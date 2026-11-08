import { createRomeDB } from '@cossackframework/romedb';
import { getRequestContext } from '@cossackframework/core';
import { cloudflarePurger, cmsReconcilers, CmsNetwork, createCMS, MAIN_SITE, prefixedStorage, stripePayments, type CachePurger, type CmsHost, type NetworkSite, type PluginRunner } from '@cossackframework/cms/server';
import { aiProvider, type AiBindings } from './ai';
import type { Principal } from '@cossackframework/cms';
import { plugins } from '@cossackframework/framework/plugins';
import { modules, resources } from './resources';
import { databaseConnection, siteDatabase, siteDirectory, type DatabaseBindings } from './database';
import { pendingWrites, type PendingBindings } from './pending';
import { imageTransformer, mediaStorage, type MediaBindings } from './media';

export interface CmsBindings extends DatabaseBindings, PendingBindings, MediaBindings, AiBindings {
    /** Stripe as the payments provider: the secret key, and the webhook endpoint's signing secret. */
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    /** Stripe's API base, for tests. */
    STRIPE_API_URL?: string;
    APP_URL?: string;
    /** Sends form notifications: Cloudflare's Email Service binding, or any `{ send(message) }`. */
    EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; replyTo?: string }): Promise<unknown> };
    /** The sender of form notifications. */
    MAIL_FROM?: string;
    /** Purges the Cloudflare cache when pages change: a token with Zone → Cache Purge, and Zone → Zone Read unless the zone ID is given. */
    CLOUDFLARE_API_TOKEN?: string;
    /** The zone to purge; without it, the zone is looked up by each site's host. */
    CLOUDFLARE_ZONE_ID?: string;
    /** The Cloudflare API's base URL, for tests. */
    CLOUDFLARE_API_URL?: string;
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
    }
}

let current: { key: string; network: CmsNetwork } | undefined;
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
    const connection = databaseConnection(env);
    const key = `${connection.url}\n${connection.token ?? ''}`;
    if (current?.key !== key) {
        const db = createRomeDB({ ...connection, pending: pendingWrites(env), reconcilers: cmsReconcilers() });
        const storage = mediaStorage(env);
        const images = imageTransformer(env);
        const mail = env.EMAIL;
        const ai = aiProvider(env);
        const payments = env.STRIPE_SECRET_KEY?.trim() ? stripePayments({ secretKey: env.STRIPE_SECRET_KEY.trim(), ...(env.STRIPE_WEBHOOK_SECRET ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}), ...(env.STRIPE_API_URL ? { api: env.STRIPE_API_URL } : {}) }) : null;
        const multisite = siteDatabase(env, MAIN_SITE) !== null;
        const directory = siteDirectory(env);
        const network: CmsNetwork = new CmsNetwork({
            db,
            networkHost: () => urlOf(env.APP_URL)?.host,
            ...(multisite ? { open: site => createRomeDB({ ...siteDatabase(env, site.database)!, pending: pendingWrites(env, site.database), reconcilers: cmsReconcilers() }) } : {}),
            ...(directory ? { directory } : {}),
            hostUrl: host => siteUrl(env, { host })!,
            host: (site, siteDb) => createCMS({
                db: siteDb, network: db, site: site.id, modules, resources, plugins,
                // A site's media keys start with sites/<id>/; the main site keeps its own.
                ...(storage ? { storage: site.id === MAIN_SITE ? storage : prefixedStorage(storage, `sites/${site.id}/`) } : {}),
                ...(images ? { images } : {}), siteUrl: () => siteUrl(env, site),
                ...(mail ? { mail: { send: message => mail.send(message) }, mailFrom: env.MAIL_FROM || 'no-reply@example.com' } : {}),
                // Ending a network session ends the child sessions sites made from it.
                sessionsEnded: ended => network.endSessions(ended),
                purgers: purgers(env, site),
                ...(ai ? { ai } : {}),
                ...(payments ? { payments } : {}),
                // Bindings a plugin's manifest names in permissions.secrets; strings only, read when asked.
                secrets: name => { const value = (env as Record<string, unknown>)[name]; return typeof value === 'string' ? value : undefined; },
                // Every binding, for a plugin granted unrestricted access.
                env: env as Record<string, unknown>,
                runner: pluginRunner,
            }),
        });
        current = { key, network };
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
