---
title: "Rate Limiting"
description: "Enforce server-side request limits with @RateLimit and the RateLimit() wrapper to protect API routes and @Server methods from abuse. Choose between in-memory, Durable Object, Redis, and KV storage backends."
---

# Rate Limiting

`RateLimit` enforces **server-side** request limits — real abuse protection that a malicious client cannot bypass (unlike client-side [`@Debounce` / `@Throttle`](/docs/tasks.md#rate-limiting-method-calls-debounce-and-throttle), which are UX-only). When a caller exceeds the limit, the framework responds `429 Too Many Requests` with a `Retry-After` header, **before** your handler or server method runs.

It works in three places:

- **Functional API routes** — via the `RateLimit()` handler wrapper.
- **Class-based API routes** (`get` / `post` / …) — via the `@RateLimit()` decorator.
- **`@Server` component methods** (HTTP/SSE transport) — via the `@RateLimit()` decorator, enforced at the `/crpc` and `/upload` dispatch boundaries.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `window` | `number` (ms) | `60_000` | Fixed-window duration. |
| `max` | `number` | `60` | Max requests per window, per key. |
| `key` | `(c) => string` | user id, else IP | How callers are bucketed. |
| `message` | `string` | `'Too Many Requests'` | Body of the `429` response. |

## Functional API routes (handler wrapper)

TypeScript decorators cannot legally be applied to a `const` export, so functional routes use the wrapper form. Two styles — with options, or with sensible defaults (`60`/min):

```typescript
import { RateLimit } from '@cossackframework/core';

// With options: 3 requests per 10 seconds per caller.
export const GET = RateLimit({ window: 10_000, max: 3 }, (c) => {
    return c.json([{ id: 1, name: 'Alice' }]);
});

// With defaults (60 req/min).
export const POST = RateLimit((c) => c.json({ ok: true }));
```

## Class-based API routes & `@Server` methods (decorator)

The decorator form works anywhere the framework dispatches server-side: class-based API handlers (`get`/`post`/…) and `@Server` component methods (HTTP/SSE transport). It is enforced at the `/crpc` and API dispatch boundaries.

```typescript
import { Cossack, Page, Server, State, RateLimit } from '@cossackframework/core';

// Class-based API route
@Page()
export default class UsersApi extends Cossack {
    @RateLimit({ window: 60_000, max: 10 })
    async get() {
        return this.c.json([{ id: 1, name: 'Alice' }]);
    }
}

// A page component method called from the client over RPC
@Page({ transport: 'http' })
export default class SearchPage extends Cossack {
    @State() saveAttempts = 0;

    @Server()
    @RateLimit({ window: 10_000, max: 3 })
    async guardedSave() {
        this.saveAttempts++; // only the first 3/10s run; the rest are 429'd
    }
}
```

## How callers are identified

By default a caller is bucketed by the authenticated user id, falling back to the client IP (`cf-connecting-ip` → `x-real-ip` → `x-forwarded-for`). Bucket by anything else with `key`:

```typescript
RateLimit({ window: 60_000, max: 100, key: (c) => `tenant:${c.get('user').tenantId}` }, handler);
```

## Storage backends

The default store is **in-memory and per-process**, so it is exact for a single instance (Node.js adapter, one Durable Object replica). On the edge an attacker can land on different instances, so back the limiter with shared storage there. Cossack ships three built-in stores:

| Store | Consistency | Best for |
| --- | --- | --- |
| `DurableObjectRateLimitStore` | **Strong** (exact) | Strict/accurate limits on Cloudflare — the recommended option. |
| `RedisRateLimitStore` (Upstash) | **Strong** (exact) | Cross-runtime Redis; works on Workers + Node. |
| `KvRateLimitStore` | **Approximate** | Cheap, global, "good enough" abuse protection. |

### Zero-code configuration (recommended)

You don't need to touch your `index.ts`. Set the `rateLimit` var in `wrangler.jsonc` plus the relevant binding/credentials, and the framework picks the store automatically on first use. (On other runtimes, or for full control, use the manual `setRateLimitStore()` calls shown under each store below.)

| `rateLimit` value | What you also need |
| --- | --- |
| `"durable-object"` (alias `"do"`) | a `RATE_LIMIT_DO` DO binding + export the class (see below) |
| `"redis"` (alias `"upstash"`) | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` vars |
| `"kv"` | a `RATE_LIMITS` KV binding |
| *(unset)* | the default in-memory store (single instance only) |

```jsonc
// wrangler.jsonc — pick ONE mode:
{
  "vars": { "rateLimit": "durable-object" },
  "durable_objects": {
    "bindings": [{ "name": "RATE_LIMIT_DO", "class_name": "RateLimitDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_classes": ["RateLimitDurableObject"] }]
}
```

> **Durable Object mode requires one export.** Cloudflare mandates that DO classes be exported from the Worker entry, so add a single line to your `src/index.ts`:
> ```ts
> export { AppDurableObject, RateLimitDurableObject } from '@cossackframework/core';
> // (AppDurableObject is your existing app DO; RateLimitDurableObject is from core)
> ```
> `"redis"` and `"kv"` modes need **no code changes at all** — bindings/vars only.

A manual `setRateLimitStore(...)` call, if present, always takes precedence over this var.

## Manual configuration

### Durable Object (strongly consistent — recommended)

Each key is routed to its own Durable Object (`idFromName(key)`), so every bucket is its own single-threaded consistency point — limits are exact across instances and regions. This is Cloudflare's recommended pattern for precise rate limiting.

Register the bundled `RateLimitDurableObject` in `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "RATE_LIMIT_DO", "class_name": "RateLimitDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_classes": ["RateLimitDurableObject"] }]
}
```

Then wire it up and re-export the class from your Worker entry:

```ts
import { setRateLimitStore, DurableObjectRateLimitStore, RateLimitDurableObject } from '@cossackframework/core';

export { RateLimitDurableObject };

export default {
    async fetch(req, env) {
        setRateLimitStore(new DurableObjectRateLimitStore(env.RATE_LIMIT_DO));
        return app.fetch(req, env);
    },
};
```

### Redis / Upstash (strongly consistent, cross-runtime)

`RedisRateLimitStore` talks to **Upstash Redis over REST** — the only Redis shape that runs on both Cloudflare Workers (no TCP sockets) and Node.js, with **zero extra dependencies**. Counting uses a single atomic `EVAL` (`INCR` + conditional `EXPIRE`), so it is exact under concurrency.

Configure the credentials as env vars (in `wrangler.jsonc` `vars`, or your host's env):

```jsonc
{
  "vars": {
    "UPSTASH_REDIS_REST_URL": "https://xxxxx.upstash.io",
    "UPSTASH_REDIS_REST_TOKEN": "AY...="
  }
}
```

```ts
import { setRateLimitStore, redisRateLimitStoreFromEnv } from '@cossackframework/core';

export default {
    async fetch(req, env) {
        setRateLimitStore(redisRateLimitStoreFromEnv(env));
        return app.fetch(req, env);
    },
};
// or, anywhere: new RedisRateLimitStore({ url, token })
```

### Cloudflare KV (approximate)

`KvRateLimitStore` is the cheapest global option. Expired buckets are auto-expired via KV's TTL, so there's no unbounded growth.

```ts
import { setRateLimitStore, KvRateLimitStore } from '@cossackframework/core';

export default {
    async fetch(req, env) {
        setRateLimitStore(new KvRateLimitStore(env.RATE_LIMITS));
        return app.fetch(req, env);
    },
};
```

> **KV is approximate, not exact.** KV is *eventually consistent* and has no atomic increment, so a concurrent burst from one caller can briefly under-count (two reads land before either write). The limit may be exceeded by a small margin under load. If correctness matters, prefer the Durable Object or Redis store above.

### Custom store

Need D1, a self-hosted Redis, or something else? Implement the `RateLimitStore` interface (a single `hit` method) and register it:

```ts
import type { RateLimitStore } from '@cossackframework/core';

class MyStore implements RateLimitStore {
    async hit(key: string, windowMs: number) {
        // return { count, resetAt }
    }
}
setRateLimitStore(new MyStore());
```
