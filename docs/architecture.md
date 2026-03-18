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
2.  The Hono router matches the incoming URL to a route and identifies the corresponding Page Component.
    *   **TypeScript Components**: Standard `index.ts` files.
    *   **MDX Components**: `index.mdx` files which are automatically transformed into component classes during the Vite build process.
3.  **Routing & Middleware**: The router identifies the stack of **Layouts** relevant to this page (e.g., `RootLayout` -> `DashboardLayout` -> `TasksPage`) and applies all their middlewares in order.
4.  **Error Boundaries**: If a component fails to load or render, the router searches for the **nearest `error/index.ts`** page up the directory tree. Similarly, if a route is not found, the router searches for the **nearest `404/index.ts`**. This allows for localized error UI while preserving parent layouts (like sidebars).
5.  **Bootstrapping**:
    *   The Global `App` component is instantiated and bootstrapped.
    *   Each `Layout` in the stack is instantiated and bootstrapped.
    *   The `Page` component is instantiated and bootstrapped.
6.  **Data Loading**: The component's `init()` method is called to fetch the initial data. This method is server-only by default and runs in the server environment, with access to databases and other server resources.
7.  **Rendering**: The content is rendered inside-out: `App(RootLayout(DashboardLayout(Page())))`.
8.  **Metadata Merging**: The framework processes metadata from the inside-out using the `head()` method. The Page provides the initial values (automatically extracted from frontmatter in MDX components), which are then passed to each Layout in the stack, and finally to the Global App for final branding or global tags.
9.  The final HTML page is constructed, embedding the rendered HTML, the serialized initial state, and the merged head tags into the response.
10. The complete HTML page is sent to the user's browser.

### 2. Client-Side Hydration & Navigation

1.  The browser receives the HTML, renders the initial view, and downloads the client-side JavaScript.
2.  An instance of the `Tasks` component is created in the browser.
3.  The component's `bootstrap` method runs its client-side path.
4.  It reads `window.__INITIAL_STATE__` to instantly populate its `@State` properties.
5.  **Client-Only State**: It also initializes any properties decorated with `@ClientState`. These properties are NOT synchronized with the server and are excluded from the initial state script.
6.  It also reads the list of server method names and **replaces them** with proxy functions.
7.  Crucially, it reads the **Server Runtime Targets** (e.g., Durable Object IDs or logical references) for each **State Provider** and establishes a WebSocket connection for each one.
8.  **Instant Navigation (Soft Navigation)**: When a user clicks a link (e.g., `<a href="/about">`), the framework intercepts the click. instead of a full reload, it:
    *   **Pre-fetching**: The framework automatically begins fetching the next page data when the user hovers over a link, effectively hiding network latency.
    *   **Caching**: All visited and pre-fetched pages are stored in a memory cache. If a URL is in the cache, the transition happens instantaneously without a network request.
    *   **Component Swap**: The current component instance is destroyed (closing WebSockets), and the new component is instantiated and bootstrapped using the state parsed from the fetched HTML.
9.  **Programmatic Navigation**: Components can call `this.redirect('/new-path')`. On the client, this is automatically intercepted and handled as a soft navigation (SPA transition) rather than a full browser reload.

### 3. Server Runtime Interaction & State Synchronization

1.  When a user performs an action (e.g., clicks a button), they call a client-side **proxy function**.
2.  **Function Binding**: All event handlers must use **Arrow Functions** (e.g., `toggle = () => { ... }`) to ensure the correct `this` context is preserved when called by the browser's event system.
3.  **Optimistic UI**: If the method is decorated with `@Optimistic`, the client executes the handler immediately, updating the local UI state before the request is even sent.
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

## Security: Code Splitting & Server-Only Code Stripping

The framework includes a **security plugin** (`vite-security-plugin.ts`) that automatically strips server-only code from client bundles during the build process. This ensures sensitive code (database queries, API keys, business logic) is never exposed to the browser.

### How It Works

During the client build, the `cossackSecurityPlugin` analyzes component class methods using AST-style brace depth tracking and:

1. **Keeps** methods decorated with `@Client`, `@Optimistic`, `@Computed`, `@Shared`, `@OnEvent`
2. **Keeps** built-in lifecycle methods: `render`, `head`, `onMount`, `onCleanup`, `escapeHtml`, `loadingTemplate`, `toString`, `valueOf`
3. **Keeps** property getters and setters (accessor methods)
4. **Stubs** methods decorated with `@Server` (replaces body with RPC proxy stub)
5. **Stubs** methods without any decorator (secure by default)

**Note:** The `init()` and `get()` methods are **server-only by default** and will be stubbed in client bundles unless explicitly marked with `@Shared`.

### Method Classification

#### Server-Only (Stripped from Client Bundle)
- Methods decorated with `@Server` → stub becomes RPC proxy
- Methods without any decorator → stub becomes RPC proxy
- `init()` method (unless marked `@Shared`)
- `get()` method (unless marked `@Shared`)

#### Client-Safe (Kept in Client Bundle)
- Methods decorated with `@Client`, `@Optimistic`, `@Computed`, `@Shared`, `@OnEvent`
- Built-in lifecycle methods: `render`, `head`, `onMount`, `onCleanup`, `escapeHtml`, `loadingTemplate`
- Property getters/setters
- Properties decorated with `@ClientState`

### Seamless RPC Proxying

When a server-only method is stubbed, the framework enables **seamless RPC proxying**. Client methods can call server-only methods directly, and the calls are automatically routed through the appropriate transport (HTTP or WebSocket).

**How it works:**
1. Server-only methods are replaced with stub functions that check `this.__cossack_proxies` map
2. During client bootstrap, proxy functions are automatically registered for all server-only methods
3. When a client method calls a server-only method (e.g., `await this.init()`), the proxy intercepts the call
4. The proxy forwards the call to the server via the configured transport
5. The server executes the real method and returns the result

**Example:**
```typescript
class LifecycleDemo extends Cossack {
  @State()
  data: string[] = [];

  // Server-only - stub becomes RPC proxy
  async init() {
    // Database query, API calls - stripped from client
    this.data = await db.select().from('users');
  }

  // Client method can seamlessly call server-only method
  @Client()
  async reload() {
    // This call is automatically proxied to the server
    await this.init();
    this.data = ['Cossack', 'Hono', 'Cloudflare'];
  }
}
```

### The `@Shared` Decorator

The `@Shared()` decorator marks a method as safe to run on both client and server. Unlike `@Server` methods (which become proxies on the client) or `@Client` methods (which run only on the client), `@Shared` methods retain their full implementation on both sides.

**Use `@Shared` for:**
- Pure functions that don't access server-only resources
- Validation logic that needs to run consistently on both sides
- Data transformation utilities

**Example:**
```typescript
class MyPage extends Cossack {
  @Shared()
  validateEmail(email: string): boolean {
    // Runs identically on both client and server
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  @Server()
  async createUser(email: string) {
    // Server-only - this code is stripped from client bundle
    if (!this.validateEmail(email)) {
      throw new Error('Invalid email');
    }
    return await db.insert(users, { email });
  }
}
```

### Metadata Injection

For methods detected as server-only (without explicit `@Server` decorator), the plugin automatically injects a static `__registerServerOnlyMethods()` method that registers them in the `cossack:server-methods` metadata. This enables the RPC proxying system to work seamlessly without requiring explicit `@Server` decorators on every server-only method.

### Build Configuration

The security plugin is automatically applied in client builds (`vite.client.config.ts`). It does **not** affect SSR builds (`vite.ssr.config.ts`), ensuring server code remains intact.

### Development vs Production

In development, calling a server-only method via a proxy that hasn't been set up yet throws a descriptive error:
```
Error: [Cossack] Method MyPage.init is server-only. The proxy has not been set up yet. Make sure this method is called after bootstrap.
```

In production, the stub is minimal to reduce bundle size while still checking for the proxy before execution.

## Testing

The framework uses vitest for unit tests and Playwright for end-to-end tests.

### Unit Tests

Run core package tests:
```sh
cd packages/core && pnpm vitest --run
```

Run framework package unit tests:
```sh
cd packages/framework && pnpm vitest --run tests/
```

### End-to-End Tests

Run all e2e tests:
```sh
cd packages/framework && pnpm exec playwright test
```

Run a specific test file:
```sh
cd packages/framework && pnpm exec playwright test e2e/pages/nested-state.spec.ts
```

Note: Each nested component instance maintains its own isolated state on the server, enabling true component isolation in stateful applications.
