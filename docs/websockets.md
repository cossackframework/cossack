---
title: "States with Websockets"
description: "Real-time state management over WebSockets with Durable Object transport for true real-time applications."
---

# States with Websockets

The true power of state management in Cossack is that is not only limited to HTTP based state but can be synced with any transport layer. For example, websocket, so you can write a truly real time application just as the same 

Cossack's primary goal is to unify client and server state management. For real-time applications, it provides a flexible, powerful architecture that allows you to choose the right pattern for the job, from simple, automatic UI updates to robust, secure, event-driven workflows.

**Note:** The patterns described here—Automatic State Synchronization and Event-Driven Re-fetch—are features of the real-time transport and require components to be decorated with `@Page({ transport: 'durable-object' })`.

## Stateless vs Stateful Durable Objects

By default, `transport: 'durable-object'` creates a **stateless** DO that acts as a WebSocket hub only. State is ephemeral — it lives in-memory during the session but is not persisted to DO storage. This is ideal for applications that use a database (D1, R2, etc.) as the source of truth.

To persist state in DO storage (survives reconnections and DO eviction), add `stateful: true`:

```typescript
// Stateless (default) — recommended for DB-backed apps
@Page({ transport: 'durable-object' })

// Stateful — state persists in DO storage
@Page({ transport: 'durable-object', stateful: true })
```

### When to use `stateful: true`
- In-memory state that needs to persist across connections (e.g., counters, shared whiteboards)
- No external database — the DO itself is the source of truth
- State should survive DO eviction and reactivation

## Scope — controlling which Durable Object instance a page connects to

By default, each URL gets its own Durable Object instance (per-URL scope). The `scope` option on `@Page` overrides this: it receives the Hono `Context` and returns a scope-key string, which becomes the Durable Object **ID name**. Users (and tabs) that resolve to the same scope key land on the same DO instance and share state — this is the mechanism behind multiplayer features (shared whiteboards, chat rooms, collaborative docs).

```typescript
// All members of a team share one DO instance for this page
@Page({
    transport: 'durable-object',
    stateful: true,
    scope: (c) => `team:${c.get('user').teamId}`,
})

// One DO instance per room (URL param)
@Page({
    transport: 'durable-object',
    stateful: true,
    scope: (c) => `room:${c.req.param('roomId')}`,
})
```

The scope function is evaluated **once during SSR** with the full request context (including params and query). The resulting `scopeKey` is embedded in the page's initial state and reused as the DO ID name, so SSR, the WebSocket connection, and `/crpc` all agree on the same instance — even when scope depends on params not present in later requests.

The same `scope` option also applies to the `sse` transport (where the default is per-user instead of per-URL). Without `scope`, the default per-URL behavior is unchanged.

This architecture is built on three pillars: **State Providers**, **Channels**, and **Events**.

-   **`StateProvider` (The "Where"):** A State Provider determines *which* stateful backend a component connects to. By default, components use a `PageStateProvider`, which scopes state to the current URL. However, you can create custom providers to connect to other contexts, such as a `UserSessionProvider` for state shared across all pages for a logged-in user, or a `GlobalProvider` for a singleton state shared by all users.

-   **`Channel` (The "What"):** A Channel is a logical partition *within* a provider. It allows you to group related pieces of state. When an automatic update occurs, the framework sends a partial state object containing only the properties for the affected channel, making updates efficient.

-   **`Event` (The "When" & "How"):** An Event is a simple, stateless message broadcasted by the server. Components can listen for these events to trigger actions, most notably the "Event-Driven Re-fetch" pattern, which is the most secure way to handle complex state changes.

---

## Two Core Patterns for Real-Time State

Cossack offers two primary patterns for managing real-time state. You can use either—or both—within the same component.

### 1. Automatic State Synchronization (The "Blazor" Way)

This is the simplest and most direct way to manage state. It's perfect for UI-specific state that isn't persisted in a database or doesn't have complex security requirements.

**How it works:**
1.  You decorate a property with `@State`.
2.  You decorate a server-side method with `@Server`.
3.  When the `@Server` method changes the value of the `@State` property, the framework **automatically** detects the change.
4.  It then broadcasts a **partial state update** containing only the properties for the affected channel to all clients connected to that page.
5.  The client-side component receives the update and automatically re-renders.

#### Example: A Simple Counter

```typescript
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'durable-object' })
export class Counter extends Cossack {
    
    @State() // Uses the default 'global' channel
    private count: number = 0;

    @Server()
    private increment() {
        // This one line is enough to trigger a UI update for all clients.
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

In this example, calling `this.count++` is all that's needed. The framework handles detecting the change, serializing the new value, broadcasting it, and re-rendering the component on all connected clients.

---

### 2. Event-Driven Re-fetch (The "Liveview" Way)

This is the most robust and secure pattern. It is the **recommended approach** for any action that modifies a shared source of truth (like a database) or requires permission checks.

**How it works:**
1.  A `@Server` method performs an action, such as writing to a database.
2.  Instead of changing the component's state directly, it calls `this.broadcastEvent('event-name')`.
3.  The server broadcasts this simple, stateless event message to all connected clients.
4.  A method on the component decorated with `@OnEvent('event-name')` is triggered on every client.
5.  This handler's primary job is to call `this.init()`, which re-runs the component's initial data-loading logic. This ensures that each client re-fetches the data *within its own permission context*.

This pattern is secure by default and prevents race conditions or accidental data leaks.

#### Example: Deleting a Task

```typescript
import { Page, Server, State, OnEvent } from '@cossackframework/core';

@Page({ transport: 'durable-object' })
export class Tasks extends Cossack {
    @State()
    private tasks: Task[] = [];

    async init() {
        // In a real app, this would fetch tasks from a database,
        // applying user-specific permissions.
        // e.g., this.tasks = await db.getTasksForUser(this.user);
        if (this.tasks.length === 0) {
             this.tasks = [/* ... initial tasks ... */];
        }
    }

    private async deleteTask(taskId: number) {
        // 1. Modify the source of truth (the in-memory array here)
        this.tasks = this.tasks.filter(task => task.id !== taskId);
        
        // 2. Broadcast a simple event, NOT the new state
        this.broadcastEvent('tasks:changed');
    }

    // 3. The event handler triggers a re-fetch on all clients
    @OnEvent('tasks:changed')
    private async onTasksChanged() {
        await this.init();
    }

    //...
}
```

---

## Connections, Providers, and Channels

Real-time communication in Cossack is managed through a clear hierarchy:

1.  **Connection:** A physical WebSocket connection is established for each **State Provider** a component uses. For most components, this is just a single connection to the default `PageStateProvider`.
2.  **Channel:** A channel is a logical grouping of state *within* a single provider's connection. It allows the framework to send efficient, partial state updates.

By default, all state and actions use the `global` channel within the default `page` provider.

```typescript
@Page({
    transport: 'durable-object'
})
export class LiveCounter extends Cossack {
    
    @State() // Uses the 'global' channel within the 'page' provider.
    private count: number = 0;

    private increment() {
        this.count++;
    }
    // ...
}
```

---

### Multi-Channel Components

The true power of this system comes from associating specific pieces of state and server-side actions with different channels. This allows for fine-grained control over data flow.

#### 1. Channel-Specific State with `@State`

Use the `channel` property on the `@State` decorator to link a state variable to a specific channel. When this variable's value changes on the server, the automatic update will **only** contain the state for other properties belonging to that same channel.

```typescript
@Page({
    transport: 'durable-object',
    channels: ['feeds', 'notifications']
})
export class Dashboard extends Cossack {
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    @State({ channel: 'notifications' })
    private notificationCount: number = 0;
}
```

#### 2. Channel-Specific Actions with `@Server`

Similarly, use the `channel` property on the `@Server` decorator. This is primarily used for logical grouping and has no effect on which WebSocket connection is used (that is determined by the `provider` property).

```typescript
@Server({ channel: 'feeds' })
private incrementFeed() {
    this.feedCount++;
}

@Server({ channel: 'notifications' })
private incrementNotifications() {
    this.notificationCount++;
}
```

---

### Complete Example

Here is how the concepts come together in a single component.

```typescript
import { Page, Server, State } from '@cossackframework/core';
import { Cossack } from '@cossackframework/core';
// ... other imports

@Page({
    transport: 'durable-object',
    channels: ['feeds', 'notifications'],
})
export class Greeting extends Cossack {
    // State for the 'feeds' channel
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    // State for the 'notifications' channel
    @State({ channel: 'notifications' })
    private notificationCount: number = 0;

    // State for the default 'global' channel
    @State()
    private name: string = 'World';

    // Action associated with the 'feeds' channel
    @Server({ channel: 'feeds' })
    private incrementFeed = async () => {
        this.feedCount++;
    };

    // Action associated with the 'notifications' channel
    @Server({ channel: 'notifications' })
    private incrementNotifications = async () => {
        this.notificationCount++;
    };

    protected render(): TemplateResult {
        return html`
            <div>
                <h1>Hello ${this.name}!</h1>
                <p>Feeds: ${this.feedCount}</p>
                <p>Notifications: ${this.notificationCount}</p>

                <button @click=${this.incrementFeed}>Increment Feeds</button>
                <button @click=${this.incrementNotifications}>Increment Notifications</button>
            </div>
        `;
    }
}
```

**Behavior:**
-   The client establishes **one** WebSocket connection for the default `page` provider.
-   When "Increment Feeds" is clicked, `incrementFeed` is called on the server.
-   The server automatically broadcasts a partial state update containing **only `feedCount`** to all clients connected to this page.
-   The "Increment Notifications" button behaves identically but for the `notificationCount` state.
-   If `this.name` were to change, the partial update would contain only the `name` property.

## Sharing State Across Pages/Components with Providers

To share state between pages or components (e.g., a shopping cart, notifications), you can create a custom `StateProvider`.

For example, a `UserSessionProvider` would be responsible for connecting to a Durable Object whose ID is derived from the user's session, not the URL.

```typescript
// 1. Define a custom provider
export class UserSessionProvider extends StateProvider {
  getDurableObjectId() {
    const userId = this.component.user?.id;
    if (!userId) throw new Error("User not authenticated!");
    // All components using this provider will connect to the SAME DO for this user
    return this.env.SESSION_DO.idFromName(userId);
  }
}

// 2. Register it in your component
@Page({
  transport: 'durable-object',
  providers: {
    session: new UserSessionProvider()
  }
})
export class MyPageComponent extends Cossack {

  // 3. Target the provider for state and actions
  @State({ provider: 'session' })
  private notificationCount: number = 0;

  @Server({ provider: 'session' })
  private async markNotificationsAsRead() {
    // This action is sent to the user's session DO, not the page DO.
    this.notificationCount = 0;
  }
}
```

Now, `notificationCount` can be accessed and modified consistently from any page that registers and uses the `session` provider.
