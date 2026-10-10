import { describe, expect, it } from 'vitest';
import { CossackElement } from './cossack-element';
import { getFinalizedStyles } from './style-runtime';
import type { CSSResultGroup } from './css-result';

describe('component styles without the CSS feature', () => {
  it('accepts empty and inherited nested style arrays without constructing CSS', () => {
    class Empty extends CossackElement { static styles: CSSResultGroup = []; }
    class Nested extends Empty { static styles = [Empty.styles, [[], []]]; }
    expect(getFinalizedStyles(Empty)).toEqual({ cssText: '', scopeId: 'cztntfp' });
    expect(getFinalizedStyles(Nested)).toEqual(getFinalizedStyles(Empty));
  });

  it('reads and caches an absent static getter once', () => {
    let reads = 0;
    class Unstyled extends CossackElement {
      static get styles(): undefined { reads++; return undefined; }
    }
    expect(getFinalizedStyles(Unstyled)).toBeNull();
    expect(getFinalizedStyles(Unstyled)).toBeNull();
    expect(reads).toBe(1);
  });

  it('rejects raw CSS without registering the parser', () => {
    class Invalid extends CossackElement { static styles = ['button { color: red; }'] as unknown as CSSResultGroup; }
    expect(() => getFinalizedStyles(Invalid)).toThrow(/static styles/);
  });
});
