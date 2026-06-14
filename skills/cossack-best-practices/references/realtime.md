# Real-Time State Sync

Cossack supports real-time state synchronization via two transports. **Do not wire up WebSockets or SSE by hand** — use the built-in transport options on `@Page`.

## Choose a transport

| Transport | When to use | Persistent state | Bidirectional |
|---|---|---|---|
| `http` (default) | Standard request/response. No real-time. | No | No |
| `sse` | Server-to-client push on plain Workers. Live counters, chat, streaming text. | No (in-memory) | Actions via POST |
| `durable-object` | Multi-user coordination, persistent state, bidirectional. | Optional (`stateful: true`) | Yes (WebSocket) |

Rule of thumb: start with `sse`. Reach for `durable-object` only when you need persistent state in the DO itself or full bidirectional comms.

## Scope (SSE & Durable Object)

The `scope` option on `@Page` determines **which state backend** a request connects to — the SSE store entry, or the Durable Object instance. It receives the Hono `Context` and returns a scope-key string. It works for **both** real-time transports; only the default differs:

| Transport | Default scope | What `scope` overrides |
|---|---|---|
| `sse` | per-user (`user:${user?.id \|\| 'anonymous'}`) | Which SSE store entry is used |
| `durable-object` | per-URL (`c.req.url`) | Which Durable Object **instance** the page routes to |

```typescript
// SSE — per-team
@Page({ transport: 'sse', scope: (c) => `team:${c.get('user').teamId}` })

// SSE — per-room from query string
@Page({ transport: 'sse', scope: (c) => `room:${c.req.query('room') || 'lobby'}` })

// SSE — broadcast to everyone
@Page({ transport: 'sse', scope: () => 'shared' })

// Durable Object — route all members of a team to the same DO instance
@Page({ transport: 'durable-object', scope: (c) => `team:${c.get('user').teamId}` })

// Durable Object — one DO instance per room (shared whiteboard, multiplayer)
@Page({ transport: 'durable-object', stateful: true, scope: (c) => `room:${c.req.param('roomId')}` })
```

The scope function is evaluated **once during SSR** with the full request context (including params and query). The resulting `scopeKey` is:
- embedded in the page's initial state, and
- reused by the `/sse` endpoint, `/crpc` handler, **and** as the Durable Object ID name — so all three contexts agree on the same backend even when scope depends on query params not present in later requests.

For DO transport, `scope` is the mechanism for **multiplayer**: users (or tabs) that resolve to the same scope key land on the same DO instance and share state. Without `scope`, each URL gets its own DO instance.

---

## SSE transport

Real-time server-to-client sync on **plain Cloudflare Workers** — no Durable Object binding required. Actions are sent via HTTP POST (`/crpc`); state updates are pushed over a long-lived SSE connection.

```typescript
import { Page, State, Server, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'sse' }) // per-user scope by default
export class LiveCounter extends Cossack {
    @State() private count: number = 0;

    @Server()
    private increment() {
        this.count++; // pushed to all connected clients automatically
    }

    protected render() {
        return html`<p>${this.count}</p><button @click=${this.increment}>+</button>`;
    }
}
```

SSE defaults to per-user scope. See [Scope](#scope-sse--durable-object) above for per-team / per-room / shared variants (the same option also applies to Durable Object transport).

### Streaming with async generators

SSE supports `async *` generator server methods — ideal for chat, AI responses, incremental output:

```typescript
@Server()
async *sendMessage(text: string) {
    this.isStreaming = true;
    for (const word of text.split(' ')) {
        await new Promise(r => setTimeout(r, 200));
        this.streamingText += word + ' ';
        yield word; // each yield is pushed to the client
    }
    this.isStreaming = false;
}
```

Each yielded value is sent as a `yield` SSE event; completion sends `stream-done`. State mutations inside the generator (`streamingText`, `isStreaming`) sync on each tick.

### SSE constraints

- **Server-to-client only.** Client actions go via separate HTTP POSTs, not the SSE stream.
- **In-memory state.** Not persisted across Worker restarts. Use a DB as the source of truth.
- **Multi-tab.** All tabs on the same URL share the same store entry — when any tab triggers an action, all tabs re-render.
- **Heartbeat.** The framework sends a keepalive comment every 15s (Workers close idle connections ~30s).

---

## Durable Object transport

Full bidirectional WebSocket real-time with optional persistent state. Requires a `COSSACK_OBJECT` DO binding in `wrangler.jsonc` and an `AppDurableObject` export from `src/index.ts`.

```typescript
@Page({ transport: 'durable-object' })              // stateless (default)
@Page({ transport: 'durable-object', stateful: true }) // persists to DO storage
```

Use `stateful: true` when the DO is the source of truth (counters, whiteboards, anything that must survive eviction/reconnection). Keep it stateless when a DB is the source of truth.

By default, each URL gets its own DO instance (per-URL scope). Use the `scope` option to route users to the **same** DO instance — this is how you build multiplayer (shared whiteboards, chat rooms, collaborative docs). See [Scope](#scope-sse--durable-object) above; the same `scope` option works for both SSE and DO.

### Three pillars: Providers, Channels, Events

- **StateProvider** (the *where*): which backend the component connects to. Default is `PageStateProvider` (scoped to the current URL). Custom providers exist for user-session or global scopes.
- **Channel** (the *what*): a logical partition within a provider for efficient **partial** state updates. Default is `global`.
- **Event** (the *when*): a stateless broadcast message used by the Event-Driven Re-fetch pattern.

### Pattern 1 — Automatic State Synchronization

Simplest. For UI state not in a DB. When a `@Server()` method mutates a `@State()`, the framework auto-detects the change and broadcasts a partial update to all clients.

```typescript
@Page({ transport: 'durable-object' })
export class Counter extends Cossack {
    @State() private count: number = 0;

    @Server()
    private increment() {
        this.count++; // that's it — UI updates on every connected client
    }
}
```

### Pattern 2 — Event-Driven Re-fetch (recommended for DB mutations)

Most robust and secure. For actions that modify a shared source of truth or need permission checks. The server broadcasts a stateless **event**; clients re-fetch within their own permission context.

```typescript
@Page({ transport: 'durable-object' })
export class Tasks extends Cossack {
    @State() private tasks: Task[] = [];

    async init() {
        this.tasks = await db.getTasksForUser(this.user); // permission-scoped
    }

    @Server()
    private async deleteTask(taskId: number) {
        await db.tasks.delete(taskId);
        this.broadcastEvent('tasks:changed'); // event, NOT the new state
    }

    @OnEvent('tasks:changed')
    private async onTasksChanged() {
        await this.init(); // each client re-fetches in its own context
    }
}
```

Prefer Pattern 2 whenever a mutation touches a database or involves permissions.

### Multi-channel partial updates

Partition state into channels so an update only ships the affected slice:

```typescript
@Page({ transport: 'durable-object', channels: ['feeds', 'notifications'] })
export class Dashboard extends Cossack {
    @State({ channel: 'feeds' })         private feedCount: number = 0;
    @State({ channel: 'notifications' }) private notificationCount: number = 0;

    @Server({ channel: 'feeds' })         bumpFeeds()         { this.feedCount++; }
    @Server({ channel: 'notifications' }) bumpNotifications() { this.notificationCount++; }
}
```

Calling `bumpFeeds()` broadcasts **only** `feedCount` — never `notificationCount`.

### Server-to-client method calls

From a `@Server()` method you can directly invoke `@Client()` methods; they run on every connected client:

```typescript
@Server()
async updateData() {
    // ... mutate state ...
    this.showNotification('Data updated!'); // runs on all clients
}

@Client()
private showNotification(message: string) {
    alert(message);
}
```

### Required wrangler.jsonc binding

```jsonc
{
    "durable_objects": {
        "bindings": [{ "name": "COSSACK_OBJECT", "class_name": "AppDurableObject" }]
    },
    "migrations": [{ "tag": "v1", "new_classes": ["AppDurableObject"] }]
}
```

And export from `src/index.ts`:
```typescript
import { AppDurableObject } from './DurableObject';
export { AppDurableObject };
export default { fetch: app.fetch };
```
