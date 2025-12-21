# Gemini Context for the Cossack Framework Project

This document provides the necessary context for the Gemini AI to act as an effective contributor to the Cossack Framework project.

## 1. High-Level Project Goal

Cossack is a modern, full-stack TypeScript framework designed for the edge computing and AI era. It is heavily inspired by Phoenix Liveview and .NET Blazor. The core goal is to enable developers to write stateful, real-time web applications with a unified syntax that runs on both the server (Cloudflare Workers, Node.js) and the client, abstracting away the complexity of client-server communication.

## 2. Core Principles

-   **Web Standard APIs Preferred**: Code intended for the core library or shared components should avoid Node.js-specific APIs (`fs`, `path`, etc.) to maintain edge compatibility. However, the framework now supports a Node.js runtime adapter, so Node.js APIs can be used within that specific context or in user applications targeting Node.js.
-   **Cloudflare-First Ecosystem**: Prioritize Cloudflare products for infrastructure needs (Durable Objects for state/WebSockets, D1 for database, R2 for storage, etc.), but the framework is architected to be runtime-agnostic via adapters.
-   **Strict Separation of Concerns**: The project is a monorepo with a clear distinction between the reusable **library** packages (`core`, `renderer`, `node-adapter`) and the **application** package (`framework`). The libraries must *never* depend on the application.

## 3. Monorepo Package Architecture

The project is a `pnpm` workspace.

-   **`@cossackframework/core`**: The essential library.
    -   **Purpose**: Provides the `Cossack` base class, decorators (`@Page`, `@State`, `@Server`, `@Client`), the `CossackServerRuntime` interface, and other shared utilities.
    -   **Entrypoint**: `packages/core/src/index.ts`
    -   **Key Detail**: This is a pure library. It contains no application-specific logic.

-   **`@cossackframework/renderer`**: The rendering engine.
    -   **Purpose**: Provides `html` template tag and rendering functions. It has two distinct entry points for different environments.
    -   **Server Entrypoint**: `packages/renderer/src/server.ts` (exports `renderToString`).
    -   **Client Entrypoint**: `packages/renderer/src/index.ts` (exports `render`).

-   **`@cossackframework/node-adapter`**: The Node.js runtime adapter.
    -   **Purpose**: Provides the runtime implementation for Node.js environments using `ws` for WebSockets.
    -   **Entrypoint**: `packages/node-adapter/src/index.ts`

-   **`@cossackframework/framework`**: The runnable application and primary example.
    -   **Purpose**: This is the deployable Cloudflare Worker (or Node.js app). It contains the Hono router, all page components, the application-specific `AppDurableObject` (if on CF), and the client-side entrypoint.
    -   **Worker Entrypoint**: `packages/framework/src/index.ts`
    -   **Client Entrypoint**: `packages/framework/src/client/entry-client.ts`

## 4. Request & Interactivity Lifecycle

1.  **SSR**: A request hits the server (Worker or Node). The Hono router instantiates a Page Component, calls its `init()` method for data, and uses the `@cossackframework/renderer/server` to render the initial HTML. The component's state is serialized into the page.
2.  **Hydration**: The client-side JS loads, instantiates the same Page Component, and uses the serialized state from the HTML to populate its data. It then connects to the Server Runtime via WebSocket.
3.  **Interactivity**: User actions call proxy methods on the client-side component, which sends a message to the Server Runtime over the WebSocket.
4.  **State Sync**: The Server Runtime (Durable Object or Node Adapter) processes the action, updates its internal component's state, and broadcasts the new state to all connected clients.
    *   **Note**: On Cloudflare with Durable Objects, `@State` is persisted automatically. On Node.js, `@State` is currently memory-only and resets on server restart.
5.  **Re-render**: The client-side component receives the new state and uses the `@cossackframework/renderer` to efficiently update the DOM.

## 5. Development Workflow

The development process is critical and follows a specific order.

1.  **Build Dependencies**: The library packages (`core`, `renderer`, `node-adapter`) must be built first so the application (`framework`) can import them.
    ```sh
    pnpm --filter @cossackframework/core --filter @cossackframework/renderer --filter @cossackframework/node-adapter run build
    ```
2.  **Run Application**: The development server is run from the `framework` package. It uses `wrangler` (for CF) or `node` (for Node.js).
    ```sh
    pnpm --filter @cossackframework/framework run dev
    ```

## 6. Key Architectural Decisions & "Gotchas"

-   **`isServer` Check**: The definitive way to check for the environment is `typeof window === 'undefined' || typeof window.document === 'undefined'`. This is located in `packages/core/src/shared/environment.ts`.
-   **`instanceof` is Unreliable**: Due to dual-entry points (client/server) in the renderer, `instanceof TemplateResult` fails. We use "duck typing" (`isTemplateResult` helper function) to check for template objects instead.
-   **Server Runtime Abstraction**: The `Cossack` base class uses a generic `CossackServerRuntime` interface. This decouples the framework logic from the underlying transport (Durable Objects vs Node `ws`).
-   **Durable Object Extensibility**: The base `CossackDurableObject` in `core` is generic. The `framework` contains an `AppDurableObject` that extends it and provides the application-specific list of page components. This is the correct pattern for Cloudflare.
-   **Dependencies**: The `framework` must explicitly list all dependencies it uses, even if they are also used by `core` (e.g., `hono`, `reflect-metadata`).
