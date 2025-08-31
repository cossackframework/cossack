# Real-Time Functionality with WebSockets

The Cossack framework provides a powerful, declarative API for adding real-time, stateful functionality to your components using WebSockets and Cloudflare Durable Objects.

## Enabling WebSockets

To make a component real-time, you simply add the `channel` property to its `@Page` decorator. This tells the framework to establish and manage a WebSocket connection for the component.

The `channel` property offers three flexible modes to cover a wide range of use cases.

---

### 1. Convention-Based Channels (Public)

For the common case where your real-time channel directly mirrors your URL, you can use the simple boolean flag.

**API:**
```typescript
@Page({
    channel: true
})
export class LiveCounter extends Cossack {
    // ...
}
```

**Behavior:**
-   If a user visits `/live-counter`, the framework automatically creates a WebSocket channel named `/live-counter`.
-   All users visiting this URL will connect to the same Durable Object instance and share the same real-time state.
-   This is perfect for public, collaborative pages where everyone sees the same data.

---

### 2. Configuration-Based Channels (Shared & Private)

For more advanced control, you can provide a string to define the channel's structure. This allows you to decouple the WebSocket channel from the HTTP route.

#### Shared Channels

You can have multiple pages connect to the same real-time backend.

**API:**
```typescript
// On /dashboard page
@Page({ channel: 'global-activity' })
export class DashboardWidget extends Cossack { /* ... */ }

// On /live-feed page
@Page({ channel: 'global-activity' })
export class LiveFeed extends Cossack { /* ... */ }
```
**Behavior:** Both components will connect to the same Durable Object instance named `global-activity`.

#### Private User Channels

You can create a channel that is unique to the currently logged-in user by using the special `:currentUser.id` placeholder.

**API:**
```typescript
@Page({
    channel: 'notifications/:currentUser.id'
})
export class UserNotifications extends Cossack {
    // ...
}
```
**Behavior:**
-   The framework will automatically substitute `:currentUser.id` with the authenticated user's ID.
-   Alice (ID `user-123`) will connect to a DO named `notifications/user-123`.
-   Bob (ID `user-456`) will connect to a completely separate DO named `notifications/user-456`.
-   This provides automatic, secure state isolation for user-specific data.

---

### 3. Filtered Views (Personalized Data)

This is the most powerful pattern. It allows multiple users to connect to the same shared resource channel, but each user receives a personalized, secure view of the data.

This is achieved by implementing the optional `webSocketBroadcastFilter` method on your component.

**API:**
```typescript
@Page({
    channel: 'users' // 1. Define the public resource channel
})
export class UserSearch extends Cossack {
    // This is the complete, unfiltered state held by the DO
    @State() allUsers: User[] = []; 

    /**
     * 2. Implement the server-side filter method.
     * The framework will automatically call this for every user
     * before broadcasting a state update.
     */
    @Server()
    public webSocketBroadcastFilter(state: this, user: AuthenticatedUser): Partial<this> {
        // Application-specific security logic lives here.
        const friends = user.friends || [];
        const filteredUsers = state.allUsers.filter(u => friends.includes(u.id));
        
        // Return only the state properties that should be sent to this user.
        return { allUsers: filteredUsers };
    }
}
```

**Behavior:**
1.  All users connect to the `users` Durable Object.
2.  The DO holds the single, unfiltered list of `allUsers`.
3.  When a broadcast is triggered (e.g., a new user signs up), the framework iterates through every connected client.
4.  For each client, it calls `webSocketBroadcastFilter`, passing in the full state and that client's authenticated `user` object.
5.  The framework sends the filtered, secure state returned by your method to that specific client.

This ensures that the server is the single source of truth for authorization, and no sensitive data is ever leaked to the client.
