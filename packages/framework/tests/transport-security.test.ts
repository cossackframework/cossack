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
            const body = route === '/crpc' ? JSON.stringify(rpc) : new URLSearchParams({ ...rpc, payload: JSON.stringify(rpc.payload) });
            const response = await app.request(route, {
                method: 'POST', body,
                headers: { ...(origin ? { origin } : {}), 'content-type': route === '/crpc' ? 'text/plain' : 'application/x-www-form-urlencoded' },
            });
            expect(response.status).toBe(403);
        }
        expect(action).not.toHaveBeenCalled();
    });

    it.each(['/crpc', '/upload'])('retains a supplied UUID correlation ID on %s without bypassing guards', async route => {
        const id = crypto.randomUUID();
        const guard = vi.fn((c: any) => c.json({ error: 'Forbidden' }, 403));
        const { app, action } = appFor({ ...ctx, getMiddlewares: () => [guard] });
        const body = route === '/crpc' ? JSON.stringify(rpc) : new URLSearchParams({ ...rpc, payload: JSON.stringify(rpc.payload) });
        const response = await app.request(route, { method: 'POST', body, headers: {
            origin: 'http://localhost', 'X-Cossack-Request-Id': id,
            'Content-Type': route === '/crpc' ? 'application/json' : 'application/x-www-form-urlencoded',
        } });
        expect(response.status).toBe(403); expect(response.headers.get('X-Cossack-Request-Id')).toBe(id);
        expect(guard).toHaveBeenCalledOnce(); expect(action).not.toHaveBeenCalled();
    });
    it.each(['arbitrary', '', 'x'.repeat(10000), '00000000-0000-1000-8000-000000000000'])('replaces unsupported correlation ID (%#)', async id => {
        const { app } = appFor();
        const response = await app.request('/crpc', { method: 'POST', body: JSON.stringify(rpc),
            headers: { origin: 'http://localhost', 'X-Cossack-Request-Id': id } });
        expect(response.headers.get('X-Cossack-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
        expect(response.headers.get('X-Cossack-Request-Id')).not.toBe(id);
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

    it('rejects oversized JSON RPC bodies with 413 before dispatch', async () => {
        const { app, action } = appFor();
        const body = JSON.stringify({ ...rpc, payload: ['x'.repeat(1024 * 1024)] });
        const response = await app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost' }, body });
        expect(response.status).toBe(413);
        expect((await response.json() as any).code).toBe('COSSACK_RPC_REQUEST_TOO_LARGE');
        expect(action).not.toHaveBeenCalled();
        const limited = appFor({ ...ctx, rpcBodyLimits: { jsonBytes: 64 } });
        const small = await limited.app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost' },
            body: JSON.stringify({ ...rpc, payload: ['x'.repeat(100)] }) });
        expect(small.status).toBe(413);
        expect(limited.action).not.toHaveBeenCalled();
    });

    it('rejects multipart uploads above the limit by Content-Length and by streamed size', async () => {
        const form = new FormData();
        for (const [key, value] of Object.entries({ ...rpc, payload: JSON.stringify([{ _cossack_file_id: 'file_0' }]) })) form.set(key, String(value));
        form.set('file_0', new File(['x'.repeat(4096)], 'big.bin'));
        const encoded = new Response(form);
        const type = encoded.headers.get('content-type')!;
        const bytes = new Uint8Array(await encoded.arrayBuffer());
        const { app, action } = appFor({ ...ctx, rpcBodyLimits: { uploadBytes: 1024 } });
        const declared = await app.request('/upload', { method: 'POST', body: bytes,
            headers: { origin: 'http://localhost', 'content-type': type, 'content-length': String(bytes.byteLength) } });
        expect(declared.status).toBe(413);
        expect((await declared.json() as any).code).toBe('COSSACK_RPC_REQUEST_TOO_LARGE');
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
            for (let i = 0; i < bytes.byteLength; i += 256) controller.enqueue(bytes.slice(i, i + 256));
            controller.close();
        } });
        const streamed = await app.request(new Request('http://localhost/upload', { method: 'POST', body: stream,
            duplex: 'half', headers: { origin: 'http://localhost', 'content-type': type } } as RequestInit));
        expect(streamed.status).toBe(413);
        expect((await streamed.json() as any).code).toBe('COSSACK_RPC_REQUEST_TOO_LARGE');
        expect(action).not.toHaveBeenCalled();
        const allowed = appFor();
        const ok = await allowed.app.request('/upload', { method: 'POST', body: bytes, headers: { origin: 'http://localhost', 'content-type': type } });
        expect(ok.status).toBe(200);
        expect(allowed.action).toHaveBeenCalledOnce();
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
        app.use('*', async (c, next) => {
            c.set('user' as never, user as never);
            if (user) c.set('cossack.captureRealtimeIdentity' as never, (async () => ({
                version: 1, provider: 'fixture.session', data: { reference: 'opaque', fingerprint: 'digest' },
            })) as never);
            await next();
        });
        app.get('/ws/:provider/:id', handleWebSocketProxy(ctx));
        const response = await app.request('/ws/page/target?routePath=/private', { headers: {
            origin: 'http://localhost', 'X-User-ID': 'admin', 'X-User-Data': '{"id":"admin","role":"admin"}',
        } }, { COSSACK_OBJECT: { idFromString: () => 'target', get: () => ({ fetch: forward }) } });
        expect(response.status).toBe(200);
        const headers = (forward.mock.calls[0] as unknown as [Request])[0].headers;
        expect(headers.get('X-User-ID')).toBe(user?.id ?? null);
        expect(headers.get('X-User-Data')).toBe(user ? JSON.stringify(user) : null);
        expect(headers.get('X-Cossack-Realtime-Scope')).toBe(user ? 'user:real-user' : 'user:anonymous');
        expect(headers.get('X-Cossack-Realtime-Identity')).toBe(user ? JSON.stringify({
            version: 1, provider: 'fixture.session', data: { reference: 'opaque', fingerprint: 'digest' },
        }) : null);
        expect(headers.get('Cookie')).toBeNull();
    });

    it('forwards a terminal rejection when a custom-scope socket targets another Durable Object', async () => {
        class TeamPage {}
        Reflect.defineMetadata('page:options', { scope: (c: any) => `team:${c.req.param('team')}` }, TeamPage);
        const teamContext: RouterContext = {
            ...ctx,
            pages: { [path]: { default: TeamPage } },
            routePathToFilePathMap: new Map([['/private', path]]),
        };
        const forward = vi.fn(async () => new Response('upgraded'));
        const app = new Hono();
        app.use('*', async (c, next) => {
            c.set('user' as never, { id: 'member' } as never);
            c.set('cossack.captureRealtimeIdentity' as never, (async () => ({ version: 1, provider: 'fixture.session', data: {} })) as never);
            await next();
        });
        app.get('/ws/:provider/:id', handleWebSocketProxy(teamContext));
        const params = JSON.stringify({ team: 'alpha' });
        const response = await app.request(`/ws/page/stale?${new URLSearchParams({ routePath: '/private', params })}`, {
            headers: { origin: 'http://localhost' },
        }, { COSSACK_OBJECT: {
            idFromString: () => 'stale', idFromName: () => ({ toString: () => 'current' }), get: () => ({ fetch: forward }),
        } });
        expect(response.status).toBe(200);
        const forwarded = (forward.mock.calls[0] as unknown as [Request])[0];
        expect(forwarded.headers.get('X-Cossack-Realtime-Target-Valid')).toBe('false');
        expect(forwarded.headers.get('X-Cossack-Realtime-Scope')).toBe('team:alpha');
    });
});
