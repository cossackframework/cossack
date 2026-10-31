import { describe, expect, it } from 'vitest';
import {
    allowedMoves, buildMenu, checkRichText, dropDepths, flattenMenu, manifestProblems, menuProblems, moveRows, normalizeMenu, richTextBlocks, richTextEmpty,
    richTextFromPlain, richTextHtml, richTextMedia, richTextParts, richTextPlain, safeLinkUrl, shiftRows, siteThemeProblems, themeProblems, validateValue, field, assembleSiteTheme, layerSiteThemes, entryTemplate, archiveTemplate, templateCandidates, entryTemplateChoices, type SiteTheme,
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
            { type: 'cmsBlock', attrs: { _id: 'b1', type: 'core/button', data: { label: 'Go', url: '/go' } } },
        ));
        expect('doc' in checked).toBe(true);
        const clean = (checked as { doc: RichTextDoc }).doc;
        expect(clean.content[0]).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] });
        expect(clean.content[1]!.content![2]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }]);
        expect(clean.content[4]!.attrs).toEqual({ src: '/media/abc/a.png', alt: 'A', mediaId: 'abc' });
        expect(richTextMedia(clean)).toEqual(['abc']);
        expect(richTextBlocks(clean)).toEqual([{ _id: 'b1', type: 'core/button', data: { label: 'Go', url: '/go' } }]);
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
        expect(error(doc({ type: 'blockquote', content: [{ type: 'cmsBlock', attrs: { _id: 'a', type: 'core/divider', data: {} } }] }))).toMatch(/cmsBlock is not allowed here/);
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
            { type: 'cmsBlock', attrs: { _id: 'b1', type: 'core/divider', data: {} } },
            { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph(text('three'))] }] },
            { type: 'image', attrs: { src: '/media/gone/a.png', alt: 'Gone', mediaId: 'gone' } },
            { type: 'image', attrs: { src: '/media/old/a.png', alt: 'Kept "it"', mediaId: 'kept' } },
        );
        const media = (id: string) => id === 'kept' ? { url: '/media/kept/new.png', width: 4, height: 3 } : null;
        expect(richTextHtml(value, { media, block: block => `<hr data-block="${block._id}">` })).toBe(
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

const noopTemplate = () => null;

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

    it('assembles a theme from template files, with the ui.ts export on top', () => {
        const layout = () => null, entry = () => null, archive = () => null, posts = () => null, override = () => null;
        expect(assembleSiteTheme({})).toBeUndefined();
        expect(assembleSiteTheme({ ui: {} })).toBeUndefined();
        expect(assembleSiteTheme({ templates: { layout: { default: layout }, entry: { default: entry }, archive: { default: archive }, 'not-found': { default: posts }, 'entry-posts': { default: posts } } }))
            .toEqual({ layout, entry, archive, notFound: posts, templates: { 'entry-posts': posts } });
        // ui.ts wins slot by slot and adds its own specific templates.
        expect(assembleSiteTheme({ ui: { theme: { entry: override, templates: { term: override } } }, templates: { layout: { default: layout }, entry: { default: entry }, 'entry-posts': { default: posts } } }))
            .toEqual({ layout, entry: override, templates: { 'entry-posts': posts, term: override } });
        // A file without a default export leaves the slot empty, which validation reports.
        expect(siteThemeProblems(assembleSiteTheme({ templates: { layout: {}, entry: { default: entry }, archive: { default: archive } } }))).toEqual(['theme.layout must be a function.']);
        expect(siteThemeProblems({ layout, entry, archive, templates: { 'entry-posts': posts, 'page-about': posts, term: 'x' } }))
            .toEqual([expect.stringMatching(/^theme\.templates\.page-about: name it/), 'theme.templates.term must be a function.']);
    });

    it('picks the most specific template for a view', () => {
        const named = (name: string) => Object.assign(() => null as never, { templateName: name });
        const theme: SiteTheme = { layout: named('layout'), entry: named('entry'), archive: named('archive'), home: named('home'),
            templates: { 'entry-posts': named('entry-posts'), 'archive-products': named('archive-products'), term: named('term'), 'term-category': named('term-category') } };
        const name = (template: unknown) => (template as { templateName: string }).templateName;
        expect(name(entryTemplate(theme, 'posts'))).toBe('entry-posts');
        expect(name(entryTemplate(theme, 'pages'))).toBe('entry');
        expect(name(archiveTemplate(theme, { kind: 'archive', collection: 'products', taxonomy: null }))).toBe('archive-products');
        expect(name(archiveTemplate(theme, { kind: 'archive', collection: 'posts', taxonomy: null }))).toBe('archive');
        expect(name(archiveTemplate(theme, { kind: 'term', collection: 'posts', taxonomy: 'category' }))).toBe('term-category');
        expect(name(archiveTemplate(theme, { kind: 'term', collection: 'posts', taxonomy: 'tag' }))).toBe('term');
        expect(name(archiveTemplate({ ...theme, templates: { 'archive-products': named('archive-products') } }, { kind: 'term', collection: 'products', taxonomy: 'tag' }))).toBe('archive-products');
        expect(name(archiveTemplate(theme, { kind: 'home', collection: 'posts', taxonomy: null }))).toBe('home');
        // No search template: the archive.
        expect(name(archiveTemplate(theme, { kind: 'search', collection: null, taxonomy: null }))).toBe('archive');
    });

    it('lists template candidates, which loaders follow too', () => {
        expect(templateCandidates({ kind: 'entry', collection: 'posts' })).toEqual(['entry-posts', 'entry']);
        expect(templateCandidates({ kind: 'entry', collection: 'pages', template: 'entry-wide' })).toEqual(['entry-wide', 'entry-pages', 'entry']);
        // Only entry templates can be chosen for an entry.
        expect(templateCandidates({ kind: 'entry', collection: 'pages', template: 'archive-posts' })).toEqual(['entry-pages', 'entry']);
        expect(templateCandidates({ kind: 'entry', collection: 'my_things' })).toEqual(['entry-my_things', 'entry']);
        expect(templateCandidates({ kind: 'term', collection: 'posts', taxonomy: 'tags' })).toEqual(['term-tags', 'term', 'archive-posts', 'archive']);
        expect(templateCandidates({ kind: 'home', collection: 'posts', taxonomy: null })).toEqual(['home', 'archive-posts', 'archive']);
        expect(templateCandidates({ kind: 'search', collection: null, taxonomy: null })).toEqual(['search', 'archive']);
        expect(templateCandidates({ kind: 'not-found' })).toEqual(['not-found']);
    });

    it('uses a chosen entry template, and falls back when the theme lacks it', () => {
        const named = (name: string) => Object.assign(() => null as never, { templateName: name });
        const theme: SiteTheme = { layout: named('layout'), entry: named('entry'), archive: named('archive'), templates: { 'entry-wide': named('entry-wide'), 'entry-posts': named('entry-posts'), term: named('term') } };
        const name = (template: unknown) => (template as { templateName: string }).templateName;
        expect(name(entryTemplate(theme, 'pages', 'entry-wide'))).toBe('entry-wide');
        expect(name(entryTemplate(theme, 'posts', 'entry-gone'))).toBe('entry-posts');
        expect(name(entryTemplate(theme, 'pages', 'entry-gone'))).toBe('entry');
        expect(entryTemplateChoices(theme)).toEqual(['entry-posts', 'entry-wide']);
        expect(entryTemplateChoices(undefined)).toEqual([]);
    });

    it('layers a child theme over its parent, slot by slot', () => {
        const parent = { layout: () => 1, entry: () => 2, archive: () => 3, templates: { term: () => 4 }, blocks: { 'x/a': () => 5 } };
        const child = { entry: () => 6, templates: { 'entry-wide': () => 7 }, blocks: { 'x/b': () => 8 } };
        const layered = layerSiteThemes(parent, child) as Record<string, unknown>;
        expect(layered.layout).toBe(parent.layout);
        expect(layered.entry).toBe(child.entry);
        expect(Object.keys(layered.templates as object)).toEqual(['term', 'entry-wide']);
        expect(Object.keys(layered.blocks as object)).toEqual(['x/a', 'x/b']);
        expect(layerSiteThemes(undefined, child)).toBe(child);
        expect(layerSiteThemes(parent, undefined)).toBe(parent);
        // Assembled from files, the parent's first.
        const files = (stems: string[]) => Object.fromEntries(stems.map(stem => [stem, { default: () => stem }]));
        expect(Object.keys(assembleSiteTheme({ templates: files(['entry']) }, { templates: files(['layout', 'entry', 'archive']) }) as object)).toEqual(['layout', 'entry', 'archive']);
        expect(themeProblems({ label: 'X', extends: 'Bad Name', areas: { Side: '' } })).toEqual(['theme.extends must name a theme plugin.', expect.stringMatching(/theme.areas: Side must be/), expect.stringMatching(/theme.areas.Side needs a label/)]);
    });

    it('takes the head template from templates/head.ts', () => {
        const head = () => ({ links: [] });
        expect(assembleSiteTheme({ templates: { head: { default: head } } })).toEqual({ head });
        expect(siteThemeProblems({ layout: noopTemplate, entry: noopTemplate, archive: noopTemplate, head: 'x' })).toEqual(['theme.head must be a function.']);
    });

    it('checks the assembled theme', () => {
        const noop = () => null;
        expect(siteThemeProblems({ layout: noop, entry: noop, archive: noop })).toEqual([]);
        expect(siteThemeProblems({ layout: noop })).toEqual(['theme.entry must be a function.', 'theme.archive must be a function.']);
        expect(siteThemeProblems(undefined)).toEqual([expect.stringMatching(/no templates/)]);
    });
});
