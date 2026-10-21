import { describe, expect, it } from 'vitest';
import {
    blockAllowedIn, blockCategory, blockMedia, blockProblems, blocksShapeProblem, blockTreeProblem, checkComment, collectionProblems, compareRecords, CORE_BLOCKS, diffWords,
    field, findBlock, flattenBlocks, imageEditsProblems, imageSrcset, imageUrl, insertBlock, languageName, moveBlock, placeBlocks, posts, redirectPath, redirectProblems, removeBlock,
    normalizeRichText, richTextBlocks, shiftBlock, validateBlocks, validateValue, variantRect, variantWidth, webhookUrlProblem, type Block,
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
        const changes = compareRecords({ title: field.string({ label: 'Title' }), sticky: field.boolean({ label: 'Sticky' }), body: field.richText({ label: 'Body' }) },
            { id: 'a', rev: 1, createdAt: 0, updatedAt: 0, owner: null, title: 'Old', sticky: false, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }] } },
            { id: 'a', rev: 2, createdAt: 0, updatedAt: 0, owner: null, title: 'New', sticky: true, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }] } });
        expect(changes.map(change => [change.name, change.kind, change.before, change.after])).toEqual([['title', 'text', 'Old', 'New'], ['sticky', 'value', 'No', 'Yes']]);
    });

    it('validates group fields and field order', () => {
        const seo = field.group({ title: field.string({ max: 5 }), noindex: field.boolean() });
        expect(validateValue('seo', seo, { title: 'Short', noindex: true })).toBeUndefined();
        expect(validateValue('seo', seo, { title: null })).toBeUndefined();
        expect(validateValue('seo', seo, { title: 'Too long' })).toContain('at most 5');
        expect(validateValue('seo', seo, { other: 1 })).toBe('has no subfield other.');
        expect(collectionProblems({ ...posts, fieldOrder: ['Not valid'] })).toContain('The field order names at most 64 fields.');
        expect(collectionProblems({ ...posts, comments: 'yes' as never })).toContain('Comments are on or off.');
        // Blank text does not fill a required field.
        expect(validateValue('title', field.string({ required: true }), '   ')).toBe('is required.');
        expect(validateValue('title', field.string({ required: true }), 'Hello')).toBeUndefined();
        expect(validateValue('note', field.string(), '')).toBeUndefined();
    });

    it('names languages and groups blocks', () => {
        expect(languageName('fr')).toBe('Français');
        expect(languageName('not a code')).toBe('not a code');
        expect(CORE_BLOCKS.every(block => block.icon && block.category)).toBe(true);
        expect(blockCategory({})).toBe('widgets');
        const block = { name: 'acme/card', label: 'Card', fields: {} };
        expect(blockProblems({ ...block, icon: 'star', category: 'design' })).toEqual([]);
        expect(blockProblems({ ...block, icon: 'Not An Icon' })).toHaveLength(1);
        expect(blockProblems({ ...block, category: 'layout' as never })).toEqual(['block acme/card: the category is one of text, media, design, widgets, embeds.']);
    });

    it('nests blocks in containers', () => {
        const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, children: { allowed: ['core/paragraph'], max: 3 }, parent: ['core/group'] })).toEqual([]);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, children: { max: 0 } })).toEqual(['block acme/box: children.max is 1 to 200.']);
        expect(blockProblems({ name: 'acme/box', label: 'Box', fields: {}, parent: [] })).toEqual(['block acme/box: parent lists block names.']);
        const columns: Block = { id: 'cols', type: 'core/columns', data: {}, children: [
            { id: 'a', type: 'core/column', data: { span: 4 }, children: [{ id: 'h', type: 'core/heading', data: { text: 'Left' } }] },
            { id: 'b', type: 'core/column', data: {}, layout: { hide: ['sm', 'sm'] }, children: [] },
        ] };
        const checked = validateBlocks([columns], types);
        expect(checked.errors).toEqual({});
        expect(checked.blocks[0]).toEqual({ id: 'cols', type: 'core/columns', data: { gap: 'medium', stack: 'mobile' }, children: [
            { id: 'a', type: 'core/column', data: { span: 4, verticalAlign: 'top' }, children: [{ id: 'h', type: 'core/heading', data: { text: 'Left', level: 'h2' } }] },
            { id: 'b', type: 'core/column', data: { verticalAlign: 'top' }, layout: { hide: ['sm'] }, children: [] },
        ] });
        // A column goes only inside columns, columns hold only columns, a leaf holds nothing.
        expect(validateBlocks([{ id: 'c', type: 'core/column', data: {} }], types).errors).toEqual({ c: 'core/column goes inside core/columns.' });
        expect(validateBlocks([{ id: 'cols', type: 'core/columns', data: {}, children: [{ id: 'p', type: 'core/paragraph', data: { text: 'x' } }] }], types).errors).toEqual({ p: 'core/paragraph cannot go inside core/columns.' });
        expect(validateBlocks([{ id: 'p', type: 'core/paragraph', data: { text: 'x' }, children: [{ id: 'q', type: 'core/divider', data: {} }] }], types).errors).toEqual({ p: 'core/paragraph does not hold blocks.' });
        expect(validateBlocks([{ id: 'cols', type: 'core/columns', data: {}, children: Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, type: 'core/column', data: {} })) }], types).errors).toEqual({ cols: 'holds at most 6 blocks.' });
        // A field's allowed list applies at the top level; the containers' rules below it.
        expect(validateBlocks([{ id: 'g', type: 'core/group', data: {}, children: [{ id: 'q', type: 'core/quote', data: { text: 'q' } }] }], types, ['core/group']).errors).toEqual({});
        expect(validateBlocks([{ id: 'q', type: 'core/quote', data: { text: 'q' } }], types, ['core/group']).errors).toEqual({ q: 'core/quote is not an available block.' });
        // The shape: distinct IDs across the tree, the depth and count limits, the layout.
        expect(blocksShapeProblem([{ id: 'a', type: 'core/group', data: {}, children: [{ id: 'a', type: 'core/divider', data: {} }] }])).toBe('blocks need distinct IDs.');
        const deep = (depth: number): Block => depth ? { id: `d${depth}`, type: 'core/group', data: {}, children: [deep(depth - 1)] } : { id: 'leaf', type: 'core/divider', data: {} };
        expect(blocksShapeProblem([deep(3)])).toBeUndefined();
        expect(blocksShapeProblem([deep(4)])).toBe('blocks nest at most 4 deep.');
        expect(blocksShapeProblem([{ id: 'a', type: 'core/divider', data: {}, layout: { hide: ['xl'] } }])).toBe('block layout.hide lists sm, md, lg.');
        expect(blocksShapeProblem([{ id: 'a', type: 'core/group', data: {}, children: 'no' }])).toBe('block children must be a list of blocks.');
        expect(blockMedia([{ id: 'g', type: 'core/group', data: {}, children: [{ id: 'i', type: 'core/image', data: { image: 'file-1' } }] }], types)).toEqual(['file-1']);
        // The tree helpers editors use.
        const tree: Block[] = [columns, { id: 'p', type: 'core/paragraph', data: { text: 'After' } }];
        expect(flattenBlocks(tree).map(block => block.id)).toEqual(['cols', 'a', 'h', 'b', 'p']);
        expect(placeBlocks(tree).map(place => [place.block.id, place.depth, place.parent, place.index])).toEqual([['cols', 0, null, 0], ['a', 1, 'cols', 0], ['h', 2, 'a', 0], ['b', 1, 'cols', 1], ['p', 0, null, 1]]);
        expect(findBlock(tree, 'h')?.data).toEqual({ text: 'Left' });
        expect(findBlock(moveBlock(tree, 'p', 'b', 0), 'b')?.children?.map(block => block.id)).toEqual(['p']);
        expect(moveBlock(tree, 'cols', 'a', 0)).toEqual(tree);
        expect(flattenBlocks(removeBlock(tree, 'a')).map(block => block.id)).toEqual(['cols', 'b', 'p']);
        expect(flattenBlocks(insertBlock(tree, 'b', { id: 'n', type: 'core/divider', data: {} })).map(block => block.id)).toEqual(['cols', 'a', 'h', 'b', 'n', 'p']);
        // Moves: in goes under the sibling above when the types allow it, out follows the container.
        expect(shiftBlock(tree, 'p', 'in', types)).toBe(tree);
        const grouped: Block[] = [{ id: 'g', type: 'core/group', data: {}, children: [] }, { id: 'p', type: 'core/paragraph', data: { text: 'x' } }];
        const inside = shiftBlock(grouped, 'p', 'in', types);
        expect(placeBlocks(inside).map(place => [place.block.id, place.parent])).toEqual([['g', null], ['p', 'g']]);
        expect(placeBlocks(shiftBlock(inside, 'p', 'out', types)).map(place => place.parent)).toEqual([null, null]);
        expect(shiftBlock(tree, 'h', 'up', types)).toBe(tree);
        expect(flattenBlocks(shiftBlock(tree, 'b', 'up', types)).map(block => block.id)).toEqual(['cols', 'b', 'a', 'h', 'p']);
        expect(blockTreeProblem([{ id: 'c', type: 'core/column', data: {} }], types)).toBe('Column goes inside Columns.');
        expect(blockTreeProblem(tree, types)).toBeUndefined();
        expect(blockAllowedIn(types, 'core/column', 'core/columns')).toBe(true);
        expect(blockAllowedIn(types, 'core/group', 'core/columns')).toBe(false);
        // A body embeds a container with its children.
        const doc = normalizeRichText({ type: 'doc', content: [{ type: 'cmsBlock', attrs: { id: 'cols', type: 'core/columns', data: {}, children: columns.children, layout: { hide: ['lg'] } } }] });
        expect(richTextBlocks(doc)[0]).toMatchObject({ id: 'cols', layout: { hide: ['lg'] }, children: [{ id: 'a' }, { id: 'b' }] });
        expect(() => normalizeRichText({ type: 'doc', content: [{ type: 'cmsBlock', attrs: { id: 'x', type: 'core/group', data: {}, children: 'no' } }] })).toThrow();
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
