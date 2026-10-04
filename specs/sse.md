# SSE Transport and Distributed Scope Coordination

This document describes the SSE transport backends, the coordinator Durable
Object, shared-state semantics, and the runtime contract for Node and Deno.
It was written by GLM on 2026-10-02 and updated by Codex after reviewing the
implementation. See the [Codex review](./release-0.9.0.md#codex-review-2026-10-02)
for fixes, verification, and remaining release acceptance work.

Related documents: [docs/sse.md](../docs/sse.md) (user-facing guide),
[specs/architecture.md](./architecture.md), [specs/service.md](./service.md).

## Overview

`@Page({ transport: 'sse' })` pages push state updates to browsers over a
long-lived SSE connection (`/sse/:componentRouteId`). Client actions are
ordinary `/crpc` POSTs. Two backends implement the same endpoint contracts:

| Runtime | Backend | Selection |
| --- | --- | --- |
| Cloudflare Workers | `SseDurableObject` namespace via the `COSSACK_SSE` binding | Binding present in `env`. |
| Node.js / Deno | Process-local in-memory store in `framework/src/transports/sse.ts` | No binding and not running under Workers. |
| Cloudflare without the binding | None | `COSSACK_SSE_BINDING_MISSING` diagnostic (HTTP 500) for `/crpc`, `/sse`, and SSR. Process-local state must not become the Cloudflare fallback. |

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

Initial and queued frames are checked again at emission. Checks and revocation
are not one transaction: a validated frame can be in flight after revocation.
Idle checks occur before the 15-second heartbeat with reader demand; backpressure
and slow storage prevent a strict elapsed-time guarantee. An action that already
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
  the Node, Deno, and browser import graphs stay clean. `pnpm audit:bundle`
  covers this boundary.
- The scaffold generates the binding with a `new_sqlite_classes` migration in
  `wrangler.jsonc` and the Worker entry export in `src/index.ts`.

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
| `updates(after)` | Events after a cursor plus a `resync` flag (`after` ahead of the snapshot or behind the pruned history). |
| `publish(state, requestId?)` | Appends a correlated `state-update` event and replaces the plain public snapshot. The optional request ID is event metadata only. |
| `broadcast(event, data)` | Appends an `event`/`client-action` event without changing the snapshot. Reserved `state-update` entries replace the snapshot; the runtime does not send partial state through this method. |
| `execute(action)` | Serializes actions per scope; see below. |

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
   batch is empty, it waits 200 ms before polling `updates(cursor)` again.
   Persisted history bounds each batch; a slow reader does not accumulate an
   unbounded writer queue or keep polling without demand.
5. Sends resync plus an authoritative snapshot for expired/invalid history,
   and heartbeats after 15 s when the reader is waiting. Body cancellation and
   request abort remove the wait timer/listener; poll failure errors the stream
   so EventSource can reconnect with `Last-Event-ID`.

## Node and Deno backend contract

The process-local backend is a **development convenience with the same endpoint
contracts**:

- The store is an in-memory `Map` keyed by `componentRouteId:scopeKey` with LRU
  bounding (500 entries). State is per-process: not shared across machine
  boundaries, not persisted across restarts, and reset by SSR (each SSR
  replaces the stored entry).
- `/crpc` constructs a per-request component and applies the **client-sent**
  state (sanitized), because there is no authoritative server-side snapshot.
  Streams sync frames to the stored entry through the version counter.
- The `/sse` endpoint uses the earlier timer/writer polling implementation and
  event names. It does not yet have the coordinator subscription's demand-driven
  buffering/cancellation guarantees. Broadcasts use process-local `SseRuntime`.
  RT-19/RT-25 follow-ups must verify adapter parity explicitly.
- It is deliberately not a Cloudflare fallback: on Workers without
  `COSSACK_SSE`, requests fail with `COSSACK_SSE_BINDING_MISSING`.

Applications needing cross-process coordination on Node or Deno must front
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
Node/Deno publication IDs increase within the process across SSR replacement and
entry recreation. Replacement preserves active connection counts. These IDs provide
neither durable history nor ordering across process restarts.

Native browser/workerd/D1 acceptance holds a committed HTTP reply, delivers its real
SSE publication, publishes different state before and after settlement, then closes
the actual subscription response. The native EventSource reconnects after 130 test
publications exceed retained history, receives resync and converges without replaying
a mutation. Post-yield client-visible failure and cancellation settle once. The
response-close wrapper exists only in the private test application. Production Node
acceptance covers ordinary ordering and post-yield failure with its actual SSE backend.
Read the [release evidence](./release-0.9.0.md#codex-optimistic-sse-ordering-2026-10-03).
