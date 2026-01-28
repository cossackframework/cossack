# Cossack Renderer Project (CRP) Usage Guide

CRP is a Lit-compatible rendering engine designed for **Light DOM** and **SSR**. It provides a familiar API for building components but focuses on returning HTML strings directly for SSR and managing DOM updates without Shadow DOM isolation.

## Installation

```bash
pnpm add cossack-renderer
```

## Defining Components

Components are classes that extend `CossackElement`. They manage their own state and render template results.

```typescript
import { CossackElement, html } from 'cossack-renderer';

export class MyCounter extends CossackElement {
  // Define reactive properties
  static properties = {
    count: { state: true },
    label: { state: true }
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

## Rendering

### Client-Side Rendering (Hydration/Mounting)

To mount a component to the DOM:

```typescript
import { MyCounter } from './MyCounter';

const container = document.getElementById('app');
const app = new MyCounter();
app.mount(container); // Mounts and renders to the container
```

### Server-Side Rendering (SSR)

To render a component to an HTML string:

```typescript
import { renderToString } from 'cossack-renderer';
import { MyCounter } from './MyCounter';

const app = new MyCounter();
// Optional: Wait for async data or updates
const htmlString = renderToString(app.render());
console.log(htmlString);
```

## Template Syntax

CRP uses tagged template literals via `html`.

### Basic Expressions

```typescript
html`<h1>Hello ${name}</h1>`
```

### Attributes

Boolean attributes are removed if `false/null/undefined`.

```typescript
html`<button ?disabled="${isDisabled}">Click</button>`
```

### Event Binding

Bind event listeners using Lit's `@` syntax.

```typescript
html`<button @click="${(e) => this.handleClick(e)}">Click Me</button>`
```

### Property Binding

For `<input>` elements, use `.` prefix to bind properties directly.

```typescript
html`<input type="text" .value="${this.inputValue}" @input="${this.handleInput}" />`
```

### Spread Attributes

You can spread an object into attributes using the `...` syntax.

```typescript
const props = { id: 'btn', class: 'primary', 'data-type': 'action' };
html`<button ...=${props}>Click</button>`
```

### Unsafe HTML

To render raw HTML strings (careful!):

```typescript
import { unsafeHTML } from 'cossack-renderer';
html`<div>${unsafeHTML('<script>...</script>')}</div>`
```

## Using Components in Templates

There are two ways to use other components within a template.

### 1. The `component` Helper

Type-safe and explicit.

```typescript
import { component } from 'cossack-renderer';
import { ChildComponent } from './ChildComponent';

html`
  <div class="parent">
    ${component(ChildComponent, { someProp: 'value' })}
  </div>
`
```

### 2. JSX-like Syntax `<c:TagName>`

More declarative. Requires registering components in `static components`.

```typescript
class ParentComponent extends CossackElement {
  static components = { ChildComponent };

  render() {
    return html`
      <div class="parent">
        <c:ChildComponent .someProp="value"></c:ChildComponent>
        
        <!-- Spread props -->
        <c:ChildComponent ...=${{ otherProp: 123 }}></c:ChildComponent>
      </div>
    `;
  }
}
```

## Directives

CRP includes standard Lit directives.

### `repeat` (Keyed Lists)

Efficiently renders lists by key.

```typescript
import { repeat } from 'cossack-renderer';

html`
  <ul>
    ${repeat(items, (item) => item.id, (item) => html`
      <li>${item.text}</li>
    `)}
  </ul>
`
```

### `classMap` & `styleMap`

Dynamic classes and styles.

```typescript
import { classMap, styleMap } from 'cossack-renderer';

const classes = { active: isActive, error: hasError };
const styles = { color: 'red', display: isVisible ? 'block' : 'none' };

html`<div class="${classMap(classes)}" style="${styleMap(styles)}">...</div>`
```

### `ref`

Get a reference to the DOM element.

```typescript
import { ref } from 'cossack-renderer';

html`<input ref="${(el) => console.log(el)}" />`
```

### `live`

Check against the live DOM value (useful for inputs).

```typescript
import { live } from 'cossack-renderer';

html`<input .value="${live(inputValue)}" />`
```

## Context API

Share state deep in the tree.

### 1. Create Context

```typescript
import { createContext } from 'cossack-renderer';

export const ThemeContext = createContext('light'); // Default value
```

### 2. Provide Context

```typescript
class App extends CossackElement {
  render() {
    this.provide(ThemeContext, 'dark');
    return html`<c:Child></c:Child>`;
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
import { ReactiveController, ReactiveControllerHost } from 'cossack-renderer';

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

CRP supports passing children to components.

**Parent:**
```typescript
html`
  <c:Card>
    <h1>Title</h1>
    <p>Content</p>
  </c:Card>
`
```

**Child (Card):**
```typescript
class Card extends CossackElement {
  render() {
    return html`
      <div class="card">
        ${this.children}
      </div>
    `;
  }
}
```