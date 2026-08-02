// src/config/cache.ts
//
// Cache configuration. Each file in `src/config/` default-exports a factory
// `({ env }) => ({...})` evaluated per request, so it can read request-scoped
// environment bindings. Access values with `config('cache.default')`.
//
// The `cache` facade (from `@cossackframework/framework/cache`) reads this config
// per-request to resolve the default store and build named stores.
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
    default: env('CACHE_DRIVER', 'memory'),

    // Named stores. Declare as many as you need; access a specific one with
    // `cache.store('kv').get(...)`. Bindings are named as strings (the config
    // system only carries strings); the cache resolves the binding object from
    // the request env at build time.
    stores: {
        // In-memory (default). Per-process — not shared across instances.
        memory: { driver: 'memory' },

        // Cloudflare KV. Recommended for read-through caching (see docs/cache.md).
        // Requires a `CACHE` KV binding in wrangler.jsonc.
        kv: { driver: 'kv', binding: 'CACHE' },

        // Durable Object (strongly consistent). Requires a `CACHE_DO` binding
        // and exporting CacheDurableObject from your Worker entry.
        'durable-object': { driver: 'durable-object', binding: 'CACHE_DO' },

        // Database cache driver from @cossackframework/database/cossack.
        // Registered by the project template in src/middlewares/orm.ts via
        // extendCacheDriver(). Requires the `cache_items` table (default
        // migration 0006_create_cache_table.ts).
        database: { driver: 'database' },
    },
});
