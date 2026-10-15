// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Optimistic, Server, Service, State } from '../src/shared/decorators';
import { ServiceScope } from '../src/shared/service-scope';
import { proxyHttpMethods } from '../src/shared/method-proxy';
import { startDevelopmentTrace, type DevelopmentTraceSession } from '../src/shared/development-trace';
import { RPC_NATIVE_RESPONSE_HEADER, RPC_NATIVE_RESPONSE_MAX_BYTES, RPC_STREAM_CONTENT_TYPE } from '../src/shared/rpc-stream';
const scopes: ServiceScope[] = [];
let capture: DevelopmentTraceSession | undefined;
afterEach(async () => { capture?.stop(); await Promise.all(scopes.splice(0).map(scope => scope.disposeAsync())); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function target(kind: 'component' | 'service') {
    const consumer = { loading: {} as Record<string, number>, requestUpdate: vi.fn() };
    if (kind === 'service') {
        @Service() class Counter {
            @State() count = 0;
            @Optimistic('run') preview() { this.count = 1; }
            @Server({ timeout: 50 }) run() { return 'server'; }
        }
        const scope = new ServiceScope(undefined, [Counter], { ownerRouteId: 'layout' }); scopes.push(scope); scope.subscribe(Counter, consumer);
        return { host: scope.resolveDeclared(Counter) as any, consumer };
    }
    const host: any = { ...consumer, constructor: class Page {}, __cossack_proxies: new Map(),
        getInitialStateFromWindow: () => ({ componentRouteId: 'page', transport: 'http' }),
        count: 0, getPublicState: () => ({ count: host.count }),
        hasMethod: () => false,
        setProperty(key: string, value: unknown) { this[key] = value; },
    };
    Reflect.defineMetadata('cossack:server-methods', { run: { timeout: 50 } }, host.constructor);
    proxyHttpMethods(host, [{ name: 'run' }]); return { host, consumer: host };
}
it.each(['component', 'service'] as const)('settles a %s deadline while its iterator is parked at a yield', async kind => {
    vi.useFakeTimers(); const requestId = crypto.randomUUID(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ v: 1, type: 'yield', requestId, state: { count: 7 }, value: 'first' }) + '\n')); }, cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } })));
    capture = startDevelopmentTrace(); const { host, consumer } = target(kind), call = host.run(), iterator = call[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: 'first' }); expect(host.count).toBe(7); expect(consumer.loading.run).toBe(1);
    let failure: any; void call.catch((error: unknown) => { failure = error; });
    await vi.advanceTimersByTimeAsync(51);
    // No further next()/return() is needed to release the call and reader.
    expect(failure).toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId });
    expect(consumer.loading).toEqual({}); expect(host.count).toBe(7);
    expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
    expect(capture.snapshot().events.filter(event => event.phase === 'finish')).toMatchObject([{ outcome: 'timeout', requestId }]);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT', requestId });
    await call.cancel(); expect(cancel).toHaveBeenCalledTimes(1); expect(consumer.loading).toEqual({});
});

it.each(['component', 'service'] as const)('keeps %s completion stable when it wins before the deadline', async kind => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(kind === 'service'
        ? { _cossack_return: 4, _cossack_service_state: { count: 4 } } : { _cossack_return: 4, count: 4 }), { headers: { 'Content-Type': 'application/json' } })));
    capture = startDevelopmentTrace(); const { host, consumer } = target(kind), call = host.run();
    expect(await call).toBe(4); await vi.advanceTimersByTimeAsync(100); await call.cancel();
    expect(await call).toBe(4); expect(host.count).toBe(4); expect(consumer.loading).toEqual({});
    expect(capture.snapshot().events.filter(event => event.phase === 'finish')).toMatchObject([{ outcome: 'succeeded' }]);
});

it.each(['component', 'service'] as const)('keeps explicit %s cancellation distinct from its later deadline', async kind => {
    vi.useFakeTimers(); const requestId = crypto.randomUUID(), cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ v: 1, type: 'yield', requestId, state: { count: 3 } }) + '\n')); }, cancel: cancelled }), { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } })));
    capture = startDevelopmentTrace(); const { host, consumer } = target(kind), call = host.run(), iterator = call[Symbol.asyncIterator]();
    await iterator.next(); await Promise.all([call.cancel(), call.cancel()]); await vi.advanceTimersByTimeAsync(100);
    await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId });
    expect(cancelled).toHaveBeenCalledTimes(1); expect(host.count).toBe(3); expect(consumer.loading).toEqual({});
    expect(capture.snapshot().events.filter(event => event.phase === 'finish')).toMatchObject([{ outcome: 'cancelled' }]);
});

it.each(['timeout', 'disconnect', 'overflow'] as const)('settles a paused WebSocket call on %s without another consumer pull', async ending => {
    const { proxyServerMethods } = await import('../src/shared/method-proxy');
    const { routeSocketFrame, failPendingSocketCalls } = await import('../src/shared/transport-connections');
    const { wsPendingCalls } = await import('../src/shared/transport-connections');
    vi.useFakeTimers(); const socket = { readyState: WebSocket.OPEN, send: vi.fn() };
    const { host, consumer } = target('component'); host.websocket = socket; host.consume = () => undefined;
    proxyServerMethods(host, [{ name: 'run', channel: 'channel' }]);
    capture = startDevelopmentTrace(); const call = host.run(), iterator = call[Symbol.asyncIterator]();
    const requestId = JSON.parse(socket.send.mock.calls[0][0]).requestId;
    routeSocketFrame(socket, { v: 1, type: 'yield', requestId, state: { count: 7 }, value: 'first' });
    expect(await iterator.next()).toEqual({ done: false, value: 'first' });
    let failure: any; void call.catch((error: unknown) => { failure = error; });
    if (ending === 'timeout') await vi.advanceTimersByTimeAsync(51);
    else if (ending === 'disconnect') failPendingSocketCalls(socket);
    else for (let i = 0; i < 257; i++) routeSocketFrame(socket, { v: 1, type: 'yield', requestId, state: { count: i }, value: i });
    await vi.advanceTimersByTimeAsync(0);
    const code = ending === 'timeout' ? 'COSSACK_RPC_TIMEOUT' : ending === 'disconnect' ? 'COSSACK_RPC_TRANSPORT_CLOSED' : 'COSSACK_RPC_BUFFER_EXCEEDED';
    expect(failure).toMatchObject({ code, requestId }); expect(host.count).toBe(7); expect(consumer.loading).toEqual({});
    expect(wsPendingCalls(socket).size).toBe(0);
    expect(capture.snapshot().events.filter(event => event.phase === 'finish')).toMatchObject([{ outcome: ending === 'timeout' ? 'timeout' : ending === 'disconnect' ? 'disconnected' : 'failed' }]);
    await expect(iterator.next()).rejects.toMatchObject({ code, requestId }); await call.cancel();
    expect(socket.send.mock.calls.map(([value]) => JSON.parse(value).type)).toEqual(ending === 'disconnect' ? ['action'] : ['action', 'cancel']);
});

it.each(['COSSACK_RPC_CLIENT_ERROR', 'COSSACK_RPC_TRANSPORT_CLOSED'])('preserves queued yields before a server error even when its code is %s', async code => {
    const { proxyServerMethods } = await import('../src/shared/method-proxy');
    const { routeSocketFrame } = await import('../src/shared/transport-connections');
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() };
    const { host } = target('component'); host.websocket = socket; host.consume = () => undefined;
    proxyServerMethods(host, [{ name: 'run', channel: 'channel' }]);
    const call = host.run(), iterator = call[Symbol.asyncIterator]();
    const requestId = JSON.parse(socket.send.mock.calls[0][0]).requestId;
    routeSocketFrame(socket, { v: 1, type: 'yield', requestId, state: { count: 7 }, value: 'first' });
    routeSocketFrame(socket, { v: 1, type: 'error', requestId, code, message: 'Application failure' });
    expect(await iterator.next()).toEqual({ done: false, value: 'first' }); expect(host.count).toBe(7);
    await expect(iterator.next()).rejects.toMatchObject({code, requestId});
    await expect(call).rejects.toMatchObject({code}); expect(host.loading).toEqual({});
    expect(socket.send).toHaveBeenCalledTimes(1);
});

it.each(['component', 'service'] as const)('preserves a %s native size failure before its deadline when producer cleanup stalls', async kind => {
    vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
    const requestId = crypto.randomUUID();
    let rejectCleanup!: (reason: Error) => void;
    const cleanup = new Promise<void>((_, reject) => { rejectCleanup = reject; });
    const cancel = vi.fn(() => cleanup);
    const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(RPC_NATIVE_RESPONSE_MAX_BYTES + 1)); }, cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: {
        [RPC_NATIVE_RESPONSE_HEADER]: 'native', 'X-Cossack-Request-Id': requestId,
    } })));
    capture = startDevelopmentTrace(); const { host, consumer } = target(kind), call = host.run();
    let failure: unknown;
    void call.catch((error: unknown) => { failure = error; });
    try {
        await vi.advanceTimersByTimeAsync(0);
        expect(failure).toMatchObject({ code: 'COSSACK_RPC_RESPONSE_TOO_LARGE', requestId });
        expect(consumer.loading).toEqual({}); expect(host.count).toBe(0);
        expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
        expect(capture.snapshot().events.filter(event => event.phase === 'finish')).toMatchObject([{ outcome: 'failed', requestId }]);
        await vi.advanceTimersByTimeAsync(100);
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_TOO_LARGE', requestId });
        await call.cancel(); expect(cancel).toHaveBeenCalledOnce();
    } finally {
        rejectCleanup(new Error('late producer cleanup failure'));
        await call.catch(() => {});
    }
});
