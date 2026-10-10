import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { storageCapabilities, storageRequirements, readStorageCapabilities, assertStorageRequirements } from '../src/shared/storage-capabilities';
import { InMemoryRateLimitStore, KvRateLimitStore, DurableObjectRateLimitStore, RedisRateLimitStore,
    RateLimit, setRateLimitStore, __resetRateLimitForTests, inspectRateLimitStore } from '../src/shared/rate-limit';

afterEach(() => { __resetRateLimitForTests(); vi.restoreAllMocks(); });
it('separates shared/atomic/persistence traits and keeps operation support honest', () => {
    const memory = storageCapabilities('rate-limit', 'memory');
    expect(memory).toMatchObject({ durationUnit: 'milliseconds', locality: 'process', persistence: 'ephemeral', atomicIncrement: true });
    expect(storageCapabilities('rate-limit', 'kv')).toMatchObject({ locality: 'shared', consistency: 'eventual', atomicIncrement: false, expiryPrecision: 'milliseconds' });
    expect(storageCapabilities('cache', 'durable-object')).toMatchObject({ locality: 'shared', consistency: 'strong', persistence: 'durable', atomicIncrement: false });
    expect(storageCapabilities('rate-limit', 'redis').persistence).toBe('unknown');
    expect(storageCapabilities('cache', 'database')).toMatchObject({ locality: 'unknown', consistency: 'unknown', persistence: 'unknown', expiryPrecision: 'milliseconds' });
    expect(storageCapabilities('cache', 'kv').operations).not.toContain('flush');
});
it.each([{ shared: true }, { durable: true }])('rejects incompatible local guarantees before even charging a memory bucket (%j)', requires => {
    const store = new InMemoryRateLimitStore();
    expect(() => store.hit('key', 60000, { requires })).toThrow(/required/);
    expect(store.hit('key', 60000).count).toBe(1);
});
it.each(['kv', 'durable-object', 'redis'])('checks direct builtin requirements before backend I/O (%s)', provider => {
    const fetch = vi.fn(async () => Response.json({ result: [1, 60000] }));
    const get = vi.fn(async () => null); const put = vi.fn();
    const store = provider === 'kv' ? new KvRateLimitStore({ get, put }) : provider === 'redis'
        ? new RedisRateLimitStore({ url: 'https://redis.test', token: 'secret', fetch })
        : new DurableObjectRateLimitStore({ idFromName: name => name, get: () => ({ fetch }) });
    const requires = provider === 'kv' ? { atomicIncrement: true } : { operations: ['flush'] as const };
    return expect(store.hit('key', 60000, { requires })).rejects.toThrow(/required/).then(() => {
        expect(fetch).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    });
});
it('rejects undeclared custom guarantees before counter and handler invocation', async () => {
    const hit = vi.fn(() => ({ count: 1, resetAt: Date.now() + 60000 })); setRateLimitStore({ hit });
    const handler = vi.fn(c => c.json({ ok: true })); const app = new Hono();
    app.onError(() => Response.json({ error: 'Internal Server Error' }, { status: 500 }));
    app.get('/', RateLimit({ requires: { shared: true, atomicIncrement: true } }, handler));
    expect((await app.request('/')).status).toBe(500);
    expect(hit).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
    expect(inspectRateLimitStore()).toMatchObject({ provider: 'custom', locality: 'unknown', atomicIncrement: 'unknown' });
});
it('accepts explicitly declared custom traits and inspects without consuming quota', async () => {
    const hit = vi.fn(() => ({ count: 1, resetAt: Date.now() + 60000 }));
    setRateLimitStore({ hit, capabilities: storageCapabilities('rate-limit', 'durable-object') });
    expect(inspectRateLimitStore().durationUnit).toBe('milliseconds'); expect(hit).not.toHaveBeenCalled();
    const app = new Hono(); app.get('/', RateLimit({ requires: { shared: true, atomicIncrement: true } }, c => c.json({ ok: true })));
    expect((await app.request('/')).status).toBe(200); expect(hit).toHaveBeenCalledOnce();
});
it.each([null, [], 'shared', { shared: 1 }, { invented: true }, { operations: ['invented'] }, new Date()])('rejects invalid requirements (%#)', value => {
    expect(() => storageRequirements(value)).toThrow(/requirements/);
});
it('snapshots requirements/declarations and does not expose malformed metadata values', () => {
    const requirements = { shared: true, operations: ['hit'] as any[] };
    const snapshot = storageRequirements(requirements); requirements.shared = false; requirements.operations.push('flush');
    expect(snapshot).toEqual({ shared: true, operations: ['hit'] }); expect(Object.isFrozen(snapshot.operations)).toBe(true);
    const declaration = { ...storageCapabilities('rate-limit', 'durable-object'), operations: ['hit'] as any[] };
    const capabilities = readStorageCapabilities(declaration, 'rate-limit'); declaration.operations.push('flush');
    expect(capabilities.operations).toEqual(['hit']);
    expect(() => readStorageCapabilities({ ...declaration, provider: 'https://PRIVATE_TOKEN' }, 'rate-limit')).toThrow('Invalid storage capability declaration');
    expect(() => assertStorageRequirements(storageCapabilities('cache', 'durable-object'), { atomicIncrement: true })).toThrow(/required atomicIncrement/);
});
