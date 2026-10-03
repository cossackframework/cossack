import { Context } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { setRequestContextGetter } from '@cossackframework/core';
import { cache, InMemoryCacheStore, __resetCacheForTests, extendCacheDriver } from '../src/cache';
import { runWithConfig } from '../src/config';

afterEach(() => { __resetCacheForTests(); setRequestContextGetter(() => undefined); vi.restoreAllMocks(); });
function scope<T>(driver: string, requires: unknown, work: () => T) {
    const binding = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const c = new Context(new Request('https://cache.test/'), { env: { CACHE: binding } });
    setRequestContextGetter(() => c);
    const result = runWithConfig({ env: c.env, config: { cache: {
        default: 'main', stores: { main: { driver, ...(requires === undefined ? {} : { requires }) } },
    } } }, work);
    return { result, binding };
}
it('inspects the selected store and units without running a cache operation', async () => {
    const { result, binding } = scope('kv', undefined, () => cache.inspect());
    const capabilities = await result;
    expect(capabilities).toMatchObject({ provider: 'kv', kind: 'cache', durationUnit: 'milliseconds',
        locality: 'shared', persistence: 'durable', consistency: 'eventual', atomicIncrement: false });
    expect(capabilities.operations).not.toContain('flush'); expect(binding.get).not.toHaveBeenCalled();
});
it.each([{ strongConsistency: true }, { atomicIncrement: true }, { operations: ['flush'] }])
    ('rejects configured KV guarantees before get/set/compute (%j)', async requires => {
        const compute = vi.fn(() => 1);
        const { result, binding } = scope('kv', requires, () => Promise.all([
            expect(cache.get('key')).rejects.toThrow(/required/),
            expect(cache.set('key', 1)).rejects.toThrow(/required/),
            expect(cache.remember('key', 1000, compute)).rejects.toThrow(/required/),
        ]));
        await result; expect(compute).not.toHaveBeenCalled(); expect(binding.get).not.toHaveBeenCalled(); expect(binding.put).not.toHaveBeenCalled();
    });
it('accepts supported requirements and rechecks every request selection', async () => {
    await scope('memory', { strongConsistency: true, millisecondExpiry: true }, () => cache.set('key', 1)).result;
    await expect(scope('memory', { shared: true }, () => cache.get('key')).result).rejects.toThrow(/required shared/);
});
it('cannot weaken a bound requirement by chaining another facade', async () => {
    cache.setDefaultStore(new InMemoryCacheStore());
    const required = cache.require({ shared: true }).require({ shared: false });
    await expect(required.set('key', 1)).rejects.toThrow(/required shared/);
    expect(await cache.get('key')).toBeUndefined();
});
it('keeps custom capabilities unknown unless explicitly declared and never calls methods after rejection', async () => {
    const store = { get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn(), flush: vi.fn(),
        getMany: vi.fn(), setMany: vi.fn(), deleteMany: vi.fn() };
    extendCacheDriver('custom', () => store);
    expect(scope('custom', undefined, () => cache.inspect()).result).toMatchObject({ provider: 'custom', locality: 'unknown' });
    await expect(scope('custom', { shared: true }, () => cache.set('key', 1)).result).rejects.toThrow(/required shared/);
    expect(store.set).not.toHaveBeenCalled();
});
it.each([null, { shared: 1 }, { unknown: true }])('validates bound requirement declarations immediately (%#)', input => {
    expect(() => cache.require(input as any)).toThrow(/requirements/);
});
