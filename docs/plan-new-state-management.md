# Architectural Plan: Next-Generation State Management

This document captures the complete brainstorming session and architectural plan for the next generation of Cossack's state management system. The goal is to evolve the framework from its current "one-DO-per-URL" model to a more flexible, robust, and production-ready architecture that can handle complex, real-world application scenarios.

## 1. Core Problems with the Current Model

Our brainstorming identified several critical limitations with the initial architecture:

1.  **The "Shared State" Problem:** State cannot be easily shared across different pages. A shopping cart, user notifications, or login status are tied to the Durable Object for a specific URL, which is incorrect.
2.  **The "DO Explosion" Problem:** For content-heavy sites (like blogs or e-commerce), creating a separate Durable Object for every single URL is inefficient and costly.
3.  **Authorization & Data Visibility:** The current model assumes all users connected to a DO see the exact same state. It has no mechanism for handling scenarios where an `administrator` and a `moderator` view the same page but should see different data, which is a major security and UX flaw.
4.  **Pagination Integrity:** Simply filtering the state for a user *after* it has been fetched (e.g., for pagination) breaks the user experience. A page can end up with fewer items than expected, and the total page count becomes incorrect.

## 2. Inspiration from Mature Frameworks

We analyzed two leading frameworks to inform our design:

*   **Phoenix Liveview:** Utilizes the "Actor Model" where everything is a lightweight process. State is shared via a powerful **PubSub (Publish-Subscribe)** system. Components subscribe to topics, and stateful `GenServer` processes publish events to those topics. This is a highly decoupled, event-driven model perfect for distributed systems.
*   **.NET Blazor:** Uses a classic object-oriented approach with a **Dependency Injection (DI)** container. Stateful "services" are registered with specific **lifetimes** (`Scoped` for per-user, `Singleton` for global). Components "inject" these services to access and share state. This is an explicit, type-safe, and easy-to-understand model.

## 3. The Proposed Hybrid Architecture

Our final proposed architecture is a hybrid that takes the best concepts from both Liveview and Blazor, creating a system uniquely suited to the Cloudflare/Durable Object ecosystem. It is built on three pillars: `StateProviders`, `Channels`, and `Events`.

### Pillar 1: `StateProvider` (The "Where")

This is the core abstraction that decouples components from the underlying state technology.

*   **Role:** A `StateProvider` is a class that knows how to connect to a specific *type* of state source (e.g., a specific DO strategy). It answers the question: "Which stateful context am I talking to?"
*   **Implementation:** The `@Page` decorator will be updated to register named providers for the component.

    ```typescript
    @Page({
      providers: {
        page: new PageStateProvider(), // Default, for state tied to the URL
        session: new UserSessionProvider() // For state tied to the logged-in user
      }
    })
    ```
*   **Usage:** The `@State` and `@Server` decorators will use a `provider` property to target the correct context.

    ```typescript
    @State({ provider: 'session' }) // This state lives in the user's session.
    private cart: ShoppingCart;

    @Server({ provider: 'session' }) // This action is sent to the user's session DO.
    private async addToCart() { /* ... */ }
    ```

### Pillar 2: `Channel` (The "What")

The `channels` feature is not obsolete; it becomes an essential filtering mechanism *within* a provider.

*   **Role:** A channel allows a component to subscribe to a specific *slice* of state within a larger stateful context. It answers the question: "Within this room, what specific topic am I interested in?"
*   **Usage:** The `channel` property is used alongside the `provider` property.

    ```typescript
    // This component connects to the user's session DO, but only wants
    // updates related to notifications. It will not receive cart updates.
    @State({ provider: 'session', channel: 'notifications' })
    private notificationCount: number = 0;
    ```

### Pillar 3: `@OnEvent` & The "Event-Driven Re-fetch" Pattern (The "When" & "How")

This is the core pattern for ensuring data consistency, security, and a good user experience.

*   **Role:** Instead of broadcasting large, insecure state objects, the Durable Object will broadcast tiny, factual **event messages** (e.g., `"users:changed"`). Components will listen for these events and re-run their own permission-aware data fetching logic.
*   **The Flow:**
    1.  An action in a DO modifies the source of truth (the D1 database).
    2.  The DO broadcasts a simple event: `this.broadcast("users:changed")`.
    3.  A component subscribed to this event via `@OnEvent("users:changed")` will have its handler method triggered.
    4.  The handler's primary job is to call `this.init()`.
    5.  The `init()` method re-runs its original database query, which includes the user's context (`db.getVisibleUsersFor({ viewer: this.user, ... })`).
*   **Benefits:** This pattern is secure by default, always preserves UX integrity (pagination is never broken), and is highly efficient.

## 4. Detailed Counter Example

This pseudo-code illustrates the complete, end-to-end flow.

```typescript
// 1. The Provider (Connects to a single DO for the whole app)
export class CounterProvider extends StateProvider {
  getDurableObjectId() { return this.env.COUNTER_DO.idFromName("singleton-counter"); }
}

// 2. The Component (Contains all the logic)
@Page({ providers: { counter: new CounterProvider() }})
export class CounterPage extends Cossack {
  @State() private currentCount: number = 0;

  // The single source of truth for this component's data
  @Server() async init() {
    this.currentCount = await db.getCounterValue();
  }

  // The action logic ONLY lives here. It modifies the DB and broadcasts an event.
  @Server({ provider: 'counter' })
  private async increment() {
    const newValue = await db.getCounterValue() + 1;
    await db.setCounterValue(newValue);
    this.broadcast("counter:changed"); // Broadcasts a simple event
  }

  // The event handler, which triggers a re-fetch.
  @OnEvent("counter:changed")
  private async onCounterChanged() {
    await this.init();
  }

  template() {
    return html`<button @click=${this.increment}>Count is ${this.currentCount}</button>`;
  }
}
```

## 5. Future Considerations & Optimizations

This architecture provides a clear path for essential post-1.0 features:

*   **The "Thundering Herd" Problem:** Solved by implementing a short-lived, in-memory cache within the Durable Object to buffer high-frequency re-fetch requests.
*   **Optimistic Updates:** The framework can provide an API (`this.increment().optimistically(...)`) to allow the UI to update instantly while the robust re-fetch happens in the background.
*   **Event Granularity:** The `@OnEvent` decorator can be enhanced to support more specific topics (`@OnEvent("users:page:{this.pageId}:changed")`) to prevent unnecessary re-fetches.
*   **"Smart" Components:** The provider model can be extended to stateful child components (`@Component`), allowing them to connect to state sources independently of their parent page.

This plan provides a complete and robust foundation for the next stage of the Cossack Framework's development.
