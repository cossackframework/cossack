// src/config/cache.ts
//
// Cache configuration. Each file in `src/config/` default-exports a factory
// `({ env }) => ({...})` evaluated per request, so it can read request-scoped
// environment bindings (`env('KEY', default)`). Access values anywhere with
// `config('cache.default')` (dotted: file name + nested path).
//
//   import { config } from '@cossackframework/framework/config';
//   const driver = config('cache.default'); // 'memory'
import type { EnvFunction } from '@cossackframework/framework/config';
import type { CacheConfig } from '@cossackframework/framework/cache';

declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        cache: CacheConfig;
    }
}

export default ({ env }: { env: EnvFunction }): CacheConfig => ({
    // The default store — a key in `stores` below. Driven by the CACHE_DRIVER
    // env var, defaulting to in-memory (zero-config, per-process).
    // For most apps, set CACHE_DRIVER=kv and add a CACHE KV binding in
    // wrangler.jsonc — see docs/cache.md.
    default: env('CACHE_DRIVER', 'memory'),

    // Named stores. Access a specific one with `cache.store('name').get(...)`.
    // Bindings are named as strings; the cache resolves the binding object from
    // the request env at build time.
    stores: {
        memory: { driver: 'memory' },
        kv: { driver: 'kv', binding: 'CACHE' },
        'durable-object': { driver: 'durable-object', binding: 'CACHE_DO' },
        database: { driver: 'database' },
    },
});
