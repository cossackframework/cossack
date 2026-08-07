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

## Server/client method calling — no `fetch()`

This is the framework's core feature. A `@Server()` method runs on the server only; on the client its body is replaced with an **automatic RPC proxy**. You call it as `this.method(args)` — the framework handles the wire call. **Never write `fetch('/api/...')` to reach a server method.**

```typescript
// ❌ Reinventing the RPC the framework already gives you:
async loadUser(id: number) {
    const res = await fetch(`/api/users/${id}`);
    this.user = await res.json();
}

// ✅ The built-in: define @Server(), call it directly.
@Server()
async loadUser(id: number) {
    this.user = await User.findOne({ where: { id } }); // server-only, state syncs back
}
// client: await this.loadUser(42)  — no fetch, no API route
```

The reverse works too: inside a `@Server()` method, calling `this.someClientMethod(args)` runs it on **every connected client** (toasts, alerts, UI resets). `@Shared()` retains the body in both bundles for logic that must run identically on both sides.

See `references/server-client-rpc.md` for the full mechanism (transports, transportable arguments, security, server→client calls).

For read-only data consumed by rendering, prefer the compiler macro `server$`
over `init() + @State() + @Server()` boilerplate. Keep `@Server()` for
mutations, redirects, session/flash writes, broadcasts, and client actions. See
`references/server-functions.md`.

## Use the built-in (don't reinvent)

| If you're about to… | Use the built-in | Notes |
|---|---|---|
| Call the server from the client | `@Server()` method, called as `this.method()` — **no `fetch()`** | Auto RPC proxy; see `references/server-client-rpc.md` |
| Load read-only server data for rendering | `server$(() => query(), { initial })` | SSR, hydration, reactive deps; see `references/server-functions.md` |
| Query a database | Decorated models from `@cossackframework/database` | Use in `server$` for render data or `@Server()` for actions; see `references/database.md` |
| Cache an expensive result | `cache.remember(key, ttl, fn)` from `@cossackframework/framework/cache` | Server-only; KV recommended; see `references/cache.md` |
| Validate a form field | `@Validate({ rules, config })` + `getError()` / `hasError()` / `validateAll()` | See `references/validation.md` |
| Handle a form submission | Progressive: `<form method="post">` + `post()` + `flash`/`old`. Reactive: `@Store` + `@Validate` + `@Server` submit. | No `fetch()`; see `references/forms.md` |
| Track "is loading" | `this.loading['methodName']` (counter), `loadingTemplate()`, `loading.ts`, `clientInit()` | Auto-tracked; see `references/loading.md` |
| Show a route-level skeleton | `loading.ts` next to `index.ts` in the route dir | Auto-rendered during navigation |
| Render an image | `Image({ src, width, height, alt, ... })` | Cloudflare Image Resizing aware; never raw `<img>` for hero/feature images |
| Access a DOM node | `@Ref()` decorator | No `querySelector` |
| Run code after mount | `onMount()` / `@Task()` / `@VisibleTask()` | No manual `setTimeout`/`IntersectionObserver` |
| Run logic on **every state change** | `@Task()` (both sides) / `@ServerTask()` (server-only) / `@ClientTask()` (client-only) | Replaces manual `if (isServer) return;` guards; see `references/tasks.md` |
| Run a task only when **specific fields** change | `@Task({ track: ['user', 'posts'] })` | useEffect-style dep array; supports dot-paths like `'form.email'`; see `references/tasks.md` |
| Tear down side effects automatically | return a cleanup fn from a `@Task`/`@ServerTask`/`@ClientTask` | Runs before next re-run + on destroy (React `useEffect` style) |
| Listen to window/doc events | `@OnWindow('resize', { debounce })` / `@OnDocument('keydown')` | Auto-bound + auto-cleaned; supports throttle/debounce |
| Derive a value from state | `@Computed()` getter | Memoized; don't recompute inline in `render()` |
| Mutate nested objects/arrays reactively | `@Store()` / `@ClientStore()` (deep Proxy) | No manual reassign for `obj.field = x` / `arr.push()`; see `references/decorators.md` |
| Share reactive global state across components | `createStore()` + `connectStore()` | For toasts/theme/palette — re-renders on change; see `references/reactive-store.md` |
| Use a Button / Input / Modal / Toast | `@cossackframework/ui` via `component(Button, {...})` | shadcn-style components + Solar icons; see `references/ui.md` |
| Trap or cycle focus in overlays | `focusTrap()` / `focusNext()` / `getTabbable()` from `@cossackframework/core` | For custom menus/dialogs; native `<dialog>` (Modal/Sheet) traps automatically; see `references/ui.md#focus-management` |
| Coerce form values (number/boolean/date) | `coerce` rule in `@Validate` / `getFormData<T>()` | Transforms before validation, writes back to `data`; see `references/validation.md` |
| Bind a method as a handler | nothing — methods are auto-bound | No arrow-function class fields, no `.bind(this)` |
| Redirect | `this.redirect(url)` | Client-intercepted as soft SPA navigation |
| Set `<head>` metadata / SEO / OG | `head(context)` returning `HeadContext` | `description`/`image` auto-expand to OG/Twitter |
| Handle errors / 404 | `error/index.ts` and `404/index.ts` near the route | Hierarchical boundaries; see `references/errors.md` |
| Add auth | `cossack add auth` (scaffolds it all) → `createAuth()` + `auth.middleware` from `@cossackframework/auth` | No hand-rolled session checks; see `references/auth.md` |
| Add a native desktop target | `cossack add desktop` with any web adapter | Keep routes shared; normal server methods run in the Electron main process through local RPC; see `references/desktop.md` |
| Real-time state sync | `@Page({ transport: 'sse' \| 'durable-object' })` + `channels`/`scope` | Default to `sse`; see `references/realtime.md` |
| Broadcast a stateless event | `@Server() broadcastEvent(name)` + `@OnEvent(name)` | |
| Register server middleware | `defineServerMiddleware()` + `@Page({ middlewares })` | No route-wrapper hacks |
| Share logic/state across components | `@Service({ scope })` (DI) | No module-level singletons |
| Prevent leaving the page | `@PreventNavigation()` | No `beforeunload` |
| Static-render a page | `@Page({ ssg: true })` | No custom pre-render scripts |
| Optimistic UI | `@Optimistic('serverMethod')` + a `@ClientState` shadow + `@Computed` display getter | See `references/validation.md` sibling patterns / optimistic docs |
| Render a list (keyed, reorderable) | `repeat(items, keyFn, template)` | Per-item state preserved across reorder; see `references/directives.md` |
| Render a list (any iterable) | `map(iterable, fn)` / `join(iterable, fn, sep)` / `range(...)` | Unkeyed; see `references/directives.md` |
| Conditional render (2+ branches) | `when(cond, a, b?)` / `choose(value, cases, default?)` | Only the taken branch evaluates; see `references/directives.md` |
| Dynamic classes / styles | `classMap({ ... })` / `styleMap({ ... })` | Pure functions returning a string; see `references/directives.md` |
| Two-way bind a form field | `bind(this, 'field')` | Reads field + writes edits back; see `references/directives.md` |
| Optional attribute (undefined-only drop) | `ifDefined(value)` | Drops attr only on `undefined`; see `references/directives.md` |
| Memoize an expensive subtree | `guard(deps, factory)` | Skips re-render until deps change; see `references/directives.md` |
| Preserve state across template swaps | `cache(value)` | Keeps switched-away subtrees alive; see `references/directives.md` |
| Force a subtree remount | `key(value, template)` | Re-triggers animations / remounts; see `references/directives.md` |

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

`@Validate` stacks **on top of** `@State`/`@ClientState`/`@Store`/`@ClientStore`. Declare an `errors` state property yourself — the framework writes messages there but does not create it. Use `validateAll()` before submit, `validateProperty(name)` on blur/input. Built-in rules: `required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `email`, `url`, `custom`, `customAsync`, `coerce` (`'number'|'boolean'|'date'`). Full API in `references/validation.md`.

**Nested validation** — for a single `@Store`/`@ClientStore`, pass a rule map (use `storeRules<T>()` for compile-time-checked keys) that mirrors the store shape. Keys are relative to the store and auto-prefixed at runtime; `errors` stays a flat object keyed by the full dot-path (`'form.address.zip'`). `validateProperty`/`hasError`/`getError` take the full prefixed path.

**Typed submission** — `this.c.getFormData<T>({ rules })` returns `{ data, errors, valid }`. With `coerce`, `data` is correctly typed (`number`/`boolean`/`Date`, not `string`):

```typescript
const { data, valid } = await this.c.getFormData<SignupForm>({
    rules: storeRules<SignupForm>({
        age:      { coerce: 'number', min: 18, message: 'Must be 18+' },
        tos:      { coerce: 'boolean', required: true },
        birthday: { coerce: 'date' },
    }),
});
if (valid) { data.age /* number */, data.tos /* boolean */, data.birthday /* Date */ }
```

### 2. Loading — use `this.loading` and `loadingTemplate()`

```typescript
async init() { this.user = await fetchUser(); }

loadingTemplate() { return html`<div class="skeleton">Loading…</div>`; }

render() {
    // For @Server method "save": this.loading.save > 0 means pending
    return html`<button ?disabled="${this.loading.save}">Save</button>`;
}
```

The framework auto-tracks pending `@Server()` / `@Client()` / `@Shared()` calls by method name (a reference counter — truthy when `> 0`) and `init`/`get` automatically. For full-page skeletons on navigation, add a `loading.ts` file in the route directory.

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
}
```

The renderer ships a full directive set for common template patterns — prefer
them over hand-rolled equivalents: `repeat` (keyed lists), `when`/`choose`
(conditionals), `classMap`/`styleMap`, `ifDefined`, `bind` (two-way form
binding), `live`, `guard`/`cache` (memoization), `key`, `map`/`join`/`range`,
`preventDefault`. All from `@cossackframework/renderer`; all SSR + client safe.
See `references/directives.md` for the full list, signatures, and when to reach
for each.

## Navigation lifecycle

- `onMount()` once after first client render; `onCleanup()` before destruction.
- `onNavigateComplete(pathname)` on the App component after every navigation.
- Custom events on `document`: `cossack:ready` (after navigation), `cossack:before-navigate` (before SPA nav).
- `clientInit()` runs after hydration (commonly calls `init()` via RPC for the loading pattern).

## Common mistakes to avoid

- **Writing `fetch('/api/...')` to call the server.** Use a `@Server()` method and call it as `this.method()`. The framework installs an automatic RPC proxy — no API route, no serialization boilerplate. See `references/server-client-rpc.md`.
- **Using `init() + @State() + @Server()` for read-only render data.** Prefer a named `server$` resource with `{ initial }` and explicit `deps`. Keep `@Server()` for effects. See `references/server-functions.md`.
- **Calling ORM models or `cache` directly from `@Client()` / `@Shared()` / `render()`.** Put reads in a `server$` loader or effects in `@Server()`. A `server$` loader is compiler-extracted even when the macro call appears in `render()`.
- **Stripped method ran as no-op on client.** Add `@Client()` / `@Shared()` / `@Optimistic()`.
- **`@Validate()` used alone.** It must stack on `@State()` / `@ClientState()` / `@Store()` / `@ClientStore()`.
- **Forgetting to declare the `errors` property.** `@Validate` writes to `config.errorProperty` (default `'errors'`), but does **not** create the property for you. Declare `@State() errors: Record<string, string> = {};` or errors are silently swallowed.
- **Arrow-function class fields for handlers.** Unnecessary — methods are auto-bound during bootstrap.
- **Manual `addEventListener` / `removeEventListener`.** Use `@OnWindow` / `@OnDocument` / `@On` (auto-cleaned).
- **Mutating state server-side without `@Server()`.** Changes won't broadcast to clients.
- **`location.href = ...`** Use `this.redirect()`.
- **`querySelector` for a child node.** Use `@Ref()`.
- **Accessing `window`/`document`/the DOM inside `@Task`.** `@Task` runs on both server and client, so it crashes during SSR. Use `@ClientTask()` (if the logic must re-run on every render) or `onMount()` / `@On('mount')` (if it's one-time setup). See `references/tasks.md`.
- **Writing `tracker` instead of `track`.** The task dependency option is `track` — `@Task({ track: ['user'] })`. See `references/tasks.md`.
- **Forgetting to unsubscribe a `connectStore()`.** Call the returned unsubscribe function in `onCleanup()`, or you'll leak a subscriber after the component is destroyed. See `references/reactive-store.md`.
- **Using `focusTrap` on a native `<dialog>` (Modal/Sheet).** The `<dialog>` element traps focus automatically — `focusTrap` is only for custom overlays that DON'T use `<dialog>`. See `references/ui.md#focus-management`.
- **Hand-rolling list/conditional/memoization logic in `render()`.** Use the renderer directives instead: `repeat`/`map`/`join`/`range` (lists), `when`/`choose` (conditionals), `classMap`/`styleMap`, `ifDefined`, `guard`/`cache` (memoization), `bind` (two-way binding). They handle SSR, hydration, and dirty-checking correctly. See `references/directives.md`.
- **Adding renderer IPC for normal Desktop actions.** Leave the method undecorated (or use `@Server()`): Cossack proxies it to the web runtime or Electron automatically. Use the window-scoped `COSSACK_DESKTOP` binding in server code. See `references/desktop.md`.

## References

- `references/server-client-rpc.md` — the RPC mechanism: `@Server`/`@Client`/`@Shared`, transports, server→client calls, security
- `references/server-functions.md` — `server$` fields/inline calls, deps, SSR/hydration, refresh/invalidation, query-vs-mutation rules
- `references/directives.md` — the full template directive set (`repeat`/`when`/`choose`/`classMap`/`styleMap`/`ifDefined`/`bind`/`live`/`guard`/`cache`/`key`/`map`/`join`/`range`/`preventDefault`/`ref`/`unsafeHTML`), signatures, and when to use each
- `references/decorators.md` — full decorator API (class, property, method decorators, helpers)
- `references/tasks.md` — task decorators (`@Task`/`@ServerTask`/`@ClientTask`/`@VisibleTask`), the `track` option + path matching, automatic cleanup, choosing the right tool
- `references/validation.md` — `@Validate` deep dive (rules incl. `coerce`, config, async validators, full form, nested `@Store` validation, typed `getFormData<T>()`)
- `references/forms.md` — the two form patterns: progressive (`post()` + `flash`/`old`) vs reactive (`@Store` + `@Validate` + `@Server`)
- `references/reactive-store.md` — `createStore()` / `connectStore()` for global reactive state, the imperative-API pattern (e.g. `toast`)
- `references/ui.md` — `@cossackframework/ui` components, theming, icons, ejecting; focus-management helpers (`focusTrap`/`focusNext`/…)
- `references/loading.md` — the four loading mechanisms (`loading.ts`, `loadingTemplate()`, `this.loading`, `clientInit()`)
- `references/database.md` — decorated entities, Active Record queries, scoped SQL, providers
- `references/cache.md` — `cache` facade, `remember()`, stores, KV recommendation
- `references/realtime.md` — SSE vs Durable Object transports, scope, channels, streaming, event-driven re-fetch
- `references/auth.md` — `cossack add auth` scaffold, `createAuth()` flow, the session/PBKDF2 module, guards, `this.user`
- `references/desktop.md` — independent Electron target, shared routes, automatic local server RPC, secure native APIs, persistence, and Forge packaging
- `references/errors.md` — `404/index.ts` and `error/index.ts` hierarchical boundaries
