import { Context } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRequestContextGetter } from '@cossackframework/core';
import { cache, CacheDurableObject, DurableObjectCacheStore, InMemoryCacheStore, KvCacheStore, __resetCacheForTests } from '../src/cache';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); __resetCacheForTests(); setRequestContextGetter(() => undefined); });
function durable(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    return new DurableObjectCacheStore({ idFromName: name => name, get: () => ({ fetch }) });
}

describe.each(['memory', 'kv', 'durable-object'])('%s cache input policy', provider => {
    const make = () => provider === 'memory' ? new InMemoryCacheStore()
        : provider === 'kv' ? new KvCacheStore({ get: vi.fn(), put: vi.fn(), delete: vi.fn() })
        : durable(vi.fn());
    it.each(['', null, 1, '🙂'.repeat(129), '\ud800', '\udc00'])('rejects invalid keys across read and write operations (%#)', async key => {
        const store = make();
        for (const action of [() => store.get(key as any), () => store.has(key as any), () => store.delete(key as any),
            () => store.set(key as any, 1), () => store.getMany(['valid', key as any]), () => store.deleteMany(['valid', key as any])]) {
            await expect(action()).rejects.toThrow(/keys|key/);
        }
    });
    it('rejects oversized/non-JSON values and batches before any mutation', async () => {
        const store = make();
        const circular: any = {}; circular.self = circular;
        for (const value of [1n, circular, () => 1, 'x'.repeat(1024 * 1024)]) {
            await expect(store.setMany([{ key: 'first', value: 1 }, { key: 'second', value }])).rejects.toThrow(/JSON/);
        }
        await expect(store.setMany(Array.from({ length: 129 }, (_, i) => ({ key: String(i), value: i })))).rejects.toThrow(/128/);
        await expect(store.setMany(Array.from({ length: 3 }, (_, i) => ({ key: String(i), value: 'x'.repeat(800000) })))).rejects.toThrow(/2 MiB/);
        if (provider === 'memory') expect(await store.get('first')).toBeUndefined();
    });
});

it('evicts least recently used cache entries without unbounded live growth', async () => {
    const store = new InMemoryCacheStore(2);
    await store.set('a', 1); await store.set('b', 2); await store.get('a'); await store.set('c', 3);
    expect(await store.getMany(['a', 'b', 'c'])).toEqual([1, undefined, 3]);
});
it('enforces serialized memory byte limits and preserves the old value on invalid overwrite/batch', async () => {
    const store = new InMemoryCacheStore(10, 10);
    await store.set('a', '123'); await store.set('b', '123');
    expect(await store.get('a')).toBeUndefined(); expect(await store.get('b')).toBe('123');
    await expect(store.set('b', '123456789')).rejects.toThrow(/maxBytes/);
    await expect(store.setMany<unknown>([{ key: 'c', value: 1 }, { key: 'd', value: '123456789' }])).rejects.toThrow(/maxBytes/);
    expect(await store.get('c')).toBeUndefined(); expect(await store.get('b')).toBe('123');
    await store.delete('b'); await store.set('a', '123'); await store.flush(); await store.set('b', '123');
    expect(await store.get('b')).toBe('123');
});
it.each([0, -1, NaN, Infinity, 1.5, null])('rejects invalid memory capacity (%j)', capacity => {
    expect(() => new InMemoryCacheStore(capacity as any)).toThrow(/maxEntries/);
    expect(() => new InMemoryCacheStore(10, capacity as any)).toThrow(/maxBytes/);
});
it('validates facade durations even on cache hits and before computing a miss', async () => {
    const store = new InMemoryCacheStore(); cache.setDefaultStore(store); await cache.set('key', 1);
    const compute = vi.fn(() => 2);
    await expect(cache.remember('key', -1, compute)).rejects.toThrow(/ttlMs/);
    await expect(cache.remember('missing', -1, compute)).rejects.toThrow(/ttlMs/);
    await expect(cache.setMany([{ key: 'key', value: 2 }], -1)).rejects.toThrow(/ttlMs/);
    expect(compute).not.toHaveBeenCalled(); expect(await cache.get('key')).toBe(1);
});
it('honors the UTF-8 KV storage limit after namespace framing before issuing writes', async () => {
    const binding = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const store = new KvCacheStore(binding, { namespace: 'x'.repeat(500) });
    await expect(store.setMany([{ key: 'a', value: 1 }, { key: '🙂'.repeat(10), value: 2 }])).rejects.toThrow(/512/);
    expect(binding.put).not.toHaveBeenCalled();
    expect(() => new KvCacheStore(binding, { namespace: null as any })).toThrow(/namespace/);
});
it('does not delete a fresh KV replacement based on a stale expired read', async () => {
    const binding = { get: vi.fn(async () => JSON.stringify({ version: 1, value: 'stale', expiresAt: 1 })), put: vi.fn(), delete: vi.fn() };
    const store = new KvCacheStore(binding); await store.set('key', 'fresh');
    expect(await store.get('key')).toBeUndefined(); expect(binding.delete).not.toHaveBeenCalled();
});

it.each([200, 404, 503])('disposes unused DO replies without waiting for producer cancellation (%i)', async status => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const store = durable(async () => new Response(new ReadableStream({ cancel }), { status }));
    if (status === 200) await store.delete('key');
    else if (status === 404) expect(await store.get('key')).toBeUndefined();
    else await expect(store.get('key')).rejects.toThrow(/GET returned 503/);
    expect(cancel).toHaveBeenCalledOnce();
});
it('times out ignored DO fetches and disposes their eventual replies', async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const cancel = vi.fn();
    const store = durable(() => new Promise(resolve => { release = resolve; }));
    const pending = expect(store.get('key')).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5000); await pending;
    release(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce();
});
it('requires EOF and bounds streamed JSON replies even when cancel never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const encoder = new TextEncoder();
    const store = durable(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode('null')); }, cancel,
    })));
    const pending = expect(store.get('key')).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5000); await pending; expect(cancel).toHaveBeenCalledOnce();
    const oversized = durable(async () => new Response(' '.repeat(2 * 1024 * 1024 + 1)));
    await expect(oversized.get('key')).rejects.toThrow(/2 MiB/);
});
it('cancels a pending DO read with the current request signal before accepting its payload', async () => {
    const controller = new AbortController();
    const context = new Context(new Request('https://cache.test/', { signal: controller.signal }));
    setRequestContextGetter(() => context);
    const cancel = vi.fn();
    const store = durable(async () => new Response(new ReadableStream({ cancel })));
    const pending = expect(store.get('key')).rejects.toThrow(/aborted/);
    await Promise.resolve(); controller.abort(); await pending;
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
it.each([[null], [{ found: true }], [], [{ found: 'yes', value: 1 }]].map(reply => ({ reply })))('rejects malformed DO batch reply (%j)', async ({ reply }) => {
    await expect(durable(async () => Response.json(reply)).getMany(['key'])).rejects.toThrow(/batch reply/);
});
it('rejects invalid private batches, oversized input and legacy TTL before DO mutations', async () => {
    const storage = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), deleteAll: vi.fn() };
    const object = new CacheDurableObject({ storage } as any, {});
    for (const body of [JSON.stringify([{ key: 'first', value: 1 }, { key: 'bad', value: 2, ttlMs: -1 }]),
        JSON.stringify([{ key: 'old', value: 1, ttlSeconds: 1 }]), ' '.repeat(2 * 1024 * 1024 + 1)]) {
        expect((await object.fetch(new Request('https://cache/set-many', { method: 'POST', body }))).status).toBe(400);
    }
    expect((await object.fetch(new Request('https://cache/entry?key=x&ttl=1', { method: 'PUT', body: '1' }))).status).toBe(400);
    expect(storage.put).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled();
});
it('reports storage failures as sanitized 500 responses rather than invalid input', async () => {
    const object = new CacheDurableObject({ storage: { get: async () => { throw new Error('PRIVATE_BACKEND_TOKEN'); } } } as any, {});
    const response = await object.fetch(new Request('https://cache/entry?key=key'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('PRIVATE_BACKEND_TOKEN');
});
it('bounds private get-many replies before constructing an oversized response', async () => {
    const get = vi.fn(async () => ({ value: 'x'.repeat(800000) }));
    const object = new CacheDurableObject({ storage: { get } } as any, {});
    const response = await object.fetch(new Request('https://cache/get-many', { method: 'POST', body: JSON.stringify(['a', 'b', 'c', 'd']) }));
    expect(response.status).toBe(500); expect(get).toHaveBeenCalledTimes(3);
});
it('rejects malformed provider response objects without accepting a payload', async () => {
    await expect(durable(async () => null as any).get('key')).rejects.toThrow(/provider response/);
});
