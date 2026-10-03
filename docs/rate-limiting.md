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
| `window` | `number` (ms) | `60_000` | Positive safe-integer milliseconds. |
| `max` | `number` | `60` | Non-negative safe integer; zero denies all calls. |
| `key` | `(c) => string` | user id, else IP | Returns a non-empty string identifying the caller bucket. |
| `message` | `string` | `'Too Many Requests'` | Body of the `429` response. |

Invalid runtime options reject before the counter is touched. Counter replies
must contain a positive safe-integer `count` and a positive safe-integer
`resetAt` in epoch milliseconds. This applies to custom stores too. Backend
errors and corrupt counters reject before the application action runs. A failed
reply can still mean the backend counted the attempt; calls are not retried.

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
| `DurableObjectRateLimitStore` | **Strong**, persistent fixed window | Exact counters across Workers and DO reconstruction. |
| `RedisRateLimitStore` (Upstash) | **Strong** (exact) | Cross-runtime Redis. Works on Workers and Node.js. |
| `KvRateLimitStore` | **Approximate** | Cheap, global, "good enough" abuse protection. |

### Zero-code configuration (recommended)

You do not need to touch your `index.ts`. Set the `rateLimit` var in `wrangler.jsonc` plus the relevant binding/credentials, and the framework resolves the store from each request’s environment. (On other runtimes, or for full control, use the manual `setRateLimitStore()` calls shown under each store below.)

| `rateLimit` value | What you also need |
| --- | --- |
| `"durable-object"` (alias `"do"`) | a `RATE_LIMIT_DO` DO binding + export the class (see below) |
| `"redis"` (alias `"upstash"`) | `UPSTASH_REDIS_REST_URL` var + `UPSTASH_REDIS_REST_TOKEN` secret |
| `"kv"` | a `RATE_LIMITS` KV binding |
| *(unset)* | the default in-memory store (single instance only) |

```jsonc
// wrangler.jsonc — pick ONE mode:
{
  "vars": { "rateLimit": "durable-object" },
  "durable_objects": {
    "bindings": [{ "name": "RATE_LIMIT_DO", "class_name": "RateLimitDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimitDurableObject"] }]
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

Explicit configuration requires a supported non-empty mode and valid bindings
or credentials. Missing bindings, unknown modes and invalid values throw; they
never fall back to memory. A repaired environment can serve its next request.
Unchanged environment/binding/credential selections reuse a store. Changing a
selection does not retarget another request's already selected store. An
unconfigured request uses the process-local memory default and never inherits a
previous request's configured backend.

`setRateLimitStore(...)` is an intentional process-wide override. Configure it
once during setup for an application with one fixed backend. It overrides every
environment selection. Use automatic environment selection when serving multiple
environments or bindings in one process.

## Manual configuration

### Durable Object (strongly consistent : recommended)

Each key is routed to its own Durable Object (`idFromName(key)`). The counter
and reset deadline commit together in a storage transaction. Eviction and
reconstruction preserve a spent budget. New hits within the active window keep
its original deadline, even if the requested duration changes. At the deadline,
the next hit starts a new window with the requested duration.

An alarm removes the expired record. Delayed alarms cannot erase a newer
window, and expiry does not depend on alarm delivery. Storage or alarm-write
failures reject the hit before the application action runs. Persisted records
and DO replies require positive safe-integer counts and epoch-millisecond reset
times; corrupt data fails rather than restoring a caller's budget.

Every built-in store requires a positive safe-integer `window` in milliseconds
that fits the timestamp range. Invalid direct DO requests return 400 with
`COSSACK_RATE_LIMIT_CONFIG_INVALID`; direct store calls throw before contacting
the binding. All built-in direct `hit()` calls also reject invalid keys and windows.

The implementation uses the transactional key-value API supported by SQLite
and existing legacy DO storage. Create new namespaces with SQLite; retain the
migration history of existing namespaces. See [Cloudflare storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction).

Register the bundled `RateLimitDurableObject` in `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "RATE_LIMIT_DO", "class_name": "RateLimitDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimitDurableObject"] }]
}
```

Export the class from the Worker entry as shown above. For a process with one
fixed namespace, configure an override during application setup:

```ts
import { setRateLimitStore, DurableObjectRateLimitStore, type RateLimitDurableObjectNamespace } from '@cossackframework/core';

export function configureLimiter(bindings: { RATE_LIMIT_DO: RateLimitDurableObjectNamespace }) {
    setRateLimitStore(new DurableObjectRateLimitStore(bindings.RATE_LIMIT_DO));
}
```

### Redis / Upstash (strongly consistent, cross-runtime)

`RedisRateLimitStore` uses Upstash Redis over REST on Cloudflare Workers and Node.js with zero extra dependencies. Counting uses a single atomic `EVAL` (`INCR` + conditional `PEXPIRE`), so it is exact under concurrency.

Set the REST URL in `wrangler.jsonc` and provide the token as a Worker secret:
`pnpm exec wrangler secret put UPSTASH_REDIS_REST_TOKEN`. Local development can
read the token from `.dev.vars`. Other runtimes can use their host environment.

```jsonc
{
  "vars": {
    "UPSTASH_REDIS_REST_URL": "https://xxxxx.upstash.io"
  }
}
```

```ts
import { setRateLimitStore, redisRateLimitStoreFromEnv } from '@cossackframework/core';

// One fixed backend, configured once during application setup.
export function configureLimiter(env: Record<string, string | undefined>) {
    setRateLimitStore(redisRateLimitStoreFromEnv(env));
}
// Or construct a store directly: new RedisRateLimitStore({ url, token }).
```

Redis expiry uses milliseconds without rounding to whole seconds. Missing,
malformed or negative PTTL values reject instead of creating a guessed deadline.
The explicit `redisRateLimitStoreFromEnv(env)` helper requires credentials from
that environment; it does not borrow process credentials when they are absent.
See [Redis PEXPIRE](https://redis.io/docs/latest/commands/pexpire/) and
[PTTL](https://redis.io/docs/latest/commands/pttl/).

### Cloudflare KV (approximate)

KV is a shared approximate store. Its storage TTL is at least 60 seconds, while
the record's millisecond deadline controls the logical fixed window. Shorter
windows reset at that deadline even while the old record remains in storage.
Corrupt records reject without overwriting them or restoring a caller's budget.

```ts
import { setRateLimitStore, KvRateLimitStore, type RateLimitKvNamespace } from '@cossackframework/core';

// One fixed binding, configured once during application setup.
export function configureLimiter(bindings: { RATE_LIMITS: RateLimitKvNamespace }) {
    setRateLimitStore(new KvRateLimitStore(bindings.RATE_LIMITS));
}
```

KV has eventual consistency and no atomic increment; under-counting across
regions has no strict bound. It also permits only one write per key per second.
Write failures reject the action, so this backend is unsuitable for burst
traffic that needs reliable counting. Use Durable Objects or Redis for that
workload. See [Cloudflare KV write limits](https://developers.cloudflare.com/kv/api/write-key-value-pairs/).

### Custom store

Need D1, a self-hosted Redis, or something else? Implement the `RateLimitStore` interface (a single `hit` method) and register it:

```ts
import { setRateLimitStore, type RateLimitStore } from '@cossackframework/core';

// Supply a store whose hit() increments a real fixed-window counter.
export function configureLimiter(store: RateLimitStore) {
    setRateLimitStore(store);
}
```
