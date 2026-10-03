import { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimitStore, KvRateLimitStore, DurableObjectRateLimitStore, RedisRateLimitStore,
    evaluateRateLimit, setRateLimitStore, __resetRateLimitForTests, RateLimit, enforceMethodRateLimit } from '../src/shared/rate-limit';

beforeEach(() => { __resetRateLimitForTests(); vi.useFakeTimers(); vi.setSystemTime(2000000); });
afterEach(() => { __resetRateLimitForTests(); vi.useRealTimers(); vi.restoreAllMocks(); });
function kv() {
    const values = new Map<string, string>();
    return { get: vi.fn(async (key: string) => values.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
}
function redis() {
    const values = new Map<string, number>();
    return vi.fn(async (_url: string, init?: RequestInit) => {
        const key = JSON.parse(init!.body as string)[3];
        const count = (values.get(key) ?? 0) + 1; values.set(key, count);
        return Response.json({ result: [count, 60000] });
    });
}
function provider(name: string) {
    const io = vi.fn(async () => Response.json({ count: 1, resetAt: Date.now() + 60000 }));
    const binding = kv(); const fetch = redis();
    const store = name === 'memory' ? new InMemoryRateLimitStore() : name === 'kv' ? new KvRateLimitStore(binding)
        : name === 'durable-object' ? new DurableObjectRateLimitStore({ idFromName: value => value, get: () => ({ fetch: io }) })
        : new RedisRateLimitStore({ url: 'https://redis.test', token: 'secret', fetch });
    return { store, calls: () => binding.get.mock.calls.length + binding.put.mock.calls.length + io.mock.calls.length + fetch.mock.calls.length };
}
describe.each(['memory', 'kv', 'durable-object', 'redis'])('%s limiter key policy', name => {
    it.each(['🙂'.repeat(129), '\ud800', '\udc00', 1, null])('rejects malformed/oversized keys before I/O (%#)', async key => {
        const { store, calls } = provider(name);
        await expect(Promise.resolve().then(() => store.hit(key as any, 60000))).rejects.toThrow(/key/);
        expect(calls()).toBe(0);
    });
});
it.each([0, -1, 1.5, NaN, Infinity, null, 100001])('rejects invalid memory limiter capacities (%#)', value => {
    expect(() => new InMemoryRateLimitStore(value as any)).toThrow(/maxEntries/);
});
it('bounds memory buckets without restoring spent live quotas and reuses expired capacity', () => {
    const store = new InMemoryRateLimitStore(2);
    expect(store.hit('a', 60000).count).toBe(1); expect(store.hit('b', 1001).count).toBe(1);
    expect(() => store.hit('c', 60000)).toThrow(/capacity/);
    expect(store.hit('a', 60000).count).toBe(2); expect(store.hit('b', 1001).count).toBe(2);
    vi.setSystemTime(2001001);
    expect(store.hit('c', 60000).count).toBe(1); expect(store.hit('a', 60000).count).toBe(3);
    expect(() => store.hit('d', 60000)).toThrow(/capacity/);
});
describe.each(['kv', 'redis'])('%s namespace policy', name => {
    it('frames namespace/key pairs so distinct quotas never collide', async () => {
        const binding = kv(); const fetch = redis();
        const make = (namespace: string) => name === 'kv' ? new KvRateLimitStore(binding, { namespace })
            : new RedisRateLimitStore({ url: 'https://redis.test', token: 'secret', namespace, fetch });
        const a = make('a:'); const b = make('a:b:');
        expect((await a.hit('b:c', 60000)).count).toBe(1);
        expect((await b.hit('c', 60000)).count).toBe(1);
        expect((await a.hit('b:c', 60000)).count).toBe(2);
    });
    it.each([null, false, 1, 'x'.repeat(513), '\ud800'])('rejects invalid namespace declarations (%#)', namespace => {
        expect(() => name === 'kv' ? new KvRateLimitStore(kv(), { namespace: namespace as any })
            : new RedisRateLimitStore({ url: 'https://redis.test', token: 'secret', namespace: namespace as any, fetch: redis() })).toThrow(/namespace/);
    });
    it('checks final framed key bytes at the provider boundary', async () => {
        const binding = kv(); const fetch = redis();
        const make = (namespace: string) => name === 'kv' ? new KvRateLimitStore(binding, { namespace })
            : new RedisRateLimitStore({ url: 'https://redis.test', token: 'secret', namespace, fetch });
        expect((await make('').hit('x'.repeat(505), 60000)).count).toBe(1);
        await expect(make('namespace').hit('x'.repeat(505), 60000)).rejects.toThrow(/512/);
        expect(name === 'kv' ? binding.get : fetch).toHaveBeenCalledTimes(1);
    });
});
it.each(['http://redis.test', 'ftp://redis.test', 'data:text/plain,test', 'https://user:PRIVATE@redis.test',
    'https://redis.test/#PRIVATE', 'https://redis.test/?token=PRIVATE', 'https://redis.test/\n',
    'not-a-url', 'https:redis.test', 'https://redis.test\\path', 'https://redis.test/?', 'https://redis.test/#',
    'https://redis.test/' + '界'.repeat(400), 'https://redis.test/' + 'x'.repeat(2048)])('rejects unsafe Redis endpoints without revealing credentials (%#)', url => {
    const fetch = redis();
    expect(() => new RedisRateLimitStore({ url, token: 'PRIVATE_TOKEN', fetch })).toThrow(/endpoint/);
    try { new RedisRateLimitStore({ url, token: 'PRIVATE_TOKEN', fetch }); }
    catch (error) { expect(String(error)).not.toContain('PRIVATE'); }
    expect(fetch).not.toHaveBeenCalled();
});
it.each(['secret\nvalue', 'secret value', '🙂', 'x'.repeat(8193)])('rejects invalid bearer tokens before fetch (%#)', token => {
    expect(() => new RedisRateLimitStore({ url: 'https://redis.test', token, fetch: redis() })).toThrow(/token/);
});
it('uses manual redirects and rejects a redirect without accepting the counter or forwarding its token', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 307, headers: { Location: 'https://other.test/' } }));
    const store = new RedisRateLimitStore({ url: 'https://redis.test', token: 'secret', fetch });
    await expect(store.hit('key', 60000)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]).toHaveLength(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
});
it('frames evaluated scope/caller identities so one route cannot borrow another budget', async () => {
    setRateLimitStore(new InMemoryRateLimitStore());
    const c = new Context(new Request('https://limit.test/'));
    expect(await evaluateRateLimit(c, 'a:b', { max: 1, key: () => 'c' })).toBeNull();
    expect(await evaluateRateLimit(c, 'a', { max: 1, key: () => 'b:c' })).toBeNull();
    expect(await evaluateRateLimit(c, 'a:b', { max: 1, key: () => 'c' })).toMatchObject({ retryAfter: 60 });
});
it.each([null, false, [], 'private', { windowMs: 1000 }, { mx: 1 }])('rejects malformed wrappers and decorator options before a counter (%#)', async options => {
    const c = new Context(new Request('https://limit.test/'));
    const hit = vi.fn(() => ({ count: 1, resetAt: Date.now() + 60000 })); setRateLimitStore({ hit });
    const handler = vi.fn();
    await expect(Promise.resolve().then(() => RateLimit(options as any, handler)(c))).rejects.toThrow(/options/);
    class Action { save() {} }
    RateLimit(options as any)(Action.prototype, 'save', Object.getOwnPropertyDescriptor(Action.prototype, 'save')!);
    await expect(enforceMethodRateLimit(c, Action, 'save', 'api')).rejects.toThrow(/options/);
    expect(hit).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
});
