import { describe, expect, it } from 'vitest';
import { normalizeRichText, richTextHtml, richTextMarkdown, richTextPlain, type RichTextDoc } from '../src/index';

const cell = (text: string, type: 'tableCell' | 'tableHeader' = 'tableCell', attrs?: Record<string, unknown>) => ({ type, ...(attrs ? { attrs } : {}), content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const table: RichTextDoc = { type: 'doc', content: [{ type: 'table', content: [
    { type: 'tableRow', content: [cell('Name', 'tableHeader'), cell('Size', 'tableHeader', { colspan: 1, colwidth: [120] })] },
    { type: 'tableRow', content: [cell('Alpha'), cell('1 | 2', 'tableCell', { rowspan: 2 })] },
] }] };

describe('rich text tables', () => {
    it('keeps tables, rows and cells with their spans and drops what does not belong', () => {
        const clean = normalizeRichText(table);
        const rows = clean.content[0]!.content!;
        expect(rows).toHaveLength(2);
        expect(rows[0]!.content![1]!.attrs).toEqual({ colspan: 1, colwidth: [120] });
        expect(rows[1]!.content![1]!.attrs).toEqual({ rowspan: 2 });
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'table', content: [{ type: 'paragraph' }] }] })).toThrow(/not allowed/);
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'tableRow', content: [cell('x')] }] })).toThrow(/not allowed/);
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'table', content: [] }] })).toThrow(/must not be empty/);
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell('x', 'tableCell', { colspan: 500 })] }] }] })).toThrow(/colspan/);
    });

    it('renders a table and writes it as Markdown', () => {
        const html = richTextHtml(table);
        expect(html).toBe('<div class="cms-table"><table><tr><th><p>Name</p></th><th><p>Size</p></th></tr><tr><td><p>Alpha</p></td><td rowspan="2"><p>1 | 2</p></td></tr></table></div>');
        expect(richTextMarkdown(table)).toBe('| Name | Size |\n| --- | --- |\n| Alpha | 1 \\| 2 |');
        expect(richTextPlain(table)).toBe('Name\n\nSize\n\nAlpha\n\n1 | 2');
    });

    it('highlights code blocks and keeps the language class', () => {
        const doc: RichTextDoc = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'return 1 // one' }] }] };
        expect(richTextHtml(doc)).toBe('<pre class="cms-code"><code class="language-js"><span class="tok-k">return</span> <span class="tok-n">1</span> <span class="tok-c">// one</span></code></pre>');
    });
});
