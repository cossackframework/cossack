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

// Ref is usually just a function, but we can verify it
export type RefCallback = (el: Element | undefined) => void;
