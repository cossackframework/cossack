# Lifecycle Tasks

Cossack's task decorators run logic on component mount and on state updates.
They are the declarative alternative to scattering setup/teardown code across
lifecycle hooks. All decorators are imported from `@cossackframework/core`.

> **Client-bundle note:** `@ServerTask` bodies are stripped from the client
> bundle (like `@Server`). `@Task`, `@ClientTask`, and `@VisibleTask` bodies
> are preserved. See `references/server-client-rpc.md` for the stripping rules.

## The four task decorators

| Decorator | Server | Client | Use for |
|---|---|---|---|
| `@Task` | ✅ Runs | ✅ Runs | Logic safe on both sides (logging, derived state) |
| `@ServerTask` | ✅ Runs | ❌ Body stripped | Server-only side effects (no `if (isServer)` guard) |
| `@ClientTask` | ❌ Skipped | ✅ Runs | DOM/browser logic (no `if (!isServer)` guard) |
| `@VisibleTask` | ❌ Skipped | ✅ Runs | Deferred until the element enters the viewport |

Every task runs **once on mount** (during bootstrap), then re-runs on state
updates according to its `track` option.

## `@Task` — runs on both server and client

Use for logic that must stay in sync with component state across SSR and
hydration: derived state, logging, side effects safe in both environments.

```typescript
import { Cossack, Task, State } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @State() count = 0;

    @Task()
    logUpdate() {
        console.log(`Count is: ${this.count}`);
    }
}
```

> **Don't** access `window` / `document` / the DOM inside `@Task` — it runs
> during SSR where those globals are undefined. Use `@ClientTask` (if the logic
> must re-run on every render) or `onMount()` / `@On('mount')` (if it's
> one-time setup).

## `@ServerTask` — server only

Body is stripped from the client bundle by the security plugin. Use for
server-side data normalization, env-driven state seeding, or analytics — no
manual `if (this.isServer) return;` guard needed.

```typescript
import { Cossack, ServerTask, State } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @State() serverTime = '';

    @ServerTask()
    setServerTime() {
        this.serverTime = new Date().toISOString();
    }
}
```

## `@ClientTask` — client only

Body is preserved in the client bundle; the server skips it. Use for logic that
touches the DOM or browser APIs and needs to re-run on every render. This
replaces the manual `if (this.isServer) return;` guard that was previously
needed inside `@Task`.

```typescript
import { Cossack, ClientTask } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @ClientTask()
    syncDialogState() {
        const dlg = this.dialogRef.value;
        if (!dlg) return;
        if (this.props.open && !dlg.open) dlg.showModal();
        else if (!this.props.open && dlg.open) dlg.close();
    }
}
```

## Tracking dependencies: the `track` option

By default, a task runs on **every** state change — any `@State`, `@Store`,
`@ClientState`, or `@ClientStore` mutation re-triggers it. When a task only
cares about a few specific fields, re-running it on every change wastes work
(and can cause unwanted side effects like refetching data when an unrelated
counter changes).

All three task decorators accept `track` — a React `useEffect`-style dependency
array. The task runs once on mount, and again **only** when one of the tracked
dependencies changes.

```typescript
@State() user = null;
@State() posts = [];
@State() darkMode = false;   // unrelated to the feed

// Runs on mount, and ONLY when `user` or `posts` change.
// Toggling `darkMode` will NOT re-run this.
@Task({ track: ['user', 'posts'] })
async reloadFeed() {
    this.feed = await fetch(`/api/feed?u=${this.user.id}`).then(r => r.json());
}
```

### Tracking nested store fields (dot-paths)

For `@Store` / `@ClientStore`, address a specific nested field with a
**dot-path**. This avoids re-running an expensive task when a *sibling* field
in the same store changes.

```typescript
@Store() form = {
    email: '',
    address: { zip: '' },
    card: { number: '', cvc: '' },
};

// Runs only when the email field changes — NOT when card.number or
// address.zip change, even though they live in the same `form` store.
@Task({ track: ['form.email'] })
validateEmail() {
    this.emailValid = /^[^@]+@[^@]+\.[^@]+$/.test(this.form.email);
}
```

### How path matching works

Matching is **segment-wise prefix in either direction**, so you get intuitive
behavior:

| `track` dep | Changed path | Runs? | Why |
|---|---|---|---|
| `'user'` | `'user'` | ✅ | Exact match |
| `'user'` | `'user.name'` | ✅ | Ancestor of the change (the whole `user` is tracked) |
| `'form.email'` | `'form.email'` | ✅ | Exact match |
| `'form.email'` | `'form'` | ✅ | The whole `form` was reassigned, so `email` changed too |
| `'form.email'` | `'form.password'` | ❌ | Sibling field — not tracked |
| `'store'` | `'store.user.address.zip'` | ✅ | Tracking the whole store fires on any nested mutation |

> **Tip:** Tracking the top-level store key (`track: ['form']`) fires on *any*
> nested mutation of that store. Tracking a deep path (`track: ['form.email']`)
> scopes the task to that specific field.

### Notes on tracking

- **The option is named `track`** (not `tracker`).
- **Mount always runs.** A tracked task runs once during bootstrap regardless of
  `track` — mirroring `useEffect`'s mount run.
- **Omitting `track` is legacy behavior.** A task with no `track` (or an empty
  array) runs on **every** state change.
- **By name, not by value.** `track` takes property *names* (strings) or
  dot-paths — it cannot take runtime values like `track: [this.user]`, because
  decorators run at class-definition time, before any instance exists.
- Symbols are supported and match only against their own top-level key.

### Known limitation — aliased objects in a `@Store`

When the **same object reference sits at two different paths** inside a store
(aliasing), Cossack reports the mutation at the **first-seen** path (proxies are
cached by raw target). Workaround: don't alias — use separate objects.

```typescript
const shared = { name: 'Jane' };
@Store() form = { primary: shared, secondary: shared };   // ❌ aliased

@Task({ track: ['form.secondary.name'] })
watchSecondary() { /* NEVER fires — reported path is form.primary.name */ }

// ✅ Fix: separate objects → separate proxies → correct paths
@Store() form = { primary: { name: 'Jane' }, secondary: { name: 'Jane' } };
```

This almost never matters — most stores are tree-shaped.

## Automatic cleanup (React `useEffect` style)

A task may **return a cleanup function**. The cleanup runs automatically:

1. **Before the next re-run** of that task (so stale timers, listeners, and
   subscriptions from the previous run are torn down first).
2. **Once when the component is destroyed** (`onCleanup()` / `destroy()`).

Works for `@Task`, `@ServerTask`, and `@ClientTask`. Async tasks may return a
cleanup from the resolved promise. Errors inside a cleanup are logged and
swallowed, so one failing cleanup can't block siblings.

```typescript
import { Cossack, Task, State } from '@cossackframework/core';

export default class LiveTicker extends Cossack {
    @State() symbol = 'AAPL';

    // Re-subscribes whenever `symbol` changes; the previous subscription's
    // cleanup runs first, and the final one runs on destroy().
    @Task({ track: ['symbol'] })
    subscribe() {
        const ws = new WebSocket(`/quotes/${this.symbol}`);
        ws.onmessage = (e) => (this.price = JSON.parse(e.data).price);
        return () => ws.close();   // cleanup
    }
}
```

## `@VisibleTask` — deferred until visible

Runs **only on the client** when the component (or a specific element within it)
becomes visible in the viewport via `IntersectionObserver`. Use for expensive
operations that should be deferred until the user actually sees the content
(fetching data, starting animations, initializing heavy libraries).

Options:
- `strategy?: 'intersection-observer' | 'document-ready'` (default `'intersection-observer'`)
- `threshold?: number` — visibility fraction 0–1 (default `0`)
- `selector?: string` — CSS selector to target a specific element within the
  component. When set, `@VisibleTask` automatically observes **new elements**
  that match the selector after each SPA navigation.

```typescript
@VisibleTask({ strategy: 'intersection-observer', threshold: 0.5 })
async loadData() {
    this.data = await fetch('/api/data').then(res => res.json());
}

@VisibleTask({ selector: '#chart-container' })
initChart() { /* runs when #chart-container becomes visible */ }
```

## Choosing the right tool

| You need to... | Use | Fires |
|---|---|---|
| React to state changes on **both server and client** | `@Task` | Mount + every state update (SSR-safe) |
| React to **specific** state fields only | `@Task({ track: [...] })` | Mount + when a tracked dep changes |
| Run a task on **server only** (no `isServer` guard) | `@ServerTask` | Mount + every state update (server only) |
| Run a task on **client only** (no `isServer` guard) | `@ClientTask` | Mount + every state update (client only) |
| Tear down side effects automatically | return a cleanup fn from a task | Before next re-run + on destroy |
| Run setup logic **once on the client** | `onMount()` or `@On('mount')` | Once after first client render |
| Defer work until an element **enters the viewport** | `@VisibleTask` | Client-only, on intersection |
| React to **SPA navigation** globally | `onNavigateComplete()` / `@On('navigate-complete')` | App component only, after each route change |
| Release resources before destroy | `onCleanup()` | Once, before destruction |

### `@Task` vs `onMount()`

- **`@Task`** runs on **both server and client**, re-runs on **every state
  update**. Use for derived state/logging that must stay in sync across SSR and
  hydration.
- **`onMount()`** runs **once, client-only**. Use for one-time setup: starting
  timers, initializing client-only libraries, reading `window`/`document`.

If your logic touches `window`, `document`, or the DOM directly, it belongs in
`onMount()` (or `@On('mount')`), **not** `@Task` — otherwise it crashes during
SSR where those globals don't exist.

## Common pitfalls

- **Accessing `window`/`document`/the DOM inside `@Task`.** It runs during SSR
  where those globals are undefined. Use `@ClientTask` (re-runs on every render)
  or `onMount()` / `@On('mount')` (one-time setup).
- **Writing `tracker` instead of `track`.** The option is `track`.
- **Using `@On('navigate-complete')` on a Page or Layout.** It only fires on the
  App component. For page-specific "I just loaded" logic, use `@On('mount')`.
- **Manual `addEventListener` for document/window events.** Use `@OnDocument` /
  `@OnWindow` — they handle cleanup automatically.
- **Reaching for `@VisibleTask` when `@Task` would do.** If the work is cheap or
  needed immediately, `@Task` (or `onMount()`) is simpler.
