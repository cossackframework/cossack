---
title: "Server calls and client types"
description: "Infer generator yields and final RPC results in authored client code."
---

# Server calls and client types

Calling a server method in the browser uses Cossack's remote procedure call
(RPC) proxy. Each invocation starts one operation. It returns a `RpcCall`:
await it for the final result, iterate it for generator yields, or cancel it.
Awaiting the same call again does not invoke the server again.

TypeScript checks the method as authored. A decorator cannot change that type
to the browser proxy's type. For example, an `async *` method has a native
`AsyncGenerator` type in the editor even though its browser proxy returns a
`RpcCall`. Wrap the invocation with `rpc$` to expose the inferred client type:

```typescript
import { Client, Cossack, Page, Server, rpc$ } from '@cossackframework/core';

@Page({ transport: 'http' })
export default class ProgressPage extends Cossack {
  @Server()
  async *generate(limit: number) {
    for (let step = 1; step <= limit; step++) yield { step };
    return { total: limit };
  }

  @Client()
  async start() {
    const call = rpc$(this.generate(3));
    for await (const progress of call) {
      console.log(progress.step); // number
    }
    const result = await call;
    console.log(result.total); // number
  }
}
```

This infers `RpcCall<{ total: number }, { step: number }>` from the original
method. Arguments retain their authored types. The helper also handles inherited
methods, generic methods, function fields, and injected scoped service calls:
`rpc$(this.reportService.generate(3))`. It works with HTTP, SSE, and WebSocket
proxies. It returns the exact call it receives and does not dispatch or wrap a
second operation. No Vite transform, editor plugin, or user cast is needed to
check the client handler's types.

Use the helper synchronously around the invocation in client code. Calling it
after `await` passes the resolved value instead of the call. Passing a native
server return value, generator, or ordinary Promise throws
`COSSACK_RPC_CALL_REQUIRED`. The helper cannot turn a local function into a
remote action. Server code continues calling the original native method directly.
The server may execute before the helper sees a native value, so do not use this
client view in server code.

`RpcCall<Result, Yield>` exposes:

| Operation | Behavior |
| --- | --- |
| `await call` | Drains unconsumed yields and returns `Result`. After iteration finishes, it returns the same final result. |
| `for await (const value of call)` | Consumes `Yield` values with backpressure. Only one iterator may consume a call. |
| `call.catch(handler)` | Returns a Promise with the final result or the recovery value. |
| `call.finally(handler)` | Runs the handler after completion or failure. |
| `await call.cancel()` | Cancels transport consumption and releases the operation. |

Select iteration synchronously, before the helper returns control to the event
loop. An unobserved call automatically drains so an event handler can ignore a
result while the operation still completes. Selecting another iterator, or
selecting iteration after promise consumption began, throws
`COSSACK_RPC_ALREADY_CONSUMED`. Repeated awaits share completion.

Ordinary methods return `RpcCall<RpcResult<Return>, never>` and yield no values.
Generators infer yielded and final values separately. A generator with no
explicit return has a `void` final result. A broad `AsyncIterable<Yield>` return
annotation has an `unknown` final result because that annotation does not
describe completion. Prefer an inferred return or `AsyncGenerator<Yield, Result>`
when callers need a precise final result.

Client results use `RpcSerialized<T>`, the value's JSON representation. The same
conversion applies to generator yields, arguments, and public RPC state. It does
not restore native prototypes in the browser.

| Server value | Wire value / client type |
| --- | --- |
| String, boolean, null, finite number | The JSON primitive. |
| Valid `Date` | ISO timestamp string. |
| Object field with `undefined` | Omitted. An optional field can read as undefined. |
| Undefined array entry or hole | Null. |
| Top-level void or undefined completion | Undefined completion. |
| Data/model instance | Own enumerable fields as a plain object; prototype methods are absent. |
| Object with `toJSON()` | Its validated JSON representation, evaluated once per value location. |
| Non-finite number, invalid Date, binary/native opaque value | `COSSACK_RPC_SERIALIZATION_FAILED` with its path. |

For example, `rpc$(this.loadRecord())` maps a native
`{ createdAt: Date }` result to `{ createdAt: string }`. Parse that string
explicitly when a client needs a Date object. Model methods such as `save()` do
not cross the wire. Use an explicit data object or a typed `toJSON()` method for
class contracts; data fields must be own enumerable properties. TypeScript
visibility modifiers do not control JSON enumeration.

The snapshot validates custom JSON output too, including nested values, cycles,
and throwing hooks/getters. Root result hooks receive an empty key on all
transports; nested hooks receive their property name or array index. Recursion is
limited to 256 levels. Shared references are copied, while actual cycles reject.
Maps, Sets, weak collections, functions, symbols, bigints, RegExp, Errors, nested
Promises, raw buffers/views, Blob/File results, and nested HTTP objects are not
JSON data. Convert them to explicit data or use the appropriate HTTP endpoint.

Method parameter types remain authored types. Declare JSON action inputs using
the representation the server receives, such as an ISO string for a timestamp.
HTTP/SSE component and explicit scoped service calls accept File arguments,
including nested files and arrays. The client sends them as multipart parts;
FileList arguments become arrays of Files. Public state and returned/yielded
values still use JSON and reject files or raw binary values. WebSocket arguments
and raw Blob arguments reject before dispatch; use File arguments on HTTP/SSE
or an HTTP endpoint for binary operations.

Multipart and JSON calls share action validation, layout service ownership,
request/ORM context, generator replies, cookies/redirects and awaited cleanup.
The `_cossack_file_id` field is reserved for framework file references inside
multipart payloads. Missing/duplicate file parts, duplicate metadata, malformed
JSON or markers and invalid envelope shapes reject before action dispatch with
`COSSACK_RPC_REQUEST_INVALID`, a path and request ID.

Component uploads use Fetch by default, preserving native response streaming.
To observe upload progress, declare a numeric client state field named after the
method, such as `uploadProgress` for `upload()`. That selects XMLHttpRequest
(XHR). The percentage measures request bytes sent, not action completion. Both
clients expose generator yields before completion and retain cancellation,
deadlines and the same correlated stream protocol. The XHR bridge forwards
complete UTF-8 lines as they arrive and enforces the frame limit. XHR itself
retains received text and cannot pause downloads when an iterator pauses; prefer
the default Fetch path for long streams. This is a browser transport limitation,
not a server-global response buffer. See the [XHR standard](https://xhr.spec.whatwg.org/#the-responsetype-attribute).

```typescript
@ClientState() uploadProgress = 0; // Optional; omit to use Fetch.

// Import input from @cossackframework/core.
@Server({ input: input.object({
  title: input.string({required:true}),
  nested: input.object({files: input.array(input.file({maxBytes:1_048_576}), {minItems:1,maxItems:4})}),
}) })
async *upload(input: { title: string; nested: { files: File[] } }) {
  yield await input.nested.files[0].text();
  return { name: input.nested.files[0].name };
}

@Client()
async submit(file: File) {
  const call = rpc$(this.upload({ title: 'Draft', nested: { files: [file] } }));
  for await (const progress of call) console.log(progress);
  console.log((await call).name);
}
```

An ordinary method returning a native `Response` has a `Response | undefined`
client result. Successful HTTP/SSE component and service calls resolve to a local
browser `Response` with the native status, status text, readable body and
browser-visible headers. Text, JSON, binary and bodyless responses are supported.
Their bodies never become component state or redirect metadata. The component
upload path supports binary responses too. Cookie handling follows the browser's
HTTP rules; `Set-Cookie` remains unavailable to client code.

The proxy consumes the entire native body before completing the call. This keeps
deadlines, cancellation and server resource cleanup active through consumption,
including an unobserved call. It buffers at most 1 MiB and rejects larger bodies
with `COSSACK_RPC_RESPONSE_TOO_LARGE`. On cancellation or a size failure, the
client requests producer cancellation and releases its reader without waiting
for a producer cleanup hook that may never settle. Local rejection does not
prove server cleanup or termination of application I/O. Use an HTTP endpoint for
larger downloads or continuous streams. The result is a local response, so `url` and `redirected`
do not describe the original fetch. Repeated awaits return the same response;
read its body once or call `clone()` before consuming it.

```typescript
const response = await rpc$(this.exportReport());
if (response) {
  const contents = await response.blob();
  console.log(response.status, contents.size);
}
```

Redirects navigate and complete with undefined. Non-success HTTP statuses reject
with an `RpcError` containing the status and known request ID. Native responses
do not carry a state envelope; use a typed data return to hydrate action state.
WebSocket actions returning a native `Response` cancel its body and fail with
`COSSACK_RPC_HTTP_RESPONSE_REQUIRED`. A native Response cannot be a generator
yield or terminal value: these, and nested `Response`, `Request`, or `Headers`
in serialized trees, fail with `COSSACK_RPC_SERIALIZATION_FAILED` and their path.

HTTP/SSE RPC redirects return metadata that the client proxy uses to navigate.
The redirect envelope contains only `_cossack_redirect`, a nonempty URL using
HTTP or HTTPS (including relative URLs). Malformed or conflicting metadata
rejects before navigation or hydration with `COSSACK_RPC_RESPONSE_INVALID`.
Cookies from the action's native response, `cookie()`, and flash middleware are
preserved together, including separate `Set-Cookie` values. Background transports
preserve valid incoming flash for the next page. An RPC HTTP error status (400
or higher) discards outgoing flash written before the failure. A later stream
error cannot undo headers already sent.

Write cookies, flash, and response headers before returning a stream. Async
generator bodies execute lazily, after the response's middleware has finished;
even a write before the first `yield` is too late. Use an ordinary async server
method to prepare headers, then return a generator:

```typescript
@Server()
async generate() {
  cookie().set('job_started', '1', { httpOnly: true, path: '/' });
  return (async function* () {
    yield { step: 1 };
    return { total: 1 };
  })();
}
```

Import `cookie` from `@cossackframework/core`. Late `cookie().set/delete`,
`flash/flashInput`, and `this.c.header` writes reject with
`COSSACK_RESPONSE_HEADERS_COMMITTED`. Session rotation and destruction also
reject before modifying storage when headers are finalized. Existing session
bag writes do not require a cookie change; see [sessions](./session.md).

Failures reject with `RpcError`, including validation, authorization, timeout,
disconnect, cancellation, and invalid serialization. Do not retry mutations
automatically after a timeout or disconnect: the server outcome may be unknown.
Network failures report that uncertainty; the framework never retries the action.
Cancelling response consumption does not roll back a completed mutation.

A method can declare a client-side deadline with `@Server({ timeout: ms })`.
`ms` must be an integer from 1 through 2,147,483,647; invalid values throw when
the decorator is applied. This bound avoids runtime timer clamping. A configured
deadline continues while an iterator is paused at a yielded value.
HTTP/SSE, explicit service and WebSocket calls reject completion with
`COSSACK_RPC_TIMEOUT`, release local loading ownership and close the paused
iterator without requiring another consumer pull. The next pull observes the
interruption once; later pulls report completion. Explicit cancellation retains
`COSSACK_RPC_CANCELLED`, and an already completed call keeps its result.

WebSocket disconnects, invalid frames and buffer overflow also interrupt a paused
consumer. Unconsumed queued frames are discarded; already reconciled yield state
remains authoritative. Cancellation requests are sent at most once for a locally
cancelled or timed-out call. This does not confirm that server work stopped.
Application error frames retain their order after earlier yields; consuming those
yields still observes their confirmed state before the error.
HTTP stream cleanup requests producer cancellation and releases its reader lock
without waiting for an uncooperative producer's cleanup promise.

Use the error's `code` for application decisions. Internal exception messages
and stacks stay in server logs, including service RPC in development. Deliberate
`ClientVisibleError` messages and validation field errors remain visible.
Correlated server failures carry `requestId`. HTTP/SSE and service failures retain
the response's request ID on invalid JSON, mid-stream deadlines, and network
disconnects. Before response headers arrive, the server-generated HTTP request ID
may be unavailable; local pre-dispatch failures and cancellation also need not
have one. `status` describes an HTTP failure and is absent on WebSocket failures.

Ordinary JSON replies and HTTP error bodies have a total 1 MiB byte limit,
exported as `RPC_JSON_RESPONSE_MAX_BYTES`. The limit includes state, results,
and diagnostics; overflow rejects with `COSSACK_RPC_RESPONSE_TOO_LARGE`. Use an
HTTP endpoint for larger bodies. Clients consume the body through EOF before
hydration or completion, with cancellation and deadlines still active. Invalid
UTF-8, JSON, or envelope shapes reject with `COSSACK_RPC_RESPONSE_INVALID` and
the known header ID. Explicit service replies require an object in
`_cossack_service_state`; component replies cannot contain that service envelope.

HTTP error `code` and `requestId`, when present, must be nonempty strings;
`error` must be a string and `fieldErrors` must be an object. Nested field errors
remain JSON data. The body ID must match a known header ID; otherwise a valid
body ID supplies correlation. Ordinary component state named `requestId` remains
application data. Non-JSON middleware failures and native failure bodies stay
opaque, with generic status diagnostics. A malformed declared JSON failure
rejects as an invalid response. These client checks do not roll back a mutation
that already ran or retry it.

HTTP/SSE generator frames must use the response's `X-Cossack-Request-Id` when
present, or the first accepted frame's ID otherwise. Invalid JSON, UTF-8, frame
shapes and later ID mismatches reject with `COSSACK_RPC_STREAM_INVALID` and the
known ID. Error codes and request IDs must contain a non-whitespace character.
Yields arrive incrementally. The final result or error waits until the response
body ends: trailing data or a body failure rejects before final state is applied.
Cancellation and deadlines remain active during that wait. Already accepted
yield state remains visible; failure does not undo it or the server's mutation.

WebSocket calls share a persistent connection. Their correlated terminal frame
completes the call without waiting for the socket to close. Unknown or completed
request IDs are ignored, so a foreign frame cannot hydrate another call's state.
A malformed frame with a pending call's ID rejects that call and releases its
pending entry.

Invalid action targets reject with `COSSACK_RPC_REQUEST_INVALID`; a missing
child returns `COSSACK_RPC_NOT_FOUND`. A valid target cannot expose framework
methods outside the server allowlist (`COSSACK_RPC_FORBIDDEN`). Rate-limited
actions reject before mutation with `COSSACK_RPC_RATE_LIMITED` and the known ID.
See [rate-limit ownership](./rate-limiting.md) for caller keys and store limits.

WebSocket actions and custom rate keys use the originating peer's verified
upgrade context, even when several peers share one component. Cloudflare keeps
a filtered request snapshot in the native attachment; Node/Deno pass each
connection's context. See [action identity and context](./websockets.md#action-identity-and-request-context)
for retained headers, old-peer reconnects, capacity errors and session limits.

The shared [transport conformance matrix](../packages/framework/tests/rpc-conformance-matrix.test.ts)
runs the same assertions against HTTP and SSE component actions, explicit service
actions, and the WebSocket runtime dispatcher. It exercises real server handlers
with controlled transport faults; generated browser acceptance separately checks
production builds and navigation.

| Case | Shared expectation |
| --- | --- |
| Ordinary return / generator | Ordinary results have no yields; generators keep yields and final results separate. |
| Repeated await / catch / finally | Completion is shared and never dispatches a second mutation. |
| Unobserved call | The call drains and releases loading automatically. |
| Validation / application error | The call rejects with stable codes and server request IDs; private exceptions stay private. |
| Timeout / disconnect | The call rejects, releases loading, and never retries an uncertain mutation. |
| Cancel / iterator return | Consumption ends and remote cleanup follows when application I/O yields control. |
| Second iterator | It rejects without interfering with the first consumer or dispatching again. |
| Unsupported payload / state / result | The diagnostic names the offending value path; invalid input does not dispatch. |
| Malformed protocol / foreign ID | Invalid correlated frames reject before state hydration; unknown socket IDs are isolated. |
| HTTP result followed by data | Rejects before final state hydration; accepted earlier yields remain visible. |
| Action limit / unavailable counter store | Rejects before mutation with correlation and loading cleanup; private store errors remain private. |
| Ownership | HTTP request scopes close with the response; WebSocket component ownership lasts until runtime teardown. |
