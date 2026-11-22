import { createRomeDB } from '@cossackframework/romedb';
import { getRequestContext } from '@cossackframework/core';
import { cloudflarePurger, cmsReconcilers, CmsNetwork, createCMS, DEFAULT_RESERVED_PATHS, MAIN_SITE, prefixedStorage, stripePayments, type CachePurger, type CmsHost, type NetworkSite, type PluginRunner } from '@cossackframework/cms/server';
import type { CmsStorage } from '@cossackframework/cms/storage';
import { aiProvider, type AiBindings } from './ai';
import { DEFAULT_UPDATES_CHANNEL, DEFAULT_UPDATES_URL, type IconStyleName, type Principal } from '@cossackframework/cms';
import { plugins } from '@cossackframework/framework/plugins';
// The project's own: its resources, modules, the options it sets, and where the CMS keeps its data.
import { modules, options as projectOptions, resources, storage as projectStorage } from '@/cms.config';
import { announceNoteEvent } from './notes-announce';
import { reservedRouteSegments } from './reserved-paths';
import { requestCallsSignal } from './request-calls';
import { devMailTransport, markMailKeptOnly } from './dev-mail';
import { ormPeople } from './people';
import { tenantSites } from './sites';
import { accounts, asMainAccount, withTenant } from '../tenants';
import { TenantMember } from '@/models/TenantMember';
import registry from 'virtual:cossack-pages';

/**
 * The environment bindings the CMS application reads. The project's storage (`storage` in
 * src/cms.config.ts) reads its own: the database address, the media bucket and so on.
 */
export interface CmsBindings extends AiBindings {
    /** Stripe as the payments provider: the secret key, and the webhook endpoint's signing secret. */
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    /** Stripe's API base, for tests. */
    STRIPE_API_URL?: string;
    APP_URL?: string;
    /** Sends the site's emails, plain text with an HTML part: Cloudflare's Email Service binding, the Node adapter's SMTP sender, or any `{ send(message) }`. */
    EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; html?: string; replyTo?: string }): Promise<unknown> };
    /** The sender of the site's emails. */
    MAIL_FROM?: string;
    /** Purges the Cloudflare cache when pages change: a token with Zone → Cache Purge, and Zone → Zone Read unless the zone ID is given. */
    CLOUDFLARE_API_TOKEN?: string;
    /** The zone to purge; without it, the zone is looked up by each site's host. */
    CLOUDFLARE_ZONE_ID?: string;
    /** The Cloudflare API's base URL, for tests. */
    CLOUDFLARE_API_URL?: string;
    /**
     * Where Tools → Updates sends its request: the project's pipeline, which runs `cossack upgrade`.
     * For GitHub: https://api.github.com/repos/<owner>/<repository>/dispatches.
     */
    CMS_UPDATE_HOOK_URL?: string;
    /** Sent to the hook as a bearer token. For GitHub: a fine-grained token with Contents: read and write on the repository. */
    CMS_UPDATE_HOOK_TOKEN?: string;
}

declare module 'hono' {
    interface ContextVariableMap {
        /** The host of the site the request reached. */
        cms: CmsHost;
        site: NetworkSite;
        /** The network the site belongs to; `enabled()` says whether it serves added sites. */
        network: CmsNetwork;
        principal: Principal;
        /** Cache tags the site layout adds to every page: the collections its widget areas list. */
        'cms.cacheTags'?: readonly string[];
        /** What the dashboard computed for this request already (`remember` in `dashboard/access.ts`). */
        'cms.memo'?: Map<string, Promise<unknown>>;
        /** The Solar style this request's icons are drawn in (Settings → Appearance); `iconStyle()` reads it. */
        'cms.iconStyle'?: IconStyleName;
        /** The dashboard's `ui-palette` meta content, `<base> <accent>`, from Settings → Interface. */
        'cms.palette'?: string;
    }
}

let current: { key: string; network: CmsNetwork } | undefined;
/** Each network's update settings, for the scheduled run, which has the network and not the bindings. */
const networkUpdates = new WeakMap<CmsNetwork, { check: boolean; url: string; channel: string }>();
export function updateSettingsOf(network: CmsNetwork): { check: boolean; url: string; channel: string } | undefined {
    return networkUpdates.get(network);
}

/** The update notice's settings, from `updates` in src/cms.config.ts; an unset one keeps its default. */
export function updateSettings(env: CmsBindings): { check: boolean; url: string; channel: string } {
    const project = typeof projectOptions === 'function' ? projectOptions(env as Record<string, unknown>, { id: MAIN_SITE }) : projectOptions;
    return { check: project.updates?.check !== false, url: project.updates?.url || DEFAULT_UPDATES_URL, channel: project.updates?.channel || DEFAULT_UPDATES_CHANNEL };
}
let pluginRunner: PluginRunner | null = null;

/**
 * Runs isolated plugins: a Cloudflare Worker entry sets `cloudflarePluginRunner()` from
 * `@cossackframework/cms/cloudflare` before the first request. Node sets none, and its build
 * keeps every plugin in the application.
 */
export function setPluginRunner(runner: PluginRunner | null): void {
    pluginRunner = runner;
    current = undefined;
}

/**
 * One network per isolate or process, keyed by the main database's address and credential. The
 * main database holds the accounts and the site registry; each added site has its own database.
 */
export function networkFor(env: CmsBindings): CmsNetwork {
    // The runtime's storage names its own bindings; this module passes the environment through.
    const store = projectStorage as CmsStorage<unknown>;
    const connection = store.databaseConnection(env);
    const key = `${connection.url}\n${connection.token ?? ''}`;
    if (current?.key !== key) {
        // On Workers a request's database calls end with it (cms/request-calls.ts), or a call of a
        // request that ended first would keep one of the client's places for good.
        const calls = store.cancelsRequestIo ? { requestSignal: requestCallsSignal } : {};
        const db = createRomeDB({ ...connection, pending: store.pendingWrites(env), reconcilers: cmsReconcilers(), ...calls });
        const storage = store.mediaStorage(env);
        const images = store.imageTransformer(env);
        const mail = env.EMAIL;
        const ai = aiProvider(env);
        const payments = env.STRIPE_SECRET_KEY?.trim() ? stripePayments({ secretKey: env.STRIPE_SECRET_KEY.trim(), ...(env.STRIPE_WEBHOOK_SECRET ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}), ...(env.STRIPE_API_URL ? { api: env.STRIPE_API_URL } : {}) }) : null;
        const multisite = store.siteDatabase(env, MAIN_SITE) !== null;
        const directory = store.siteDirectory(env);
        const webhookFetch = store.webhookFetch;
        const network: CmsNetwork = new CmsNetwork({
            db,
            networkHost: () => urlOf(env.APP_URL)?.host,
            ...(multisite ? { open: site => createRomeDB({ ...store.siteDatabase(env, site.database)!, pending: store.pendingWrites(env, site.database), reconcilers: cmsReconcilers(), ...calls }) } : {}),
            ...(directory ? { directory } : {}),
            hostUrl: host => siteUrl(env, { host })!,
            // Sites are the dashboard package's tenants; a site's users are in the site's own database.
            sites: tenantSites,
            inSite: (site, work) => site.id === MAIN_SITE ? asMainAccount(() => accounts(work)) : withTenant({ id: site.id, slug: site.id, name: site.name ?? site.id, database: site.database, status: 'active' }, work),
            memberSites: accountId => asMainAccount(() => accounts(async () => (await TenantMember.find({ where: { userId: accountId }, take: 500 })).map(member => member.tenantId))),
            host: (site, siteDb) => {
              // What the project sets in src/cms.config.ts goes over the defaults below.
              const project = typeof projectOptions === 'function' ? projectOptions(env as Record<string, unknown>, site) : projectOptions;
              // The project's transport, else the EMAIL binding. In development the mail is also kept for
              // GET /api/cms/dev/mail and printed (cms/dev-mail.ts), with or without a transport.
              const transport = project.mail ?? (mail ? { send: (message: Parameters<NonNullable<typeof mail>['send']>[0]) => mail.send(message) } : undefined);
              const siteMail = localAddress(env.APP_URL) ? devMailTransport(site.id, transport) : transport;
              // Health still reports a missing sender while development keeps the mail.
              const made = (host: CmsHost) => siteMail && !transport ? markMailKeptOnly(host) : host;
              return made(createCMS({
                db: siteDb, network: db, site: site.id, modules, resources, plugins,
                // Accounts, roles and sign-in are the dashboard package's, on the ORM (specs/cms-on-dashboard.md).
                people: ormPeople,
                // A site whose APP_URL is this machine is in development: its webhooks may stay local. No APP_URL is no exception.
                localWebhooks: localAddress(env.APP_URL),
                ...(webhookFetch && !localAddress(env.APP_URL) ? { webhookFetch } : {}),
                // A site's media keys start with sites/<id>/; the main site keeps its own.
                ...(storage ? { storage: site.id === MAIN_SITE ? storage : prefixedStorage(storage, `sites/${site.id}/`) } : {}),
                ...(images ? { images } : {}), siteUrl: () => siteUrl(env, site),
                ...(siteMail ? { mailFrom: env.MAIL_FROM || 'no-reply@example.com' } : {}),
                // Ending a network session ends the child sessions sites made from it.
                sessionsEnded: ended => network.endSessions(ended),
                // A note's webhooks and emails, from the outbox job its write queued.
                announceNote: announceNoteEvent,
                purgers: [...purgers(env, site), ...(project.purgers ?? [])],
                ...(ai ? { ai } : {}),
                ...(payments ? { payments } : {}),
                // Bindings a plugin's manifest names in permissions.secrets; strings only, read when asked.
                secrets: name => { const value = (env as Record<string, unknown>)[name]; return typeof value === 'string' ? value : undefined; },
                // Every binding, for a plugin granted unrestricted access.
                env: env as Record<string, unknown>,
                runner: pluginRunner,
                ...(({ purgers: _purgers, reservedPaths: _reserved, updates: _updates, mail: _mail, ...rest }) => rest)(project),
                ...(siteMail ? { mail: siteMail } : {}),
                // An entry's slug cannot take the address of a page: the CMS's routes, every page file of the
                // application (the project's, the CMS's and plugins'), and what the project names itself.
                reservedPaths: [...new Set([...DEFAULT_RESERVED_PATHS, ...reservedRouteSegments(Object.keys(registry.pages)), ...(project.reservedPaths ?? [])])],
              }));
            },
        });
        current = { key, network };
        networkUpdates.set(network, updateSettings(env));
    }
    return current.network;
}

/** The caches in front of a site that its changes purge: Cloudflare's, when the application has a token for it. */
function purgers(env: CmsBindings, site: NetworkSite): CachePurger[] {
    const token = env.CLOUDFLARE_API_TOKEN?.trim();
    if (!token) return [];
    return [cloudflarePurger({
        token, ...(env.CLOUDFLARE_ZONE_ID ? { zoneId: env.CLOUDFLARE_ZONE_ID } : {}), ...(env.CLOUDFLARE_API_URL ? { api: env.CLOUDFLARE_API_URL } : {}),
        hosts: () => { const host = urlOf(siteUrl(env, site))?.hostname; return host ? [host] : []; },
    })];
}

/** The main site's host. A request's own site is `c.get('cms')`. */
export function cmsFor(env: CmsBindings): CmsHost {
    return networkFor(env).main;
}

/**
 * A site's address: APP_URL for the main site, its primary domain for the others, never the
 * request's Host header. With an http APP_URL (development), sites keep its scheme and port.
 */
export function siteUrl(env: CmsBindings, site: Pick<NetworkSite, 'host'>): string | undefined {
    if (!site.host) return env.APP_URL;
    const network = urlOf(env.APP_URL);
    return network?.protocol === 'http:' ? `http://${site.host}${network.port ? `:${network.port}` : ''}` : `https://${site.host}`;
}

function urlOf(value: string | undefined): URL | undefined {
    try { return value ? new URL(value) : undefined; }
    catch { return undefined; }
}

/** The CMS host of the current request, for server code without a context argument. */
export function currentCms(): CmsHost {
    const c = getRequestContext();
    const cms = c?.get('cms');
    if (!cms) throw new Error('No CMS on this request. Register cmsMiddleware in src/bootstrap/middlewares.ts.');
    return cms;
}

/** Whether APP_URL names this machine. An unset or unreadable APP_URL is not local. */
export function localAddress(appUrl: string | undefined): boolean {
    const host = urlOf(appUrl)?.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host?.endsWith('.localhost') === true;
}

/** A site's RomeDB database by the site's ID, for the application's own tables there (src/orm/factory.ts: `tenantORM`). */
export async function siteDatabase(env: CmsBindings, id: string) {
    return networkFor(env).databaseOf(id);
}
