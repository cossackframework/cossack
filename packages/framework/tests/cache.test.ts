// tests/cache.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setRequestContextGetter } from '@cossackframework/core';
import { runWithConfig, type ConfigStore } from '../src/config';
import {
    InMemoryCacheStore,
    KvCacheStore,
    DurableObjectCacheStore,
    CacheDurableObject,
    cache,
    extendCacheDriver,
    __resetCacheForTests,
    type CacheStore,
    type CacheEntry,
    type CacheKvNamespace,
    type CacheDurableObjectNamespace,
    type CacheConfig,
} from '../src/cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Wire getRequestContext() to return a fake Context carrying the given env, so
// the cache manager can resolve KV/DO bindings. Pass `null` to clear it.
function setEnv(env: Record<string, any> | null): void {
    setRequestContextGetter(() => (env ? ({ env } as any) : undefined));
}

// Scope a cache config + env for the manager tests. The env is wired into
// getRequestContext() (for binding resolution) AND into the config store.
function withCacheScope<T>(
    cfg: CacheConfig,
    env: Record<string, any>,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    const store: ConfigStore = { env, config: { cache: cfg } };
    setEnv(env);
    return runWithConfig(store, () => fn());
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

describe('InMemoryCacheStore', () => {
    let store: InMemoryCacheStore;

    beforeEach(() => {
        store = new InMemoryCacheStore();
    });

    it('stores and reads values', async () => {
        await store.set('a', { n: 1 });
        expect(await store.get<{ n: number }>('a')).toEqual({ n: 1 });
    });

    it('returns undefined for missing keys', async () => {
        expect(await store.get('missing')).toBeUndefined();
    });

    it('overwrites existing values', async () => {
        await store.set('a', 'first');
        await store.set('a', 'second');
        expect(await store.get<string>('a')).toBe('second');
    });

    it('delete removes a key', async () => {
        await store.set('a', 1);
        await store.delete('a');
        expect(await store.has('a')).toBe(false);
    });

    it('has() reports presence', async () => {
        await store.set('a', 1);
        expect(await store.has('a')).toBe(true);
        expect(await store.has('b')).toBe(false);
    });

    it('flush() clears everything', async () => {
        await store.set('a', 1);
        await store.set('b', 2);
        await store.flush();
        expect(await store.has('a')).toBe(false);
        expect(await store.has('b')).toBe(false);
    });

    it('respects a TTL in seconds', async () => {
        await store.set('temp', 'x', 0.02); // 20ms
        expect(await store.get('temp')).toBe('x');
        await new Promise((r) => setTimeout(r, 30));
        expect(await store.get('temp')).toBeUndefined();
        expect(await store.has('temp')).toBe(false);
    });

    it('omitting a TTL stores indefinitely', async () => {
        await store.set('forever', 'x');
        await new Promise((r) => setTimeout(r, 10));
        expect(await store.get('forever')).toBe('x');
    });

    it('set(key, undefined) deletes', async () => {
        await store.set('a', 1);
        await store.set('a', undefined);
        expect(await store.has('a')).toBe(false);
    });

    it('survives corrupt stored JSON', async () => {
        (store as any).entries.set('bad', { raw: '{not json' });
        expect(await store.get('bad')).toBeUndefined();
        expect((store as any).entries.has('bad')).toBe(false);
    });

    it('prunes expired entries lazily once over maxEntries', async () => {
        const s = new InMemoryCacheStore(3);
        await s.set('expire-me', 'x', 0.01);
        await new Promise((r) => setTimeout(r, 20));
        for (let i = 0; i < 5; i++) await s.set(`k${i}`, i);
        expect((s as any).entries.has('expire-me')).toBe(false);
    });

    it('getMany reads multiple keys', async () => {
        await store.set('a', 1);
        await store.set('b', 2);
        expect(await store.getMany(['a', 'b', 'c'])).toEqual([1, 2, undefined]);
    });

    it('setMany writes multiple entries', async () => {
        const entries: CacheEntry<number>[] = [
            { key: 'a', value: 1 },
            { key: 'b', value: 2, ttlSeconds: 0.02 },
        ];
        await store.setMany(entries);
        expect(await store.get('a')).toBe(1);
        expect(await store.get('b')).toBe(2);
        await new Promise((r) => setTimeout(r, 30));
        expect(await store.get('b')).toBeUndefined();
    });

    it('deleteMany removes multiple keys', async () => {
        await store.set('a', 1);
        await store.set('b', 2);
        await store.set('c', 3);
        await store.deleteMany(['a', 'b']);
        expect(await store.has('a')).toBe(false);
        expect(await store.has('b')).toBe(false);
        expect(await store.has('c')).toBe(true);
    });

    it('round-trips structured values (no mutation)', async () => {
        const obj = { list: [1, 2, { deep: true }] };
        await store.set('obj', obj);
        obj.list.push(99);
        const out = await store.get<{ list: number[] }>('obj');
        expect(out?.list).toEqual([1, 2, { deep: true }]);
    });
});

// ---------------------------------------------------------------------------
// Fake KV + KvCacheStore
// ---------------------------------------------------------------------------

class FakeKv implements CacheKvNamespace {
    private store = new Map<string, { value: string; expiresAt?: number }>();

    async get(key: string): Promise<string | null> {
        const e = this.store.get(key);
        if (!e) return null;
        if (e.expiresAt !== undefined && Date.now() >= e.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return e.value;
    }

    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined,
        });
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }
}

describe('KvCacheStore', () => {
    it('stores and reads JSON values', async () => {
        const store = new KvCacheStore(new FakeKv());
        await store.set('a', { n: 1 });
        expect(await store.get<{ n: number }>('a')).toEqual({ n: 1 });
    });

    it('returns undefined for missing keys', async () => {
        const store = new KvCacheStore(new FakeKv());
        expect(await store.get('missing')).toBeUndefined();
    });

    it('deletes keys', async () => {
        const store = new KvCacheStore(new FakeKv());
        await store.set('a', 1);
        await store.delete('a');
        expect(await store.has('a')).toBe(false);
    });

    it('honours a custom namespace prefix', async () => {
        const kv = new FakeKv();
        const store = new KvCacheStore(kv, { namespace: 'myapp:' });
        await store.set('x', 1);
        expect(await kv.get('myapp:x')).not.toBeNull();
        expect(await kv.get('cossack:cache:x')).toBeNull();
    });

    it('survives corrupt stored JSON (deletes it)', async () => {
        const kv = new FakeKv();
        await kv.put('cossack:cache:bad', '{not json');
        const store = new KvCacheStore(kv);
        expect(await store.get('bad')).toBeUndefined();
        expect(await kv.get('cossack:cache:bad')).toBeNull();
    });

    it('flush() throws (KV has no bulk delete)', async () => {
        const store = new KvCacheStore(new FakeKv());
        await expect(store.flush()).rejects.toThrow(/bulk-delete/);
    });

    it('uses the KV-side TTL, clamped to the 60s minimum', async () => {
        const kv = new FakeKv();
        const store = new KvCacheStore(kv);
        await store.set('temp', 'x', 0.02);
        const raw = await kv.get('cossack:cache:temp');
        expect(raw).toBe(JSON.stringify('x'));
        expect(await store.get('temp')).toBe('x');
    });

    it('getMany / setMany / deleteMany batch over KV', async () => {
        const store = new KvCacheStore(new FakeKv());
        await store.setMany([{ key: 'a', value: 1 }, { key: 'b', value: 2 }]);
        expect(await store.getMany(['a', 'b', 'c'])).toEqual([1, 2, undefined]);
        await store.deleteMany(['a', 'b']);
        expect(await store.has('a')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Fake DO storage + CacheDurableObject + DurableObjectCacheStore
// ---------------------------------------------------------------------------

class FakeStorage {
    private map = new Map<string, unknown>();
    async get<T>(key: string): Promise<T | undefined> {
        return this.map.get(key) as T | undefined;
    }
    async put(key: string, value: unknown): Promise<void> {
        this.map.set(key, value);
    }
    async delete(key: string): Promise<boolean> {
        return this.map.delete(key);
    }
    async deleteAll(): Promise<void> {
        this.map.clear();
    }
}

function makeFakeDurableObjectState(): any {
    return { storage: new FakeStorage() };
}

describe('CacheDurableObject', () => {
    it('PUT then GET round-trips a value', async () => {
        const dobj = new CacheDurableObject(makeFakeDurableObjectState(), {});
        await dobj.fetch(new Request('https://cache/a', {
            method: 'PUT', body: JSON.stringify({ n: 1 }), headers: { 'Content-Type': 'application/json' },
        }));
        const got = await dobj.fetch(new Request('https://cache/a'));
        expect(got.status).toBe(200);
        expect(await got.json()).toEqual({ n: 1 });
    });

    it('GET returns 404 for missing keys', async () => {
        const dobj = new CacheDurableObject(makeFakeDurableObjectState(), {});
        expect((await dobj.fetch(new Request('https://cache/missing'))).status).toBe(404);
    });

    it('honours the ?ttl= query param', async () => {
        const dobj = new CacheDurableObject(makeFakeDurableObjectState(), {});
        await dobj.fetch(new Request('https://cache/temp?ttl=0.02', {
            method: 'PUT', body: JSON.stringify('x'), headers: { 'Content-Type': 'application/json' },
        }));
        expect((await dobj.fetch(new Request('https://cache/temp'))).status).toBe(200);
        await new Promise((r) => setTimeout(r, 30));
        expect((await dobj.fetch(new Request('https://cache/temp'))).status).toBe(404);
    });

    it('flush clears all keys', async () => {
        const dobj = new CacheDurableObject(makeFakeDurableObjectState(), {});
        await dobj.fetch(new Request('https://cache/a', { method: 'PUT', body: '1', headers: { 'Content-Type': 'application/json' } }));
        await dobj.fetch(new Request('https://cache/flush', { method: 'POST' }));
        expect((await dobj.fetch(new Request('https://cache/a'))).status).toBe(404);
    });

    it('batch endpoints (get-many/set-many/delete-many/has)', async () => {
        const dobj = new CacheDurableObject(makeFakeDurableObjectState(), {});
        await dobj.fetch(new Request('https://cache/set-many', {
            method: 'POST', body: JSON.stringify([{ key: 'a', value: 1 }, { key: 'b', value: 2 }]), headers: { 'Content-Type': 'application/json' },
        }));
        const has = await dobj.fetch(new Request('https://cache/has', {
            method: 'POST', body: JSON.stringify(['a', 'z']), headers: { 'Content-Type': 'application/json' },
        }));
        expect(await has.json()).toEqual([true, false]);
        const many = await dobj.fetch(new Request('https://cache/get-many', {
            method: 'POST', body: JSON.stringify(['a', 'b', 'z']), headers: { 'Content-Type': 'application/json' },
        }));
        expect(await many.json()).toEqual([1, 2, null]);
    });
});

function makeFakeNamespace(): CacheDurableObjectNamespace {
    const instance = new CacheDurableObject(makeFakeDurableObjectState(), {});
    return {
        idFromName: () => 'id-default',
        idFromString: (id: string) => id,
        get: () => ({
            fetch: (input: RequestInfo | URL, init?: RequestInit) => instance.fetch(new Request(input, init)),
        }),
    } as unknown as CacheDurableObjectNamespace;
}

describe('DurableObjectCacheStore', () => {
    it('stores and reads values through the DO', async () => {
        const store = new DurableObjectCacheStore(makeFakeNamespace());
        await store.set('a', { n: 1 });
        expect(await store.get<{ n: number }>('a')).toEqual({ n: 1 });
    });

    it('returns undefined for missing keys (404)', async () => {
        const store = new DurableObjectCacheStore(makeFakeNamespace());
        expect(await store.get('missing')).toBeUndefined();
    });

    it('flush() clears everything', async () => {
        const store = new DurableObjectCacheStore(makeFakeNamespace());
        await store.set('a', 1);
        await store.set('b', 2);
        await store.flush();
        expect(await store.has('a')).toBe(false);
    });

    it('batch ops (getMany/setMany/deleteMany)', async () => {
        const store = new DurableObjectCacheStore(makeFakeNamespace());
        await store.setMany([{ key: 'a', value: 1 }, { key: 'b', value: 2 }]);
        expect(await store.getMany(['a', 'b', 'c'])).toEqual([1, 2, undefined]);
        await store.deleteMany(['a', 'b']);
        expect(await store.getMany(['a', 'b'])).toEqual([undefined, undefined]);
    });

    it('throws when the DO responds non-OK', async () => {
        const ns: CacheDurableObjectNamespace = {
            idFromName: () => 0, idFromString: () => 0,
            get: () => ({ fetch: async () => new Response('boom', { status: 500 }) }),
        } as unknown as CacheDurableObjectNamespace;
        const store = new DurableObjectCacheStore(ns);
        await expect(store.get('a')).rejects.toThrow(/500/);
    });

    it('set(key, undefined) deletes the key', async () => {
        const store = new DurableObjectCacheStore(makeFakeNamespace());
        await store.set('a', 1);
        expect(await store.has('a')).toBe(true);
        await store.set('a', undefined);
        expect(await store.has('a')).toBe(false);
        expect(await store.get('a')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Cache facade — config-driven resolution
// ---------------------------------------------------------------------------

describe('cache facade — config-driven resolution', () => {
    beforeEach(() => {
        __resetCacheForTests();
    });
    afterEach(() => {
        __resetCacheForTests();
        setEnv(null);
    });

    it('defaults to in-memory when no cache config is present', async () => {
        // No config scope at all.
        await cache.set('a', 1);
        expect(await cache.get('a')).toBe(1);
    });

    it('uses the default store declared in config', async () => {
        const cfg: CacheConfig = {
            default: 'memory',
            stores: { memory: { driver: 'memory' } },
        };
        await withCacheScope(cfg, {}, async () => {
            await cache.set('a', { n: 1 });
            expect(await cache.get<{ n: number }>('a')).toEqual({ n: 1 });
        });
    });

    it('resolves a named store via cache.store()', async () => {
        const cfg: CacheConfig = {
            default: 'memory',
            stores: {
                memory: { driver: 'memory' },
                kv: { driver: 'kv', binding: 'CACHE' },
            },
        };
        const fakeKv = new FakeKv();
        await withCacheScope(cfg, { CACHE: fakeKv }, async () => {
            await cache.store('kv').set('x', 42);
            expect(await cache.store('kv').get('x')).toBe(42);
            // Raw KV has the namespaced key.
            expect(await fakeKv.get('cossack:cache:x')).not.toBeNull();
        });
    });

    it('resolves a Durable Object store from a binding', async () => {
        const ns = makeFakeNamespace();
        const cfg: CacheConfig = {
            default: 'do',
            stores: { do: { driver: 'durable-object', binding: 'CACHE_DO' } },
        };
        await withCacheScope(cfg, { CACHE_DO: ns }, async () => {
            await cache.set('a', 1);
            expect(await cache.get('a')).toBe(1);
        });
    });

    it('throws a clear error for an undefined store name', async () => {
        const cfg: CacheConfig = {
            default: 'memory',
            stores: { memory: { driver: 'memory' } },
        };
        await withCacheScope(cfg, {}, async () => {
            await expect(cache.store('nonexistent').get('a')).rejects.toThrow(/not defined/);
        });
    });

    it('throws a clear error for a missing binding', async () => {
        const cfg: CacheConfig = {
            default: 'kv',
            stores: { kv: { driver: 'kv', binding: 'CACHE' } },
        };
        // No CACHE binding in env.
        await withCacheScope(cfg, {}, async () => {
            await expect(cache.get('a')).rejects.toThrow(/CACHE/);
        });
    });

    it('throws a clear error for an unknown driver', async () => {
        const cfg: CacheConfig = {
            default: 'redis',
            stores: { redis: { driver: 'redis' } },
        };
        await withCacheScope(cfg, {}, async () => {
            await expect(cache.get('a')).rejects.toThrow(/Unknown cache driver/);
        });
    });

    it('extendCacheDriver() registers a custom driver', async () => {
        const custom = new InMemoryCacheStore();
        extendCacheDriver('custom', () => custom);
        const cfg: CacheConfig = {
            default: 'custom',
            stores: { custom: { driver: 'custom' } },
        };
        await withCacheScope(cfg, {}, async () => {
            await cache.set('a', 1);
            expect(await custom.get('a')).toBe(1);
        });
    });

    it("'database' driver throws a helpful error when not registered", async () => {
        const cfg: CacheConfig = {
            default: 'database',
            stores: { database: { driver: 'database' } },
        };
        await withCacheScope(cfg, {}, async () => {
            // The framework doesn't hard-depend on @cossackframework/database.
            // The 'database' driver ships as a stub that throws a clear error
            // guiding the user to register it via extendCacheDriver() (the
            // default template does this in src/middlewares/db.ts).
            await expect(cache.get('a')).rejects.toThrow(
                /not registered[\s\S]*extendCacheDriver|not registered[\s\S]*src\/middlewares\/db\.ts/,
            );
        });
    });

    it("'database' driver works after manual extendCacheDriver registration", async () => {
        const custom = new InMemoryCacheStore();
        extendCacheDriver('database', () => custom);
        const cfg: CacheConfig = {
            default: 'database',
            stores: { database: { driver: 'database' } },
        };
        await withCacheScope(cfg, {}, async () => {
            await cache.set('a', 1);
            expect(await custom.get('a')).toBe(1);
        });
    });

    it('setDefaultStore() overrides config-driven default', async () => {
        const manual = new InMemoryCacheStore();
        cache.setDefaultStore(manual);
        try {
            const cfg: CacheConfig = {
                default: 'memory',
                stores: { memory: { driver: 'memory' } },
            };
            await withCacheScope(cfg, {}, async () => {
                await cache.set('a', 1);
                expect(await manual.get('a')).toBe(1);
            });
        } finally {
            __resetCacheForTests();
        }
    });

    it('reuses store instances across requests (per-isolate cache)', async () => {
        const cfg: CacheConfig = {
            default: 'memory',
            stores: { memory: { driver: 'memory' } },
        };
        // First "request".
        await withCacheScope(cfg, {}, async () => {
            await cache.set('shared', 'hello');
        });
        // Second "request" — same isolate, should see the same instance.
        await withCacheScope(cfg, {}, async () => {
            expect(await cache.get('shared')).toBe('hello');
        });
    });

    it('remember() computes and caches on a miss', async () => {
        const cfg: CacheConfig = {
            default: 'memory',
            stores: { memory: { driver: 'memory' } },
        };
        await withCacheScope(cfg, {}, async () => {
            let calls = 0;
            const out = await cache.remember('k', 60, () => {
                calls++;
                return { computed: true };
            });
            expect(out).toEqual({ computed: true });
            expect(calls).toBe(1);
            const again = await cache.remember('k', 60, () => {
                calls++;
                return { computed: false };
            });
            expect(again).toEqual({ computed: true });
            expect(calls).toBe(1);
        });
    });

    it('per-request default switching (different config scopes)', async () => {
        // Simulate two concurrent request configs choosing different defaults.
        const cfgKv: CacheConfig = {
            default: 'kv',
            stores: { kv: { driver: 'kv', binding: 'CACHE' } },
        };
        const cfgMemory: CacheConfig = {
            default: 'memory',
            stores: { memory: { driver: 'memory' } },
        };
        const fakeKv = new FakeKv();

        // Request 1 uses KV.
        await withCacheScope(cfgKv, { CACHE: fakeKv }, async () => {
            await cache.set('via-kv', 'yes');
        });
        // Request 2 uses memory — should NOT see the KV value.
        await withCacheScope(cfgMemory, {}, async () => {
            expect(await cache.get('via-kv')).toBeUndefined();
        });
        // KV still has it.
        await withCacheScope(cfgKv, { CACHE: fakeKv }, async () => {
            expect(await cache.get('via-kv')).toBe('yes');
        });
    });
});

// ---------------------------------------------------------------------------
// Type-level checks (compile-time only)
// ---------------------------------------------------------------------------

describe('cache value typing (compile-time)', () => {
    it('get<T> / set<T> are value-typed on any key', async () => {
        interface User {
            id: number;
            name: string;
        }
        await cache.set<User>('user:1', { id: 1, name: 'Ada' }, 60);
        const u = await cache.get<User>('user:1');
        if (u) expect(typeof u.name).toBe('string');
        // @ts-expect-error — value must match the type parameter
        await cache.set<User>('user:2', { wrong: true });
        // @ts-expect-error — accessing a non-existent field is a type error
        const _bad = (await cache.get<User>('user:1'))?.nonexistent;
        void _bad;
    });

    it('default value type is unknown', async () => {
        const v = await cache.get('any-key');
        expect(v).toBeUndefined();
    });
});
