---
name: create-component
description: Create a reusable Cossack component
disable-model-invocation: true
user-invocable: true
---

# Create a Cossack Component

You are creating a reusable component for a Cossack Framework application. Components are placed in `src/components/` and can be used in pages, layouts, and other components.

## Step 1: Ask for Details

Ask the user:
1. What is the component name? (PascalCase, e.g., `Button`, `UserCard`, `SearchInput`)
2. What props does it accept?
3. Does it need server actions?

## Step 2: Create the File

Place the file at `src/components/<ComponentName>.ts`.

## Step 3: Generate the Component Class

### Basic Component

```typescript
import { html } from '@cossackframework/renderer';
import { Cossack, Component, Prop } from '@cossackframework/core';

@Component()
export class MyComponent extends Cossack {
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    render() {
        return html`
            <div class="my-component">
                ${this.children}
            </div>
        `;
    }
}
```

### Component with Props and Spread Pattern

Use `@Prop()` for input properties and `...=${rest}` to pass through unknown attributes:

```typescript
import { html } from '@cossackframework/renderer';
import { Cossack, Component, Prop } from '@cossackframework/core';

@Component()
export class Button extends Cossack {
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    render() {
        // Destructure known props, spread the rest onto the element
        const { variant, ...rest } = this.props;

        return html`
            <button data-variant="${this.variant}" class="btn btn-${this.variant}" ...=${rest}>
                ${this.children}
            </button>
        `;
    }
}
```

### Component with Server Actions

Components can have `@State()` and `@Server()` methods:

```typescript
import { html } from '@cossackframework/renderer';
import { Cossack, Component, State, Server } from '@cossackframework/core';

@Component({
    transport: 'http'  // Required if using server actions
})
export class NestedCounter extends Cossack {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    render() {
        return html`
            <div>
                <p>Count: ${this.count}</p>
                <button @click="${this.increment}">+1</button>
            </div>
        `;
    }
}
```

## Step 4: Using Components

### In a Parent Component or Page

Import and use the `component()` helper from the renderer:

```typescript
import { html, component } from '@cossackframework/renderer';
import { Button } from '@/components/Button';

// Usage in render():
render() {
    return html`
        <div>
            ${component(Button, {
                variant: 'primary',
                '@click': this.handleClick,   // Event listeners
                disabled: this.isLoading,     // Regular attributes
                '?disabled': this.isLoading,  // Boolean attributes
            }, 'Click Me')}
        </div>
    `;
}
```

### component() Signature

```typescript
component(
    ComponentClass,   // The component class (e.g., Button)
    props?: object,   // Properties object (events, attributes, @Prop values)
    children?: any    // Content to pass through this.children
)
```

### Passing Children

```typescript
// With text children
component(Button, { variant: 'primary' }, 'Submit')

// With template children
component(Card, { title: 'Hello' }, html`<p>Card content</p>`)

// With nested component
component(Layout, { dir: 'ltr' }, html`
    <h1>Title</h1>
    <p>Content</p>
`)
```

## Step 5: Context Access in Components

Components have access to the same framework context as pages:

```typescript
@Component()
export class ContextCard extends Cossack {
    render() {
        return html`
            <div>
                <p>User: ${this.user?.name || 'Guest'}</p>
                <p>Path: ${this.c?.req.path}</p>
                <p>Env: ${this.env ? 'Available' : 'N/A'}</p>
            </div>
        `;
    }
}
```

- `this.c` — Hono request context
- `this.user` — Authenticated user (if auth is configured)
- `this.env` — Environment bindings (Cloudflare bindings, etc.)
- `this.isServer` — `true` on server, `false` on client

## Step 6: Verify

1. File is in `src/components/`
2. Class extends `Cossack` and has `@Component()` decorator
3. Uses `@Prop()` for inputs (not constructor parameters)
4. If using server actions, `transport` is specified in `@Component()`
5. Run type checks: `pnpm tsc --noEmit`
