# SSE Transport and Distributed Scope Coordination

This document describes the SSE transport backends, the coordinator Durable
Object, shared-state semantics, and the runtime contract for Node.
It was written by GLM on 2026-10-02 and updated by Codex after reviewing the
implementation. See the [Codex review](./release-0.9.0.md)
for final verification and release scope.

Related documents: [docs/sse.md](../docs/sse.md) (user-facing guide),
[specs/architecture.md](./architecture.md), [specs/service.md](./service.md).

## Overview

`@Page({ transport: 'sse' })` pages push state updates to browsers over a
long-lived SSE connection (`/sse/:componentRouteId`). Client actions are
ordinary `/crpc` POSTs. Two backends implement the same endpoint contracts:

| Runtime | Backend | Selection |
| --- | --- | --- |
| Cloudflare Workers | `SseDurableObject` namespace via the `COSSACK_SSE` binding | Binding present in `env`; also provides durable one-use claims for signed flash cookies. |
| Node.js | Process-local in-memory store in `framework/src/transports/sse.ts` | No binding and not running under Workers. |
| Cloudflare without the binding | None | `COSSACK_SSE_BINDING_MISSING` diagnostic (HTTP 500) for `/crpc`, `/sse`, and SSR; valid flash reads fail closed with HTTP 503 and flash writes require the binding. Process-local state must not become the Cloudflare fallback. |

Cloudflare detection uses `navigator.userAgent === 'Cloudflare-Workers'` (the
documented Workers identity). Binding presence alone selects the coordinator,
which keeps the backend unit-testable with a structural fake.

## Live subscription authorization

`framework/realtime-context.ts` owns a structural server-only identity protocol.
Auth exposes optional `AuthRealtimeProvider` capture/validate callbacks. The
scaffold captures `{ reference, fingerprint }`, with an independent public UUID
and SHA-256 of the current random token. Expiry, auth purpose, owner and token
fingerprint must still match storage; auth resolves user/roles afresh. No token
or fingerprint enters hydration, coordinator public state or browser frames.

Both subscription backends use one pull-driven stream. Each delivery, including
replay and heartbeat, re-enters fresh request/config/ORM scopes and global plus
inherited guard middleware. Decoded params, request bindings and the captured
locale are available. Credential/assertion headers are removed. Response header
writes are prohibited. The original owner and computed scope must still match.
Denial or validation failure emits only the fixed `authorization-error` event
and closes. Core retires that EventSource before handling any later callback,
sets fixed closed feedback and stops retries. Explicit reload uses the current
cookie. Missing authenticated capture support returns coded HTTP 409 at open.

Authorization runs once per delivered batch, not per frame: the initial
replay (events + snapshot + `connected`) is one batch and each poll result is
one batch. A batch still draining (slow reader) 5 s after its check is checked
again before the next frame, and every heartbeat is checked. So replaying 128
events costs one middleware pass, and a revocation stops delivery at the next
batch, heartbeat, or 5 s boundary. Checks and revocation are not one
transaction: frames of an already-validated batch can be in flight after
revocation. Idle checks occur before the 15-second heartbeat with reader
demand; backpressure and slow storage prevent a strict elapsed-time guarantee. An action that already
started can also retain its request identity. WebSocket delivery/action freshness
is still open RT-11 work. See the [provider and migration contract](../docs/sse.md#session-changes-on-an-open-subscription).

## Package and import boundaries

- `packages/framework/src/SseDurableObject.ts` is the only module that imports
  `cloudflare:workers`. It is published as the Cloudflare-only entry
  `@cossackframework/framework/SseDurableObject` and must be re-exported from
  the application Worker entry (Cloudflare requires DO classes in the entry's
  export graph).
- `framework/src/transports/sse.ts` and `framework/src/router.ts` are neutral.
  They reach the coordinator only through `env.COSSACK_SSE` (a structural
  `SseCoordinatorStub` contract) and never import native Workers modules, so
  the Node and browser import graphs stay clean. `pnpm audit:bundle`
  covers this boundary.
- The scaffold generates the binding with a `new_sqlite_classes` migration in
  `wrangler.jsonc` and the Worker entry export in `src/index.ts`.

The same namespace also owns flash replay claims. The middleware names one
additional DO per signed nonce as `cossack.flash.v1:<nonce>`, separate from the
JSON tuple names used by SSE scopes. `claimFlash(nonce, expiresAt)` validates
the token shape and future expiry, schedules expiry cleanup, and performs a
unique SQLite insert with `RETURNING` so concurrent page requests have exactly
one winner. The alarm deletes the expired claim. Generated Cloudflare projects
already include the required `COSSACK_SSE` binding and SQLite migration.

## The coordinator Durable Object

One DO instance per scope, named by the collision-safe tuple
`JSON.stringify([componentRouteId, scopeKey])`. Storage is SQLite:

- `snapshot` (single row): authoritative `state` JSON plus the latest event
  `cursor`.
- `events`: append-only log of `{cursor, event, data, bytes}`, bounded to 128
  rows and 1 MiB total. Subscribers with expired cursors resynchronize from the
  snapshot instead of observing gaps.

RPC surface:

| Method | Behavior |
| --- | --- |
| `initialize(state)` | `INSERT OR IGNORE`; returns `{state, cursor, fresh}`. First initialization wins; later SSR never resets shared state. |
| `currentState()` | Snapshot or `null` before initialization (used by the subscription's cold start). |
| `updates(after, waitMs?, waiterId?)` | Events after a cursor plus a `resync` flag (`after` ahead of the snapshot or behind the pruned history). With `waitMs > 0` and nothing new, the call is a long-poll: it is held until an event is appended, `cancelWait(waiterId)`, or the wait (capped at 25 s) elapses, then returns. Waiters are bounded (2,048 per scope); overflow returns at once with `retryAfterMs`. A duplicate `waiterId` releases the previous waiter. |
| `cancelWait(waiterId)` | Releases a held long-poll when its subscriber disconnects. |
| `publish(state, requestId?)` | Appends a correlated `state-update` event and replaces the plain public snapshot. The optional request ID is event metadata only. |
| `broadcast(event, data)` | Appends an `event`/`client-action` event without changing the snapshot. Reserved `state-update` entries replace the snapshot; the runtime does not send partial state through this method. |
| `execute(action)` | Serializes actions per scope; see below. |
| `claimFlash(nonce, expiresAt)` | Atomically inserts a signed flash nonce only in the matching `cossack.flash.v1:<nonce>` object; `RETURNING` selects one winner, and its alarm deletes the claim at expiry. |

`execute` holds an explicit per-scope serialization slot (a promise chain —
`blockConcurrencyWhile` is used only for table initialization in the
constructor). The action callback executes in the calling Worker via RPC with
its original `AsyncLocalStorage` snapshot, so request middleware, layout DI,
ORM scope, config, locale, and auth contexts remain active. Response handling:

- RPC-stream responses (`application/x-cossack-rpc+ndjson`, without the reserved
  native-response marker) are re-emitted
  frame by frame. The coordinator publishes `scopeState` when supplied for a
  child target, otherwise `state`. Protocol parsing requires both supplied
  state objects to be valid; malformed frames fail with
  `COSSACK_RPC_STREAM_INVALID` and release the slot.
- Ordinary JSON results, `{_cossack_redirect}` bodies, custom `Response`
  objects, and error statuses preserve their body and headers. The callback
  publishes page state before returning an ordinary result. All response
  bodies hold the serialization slot until EOF, failure, or cancellation;
  a Response without a body releases it immediately.
- The router wraps custom component/service Response bodies in their original
  request context and retains middleware/DI lifetime through body completion.
  Native responses marked `X-Cossack-Rpc-Response: native` remain opaque even
  when their MIME type matches RPC NDJSON; the coordinator must check this
  marker before parsing protocol frames. Context and native-response cookies
  are preserved, including redirects and methods that set cookies before
  returning a lazy generator. Cookie writes inside that generator occur after
  headers commit and reject with `COSSACK_RESPONSE_HEADERS_COMMITTED`. Session
  recipes, sensitive old-input handling, rotation and concurrency remain RT-11.
- The slot releases when the stream finishes, fails, or the caller cancels the
  response body. Cancellation propagates from the browser through the Worker
  (`c.req.raw.signal` is wired to `response.body.cancel()` in the router) and
  through RPC stream teardown.
- A caller that disconnects **while queued** cannot cancel its callback on the
  tested runtime baseline (AbortSignal-over-RPC requires the experimental
  `abort_signal` compatibility flag, unavailable in wrangler 4.114.0). Such an
  action runs at most once and its result is discarded. Actions are never
  replayed; the framework does not claim exactly-once external side effects.
- Pending actions are bounded (32 per scope; HTTP 429 `COSSACK_SSE_BUSY`).
- A DO restart mid-action breaks the in-flight response (and its in-memory
  serialization queue resets) but preserves the SQLite snapshot and log;
  subsequent actions serialize on a fresh queue.

## Shared-state semantics

- The authoritative scope state is the public state of the **page root**.
  A child addressed by RPC `target` has separate target-local state. Child
  generator frames carry target `state` for their caller and page `scopeState`
  for the coordinator. Child actions cannot replace the page snapshot.
  Hydration applies only declared/public keys of the receiving component.
- Child components and services not addressed by an action keep request-local
  state. Services declared on a parent layout are injected into the page and
  their `@State` keys mirror into the page's public state, which then
  round-trips through the coordinator snapshot.
- SSR initializes the scope with the rendered page's public state
  (first-write-wins). When the scope already exists, SSR hydrates the
  authoritative snapshot so the HTML renders shared state; it never overwrites
  the snapshot.
- `/crpc` hydrates the page from the coordinator snapshot before rendering
  and resolving its child target. Browser state applies only to child targets;
  a stale tab cannot overwrite page shared state.
- `CoordinatorSseRuntime` forwards event/client-action broadcasts and awaits
  them before action/frame completion. Deferred partial state broadcasts are
  ignored: complete page snapshots are committed by the action result or its
  frames while the action owns the serialization slot.

## Subscription endpoint

`/sse/:componentRouteId` re-evaluates the scope with the live authenticated
request (a mismatched `scopeKey` is rejected with 403), then:

1. Reads the cursor from `Last-Event-ID` (sent automatically by `EventSource`
   on reconnect) or the `cursor` query parameter; invalid cursors are rejected
   with 400.
2. Cold-starts a missing scope using the actual layout service ancestry and
   a component with `skipInit: true`. It initializes the scope and awaits
   disposal of temporary components/services.
3. Replays retained events after the supplied cursor in increasing ID order,
   then sends the current `state-update` snapshot and `connected`. Sending the
   latest snapshot ID first would acknowledge broadcasts before delivery.
4. Delivers one frame per reader pull. While reader demand is pending and the
   batch is empty, it long-polls `updates(cursor, waitMs, waiterId)` with
   `waitMs` = time left until the next heartbeat (≤ 15 s), and calls again as
   soon as a response arrives. An idle subscriber therefore makes about one
   coordinator RPC per heartbeat instead of five per second; publishes wake
   every waiter at once. An empty response that returns before its wait
   (busy waiter table, non-blocking backend) is followed by a backoff of up to
   1 s, so it never becomes a hot loop. Persisted history bounds each batch;
   a slow reader does not accumulate an unbounded writer queue or poll
   without demand.
5. Sends resync plus an authoritative snapshot for expired/invalid history,
   and heartbeats after 15 s when the reader is waiting. Body cancellation and
   request abort abandon the held poll locally and call `cancelWait` (best
   effort; the 25 s cap bounds a lost cancel). Poll failure errors the stream
   so EventSource can reconnect with `Last-Event-ID`.

Durable Object RPC permits a method to await a pending promise; the object's
input gate stays open while it waits (no storage I/O is pending), so the
publish that wakes waiters is processed normally, and the output gate holds
the woken replies until that write is durable. Held calls bill wall-clock
duration on the object; the 25 s cap keeps each call far below RPC limits.

## Node backend contract

The process-local backend is a **development convenience with the same endpoint
contracts**:

- The store is an in-memory `Map` keyed by `componentRouteId:scopeKey` with LRU
  bounding (500 entries), enforced on every insert (SSR registration and
  subscription cold start) and disconnect. Eviction prefers entries without
  live connections. Entries with no live connection expire 60 s after their
  last activity (SSR, connect, disconnect, or sync), so SSR renders that never
  open a subscription do not retain component instances and request contexts.
  State is per-process: not shared across machine boundaries, not persisted
  across restarts, and reset by SSR (each SSR replaces the stored entry).
- `/crpc` constructs a per-request component and applies the **client-sent**
  state (sanitized), because there is no authoritative server-side snapshot.
  Streams sync frames to the stored entry through the version counter.
- The `/sse` endpoint shares the coordinator's demand-driven stream, batch
  authorization and heartbeat. Instead of polling, a waiting subscriber is
  woken by SSR replacement or `syncSseState` through a process-local notifier. Broadcasts use process-local `SseRuntime`.
  RT-19/RT-25 follow-ups must verify adapter parity explicitly.
- Flash cookies are signed and server-expiring, but Node has no durable
  replay store. A copied cookie can be consumed repeatedly until its signed
  expiry. Cloudflare uses the Durable Object claim described above.
- It is deliberately not a Cloudflare fallback: on Workers without
  `COSSACK_SSE`, requests fail with `COSSACK_SSE_BINDING_MISSING`.

Applications needing cross-process coordination on Node must front
requests through one process while retaining the limits described above. A
distributed adapter is future work; single-process routing does not provide
persistence or restart recovery.

## Cloudflare environment caveat

Wrangler does not inherit bindings into named environments. Applications using
`--env` must re-declare the `durable_objects` binding inside each environment
block. The deployment preflight reports `COSSACK_ENV_BINDING_NOT_INHERITED`
when the selected environment is missing a top-level DO binding, and the
artifact comparison validates the built configuration.

## Verification (2026-10-02, GLM)

- `packages/cossack/tests/sse-coordinator-integration.test.js` — two real
  Workers sharing one DO namespace: concurrent cross-worker serialization,
  first-initialization-wins, ordinary-JSON passthrough with explicit publish,
  broadcasts, a disconnected queued caller (no deadlock, no replay), invalid
  state frames (explicit failure and slot release), history bounds with resync,
  persistence across harness reload, and reader-cancel slot release.
- `packages/framework/tests/sse-coordinator-transport.test.ts` — router and
  endpoint behavior against a structural fake coordinator: SSR initialize +
  hydrate, authoritative hydration beating stale client state, redirect JSON
  with published state, generator frames published per frame, `execute`
  serialization, broadcast fan-out, subscription cursors, `Last-Event-ID`
  resume without replay, invalid cursor 400, cross-user scope 403, and the
  missing-binding diagnostic on Cloudflare.
- `packages/cossack/tests/deploy-integration.test.js` — a generated staging
  application built with real Vite and run under workerd with the generated
  `COSSACK_SSE` binding: SSR renders authoritative shared state across
  requests, stale browser state cannot overwrite the coordinator, redirects
  keep the JSON contract, subscriptions deliver cursor-addressed incremental
  events, broadcasts fan out, and `Last-Event-ID` reconnects resume cleanly.
  The existing D1/context stream, cancellation, SSG, and asset checks are
  retained.

## Codex regression verification (2026-10-02)

The monorepo run passes 2,227 tests across 13 packages. New regressions cover
page/child snapshot separation, SSR-derived child targets, cold-start layout
services, monotonic reconnect cursors, demand-driven subscription cancellation,
service/custom-response ORM lifetime, nested request helper scopes, and bounded
WebSocket frame consumption. The native two-Worker coordinator suite additionally
checks that a custom streaming Response keeps its action slot until cancellation.
The generated staging application suite still passes against built public exports.
These are local workerd tests; they do not prove a remote deployment or atomic
external effects across a mid-action restart.

## Codex optimistic SSE ordering review (2026-10-03)

Publications correlate pending page calls by `_cossack_request_id`. Event IDs order
ambient snapshots; ordinary page replies use `X-Cossack-SSE-Cursor` and page generator
frames use reserved `_cossack_sse_cursor` state metadata. Child frames publish separate
scopeState and never apply the page cursor to child-local state. Metadata is bounded
and excluded from component hydration and the persisted public snapshot.

A matching publication removes only its confirmed public preview. Terminal response
ownership still controls loading. Older replies confirm their own contribution without
replacing a newer base. Higher revisions restore authority after settlement; duplicate
revisions preserve surviving local edits. Reopening resets the client's baseline.
Node publication IDs increase within the process across SSR replacement and
entry recreation. Replacement preserves active connection counts. These IDs provide
neither durable history nor ordering across process restarts.

Native browser/workerd/D1 acceptance holds a committed HTTP reply, delivers its real
SSE publication, publishes different state before and after settlement, then closes
the actual subscription response. The native EventSource reconnects after 130 test
publications exceed retained history, receives resync and converges without replaying
a mutation. Post-yield client-visible failure and cancellation settle once. The
response-close wrapper exists only in the private test application. Production Node
acceptance covers ordinary ordering and post-yield failure with its actual SSE backend.
Read the [release evidence](./release-0.9.0.md).
