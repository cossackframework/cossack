# Lifecycle Tasks & Events

Cossack provides a set of decorators and lifecycle hooks to handle component lifecycle tasks and DOM events in a declarative way, similar to frameworks like Qwik. These tools allow you to run logic on mount, updates, visibility changes, and handle user interactions efficiently.

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

Runs once after the component's first client render. Use it to initialize client-only state, attach listeners via decorators (handled automatically by the base implementation), or kick off side effects.

> **Important:** Always call `super.onMount()` when overriding. The base implementation sets up `@VisibleTask` observers, fires `@On('mount')` handlers, and wires up `@On`/`@OnDocument`/`@OnWindow` listeners. Skipping `super` disables all of these.

```typescript
import { Cossack, Page, ClientState } from '@cossackframework/core';

@Page()
export default class MyComponent extends Cossack {
    @ClientState() ready = false;

    onMount() {
        super.onMount(); // Required
        this.ready = true;
    }
}
```

### `onNavigateComplete(pathname)`

Runs after every SPA navigation completes. **Only called on the App component** — page/layout components do not receive this callback. Use it for global concerns like analytics, scroll restoration, or refreshing observers.

> **Important:** Always call `super.onNavigateComplete(pathname)` when overriding. The base implementation refreshes `@VisibleTask` observers and fires `@On('navigate-complete')` handlers.

```typescript
import { Cossack, Page } from '@cossackframework/core';

@Page()
export class App extends Cossack {
    onNavigateComplete(pathname: string) {
        super.onNavigateComplete(pathname); // Required
        analytics.track('pageview', { path: pathname });
    }
}
```

### `onCleanup()`

Runs immediately before the component is destroyed. Use it to release resources, close connections, or cancel timers. Any listeners attached via `@On`/`@OnDocument`/`@OnWindow` are removed automatically by the framework — you do not need to clean those up here.

> **Important:** Always call `super.onCleanup()` when overriding.

```typescript
import { Cossack, Page } from '@cossackframework/core';

@Page()
export default class MyComponent extends Cossack {
    private timer?: ReturnType<typeof setInterval>;

    onMount() {
        super.onMount();
        this.timer = setInterval(() => console.log('tick'), 1000);
    }

    onCleanup() {
        super.onCleanup();
        if (this.timer) clearInterval(this.timer);
    }
}
```

### Lifecycle Event Shortcuts

The `@On` decorator also accepts the lifecycle event names `'mount'` and `'navigate-complete'` as decorator-based alternatives to the lifecycle hooks above. They have two advantages over the hooks:

- **Multiple handlers:** You can register several `@On('mount')` or `@On('navigate-complete')` methods on the same component. Only one `onMount()` / `onNavigateComplete()` override is possible.
- **No `super()` bookkeeping:** The handlers run independently of the hook overrides.

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
