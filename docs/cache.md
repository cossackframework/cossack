---
title: "Cache"
description: "Server-side caching with a Laravel-inspired API. Configure stores in config/cache.ts — in-memory, KV, Durable Object, or database backends — and read/write with cache.get(), cache.remember(), and cache.store()."
---

# Cache

Cossack's `cache` is a **server-side** cache with a Laravel-inspired API and a config-driven store system. Declare your stores in `config/cache.ts`, then read/write expensive results — API responses, database queries, computed data — cheaply until they expire.

```typescript
import { cache } from '@cossackframework/framework/cache';

// Store a value for 5 minutes (TTLs are in seconds).
await cache.set<User>('user:1', user, 300);

// Read it back (typed).
const user = await cache.get<User>('user:1'); // Promise<User | undefined>

// Read-through cache: compute + store on a miss.
const settings = await cache.remember('settings', 600, () => loadSettings());

// Use a specific named store.
await cache.store('kv').set('key', 'value', 60);
```

TTLs are in **seconds** throughout.

## Configuration

Cache is configured in `src/config/cache.ts` — a factory evaluated per request (so it can read environment bindings). Declare a `default` store plus a `stores` map:

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

`cache.get()` uses `default`; `cache.store('kv')` uses a named store. Read any value with `config('cache.default')`.

## Which backend should I use?

For most apps, **KV is the recommended default**. It's the natural fit for the most common cache pattern — read-through caching of expensive results:

```ts
const products = await cache.remember('products:featured', 600, () =>
    db().selectFrom('products').where('featured', '=', 1).selectAll().execute(),
);
```

Why KV fits `remember()` so well:

- **Eventual consistency is harmless.** `remember()` is idempotent — if two instances both miss and both recompute, the result is the same. Staleness is already bounded by your TTL.
- **Native TTL = auto garbage collection.** KV's `expirationTtl` reaps expired keys for you — no unbounded growth, no `purgeExpired()` chore.
- **It offloads the database.** A KV hit never touches D1/Turso — the whole point of caching a query result. (`DatabaseCacheStore` does *not* give you this — a cache read still hits the database.)
- **Globally fast reads.** KV is served from the edge region nearest the reader.
- **Simplest persistent option.** One binding + a line in `config/cache.ts` — no entry-point code, no DO class export, no migration.

### Reach for the others when…

| If you need… | Use |
| --- | --- |
| Strong consistency (a write visible to the next read, everywhere) | Durable Object |
| A TTL under 60 seconds (KV clamps sub-minute TTLs up) | Durable Object or database |
| Atomic read-modify-write (counters, locks) | Durable Object |
| Cache data co-located with your app data, DB load acceptable | database |
| Just local development / a single instance | `memory` (the default) |

## Storage backends

| Store | Consistency | Best for |
| --- | --- | --- |
| `memory` (default) | Per-process | Dev, single-instance apps. Zero config. |
| `durable-object` | **Strong** | Persistent, strongly-consistent cache on Cloudflare. |
| `kv` | **Eventual** | Cheap, global, "good enough" caching. |
| `database` | **Strong** | Cache that lives alongside your app's database (D1/Turso). |

### In-memory (default)

Works with zero configuration. Per-process — a single Node.js instance or one Workers isolate. Not shared across instances or regions.

```typescript
export default ({ env }) => ({
    default: 'memory',
    stores: { memory: { driver: 'memory' } },
});
```

### Cloudflare KV (recommended for most apps)

The cheapest global option, and the natural fit for read-through caching. Expired keys are garbage-collected via KV's TTL, so there's no unbounded growth.

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

> **KV is approximate.** KV is *eventually consistent*: writes take up to ~60s to propagate globally, and there is no atomic read-modify-write. A value written on one instance may not be visible to a read on another instance immediately. This is fine for most cache use cases (a stale or missing entry is simply recomputed); if you need strict consistency, use the Durable Object store.
>
> KV enforces a minimum TTL of 60 seconds; sub-minute TTLs are clamped up. `cache.flush()` throws on the KV store (KV has no bulk-delete-by-prefix).

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

> **Durable Object mode requires one export.** Cloudflare mandates that DO classes be exported from the Worker entry, so add `CacheDurableObject` to the exports in your `src/index.ts`:
> ```ts
> import { AppDurableObject } from '@cossackframework/framework/DurableObject'; // already there
> import { CacheDurableObject } from '@cossackframework/framework';
>
> export { AppDurableObject, CacheDurableObject };
> ```

### Database (strongly consistent)

`DatabaseCacheStore` stores cache data in your app's database (D1 or Turso) via the per-request `db()` client. It's part of `@cossackframework/database` — run `cossack add database` first if you haven't.

**1. Generate the `cache_items` table migration:**

```sh
cossack cache:make-table
cossack migration up
```

**2. Register the driver** (once, at startup — e.g. in `src/index.ts`):

```ts
import { extendCacheDriver } from '@cossackframework/framework/cache';
import { DatabaseCacheStore } from '@cossackframework/database';

extendCacheDriver('database', () => new DatabaseCacheStore());
```

**3. Declare the store** in `config/cache.ts`:

```typescript
export default ({ env }) => ({
    default: 'database',
    stores: { database: { driver: 'database' } },
});
```

`DatabaseCacheStore()` resolves the per-request `db()` client lazily on each operation, so a single instance serves every request. Expired rows are reaped lazily on read; call `store.purgeExpired()` opportunistically to reclaim space.

## API

| Method | Description |
| --- | --- |
| `cache.get<T>(key)` | Read a value from the default store. Returns `undefined` if missing or expired. |
| `cache.set<T>(key, value, ttlSeconds?)` | Write a value. TTL defaults to 3600s (1 hour). |
| `cache.has(key)` | `true` if the key exists and hasn't expired. |
| `cache.delete(key)` / `cache.forget(key)` | Remove a key (Laravel naming). |
| `cache.flush()` | Remove every key. |
| `cache.remember<T>(key, ttlSeconds, fn)` | Return the cached value on a hit, otherwise call `fn`, store its result with the TTL, and return it. |
| `cache.getMany<T>(keys)` | Read several keys at once. |
| `cache.setMany<T>(entries, defaultTtl?)` | Write several `{ key, value, ttlSeconds? }` entries. |
| `cache.deleteMany(keys)` | Remove several keys. |
| `cache.store(name)` | Access a named store declared in `config/cache.ts`. |
| `cache.setDefaultStore(store)` | Override the default store directly (advanced). |
| `extendCacheDriver(driver, factory)` | Register a custom driver (e.g. Redis). |

## Custom stores

Need Redis, R2, or something else? Implement the `CacheStore` interface and register it as a driver:

```ts
import type { CacheStore } from '@cossackframework/framework/cache';
import { extendCacheDriver } from '@cossackframework/framework/cache';

class RedisCacheStore implements CacheStore {
    async get<T>(key: string): Promise<T | undefined> { /* ... */ }
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> { /* ... */ }
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

`cache.remember()` is the idiomatic way to cache an expensive operation. It returns the cached value on a hit, or computes, stores, and returns it on a miss:

```ts
const products = await cache.remember('products:featured', 600, () =>
    db().selectFrom('products').where('featured', '=', 1).selectAll().execute(),
);
```

### Multiple stores

Use `cache.store()` to target a specific named store (e.g. a hot in-memory store alongside a persistent KV store):

```ts
// Fast per-process cache for the request lifecycle.
await cache.store('memory').set('computed', expensive(), 10);
// Persistent cache across instances.
await cache.store('kv').set('products', list, 3600);
```
