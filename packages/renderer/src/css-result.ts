const CSS_RESULT_TOKEN = Symbol('cossack-css-result');

/** A safely constructed block of component CSS. */
export class CSSResult {
  readonly cssText: string;

  /** @internal Use css`` or unsafeCSS() instead. */
  constructor(cssText: string, token: symbol) {
    if (token !== CSS_RESULT_TOKEN) {
      throw new Error('[cossack/renderer] CSSResult cannot be constructed directly. Use css`` or unsafeCSS().');
    }
    this.cssText = cssText;
  }

  toString(): string {
    return this.cssText;
  }
}

export type CSSResultGroup = CSSResult | readonly CSSResultGroup[];

export const createCSSResult = (text: string): CSSResult => new CSSResult(text, CSS_RESULT_TOKEN);

