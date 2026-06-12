# Server-Sent Events (SSE) Transport

SSE is a lightweight transport that provides real-time server-to-client state sync on **plain Cloudflare Workers** — no Durable Object or WebSocket required. The client sends actions via HTTP POST (`/crpc`), and the server pushes state updates to all connected clients via a long-lived SSE connection.

This is ideal for pages that need real-time updates (live counters, chat, streaming text) but don't require full bidirectional communication or persistent state.

## Usage

Decorate your page component with `@Page({ transport: 'sse' })`:

```typescript
import { Page, State, Server, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'sse' })
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

## Async Generator Streaming

SSE transport supports streaming responses using `async *` generator methods. This is useful for chat, AI responses, or any scenario where the server produces output incrementally.

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

1. The client calls the `@Server` async generator method via `/crpc`.
2. The server detects the method returns an `AsyncIterable` and registers it in the SSE store.
3. The SSE endpoint's polling loop pulls one value from the generator on each tick (~200ms).
4. Each yielded value is sent as a `yield` SSE event to the client.
5. After each pull, the server syncs state changes (e.g., `streamingText`, `isStreaming`) from the generator's source instance to the SSE store entry.
6. When the generator completes, a `stream-done` event is sent to the client.

---

## Multi-Tab Support

All browser tabs open on the same URL share the **same SSE state store entry**. When any tab triggers an action:

1. The server processes the action and updates the shared component instance.
2. The version counter is bumped.
3. **Every** connected SSE client (all tabs) receives the state update and re-renders.

The first tab to load the page creates the SSE store entry during SSR. Subsequent tabs reuse it — they do not create new component instances or overwrite existing state.

---

## Architecture

```
Client (Browser)                    Server (Cloudflare Worker)
┌─────────────┐                    ┌──────────────────────────┐
│             │ ──── GET /sse ───► │ SSE Endpoint             │
│  SSE        │ ◄── state-update ── │  (TransformStream)       │
│  Connection │ ◄── yield ────────  │  Polls shared store      │
│             │ ◄── stream-done ──  │  every 200ms             │
│             │                    │                          │
│             │ ── POST /crpc ───► │ CRPC Handler             │
│             │                    │  Resolves component       │
│             │                    │  Applies state            │
│             │                    │  Calls action             │
│             │ ◄── JSON resp ──── │  Bumps version counter   │
└─────────────┘                    └──────────────────────────┘
```

- **Actions**: Sent via HTTP POST to `/crpc`. The server creates a fresh component instance per request, applies the client's state, calls the method, and syncs the result back to the shared SSE store entry.
- **State sync**: The SSE endpoint polls a shared `Map` (`sseStateStore`). When `/crpc` bumps the `stateVersion` counter, the SSE driver detects the change on its next tick and pushes a `state-update` event.
- **Heartbeat**: A heartbeat comment (`: heartbeat\n\n`) is sent every 15 seconds to prevent Cloudflare Workers from closing idle connections (~30s timeout).

---

## SSE Event Types

The SSE connection uses the following event types:

| Event | Direction | Description |
|-------|-----------|-------------|
| `state-update` | Server → Client | Full public state object. Sent on initial connect and after each action. |
| `connected` | Server → Client | Sent once after initial state. Confirms the connection is active. |
| `yield` | Server → Client | A single yielded value from an async generator (`{ streamId, value }`). |
| `stream-done` | Server → Client | Generator completed (`{ streamId }`). |
| `stream-error` | Server → Client | Generator threw an error (`{ streamId, error }`). |
| `: heartbeat` | Server → Client | SSE comment to keep the connection alive. |

---

## Constraints

- **Server-to-client only**: SSE is a one-directional protocol. Client actions are sent via separate HTTP POST requests, not through the SSE connection itself.
- **Plain Workers**: No Durable Object binding required. State lives in-memory within the Worker's global scope. State is **not persisted** across Worker restarts.
- **Per-URL state**: The SSE store is keyed by `componentRouteId:pathname`. Different URLs have independent state.
- **Cold starts**: If the SSE endpoint receives a connection before SSR has registered the store entry (e.g., direct navigation), it creates a component instance on demand with `skipInit: true`.
- **Not for Durable Object pages**: Use `transport: 'durable-object'` for pages that need bidirectional WebSocket communication, persistent state, or multi-user coordination beyond simple broadcast.
