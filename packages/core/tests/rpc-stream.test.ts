// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendRpcFrame, createRpcCall, rpc$, readRpcStream, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES } from '../src/shared/rpc-stream';
import { proxyHttpMethods } from '../src/shared/method-proxy';

const frame = (type: 'yield' | 'done' = 'yield', value: unknown = 'é🌿', state = { count: 1 }) =>
    ({ v: 1 as const, type, requestId: 'request-1', value, state });
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
function response(chunks: Uint8Array[], cancel = vi.fn()) {
    return new Response(new ReadableStream({
        pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
        cancel,
    }), { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } });
}
async function collect(response: Response) {
    const frames = [];
    for await (const value of readRpcStream(response)) frames.push(value);
    return frames;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('authored client RPC view', () => {
    it('returns the same operation and consumers without another dispatch', async () => {
        let runs = 0;
        const original = createRpcCall((async function* () {
            runs++;
            yield { step: 1 };
            return { total: 1 };
        })(), () => {});
        const call = rpc$(original);
        expect(call).toBe(original);
        expect(rpc$(call)).toBe(call);
        const yielded = [];
        for await (const value of call) yielded.push(value);
        expect(yielded).toEqual([{ step: 1 }]);
        await expect(call).resolves.toEqual({ total: 1 });
        await expect(call).resolves.toEqual({ total: 1 });
        expect(runs).toBe(1);
    });
    it('retains the original cancellation and rejection contract', async () => {
        const abort = vi.fn();
        const original = createRpcCall((async function* () {
            yield 'first';
            return 'final';
        })(), abort);
        const call = rpc$(original);
        const iterator = call[Symbol.asyncIterator]();
        expect(await iterator.next()).toEqual({ done: false, value: 'first' });
        await call.cancel();
        expect(abort).toHaveBeenCalledOnce();
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    });
    it('rejects native return values and lookalike calls instead of inventing a local RPC', () => {
        for (const value of [42, null, Promise.resolve(42), (async function* () { yield 1; })(),
            { then() {}, cancel() {}, [Symbol.asyncIterator]() {} }]) {
            expect(() => rpc$(value)).toThrow(expect.objectContaining({ code: 'COSSACK_RPC_CALL_REQUIRED' }));
        }
    });
});

describe('RPC frame parsing', () => {
    it('decodes UTF-8 frames split at every byte and handles multiple frames in a chunk', async () => {
        const bytes = encode(frame());
        const frames = await collect(response([...bytes].map(byte => Uint8Array.of(byte)).concat([encode(frame('done', 42))])));
        expect(frames).toEqual([frame(), frame('done', 42)]);
        expect(await collect(response([new TextEncoder().encode(`${JSON.stringify(frame())}\r\n${JSON.stringify(frame('done'))}\n`)])))
            .toEqual([frame(), frame('done')]);
    });
    it.each([
        [new Uint8Array(), 'COSSACK_RPC_STREAM_TRUNCATED'],
        [encode(frame()), 'COSSACK_RPC_STREAM_TRUNCATED'],
        [new TextEncoder().encode(JSON.stringify(frame('done'))), 'COSSACK_RPC_STREAM_TRUNCATED'],
        [encode({ ...frame('done'), v: 2 }), 'COSSACK_RPC_STREAM_INVALID'],
        [Uint8Array.of(255, 10), 'COSSACK_RPC_STREAM_INVALID'],
        [encode({ ...frame('done'), state: [] }), 'COSSACK_RPC_STREAM_INVALID'],
        [encode({ ...frame('done'), scopeState: [] }), 'COSSACK_RPC_STREAM_INVALID'],
    ])('rejects incomplete and invalid protocol data', async (bytes, code) => {
        await expect(collect(response([bytes as Uint8Array]))).rejects.toMatchObject({ code });
    });
    it('bounds a frame in bytes even when it arrives across many chunks', async () => {
        const cancel = vi.fn();
        await expect(collect(response([new Uint8Array(RPC_STREAM_MAX_FRAME_BYTES), Uint8Array.of(32)], cancel)))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_TOO_LARGE' });
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('rejects mismatched request IDs and extra frames after completion', async () => {
        await expect(collect(response([encode(frame()), encode({ ...frame('done'), requestId: 'other' })])))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID' });
        await expect(collect(response([encode(frame('done')), encode(frame())])))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID' });
    });
    it('matches the first frame to the known HTTP response ID before exposing state', async () => {
        const reply = response([encode(frame('done'))]);
        reply.headers.set('X-Cossack-Request-Id', 'expected');
        await expect(collect(reply)).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: 'expected' });
    });
    it.each([
        encode({ ...frame(), state: [] }),
        Uint8Array.of(255, 10),
        new TextEncoder().encode('{invalid}\n'),
    ])('retains a learned ID when a later frame is malformed', async bytes => {
        await expect(collect(response([encode(frame()), bytes]))).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: 'request-1' });
    });
    it.each(['', ' '])('rejects empty error code %j', async code => {
        const reply = response([encode({ v: 1, type: 'error', requestId: 'request-1', code, message: 'Failure' })]);
        reply.headers.set('X-Cossack-Request-Id', 'request-1');
        await expect(collect(reply)).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: 'request-1' });
    });
    it('withholds the terminal frame until EOF proves that no data follows it', async () => {
        let finish: (() => void) | undefined;
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(encode(frame('done'))); },
            pull(controller) { finish = () => controller.close(); },
        }, { highWaterMark: 0 });
        const iterator = readRpcStream(new Response(body));
        const delivered = vi.fn(); const pending = iterator.next().then(value => { delivered(); return value; });
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        expect(delivered).not.toHaveBeenCalled(); finish!();
        expect(await pending).toEqual({ done: false, value: frame('done') });
        await iterator.next(); expect(body.locked).toBe(false);
    });
    it('reports a post-yield reader failure with correlation and releases the reader', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(encode(frame())); },
            pull(controller) { controller.error(new TypeError('private producer details')); },
        }, { highWaterMark: 0 });
        await expect(collect(new Response(body))).rejects.toMatchObject({ code: 'COSSACK_RPC_NETWORK_FAILED', requestId: 'request-1', message: expect.stringContaining('unknown') });
        expect(body.locked).toBe(false);
    });
    it.each(['done', 'error'] as const)('rejects a body failure after %s rather than exposing its terminal frame', async type => {
        const terminal = type === 'done' ? frame('done') :
            { v: 1, type, requestId: 'request-1', code: 'COSSACK_VALIDATION_FAILED', message: 'Invalid' };
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(encode(terminal)); },
            pull(controller) { controller.error(new TypeError('private producer details')); },
        }, { highWaterMark: 0 });
        await expect(collect(new Response(body))).rejects.toMatchObject({
            code: 'COSSACK_RPC_NETWORK_FAILED', requestId: 'request-1', message: expect.stringContaining('unknown'),
        });
        expect(body.locked).toBe(false);
    });
    it('keeps cancellation active while a terminal frame waits for EOF', async () => {
        let waiting = false;
        const cancelled = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(encode(frame('done'))); },
            pull() { waiting = true; }, cancel: cancelled,
        }, { highWaterMark: 0 });
        const controller = new AbortController();
        const pending = readRpcStream(new Response(body), controller.signal).next();
        await vi.waitFor(() => expect(waiting).toBe(true)); controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: 'request-1' });
        expect(cancelled).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
    });
    it('cancels a pending reader and releases its lock on abort', async () => {
        const cancelled = vi.fn();
        const stream = new ReadableStream<Uint8Array>({ cancel: cancelled });
        const controller = new AbortController();
        const iterator = readRpcStream(new Response(stream), controller.signal);
        const pending = iterator.next();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        expect(cancelled).toHaveBeenCalledOnce();
        expect(stream.locked).toBe(false);
    });
});

function component(transport: 'http' | 'sse' = 'sse') {
    const instance: any = {
        constructor: class StreamPage {},
        __cossack_proxies: new Map(),
        getInitialStateFromWindow: () => ({ componentRouteId: 'page', transport, scopeKey: 'user:alice' }),
        count: 0,
        getPublicState: () => ({ count: instance.count }),
        loading: {}, _optimisticLockedKeys: {}, _optimisticPendingState: {},
        _isOptimisticLocked: () => false, hasMethod: () => false,
        requestUpdate: vi.fn(), setProperty: (key: string, value: unknown) => { instance[key] = value; },
    };
    proxyHttpMethods(instance, [{ name: 'run' }]);
    return instance;
}

describe('single-dispatch RPC calls', () => {
    it.each(['http', 'sse'] as const)('rejects %s terminal-following data before applying final state or reporting success', async transport => {
        const reply = response([encode(frame('done', 'premature', { count: 999 })), encode(frame())]);
        reply.headers.set('X-Cossack-Request-Id', 'request-1');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply));
        const target = component(transport);
        await expect(target.run()).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID', requestId: 'request-1' });
        expect(target.count).toBe(0); expect(target.loading).toEqual({}); expect(fetch).toHaveBeenCalledOnce();
    });
    it.each(['http', 'sse'] as const)('compares %s custom state using its property JSON key before applying updates', async transport => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ count: { key: 'count', value: 2 }, _cossack_return: 'saved' }),
            { headers: { 'Content-Type': 'application/json' } })));
        const target = component(transport);
        target.count = { toJSON(key: string) { return { key, value: 1 }; } };
        expect(await target.run()).toBe('saved');
        expect(target.count).toEqual({ key: 'count', value: 2 });
        expect(target.loading).toEqual({});
    });
    it.each(['http', 'sse'] as const)('returns ordinary %s results without inventing generator yields', async transport => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ count: 7, _cossack_return: { total: 7 } }),
            { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const target = component(transport);
        const call = rpc$(target.run());
        const values = [];
        for await (const value of call) values.push(value);
        expect(values).toEqual([]);
        expect(await call).toEqual({ total: 7 });
        expect(target.count).toBe(7);
        expect(target.loading).toEqual({});
        expect(fetchMock).toHaveBeenCalledOnce();
    });
    it.each(['http', 'sse'] as const)('iterates one %s response, applies every frame, and shares its final result', async transport => {
        const fetchMock = vi.fn((_input: unknown, _init?: RequestInit) => Promise.resolve(response([encode(frame()), encode(frame('yield', 'second', { count: 2 })), encode(frame('done', 42, { count: 3 }))])));
        vi.stubGlobal('fetch', fetchMock);
        const target = component(transport);
        const call = target.run();
        const values = [];
        for await (const value of call) { values.push(value); expect(target.loading.run).toBe(1); }
        expect(values).toEqual(['é🌿', 'second']);
        expect(target.count).toBe(3);
        expect(await call).toBe(42);
        expect(await call).toBe(42);
        expect(target.loading).toEqual({});
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty('_cossack_stream');
    });
    it('awaits a stream through completion, including ordinary async action results', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([encode(frame()), encode(frame('done', 'final', { count: 2 }))])));
        const target = component();
        expect(await target.run()).toBe('final');
        expect(target.count).toBe(2);
        expect(target.loading).toEqual({});
    });
    it('preserves local edits made between stream frames', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([encode(frame()), encode(frame('done', 'final', { count: 2 }))])));
        const target = component();
        const call = target.run();
        const iterator = call[Symbol.asyncIterator]();
        await iterator.next();
        target.count = 100;
        await iterator.next();
        expect(await call).toBe('final');
        expect(target.count).toBe(100);
    });
    it('throws a correlated server stream error and cleans loading', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([encode(frame()), encode({ v: 1, type: 'error', requestId: 'request-1', code: 'COSSACK_RPC_CLIENT_ERROR', message: 'invalid prompt' })])));
        const target = component();
        const call = target.run();
        const consume = async () => { for await (const _value of call) {} };
        await expect(consume()).rejects.toMatchObject({ code: 'COSSACK_RPC_CLIENT_ERROR', requestId: 'request-1', message: 'invalid prompt' });
        await expect(call).rejects.toThrow('invalid prompt');
        expect(target.loading).toEqual({});
    });
    it('breaking iteration cancels its reader and request once', async () => {
        const cancelled = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
            start(controller) { controller.enqueue(encode(frame())); }, cancel: cancelled,
        }), { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } })));
        const target = component();
        const call = target.run();
        for await (const _value of call) break;
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        expect(cancelled).toHaveBeenCalledOnce();
        expect((vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
        expect(target.loading).toEqual({});
    });
    it('propagates serialization failures without dispatching or leaking loading', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const target = component();
        await expect(target.run(1n)).rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED' });
        expect(fetch).not.toHaveBeenCalled();
        expect(target.loading).toEqual({});
    });
    it('cancels a pending fetch with a stable error and no loading leak', async () => {
        vi.stubGlobal('fetch', vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        })));
        const target = component();
        const call = target.run();
        await call.cancel();
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        expect(fetch).toHaveBeenCalledOnce();
        expect(target.loading).toEqual({});
    });
    it('rejects invalid JSON responses and fetch failures with transport codes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON', { headers: { 'X-Cossack-Request-Id': 'invalid-json-request' } })));
        const target = component();
        await expect(target.run()).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_INVALID', requestId: 'invalid-json-request' });
        expect(target.loading).toEqual({});
        vi.mocked(fetch).mockRejectedValueOnce(new TypeError('connection failed'));
        await expect(target.run()).rejects.toMatchObject({ code: 'COSSACK_RPC_NETWORK_FAILED',
            message: expect.stringContaining('server outcome is unknown') });
        expect(target.loading).toEqual({});
    });
    it('automatically drains an unobserved event-handler call and logs failures', async () => {
        const onError = vi.fn();
        const cleanup = vi.fn();
        const call = createRpcCall((async function* () { try { throw new Error('failed'); } finally { cleanup(); } })(), vi.fn(), onError);
        await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
        expect(onError).toHaveBeenCalledOnce();
        await expect(call).rejects.toThrow('failed');
    });
    it('rejects a second iterator without executing another operation', async () => {
        const run = vi.fn();
        const call = createRpcCall((async function* () { run(); yield 1; return 2; })(), vi.fn());
        const iterator = call[Symbol.asyncIterator]();
        expect(() => call[Symbol.asyncIterator]()).toThrow('already have a consumer');
        expect(await iterator.next()).toEqual({ value: 1, done: false });
        expect(await iterator.next()).toEqual({ value: 2, done: true });
        expect(run).toHaveBeenCalledOnce();
    });
});

it('releases a malformed stream without waiting for an uncooperative producer cancellation hook', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('invalid-json\n')); }, cancel });
    await expect(collect(new Response(body, { headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE } }))).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_INVALID' });
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it('keeps socket trace metadata optional at the frame limit and snapshots application values once', () => {
    const send = vi.fn(), toJSON = vi.fn(() => 'x');
    const socket = { readyState: 1, send };
    const metadata = vi.fn(() => JSON.stringify({ evidence: 'private-test-only' }));
    sendRpcFrame(socket, frame('done', { toJSON }), metadata);
    expect(toJSON).toHaveBeenCalledOnce(); expect(metadata).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0][0]).developmentTrace).toBe(metadata.mock.results[0].value);
    const base = frame('done', '');
    base.value = 'x'.repeat(RPC_STREAM_MAX_FRAME_BYTES - new TextEncoder().encode(JSON.stringify(base)).length);
    sendRpcFrame(socket, base, metadata);
    expect(new TextEncoder().encode(send.mock.calls[1][0])).toHaveLength(RPC_STREAM_MAX_FRAME_BYTES);
    expect(JSON.parse(send.mock.calls[1][0]).developmentTrace).toBeUndefined();
});
