# Gemini Context for the Cossack Framework Project

This document provides the necessary context for the Gemini AI to act as an effective contributor to the Cossack Framework project.

## Rules
- Run type checks after code changes: `pnpm tsc --noEmit`
- Create tests for new features and bug fixes.


## 1. High-Level Project Goal

Cossack is a modern, full-stack TypeScript framework designed for the edge computing and AI era. It is heavily inspired by Phoenix Liveview and .NET Blazor. The core goal is to enable developers to write stateful, real-time web applications with a unified syntax that runs on both the server (Cloudflare Workers, Node.js) and the client, abstracting away the complexity of client-server communication.

## 2. Core Principles

-   **Web Standard APIs Preferred**: Code intended for the core library or shared components should avoid Node.js-specific APIs (`fs`, `path`, etc.) to maintain edge compatibility. However, the framework now supports a Node.js runtime adapter, so Node.js APIs can be used within that specific context or in user applications targeting Node.js.
-   **Cloudflare-First Ecosystem**: Prioritize Cloudflare products for infrastructure needs (Durable Objects for state/WebSockets, D1 for database, R2 for storage, etc.), but the framework is architected to be runtime-agnostic via adapters.
-   **Strict Separation of Concerns**: The project is a monorepo with a clear distinction between the reusable **library** packages (`core`, `renderer`, `node-adapter`) and the **application** package (`framework`). The libraries must *never* depend on the application.

## 3. Monorepo Package Architecture

The project is a `pnpm` workspace.

-   **`@cossackframework/core`**: The essential library.
    -   **Purpose**: Provides the `Cossack` base class, decorators (`@Page`, `@State`, `@ClientState`, `@Server`, `@Client`, `@Optimistic`), the `CossackServerRuntime` interface, and other shared utilities.
    -   **Entrypoint**: `packages/core/src/index.ts`
    -   **Key Detail**: This is a pure library. It contains no application-specific logic.

-   **`@cossackframework/renderer`**: The rendering engine.
    -   **Purpose**: A custom, Lit-compatible rendering engine designed for Light DOM and SSR. It provides the `CossackElement` base class for components, `html` template tag, and `TemplateResult`.
    -   **Server Entrypoint**: `packages/renderer/src/server.ts` (exports `renderToString`, `escapeHtml`).
    -   **Client Entrypoint**: `packages/renderer/src/index.ts` (exports `render`, `CossackElement`, `html`).

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
5.  **Re-render**: State updates trigger `requestUpdate()` on individual `CossackElement` instances. On the client, a top-level orchestrator intercepts these updates to re-compose the Page/Layout tree and trigger a root app re-render.

## 5. Development Workflow

1.  **Build Dependencies**: Build `core`, `renderer`, and `node-adapter` first.
2.  **Run Application**: Use `pnpm --filter @cossackframework/framework run dev`.

## 6. Key Architectural Decisions & "Gotchas"

-   **`isServer` Check**: `typeof window === 'undefined' || typeof window.document === 'undefined'`.
-   **Metadata Merging**: Always use `head(context: HeadContext): HeadValue`. The framework automatically handles category preservation and auto-expands SEO shortcuts (`description`, `image`) into OG/Twitter tags.
-   **Client-Side Persistence**: The Global `App` component is bootstrapped once and persists across all navigations.
-   **Auto-Binding**: All component methods are automatically bound to the instance during `bootstrap`. Standard class methods can be used as event handlers without manual binding or arrow functions.
-   **Lifecycle Hooks**: Components can implement `onMount()` (runs once after first client-render) and `onCleanup()` (runs before component destruction).
-   **SPA Redirects**: `this.redirect()` on the client is automatically intercepted and handled as a soft navigation.
-   **Hierarchical Error Boundaries**: The router searches for the nearest `error/index.ts` or `404/index.ts` up the directory tree relative to the current route.

## 7. Key Features

- **Instant App**: Soft navigation with pre-fetching on hover and a client-side page cache.
- **Light DOM Components**: Class-based `CossackElement` components (Lit-compatible) that render directly to Light DOM for easy global styling.
- **Progress Bar**: Automatic visual feedback for background page loads and redirects.
- **Nested Layouts & Route Groups**: Standardized file-based organization with inheritance.
- **Qwik-like Metadata**: Intelligent merging of titles and meta tags from Page -> Layouts -> App.
- **Optimistic UI**: Built-in support for instant feedback on actions.
- **Client-Only State**: `@ClientState` decorator for local UI state that triggers re-renders without server sync.
- **Universal Loading State**: Built-in `this.loading[methodName]` support for all transport modes.
- **Hierarchical Error Pages**: Folder-level `404` and `error` pages for localized error handling.
- **MDX Support**: Zero-configuration support for `.mdx` files as endpoints, allowing markdown-based content with full layout support.
- **Runtime Adapters**: Support for Cloudflare Workers (default) and Node.js.
- **Image Optimization**: `Image` component for responsive, edge-optimized assets.
- **Code Splitting & Security**: Automatic server-only code stripping from client bundles via `@Server`, `@Client`, `@Shared`, `@Optimistic`, and `@Computed` decorators.

## Decorators Reference

### Server-Only Decorators
These decorators mark code that should only run on the server:

- **`@Server()`**: Marks a method as server-only. The method body is stripped from the client bundle and replaced with a proxy function that calls the server via WebSocket or HTTP.
- **`@State()`**: Marks a property as synchronized state (server-to-client).
- **`@Client()`**: Marks a method as client-only. On the server, these methods are replaced with no-ops.

### Client-Only Decorators
These decorators mark code that only runs on the client:

- **`@ClientState()`**: Marks a property as client-only state (triggers re-renders, no server sync).
- **`@Prop()`**: Semantic equivalent to `@ClientState()` for component inputs.
- **`@Optimistic()`**: Marks an optimistic UI handler that runs immediately on the client while the server processes the action.

### Shared Decorators
- **`@Shared()`**: Marks a method as safe to run on both client and server. The full implementation is retained in both bundles. Use for pure functions, validation logic, and data transformation utilities.

### Computed Properties
- **`@Computed()`**: Marks a getter method as a computed property (memoized).

### Built-in Methods (Always Kept in Client)
The following lifecycle methods are never stripped from the client bundle:
- `render()`, `head()`, `onMount()`, `onCleanup()`, `escapeHtml()`, `get()`, `init()`, `loadingTemplate()`

## Security: Code Stripping

The framework includes a Vite security plugin (`cossackSecurityPlugin`) that automatically strips server-only code from client bundles. This ensures that:

1. Database queries, API keys, and server-side business logic are never exposed to the browser
2. Methods without any decorator are treated as server-only by default (secure by default)
3. Only explicitly marked client-safe code reaches the browser

**Method Classification:**
- **Server-Only** (stubs in client): `@Server` decorated methods, methods without decorators
- **Client-Safe** (full implementation): `@Client`, `@Optimistic`, `@Computed`, `@Shared`, built-in lifecycle methods

**Example:**
```typescript
class MyPage extends Cossack {
  @Server()
  async queryDatabase() {
    // This code is stripped from client bundle
    return await db.select().from(users);
  }

  @Shared()
  validateEmail(email: string): boolean {
    // This runs on both client and server
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  @Client()
  updateUI() {
    // Client-only, stubbed on server
  }
}
```
