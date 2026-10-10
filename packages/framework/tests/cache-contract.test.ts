import { AsyncLocalStorage } from 'node:async_hooks';
import { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRequestContextGetter } from '@cossackframework/core';
import { runWithConfig } from '../src/config';
import { __resetCacheForTests, cache, extendCacheDriver, InMemoryCacheStore } from '../src/cache';

const contexts = new AsyncLocalStorage<Context>();
const spec = (driver: string, extra: Record<string, unknown> = {}): { default: string; stores: { main: Record<string, unknown> & { driver: string } } } => ({ default: 'main', stores: { main: { driver, ...extra } } });
function request<T>(config: unknown, env: Record<string, unknown>, work: (c: Context) => T): T {
    const c = new Context(new Request('https://cache.test/'), { env });
    return contexts.run(c, () => runWithConfig({ env, config: config === undefined ? {} : { cache: config } }, () => work(c))) as T;
}
function kv() {
    const records = new Map<string, string>();
    return { get: vi.fn(async (key: string) => records.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
        delete: vi.fn(async (key: string) => { records.delete(key); }) };
}
beforeEach(() => { __resetCacheForTests(); setRequestContextGetter(() => contexts.getStore()); });
afterEach(() => { __resetCacheForTests(); setRequestContextGetter(() => undefined); vi.restoreAllMocks(); });

describe('cache provider ownership and configuration', () => {
    it('keeps concurrent same-name KV bindings separate', async () => {
        const a = kv(); const b = kv(); const cfg = spec('kv', { binding: 'CACHE' });
        let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
        const get = a.get.getMockImplementation()!;
        a.get.mockImplementation(async key => { await held; return get(key); });
        const first = request(cfg, { CACHE: a }, () => cache.get('key'));
        await vi.waitFor(() => expect(a.get).toHaveBeenCalledTimes(1));
        const second = request(cfg, { CACHE: b }, () => cache.get('key'));
        try { await vi.waitFor(() => expect(b.get).toHaveBeenCalledTimes(1)); }
        finally { release(); await Promise.allSettled([first, second]); }
    });
    it('does not borrow a previously configured binding when the current env is missing it', async () => {
        const binding = kv(); const cfg = spec('kv', { binding: 'CACHE' });
        await request(cfg, { CACHE: binding }, () => cache.set('key', 'first'));
        await expect(request(cfg, {}, () => cache.get('key'))).rejects.toThrow(/binding/);
        expect(binding.get).not.toHaveBeenCalled();
    });
    it('observes binding replacement and configuration repair on the same environment object', async () => {
        const a = kv(); const b = kv(); const env: Record<string, unknown> = { CACHE: a };
        const cfg = spec('kv', { binding: 'CACHE' });
        await request(cfg, env, () => cache.set('key', 'a'));
        env.CACHE = b;
        expect(await request(cfg, env, () => cache.get('key'))).toBeUndefined();
        env.CACHE = null;
        await expect(request(cfg, env, () => cache.get('key'))).rejects.toThrow(/binding/);
        env.CACHE = a;
        expect(await request(cfg, env, () => cache.get('key'))).toBe('a');
    });
    it.each([null, false, '', 'private-config-value', [], {}, { default: '' }, { default: 'main' },
        { default: 'main', stores: [] }, { default: 'main', stores: { main: null } },
        spec('', {}), spec('kv', { binding: null }), spec('kv', { namespace: null })])
        ('rejects malformed configured selection without falling back or echoing values (%#)', async cfg => {
            await expect(request(cfg, { CACHE: kv() }, () => cache.get('key'))).rejects.toThrow();
            try { await request(cfg, {}, () => cache.get('key')); }
            catch (error) { expect(String(error)).not.toContain('private-config-value'); }
        });
    it('validates the binding shape even after its cached store exists', async () => {
        const binding: any = kv(); const cfg = spec('kv', { binding: 'CACHE' });
        await request(cfg, { CACHE: binding }, () => cache.set('key', 'saved'));
        binding.delete = null;
        await expect(request(cfg, { CACHE: binding }, () => cache.get('key'))).rejects.toThrow(/binding/);
        expect(binding.get).not.toHaveBeenCalled();
    });
    it('keeps named process-local memory stores independent across requests', async () => {
        const cfg = { default: 'a', stores: { a: { driver: 'memory' }, b: { driver: 'memory' } } };
        await request(cfg, {}, () => cache.set('key', 'a'));
        expect(await request(cfg, {}, () => cache.store('b').get('key'))).toBeUndefined();
        expect(await request(cfg, {}, () => cache.get('key'))).toBe('a');
    });
    it('does not skip other built-ins when memory is extended before the first cache access', async () => {
        const custom = new InMemoryCacheStore(); extendCacheDriver('memory', () => custom);
        const binding = kv();
        await request(spec('kv', { binding: 'CACHE' }), { CACHE: binding }, () => cache.set('key', 1));
        expect(binding.put).toHaveBeenCalledTimes(1);
    });
    it('passes the actual namespace including an explicitly empty prefix', async () => {
        const binding = kv();
        await request(spec('kv', { binding: 'CACHE', namespace: '' }), { CACHE: binding }, () => cache.set('key', 1));
        expect(binding.put.mock.calls[0][0]).toBe(JSON.stringify(['', 'key']));
    });
    it('isolates custom factories by request and full spec, while reusing unchanged selection within a request', async () => {
        const stores = new Map<string, InMemoryCacheStore>();
        const factory = vi.fn((options, env) => {
            const key = JSON.stringify([options.region, env.TENANT]);
            if (!stores.has(key)) stores.set(key, new InMemoryCacheStore());
            return stores.get(key)!;
        });
        extendCacheDriver('custom', factory);
        const cfg = { default: 'a', stores: { a: { driver: 'custom', region: 'a' }, b: { driver: 'custom', region: 'b' } } };
        await request(cfg, { TENANT: 'one' }, async () => {
            await cache.set('key', 'one-a'); expect(await cache.get('key')).toBe('one-a');
            expect(factory).toHaveBeenCalledTimes(1);
            expect(await cache.store('b').get('key')).toBeUndefined();
        });
        expect(await request(cfg, { TENANT: 'two' }, () => cache.get('key'))).toBeUndefined();
        expect(factory).toHaveBeenCalledTimes(3);
    });
    it('observes spec/env changes inside the same request and captures remember’s provider before awaiting', async () => {
        const a = new InMemoryCacheStore(); const b = new InMemoryCacheStore();
        const factory = vi.fn((options, env) => options.region === 'a' && env.TENANT === 'one' ? a : b);
        extendCacheDriver('custom', factory);
        const cfg = spec('custom', { region: 'a' }); const env = { TENANT: 'one' };
        await request(cfg, env, async () => {
            await cache.remember('key', 10000, async () => { env.TENANT = 'two'; cfg.stores.main.region = 'b'; return 'a'; });
            expect(await a.get('key')).toBe('a'); expect(await b.get('key')).toBeUndefined();
            expect(await cache.get('key')).toBeUndefined(); expect(factory).toHaveBeenCalledTimes(2);
        });
    });
    it('rejects invalid factory and manual-store shapes before caching them', async () => {
        extendCacheDriver('custom', () => ({ get: async () => 'leaked' } as any));
        await expect(request(spec('custom'), {}, () => cache.get('key'))).rejects.toThrow(/store/);
        expect(() => cache.setDefaultStore({ get: async () => 'leaked' } as any)).toThrow(/store/);
    });
});
