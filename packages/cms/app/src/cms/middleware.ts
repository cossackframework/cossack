import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSupportedLocales, LOCALE_COOKIE_NAME, setRequestLocale } from '@cossackframework/core';
import { ANONYMOUS, type Principal } from '@cossackframework/cms';
import { MAIN, type SiteResolution } from '@cossackframework/cms/server';
import { cmsFor, networkFor, type CmsBindings } from './index';
import { handoff } from './handoff';
import { runMaintenance } from './maintenance';

/**
 * For `createApp({ isPluginActive })`: a rendered plugin's pages, layouts and HTTP handlers
 * answer only while the plugin is active (migrated and granted); otherwise they are not found,
 * like an unknown URL. Before setup, or while the CMS is unavailable, no plugin route answers.
 */
export async function pluginRouteActive(plugin: string, c: Context): Promise<boolean> {
    try { return await (c.get('cms') ?? cmsFor(c.env as CmsBindings)).pluginActive(plugin); }
    catch { return false; }
}

/** When each site's maintenance last ran in this isolate, by database. */
const lastMaintenance = new Map<string, number>();

/**
 * Finds the site the request's host names and puts its CMS host on the context with current
 * collection definitions, then delivers outbox events and webhooks after requests that wrote.
 * Maintenance also runs at most once a minute for each site. A host no site claims gets a 404,
 * an alias redirects to its site's primary domain, and an archived site shows only its dashboard.
 */
export const cmsMiddleware: MiddlewareHandler = async (c, next) => {
    const network = networkFor(c.env as CmsBindings);
    const url = new URL(c.req.url);
    // Before setup the registry does not exist yet: the main site answers.
    const found: SiteResolution = await network.resolve(url.host).catch(() => ({ kind: 'site', site: MAIN }));
    // Which site a domain serves, for the network's domain check; aliases answer before they redirect.
    if (url.pathname === '/.well-known/cossack-site' && found.kind !== 'missing') {
        return c.text(found.kind === 'redirect' ? found.site : found.site.id, 200, { 'cache-control': 'no-store' });
    }
    if (found.kind === 'missing') return c.text('No site at this address.', 404);
    if (found.kind === 'redirect') {
        url.hostname = found.host;
        return c.redirect(url.toString(), 301);
    }
    if (found.kind === 'archived' && !/^\/(?:dashboard|auth)(?:\/|$)/.test(c.req.path)) return c.text('This site is archived.', 503);
    const cms = network.hostOf(found.site);
    c.set('cms', cms);
    c.set('site', found.site);
    c.set('network', network);
    c.set('principal', ANONYMOUS);
    // Sign-in happens on the network host; other sites get their sessions through a handoff.
    const routed = await handoff(c, network, found.site);
    if (routed) return routed;
    // Before setup the definition tables do not exist yet; built-in collections apply.
    await cms.ready().catch(error => console.error('[cms] could not load collections', error));
    // Until a user picks a language (Profile → Dashboard language), the dashboard speaks the
    // site's default one when a catalog has it. Site pages then switch to their content's language.
    const supported = getSupportedLocales();
    if (supported.length > 1 && !getCookie(c, LOCALE_COOKIE_NAME)) {
        const main = (await cms.languages()).default;
        if (supported.some(code => code.toLowerCase() === main.toLowerCase())) setRequestLocale(main);
    }
    const writes = cms.outboxWrites;
    await next();
    const now = Date.now();
    if (cms.outboxWrites !== writes) later(c, cms.outbox.dispatch({ limit: 10 }).then(() => cms.webhooks.dispatch({ limit: 10 })));
    if (now - (lastMaintenance.get(found.site.database) ?? 0) > 60_000) {
        lastMaintenance.set(found.site.database, now);
        later(c, runMaintenance(cms, { warm: false }));
    }
};

/**
 * After auth: the request principal is the signed-in user's, or anonymous. Under /api/, an
 * application password (`Authorization: Bearer cms_…`) signs the request in instead; read-only
 * passwords may only read, and token requests skip the session's same-origin checks.
 */
export const cmsPrincipal: MiddlewareHandler = async (c, next) => {
    const session = (c.get('user') as { principal?: Principal } | undefined)?.principal;
    c.set('principal', session ?? ANONYMOUS);
    const header = c.req.header('authorization') ?? '';
    if (!session && /^Bearer cms_/i.test(header) && (c.req.path === '/api' || c.req.path.startsWith('/api/'))) {
        const token = await c.get('cms').tokenPrincipal(header.slice(7).trim()).catch(() => null);
        if (!token) return c.json({ error: 'The application password is not valid.', code: 'CMS_UNAUTHENTICATED' }, 401, { 'www-authenticate': 'Bearer' });
        if (token.scope === 'read' && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return c.json({ error: 'This application password can only read.', code: 'CMS_FORBIDDEN' }, 403);
        c.set('principal', token.principal);
        c.set('cms.token', true);
    }
    await next();
};

declare module 'hono' {
    interface ContextVariableMap {
        /** The request signed in with an application password. */
        'cms.token': boolean;
    }
}

function later(c: Parameters<MiddlewareHandler>[0], work: Promise<unknown>): void {
    const settled = work.catch(error => console.error('[cms] background work failed', error));
    try { c.executionCtx.waitUntil(settled); } catch { /* Node keeps running the promise. */ }
}
