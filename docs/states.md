# State Management in Cossack

Cossack's primary goal is to unify client and server state management. It provides a flexible, powerful architecture that allows you to choose the right pattern for the job, from simple, automatic UI updates to robust, secure, event-driven workflows.

This architecture is built on three pillars: **State Providers**, **Channels**, and **Events**.

-   **`StateProvider` (The "Where"):** A State Provider determines *which* stateful backend a component connects to. By default, components use a `PageStateProvider`, which scopes state to the current URL. However, you can create custom providers to connect to other contexts, such as a `UserSessionProvider` for state shared across all pages for a logged-in user, or a `GlobalProvider` for a singleton state shared by all users.

-   **`Channel` (The "What"):** A Channel is a logical partition *within* a provider. It allows you to group related pieces of state. When an automatic update occurs, the framework sends a partial state object containing only the properties for the affected channel, making updates efficient.

-   **`Event` (The "When" & "How"):** An Event is a simple, stateless message broadcasted by the server. Components can listen for these events to trigger actions, most notably the "Event-Driven Re-fetch" pattern, which is the most secure way to handle complex state changes.

---

## Two Core Patterns

Cossack offers two primary patterns for managing state. You can use either—or both—within the same component.

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
import { Page, Server, State } from '@cossackframework/core';

@Page()
export class Counter extends Cossack {
    
    @State() // Uses the default 'global' channel
    private count: number = 0;

    @Server()
    private increment() {
        // This one line is enough to trigger a UI update for all clients.
        this.count++;
    }

    protected template() {
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

@Page()
export class Tasks extends Cossack {
    @State()
    private tasks: Task[] = [];

    @Server()
    async init() {
        // In a real app, this would fetch tasks from a database,
        // applying user-specific permissions.
        // e.g., this.tasks = await db.getTasksForUser(this.user);
        if (this.tasks.length === 0) {
             this.tasks = [/* ... initial tasks ... */];
        }
    }

    @Server()
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

    // ... template and other methods
}
```

---

## Sharing State Across Pages with Providers

To solve the "Shared State" problem (e.g., a shopping cart, notifications), you can create a custom `StateProvider`.

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
