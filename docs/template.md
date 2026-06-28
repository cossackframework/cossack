---
title: 'Cossack Template'
description: 'Powerful template syntax for building dynamic UIs inspired by Lit using tagged template literals via the html function.'
---

# Cossack Template

Cossack provides a powerful template syntax for building dynamic UIs inspired by Lit. This guide covers the basics of using templates in your components.

## Template Syntax

Cossack uses tagged template literals via `html`.

### Basic Expressions

```typescript
html`<h1>Hello ${name}</h1>`;
```

### Attributes

Boolean attributes are removed if `false/null/undefined`.

```typescript
html`<button ?disabled="${isDisabled}">Click</button>`;
```

### Event Binding

Bind event listeners using Lit's `@` syntax.

```typescript
html`<button @click="${(e) => this.handleClick(e)}">Click Me</button>`;
```

### Property Binding

For `<input>` elements, use `.` prefix to bind properties directly.

```typescript
html`<input type="text" .value="${this.inputValue}" @input="${this.handleInput}" />`;
```

### Spread Attributes

You can spread an object into attributes using the `...` syntax.

```typescript
const props = { id: 'btn', class: 'primary', 'data-type': 'action' };
html`<button ...=${props}>Click</button>`;
```

### Unsafe HTML

To render raw HTML strings (careful!):

```typescript
import { unsafeHTML } from '@cossackframework/renderer';
html`<div>${unsafeHTML('<script>...</script>')}</div>`;
```

## Using Components in Templates

Use the `component` helper function to include child components in your templates.

```typescript
import { component } from '@cossackframework/renderer';
import { ChildComponent } from './ChildComponent';

html` <div class="parent">${component(ChildComponent, { someProp: 'value' })}</div> `;
```

You can also pass children to components:

```typescript
html`
  <div class="parent">${component(ChildComponent, { someProp: 'value' }, html` <span>Child content</span> `)}</div>
`;
```

## Directives

Cossack includes standard Lit directives.

### `repeat` (Keyed Lists)

Efficiently renders lists by key.

```typescript
import { repeat } from '@cossackframework/renderer';

html`
  <ul>
    ${repeat(
      items,
      (item) => item.id,
      (item) => html` <li>${item.text}</li> `,
    )}
  </ul>
`;
```

### `classMap` & `styleMap`

Dynamic classes and styles.

```typescript
import { classMap, styleMap } from '@cossackframework/renderer';

const classes = { active: isActive, error: hasError };
const styles = { color: 'red', display: isVisible ? 'block' : 'none' };

html`<div class="${classMap(classes)}" style="${styleMap(styles)}">...</div>`;
```

### `ref`

Get a reference to the DOM element.

```typescript
import { ref } from '@cossackframework/renderer';

html`<input ref="${(el) => console.log(el)}" />`;
```

### `live`

Check against the live DOM value (useful for inputs).

```typescript
import { live } from '@cossackframework/renderer';

html`<input .value="${live(inputValue)}" />`;
```

### `key`

Force a subtree to be **recreated** when the key changes. Useful for
re-triggering CSS animations or remounting a child (e.g. on tab/index change).
With the same key, updates apply in place (no rebuild).

```typescript
import { key, html } from '@cossackframework/renderer';

// `child` (and any enter animation) re-runs whenever `currentIndex` changes.
html`<div>${key(currentIndex, html`<div class="animate-fade-in">${child}</div>`)}</div>`;
```

In SSR, `key` is transparent (it just renders its template — there is no
previous DOM to dispose).

## Context API

Share state deep in the tree.

### 1. Create Context

```typescript
import { createContext } from '@cossackframework/renderer';

export const ThemeContext = createContext('light'); // Default value
```

### 2. Provide Context

```typescript
class App extends CossackElement {
  render() {
    this.provide(ThemeContext, 'dark');
    return html`${component(Child)}`;
  }
}
```

### 3. Consume Context

```typescript
class Child extends CossackElement {
  render() {
    const theme = this.consume(ThemeContext);
    return html`<span>Theme is ${theme}</span>`;
  }
}
```

## Reactive Controllers

Reuse logic across components using controllers.

```typescript
import { ReactiveController, ReactiveControllerHost } from '@cossackframework/renderer';

class ClockController implements ReactiveController {
  host: ReactiveControllerHost;
  value = new Date();
  private timer?: number;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected() {
    this.timer = setInterval(() => {
      this.value = new Date();
      this.host.requestUpdate();
    }, 1000);
  }

  hostDisconnected() {
    clearInterval(this.timer);
  }
}

class ClockElement extends CossackElement {
  private clock = new ClockController(this);

  render() {
    return html`<time>${this.clock.value.toLocaleTimeString()}</time>`;
  }
}
```

## Children Projection (Slots)

Cossack supports passing children to components.

**Parent:**

```typescript
html`
  ${component(
    Card,
    {},
    html`
      <h1>Title</h1>
      <p>Content</p>
    `,
  )}
`;
```

**Child (Card):**

```typescript
class Card extends CossackElement {
  render() {
    return html` <div class="card">${this.children}</div> `;
  }
}
```

## Using Cossack Renderer with Other Frameworks

This package is intended to use with the Cossack Framework via `create-cossack-app`, but can also be used standalone in any project that needs a lightweight rendering solution.

### Installation

```bash
pnpm add @cossackframework/renderer
```

### Defining Components

Components are classes that extend `CossackElement`. They manage their own state and render template results.

```typescript
import { CossackElement, html } from '@cossackframework/renderer';

export class MyCounter extends CossackElement {
  // Define reactive properties
  static properties = {
    count: { state: true },
    label: { state: true },
  };

  // Declare fields for TypeScript
  declare count: number;
  declare label: string;

  constructor() {
    super();
    this.count = 0;
    this.label = 'Count';
  }

  increment() {
    this.count++;
  }

  render() {
    return html`
      <div>
        <span>${this.label}: ${this.count}</span>
        <button @click="${() => this.increment()}">+</button>
      </div>
    `;
  }
}
```

### Rendering

#### Client-Side Rendering (Hydration/Mounting)

To mount a component to the DOM:

```typescript
import { MyCounter } from './MyCounter';

const container = document.getElementById('app');
const app = new MyCounter();
app.mount(container); // Mounts and renders to the container
```

#### Server-Side Rendering (SSR)

To render a component to an HTML string:

```typescript
import { renderToString } from '@cossackframework/renderer';
import { MyCounter } from './MyCounter';

const app = new MyCounter();
// Optional: Wait for async data or updates
const htmlString = renderToString(app.render());
console.log(htmlString);
```
