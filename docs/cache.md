---
title: "Cache"
description: "Configure cache stores in config/cache.ts and use cache.get(), cache.remember(), and cache.store()."
---

# Cache

The `cache` API stores data on the server. Define cache stores in `config/cache.ts`. Use the API to store results such as API responses and database queries until they expire.

```typescript
import { cache } from '@cossackframework/framework/cache';

// Store a value for 5 minutes (TTLs are in milliseconds).
await cache.set<User>('user:1', user, 300_000);

// Read it back (typed).
const user = await cache.get<User>('user:1'); // Promise<User | undefined>

// Read-through cache: compute + store on a miss.
const settings = await cache.remember('settings', 600_000, () => loadSettings());

// Use a specific named store.
await cache.store('kv').set('key', 'value', 60_000);
```

TTLs are nonnegative integer milliseconds. Zero expires immediately. The facade `set()` default is `3_600_000` ms (one hour). A direct store call or batch entry with an omitted TTL stores indefinitely. Invalid durations are rejected before writes.

## Configuration

Cache is configured in `src/config/cache.ts`. The file default-exports a factory, evaluated per request (so it can read environment bindings). Declare a `default` store plus a `stores` map:

```typescript
// src/config/cache.ts
import type { EnvFunction } from '@cossackframework/framework/config';
import type { CacheConfig } from '@cossackframework/framework/cache';

declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        cache: CacheConfig;
    }
}

export default ({ env }: { env: EnvFunction }): CacheConfig => ({
    // The default store — a key in `stores` below.
    default: env('CACHE_DRIVER', 'memory'),

    // Named stores. Access a specific one with `cache.store('name')`.
    // Bindings are named as strings; the cache resolves the binding object
    // from the request env at build time.
    stores: {
        memory: { driver: 'memory' },
        kv: { driver: 'kv', binding: 'CACHE' },
        'durable-object': { driver: 'durable-object', binding: 'CACHE_DO' },
        database: { driver: 'database' },
    },
});
```

`cache.get()` uses `default`. `cache.store('kv')` uses a named store. Read any value with `config('cache.default')`.

## Choose a cache backend

Choose KV for recomputable data when stale reads are acceptable. Choose a Durable Object when successive reads must observe writes to one storage owner. Use memory for process-local data. Database guarantees depend on the selected database and its read configuration.

`remember()` can compute the same key concurrently in several requests. It does not lock or combine those requests. Use a side-effect-free computation and allow duplicate work. Cache stores expose get and set operations. Even the Durable Object store does not make a separate `get()` plus `set()` atomic. Use the rate-limit store for counters and a dedicated coordination API for locks.

| Need | Store |
| --- | --- |
| Shared cache with one consistent storage owner | Durable Object |
| Global reads where stale values and misses are acceptable | KV |
| Cache alongside application data | database |
| One process or local development | `memory` (the default) |

## Storage backends

| Store | Consistency | Best for |
| --- | --- | --- |
| `memory` (default) | Per-process | Dev, single-instance apps. Zero configuration. |
| `durable-object` | Strong | Persistent, strongly-consistent cache on Cloudflare. |
| `kv` | Eventual | Cheap, global, "good enough" caching. |
| `database` | Provider-dependent | Cache alongside application data. |

### In-memory (default)

The memory store works with zero configuration. It is per-process: a single Node.js instance or one Workers isolate. It is not shared across instances or regions.

```typescript
export default ({ env }) => ({
    default: 'memory',
    stores: { memory: { driver: 'memory' } },
});
```

### Cloudflare KV

KV serves shared data across Workers. Reads remain eventually consistent. Each record includes its logical expiration timestamp. Native KV retention cleans up expiring records later. Records with no TTL remain until deleted.

```jsonc
// wrangler.jsonc
{
  "kv_namespaces": [{ "binding": "CACHE", "id": "..." }]
}
```

```typescript
export default ({ env }) => ({
    default: env('CACHE_DRIVER', 'kv'),
    stores: { kv: { driver: 'kv', binding: 'CACHE' } },
});
```

> KV is approximate. It is eventually consistent: reads can remain stale across locations, and there is no atomic read-modify-write. A read on one instance can return an old value after another instance writes a new value. For strict consistency, use the Durable Object store. A stale or missing cache entry is safe when your code can compute the value again.
>
> KV storage retention has a 60-second minimum. Cossack enforces the requested millisecond expiration when it reads a record. Storage retention is `max(60, ceil(ttlMs / 1000))` seconds. `cache.flush()` throws on the KV store because KV cannot delete keys by prefix.

### Durable Object (strongly consistent)

One Durable Object instance backs the entire cache, so writes are linearized and entries persist across eviction (via transactional storage).

```jsonc
// wrangler.jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "CACHE_DO", "class_name": "CacheDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["CacheDurableObject"] }]
}
```

```typescript
export default ({ env }) => ({
    default: 'durable-object',
    stores: { 'durable-object': { driver: 'durable-object', binding: 'CACHE_DO' } },
});
```

> Durable Object mode requires one export. Cloudflare requires Durable Object classes to be exported from the Worker entry. Add `CacheDurableObject` to the exports in your `src/index.ts`:
> ```ts
> import { AppDurableObject } from '@cossackframework/framework/DurableObject'; // already there
> import { CacheDurableObject } from '@cossackframework/framework/cache';
>
> export { AppDurableObject, CacheDurableObject };
> ```

### Database

`createDatabaseCacheStore()` stores cache data through the request-scoped ORM.

New projects register it in `src/middlewares/orm.ts` and include migration `0006_create_cache_table.ts`.

1. Apply the migration if you have not applied it:

```sh
cossack migration up
```

2. Set `CACHE_DRIVER=database` in your wrangler vars or `.dev.vars`, or declare the store in `config/cache.ts`:

```typescript
export default ({ env }) => ({
    default: 'database',
    stores: { database: { driver: 'database' } },
});
```

The driver registration lives in `src/middlewares/orm.ts`:

```ts
import { createDatabaseCacheStore } from '@cossackframework/database/cossack';
import { extendCacheDriver } from '@cossackframework/framework/cache';

extendCacheDriver('database', () => createDatabaseCacheStore());
```

Remove that registration if you do not use database-backed caching. The store resolves the active ORM lazily, returns `undefined` for misses or corrupt payloads, and implements the complete Framework cache contract.

## API

| Method | Description |
| --- | --- |
| `cache.get<T>(key)` | Read a value from the default store. Returns `undefined` if missing or expired. |
| `cache.set<T>(key, value, ttlMs?)` | Write a value. TTL defaults to 3_600_000 ms (1 hour). |
| `cache.has(key)` | `true` if the key exists and has not expired. |
| `cache.delete(key)` / `cache.forget(key)` | Remove a key (Laravel naming). |
| `cache.flush()` | Remove every key. |
| `cache.remember<T>(key, ttlMs, fn)` | Return the cached value on a hit, otherwise call `fn`, store its result with the TTL, and return it. |
| `cache.getMany<T>(keys)` | Read several keys at once. |
| `cache.setMany<T>(entries, defaultTtlMs?)` | Write several `{ key, value, ttlMs? }` entries. |
| `cache.deleteMany(keys)` | Remove several keys. |
| `cache.store(name)` | Access a named store declared in `config/cache.ts`. |
| `cache.setDefaultStore(store)` | Override the default store directly (advanced). |
| `extendCacheDriver(driver, factory)` | Register a custom driver (for example Redis). |

## Custom stores

Implement the `CacheStore` interface and register it as a driver for Redis, R2, or another backend:

```ts
import type { CacheStore } from '@cossackframework/framework/cache';
import { extendCacheDriver } from '@cossackframework/framework/cache';

class RedisCacheStore implements CacheStore {
    async get<T>(key: string): Promise<T | undefined> { /* ... */ }
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> { /* ... */ }
    async has(key: string): Promise<boolean> { /* ... */ }
    async delete(key: string): Promise<void> { /* ... */ }
    async flush(): Promise<void> { /* ... */ }
    async getMany<T>(keys: string[]): Promise<(T | undefined)[]> { /* ... */ }
    async setMany<T>(entries): Promise<void> { /* ... */ }
    async deleteMany(keys: string[]): Promise<void> { /* ... */ }
}

extendCacheDriver('redis', () => new RedisCacheStore());
```

Then declare it in `config/cache.ts`:

```ts
export default ({ env }) => ({
    default: 'redis',
    stores: { redis: { driver: 'redis' } },
});
```

## Usage patterns

### Read-through caching

Use `cache.remember()` to cache an expensive operation. It returns the cached value on a hit, or computes, stores, and returns it on a miss:

```ts
const products = await cache.remember('products:featured', 600_000, () =>
    Product.find({ where: { featured: true } }),
);
```

### Multiple stores

Use `cache.store()` to target a specific named store, for example a hot in-memory store alongside a persistent KV store:

```ts
// Fast per-process cache for the request lifecycle.
await cache.store('memory').set('computed', expensive(), 10_000);
// Persistent cache across instances.
await cache.store('kv').set('products', list, 3_600_000);
```

## Ownership and limits

Built-in KV and Durable Object wrappers are reused by the actual binding object's identity and the full store declaration. A missing or invalid binding rejects before lookup. Another request's binding is never a fallback. Durable Object I/O stubs are obtained inside each operation.

Named built-in memory stores persist within one process. At `maxEntries` (default 10,000) or `maxBytes` (default 8 MiB of serialized keys and values), a write first removes every expired entry. If the store is still full, it evicts the least recently used entries. A write costs the same at any capacity: the store finds expired and least recently used entries through indexes, not by reading every entry. This byte budget does not measure JavaScript heap usage or impose a process-wide limit. Configure both in the memory store declaration. A value that exceeds the byte budget rejects before replacing an existing value.

Keys must be nonempty valid UTF-8 strings of at most 512 UTF-8 bytes. KV also validates the combined namespace and key after framing. JSON values have a 1 MiB limit. Batches accept at most 128 entries and 2 MiB of serialized write data, including entry overhead. All inputs are validated and snapshotted before writes. A later storage failure can still leave a partially written batch. These limits apply to the built-in stores and the facade. A custom store used directly must enforce its own policy.

The Durable Object client uses a five-second I/O deadline, the current request's abort signal, a 2 MiB JSON reply limit, strict UTF-8, and required EOF. Unused and failed bodies are cancelled without waiting for producer cancellation. A write already dispatched can still commit. There is no rollback or retry. Custom cache and database calls do not inherit this deadline automatically.

Custom factories are memoized within a request by factory identity, the complete JSON store spec, and shallow environment field values/binding identities. Nested mutable environment objects are not tracked: treat bindings and credentials as stable within a request. Factories own any resources they create. The cache manager does not close them. Use scoped ORM/service ownership. `remember()` captures its selected provider before awaiting the computation.

## KV limits

Live KV allows one write per key per second. See [KV write limits and retention](https://developers.cloudflare.com/kv/api/write-key-value-pairs/) and [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/). Local tests do not prove regional propagation, production write throttling, or remote producer shutdown.

## Required guarantees and inspection

`cache.inspect()` describes the current provider without dispatching a cache
operation. Resolving a custom factory can still construct resources. Keep factory
construction free of storage operations and close owned resources yourself.

```typescript
import { cache } from '@cossackframework/framework/cache';

const capabilities = cache.inspect();
const shared = cache.require({ shared: true, strongConsistency: true });
await shared.set('settings', { theme: 'dark' }, 60_000);
```

`cache.store('name').require(...)` works the same way. Requirements are immutable
snapshots tested when each operation resolves its provider. Chaining `require`
cannot weaken an earlier requirement. Declare the same `requires` object on a
named store in `src/config/cache.ts` to apply it to every use of that declaration.
Unsupported or unknown guarantees throw `COSSACK_STORAGE_GUARANTEE_UNSUPPORTED`
before get/set/batch operations or a `remember` computation.

Supported requirements are `shared`, `durable`, `strongConsistency`,
`millisecondExpiry`, `atomicIncrement` and `operations` (a list of operation
names). Cache providers do not expose an increment operation, so none can satisfy
`atomicIncrement: true`. A DO-backed separate get/set sequence is still not atomic.

| Provider | Locality | Persistence | Consistency | Operations |
| --- | --- | --- | --- | --- |
| Memory | Process | Ephemeral | Strong within this process | All cache operations |
| KV | Shared | Durable | Eventual | All except flush |
| Durable Object | Shared | Durable | Strong within its owner | All cache operations |
| Database | Unknown | Unknown | Unknown | All cache operations |
| Undeclared custom | Unknown | Unknown | Unknown | Unknown |

Built-ins and the database adapter declare logical millisecond expiry. Database
locality, persistence and consistency depend on deployment/read settings and stay
unknown. Custom stores can declare a validated `StorageCapabilities` object on
`capabilities`. Declarations are assertions by their implementer, not remote
proof. Undeclared stores remain usable without requested guarantees.
The pure model is exported from `@cossackframework/core/storage-capabilities`
and re-exported from `@cossackframework/framework/storage-capabilities`.

Run `cossack inspect providers --json [--env staging]` for compiler-backed cache
and limiter declarations, backend profiles, units and binding diagnostics.
`cossack check providers` fails on invalid declarations or unsupported required
cache guarantees. Missing bindings on the selected default fail the command.
Missing bindings on optional unselected stores produce warnings and
`bindingStatus: "missing"`. Named-store operations still validate their binding at runtime.
Inspection never executes configuration modules or contacts providers.
It reads public selected Wrangler variables/bindings, not process/dev/secret
values. Dynamic helpers, registration candidates and default-store overrides
remain unknown. A declared built-in profile does not establish remote readiness.
