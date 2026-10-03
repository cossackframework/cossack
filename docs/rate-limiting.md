---
title: "Rate Limiting"
description: "Enforce server-side request limits with @RateLimit and the RateLimit() wrapper to protect API routes and @Server methods from abuse. Choose between in-memory, Durable Object, Redis, and KV storage backends."
---

# Rate Limiting

`RateLimit` enforces **server-side** request limits : real abuse protection that a malicious client cannot bypass (unlike client-side [`@Debounce` / `@Throttle`](/docs/tasks.md#rate-limiting-method-calls-debounce-and-throttle), which are UX-only). When a caller exceeds the limit, the framework responds `429 Too Many Requests` with a `Retry-After` header, **before** your handler or server method runs.

It works in three places:

- **Functional API routes** : via the `RateLimit()` handler wrapper.
- **Class-based API routes** (`get` / `post` / …) : via the `@RateLimit()` decorator.
- **`@Server` component and scoped service methods** : via `@RateLimit()`, enforced before mutation at `/crpc`, `/upload`, and correlated WebSocket action dispatch.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `window` | `number` (ms) | `60_000` | Fixed-window duration. |
| `max` | `number` | `60` | Max requests per window, per key. |
| `key` | `(c) => string` | user id, else IP | How callers are bucketed. |
| `message` | `string` | `'Too Many Requests'` | Body of the `429` response. |

## Functional API routes (handler wrapper)

TypeScript decorators cannot legally be applied to a `const` export, so functional routes use the wrapper form. Two styles : with options, or with sensible defaults (`60`/min):

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

The decorator form works on class-based API handlers (`get`/`post`/…) and
`@Server` component/service methods. Inherited limits and forwarded service
method limits use the declaring metadata. RPC rejection uses
`COSSACK_RPC_RATE_LIMITED` and the request ID. HTTP replies also include status
429 and `Retry-After`; WebSocket calls reject through their correlated error
frame and release loading. Counter-store failures reject before mutation with
a sanitized internal error. Calls are never retried automatically.

Component budgets belong to the canonical server route, action-owning class,
method and caller. Changing request IDs, opening another socket, or switching
between JSON, multipart and WebSocket does not restore the same budget when
the caller identity and configured store are shared. Child classes have separate
budgets from the page; siblings of the same class share their action budget.
Explicit layout services use their owning layout and service slot, so the same
service shares its budget across pages that use that layout. These budgets do
not limit direct server-to-server calls to the original local method.

WebSocket identity comes from the runtime's verified upgrade rather than action
arguments. Anonymous Durable Object peers have no synthetic user ID, so the
default key uses the captured IP headers. Each socket supplies its own headers,
query and decoded page route params to actions and custom keys, including after
component reconstruction. Node and Deno also pass the connecting peer context
when sharing a component; they do not reuse the first connection's headers.

Cloudflare retains a request snapshot in the native WebSocket attachment.
Cookie/Authorization, common credential headers, handshake noise and internal
identity assertions are excluded. Custom application headers and query values
are retained; do not put credentials in those values. Oversized snapshots fail
the upgrade with `COSSACK_WS_CONTEXT_TOO_LARGE` (413), rather than dropping key
inputs. Old connections without a snapshot reject actions and close with 1012
for reconnect. These are upgrade-time facts; session revocation/rotation still
needs application/session policy. In-memory counters remain process-local;
shared route namespaces do not make them durable or distributed.

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
| `DurableObjectRateLimitStore` | **Strong** (exact) | Strict/accurate limits on Cloudflare : the recommended option. |
| `RedisRateLimitStore` (Upstash) | **Strong** (exact) | Cross-runtime Redis. Works on Workers and Node.js. |
| `KvRateLimitStore` | **Approximate** | Cheap, global, "good enough" abuse protection. |

### Zero-code configuration (recommended)

You do not need to touch your `index.ts`. Set the `rateLimit` var in `wrangler.jsonc` plus the relevant binding/credentials, and the framework picks the store automatically on first use. (On other runtimes, or for full control, use the manual `setRateLimitStore()` calls shown under each store below.)

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

> **Durable Object mode requires one export.** Cloudflare mandates that DO classes be exported from the Worker entry, so add `RateLimitDurableObject` to the exports in your `src/index.ts`:
> ```ts
> import { AppDurableObject } from '@cossackframework/framework/DurableObject'; // already there
> import { RateLimitDurableObject } from '@cossackframework/core';
>
> export { AppDurableObject, RateLimitDurableObject };
> ```
> (Keep `AppDurableObject`'s existing import from the framework : only `RateLimitDurableObject` comes from core.) `"redis"` and `"kv"` modes need **no code changes at all** : bindings/vars only.

A manual `setRateLimitStore(...)` call, if present, always takes precedence over this var.

## Manual configuration

### Durable Object (strongly consistent : recommended)

Each key is routed to its own Durable Object (`idFromName(key)`), so every bucket is its own single-threaded consistency point : limits are exact across instances and regions. This is Cloudflare's recommended pattern for precise rate limiting.

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

`RedisRateLimitStore` talks to **Upstash Redis over REST** : the only Redis shape that runs on both Cloudflare Workers (no TCP sockets) and Node.js, with **zero extra dependencies**. Counting uses a single atomic `EVAL` (`INCR` + conditional `EXPIRE`), so it is exact under concurrency.

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

`KvRateLimitStore` is the cheapest global option. Expired buckets are auto-expired via KV's TTL, so there is no unbounded growth.

```ts
import { setRateLimitStore, KvRateLimitStore } from '@cossackframework/core';

export default {
    async fetch(req, env) {
        setRateLimitStore(new KvRateLimitStore(env.RATE_LIMITS));
        return app.fetch(req, env);
    },
};
```

> **KV is approximate, not exact.** KV is *eventually consistent* and has no atomic increment. Two reads can happen before either write during a concurrent burst, which can cause a temporary under-count. The limit can be exceeded by a small amount under load. For exact limits, use the Durable Object or Redis store above.

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
