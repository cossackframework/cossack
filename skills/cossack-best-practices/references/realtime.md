# Real-Time State Sync

Cossack supports real-time state synchronization via two transports. **Do not wire up WebSockets or SSE by hand** — use the built-in transport options on `@Page`.

## Choose a transport

| Transport | When to use | Persistent state | Bidirectional |
|---|---|---|---|
| `http` (default) | Standard request/response. No real-time. | No | No |
| `sse` | Server-to-client push with a Cloudflare coordinator. Live counters, chat, streaming text. | Coordinator-backed | Actions via POST |
| `durable-object` | Multi-user coordination, persistent state, bidirectional. | Optional (`stateful: true`) | Yes (WebSocket) |

Rule of thumb: start with `sse`. Reach for `durable-object` only when you need persistent state in the DO itself or full bidirectional comms.

## Scope (SSE & Durable Object)

The `scope` option on `@Page` determines **which state backend** a request connects to — the SSE store entry, or the Durable Object instance. It receives the Hono `Context` and returns a scope-key string. It works for **both** real-time transports; only the default differs:

| Transport | Default scope | What `scope` overrides |
|---|---|---|
| `sse` | per-user (`user:${user?.id \|\| 'anonymous'}`) | Which SSE store entry is used |
| `durable-object` | one instance per page (or layout) plus its route params | Which Durable Object **instance** the owner routes to: the owner plus the scope key |

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

Scope is resolved from current authenticated server context for authorized SSR/transport operations. Serialized scope information lets the browser identify a destination; it is not permission to join it. Scope callbacks must be deterministic for the same trusted ownership context. Explicit room/team scope callbacks must verify membership server-side, including revoked access.

Users or tabs resolving to the same component and scope share its backend. A Durable Object instance is always named by its owner (the page file, the layout file or the realtime component's registry id) plus the scope key, so two owners never share an instance and no key names another owner's. A durable-object scope must return a non-empty string. Declare an explicit authorized shared scope for multiplayer rooms; client-provided query/route keys alone are not proof of membership.

---

## SSE transport

Cloudflare SSE requires the `COSSACK_SSE` Durable Object coordinator and `SseDurableObject` Worker export. Node coordination is process-local. Actions are sent via HTTP POST (`/crpc`); state updates are pushed over a long-lived SSE connection.

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

    render() {
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

### Three pillars: Instance, Channels, Events

- **Instance** (the *where*): the one real-time instance an owner connects to over its own WebSocket (`/ws/:id`): a page or layout plus its route params or `scope` key, or a realtime component plus its `scope` key. A child component without a transport uses its host's connection. Use `scope` (for example `scope: c => 'user:' + c.get('user').id`, throwing for anonymous users) for per-user, per-team or per-room state.
- **Channel** (the *what*): a logical partition within an owner's connection for efficient **partial** state updates. Default is `global`.
- **Event** (the *when*): a stateless broadcast message used by the Event-Driven Re-fetch pattern.

### Live state across page files: realtime layouts and components

A page's `scope` shares state among the URLs and tabs of **one page file**. For state that several page files share:

- **Realtime layout**: `@Page({ transport: 'durable-object', scope })` on a `layout.ts`. One instance per layout and scope key, shared by every page below it. Client navigation between those pages keeps the layout and its one connection. A root layout with a per-user scope gives app-wide per-user state.
- **Realtime component**: `@Component({ transport: 'durable-object', scope })`. One instance per component and scope key, shared by every page that embeds it (a cart badge, a notification feed). It has its own connection, separate from the page's.

```typescript
// One instance per signed-in user; never fall back to a shared key.
const perUser = (c: Context) => {
    const user = c.get('user');
    if (!user) throw new ResourceAuthorizationError('COSSACK_AUTH_UNAUTHENTICATED');
    return `user:${user.id}`;
};

// src/pages/layout.ts: app-wide per-user live state
@Page({ transport: 'durable-object', scope: perUser })
export default class RootLayout extends Cossack {
    @State() unread = 0;
    @Server() markAllRead() { this.unread = 0; }
    render() { return html`<button @click=${this.markAllRead}>${this.unread}</button>${this.children}`; }
}

// src/components/CartBadge.ts: a reusable live widget for any page
@Component({ transport: 'durable-object', scope: perUser })
export class CartBadge extends Cossack {
    @State() count = 0;
    @Server() add() { this.count++; }
    render() { return html`<button @click=${this.add}>Cart (${this.count})</button>`; }
}
```

Rules:

- Never use `c.get('user')?.id` in a scope: every anonymous visitor would share `user:undefined`. Throw instead; SSR then renders the layout or component offline (`realtime.websocket.state === 'closed'`).
- A realtime component must be exported from a file under `src/`, with a literal options object that sets `transport: 'durable-object'` and `scope`. The build registers it (`<file>#<export>`) and fails without `scope` or an export. The server builds only registered components, in a service scope of their own (no layout services). Props stay in the browser. Render it during SSR, which computes its target.
- A **layout** connection runs the layout's own guard stack (enclosing layouts plus the layout) with the checked route params of the page the browser is on; the page's own guards do not run.
- A **component** connection runs the hosting page's layout and page guards with the page's checked params, then the component's own `middlewares`, then its `scope` (a throw or an empty key rejects).
- Every action and delivered frame repeats those checks. A client can name any page it may open, so keep a component's access rule in its `scope`, its `middlewares` and each `@Server` method.
- A child component without `transport` runs in its host's instance: over the host's connection in a realtime page, layout or component, over HTTP elsewhere.

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

## Ownership and authorization limits

Scope keys identify a backend; they do not authorize access. Derive tenant/user
ownership from trusted context and recheck record access for RPC and delivered
socket operations. Do not treat browser scope/state or an open socket as authority.
Cloudflare durable state requires actual bindings and native restart acceptance;
Node realtime state is process-local and resets with its process. Read the
installed Core `rpc-streams-and-transport-policy` and
`server-action-access-policy` guides in `cossack docs --package @cossackframework/core --json`, selecting
`guidance.guides` by ID. This is offline guidance, not a
remote readiness probe.
