import { describe, expect, it } from 'vitest';
import { escapeHtml, html, renderToString } from './cossack-html';

// The original five chained replaces; the single-pass version must match it.
const reference = (unsafe: unknown): string => String(unsafe)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

describe('escapeHtml', () => {
  it('matches the chained replacements for every special character and non-string', () => {
    const inputs: unknown[] = [
      '', 'plain text', '&', '&&', '&amp;', '&lt;', '<script>alert("x")</script>', `it's "quoted"`,
      'a&b<c>d"e\'f', '<<>>""\'\'', 'é & \u{1F600} <', 0, 42, true, false, null, undefined,
      ['a<b', 'c&d'], { toString: () => '<obj attr="1">' },
    ];
    for (const input of inputs) expect(escapeHtml(input)).toBe(reference(input));
  });

  it('returns the same string when nothing needs escaping', () => {
    const value = 'Row 1234 label';
    expect(escapeHtml(value)).toBe(value);
  });

  it('escapes SSR text and attribute values', () => {
    const value = `<a href="x">Tom & 'Jerry'</a>`;
    expect(renderToString(html`<p title=${value}>${value}</p>`))
      .toBe(`<p title="${reference(value)}">${reference(value)}</p>`);
  });
});
