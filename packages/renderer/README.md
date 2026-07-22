# Cossack Renderer Package

Cossack Renderer is a Lit-compatible rendering engine designed for **Light DOM** and **SSR**. It provides a familiar API for building components but focuses on returning HTML strings directly for SSR and managing DOM updates without Shadow DOM isolation.

## Installation

This package is intended to use with the Cossack Framework via `create-cossack-app`, but can also be used standalone in any project that needs a lightweight rendering solution.

```bash
pnpm add @cossackframework/renderer
```

## Defining Components

Components are classes that extend `CossackElement`. They manage their own state and render template results.

```typescript
import { CossackElement, html } from '@cossackframework/renderer';

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
import { renderToString } from '@cossackframework/renderer';
import { MyCounter } from './MyCounter';

const app = new MyCounter();
// Optional: Wait for async data or updates
const htmlString = renderToString(app.render());
console.log(htmlString);
```

## Template Syntax

Cossack uses tagged template literals via `html`.

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
import { unsafeHTML } from '@cossackframework/renderer';
html`<div>${unsafeHTML('<script>...</script>')}</div>`
```

### SVG Fragments

Use `svg` for fragments whose root nodes must be created in the SVG namespace.
SVG results can be nested, rendered in arrays, and used inside an HTML `<svg>`
element. The renderer switches back to the HTML namespace inside
`<foreignObject>`.

```typescript
import { html, svg } from '@cossackframework/renderer';

const dot = (x: number, color: string) => svg`
  <circle cx="${x}" cy="12" r="6" fill="${color}"></circle>
`;

html`<svg viewBox="0 0 100 24">${[dot(12, 'red'), dot(32, 'blue')]}</svg>`
```

SVG and HTML templates serialize the same way during SSR. Namespace selection
is a client DOM concern and is preserved during hydration.

### Rendering Nothing

`nothing` removes the value according to its binding context. An empty string
also renders no child node, but remains an ordinary value in attributes.

```typescript
import { html, nothing } from '@cossackframework/renderer';

html`
  <p>${showMessage ? message : nothing}</p>
  <a title="prefix-${hasTitle ? title : nothing}">link</a>
  <input .value=${hasValue ? value : nothing}>
  <button ?disabled=${busy ? true : nothing}>Save</button>
  <button @click=${enabled ? this.save : nothing}>Save</button>
  <div ...=${enabled ? attributes : nothing}></div>
`
```

In child expressions, `nothing` clears managed nodes. In normal attributes it
removes the whole attribute, including an attribute with several expressions.
Property bindings receive `undefined`, boolean attributes are removed, event
handlers are disabled, and a spread set to `nothing` removes its previously
managed values. SSR, hydration, and later updates use the same rules.

## Component Styles

Declare Light DOM component styles with `static styles`. The `css` tag accepts
only numbers and nested `CSSResult` values in interpolations. Raw values require
the explicit `unsafeCSS` trust boundary.

```typescript
import {
  CossackElement,
  css,
  html,
  unsafeCSS,
} from '@cossackframework/renderer';

const gap = 12;
const shared = css`.label { font-weight: 600; }`;
const reviewedThemeColor = unsafeCSS('rebeccapurple');

class Notice extends CossackElement {
  static styles = [
    shared,
    css`
      .notice { display: flex; gap: ${gap}px; color: ${reviewedThemeColor}; }
      @media (width < 40rem) { .notice { display: block; } }
      @keyframes enter { from { opacity: 0; } }
      .notice { animation: enter 150ms; }
    `,
  ];

  render() {
    return html`<div class="notice"><span class="label">Ready</span></div>`;
  }
}
```

Style arrays may be nested. They are flattened in declaration order, and the
last occurrence of the same `CSSResult` wins. A subclass can extend inherited
styles explicitly:

```typescript
class EmphasizedNotice extends Notice {
  static styles = [Notice.styles, css`.notice { border: 2px solid currentColor; }`];
}
```

Cossack scopes selectors by adding deterministic `data-cossack-scope`
attributes to elements created by that component and emits one managed style
element per component instance. Conditional at-rules and functional selectors
are scoped recursively; keyframe names and matching animation declarations are
rewritten. `:host`, `:host-context`, and `::slotted` are rejected because
Cossack uses Light DOM rather than Shadow DOM.

Scoping follows template ownership. Nested components use their own scope, while
projected templates retain the scope of the component that created them. This
is attribute-based isolation, not a Shadow DOM security boundary: inherited CSS
properties still inherit normally. `unsafeHTML` and manually supplied DOM nodes
are explicit escape hatches and are not guaranteed to receive scope attributes.

## Using Components in Templates

Use the `component` helper function to include child components in your templates.

```typescript
import { component } from '@cossackframework/renderer';
import { ChildComponent } from './ChildComponent';

html`
  <div class="parent">
    ${component(ChildComponent, { someProp: 'value' })}
  </div>
`
```

You can also pass children to components:

```typescript
html`
  <div class="parent">
    ${component(ChildComponent, { someProp: 'value' }, html`
      <span>Child content</span>
    `)}
  </div>
`
```

## Directives

Cossack includes standard Lit directives.

### `repeat` (Keyed Lists)

Efficiently renders lists by key.

```typescript
import { repeat } from '@cossackframework/renderer';

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
import { classMap, styleMap } from '@cossackframework/renderer';

const classes = { active: isActive, error: hasError };
const styles = { color: 'red', display: isVisible ? 'block' : 'none' };

html`<div class="${classMap(classes)}" style="${styleMap(styles)}">...</div>`
```

### `ref`

Get a reference to the DOM element.

```typescript
import { ref } from '@cossackframework/renderer';

html`<input ref="${(el) => console.log(el)}" />`
```

### `live`

Check against the live DOM value (useful for inputs).

```typescript
import { live } from '@cossackframework/renderer';

html`<input .value="${live(inputValue)}" />`
```

### `bind`

Two-way binding for a form element's value/checked against a component state
field. It reads the field for rendering and writes user edits back to it. The
DOM property is inferred from the attribute it is attached to (`.value` →
`value`, `.checked` → `checked`).

```typescript
import { bind } from '@cossackframework/renderer';

html`<input .value="${bind(this, 'email')}" />`
html`<input type="checkbox" .checked="${bind(this, 'active')}" />`
```

`bind` supports dot-paths into nested state, so a `@Store` field can be bound at
any depth: `bind(this, 'address.street')`.

### `key`

Force a subtree to be recreated when the key changes. Useful for re-triggering
CSS animations or remounting a child.

```typescript
import { key } from '@cossackframework/renderer';

html`<div>${key(currentIndex, html`<div class="animate-fade-in">${child}</div>`)}</div>`
```

### `preventDefault`

Wraps an event handler so the event's default is prevented before it runs. It
also disables the browser's native validation on the bound `<form>` by default;
pass `{ novalidate: false }` to keep native validation.

```typescript
import { preventDefault } from '@cossackframework/renderer';

html`<form @submit="${preventDefault(this.onSave)}"></form>`
html`<form @submit="${preventDefault(this.onSave, { novalidate: false })}"></form>`
```

### `when`

Render one of two templates based on a condition. Pass the truthy case and an
optional falsy case (both functions receive the condition).

```typescript
import { when } from '@cossackframework/renderer';

html`${when(isOn, () => html`<p>On</p>`, () => html`<p>Off</p>`)}`
```

### `choose`

Select a template by matching a value against an ordered list of cases, like a
`switch`.

```typescript
import { choose } from '@cossackframework/renderer';

html`${choose(status, [
  ['idle', () => html`<i>Idle</i>`],
  ['loading', () => html`<b>Loading…</b>`],
], () => html`<span>Unknown</span>`)}`
```

### `ifDefined`

Only omit an attribute when the value is `undefined`; render every other value
(including `null`, `false`, `0`, `''`) as a normal attribute.

```typescript
import { ifDefined } from '@cossackframework/renderer';

html`<a href="${ifDefined(url)}">link</a>`
```

### `guard`

Defer re-evaluating a template until its dependencies change. Wrap expensive
rendering so it is not recomputed on every render, only when the inputs it
depends on change. Pass a single dependency or an array (compared shallowly).

```typescript
import { guard } from '@cossackframework/renderer';

html`<ul>${guard(items, () => html`...expensive...`)}</ul>`
html`${guard([query, page], () => renderResults(query, page))}`
```

### `cache`

Keep previously-rendered template subtrees alive instead of destroying them
when the rendered value switches templates. Toggling back to a cached template
reattaches its existing DOM and part tree, preserving component state, scroll
position, and focus.

```typescript
import { cache } from '@cossackframework/renderer';

html`${cache(showA ? html`<a-component></a-component>` : html`<b-component></b-component>`)}`
```

### `map`

Map an iterable to renderable values and render them as a list.

```typescript
import { map } from '@cossackframework/renderer';

html`<ul>${map(items, (item) => html`<li>${item.name}</li>`)}</ul>`
```

### `join`

Join renderable values with a separator interleaved between each pair. The
separator can be a static value or a template (e.g. a divider element).

```typescript
import { join } from '@cossackframework/renderer';

html`${join(names, (n) => n, ', ')}` // "a, b, c"
html`<ul>${join(items, (i) => html`<li>${i}</li>`, () => html`<li class="sep">•</li>`)}</ul>`
```

### `range`

Generate an increasing (or decreasing) sequence of numbers as an array.

```typescript
import { range } from '@cossackframework/renderer';

html`<ul>${range(0, 5).map((n) => html`<li>${n}</li>`)}</ul>` // 0..4
```

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
  ${component(Card, {}, html`
    <h1>Title</h1>
    <p>Content</p>
  `)}
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
