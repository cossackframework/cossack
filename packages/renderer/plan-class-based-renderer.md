# Plan - Advanced Renderer (Class-Based)

## Overview

Currently, the renderer library is very basic, providing only the `html` template tag and rendering functions. To enhance its capabilities and better support complex applications, we plan to implement a class-based component system similar to frameworks like Lit or React. This will allow developers to create reusable, stateful components with lifecycle methods, making it easier to build and maintain large applications. Think of current state is similar to `lit-html`, and the plan is to evolve it towards a more full-featured component model.

## Goals

- **Component Class**: Introduce a base `Component` class that developers can extend to create custom components.
- **Composable**: Allow components to be nested and composed within each other.
- **State Management**: Implement a simple state management system within components.
- **Lifecycle Methods**: Provide lifecycle hooks such as `connectedCallback`, `disconnectedCallback.

## Proposed API

### Base Component Class

```typescript
// App.ts
import { html, TemplateResult, CossackElement, css, Component, State } from '@cossackframework/renderer';

@Component({
    tag: 'app',
})
export class App extends CossackElement {
  // Define scoped styles right with your component, in plain CSS
  static styles = css`
    :host {
      color: blue;
    }
  `;

  render() {
    return html`
        <main>
            <aside>
                <div>
                    ${this.children}
                </div>
            </aside>
        </main>
    `;
  }
}
```

```ts
// Button.ts
import { html, TemplateResult, CossackElement, Component, State } from '@cossackframework/renderer';
@Component({
    tag: 'button',
})
export class MyButton extends CossackElement {
    render(): TemplateResult {
        return html`
            <button ...=${this.props}>
                ${this.children}
            </button>
        `;
    }
}
```

```ts
// MyCounterPage.ts
import { html, TemplateResult, CossackElement, Component, State } from '@cossackframework/renderer';
@Component({
    tag: 'my-counter-page',
})
export class MyCounterPage extends CossackElement {
    @State()
    private count: number = 0;
    
    private increment() {
        this.count++;
    }
    
    render(): TemplateResult {
        return html`
            <c-app>
                <p>Count: ${this.count}</p>
                <c-button @click=${this.increment}>Increment</c-button>
            </c-app>
        `;
    }
}
```

### Optimizations considerations

Unlike React/Vue, we won't render the whole tree and let the browser parsing the HTML for composability. We won't use web components Shadow DOM to keep it simple and compatible with SSR. My plan is generate flattened components at the build time (using Vite plugin) and flatten the tree to single template function for each top-level component to minimize the number of DOM operations during rendering. This way we can achieve good performance while still providing a component-based architecture.

We also combine all of the nested components into a single render function to minimize the number of DOM operations during rendering.

So, for the above `MyCounterPage`, the generated class would look like this:

```ts
import { html, TemplateResult, CossackElement, Component, State } from '@cossackframework/renderer';
@Component()
export class MyCounterPage extends CossackElement  {
    @State()
    private count: number = 0;

    // Nested state morphed into the main component to reduce DOM operations
    @State()
    private morphed_state303: string = '';

    public increment() {
        this.count++;
    }

    // We flatten the whole tree into a single render function
    public render() {
        return html`
            <main>
                <aside>
                    <div>
                        <p>Count: ${this.count}</p>
                        <button data-state-hash="state303" @click=${this.increment}>Increment</button>
                    </div>
                </aside>
            </main>
        `;
    }
}
```

The `CossackElement` base class would handle the state updates and re-rendering logic, ensuring that only the necessary parts of the DOM are updated when state changes occur.

## Server side rendering

The server-side rendering process would remain largely unchanged. The `renderToString` function would still be used to generate the initial HTML string for the component tree, and we flatten the component tree into a single render function for each top-level component to optimize the rendering process.
