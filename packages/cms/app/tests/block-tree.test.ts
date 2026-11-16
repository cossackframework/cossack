import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('__', (value: string) => value);
const { BlockTree } = await import('../src/cms/block-tree');
const { component } = await import('@cossackframework/renderer');
const { renderToString } = await import('@cossackframework/renderer/server');

const options = [
    { name: 'core/heading', label: 'Heading', description: '', icon: 'text-bold', category: 'text', fields: [{ name: 'text', kind: 'string', label: 'Text' }], children: null, parent: [], supports: [] },
    { name: 'core/group', label: 'Group', description: '', icon: 'widget', category: 'layout', fields: [], children: { allowed: [], max: null }, parent: [], supports: [] },
];
const blocks = [
    { _id: 'grp', type: 'core/group', data: {}, children: [{ _id: 'hd', type: 'core/heading', data: { text: 'Hello' } }] },
    { _id: 'para', type: 'core/heading', data: { text: 'World' }, layout: { hide: ['sm'] } },
];
const render = async () => (await renderToString(component(BlockTree, { id: 'tree', blocks, options, allowed: [], error: '', onChange: () => undefined, onEdit: () => undefined, onNote: () => undefined, control: () => null } as never))).replace(/\s*\n\s*/g, '');

describe('block tree toolbar', () => {
    it('keeps Edit, Note and Remove as buttons and folds the rest into a More menu', async () => {
        const markup = await render();
        expect(markup).toContain('aria-label="Edit Heading"');
        expect(markup).toContain('aria-label="Add a note on Heading"');
        expect(markup).toContain('aria-label="Remove Heading"');
        expect(markup).toContain('aria-label="More actions for Heading"');
        // The device toggles and the four moves became menu items.
        expect(markup).not.toMatch(/<button[^>]*aria-label="Hide on phones Heading"[^>]*aria-describedby/);
        expect(markup).toMatch(/<button[^>]*role="menuitem"[^>]*aria-label="Hide on tablets Heading"/);
        expect(markup).toMatch(/<button[^>]*role="menuitem"[^>]*aria-label="Move up Heading"/);
        expect(markup).toMatch(/<button[^>]*role="menuitem"[^>]*aria-label="Move in Heading"/);
        expect(markup).toMatch(/<button[^>]*role="menuitem"[^>]*aria-label="Duplicate Heading"/);
    });

    it('marks a block hidden on a device in its header and offers to show it again', async () => {
        const markup = await render();
        const para = markup.slice(markup.indexOf('data-block-tree-item="para"'));
        expect(para).toContain('title="Hidden on phones"');
        expect(para).toMatch(/<button[^>]*role="menuitem"[^>]*aria-label="Show on phones Heading"[^>]*aria-pressed="true"/);
    });
});
