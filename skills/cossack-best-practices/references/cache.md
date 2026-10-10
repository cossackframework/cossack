# Cache (`cache`)

Cossack ships a **server-side** cache with a Laravel-inspired API and a config-driven store system. Declare stores in `src/config/cache.ts`, then read/write expensive results — API responses, database queries, computed data — cheaply until they expire.

> **Before you hand-roll an in-memory `Map` or a custom KV wrapper** — Cossack has a built-in `cache` facade. Use it inside `@Server()` methods.

## Quick start

```typescript
import { cache } from '@cossackframework/framework/cache';
import { Product } from '@/models/Product';

// Read-through cache: compute + store on a miss, return the stored value on a hit.
const products = await cache.remember('products:featured', 600_000, () =>
    Product.find({ where: { featured: true } }),
);

// Explicit set / get (TTLs are in MILLISECONDS).
await cache.set<User>('user:1', user, 300_000);
const user = await cache.get<User>('user:1'); // Promise<User | undefined>

// Use a specific named store.
await cache.store('kv').set('key', 'value', 60_000);
```

**TTLs are in milliseconds throughout.** There is no `cache(...)` function call — `cache` is a facade object; the read-through method is `cache.remember(key, ttl, fn)`.

## API

| Method | Signature | Description |
|---|---|---|
| `get<T>(key)` | `(key: string) => Promise<T \| undefined>` | Read a value. Returns `undefined` on miss. |
| `set<T>(key, value, ttl?)` | `(key, value, ttlMs?) => Promise<void>` | Store a value. TTL in integer milliseconds; facade `set()` defaults to 3_600_000 ms. |
| `has(key)` | `(key: string) => Promise<boolean>` | Check existence. |
| `delete(key)` / `forget(key)` | `(key: string) => Promise<void>` | Delete a key (`forget` is an alias). |
| `flush()` | `() => Promise<void>` | Clear the entire current store. |
| `remember<T>(key, ttl, fn)` | `(key, ttlMs, fn) => Promise<T>` | Read-through: return cached hit, or compute `fn()`, store it, and return it. |
| `getMany<T>(keys)` / `setMany<T>(entries, defaultTtlMs?)` / `deleteMany(keys)` | — | Batch operations. |
| `store(name)` | `(name: string) => StoreBoundCache` | Switch to a named store. |
| `setDefaultStore(store)` | `(store: CacheStore) => void` | Change the default store. |
| `extendCacheDriver(driver, factory)` | `(name, factory) => void` | Register a custom backend. |

## The constraint: server-only

`cache` lives in `@cossackframework/framework/cache` and is **server-only** — every call must live inside a `@Server()` method (or server middleware). The client bundle has no database, no KV binding, and no config system. Do not call `cache` from `@Client()` / `@Shared()` / `render()`.

```typescript
@Server()
async loadDashboard() {
    // ✅ inside a @Server() method
    this.stats = await cache.remember('dashboard:stats', 60_000, () => computeStats());
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

Use KV for recomputable data when stale reads and misses are acceptable. Its logical expiration is checked in milliseconds; native retention cleans up expiring records later. It has no atomic increments and production writes to one key are limited to one per second.

`remember()` does not combine concurrent computations or lock a key. Use a side-effect-free function. A cache `get()` followed by `set()` is not an atomic counter, including in the DO backend.

- **`memory`**: process-local data, bounded by entry count and serialized bytes.
- **`durable-object`**: one shared consistent owner; this implementation routes the whole cache to `idFromName('default')`, with no per-room/session isolation option.
- **`database`**: cache alongside app data; consistency depends on the database and read configuration. Register `createDatabaseCacheStore()` from `src/middlewares/orm.ts`.

## Real example

The framework's demo at `packages/framework/src/pages/examples/cache/index.ts` shows `cache.set()` / `cache.get()` inside a `@Server()` method, with `this.loading['runCacheTest']` driving the button's disabled state. For the full config reference, custom store implementation (`CacheStore` interface), and backend details, see `docs/cache.md`.

Cache TTLs use integer milliseconds (`ttlMs`). KV logical expiry is checked separately from native retention; KV reads can still be stale. `remember()` allows duplicate computations and provides no lock. Use side-effect-free computations. Custom factories belong to the current request; use scoped resource ownership. Built-in memory stores are bounded by count and serialized bytes. For limits and binding identity rules, read `docs/cache.md`.
