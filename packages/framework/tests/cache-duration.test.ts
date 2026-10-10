import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheDurableObject, DurableObjectCacheStore, InMemoryCacheStore, KvCacheStore } from '../src/cache';

function kv() {
    const values = new Map<string, string>();
    return { get: vi.fn(async (key: string) => values.get(key) ?? null),
        put: vi.fn(async (key: string, value: string, _options?: { expirationTtl?: number }) => { values.set(key, value); }),
        delete: vi.fn(async (key: string) => { values.delete(key); }) };
}
function durable() {
    const values = new Map<string, unknown>();
    const storage = { get: async (key: string) => values.get(key),
        put: async (key: string, value: unknown) => { values.set(key, value); },
        delete: async (key: string) => values.delete(key), deleteAll: async () => values.clear() };
    const object = new CacheDurableObject({ storage } as any, {});
    const binding = { idFromName: (name: string) => name,
        get: vi.fn(() => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => object.fetch(new Request(input, init)) })) };
    return { store: new DurableObjectCacheStore(binding as any), binding, values };
}
const providers = ['memory', 'kv', 'durable-object'] as const;
function make(provider: typeof providers[number]) {
    return provider === 'memory' ? new InMemoryCacheStore() : provider === 'kv' ? new KvCacheStore(kv()) : durable().store;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(2000000); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe.each(providers)('%s cache millisecond contracts', provider => {
    it('expires at the exact millisecond boundary across get/has/getMany', async () => {
        const store = make(provider);
        await store.set('key', null, 1001);
        vi.setSystemTime(2001000);
        expect(await store.get('key')).toBeNull(); expect(await store.has('key')).toBe(true);
        expect(await store.getMany(['key', 'missing'])).toEqual([null, undefined]);
        vi.setSystemTime(2001001);
        expect(await store.get('key')).toBeUndefined(); expect(await store.has('key')).toBe(false);
        expect(await store.getMany(['key'])).toEqual([undefined]);
    });
    it('accepts zero as immediate expiry and omission as indefinite', async () => {
        const store = make(provider); await store.set('zero', 1, 0); await store.set('forever', 2);
        expect(await store.get('zero')).toBeUndefined(); vi.setSystemTime(3000000);
        expect(await store.get('forever')).toBe(2);
    });
    it.each([-1, 1.5, NaN, Infinity, null, '1000', 8640000000000000, 1n, Symbol('invalid')])('rejects invalid durations before overwrite (%#)', async ttl => {
        const store = make(provider); await store.set('key', 'kept');
        await expect(store.set('key', 'lost', ttl as any)).rejects.toThrow();
        expect(await store.get('key')).toBe('kept');
    });
    it('validates an entire batch before the first mutation and rejects legacy units', async () => {
        const store = make(provider);
        await expect(store.setMany([{ key: 'first', value: 1 }, { key: 'second', value: 2, ttlMs: -1 }] as any)).rejects.toThrow();
        expect(await store.get('first')).toBeUndefined();
        await expect(store.setMany([{ key: 'legacy', value: 1, ttlSeconds: 1 }] as any)).rejects.toThrow(/ttlMs/);
        expect(await store.has('legacy')).toBe(false);
    });
    it('round-trips dot segments, reserved paths, Unicode and null values', async () => {
        const store = make(provider);
        const keys = ['.', '..', '/', 'flush', 'get-many', '?key', '%23', '#hash', '🙂'];
        for (const key of keys) { await store.set(key, null); expect(await store.has(key)).toBe(true); }
        expect(await store.getMany(keys)).toEqual(keys.map(() => null));
        await store.deleteMany(keys); expect(await store.getMany(keys)).toEqual(keys.map(() => undefined));
    });
});

it('separates KV logical expiry from its minimum storage retention', async () => {
    const binding = kv(); const store = new KvCacheStore(binding);
    await store.set('key', 'value', 1001);
    expect(binding.put.mock.calls[0][2]).toEqual({ expirationTtl: 60 });
    vi.setSystemTime(2001001); expect(await store.get('key')).toBeUndefined();
});
it('does not let namespace/key concatenation collide', async () => {
    const binding = kv(); const a = new KvCacheStore(binding, { namespace: 'a:' });
    const b = new KvCacheStore(binding, { namespace: 'a:b:' });
    await a.set('b:c', 'first'); await b.set('c', 'second');
    expect(await a.get('b:c')).toBe('first'); expect(await b.get('c')).toBe('second');
});
it('creates Durable Object stubs inside each operation rather than retaining a request-created stub', async () => {
    const { store, binding } = durable(); expect(binding.get).not.toHaveBeenCalled();
    await store.set('key', 'value'); await store.get('key'); expect(binding.get).toHaveBeenCalledTimes(2);
});
