---
title: "States Management"
description: "Shared state between client and server using the @State decorator with automatic synchronization and simple property definitions."
---

# States Management

Managing states in traditional frameworks used to be hard. You'll need to init state, fetch the data from the server, mutate it and synchronize everytime state change on both server and client. However, not anymore with Cossack.

## Defining States (`@State`)

To define a state, in your pages or components, just define a property with a `@State()` decorator. This will create a shared state between client and server, and they are synced automatically!

```ts
export class Counter extends Cossack {
    @State()
    private count: number = 0;

    increment() {
        this.count++;
    }

    render() {
        return html`
            <div>
                <p>Count: ${this.count}</p>
                <button @click=${this.increment}>+</button>
            </div>
        `;
    }
}
```

That's it! When you change the state value, for example, `this.count++`, it automagically synchronize between servers and clients. The UI also reactive without complex hooks.

## Client-Only States (`@ClientState`)

Not all state needs to be synchronized with the server. Cosmetic UI state—like whether a dropdown is open, which tab is active, or the current value of an unsubmitted input—shouldn't require a network round-trip. 

For these cases, use the `@ClientState` decorator.

**How it works:**
1.  You decorate a property with `@ClientState`.
2.  When you change this property on the client, it **automatically** triggers a re-render.
3.  The property is **ignored** during Server-Side Rendering (initial state) and is **never** sent over the WebSocket.

### Example: A Toggle Switch

```typescript
import { Page, ClientState } from '@cossackframework/core';

@Page()
export class ToggleDemo extends Cossack {
    
    @ClientState() 
    private isExpanded: boolean = false;

    @Client()
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
```


## Computed State (`@Computed`)

For values that can be derived from existing state, use the `@Computed` decorator on a getter.

**How it works:**
1. You define a getter method that calculates a value based on other properties.
2. You decorate it with `@Computed`.
3. The value is automatically re-calculated whenever the underlying state changes (because the template re-renders).
4. Computed properties are **not** serialized or sent over the network; they are always calculated locally.

### Example: Derived Calculation

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

--- 

## Advanced: Realtime State with WebSockets

Refer to [Websockets](/docs/websockets.md) documentation about how to make realtime application with websockets.

By default, Durable Object transport is **stateless** — state is ephemeral and not persisted to DO storage. Add `stateful: true` to `@Page()` if state needs to persist across connections and DO evictions.
