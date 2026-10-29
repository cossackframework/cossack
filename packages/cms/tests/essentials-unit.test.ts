import { describe, expect, it } from 'vitest';
import {
    blockAllowedIn, blockCategory, blockMedia, blockProblems, blocksShapeProblem, blockStyleAttributes, blockSupports, blockTreeProblem, checkComment, collectionProblems, collectionResource, compareRecords, contentBlocks, extendCollection, CORE_BLOCKS, customCssProblem, DEFAULT_PRESETS, diffWords,
    field, findBlock, flattenBlocks, imageEditsProblems, imageSrcset, imageUrl, insertBlock, languageName, layerPresets, moveBlock, placeBlocks, posts, presetOverridesProblem, presetProblems, presetStyle, redirectPath, redirectProblems, removeBlock,
    normalizeRichText, resolvePresets, richTextBlocks, shiftBlock, themeProblems, validateBlocks, validateValue, variantRect, variantWidth, webhookUrlProblem, BLOCK_CATEGORIES, FORM_BLOCKS, type Block,
} from '../src/index';
import { negotiateFormat } from '../src/server/images';

describe('essentials helpers', () => {
    it('diffs words and keeps layout', () => {
        expect(diffWords('one two three', 'one 2 three four')).toEqual([
            { kind: 'same', text: 'one ' }, { kind: 'removed', text: 'two' }, { kind: 'added', text: '2' }, { kind: 'same', text: ' three' }, { kind: 'added', text: ' four' },
        ]);
        expect(diffWords('', '')).toEqual([]);
        // Too many tokens are reported as replaced.
        expect(diffWords('a b c', 'x y z', 3)).toEqual([{ kind: 'removed', text: 'a b c' }, { kind: 'added', text: 'x y z' }]);
        const base = { id: 's', rev: 1, createdAt: 0, updatedAt: 0, owner: null };
        const settings = compareRecords({ settings: field.json({ label: 'Settings' }), note: field.text({ label: 'Note' }) }, { ...base, settings: { a: 1 }, note: 'x' }, { ...base, rev: 2, settings: { a: 2 }, note: 'y' });
        expect(settings.map(change => [change.name, change.kind, change.structured])).toEqual([['settings', 'text', true], ['note', 'text', false]]);
        expect(settings[0]!.after).toBe('{\n  "a": 2\n}');
        const changes = compareRecords({ title: field.string({ label: 'Title' }), sticky: field.boolean({ label: 'Sticky' }), body: field.richText({ label: 'Body' }) },
            { id: 'a', rev: 1, createdAt: 0, updatedAt: 0, owner: null, title: 'Old', sticky: false, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }] } },
            { id: 'a', rev: 2, createdAt: 0, updatedAt: 0, owner: null, title: 'New', sticky: true, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }] } });
        expect(changes.map(change => [change.name, change.kind, change.before, change.after])).toEqual([['title', 'text', 'Old', 'New'], ['sticky', 'value', 'No', 'Yes']]);
    });

    it('searches blocks by keyword and offers common blocks everywhere', () => {
        const richText = CORE_BLOCKS.find(block => block.name === 'core/richtext')!;
        expect(richText.keywords).toContain('wysiwyg');
        expect(richText.common).toBe(true);
        expect(CORE_BLOCKS.filter(block => block.common).map(block => block.name)).toEqual(['core/richtext', 'core/paragraph', 'core/heading', 'core/image', 'core/divider']);
        expect(FORM_BLOCKS.find(block => block.name === 'form/email')!.keywords).toContain('mail');
        // Input and field blocks keep to their own places, each under a label of its own that says where its values live.
        expect(blockProblems({ name: 'acme/thing', label: 'Thing', keywords: ['a'], common: true, fields: {} })).toEqual([]);
        expect(blockProblems({ name: 'acme/thing', label: 'Thing', keywords: [''], common: 'yes' as never, fields: {} })).toEqual([expect.stringContaining('keywords'), expect.stringContaining('common is on or off')]);
        expect(blockProblems({ name: 'acme/thing', label: 'Thing', common: true, input: { kind: 'string' }, fields: { name: field.string(), label: field.string() } })).toEqual([expect.stringContaining('cannot be common')]);
        expect(BLOCK_CATEGORIES.filter(category => category.description).map(category => [category.id, category.label])).toEqual([['form', 'Form inputs'], ['field', 'Entry fields'], ['data', 'Data']]);
        expect(new Set(BLOCK_CATEGORIES.map(category => category.label)).size).toBe(BLOCK_CATEGORIES.length);
        // A common block passes a field group's check; another non-field block does not.
        const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
        expect(validateBlocks([{ _id: 'h', type: 'core/heading', data: { text: 'Section', level: 'h2' } }], types, { fieldGroup: true }).errors).toEqual({});
        expect(Object.keys(validateBlocks([{ _id: 'q', type: 'core/quote', data: { text: 'No' } }], types, { fieldGroup: true }).errors)).toEqual(['q']);
    });

    it('adds a password field for a protected collection', () => {
        const resource = collectionResource({ name: 'docs', label: 'Docs', singular: 'Doc', fields: {}, features: { content: true, password: true } });
        expect(resource.fields.password).toMatchObject({ kind: 'string', max: 100, placement: 'sidebar' });
        expect(collectionResource({ name: 'docs', label: 'Docs', singular: 'Doc', fields: {} }).fields.password).toBeUndefined();
        expect(collectionProblems({ name: 'docs', label: 'Docs', singular: 'Doc', fields: {}, features: { password: 'yes' as never } })).toEqual([expect.stringContaining('Features are content, excerpt, featuredImage, revisions, password')]);
    });

    it('validates group fields and field order', () => {
        const seo = field.group({ title: field.string({ max: 5 }), noindex: field.boolean() });
        expect(validateValue('seo', seo, { title: 'Short', noindex: true })).toBeUndefined();
        expect(validateValue('seo', seo, { title: null })).toBeUndefined();
        expect(validateValue('seo', seo, { title: 'Too long' })).toContain('at most 5');
        expect(validateValue('seo', seo, { other: 1 })).toBe('has no subfield other.');
        expect(collectionProblems({ ...posts, fieldOrder: ['Not valid'] })).toContain('The field order names at most 64 fields.');
        expect(collectionProblems({ ...posts, comments: 'yes' as never })).toContain('Comments are on or off.');
        expect(collectionProblems({ ...posts, managed: 'yes' as never })).toContain('Managed is on or off.');
        // Blank text does not fill a required field.
        expect(validateValue('title', field.string({ required: true }), '   ')).toBe('is required.');
        expect(validateValue('title', field.string({ required: true }), 'Hello')).toBeUndefined();
        expect(validateValue('note', field.string(), '')).toBeUndefined();
    });

    it('turns features into fixed fields and keeps their names reserved', () => {
        const base = { name: 'products', label: 'Products', singular: 'Product', fields: {} };
        expect(Object.keys(collectionResource({ ...base }).fields)).not.toEqual(expect.arrayContaining(['content', 'excerpt', 'featuredImage']));
        const resource = collectionResource({ ...base, features: { content: { blocks: ['core/paragraph'] }, excerpt: true, featuredImage: true, revisions: false } });
        expect(Object.keys(resource.fields).slice(0, 4)).toEqual(['title', 'slug', 'content', 'excerpt']);
        expect(resource.fields.content).toMatchObject({ kind: 'blocks', search: true, blocks: ['core/paragraph'] });
        expect(resource.fields.featuredImage).toMatchObject({ kind: 'string', media: true, placement: 'sidebar' });
        expect(resource.revisions).toBe(false);
        expect(collectionResource(posts).revisions).toBe(true);
        expect(contentBlocks(true)).toEqual([]);
        expect(contentBlocks({ blocks: ['a'] })).toEqual(['a']);
        expect(contentBlocks(false)).toBeNull();
        expect(contentBlocks({ blocks: [1] } as never)).toBeNull();
        expect(collectionProblems({ ...base, fields: { content: field.blocks() } })).toContain('content is a feature; turn it on instead of declaring it.');
        expect(collectionProblems({ ...base, features: { sticky: true } as never })).toContain('Features are content, excerpt, featuredImage, revisions, password, each on or off.');
        expect(collectionProblems({ ...base, template: [{ _id: 'a', type: 'core/richtext', data: {} }] })).toContain('The content template needs the content feature.');
        expect(collectionProblems({ ...base, features: { content: true }, template: [{ _id: 'a', type: 'core/richtext', data: {} }] })).toEqual([]);
        // A built-in collection's features stay on; stored ones add to them.
        expect(extendCollection(posts, { features: { excerpt: false, revisions: false } }).features).toEqual({ content: true, excerpt: true, featuredImage: true, password: true, revisions: false });
    });

    it('names languages and groups blocks', () => {
        expect(languageName('fr')).toBe('Français');
        expect(languageName('not a code')).toBe('not a code');
        expect(CORE_BLOCKS.every(block => block.icon && block.category)).toBe(true);
        expect(blockCategory({})).toBe('widgets');
        const block = { name: 'acme/card', label: 'Card', fields: {} };
        expect(blockProblems({ ...block, icon: 'star', category: 'design' })).toEqual([]);
        expect(blockProblems({ ...block, icon: 'Not An Icon' })).toHaveLength(1);
        expect(blockProblems({ ...block, category: 'layout' as never })).toEqual(['block acme/card: the category is one of text, media, design, widgets, embeds, form, field, data.']);
    });

    it('nests blocks in containers', () => {
        const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, children: { allowed: ['core/paragraph'], max: 3 }, parent: ['core/group'] })).toEqual([]);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, children: { max: 0 } })).toEqual(['block acme/box: children.max is 1 to 200.']);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, parent: [] })).toEqual(['block acme/box: parent lists block names.']);
        const columns: Block = { _id: 'cols', type: 'core/columns', data: {}, children: [
            { _id: 'a', type: 'core/column', data: { span: 4 }, children: [{ _id: 'h', type: 'core/heading', data: { text: 'Left' } }] },
            { _id: 'b', type: 'core/column', data: {}, layout: { hide: ['sm', 'sm'] }, children: [] },
        ] };
        const checked = validateBlocks([columns], types);
        expect(checked.errors).toEqual({});
        expect(checked.blocks[0]).toEqual({ _id: 'cols', type: 'core/columns', data: { gap: 'medium', stack: 'mobile' }, children: [
            { _id: 'a', type: 'core/column', data: { span: 4, verticalAlign: 'top' }, children: [{ _id: 'h', type: 'core/heading', data: { text: 'Left', level: 'h2' } }] },
            { _id: 'b', type: 'core/column', data: { verticalAlign: 'top' }, layout: { hide: ['sm'] }, children: [] },
        ] });
        // A column goes only inside columns, columns hold only columns, a leaf holds nothing.
        expect(validateBlocks([{ _id: 'c', type: 'core/column', data: {} }], types).errors).toEqual({ c: 'core/column goes inside core/columns.' });
        expect(validateBlocks([{ _id: 'cols', type: 'core/columns', data: {}, children: [{ _id: 'p', type: 'core/paragraph', data: { text: 'x' } }] }], types).errors).toEqual({ p: 'core/paragraph cannot go inside core/columns.' });
        expect(validateBlocks([{ _id: 'p', type: 'core/paragraph', data: { text: 'x' }, children: [{ _id: 'q', type: 'core/divider', data: {} }] }], types).errors).toEqual({ p: 'core/paragraph does not hold blocks.' });
        expect(validateBlocks([{ _id: 'cols', type: 'core/columns', data: {}, children: Array.from({ length: 7 }, (_, index) => ({ _id: `c${index}`, type: 'core/column', data: {} })) }], types).errors).toEqual({ cols: 'holds at most 6 blocks.' });
        // A field's allowed list applies at the top level; the containers' rules below it.
        expect(validateBlocks([{ _id: 'g', type: 'core/group', data: {}, children: [{ _id: 'q', type: 'core/quote', data: { text: 'q' } }] }], types, { allowed: ['core/group'] }).errors).toEqual({});
        expect(validateBlocks([{ _id: 'q', type: 'core/quote', data: { text: 'q' } }], types, { allowed: ['core/group'] }).errors).toEqual({ q: 'core/quote is not an available block.' });
        // The shape: distinct IDs across the tree, the depth and count limits, the layout.
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/group', data: {}, children: [{ _id: 'a', type: 'core/divider', data: {} }] }])).toBe('blocks need distinct IDs.');
        const deep = (depth: number): Block => depth ? { _id: `d${depth}`, type: 'core/group', data: {}, children: [deep(depth - 1)] } : { _id: 'leaf', type: 'core/divider', data: {} };
        expect(blocksShapeProblem([deep(3)])).toBeUndefined();
        expect(blocksShapeProblem([deep(4)])).toBe('blocks nest at most 4 deep.');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, layout: { hide: ['xl'] } }])).toBe('block layout.hide lists sm, md, lg.');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/group', data: {}, children: 'no' }])).toBe('block children must be a list of blocks.');
        expect(blockMedia([{ _id: 'g', type: 'core/group', data: {}, children: [{ _id: 'i', type: 'core/image', data: { image: 'file-1' } }] }], types)).toEqual(['file-1']);
        // The tree helpers editors use.
        const tree: Block[] = [columns, { _id: 'p', type: 'core/paragraph', data: { text: 'After' } }];
        expect(flattenBlocks(tree).map(block => block._id)).toEqual(['cols', 'a', 'h', 'b', 'p']);
        expect(placeBlocks(tree).map(place => [place.block._id, place.depth, place.parent, place.index])).toEqual([['cols', 0, null, 0], ['a', 1, 'cols', 0], ['h', 2, 'a', 0], ['b', 1, 'cols', 1], ['p', 0, null, 1]]);
        expect(findBlock(tree, 'h')?.data).toEqual({ text: 'Left' });
        expect(findBlock(moveBlock(tree, 'p', 'b', 0), 'b')?.children?.map(block => block._id)).toEqual(['p']);
        expect(moveBlock(tree, 'cols', 'a', 0)).toEqual(tree);
        expect(flattenBlocks(removeBlock(tree, 'a')).map(block => block._id)).toEqual(['cols', 'b', 'p']);
        expect(flattenBlocks(insertBlock(tree, 'b', { _id: 'n', type: 'core/divider', data: {} })).map(block => block._id)).toEqual(['cols', 'a', 'h', 'b', 'n', 'p']);
        // Moves: in goes under the sibling above when the types allow it, out follows the container.
        expect(shiftBlock(tree, 'p', 'in', types)).toBe(tree);
        const grouped: Block[] = [{ _id: 'g', type: 'core/group', data: {}, children: [] }, { _id: 'p', type: 'core/paragraph', data: { text: 'x' } }];
        const inside = shiftBlock(grouped, 'p', 'in', types);
        expect(placeBlocks(inside).map(place => [place.block._id, place.parent])).toEqual([['g', null], ['p', 'g']]);
        expect(placeBlocks(shiftBlock(inside, 'p', 'out', types)).map(place => place.parent)).toEqual([null, null]);
        expect(shiftBlock(tree, 'h', 'up', types)).toBe(tree);
        expect(flattenBlocks(shiftBlock(tree, 'b', 'up', types)).map(block => block._id)).toEqual(['cols', 'b', 'a', 'h', 'p']);
        expect(blockTreeProblem([{ _id: 'c', type: 'core/column', data: {} }], types)).toBe('Column goes inside Columns.');
        expect(blockTreeProblem(tree, types)).toBeUndefined();
        expect(blockAllowedIn(types, 'core/column', 'core/columns')).toBe(true);
        expect(blockAllowedIn(types, 'core/group', 'core/columns')).toBe(false);
        // A body embeds a container with its children.
        const doc = normalizeRichText({ type: 'doc', content: [{ type: 'cmsBlock', attrs: { _id: 'cols', type: 'core/columns', data: {}, children: columns.children, layout: { hide: ['lg'] } } }] });
        expect(richTextBlocks(doc)[0]).toMatchObject({ _id: 'cols', layout: { hide: ['lg'] }, children: [{ _id: 'a' }, { _id: 'b' }] });
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'cmsBlock', attrs: { _id: 'x', type: 'core/group', data: {}, children: 'no' } }] })).toThrow();
    });

    it('styles blocks from theme presets', () => {
        const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
        // Supports: the category's defaults, narrowed or widened by the declaration.
        expect(blockSupports({ category: 'text' })).toEqual(['background', 'text', 'padding', 'margin', 'fontSize', 'align']);
        expect(blockSupports({ category: 'media' })).toEqual(['padding', 'margin']);
        expect(blockSupports({})).toEqual(['background', 'text', 'padding', 'margin']);
        expect(blockSupports({ category: 'design', supports: { color: false, typography: ['align'], spacing: ['padding'] } })).toEqual(['padding', 'align']);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, supports: { color: ['background'], typography: true } })).toEqual([]);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, supports: { border: true } as never })).toEqual(['block acme/box: supports has no border; it takes color, spacing, typography.']);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, supports: { color: ['shadow'] } as never })).toEqual(['block acme/box: supports.color is true, false or some of background, text.']);
        // The shape: slugs per property, an alignment, the anchor and class names.
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, style: { background: 'Brand' } }])).toBe('block style.background is a preset slug.');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, style: { align: 'justify' } }])).toBe('block style.align is left, center, right.');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, style: { shadow: 'x' } }])).toBe('block style has no shadow; it takes background, text, padding, margin, fontSize, align.');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, layout: { anchor: '1st' } }])).toContain('block layout.anchor is an HTML id');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, layout: { className: 'ok bad!' } }])).toContain('block layout.className lists class names');
        expect(blocksShapeProblem([{ _id: 'a', type: 'core/divider', data: {}, style: { padding: 'large', align: 'center' }, layout: { anchor: 'top', className: 'hero  wide' } }])).toBeUndefined();
        // Validation keeps the properties the type supports and drops the rest; empty extras go.
        const checked = validateBlocks([
            { _id: 'p', type: 'core/paragraph', data: { text: 'Hi' }, style: { background: 'brand', align: 'center', padding: '' }, layout: { hide: [], anchor: ' intro ', className: ' a  b ' } },
            { _id: 'i', type: 'core/image', data: { image: 'f1' }, style: { background: 'brand', padding: 'large' }, layout: { anchor: '' } },
        ], types);
        expect(checked.errors).toEqual({});
        expect(checked.blocks[0]).toEqual({ _id: 'p', type: 'core/paragraph', data: { text: 'Hi' }, style: { background: 'brand', align: 'center' }, layout: { anchor: 'intro', className: 'a b' } });
        expect(checked.blocks[1]).toEqual({ _id: 'i', type: 'core/image', data: { image: 'f1' }, style: { padding: 'large' } });
        // The wrapper's attributes: classes per property, the variables inline, the anchor and class names.
        expect(blockStyleAttributes({ style: { background: 'brand', text: 'light', padding: 'large', margin: 'none', fontSize: 'x-large', align: 'center' }, layout: { anchor: 'intro', className: 'hero' } })).toEqual({
            className: 'cms-block cms-bg-brand cms-text-light cms-p-large cms-m-none cms-size-x-large cms-align-center hero', id: 'intro',
            style: 'background-color: var(--cms-color-brand); color: var(--cms-color-light); padding: var(--cms-space-large); margin-block: var(--cms-space-none); font-size: var(--cms-size-x-large); text-align: center',
        });
        expect(blockStyleAttributes({ style: {}, layout: { hide: ['sm'] } })).toBeNull();
        expect(blockStyleAttributes({ style: { background: 'bad slug' } })).toBeNull();
        // Presets: the manifest's checks, the defaults, layering, the site's overrides, the variables.
        expect(presetProblems({ colors: [{ slug: 'brand', name: 'Brand', value: '#0f172a' }, { slug: 'glow', name: 'Glow', value: 'oklch(0.7 0.1 200)' }], spacing: [{ slug: 'tight', name: 'Tight', value: 'clamp(0.5rem, 2vw, 1rem)' }] })).toEqual([]);
        expect(presetProblems({ colors: [{ slug: 'Brand', name: 'Brand', value: '#fff' }] })).toEqual(['colors: slugs are lowercase letters, digits and hyphens.']);
        expect(presetProblems({ colors: [{ slug: 'brand', name: 'Brand', value: 'url(x)' }, { slug: 'brand', name: 'Again', value: '#fff' }] })).toEqual(['colors.brand needs a CSS colour.', 'colors.brand is listed twice.']);
        expect(presetProblems({ shadows: [] })).toEqual(['shadows is not a preset kind; use colors, fontSizes, spacing.']);
        expect(presetProblems({ fontSizes: [{ slug: 'big', name: 'Big', value: '2rem; color: red' }] })).toEqual(['fontSizes.big needs a CSS length.']);
        expect(themeProblems({ label: 'T', presets: { colors: [{ slug: 'x', name: '', value: '#fff' }] } })).toEqual(['theme.presets: colors.x needs a name of at most 40 characters.']);
        const layered = layerPresets({ colors: [{ slug: 'base', name: 'Base', value: '#fff' }, { slug: 'brand', name: 'Brand', value: '#00f' }] }, { colors: [{ slug: 'brand', name: 'Brand', value: '#f00' }] });
        expect(layered.colors).toEqual([{ slug: 'brand', name: 'Brand', value: '#f00' }, { slug: 'base', name: 'Base', value: '#fff' }]);
        expect(layered.spacing).toBeUndefined();
        const resolved = resolvePresets({ colors: [{ slug: 'brand', name: 'Brand', value: '#00f' }] }, { colors: { brand: '#0a0' }, custom: [{ slug: 'mine', name: 'Mine', value: '#123' }, { slug: 'brand', name: 'Dupe', value: '#000' }] });
        expect(resolved.colors).toEqual([{ slug: 'brand', name: 'Brand', value: '#0a0' }, { slug: 'mine', name: 'Mine', value: '#123' }]);
        expect(resolved.fontSizes).toEqual(DEFAULT_PRESETS.fontSizes);
        expect(resolved.spacing.map(preset => preset.slug)).toEqual(['none', 'small', 'medium', 'large', 'x-large']);
        expect(presetOverridesProblem({ colors: { brand: '#0a0' } })).toBeUndefined();
        expect(presetOverridesProblem({ colors: { brand: 'url(x)' } })).toBe('brand needs a CSS colour.');
        expect(presetOverridesProblem({ custom: [{ slug: 'ok', name: 'Ok', value: 'nope!' }] })).toBe('ok needs a CSS colour.');
        expect(presetOverridesProblem([])).toBe('Preset overrides are an object.');
        expect(presetStyle({ colors: [{ slug: 'brand', name: 'Brand', value: ' #0a0 ' }], spacing: [{ slug: 'none', name: 'None', value: '0' }] })).toBe('--cms-color-brand: #0a0; --cms-space-none: 0;');
        // Additional CSS may style, not load or run.
        expect(customCssProblem('.hero { color: red }')).toBeUndefined();
        expect(customCssProblem('@import url(x);')).toBe('Additional CSS cannot use @import.');
        expect(customCssProblem('.a { background: url(x) }')).toBe('Additional CSS cannot use url().');
        expect(customCssProblem('.a { width: expression(1) }')).toBe('Additional CSS cannot run scripts.');
        expect(customCssProblem('</style><script>')).toBe('Additional CSS cannot contain HTML tags.');
        // A body's embedded block carries its style.
        const doc = normalizeRichText({ type: 'doc', content: [{ type: 'cmsBlock', attrs: { _id: 'q', type: 'core/quote', data: { text: 'q' }, style: { background: 'brand' } } }] });
        expect(richTextBlocks(doc)[0]).toMatchObject({ _id: 'q', style: { background: 'brand' } });
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'cmsBlock', attrs: { _id: 'q', type: 'core/quote', data: { text: 'q' }, style: { background: 'Bad' } } }] })).toThrow();
    });

    it('checks redirects and webhook URLs', () => {
        expect(redirectPath('/old/page/?utm=1')).toBe('/old/page');
        expect(redirectProblems({ source: '/old', target: '/new' })).toEqual([]);
        expect(redirectProblems({ source: '/old/*', target: 'https://example.com/*' })).toEqual([]);
        expect(redirectProblems({ source: '/', target: '/x' })).toHaveLength(1);
        expect(redirectProblems({ source: '/a/*/b', target: '/x' })).toHaveLength(1);
        expect(redirectProblems({ source: '/a', target: '/b/*' })).toHaveLength(1);
        expect(redirectProblems({ source: '/gone', target: '', status: 410 })).toEqual([]);
        expect(redirectProblems({ source: '/a', target: 'javascript:alert(1)' })).toHaveLength(1);
        expect(webhookUrlProblem('https://hooks.example.com/build')).toBeUndefined();
        expect(webhookUrlProblem('http://localhost:8787/hook')).toBeUndefined();
        expect(webhookUrlProblem('http://example.com/hook')).toContain('HTTPS');
        expect(webhookUrlProblem('https://user:secret@example.com/')).toContain('credentials');
    });

    it('checks posted comments', () => {
        expect(checkComment({ content: ' Hi\r\nthere ', authorName: 'Ann', authorEmail: 'ANN@Example.com' }, true)).toEqual({ content: 'Hi\nthere', authorName: 'Ann', authorEmail: 'ann@example.com', authorUrl: '' });
        expect(() => checkComment({ content: '' }, false)).toThrow('Write a comment.');
        expect(() => checkComment({ content: 'x', authorEmail: 'nope' }, false)).toThrow('valid email');
        expect(() => checkComment({ content: 'x', authorUrl: 'javascript:alert(1)' }, false)).toThrow('https://');
        expect(() => checkComment({ content: 'x' }, true)).toThrow('Enter your name.');
    });

    it('describes image variants around crops and focal points', () => {
        const image = { id: 'f1', name: 'photo one.png', contentType: 'image/png', width: 2000, height: 1000, edits: null, version: 7 };
        expect(variantWidth(700)).toBe(960);
        expect(variantWidth(9000)).toBe(2560);
        expect(imageUrl(image, { width: 700 })).toBe('/media/f1/photo%20one.png?w=960&v=7');
        expect(imageSrcset(image).split(', ').map(entry => entry.split(' ')[1])).toEqual(['320w', '640w', '960w', '1280w', '1920w', '2000w']);
        expect(imageSrcset({ ...image, contentType: 'image/gif' })).toBe('');
        expect(variantRect(image, 1)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
        expect(variantRect({ ...image, edits: { focus: { x: 1, y: 0.5 } } }, 1)).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 });
        expect(variantRect({ ...image, edits: { crop: { x: 100, y: 100, width: 400, height: 400 } } })).toEqual({ x: 100, y: 100, width: 400, height: 400 });
        expect(imageEditsProblems({ crop: { x: 0, y: 0, width: 10, height: 10 } }, 100, 100)).toHaveLength(1);
        expect(imageEditsProblems({ focus: { x: 2, y: 0 } }, 100, 100)).toHaveLength(1);
        expect(negotiateFormat('image/avif,image/webp,*/*', 'image/png')).toBe('avif');
        expect(negotiateFormat('image/webp,*/*', 'image/jpeg')).toBe('webp');
        expect(negotiateFormat('*/*', 'image/png')).toBe('png');
    });
});
