---
title: "Development RPC traces"
description: "Capture bounded client RPC lifecycle evidence during development."
---

# Development RPC traces

The core package provides opt-in capture for component HTTP/SSE and WebSocket
calls. Use it from Vite development code:

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

Each call has a local `callId`, an opaque `componentId` and a UUID `requestId` when
available. A server can change the wire request ID; `callId` still groups the local
lifecycle. Non-UUID response identifiers are omitted. These are client observations,
not authenticated server execution evidence.

| Phase | Meaning |
| --- | --- |
| `start` | A local call attempt started; it may fail before dispatch. |
| `response` | HTTP response handling or a WebSocket result/error frame was observed. |
| `state-reconciled` | A response state snapshot was reconciled and a render update requested. Stale fields may have been skipped; this is not a DOM-commit event. |
| `finish` | Local call cleanup completed, with `succeeded`, `failed`, `cancelled`, `timeout` or `disconnected`. |

Arguments, return values, state values, method names, route paths, provider names
and raw errors are omitted. Capture holds component identities weakly. Snapshots
can be edited without changing the internal buffer.

A new capture stops the previous one. In-flight calls keep their original capture
owner and do not enter the new session. `stop()` detaches collection but retains
the bounded snapshot on the session handle. It does not cancel application calls;
a stopped session may therefore have starts without terminal events. Cancellation
or a timeout does not prove that remote work stopped or external effects rolled back.

RT-28 remains open. Navigation correlation, resources, service scopes, server-side
events, the browser inspector and CLI/MCP trace access still need integration.
The separate [stored test-results reader](./test-results.md) does not read traces.
