---
title: "Server-Sent Events (SSE) Transport"
description: "Real-time transport with distributed scope coordination on Cloudflare and a process-local backend for Node."
---

# Server-Sent Events (SSE) Transport

SSE sends real-time state updates from the server to connected clients. The
client sends actions with HTTP POST (`/crpc`, or `/upload` for File arguments). The server sends state updates
through a long-lived SSE connection.

SSE pages use one of two backends, selected by the runtime:

- Cloudflare Workers use distributed coordination. Scope state lives in a
  SQLite-backed Durable Object (`SseDurableObject`, binding `COSSACK_SSE`).
  State is shared across Worker instances, survives restarts, and actions are
  serialized per scope.
- Node uses a process-local backend. State lives in an in-memory store
  inside one process. This is a development convenience, not durable
  coordination. See [Runtime backends](#runtime-backends).

## Cloudflare setup

Generated Cloudflare applications are already configured. In an existing
application, add the binding to `wrangler.jsonc` and export the class from the
Worker entry:

```jsonc
{
  "compatibility_flags": ["nodejs_als", "enable_request_signal"],
  "durable_objects": {
    "bindings": [{ "name": "COSSACK_SSE", "class_name": "SseDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SseDurableObject"] }]
}
```

```typescript
// src/index.ts
import { SseDurableObject } from '@cossackframework/framework/SseDurableObject';
export { SseDurableObject };
```

`SseDurableObject` uses `new_sqlite_classes` (not `new_classes`) because it
stores its snapshot and event log in the Durable Object's SQLite storage.

Cloudflare environments do not inherit bindings. Every named environment
that deploys SSE pages must re-declare the `durable_objects` binding. The
deployment preflight fails with `COSSACK_ENV_BINDING_NOT_INHERITED` when the
selected environment is missing it. An SSE page running on Cloudflare without
the binding fails with `COSSACK_SSE_BINDING_MISSING` (HTTP 500 on `/crpc`,
`/sse`, and the SSR route) instead of falling back to process-local
state.

Keep `enable_request_signal` in the selected environment's compatibility flags.
It enables incoming HTTP disconnect notifications. `cossack check cloudflare`
and deploy preflight report `COSSACK_REQUEST_SIGNAL_REQUIRED` for a coordinator
configuration without it. Compatibility flags inherit unless the named
environment overrides them. Preserve `nodejs_compat` if your app needs it.
Add the flag to existing configuration
explicitly. See [Cloudflare's Request.signal documentation](https://developers.cloudflare.com/workers/runtime-apis/request/).

## Usage

Decorate your page component with `@Page({ transport: 'sse' })`:

```typescript
import { Page, State, Server, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'sse' }) // Per-user by default
export class LiveCounter extends Cossack {
    @State()
    private count: number = 0;

    @Server()
    private increment() {
        this.count++;
    }

    protected render() {
        return html`
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>Increment</button>
        `;
    }
}
```

### How it works (Cloudflare coordinator)

1. SSR evaluates the page scope and calls `initialize()` on the scope's
   Durable Object with the rendered page's public state. First initialization
   wins: rendering another tab, or SSR after a restart, never resets shared
   state. If the scope already exists, SSR hydrates the authoritative snapshot
   so the HTML shows the shared state.
2. When the page loads, the client opens an SSE connection to
   `/sse/:componentRouteId`. The endpoint re-evaluates the scope with the live
   authenticated request, then streams the authoritative snapshot followed by
   incremental events. Each event carries its cursor as the SSE `id`, so the
   browser's automatic `EventSource` reconnect sends `Last-Event-ID` and
   resumes without replaying delivered events.
3. When the user triggers a server action, the client POSTs to `/crpc` or sends
   multipart File arguments to `/upload`. Both use the same scoped dispatcher. The
   router executes the action inside the coordinator's per-scope serialization
   slot and hydrates the component from the authoritative snapshot, not from
   the browser's state. Request middleware, layout DI, ORM scope, configuration,
   rate limits, and the `@Server` allowlist all apply as usual.
4. Generator actions stream NDJSON frames back through the coordinator. Each
   frame's state is published to the scope. Ordinary results, redirects
   (`_cossack_redirect`), and custom `Response` objects pass through the
   coordinator after publishing the final state once.
5. Every subscribed client receives `state-update` events. When the event
   history for a cursor has expired, the subscriber receives a fresh
   authoritative snapshot instead of a gap.

## Session changes on an open subscription

Authenticated SSE needs `createAuth({ realtime: { key, capture, validate }, ... })`.
The generated auth recipe supplies this provider. An authenticated application
without the capture hook receives HTTP 409 with
`COSSACK_REALTIME_AUTH_REQUIRED` when it opens `/sse`. Anonymous pages can still
subscribe. Their middleware and scope are also validated before delivery.
Capture/storage failures instead return fixed HTTP 503
`COSSACK_REALTIME_AUTH_UNAVAILABLE`, without the provider exception text.

`key` is a stable application name, such as `app.sessions`. `capture(sessionId,
userId, context)` returns a server-only JSON descriptor. `validate(data, context)`
reads current storage and returns the current owner ID, or `null`. Auth then
loads the current user and roles through `resolveUserById`. The framework keeps
its auth integration structural and does not import the auth or database package.

The generated descriptor contains the session's independent public reference
and a SHA-256 fingerprint of its random token. The reference survives rotation.
The fingerprint changes. Validation tests both against a live, unexpired auth
session. A reference alone keeps an old subscription valid after rotation.
Never put a bearer token in the descriptor, public state or event payloads.
Keep even the fingerprint server-only. Descriptors must be plain JSON, at most
1024 encoded bytes, with at most 128 visited values and 16 nesting levels.
Accessors, reserved prototype keys, sparse arrays and unsupported values reject.

Before each snapshot, replay frame, event or heartbeat, the framework runs a
fresh request, configuration and ORM scope. It also runs global middleware and
inherited page/layout
guards. It resolves fresh user data and requires the same owner and computed
scope as at subscription time. The original page params and resolved locale
remain available. Cookie, Authorization and common credential/assertion headers
are removed from the validation request. Middleware must use its revalidation
provider rather than reread a login cookie. It cannot renew a cookie or change
response headers after the stream starts. Middleware denial, provider
failure, missing user, revoked/expired/rotated session or changed scope ends delivery.

The server sends `authorization-error` with `COSSACK_REALTIME_AUTH_CHANGED` and
closes the stream. The browser closes EventSource, stops its automatic retries
and reports a fixed error in `this.realtime.sse.lastError`. Reload the page to
open a subscription with the current cookie. Other authorized subscribers in
the same scope continue receiving updates. This behavior applies to both SSE
backends.

Validation runs before emission. A frame that passed validation can already be in
flight when another request revokes the session. An idle stream validates before
its next 15-second heartbeat while the reader has demand. Network buffering,
backpressure or slow application storage can delay it. There is no atomic
revocation barrier or fixed wall-clock closure guarantee. Each delivery invokes
auth storage and guard callbacks, so keep those callbacks read-only and fast.

## Shared state semantics

- The scope's authoritative state belongs to the page root. A child
  addressed by RPC `target` returns its own public state to its caller. Its
  generator frames also carry the page's `scopeState` for the coordinator.
  Ordinary and streaming child actions preserve the page snapshot, including
  when child and page state keys have identical names. The process-local
  backend also publishes the page root rather than child-local state.
- Child components and services not addressed by the action keep
  request-local state. Their state is not shared through the scope. Page
  components injected with a declared service mirror the service's `@State`
  keys into the page's public state, which then round-trips through the
  coordinator.
- A stale browser snapshot cannot overwrite shared state. `/crpc` hydrates
  from the coordinator's snapshot. The client-sent state is only applied to
  child targets, whose state the scope does not track.
- Cancelled queued actions do not start. The router assigns a private
  operation ID, distinct from the caller's correlation ID, and cancels it when
  the request signal aborts or the response body is cancelled. Cancellation removes that queued entry without
  releasing the active action's slot or changing the order of other callers.
  A pending counter decision receives an abort signal. Its late reply cannot
  invoke the action. Application work that already started can finish and have
  external side effects. It is never replayed or rolled back. A lost response
  does not prove that a mutation failed.
- Component event broadcasts preserve the public snapshot.
  `broadcastEvent(...)` and client actions append `event`/`client-action` events.
  The coordinator runtime suppresses delayed partial-state broadcasts. Action
  results publish full public state inside their serialization slot. Direct use
  of the reserved coordinator `state-update` event replaces the snapshot. Do not
  send a partial object through that low-level event.
- Serialization is per scope. Concurrent actions on the same scope execute
  one at a time. Different scopes run in parallel. The pending-action queue is
  bounded (HTTP 429 `COSSACK_SSE_BUSY` beyond 32 pending actions per scope).
  `queueStatus()` reports pending/queued counts and whether a slot is active.
  It contains no caller or operation IDs. Cancellation releases response-body
  ownership without waiting for an uncooperative producer's cancel hook.
  Arbitrary application methods have no server execution deadline.
  The installed
  workerd baseline does not deliver a pre-header TCP disconnect notification,
  even in a minimal Worker with the flag.
- History is bounded. The event log keeps at most 128 events and 1 MiB of
  event data per scope. Subscribers with older cursors are resynchronized from
  the snapshot.

## Optimistic confirmation and snapshot order

State publications include the originating action's `_cossack_request_id` when available.
The SQLite snapshot remains plain public state. The event's `id` supplies its cursor.
A page action's JSON reply carries `X-Cossack-SSE-Cursor`. Generator frames carry
`_cossack_sse_cursor` in their state. These reserved values never hydrate public fields.
Child replies keep their own state domain and do not carry the parent page cursor.

A matching event confirms the pending public preview once. Loading stays active until
the action settles. Older replies still return their action result, but cannot replace
newer public state. A higher cursor supplies authority even for equal values after
settlement. ClientState and ClientStore drafts remain local. A reopened EventSource
resets the client's cursor baseline before the server's snapshot is applied.

Node uses increasing process publication IDs across SSR replacement and entry
recreation. Scopes can observe gaps in these IDs. A restart loses this order, and the
backend has no durable history or cross-process coordination. Cloudflare retains its
per-scope SQLite event history and resynchronizes when history expires.

## Runtime backends

| Runtime | Backend | Guarantees |
| --- | --- | --- |
| Cloudflare Workers | `SseDurableObject` via the `COSSACK_SSE` binding | Shared across instances and requests, SQLite-persisted across restarts, per-scope action serialization, and bounded event history with cursor reconnect. |
| Node.js | Process-local in-memory store | Same endpoint and `/crpc` contracts, but state is per-process: it is not shared across machine boundaries, does not survive restarts, and SSR resets the stored entry. Actions still hydrate the client-sent state because there is no authoritative server-side snapshot. |

The process-local backend is not a Cloudflare fallback. If an
SSE page runs on Cloudflare without the `COSSACK_SSE` binding, requests fail
with a diagnostic instead of degrading to per-isolate
state. Applications that need cross-process coordination on Node must
front multiple instances with a single process.

## Scope

By default, SSE state is scoped per-user. Each authenticated user has
separate state. Unauthenticated users share one `anonymous` scope.

The `scope` option controls which users share the same state. It receives the
Hono `Context` (with access to the user, route params, query params, env
bindings) and returns a scope key string.

> `scope` is a shared `@Page` option. For the `durable-object` transport, it selects the Durable Object instance that handles a page. The default scope is per page instance (component plus route params, ignoring host and query string). See [WebSockets: Scope](./websockets.md#scope-controlling-which-durable-object-instance-a-page-connects-to).

### Default: Per-User

```typescript
// No scope needed — each user gets isolated state
@Page({ transport: 'sse' })
```

### Per-Team

```typescript
@Page({
    transport: 'sse',
    scope: (c) => `team:${c.get('user').teamId}`
})
```

Connected users with the same `teamId` share one coordinator scope regardless
of which Worker instance serves their requests.

### Per-Room

```typescript
@Page({
    transport: 'sse',
    scope: (c) => `room:${c.req.query('room') || 'lobby'}`
})
```

### Shared (Broadcast to All Users)

```typescript
@Page({
    transport: 'sse',
    scope: () => 'shared'
})
```

Every user on this page shares the same coordinator scope.

### How scope works

The scope function runs during SSR and is recomputed for each subscription and
action using the authenticated request and forwarded page parameters. The
browser receives the SSR scope key, but cannot use it to authorize another
scope. On Cloudflare, the scope key and the component route ID form a
collision-safe tuple that names the coordinator's Durable Object instance.

1. SSR evaluates `scope(c)`, initializes or hydrates the coordinator scope, and includes `scopeKey` in the initial state sent to the client.
2. The `/sse` endpoint re-evaluates the scope and rejects a mismatched `scopeKey` with 403 before subscribing.
3. `/crpc` re-evaluates the scope, rejects mismatches with 403, and executes the action inside the scope's serialization slot.

## Async Generator Streaming

HTTP and SSE pages support streaming action responses using `async *` generator methods. Use it for chat, AI responses, or other incremental results.

For typed yields and completion in a client handler, use
`const call = rpc$(this.sendMessage(text))`, iterate `call`, then await `call`
for its final result. Ordinary methods yield no values. See
[server calls and client types](./rpc.md) for inference and cancellation.

### Example: Streaming Chat

```typescript
import { Page, State, Server, Client, ClientState, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

@Page({ transport: 'sse' })
export class SseChat extends Cossack {
    @State()
    messages: ChatMessage[] = [];

    @State()
    streamingText: string = '';

    @State()
    isStreaming: boolean = false;

    @ClientState()
    inputValue: string = '';

    @Client()
    handleSubmit(e: Event) {
        e.preventDefault();
        const text = this.inputValue;
        if (!text.trim() || this.isStreaming) return;
        this.inputValue = '';
        this.sendMessage(text);
    }

    @Server()
    async *sendMessage(text: string) {
        this.messages = [...this.messages, { role: 'user', content: text.trim() }];
        this.isStreaming = true;
        this.streamingText = '';

        const words = text.split(' ');
        for (const word of words) {
            await new Promise(r => setTimeout(r, 200));
            this.streamingText += word + ' ';
            yield word;
        }

        this.messages = [...this.messages, { role: 'assistant', content: this.streamingText.trim() }];
        this.streamingText = '';
        this.isStreaming = false;
    }

    protected render() {
        return html`
            <div class="messages">
                ${this.messages.map((m: ChatMessage) => html`
                    <div class="msg ${m.role}">${m.content}</div>
                `)}
                ${this.isStreaming ? html`
                    <div class="msg streaming">${this.streamingText}|</div>
                ` : ''}
            </div>
            <form @submit=${this.handleSubmit}>
                <input .value=${this.inputValue} @input=${(e: Event) => this.inputValue = (e.target as HTMLInputElement).value} />
                <button type="submit" ?disabled=${this.isStreaming}>Send</button>
            </form>
        `;
    }
}
```

### How streaming works

1. Calling the method starts one HTTP POST to `/crpc`.
2. The server awaits ordinary promises and detects async iterable results.
3. Each reader pull advances the generator and returns a versioned `yield` frame with its value and public state.
4. A `done` frame contains the final return value and public state. An `error` frame contains a stable error code, a request ID, and a message. Internal exceptions are logged on the server and redacted in the response.
5. Completion, failure, or cancellation closes the generator and releases the request's components and services.

On SSE pages under the Cloudflare coordinator, the action runs inside the
scope's serialization slot and every frame's state is published to the scope,
so other subscribers observe progress while the caller streams.

Use `for await` to consume yielded values. Breaking the loop cancels the response:

```typescript
@Client()
async displayWords(text: string) {
    try {
        for await (const word of this.sendMessage(text)) {
            console.log(word);
        }
    } catch (error) {
        console.error('Streaming failed', error);
    }
}
```

At runtime, awaiting a streaming call drains its yields, applies state updates,
and returns the generator's final result. Calls ignored by event handlers drain
automatically. The first consumer chooses iteration or promise consumption. A
second iterator fails instead of executing the action again. Awaiting a call
after iteration observes the same completion.

Frames use `application/x-cossack-rpc+ndjson` and have a maximum size of 1 MiB.
Both ends parse or produce frames incrementally. State edits made by the client
while a call is pending remain protected from stale responses. A streaming
response owns its serialization slot until it finishes, fails, or the caller
cancels it. Cancelling the response body releases the slot.

Cancellation requests generator closure. A generator must finish its current
pending operation before JavaScript can run its `finally` block. Pass the
request's abort signal to cancellable external operations. There is no automatic
mutation retry.

HTTP and SSE component action failures reject their calls. Catch failures
in client handlers when the application must show an error. `RpcError` exposes
`code`, an optional HTTP `status`, and a server `requestId` when available.

Cookie, session, and redirect headers must be decided before returning a
response. HTTP headers cannot change after streaming starts. Ordinary
(non-streaming) results and redirects are handled identically on both
backends: redirects return `{ _cossack_redirect }` JSON, and cookies set
through the request context and native Response cookies are preserved. This
also applies when an ordinary method sets cookies and then returns a lazy
generator. A cookie write inside the generator body happens after the response
headers commit and rejects with `COSSACK_RESPONSE_HEADERS_COMMITTED`.

Successful ordinary native Responses use the [RPC native-body contract](./rpc.md):
the client drains a bounded body before completion. The coordinator preserves
their bytes, status and headers, even when their MIME type is RPC NDJSON. The
reserved `X-Cossack-Rpc-Response: native` header distinguishes user data from
protocol frames. Native bodies still own request cleanup and the serialization
slot until completion, failure or cancellation.

## Connection status and recovery

`this.realtime.sse` exposes the subscription health:
`state` (`connecting`, `open`, `reconnecting`, or `closed`), `attempts`,
`lastEventId` (the last delivered cursor), `lastError`, and `resynced`. The
`resynced` field is set when a reconnect had to replace expired history with an
authoritative
snapshot. WebSocket providers expose the same fields per provider under
`this.realtime.websockets` with bounded reconnect backoff. See
[WebSockets](./websockets.md#connection-status). Pending calls that lose their
transport reject with an explicit uncertain-outcome error and are never
replayed.

Destroying an SSE page sets its connection status to `closed` before closing the
EventSource. The browser does not emit a close event for that operation. A retired
or replaced source cannot publish late state, cursor updates, actions or events.
A destroyed component cannot reconnect. Shared layout services remain active when
only their child page changes between HTTP and SSE.

## SSE Event Types

| Event | Description |
|-------|-------------|
| `state-update` | Authoritative snapshot on connection, incremental public state after action frames, and partial state broadcasts. |
| `event` | Application broadcast emitted by `broadcastEvent(...)` in a server action. |
| `client-action` | Server-initiated client method invocation. |
| `connected` | Confirms that the subscription is active. |
| `: heartbeat` | Periodic SSE comment. |

Every event carries `id: <cursor>`. Reconnecting with `Last-Event-ID` (sent
automatically by `EventSource`) resumes after the delivered cursor. State
events can be re-delivered idempotently, but events the client already observed
are not replayed twice. When the cursor's history has expired, the client
receives a fresh `state-update` snapshot instead.

Action yields, completion, and failures are response frames, not SSE events.

## Constraints

- Server-to-client only: SSE is a one-directional protocol. Client actions are sent via separate HTTP POST requests, not through the SSE connection itself.
- Cloudflare binding required: SSE pages on Cloudflare need the `COSSACK_SSE` Durable Object binding. Missing bindings produce `COSSACK_SSE_BINDING_MISSING` diagnostics.
- Environment inheritance: Cloudflare environments do not inherit bindings. Re-declare `durable_objects` per environment.
- Per-scope state: Coordinator scopes are keyed by the `[componentRouteId, scopeKey]` tuple. The default scope is per-user. Use `scope` to select per-team, per-room, or shared state.
- Cold starts: If the SSE endpoint receives a connection before SSR has initialized the scope, it constructs a component instance on demand with `skipInit: true` and initializes the scope. First initialization wins.
- Separate from Durable Object pages: Use `transport: 'durable-object'` for pages that need bidirectional WebSocket communication or per-page persistent actors. The SSE coordinator coordinates shared scope state, not component lifecycles.

## Scope access

The server recomputes the scope for every subscription and SSE RPC request.
This includes custom `scope(c)` functions. A browser-supplied scope key cannot
authorize access to another user's stream. The client forwards page query values
and route params so the same scope function can run again.

Test membership inside custom scope functions that accept room or tenant IDs.
These IDs remain client input. The default anonymous scope is shared by guests.
Use a validated session-based scope for private guest data.

HTTP RPC and upload requests require an allowed `Origin` header. The default is
the request's own origin. Set `createApp({ allowedOrigins: [...] })` for explicit
additional origins. Non-browser callers must send a matching header too.
