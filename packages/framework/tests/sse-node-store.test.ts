import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Page, Server, Service, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';
import { __resetSseStore } from '../src/transports/sse';

// Node (process-local) SSE backend: no COSSACK_SSE coordinator binding.
const { registry } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const path = '/src/pages/live/index.ts';
const layoutPath = '/src/pages/layout.ts';

let disposedServices = 0;
let readsAfterDestroy = 0;

@Service()
class Greeting extends CossackService {
    @State() greeting = 'hello from layout';
    onDispose() { disposedServices++; }
}

@Page({ services: [Greeting] })
class Layout extends Cossack {
    render() { return html`${this.children}`; }
}

@Page({ transport: 'sse' })
class LivePage extends Cossack {
    @State() count = 0;
    @State() greeting = '';
    @Inject(Greeting) service!: Greeting;
    destroyed = false;
    async init() { this.greeting = this.service.greeting; }
    render() { this.greeting ||= this.service.greeting; return html`live ${this.count} ${this.greeting}`; }
    @Server() async increment() { return ++this.count; }
    onCleanup() { this.destroyed = true; }
    getPublicState() {
        if (this.destroyed) readsAfterDestroy++;
        return super.getPublicState();
    }
}

registry.pages[path] = { default: LivePage };
registry.layouts[layoutPath] = { default: Layout };
const { createApp } = await import('../src/router');
const id = computeRouteIds([path], [layoutPath]).routePathToIdMap.get(path)!;

const env = () => ({}) as any;

async function firstStateFrame(app: ReturnType<typeof createApp>) {
    const controller = new AbortController();
    const response = await app.request(`/sse/${id}?scopeKey=${encodeURIComponent('user:anonymous')}`,
        { signal: controller.signal }, env());
    expect(response.status, response.status === 200 ? '' : await response.text()).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const frame = /event: state-update\n(?:id: \d+\n)?data: (.*)\n\n/;
    try {
        while (!frame.test(text)) {
            const next = await reader.read();
            if (next.done) break;
            text += decoder.decode(next.value, { stream: true });
        }
    } finally {
        controller.abort();
        await reader.cancel().catch(() => {});
    }
    return JSON.parse(frame.exec(text)![1]);
}

afterEach(() => {
    __resetSseStore();
    disposedServices = 0;
    readsAfterDestroy = 0;
});

describe('Node SSE store', () => {
    it('never reads SSE state from the destroyed SSR page instance', async () => {
        const app = createApp();
        const ssr = await app.request('/live', {}, env());
        expect(ssr.status).toBe(200);
        // SSR tears down its components and request services.
        expect(disposedServices).toBeGreaterThan(0);

        expect(await firstStateFrame(app)).toMatchObject({ count: 0, greeting: 'hello from layout' });
        const rpc = await app.request('/crpc', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
            body: JSON.stringify({ componentRouteId: id, action: 'increment', payload: [], scopeKey: 'user:anonymous',
                state: { count: 0, greeting: 'hello from layout' } }),
        }, env());
        expect(await rpc.json()).toMatchObject({ _cossack_return: 1 });
        expect(await firstStateFrame(app)).toMatchObject({ count: 1, greeting: 'hello from layout' });
        expect(readsAfterDestroy).toBe(0);
    });

    it('builds cold-start SSE state with the layout service scopes', async () => {
        const app = createApp();
        // No SSR first: the endpoint constructs the page itself.
        expect(await firstStateFrame(app)).toMatchObject({ count: 0, greeting: 'hello from layout' });
        // The temporary instance and its scoped services are released.
        expect(disposedServices).toBeGreaterThan(0);
        expect(readsAfterDestroy).toBe(0);
    });
});
