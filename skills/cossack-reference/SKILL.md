---
name: cossack-reference
description: Cossack Framework reference guide — decorators, template syntax, routing, and conventions
user-invocable: false
paths:
  - "src/pages/**"
  - "src/components/**"
  - "src/services/**"
  - "src/middlewares/**"
  - "src/App.ts"
  - "src/root.ts"
---

# Cossack Framework Reference

This skill provides background knowledge about the Cossack Framework. It is automatically loaded when working on Cossack-specific files.

## Framework Overview

Cossack is a full-stack TypeScript framework where components run on both server and client. A single component class handles SSR, hydration, client-side interactivity, and real-time state sync.

## Package Structure

```
@cossackframework/core       — Base class, decorators, utilities
@cossackframework/renderer    — html tag, component(), TemplateResult, CossackElement
@cossackframework/auth        — createAuth, createLoginHandler
@cossackframework/node-adapter — Node.js runtime adapter
```

## Decorators Quick Reference

See `references/decorators.md` for the full API table.

## Template Syntax

The `html` tagged template literal from `@cossackframework/renderer`:

```typescript
import { html, component } from '@cossackframework/renderer';

render() {
    return html`
        <div>
            <!-- Text interpolation -->
            <p>${this.message}</p>

            <!-- Event binding -->
            <button @click="${this.handleClick}">Click</button>

            <!-- Property binding (sets JS property, not attribute) -->
            <input .value="${this.inputValue}" />

            <!-- Boolean attribute -->
            <button ?disabled="${this.isLoading}">Submit</button>

            <!-- Attribute spreading -->
            <div ...=${this.restProps}></div>

            <!-- Conditional rendering -->
            ${this.showDetails ? html`<p>Details</p>` : ''}

            <!-- List rendering -->
            ${this.items.map(item => html`<li>${item.name}</li>`)}

            <!-- Component usage -->
            ${component(ChildComponent, { prop: 'value', '@click': this.onChildClick }, 'Slot content')}

            <!-- Image helper -->
            ${Image({ src: '/photo.jpg', width: 600, height: 400, alt: 'Photo', loading: 'lazy' })}
        </div>
    `;
}
```

## Routing Conventions

File-based routing under `src/pages/`:

| File Path | URL |
|-----------|-----|
| `pages/index/index.ts` | `/` |
| `pages/about/index.ts` | `/about` |
| `pages/about.ts` | `/about` (flat file) |
| `pages/hello/[name]/index.ts` | `/hello/:name` |
| `pages/blog/[category]/[slug]/index.ts` | `/blog/:category/:slug` |
| `pages/(auth)/login/index.ts` | `/login` (route group, no URL prefix) |
| `pages/api/hello/index.ts` | `/api/hello` (API route) |
| `pages/404/index.ts` | 404 fallback |
| `pages/error/index.ts` | Error fallback |

## Project Structure

```
src/
  index.ts              — App entry point (creates Hono app, exports fetch handler)
  App.ts                — Global App component (persists across navigations)
  root.ts               — HTML shell (renderRoot)
  router.ts             — Route registration and SSR pipeline
  pages/                — File-based routing
    layout.ts           — Root layout
    (group)/            — Route groups
    [param]/            — Dynamic segments
  components/           — Reusable components
  middlewares/          — Server middleware files
  services/             — Service classes (DI)
  client/
    entry-client.ts     — Client-side entry point
```

## Key Framework Context

Available on all Cossack component instances:

| Property | Type | Description |
|----------|------|-------------|
| `this.c` | `Context` | Hono request context. Access params, query, headers, etc. |
| `this.user` | `AuthenticatedUser \| undefined` | Authenticated user (if auth middleware configured) |
| `this.env` | `Env` | Environment bindings (Cloudflare bindings, etc.) |
| `this.isServer` | `boolean` | `true` on server, `false` on client |
| `this.loading` | `Record<string, number>` | Pending server method call counters. `this.loading['init'] > 0` means init is in progress. |
| `this.children` | `unknown` | Content projected into the component (from `component(Parent, {}, children)`) |
| `this.props` | `Record<string, any>` | Props passed from parent via `component()` |
| `this.activeComponents` | `Map<string, Cossack>` | Registry of active child component instances |

## Built-in Methods

| Method | Decorator Needed | Description |
|--------|-----------------|-------------|
| `render(): TemplateResult` | No | Returns the component's HTML template. Required. |
| `head(context: HeadContext): HeadValue` | No | Returns metadata for `<head>`. Optional. |
| `init()` | `@Server()` | Server-side initialization. Runs during SSR and on demand. |
| `get()` | No | Alternative to `init()` for data loading (returns state). |
| `onMount()` | No | Runs once after first client render. |
| `onCleanup()` | No | Runs before component destruction. |
| `clientInit()` | No | Runs after hydration on client. Calls init() via RPC for loading pattern. |
| `loadingTemplate()` | No | Returns loading UI. If present, SSR skips init() and shows loading UI. |
| `redirect(url, status?)` | No | Redirect. On client, intercepted as soft navigation. |
| `requestUpdate()` | No | Trigger a re-render manually. |
| `isActive(path, exact?)` | No | Check if a route is active (for nav highlighting). |
| `broadcastEvent(name)` | `@Server()` | Broadcast a stateless event to all connected clients. |
| `validateProperty(name)` | No | Validate a single property. Returns boolean. |
| `validateAll()` | No | Validate all validated properties. Returns boolean. |
| `getError(name)` | No | Get the validation error message for a property. |
| `hasError(name)` | No | Check if a property has a validation error. |
| `clearErrors()` | No | Clear all validation errors. |

## Build & Dev Commands

```bash
# Build library packages first
pnpm --filter @cossackframework/core build
pnpm --filter @cossackframework/renderer build
pnpm --filter @cossackframework/node-adapter build

# Run the application
pnpm --filter @cossackframework/framework run dev

# Type check
pnpm tsc --noEmit

# Unit tests
cd packages/core && pnpm vitest --run
cd packages/framework && pnpm vitest --run tests/

# E2E tests
cd packages/framework && pnpm exec playwright test
```

## Security: Code Stripping

The Vite security plugin (`cossackSecurityPlugin`) strips server-only code from client bundles:

- **Server-Only** (stubs in client): Methods with `@Server`, methods without decorators
- **Client-Safe** (full implementation): `@Client`, `@Optimistic`, `@Computed`, `@Shared`, built-in lifecycle methods
- Methods without any decorator are treated as server-only by default

## Auto-Binding

All component methods are automatically bound to the instance during `bootstrap`. Standard class methods can be used as event handlers without manual binding or arrow functions.

```typescript
// Both work directly as event handlers:
@Server() async fetchData() { ... }
handleClick() { ... }
```
