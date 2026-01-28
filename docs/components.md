# Components

In Cossack, reusable components are built using the same `Cossack` base class as pages, but they are used differently within the template. This guide explains how to create, use, and manage state in reusable components.

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

You can use components in two ways:

### 1. Auto-Discovered Syntax (Recommended)

Components placed in `src/components` are automatically discovered and registered. You can use them directly in your templates using the `<c:ComponentName>` syntax without importing them.

```typescript
// No import needed!
html`
    <div>
        <c:Button variant="secondary" @click="${this.handleClick}">Click Me</c:Button>
    </div>
`
```

### 2. Manual Import & Helper

To use a class-based component explicitly (e.g., if it's not in `src/components` or you prefer explicit imports), use the `component()` helper function from `@cossackframework/renderer`.

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
        <c:MyForm @save="${this.saveData}" />
    `;
}
```

## Server Actions in Components

Reusable components **can** now define and handle their own `@Server` actions directly. They are fully stateful and persisted as part of the Page's state tree.

```typescript
// src/components/Counter.ts
import { Cossack, Component, Server, State } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class Counter extends Cossack {
    @State() count = 0;

    @Server()
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

## Accessing Context

Components can access the global framework context (`env`, `user`, `c` for request) directly using `this.env`, `this.user`, and `this.c`, without needing them passed as props.

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

