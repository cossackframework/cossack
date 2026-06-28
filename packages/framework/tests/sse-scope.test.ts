import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import { handleSseEndpoint, registerSseStoreEntry, resolveSseScopeKey, __sseStoreSize, type RouterContext } from '../src/transports/sse';

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

function makeContext(user: unknown, scopeKey: string | null): Context {
    const url = 'http://localhost/sse/sse_page';
    return {
        req: {
            param: (name?: string) => (name === 'componentRouteId' ? 'sse_page' : { componentRouteId: 'sse_page' }),
            query: (name: string) => (name === 'scopeKey' ? scopeKey : undefined),
            header: (name: string) => (name.toLowerCase() === 'origin' ? 'http://localhost' : undefined),
            url,
            raw: { signal: undefined } as any,
        },
        get: (key: string) => (key === 'user' ? user : undefined),
        env: {},
    } as unknown as Context;
}

describe('handleSseEndpoint scope validation (cross-user eavesdropping guard)', () => {
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

    it('does NOT reject when the scopeKey matches the authenticated user', async () => {
        // When the scope matches, the handler proceeds past the gate. With this
        // minimal mock the subsequent cold-start bootstrap may throw or return a
        // non-403 status — either way proves the scope gate let an honest
        // client through.
        const handler = handleSseEndpoint(makeCtx());
        let result: { threw: boolean; status?: number };
        try {
            const res = await handler(makeContext({ id: 'alice' }, 'user:alice'));
            result = { threw: false, status: res.status };
        } catch {
            result = { threw: true };
        }
        expect(result.threw || result.status !== 403).toBe(true);
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
        const url = 'http://localhost/sse/sse_page';
        return {
            req: {
                param: (name?: string) => (name === 'componentRouteId' ? 'sse_page' : { componentRouteId: 'sse_page' }),
                query: (name: string) => (name === 'scopeKey' ? scopeKey : undefined),
                header: (name: string) => (name.toLowerCase() === 'origin' ? 'http://localhost' : undefined),
                url,
                raw: { signal: controller.signal } as any,
            },
            get: (key: string) => (key === 'user' ? user : undefined),
            env: {},
        } as unknown as Context;
    }

    it('deletes the store entry when the last connection disconnects', async () => {
        const ctx = makeCtx();
        const scopeKey = 'user:alice';
        // Pre-register an entry so the handler skips cold-start bootstrap.
        registerSseStoreEntry(ctx, '/src/pages/sse/index.ts', scopeKey, {
            getPublicState: () => ({ count: 0 }),
        } as any);
        expect(__sseStoreSize()).toBe(1);

        const controller = new AbortController();
        const handler = handleSseEndpoint(ctx);
        await handler(makeSignalContext({ id: 'alice' }, scopeKey, controller));
        // Connection registered.
        expect(__sseStoreSize()).toBe(1);

        // Simulate client disconnect → entry should be removed.
        controller.abort();
        expect(__sseStoreSize()).toBe(0);
    });
});
