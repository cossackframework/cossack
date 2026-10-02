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

A method returning a native `Response` has an `unknown` client result. The
transport handles HTTP responses and redirects; it does not transfer a native
`Response` instance to the browser. Return a typed data value when a client
handler needs a typed completion value.

Failures reject with `RpcError`, including validation, authorization, timeout,
disconnect, cancellation, and invalid serialization. Do not retry mutations
automatically after a timeout or disconnect: the server outcome may be unknown.
Cancelling response consumption does not roll back a completed mutation.
