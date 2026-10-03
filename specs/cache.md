# Cache

This document describes the server-side cache. It covers store configuration, built-in drivers, per-request store selection, and the `cache` API.

## Design Principles

1. **Configuration.** Declare stores in `src/config/cache.ts` with a `default` value and a `stores` map. The config system evaluates this file for each request. The `cache` API reads `config('cache.default')` and `config('cache.stores')` to select stores.
2. **Framework package.** `@cossackframework/framework` owns the cache system and exports it from `@cossackframework/framework/cache`. The cache needs the config system, which also belongs to the framework. The framework already depends on core.
3. **Server-only.** Cache data lives on the server. The facade resolves stores from the per-request config scope (set up by the config middleware). On the client there is no request scope.
4. **Per-request store selection.** The cache selects the default store for each request from the config AsyncLocalStorage (ALS) scope. This prevents one request from setting the default for later requests. Built-in wrappers are cached by actual binding identity and the full store spec; named memory stores are process-local. Custom selections belong to the current request. Missing or invalid current bindings reject before any memoized lookup.
5. **Drivers.** Built-in drivers are `memory` (default), `kv`, and `durable-object`. `src/middlewares/orm.ts` registers the `database` driver from `@cossackframework/database/cossack` with `extendCacheDriver()`. The framework does not depend on the ORM.
6. **Multiple stores.** A config file can declare several stores, such as `memory`, `kv`, and `database`. `cache.get()` uses the default store. `cache.store('kv')` selects a named store.

## Package Responsibilities

| Package | Role |
|---------|------|
| `@cossackframework/framework` | Owns the cache system: `CacheStore` interface, built-in stores (`InMemoryCacheStore`, `KvCacheStore`, `DurableObjectCacheStore` + `CacheDurableObject`), the `CacheManager` (per-isolate instance cache + per-request config resolution), the `cache` facade, and `extendCacheDriver()`. Also owns `config/cache.ts` (the framework's own cache config). All exported from `@cossackframework/framework/cache`. |
| `@cossackframework/core` | Provides `getRequestContext()` : the injection point the cache uses to resolve Worker bindings (`env.CACHE`, `env.CACHE_DO`) from the active request. No cache code lives in core. |
| `@cossackframework/database/cossack` | Owns `createDatabaseCacheStore()`, which lazily resolves the scoped ORM and structurally implements Framework's cache contract. The template registers it with `extendCacheDriver('database', () => createDatabaseCacheStore())`. |
| `cossack` CLI | No longer owns a cache-specific command : the `cache_items` migration ships as a default (`0006_create_cache_table.ts`). |

## TTL Units

All public cache TTL values are nonnegative integer **milliseconds** (`ttlMs`). Zero expires immediately; omission stores indefinitely for direct stores and batch entries. Facade `set()` defaults to 3_600_000 ms. KV storage retention converts to `max(60, ceil(ttlMs / 1000))` seconds, while a versioned value envelope holds the epoch millisecond deadline used for logical reads. Durable Object/database storage already uses epoch milliseconds. Invalid durations reject before mutation, including when `remember()` hits.

## The Store Interface

```typescript
interface CacheStore {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
    getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
}
```

`set(key, undefined)` works like `delete(key)`. Persistent stores serialize values as JSON. The in-memory store also serializes and parses values as JSON, so callers cannot change stored values through a shared object reference.

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

The factory runs per request with access to `c.env` : so the binding-timing problem dissolves (by the time the config is evaluated, bindings exist).

## Drivers

### In-memory (`memory`, default)

`InMemoryCacheStore` : a `Map` with LRU eviction at `maxEntries` (default 10 000) or `maxBytes` (default 8 MiB serialized keys/values). Expired entries are removed before live eviction; invalid capacities and oversized entries reject. Per-process. Not shared across instances/regions. Works with zero configuration.

### KV (`kv`)

`KvCacheStore` : Cloudflare KV. Keys are framed namespace/key JSON tuples; values are versioned JSON envelopes with logical millisecond expiry and rounded native retention. Reads never delete stale expired/corrupt records, because a newer write may exist. Uses a structural `CacheKvNamespace` type. Eventually consistent. `flush()` is unsupported (KV has no bulk-delete-by-prefix) and throws a helpful error. KV storage retention has a minimum of 60 seconds; logical cache expiry still uses ttlMs.

### Durable Object (`durable-object`)

`DurableObjectCacheStore` + `CacheDurableObject` : strongly consistent. One DO instance holds the entire cache (`idFromName('default')`). Uses DO transactional storage (`state.storage`) so entries persist across eviction. The DO class must be exported from the Worker entry (Cloudflare requirement).

### Database (`database`)

`createDatabaseCacheStore()` uses the request-scoped ORM and the physical table `cache_items(key, value, expires_at, updated_at)`. It handles upserts, lazy expiry, corrupt payloads, bulk operations, flushes, and misses.

Not hard-imported by Framework. The project template registers it from `src/middlewares/orm.ts`. It requires `cache_items`, shipped in migration `0006_create_cache_table.ts`.

## CacheManager

The manager is the bridge between config and stores:

- **Per-request default resolution.** `resolveDefaultStore()` reads `config('cache.default')` from the active config ALS scope, then looks up the named store. This gives correct per-request behavior (no first-request-wins bug).
- **Owned memoization.** Built-in KV/DO stores use a weak binding-identity map and a bounded full-spec/name map. Memory stores use a bounded process-local map of named declarations. Custom factories reuse an unchanged same-request selection only; shallow env fields/identities and factory identity invalidate it. No resource disposal is inferred; nested mutable env objects must remain stable. `remember()` captures its provider before awaiting work.
- **Named stores.** `resolveNamedStore(name)` looks up `config('cache.stores.name')`, builds/returns the instance.
- **Custom drivers.** `extendCacheDriver(driver, factory)` registers a factory for custom drivers (Redis, R2, etc.) and for the `'database'` driver (registered by the project template in `src/middlewares/db.ts`, not by the framework itself).
- **Default override.** `cache.setDefaultStore(store)` overrides config-driven resolution (advanced).

`__resetCacheForTests()` resets all manager state (driver factories, instance cache, default override).

## The `cache` Facade

```typescript
import { cache } from '@cossackframework/framework/cache';
```

`get`/`set` are **value-typed** (`cache.get<User>('user:1')`). `remember(key, ttl, fn)` is a read-through helper. `forget` aliases `delete` (Laravel naming). Facade `set()` defaults to 3_600_000 ms; direct stores and batches omit expiry unless a TTL is supplied. `store(name)` returns a sub-facade bound to a named store. `setDefaultStore()` overrides the config-driven default.

## How Config Reaches the Cache

The cache reads the config tree via `config('cache')` (imported from `./config`), which reads from the framework's per-request config ALS. This is why the cache lives in the framework: the config system is framework-owned, and core cannot import it (strict `framework → core` dependency direction).

For binding *objects* (KV/DO namespaces), the cache uses `getRequestContext().env` : the core injection point the framework wires once at startup via `setRequestContextGetter`. This is the same indirection `cookie()` and `session()` use.

## Test Conventions

- `__resetCacheForTests()` resets manager state, called in `beforeEach`/`afterEach`.
- Driver tests use structural fakes (`FakeKv implements CacheKvNamespace`, a fake DO namespace routing to one `CacheDurableObject` with an in-memory storage fake).
- Manager/config tests scope a `ConfigStore` with a `cache` key via `runWithConfig()` and wire `setRequestContextGetter` to return a fake env for binding resolution.
- ORM cache contract tests use a real Node SQLite database inside `orm.run()`.

## 0.9.0 validation and private protocol

All stores validate nonempty valid UTF-8 keys of at most 512 bytes, JSON values up to 1 MiB, and write batches up to 128 entries/2 MiB including overhead. Framework and database hold matching pure validators independently, preserving the library dependency boundary. Invalid batch input cannot cause a prefix of writes; backend failures can still cause partial writes. Database cleanup compares the read value/deadline before deleting, so a concurrent replacement survives.

DO clients obtain stubs per operation. Their requests have a five-second deadline/current-request abort signal; streamed JSON requires EOF, strict UTF-8 and at most 2 MiB. Cancellation is detached from producer cleanup and cannot roll back a dispatched write. The DO endpoint bounds incoming JSON and uses `/entry?key=...`, `ttlMs`, and `{found,value}` batch replies, preserving dot segments and null. Input errors return sanitized 400; storage/reply-size failures return sanitized 500. KV does not offer flush or atomic increments; database consistency depends on its provider/read configuration.

Migration: multiply old TTL arguments by 1,000; rename batch `ttlSeconds` to `ttlMs`. Existing DB/DO epoch timestamps remain valid. New KV framing/envelopes intentionally start a fresh cache; legacy indefinite keys require explicit cleanup. Deploy the private DO client and class together. Provider capability declarations/inspection and rejection of unsupported requested guarantees remain unfinished RT-18 work; this checkpoint does not close the release task.
