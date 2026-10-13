---
title: "Lifecycle Tasks & Events"
description: "Decorators and lifecycle hooks for handling component lifecycle tasks and DOM events in a declarative way similar to Qwik."
---

# Lifecycle Tasks & Events

Cossack provides decorators and lifecycle hooks for component lifecycle tasks and DOM events. The syntax is similar to Qwik. You can run logic on mount, on state updates, on visibility changes, and on user interactions.

`onMount`, `render`, and other lifecycle methods are preserved in the client bundle. Helpers that they call through `this.method(...)` are preserved too. If a helper is called through a dynamic callback that static analysis cannot see, mark it with `@Client()`. See [Client Bundle & Method Stripping](./client-bundle.md).

## @Task

The `@Task` decorator marks a method to run on component mount and every time the component's state updates. This method runs on both the server and the client.

`@Task` accepts an optional options object. Pass `{ track: [...] }` to run the task only when specific state fields change. Return a cleanup function for automatic teardown. See [Tracking Dependencies](#tracking-dependencies-the-track-option) and [Automatic Cleanup](#automatic-cleanup-react-useeffect-style) below.

Async tasks receive an `AbortSignal`. Dependency changes and disposal abort the
previous execution. Make sure that `signal.aborted` is not set after each awaited
operation and before you write state. Cancellation cannot undo arbitrary
application writes. Pass the signal to APIs that support cancellation, such as
`fetch`. A cleanup returned after cancellation still runs. Repeated executions
wait for that task's registered cleanup, while unrelated tasks can proceed.

The signal remains owned after setup finishes. A returned subscription or timer
can keep reading that signal. A rerun aborts it before cleanup. Disposal aborts
all task signals before component cleanup hooks. Completing setup does not release
the execution's cancellation identity.

```ts
import { Task, type TaskContext } from '@cossackframework/core';

@Task<SearchPage>({ track: ['query'] as const })
async load(signal: AbortSignal, task: TaskContext<SearchPage>) {
    const response = await fetch(`/search?q=${encodeURIComponent(this.query)}`, { signal });
    const results: SearchResult[] = await response.json();
    task.commit({ results });
}
```

`task.commit` applies a plain object of reactive field replacements synchronously.
It returns `false` when another execution owns the task or when the component is
destroyed. This also protects results from APIs that ignore cancellation.
Use a concrete component type, such as `TaskContext<SearchPage>`, so that
TypeScript rejects wrong field names and value types. Readonly fields, methods
and unknown names fail type checking. Runtime commits accept only initialized
reactive fields, including client-only state and stores. Ordinary fields and
injected services are rejected. The runtime rejects getters, callbacks and
promises before any write. Replace a nested store with its complete field shape.

The context is immutable. It exposes `signal`, `isCurrent`, `task`, `component`
and `trigger`. Ownership lasts after setup settles, so a subscription can retain
its context and commit while it remains current. A commit cannot roll back writes,
terminate ignored I/O or guard unrelated asynchronous side effects. For direct
writes to `this`, make sure that the execution is still current. Patches are
synchronous. There is no transaction or rollback guarantee across reentrant
setters.

### Typed dependency paths

Pass the host type to any task decorator so that TypeScript rejects unknown dependency names:

```ts
@ClientTask<SearchPage>({ track: ['query', 'form.filters.status', 'rows.0.id'] as const })
async update(signal: AbortSignal, task: TaskContext<SearchPage>) {
    // Read the tracked inputs; commit the result when this execution is current.
}
```

Paths include public fields, nullable nested objects, array indices and array
length, up to six segments. Methods are excluded. A path type follows its declared
shape. The field must still use a reactive state/store decorator to notify tasks.
For private fields, declare the dependency shape explicitly, for example
`@Task<{ query: string }>({ track: ['query'] })`. Decorators without a host type
accept untyped paths. The framework does not infer the supplied shape or compare
it with private runtime metadata.

Inherited tasks run alongside child declarations. Decorating the same method in
a child replaces its task kind and dependencies. Environment filtering happens
after that replacement. Setup, commit and cleanup failures identify the task,
component, trigger and stage. Cleanup failures are logged while other cleanup
continues. Disposal aborts signals before cleanup hooks and owned service disposal.
An uncancellable setup can settle after disposal. Its returned cleanup still runs,
but it cannot rely on an already disposed layout service.

### Usage

Use `@Task` for logic that runs initially or reacts to state changes. Examples are logging, derived state calculations, and side effects that are safe to run in both environments.

```typescript
import { Cossack, Task, State } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @State()
    count = 0;

    @Task()
    logUpdate() {
        console.log(`Component updated. Count is: ${this.count}`);
        // This runs on server during SSR/interactions, and on client during hydration/updates
    }
}
```

## @ServerTask

The `@ServerTask` decorator is like `@Task`, but the method runs only on the server. Its body is stripped from the client bundle by the security plugin (like `@Server` methods). A manual `if (this.isServer) return;` guard is not needed.

Use `@ServerTask` for logic that runs during server-side rendering or state broadcasts and must not run in the browser. Examples include data normalization, state setup from environment variables, and analytics logging.

```typescript
import { Cossack, ServerTask, State } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @State()
    serverTime = '';

    @ServerTask()
    setServerTime() {
        // Runs only on server — body is stripped from the client bundle.
        this.serverTime = new Date().toISOString();
    }
}
```

## @ClientTask

The `@ClientTask` decorator is like `@Task`, but the method runs only on the client. Its body is preserved in the client bundle (like `@Client` methods). `runTasks()` skips it when executing on the server.

Use `@ClientTask` for logic that touches the DOM or browser APIs and re-runs on every render. Examples are reconciling a `<dialog>` open state, positioning a popover, or updating a scroll indicator. It removes the manual `if (this.isServer) return;` guard from `@Task` code.

```typescript
import { Cossack, ClientTask } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @ClientTask()
    syncDialogState() {
        // Runs only on client — no isServer guard needed.
        const dlg = this.dialogRef.value;
        if (!dlg) return;
        if (this.props.open && !dlg.open) dlg.showModal();
        else if (!this.props.open && dlg.open) dlg.close();
    }
}
```

### @Task vs @ServerTask vs @ClientTask

| Decorator | Server | Client | Use for |
| --- | --- | --- | --- |
| `@Task` | ✅ Runs | ✅ Runs | Logic safe on both sides (logging, derived state) |
| `@ServerTask` | ✅ Runs | ❌ Body stripped | Server-only side effects (no `if (isServer)` guard needed) |
| `@ClientTask` | ❌ Skipped | ✅ Runs | DOM/browser logic (no `if (!isServer)` guard needed) |

## Tracking Dependencies: the `track` option

By default, a task runs on every state change. Any `@State`, `@Store`, `@ClientState`, or `@ClientStore` mutation re-triggers it. When a task reads only a few specific fields, a re-run on every change wastes work. It can also cause unwanted side effects, like refetching data when an unrelated counter changes.

All three task decorators accept a `track` option. It restricts which state changes re-run the task. It works like React's `useEffect` dependency array. The task runs once on mount, and again only when one of the tracked dependencies changes.

```typescript
import { Cossack, Task, State } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @State() user = null;
    @State() posts = [];
    @State() darkMode = false;   // unrelated to the feed

    // Runs on mount, and ONLY when `user` or `posts` change.
    // Toggling `darkMode` will NOT re-run this.
    @Task({ track: ['user', 'posts'] })
    async reloadFeed() {
        this.feed = await fetch(`/api/feed?u=${this.user.id}`).then(r => r.json());
    }
}
```

### Tracking nested store fields (dot-paths)

For `@Store` / `@ClientStore`, you can address a specific nested field with a dot-path. This avoids re-running an expensive task when a sibling field in the same store changes.

```typescript
import { Cossack, Task, Store } from '@cossackframework/core';

export default class CheckoutForm extends Cossack {
    @Store()
    form = {
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
}
```

### How path matching works

Matching compares path segments as a prefix in either direction:

| `track` dep | Changed path | Runs? | Why |
| --- | --- | --- | --- |
| `'user'` | `'user'` | ✅ | Exact match |
| `'user'` | `'user.name'` | ✅ | Ancestor of the change (the whole `user` is tracked) |
| `'form.email'` | `'form.email'` | ✅ | Exact match |
| `'form.email'` | `'form'` | ✅ | The whole `form` was reassigned, so `email` changed too |
| `'form.email'` | `'form.password'` | ❌ | Sibling field. Not tracked. |
| `'store'` | `'store.user.address.zip'` | ✅ | Tracking the whole store fires on any nested mutation |

Tracking the top-level store key (`track: ['form']`) fires on any nested mutation of that store. Tracking a deep path (`track: ['form.email']`) scopes the task to that specific field.

### Notes on tracking

- A tracked task runs once during bootstrap (the initial mount run), regardless of `track`. This mirrors `useEffect`, which runs once on mount.
- A task with no `track` (or an empty array) runs on every state change.
- `track` takes property names (strings) or dot-paths. It cannot take runtime values like `track: [this.user]`, because decorators run at class-definition time, before any instance exists.
- Symbols are supported and match only against their own top-level key.

### Known limitations & workarounds

#### Aliased objects in a `@Store` report the first-seen path

When you track a nested store field with a dot-path, Cossack matches it against the mutation path. The mutation path is the dotted location of the field that changed (`form.address.zip`). For tree-shaped stores (the common case), this is always correct.

The limitation arises when the same object reference sits at two different paths inside a store. This is aliasing. Nested store objects are wrapped in reactive Proxies that are cached by their raw target, for identity stability and cycle-safety. An aliased object reuses the proxy created for the first path it was accessed through. A mutation then reports that first path, not the path you used to reach it.

Example:

```typescript
const shared = { name: 'Jane' };

@Store()
form = {
    primary: shared,     // path: form.primary
    secondary: shared,   // SAME object reference — path: form.secondary
};

// Mutate through form.secondary:
this.form.secondary.name = 'Bob';
// Trigger reports: 'form.primary.name' (the first path), NOT 'form.secondary.name'

@Task({ track: ['form.secondary.name'] })
watchSecondary() { /* ❌ NEVER fires — reported path is form.primary.name */ }
```

Most stores are tree-shaped. Each object has exactly one parent, so every field has a unique, stable path. The issue only appears if you deliberately alias the same object reference into two slots of a store.

Workaround: use separate objects. Do not create aliases.

```typescript
@Store()
form = {
    primary:   { name: 'Jane' },   // separate objects → separate proxies
    secondary: { name: 'Jane' },   // each gets its own correct path
};

@Task({ track: ['form.secondary.name'] })
watchSecondary() { /* ✅ fires correctly now */ }
```

With distinct objects, each object gets its own proxy with the correct `basePath`. Mutation paths are then accurate, and `track` filtering works as expected.

## Automatic Cleanup (React `useEffect` style)

A task can return a cleanup function. The framework runs the cleanup:

1. Before the next re-run of that task. Stale timers, listeners, and subscriptions from the previous run are torn down first.
2. Once when the component is destroyed (`onCleanup()` / `destroy()`).

This follows the React `useEffect` cleanup contract. You do not manage teardown manually.

```typescript
import { Cossack, Task, State } from '@cossackframework/core';

export default class LiveTicker extends Cossack {
    @State() symbol = 'AAPL';

    // Re-subscribes whenever `symbol` changes; the previous subscription's
    // cleanup runs first, and the final one runs on unmount.
    @Task({ track: ['symbol'] })
    subscribe() {
        const ws = new WebSocket(`/quotes/${this.symbol}`);
        ws.onmessage = (e) => (this.price = JSON.parse(e.data).price);
        // Returned cleanup runs before the next re-run and on destroy().
        return () => ws.close();
    }
}
```

This works for `@Task`, `@ServerTask`, and `@ClientTask`. An async task can return a cleanup function from its resolved promise. The framework logs and ignores cleanup errors so one failure does not stop other cleanups.

## @VisibleTask

The `@VisibleTask` decorator marks a method to run only on the client when the component (or a specific element within it) becomes visible in the viewport. This is implemented using `IntersectionObserver`.

### Options

- `strategy`: supports `'intersection-observer'` (default) or `'document-ready'`.
- `threshold`: a number between 0 and 1. It is the percentage of visibility required to trigger the task (default: 0).
- `selector`: an optional CSS selector string. It targets a specific element within the component. If omitted, the framework observes the component's root container.

### Auto-Refresh on Navigation

With a `selector`, `@VisibleTask` also observes new elements that match the selector after each SPA navigation. If your component renders new elements matching the selector during navigation to a new page, the visible task fires for those elements without extra configuration.

### Usage

Use `@VisibleTask` to defer expensive work until the user sees the content. Examples include fetching data, starting animations, and loading large third-party libraries.

```typescript
import { Cossack, VisibleTask, State } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @State()
    data = null;

    @VisibleTask({ strategy: 'intersection-observer', threshold: 0.5 })
    async loadData() {
        // Runs only on client when component is 50% visible
        console.log('Component is visible, loading data...');
        this.data = await fetch('/api/data').then(res => res.json());
    }

    @VisibleTask({ selector: '#chart-container' })
    initChart() {
        // Runs when #chart-container inside the component becomes visible
        // Perfect for initializing charting libraries
    }
}
```

## Lifecycle Methods

Cossack components have three lifecycle hooks you can override. They run only on the client.

### `onMount()`

Runs once after the component's first client render. Use it to initialize client-only state or start side effects.

```typescript
import { Cossack, Page, ClientState } from '@cossackframework/core';

@Page()
export default class MyComponent extends Cossack {
    @ClientState() ready = false;

    @Client()
    onMount() {
        this.ready = true;
    }
}
```

### `onNavigateComplete(pathname)`

Runs after every SPA navigation completes. The framework calls it only on the App component. Page and layout components do not receive this callback. Use it for global concerns like analytics, scroll restoration, or refreshing observers.

```typescript
import { Cossack, Page } from '@cossackframework/core';

@Page()
export class App extends Cossack {
    @Client()
    onNavigateComplete(pathname: string) {
        analytics.track('pageview', { path: pathname });
    }
}
```

### `onCleanup()`

Runs immediately before the component is destroyed. Use it to release resources, close connections, or cancel timers. The framework removes listeners attached via `@On`/`@OnDocument`/`@OnWindow` automatically. You do not need to clean those up here.

`destroy()` starts cleanup synchronously. `await destroyAsync()` also waits for
Promise-returning `onCleanup()` hooks, descendant cleanup, registered task
cleanup, and owned service disposal. Both methods run hooks once. If a hook
fails, the framework still releases the other resources. The awaitable method
reports component or service failures with an `AggregateError`. Task cleanup
failures keep their logged-error behavior. SSG waits for cleanup before it
accepts generated HTML.

```typescript
import { Cossack, Page } from '@cossackframework/core';

@Page()
export default class MyComponent extends Cossack {
    private timer?: ReturnType<typeof setInterval>;

    onMount() {
        this.timer = setInterval(() => console.log('tick'), 1000);
    }

    onCleanup() {
        if (this.timer) clearInterval(this.timer);
    }
}
```

### Lifecycle Event Shortcuts

The `@On` decorator also accepts the lifecycle event names `'mount'` and `'navigate-complete'` as decorator-based alternatives to the lifecycle hooks above. The advantage is multiple handlers. You can register several `@On('mount')` or `@On('navigate-complete')` methods on the same component. Only one `onMount()` / `onNavigateComplete()` override is possible.

| Decorator                | Equivalent hook        | Fires on                | Multiple allowed |
| ------------------------ | ---------------------- | ----------------------- | ---------------- |
| `@On('mount')`           | `onMount()`            | Any component (client)  | Yes              |
| `@On('navigate-complete')` | `onNavigateComplete()` | App component only  | Yes              |

```typescript
import { Cossack, Page, ClientState, On } from '@cossackframework/core';

@Page()
export default class MyComponent extends Cossack {
    @ClientState() ready = false;

    @On('mount')
    initAnalytics() {
        analytics.setup();
    }

    @On('mount')
    prefetchAssets() {
        // Multiple @On('mount') handlers are supported.
        preloadImages();
    }
}
```

For the App component:

```typescript
import { Cossack, Page, On } from '@cossackframework/core';

@Page()
export class App extends Cossack {
    @On('navigate-complete')
    trackPageview(pathname: string) {
        // Fires after every SPA navigation. App-only.
        analytics.track('pageview', { path: pathname });
    }
}
```

## Event Handling

Cossack provides two ways to handle events: template-based (Lit-like syntax) and decorator-based.

### Template-Based Events (Recommended for element events)

Use the Lit-like event syntax directly in your templates for element-level events. This is explicit and aligns with web component patterns.

```typescript
import { Cossack, Page, ClientState } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class MyComponent extends Cossack {
    @ClientState()
    clickCount = 0;

    render() {
        return html`
            <button @click=${() => this.clickCount++}>
                Clicks: ${this.clickCount}
            </button>
        `;
    }
}
```

For `document` and `window` events, use the `@OnDocument` and `@OnWindow` decorators below. They handle cleanup automatically.

### Event Decorators

Cossack provides decorators to declaratively attach event listeners to DOM elements without manually managing `addEventListener` and `removeEventListener`. The framework removes these listeners when the component is destroyed. The security plugin preserves them in client bundles.

### @On

Listens for events on the component's root element (`this.container`). Also accepts the Cossack lifecycle events `'mount'` and `'navigate-complete'` (see [Lifecycle Event Shortcuts](#lifecycle-event-shortcuts) above).

```typescript
import { Cossack, On } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @On('click')
    handleClick(event: MouseEvent) {
        console.log('Component clicked!', event);
    }
}
```

### @OnDocument

Listens for events on the global `document` object. Useful for global keyboard shortcuts or clicking outside logic.

Accepts an optional second argument with `throttle` or `debounce` options (in milliseconds):

```typescript
import { Cossack, OnDocument } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @OnDocument('keydown')
    handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            this.closeModal();
        }
    }

    @OnDocument('mousemove', { throttle: 100 })
    handleMouseThrottled(event: MouseEvent) {
        // Fires at most once every 100ms
        console.log('Mouse at:', event.clientX, event.clientY);
    }
}
```

### @OnWindow

Listens for events on the global `window` object. Useful for resize or scroll events.

Accepts an optional second argument with `throttle` or `debounce` options (in milliseconds):

```typescript
import { Cossack, OnWindow } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @OnWindow('resize')
    handleResize() {
        console.log('Window resized:', window.innerWidth, window.innerHeight);
    }

    @OnWindow('resize', { debounce: 150 })
    handleResizeDebounced() {
        // Fires 150ms after the user stops resizing
        this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
    }

    @OnWindow('scroll', { throttle: 200 })
    handleScrollThrottled() {
        // Fires at most once every 200ms during scroll
        this.scrollY = window.scrollY;
    }
}
```

## Rate-Limiting Method Calls: `@Debounce` and `@Throttle`

The `{ throttle, debounce }` options above only apply to event listeners attached via `@OnDocument` / `@OnWindow`. To rate-limit any method call, for example a search function invoked from a template handler or called directly, use the `@Debounce(ms)` and `@Throttle(ms)` method decorators.

Both are client-only modifiers. On the server the method runs immediately, so they are safe on a method that also runs server-side. They compose with any classification decorator:

- `@Client`, `@Shared`, `@On` keep the real body and rate-limit it.
- `@Server` rate-limits the RPC proxy call on the client. Use it for search-as-you-type that hits the server, so you do not send one request per keystroke.

The wrapped method returns `void` because execution is deferred or coalesced. The original return value is lost. Each component instance gets its own independent timer.

```typescript
import { Cossack, Page, ClientState, Client, Server, Debounce, Throttle } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class SearchPage extends Cossack {
    @ClientState()
    results: string[] = [];

    @ClientState()
    clicks = 0;

    // Debounced: only the LAST query (after 500ms of inactivity) runs.
    @Client()
    @Debounce(500)
    async runSearch(query: string) {
        this.results = await this.searchServer(query);
    }

    // Debounced server RPC: rapid keystrokes send at most one request per pause.
    @Server()
    @Debounce(500)
    async searchServer(query: string) {
        return await db.search(query);
    }

    // Throttled: the first click runs immediately; the rest are ignored for 1s.
    @Client()
    @Throttle(1000)
    trackClick() {
        this.clicks++;
    }

    render() {
        return html`<input @input=${(e: InputEvent) => this.runSearch((e.target as HTMLInputElement).value)} />`;
    }
}
```

`@Debounce` / `@Throttle` are client-only. They never wrap anything on the server. A server method runs immediately on every call. On a `@Server` method the decorator wraps the client-side RPC proxy. It coalesces only that user's outgoing requests, per browser and independent per user. That reduces round-trips while typing, but it is not server-side rate limiting. A malicious client can skip the proxy and flood the endpoint. For enforcement that blocks abuse, use [`@RateLimit`](/docs/rate-limiting.md).

| Decorator | Edge | Behavior |
| --- | --- | --- |
| `@Debounce(ms)` | trailing | Resets a timer on every call. It fires once after `ms` of inactivity, with the latest arguments. |
| `@Throttle(ms)` | leading | Fires immediately on the first call, then ignores further calls for `ms`. |

A `@Debounce` / `@Throttle` method without a classification decorator (`@Client` / `@Server` / `@Shared` / `@On`) stays server-only by default. The framework emits a development warning on the client. Pair them with one of those decorators.

These decorators run in the browser, so a malicious client can bypass them. For abuse protection enforced on the server with `429 Too Many Requests`, use [`@RateLimit`](/docs/rate-limiting.md). It works on `@Server` methods, class-based API routes, and functional API routes.

## Example: All Together

This example combines these features:

```typescript
import { Cossack, Page, State, ClientState, Task, ServerTask, ClientTask, VisibleTask, On, OnWindow } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class FeatureDemo extends Cossack {
    @State()
    serverCount = 0;

    @ClientState()
    windowWidth = 0;

    @Task()
    logChange() {
        console.log('State changed:', this.serverCount);
    }

    // Tracked task: runs on mount, and ONLY when `serverCount` changes.
    @Task({ track: ['serverCount'] })
    syncCount() {
        document.title = `Count: ${this.serverCount}`;
        // Returned cleanup runs before the next re-run and on destroy().
        return () => console.log('cleanup: syncCount');
    }

    @ServerTask()
    logServerSide() {
        // Runs on server only — body stripped from client bundle.
        console.log('Server render, count:', this.serverCount);
    }

    @ClientTask()
    measureLayout() {
        // Runs on client only — safe to access the DOM.
        this.windowWidth = window.innerWidth;
    }

    @VisibleTask()
    onVisible() {
        console.log('I am seen!');
    }

    @On('click')
    increment() {
        this.serverCount++; // Syncs with server
    }

    @OnWindow('resize')
    updateWidth() {
        this.windowWidth = window.innerWidth; // Updates client-only state
    }

    render() {
        return html`
            <div>
                <h1>Count: ${this.serverCount}</h1>
                <p>Window Width: ${this.windowWidth}</p>
            </div>
        `;
    }
}
```

## Best Practices: Choosing the Right Tool

This section helps you choose between `@Task`, `@VisibleTask`, `@On`, and the `onMount()` / `onNavigateComplete()` / `onCleanup()` lifecycle hooks.

### Quick Reference

| You need to... | Use | Fires |
| --- | --- | --- |
| React to state changes on both server and client | `@Task` | Mount + every state update (SSR-safe) |
| React to specific state fields only | `@Task({ track: [...] })` | Mount + when a tracked dep changes |
| Run a task on server only (no manual `isServer` guard) | `@ServerTask` | Mount + every state update (server only) |
| Run a task on client only (no manual `isServer` guard) | `@ClientTask` | Mount + every state update (client only) |
| Tear down a task's side effects automatically | return a cleanup fn from a task | Before next re-run + on destroy |
| Run setup logic once on the client | `onMount()` or `@On('mount')` | Once after first client render |
| Defer work until an element enters the viewport | `@VisibleTask` | Client-only, on intersection |
| React to SPA navigation globally | `onNavigateComplete()` or `@On('navigate-complete')` | App component only, after each route change |
| Release resources before destroy | `onCleanup()` | Once, before destruction |
| Handle a click/input on a specific element | Template `@click` | On the element event |
| Handle document-wide events (keyboard shortcuts) | `@OnDocument` | On the document event (auto-cleaned) |
| Handle window-wide events (resize, scroll) | `@OnWindow` | On the window event (auto-cleaned) |

### `@Task` vs `onMount()`

- `@Task` runs on both server and client, and re-runs on every state update. Use it for derived state, logging, or side effects that must stay in sync with component state across SSR and hydration.
- `onMount()` runs once, client-only. Use it for one-time setup: starting timers, initializing client-only libraries, reading `window`/`document`.

If your logic touches `window`, `document`, or the DOM directly, use `onMount()` or `@On('mount')`. Do not use `@Task` for that logic. `@Task` also runs during SSR, where those globals do not exist.

```typescript
// Wrong — crashes on the server because `window` is undefined
@Task()
trackSize() {
    this.width = window.innerWidth;
}

// Right — client-only, runs once
@On('mount')
trackSize() {
    this.width = window.innerWidth;
}
```

### `onMount()` vs `@On('mount')`

Both fire at the same point in the lifecycle. Choose based on structure:

- Use `onMount()` for a single block of setup logic. The override is clear and discoverable.
- Use `@On('mount')` when you want multiple independent handlers on the same component.

You can mix both on the same component. `@On('mount')` handlers fire before your `onMount()` override runs.

### `onMount()` on a Page vs `onNavigateComplete()` on the App

- `onMount()` fires on every component (App, layouts, pages) when it first renders on the client. Page components are destroyed and re-created on each SPA navigation. A Page's `onMount()` therefore fires on every navigation to that page.
- `onNavigateComplete(pathname)` fires only on the App component, after the new page has loaded. Use it for global concerns: analytics, scroll restoration, closing flyout menus, progress indicators.

Use `@On('mount')` on a page for "this page just became active" logic. Use `@On('navigate-complete')` on the App for "a navigation just finished, regardless of which page" logic. Do not put `@On('navigate-complete')` on a Page component. It never fires there.

### Template `@click` vs `@On('click')`

- Prefer template syntax (`<button @click=${...}>`) for element-level events. It sits next to the element, is explicit, and does not depend on the component having a `container`.
- Use `@On('click')` when you want a handler bound to the component's root element as a whole, or when you want the method auto-bound, independently testable, and reusable.

### Common Pitfalls

- Do not access `window` / `document` / the DOM inside `@Task`. It runs during SSR where those globals are undefined. Use `@ClientTask` if the logic must re-run on every render. Use `onMount()` / `@On('mount')` if it is one-time setup. `@ClientTask` replaces the manual `if (this.isServer) return;` guard.
- Do not use `@On('navigate-complete')` on a Page or Layout component. It only fires on the App. For page-specific "I just loaded" logic, use `@On('mount')`.
- Do not call `addEventListener` manually for `document` or `window` events without a matching `removeEventListener` in `onCleanup()`. Use `@OnDocument` / `@OnWindow`. They handle cleanup automatically.
- Use `@Task` or `onMount()` for cheap work or work that must run immediately. Use `@VisibleTask` to wait until an element enters the viewport.
