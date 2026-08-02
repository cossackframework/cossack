# Server / Client Method Calling (RPC)

Cossack's defining feature: **a single component class runs on both server and client, and methods call each other directly.** You write `this.someMethod(args)`; the framework decides whether to run it locally or proxy it to the server. There is no `fetch()`, no API route to hand-wire, no serialization boilerplate.

> **Before you write `fetch('/api/...')` — stop.** A `@Server()` method is the built-in way to call the server from the client. A `@Client()` method is the built-in way for the server to invoke code on every connected client.

## The mental model

```
@Server()    →  method body runs on the SERVER only.
                  On the client, the method is replaced with an async proxy
                  that calls the server automatically.

@Client()    →  method body runs on the CLIENT only.
                  On the server, it is a no-op — UNLESS called from inside a
                  @Server() method, where it invokes the method on every
                  connected client.

@Shared()    →  method body is retained in BOTH bundles. Runs locally
                  wherever it is called. Also RPC-callable.
```

A method with **no decorator** is treated as server-only (same as `@Server()`): its body is stripped from the client bundle. See the "#1 rule" in `SKILL.md`.

## Calling a server method from the client

Define a `@Server()` method. Call it as `this.method(args)` from a client handler, an event binding in `render()`, or `clientInit()`. The framework generates a proxy per transport — you never write the wire call.

```typescript
import { Cossack, Page, Server, Client, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class UserProfile extends Cossack {
    @State() user: { name: string } | null = null;

    // Runs on the server only. Body is stripped from the client bundle.
    @Server()
    async loadUser(id: number) {
        this.user = { name: 'Ada' }; // mutate @State — synced back to client
    }

    // A client method calls the server method as if it were local.
    @Client()
    async onMount() {
        await this.loadUser(42); // → proxied to server, no fetch()
    }

    render() {
        return html`<h1>${this.user?.name ?? '…'}</h1>`;
    }
}
```

You can also bind a `@Server()` method **directly** as an event handler — methods are auto-bound, and the proxy is installed on the instance:

```typescript
render() {
    return html`<button @click="${this.incrementCount}">+1</button>`;
}

@Server()
async incrementCount() { this.count++; }
```

### Anti-pattern: writing `fetch()` yourself

```typescript
// ❌ Don't do this — reinvents what @Server() already does.
async loadUser(id: number) {
    const res = await fetch(`/api/users/${id}`);
    this.user = await res.json();
}

// ✅ Use the built-in RPC.
@Server()
async loadUser(id: number) {
    this.user = await User.findOne({ where: { id } });
}
```

## Calling a client method from the server

Inside a `@Server()` method, calling `this.someClientMethod(args)` dispatches it to **every connected client**, not just the caller. This is how you push side-effects (toasts, alerts, UI resets) from the server:

```typescript
@Server()
async deleteTask(taskId: number) {
    this.tasks = this.tasks.filter(t => t.id !== taskId);
    this.broadcastEvent('tasks:changed');
    this.showAlert('Task deleted!'); // ← runs on every connected client
}

@Client()
private showAlert(message: string) {
    alert(message);
}
```

## How the proxy works per transport

The transport is set on `@Page({ transport })`. The developer-facing API is identical across all three — only the wire differs:

| Transport | Client→Server wire | Server→Client wire | Notes |
|---|---|---|---|
| `http` (default) | `POST /crpc` with JSON body | (none — state synced via re-render) | File uploads go through a separate `XMLHttpRequest` to `/upload` with progress. |
| `sse` | `POST /crpc` | SSE stream (server push) | Server methods can be `async *` generators — each `yield` is pushed to the client. The proxy is both thenable and async-iterable. |
| `durable-object` | WebSocket message | WebSocket message | Bidirectional. Genuine WebSocket — no fetch at all. |

You do not need to know this to use `@Server()`. It's here so you understand what happens under the hood and can reason about latency, streaming, and what payloads are transportable.

### Transportable arguments

Arguments are serialized before crossing the wire. **Plain objects and arrays** pass through cleanly. The following are **stripped** (not transportable) on the WebSocket / SSE path:

- DOM nodes
- `Event` objects (pass `event.target.value`, not the event)
- `File` / `Blob` (use the upload mechanism instead)
- Functions / class instances with non-serializable internal state

For file uploads, the HTTP transport uses a dedicated `XMLHttpRequest` to `/upload` so progress can be reported.

## `@Server` vs `@Client` vs `@Shared` — at a glance

| Decorator | Runs on server? | Runs on client? | Body in client bundle? | RPC-callable from client? |
|---|---|---|---|---|
| `@Server()` | Yes | No (proxy) | No (stripped) | Yes |
| `@Client()` | No (no-op) | Yes | Yes | No |
| `@Shared()` | Yes | Yes | Yes (retained) | Yes |
| *(none)* | Yes | No (proxy) | No (stripped) | No* |

\* Undecorated methods are server-only by default for code-stripping, but are **not** registered as RPC-callable actions. Mark a method `@Server()` explicitly if the client needs to call it. Only `@Server()` and `@Shared()` methods are exposed as RPC actions.

Use `@Shared()` for pure logic that must run identically on both sides (e.g. a shared validator, a currency formatter) and that the client may also call directly without a round-trip.

## Security

- **Only `@Server()` and `@Shared()` methods are RPC-callable.** The framework checks `cossack:server-methods` metadata on the prototype chain; a method without that metadata is rejected. Internal framework hooks decorated with `@Server()` purely for stripping (e.g. `initializeProviders`) are on a blocklist and cannot be invoked via RPC.
- **Never put secrets in a `@Client()` or `@Shared()` method** — the body is shipped to the browser. Secrets, DB credentials, and API keys belong in `@Server()` methods or `this.env`.
- **The `user` argument is server-injected.** When a `@Server()` method accepts a `user` parameter, the framework injects the authenticated user from the request context — the client cannot forge it. You do not pass `user` from the client.

## `this.loading` is auto-tracked

Every `@Server()` / `@Client()` / `@Shared()` RPC call is automatically counted in `this.loading[methodName]`. See `references/loading.md`.

## Real example

The framework's own demo at `packages/framework/src/pages/tasks/index.ts` shows the full pattern: a `@Server() deleteTask()` method mutates `@State`, broadcasts an event, and calls a `@Client() showAlert()` method — all from within the server method, with the client triggering it via a plain `this.deleteTask(taskId)` call. See `references/realtime.md` for the event-driven re-fetch pattern used there.
