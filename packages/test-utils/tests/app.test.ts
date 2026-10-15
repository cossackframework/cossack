import { describe, expect, it, vi } from 'vitest';
import { authFixture, createServerApp, readHydrationState } from '../src/server';

describe('production fetch contract helpers', () => {
    it('dispatches Requests, bindings and abort signals without replacing the injected handler', async () => {
        const controller = new AbortController();
        const env = { TENANT: 'first' };
        const fetch = vi.fn((request: Request, bindings: typeof env) => {
            expect(request.url).toBe('https://app.test/page?q=one');
            expect(request.signal.aborted).toBe(true);
            expect(bindings).toBe(env);
            return new Response('real handler', { status: 202 });
        });
        controller.abort();
        const app = createServerApp({ fetch, env, baseUrl: 'https://app.test' });
        expect((await app.request('/page?q=one', { signal: controller.signal })).status).toBe(202);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('sends exact component/service RPC envelopes and credential headers', async () => {
        const requests: Request[] = [];
        const app = createServerApp({ fetch: request => { requests.push(request); return new Response(); }, env: {} });
        const fixture = authFixture({ headers: { 'X-Test-User': 'alice' }, cookies: { session: 'a b' } });
        await app.componentRpc({ componentRouteId: 'route', action: 'save', payload: [3], state: { count: 1 } }, fixture);
        await app.serviceRpc({ ownerRouteId: 'layout', slot: '0', componentRouteId: 'route', action: 'save' }, { headers: { Origin: 'https://denied.test' } });
        expect(requests[0].headers.get('Origin')).toBe('http://localhost');
        expect(requests[0].headers.get('Cookie')).toBe('session=a%20b');
        expect(requests[0].headers.get('X-Test-User')).toBe('alice');
        expect(await requests[0].json()).toEqual({ componentRouteId: 'route', action: 'save', payload: [3], state: { count: 1 } });
        expect(requests[1].headers.get('Origin')).toBe('https://denied.test');
        expect(await requests[1].json()).toEqual({ service: { ownerRouteId: 'layout', slot: '0' }, componentRouteId: 'route', pageParams: {},
            action: 'save', payload: [], state: {} });
    });

    it('parses escaped production hydration JSON without evaluating scripts', () => {
        const html = '<script>window.__INITIAL_STATE__ = {"public":{"name":"\\u003c/script\\u003e"}}</script>';
        expect(readHydrationState(html)).toEqual({ public: { name: '</script>' } });
        expect(readHydrationState('<script>throw new Error("do not execute")</script>')).toBeUndefined();
        expect(() => readHydrationState('<script>window.__INITIAL_STATE__ = globalThis.process.exit()</script>')).toThrow();
        expect(() => readHydrationState(html + html)).toThrow('multiple assignments');
    });

    it('rejects invalid fixture cookie names and non-HTTP application origins', () => {
        expect(() => authFixture({ cookies: { 'bad;name': 'value' } })).toThrow();
        expect(() => createServerApp({ fetch: () => new Response(), env: {}, baseUrl: 'file:///tmp' })).toThrow();
    });
});
