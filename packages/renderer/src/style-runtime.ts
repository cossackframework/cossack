import type { CSSResultGroup } from './css-result';

export interface FinalizedStyles {
  readonly cssText: string;
  readonly scopeId: string;
}

/** One component style scope a render used: its id and its scoped CSS. */
export interface ComponentStyle {
  readonly scopeId: string;
  readonly cssText: string;
}

type StyledClass = Function & { styles?: CSSResultGroup };
type StyleFinalizer = (styles: CSSResultGroup) => FinalizedStyles;

let finalizeStyles: StyleFinalizer | undefined;
const finalizedStyles = new WeakMap<Function, FinalizedStyles | null>();
// Scope ids hash the normalized CSS, so classes with identical styles share
// one scope and one stylesheet.
const stylesByScope = new Map<string, FinalizedStyles>();
const emptyStyles = (value: unknown): boolean => Array.isArray(value) && value.every(emptyStyles);

/** @internal Installed when css`` or unsafeCSS() constructs component styles. */
export const registerStyleFinalizer = (finalizer: StyleFinalizer): void => {
  finalizeStyles = finalizer;
};

/** @internal Components without styles never need the CSS parser. */
export const getFinalizedStyles = (componentClass: StyledClass): FinalizedStyles | null => {
  if (finalizedStyles.has(componentClass)) return finalizedStyles.get(componentClass)!;
  // Read static getters once. A getter may itself construct css`` and register
  // the finalizer, just as an ordinary static field initializer does.
  const declared = componentClass.styles;
  let result: FinalizedStyles | null;
  if (declared === undefined) result = null;
  else if (finalizeStyles) result = finalizeStyles(declared);
  // Empty (possibly nested) style arrays are valid without a CSS factory.
  // cztntfp is the existing FNV-1a scope hash for an empty stylesheet.
  else if (emptyStyles(declared)) result = { cssText: '', scopeId: 'cztntfp' };
  else {
    throw new TypeError(
      '[cossack/renderer] static styles must contain only CSSResult values returned by css`` or unsafeCSS().',
    );
  }
  finalizedStyles.set(componentClass, result);
  if (result && !stylesByScope.has(result.scopeId)) stylesByScope.set(result.scopeId, result);
  return result;
};

/**
 * @internal The stylesheet for a scope that templates carry, or undefined when
 * there is nothing to emit (unknown scope or empty CSS).
 */
export const stylesForScope = (scopeId: string): FinalizedStyles | undefined => {
  const styles = stylesByScope.get(scopeId);
  return styles && styles.cssText !== '' ? styles : undefined;
};

// --- SSR collection ---

// Rendering is synchronous, so one active collector at a time is enough.
let activeCollector: Map<string, ComponentStyle> | undefined;

/** @internal Called by SSR for every template rendered in a style scope. */
export const recordStyleScope = (scopeId: string): void => {
  const collector = activeCollector;
  if (!collector || collector.has(scopeId)) return;
  const styles = stylesForScope(scopeId);
  if (styles) collector.set(scopeId, { scopeId, cssText: styles.cssText });
};

/**
 * Run a synchronous server render and return the component style scopes it
 * used, in first-use order. Components do not inline their styles: emit the
 * returned styles once per page, in `<head>`, with `renderComponentStyles()`.
 *
 * ```ts
 * const { result: body, styles } = collectComponentStyles(() => renderToString(page, { hydrate: true }));
 * const head = renderComponentStyles(styles);
 * ```
 */
export const collectComponentStyles = <T>(render: () => T): { result: T; styles: ComponentStyle[] } => {
  const previous = activeCollector;
  const collector = new Map<string, ComponentStyle>();
  activeCollector = collector;
  try {
    const result = render();
    return { result, styles: [...collector.values()] };
  } finally {
    activeCollector = previous;
    // A nested collection still counts towards the enclosing render.
    if (previous) for (const [scopeId, style] of collector) if (!previous.has(scopeId)) previous.set(scopeId, style);
  }
};

/** Attribute naming the scope on every managed component `<style>` element. */
export const COMPONENT_STYLE_ATTRIBUTE = 'data-cossack-style';

/**
 * One `<style data-cossack-style="<scope id>">` element per collected scope.
 * The client adopts these elements on hydration instead of inserting copies.
 */
export const renderComponentStyles = (styles: readonly ComponentStyle[]): string => styles
  .map(({ scopeId, cssText }) => {
    // `</style` would end the element early; `<\/style` is equivalent CSS.
    const safeCss = cssText.replace(/<\/style/gi, '<\\/style');
    return `<style ${COMPONENT_STYLE_ATTRIBUTE}="${scopeId.replace(/[^a-z0-9_-]/gi, '')}">${safeCss}</style>`;
  })
  .join('');
