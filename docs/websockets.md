# Real-Time Functionality with WebSockets

The Cossack framework provides a powerful, declarative API for adding real-time, stateful functionality to your components using WebSockets and Cloudflare Durable Objects. The system is designed to be incredibly simple for basic use cases while scaling elegantly to support complex components with multiple, independent real-time data streams.

## Enabling WebSockets & Defining Channels

To make a component real-time, you add the `channels` property to its `@Page` decorator. This property takes an array of strings, where each string is the name of a WebSocket channel the component can connect to.

```typescript
@Page({
    channels: [
        'feeds',        // A channel for live feed updates
        'notifications' // A separate channel for notifications
    ]
})
export class MyComponent extends Cossack {
    // ...
}
```

This configuration tells the framework that `MyComponent` will manage two distinct WebSocket connections on the client-side.

---

### The `global` Channel: Simplicity by Default

For components that only need a single WebSocket connection, you don't need to specify any channel names. The framework includes a special **`global`** channel that is used by default.

If you define a `channels` array, the `global` channel is automatically included.

**Behavior:**
-   `@State()` decorators without a `channel` property will sync over the `global` channel.
-   `@Server()` methods without a `channel` property will be called over the `global` channel.

This maintains the simplicity of the original API for the most common use cases.

```typescript
@Page({
    // No `channels` array needed for the default global channel
})
export class LiveCounter extends Cossack {
    
    @State() // This state syncs over the 'global' channel
    private count: number = 0;

    @Server() // This action is called over the 'global' channel
    private increment() {
        this.count++;
    }
    // ...
}
```

---

### Multi-Channel Components

The true power of this system comes from associating specific pieces of state and server-side actions with different channels. This allows for fine-grained control over data flow, improving performance and logical separation.

#### 1. Channel-Specific State with `@State`

Use the `channel` property on the `@State` decorator to link a state variable to a specific channel. When this variable's value changes on the server, the update will **only** be broadcast to clients connected to that channel.

```typescript
@State({ channel: 'feeds' })
private feedCount: number = 0;

@State({ channel: 'notifications' })
private notificationCount: number = 0;
```

#### 2. Channel-Specific Actions with `@Server`

Similarly, use the `channel` property on the `@Server` decorator to link a method to a channel. The client-side proxy for this method will automatically know to send the action request over the correct WebSocket.

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
import { Page, Server, State } from '@/shared/decorators';
import { Cossack } from '@/shared/cossack';
// ... other imports

@Page({
    channels: [
        'feeds',
        'notifications',
    ],
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

    protected template(): TemplateResult {
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
-   When the "Increment Feeds" button is clicked, the `incrementFeed` action is sent over the `feeds` WebSocket. Only `feedCount` is updated, and the new state is broadcast back only to clients on the `feeds` channel.
-   The "Increment Notifications" button behaves identically but for the `notifications` state and channel.
-   If `this.name` were to change, the update would be sent over the `global` channel.