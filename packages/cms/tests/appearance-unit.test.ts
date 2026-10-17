import { describe, expect, it } from 'vitest';
import {
    allowedMoves, buildMenu, checkRichText, dropDepths, flattenMenu, manifestProblems, menuProblems, moveRows, normalizeMenu, richTextBlocks, richTextEmpty,
    richTextFromPlain, richTextHtml, richTextMedia, richTextParts, richTextPlain, safeLinkUrl, shiftRows, siteThemeProblems, themeProblems, validateValue, field,
    type MenuItem, type MenuRow, type RichTextDoc,
} from '../src/index';
import { collectionSpec } from '../src/server/schema';
import { resolveResource } from '../src/resource';

const doc = (...content: unknown[]) => ({ type: 'doc', content }) as RichTextDoc;
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });

describe('rich text', () => {
    it('accepts TipTap documents and keeps only known attributes', () => {
        const checked = checkRichText(doc(
            { type: 'heading', attrs: { level: 2, textAlign: null, id: 'x' }, content: [text('Title')] },
            { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('Bold', [{ type: 'bold' }]), { type: 'hardBreak' }, text('link', [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'x', class: null } }])] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('one'))] }] },
            { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('let a = 1;')] },
            { type: 'image', attrs: { src: '/media/abc/a.png', alt: 'A', mediaId: 'abc', width: 10 } },
            { type: 'cmsBlock', attrs: { id: 'b1', type: 'core/button', data: { label: 'Go', url: '/go' } } },
        ));
        expect('doc' in checked).toBe(true);
        const clean = (checked as { doc: RichTextDoc }).doc;
        expect(clean.content[0]).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] });
        expect(clean.content[1]!.content![2]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }]);
        expect(clean.content[4]!.attrs).toEqual({ src: '/media/abc/a.png', alt: 'A', mediaId: 'abc' });
        expect(richTextMedia(clean)).toEqual(['abc']);
        expect(richTextBlocks(clean)).toEqual([{ id: 'b1', type: 'core/button', data: { label: 'Go', url: '/go' } }]);
        expect(validateValue('body', field.richText(), clean)).toBeUndefined();
    });

    it('rejects unknown nodes, unsafe URLs and misplaced blocks', () => {
        const error = (value: unknown) => 'error' in checkRichText(value) ? (checkRichText(value) as { error: string }).error : undefined;
        expect(error('<p>html</p>')).toMatch(/rich text document/);
        expect(error(doc({ type: 'script', content: [] }))).toMatch(/script is not allowed/);
        expect(error(doc(paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))))).toMatch(/href is not valid/);
        expect(error(doc(paragraph(text('x', [{ type: 'link', attrs: { href: '//evil.example' } }]))))).toMatch(/href is not valid/);
        expect(error(doc({ type: 'image', attrs: { src: 'http://example.com/a.png' } }))).toMatch(/src is not valid/);
        expect(error(doc({ type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } }))).toMatch(/src is not valid/);
        expect(error(doc({ type: 'blockquote', content: [{ type: 'cmsBlock', attrs: { id: 'a', type: 'core/divider', data: {} } }] }))).toMatch(/cmsBlock is not allowed here/);
        expect(error(doc(paragraph(text('x', [{ type: 'bold' }, { type: 'bold' }]))))).toMatch(/repeats bold/);
        expect(error(doc({ type: 'codeBlock', content: [text('x', [{ type: 'bold' }])] }))).toMatch(/plain text/);
        expect(error(doc({ type: 'bulletList', content: [] }))).toMatch(/must not be empty/);
        let deep: unknown = paragraph(text('x'));
        for (let level = 0; level < 30; level++) deep = { type: 'blockquote', content: [deep] };
        expect(error(doc(deep))).toMatch(/nests deeper/);
        expect(safeLinkUrl('mailto:a@example.com')).toBe(true);
        expect(safeLinkUrl('/about#team')).toBe(true);
        expect(safeLinkUrl('https://exa mple.com')).toBe(false);
    });

    it('renders escaped HTML, plain text and parts split at blocks', () => {
        const value = doc(
            paragraph(text('<script>alert("x")</script> & '), text('bold', [{ type: 'bold' }, { type: 'link', attrs: { href: '/a"b' } }])),
            { type: 'cmsBlock', attrs: { id: 'b1', type: 'core/divider', data: {} } },
            { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph(text('three'))] }] },
            { type: 'image', attrs: { src: '/media/gone/a.png', alt: 'Gone', mediaId: 'gone' } },
            { type: 'image', attrs: { src: '/media/old/a.png', alt: 'Kept "it"', mediaId: 'kept' } },
        );
        const media = (id: string) => id === 'kept' ? { url: '/media/kept/new.png', width: 4, height: 3 } : null;
        expect(richTextHtml(value, { media, block: block => `<hr data-block="${block.id}">` })).toBe(
            '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; <a href="/a&quot;b"><strong>bold</strong></a></p><hr data-block="b1"><ol start="3"><li><p>three</p></li></ol>'
            + '<img src="/media/kept/new.png" alt="Kept &quot;it&quot;" width="4" height="3" loading="lazy" decoding="async">');
        const parts = richTextParts(value, { media });
        expect(parts.map(part => part.kind)).toEqual(['html', 'block', 'html']);
        expect(richTextPlain(value)).toBe('<script>alert("x")</script> & bold\n\nthree\n\nGone\n\nKept "it"');
        expect(richTextEmpty(doc(paragraph()))).toBe(true);
        expect(richTextFromPlain('One\nline\n\n\nTwo')).toEqual(doc(paragraph(text('One'), { type: 'hardBreak' }, text('line')), paragraph(text('Two'))));
        expect(checkRichText(richTextFromPlain('a\n\nb'))).toHaveProperty('doc');
        expect(richTextEmpty(doc({ type: 'horizontalRule' }))).toBe(false);
    });

    it('indexes the plain text of searchable rich text', () => {
        const resource = resolveResource({ name: 'notes', fields: { title: field.string({ search: true }), body: field.richText({ search: true }) } });
        const spec = collectionSpec(resource, () => 'x');
        expect(spec.indexes.find(index => index.kind === 'fulltext')?.paths).toEqual(['title', '_text_body']);
        expect(spec.fields.find(entry => entry.name === 'body')).toMatchObject({ type: 'object', flexible: true });
        expect(spec.fields.find(entry => entry.name === '_text_body')).toMatchObject({ type: 'string', nullable: true });
    });
});

const item = (id: string, children: MenuItem[] = [], extra: Partial<MenuItem> = {}): MenuItem => ({ id, kind: 'link', label: id.toUpperCase(), url: `/${id}`, children, ...extra });
const ids = (rows: readonly MenuRow[]) => rows.map(row => `${row.id}${row.depth}`).join(' ');

describe('menus', () => {
    const tree = [item('a', [item('b', [item('c')]), item('d')]), item('e')];

    it('validates items, kinds and limits', () => {
        expect(menuProblems(tree)).toEqual([]);
        expect(menuProblems([item('a'), item('a')])).toEqual([expect.stringMatching(/distinct ID/)]);
        expect(menuProblems([item('x', [], { url: 'javascript:alert(1)' })])).toEqual([expect.stringMatching(/URL must start/)]);
        expect(menuProblems([{ id: 'p', kind: 'entry', label: '', collection: 'pages', children: [] }])).toEqual([expect.stringMatching(/needs an entry/)]);
        let deep = item('l5');
        for (let level = 4; level >= 0; level--) deep = item(`l${level}`, [deep]);
        expect(menuProblems([deep]).join(' ')).toMatch(/5 levels/);
        expect(menuProblems(Array.from({ length: 301 }, (_, index) => item(`i${index}`)))).toEqual([expect.stringMatching(/at most 300/)]);
        expect(normalizeMenu([{ ...item('n'), kind: 'term', taxonomy: 'tags', term: 't1', url: '/ignored', newTab: false }])).toEqual([{ id: 'n', kind: 'term', label: 'N', taxonomy: 'tags', term: 't1', children: [] }]);
    });

    it('flattens and rebuilds the tree', () => {
        const rows = flattenMenu(tree);
        expect(ids(rows)).toBe('a0 b1 c2 d1 e0');
        expect(buildMenu(rows)).toEqual(tree);
    });

    it('moves a subtree with the depths that fit the drop position', () => {
        const rows = flattenMenu(tree);
        // b (with c) before e: no shallower than e, at most one deeper than d.
        expect(dropDepths(rows, 1, 2)).toEqual({ min: 0, max: 2 });
        expect(ids(moveRows(rows, 1, 2, 0))).toBe('a0 d1 b0 c1 e0');
        expect(ids(moveRows(rows, 1, 2, 2))).toBe('a0 d1 b2 c3 e0');
        // Between a and its child d, b stays a child: it cannot adopt d.
        expect(ids(moveRows(rows, 1, 1, 0))).toBe('a0 b1 c2 d1 e0');
        // e to the top.
        expect(ids(moveRows(rows, 4, 0, 3))).toBe('e0 a0 b1 c2 d1');
    });

    it('applies the move buttons', () => {
        const rows = flattenMenu(tree);
        expect(ids(shiftRows(rows, 3, 'up'))).toBe('a0 d1 b1 c2 e0');
        expect(ids(shiftRows(rows, 1, 'down'))).toBe('a0 d1 b1 c2 e0');
        expect(ids(shiftRows(rows, 3, 'in'))).toBe('a0 b1 c2 d2 e0');
        expect(ids(shiftRows(rows, 2, 'out'))).toBe('a0 b1 c1 d1 e0');
        expect(ids(shiftRows(rows, 1, 'out'))).toBe('a0 d1 b0 c1 e0');
        expect(ids(shiftRows(rows, 4, 'up'))).toBe('e0 a0 b1 c2 d1');
        expect(shiftRows(rows, 0, 'up')).toBe(rows);
        expect([...allowedMoves(rows, 0)]).toEqual(['down']);
        expect([...allowedMoves(rows, 2)]).toEqual(['out']);
    });
});

describe('themes', () => {
    const manifest = (theme: unknown) => ({ schemaVersion: 1, name: 'paper', version: '1.0.0', theme });

    it('validates the manifest theme field', () => {
        expect(manifestProblems(manifest({ label: 'Paper', locations: { primary: 'Primary menu' }, options: { accent: { kind: 'enum', values: ['blue', 'rose'], default: 'blue' } } }))).toEqual([]);
        expect(themeProblems({ label: '', locations: { Primary: 'x' } })).toEqual([expect.stringMatching(/label/), expect.stringMatching(/lowercase/)]);
        expect(manifestProblems({ ...manifest({ label: 'Paper' }), logo: 'assets/logo.svg', cover: 'assets/cover.webp' })).toEqual([]);
        expect(manifestProblems({ ...manifest({ label: 'Paper' }), logo: '../secret.png', cover: 'assets/cover.html' })).toEqual([expect.stringMatching(/^logo must name/), expect.stringMatching(/^cover must name/)]);
        expect(themeProblems({ label: 'X', options: { logo: { kind: 'string', media: true } } })).toEqual([expect.stringMatching(/cannot be indexed/)]);
        expect(themeProblems({ label: 'X', options: { data: { kind: 'json' } } })).toEqual([expect.stringMatching(/must be a string/)]);
    });

    it('checks the ui.ts theme export', () => {
        const noop = () => null;
        expect(siteThemeProblems({ layout: noop, entry: noop, archive: noop })).toEqual([]);
        expect(siteThemeProblems({ layout: noop })).toEqual(['theme.entry must be a function.', 'theme.archive must be a function.']);
        expect(siteThemeProblems(undefined)).toEqual(['ui.ts must export theme.']);
    });
});
