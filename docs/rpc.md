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

Ordinary methods return `RpcCall<Awaited<Return>, never>` and yield no values.
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
HTTP/SSE component calls retain their separate File upload handling; files are
not ordinary JSON. Service/WebSocket JSON calls reject binary values before
dispatch. Ordinary multipart results use the same JSON snapshot and diagnostics.
This contract does not imply multipart generator or nested-file parity.

A method returning a native `Response` has an `unknown` client result. The
HTTP/SSE transport handles responses and redirects; it does not transfer a native
`Response` instance to the browser. Return a typed data value when a client
handler needs a typed completion value. WebSocket actions returning a native
`Response` fail with `COSSACK_RPC_HTTP_RESPONSE_REQUIRED`. Nested `Response`,
`Request`, and `Headers` instances in serialized arguments, state, or stream
values fail with `COSSACK_RPC_SERIALIZATION_FAILED` and the offending value path.

HTTP/SSE RPC redirects return metadata that the client proxy uses to navigate.
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

Use the error's `code` for application decisions. Internal exception messages
and stacks stay in server logs, including service RPC in development. Deliberate
`ClientVisibleError` messages and validation field errors remain visible.
Correlated server failures carry `requestId`. HTTP/SSE and service failures retain
the response's request ID on invalid JSON, mid-stream deadlines, and network
disconnects. Before response headers arrive, the server-generated HTTP request ID
may be unavailable; local pre-dispatch failures and cancellation also need not
have one. `status` describes an HTTP failure and is absent on WebSocket failures.

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
| Ownership | HTTP request scopes close with the response; WebSocket component ownership lasts until runtime teardown. |
