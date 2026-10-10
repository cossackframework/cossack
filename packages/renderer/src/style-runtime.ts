import type { CSSResultGroup } from './css-result';

export interface FinalizedStyles {
  readonly cssText: string;
  readonly scopeId: string;
}

type StyledClass = Function & { styles?: CSSResultGroup };
type StyleFinalizer = (styles: CSSResultGroup) => FinalizedStyles;

let finalizeStyles: StyleFinalizer | undefined;
const finalizedStyles = new WeakMap<Function, FinalizedStyles | null>();
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
  return result;
};
