# Cache

This document specifies the architecture of Cossack's server-side cache: the config-driven store system, the built-in drivers, the per-request resolution model, and the `cache` facade.

## Design Principles

1. **Config-driven.** Stores are declared in `src/config/cache.ts` (a Laravel-style config file: `default` + a `stores` map), evaluated per request by the existing config system. The `cache` facade reads `config('cache.default')` and `config('cache.stores')` to resolve stores.
2. **Lives in the framework.** The cache system is owned by `@cossackframework/framework` (exported from `@cossackframework/framework/cache`), not core, because it needs direct access to the config system (which is framework-owned). The framework already depends on core.
3. **Server-only.** Cache data lives on the server. The facade resolves stores from the per-request config scope (set up by the config middleware). On the client there is no request scope.
4. **Per-request resolution, per-isolate instances.** The *choice* of default store is resolved per-request from the config ALS (correct isolation — no first-request-wins bug). Store *instances* are memoized per-isolate keyed by driver+binding (bindings are stable per deployment, so reuse is safe and efficient).
5. **Pluggable drivers.** Built-in drivers: `memory` (default), `kv`, `durable-object`. The `database` driver from `@cossackframework/orm/cossack` is registered in `src/middlewares/orm.ts` via `extendCacheDriver()`; Framework stays ORM-independent.
6. **Multiple stores.** A config file can declare many stores (e.g. `memory` + `kv` + `database`). `cache.get()` uses the default; `cache.store('kv')` targets a named one.

## Package Responsibilities

| Package | Role |
|---------|------|
| `@cossackframework/framework` | Owns the cache system: `CacheStore` interface, built-in stores (`InMemoryCacheStore`, `KvCacheStore`, `DurableObjectCacheStore` + `CacheDurableObject`), the `CacheManager` (per-isolate instance cache + per-request config resolution), the `cache` facade, and `extendCacheDriver()`. Also owns `config/cache.ts` (the framework's own cache config). All exported from `@cossackframework/framework/cache`. |
| `@cossackframework/core` | Provides `getRequestContext()` — the injection point the cache uses to resolve Worker bindings (`env.CACHE`, `env.CACHE_DO`) from the active request. No cache code lives in core. |
| `@cossackframework/orm/cossack` | Owns `createDatabaseCacheStore()`, which lazily resolves the scoped ORM and structurally implements Framework's cache contract. The template registers it with `extendCacheDriver('database', () => createDatabaseCacheStore())`. |
| `cossack` CLI | No longer owns a cache-specific command — the `cache_items` migration ships as a default (`0006_create_cache_table.ts`). |

## TTL Units

All TTLs are in **seconds** throughout the cache API (Laravel-compatible). KV's native `expirationTtl` is also seconds. The Durable Object and database stores convert seconds to epoch-millis internally.

## The Store Interface

```typescript
interface CacheStore {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
    getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
}
```

`set(key, undefined)` is equivalent to `delete(key)`. Values are JSON-serialized by the persistent stores; the in-memory store JSON-round-trips values too (no caller mutation leaks).

## The Config File

```typescript
// src/config/cache.ts — factory evaluated per request by the config middleware.
export default ({ env }): CacheConfig => ({
    default: env('CACHE_DRIVER', 'memory'),
    stores: {
        memory: { driver: 'memory' },
        kv: { driver: 'kv', binding: 'CACHE' },
        'durable-object': { driver: 'durable-object', binding: 'CACHE_DO' },
        database: { driver: 'database' },
    },
});
```

Each store spec has a `driver` name and, for KV/DO, a `binding` naming the Worker binding. Bindings are named as **strings** (the config system's `env()` only returns strings); the cache manager resolves the actual binding object via `getRequestContext().env[bindingName]` when building the store instance.

The factory runs per request with access to `c.env` — so the binding-timing problem dissolves (by the time the config is evaluated, bindings exist).

## Drivers

### In-memory (`memory`, default)

`InMemoryCacheStore` — a `Map` with lazy TTL pruning once over `maxEntries` (default 10 000). Per-process. Not shared across instances/regions. Works with zero configuration.

### KV (`kv`)

`KvCacheStore` — Cloudflare KV. Values stored as JSON; expiry via KV's native `expirationTtl` (auto-GC). Uses a structural `CacheKvNamespace` type. Eventually consistent. `flush()` is unsupported (KV has no bulk-delete-by-prefix) and throws a helpful error. KV enforces a minimum TTL of 60s.

### Durable Object (`durable-object`)

`DurableObjectCacheStore` + `CacheDurableObject` — strongly consistent. One DO instance holds the entire cache (`idFromName('default')`). Uses DO transactional storage (`state.storage`) so entries persist across eviction. The DO class must be exported from the Worker entry (Cloudflare requirement).

### Database (`database`)

`createDatabaseCacheStore()` uses the request-scoped ORM and the physical table `cache_items(key, value, expires_at, updated_at)`. It handles upserts, lazy expiry, corrupt payloads, bulk operations, flushes, and misses.

Not hard-imported by Framework. The project template registers it from `src/middlewares/orm.ts`. It requires `cache_items`, shipped in migration `0006_create_cache_table.ts`.

## CacheManager

The manager is the bridge between config and stores:

- **Per-request default resolution.** `resolveDefaultStore()` reads `config('cache.default')` from the active config ALS scope, then looks up the named store. This gives correct per-request behavior (no first-request-wins bug).
- **Per-isolate instance cache.** `Map<string, CacheStore>` keyed by `driver:binding`. Store instances are built lazily from the config spec + resolved binding on first miss, then reused across requests (bindings are stable per deployment). No ALS needed for instances.
- **Named stores.** `resolveNamedStore(name)` looks up `config('cache.stores.name')`, builds/returns the instance.
- **Custom drivers.** `extendCacheDriver(driver, factory)` registers a factory for custom drivers (Redis, R2, etc.) and for the `'database'` driver (registered by the project template in `src/middlewares/db.ts`, not by the framework itself).
- **Default override.** `cache.setDefaultStore(store)` overrides config-driven resolution (advanced).

`__resetCacheForTests()` resets all manager state (driver factories, instance cache, default override).

## The `cache` Facade

```typescript
import { cache } from '@cossackframework/framework/cache';
```

`get`/`set` are **value-typed** (`cache.get<User>('user:1')`). `remember(key, ttl, fn)` is a read-through helper. `forget` aliases `delete` (Laravel naming). Default TTL is 3600s. `store(name)` returns a sub-facade bound to a named store. `setDefaultStore()` overrides the config-driven default.

## How Config Reaches the Cache

The cache reads the config tree via `config('cache')` (imported from `./config`), which reads from the framework's per-request config ALS. This is why the cache lives in the framework: the config system is framework-owned, and core cannot import it (strict `framework → core` dependency direction).

For binding *objects* (KV/DO namespaces), the cache uses `getRequestContext().env` — the core injection point the framework wires once at startup via `setRequestContextGetter`. This is the same indirection `cookie()` and `session()` use.

## Test Conventions

- `__resetCacheForTests()` resets manager state, called in `beforeEach`/`afterEach`.
- Driver tests use structural fakes (`FakeKv implements CacheKvNamespace`, a fake DO namespace routing to one `CacheDurableObject` with an in-memory storage fake).
- Manager/config tests scope a `ConfigStore` with a `cache` key via `runWithConfig()` and wire `setRequestContextGetter` to return a fake env for binding resolution.
- ORM cache contract tests use a real Node SQLite database inside `orm.run()`.
