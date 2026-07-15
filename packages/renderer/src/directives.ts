// --- Result Wrappers ---

export class LiveResult {
  constructor(public readonly value: unknown) {}
}

export class RepeatResult {
  constructor(
    public readonly items: unknown[],
    public readonly keyFn: (item: any, index: number) => unknown,
    public readonly templateFn: (item: any, index: number) => unknown,
  ) {}
}

export class KeyResult {
  constructor(
    public readonly value: unknown,
    public readonly template: unknown,
  ) {}
}

export class BindResult {
  constructor(
    // The component instance that owns the state field. The directive reads
    // the current value from it on render and writes user edits back to it.
    public readonly component: unknown,
    // The state field name on the component (e.g. 'email').
    public readonly fieldName: string,
  ) {}
}

export class PreventDefaultResult {
  constructor(
    // The wrapped event handler.
    public readonly handler: EventListener,
    // Whether the bound <form> should get `novalidate` to disable the
    // browser's native validation. Resolved from options at the call site.
    public readonly novalidate: boolean,
  ) {}
}

export class IfDefinedResult {
  constructor(public readonly value: unknown) {}
}

export class GuardResult {
  constructor(
    // Value(s) compared across renders to decide whether the factory should run
    // again. A single value or an array — both are compared shallowly.
    public readonly deps: unknown,
    // Invoked to produce the rendered value when the deps change.
    public readonly factory: () => unknown,
  ) {}
}

export class CacheResult {
  constructor(public readonly value: unknown) {}
}

// --- Directives ---

/**
 * Checks against the DOM value instead of the previous rendered value.
 * Usage: <input .value=${live(x)}>
 */
export const live = (value: unknown) => new LiveResult(value);

/**
 * Repeats a template for each item in an array, using a key to maintain state.
 * Usage: repeat(items, (item) => item.id, (item) => html`...`)
 */
export const repeat = (
  items: unknown[],
  keyFnOrTemplate: (item: any, index: number) => unknown,
  template?: (item: any, index: number) => unknown,
) => {
  if (template === undefined) {
    // Overload: repeat(items, template) -> key is index
    return new RepeatResult(items, (_i: any, index: number) => index, keyFnOrTemplate as any);
  }
  return new RepeatResult(items, keyFnOrTemplate, template);
};

/**
 * Generates a class string from an object.
 * Usage: class="${classMap({ active: isActive })}"
 */
export const classMap = (classInfo: Record<string, string | boolean | number>) => {
  return Object.keys(classInfo)
    .filter((key) => classInfo[key])
    .join(' ');
};

/**
 * Generates a style string from an object.
 * Usage: style="${styleMap({ color: 'red' })}"
 */
export const styleMap = (styleInfo: Record<string, string | undefined | null>) => {
  return Object.keys(styleInfo)
    .filter((key) => styleInfo[key] != null)
    .map((key) => `${key}:${styleInfo[key]}`)
    .join(';');
};

/**
 * Forces its subtree to be recreated when `value` changes.
 * Useful for re-triggering CSS animations and forcing remounts.
 * Usage: html`${key(id, html`<child></child>`)}`
 */
export const key = (value: unknown, template: unknown) => new KeyResult(value, template);

/**
 * Two-way binding for a form element's value/checked against a component
 * state field. Reads the field for rendering AND writes user edits back to
 * it (which triggers a re-render via the `@State` setter).
 *
 * Usage (`.value`/`.checked` is inferred from the bound attribute):
 *   <input .value="${bind(this, 'email')}" />
 *   <input type="checkbox" .checked="${bind(this, 'active')}" />
 *
 * `bind` picks the DOM property to bind from the attribute it is attached to
 * (`.value` -> `value`, `.checked` -> `checked`) and the appropriate writeback
 * event for the element (`input` for text-like inputs/textarea; `change` for
 * checkbox/radio/range inputs and `<select>`).
 *
 * @param component  The component instance owning the state field (usually `this`).
 * @param fieldName  The state field name to read from / write back to. Supports
 *                   dot-paths into nested state (e.g. `'address.street'`), so a
 *                   `@Store` field can be bound at any depth.
 */
export const bind = (component: unknown, fieldName: string) =>
  new BindResult(component, fieldName);

/**
 * Read a (possibly dotted) field path off a component, walking the object graph
 * via property access (so `@Store` reactive proxies traverse correctly).
 * Single-segment paths take the fast path; `null`/`undefined` short-circuits.
 *
 * @internal — used by the bind directive; lives here so the renderer stays
 * dependency-free (it mirrors `resolveStatePath` in @cossackframework/core).
 */
export function resolveField(component: unknown, path: string): unknown {
  const comp = component as any;
  if (!path.includes('.')) return comp?.[path];
  const parts = path.split('.');
  let current: any = comp?.[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (current == null) return undefined;
    current = current[parts[i]];
  }
  return current;
}

/**
 * Write a value into a (possibly dotted) field path. Resolves to the parent via
 * property access (so the `@Store` Proxy trap fires on the final segment) and
 * creates intermediate objects when a segment is missing.
 *
 * @internal — counterpart to {@link resolveField} for the bind writeback.
 */
export function setField(component: unknown, path: string, value: unknown): void {
  const comp = component as any;
  if (!comp) return;
  if (!path.includes('.')) {
    comp[path] = value;
    return;
  }
  const parts = path.split('.');
  let current: any = comp[parts[0]];
  for (let i = 1; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  if (current != null && typeof current === 'object') {
    current[parts[parts.length - 1]] = value;
  }
}

/**
 * Wraps an event handler so the event's default is prevented before it runs.
 *
 * Browser-native (HTML5 constraint) validation is ALSO disabled by default —
 * the bound <form> gets `novalidate` — because Cossack encourages custom
 * `@Validate` validation. Pass `{ novalidate: false }` to restore native
 * validation.
 *
 * Usage:
 *   <form @submit="${preventDefault(this.serverHandle)}"></form>
 *   <!-- keep native validation -->
 *   <form @submit="${preventDefault(this.serverHandle, { novalidate: false })}"></form>
 *
 * @param handler  The event handler to invoke after preventing default.
 * @param options  Optional. `novalidate` (default `true`) toggles `novalidate`.
 */
export const preventDefault = (
  handler: EventListener,
  options?: { novalidate?: boolean },
) => new PreventDefaultResult(handler, options?.novalidate ?? true);

/**
 * Only omit an attribute when the value is `undefined`; render every other
 * value (including `null`, `false`, `0`, `''`) as a normal attribute. This is
 * the Lit-faithful `ifDefined` directive.
 *
 * By default a plain Cossack attribute binding `href="${url}"` already omits the
 * attribute for `null`/`undefined`/`false`, and renders everything else. The
 * difference `ifDefined` makes is two-fold:
 *
 *  1. Only `undefined` drops the attribute — `null` is rendered as `"null"`,
 *     `false` as `"false"` (useful for data attributes where you want the
 *     literal string rather than an omission).
 *  2. When the value transitions from defined back to `undefined` on a
 *     re-render, the attribute is explicitly removed.
 *
 * Usage:
 *   html`<a href="${ifDefined(url)}">link</a>`
 *   html`<div data-flag="${ifDefined(maybeUndefined)}">...</div>`
 *
 * @param value  The value to render, or `undefined` to omit the attribute.
 */
export const ifDefined = (value: unknown) => new IfDefinedResult(value);

/**
 * Defers re-evaluating a template until its dependencies change. `guard` caches
 * the value produced by `factory()` and reuses it on subsequent renders as long
 * as `deps` is shallow-equal to the previous render; `factory` only runs again
 * when a dependency changes.
 *
 * This is an optimization for expensive rendering (large lists, heavy
 * computations): wrap the costly part so it is not recomputed on every render,
 * only when the inputs it actually depends on change.
 *
 * Usage (single dependency):
 *   html`<ul>${guard(items, () => html`...expensive...`)}</ul>`
 * Usage (multiple dependencies — pass an array):
 *   html`${guard([query, page], () => renderResults(query, page))}`
 *
 * The dependency comparison is shallow: for a single value it uses `===`; for
 * an array each element is compared with `===` and lengths must match.
 *
 * @param deps     A comparable value or an array of values.
 * @param factory  Called (with no args) to produce the value when deps change.
 */
export const guard = (deps: unknown, factory: () => unknown) => new GuardResult(deps, factory);

/**
 * Caches and reuses previously-rendered template subtrees instead of destroying
 * them when the rendered value switches to a different template. When you
 * toggle between two (or more) templates behind `cache`, switching back to one
 * that was rendered before reattaches its existing DOM and part tree rather
 * than rebuilding it — so component state, scroll positions, focus, and DOM
 * identity are preserved across the swap.
 *
 * Without `cache`, a conditional like `cond ? html\`<A/>\` : html\`<B/>\``
 * rebuilds the previously-shown branch every time you switch back, losing that
 * branch's state. With `cache`, each branch is kept alive while it is not
 * displayed.
 *
 * Usage:
 *   html`${cache(showA ? html`<A-component></A-component>` : html`<B-component></B-component>`)}`
 *
 * The cache key is the template's `strings` (the literal parts of the tagged
 * template), so distinct `html\`...\`` sites are cached separately. Non-template
 * values are passed through unchanged (no caching benefit, no harm).
 *
 * @param value  A `TemplateResult` (or any node value) to cache by template.
 */
export const cache = (value: unknown) => new CacheResult(value);

/**
 * Renders one of two templates based on a condition. `when` is a pure function
 * that picks a branch and returns its result — it has no engine coupling, the
 * chosen value flows through the renderer like any other node value.
 *
 * Usage:
 *   html`${when(isOn, () => html`<p>On</p>`, () => html`<p>Off</p>`)}`
 *
 * The case functions receive the condition so they can use it without a second
 * binding. If the false case is omitted, `undefined` is returned (renders nothing).
 *
 * @param condition  Truthy/falsy value selecting the branch.
 * @param trueCase   Called with `condition` when it is truthy.
 * @param falseCase  Optional. Called with `condition` when it is falsy.
 */
export const when = (
  condition: unknown,
  trueCase: (c: unknown) => unknown,
  falseCase?: (c: unknown) => unknown,
) => (condition ? trueCase(condition) : falseCase?.(condition));

/**
 * Selects a template by matching a value against an ordered list of cases,
 * like a `switch`. The first case whose lookup `===` the value wins; otherwise
 * the optional default case is used (or nothing is rendered).
 *
 * Usage:
 *   html`${choose(status, [
 *     ['idle', () => html`<i>Idle</i>`],
 *     ['loading', () => html`<b>Loading…</b>`],
 *   ], () => html`<span>Unknown</span>`)}`
 *
 * Each case function receives the matched value and its case index.
 *
 * @param value        The value to match.
 * @param cases        Ordered `[lookup, fn]` pairs. First `lookup === value` wins.
 * @param defaultCase  Optional fallback called when no case matches.
 */
export const choose = <T>(
  value: T,
  cases: Array<[T, (v: T, i: number) => unknown]>,
  defaultCase?: () => unknown,
): unknown => {
  for (let i = 0; i < cases.length; i++) {
    const [lookup, fn] = cases[i];
    if (lookup === value) return fn(value, i);
  }
  return defaultCase?.();
};

/**
 * Maps an iterable to renderable values (e.g. templates) and returns the array.
 * It is a thin helper over `Array.from` so that plain objects/iterables can be
 * rendered as a list without manually spreading into an array first. The
 * renderer already handles arrays, so this needs no engine integration.
 *
 * Usage:
 *   html`<ul>${map(items, (item) => html`<li>${item.name}</li>`)}</ul>`
 *
 * @param iterable   Anything `Array.from` accepts.
 * @param identityFn Maps each item to a renderable value, receiving `(item, index)`.
 */
export const map = <T>(
  iterable: Iterable<T> | ArrayLike<T>,
  identityFn: (item: T, index: number) => unknown,
): unknown[] => Array.from(iterable, identityFn);

/**
 * Joins renderable values with a separator interleaved between each pair — the
 * list equivalent of `Array.prototype.join`, but with values rather than
 * strings so the separator can itself be a template (e.g. a `<li>` divider).
 *
 * Usage (string separator):
 *   html`${join(names, (n) => n, ', ')}`  // "a, b, c"
 * Usage (separator template):
 *   html`<ul>${join(items, (i) => html`<li>${i}</li>`, () => html`<li class="sep">•</li>`)}</ul>`
 *
 * @param iterable Anything `Array.from` accepts.
 * @param valueFn  Maps each item to a renderable value.
 * @param joiner   Either a static renderable value or `(index) => value`. The
 *                 index is the position of the item BEFORE the separator.
 */
export const join = <T>(
  iterable: Iterable<T> | ArrayLike<T>,
  valueFn: (item: T, index: number) => unknown,
  joiner: unknown | ((index: number) => unknown),
): unknown[] => {
  const arr = Array.from(iterable);
  const out: unknown[] = [];
  const sepFn = typeof joiner === 'function' ? (joiner as (i: number) => unknown) : () => joiner;
  for (let i = 0; i < arr.length; i++) {
    out.push(valueFn(arr[i], i));
    if (i < arr.length - 1) out.push(sepFn(i));
  }
  return out;
};

/**
 * Generates an increasing (or decreasing) sequence of numbers as an array,
 * suitable for rendering a fixed number of items. Overloads:
 *   range(end)               -> [0, 1, …, end-1]     (half-open, step +1)
 *   range(start, end)        -> [start, …, end-1]    (step +1)
 *   range(start, end, step)  -> [start, start+step, …]  (stops before `end`)
 *
 * Usage:
 *   html`<ul>${range(0, 5).map((n) => html`<li>${n}</li>`)}</ul>`
 *
 * A negative `step` walks downward (e.g. `range(5, 0, -1)` → `[5,4,3,2,1]`).
 */
export const range = (startOrEnd: number, end?: number, step = 1): number[] => {
  const start = end === undefined ? 0 : startOrEnd;
  const stop = end === undefined ? startOrEnd : end;
  const out: number[] = [];
  if (step === 0) return out;
  if (step > 0) {
    for (let n = start; n < stop; n += step) out.push(n);
  } else {
    for (let n = start; n > stop; n += step) out.push(n);
  }
  return out;
};

// Ref is usually just a function, but we can verify it
export type RefCallback = (el: Element | undefined) => void;
