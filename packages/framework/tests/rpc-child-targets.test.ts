import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, State, readRpcStream, RateLimit, __resetRateLimitForTests } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';
import { registerSseStoreEntry } from '../src/transports/sse';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {} }));
let childId = '';
let mutations = 0;
let cleaned = 0;
class Child extends Cossack {
    @State() count = 0; // Deliberately collides with the page's public key.
    @Server() @RateLimit({ max: 1, window: 60_000 })
    increment() { mutations++; return ++this.count; }
    @Server() async *stream() { mutations++; yield ++this.count; return ++this.count; }
    render() { childId = this._id; return html`child ${this.count}`; }
    onCleanup() { cleaned++; }
}
class BasePage extends Cossack {
    @State() count = 10;
    @Server() @RateLimit({ max: 1, window: 60_000 })
    increment() { mutations++; return ++this.count; }
    render() { return html`page ${this.count}${component(Child, {})}`; }
}
@Page({ transport: 'http' }) class HttpPage extends BasePage {}
@Page({ transport: 'sse' }) class SsePage extends BasePage {}
const paths = { http: '/src/pages/child-http/index.ts', sse: '/src/pages/child-sse/index.ts' };
registry.pages[paths.http] = { default: HttpPage };
registry.pages[paths.sse] = { default: SsePage };
const ids = computeRouteIds(Object.values(paths), []);
const { createApp } = await import('../src/router');

describe.each(['http', 'sse'] as const)('%s child RPC ownership', transport => {
    let app: ReturnType<typeof createApp>;
    let scopeKey: string;
    let snapshot: { count: number };
    const routeId = ids.routePathToIdMap.get(paths[transport])!;
    const call = (action: string, target?: unknown, multipart = false) => {
        const envelope = { componentRouteId: routeId, scopeKey, action, target, state: { count: 0 }, payload: [] };
        const body = multipart ? new FormData() : JSON.stringify(envelope);
        if (body instanceof FormData) for (const [key, value] of Object.entries(envelope)) {
            if (value !== undefined) body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        return app.request(multipart ? '/upload' : '/crpc', {
            method: 'POST', headers: { origin: 'http://localhost', ...(multipart ? {} : { 'Content-Type': 'application/json' }) }, body,
        }, {} as any);
    };
    beforeEach(async () => {
        __resetRateLimitForTests(); mutations = cleaned = 0;
        app = createApp(); scopeKey = 'user:anonymous'; snapshot = { count: 10 };
        // Use the actual process-local store interface. Capture the page state
        // it receives, including collisions with child-local public keys.
        childId = '';
        if (transport === 'sse') {
            const ssr = await app.request('/child-sse', {}, {} as any);
            expect(ssr.status, await ssr.text()).toBe(200);
        } else {
            // Rendering during actual RPC reconstructs deterministic child IDs.
            // HTTP pages also support API-only GET behavior; do not invent SSR.
            expect((await call('notAnAction')).status).toBe(403);
        }
        if (transport === 'sse') registerSseStoreEntry(ids as any, paths.sse, scopeKey, Object.assign(snapshot, {
            getPublicState(this: { count: number }): { count: number } { return { count: this.count }; },
        }));
        expect(childId).toBeTruthy(); cleaned = 0;
    });
    afterEach(() => { vi.restoreAllMocks(); });
    it.each([false, true])('keeps ordinary child state separate from the page (multipart=%s)', async multipart => {
        const response = await call('increment', childId, multipart);
        expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 1, _cossack_return: 1 });
        expect(mutations).toBe(1); expect(cleaned).toBe(1);
        if (transport === 'sse') expect(snapshot.count).toBe(10);
    });
    it.each([false, true])('keeps streaming child state separate from the page (multipart=%s)', async multipart => {
        const response = await call('stream', childId, multipart); const frames = [];
        for await (const frame of readRpcStream(response)) frames.push(frame);
        expect(frames.map(frame => frame.type === 'error' ? frame.code : frame.state.count)).toEqual([1, 2]);
        expect(mutations).toBe(1); expect(cleaned).toBe(1);
        if (transport === 'sse') expect(snapshot.count).toBe(10);
    });
    it.each(['missing', 7])('rejects invalid target %j without executing a root action', async target => {
        const response = await call('increment', target);
        expect(response.status).toBe(typeof target === 'string' ? 404 : 400);
        expect(await response.json()).toMatchObject({ code: typeof target === 'string' ? 'COSSACK_RPC_NOT_FOUND' : 'COSSACK_RPC_REQUEST_INVALID', requestId: expect.any(String) });
        expect(mutations).toBe(0); if (transport === 'sse') expect(snapshot.count).toBe(10);
    });
    it('rejects framework actions on a valid child and cleans its tree', async () => {
        const response = await call('destroy', childId);
        expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_FORBIDDEN', requestId: expect.any(String) });
        expect(mutations).toBe(0); expect(cleaned).toBe(1);
    });
    it('does not charge a child action against the page action with the same name', async () => {
        expect((await call('increment', childId)).status).toBe(200);
        expect((await call('increment')).status).toBe(200);
        expect(mutations).toBe(2);
    });
    it('shares a child budget between JSON and multipart without a second mutation', async () => {
        expect((await call('increment', childId)).status).toBe(200);
        const denied = await call('increment', childId, true);
        expect(denied.status).toBe(429); expect(denied.headers.get('Retry-After')).toMatch(/^\d+$/);
        expect(await denied.json()).toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: expect.any(String) });
        expect(mutations).toBe(1); expect(cleaned).toBe(2);
        if (transport === 'sse') expect(snapshot.count).toBe(10);
    });
});
