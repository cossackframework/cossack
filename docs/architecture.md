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
3.  An instance of the `Tasks` component is created on the server.
4.  The component's `bootstrap` method is called. It identifies all **State Providers** registered in the `@Page` decorator (defaulting to a `PageStateProvider` if none are specified).
5.  The component's `@Server` decorated `init()` method is called to fetch the initial data for the page.
6.  The `getInitialHtml()` method is called, which uses the `@cossackframework/renderer/server` package to render the component's template into an HTML string.
7.  The component's `getInitialState()` method is called. It serializes all `@State` properties, the names of all `@Server` methods, and the unique Durable Object IDs for each registered **State Provider**.
8.  The final HTML page is constructed, embedding the rendered HTML and the serialized initial state into a `<script>` tag (`window.__INITIAL_STATE__`).
9.  The complete HTML page is sent to the user's browser.

### 2. Client-Side Hydration & WebSocket Interactivity

1.  The browser receives the HTML, renders the initial view, and downloads the client-side JavaScript.
2.  An instance of the `Tasks` component is created in the browser.
3.  The component's `bootstrap` method runs its client-side path.
4.  It reads `window.__INITIAL_STATE__` to instantly populate its `@State` properties.
5.  It also reads the list of server method names and **replaces them** with proxy functions.
6.  Crucially, it reads the Durable Object IDs for each **State Provider** and establishes a WebSocket connection for each one. For a simple page, this is typically just one connection to the `PageStateProvider`.
7.  The page is now fully hydrated and interactive.

### 3. Durable Object (DO) Interaction & State Synchronization

1.  When a user performs an action (e.g., clicks a button), they call a client-side **proxy function**.
2.  The proxy function sends a JSON message over the appropriate provider's WebSocket (e.g., `{ "type": "action", "action": "incrementFeed", "payload": [] }`).
3.  The `AppDurableObject` receives the message and calls the real method on its internal component instance.
4.  From here, one of two state synchronization patterns occurs:

    **a) Automatic State Push (Default):**
    - The server method modifies a `@State` property (e.g., `this.feedCount++`).
    - The `@State` decorator's setter is triggered and queues a microtask to broadcast the change.
    - The DO identifies all state properties belonging to the same **channel** as the changed property (e.g., `feeds`).
    - It constructs a **partial state object** containing only the properties for that channel.
    - The DO broadcasts this partial state to **all** clients connected to it.
    - The client-side component receives the partial state, updates its local properties, and automatically re-renders the UI.

    **b) Event-Driven Re-fetch (Manual):**
    - The server method modifies a database or other external source of truth.
    - It then calls `this.broadcastEvent('some-event-name')`.
    - The DO broadcasts this simple event message to **all** connected clients.
    - Any client-side component with an `@OnEvent('some-event-name')` handler will execute that handler.
    - The handler's job is typically to call `this.init()` again, which re-runs the original, permission-aware query to get the fresh, secure state.
    - The component updates its state from the new query and re-renders.
