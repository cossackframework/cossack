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
 * @param fieldName  The state field name to read from / write back to.
 */
export const bind = (component: unknown, fieldName: string) =>
  new BindResult(component, fieldName);

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

// Ref is usually just a function, but we can verify it
export type RefCallback = (el: Element | undefined) => void;
