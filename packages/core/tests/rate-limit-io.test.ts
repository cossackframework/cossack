import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableObjectRateLimitStore, KvRateLimitStore, RedisRateLimitStore, RateLimit,
    RATE_LIMIT_RESPONSE_MAX_BYTES, setRateLimitStore, __resetRateLimitForTests, type RateLimitHitOptions } from '../src/shared/rate-limit';

const bytes = (s: string) => new TextEncoder().encode(s);
const counter = () => ({ count: 1, resetAt: Date.now() + 60000 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { __resetRateLimitForTests(); vi.restoreAllMocks(); });

describe.each(['do', 'redis'] as const)('%s rate-limit response lifetime', provider => {
    const payload = () => JSON.stringify(provider === 'do' ? counter() : { result: [1, 60000] });
    function store(fetch: (input: any, init?: RequestInit) => Promise<Response>) {
        return provider === 'do' ? new DurableObjectRateLimitStore({ idFromName: name => name, get: () => ({ fetch }) })
            : new RedisRateLimitStore({ url: 'https://redis.test', token: 'PRIVATE_TOKEN', fetch });
    }
    it('accepts a reply exactly at the byte bound through EOF', async () => {
        const response = new Response(payload().padEnd(RATE_LIMIT_RESPONSE_MAX_BYTES, ' '));
        expect((await store(async () => response).hit('key', 60000)).count).toBe(1);
        expect(response.body?.locked).toBe(false);
    });
    it.each([undefined, '1'])('rejects excess bytes independently of content-length %s', async length => {
        const cancel = vi.fn(); let step = 0;
        const response = new Response(new ReadableStream({ pull(c) {
            if (step++ === 0) c.enqueue(bytes(payload().padEnd(RATE_LIMIT_RESPONSE_MAX_BYTES, ' ')));
            else c.enqueue(bytes(' '));
        }, cancel }), { headers: length ? { 'Content-Length': length } : {} });
        await expect(store(async () => response).hit('key', 60000)).rejects.toThrow(/8192/);
        expect(cancel).toHaveBeenCalledTimes(1); expect(response.body?.locked).toBe(false);
    });
    it('counts UTF-8 bytes rather than characters', async () => {
        const response = new Response(payload().slice(0, -1) + ',"padding":"' + 'é'.repeat(4100) + '"}');
        await expect(store(async () => response).hit('key', 60000)).rejects.toThrow(/8192/);
        expect(response.body?.locked).toBe(false);
    });
    it.each([new Uint8Array([255]), new Uint8Array([226, 130])])('rejects malformed or truncated UTF-8 %j', async tail => {
        const response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes(payload())); c.enqueue(tail); c.close(); } }));
        await expect(store(async () => response).hit('key', 60000)).rejects.toThrow();
        expect(response.body?.locked).toBe(false);
    });
    it('rejects a producer error after a valid JSON prefix', async () => {
        let step = 0;
        const response = new Response(new ReadableStream({ pull(c) {
            if (!step++) c.enqueue(bytes(payload())); else c.error(new Error('Producer failed'));
        } }, { highWaterMark: 0 }));
        await expect(store(async () => response).hit('key', 60000)).rejects.toThrow(/Producer/);
        expect(response.body?.locked).toBe(false);
    });
    it('requires EOF before allowing a hit and expires a stalled body', async () => {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes(payload())); }, cancel }));
        await expect(store(async () => response).hit('key', 60000, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
        expect(cancel).toHaveBeenCalledTimes(1); expect(response.body?.locked).toBe(false);
    });
    it('discards an HTTP error without reading or exposing its private body', async () => {
        const cancel = vi.fn(); const pull = vi.fn();
        const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 503 });
        await expect(store(async () => response).hit('key', 60000)).rejects.toThrow(/HTTP 503/);
        expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
        expect(response.body?.locked).toBe(false);
    });
    it('does not hang on an HTTP error producer whose cancel never finishes', async () => {
        const response = new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 503 });
        await expect(store(async () => response).hit('key', 60000)).rejects.toThrow(/HTTP 503/);
    });
    it('rejects before dispatch when already aborted and sanitizes the reason', async () => {
        const fetch = vi.fn(); const controller = new AbortController(); controller.abort('PRIVATE_TOKEN');
        await expect(store(fetch).hit('key', 60000, { signal: controller.signal })).rejects.toMatchObject({
            code: 'COSSACK_RPC_CANCELLED', message: 'Rate-limit decision was cancelled.' });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each(['abort', 'timeout'] as const)('disposes a late header response after %s when fetch ignores its signal', async mode => {
        const headers = deferred<Response>(); const fetch = vi.fn((_input: any, _init?: RequestInit) => headers.promise);
        const controller = new AbortController();
        const hit = store(fetch).hit('key', 60000, { signal: controller.signal, timeoutMs: mode === 'abort' ? 500 : 20 });
        const rejection = expect(hit).rejects.toMatchObject({ code: mode === 'abort' ? 'COSSACK_RPC_CANCELLED' : 'COSSACK_RPC_TIMEOUT' });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        if (mode === 'abort') controller.abort('PRIVATE_TOKEN');
        await rejection;
        expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
        const cancel = vi.fn(); const response = new Response(new ReadableStream({ cancel }));
        headers.resolve(response);
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
        expect(response.body?.locked).toBe(false);
    });
    it('releases a reader on abort even when producer cancellation never finishes', async () => {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes(payload())); }, cancel }));
        const controller = new AbortController(); const hit = store(async () => response).hit('key', 60000, { signal: controller.signal });
        const rejection = expect(hit).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await vi.waitFor(() => expect(response.body?.locked).toBe(true));
        controller.abort(); await rejection;
        await vi.waitFor(() => expect(response.body?.locked).toBe(false));
        expect(cancel).toHaveBeenCalledTimes(1);
    });
    it('keeps deadline ownership until EOF and removes it after success', async () => {
        let received!: AbortSignal;
        const hit = store(async (_url, init) => { received = init!.signal!; return new Response(payload()); });
        await hit.hit('key', 60000, { timeoutMs: 20 });
        await new Promise(resolve => setTimeout(resolve, 35));
        expect(received.aborted).toBe(false);
    });
});

describe('counter decision guards', () => {
    function guarded(options = {}) {
        const mutate = vi.fn(() => new Response('ok'));
        const app = new Hono(); app.onError(() => new Response('failed', { status: 500 }));
        app.get('/', RateLimit(options, mutate)); return { mutate, app };
    }
    it('releases a cancelled custom store decision and never runs a late API mutation', async () => {
        const reply = deferred<ReturnType<typeof counter>>(); let signal!: AbortSignal;
        const hit = vi.fn((_key: string, _window: number, options?: RateLimitHitOptions) => { signal = options!.signal!; return reply.promise; });
        setRateLimitStore({ hit }); const action = guarded(); const controller = new AbortController();
        const response = action.app.request('/', { signal: controller.signal });
        await vi.waitFor(() => expect(hit).toHaveBeenCalledTimes(1)); controller.abort();
        expect((await response).status).toBe(500); expect(signal.aborted).toBe(true);
        reply.resolve(counter()); await Promise.resolve();
        expect(action.mutate).not.toHaveBeenCalled();
    });
    it('bounds a custom store that ignores cancellation and does not retry', async () => {
        const hit = vi.fn(() => new Promise<ReturnType<typeof counter>>(() => {})); setRateLimitStore({ hit });
        const action = guarded({ backendTimeoutMs: 20 });
        expect((await action.app.request('/')).status).toBe(500);
        expect(hit).toHaveBeenCalledTimes(1); expect(action.mutate).not.toHaveBeenCalled();
    });
    it('uses the five-second default deadline for an uncooperative custom store', async () => {
        vi.useFakeTimers();
        try {
            const hit = vi.fn(() => new Promise<ReturnType<typeof counter>>(() => {})); setRateLimitStore({ hit });
            const action = guarded(); let settled = false;
            const response = Promise.resolve(action.app.request('/')).then(result => { settled = true; return result; });
            await vi.advanceTimersByTimeAsync(4999);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect((await response).status).toBe(500); expect(hit).toHaveBeenCalledTimes(1);
            expect(action.mutate).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });
    it.each([0, -1, NaN, 1.5, Infinity, null, 2147483648])('rejects invalid deadline %s before counter dispatch', async backendTimeoutMs => {
        const hit = vi.fn(counter); setRateLimitStore({ hit });
        const action = guarded({ backendTimeoutMs });
        expect((await action.app.request('/')).status).toBe(500);
        expect(hit).not.toHaveBeenCalled(); expect(action.mutate).not.toHaveBeenCalled();
    });
    it('does not issue a KV write after an aborted pending read returns', async () => {
        const read = deferred<string | null>(); const get = vi.fn(() => read.promise); const put = vi.fn(async () => {});
        const controller = new AbortController(); const hit = new KvRateLimitStore({ get, put }).hit('key', 60000, { signal: controller.signal });
        const rejection = expect(hit).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1)); controller.abort(); await rejection;
        read.resolve(null); await Promise.resolve(); await Promise.resolve();
        expect(put).not.toHaveBeenCalled();
    });
    it('does not retry or undo an already dispatched KV write after cancellation', async () => {
        const write = deferred<void>();
        const put = vi.fn(async () => { await write.promise; });
        const controller = new AbortController();
        const hit = new KvRateLimitStore({ get: async () => null, put }).hit('key', 60000, { signal: controller.signal });
        const rejection = expect(hit).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
        controller.abort(); await rejection; write.resolve();
        await Promise.resolve(); await Promise.resolve(); expect(put).toHaveBeenCalledTimes(1);
    });
    it('rejects oversized KV records without overwriting them', async () => {
        const put = vi.fn(async () => {});
        const kv = new KvRateLimitStore({ get: async () => JSON.stringify(counter()).padEnd(8193, ' '), put });
        await expect(kv.hit('key', 60000)).rejects.toThrow(/Invalid/); expect(put).not.toHaveBeenCalled();
    });
});
