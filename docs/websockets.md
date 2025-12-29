# Real-Time Functionality with WebSockets

The Cossack framework provides a powerful, declarative API for adding real-time, stateful functionality to your components. This is achieved by leveraging **Cloudflare Durable Objects** and the modern **Hibernatable WebSockets API**.

**Important:** To use any of the real-time features described in this document, you must explicitly enable the WebSocket transport by decorating your component with `@Page({ transport: 'durable-object' })`. The default transport is `'http'`.

### Powered by Hibernatable WebSockets

Cossack's backend is built on a "serverless" model. This means:

-   **Efficiency:** The Durable Object that manages your component's state can be "hibernated" (removed from memory) when it's not actively processing messages.
-   **Persistence:** Even when hibernated, the WebSocket connections remain open. When a new message arrives, the Cloudflare runtime instantly wakes up the correct Durable Object, preserving its state and ensuring no messages are lost.
-   **Reliability:** A built-in, low-level heartbeat mechanism (`ping-pong`) is automatically managed by the framework, preventing connections from being dropped due to network timeouts.

This architecture allows for thousands of concurrent, stateful connections with minimal resource overhead.

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

    @Server() // Action is sent over the 'page' provider's connection.
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
