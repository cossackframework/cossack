---
title: "Components"
description: "Reusable components in Cossack are built using the same Cossack base class as pages and support state management via decorators."
---

# Components

In Cossack, reusable components are built using the same `Cossack` base class as pages, but they are used differently within the template. This guide explains how to create, use, and manage state in reusable components.

> **Method stripping:** methods on `Cossack` subclasses that are not needed in
> the browser are automatically stripped from the client bundle. See
> [Client Bundle & Method Stripping](./client-bundle.md) for the rule, the
> built-in allowlist, using `@Client` as the escape hatch, and transitive
> preservation of helpers called from lifecycle hooks.

## Creating a Component

To create a component, extend the `Cossack` class. You can use standard decorators like `@Prop`, `@State`, and `@ClientState`.

### Basic Example: Button

```typescript
import { html } from "@cossackframework/renderer";
import { Cossack, Component, Prop } from "@cossackframework/core";

@Component()
export class Button extends Cossack {
    // 1. Define inputs using @Prop
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    @Prop()
    disabled: boolean = false;

    render() {
        // 2. Access props via `this.props` to spread "rest" attributes (like class, style, onClick)
        // Note: We extract known props to avoid spreading them as attributes if they are already handled.
        const { variant, disabled, ...rest } = this.props;

        return html`
            <button 
                data-variant="${this.variant}" 
                ?disabled="${this.disabled}" 
                ...=${rest}
            >
                ${this.children}
            </button>
        `;
    }
}
```

### Components with Internal State: FileUploader

Components can have their own internal state using `@ClientState` (for UI state) or `@State` (if connected to a provider, though typically reusable components use client state or props).

```typescript
import { html } from "@cossackframework/renderer";
import { Cossack, Component, Prop, ClientState } from "@cossackframework/core";

@Component()
export class FileUploader extends Cossack {
    // Inputs from parent
    @Prop()
    uploading: boolean = false;

    @Prop()
    progress: number = 0;

    // Callback for parent action
    @Prop()
    onUpload?: (file: File) => void;

    // Internal UI state
    @ClientState()
    selectedFile: File | null = null;

    render() {
        return html`
            <div class="file-uploader">
                <input type="file" @change="${(e: any) => this.selectedFile = e.target.files[0]}" />
                
                <button 
                    ?disabled="${!this.selectedFile || this.uploading}"
                    @click="${() => this.onUpload?.(this.selectedFile!)}"
                >
                    ${this.uploading ? `Uploading ${this.progress}%` : 'Upload'}
                </button>
            </div>
        `;
    }
}
```

## Using Components

To use a class-based component, you the use the `component()` helper function from `@cossackframework/renderer`.

```typescript
import { html, component } from "@cossackframework/renderer";
import { Button } from "./components/Button";

// Inside your Page's render method:
html`
    <div>
        ${component(Button, { variant: 'secondary', onClick: this.handleClick }, 'Click Me')}
    </div>
`
```

### Passing State (Parent to Child)

Data flows down via properties. When the parent state changes, the `render` method re-runs, and `component()` is called with new values. The child component detects these changes and updates efficiently.

```typescript
// Parent Page
@State() count = 0;

render() {
    return html`
        ${component(CounterDisplay, { count: this.count })}
    `;
}
```

### Passing Actions (Child to Parent)

Events flow up via callbacks passed as properties.

```typescript
// Parent Page
@Server()
async saveData(data: any) {
    // ... save to DB ...
}

render() {
    return html`
        ${component(MyForm, { '@save': this.saveData })}
    `;
}
```

## Server Actions in Components

Reusable components **can** define and handle their own `@Server` actions directly. Components are fully stateful and their state is persisted as part of the Page's state tree.

### Basic Example

```typescript
// src/components/Counter.ts
import { Cossack, Component, Server, State } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class Counter extends Cossack {
    @State() count = 0;

    increment() {
        this.count++;
    }

    render() {
        return html`
            <button @click="${this.increment}">Count: ${this.count}</button>
        `;
    }
}
```

### How It Works

When a component with `@Server` actions is used in a Page:

1. **Initial Render (Server):** The component is rendered, and its state is included in the Page's initial state tree under `_children`.
2. **Client Hydration:** The component is restored with its server state.
3. **Action Dispatch:** When `@Server` method is called, the framework sends the action to the server with the component's current state.
4. **State Update:** The server executes the action and returns the updated state.
5. **Re-render:** The client receives the new state and re-renders the component.

### Nested Component State Flow

State is automatically synchronized between nested components and the page:

```typescript
// Parent Page
@Page()
export class Dashboard extends Cossack {
    render() {
        return html`
            <div>
                ${component(Counter)}
                ${component(Counter)}
            </div>
        `;
    }
}
```

Each `Counter` instance maintains its own independent state, managed through unique component IDs (`root:0`, `root:1`, etc.).

### Accessing Framework Context

Server actions in components can access `this.env`, `this.user`, and `this.c` directly:

```typescript
@Component()
export class LikeButton extends Cossack {
    @State() liked = false;
    @State() count = 0;

    async toggleLike() {
        // Access database bindings
        const stmt = this.env.DB.prepare(
            "INSERT INTO likes (user_id, post_id) VALUES (?, ?)"
        );
        await stmt.bind(this.user?.id, this.postId).run();

        this.liked = !this.liked;
        this.count += this.liked ? 1 : -1;
    }

    @Prop() postId!: string;

    render() {
        return html`
            <button @click="${this.toggleLike}">
                ${this.liked ? '❤️' : '🤍'} ${this.count}
            </button>
        `;
    }
}
```

## Accessing Context

Components can access the global framework context (`env`, `user`, `c` for request) directly using `this.env`, `this.user`, and `this.c`, without needing them passed as props.

> **See [Framework Context API](./framework-context.md)** for complete documentation on accessing environment bindings, authenticated users, and request context from any component.

```typescript
@Component()
export class UserProfile extends Cossack {
    render() {
        return html`
            <div>
                Logged in as: ${this.user?.name}
                (DB: ${this.env.DB_NAME})
            </div>
        `;
    }
}
```

## Testing

Use `@cossackframework/test-utils` to test components in isolation.

### Installation

```bash
pnpm add -D @cossackframework/test-utils
```

### Basic Example

```typescript
import { render } from '@cossackframework/test-utils';
import { Counter } from './Counter';

test('increments count', async () => {
    const { click, html } = await render(Counter);

    expect(html()).toContain('Count: 0');
    await click('button');
    expect(html()).toContain('Count: 1');
});
```

### Render API

The `render` function returns a helper object with the following methods:

| Method | Description |
|--------|-------------|
| `instance` | The component instance |
| `container` | The DOM element containing the rendered component |
| `html()` | Returns the current HTML as a string |
| `click(selector)` | Dispatches a click event on the matching element |
| `type(selector, text)` | Types text into an input field |
| `waitForUpdate()` | Waits for the next component update |
| `unmount()` | Cleans up and removes the component |

### Testing with Props

```typescript
test('renders with custom label', async () => {
    const { html } = await render(Button, {
        props: { variant: 'primary', label: 'Click Me' }
    });

    expect(html()).toContain('Click Me');
});
```

### Testing with Initial State

```typescript
test('renders with initial state', async () => {
    const { html } = await render(TodoList, {
        state: { todos: ['Task 1', 'Task 2'] }
    });

    expect(html()).toContain('Task 1');
    expect(html()).toContain('Task 2');
});
```

### Testing User Input

```typescript
test('handles form input', async () => {
    const { type, html } = await render(SearchBox);

    await type('input', 'search query');
    expect(html()).toContain('search query');
});
```

### Testing Server Actions (Mocking)

For components with `@Server` actions, mock the server methods:

```typescript
import { render } from '@cossackframework/test-utils';
import { LikeButton } from './LikeButton';

test('toggles like state', async () => {
    const { click, html } = await render(LikeButton);

    // Mock the server method
    (LikeButton.prototype as any).toggleLike = async function() {
        this.liked = !this.liked;
    };

    await click('button');
    expect(html()).toContain('❤️');
});
```

### Cleanup

The `unmount` helper cleans up the component:

```typescript
test('cleanup', async () => {
    const { unmount } = await render(MyComponent);

    // ... test code ...

    unmount(); // Removes component from DOM
});
```

### Using with Testing Frameworks

Works with Vitest, Jest, or any TypeScript test framework:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
    },
});
```

