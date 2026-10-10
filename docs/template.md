---
title: 'Cossack Template'
description: 'Build dynamic user interfaces with the html template function.'
---

# Cossack Template

Use Cossack templates to build dynamic user interfaces. The syntax draws on Lit.

## Template Syntax

The `html` function creates a tagged template literal.

### Basic Expressions

```typescript
html`<h1>Hello ${name}</h1>`;
```

### Attributes

Boolean attributes are removed if `false/null/undefined`.

```typescript
html`<button ?disabled="${isDisabled}">Click</button>`;
```

### Table rows

Wrap dynamic table rows in an explicit `<tbody>`:

```typescript
html`<table><tbody>${rows.map(row => html`<tr><td>${row.name}</td></tr>`)}</tbody></table>`;
```

Browsers insert a missing `<tbody>` while parsing HTML. That can move hydration
markers and force the client to rebuild the server-rendered table.

### Event Binding

Bind event listeners using Lit's `@` syntax.

```typescript
html`<button @click="${(e) => this.handleClick(e)}">Click Me</button>`;
html`<form @submit="${this.handleSubmit}">...</form>`;
```

### Property Binding

For `<input>` elements, use `.` prefix to bind properties directly.

```typescript
html`<input type="text" .value="${this.inputValue}" @input="${this.handleInput}" />`;
```

### Spread Attributes

Use `...` to spread an object into attributes.

```typescript
const props = { id: 'btn', class: 'primary', 'data-type': 'action' };
html`<button ...=${props}>Click</button>`;
```

### Unsafe HTML

To render an HTML string, use `unsafeHTML`:

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

Renders lists by key. The framework reuses and reorders DOM nodes by key.

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

Compare against the live DOM value instead of the last-rendered value when
deciding whether to write a property. This is the Lit-faithful `live` directive.

By default, a plain property binding like `.value="${this.email}"` compares
against the last value the renderer committed. If the bound value is
unchanged, the write is skipped, so a user's in-progress edit is not clobbered.
`live()` switches the comparison to the actual DOM value. The property
is written whenever the DOM differs from the bound value, even if the bound
value itself has not changed. Use it to force the DOM back to the
bound value, for example in a "Reset" button that reverts a field the user edited.

> Note: `live()` is a render-direction directive only. It does not provide
> two-way binding. It does not write DOM edits back into your state. For
> two-way binding, use [`bind()`](#bind) instead.

```typescript
import { live } from '@cossackframework/renderer';

html`<input .value="${live(this.email)}" />`;
```

`live()` also works when routed through `component()` props (for example `component(Input, { '.value': live(this.email) })`), so it can be combined with UI components the same way `bind()` can.

### `bind`

Two-way binding for a form element's value/checked against a component state
field. It reads the field for rendering and writes user edits back to it
(assignment to a `@State` field triggers a re-render automatically). The DOM
property is inferred from the attribute it is attached to (`.value` → `value`,
`.checked` → `checked`). The writeback event is chosen per element
(`input` for text-like inputs and `<textarea>`, `change` for checkbox/radio/
range inputs and `<select>`).

`bind(this, 'field')` replaces the manual combination of `.value`, `@input`,
and `setProperty`:

```typescript
import { html, bind } from '@cossackframework/renderer';

// Before:
html`<input
    .value="${this.email}"
    @input="${(e: Event) => this.setProperty('email', (e.target as HTMLInputElement).value)}"
/>`;

// After:
html`<input .value="${bind(this, 'email')}" />`;
```

Works for checkboxes too:

```typescript
html`<input type="checkbox" .checked="${bind(this, 'active')}" />`;
```

### `key`

Force the framework to recreate a subtree when the key changes. Use it for
re-triggering CSS animations or remounting a child, for example on tab or index
change. With the same key, updates apply in place (no rebuild).

```typescript
import { key, html } from '@cossackframework/renderer';

// `child` (and any enter animation) re-runs whenever `currentIndex` changes.
html`<div>${key(currentIndex, html`<div class="animate-fade-in">${child}</div>`)}</div>`;
```

In SSR, `key` is transparent. It renders its template, and there is no
previous DOM to dispose.

### `preventDefault`

Wraps an event handler so the browser prevents the event's default before the handler
runs.

The directive also disables browser-native (HTML5 constraint) validation by
default. The bound `<form>` gets the `novalidate` attribute, because Cossack
expects custom `@Validate` validation. Pass `{ novalidate: false }` to restore
native validation. The `preventDefault` behavior itself stays unconditional.

```typescript
import { preventDefault } from '@cossackframework/renderer';

html`<form @submit="${preventDefault(this.onSave)}"></form>`;
// keep native validation:
html`<form @submit="${preventDefault(this.onSave, { novalidate: false })}"></form>`;
```

### `when`

Render one of two templates based on a condition. The two branches are
functions, and the framework invokes a function only when its case is selected.
The untaken branch never runs. The chosen case
function receives the condition as its argument.

```typescript
import { when } from '@cossackframework/renderer';

html`${when(isOn, () => html`<p>On</p>`, () => html`<p>Off</p>`)}`;
```

If the false case is omitted, nothing is rendered when the condition is falsy.

### `choose`

Select a template by matching a value against an ordered list of cases, like a
`switch` statement. The first case whose lookup `===` the value wins. Otherwise
the optional default case is used.

```typescript
import { choose } from '@cossackframework/renderer';

html`${choose(status, [
  ['idle', () => html`<i>Idle</i>`],
  ['loading', () => html`<b>Loading…</b>`],
], () => html`<span>Unknown</span>`)}`;
```

Each case function receives the matched value and its case index. Use `choose`
when more than two branches depend on a single value. It reads
more clearly than a chain of `when` calls or ternaries.

### `ifDefined`

Omit an attribute only when its value is `undefined`. Render every other value
(including `null`, `false`, `0`, `''`) as a normal attribute. This is the
Lit-faithful `ifDefined` directive.

By default a plain Cossack attribute binding like `href="${url}"` omits the
attribute for `null`/`undefined`/`false`. `ifDefined` narrows that to
`undefined`-only omission. It renders `false`/`null` as the literal strings
`"false"`/`"null"`. This is useful for data attributes where you want the literal
value rather than an omission.

```typescript
import { ifDefined } from '@cossackframework/renderer';

html`<a href="${ifDefined(url)}">link</a>`;
```

When the value transitions from defined back to `undefined` on a re-render, the
attribute is explicitly removed. `ifDefined` also works through `component()`
props (for example `component(Link, { href: ifDefined(url) })`).

### `guard`

Defer re-evaluating a template until its dependencies change. `guard` caches
the value produced by its factory and reuses it on subsequent renders as long
as the `deps` are shallow-equal to the previous render. The factory runs
again when a dependency changes.

Use `guard` for expensive rendering, such as large lists or heavy
computations. The costly part then runs only when the inputs it depends on
change, not on every render.

```typescript
import { guard } from '@cossackframework/renderer';

// single dependency
html`<ul>${guard(items, () => html`...expensive list...`)}</ul>`;

// multiple dependencies — pass an array (compared element-by-element)
html`${guard([query, page], () => renderResults(query, page))}`;
```

The dependency comparison is shallow. For a single value, it uses `===`. For an
array each element is compared with `===` and the lengths must match.
Memoization is per-template-site. The cache lives on the rendered Part, so
reuse the same `html\`...\`` site across renders for it to take effect (this is
how all Cossack/Lit directives work).

### `cache`

Keep previously-rendered template subtrees alive instead of destroying them
when the rendered value switches to a different template. When you toggle
between two or more templates behind `cache`, switching back reattaches the
existing DOM and part tree rather than rebuilding it. Component state, scroll
position, focus, and DOM identity survive the swap.

Without `cache`, a conditional like `cond ? html\`<A/>\` : html\`<B/>\`` rebuilds
the previously-shown branch every time you switch back. That branch loses its
state. With `cache`, each branch is kept alive while it is not displayed.

```typescript
import { cache } from '@cossackframework/renderer';

html`${cache(showA ? html`<a-component></a-component>` : html`<b-component></b-component>`)}`;
```

The cache key is the template's `strings` (the literal parts of the tagged
template), so distinct `html\`...\`` sites are cached separately. Non-template
values are passed through unchanged (no caching benefit, no harm).

### `map`

Map an iterable to renderable values, such as templates, and render them as a
list. It is a small helper over `Array.from`. Plain objects, `Set`s, and
other iterables then render as a list without manual conversion to an
array.

```typescript
import { map } from '@cossackframework/renderer';

html`<ul>${map(items, (item) => html`<li>${item.name}</li>`)}</ul>`;
```

`map` does not key its items (it renders a plain array). For keyed lists with
reordering and per-item state preservation, use [`repeat`](#repeat-keyed-lists)
instead.

### `join`

Join renderable values with a separator between each pair. It is the list
equivalent of `Array.prototype.join`, but with values instead of strings. The
separator can be a template, for example a divider element.

```typescript
import { join } from '@cossackframework/renderer';

// string separator -> "a, b, c"
html`${join(names, (n) => n, ', ')}`;

// separator template (a divider between list items)
html`<ul>${join(items, (i) => html`<li>${i}</li>`, () => html`<li class="sep">•</li>`)}</ul>`;
```

The joiner is a static value or a `(index) => value` function. The index
is the position of the item before the separator.

### `range`

Generate an increasing or decreasing sequence of numbers as an array.
Use it to render a fixed number of items, for example pagination or a numbered
grid. It is half-open like `Array.prototype.slice`.

- `range(end)` → `[0, 1, …, end-1]`
- `range(start, end)` → `[start, …, end-1]`
- `range(start, end, step)` → `[start, start+step, …]` (stops before `end`)

```typescript
import { range } from '@cossackframework/renderer';

html`<ul>${range(0, 5).map((n) => html`<li>${n}</li>`)}</ul>`; // 0..4
html`${range(5, 0, -1).map((n) => html`<li>${n}</li>`)}`;      // 5,4,3,2,1
```

A negative `step` walks downward.

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

Parent:

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

Child (Card):

```typescript
class Card extends CossackElement {
  render() {
    return html` <div class="card">${this.children}</div> `;
  }
}
```

## Using Cossack Renderer with Other Frameworks

Projects created with `cossack create` include this package. You can also
use it standalone in any project.

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
