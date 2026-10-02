import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Cossack, CossackService, ClientVisibleError, createInstance, InMemoryWebSocketRuntime,
    Page, rpc$, Server, Service, ServiceScope, State,
} from '@cossackframework/core';
// Wire browser-side transport boundaries from the same built core modules the
// public entry uses. These internals are deliberately not new application APIs.
import { proxyHttpMethods, proxyServerMethods } from '../../core/dist/shared/method-proxy.js';
import { failPendingSocketCalls, routeSocketFrame, wsPendingCalls } from '../../core/dist/shared/transport-connections.js';
import { computeRouteIds } from '../src/route-ids';

const { registry, effects } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
    effects: { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0 },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {} }));

// Finite application I/O lets teardown prove eventual remote cleanup even when
// a caller has already timed out/disconnected. Cancellation is not rollback.
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 160));
class DataModel { id = 7; when = new Date('2026-10-03'); save() { throw new Error('never called'); } }
class JsonRecord { toJSON() { effects.jsonCalls++; return { when: new Date('2026-10-03'), title: 'serialized' }; } }
const wireData = () => ({ when: new Date('2026-10-03'), model: new DataModel(), custom: new JsonRecord(), absent: undefined, list: [undefined, null] });
const expectedWireData = { when: '2026-10-03T00:00:00.000Z', model: { id: 7, when: '2026-10-03T00:00:00.000Z' }, custom: { when: '2026-10-03T00:00:00.000Z', title: 'serialized' }, list: [null, null] };
const lossyValues = [NaN, new Date('invalid'), new Uint8Array([1]), { toJSON() { return { callback() {} }; } }];
function actions<T extends abstract new (...args: any[]) => object>(Base: T) {
    abstract class Actions extends Base {
        constructor(...args: any[]) { super(...args); }
        @State() count = 0;
        @Server() async echo(value: unknown) { effects.runs++; return value; }
        @Server() async structured() { effects.runs++; return wireData(); }
        @Server() rootJson() { return { toJSON(key: string) { return { key }; } }; }
        @Server() async *rootJsonStream() { yield this.rootJson(); return this.rootJson(); }
        @Server() async *structuredStream() { yield wireData(); return wireData(); }
        @Server() async lossy(index: number) { effects.runs++; return { invalid: lossyValues[index] }; }
        @Server() async ordinary(delta: number) { effects.runs++; this.count += delta; return { count: this.count }; }
        @Server() async *stream() {
            effects.runs++;
            try {
                this.count++; yield { count: this.count };
                this.count++; yield { count: this.count };
                return { total: this.count };
            } finally { effects.streamsClosed++; }
        }
        @Server() async *streamError() {
            effects.runs++;
            try { yield 'first'; throw new ClientVisibleError('Rejected after progress'); }
            finally { effects.streamsClosed++; }
        }
        @Server() async visible() { effects.runs++; throw new ClientVisibleError('Prompt required'); }
        @Server() async internal() { effects.runs++; throw new Error('PRIVATE_TOKEN must never reach the caller'); }
        @Server({ input: { title: { required: true } } })
        async validated(input: { title: string }) { effects.runs++; return input.title; }
        @Server({ timeout: 80 }) async slow() { effects.runs++; await pause(); return 'completed remotely'; }
        @Server({ timeout: 80 }) async *slowStream() {
            effects.runs++;
            try { yield 'first'; await pause(); yield 'second'; return 'completed remotely'; }
            finally { effects.streamsClosed++; }
        }
        @Server() async *cancelable() {
            effects.runs++;
            try { yield 'first'; await pause(); yield 'second'; return 'completed remotely'; }
            finally { effects.streamsClosed++; }
        }
        @Server() async unsupported() { effects.runs++; return { nested: { callback() {} } }; }
    }
    return Actions;
}
@Page({ transport: 'http' })
class HttpPage extends actions(Cossack) {
    render() { return null as any; }
    onCleanup() { effects.disposed++; }
}
@Page({ transport: 'sse' })
class SsePage extends HttpPage {}
@Service()
class MatrixService extends actions(CossackService) {
    onDispose() { effects.disposed++; }
}
@Page({ services: [MatrixService] })
class Layout extends Cossack { render() { return null as any; } }
const httpPath = '/src/pages/http/index.ts';
const ssePath = '/src/pages/sse/index.ts';
const layoutPath = '/src/pages/layout.ts';
registry.pages[httpPath] = { default: HttpPage };
registry.pages[ssePath] = { default: SsePage };
registry.layouts[layoutPath] = { default: Layout };
const ids = computeRouteIds([httpPath, ssePath], [layoutPath]);
const { createApp } = await import('../src/router');
type Transport = 'http' | 'sse' | 'websocket' | 'service';

function clientSurface(constructor: any, transport: Transport) {
    const client: any = {
        constructor, count: 0, loading: {}, websockets: new Map(), __cossack_proxies: new Map(),
        _optimisticLockedKeys: {}, _optimisticPendingState: {},
        getInitialStateFromWindow: () => ({ componentRouteId: ids.routePathToIdMap.get(transport === 'sse' ? ssePath : httpPath), transport, scopeKey: 'user:anonymous' }),
        getPublicState: () => ({ count: client.count }),
        consume() {}, hasMethod: () => false, getMethod() {}, _isOptimisticLocked: () => false,
        setProperty(key: string, value: unknown) { client[key] = value; }, requestUpdate() {},
    };
    return client;
}

async function harness(transport: Transport) {
    const app = createApp();
    const requests: any[] = [];
    const responses: Response[] = [];
    const serverJobs: Promise<unknown>[] = [];
    let disconnected = false;
    let breakStream: (() => void) | undefined;
    let server: HttpPage | undefined;
    let scope: ServiceScope | undefined;
    let off: (() => void) | undefined;
    let socket: any;
    const browserWindow = { location: { search: '', href: '' } };
    const client = clientSurface(HttpPage, transport);
    let target = client;
    vi.stubGlobal('window', browserWindow);
    for (const name of ['Node', 'Window', 'FileList']) vi.stubGlobal(name, class {});

    if (transport === 'websocket') {
        server = createInstance(HttpPage) as HttpPage;
        server.connectedCallback();
        const runtime = new InMemoryWebSocketRuntime(server);
        const peer = { readyState: 1, send(data: string) {
            if (!disconnected) routeSocketFrame(socket, JSON.parse(data));
        } };
        socket = { readyState: 1, send(data: string) {
            const frame = JSON.parse(data);
            if (frame.type === 'action') requests.push(frame);
            const job = runtime.onClientMessage(peer, data);
            serverJobs.push(job);
            void job.catch(() => {});
        } };
        runtime.addClient(peer);
        vi.stubGlobal('WebSocket', Object.assign(class {}, { OPEN: 1 }));
        client.websockets.set('page', socket);
        proxyServerMethods(client, Object.keys(Reflect.getMetadata('cossack:server-methods', HttpPage))
            .map(name => ({ name, channel: 'global', provider: 'page' })));
    } else {
        vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
            requests.push(JSON.parse(init.body as string));
            // ServiceScope installs browser proxies based on window presence.
            // Server scope construction must execute in its native environment.
            vi.stubGlobal('window', undefined);
            const job = Promise.resolve(app.fetch(new Request('http://localhost/crpc', {
                ...init, headers: { ...init.headers, Origin: 'http://localhost' },
            }), { APP_URL: 'http://localhost' } as any));
            serverJobs.push(job);
            const response = job.finally(() => vi.stubGlobal('window', browserWindow)).then(res => {
                responses.push(res);
                if (!res.body || !res.headers.get('Content-Type')?.includes('ndjson')) return res;
                const reader = res.body.getReader();
                const body = new ReadableStream<Uint8Array>({
                    start(controller) { breakStream = () => {
                        controller.error(new TypeError('Connection lost'));
                        const cleanup = reader.cancel().finally(() => reader.releaseLock());
                        serverJobs.push(cleanup); void cleanup.catch(() => {});
                    }; },
                    async pull(controller) {
                        const next = await reader.read();
                        if (!disconnected) { if (next.done) controller.close(); else controller.enqueue(next.value); }
                    },
                    async cancel() { await reader.cancel(); reader.releaseLock(); },
                }, { highWaterMark: 0 });
                return new Response(body, res);
            });
            return new Promise<Response>((resolve, reject) => {
                const abort = () => reject(new DOMException('Aborted', 'AbortError'));
                init.signal?.addEventListener('abort', abort, { once: true });
                void response.then(resolve, reject).finally(() => init.signal?.removeEventListener('abort', abort));
            });
        });
        if (transport === 'service') {
            scope = new ServiceScope(undefined, [MatrixService], { ownerRouteId: ids.routePathToIdMap.get(layoutPath), scopeKey: 'user:anonymous' });
            target = scope.resolveDeclared(MatrixService);
            off = scope.subscribe(MatrixService, client);
        } else proxyHttpMethods(client, Object.keys(Reflect.getMetadata('cossack:server-methods', HttpPage)).map(name => ({ name })));
    }
    return {
        client, target, requests,
        pendingCalls: () => socket ? wsPendingCalls(socket).size : 0,
        disconnect() {
            disconnected = true;
            if (socket) { socket.readyState = 3; failPendingSocketCalls(socket); }
            else breakStream!();
        },
        async dispose() {
            await Promise.allSettled(serverJobs);
            // Draining/cancelling owns cleanup. A cancelled client's pre-header
            // request may finish remotely; cancel that unobserved response too.
            for (const response of responses) if (!response.body?.locked) await response.body?.cancel();
            if (server) await server.destroyAsync();
            off?.(); await scope?.disposeAsync();
        },
    };
}

describe.each(['http', 'sse', 'websocket', 'service'] as const)('%s shared RPC conformance', transport => {
    let wire: Awaited<ReturnType<typeof harness>>;
    beforeEach(async () => {
        Object.assign(effects, { runs: 0, streamsClosed: 0, disposed: 0, jsonCalls: 0 });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        wire = await harness(transport);
    });
    afterEach(async () => { await wire.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    const settled = () => { expect(wire.client.loading).toEqual({}); expect(wire.pendingCalls()).toBe(0); };

    it('returns normalized dates, model fields, custom JSON, and optional/array values', async () => {
        expect(await wire.target.structured()).toEqual(expectedWireData);
        expect(effects.jsonCalls).toBe(1); settled();
    });
    it('normalizes yielded and terminal data independently with one hook invocation per value', async () => {
        const call = rpc$(wire.target.structuredStream()); const values = [];
        for await (const value of call) values.push(value);
        expect(values).toEqual([expectedWireData]); expect(await call).toEqual(expectedWireData);
        expect(effects.jsonCalls).toBe(2); settled();
    });
    it('normalizes client payloads before dispatch without invoking hooks twice', async () => {
        expect(await wire.target.echo(wireData())).toEqual(expectedWireData);
        expect(effects.jsonCalls).toBe(1); expect(wire.requests[0].payload).toEqual([expectedWireData]); settled();
    });
    it('preserves an own __proto__ field as payload data through upload extraction and JSON encoding', async () => {
        const value = JSON.parse('{"__proto__":{"label":"data"}}');
        expect(await wire.target.echo(value)).toEqual(value);
        expect(Object.hasOwn(wire.requests[0].payload[0], '__proto__')).toBe(true); settled();
    });
    it('uses the same root toJSON key for ordinary, yielded, and terminal results', async () => {
        expect(await wire.target.rootJson()).toEqual({ key: '' });
        const call = rpc$(wire.target.rootJsonStream()); const values = [];
        for await (const value of call) values.push(value);
        expect(values).toEqual([{ key: '' }]); expect(await call).toEqual({ key: '' }); settled();
    });
    it.each(lossyValues.map((_, index) => index))('rejects lossy result %s instead of changing or dropping it', async index => {
        await expect(Promise.resolve(wire.target.lossy(index))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', requestId: expect.any(String), message: expect.stringContaining('value.invalid') });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it.each(lossyValues)('rejects lossy argument %s before mutation', async value => {
        await expect(Promise.resolve(wire.target.echo(value))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('payload[0]') });
        expect(wire.requests).toHaveLength(0); expect(effects.runs).toBe(0); settled();
    });

    it('returns ordinary data without yields and repeated awaits never redispatch', async () => {
        const call = rpc$(wire.target.ordinary(3));
        const values = []; for await (const value of call) values.push(value);
        expect(values).toEqual([]);
        expect(await call).toEqual({ count: 3 }); expect(await call).toEqual({ count: 3 });
        expect(wire.target.count).toBe(3); expect(wire.requests).toHaveLength(1); expect(effects.runs).toBe(1); settled();
    });
    it('drains an unobserved action and releases loading without another dispatch', async () => {
        wire.target.ordinary(4);
        await expect.poll(() => wire.target.count).toBe(4);
        await expect.poll(() => Object.keys(wire.client.loading)).toEqual([]);
        expect(wire.requests).toHaveLength(1); expect(effects.runs).toBe(1);
    });
    it('releases request ownership after completion while WebSocket ownership lasts until teardown', async () => {
        await wire.target.stream();
        expect(effects.streamsClosed).toBe(1);
        expect(effects.disposed).toBe(transport === 'websocket' ? 0 : transport === 'service' ? 1 : 2);
    });
    it('streams yields and terminal data separately, applies state, and closes the generator once', async () => {
        const call = rpc$(wire.target.stream());
        const values = []; for await (const value of call) values.push(value);
        expect(values).toEqual([{ count: 1 }, { count: 2 }]);
        expect(await call).toEqual({ total: 2 }); expect(wire.target.count).toBe(2);
        expect(effects.streamsClosed).toBe(1); expect(wire.requests).toHaveLength(1); settled();
    });
    it.each([['visible', 'COSSACK_RPC_CLIENT_ERROR', 'Prompt required'], ['internal', 'COSSACK_RPC_INTERNAL_ERROR', 'Internal Server Error']])('correlates and redacts %s errors', async (action, code, message) => {
        await expect(Promise.resolve(wire.target[action]())).rejects.toMatchObject({ code, message, requestId: expect.any(String) });
        expect(wire.requests).toHaveLength(1); expect(effects.runs).toBe(1); settled();
    });
    it('validates before application mutation with correlated field errors', async () => {
        await expect(Promise.resolve(wire.target.validated({}))).rejects.toMatchObject({ code: 'COSSACK_VALIDATION_FAILED', requestId: expect.any(String), fieldErrors: { title: expect.any(String) } });
        expect(effects.runs).toBe(0); settled();
    });
    it('preserves yields before a correlated application failure and closes once', async () => {
        const call = rpc$(wire.target.streamError());
        const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR', requestId: expect.any(String), message: 'Rejected after progress' });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR' });
        expect(effects.streamsClosed).toBe(1); expect(effects.runs).toBe(1); settled();
    });
    it('shares catch/finally completion handlers without repeating the failed mutation', async () => {
        const call = rpc$(wire.target.visible()); const finished = vi.fn();
        const recovered = call.catch(error => error.code);
        const finalized = call.finally(finished).catch(error => error.code);
        expect(await recovered).toBe('COSSACK_RPC_CLIENT_ERROR');
        expect(await finalized).toBe('COSSACK_RPC_CLIENT_ERROR');
        expect(finished).toHaveBeenCalledOnce(); expect(wire.requests).toHaveLength(1); settled();
    });
    it.each(['slow', 'slowStream'])('enforces %s deadlines without retry or leaked loading', async action => {
        await expect(Promise.resolve(wire.target[action]())).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', message: expect.stringContaining('outcome is unknown') });
        expect(wire.requests).toHaveLength(1); expect(effects.runs).toBe(1); settled();
    });
    it('retains the request ID when a deadline expires after progress', async () => {
        const call = rpc$(wire.target.slowStream()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId: expect.any(String) });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' }); settled();
    });
    it('cancels after a yield, rejects completion, and eventually closes remote work', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await call.cancel(); await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await expect.poll(() => effects.streamsClosed).toBe(1);
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects a second iterator without losing the first or redispatching', async () => {
        const call = rpc$(wire.target.stream()); const iterator = call[Symbol.asyncIterator]();
        expect(() => call[Symbol.asyncIterator]()).toThrow(expect.objectContaining({ code: 'COSSACK_RPC_ALREADY_CONSUMED' }));
        expect((await iterator.next()).value).toEqual({ count: 1 });
        expect((await iterator.next()).value).toEqual({ count: 2 });
        expect((await iterator.next()).done).toBe(true);
        expect(await call).toEqual({ total: 2 }); expect(wire.requests).toHaveLength(1); settled();
    });
    it('cancels on iterator return and releases the remote generator', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        expect(await iterator.return!()).toMatchObject({ done: true });
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await expect.poll(() => effects.streamsClosed).toBe(1); expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects unsupported return values with a correlated path', async () => {
        await expect(Promise.resolve(wire.target.unsupported())).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', requestId: expect.any(String), message: expect.stringContaining('value.nested.callback') });
        expect(wire.requests).toHaveLength(1); settled();
    });
    it('rejects unsupported input before dispatching a mutation', async () => {
        await expect(Promise.resolve(wire.target.ordinary({ nested: new Map() }))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('payload[0].nested') });
        expect(wire.requests).toHaveLength(0); expect(effects.runs).toBe(0); settled();
    });
    it('rejects unsupported public state before dispatching a mutation', async () => {
        wire.target.count = new Map();
        await expect(Promise.resolve(wire.target.ordinary(1))).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('state.count') });
        expect(wire.requests).toHaveLength(0); expect(effects.runs).toBe(0); settled();
    });
    it('reports disconnect uncertainty without replaying a mutation', async () => {
        const call = rpc$(wire.target.cancelable()); const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        wire.disconnect();
        await expect(iterator.next()).rejects.toMatchObject({ code: transport === 'websocket' ? 'COSSACK_RPC_TRANSPORT_CLOSED' : 'COSSACK_RPC_NETWORK_FAILED', message: expect.stringContaining('unknown'), requestId: expect.any(String) });
        await expect(call).rejects.toBeDefined(); expect(wire.requests).toHaveLength(1); settled();
    });
});

describe('multipart upload JSON values', () => {
    afterEach(() => vi.restoreAllMocks());
    const upload = (action: string, payload: unknown[] = []) => {
        const body = new FormData();
        body.set('componentRouteId', ids.routePathToIdMap.get(httpPath)!);
        body.set('action', action); body.set('payload', JSON.stringify(payload));
        body.set('file_test', new Blob(['hello']), 'test.txt');
        return createApp().request('/upload', { method: 'POST', body, headers: { Origin: 'http://localhost' } }, { APP_URL: 'http://localhost' } as any);
    };
    it('normalizes native JSON data and invokes hooks once on ordinary results', async () => {
        effects.jsonCalls = 0;
        const response = await upload('structured');
        expect(response.status).toBe(200); expect(response.headers.get('X-Cossack-Request-Id')).toBeTruthy();
        expect(await response.json()).toMatchObject({ _cossack_return: expectedWireData });
        expect(effects.jsonCalls).toBe(1);
    });
    it.each([0, 1, 2, 3])('rejects lossy upload result %s with a correlated path', async index => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await upload('lossy', [index]);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED',
            requestId: response.headers.get('X-Cossack-Request-Id'), error: expect.stringContaining('value.invalid') });
    });
    it('keeps private upload exceptions in server logs even in development', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await upload('internal');
        expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', error: 'Internal Server Error' });
    });
});
