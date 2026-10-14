import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    cache, DurableObjectCacheStore, InMemoryCacheStore, KvCacheStore, __resetCacheForTests,
    type CacheDurableObjectNamespace, type CacheEntry, type CacheKvNamespace, type CacheStore,
} from '../src/cache';

/** Count serializer work done on one value during a facade write. */
function watchSerializer(value: object) {
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const raw = JSON.stringify(value);
    stringify.mockClear();
    return {
        raw,
        stringified: () => stringify.mock.calls.filter(([input]) => input === value).length,
        parsed: () => parse.mock.calls.filter(([input]) => input === raw).length,
        encoded: () => encode.mock.calls.filter(([input]) => input === raw).length,
    };
}

function kvBinding() {
    const records = new Map<string, string>();
    const binding = {
        put: vi.fn(async (key: string, value: string, _options?: { expirationTtl?: number }) => { records.set(key, value); }),
        get: vi.fn(async (key: string) => records.get(key) ?? null),
        delete: vi.fn(async (key: string) => { records.delete(key); }),
    } satisfies CacheKvNamespace;
    return { binding, records };
}

function durableObjectBinding() {
    const bodies: { url: string; body: string }[] = [];
    const ns: CacheDurableObjectNamespace = {
        idFromName: () => ({}),
        get: () => ({
            async fetch(input: RequestInfo | URL, init?: RequestInit) {
                bodies.push({ url: String(input), body: String(init?.body) });
                return Response.json({ ok: true });
            },
        }),
    };
    return { ns, bodies };
}

const value = () => ({ id: 7, name: 'Ada', tags: ['a', 'b'], nested: { ok: true, ratio: 0.5 } });

describe('cache facade writes serialize each value once', () => {
    beforeEach(() => __resetCacheForTests());
    afterEach(() => { vi.restoreAllMocks(); __resetCacheForTests(); });

    it('memory store: set, setMany and remember stringify and size the value once', async () => {
        cache.setDefaultStore(new InMemoryCacheStore());
        for (const write of [
            (input: object) => cache.set('k', input, 60_000),
            (input: object) => cache.setMany([{ key: 'k', value: input }], 60_000),
            (input: object) => cache.remember('fresh', 60_000, () => input),
        ]) {
            const input = value();
            const watch = watchSerializer(input);
            await write(input);
            expect(watch.stringified()).toBe(1);
            expect(watch.parsed()).toBe(0);
            expect(watch.encoded()).toBe(1);
            vi.restoreAllMocks();
        }
        expect(await cache.get('k')).toEqual(value());
        expect(await cache.get('fresh')).toEqual(value());
    });

    it('KV store: one stringify, and the stored envelope is unchanged', async () => {
        const { binding, records } = kvBinding();
        cache.setDefaultStore(new KvCacheStore(binding));
        const input = value();
        const watch = watchSerializer(input);
        const before = Date.now();
        await cache.set('k', input, 60_000);
        expect(watch.stringified()).toBe(1);
        expect(watch.parsed()).toBe(0);
        expect(watch.encoded()).toBe(1);
        vi.restoreAllMocks();
        const stored = binding.put.mock.calls[0][1];
        const { expiresAt } = JSON.parse(stored);
        expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000);
        expect(stored).toBe(JSON.stringify({ version: 1, value: input, expiresAt }));
        expect(binding.put.mock.calls[0][2]).toEqual({ expirationTtl: 60 });
        expect(await cache.get('k')).toEqual(input);

        const batch = watchSerializer(input);
        await cache.setMany([{ key: 'b', value: input, ttlMs: 120_000 }]);
        expect(batch.stringified()).toBe(1);
        expect(batch.parsed()).toBe(0);
        vi.restoreAllMocks();
        expect(records.size).toBe(2);
        expect(await cache.get('b')).toEqual(input);
    });

    it('Durable Object store: one stringify, and the wire bodies are unchanged', async () => {
        const { ns, bodies } = durableObjectBinding();
        cache.setDefaultStore(new DurableObjectCacheStore(ns));
        const input = value();
        const watch = watchSerializer(input);
        await cache.set('k', input, 5_000);
        expect(watch.stringified()).toBe(1);
        expect(watch.parsed()).toBe(0);
        vi.restoreAllMocks();
        expect(bodies[0]).toEqual({ url: 'https://cache/entry?key=k&ttlMs=5000', body: watch.raw });

        const entries: CacheEntry[] = [{ key: 'a', value: input, ttlMs: 1_000 }, { key: 'bé"', value: 'x' }, { key: 'c', value: undefined }];
        const batch = watchSerializer(input);
        await cache.setMany(entries);
        expect(batch.stringified()).toBe(1);
        expect(batch.parsed()).toBe(0);
        vi.restoreAllMocks();
        expect(bodies[1]).toEqual({ url: 'https://cache/set-many', body: JSON.stringify(entries) });
    });

    it('Durable Object batches over 2 MiB still reject before any request', async () => {
        const { ns, bodies } = durableObjectBinding();
        cache.setDefaultStore(new DurableObjectCacheStore(ns));
        const big = 'é'.repeat(250_000); // 500 000 UTF-8 bytes per value
        const entries = Array.from({ length: 5 }, (_, index) => ({ key: `k${index}`, value: big }));
        await expect(cache.setMany(entries)).rejects.toThrow(/2 MiB/);
        expect(bodies).toHaveLength(0);
    });

    it('custom stores and overridden built-ins still receive a JSON snapshot through set()', async () => {
        const received: unknown[] = [];
        class Logged extends InMemoryCacheStore {
            override async set<T>(key: string, input: T, ttlMs?: number) { received.push(input); return super.set(key, input, ttlMs); }
        }
        for (const store of [new Logged(), {
            get: async () => undefined, has: async () => false, delete: async () => {}, flush: async () => {},
            getMany: async () => [], setMany: async () => {}, deleteMany: async () => {},
            set: async (_key: string, input: unknown) => { received.push(input); },
        } satisfies CacheStore]) {
            cache.setDefaultStore(store);
            const input = { when: new Date(0), skip: undefined, n: 1 };
            await cache.set('k', input, 60_000);
            expect(received.at(-1)).not.toBe(input);
            expect(received.at(-1)).toEqual({ when: '1970-01-01T00:00:00.000Z', n: 1 });
        }
    });
});
