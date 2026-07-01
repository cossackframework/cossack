# Cossack Framework

## Rules
- Run type checks after code changes: `pnpm tsc --noEmit`
- Create/run tests for new features and bug fixes.
- This project is the monorepo using pnpm, all packages located at `packages` directory.
- Check `/specs/architecture.md` for architectural guidelines before making significant changes.

## Database (`@cossackframework/database`)
- Optional package; add to an app with `npx cossack add database` (prompts dialect, default D1).
- Built on **Kysely 0.29** (re-exported — don't install kysely separately). Custom D1 and libSQL/Turso dialects (the community ones are stale). Postgres/MySQL are deferred.
- Querying: `this.c.get('db')` or `getDb(c)` in routes, or the global `db()` helper (AsyncLocalStorage, scoped per-request by `createDbMiddleware`). Registered via `src/config/middlewares.ts` (auto-loaded by the framework via `virtual:cossack-middlewares`).
- Typing: the `Database` interface (table→row) and `User` (from core) are empty by default and augmented via `declare module` from `src/models/*.ts`.
- Migrations/seeders live under `src/migrations/` and `src/seeders/`. CLI: `cossack migration up|down|status`, `cossack seeder run`, `cossack generate model|migration|seeder <name>`.
- D1 has no interactive transactions — for atomic multi-statement writes, use the raw D1 binding's `.batch([...])` (`c.env.DB.batch([...])`); Kysely has no `.batch()`. The migrator is unaffected (SQLite adapter reports `supportsTransactionalDdl: false`).


## 1. High-Level Project Goal

Cossack is a modern, full-stack TypeScript framework. The core goal is to enable developers to write applications with a unified syntax on only one component that runs on both the server (Cloudflare Workers, Node.js) and the client. Client and server methods can call each other directly without complex `fetch()`, instead, the framework setups proxy between them.

## 2. Core Principles

-   **Web Standard APIs Preferred**: Code intended for the core library or shared components should avoid Node.js-specific APIs (`fs`, `path`, etc.) to maintain edge compatibility. However, the framework now supports a Node.js runtime adapter, so Node.js APIs can be used within that specific context or in user applications targeting Node.js.
-   **Cloudflare-First Ecosystem**: Prioritize Cloudflare products for infrastructure needs (Durable Objects for state/WebSockets, D1 for database, R2 for storage, etc.), but the framework is architected to be runtime-agnostic via adapters.
-   **Strict Separation of Concerns**: The project is a monorepo with a clear distinction between the reusable **library** packages (`core`, `renderer`, `node-adapter`) and the **application** package (`framework`). The libraries must *never* depend on the application.

## 3. Monorepo Package Architecture

The project is a `pnpm` workspace.

-   **`@cossackframework/core`**: The core library.
-   **`@cossackframework/renderer`**: The rendering engine. Inspired by Lit.
-   **`@cossackframework/node-adapter`**: The Node.js runtime adapter.
-   **`@cossackframework/framework`**: The meta framework package
-   **`@cossackframework/auth`**: Auth package
-   **`@cossackframework/database`**: Database support — Kysely-based query builder with D1 + Turso dialects, migrations, and seeders. Re-exports Kysely. Optional; add via `cossack add database`.
-   **`@cossackframework/test-utils`**: Test helpers
-   **`@cossackframework/create-cossack-app`**: `create-cossack-app` CLI.


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
2.  **Run Application**: Use `pnpm run dev`.

## 6. Key Architectural Decisions & "Gotchas"

-   **`isServer` Check**: `typeof window === 'undefined' || typeof window.document === 'undefined'`.
-   **Metadata Merging**: Always use `head(context: HeadContext): HeadValue`. The framework automatically handles category preservation and auto-expands SEO shortcuts (`description`, `image`) into OG/Twitter tags.
-   **Client-Side Persistence**: The Global `App` component is bootstrapped once and persists across all navigations.
-   **Auto-Binding**: All component methods are automatically bound to the instance during `bootstrap`. Standard class methods can be used as event handlers without manual binding or arrow functions.
-   **Lifecycle Hooks**: Components can implement `onMount()` (runs once after first client-render), `onCleanup()` (runs before component destruction), and `onNavigateComplete(pathname)` (runs on the App component after every navigation).
-   **Navigation Events**: The framework dispatches `cossack:ready` (after navigation) and `cossack:before-navigate` (before SPA navigation) custom events on `document`.
-   **SPA Redirects**: `this.redirect()` on the client is automatically intercepted and handled as a soft navigation.
-   **Hierarchical Error Boundaries**: The router searches for the nearest `error/index.ts` or `404/index.ts` up the directory tree relative to the current route.

## Decorators Reference

### Server-Only Decorators
These decorators mark code that should only run on the server:

- **`@Server()`**: Marks a method as server-only. The method body is stripped from the client bundle and replaced with a proxy function that calls the server via WebSocket or HTTP.
- **`@State()`**: Marks a property as synchronized state (server-to-client).
- **`@Client()`**: Marks a method as client-only. On the server, these methods are replaced with no-ops.

### Client-Only Decorators
These decorators mark code that only runs on the client:

- **`@ClientState()`**: Marks a property as client-only state (triggers re-renders, no server sync).
- **`@Optimistic()`**: Marks an optimistic UI handler that runs immediately on the client while the server processes the action.
- **`@Validate()`**: Adds validation rules to a property. Works with `@State` and `@ClientState`. Supports built-in validators (required, minLength, maxLength, min, max, pattern, email, url) and custom validators (sync and async).
- **`@OnWindow(eventName, options?)`**: Listens for window events. Accepts `{ throttle?: number, debounce?: number }`.
- **`@OnDocument(eventName, options?)`**: Listens for document events. Accepts `{ throttle?: number, debounce?: number }`.

### Shared Decorators
- **`@Shared()`**: Marks a method as safe to run on both client and server. The full implementation is retained in both bundles. Use for pure functions, validation logic, and data transformation utilities.

### Rate-Limiting Decorators (client-only effect)
- **`@Debounce(ms)`**: Coalesces rapid calls into a single trailing invocation after `ms` of inactivity (latest args win). Composes with `@Client`/`@Server`/`@Shared`/`@On`; with `@Server` it debounces the RPC proxy call. Stores `cossack:debounce` metadata; applied during `_frameworkMount()`. On the server the method runs immediately. Returns `void`.
- **`@Throttle(ms)`**: Leading-edge throttle — first call runs immediately, further calls ignored for `ms`. Same composition/metadata (`cossack:throttle`) and client-only semantics as `@Debounce`.

### Server-Side Rate Limiting (`RateLimit`) — abuse protection
- **`@RateLimit({ window?, max?, key?, message? })`**: Method decorator enforced **server-side** at the `/crpc`, `/upload`, and class-based API dispatch boundaries — returns `429 Too Many Requests` (+ `Retry-After`) before the handler runs. Used on `@Server` methods and class-based API `get/post/…`. Client-side `@Debounce`/`@Throttle` are UX-only and bypassable; `@RateLimit` is not.
- **`RateLimit(options, handler)` / `RateLimit(handler)`**: Higher-order wrapper for **functional API routes** (decorators can't apply to `const` exports). Defaults: `window` 60s, `max` 60.
- Storage: pluggable via `setRateLimitStore()` (manual) or the **zero-code** `rateLimit` env var (`"durable-object"` / `"redis"` / `"kv"` in `wrangler.jsonc` `vars`, auto-applied lazily in `enforceRateLimit` via `configureRateLimitFromEnv`; a manual `setRateLimitStore` call wins). Built-ins: `InMemoryRateLimitStore` (default, per-process), `DurableObjectRateLimitStore` + `RateLimitDurableObject` (strongly consistent, one DO per key — recommended for strict limits), `RedisRateLimitStore` / `redisRateLimitStoreFromEnv` (zero-dep Upstash REST, cross-runtime), `KvRateLimitStore` (approximate). Default key: user id else client IP. Lives in `packages/core/src/shared/rate-limit.ts`.

### Computed Properties
- **`@Computed()`**: Marks a getter method as a computed property (memoized).

### Built-in Methods (Always Kept in Client)
The following lifecycle methods are never stripped from the client bundle:
- `render()`, `head()`, `onMount()`, `onCleanup()`, `onNavigateComplete()`, `escapeHtml()`, `loadingTemplate()`
- `clientInit()` — Client-only initialization method
- Validation methods: `getError()`, `hasError()`, `validateProperty()`, `validateAll()`, `clearErrors()`

Note: `init()` and `get()` are intentionally NOT in this list — they are server-only by default (they typically fetch data).

## Security: Code Stripping

The framework includes a Vite security plugin (`cossackSecurityPlugin`) that automatically strips server-only code from client bundles. This ensures that:

1. Database queries, API keys, and server-side business logic are never exposed to the browser
2. Methods without any decorator are treated as server-only by default (secure by default)
3. Only explicitly marked client-safe code reaches the browser

**Transitive preservation:** helpers called (directly or transitively, up to 3 levels) from a client-safe method via `this.method(...)` are kept automatically — you don't need to decorate every helper. See `docs/client-bundle.md` for the full rule.

**Method Classification:**
- **Server-Only** (stubs in client): `@Server` decorated methods, methods without decorators that are not reachable from a client-safe method
- **Client-Safe** (full implementation): `@Client`, `@Optimistic`, `@Computed`, `@Shared`, `@Task`, `@VisibleTask`, built-in lifecycle methods, and any method transitively reachable from them

**Failure mode:** calling a stripped method that has no RPC proxy throws a descriptive error (no silent RPC). Only `@Server` methods are registered for RPC proxying.

## Running Tests

### Unit Tests
- **Core package:** `cd packages/core && pnpm vitest --run`
- **Framework package:** `cd packages/framework && pnpm vitest --run tests/`

### End-to-End Tests
- **Run all e2e tests:** `cd packages/framework && pnpm exec playwright test`
- **Run specific test file:** `cd packages/framework && pnpm exec playwright test e2e/pages/nested-state.spec.ts`
- **Run with UI:** `cd packages/framework && pnpm exec playwright test --ui`

Note: Avoid using `pnpm test` in the framework package as it has a configuration issue that runs both vitest and playwright together.
