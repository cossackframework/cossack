---
title: "Development traces"
description: "Capture bounded navigation and client RPC lifecycle evidence during development."
---

# Development traces

The core package provides opt-in capture for framework navigation and component
HTTP/SSE and WebSocket calls, plus explicit layout-service HTTP calls. Use it from
Vite development code:

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
`rpc` describes component calls, `service-rpc` describes explicit layout-service
calls, `server-rpc` carries server dispatch evidence, `server-stream` carries delivered
RPC stream terminal evidence, and `navigation` describes navigation decisions.

RPC calls share a local `callId` and a UUID `requestId` when available. Component
calls have an opaque `componentId`; service calls have a separate opaque `serviceId`.
A service instance keeps its identity within a capture and is held weakly. Service
identities do not add services or service state values to the component registry. A server can change the wire request ID; `callId` still groups the local
lifecycle. Non-UUID response identifiers are omitted. These are client observations,
not authenticated server execution evidence. Validated stream frames supply their
request ID if the HTTP response omitted the correlation header; subsequent state
and terminal events use that ID.

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

Deadlines can finish a call while its consumer is paused at a yield. Its timeout
trace and local loading cleanup do not wait for another pull. Explicit cancellation
keeps its own outcome. WebSocket disconnects and buffer overflow also settle paused
calls, discarding unconsumed frames while preserving already reconciled state.
These local terminal events do not prove that remote work stopped.

## Server dispatch evidence

During an active capture, component and explicit service HTTP calls send an opaque
call ID in `X-Cossack-Development-Trace`. This includes SSE page actions, which use
HTTP, and multipart uploads. The development router returns a bounded, fixed-field
record in the same header. Production removes this instrumentation.

A `server-rpc` response event joins the local call through `callId` and `requestId`.
Its separate `dispatchId` identifies that server request. The server records
`receivedAt`, `invokedAt`, `returnedAt` and `respondedAt`; the invocation and return
markers are null when their stages were not reached. `status` is the response
status, and `result` is `none`, `value`, `stream` or `native`. A method that throws
has an invocation marker but no return marker. A denied dispatch has neither.

Returning a generator records `stream` before its body runs. Returning a native
Response records `native` before its body completes. Neither proves streaming
success, cleanup or delivery. A separate `server-stream` event can report a
delivered RPC generator terminal. WebSocket dispatch and native-body terminal
evidence remain pending. Calls interrupted before response headers have no such
record; absence does not prove that the server did not execute them.

`timestamp` is browser receipt time. The four server markers use the server wall
clock; do not subtract them from browser timestamps or assume synchronized clocks.
The client rejects oversized, extra-field, malformed and mismatched records and
accepts at most one record per call. Evidence follows the original capture owner
and shares its bounded buffer. CLI and MCP read the same stored event. These are
response-carried observations, not authenticated server logs; a local browser or
proxy can edit them. They contain no arguments, state values, names or raw errors.

### Delivered stream terminals

For an opted-in HTTP RPC generator, the terminal `done` or `error` frame may carry
one bounded `developmentTrace` record. It becomes a `server-stream` event only
after the client validates the full stream, including end of body. The record must
match the call ID, request ID and dispatch ID from the earlier `server-rpc` record.
A done frame reports `outcome: 'succeeded'`; an error frame reports `failed`.
`cleanup` separately reports `completed` or `failed`, and `finishedAt` uses the
server clock. Successful terminals require completed request cleanup. An action
failure may still have completed cleanup.

This record covers the producing action's request cleanup, not all downstream
coordinator or network work. It does not undo external effects. Cancellation,
disconnect, truncation or invalid data after the terminal can prevent delivery or
validation, so no server terminal is inferred from a local finish event. No record
is sent on intermediate yields. The response encoder omits optional evidence when
it would crowd the frame byte limit, including space for an SSE coordinator cursor.
Missing evidence never establishes that the server failed or stopped.

Malformed evidence is ignored without changing application results. Valid records
share the capture's bounded buffer and are available through the same CLI/MCP
reader. Production removes the server evidence encoder and client collector.

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

## Browser inspector

The framework's development entry installs the inspector. Generated applications
with a custom client entry can opt in explicitly:

```ts
if (import.meta.env.DEV) {
  const { enableDevTools } = await import('@cossackframework/framework/client/devtools');
  const inspector = enableDevTools();
  // Retain the controller if this entry owns a shorter application lifetime.
  import.meta.hot?.dispose(() => inspector?.dispose());
}
```

Installation is idempotent and does not start capture. The toolbar's **Record trace**
button starts a session; **Stop trace** stops collection while retaining its history.
**Log snapshot** writes a detached default snapshot to the browser console.
A new session replaces the previous capture, including one started through core.

Hold Control to highlight a component source range. **Ctrl-Shift-click** starts
capture if needed and logs its passive snapshot without invoking the clicked
application action. **Ctrl-click** opens its source through the existing local
editor service at `http://localhost:3333/open`; that service must be running.
Inspection does not contact the editor service. Neither gesture logs live instances
or selects state values automatically.

The returned `BrowserDevTools` controller provides `startCapture`, `stopCapture`,
`snapshot`, `inspect(file, options)` and `dispose`. Explicit state selection uses
the same bounded, redacted core reader described above. `snapshot()` returns null
before recording and after disposal. Disposal stops only the owned capture,
removes listeners and controls, restores the owned cursor and clears source
registrations. Hot-module replacement and final page exit dispose automatically;
a back/forward-cache suspension retains capture and hides the highlight.

Source lookup is limited to compiler comment markers and registered instances.
Client navigation registers the page after rendering. The bounded weak registry
holds the most recent instance for each of at most 128 source files. Repeated
instances from one source are not distinguished; a marker without a registration
reports that no component is registered. It is not a complete component-tree view.
Custom integrations can call `registerDevToolsInstance(file, instance)` and retain
its identity-safe unregister callback. Reinstalling after disposal requires new
registrations. Core capture can still observe other instances through navigation
and RPC without a source registration.

## Read captures from CLI and MCP

Enable the project bridge in the existing Vite page plugin:

```ts
cossackPages({ developmentTraces: true })
```

The option defaults to false. During development the client route registry loads
the inspector and publisher, including on Worker-rendered pages that bypass Vite's
HTML transformation. The HTML transform uses the same virtual module URL, so
using both paths does not install duplicate publishers. Custom HTML servers that
do not load the client registry must call `transformIndexHtml`.
It does not start capture. Use **Record trace**, reproduce the interaction, and
stop recording. While connected, the browser offers its default snapshot once per
second; only one unacknowledged snapshot is outstanding. A stopped capture is
published once after acknowledgement. Disconnects suppress periodic publishing;
reconnection offers the current snapshot. Page exit may occur before a final
snapshot reaches disk. A new capture within a sampling interval can replace an
unpublished capture.

Read the most recently received record from the application directory:

```sh
pnpm exec cossack traces --json
pnpm exec cossack traces --session <capture-uuid> --json
```

The project-bound MCP tool is `read_development_traces`, with an optional `session`
UUID. Both interfaces use the framework's Node-only `/development-traces` reader.
They do not start recording, execute application modules, query the browser or
replay actions. Read `data.record.snapshot` for the shared event/component schema.
`data.freshness.ageMs` is elapsed time since Vite received that record;
`live: false` is explicit. A saved `collecting: true` flag does not prove that the
browser or development server is still running. Source/environment freshness and
server execution are not verified.

Vite writes at most 16 session records under `.cossack/development-traces`, with a
2 MiB snapshot limit, private file modes where supported and atomic replacement.
Use one recording Vite server per project directory. Writers serialize accepted
updates and reject overload rather than queueing unlimited messages. Invalid or
unavailable writes are retried on a later sampling interval. Readers reject linked
directories/files, malformed data, extra payload fields and records from another
project location. Explicitly selected state values never enter these records;
only default field inventory is accepted. Do not commit `.cossack` output.

The bridge uses Vite's existing [custom HMR events](https://vite.dev/guide/api-plugin.html#client-server-communication),
with a per-server token to separate server instances. It does not add a deployed
HTTP endpoint. That token is available to the development browser and is not an
authentication claim. Treat records as local browser observations. Production
HTML does not install the bridge, and production bundling removes the publisher.

Generated Cloudflare acceptance now follows real component-stream, service and
failure button actions through browser capture, Vite persistence, CLI and MCP. It
also checks generated types and production client/Worker bundles. The same
acceptance passes with installed tarballs and offline CLI/MCP readers. The Vite
bridge uses the public inspector import so dependency optimization does not
create a second capture owner. Other runtime development paths and remaining
server transport evidence still have separate acceptance gates. The separate [stored test-results reader](./test-results.md)
reads test evidence, not runtime traces.
