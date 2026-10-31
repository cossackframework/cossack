import { describe, expect, it } from 'vitest';
import {
    boxBlock, boxFields, collectionProblems, collectionResource, CORE_FIELDS, defaultEditorLayout, EDIT_TAB, EDITOR_TAB_ID, editorBoxes, editorLayoutProblems, editorLayoutTypes, editorTabId, extendCollection, field, forms, layoutBoxes, manifestProblems, posts,
    resolveEditorLayout, type Block, type CollectionDefinition, type EditorLayout, type FieldGroup,
} from '../src/index';

const fieldBlock = (id: string, kind: string, name: string): Block => ({ _id: id, type: `field/${kind}`, data: { name, label: name } });

/** Products: content, a featured image, categories, a Pricing group in the main column and a Stock group in the sidebar. */
const products: CollectionDefinition = {
    name: 'products', label: 'Products', singular: 'Product', path: 'shop', hierarchical: true, comments: true, taxonomies: ['categories'],
    features: { content: true, excerpt: true, featuredImage: true },
    fields: { sku: field.string({ max: 40, label: 'SKU' }), onSale: field.boolean({ label: 'On sale' }) },
};
const pricing: FieldGroup = { id: 'pricing', title: 'Pricing', targets: [{ kind: 'collection', name: 'products' }], blocks: [fieldBlock('p', 'number', 'price')] };
const stock: FieldGroup = { id: 'stock', title: 'Stock', placement: 'sidebar', targets: [{ kind: 'collection', name: 'products' }], blocks: [fieldBlock('q', 'integer', 'quantity')] };
const taxonomies = [{ name: 'categories', label: 'Categories' }];

function boxesOf(definition: CollectionDefinition, groups: FieldGroup[] = []) {
    const resource = collectionResource(definition, { categories: 'Categories' });
    return editorBoxes({ collection: definition, fields: resource.fields, groups, taxonomies: definition.taxonomies?.length ? taxonomies : [], special: CORE_FIELDS });
}

describe('editor boxes', () => {
    it('lists the editor\'s boxes in the order the editor showed them, main column first', () => {
        const boxes = boxesOf(products, [pricing, stock]);
        expect(boxes.map(box => box.id)).toEqual([
            'field:content', 'field:excerpt', 'field:sku', 'group:pricing', 'seo',
            'attributes', 'languages', 'template', 'taxonomy:categories', 'field:featuredImage', 'field:onSale', 'group:stock', 'discussion', 'revisions',
        ]);
        expect(boxes.find(box => box.id === 'group:pricing')).toMatchObject({ label: 'Pricing', placement: 'main' });
        expect(boxes.find(box => box.id === 'taxonomy:categories')).toMatchObject({ label: 'Categories', placement: 'sidebar' });
        expect(boxes.find(box => box.id === 'languages')?.note).toContain('several languages');
    });

    it('leaves out what the collection does not have, and fields a group lays out', () => {
        const flat: CollectionDefinition = { ...products, path: null, hierarchical: false, comments: false, taxonomies: [], features: { content: true, revisions: false } };
        const grouped: FieldGroup = { ...pricing, blocks: [fieldBlock('s', 'text', 'sku')] };
        expect(boxesOf(flat, [grouped]).map(box => box.id)).toEqual(['field:content', 'group:pricing', 'languages', 'field:onSale']);
    });

    it('builds the default layout: one Edit tab and the sidebar', () => {
        const layout = defaultEditorLayout(boxesOf(products, [pricing, stock]));
        expect(layout.tabs).toHaveLength(1);
        expect(layout.tabs[0]).toMatchObject({ _id: EDIT_TAB, type: 'editor/tab', data: { label: 'Edit' } });
        expect(layoutBoxes(layout.tabs).map(entry => entry.id)).toEqual(['field:content', 'field:excerpt', 'field:sku', 'group:pricing', 'seo']);
        expect(layoutBoxes(layout.sidebar).map(entry => entry.id)).toEqual(['attributes', 'languages', 'template', 'taxonomy:categories', 'field:featuredImage', 'field:onSale', 'group:stock', 'discussion', 'revisions']);
        expect(boxBlock('field:featuredImage')).toEqual({ _id: 'box-field-featuredImage', type: 'editor/box', data: { box: 'field:featuredImage' } });
    });

    it('names the fields a box edits, so an error finds its tab', () => {
        expect(boxFields('field:excerpt', [])).toEqual(['excerpt']);
        expect(boxFields('group:pricing', [pricing])).toEqual(['price']);
        expect(boxFields('group:gone', [pricing])).toEqual([]);
        expect(boxFields('taxonomy:categories', [])).toEqual(['categories']);
        expect(boxFields('seo', [])).toEqual(['seo', 'summary']);
        expect(boxFields('attributes', [])).toEqual(['parent', 'menuOrder']);
        expect(boxFields('revisions', [])).toEqual([]);
    });
});

describe('editor layout validation', () => {
    const layout: EditorLayout = {
        tabs: [
            { _id: 'edit', type: 'editor/tab', data: { label: 'Product' }, children: [boxBlock('field:content'), { _id: 'cols', type: 'core/columns', data: {}, children: [
                { _id: 'c1', type: 'core/column', data: {}, children: [boxBlock('group:pricing')] },
                { _id: 'c2', type: 'core/column', data: {}, children: [boxBlock('group:stock')] },
            ] }] },
            { _id: 'inventory', type: 'editor/tab', data: { label: 'Inventory', icon: 'box' }, children: [{ _id: 'sec', type: 'editor/section', data: { title: 'Warehouse', description: 'Counted weekly.' }, children: [boxBlock('field:sku'), { _id: 'note', type: 'core/paragraph', data: { text: 'Fill before publishing.' } }] }] },
        ],
        sidebar: [boxBlock('taxonomy:categories'), boxBlock('seo')],
    };

    it('accepts tabs, sections, columns, notes and boxes, with defaults applied', () => {
        const checked = editorLayoutProblems(layout);
        expect(checked.problems).toEqual([]);
        expect(checked.layout.tabs[1]!.children![0]!.data).toEqual({ title: 'Warehouse', description: 'Counted weekly.' });
        expect(checked.layout.tabs[0]!.children![1]!.data).toEqual({ gap: 'medium', stack: 'mobile' });
        expect(collectionProblems({ ...products, editor: layout })).toEqual([]);
    });

    it('refuses the wrong first tab, nested tabs, content blocks, unknown boxes and a box placed twice', () => {
        const bad: EditorLayout = {
            tabs: [
                { _id: 'main', type: 'editor/tab', data: { label: 'Main' }, children: [
                    { _id: 'inner', type: 'editor/tab', data: { label: 'Inner' }, children: [] },
                    { _id: 'img', type: 'core/image', data: {} },
                    { _id: 'b1', type: 'editor/box', data: { box: 'field:1bad' } },
                    boxBlock('seo'),
                ] },
                { _id: 'main', type: 'editor/tab', data: {}, children: [] },
            ],
            sidebar: [boxBlock('seo'), { _id: 'side', type: 'editor/tab', data: { label: 'Side' }, children: [] }],
        };
        const { problems } = editorLayoutProblems(bad);
        expect(problems).toEqual(expect.arrayContaining([
            'The first tab is edit.',
            'Tab main is listed twice.',
            expect.stringContaining('Tab block main.label: is required.'),
            expect.stringContaining('Tab block inner: editor/tab cannot go inside editor/tab.'),
            expect.stringContaining('Tab block img: core/image'),
            expect.stringContaining('Tab block b1.box:'),
            expect.stringContaining('Sidebar block side:'),
            'Block box-seo: the box seo is placed twice.',
        ]));
        expect(collectionProblems({ ...products, editor: { tabs: 'no' } as never })).toEqual(['The editor layout tabs is a list of blocks.']);
        expect(collectionProblems({ ...products, editor: bad })).toEqual(expect.arrayContaining([expect.stringContaining('Editor layout: The first tab is edit.')]));
    });

    it('gives tabs address-safe IDs from their labels, and refuses reserved or malformed ones', () => {
        expect(editorTabId('Inventory')).toBe('inventory');
        expect(editorTabId('Prix & Délais')).toBe('prix-delais');
        expect(editorTabId('Inventory', ['inventory'])).toBe('inventory-2');
        expect(editorTabId('Inventory', ['inventory', 'inventory-2'])).toBe('inventory-3');
        // The editor's own: its JSON view, and the sidebar row of the layout editor.
        expect(editorTabId('JSON')).toBe('json-2');
        expect(editorTabId('Sidebar')).toBe('sidebar-2');
        expect(editorTabId('!!!')).toBe('tab');
        expect(EDITOR_TAB_ID.test(editorTabId('A very long tab label that keeps going and going'))).toBe(true);
        const tab = (id: string): Block => ({ _id: id, type: 'editor/tab', data: { label: id }, children: [] });
        const { problems } = editorLayoutProblems({ tabs: [tab('edit'), tab('json'), tab('Big_Tab'), tab('a1b2c3d4e5f6')], sidebar: [] });
        expect(problems).toEqual([
            'Tab json: the ID json is the editor\'s own.',
            'Tab Big_Tab: an ID is lowercase letters, digits and single hyphens, at most 40 characters, for the address (?tab=).',
        ]);
        // On screen a box is a meta box.
        expect(editorLayoutTypes().get('editor/box')!.label).toBe('Meta box');
    });

    it('offers the boxes as choices, keeping IDs a stored layout names', () => {
        const types = editorLayoutTypes(boxesOf(products, [pricing]), ['group:gone', 'nonsense']);
        const box = types.get('editor/box')!.fields.box!;
        expect(box.kind).toBe('enum');
        expect(box.values).toContain('group:pricing');
        expect(box.values).toContain('group:gone');
        expect(box.values).not.toContain('nonsense');
        expect(box.choices).toMatchObject({ 'group:pricing': 'Pricing', 'group:gone': 'group:gone (not available)' });
        expect(editorLayoutProblems({ tabs: [{ _id: 'edit', type: 'editor/tab', data: { label: 'Edit' }, children: [boxBlock('group:other')] }], sidebar: [] }, { types }).problems).toEqual([expect.stringContaining('Tab block box-group-other.box:')]);
    });
});

describe('resolving a layout', () => {
    const boxes = boxesOf(products, [pricing, stock]);

    it('renders the default when nothing is stored', () => {
        const resolved = resolveEditorLayout(undefined, boxes);
        expect(resolved.tabs.map(tab => tab._id)).toEqual(['edit']);
        expect(layoutBoxes(resolved.tabs).map(entry => entry.id)).toEqual(['field:content', 'field:excerpt', 'field:sku', 'group:pricing', 'seo']);
        expect(resolved.missing).toEqual([]);
        expect(resolved.added).toEqual({});
    });

    it('appends boxes a stored layout does not name, and leaves out boxes that are gone', () => {
        const stored: EditorLayout = {
            tabs: [
                { _id: 'edit', type: 'editor/tab', data: { label: 'Product' }, children: [boxBlock('field:content'), boxBlock('group:gone')] },
                { _id: 'pricing', type: 'editor/tab', data: { label: 'Pricing' }, children: [{ _id: 'sec', type: 'editor/section', data: { title: 'Prices' }, children: [boxBlock('group:pricing'), boxBlock('field:onSale')] }] },
            ],
            sidebar: [boxBlock('field:featuredImage'), boxBlock('taxonomy:old')],
        };
        const resolved = resolveEditorLayout(stored, boxes);
        expect(resolved.tabs.map(tab => tab._id)).toEqual(['edit', 'pricing']);
        // The gone group's box is dropped; the main boxes the layout does not name follow on the first tab.
        expect(layoutBoxes(resolved.tabs[0]!.children!).map(entry => entry.id)).toEqual(['field:content', 'field:excerpt', 'field:sku', 'seo']);
        expect(layoutBoxes(resolved.tabs[1]!.children!).map(entry => entry.id)).toEqual(['group:pricing', 'field:onSale']);
        expect(layoutBoxes(resolved.sidebar).map(entry => entry.id)).toEqual(['field:featuredImage', 'attributes', 'languages', 'template', 'taxonomy:categories', 'group:stock', 'discussion', 'revisions']);
        expect(resolved.missing).toEqual(['group:gone', 'taxonomy:old']);
    });

    it('adds plugins\' tabs and sidebar boxes, prefixed, unless the stored layout placed them', () => {
        const shipping: FieldGroup = { id: 'shop-shipping', title: 'Shipping', plugin: 'shop', targets: [{ kind: 'collection', name: 'products' }], blocks: [fieldBlock('w', 'number', 'weight')] };
        const withShop = boxesOf(products, [pricing, stock, shipping]);
        expect(withShop.find(box => box.id === 'group:shop-shipping')).toMatchObject({ label: 'Shipping', plugin: 'shop', placement: 'main' });
        const additions = [{ plugin: 'shop', layout: { tabs: [{ _id: 'shipping', type: 'editor/tab', data: { label: 'Shipping' }, children: [boxBlock('group:shop-shipping')] }], sidebar: [boxBlock('group:stock')] } }];
        const fresh = resolveEditorLayout(undefined, withShop, additions);
        expect(fresh.tabs.map(tab => tab._id)).toEqual(['edit', 'shop-shipping']);
        expect(fresh.added).toEqual({ 'shop-shipping': 'shop' });
        expect(layoutBoxes(fresh.tabs[1]!.children!).map(entry => entry.id)).toEqual(['group:shop-shipping']);
        // The plugin places the stock group, so the default leaves it to the plugin's sidebar block, at the end.
        expect(layoutBoxes(fresh.sidebar).map(entry => entry.id)).toEqual(['attributes', 'languages', 'template', 'taxonomy:categories', 'field:featuredImage', 'field:onSale', 'discussion', 'revisions', 'group:stock']);
        expect(layoutBoxes(fresh.tabs[0]!.children!).map(entry => entry.id)).not.toContain('group:shop-shipping');
        // Once the administrator moved the plugin's tab, the stored one wins.
        const moved: EditorLayout = { tabs: [{ _id: 'edit', type: 'editor/tab', data: { label: 'Edit' }, children: [] }, { _id: 'shop-shipping', type: 'editor/tab', data: { label: 'Delivery' }, children: [boxBlock('group:shop-shipping'), boxBlock('group:pricing')] }], sidebar: [] };
        const kept = resolveEditorLayout(moved, withShop, additions);
        expect(kept.tabs[1]!.data.label).toBe('Delivery');
        expect(kept.added).toEqual({});
        // An inactive plugin adds nothing; its group's box is then missing.
        const gone = resolveEditorLayout(moved, boxesOf(products, [pricing, stock]), []);
        expect(gone.missing).toEqual(['group:shop-shipping']);
        expect(layoutBoxes(gone.tabs[1]!.children!).map(entry => entry.id)).toEqual(['group:pricing']);
    });
});

describe('declared layouts', () => {
    it('gives forms a Settings tab, and keeps a stored layout on a built-in collection', () => {
        expect(forms.editor!.tabs.map(tab => [tab._id, tab.data.label])).toEqual([['edit', 'Form'], ['settings', 'Settings']]);
        expect(layoutBoxes(forms.editor!.tabs[1]!.children!).map(entry => entry.id)).toEqual(['field:settings', 'field:notifications']);
        expect(collectionProblems(forms)).toEqual([]);
        const layout: EditorLayout = { tabs: [{ _id: 'edit', type: 'editor/tab', data: { label: 'Post' }, children: [boxBlock('field:content')] }], sidebar: [] };
        expect(extendCollection(posts, { editor: layout }).editor).toEqual(layout);
        expect(extendCollection(posts, {}).editor).toBeUndefined();
    });

    it('checks a plugin\'s field groups and editor additions in its manifest', () => {
        const manifest = {
            schemaVersion: 1, name: 'shop', version: '1.0.0',
            fieldGroups: [{ id: 'shop-shipping', title: 'Shipping', targets: [{ kind: 'collection', name: 'products' }], blocks: [fieldBlock('w', 'number', 'weight')] }],
            editor: [{ collection: 'products', tabs: [{ _id: 'shipping', type: 'editor/tab', data: { label: 'Shipping' }, children: [boxBlock('group:shop-shipping')] }] }],
        };
        expect(manifestProblems(manifest)).toEqual([]);
        expect(manifestProblems({ ...manifest,
            fieldGroups: [{ id: 'shipping', title: '', plugin: 'shop', targets: [], blocks: [] }, { id: 'shipping', title: 'Again', targets: [], blocks: [] }],
            editor: [{ collection: 'products', tabs: [{ _id: 't', type: 'core/image', data: {} }] }, { collection: 'products' }, { tabs: [] }],
        })).toEqual([
            'field group shipping: plugin is set by the host.',
            'field group shipping: IDs start with shop-.',
            'field group shipping: The title is required and at most 120 characters.',
            'field group shipping: IDs start with shop-.',
            'field group shipping is declared twice.',
            expect.stringContaining('editor products: Tab block t:'),
            'editor products is declared twice.',
            'editor[2] must name a collection.',
        ]);
    });
});
