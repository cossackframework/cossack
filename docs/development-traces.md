---
title: "Development traces"
description: "Capture bounded navigation and client RPC lifecycle evidence during development."
---

# Development traces

The core package provides opt-in capture for framework navigation and component
HTTP/SSE and WebSocket calls. Use it from Vite development code:

```ts
import { startDevelopmentTrace } from '@cossackframework/core/devtools';

if (import.meta.env.DEV) {
  const session = startDevelopmentTrace({ capacity: 512 });
  // Perform the application interaction you want to inspect.
  const evidence = session.snapshot();
  console.log(evidence);
  session.stop();
}
```

Keep the session alive while the interaction runs, then read its snapshot.
Snapshot reads never execute or replay calls. Collection is disabled outside
development. The production proxy bundle removes collection code.

Each snapshot has a schema version, capture session ID, start time, collection
status, capacity, dropped-event count and detached event records. Capacity defaults
to 512 and accepts integers from 1 to 2,048. A full buffer evicts the oldest event.
Sequence numbers order events; timestamps use the local wall clock. A dropped
history is incomplete and may contain a terminal event without its start.

Events form a discriminated union. Check `event.kind` before reading fields:
`rpc` describes component calls and `navigation` describes navigation decisions.

Each RPC call has a local `callId`, an opaque `componentId` and a UUID `requestId` when
available. A server can change the wire request ID; `callId` still groups the local
lifecycle. Non-UUID response identifiers are omitted. These are client observations,
not authenticated server execution evidence.

| Phase | Meaning |
| --- | --- |
| `start` | A local call attempt started; it may fail before dispatch. |
| `response` | HTTP response handling or a WebSocket result/error frame was observed. |
| `state-reconciled` | A response state snapshot was reconciled and a render update requested. Stale fields may have been skipped; this is not a DOM-commit event. |
| `finish` | Local call cleanup ended, with `succeeded`, `failed`, `cancelled`, `timeout` or `disconnected`. |

Navigation events retain their `navigationId` across start, cache, layout,
transition, scroll and finish decisions. The finish event has an outcome
(`completed`, `superseded`, `canceled`, `redirected` or `failed`) and a `committed`
flag. `component-prepared` events identify the app, layout, page and loading
instances involved in preparation. Their opaque `componentId` matches RPC events
from the same instance within the capture. Preparation can fail: check the terminal
outcome before treating a component as committed. This relationship does not prove
navigation caused every later call from that instance.

Cache invalidations and standalone prefetch decisions have `navigationId: null`.
They share the same sequence and capacity as RPC events. The recorder copies only
allowed primitive fields and ignores invalid navigation metadata. Events after a
navigation's terminal event are excluded from the capture; the existing DOM
navigation-diagnostic stream keeps its own behavior.

Trace events omit arguments, return values, state values, method names, route paths,
provider names and raw errors. Capture holds component identities weakly. Snapshots
can be edited without changing the internal buffer.

A new capture stops the previous one. In-flight calls keep their original capture
owner and do not enter the new session. `stop()` detaches collection but retains
the bounded snapshot on the session handle. It does not cancel application calls;
a stopped session may therefore have starts without terminal events. Cancellation
or a timeout does not prove that remote work stopped or external effects rolled back.

## Component snapshots

`session.snapshot().components` reports current status for up to 64 component
instances observed through navigation, RPC or explicit inspection. The registry
holds weak references; `dropped` counts registry evictions and is separate from
the event-buffer count. Platforms without `WeakRef` report tracking as unavailable.
Explicit inspection still works there. Components can be `available`, `unavailable`,
`collected` or `stopped`. A stopped capture performs no further component reads.

Each result includes `capturedAt`. Component details are read when requested; they
are not a reconstruction of state at an earlier event. They include:

- The actual framework lifecycle phase.
- Initialized public and client-only state field names. Values are omitted by default.
  Undecorated/private fields and other internal state are excluded.
- Resource states, value-presence and staleness flags, including compiler-declared
  resources that have not been bound. Inspection does not call resource getters,
  start loaders, refresh data or expose raw resource errors/results.
- Up to 16 service scopes with opaque parent IDs, declared service slots/names,
  initialization, disposal, subscriber and pending-call counts. Reads do not resolve
  services or expose their state, request context, owner URLs or scope keys.
- Recorded SSE/WebSocket states, reconnect counts and resynchronization flags.
  Transport slots are positions within this snapshot, not durable provider IDs.
  Provider names, event cursors and raw errors are omitted. An empty list means no
  status was recorded, not proof that the component has no transport configuration.

Given a component reference, select up to 32 state fields explicitly:

```ts
const selected = session.inspect(component, { state: ['count', 'draft'] });
```

Only initialized public or client-only fields are eligible. Unknown, private and
uninitialized selections do not reveal values. Selection does not change subsequent
default snapshots or store the selected values in the event buffer. Returned values
are tagged records, such as `{ type: 'number', value: 7 }`, rather than live objects.

Selected values use a shared 256-node budget, depth 4, 32 entries per object/array
and a 512-character string limit. Truncation, cycles, unsupported native/class values,
array holes and accessors have explicit markers. Accessors and `toJSON` are not
called. Each inventory is capped at 64 state/resource/transport entries and 64
services per scope; truncation is explicit. The registry and output limits do not
provide a sandbox against malicious JavaScript proxies: reflective inspection can
invoke proxy traps. Do not select values backed by untrusted proxies.

Recognized secret field names and common credential strings are redacted. This
cannot identify every secret stored under an ordinary name. Select only fields
that are appropriate to inspect or share. Component/resource values are never
included in the default event stream.

RT-28 remains open. Server-side correlation, browser inspector integration,
CLI/MCP trace access and generated-browser acceptance still need work.
The separate [stored test-results reader](./test-results.md) does not read traces.
