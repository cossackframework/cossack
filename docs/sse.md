---
title: "Server-Sent Events (SSE) Transport"
description: "Lightweight real-time transport using SSE for server-to-client state sync on plain Cloudflare Workers without Durable Objects."
---

# Server-Sent Events (SSE) Transport

SSE sends real-time state updates from the server to connected clients on **plain Cloudflare Workers**. It does not require a Durable Object or WebSocket. The client sends actions with HTTP POST (`/crpc`). The server sends state updates through a long-lived SSE connection.

Use SSE to subscribe to state updates. Async generator action results stream through their own HTTP response and also work on HTTP pages. Shared SSE state currently lives in one Worker instance; cross-instance broadcasts require the distributed backend, which is still pending.

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

### How it works

1. When the page loads, the client opens an SSE connection to `/sse/:componentRouteId`.
2. The server sends the current state as an initial `state-update` event.
3. When the user triggers a server action (e.g., clicking "Increment"), the client sends a POST to `/crpc`.
4. The server processes the action, mutates state, and bumps a version counter on the shared SSE store entry.
5. The SSE endpoint's polling loop detects the version change and pushes a `state-update` event to every connected client.
6. Each client receives the new state and re-renders.

---

## Scope

By default, SSE state is scoped **per-user**. Each authenticated user has separate state. Unauthenticated users share one `anonymous` scope.

The `scope` option controls which users share the same state. It receives the Hono `Context` (with access to the user, route params, query params, env bindings) and returns a scope key string.

> **Note:** `scope` is a shared `@Page` option. For the `durable-object` transport, it selects the Durable Object instance that handles a page. The default scope is per URL. See [WebSockets: Scope](./websockets.md#scope-controlling-which-durable-object-instance-a-page-connects-to).

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

Connected users with the same `teamId` can receive the same state updates when their requests reach the same Worker instance.

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

Every user on this page shares the same state. This matches the behavior before scope support.

### How scope works

The scope function runs during SSR and is recomputed for each subscription and action using the authenticated request and forwarded page parameters. The browser receives the SSR scope key, but cannot use it to authorize another scope.

1. **SSR** : evaluates `scope(c)`, registers the SSE store entry with the scoped key, includes `scopeKey` in the initial state sent to the client
2. **`/sse` endpoint** : receives `scopeKey` as a query param from the client, looks up the store entry
3. **`/crpc`** : receives `scopeKey` in the request body, syncs state to the correct scoped entry

---

## Async Generator Streaming

HTTP and SSE pages support streaming action responses using `async *` generator methods. This is useful for chat, AI responses, or other incremental results.

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
automatically. The first consumer chooses iteration or promise consumption;
a second iterator fails instead of executing the action again. Awaiting a call
after iteration observes the same completion.

Frames use `application/x-cossack-rpc+ndjson` and have a maximum size of 1 MiB.
Both ends parse or produce frames incrementally. State edits made by the client
while a call is pending remain protected from stale responses.

Cancellation requests generator closure. A generator must finish its current
pending operation before JavaScript can run its `finally` block. Pass the
request's abort signal to cancellable external operations. There is no automatic
mutation retry.

HTTP and SSE component action failures now reject their calls. Catch failures
in client handlers when the application should show an error. `RpcError` exposes
`code`, an optional HTTP `status`, and a server `requestId` when available.
This replaces the previous behavior that logged failures and resolved with
`undefined`. WebSocket and explicit service RPC parity remain separate work.

Cookie, session, and redirect headers must be decided before returning a stream;
HTTP headers cannot change after streaming starts.

## Multi-Tab Support

The current SSE subscription backend polls an in-memory store keyed by
`componentRouteId:scopeKey`. Other subscribers in the same Worker instance can
receive public state updates after action frames. Generator values belong only
to the response that invoked the action.

This is not durable or distributed coordination. SSR replaces the stored
component for its scope, and updates can be lost across Worker instances or
restarts. Use Durable Object transport when shared state must be coordinated.

## SSE Event Types

| Event | Description |
|-------|-------------|
| `state-update` | Public state on initial connection and after an action changes the stored version. |
| `connected` | Confirms that the subscription is active. |
| `: heartbeat` | Periodic SSE comment. |

Action yields, completion, and failures are response frames, not SSE events.

## Constraints

- **Server-to-client only**: SSE is a one-directional protocol. Client actions are sent via separate HTTP POST requests, not through the SSE connection itself.
- **Plain Workers**: No Durable Object binding required. State lives in-memory within the Worker's global scope. State is **not persisted** across Worker restarts.
- **Per-scope state**: The SSE store is keyed by `componentRouteId:scopeKey`. Default scope is per-user. Use `scope` to customize (per-team, per-room, shared, etc.).
- **Cold starts**: If the SSE endpoint receives a connection before SSR has registered the store entry (e.g., direct navigation), it creates a component instance on demand with `skipInit: true`.
- **Separate from Durable Object pages**: Use `transport: 'durable-object'` for pages that need bidirectional WebSocket communication, persistent state, or multi-user coordination beyond simple broadcast.

## Scope access

The server recomputes the scope for every subscription and SSE RPC request.
This includes custom `scope(c)` functions. A browser-supplied scope key cannot
authorize access to another user's stream. The client forwards page query values
and route params so the same scope function can run again.

Check membership inside custom scope functions that accept room or tenant IDs.
These IDs remain client input. The default anonymous scope is shared by guests.
Use a validated session-based scope for private guest data.

HTTP RPC and upload requests require an allowed `Origin` header. The default is
the request's own origin. Set `createApp({ allowedOrigins: [...] })` for explicit
additional origins. Non-browser callers must send a matching header too.
