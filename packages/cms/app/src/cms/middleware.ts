import type { MiddlewareHandler } from 'hono';
import { ANONYMOUS, type Principal } from '@cossackframework/cms';
import { cmsFor, type CmsBindings } from './index';
import { runMaintenance } from './maintenance';

let lastMaintenance = 0;

/**
 * Puts the CMS host on the context with current collection definitions, then delivers outbox
 * events and webhooks after requests that wrote. Maintenance also runs at most once a minute.
 */
export const cmsMiddleware: MiddlewareHandler = async (c, next) => {
    const cms = cmsFor(c.env as CmsBindings);
    c.set('cms', cms);
    c.set('principal', ANONYMOUS);
    // Before setup the definition tables do not exist yet; built-in collections apply.
    await cms.ready().catch(error => console.error('[cms] could not load collections', error));
    const writes = cms.outboxWrites;
    await next();
    const now = Date.now();
    if (cms.outboxWrites !== writes) later(c, cms.outbox.dispatch({ limit: 10 }).then(() => cms.webhooks.dispatch({ limit: 10 })));
    if (now - lastMaintenance > 60_000) {
        lastMaintenance = now;
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
