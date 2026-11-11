import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { enforceRateLimit, getClientIp, getSupportedLocales, LOCALE_COOKIE_NAME, setRequestLocale } from '@cossackframework/core';
import { ANONYMOUS, escapeHtml, hasPermission, PERMISSIONS, type Principal, DEFAULT_ICON_STYLE, isIconStyle } from '@cossackframework/cms';
import { MAIN, MAIN_SITE, networkSite, type SiteResolution } from '@cossackframework/cms/server';
import { cmsFor, networkFor, type CmsBindings } from './index';
import { handoff } from './handoff';
import { dashboardPalette } from '../dashboard/head';
import { runMaintenance } from './maintenance';
import { accountNeedsSecondFactor, secondFactorRequired, type PublicUser } from '../auth';

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
    let found: SiteResolution = await network.resolve(url.host).catch(() => ({ kind: 'site', site: MAIN }));
    // API clients name a site on the network host: `X-Cossack-Site: blog` (or `?site=blog` on the MCP
    // endpoint) serves that site, so a tool need not reach the site's own address.
    const requested = requestedSite(c, url);
    if (requested && requested !== MAIN_SITE && found.kind === 'site' && found.site.id === MAIN_SITE) {
        if (!(await network.enabled().catch(() => false))) return c.json({ error: 'The network is off: only the main site answers.', code: 'CMS_NOT_FOUND' }, 404);
        const record = await network.sites.get(requested).catch(() => null);
        if (!record || record.status === 'deleted' || record.status === 'creating') return c.json({ error: `No site with the ID ${requested}.`, code: 'CMS_NOT_FOUND' }, 404);
        found = record.status === 'archived' ? { kind: 'archived', site: networkSite(record) } : { kind: 'site', site: networkSite(record) };
    }
    // Which site a domain serves, for the network's domain check; aliases answer before they redirect.
    if (url.pathname === '/.well-known/cossack-site' && found.kind !== 'missing') {
        return c.text(found.kind === 'redirect' ? found.site : found.site.id, 200, { 'cache-control': 'no-store' });
    }
    if (found.kind === 'missing') return c.text('No site at this address.', 404);
    if (found.kind === 'redirect') {
        url.hostname = found.host;
        return c.redirect(url.toString(), 301);
    }
    if (found.kind === 'archived' && !/^\/(?:dashboard|auth)(?:\/|$)/.test(c.req.path)) {
        return c.req.path.startsWith('/api/') ? c.json({ error: 'This site is archived.', code: 'CMS_UNAVAILABLE' }, 503) : c.text('This site is archived.', 503);
    }
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
    // Settings → Interface: the style every icon of this request is drawn in (`iconStyle()` in
    // cms/icons.ts reads it) and the dashboard's palettes (`dashboardHead()` in dashboard/head.ts).
    const [style, palette, accent] = await Promise.all((['interface.iconStyle', 'interface.palette', 'interface.accent'] as const).map(key => cms.settings.get(key).catch(() => undefined)));
    c.set('cms.iconStyle', isIconStyle(style) ? style : DEFAULT_ICON_STYLE);
    c.set('cms.palette', dashboardPalette(palette, accent));
    // Until a user picks a language (Profile → Dashboard language), the dashboard speaks the
    // site's default one when a catalog has it. Site pages then switch to their content's language.
    const supported = getSupportedLocales();
    if (supported.length > 1 && !getCookie(c, LOCALE_COOKIE_NAME)) {
        const main = (await cms.languages()).default;
        if (supported.some(code => code.toLowerCase() === main.toLowerCase())) setRequestLocale(main);
    }
    const writes = cms.outboxWrites;
    await next();
    securityHeaders(c, url);
    const now = Date.now();
    if (cms.outboxWrites !== writes) later(c, cms.outbox.dispatch({ limit: 10 }).then(() => cms.webhooks.dispatch({ limit: 10 })));
    if (now - (lastMaintenance.get(found.site.database) ?? 0) > 60_000) {
        lastMaintenance.set(found.site.database, now);
        later(c, runMaintenance(cms, { warm: false }));
    }
};

/**
 * Headers every response carries unless the route set its own: no MIME sniffing, a tight
 * referrer, no framing by other sites (Live Edit frames the site from its own origin), and HSTS
 * over https. A Content-Security-Policy is left to the deployment: pages inline their hydration
 * state, so a policy needs the deployment's nonces or hashes.
 */
function securityHeaders(c: Context, url: URL): void {
    const headers = c.res.headers;
    if (!headers.has('x-content-type-options')) c.header('x-content-type-options', 'nosniff');
    if (!headers.has('referrer-policy')) c.header('referrer-policy', 'strict-origin-when-cross-origin');
    if (!headers.has('x-frame-options') && !headers.has('content-security-policy')) c.header('x-frame-options', 'SAMEORIGIN');
    if (url.protocol === 'https:' && !headers.has('strict-transport-security')) c.header('strict-transport-security', 'max-age=31536000');
}

/**
 * After auth: the request principal is the signed-in user's, or anonymous. Under /api/, an
 * application password (`Authorization: Bearer cms_…`) signs the request in instead; read-only
 * passwords may only read, and token requests skip the session's same-origin checks.
 */
export const cmsPrincipal: MiddlewareHandler = async (c, next) => {
    const user = c.get('user') as PublicUser | undefined;
    let session = user?.principal as Principal | undefined;
    // Staff that General settings require to use two-step sign-in act with their session only
    // once they have a second factor. Until then the session is anonymous everywhere (the site,
    // Live Edit, previews, server methods), so no page has to repeat the check; signing in and
    // out stays open, the rest of the API refuses, and the dashboard guards send them to set one up.
    if (session && !c.req.path.startsWith('/api/auth/') && await secondFactorRequired(user!, c).catch(() => true)) {
        if (API_PATH.test(c.req.path) && !VISITOR_API.test(c.req.path)) return secondFactorRefusal(c);
        session = undefined;
    }
    c.set('principal', session ?? ANONYMOUS);
    const header = c.req.header('authorization') ?? '';
    if (!user && /^Bearer cms_/i.test(header) && API_PATH.test(c.req.path)) {
        const token = await c.get('cms').tokenPrincipal(header.slice(7).trim()).catch(() => null);
        if (!token) return c.json({ error: 'The application password is not valid.', code: 'CMS_UNAUTHENTICATED' }, 401, { 'www-authenticate': 'Bearer' });
        // An application password made before the requirement was turned on stops working too.
        if (token.principal.kind === 'user' && await accountNeedsSecondFactor({ id: token.principal.id, principal: token.principal }).catch(() => true)) return secondFactorRefusal(c);
        if (token.scope === 'read' && c.req.path !== MCP_PATH && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return c.json({ error: 'This application password can only read.', code: 'CMS_FORBIDDEN' }, 403);
        c.set('principal', token.principal);
        c.set('cms.token', true);
        c.set('cms.tokenScope', token.scope);
    }
    // Maintenance or coming-soon mode: visitors without dashboard access get a holding page with status 503; the dashboard, sign-in, the API and assets keep answering.
    if (!HOLDING_EXEMPT.test(c.req.path) && !hasPermission(c.get('principal'), PERMISSIONS.dashboard)) {
        const mode = await c.get('cms').settings.get('general.maintenance').catch(() => 'off') as 'off' | 'maintenance' | 'soon';
        if (mode !== 'off') {
            const settings = await c.get('cms').settings.all();
            return c.html(holdingPage(mode, settings['general.siteTitle'], settings['general.maintenanceMessage']), 503, { 'retry-after': '3600', 'cache-control': 'private, no-store' });
        }
    }
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
        // One budget per caller for the whole API, counted in the framework's rate-limit store (per isolate unless a shared store is configured).
        const principal = c.get('principal');
        const limited = await enforceRateLimit(c, 'cms-api', { window: 60_000, max: principal.kind === 'anonymous' ? API_LIMITS.anonymous : API_LIMITS.signedIn,
            key: () => principal.kind === 'user' ? `user:${principal.id}` : `ip:${getClientIp(c)}`, message: 'Too many requests. Slow down and try again in a minute.' });
        if (limited) return limited;
    }
    await next();
};

const API_PATH = /^\/api(?:\/|$)/;

/** The API endpoints visitors use from the site (comments, forms, search, menus): staff still waiting to add a second factor use them as anyone does. */
const VISITOR_API = /^\/api\/cms\/(?:comments|search|recovery|payments\/webhook|menus\/[^/]+|forms\/[^/]+)\/?$/;

function secondFactorRefusal(c: Context) {
    return c.json({ error: 'This site requires two-step sign-in: set it up under Profile → Security first.', code: 'CMS_SECOND_FACTOR_REQUIRED' }, 403);
}

/** Paths the holding page never covers: the dashboard, sign-in, the API, the framework's own routes, assets and media. */
const HOLDING_EXEMPT = /^\/(?:dashboard|auth|api|crpc|sse|assets|media|_cossack|\.well-known|favicon\.ico|manifest\.webmanifest|robots\.txt)(?:\/|$)/;

/** The holding page of maintenance and coming-soon mode: the site's title, the message, no script, no theme (the theme may be what is being worked on). */
export function holdingPage(mode: 'maintenance' | 'soon', title: string, message: string): string {
    const esc = escapeHtml;
    const heading = mode === 'soon' ? 'Coming soon' : 'Down for maintenance';
    const text = message.trim() || (mode === 'soon' ? 'This site has not launched yet. Check back soon.' : 'This site is being worked on and will be back shortly.');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(heading)} · ${esc(title)}</title>`
        + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f8fafc;color:#0f172a}main{max-width:36rem;padding:2rem;text-align:center}h1{font-size:1.75rem;margin:0 0 .5rem}p{margin:.5rem 0;white-space:pre-line;color:#475569}.site{font-size:.875rem;letter-spacing:.05em;text-transform:uppercase;color:#64748b}@media(prefers-color-scheme:dark){body{background:#0b1220;color:#e2e8f0}p{color:#94a3b8}}</style></head>'
        + `<body><main><p class="site">${esc(title)}</p><h1>${esc(heading)}</h1><p>${esc(text)}</p></main></body></html>`;
}

/** API requests per minute per caller: a signed-in user or application password, or an anonymous address. */
export const API_LIMITS = Object.freeze({ anonymous: 120, signedIn: 600 });

/** The site an API request names, if any: the `X-Cossack-Site` header, or `?site=` on the MCP endpoint, whose clients set a URL. */
function requestedSite(c: Context, url: URL): string | null {
    if (!url.pathname.startsWith('/api/')) return null;
    const named = c.req.header('x-cossack-site') ?? (url.pathname === MCP_PATH ? url.searchParams.get('site') : null);
    return named && /^[a-z0-9][a-z0-9-]{0,62}$/.test(named) ? named : null;
}

/** The MCP endpoint checks read-only application passwords itself, per tool. */
export const MCP_PATH = '/api/cms/mcp';

declare module 'hono' {
    interface ContextVariableMap {
        /** The request signed in with an application password. */
        'cms.token': boolean;
        /** What that application password may do. */
        'cms.tokenScope': 'read' | 'write';
    }
}

function later(c: Parameters<MiddlewareHandler>[0], work: Promise<unknown>): void {
    const settled = work.catch(error => console.error('[cms] background work failed', error));
    try { c.executionCtx.waitUntil(settled); } catch { /* Node keeps running the promise. */ }
}
