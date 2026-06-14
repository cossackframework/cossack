---
name: cossack-best-practices
description: Cossack Framework best practices — use built-in features instead of reinventing them
user-invocable: false
paths:
  - "src/pages/**"
  - "src/components/**"
  - "src/services/**"
  - "src/middlewares/**"
  - "src/App.ts"
  - "src/root.ts"
---

# Cossack Framework Best Practices

Cossack ships built-in features for most common web-app needs. Before writing custom logic, check the table below — the framework almost already has it. Using the built-in keeps SSR, hydration, state sync, and code stripping correct.

## The #1 rule: methods are server-only by default

A method with **no decorator** is treated as server-only and its body is **stripped from the client bundle**. This is secure-by-default but a common source of bugs.

- Call it on the client → it silently becomes a server RPC proxy.
- Want the code to actually run in the browser? Mark it `@Client()`, `@Optimistic()`, `@Shared()`, or make it a built-in lifecycle method (`render`, `onMount`, `head`, …).
- When you reference a method as an event handler in `render()`, it must be client-safe.

See `references/decorators.md` for the full decorator API.

## Use the built-in (don't reinvent)

| If you're about to… | Use the built-in | Notes |
|---|---|---|
| Validate a form field | `@Validate({ rules, config })` + `getError()` / `hasError()` / `validateAll()` | See `references/validation.md` |
| Track "is loading" | `this.loading['methodName']` (counter), `loadingTemplate()`, `loading.ts`, `clientInit()` | Auto-tracked; see `references/loading.md` |
| Show a route-level skeleton | `loading.ts` next to `index.ts` in the route dir | Auto-rendered during navigation |
| Render an image | `Image({ src, width, height, alt, ... })` | Cloudflare Image Resizing aware; never raw `<img>` for hero/feature images |
| Access a DOM node | `@Ref()` decorator | No `querySelector` |
| Run code after mount | `onMount()` / `@Task()` / `@VisibleTask()` | No manual `setTimeout`/`IntersectionObserver` |
| Listen to window/doc events | `@OnWindow('resize', { debounce })` / `@OnDocument('keydown')` | Auto-bound + auto-cleaned; supports throttle/debounce |
| Derive a value from state | `@Computed()` getter | Memoized; don't recompute inline in `render()` |
| Bind a method as a handler | nothing — methods are auto-bound | No arrow-function class fields, no `.bind(this)` |
| Redirect | `this.redirect(url)` | Client-intercepted as soft SPA navigation |
| Set `<head>` metadata / SEO / OG | `head(context)` returning `HeadContext` | `description`/`image` auto-expand to OG/Twitter |
| Handle errors / 404 | `error/index.ts` and `404/index.ts` near the route | Hierarchical boundaries; see `references/errors.md` |
| Add auth | `createAuth()` + middleware from `@cossackframework/auth` | No hand-rolled session checks; see `references/auth.md` |
| Real-time state sync | `@Page({ transport: 'sse' \| 'durable-object' })` + `channels`/`scope` | Default to `sse`; see `references/realtime.md` |
| Broadcast a stateless event | `@Server() broadcastEvent(name)` + `@OnEvent(name)` | |
| Register server middleware | `defineServerMiddleware()` + `@Page({ middlewares })` | No route-wrapper hacks |
| Share logic/state across components | `@Service({ scope })` (DI) | No module-level singletons |
| Prevent leaving the page | `@PreventNavigation()` | No `beforeunload` |
| Static-render a page | `@Page({ ssg: true })` | No custom pre-render scripts |
| Optimistic UI | `@Optimistic('serverMethod')` + a `@ClientState` shadow + `@Computed` display getter | See `references/validation.md` sibling patterns / optimistic docs |

## Three essentials most often reinvented

### 1. Validation — use `@Validate`, never roll your own

```typescript
import { Cossack, Page, State, Validate } from '@cossackframework/core';

@State()
@Validate({ rules: { required: true, email: true, message: 'Enter a valid email' } })
email: string = '';

@State()
errors: Record<string, string> = {};

render() {
    return html`
        <input .value="${this.email}" @input="${e => this.email = e.target.value}" />
        ${this.hasError('email') ? html`<span>${this.getError('email')}</span>` : ''}
    `;
}
```

`@Validate` stacks **on top of** `@State`/`@ClientState`. Use `validateAll()` before submit, `validateProperty(name)` on blur/input. Built-in rules: `required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `email`, `url`, `custom`, `customAsync`. Full API in `references/validation.md`.

### 2. Loading — use `this.loading` and `loadingTemplate()`

```typescript
async init() { this.user = await fetchUser(); }

loadingTemplate() { return html`<div class="skeleton">Loading…</div>`; }

render() {
    // For @Server method "save": this.loading.save > 0 means pending
    return html`<button ?disabled="${this.loading.save}">Save</button>`;
}
```

The framework auto-tracks pending `@Server()` calls by method name and `init`/`get` automatically. For full-page skeletons on navigation, add a `loading.ts` file in the route directory.

### 3. Images — use `Image()`, not `<img>`

```typescript
import { Image } from '@cossackframework/core';

${Image({ src: '/banner.jpg', width: 800, height: 400, alt: 'Banner', loading: 'lazy' })}
```

In dev it renders a plain `<img>`; on Cloudflare (set `VITE_COSSACK_IMAGE_PROVIDER=cloudflare`) it rewrites to `/cdn-cgi/image/...` for automatic resizing/format conversion.

## Framework context available on every component

| Property | Description |
|---|---|
| `this.c` | Hono request context (params, query, headers) — server only |
| `this.user` | Authenticated user (if auth middleware configured) |
| `this.env` | Environment bindings (Cloudflare bindings, etc.) |
| `this.isServer` | `true` on server, `false` on client |
| `this.loading` | Pending-call counters, keyed by method name (`this.loading['init']`) |
| `this.children` | Projected content passed via `component(Parent, {}, children)` |
| `this.props` | Props passed from parent via `component()` |

## Routing conventions (file-based, under `src/pages/`)

| File | URL |
|---|---|
| `index/index.ts` | `/` |
| `about/index.ts` | `/about` |
| `blog/[slug]/index.ts` | `/blog/:slug` |
| `(auth)/login/index.ts` | `/login` (route group — no URL prefix) |
| `api/hello/index.ts` | `/api/hello` (API route) |
| `404/index.ts` | 404 fallback |
| `error/index.ts` | error fallback |

Layouts: `layout.ts` in any route directory wraps that subtree.

## Template syntax (`html` from `@cossackframework/renderer`)

```typescript
render() {
    return html`
        <p>${this.message}</p>                          <!-- text -->
        <button @click="${this.handleClick}">Go</button> <!-- event -->
        <input .value="${this.value}" />                <!-- property -->
        <button ?disabled="${this.busy}">Save</button>  <!-- boolean attr -->
        ${this.show ? html`<p>hi</p>` : ''}             <!-- conditional -->
        ${this.items.map(i => html`<li>${i}</li>`)}     <!-- list -->
        ${component(Child, { prop: 'x' }, 'slot')}      <!-- child -->
    `;
}
```

## Navigation lifecycle

- `onMount()` once after first client render; `onCleanup()` before destruction.
- `onNavigateComplete(pathname)` on the App component after every navigation.
- Custom events on `document`: `cossack:ready` (after navigation), `cossack:before-navigate` (before SPA nav).
- `clientInit()` runs after hydration (commonly calls `init()` via RPC for the loading pattern).

## Common mistakes to avoid

- **Stripped method ran as no-op on client.** Add `@Client()` / `@Shared()` / `@Optimistic()`.
- **`@Validate()` used alone.** It must stack on `@State()` or `@ClientState()`.
- **Arrow-function class fields for handlers.** Unnecessary — methods are auto-bound during bootstrap.
- **Manual `addEventListener` / `removeEventListener`.** Use `@OnWindow` / `@OnDocument` / `@On` (auto-cleaned).
- **Mutating state server-side without `@Server()`.** Changes won't broadcast to clients.
- **`location.href = ...`** Use `this.redirect()`.
- **`querySelector` for a child node.** Use `@Ref()`.

## References

- `references/decorators.md` — full decorator API (class, property, method decorators, helpers)
- `references/validation.md` — `@Validate` deep dive (rules, config, async validators, full form)
- `references/loading.md` — the four loading mechanisms (`loading.ts`, `loadingTemplate()`, `this.loading`, `clientInit()`)
- `references/realtime.md` — SSE vs Durable Object transports, scope, channels, streaming, event-driven re-fetch
- `references/auth.md` — `createAuth()` flow, login handler, guards, `this.user`
- `references/errors.md` — `404/index.ts` and `error/index.ts` hierarchical boundaries
