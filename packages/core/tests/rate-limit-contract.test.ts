import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests, configureRateLimitFromEnv, DurableObjectRateLimitStore,
    getRateLimitStore, InMemoryRateLimitStore, KvRateLimitStore, RateLimit,
    RedisRateLimitStore, redisRateLimitStoreFromEnv, setRateLimitStore } from '../src/shared/rate-limit';

const validCounter = () => ({ count: 1, resetAt: Date.now() + 60000 });
const namespace = () => ({ idFromName: (name: string) => name,
    get: vi.fn(() => ({ fetch: vi.fn(async () => Response.json(validCounter())) })) });
const kv = () => ({ get: vi.fn(async (_key: string) => null as string | null),
    put: vi.fn(async (_key: string, _value: string, _options?: { expirationTtl?: number }) => {}) });
function guarded(options: any = { max: 1, window: 60000 }) {
    const mutate = vi.fn(() => Response.json({ ok: true }));
    const app = new Hono();
    app.onError(() => Response.json({ error: 'Internal Server Error' }, { status: 500 }));
    app.get('/', RateLimit(options, mutate));
    return { mutate, invoke: (env?: any) => app.request('/', {}, env) };
}
beforeEach(() => __resetRateLimitForTests());
afterEach(() => { __resetRateLimitForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const invalidConfigs = [
    { rateLimit: 'kv' }, { rateLimit: 'durable-object' }, { rateLimit: 'redis' },
    { rateLimit: 'unknown' }, { rateLimit: '' }, { rateLimit: ' ' }, { rateLimit: false }, { rateLimit: null },
    { rateLimit: 'kv', RATE_LIMITS: {} }, { rateLimit: 'do', RATE_LIMIT_DO: {} },
    { rateLimit: 'redis', UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 7 },
];
describe('request-owned configuration', () => {
    it.each(invalidConfigs)('rejects invalid configuration %j before mutation', async env => {
        const action = guarded();
        expect((await action.invoke(env)).status).toBe(500);
        expect(action.mutate).not.toHaveBeenCalled();
    });
    it('recovers after repairing a missing binding without restoring earlier budgets', async () => {
        const env: any = { rateLimit: 'kv' };
        const action = guarded();
        expect((await action.invoke(env)).status).toBe(500);
        const records = new Map<string, string>();
        env.RATE_LIMITS = { get: async (key: string) => records.get(key) ?? null,
            put: async (key: string, value: string) => { records.set(key, value); } };
        expect((await action.invoke(env)).status).toBe(200);
        expect((await action.invoke(env)).status).toBe(429);
        expect(action.mutate).toHaveBeenCalledTimes(1);
    });
    it('uses each environment binding while another environment request is still pending', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const a = namespace(); const b = namespace();
        a.get.mockReturnValue({ fetch: vi.fn(async () => { await gate; return Response.json(validCounter()); }) });
        const action = guarded();
        const pending = action.invoke({ rateLimit: 'do', RATE_LIMIT_DO: a });
        await vi.waitFor(() => expect(a.get).toHaveBeenCalledTimes(1));
        const second = action.invoke({ rateLimit: 'do', RATE_LIMIT_DO: b });
        // Wait for binding dispatch without awaiting a response that might be stuck in A.
        try { await vi.waitFor(() => expect(b.get).toHaveBeenCalledTimes(1)); }
        finally { release(); await Promise.allSettled([pending, second]); }
        expect((await pending).status).toBe(200); expect((await second).status).toBe(200);
        expect(action.mutate).toHaveBeenCalledTimes(2);
    });
    it('does not carry a configured backend into an unconfigured request', async () => {
        const binding = namespace(); const action = guarded();
        expect((await action.invoke({ rateLimit: 'do', RATE_LIMIT_DO: binding })).status).toBe(200);
        expect((await action.invoke({})).status).toBe(200);
        expect((await action.invoke()).status).toBe(429);
        expect(binding.get).toHaveBeenCalledTimes(1);
    });
    it('memoizes unchanged configuration and rebuilds when the same env changes binding/mode', () => {
        const env: any = { rateLimit: 'kv', RATE_LIMITS: kv() };
        const first = configureRateLimitFromEnv(env);
        expect(first).toBeInstanceOf(KvRateLimitStore);
        expect(configureRateLimitFromEnv(env)).toBe(first);
        env.RATE_LIMITS = kv();
        expect(configureRateLimitFromEnv(env)).not.toBe(first);
        env.rateLimit = 'do'; env.RATE_LIMIT_DO = namespace();
        expect(configureRateLimitFromEnv(env)).toBeInstanceOf(DurableObjectRateLimitStore);
        delete env.rateLimit;
        expect(configureRateLimitFromEnv(env)).toBeInstanceOf(InMemoryRateLimitStore);
    });
    it('keeps manual overrides intentional and does not replace them with environment selection', async () => {
        const manual = new InMemoryRateLimitStore(); setRateLimitStore(manual);
        const action = guarded();
        expect((await action.invoke({ rateLimit: 'unknown' })).status).toBe(200);
        expect((await action.invoke({ rateLimit: 'kv', RATE_LIMITS: kv() })).status).toBe(429);
        expect(getRateLimitStore()).toBe(manual);
    });
});

const invalidOptions = [{ window: 0 }, { window: -1 }, { window: 1.5 }, { window: NaN },
    { window: Infinity }, { window: null }, { max: -1 }, { max: 1.5 }, { max: NaN },
    { max: Infinity }, { max: null }, { key: () => '' }, { key: () => ' ' },
    { key: () => 7 }, { key: () => null }, { key: null }, { message: 7 }];
describe('limiter runtime contracts', () => {
    it.each(invalidOptions)('rejects invalid options %j before counter or mutation', async options => {
        const hit = vi.fn(validCounter); setRateLimitStore({ hit });
        const action = guarded(options);
        expect((await action.invoke()).status).toBe(500);
        expect(hit).not.toHaveBeenCalled(); expect(action.mutate).not.toHaveBeenCalled();
    });
    it('accepts zero as an intentional deny-all maximum', async () => {
        const action = guarded({ max: 0 });
        expect((await action.invoke()).status).toBe(429); expect(action.mutate).not.toHaveBeenCalled();
    });
    it('snapshots custom counter fields once before making the decision', async () => {
        let reads = 0;
        setRateLimitStore({ hit: () => ({ get count() { return ++reads <= 2 ? 2 : 0; }, resetAt: Date.now() + 60000 }) });
        const action = guarded();
        expect((await action.invoke()).status).toBe(429);
        expect(action.mutate).not.toHaveBeenCalled(); expect(reads).toBe(1);
    });
    it.each([null, {}, { count: 0, resetAt: 100 }, { count: -1, resetAt: 100 },
        { count: '1', resetAt: 100 }, { count: 1.5, resetAt: 100 }, { count: NaN, resetAt: 100 },
        { count: 1, resetAt: Infinity }, { count: 1, resetAt: -1 }])('rejects custom counter %j before mutation', async reply => {
        setRateLimitStore({ hit: () => reply as any });
        const action = guarded(); expect((await action.invoke()).status).toBe(500);
        expect(action.mutate).not.toHaveBeenCalled();
    });
});

describe('KV and Redis counter boundaries', () => {
    it.each(['{broken', 'null', '[]', '{}', '{"count":0,"resetAt":100}',
        '{"count":"1","resetAt":100}', '{"count":1,"resetAt":null}'])('rejects corrupt KV value %s without overwriting it', async raw => {
        const binding = kv(); binding.get.mockResolvedValue(raw);
        await expect(new KvRateLimitStore(binding).hit('member', 60000)).rejects.toThrow(/counter/i);
        expect(binding.put).not.toHaveBeenCalled();
    });
    it('uses KV minimum storage TTL without extending the logical fixed deadline', async () => {
        let now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const binding = kv();
        const records = new Map<string, string>();
        binding.get.mockImplementation(async key => records.get(key) ?? null);
        binding.put.mockImplementation(async (key, value) => { records.set(key, value); });
        const store = new KvRateLimitStore(binding);
        expect(await store.hit('member', 25)).toEqual({ count: 1, resetAt: now + 25 });
        expect(binding.put.mock.calls[0][2]).toEqual({ expirationTtl: 60 });
        now += 24;
        expect(await store.hit('member', 25)).toEqual({ count: 2, resetAt: now + 1 });
        now++;
        expect(await store.hit('member', 25)).toEqual({ count: 1, resetAt: now + 25 });
    });
    const invalidRedis = [null, {}, [], { result: [] }, { result: [0, 1000] },
        { result: [-1, 1000] }, { result: ['1', 1000] }, { result: [1.5, 1000] },
        { result: [1] }, { result: [1, -1] }, { result: [1, -2] }, { result: [1, '1000'] },
        { result: [1, 0.5] }, { result: [1, null] }, { error: '', result: [1, 1000] }];
    it.each(invalidRedis)('rejects Redis reply %j', async reply => {
        const store = new RedisRateLimitStore({ url: 'https://redis.test', token: 'token',
            fetch: async () => Response.json(reply) });
        await expect(store.hit('member', 1500)).rejects.toThrow();
    });
    it('sends millisecond expiry and accepts a valid zero remaining TTL', async () => {
        const fetch = vi.fn(async (_input: string, _init?: RequestInit) => Response.json({ result: [1, 0] }));
        const now = 1_700_000_000_000; vi.spyOn(Date, 'now').mockReturnValue(now);
        const store = new RedisRateLimitStore({ url: 'https://redis.test', token: 'token', fetch });
        expect(await store.hit('member', 1500)).toEqual({ count: 1, resetAt: now });
        const command = JSON.parse(fetch.mock.calls[0][1]!.body as string);
        expect(command[1]).toContain("'PEXPIRE'"); expect(command[4]).toBe('1500');
    });
    it('does not let an explicit env helper borrow process credentials', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://process.test'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(() => redisRateLimitStoreFromEnv({})).toThrow(/Upstash/);
    });
});

for (const provider of ['memory', 'kv', 'do', 'redis'] as const) {
    describe(`${provider} direct store validation`, () => {
        const store = () => provider === 'memory' ? new InMemoryRateLimitStore()
            : provider === 'kv' ? new KvRateLimitStore(kv())
            : provider === 'do' ? new DurableObjectRateLimitStore(namespace())
            : new RedisRateLimitStore({ url: 'https://redis.test', token: 'token', fetch: async () => Response.json({ result: [1, 1000] }) });
        it.each([0, -1, 1.5, NaN, Infinity])('rejects window %s', async window => {
            await expect(Promise.resolve().then(() => store().hit('member', window))).rejects.toThrow(/window/i);
        });
        it.each(['', ' ', 7, null])('rejects key %j', async key => {
            await expect(Promise.resolve().then(() => store().hit(key as any, 60000))).rejects.toThrow(/key/i);
        });
    });
}
