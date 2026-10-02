import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Cossack, CossackService, ClientVisibleError, getRequestContext, Inject, Page, readRpcStream, Server, Service, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';
import { config } from '../src/config';
import { createORM, sql } from '../../database/src/index.js';
import { createAsyncLocalScope, MemoryDriver } from '../../database/src/adapter/index.js';
import { ormMiddleware } from '../../database/src/cossack/index.js';

const { registry, effects, middlewareStore } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
    effects: { constructed: 0, runs: 0, closed: 0, components: 0, services: 0 },
    middlewareStore: { current: undefined as AsyncLocalStorage<string> | undefined, database: undefined as any },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
    return middlewareStore.current!.run(c.req.header('x-request-owner') ?? 'owner',
        () => middlewareStore.database ? middlewareStore.database(c, next) : next());
}] }));
vi.mock('virtual:cossack-config', () => ({ default: { sample: ({ env }: any) => ({ name: env('APP_URL') }) } }));
const path = '/src/pages/stream/index.ts';
const layout = '/src/pages/layout.ts';
middlewareStore.current = new AsyncLocalStorage<string>();

@Service()
class Counter extends CossackService {
    @State() count = 0;
    onDispose() { effects.services++; }
    @Server()
    async *serviceStream() {
        try {
            this.count++;
            yield { serviceCount: this.count };
            await Promise.resolve();
            this.count++;
            return 'service finished';
        } finally { effects.closed++; }
    }
    @Server()
    async serviceRegular() { this.count += 10; return this.count; }
}
@Page({ services: [Counter] })
class Layout extends Cossack { render() { return html`${this.children}`; } }
@Page({ transport: 'sse' })
class StreamPage extends Cossack {
    @State() count = 0;
    @Inject(Counter) counter!: Counter;
    constructor() { super(); effects.constructed++; }
    render() { return html`stream`; }
    onCleanup() { effects.components++; }
    @Server()
    async *stream() {
        effects.runs++;
        try {
            this.count++; this.counter.count++;
            yield { owner: middlewareStore.current!.getStore(), url: config('sample.name'), path: getRequestContext()?.req.path };
            await Promise.resolve();
            this.count++; this.counter.count++;
            yield { owner: middlewareStore.current!.getStore(), serviceCount: this.counter.count };
            return 'finished';
        } finally { effects.closed++; }
    }
    @Server()
    async regular() { await Promise.resolve(); this.count++; return 'regular result'; }
    @Server()
    async promisedStream() { await Promise.resolve(); return this.stream(); }
    @Server()
    async *fail() { yield 1; throw new ClientVisibleError('Prompt required'); }
    @Server()
    async *internal() { throw new Error('SECRET_TOKEN should stay private'); }
    @Server()
    async *query() {
        yield (await sql`SELECT ${1} AS value`).rows;
        await Promise.resolve();
        yield (await sql`SELECT ${2} AS value`).rows;
        return 'queried';
    }
}
registry.pages[path] = { default: StreamPage };
registry.layouts[layout] = { default: Layout };
const { createApp } = await import('../src/router');
const routeIds = computeRouteIds([path], [layout]);
const id = routeIds.routePathToIdMap.get(path)!;
const layoutId = routeIds.routePathToIdMap.get(layout)!;
const request = (action = 'stream', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    createApp().request('/crpc', {
        method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ componentRouteId: id, action, payload: [], scopeKey: 'user:anonymous', ...extra }),
    }, { APP_URL: 'https://configured.test' } as any);
const serviceRequest = (action: string, extra: Record<string, unknown> = {}) =>
    createApp().request('/crpc', {
        method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: { ownerRouteId: layoutId, slot: '0' }, action, payload: [], scopeKey: 'user:anonymous', ...extra }),
    }, { APP_URL: 'https://configured.test' } as any);
async function collect(response: Response) {
    const frames = [];
    for await (const frame of readRpcStream(response)) frames.push(frame);
    return frames;
}
beforeEach(() => { Object.assign(effects, { constructed: 0, runs: 0, closed: 0, components: 0, services: 0 }); });
afterEach(() => { middlewareStore.database = undefined; vi.restoreAllMocks(); });

describe('router RPC streaming lifecycle', () => {
    it('runs once, preserves middleware/config/request context, and keeps layout services until completion', async () => {
        const response = await request();
        expect(response.status).toBe(200);
        expect(effects).toMatchObject({ runs: 0, components: 0, services: 0 });
        const frames = await middlewareStore.current!.run('different-reader', () => collect(response));
        expect(frames).toEqual([
            { v: 1, type: 'yield', requestId: response.headers.get('X-Cossack-Request-Id'), value: { owner: 'owner', url: 'https://configured.test', path: '/crpc' }, state: { count: 1 } },
            { v: 1, type: 'yield', requestId: response.headers.get('X-Cossack-Request-Id'), value: { owner: 'owner', serviceCount: 2 }, state: { count: 2 } },
            { v: 1, type: 'done', requestId: response.headers.get('X-Cossack-Request-Id'), value: 'finished', state: { count: 2 } },
        ]);
        expect(effects).toMatchObject({ runs: 1, closed: 1, components: 1, services: 1 });
    });
    it('streams explicit service RPC generators with service state and awaited disposal', async () => {
        const response = await serviceRequest('serviceStream');
        expect(response.status).toBe(200);
        const frames = await collect(response);
        expect(frames).toMatchObject([
            { type: 'yield', value: { serviceCount: 1 }, state: { count: 1 } },
            { type: 'done', value: 'service finished', state: { count: 2 } },
        ]);
        expect(new Set(frames.map(frame => frame.requestId)).size).toBe(1);
        // The stream owns the request scope: disposal completes after the done frame.
        await vi.waitFor(() => expect(effects.services).toBe(1));
        expect(effects.closed).toBe(1);
    });

    it('returns ordinary explicit service results as JSON with state and return value', async () => {
        const response = await serviceRequest('serviceRegular');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ _cossack_service_state: { count: 10 }, _cossack_return: 10 });
    });

    it('awaits ordinary async methods even if an old client requests streaming', async () => {
        const response = await request('regular', { _cossack_stream: true });
        expect(await response.json()).toEqual({ count: 1, _cossack_return: 'regular result' });
        expect(effects).toMatchObject({ components: 1, services: 1 });
    });
    it('recognizes async generators returned by promises', async () => {
        expect((await collect(await request('promisedStream'))).at(-1)).toMatchObject({ type: 'done', value: 'finished' });
        expect(effects.runs).toBe(1);
    });
    it('isolates simultaneous responses and their middleware stores', async () => {
        const [alice, bob] = await Promise.all(['alice', 'bob'].map(owner => request('stream', {}, { 'x-request-owner': owner })));
        const [a, b] = await Promise.all([collect(alice), collect(bob)]);
        expect(a[0]).toMatchObject({ value: { owner: 'alice' }, state: { count: 1 } });
        expect(b[0]).toMatchObject({ value: { owner: 'bob' }, state: { count: 1 } });
        expect(a[0].requestId).not.toBe(b[0].requestId);
        expect(effects).toMatchObject({ runs: 2, closed: 2, services: 2, components: 2 });
    });
    it('rejects forged scopes before constructing components or services', async () => {
        const response = await request('stream', { scopeKey: 'user:other' });
        expect(response.status).toBe(403);
        expect(effects).toMatchObject({ constructed: 0, runs: 0, services: 0 });
    });
    it('cleans response components and scoped services on cancellation', async () => {
        const response = await request();
        const reader = response.body!.getReader();
        await reader.read();
        expect(effects.services).toBe(0);
        await reader.cancel();
        expect(effects).toMatchObject({ runs: 1, closed: 1, services: 1, components: 1 });
    });
    it('retains action allowlists and cleans denied requests', async () => {
        const response = await request('destroy');
        expect(response.status).toBe(403);
        expect(effects).toMatchObject({ runs: 0, components: 1, services: 1 });
    });
    it('returns client-visible stream errors and redacts internal exceptions', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await request('fail');
        expect((await collect(response)).at(-1)).toMatchObject({ type: 'error', code: 'COSSACK_RPC_CLIENT_ERROR', message: 'Prompt required' });
        const internal = await request('internal');
        expect(await internal.text()).not.toContain('SECRET_TOKEN');
        expect(effects).toMatchObject({ components: 2, services: 2 });
    });
    it('retains request-owned ORM factories and SQL context through streaming completion', async () => {
        const driver = new MemoryDriver('sqlite', query => ({ rows: [{ value: query.parameters[0] }] }));
        const orm = createORM({ adapter: { driver, scope: createAsyncLocalScope(new AsyncLocalStorage()) }, entities: [] });
        const close = vi.spyOn(orm, 'close');
        middlewareStore.database = ormMiddleware(() => orm);
        const response = await request('query');
        expect(close).not.toHaveBeenCalled();
        const frames = await collect(response);
        expect(frames).toMatchObject([
            { type: 'yield', value: [{ value: 1 }] },
            { type: 'yield', value: [{ value: 2 }] },
            { type: 'done', value: 'queried' },
        ]);
        expect(close).toHaveBeenCalledOnce();
        expect(() => orm.run(() => {})).toThrow('closed');
    });
    it('releases request-owned ORMs on cancellation and closes ordinary responses immediately', async () => {
        const orm = createORM({ adapter: { driver: new MemoryDriver(), scope: createAsyncLocalScope(new AsyncLocalStorage()) }, entities: [] });
        const close = vi.spyOn(orm, 'close');
        middlewareStore.database = ormMiddleware(() => orm);
        const response = await request('query');
        await response.body!.cancel();
        expect(close).toHaveBeenCalledOnce();
        const regularOrm = createORM({ adapter: { driver: new MemoryDriver() }, entities: [] });
        const closeRegular = vi.spyOn(regularOrm, 'close');
        middlewareStore.database = ormMiddleware(() => regularOrm);
        await request('regular');
        expect(closeRegular).toHaveBeenCalledOnce();
    });
});
