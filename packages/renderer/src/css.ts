import { createCSSResult as createResult, CSSResult } from './css-result';
import { finalizeStyles } from './css-scoping';
import { registerStyleFinalizer } from './style-runtime';

export { CSSResult } from './css-result';
export type { CSSResultGroup } from './css-result';

// Register through the used factory rather than a module side effect. Merely
// re-exporting css from the public barrel must not retain the CSS parser.
const createCSSResult = (text: string): CSSResult => {
  registerStyleFinalizer(finalizeStyles);
  return createResult(text);
};

/**
 * Construct component CSS. Interpolations are intentionally restricted to
 * numbers and other CSSResult values; use unsafeCSS() for reviewed raw text.
 */
export const css = (strings: TemplateStringsArray, ...values: unknown[]): CSSResult => {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === 'number') {
      text += String(value);
    } else if (value instanceof CSSResult) {
      text += value.cssText;
    } else {
      throw new Error(
        '[cossack/renderer] css`` interpolations must be numbers or CSSResult values. ' +
        'Use unsafeCSS() only for explicitly trusted raw CSS.',
      );
    }
    text += strings[i + 1];
  }
  return createCSSResult(text);
};

/** Mark a reviewed raw value as trusted CSS for interpolation into css``. */
export const unsafeCSS = (value: unknown): CSSResult => createCSSResult(String(value));
