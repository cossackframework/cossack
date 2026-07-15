# Template Directives (`@cossackframework/renderer`)

Directives are reusable template transformations imported from
`@cossackframework/renderer` and used inside `html\`...\`` tagged templates. They
cover the common rendering patterns (lists, conditionals, two-way binding, class/
style maps, memoization) so you don't hand-roll them.

> All directives are exported from `@cossackframework/renderer`. They work in
> **both SSR and client** (hydration-aware) — no special handling is needed.

## Quick reference

| Directive | Signature | Purpose |
|---|---|---|
| `repeat` | `repeat(items, keyFn, template)` / `repeat(items, template)` | Keyed list (efficient reorder, per-item state) |
| `classMap` | `classMap(classInfo)` | Build a `class` string from a `{ [cls]: truthy }` map |
| `styleMap` | `styleMap(styleInfo)` | Build a `style` string from a `{ [prop]: value }` map |
| `when` | `when(condition, trueCase, falseCase?)` | Two-branch conditional (only the taken branch runs) |
| `choose` | `choose(value, cases, defaultCase?)` | Switch over a value against `[lookup, fn][]` |
| `ifDefined` | `ifDefined(value)` | Omit an attribute **only** when value is `undefined` |
| `guard` | `guard(deps, factory)` | Skip re-render until `deps` change (memoize) |
| `cache` | `cache(value)` | Keep switched-away template subtrees alive |
| `map` | `map(iterable, fn)` | Map an iterable to renderable values |
| `join` | `join(iterable, valueFn, joiner)` | Interleave a separator between values |
| `range` | `range(end)` / `range(start, end, step?)` | Number sequence as an array |
| `key` | `key(value, template)` | Force subtree recreation when `value` changes |
| `live` | `live(value)` | Property binding compares against the live DOM value |
| `bind` | `bind(component, fieldName)` | Two-way binding (reads field + writes user edits back) |
| `preventDefault` | `preventDefault(handler, { novalidate }?)` | Wrap a handler; prevent default + toggle `novalidate` |
| `ref` | `ref` attribute / `@Ref()` | Get a reference to a DOM node |
| `unsafeHTML` | `unsafeHTML(htmlString)` | Render a raw HTML string (escape hatch) |

## Conditional rendering — prefer `when`/`choose` over ternaries

A bare ternary works, but `when`/`choose` express intent and only evaluate the
taken branch:

```typescript
import { when, choose } from '@cossackframework/renderer';

// two branches
html`${when(isLoading, () => html`<Spinner/>`, () => html`<List items=${items}/>`)}`;

// more than two branches tied to one value — reads better than nested ternaries
html`${choose(status, [
  ['idle',    () => html`<i>Idle</i>`],
  ['loading', () => html`<b>Loading…</b>`],
  ['error',   () => html`<span class="err">${msg}</span>`],
], () => html`<span>Unknown</span>`)}`;
```

The case functions receive the matched value (and, for `choose`, its index), so
they can use it without a second binding. If the false/default case is omitted,
nothing renders.

## Lists — pick the right tool

- **Keyed list with state preservation → `repeat`** (the default for arrays of
  objects that may reorder). Keys keep DOM/state aligned across shuffles:

  ```typescript
  import { repeat } from '@cossackframework/renderer';

  html`<ul>${repeat(
    items,
    (item) => item.id,            // stable key
    (item, index) => html`<li>${item.name}</li>`,
  )}</ul>`;
  ```

  Overload `repeat(items, template)` uses the index as the key (fine for static
  lists).

- **Simple mapping over any iterable → `map`** (no keying, just an array):

  ```typescript
  html`<ul>${map(items, (item) => html`<li>${item.name}</li>`)}</ul>`;
  ```

- **A separator between items → `join`** (the separator can itself be a
  template):

  ```typescript
  // text separator
  html`${join(names, (n) => n, ', ')}`;                       // "a, b, c"
  // element separator
  html`<ul>${join(items, (i) => html`<li>${i}</li>`, () => html`<li class="sep">•</li>`)}</ul>`;
  ```

- **A fixed number range → `range`** (half-open, like `slice`):

  ```typescript
  html`${range(0, 10).map((n) => html`<span>${n}</span>`)}`;  // 0..9
  html`${range(5, 0, -1)}`;                                   // 5,4,3,2,1
  ```

## Dynamic classes & styles — use `classMap` / `styleMap`

```typescript
import { classMap, styleMap } from '@cossackframework/renderer';

html`<div
  class="${classMap({ active: isActive, error: hasError, 'px-2': true })}"
  style="${styleMap({ color: 'red', display: isVisible ? 'block' : 'none' })}"
>...</div>`;
```

- `classMap`: keys with **truthy** values are joined with spaces.
- `styleMap`: `null`/`undefined` values are dropped; rest become `key:value`.

> These are **pure functions** (return a string), not structural directives —
> they work in any string interpolation, including through `component()` props.

## Optional attributes — `ifDefined`

`ifDefined` drops the attribute **only** when the value is `undefined`; every
other value (including `null`, `false`, `0`, `''`) renders as a normal attribute.
Use it for genuinely-optional attributes like `href`:

```typescript
import { ifDefined } from '@cossackframework/renderer';

html`<a href="${ifDefined(this.url)}">link</a>`;   // no href when url === undefined
```

By contrast, a plain binding `href="${this.url}"` omits on `null`/`undefined`/
`false`. Use `ifDefined` when you want `false`/`null` to render as the literal
strings `"false"`/`"null"` (e.g. data attributes) and **only** `undefined` to
mean "absent".

## Expensive rendering — memoize with `guard`

Wrap a costly subtree so it only re-renders when its dependencies change (shallow
compare). The factory is **not** re-invoked when deps are unchanged:

```typescript
import { guard } from '@cossackframework/renderer';

// single dependency
html`<ul>${guard(items, () => html`...expensive list...`)}</ul>`;

// multiple dependencies — pass an array
html`${guard([query, page], () => renderResults(query, page))}`;
```

> Memoization is **per template site**: the cache lives on the rendered Part, so
> reuse the same `html\`...\`` expression across renders (this is true of every
> directive). Comparing deps is shallow — `===` for a single value, element-wise
> for an array (lengths must match).

## Preserve state across template swaps — `cache`

When toggling between templates, `cache` keeps each branch's DOM and component
state alive instead of destroying it, so switching back restores state, scroll,
and focus:

```typescript
import { cache } from '@cossackframework/renderer';

html`${cache(
  showA ? html`<a-component></a-component>` : html`<b-component></b-component>`,
)}`;
```

The cache key is the template's literal strings, so distinct `html\`...\`` sites
cache separately. Without `cache`, switching back rebuilds the branch and loses
its state.

## Force a remount — `key`

Recreate a subtree when a key changes (re-trigger CSS animations, remount a
child):

```typescript
import { key } from '@cossackframework/renderer';

html`${key(currentIndex, html`<div class="animate-fade-in">${child}</div>`)}`;
```

With the same key, updates apply in place (no rebuild). In SSR, `key` is
transparent (just renders its template).

## Form binding — `bind` (two-way) vs `live` (render-only)

- **Two-way binding → `bind(this, 'field')`**: reads the field for rendering
  **and** writes user edits back (assignment to a `@State`/`@Store` field
  triggers a re-render). The DOM property is inferred from the bound attribute
  (`.value` → `value`, `.checked` → `checked`), and the writeback event is chosen
  per element. Supports dot-paths into nested state.

  ```typescript
  html`<input .value="${bind(this, 'email')}" />`;
  html`<input type="checkbox" .checked="${bind(this, 'active')}" />`;
  html`<input .value="${bind(this, 'address.street')}" />`;
  ```

- **Force the DOM back to a value → `live(value)`**: render-direction only.
  Switches the dirty-check to compare against the **live DOM value** (not the
  last-rendered value), so the property is written whenever the DOM differs.
  Use for a "Reset" that reverts a field the user edited. **Does not write
  back** — for two-way use `bind`.

  ```typescript
  html`<input .value="${live(this.email)}" />`;
  ```

`bind`/`live` also work through `component()` props:
`component(Input, { '.value': bind(this, 'email') })`.

## Event handlers — `preventDefault`

Wrap a handler so `event.preventDefault()` runs first. By default it also sets
`novalidate` on the bound `<form>` (Cossack encourages custom `@Validate`
validation); pass `{ novalidate: false }` to keep native validation:

```typescript
import { preventDefault } from '@cossackframework/renderer';

html`<form @submit="${preventDefault(this.onSave)}"></form>`;
html`<form @submit="${preventDefault(this.onSave, { novalidate: false })}"></form>`;
```

## DOM references — `@Ref()` (not `querySelector`)

Don't reach into the DOM manually. Use the `@Ref()` decorator and the `ref`
binding:

```typescript
import { Ref } from '@cossackframework/core';

@Ref('input') inputRef!: HTMLInputElement;
// in a template:
html`<input ref="${this.inputRef}" />`;
```

## Raw HTML — `unsafeHTML` (escape hatch)

Render an unescaped HTML string. **Only** use this with trusted content (it's an
XSS vector for user-supplied strings):

```typescript
import { unsafeHTML } from '@cossackframework/renderer';

html`<div>${unsafeHTML(trustedHtmlString)}</div>`;
```

## Common mistakes

- **Hand-rolling two-way binding.** Don't write `.value="${x}"` + `@input` +
  `setProperty` — use `bind(this, 'field')`.
- **Using a ternary where `when`/`choose` is clearer.** For 2+ branches tied to
  one value, `choose` reads far better than nested ternaries.
- **Forgetting `repeat` keys reorder.** A plain `.map()` rebuilds every item on
  shuffle; `repeat` with a stable key preserves per-item state/DOM.
- **Expecting `guard` to memoize across different template sites.** The cache is
  per-Part — reuse the same `html\`...\`` site across renders.
- **Using `live` for two-way binding.** `live` only pushes values into the DOM;
  it does not write edits back. Use `bind`.
- **Using `unsafeHTML` with user input.** It does no escaping — only render
  trusted/sanitized content.
