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

Arguments, return values, state values, method names, route paths, provider names
and raw errors are omitted. Capture holds component identities weakly. Snapshots
can be edited without changing the internal buffer.

A new capture stops the previous one. In-flight calls keep their original capture
owner and do not enter the new session. `stop()` detaches collection but retains
the bounded snapshot on the session handle. It does not cancel application calls;
a stopped session may therefore have starts without terminal events. Cancellation
or a timeout does not prove that remote work stopped or external effects rolled back.

RT-28 remains open. State/resource/service/transport snapshots, server-side
correlation, the browser inspector, CLI/MCP trace access and generated-browser
acceptance still need integration.
The separate [stored test-results reader](./test-results.md) does not read traces.
