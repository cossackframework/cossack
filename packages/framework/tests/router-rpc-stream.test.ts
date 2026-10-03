import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Cossack, CossackService, ClientVisibleError, cookie, flash, flashed, flashInput, old, forwardServiceMethods, getRequestContext, Inject, Page, readRpcStream, Server, Service, State, input } from '@cossackframework/core';
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
    @Server({ input: input.object({title:input.string({required:true})}) })
    async guardedService(input: { title: string }) { this.count++; return input.title; }
    @Server()
    async *serviceQuery() {
        yield (await sql`SELECT ${1} AS value`).rows;
        yield (await sql`SELECT ${2} AS value`).rows;
        return 'queried';
    }
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
    @Server({ input: input.object({title:input.string({required:true,minLength:3}),visits:input.number({coerce:true,min:0})}) })
    async save(input: { title: string; visits: number }) { this.count += input.visits; return input.title; }
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
let requestTransport: 'json' | 'multipart' = 'json';
const endpoint = () => requestTransport === 'json' ? '/crpc' : '/upload';
function requestBody(body: Record<string, unknown>): BodyInit {
    if (requestTransport === 'json') return JSON.stringify(body);
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) form.set(key, ['state', 'payload', 'service', 'pageParams'].includes(key) ? JSON.stringify(value) : String(value));
    }
    form.set('file_0', new File(['context file'], 'context.txt'));
    return form;
}
const request = (action = 'stream', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    createApp().request(endpoint(), {
        method: 'POST', headers: { origin: 'http://localhost', ...(requestTransport === 'json' ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: requestBody({ componentRouteId: id, action, payload: [], scopeKey: 'user:anonymous', ...extra }),
    }, { APP_URL: 'https://configured.test', APP_SECRET: 'rpc-test-signing-secret-16-chars' } as any);
const serviceRequest = (action: string, extra: Record<string, unknown> = {}) =>
    createApp().request(endpoint(), {
        method: 'POST', headers: { origin: 'http://localhost', ...(requestTransport === 'json' ? { 'Content-Type': 'application/json' } : {}) },
        body: requestBody({ service: { ownerRouteId: layoutId, slot: '0' }, action, payload: [], scopeKey: 'user:anonymous', ...extra }),
    }, { APP_URL: 'https://configured.test', APP_SECRET: 'rpc-test-signing-secret-16-chars' } as any);
async function collect(response: Response) {
    const frames = [];
    for await (const frame of readRpcStream(response)) frames.push(frame);
    return frames;
}
beforeEach(() => { Object.assign(effects, { constructed: 0, runs: 0, closed: 0, components: 0, services: 0 }); });
afterEach(() => { middlewareStore.database = undefined; vi.restoreAllMocks(); });

describe.each(['json', 'multipart'] as const)('%s router RPC streaming lifecycle', transport => {
    beforeEach(() => { requestTransport = transport; });
    it.each(['component', 'service'])('permits %s cookie/flash writes before returning a lazy generator', async target => {
        const custom = async () => {
            cookie().set('early', 'kept', { path: '/' });
            flash('success', 'Started');
            return (async function* () { yield 'first'; return 'finished'; })();
        };
        const spy = target === 'component' ? vi.spyOn(StreamPage.prototype, 'promisedStream') : vi.spyOn(Counter.prototype, 'serviceStream');
        spy.mockImplementation(custom as any);
        const response = target === 'component' ? await request('promisedStream') : await serviceRequest('serviceStream');
        expect(response.headers.getSetCookie().map(value => value.split('=')[0]).sort()).toEqual(['cossack_flash', 'early']);
        expect(await collect(response)).toEqual([
            expect.objectContaining({ type: 'yield', value: 'first' }),
            expect.objectContaining({ type: 'done', value: 'finished' }),
        ]);
    });
    it.each(['component', 'service'])('preserves %s native response/redirect cookies and flash through materialization', async target => {
        for (const redirect of [false, true]) {
            const custom = async () => {
                cookie().set('context_cookie', 'kept', { path: '/', httpOnly: true });
                flash('success', 'Saved');
                flashInput({ title: 'Draft' });
                const headers = new Headers({ 'Content-Type': 'text/plain', 'X-Custom': 'kept' });
                headers.append('Set-Cookie', 'native_one=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/');
                headers.append('Set-Cookie', 'native_two=2; Path=/');
                if (redirect) headers.set('Location', '/stream');
                return new Response(redirect ? null : 'native body', { status: redirect ? 303 : 202, headers });
            };
            const spy = target === 'component' ? vi.spyOn(StreamPage.prototype, 'regular') : vi.spyOn(Counter.prototype, 'serviceRegular');
            spy.mockImplementation(custom as any);
            const response = target === 'component' ? await request('regular') : await serviceRequest('serviceRegular');
            expect(response.status).toBe(redirect ? 200 : 202);
            expect(response.headers.get('Location')).toBeNull();
            const cookies = response.headers.getSetCookie();
            expect(cookies.map(value => value.split('=')[0]).sort()).toEqual(['context_cookie', 'cossack_flash', 'native_one', 'native_two'].sort());
            expect(response.headers.get('X-Cossack-Request-Id')).toBeTruthy();
            if (redirect) expect(await response.json()).toEqual({ _cossack_redirect: '/stream' });
            else { expect(response.headers.get('X-Custom')).toBe('kept'); expect(await response.text()).toBe('native body'); }
            const token = cookies.find(value => value.startsWith('cossack_flash='))!.split(';')[0];
            // A failed background RPC preserves incoming flash and suppresses
            // partial outgoing data. The next page still reads it exactly once.
            vi.spyOn(StreamPage.prototype, 'regular').mockImplementation(async () => {
                flash('unrelated', 'must not replace saved message');
                throw new ClientVisibleError('Rejected');
            });
            const failure = await request('regular', {}, { cookie: token });
            expect(failure.status).toBe(400);
            expect(failure.headers.getSetCookie().some(value => value.startsWith('cossack_flash='))).toBe(false);
            vi.spyOn(StreamPage.prototype, 'render').mockImplementation(() => html`${flashed('success')}:${old('title')}`);
            const page = await createApp().request('/stream', { headers: { cookie: token } }, { APP_SECRET: 'rpc-test-signing-secret-16-chars' } as any);
            expect((await page.text()).replace(/<!--[\s\S]*?-->/g, '')).toContain('Saved:Draft');
            expect(page.headers.getSetCookie().some(value => value.startsWith('cossack_flash=') && value.includes('Max-Age=0'))).toBe(true);
            spy.mockRestore();
            vi.restoreAllMocks();
        }
    });
    it.each(['component', 'service'])('rejects late %s cookie/header/flash writes in correlated stream errors', async target => {
        for (const write of [() => cookie().set('late', 'value'), () => cookie().delete('old'),
            () => getRequestContext()!.header('X-Late', 'value'), () => flash('late', 'value'), () => flashInput({ title: 'late' })]) {
            const stream = async function* () { yield 'first'; write(); return 'unreachable'; };
            const spy = target === 'component' ? vi.spyOn(StreamPage.prototype, 'stream') : vi.spyOn(Counter.prototype, 'serviceStream');
            spy.mockImplementation(stream as any);
            const response = target === 'component' ? await request('stream') : await serviceRequest('serviceStream');
            const frames = await collect(response);
            expect(frames[0]).toMatchObject({ type: 'yield', value: 'first' });
            expect(frames.at(-1)).toMatchObject({ type: 'error', code: 'COSSACK_RESPONSE_HEADERS_COMMITTED',
                requestId: response.headers.get('X-Cossack-Request-Id'), message: expect.stringContaining('before returning a streamed response') });
            expect(response.headers.get('X-Late')).toBeNull();
            expect(response.headers.getSetCookie()).toEqual([]);
            spy.mockRestore();
        }
    });
    it('rejects ordinary component and service values that JSON would silently drop', async () => {
        vi.spyOn(StreamPage.prototype, 'regular').mockResolvedValue({ nested: { cb: () => {} } } as any);
        vi.spyOn(Counter.prototype, 'serviceRegular').mockResolvedValue({ nested: { cb: () => {} } } as any);
        for (const response of [await request('regular'), await serviceRequest('serviceRegular')]) {
            expect(response.status).toBe(500);
            expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED',
                error: expect.stringContaining('value.nested.cb') });
        }
        expect(effects.services).toBe(2);
        expect(effects.components).toBe(1);
    });

    it.each(['component', 'service'])('owns a custom %s response through body cleanup', async target => {
        let opened = 0;
        let closed = 0;
        middlewareStore.database = ormMiddleware(async () => {
            opened++;
            const driver = new MemoryDriver();
            const orm = createORM({ adapter: { driver, scope: createAsyncLocalScope(new AsyncLocalStorage()) }, entities: [] });
            const originalClose = orm.close.bind(orm);
            vi.spyOn(orm, 'close').mockImplementation(async () => { closed++; await originalClose(); });
            return orm;
        });
        let step = 0;
        const custom = () => new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
                expect(getRequestContext()?.req.path).toBe(endpoint());
                const query = await sql`SELECT ${++step} AS value`;
                controller.enqueue(new TextEncoder().encode(JSON.stringify(query.rows)));
            },
        }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/plain', 'X-Custom': 'kept' } });
        if (target === 'component') vi.spyOn(StreamPage.prototype, 'regular').mockImplementation(custom as any);
        else vi.spyOn(Counter.prototype, 'serviceRegular').mockImplementation(custom as any);
        const response = target === 'component' ? await request('regular') : await serviceRequest('serviceRegular');
        expect(opened).toBe(1);
        expect(closed).toBe(0);
        expect(response.headers.get('X-Custom')).toBe('kept');
        const reader = response.body!.getReader();
        await middlewareStore.current!.run('another-reader', () => reader.read());
        expect(step).toBe(1);
        expect(closed).toBe(0);
        await reader.cancel();
        expect(closed).toBe(1);
        expect(effects.services).toBe(1);
        expect(effects.components).toBe(target === 'component' ? 1 : 0);
    });
    it('awaits SSR cleanup inside the request context before returning', async () => {
        let release!: () => void;
        let disposalStarted = false;
        let returned = false;
        const gate = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(Counter.prototype, 'onDispose').mockImplementation(async () => {
            disposalStarted = true;
            await gate;
            expect(getRequestContext()?.req.path).toBe('/stream');
            effects.services++;
        });
        const pending = Promise.resolve(createApp().request('/stream', {}, { APP_URL: 'https://configured.test' } as any))
            .then(response => { returned = true; return response; });
        await vi.waitFor(() => expect(disposalStarted).toBe(true));
        expect(returned).toBe(false);
        release();
        expect((await pending).status).toBe(200);
        expect(effects.services).toBe(1);
        expect(effects.components).toBe(1);
    });
    it('runs once, preserves middleware/config/request context, and keeps layout services until completion', async () => {
        const response = await request();
        expect(response.status).toBe(200);
        expect(effects).toMatchObject({ runs: 0, components: 0, services: 0 });
        const frames = await middlewareStore.current!.run('different-reader', () => collect(response));
        const cursors = frames.map(frame => frame.type === 'error' ? undefined : frame.state._cossack_sse_cursor);
        expect(cursors.every(cursor => Number.isSafeInteger(cursor) && Number(cursor) > 0)).toBe(true);
        expect(Number(cursors[1])).toBeGreaterThan(Number(cursors[0]));
        expect(Number(cursors[2])).toBeGreaterThan(Number(cursors[1]));
        expect(frames).toEqual([
            { v: 1, type: 'yield', requestId: response.headers.get('X-Cossack-Request-Id'), value: { owner: 'owner', url: 'https://configured.test', path: endpoint() }, state: { count: 1, _cossack_sse_cursor: cursors[0] } },
            { v: 1, type: 'yield', requestId: response.headers.get('X-Cossack-Request-Id'), value: { owner: 'owner', serviceCount: 2 }, state: { count: 2, _cossack_sse_cursor: cursors[1] } },
            { v: 1, type: 'done', requestId: response.headers.get('X-Cossack-Request-Id'), value: 'finished', state: { count: 2, _cossack_sse_cursor: cursors[2] } },
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

    it('retains the request ORM through explicit service streaming and cancellation', async () => {
        const orm = createORM({ adapter: {
            driver: new MemoryDriver('sqlite', query => ({ rows: [{ value: query.parameters[0] }] })),
            scope: createAsyncLocalScope(new AsyncLocalStorage()),
        }, entities: [] });
        const close = vi.spyOn(orm, 'close');
        middlewareStore.database = ormMiddleware(() => orm);
        const response = await serviceRequest('serviceQuery');
        expect(close).not.toHaveBeenCalled();
        expect(await collect(response)).toMatchObject([
            { type: 'yield', value: [{ value: 1 }] },
            { type: 'yield', value: [{ value: 2 }] },
            { type: 'done', value: 'queried' },
        ]);
        expect(close).toHaveBeenCalledOnce();

        const cancelledOrm = createORM({ adapter: { driver: new MemoryDriver(),
            scope: createAsyncLocalScope(new AsyncLocalStorage()) }, entities: [] });
        const cancelledClose = vi.spyOn(cancelledOrm, 'close');
        middlewareStore.database = ormMiddleware(() => cancelledOrm);
        const cancelled = await serviceRequest('serviceQuery');
        expect(cancelledClose).not.toHaveBeenCalled();
        await cancelled.body!.cancel();
        expect(cancelledClose).toHaveBeenCalledOnce();
    });

    it('enforces @Server({ input }) before the method runs with stable field errors', async () => {
        const missing = await request('save', { payload: [{ title: '', visits: 2 }] });
        expect(missing.status).toBe(400);
        expect(await missing.json()).toMatchObject({
            code: 'COSSACK_VALIDATION_FAILED',
            fieldErrors: expect.objectContaining({ title: expect.any(String) }),
        });
        // Coerced valid input reaches the method with the inferred types.
        const coerced = await request('save', { payload: [{ title: 'hello', visits: '3' }] });
        expect(coerced.status).toBe(200);
        const body = await coerced.json() as Record<string, unknown>;
        expect(body._cossack_return).toBe('hello');
        expect(body.count).toBe(3);
    });

    it('enforces forwarded and explicit service contracts before executing mutations', async () => {
        // Explicit DI uses service slots by default. Also exercise the legacy,
        // framework-installed component forwarder without fabricating metadata.
        const bootstrap = StreamPage.prototype.bootstrap;
        vi.spyOn(StreamPage.prototype, 'bootstrap').mockImplementation(async function (this: StreamPage, options) {
            await bootstrap.call(this, options);
            forwardServiceMethods(this, this.counter);
        });
        for (const response of [await request('guardedService', { payload: [{}] }),
            await serviceRequest('guardedService', { payload: [{}] })]) {
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: 'COSSACK_VALIDATION_FAILED',
                fieldErrors: { title: expect.any(String) } });
        }
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
