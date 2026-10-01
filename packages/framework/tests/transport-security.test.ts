import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { protectTransport } from '../src/transports/security';
import { handleWebSocketProxy } from '../src/transports/websocket';
import type { RouterContext } from '../src/route-ids';

const path = '/src/pages/private/index.ts';
const ctx: RouterContext = {
    routeIdMap: new Map([['private', path]]),
    routePathToIdMap: new Map([[path, 'private']]),
    routePathToFilePathMap: new Map([['/private', path]]),
    pages: { [path]: { default: class PrivatePage {} } },
    layouts: {},
};

function appFor(context: RouterContext = ctx) {
    const app = new Hono();
    const action = vi.fn((c: any) => c.text('executed'));
    for (const route of ['/crpc', '/upload', '/sse/:componentRouteId', '/ws/:provider/:id']) {
        app.use(route, protectTransport(context));
        app.all(route, action);
    }
    return { app, action };
}

const rpc = { componentRouteId: 'private', action: 'deleteAccount', payload: [] };

describe('transport security boundary', () => {
    it.each(['https://evil.example', 'null', undefined])('rejects RPC and form CSRF from %s before dispatch', async (origin) => {
        const { app, action } = appFor();
        for (const route of ['/crpc', '/upload']) {
            const body = route === '/crpc' ? JSON.stringify(rpc) : new URLSearchParams(rpc as any);
            const response = await app.request(route, {
                method: 'POST', body,
                headers: { ...(origin ? { origin } : {}), 'content-type': route === '/crpc' ? 'text/plain' : 'application/x-www-form-urlencoded' },
            });
            expect(response.status).toBe(403);
        }
        expect(action).not.toHaveBeenCalled();
    });

    it('allows same-origin RPC and explicit allowed origins', async () => {
        for (const [origin, allowedOrigins] of [['http://localhost', undefined], ['https://trusted.example', ['https://trusted.example']]] as const) {
            const { app, action } = appFor({ ...ctx, allowedOrigins: allowedOrigins ? [...allowedOrigins] : undefined });
            const response = await app.request('/crpc', { method: 'POST', headers: { origin }, body: JSON.stringify(rpc) });
            expect(response.status).toBe(200);
            expect(action).toHaveBeenCalledOnce();
        }
    });

    it.each(['/crpc', '/upload', '/sse/private', '/ws/page/target?routePath=/private'])('enforces page guards for %s', async (route) => {
        const guard = vi.fn((c: any) => c.json({ error: 'Forbidden' }, 403));
        const getMiddlewares = vi.fn(() => [guard]);
        const { app, action } = appFor({ ...ctx, getMiddlewares });
        const post = route === '/crpc' || route === '/upload';
        const body = route === '/upload' ? new URLSearchParams({ componentRouteId: 'private', action: 'deleteAccount' }) : JSON.stringify(rpc);
        const response = await app.request(route, { method: post ? 'POST' : 'GET', headers: { origin: 'http://localhost' }, ...(post ? { body } : {}) });
        expect(response.status).toBe(403);
        expect(getMiddlewares).toHaveBeenCalledWith(path);
        expect(guard).toHaveBeenCalledOnce();
        expect(action).not.toHaveBeenCalled();
    });

    it('uses the service owner guard and preserves middleware response headers', async () => {
        const { app, action } = appFor({ ...ctx, getMiddlewares: (owner) => {
            expect(owner).toBe(path);
            return [async (c, next) => { await next(); c.header('x-guard', 'ran'); }];
        } });
        const response = await app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ service: { ownerRouteId: 'private', slot: 'account' } }) });
        expect(response.status).toBe(200);
        expect(response.headers.get('x-guard')).toBe('ran');
        expect(action).toHaveBeenCalledOnce();
    });

    it('rejects malformed RPC bodies before dispatch', async () => {
        const { app, action } = appFor();
        for (const body of ['{', 'null', '[]']) {
            const response = await app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost' }, body });
            expect(response.status).toBe(400);
        }
        expect(action).not.toHaveBeenCalled();
    });

    it('returns guard redirects through the RPC protocol without invoking the action', async () => {
        const { app, action } = appFor({ ...ctx, getMiddlewares: () => [async (c) => c.redirect('/login')] });
        const response = await app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(rpc) });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ _cossack_redirect: '/login' });
        expect(response.headers.has('Location')).toBe(false);
        expect(action).not.toHaveBeenCalled();
    });

    it.each([undefined, { id: 'real-user', role: 'member' }])('replaces forged Durable Object identity headers with trusted context (%j)', async (user) => {
        const forward = vi.fn(async () => new Response('forwarded'));
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('user' as never, user as never); await next(); });
        app.get('/ws/:provider/:id', handleWebSocketProxy(ctx));
        const response = await app.request('/ws/page/target?routePath=/private', { headers: {
            origin: 'http://localhost', 'X-User-ID': 'admin', 'X-User-Data': '{"id":"admin","role":"admin"}',
        } }, { COSSACK_OBJECT: { idFromString: () => 'target', get: () => ({ fetch: forward }) } });
        expect(response.status).toBe(200);
        const headers = (forward.mock.calls[0] as unknown as [Request])[0].headers;
        expect(headers.get('X-User-ID')).toBe(user?.id ?? null);
        expect(headers.get('X-User-Data')).toBe(user ? JSON.stringify(user) : null);
    });
});
