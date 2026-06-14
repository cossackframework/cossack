---
name: setup-websocket
description: Set up real-time features in a Cossack page (Durable Object/WebSocket or SSE)
disable-model-invocation: true
user-invocable: true
---

# Set Up Real-Time Features

You are setting up real-time features for a Cossack application. First, pick the right transport with the user.

## Step 1: Choose a Transport

| Transport | When | Persistent state | Setup |
|---|---|---|---|
| `sse` | Default choice. Live counters, chat, streaming text, multi-tab sync on **plain Workers**. | No (in-memory) | None — no binding required |
| `durable-object` | Multi-user coordination across users, persistent state in the DO itself, or full bidirectional comms. | Optional (`stateful: true`) | Requires `COSSACK_OBJECT` binding + `AppDurableObject` export |

**Default to `sse`** unless the user needs cross-user coordination or DO-persisted state. If they only want real-time updates of their own data, multi-tab sync, or streaming, SSE is simpler.

> Full details for both: the `cossack-best-practices` skill's `references/realtime.md`.

### If the user chose `sse`

```typescript
@Page({ transport: 'sse' }) // per-user scope by default
export class LiveCounter extends Cossack {
    @State() private count: number = 0;

    @Server()
    private increment() { this.count++; } // auto-synced to all the user's tabs
}
```

SSE supports per-user / per-team / per-room / shared scoping via `scope: (c) => '...'`, and async-generator streaming methods (`async *`). No wrangler binding or DO export needed. Skip to Step 8 (Verify).

### If the user chose `durable-object`

Continue with the steps below.

## Step 2: Prerequisites (Durable Object only)

- The page must use `transport: 'durable-object'`
- A `COSSACK_OBJECT` Durable Object binding must be configured in `wrangler.jsonc`
- The `AppDurableObject` must be exported from `src/index.ts`

## Step 3: Understand the Two Patterns

### Stateless vs Stateful

By default, `transport: 'durable-object'` creates a **stateless** DO — it acts as a WebSocket hub without persisting state to DO storage. State is ephemeral and resets when the DO is evicted. This is ideal for DB-backed apps.

Add `stateful: true` to persist state in DO storage (survives reconnections and eviction):

```typescript
// Stateless (default) — ephemeral state
@Page({ transport: 'durable-object' })

// Stateful — state persists in DO storage
@Page({ transport: 'durable-object', stateful: true })
```

By default each URL gets its own DO instance. To make multiple users (or rooms) share the **same** DO instance — the mechanism for multiplayer, chat rooms, shared whiteboards — add the `scope` option. It works for both DO and SSE; only the default differs (DO defaults to per-URL, SSE to per-user).

```typescript
// All team members share one DO instance
@Page({ transport: 'durable-object', stateful: true, scope: (c) => `team:${c.get('user').teamId}` })
```

Cossack supports two patterns for real-time state. Choose based on the use case:

### Pattern 1: Automatic State Synchronization

Best for: Simple UI state, counters, toggles, shared whiteboards.

When a `@Server()` method modifies a `@State()` property, the framework automatically detects the change and broadcasts the new value to all connected clients.

### Pattern 2: Event-Driven Re-fetch

Best for: Database mutations, permission-sensitive data, complex state changes.

A `@Server()` method broadcasts a simple event. Clients listen with `@OnEvent()` and re-fetch data within their own security context.

## Step 4: Implement Pattern 1 — Automatic Sync

```typescript
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'durable-object' })
export class LiveCounter extends Cossack {
    @State()
    private count: number = 0;

    @Server()
    private increment() {
        // This single line triggers a UI update on ALL connected clients
        this.count++;
    }

    render() {
        return html`
            <div>
                <p>Count: ${this.count}</p>
                <button @click=${this.increment}>Increment</button>
            </div>
        `;
    }
}
```

### With Multi-Channel Updates

For fine-grained partial updates, use channels:

```typescript
@Page({
    transport: 'durable-object',
    channels: ['feeds', 'notifications'],
})
export class Dashboard extends Cossack {
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    @State({ channel: 'notifications' })
    private notificationCount: number = 0;

    @Server({ channel: 'feeds' })
    incrementFeeds() {
        this.feedCount++;
        // Only feedCount is broadcast — not notificationCount
    }

    @Server({ channel: 'notifications' })
    incrementNotifications() {
        this.notificationCount++;
        // Only notificationCount is broadcast — not feedCount
    }

    render() {
        return html`
            <div>
                <p>Feeds: ${this.feedCount}</p>
                <p>Notifications: ${this.notificationCount}</p>
                <button @click=${this.incrementFeeds}>+Feed</button>
                <button @click=${this.incrementNotifications}>+Notification</button>
            </div>
        `;
    }
}
```

## Step 5: Implement Pattern 2 — Event-Driven Re-fetch

```typescript
import { Cossack, Page, Server, State, OnEvent, Client } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';

interface Task {
    id: number;
    text: string;
}

@Page({
    transport: 'durable-object',
    channels: ['tasks'],
})
export class Tasks extends Cossack {
    @State({ channel: 'tasks' })
    private tasks: Task[] = [];

    @Server()
    async init() {
        // Fetch from database, applying user permissions
        if (this.tasks.length === 0) {
            this.tasks = [
                { id: 1, text: 'Learn Cossack' },
                { id: 2, text: 'Build real-time app' },
            ];
        }
    }

    @Server({ channel: 'tasks' })
    private async deleteTask(taskId: number) {
        // 1. Modify the source of truth
        this.tasks = this.tasks.filter(task => task.id !== taskId);

        // 2. Broadcast an event (NOT the new state directly)
        this.broadcastEvent('tasks:changed');

        // 3. Optionally call client methods
        this.showAlert('Task deleted!');
    }

    // 4. Event handler triggers re-fetch on all clients
    @OnEvent('tasks:changed')
    private async onTasksChanged() {
        await this.init(); // Re-fetch data within each client's permission context
    }

    @Client({ channel: 'tasks' })
    private showAlert(message: string) {
        alert(message);
    }

    @Client()
    private confirmDelete = (taskId: number) => {
        if (window.confirm('Delete this task?')) {
            this.loading = { ...this.loading, [`deleteTask_${taskId}`]: 1 };
            this.deleteTask(taskId);
        }
    }

    render() {
        return html`
            <div>
                <h1>Tasks</h1>
                <ul>
                    ${this.tasks.map(task => html`
                        <li>
                            <span>${task.text}</span>
                            <button @click="${() => this.confirmDelete(task.id)}"
                                ?disabled="${!!this.loading[`deleteTask_${task.id}`]}">
                                Delete
                            </button>
                        </li>
                    `)}
                </ul>
            </div>
        `;
    }
}
```

## Step 6: Server-to-Client Method Calls

From a `@Server()` method, you can directly invoke `@Client()` methods:

```typescript
@Server()
async updateData() {
    // ... update state ...

    // Call a client method (runs on ALL connected clients)
    this.showNotification('Data updated!');
}

@Client()
private showNotification(message: string) {
    // This runs on every connected client's browser
    console.log(message);
}
```

## Step 7: Configure Durable Object Binding

Ensure `wrangler.jsonc` has the binding:

```jsonc
{
    "durable_objects": {
        "bindings": [
            {
                "name": "COSSACK_OBJECT",
                "class_name": "AppDurableObject"
            }
        ]
    },
    "migrations": [
        {
            "tag": "v1",
            "new_classes": ["AppDurableObject"]
        }
    ]
}
```

And `src/index.ts` exports the Durable Object:

```typescript
import { AppDurableObject } from './DurableObject';

export { AppDurableObject };
export default { fetch: app.fetch };
```

## Step 8: Verify

**For SSE transport:**
1. Page uses `@Page({ transport: 'sse' })`
2. `scope` option set if a non-default scope (per-team/per-room/shared) is needed
3. For streaming, `@Server()` methods use `async *` generators and `yield`
4. Run type checks: `pnpm tsc --noEmit`

**For Durable Object transport:**
1. Page uses `@Page({ transport: 'durable-object' })`
2. Add `stateful: true` if state must persist in DO storage
3. Add `scope: (c) => '...'` if multiple users/rooms should share one DO instance
4. `COSSACK_OBJECT` binding exists in `wrangler.jsonc`
5. `AppDurableObject` is exported from `src/index.ts`
6. For multi-channel: channels are declared in `@Page({ channels: [...] })`
7. For events: `@OnEvent('event-name')` handler calls `this.init()` or equivalent
8. `@Client()` methods are used for client-side-only logic
9. Run type checks: `pnpm tsc --noEmit`
