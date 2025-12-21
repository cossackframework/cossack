# Cossack Framework Architecture

This document outlines the architecture of the Cossack Framework, how its packages interact, and the lifecycle of a request.

## Core Principle: Separation of Concerns

The framework is built on a strict separation between the **library** (`core`, `renderer`) and the **application** (`framework`).

-   **Libraries (`@cossackframework/core`, `@cossackframework/renderer`)**: These packages are completely agnostic of any specific application. They provide the tools, base classes, and rendering logic. The `core` library must never import from the `framework` or contain application-specific code.
-   **Application (`@cossackframework/framework`)**: This is the runnable unit. It consumes the libraries and contains all the business logic, page components, routing, and the final Cloudflare Worker entrypoint.

This separation ensures the framework's core is reusable, maintainable, and decoupled from any single implementation.

## Request Lifecycle

The lifecycle of a user interaction is split into two main phases: the initial server-side render and the subsequent client-side interactivity.

### 1. Initial HTTP Request & Server-Side Rendering (SSR)

1.  A user navigates to a URL (e.g., `/tasks`). The request hits the Cloudflare Worker.
2.  The Hono router matches the incoming URL to a route and identifies the corresponding Page Component (e.g., the `Tasks` class).
3.  **Routing & Middleware**: The router identifies the stack of **Layouts** relevant to this page (e.g., `RootLayout` -> `DashboardLayout` -> `TasksPage`) and applies all their middlewares in order.
4.  **Bootstrapping**:
    *   The Global `App` component is instantiated and bootstrapped.
    *   Each `Layout` in the stack is instantiated and bootstrapped.
    *   The `Page` component is instantiated and bootstrapped.
5.  **Data Loading**: The component's `@Server` decorated `init()` (or `get()`) method is called to fetch the initial data.
6.  **Rendering**: The content is rendered inside-out: `App(RootLayout(DashboardLayout(Page())))`.
7.  **Metadata Merging**: The framework processes metadata from the inside-out using the `head()` method. The Page provides the initial values, which are then passed to each Layout in the stack, and finally to the Global App for final branding or global tags.
8.  The final HTML page is constructed, embedding the rendered HTML, the serialized initial state, and the merged head tags into the response.
9.  The complete HTML page is sent to the user's browser.

### 2. Client-Side Hydration & Navigation

1.  The browser receives the HTML, renders the initial view, and downloads the client-side JavaScript.
2.  An instance of the `Tasks` component is created in the browser.
3.  The component's `bootstrap` method runs its client-side path.
4.  It reads `window.__INITIAL_STATE__` to instantly populate its `@State` properties.
5.  It also reads the list of server method names and **replaces them** with proxy functions.
6.  Crucially, it reads the **Server Runtime Targets** (e.g., Durable Object IDs or logical references) for each **State Provider** and establishes a WebSocket connection for each one.
7.  **Instant Navigation (Soft Navigation)**: When a user clicks a link (e.g., `<a href="/about">`), the framework intercepts the click. instead of a full reload, it:
    *   **Pre-fetching**: The framework automatically begins fetching the next page data when the user hovers over a link, effectively hiding network latency.
    *   **Caching**: All visited and pre-fetched pages are stored in a memory cache. If a URL is in the cache, the transition happens instantaneously without a network request.
    *   **Component Swap**: The current component instance is destroyed (closing WebSockets), and the new component is instantiated and bootstrapped using the state parsed from the fetched HTML.

### 3. Server Runtime Interaction & State Synchronization

1.  When a user performs an action (e.g., clicks a button), they call a client-side **proxy function**.
2.  **Optimistic UI**: If the method is decorated with `@Optimistic`, the client executes the handler immediately, updating the local UI state before the request is even sent.
3.  The proxy function sends a JSON message over the appropriate provider's WebSocket (e.g., `{ "type": "action", "action": "incrementFeed", "payload": [] }`).
4.  The **Server Runtime** (e.g., `AppDurableObject` or `NodeWebSocketRuntime`) receives the message and calls the real method on its internal component instance.
5.  From here, one of two state synchronization patterns occurs:

    **a) Automatic State Push (Default):**
    - The server method modifies a `@State` property (e.g., `this.feedCount++`).
    - The `@State` decorator's setter is triggered and queues a microtask to broadcast the change.
    - The Runtime identifies all state properties belonging to the same **channel** as the changed property (e.g., `feeds`).
    - It constructs a **partial state object** containing only the properties for that channel.
    - The Runtime broadcasts this partial state to **all** clients connected to it.
    - The client-side component receives the partial state, updates its local properties, and automatically re-renders the UI (overwriting any optimistic state).

    **b) Event-Driven Re-fetch (Manual):**
    - The server method modifies a database or other external source of truth.
    - It then calls `this.broadcastEvent('some-event-name')`.
    - The Runtime broadcasts this simple event message to **all** connected clients.
    - Any client-side component with an `@OnEvent('some-event-name')` handler will execute that handler.
    - The handler's job is typically to call `this.init()` again, which re-runs the original, permission-aware query to get the fresh, secure state.
    - The component updates its state from the new query and re-renders.

### 4. State Persistence

The framework handles state persistence differently depending on the runtime environment:

-   **Cloudflare Workers (Durable Objects):** The `@State` properties are automatically persisted to the Durable Object's transactional storage. State survives server restarts and hibernation.
-   **Node.js (Node Adapter):** The `@State` properties are strictly **in-memory**. If the Node.js server process restarts, all component state is reset to initial values. Developers running on Node.js should persist critical data to an external database manually within their action methods.
