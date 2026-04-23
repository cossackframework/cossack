# Lifecycle Tasks & Events

Cossack provides a set of decorators to handle component lifecycle tasks and DOM events in a declarative way, similar to frameworks like Qwik. These tools allow you to run logic on mount, updates, visibility changes, and handle user interactions efficiently.

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

## Event Handling

Cossack provides two ways to handle events: decorator-based and template-based (Lit-like syntax).

### Template-Based Events (Recommended)

The recommended approach is to use the Lit-like event syntax directly in your templates. This is more explicit and aligns with modern web component patterns.

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

For element events, use the `@eventName` syntax in your template. For document and window events, use `onMount`/`onCleanup` to manually add/remove listeners.

```typescript
import { Cossack, Page, ClientState } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class MyComponent extends Cossack {
    @ClientState()
    windowSize = 'Unknown';

    private handleKeydown = (event: KeyboardEvent) => {
        console.log('Key pressed:', event.key);
    };

    private handleResize = () => {
        this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
    };

    @Client()
    onMount() {
        // Document and window events need manual listeners
        document.addEventListener('keydown', this.handleKeydown);
        window.addEventListener('resize', this.handleResize);
    }

    @Client()
    onCleanup() {
        document.removeEventListener('keydown', this.handleKeydown);
        window.removeEventListener('resize', this.handleResize);
    }

    render() {
        return html`
            <div @click=${() => console.log('Clicked!')}>
                Window Size: ${this.windowSize}
            </div>
        `;
    }
}
```

### Event Decorators (Legacy)

Cossack also provides decorators to declaratively attach event listeners to DOM elements without manually managing `addEventListener` and `removeEventListener`. These listeners are automatically cleaned up when the component is destroyed.

### @On

Listens for events on the component's **root element** (`this.container`).

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

```typescript
import { Cossack, OnDocument } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @OnDocument('keydown')
    handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            this.closeModal();
        }
    }
}
```

### @OnWindow

Listens for events on the global `window` object. Useful for resize or scroll events.

```typescript
import { Cossack, OnWindow } from '@cossackframework/core';

export default class MyComponent extends Cossack {
    @OnWindow('resize')
    handleResize() {
        console.log('Window resized:', window.innerWidth, window.innerHeight);
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
