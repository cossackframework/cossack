import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Context } from 'hono';
import { handleSseEndpoint, registerSseStoreEntry, resolveSseScopeKey, syncSseState, __sseStoreSize } from '../src/transports/sse';
import type { RouterContext } from '../src/route-ids';
vi.mock('virtual:cossack-config', () => ({ default: {} }));

vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: Context, next: () => Promise<void>) => {
    const identity = c.get('cossack.realtimeIdentity');
    if (identity?.provider === 'fixture.session') c.set('user', identity.data);
    await next();
}] }));

// A Page component carrying the default scope (no scope() in pageOptions).
// resolveSseScopeKey will fall back to `user:${user?.id || 'anonymous'}`.
class SsePage {}
 Reflect.defineMetadata('page:options', { transport: 'sse' }, SsePage);

function makeCtx(overrides: Partial<RouterContext> = {}): RouterContext {
    return {
        routeIdMap: new Map([['sse_page', '/src/pages/sse/index.ts']]),
        routePathToIdMap: new Map([['/src/pages/sse/index.ts', 'sse_page']]),
        routePathToFilePathMap: new Map(),
        pages: { '/src/pages/sse/index.ts': { default: SsePage } },
        layouts: {},
        ...overrides,
    };
}

function makeContext(user: unknown, scopeKey: string | null, signal?: AbortSignal): Context {
    const url = new URL('http://localhost/sse/sse_page');
    if (scopeKey !== null) url.searchParams.set('scopeKey', scopeKey);
    const c = new Context(new Request(url, { signal, headers: { origin: 'http://localhost' } }), { env: {} });
    c.req.param = ((name?: string) => name === 'componentRouteId' ? 'sse_page' : { componentRouteId: 'sse_page' }) as typeof c.req.param;
    c.set('user', user);
    if (user) c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: user }));
    return c;
}

describe('handleSseEndpoint scope validation (cross-user eavesdropping guard)', () => {
    it('re-evaluates custom scopes instead of trusting another tenant key', async () => {
        class TenantPage {}
        Reflect.defineMetadata('page:options', {
            transport: 'sse', scope: (c: Context) => `tenant:${c.get('user').tenant}`,
        }, TenantPage);
        const handler = handleSseEndpoint(makeCtx({ pages: { '/src/pages/sse/index.ts': { default: TenantPage } } }));
        const response = await handler(makeContext({ id: 'alice', tenant: 'a' }, 'tenant:b'));
        expect(response.status).toBe(403);
    });

    it('rejects a scopeKey belonging to another user with 403', async () => {
        const handler = handleSseEndpoint(makeCtx());
        // Authenticated as alice, but requesting bob's scope
        const res = await handler(makeContext({ id: 'alice' }, 'user:bob'));
        expect(res.status).toBe(403);
    });

    it('rejects a missing scopeKey with 403', async () => {
        const handler = handleSseEndpoint(makeCtx());
        const res = await handler(makeContext({ id: 'alice' }, null));
        expect(res.status).toBe(403);
    });

    it('rejects an anonymous scope when the user is authenticated', async () => {
        const handler = handleSseEndpoint(makeCtx());
        // Authenticated as alice, requesting the anonymous scope
        const res = await handler(makeContext({ id: 'alice' }, 'user:anonymous'));
        expect(res.status).toBe(403);
    });

    it('rejects authenticated subscribers without a revalidation provider', async () => {
        const c = makeContext({ id: 'alice' }, 'user:alice'); c.set('cossack.captureRealtimeIdentity', undefined);
        const response = await handleSseEndpoint(makeCtx())(c);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_REALTIME_AUTH_REQUIRED' });
    });

    it('reports capture storage failures separately without exposing the exception', async () => {
        const c = makeContext({ id: 'alice' }, 'user:alice');
        c.set('cossack.captureRealtimeIdentity', async () => { throw new Error('PRIVATE_CAPTURE_STORAGE'); });
        const response = await handleSseEndpoint(makeCtx())(c);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ code: 'COSSACK_REALTIME_AUTH_UNAVAILABLE', error: 'Realtime authentication is unavailable. Reload to try again.' });
    });

    it('rejects an unknown componentRouteId', async () => {
        const handler = handleSseEndpoint(
            makeCtx({ routeIdMap: new Map(), pages: {} }),
        );
        const res = await handler(makeContext({ id: 'alice' }, 'user:alice'));
        expect(res.status).toBe(400);
    });
});

describe('SSE store bounding (connection counting)', () => {
    function makeSignalContext(user: unknown, scopeKey: string, controller: AbortController): Context {
        return makeContext(user, scopeKey, controller.signal);
    }

    it('decrements (but keeps) the store entry when a connection disconnects', async () => {
        // The entry is NOT deleted on disconnect: in some runtimes the request
        // abort signal fires before the client truly disconnects, which would
        // drop the entry out from under the still-live driver. The store is
        // bounded by the LRU hard cap instead.
        const ctx = makeCtx();
        const scopeKey = 'user:alice';
        registerSseStoreEntry(ctx, '/src/pages/sse/index.ts', scopeKey, {
            getPublicState: () => ({ count: 0 }),
        } as any);
        expect(__sseStoreSize()).toBe(1);

        const controller = new AbortController();
        const handler = handleSseEndpoint(ctx);
        await handler(makeSignalContext({ id: 'alice' }, scopeKey, controller));
        expect(__sseStoreSize()).toBe(1);

        // Disconnect → entry kept (connection count decremented).
        controller.abort();
        expect(__sseStoreSize()).toBe(1);
    });

    it('publishes a newer cursor to an existing subscriber after SSR replaces its entry', async () => {
        vi.useFakeTimers();
        const ctx = makeCtx();
        const scopeKey = 'user:ssr-replacement';
        const controller = new AbortController();
        const instance = (count: number) => ({ count, getPublicState() { return { count: this.count }; } });
        registerSseStoreEntry(ctx, '/src/pages/sse/index.ts', scopeKey, instance(0) as any);
        const before = syncSseState(`sse_page:${scopeKey}`, { count: 1 });
        const response = await handleSseEndpoint(ctx)(makeSignalContext({ id: 'ssr-replacement' }, scopeKey, controller));
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        try {
            const initial = decoder.decode((await reader.read()).value);
            expect(initial).toContain(`id: ${before}\n`);
            expect(initial).toContain('data: {"count":1}');
            expect(decoder.decode((await reader.read()).value)).toContain('event: connected');

            registerSseStoreEntry(ctx, '/src/pages/sse/index.ts', scopeKey, instance(6) as any);
            const replacementRead = reader.read();
            await vi.advanceTimersByTimeAsync(200);
            const replacement = decoder.decode((await replacementRead).value);
            const replacementCursor = Number(/id: (\d+)/.exec(replacement)?.[1]);
            expect(replacementCursor).toBeGreaterThan(before!);
            expect(replacement).toContain('data: {"count":6}');

            const after = syncSseState(`sse_page:${scopeKey}`, { count: 7 }, 'after-ssr');
            expect(after).toBeGreaterThan(replacementCursor);
            const updateRead = reader.read();
            await vi.advanceTimersByTimeAsync(200);
            const update = decoder.decode((await updateRead).value);
            expect(update).toContain(`id: ${after}\n`);
            expect(update).toContain('data: {"count":7,"_cossack_request_id":"after-ssr"}');
        } finally {
            controller.abort();
            await reader.cancel();
            vi.useRealTimers();
        }
    });
});
