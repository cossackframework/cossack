# Middleware — Technical Specification

This document describes the internal architecture and data flow of the middleware system. It is intended for LLM-assisted development and contributors who need to modify or extend the feature.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  @Page({ middlewares: [fn, fn] }) decorator                  │
│  Writes: Reflect metadata 'page:options' on class ctor       │
│  middlewares array is stored as-is (function references)     │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  virtual:cossack-pages (vite-plugin.ts)                      │
│  SSR: import.meta.glob('pages/**/*.ts', { eager: true })     │
│  Client: import.meta.glob('pages/**/*.ts')  // lazy          │
│  Layouts: always eager                                       │
│  → triggers @Page decorator → metadata written on class      │
└──────────────┬───────────────────────────────────────────────┘
               │ (SSR only)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  router.ts — route registration loop                         │
│  1. Reflect.getMetadata('page:options', PageComponent)       │
│  2. getLayoutStack(path) → walk parent dirs for layout.ts    │
│  3. Collect layout middlewares (root → leaf order)           │
│  4. Append page middlewares                                  │
│  5. app.get(route, ...combinedMiddlewares, ssrHandler)       │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Hono routing — per-request execution                        │
│  GET /tasks → middleware[0](c, next) → ... → ssrHandler(c)  │
│  Middlewares run on every SSR GET and HTTP action method     │
│  (post, put, patch, delete) for HTTP-transport pages         │
└──────────────────────────────────────────────────────────────┘
```

---

## File Map

| File | Responsibility |
|------|---------------|
| `packages/core/src/shared/decorators.ts` | `@Page()` decorator. Merges options and stores via `Reflect.defineMetadata('page:options', mergedOptions, target)`. |
| `packages/core/src/shared/middleware.ts` | `defineServerMiddleware(handler)` — semantic passthrough wrapper. Returns handler directly. Exists for documentation intent. |
| `packages/framework/src/vite-plugin.ts` | `cossackPages()` plugin. Loads page/layout modules via `import.meta.glob`. SSR uses `{ eager: true }`. |
| `packages/framework/src/router.ts` | `createApp()` — reads metadata, builds middleware stack, registers Hono routes. |
| `packages/framework/src/vite-security-plugin.ts` | Strips server-only method bodies from client bundle. Does NOT process middleware-only files (no `extends Cossack` match). |

---

## Phase 1: Decorator — Storing Middleware References

### `@Page(options)`

**File**: `packages/core/src/shared/decorators.ts`

The `@Page` decorator accepts a `middlewares` array of Hono `MiddlewareHandler` functions and stores it on the class constructor:

```typescript
@Page({
    middlewares: [loggingMiddleware],
    transport: 'durable-object',
})
export class Tasks extends Cossack { ... }
```

Internally:

```
Page(options)
  │
  ├─ Read existing 'page:options' metadata (supports merging)
  ├─ Merge: { transport: 'http', ...existing, ...options }
  ├─ Ensure 'global' is always in channels
  └─ Reflect.defineMetadata('page:options', mergedOptions, target)
       // target = class constructor (Tasks)
       // mergedOptions.middlewares = [loggingMiddleware]  ← function references
```

**Key detail**: The `middlewares` array holds direct function references. These are not serialized — they are the actual `MiddlewareHandler` closures. Both the decorator and the router must run in the same JS environment (SSR) so that `Reflect.getMetadata` retrieves the same references.

---

## Phase 2: Module Loading

### `virtual:cossack-pages`

**File**: `packages/framework/src/vite-plugin.ts`

The Vite plugin creates a virtual module that loads all page and layout modules:

```
SSR environment (name !== 'client'):
  pages    = import.meta.glob('pages/**/*.ts', { eager: true })   // synchronous
  layouts  = import.meta.glob('pages/**/layout.ts', { eager: true })
  loadings = import.meta.glob('pages/**/loading.ts', { eager: true })

Client environment (name === 'client'):
  pages    = import.meta.glob('pages/**/*.ts')                    // lazy, code-split
  layouts  = import.meta.glob('pages/**/layout.ts', { eager: true })
```

**Why layouts are always eager**: Layouts are small and shared. They're needed immediately on both server and client to wrap page content.

**Why pages are lazy on the client**: Only the active page's code is loaded in the browser, enabling code splitting.

**Impact on middleware**: When a page module is loaded (eager on SSR, lazy on client), its imports are resolved. If a page imports a middleware from `src/middlewares/`, that module is loaded too. On the SSR side, the `@Page` decorator runs immediately and stores the middleware references in metadata. On the client side, the decorator also runs (storing metadata), but that metadata is never read for Hono route registration.

---

## Phase 3: Route Registration

### `createApp()` — middleware collection

**File**: `packages/framework/src/router.ts` (lines 561–604)

The route registration loop iterates over all loaded page modules:

```
for each path in pages:
  │
  ├─ Derive httpRoute from file path:
  │    /src/pages/tasks/index.ts → /tasks
  │    /src/pages/hello/[name]/index.ts → /hello/:name
  │    /src/pages/index/index.ts → /
  │
  ├─ Skip 404/error pages
  │
  ├─ Get module's main export (the class)
  ├─ Verify: extends Cossack?
  │
  ├─ Read page options from metadata:
  │    pageOptions = Reflect.getMetadata('page:options', PageComponent)
  │
  ├─ Build layout stack:
  │    getLayoutStack('/src/pages/dashboard/settings/index.ts')
  │      → ['/src/pages/layout.ts', '/src/pages/dashboard/layout.ts']
  │
  ├─ Collect middlewares (root → leaf order):
  │    combinedMiddlewares = []
  │    for each layoutPath in layoutStack:
  │      lOpts = Reflect.getMetadata('page:options', LayoutComponent)
  │      combinedMiddlewares.push(...lOpts.middlewares)
  │    combinedMiddlewares.push(...pageOptions.middlewares)
  │
  └─ Register route:
       app.get(httpRoute, ...combinedMiddlewares, ssrHandler)

       // For HTTP-transport pages, also register action methods:
       if transport === 'http':
         for method in [post, put, patch, delete]:
           if method exists on prototype:
             app[method](httpRoute, ...combinedMiddlewares, apiHandler)
```

### `getLayoutStack()` — layout resolution

**File**: `packages/framework/src/router.ts` (lines 135–155)

Walks the directory tree from `src/pages/` down to the page's directory, collecting `layout.ts` files:

```
Page: /src/pages/dashboard/settings/index.ts
  │
  ├─ /src/pages/layout.ts              → exists? push
  ├─ /src/pages/dashboard/layout.ts    → exists? push
  │
  └─ stack = ['/src/pages/layout.ts', '/src/pages/dashboard/layout.ts']
```

Middleware ordering is root-to-leaf: the root layout's middleware runs first, then each nested layout's middleware, then the page's own middleware.

---

## Phase 4: `defineServerMiddleware()`

**File**: `packages/core/src/shared/middleware.ts`

```typescript
export function defineServerMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
    return handler;
}
```

This is a **passthrough function** — it returns the handler unchanged. It exists for:

1. **Semantic documentation**: Makes it explicit that a middleware is server-only.
2. **API stability**: If a future version needs runtime behavior (e.g., stripping the handler from client bundles), the function is already in place.

### Why no `isServer` guard

Middlewares are only ever invoked through Hono's route system in `router.ts`, which runs exclusively on the server. The client never calls these middleware functions through a Hono router — it only stores them in metadata as part of the `@Page` decorator.

A previous implementation wrapped the handler in `if (isServer)`, but the Cloudflare Workers runtime (via `@cloudflare/vite-plugin`) provides a `window` global in its sandbox, causing `isServer` to evaluate to `false`. Since the guard is unnecessary (middlewares only run server-side via Hono), it was removed.

### Inline middleware pattern

Middleware can also be defined inline in a page file without `defineServerMiddleware`:

```typescript
const myMiddleware: MiddlewareHandler = async (c, next) => {
    console.log('log');
    await next();
};
```

This works identically. The inline pattern is simpler for one-off use; `defineServerMiddleware` is preferred for reusable middleware files in `src/middlewares/`.

---

## Phase 5: Security Plugin Interaction

**File**: `packages/framework/src/vite-security-plugin.ts`

The security plugin transforms Cossack component source code in the **client** environment only. It stubs server-only methods.

### Middleware files are NOT processed

The plugin's `shouldProcessFile` guard skips files that don't contain class definitions extending `Cossack` or `CossackElement`:

```
transform(code, id)
  │
  ├─ environment !== 'client'? → passthrough
  ├─ id includes 'node_modules'? → passthrough
  ├─ id includes '@cossackframework/core'? → passthrough
  ├─ code doesn't include 'extends Cossack' AND
  │  code doesn't include 'extends CossackElement' AND
  │  code doesn't include '@Service'? → passthrough  ← middleware files hit this
  │
  └─ Process: stub server-only methods
```

A file like `src/middlewares/logging.ts` has no class extending `Cossack`, so it passes through unchanged in both client and SSR environments. The middleware function is included in both bundles as-is.

### Page files ARE processed (client bundle only)

In the client bundle, a page component's server-only methods are stubbed. However, the `middlewares` array stored in `page:options` metadata is preserved — it's just an array of function references, not method bodies. The security plugin does not modify the decorator arguments.

---

## Complete Request Flow

### SSR GET with middleware

```
GET /tasks
  │
  ├─ Hono matches route: app.get('/tasks', loggingMiddleware, ssrHandler)
  │
  ├─ loggingMiddleware(c, next)
  │    ├─ console.log('[GET] /tasks')
  │    └─ await next()
  │
  ├─ ssrHandler(c)
  │    ├─ getInlineCss()
  │    ├─ createInstance(App) → bootstrap
  │    ├─ createInstance(Layout) → bootstrap    (no layout middleware for /tasks)
  │    ├─ createInstance(Tasks) → bootstrap
  │    │    └─ init() sets initial task state
  │    ├─ pageInstance._render()
  │    ├─ wrap with layouts, then App
  │    ├─ merge head() from page → layouts → app
  │    └─ renderRoot({ body, initialState, headTags })
  │
  └─ Response: HTML with embedded __INITIAL_STATE__
```

### HTTP POST action with middleware

```
POST /tasks  (transport: 'http' pages only)
  │
  ├─ Hono matches: app.post('/tasks', ...combinedMiddlewares, apiHandler)
  │
  ├─ middlewares run (same stack as GET)
  │
  └─ apiHandler(c)
       ├─ createInstance(PageComponent) → bootstrap({ skipInit: true })
       ├─ Apply client state to instance
       ├─ Call action method
       └─ Return getPublicState() as JSON
```

### Non-HTTP transport actions (durable-object, websocket)

```
POST /crpc { componentRouteId, action, state, payload }
  │
  ├─ This route does NOT go through page middlewares
  │   (registered as app.post('/crpc', handler) without page middlewares)
  │
  └─ handler(c)
       ├─ Resolve component path from componentRouteId
       ├─ createInstance(PageComponent) → bootstrap({ skipInit: true })
       ├─ Apply state, call action
       └─ Return getPublicState() as JSON
```

**Note**: CRPC and WebSocket RPC actions bypass page-level middleware. Middleware only applies to Hono routes registered in the page registration loop (GET for SSR, POST/PUT/PATCH/DELETE for HTTP-transport pages).

---

## Layout Middleware Stacking

Given this directory structure:

```
src/pages/
  layout.ts              @Page({ middlewares: [rootAuth] })
  dashboard/
    layout.ts            @Page({ middlewares: [dashLogger] })
    settings/
      index.ts           @Page({ middlewares: [settingsGuard] })
```

Route registration for `/dashboard/settings`:

```
getLayoutStack('/src/pages/dashboard/settings/index.ts')
  → ['/src/pages/layout.ts', '/src/pages/dashboard/layout.ts']

combinedMiddlewares = [
  rootAuth,        ← from /src/pages/layout.ts
  dashLogger,      ← from /src/pages/dashboard/layout.ts
  settingsGuard,   ← from /src/pages/dashboard/settings/index.ts
]

app.get('/dashboard/settings', rootAuth, dashLogger, settingsGuard, ssrHandler)
```

Execution order: `rootAuth → dashLogger → settingsGuard → ssrHandler`.

Each middleware calls `await next()` to pass control to the next. If any middleware returns early (e.g., `return c.redirect('/login')`), the chain stops.

---

## Metadata Keys Used

| Key | Set By | Location | Contents |
|-----|--------|----------|----------|
| `page:options` | `@Page()` | class constructor | `{ middlewares?: MiddlewareHandler[], channels, transport, ... }` |

---

## Known Constraints

1. **CRPC bypasses middleware**: The `/crpc` and `/ws/:provider/:id` routes are registered globally, not per-page. Page-level middlewares only apply to SSR GET requests and HTTP-transport action methods (POST, PUT, PATCH, DELETE).

2. **Upload route bypasses middleware**: The `/upload` route (file uploads) is also a global route that does not go through page middlewares.

3. **Middleware runs on server only**: Despite the client bundle containing the middleware function references (in metadata), they are never invoked on the client because there is no Hono router on the client side.

4. **No middleware on SPA navigations**: Client-side navigations (intercepted `<a>` clicks) fetch data via the SSR route, which does go through middleware. But the middleware runs on the server — the client never executes it locally.

5. **Layout ordering is root-to-leaf**: There is no way to reverse the order or exclude parent middleware from a child page.

6. **`defineServerMiddleware` is a passthrough**: It provides no runtime behavior beyond returning the handler. Its value is semantic — it documents that the middleware is intended for server-side execution only.
