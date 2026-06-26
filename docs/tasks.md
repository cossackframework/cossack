---
title: "Lifecycle Tasks & Events"
description: "Decorators and lifecycle hooks for handling component lifecycle tasks and DOM events in a declarative way similar to Qwik."
---

# Lifecycle Tasks & Events

Cossack provides a set of decorators and lifecycle hooks to handle component lifecycle tasks and DOM events in a declarative way, similar to frameworks like Qwik. These tools allow you to run logic on mount, updates, visibility changes, and handle user interactions efficiently.

> **Note on client bundles:** `onMount`, `render`, and other lifecycle methods
> are preserved in the client bundle, and so are any helpers they call via
> `this.method(...)`. If a helper is called through a dynamic callback that the
> static analysis can't see, mark it with `@Client()`. See
> [Client Bundle & Method Stripping](./client-bundle.md).

## @Task

The `@Task` decorator marks a method to run on component mount and every time the component's state updates. This method runs on **both the server and the client**.

### Usage

Use `@Task` for logic that needs to run initially or react to state changes, such as logging, derived state calculations, or side effects that are safe to run in both environments.

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

## @VisibleTask

The `@VisibleTask` decorator marks a method to run **only on the client** when the component (or a specific element within it) becomes visible in the viewport. This is implemented using `IntersectionObserver`.

### Options

- `strategy`: Currently supports `'intersection-observer'` (default) or `'document-ready'`.
- `threshold`: A number between 0 and 1 indicating the percentage of visibility required to trigger the task (default: 0).
- `selector`: An optional CSS selector string to target a specific element within the component. If omitted, the component's root container is observed.

### Auto-Refresh on Navigation

When using a `selector`, `@VisibleTask` automatically observes **new elements** that match the selector after each SPA navigation. This means if your component renders new elements matching the selector when navigating to a new page, the visible task will fire for those new elements without any extra configuration.

### Usage

Use `@VisibleTask` for expensive operations that should be deferred until the user actually sees the content, such as fetching data, starting animations, or initializing heavy third-party libraries.

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

Cossack components have three lifecycle hooks you can override. They run **only on the client**.

### `onMount()`

Runs once after the component's first client render. Use it to initialize client-only state or kick off side effects.

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

Runs after every SPA navigation completes. **Only called on the App component** — page/layout components do not receive this callback. Use it for global concerns like analytics, scroll restoration, or refreshing observers.

No `super` call is needed — the framework refreshes `@VisibleTask` observers and fires `@On('navigate-complete')` handlers in a separate internal hook before your `onNavigateComplete()` runs.

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

Runs immediately before the component is destroyed. Use it to release resources, close connections, or cancel timers. Any listeners attached via `@On`/`@OnDocument`/`@OnWindow` are removed automatically by the framework — you do not need to clean those up here.

No `super` call is needed.

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

The `@On` decorator also accepts the lifecycle event names `'mount'` and `'navigate-complete'` as decorator-based alternatives to the lifecycle hooks above. Their main advantage is **multiple handlers**: you can register several `@On('mount')` or `@On('navigate-complete')` methods on the same component, whereas only one `onMount()` / `onNavigateComplete()` override is possible.

| Decorator                | Equivalent hook        | Fires on                | Multiple allowed |
| ------------------------ | ---------------------- | ----------------------- | ---------------- |
| `@On('mount')`           | `onMount()`            | Any component (client)  | Yes              |
| `@On('navigate-complete')` | `onNavigateComplete()` | **App component only**  | Yes              |

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

The recommended approach for **element-level** events is to use the Lit-like event syntax directly in your templates. This is the most explicit and aligns with modern web component patterns.

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

For `document` and `window` events, prefer the `@OnDocument` and `@OnWindow` decorators below — they handle cleanup automatically.

### Event Decorators

Cossack provides decorators to declaratively attach event listeners to DOM elements without manually managing `addEventListener` and `removeEventListener`. These listeners are automatically cleaned up when the component is destroyed, and (as of this release) they are correctly preserved in client bundles by the security plugin.

### @On

Listens for events on the component's **root element** (`this.container`). Also accepts the Cossack lifecycle events `'mount'` and `'navigate-complete'` (see [Lifecycle Event Shortcuts](#lifecycle-event-shortcuts) above).

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

## Example: All Together

Here is a comprehensive example combining these features:

```typescript
import { Cossack, Page, State, ClientState, Task, VisibleTask, On, OnWindow } from '@cossackframework/core';
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

With `@Task`, `@VisibleTask`, `@On`, and the `onMount()` / `onNavigateComplete()` / `onCleanup()` lifecycle hooks all available, it's not always obvious which one fits a given situation. This section gives concrete guidance.

### Quick Reference

| You need to... | Use | Fires |
| --- | --- | --- |
| React to state changes on **both server and client** | `@Task` | Mount + every state update (SSR-safe) |
| Run setup logic **once on the client** | `onMount()` or `@On('mount')` | Once after first client render |
| Defer work until an element **enters the viewport** | `@VisibleTask` | Client-only, on intersection |
| React to **SPA navigation** globally | `onNavigateComplete()` or `@On('navigate-complete')` | App component only, after each route change |
| Release resources before destroy | `onCleanup()` | Once, before destruction |
| Handle a **click/input** on a specific element | Template `@click` | On the element event |
| Handle **document-wide** events (keyboard shortcuts) | `@OnDocument` | On the document event (auto-cleaned) |
| Handle **window-wide** events (resize, scroll) | `@OnWindow` | On the window event (auto-cleaned) |

### `@Task` vs `onMount()`

The most common source of confusion. The rule of thumb:

- **`@Task`** runs on **both server and client**, and re-runs on **every state update**. Use it for derived state, logging, or side effects that must stay in sync with component state across SSR and hydration.
- **`onMount()`** runs **once, client-only**. Use it for one-time setup: starting timers, initializing client-only libraries, reading `window`/`document`.

If your logic touches `window`, `document`, or the DOM directly, it almost certainly belongs in `onMount()` (or `@On('mount')`), not `@Task` — otherwise it will crash during SSR where those globals don't exist.

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

- Use **`onMount()`** for a single, cohesive block of setup logic. The override is clear and discoverable.
- Use **`@On('mount')`** when you want **multiple independent handlers** on the same component.

You can mix both on the same component. `@On('mount')` handlers fire before your `onMount()` override runs.

### `onMount()` on a Page vs `onNavigateComplete()` on the App

This distinction trips up many newcomers:

- **`onMount()`** fires on **every** component (App, layouts, pages) when it first renders on the client. Page components are destroyed and re-created on each SPA navigation, so a Page's `onMount()` effectively fires on every navigation **to** that page.
- **`onNavigateComplete(pathname)`** fires **only on the App component**, after the new page has loaded. Use it for **global** concerns: analytics, scroll restoration, closing flyout menus, progress indicators.

Use `@On('mount')` on a page for "this page just became active" logic. Use `@On('navigate-complete')` on the App for "a navigation just finished, regardless of which page" logic. Do **not** put `@On('navigate-complete')` on a Page component — it will never fire there.

### Template `@click` vs `@On('click')`

- Prefer **template syntax** (`<button @click=${...}>`) for element-level events. It is co-located with the element, explicit, and doesn't depend on the component having a `container`.
- Use **`@On('click')`** when you want a handler bound to the component's root element as a whole, or when you want the method auto-bound, independently testable, and reusable.

### Common Pitfalls

- **Don't** access `window` / `document` / the DOM inside `@Task` — it runs during SSR where those globals are undefined. Use `onMount()` or `@On('mount')` instead.
- **Don't** worry about `super` in lifecycle hooks. The framework wires up `@VisibleTask` observers, `@On` listeners, and lifecycle-event handlers in separate internal hooks — your `onMount()` / `onCleanup()` / `onNavigateComplete()` overrides are purely for your own logic.
- **Don't** use `@On('navigate-complete')` on a Page or Layout component. It only fires on the App. For page-specific "I just loaded" logic, use `@On('mount')`.
- **Don't** call `addEventListener` manually for `document` or `window` events without a matching `removeEventListener` in `onCleanup()`. Use `@OnDocument` / `@OnWindow` — they handle cleanup automatically.
- **Don't** reach for `@VisibleTask` when `@Task` would do. `@VisibleTask` defers work until the element is scrolled into view; if the work is cheap or needed immediately, `@Task` (or `onMount()`) is simpler.
