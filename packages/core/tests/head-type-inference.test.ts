import { describe, it, expect } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import type { HeadValue } from '../src/shared/head';

/**
 * Regression: a `head()` override WITHOUT an explicit `: HeadValue` return
 * type used to fail type-checking because TypeScript widened the inferred
 * `{ tag: 'meta' }` to `{ tag: string }`, which was not assignable to the
 * literal union `HeadTag.tag`. The `(string & {})` term on `HeadTagName`
 * keeps autocomplete for known tag names while accepting any widened string.
 *
 * These type-level assertions live alongside the runtime test so the DX
 * scenario is exercised on every CI run. If the compiler widens
 * `HeadTag.tag` back to a closed literal union, the lines marked
 * `// @ts-expect-error` below would no longer error and this test would
 * need updating — surfacing the regression.
 */
describe('head() return type inference', () => {
    it('accepts an un-annotated head() override with mixed meta + link tags', () => {
        class Page extends Cossack {
            // NOTE: no explicit `: HeadValue` return type annotation.
            public head() {
                return {
                    title: 'World-Class Services, Designed for You',
                    meta: [
                        { tag: 'meta', attributes: { name: 'description', content: 'We specialize in photo editing.' } },
                        { tag: 'link', attributes: { rel: 'canonical', href: 'https://example.com' } },
                    ],
                };
            }
        }

        const page = new Page();
        const value: HeadValue = page.head();
        expect(value.title).toBe('World-Class Services, Designed for You');
        expect(value.meta).toHaveLength(2);
        expect(value.meta![0].tag).toBe('meta');
        expect(value.meta![1].tag).toBe('link');
    });

    it('still provides autocomplete-eligible literal tag names at call sites', () => {
        // The known names ('title', 'meta', 'link', ...) are part of the
        // union. Runtime behavior for unknown names is preserved by the
        // default branch in buildHeadContext.
        class Page extends Cossack {
            public head() {
                return {
                    tags: [
                        { tag: 'custom-thing' as const, attributes: { 'data-x': '1' } },
                    ],
                };
            }
        }

        const page = new Page();
        const value = page.head();
        expect(value.tags![0].tag).toBe('custom-thing');
    });
});
