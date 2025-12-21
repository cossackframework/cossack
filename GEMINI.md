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
    -   **Purpose**: Provides the `Cossack` base class, decorators (`@Page`, `@State`, `@Server`, `@Client`, `@Optimistic`), the `CossackServerRuntime` interface, and other shared utilities.
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

1.  **SSR**: A request hits the server. The Hono router identifies the layout stack and Page component. It instantiates, bootstraps, and calls `init()`/`get()` on all components. Metadata is merged from inside-out using `head()`.
2.  **Hydration**: The client-side JS loads, instantiates the stack, and populates `@State` from `window.__INITIAL_STATE__`.
    *   **2a. Navigation**: Subsequent navigation via `<a>` tags is intercepted. The new page data is fetched, and the component stack is updated. Global `App` and shared `Layout` instances are preserved.
3.  **Interactivity**: User actions call proxy methods on the client, sending messages over WebSockets.
    *   **Optimistic UI**: Methods decorated with `@Optimistic` run immediately on the client.
4.  **State Sync**: The Server Runtime processes the action, updates state, and broadcasts partial state objects to all connected clients.
5.  **Re-render**: Any state update triggers a full-stack re-render and metadata re-merge via a centralized client-side controller.

## 5. Development Workflow

1.  **Build Dependencies**: Build `core`, `renderer`, and `node-adapter` first.
2.  **Run Application**: Use `pnpm --filter @cossackframework/framework run dev`.

## 6. Key Architectural Decisions & "Gotchas"

-   **`isServer` Check**: `typeof window === 'undefined' || typeof window.document === 'undefined'`.
-   **Metadata Merging**: Always use `head(context: HeadContext): HeadValue`. The framework automatically handles category preservation.
-   **Client-Side Persistence**: The Global `App` component is bootstrapped once and persists across all navigations.

## 7. Key Features

- **Instant App**: Soft navigation with pre-fetching on hover and a client-side page cache.
- **Progress Bar**: Automatic visual feedback for background page loads.
- **Nested Layouts & Route Groups**: Standardized file-based organization with inheritance.
- **Qwik-like Metadata**: Intelligent merging of titles and meta tags from Page -> Layouts -> App.
- **Optimistic UI**: Built-in support for instant feedback on actions.
- **Runtime Adapters**: Support for Cloudflare Workers (default) and Node.js.
- **Image Optimization**: `Image` component for responsive, edge-optimized assets.
