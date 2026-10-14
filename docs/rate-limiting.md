---
title: "Rate Limiting"
description: "Enforce server-side request limits with @RateLimit and the RateLimit() wrapper to protect API routes and @Server methods from abuse. Choose between in-memory, Durable Object, Redis, and KV storage backends."
---

# Rate Limiting

`RateLimit` enforces server-side request limits. A malicious client cannot bypass them, unlike client-side [`@Debounce` / `@Throttle`](/docs/tasks.md#rate-limiting-method-calls-debounce-and-throttle), which only shape the user experience. When a caller exceeds the limit, the framework responds `429 Too Many Requests` with a `Retry-After` header before your handler or server method runs.

It works in three places:

- Functional API routes: through the `RateLimit()` handler wrapper.
- Class-based API routes (`get` / `post` / …): through the `@RateLimit()` decorator.
- `@Server` component and scoped service methods: through `@RateLimit()`. The framework enforces the limit before mutation at `/crpc`, `/upload`, and correlated WebSocket action dispatch.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `window` | `number` (ms) | `60_000` | Positive safe-integer milliseconds. |
| `max` | `number` | `60` | Non-negative safe integer. Zero denies all calls. |
| `key` | `(c) => string` | user id, else IP | Returns a non-empty string identifying the caller bucket. |
| `message` | `string` | `'Too Many Requests'` | Body of the `429` response. |
| `requires` | `StorageRequirements` | `{}` | Required provider guarantees. Checked before charging a counter. |
| `backendTimeoutMs` | `number` (ms) | `5000` | Counter decision deadline, including response EOF. Positive safe integer, at most `2147483647`. |

Invalid runtime options reject before the counter is touched. Counter replies
must contain a positive safe-integer `count` and a positive safe-integer
`resetAt` in epoch milliseconds. This applies to custom stores too. Backend
errors and corrupt counters reject before the application action runs. A failed
reply can still mean the backend counted the attempt. Calls are not retried.

## Backend deadlines and cancellation

Every framework counter decision has a deadline. `backendTimeoutMs` sets it
independently of the fixed window and the server method's client timeout. A
stalled provider rejects the decision and releases the call without invoking
the application action. The framework races custom stores too, even when they
ignore cancellation. It does not retry or undo an increment already dispatched.

Built-in async stores accept `hit(key, windowMs, { signal, timeoutMs })` for
direct calls. `timeoutMs` also defaults to 5000. Custom stores receive this
optional third argument during framework enforcement. Direct calls to a custom
store must implement their own deadline and cancellation contract.

DO and Redis replies have an 8192-byte maximum (`RATE_LIMIT_RESPONSE_MAX_BYTES`).
The reader checks actual bytes, decodes strict UTF-8, and requires EOF before
using the counter. Invalid JSON, producer errors, oversized replies and stalled
bodies reject. HTTP error bodies and late replies after cancellation are
cancelled without exposing their contents. Readers release their locks. Cleanup
requests do not wait forever for a producer's cancellation callback. KV text
records are checked against the same encoded byte bound before JSON parsing.
The structural KV API still materializes the returned string.

HTTP decisions observe the request's abort signal. Correlated socket decisions observe
call cancellation and peer close/error events. After an observed abort, a late
counter result cannot invoke the action. KV skips a write if its preceding read
finishes after cancellation. A write already dispatched can still commit.
Cancellation does not stop application work that began before it was observed.
RPC deadlines reject with `COSSACK_RPC_TIMEOUT`. Observed cancellation rejects
with `COSSACK_RPC_CANCELLED`. HTTP/SSE/service calls carry their UUID
correlation ID from dispatch, including errors before response headers. IDs are
public correlation data and do not bypass authentication or route guards.

Cloudflare client disconnect notifications require
[`enable_request_signal`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests).
The deadline still applies when a runtime does not emit an abort. Cancelling a
local body or passing a signal does not guarantee that a remote producer stops,
or that a charged counter is rolled back.

## Functional API routes (handler wrapper)

TypeScript decorators cannot legally be applied to a `const` export, so functional routes use the wrapper form. Two styles exist: with options, or with defaults (`60` requests per minute):

```typescript
import { RateLimit } from '@cossackframework/core';

// With options: 3 requests per 10 seconds per caller.
export const GET = RateLimit({ window: 10_000, max: 3 }, (c) => {
    return c.json([{ id: 1, name: 'Alice' }]);
});

// With defaults (60 req/min).
export const POST = RateLimit((c) => c.json({ ok: true }));
```

The wrapper keys each budget by HTTP method and the matched route template, not
the concrete URL. A caller who requests `/api/items/1`, `/api/items/2` and so on
spends one shared budget for `/api/items/:id`. Outside a Hono router the wrapper
falls back to the request path.

## Class-based API routes & `@Server` methods (decorator)

The decorator form works on class-based API handlers (`get`/`post`/…) and
`@Server` component/service methods. Inherited limits and forwarded service
method limits use the declaring metadata. RPC rejection uses
`COSSACK_RPC_RATE_LIMITED` and the request ID. HTTP replies also include status
429 and `Retry-After`. WebSocket calls reject through their correlated error
frame and release loading. Counter-store failures reject before mutation with
a sanitized internal error. Backend deadlines and observed cancellation use the
codes described above. Calls are never retried automatically.

Component budgets belong to the canonical server route, action-owning class,
method and caller. Changing request IDs, opening another socket, or switching
between JSON, multipart and WebSocket does not restore the same budget when
the caller identity and configured store are shared. Child classes have separate
budgets from the page. Siblings of the same class share their action budget.
Explicit layout services use their owning layout and service slot, so the same
service shares its budget across pages that use that layout. These budgets do
not limit direct server-to-server calls to the original local method.

WebSocket identity comes from the runtime's verified upgrade rather than action
arguments. Anonymous Durable Object peers have no synthetic user ID, so the
default key uses the captured IP headers. Each socket supplies its own headers,
query and decoded page route params to actions and custom keys, including after
component reconstruction. Node also passes the connecting peer context
when sharing a component. It does not reuse the first connection's headers.

Cloudflare retains a request snapshot in the native WebSocket attachment.
Cookie/Authorization, common credential headers, handshake noise and internal
identity assertions are excluded. Custom application headers and query values
are retained. Do not put credentials in those values. Oversized snapshots fail
the upgrade with `COSSACK_WS_CONTEXT_TOO_LARGE` (413), rather than dropping key
inputs. These are upgrade-time facts. Session revocation/rotation still
needs application/session policy. In-memory counters remain process-local.
Shared route namespaces do not make them durable or distributed.

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

By default a caller is bucketed by the authenticated user id, falling back to the client IP. Client-supplied proxy headers are not trusted by default:

- Cloudflare Workers: `cf-connecting-ip`, which Cloudflare sets and clients cannot forge.
- Node.js: the TCP peer address. A custom Node entry records it with `setClientAddress(request, incoming.socket.remoteAddress)`, or passes `@hono/node-server`'s `{ incoming }` bindings through as `env`.
- Behind a reverse proxy: set `RATE_LIMIT_TRUST_PROXY` (or `rateLimitTrustProxy`) in the environment to the one header your proxy overwrites, for example `x-real-ip` or `x-forwarded-for`. For `x-forwarded-for` the right-most entry (appended by your proxy) is used. Only enable this when the app is reachable exclusively through that proxy.

Without any of these, anonymous callers share one `ip:anonymous` bucket. Bucket by anything else with `key`:

```typescript
RateLimit({ window: 60_000, max: 100, key: (c) => `tenant:${c.get('user').tenantId}` }, handler);
```

## Storage backends

The default store is in-memory and per-process. It is exact for a single instance (Node.js adapter, one Durable Object replica). On the edge an attacker can land on different instances, so back the limiter with shared storage there. Cossack ships three built-in stores:

| Store | Consistency | Best for |
| --- | --- | --- |
| `DurableObjectRateLimitStore` | Strong, persistent fixed window | Exact counters across Workers and DO reconstruction. |
| `RedisRateLimitStore` (Upstash) | Strong (exact) | Cross-runtime Redis. Works on Workers and Node.js. |
| `KvRateLimitStore` | Approximate | Cheap, global, "good enough" abuse protection. |

### Zero-code configuration (recommended)

You do not need to change `index.ts`. Set the `rateLimit` var in `wrangler.jsonc` plus the relevant binding/credentials, and the framework resolves the store from each request's environment. On other runtimes, or for full control, use the manual `setRateLimitStore()` calls shown under each store below.

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

> Durable Object mode requires one export. Cloudflare mandates that DO classes be exported from the Worker entry, so add `RateLimitDurableObject` to the exports in your `src/index.ts`:
> ```ts
> import { AppDurableObject } from '@cossackframework/framework/DurableObject'; // already there
> import { RateLimitDurableObject } from '@cossackframework/core';
>
> export { AppDurableObject, RateLimitDurableObject };
> ```
> (Keep `AppDurableObject`'s existing import from the framework. Only `RateLimitDurableObject` comes from core.) `"redis"` and `"kv"` modes need no code changes. Bindings and vars are enough.

Explicit configuration requires a supported non-empty mode and valid bindings
or credentials. Missing bindings, unknown modes and invalid values throw. They
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
times. Corrupt data fails rather than restoring a caller's budget.

Every built-in store requires a positive safe-integer `window` in milliseconds
that fits the timestamp range. Invalid direct DO requests return 400 with
`COSSACK_RATE_LIMIT_CONFIG_INVALID`. Direct store calls throw before contacting
the binding. All built-in direct `hit()` calls also reject invalid keys and windows.

The implementation uses the transactional key-value API supported by SQLite
and existing legacy DO storage. Create new namespaces with SQLite. Retain the
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
that environment. It does not borrow process credentials when they are absent.
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

KV has eventual consistency and no atomic increment. Under-counting across
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


## Required storage guarantees

Use `@RateLimit({ requires: { shared: true, atomicIncrement: true } })` on a
server action, or pass the same options to the functional handler wrapper.
Unsupported/unknown traits reject before a counter hit or handler invocation.
Builtin direct calls accept `hit(key, windowMs, { requires })`. Framework
component, service, HTTP/SSE, multipart and socket enforcement checks the same
requirements. Client debounce does not spend or protect server quota.

`inspectRateLimitStore(env)` describes the selected manual/configured store
without consuming quota. `cossack inspect providers --json --env staging` shows
declared backends and millisecond units without executing project modules or
exposing Redis credentials. Compiler declarations and selected Wrangler settings
do not prove process/secret overrides, remote readiness or live consistency.

| Provider | Locality | Persistence | Consistency | Atomic increment |
| --- | --- | --- | --- | --- |
| Memory | Process | Ephemeral | Strong within this process | Yes |
| KV | Shared | Durable | Eventual | No |
| Durable Object | Shared | Durable | Strong within its owner | Yes |
| Redis REST | Shared | Unknown | Strong within its EVAL owner | Yes |
| Undeclared custom | Unknown | Unknown | Unknown | Unknown |

All builtin profiles use logical millisecond expiry and expose `hit` only.
Requirements support `shared`, `durable`, `strongConsistency`, `atomicIncrement`,
`millisecondExpiry` and `operations`. Unknown cannot satisfy a requested guarantee.
Redis persistence depends on the endpoint's configuration and is not assumed.
A custom store can declare `capabilities`. Its author owns the truth of that
validated declaration. Direct custom calls own their requirement checks too.

## Resource limits

Keys must be nonblank valid UTF-8 strings of at most 512 bytes. KV/Redis frame
namespace/key pairs as JSON tuples and reject when the final encoded key exceeds
512 bytes. Namespace is a valid UTF-8 string (empty is allowed), at most 512 bytes.
Explicit null is invalid. Framework scope/caller keys use JSON tuples too, so
separators in identifiers cannot merge distinct budgets.

`InMemoryRateLimitStore(maxEntries)` defaults to 10,000 entries and accepts
integers from 1 to 100,000. At capacity it removes expired buckets, then evicts
the buckets whose window started earliest so new callers are still admitted.
A flood of distinct keys therefore cannot block every caller, but evicted
callers lose their spent budget. Size `maxEntries` above the expected number of
live callers, or use a shared store for strict limits.

Redis requires an explicit HTTPS REST URL, at most 2048 UTF-8 bytes, without
embedded credentials, query, fragment, whitespace, controls or backslashes.
The bearer token must be nonempty ASCII without whitespace/controls and at most
8192 bytes. Authenticated POST requests use manual redirect handling. Redirects
reject rather than forwarding credentials to another origin. Plain HTTP has no
local-development exception.

Ordinary requests never reset a live bucket merely to free capacity. `window`
is an integer number of milliseconds. Unknown option names throw instead of
being silently ignored.
