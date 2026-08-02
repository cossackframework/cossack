# Cache (`cache`)

Cossack ships a **server-side** cache with a Laravel-inspired API and a config-driven store system. Declare stores in `src/config/cache.ts`, then read/write expensive results — API responses, database queries, computed data — cheaply until they expire.

> **Before you hand-roll an in-memory `Map` or a custom KV wrapper** — Cossack has a built-in `cache` facade. Use it inside `@Server()` methods.

## Quick start

```typescript
import { cache } from '@cossackframework/framework/cache';
import { Product } from '@/models/Product';

// Read-through cache: compute + store on a miss, return the stored value on a hit.
const products = await cache.remember('products:featured', 600, () =>
    Product.find({ where: { featured: true } }),
);

// Explicit set / get (TTLs are in SECONDS).
await cache.set<User>('user:1', user, 300);
const user = await cache.get<User>('user:1'); // Promise<User | undefined>

// Use a specific named store.
await cache.store('kv').set('key', 'value', 60);
```

**TTLs are in seconds throughout.** There is no `cache(...)` function call — `cache` is a facade object; the read-through method is `cache.remember(key, ttl, fn)`.

## API

| Method | Signature | Description |
|---|---|---|
| `get<T>(key)` | `(key: string) => Promise<T \| undefined>` | Read a value. Returns `undefined` on miss. |
| `set<T>(key, value, ttl?)` | `(key, value, ttlSeconds?) => Promise<void>` | Store a value. TTL in seconds; falls back to the store's default. |
| `has(key)` | `(key: string) => Promise<boolean>` | Check existence. |
| `delete(key)` / `forget(key)` | `(key: string) => Promise<void>` | Delete a key (`forget` is an alias). |
| `flush()` | `() => Promise<void>` | Clear the entire current store. |
| `remember<T>(key, ttl, fn)` | `(key, ttlSeconds, fn) => Promise<T>` | Read-through: return cached hit, or compute `fn()`, store it, and return it. |
| `getMany<T>(keys)` / `setMany<T>(entries, defaultTtl?)` / `deleteMany(keys)` | — | Batch operations. |
| `store(name)` | `(name: string) => StoreBoundCache` | Switch to a named store. |
| `setDefaultStore(store)` | `(name: string) => void` | Change the default store. |
| `extendCacheDriver(driver, factory)` | `(name, factory) => void` | Register a custom backend. |

## The constraint: server-only

`cache` lives in `@cossackframework/framework/cache` and is **server-only** — every call must live inside a `@Server()` method (or server middleware). The client bundle has no database, no KV binding, and no config system. Do not call `cache` from `@Client()` / `@Shared()` / `render()`.

```typescript
@Server()
async loadDashboard() {
    // ✅ inside a @Server() method
    this.stats = await cache.remember('dashboard:stats', 60, () => computeStats());
}
```

## Configuration

Stores are declared in `src/config/cache.ts` — a factory evaluated per request so it can read environment bindings:

```typescript
// src/config/cache.ts
import type { EnvFunction } from '@cossackframework/framework/config';
import type { CacheConfig } from '@cossackframework/framework/cache';

export default ({ env }: { env: EnvFunction }): CacheConfig => ({
    default: env('CACHE_DRIVER', 'memory'),
    stores: {
        memory: { driver: 'memory' },
        kv: { driver: 'kv', binding: 'CACHE' },
        'durable-object': { driver: 'durable-object', binding: 'CACHE_DO' },
        database: { driver: 'database' },
    },
});
```

`cache.get()` uses `default`; `cache.store('kv')` uses a named store.

## Which backend should I use?

For most apps, **KV is the recommended default** — it's the natural fit for read-through caching of expensive results:

- **Eventual consistency is harmless.** `remember()` is idempotent — if two isolates both miss and recompute, the result is the same. Staleness is already bounded by your TTL.
- **Native TTL = auto garbage collection.** KV's `expirationTtl` reaps expired keys for you — no unbounded growth, no `purgeExpired()` chore.
- **It offloads the database.** A KV hit never touches D1/Turso; an ORM-backed cache hit still does.
- **Globally fast reads** from the edge region nearest the reader.

Reach for the others when:
- **`memory`** — dev/test, or single-isolate ephemeral caches that don't need to survive restarts.
- **`durable-object`** — you need strong consistency or per-room/per-session cache isolation.
- **`database`** — co-located cache data, registered with `createDatabaseCacheStore()` in `src/middlewares/orm.ts`.

## Real example

The framework's demo at `packages/framework/src/pages/examples/cache/index.ts` shows `cache.set()` / `cache.get()` inside a `@Server()` method, with `this.loading['runCacheTest']` driving the button's disabled state. For the full config reference, custom store implementation (`CacheStore` interface), and backend details, see `docs/cache.md`.
