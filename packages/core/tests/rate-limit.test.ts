// tests/rate-limit.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    InMemoryRateLimitStore,
    KvRateLimitStore,
    DurableObjectRateLimitStore,
    RateLimitDurableObject,
    RedisRateLimitStore,
    redisRateLimitStoreFromEnv,
    setRateLimitStore,
    getRateLimitStore,
    configureRateLimitFromEnv,
    __resetRateLimitForTests,
    getClientIp,
    defaultRateLimitKey,
    enforceRateLimit,
    enforceMethodRateLimit,
    getRateLimitForAction,
    RateLimit,
    RATE_LIMIT_METADATA_KEY,
    type RateLimitOptions,
    type RateLimitStore,
    type RateLimitKvNamespace,
} from '../src/shared/rate-limit';

// Build a minimal fake Hono Context.
function makeContext(opts: { ip?: string; user?: { id: string }; path?: string; method?: string } = {}): any {
    const headers: Record<string, string> = {};
    if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
    return {
        req: {
            method: opts.method ?? 'GET',
            path: opts.path ?? '/api/test',
            header: (name: string) => headers[name.toLowerCase()] ?? null,
        },
        get: (key: string) => (key === 'user' ? opts.user : undefined),
        json: (data: unknown, status = 200) =>
            new Response(JSON.stringify(data), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
    };
}

describe('InMemoryRateLimitStore', () => {
    let store: InMemoryRateLimitStore;

    beforeEach(() => {
        store = new InMemoryRateLimitStore();
    });

    it('counts hits within a window', () => {
        expect(store.hit('a', 1000)).toEqual({ count: 1, resetAt: expect.any(Number) });
        expect(store.hit('a', 1000).count).toBe(2);
        expect(store.hit('a', 1000).count).toBe(3);
    });

    it('isolates keys', () => {
        store.hit('a', 1000);
        store.hit('a', 1000);
        expect(store.hit('b', 1000).count).toBe(1);
    });

    it('resets the window after it elapses', async () => {
        store.hit('a', 20);
        store.hit('a', 20);
        await new Promise((r) => setTimeout(r, 30));
        expect(store.hit('a', 20).count).toBe(1);
    });

    it('prunes expired entries lazily', async () => {
        const s = new InMemoryRateLimitStore(5);
        s.hit('k1', 10);
        await new Promise((r) => setTimeout(r, 20));
        // Add entries beyond maxEntries to trigger prune; expired k1 should drop.
        for (let i = 0; i < 10; i++) s.hit(`fresh${i}`, 10_000);
        expect((s as any).entries.has('k1')).toBe(false);
    });
});

// A minimal, consistent fake of Cloudflare KV for unit testing the store logic.
// (Does NOT simulate KV's real-world eventual consistency — that is documented,
// not unit-testable.)
class FakeKv implements RateLimitKvNamespace {
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
}

describe('KvRateLimitStore', () => {
    it('counts hits within a window', async () => {
        const kv = new FakeKv();
        const store = new KvRateLimitStore(kv);
        expect((await store.hit('a', 60_000)).count).toBe(1);
        expect((await store.hit('a', 60_000)).count).toBe(2);
        expect((await store.hit('a', 60_000)).count).toBe(3);
    });

    it('isolates keys', async () => {
        const store = new KvRateLimitStore(new FakeKv());
        await store.hit('a', 60_000);
        await store.hit('a', 60_000);
        expect((await store.hit('b', 60_000)).count).toBe(1);
    });

    it('resets after the window elapses (TTL expiry)', async () => {
        const store = new KvRateLimitStore(new FakeKv());
        await store.hit('a', 20);
        await store.hit('a', 20);
        await new Promise((r) => setTimeout(r, 30));
        expect((await store.hit('a', 20)).count).toBe(1);
    });

    it('survives corrupt KV values', async () => {
        const kv = new FakeKv();
        await kv.put('cossack:rl:corrupt', '{not json');
        const store = new KvRateLimitStore(kv);
        expect((await store.hit('corrupt', 60_000)).count).toBe(1);
    });

    it('honours a custom key namespace', async () => {
        const kv = new FakeKv();
        const store = new KvRateLimitStore(kv, { namespace: 'myapp:' });
        await store.hit('x', 60_000);
        // The KV key uses the custom prefix.
        expect(await kv.get('myapp:x')).not.toBeNull();
        expect(await kv.get('cossack:rl:x')).toBeNull();
    });

    it('integrates with enforceRateLimit via setRateLimitStore', async () => {
        setRateLimitStore(new KvRateLimitStore(new FakeKv()));
        try {
            const c = makeContext({ ip: '8.8.8.8' });
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 2 })).toBeNull();
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 2 })).toBeNull();
            const blocked = await enforceRateLimit(c, 's', { window: 60_000, max: 2 });
            expect((blocked as Response)?.status).toBe(429);
        } finally {
            setRateLimitStore(new InMemoryRateLimitStore());
        }
    });
});

describe('custom store via setRateLimitStore', () => {
    it('uses the injected store', async () => {
        let calls = 0;
        const fake: RateLimitStore = {
            hit: () => {
                calls++;
                return { count: calls, resetAt: Date.now() + 1000 };
            },
        };
        setRateLimitStore(fake);
        try {
            const c = makeContext();
            // count grows on each call, max 1 -> 2nd call is blocked
            await enforceRateLimit(c, 'scope', { window: 1000, max: 1 });
            const blocked = await enforceRateLimit(c, 'scope', { window: 1000, max: 1 });
            expect(blocked).toBeInstanceOf(Response);
            expect((blocked as Response).status).toBe(429);
        } finally {
            setRateLimitStore(new InMemoryRateLimitStore());
        }
    });
});

describe('enforceRateLimit', () => {
    beforeEach(() => setRateLimitStore(new InMemoryRateLimitStore()));

    it('allows requests up to the limit', async () => {
        const c = makeContext({ ip: '1.2.3.4' });
        for (let i = 0; i < 5; i++) {
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 5 })).toBeNull();
        }
    });

    it('blocks the request that exceeds the limit with 429 + Retry-After', async () => {
        const c = makeContext({ ip: '1.2.3.4' });
        await enforceRateLimit(c, 's', { window: 60_000, max: 2 });
        await enforceRateLimit(c, 's', { window: 60_000, max: 2 });
        const blocked = await enforceRateLimit(c, 's', { window: 60_000, max: 2 });
        expect(blocked).toBeInstanceOf(Response);
        const res = blocked as Response;
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBeTruthy();
        const body = await res.json();
        expect(body).toEqual({ error: 'Too Many Requests' });
    });

    it('respects a custom message', async () => {
        const c = makeContext({ ip: '1.2.3.4' });
        const res = (await enforceRateLimit(c, 's', { window: 60_000, max: 0, message: 'Chill out' }))!;
        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ error: 'Chill out' });
    });

    it('namespaces counters by scopeKey so limits do not leak across endpoints', async () => {
        const c = makeContext({ ip: '1.2.3.4' });
        await enforceRateLimit(c, 'routeA', { window: 60_000, max: 1 });
        // Same caller, different endpoint — independent budget.
        expect(await enforceRateLimit(c, 'routeB', { window: 60_000, max: 1 })).toBeNull();
    });

    it('buckets by a custom key function', async () => {
        const key = (_c: any) => 'tenant:acme';
        const a = makeContext({ ip: '1.1.1.1' });
        const b = makeContext({ ip: '2.2.2.2' });
        await enforceRateLimit(a, 's', { window: 60_000, max: 1, key });
        // Different IPs but same custom key -> still blocked.
        expect(await enforceRateLimit(b, 's', { window: 60_000, max: 1, key })).not.toBeNull();
    });

    it('default key separates users from IPs', async () => {
        const ipOnly = makeContext({ ip: '9.9.9.9' });
        const authed = makeContext({ ip: '9.9.9.9', user: { id: 'u1' } });
        await enforceRateLimit(ipOnly, 's', { window: 60_000, max: 1 });
        // Authenticated user has a separate bucket despite same IP.
        expect(await enforceRateLimit(authed, 's', { window: 60_000, max: 1 })).toBeNull();
    });
});

describe('key extraction', () => {
    it('reads cf-connecting-ip first', () => {
        expect(getClientIp(makeContext({ ip: '5.5.5.5' }))).toBe('5.5.5.5');
    });

    it('falls back to anonymous', () => {
        expect(getClientIp(makeContext())).toBe('anonymous');
    });

    it('prefers user id when authenticated', () => {
        expect(defaultRateLimitKey(makeContext({ ip: '1.1.1.1', user: { id: 'u42' } }))).toBe('user:u42');
    });

    it('falls back to ip when anonymous', () => {
        expect(defaultRateLimitKey(makeContext({ ip: '1.1.1.1' }))).toBe('ip:1.1.1.1');
    });
});

describe('RateLimit decorator', () => {
    it('stores metadata on the constructor', () => {
        const opts: RateLimitOptions = { window: 5_000, max: 3 };
        class C {
            @RateLimit(opts)
            save() {}
        }
        expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, C)).toEqual({ save: opts });
    });

    it('accumulates multiple methods', () => {
        class C {
            @RateLimit({ max: 1 })
            a() {}

            @RateLimit({ max: 2 })
            b() {}
        }
        expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, C)).toEqual({
            a: { max: 1 },
            b: { max: 2 },
        });
    });

    it('getRateLimitForAction walks the prototype chain', () => {
        class Base {
            @RateLimit({ window: 1_000, max: 1 })
            inherited() {}
        }
        class Sub extends Base {}
        expect(getRateLimitForAction(Sub, 'inherited')).toEqual({ window: 1_000, max: 1 });
        expect(getRateLimitForAction(Sub, 'missing')).toBeUndefined();
    });

    it('enforceMethodRateLimit returns null when no limit is declared', async () => {
        class NoLimit {
            go() {}
        }
        const c = makeContext({ ip: '1.1.1.1' });
        expect(await enforceMethodRateLimit(c, NoLimit, 'go', 'x')).toBeNull();
    });

    it('enforceMethodRateLimit blocks once the limit is exceeded', async () => {
        setRateLimitStore(new InMemoryRateLimitStore());
        class C {
            @RateLimit({ window: 60_000, max: 1 })
            go() {}
        }
        const c = makeContext({ ip: '1.1.1.1' });
        expect(await enforceMethodRateLimit(c, C, 'go', 'scope')).toBeNull();
        const blocked = await enforceMethodRateLimit(c, C, 'go', 'scope');
        expect((blocked as Response)?.status).toBe(429);
    });
});

describe('RateLimit handler wrapper (functional API routes)', () => {
    beforeEach(() => setRateLimitStore(new InMemoryRateLimitStore()));

    it('RateLimit(handler) wraps with defaults and still serves under the limit', async () => {
        const handler = RateLimit((c: any) => c.json({ ok: true }));
        const c = makeContext({ ip: '7.7.7.7' });
        const ok = (await handler(c)) as Response;
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ ok: true });
    });

    it('RateLimit(options, handler) blocks after max', async () => {
        const handler = RateLimit({ window: 60_000, max: 2 }, (c: any) => c.json({ ok: true }));
        const c = makeContext({ ip: '7.7.7.7' });
        expect(((await handler(c)) as Response).status).toBe(200);
        expect(((await handler(c)) as Response).status).toBe(200);
        const blocked = (await handler(c)) as Response;
        expect(blocked.status).toBe(429);
    });

    it('different callers have independent budgets', async () => {
        const handler = RateLimit({ window: 60_000, max: 1 }, (c: any) => c.json({ ok: true }));
        const a = makeContext({ ip: '1.1.1.1' });
        const b = makeContext({ ip: '2.2.2.2' });
        expect(((await handler(a)) as Response).status).toBe(200);
        expect(((await handler(b)) as Response).status).toBe(200);
        expect(((await handler(a)) as Response).status).toBe(429);
    });
});

describe('RateLimitDurableObject', () => {
    it('counts hits within a window and resets after it elapses', async () => {
        const dobj = new RateLimitDurableObject({} as any, {});
        const hit = (w: number) =>
            dobj.fetch(new Request(`https://rl/?window=${w}`)).then((r) => r.json() as Promise<{ count: number }>);
        expect((await hit(20)).count).toBe(1);
        expect((await hit(20)).count).toBe(2);
        expect((await hit(20)).count).toBe(3);
        await new Promise((r) => setTimeout(r, 30)); // 30ms > 20ms window
        expect((await hit(20)).count).toBe(1); // window elapsed -> fresh
    });

    it('defaults to a 60s window when none is given', async () => {
        const dobj = new RateLimitDurableObject({} as any, {});
        const r = await dobj.fetch(new Request('https://rl/'));
        expect(((await r.json()) as { count: number }).count).toBe(1);
    });
});

describe('DurableObjectRateLimitStore', () => {
    it('routes each key to its own DO instance (independent counters)', async () => {
        const instances = new Map<string, RateLimitDurableObject>();
        const ns = {
            idFromName: (name: string) => name,
            get: (id: unknown) => {
                const key = id as string;
                let inst = instances.get(key);
                if (!inst) {
                    inst = new RateLimitDurableObject({} as any, {});
                    instances.set(key, inst);
                }
                return { fetch: (input: RequestInfo | URL) => inst!.fetch(new Request(input)) };
            },
        };
        const store = new DurableObjectRateLimitStore(ns as any);
        expect((await store.hit('a', 60_000)).count).toBe(1);
        expect((await store.hit('a', 60_000)).count).toBe(2);
        expect((await store.hit('b', 60_000)).count).toBe(1); // separate DO
    });

    it('throws when the DO responds non-OK', async () => {
        const ns = {
            idFromName: (name: string) => name,
            get: () => ({ fetch: async () => new Response('boom', { status: 500 }) }),
        };
        const store = new DurableObjectRateLimitStore(ns as any);
        await expect(store.hit('a', 60_000)).rejects.toThrow(/500/);
    });

    it('integrates with enforceRateLimit via setRateLimitStore', async () => {
        const instances = new Map<string, RateLimitDurableObject>();
        const ns = {
            idFromName: (name: string) => name,
            get: (id: unknown) => {
                const key = id as string;
                let inst = instances.get(key);
                if (!inst) {
                    inst = new RateLimitDurableObject({} as any, {});
                    instances.set(key, inst);
                }
                return { fetch: (input: RequestInfo | URL) => inst!.fetch(new Request(input)) };
            },
        };
        setRateLimitStore(new DurableObjectRateLimitStore(ns as any));
        try {
            const c = makeContext({ ip: '3.3.3.3' });
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 2 })).toBeNull();
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 2 })).toBeNull();
            expect(((await enforceRateLimit(c, 's', { window: 60_000, max: 2 })) as Response).status).toBe(429);
        } finally {
            setRateLimitStore(new InMemoryRateLimitStore());
        }
    });
});

describe('RedisRateLimitStore (Upstash REST, zero-dep)', () => {
    it('posts an atomic EVAL and parses count + remaining ttl', async () => {
        let sentBody: any;
        const fakeFetch = async (_url: string, init?: RequestInit) => {
            sentBody = JSON.parse(init!.body as string);
            return new Response(JSON.stringify({ result: [3, 9500] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };
        const store = new RedisRateLimitStore({ url: 'https://x.upstash.io', token: 'tok', fetch: fakeFetch });
        const res = await store.hit('k', 60_000);
        expect(res.count).toBe(3);
        expect(res.resetAt).toBeGreaterThan(Date.now());
        // EVAL command shape: ['EVAL', script, '1', key, ttl]
        expect(sentBody[0]).toBe('EVAL');
        expect(sentBody[2]).toBe('1');
        expect(sentBody[3]).toBe('cossack:rl:k');
        expect(sentBody[4]).toBe('60');
    });

    it('throws on missing credentials', () => {
        expect(() => new RedisRateLimitStore({})).toThrow(/Upstash/);
    });

    it('surfaces Upstash error payloads', async () => {
        const fakeFetch = async () =>
            new Response(JSON.stringify({ error: 'invalid token' }), { status: 200 });
        const store = new RedisRateLimitStore({ url: 'u', token: 't', fetch: fakeFetch });
        await expect(store.hit('k', 1000)).rejects.toThrow(/invalid token/);
    });

    it('throws on non-OK HTTP status', async () => {
        const fakeFetch = async () => new Response('gateway', { status: 502 });
        const store = new RedisRateLimitStore({ url: 'u', token: 't', fetch: fakeFetch });
        await expect(store.hit('k', 1000)).rejects.toThrow(/502/);
    });

    it('falls back to windowMs when PTTL is missing', async () => {
        const fakeFetch = async () =>
            new Response(JSON.stringify({ result: [1, -1] }), { status: 200 });
        const store = new RedisRateLimitStore({ url: 'u', token: 't', fetch: fakeFetch });
        const res = await store.hit('k', 5_000);
        expect(res.count).toBe(1);
        expect(res.resetAt).toBeGreaterThan(Date.now());
    });

    it('honours a custom namespace prefix', async () => {
        let sentKey = '';
        const fakeFetch = async (_u: string, init?: RequestInit) => {
            sentKey = (JSON.parse(init!.body as string))[3];
            return new Response(JSON.stringify({ result: [1, 1000] }), { status: 200 });
        };
        const store = new RedisRateLimitStore({ url: 'u', token: 't', namespace: 'rl:', fetch: fakeFetch });
        await store.hit('k', 1000);
        expect(sentKey).toBe('rl:k');
    });

    it('redisRateLimitStoreFromEnv reads env vars', () => {
        const s = redisRateLimitStoreFromEnv({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' });
        expect(s).toBeInstanceOf(RedisRateLimitStore);
        expect(() => redisRateLimitStoreFromEnv({})).toThrow(/Upstash/);
    });

    it('integrates with enforceRateLimit via setRateLimitStore', async () => {
        let n = 0;
        const fakeFetch = async () =>
            new Response(JSON.stringify({ result: [++n, 60_000] }), { status: 200 });
        setRateLimitStore(new RedisRateLimitStore({ url: 'u', token: 't', fetch: fakeFetch }));
        try {
            const c = makeContext({ ip: '4.4.4.4' });
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 2 })).toBeNull();
            expect(await enforceRateLimit(c, 's', { window: 60_000, max: 2 })).toBeNull();
            expect(((await enforceRateLimit(c, 's', { window: 60_000, max: 2 })) as Response).status).toBe(429);
        } finally {
            setRateLimitStore(new InMemoryRateLimitStore());
        }
    });
});

describe('configureRateLimitFromEnv (zero-code config)', () => {
    beforeEach(() => __resetRateLimitForTests());
    afterEach(() => __resetRateLimitForTests());

    it('leaves the default in-memory store when no var is set', () => {
        configureRateLimitFromEnv({});
        expect(getRateLimitStore()).toBeInstanceOf(InMemoryRateLimitStore);
    });

    it('builds a KvRateLimitStore from rateLimit="kv" + RATE_LIMITS binding', () => {
        const fakeKv = { async get() { return null; }, async put() {} };
        configureRateLimitFromEnv({ rateLimit: 'kv', RATE_LIMITS: fakeKv });
        expect(getRateLimitStore()).toBeInstanceOf(KvRateLimitStore);
    });

    it('builds a RedisRateLimitStore from rateLimit="redis"', () => {
        configureRateLimitFromEnv({
            rateLimit: 'redis',
            UPSTASH_REDIS_REST_URL: 'u',
            UPSTASH_REDIS_REST_TOKEN: 't',
        });
        expect(getRateLimitStore()).toBeInstanceOf(RedisRateLimitStore);
    });

    it('builds a DurableObjectRateLimitStore from rateLimit="durable-object"', () => {
        const fakeNs = {
            idFromName: () => 0,
            get: () => ({ fetch: async () => new Response('{}') }),
        };
        configureRateLimitFromEnv({ rateLimit: 'durable-object', RATE_LIMIT_DO: fakeNs });
        expect(getRateLimitStore()).toBeInstanceOf(DurableObjectRateLimitStore);
    });

    it('accepts the RATE_LIMIT alias and is case-insensitive', () => {
        configureRateLimitFromEnv({
            RATE_LIMIT: 'Redis',
            UPSTASH_REDIS_REST_URL: 'u',
            UPSTASH_REDIS_REST_TOKEN: 't',
        });
        expect(getRateLimitStore()).toBeInstanceOf(RedisRateLimitStore);
    });

    it('stays on the default when a binding is missing (logs an error)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        configureRateLimitFromEnv({ rateLimit: 'kv' }); // no RATE_LIMITS binding
        expect(getRateLimitStore()).toBeInstanceOf(InMemoryRateLimitStore);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMITS'));
        spy.mockRestore();
    });

    it('stays on the default for an unknown mode', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        configureRateLimitFromEnv({ rateLimit: 'memcached' });
        expect(getRateLimitStore()).toBeInstanceOf(InMemoryRateLimitStore);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
        spy.mockRestore();
    });

    it('is memoized — configures only once', () => {
        const fakeKv = { async get() { return null; }, async put() {} };
        configureRateLimitFromEnv({ rateLimit: 'kv', RATE_LIMITS: fakeKv });
        const first = getRateLimitStore();
        configureRateLimitFromEnv({
            rateLimit: 'redis',
            UPSTASH_REDIS_REST_URL: 'u',
            UPSTASH_REDIS_REST_TOKEN: 't',
        });
        expect(getRateLimitStore()).toBe(first); // unchanged by the second call
        expect(getRateLimitStore()).toBeInstanceOf(KvRateLimitStore);
    });

    it('a manual setRateLimitStore() wins over env config', () => {
        const manual = new InMemoryRateLimitStore();
        setRateLimitStore(manual);
        configureRateLimitFromEnv({
            rateLimit: 'kv',
            RATE_LIMITS: { async get() { return null; }, async put() {} },
        });
        expect(getRateLimitStore()).toBe(manual);
    });

    it('enforceRateLimit auto-initializes lazily from c.env', async () => {
        const fakeKv = { async get() { return null; }, async put() {} };
        const c = makeContext({ ip: '1.1.1.1' });
        (c as any).env = { rateLimit: 'kv', RATE_LIMITS: fakeKv };
        await enforceRateLimit(c, 's', { window: 60_000, max: 5 });
        expect(getRateLimitStore()).toBeInstanceOf(KvRateLimitStore);
    });
});
