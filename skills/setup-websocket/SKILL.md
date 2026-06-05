---
name: setup-websocket
description: Set up real-time WebSocket features in a Cossack page
disable-model-invocation: true
user-invocable: true
---

# Set Up Real-Time WebSocket Features

You are setting up real-time features for a Cossack application using Durable Objects and WebSocket state synchronization.

## Prerequisites

- The page must use `transport: 'durable-object'`
- A `COSSACK_OBJECT` Durable Object binding must be configured in `wrangler.jsonc`
- The `AppDurableObject` must be exported from `src/index.ts`

## Step 1: Understand the Two Patterns

Cossack supports two patterns for real-time state. Choose based on the use case:

### Pattern 1: Automatic State Synchronization

Best for: Simple UI state, counters, toggles, shared whiteboards.

When a `@Server()` method modifies a `@State()` property, the framework automatically detects the change and broadcasts the new value to all connected clients.

### Pattern 2: Event-Driven Re-fetch

Best for: Database mutations, permission-sensitive data, complex state changes.

A `@Server()` method broadcasts a simple event. Clients listen with `@OnEvent()` and re-fetch data within their own security context.

## Step 2: Implement Pattern 1 — Automatic Sync

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

## Step 3: Implement Pattern 2 — Event-Driven Re-fetch

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

## Step 4: Server-to-Client Method Calls

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

## Step 5: Configure Durable Object Binding

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

## Step 6: Verify

1. Page uses `@Page({ transport: 'durable-object' })`
2. `COSSACK_OBJECT` binding exists in `wrangler.jsonc`
3. `AppDurableObject` is exported from `src/index.ts`
4. For multi-channel: channels are declared in `@Page({ channels: [...] })`
5. For events: `@OnEvent('event-name')` handler calls `this.init()` or equivalent
6. `@Client()` methods are used for client-side-only logic
7. Run type checks: `pnpm tsc --noEmit`
