# SSE Transport and Distributed Scope Coordination

This document describes the SSE transport backends, the coordinator Durable
Object, shared-state semantics, and the runtime contract for Node and Deno.
It was written by GLM on 2026-10-02 for the 0.9.0 distributed SSE work; Codex
reviews it against the implementation.

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
| `publish(state)` | Appends a `state-update` event and replaces the snapshot (used for ordinary action results). |
| `broadcast(event, data)` | Appends an `event`/`client-action`/partial-state event without changing the snapshot. |
| `execute(action)` | Serializes actions per scope; see below. |

`execute` holds an explicit per-scope serialization slot (a promise chain —
`blockConcurrencyWhile` is used only for table initialization in the
constructor). The action callback executes in the calling Worker via RPC with
its original `AsyncLocalStorage` snapshot, so request middleware, layout DI,
ORM scope, config, locale, and auth contexts remain active. Response handling:

- RPC-stream responses (`application/x-cossack-rpc+ndjson`) are re-emitted
  frame by frame; each `yield`/`done` frame's `state` is published. Frames
  without object state fail the stream explicitly
  (`COSSACK_RPC_STATE_INVALID`) and release the slot.
- Any other response — ordinary JSON results, `{_cossack_redirect}` bodies,
  custom `Response` objects, and error statuses — passes through unchanged and
  releases the slot immediately because the body is already materialized. The
  router callback publishes final state itself before returning. Cookies set
  through the request context are applied to ordinary JSON responses; reliable
  stream-response cookie delivery is RT-11 work, not claimed here.
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

- The authoritative scope state is the public state of the **acting component
  instance** — the page root, or the child addressed by the RPC `target`.
  Hydration applies only keys the receiving component declares
  (`sanitizeClientState` plus the instance's public keys), so a child-authored
  snapshot cannot inject foreign keys into the page root.
- Child components and services not addressed by an action keep request-local
  state. Services declared on a parent layout are injected into the page and
  their `@State` keys mirror into the page's public state, which then
  round-trips through the coordinator snapshot.
- SSR initializes the scope with the rendered page's public state
  (first-write-wins). When the scope already exists, SSR hydrates the
  authoritative snapshot so the HTML renders shared state; it never overwrites
  the snapshot.
- `/crpc` hydrates the acting root component from the coordinator snapshot.
  The browser-sent state is applied only to child targets (whose state the
  scope does not track) — a stale tab cannot overwrite shared state.
- Component `broadcastEvent` / scheduled state broadcasts are forwarded to the
  coordinator as events by the `CoordinatorSseRuntime` attached to `/crpc`
  instances. Broadcasts never replace the snapshot; only action results
  publish authoritative state.

## Subscription endpoint

`/sse/:componentRouteId` re-evaluates the scope with the live authenticated
request (a mismatched `scopeKey` is rejected with 403), then:

1. Reads the cursor from `Last-Event-ID` (sent automatically by `EventSource`
   on reconnect) or the `cursor` query parameter; invalid cursors are rejected
   with 400.
2. Cold-starts the scope when `currentState()` is null (constructs a component
   with `skipInit: true`, `initialize()`s the scope, and disposes the
   instance).
3. Sends the authoritative snapshot as a `state-update` event whose SSE `id`
   is the snapshot cursor, then a `connected` event.
4. Polls `updates(cursor)` every 200 ms and forwards every event with its
   cursor as the SSE `id`. The client's cursor is preserved (not advanced to
   the snapshot cursor) so events between the client's cursor and the snapshot
   — such as broadcasts — are still delivered; state events are idempotent for
   the client.
5. Resynchronizes with a fresh snapshot when `updates` reports `resync`, sends
   heartbeats every 15 s, and closes the stream on poll failure so the browser
   reconnects with `Last-Event-ID`.

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
- The `/sse` endpoint serves from the stored entry via the same polling model
  and event names. Broadcasts go through the process-local `SseRuntime`.
- It is deliberately not a Cloudflare fallback: on Workers without
  `COSSACK_SSE`, requests fail with `COSSACK_SSE_BINDING_MISSING`.

Applications needing cross-process coordination on Node or Deno must front
requests with a single process; a distributed adapter for those runtimes is
future work (tracked by RT-19/CF-05 follow-ups, not claimed here).

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
