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

1.  A user navigates to a URL (e.g., `/tasks`). The request hits the Cloudflare Worker, which is running the code from `packages/framework/src/index.ts`.
2.  The Hono router, defined in `packages/framework/src/router.ts`, matches the incoming URL to a route.
3.  The router identifies the corresponding Page Component (e.g., the `Tasks` class).
4.  An instance of the `Tasks` component is created on the server.
5.  The component's `bootstrap` method is called. Because this is a server environment (`isServer` is true), it runs the server-side initialization path.
6.  The component's `@Server` decorated `init()` method is called, which fetches the initial data for the page (e.g., the list of tasks).
7.  The `getInitialHtml()` method is called, which in turn calls `render()`.
8.  The `render()` method on the `Cossack` base class calls `renderToString()` from the `@cossackframework/renderer/server` package, passing it the component's `template()` result.
9.  The server-side renderer walks the template. It renders HTML tags and content, but **it explicitly ignores client-side event handlers** (like `@click`) and function values, preventing them from being executed on the server.
10. The component's `getInitialState()` method is called to serialize all `@State` properties and the names of all `@Server` methods.
11. The final HTML page is constructed, embedding the rendered HTML into the `<body>` and the serialized initial state into a `<script>` tag (`window.__INITIAL_STATE__`).
12. The complete HTML page is sent to the user's browser.

### 2. Client-Side Hydration & WebSocket Interactivity

1.  The browser receives the HTML, renders the initial view, and starts downloading the client-side JavaScript (defined in `packages/framework/src/client/entry-client.ts`).
2.  Once the JavaScript loads, it inspects the current URL and finds the corresponding Page Component (the `Tasks` class).
3.  An instance of the `Tasks` component is created in the browser.
4.  The component's `bootstrap` method is called. Because this is a client environment (`isServer` is false), it runs the client-side initialization path.
5.  The component reads the `window.__INITIAL_STATE__` object to instantly populate its `@State` properties with the data from the server.
6.  The `bootstrap` method also reads the list of server method names from the initial state and **replaces them** on the component instance with proxy functions.
7.  The component connects to the `AppDurableObject` via WebSocket, opening a connection for each channel defined in the `@Page` decorator.
8.  The page is now fully hydrated and interactive.

### 3. Durable Object (DO) Interaction

1.  When a user performs an action (e.g., clicks the "Delete" button), they are actually calling the **proxy function** that was created during hydration.
2.  The proxy function sends a JSON message over the appropriate WebSocket channel (e.g., `{ "type": "action", "action": "deleteTask", "payload": [123] }`).
3.  The `AppDurableObject` receives the message. It ensures a corresponding `Tasks` component instance exists within itself (creating one if it's the first message).
4.  The DO calls the real `deleteTask` method on its internal component instance.
5.  The `deleteTask` method modifies the component's state (the `tasks` array).
6.  The `@State` decorator's setter is triggered by the change. It automatically queues a microtask to broadcast the state change.
7.  The DO broadcasts a "state-update" message containing the new, complete state to all connected clients on the relevant channel ("tasks").
8.  The client-side component receives the "state-update" message. It updates its local `@State` properties with the new data from the server.
9.  The client-side `@State` setter is triggered, which automatically calls the component's `render()` method.
10. The `render()` method calls the client-side `render()` function from `@cossackframework/renderer`, which efficiently updates the DOM to reflect the new state.
