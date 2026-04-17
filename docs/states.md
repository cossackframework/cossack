# Real-Time State Management in Cossack

Cossack's primary goal is to unify client and server state management. For real-time applications, it provides a flexible, powerful architecture that allows you to choose the right pattern for the job, from simple, automatic UI updates to robust, secure, event-driven workflows.

**Note:** The patterns described here—Automatic State Synchronization and Event-Driven Re-fetch—are features of the real-time transport and require components to be decorated with `@Page({ transport: 'durable-object' })`.

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

### 3. Optimistic UI Updates (Instant Feedback)

For interactions where latency matters (like "liking" a post or incrementing a counter), you can use the `@Optimistic` decorator to update the UI *instantly* on the client, before the server has even processed the request.

**How it works:**
1.  You define a method that updates local state.
2.  You decorate it with `@Optimistic('serverActionName')`.
3.  When the client calls `this.serverActionName()`, the framework *immediately* runs the optimistic handler.
4.  The request is sent to the server.
5.  If the server responds with a state update (Scenario 1), the "true" server state overwrites your optimistic guess.
6.  If the server throws an error (Scenario 2), the state remains (for now) unless you handle the rollback or re-fetch manually.

**Example:**

```typescript
import { Page, Server, State, Optimistic } from '@cossackframework/core';

@Page({ transport: 'durable-object' })
class Counter extends Cossack {
    @State() count = 0;

    @Server()
    async increment() {
        // Simulate slow network/DB
        await new Promise(r => setTimeout(r, 500));
        this.count++;
    }

    // This runs immediately on the client when this.increment() is called
    @Optimistic('increment') 
    applyOptimisticIncrement() {
        this.count++; 
    }
}
```

#### Advanced: Stable Optimistic UI Pattern

When users perform actions rapidly (e.g., clicking a button multiple times), naive optimistic updates can cause "flapping" in the UI. This happens because the server processes requests sequentially, sending state updates in between your local optimistic changes.

**The Problem (Flapping):**
1. User clicks twice. Local count: 0 -> 1 -> 2.
2. Server processes 1st click. Returns count: 1. UI resets to 1.
3. Server processes 2nd click. Returns count: 2. UI jumps to 2.
   Result: 0 -> 1 -> 2 -> 1 -> 2.

**The Solution:**
Use `this.loading[methodName]` (which is a counter of pending requests) combined with a separate `@ClientState` for the optimistic value and a `@Computed` property for the display value.

```typescript
@Page({ transport: 'durable-object' })
export class OptimisticCounter extends Cossack {
    @State() count = 0;           // True server state
    @ClientState() optCount = 0;  // Local optimistic state

    @Computed()
    get displayCount() {
        // If we have pending requests, show our local guess.
        // Otherwise, show the authoritative server state.
        return (this.loading['increment'] > 0) ? this.optCount : this.count;
    }

    @Server()
    async increment() {
        await new Promise(r => setTimeout(r, 500));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimistic() {
        // If starting a new chain of requests, sync with server state first
        if (!this.loading['increment']) {
            this.optCount = this.count;
        }
        this.optCount++;
    }

    render() {
        return html`Count: ${this.displayCount}`;
    }
}
```

---

### 4. Client-Only State (@ClientState)

Not all state needs to be synchronized with the server. Cosmetic UI state—like whether a dropdown is open, which tab is active, or the current value of an unsubmitted input—shouldn't require a network round-trip. 

For these cases, use the `@ClientState` decorator.

**How it works:**
1.  You decorate a property with `@ClientState`.
2.  When you change this property on the client, it **automatically** triggers a re-render.
3.  The property is **ignored** during Server-Side Rendering (initial state) and is **never** sent over the WebSocket.

#### Example: A Toggle Switch

```typescript
import { Page, ClientState } from '@cossackframework/core';

@Page({ transport: 'http' })
export class ToggleDemo extends Cossack {
    
    @ClientState() 
    private isExpanded: boolean = false;

    toggle() {
        this.isExpanded = !this.isExpanded;
    }

    protected render() {
         return html`
            <button @click=${this.toggle}>
                ${this.isExpanded ? 'Hide' : 'Show'} Details
            </button>

            ${this.isExpanded ? html`<div>Secret details here...</div>` : ''}
        `;
    }
}

---

### 5. Computed State (@Computed)

For values that can be derived from existing state, use the `@Computed` decorator on a getter.

**How it works:**
1. You define a getter method that calculates a value based on other properties.
2. You decorate it with `@Computed`.
3. The value is automatically re-calculated whenever the underlying state changes (because the template re-renders).
4. Computed properties are **not** serialized or sent over the network; they are always calculated locally.

#### Example: Derived Calculation

```typescript
import { Page, State, Computed } from '@cossackframework/core';

@Page({ transport: 'durable-object' })
export class Counter extends Cossack {
    @State()
    private count: number = 0;

    // Derived state
    @Computed()
    get doubleCount() {
        return this.count * 2;
    }

    protected render() {
        return html`
            <p>Count: ${this.count}</p>
            <p>Doubled: ${this.doubleCount}</p>
        `;
    }
}
```

---

## Best Practices & Gotchas

### 1. Automatic `this` Binding

Cossack automatically binds all component methods to the instance during initialization. This means you can safely use standard class methods as event handlers without needing manual binding or arrow functions.

**✅ CORRECT (Standard Method):**

```typescript
export class MyComponent extends Cossack {
    @ClientState() isVisible = false;

    // Standard method - automatically bound by Cossack!
    toggle() {
        this.isVisible = !this.isVisible; 
    }

    render() {
        return html`<button @click=${this.toggle}>Toggle</button>`;
    }
}
```

**✅ CORRECT (Arrow Function):**

You can still use arrow functions if you prefer, but they are no longer required for context preservation.

```typescript
export class MyComponent extends Cossack {
    @ClientState() isVisible = false;

    // Arrow function - also works!
    toggle = () => {
        this.isVisible = !this.isVisible;
    }

    render() {
        return html`<button @click=${this.toggle}>Toggle</button>`;
    }
}
```

---

## Nested Component State Flow

When using reusable components within Pages, each component's state is independently managed and synchronized with the server. This enables powerful patterns where components maintain their own server-side state without lifting everything to the Page.

### State Structure

The initial state structure includes nested component states under the `_children` property:

```typescript
interface InitialState {
  // Page-level state
  count: number;
  user: any;

  // Nested component states
  _children: {
    "root:0": {
      count: number;
      // ... component state
    },
    "root:1": {
      // ... another component's state
    }
  };
}
```

### Component ID Generation

Each component instance receives a unique ID based on its position in the render tree:

- Page component: `"root"`
- First nested component: `"root:0"`
- Second nested component: `"root:1"`
- Deeply nested: `"root:0:0"`, etc.

### Server Action Flow

When a nested component's `@Server` method is called:

1. **Client → Server**: The action is dispatched with the component's ID (`target`) and current state
2. **Server Processing**: The framework rebuilds the component tree and finds the target component
3. **State Restoration**: The target component's state is restored from the request payload
4. **Action Execution**: The `@Server` method runs with the restored state
5. **Response → Client**: The updated state is returned and applied to the component

### Example: Independent Counters

```typescript
// src/components/Counter.ts
@Component()
export class Counter extends Cossack {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    render() {
        return html`
            <button @click="${this.increment}">
                Count: ${this.count}
            </button>
        `;
    }
}

// src/pages/index.ts
@Page()
export class Dashboard extends Cossack {
    render() {
        return html`
            <div>
                <h1>Dashboard</h1>
                ${component(Counter)}
                ${component(Counter)}
                ${component(Counter)}
            </div>
        `;
    }
}
```

Each counter maintains independent state:
- First click on counter 1: Sends `{count: 0}`, receives `{count: 1}`
- First click on counter 2: Sends `{count: 0}`, receives `{count: 1}`
- Second click on counter 1: Sends `{count: 1}`, receives `{count: 2}`

### State Persistence

Nested component state is automatically:
- **Serialized** during SSR and included in `window.__INITIAL_STATE__`
- **Restored** on client hydration
- **Synchronized** after each `@Server` action

### Best Practices

1. **Keep Components Self-Contained**: Each component should manage its own state
2. **Avoid Parent State Dependencies**: Use `@Prop` for passing data down, not for bi-directional sync
3. **Use Server Actions for Business Logic**: Keep database calls and business logic in `@Server` methods

---

## Sharing State Across Pages with Providers
// ... rest of the file ...

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
