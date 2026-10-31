import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, field, type Block, type CmsHost, type CollectionDefinition, type FieldGroup, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const editor: Principal = { kind: 'user', id: 'editor-1', roles: ['editor'], permissions: [...DEFAULT_ROLES[1].permissions] };

const fieldBlock = (id: string, kind: string, data: { [key: string]: unknown }, extra: Partial<Block> = {}): Block => ({ _id: id, type: `field/${kind}`, data: { label: id, ...data }, ...extra });

/** Products, with content and a featured image; its fields come from groups. */
const products: CollectionDefinition = { name: 'products', label: 'Products', singular: 'Product', icon: 'box', path: 'shop', features: { content: true, featuredImage: true }, fields: {} };

/** Details: two columns and a pricing tab, made for products and attached from the collection. */
const details: FieldGroup = {
    id: 'details', title: 'Details', targets: [],
    blocks: [
        { _id: 'cols', type: 'core/columns', data: {}, children: [
            { _id: 'c1', type: 'core/column', data: {}, children: [fieldBlock('sku', 'text', { name: 'sku', label: 'SKU', unique: true, max: 40 })] },
            { _id: 'c2', type: 'core/column', data: {}, children: [fieldBlock('price', 'number', { name: 'price', label: 'Price', min: 0, required: true, index: true })] },
        ] },
        { _id: 'tabs', type: 'core/tabs', data: {}, children: [{ _id: 'sale', type: 'core/tab', data: { label: 'Sale' }, children: [
            fieldBlock('onSale', 'boolean', { name: 'onSale', label: 'On sale' }),
            fieldBlock('salePrice', 'number', { name: 'salePrice', label: 'Sale price', min: 0, required: true }, { when: { rules: [{ field: 'onSale', op: 'is', value: 'true' }] } }),
        ] }] },
    ],
};

/** Specifications: a repeater with a nested notes repeater, attached to products. */
const specs: FieldGroup = {
    id: 'specs', title: 'Specifications', placement: 'main', targets: [{ kind: 'collection', name: 'products' }],
    blocks: [
        { _id: 'h', type: 'core/heading', data: { text: 'Specifications' } },
        fieldBlock('specs', 'repeater', { name: 'specs', label: 'Specifications', max: 10, summary: 'name' }, { children: [
            fieldBlock('name', 'text', { name: 'name', label: 'Name', required: true, index: true, search: true }),
            fieldBlock('kind', 'choice', { name: 'kind', label: 'Kind', choices: ['text', 'link'] }),
            fieldBlock('url', 'text', { name: 'url', label: 'URL' }, { when: { rules: [{ field: 'kind', op: 'is', value: 'link' }] } }),
            fieldBlock('notes', 'repeater', { name: 'notes', label: 'Notes' }, { children: [
                fieldBlock('text', 'textarea', { name: 'text', label: 'Note', search: true }),
                fieldBlock('tag', 'text', { name: 'tag', label: 'Tag', index: true }),
            ] }),
        ] }),
    ],
};

/** Extras for posts, categories, users and menu items. */
const extras: FieldGroup = {
    id: 'extras', title: 'Extras', placement: 'sidebar', targets: [{ kind: 'collection', name: 'posts' }, { kind: 'taxonomy', name: 'categories' }, { kind: 'users' }, { kind: 'menus' }],
    blocks: [
        fieldBlock('color', 'choice', { name: 'color', label: 'Color', choices: ['red', 'blue'] }),
        fieldBlock('badge', 'text', { name: 'badge', label: 'Badge', max: 20 }, { when: { rules: [{ field: 'color', op: 'is', value: 'red' }] } }),
        fieldBlock('links', 'repeater', { name: 'links', label: 'Links' }, { children: [fieldBlock('href', 'text', { name: 'href', label: 'URL', required: true })] }),
    ],
};

describe.skipIf(!live)('field groups', () => {
    const service = romedbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('attaches groups from the collection, in order, and one with a repeater on its own', async () => {
        await cms.saveCollection(products, admin);
        expect(Object.keys(cms.resourceById('cms/products').fields)).toEqual(expect.arrayContaining(['content', 'featuredImage']));
        await cms.saveFieldGroup(details, admin);
        await expect(cms.saveCollection(products, admin, { groups: [{ id: 'nope' }] })).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('nope') });
        // A group whose field is a feature of the collection cannot attach.
        await cms.saveFieldGroup({ id: 'clash', title: 'Clash', targets: [], blocks: [fieldBlock('x', 'text', { name: 'excerpt', label: 'Excerpt' })] }, admin);
        await expect(cms.saveCollection({ ...products, features: { ...products.features, excerpt: true } }, admin, { groups: [{ id: 'clash' }] })).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('Clash') });
        const saved = await cms.saveCollection(products, admin, { groups: [{ id: 'details' }] });
        expect(saved.fields).toEqual({});
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(group => group.id)).toEqual(['details']);
        expect((await cms.fieldGroups.get('details'))!.targets).toEqual([{ kind: 'collection', name: 'products', order: 0 }]);
        const resource = cms.resourceById('cms/products');
        expect(Object.keys(resource.fields)).toEqual(expect.arrayContaining(['sku', 'price', 'onSale', 'salePrice']));
        expect(resource.fields.price).toMatchObject({ kind: 'number', required: true, min: 0, index: true });
        expect(resource.layout?.map(block => block._id)).toEqual(['cols', 'tabs']);
        // The migration records the resource with the group's fields, so entries are written straight away.
        const first = await cms.resource('cms/products').create({ title: 'First', price: 1, sku: 'FIRST' }, { principal: editor });
        expect(first).toMatchObject({ price: 1, sku: 'FIRST' });
        await cms.resource('cms/products').delete(first.id, { principal: editor, expectedRevision: first.rev });

        await expect(cms.saveFieldGroup({ ...specs, targets: [{ kind: 'collection', name: 'nope' }] }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('nope') });
        await expect(cms.saveFieldGroup({ ...specs, blocks: [fieldBlock('x', 'text', { name: 'price', label: 'Price' })] }, admin)).rejects.toMatchObject({ message: expect.stringContaining('already in the group') });
        await expect(cms.saveFieldGroup(specs, editor)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const group = await cms.saveFieldGroup(specs, admin);
        expect(group.blocks[1]!.children!.map(block => block.data.name)).toEqual(['name', 'kind', 'url', 'notes']);
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(entry => entry.id)).toEqual(['details', 'specs']);
        // Reordering from the collection writes the groups' targets; a group left out is detached and attached again.
        await cms.saveCollection(products, admin, { groups: [{ id: 'specs' }, { id: 'details' }] });
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(entry => entry.id)).toEqual(['specs', 'details']);
        await cms.saveCollection(products, admin, { groups: [{ id: 'specs' }] });
        expect(cms.resourceById('cms/products').fields.price).toBeUndefined();
        await cms.saveCollection(products, admin, { groups: [{ id: 'details' }, { id: 'specs' }] });
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(entry => entry.id)).toEqual(['details', 'specs']);

        const withSpecs = cms.resourceById('cms/products');
        expect(withSpecs.fields.specs).toMatchObject({ kind: 'rows', max: 10 });
        expect(withSpecs.fields).not.toHaveProperty('specs__name');
        const info = await cms.db.read([{ rql: 'INFO FOR TABLE r__cms__products' }]);
        const table = info.results[0]!.rows[0]![0] as { indexes: { name: string; kind: string; path?: string[] }[] };
        expect(table.indexes.map(index => `${index.name}:${index.kind}`)).toEqual(expect.arrayContaining(['r__cms__products__price:scalar', 'r__cms__products__r_specs__name:array', 'r__cms__products__r_specs__notes__tag:array', 'r__cms__products__text:fulltext']));
        expect(table.indexes.find(index => index.name === 'r__cms__products__r_specs__notes__tag')!.path).toEqual(['specs', '*', 'notes', '*', 'tag']);
    });

    it('stores rows with ids and search text, clears hidden fields and filters on row fields', async () => {
        const entries = cms.resource('cms/products');
        await expect(entries.create({ title: 'Bad', price: 1, specs: [{ kind: 'text' }] }, { principal: editor })).rejects.toMatchObject({ fields: { specs: 'row 1: Name is required.' } });
        await expect(entries.create({ title: 'Bad', price: 1, specs__name: ['x'] }, { principal: editor })).rejects.toMatchObject({ fields: { specs__name: 'is not a field of this resource.' } });
        // The sale price is required only while the product is on sale.
        await expect(entries.create({ title: 'Bad', price: 1, onSale: true }, { principal: editor })).rejects.toMatchObject({ fields: { salePrice: 'is required.' } });
        const entry = await entries.create({
            title: 'Rocket skates', price: 19.5, sku: 'RS-1', status: 'published', onSale: false, salePrice: 9,
            specs: [
                { name: 'Weight', kind: 'text', url: 'cleared', notes: [{ text: 'light as air', tag: 'fun' }] },
                { _id: 'site', name: 'Site', kind: 'link', url: 'https://example.com', notes: [{ _id: 'n1', text: 'official', tag: 'web' }, { text: '', tag: 'fun' }] },
            ],
        }, { principal: editor });
        expect(entry.salePrice).toBeNull();
        expect(entry).not.toHaveProperty('specs__name');
        const rows = entry.specs as { _id: string; url?: string; notes: { _id: string }[] }[];
        expect(rows.map(row => row._id)).toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{1,40}$/), 'site']);
        expect(rows[0]!.url).toBeUndefined();
        expect(rows[1]!.url).toBe('https://example.com');
        expect(rows[1]!.notes.map(note => note._id)).toEqual(['n1', expect.any(String)]);

        const stored = await cms.db.read([{ rql: 'SELECT "_text_specs" FROM r__cms__products WHERE "sku" = $sku', params: { $sku: 'RS-1' } }]);
        expect(stored.results[0]!.rows[0]).toEqual(['Weight\nlight as air\nSite\nofficial']);

        const found = await entries.list({ where: { 'specs.notes.tag': { contains: 'web' } } }, { principal: editor });
        expect(found.records.map(record => record.title)).toEqual(['Rocket skates']);
        expect((await entries.list({ where: { 'specs.name': { containsAny: ['Nope'] } } }, { principal: editor })).records).toEqual([]);
        await expect(entries.list({ where: { specs__name: { contains: 'Weight' } } }, { principal: editor })).rejects.toMatchObject({ message: 'Cannot filter on specs__name.' });
        await expect(entries.list({ where: { 'specs.notes.text': { contains: 'official' } } }, { principal: editor })).rejects.toMatchObject({ message: 'Cannot filter on specs.notes.text.' });
        await expect(entries.list({ where: { 'specs.name': 'Weight' } }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const plan = await cms.db.read([{ rql: 'EXPLAIN SELECT id FROM r__cms__products WHERE array::contains("specs".*."notes".*."tag", $tag)', params: { $tag: 'web' } }]);
        expect(JSON.stringify(plan.results[0]!.rows, (_, value) => typeof value === 'bigint' ? Number(value) : value)).toMatch(/r__cms__products__r_specs__notes__tag/);

        // Changing the rows changes what the filters find; the unique SKU still holds.
        const updated = await entries.update(entry.id, { specs: [{ _id: 'site', name: 'Site', kind: 'text' }] }, { principal: editor, expectedRevision: entry.rev });
        expect((updated.specs as { _id: string }[]).map(row => row._id)).toEqual(['site']);
        expect((await entries.list({ where: { 'specs.name': { contains: 'Weight' } } }, { principal: editor })).records).toEqual([]);
        expect((await entries.list({ where: { 'specs.notes.tag': { contains: 'web' } } }, { principal: editor })).records).toEqual([]);
        expect((await entries.list({ where: { 'specs.name': { contains: 'Site' } } }, { principal: editor })).records.map(record => record.title)).toEqual(['Rocket skates']);
        await expect(entries.create({ title: 'Twin', price: 2, sku: 'RS-1' }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
    });

    it('shows a group on terms, users and menu items as meta, checked the same way', async () => {
        await cms.saveFieldGroup(extras, admin);
        expect(cms.resourceById('cms/posts').fields.links).toMatchObject({ kind: 'rows' });

        const term = await cms.taxonomies.create('categories', { name: 'Red things', meta: { color: 'red', badge: 'hot', links: [{ href: '/a' }] } }, { principal: admin });
        expect(term.meta).toEqual({ color: 'red', badge: 'hot', links: [{ _id: expect.any(String), href: '/a' }] });
        await expect(cms.taxonomies.update(term.id, { meta: { color: 'green' } }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { color: expect.stringContaining('must be one of') } });
        await expect(cms.taxonomies.update(term.id, { meta: { nope: 1 } }, { principal: admin })).rejects.toMatchObject({ fields: { nope: 'is not a field here.' } });
        // Blue clears the badge, which shows for red alone; the links are kept.
        const blue = await cms.taxonomies.update(term.id, { meta: { color: 'blue' } }, { principal: admin });
        expect(blue.meta).toEqual({ color: 'blue', links: term.meta.links });

        const user = await cms.users.create({ email: 'meta@example.com', name: 'Meta', meta: { color: 'red', badge: 'new' } });
        expect(user.meta).toEqual({ color: 'red', badge: 'new' });
        await expect(cms.users.update(user.id, { meta: { badge: 'x'.repeat(30) } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await cms.users.update(user.id, { name: 'Meta 2' })).toBe(true);
        expect((await cms.users.get(user.id))!.meta).toEqual({ color: 'red', badge: 'new' });

        const menu = await cms.menus.create({ name: 'Main', items: [{ id: 'home', kind: 'link', label: 'Home', url: '/', meta: { color: 'blue', badge: 'gone' }, children: [] }] }, { principal: admin });
        expect(menu.items[0]!.meta).toEqual({ color: 'blue' });
        await expect(cms.menus.update(menu.id, { items: [{ id: 'home', kind: 'link', label: 'Home', url: '/', meta: { color: 'purple' }, children: [] }] }, { principal: admin, expectedRevision: menu.revision }))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('Home') });
        const views = await cms.menus.resolve(menu.items);
        expect(views[0]!.meta).toEqual({ color: 'blue' });
    });

    it('drops a group: entries keep their values, the index goes, and the names free up', async () => {
        await cms.deleteFieldGroup('specs', admin);
        expect(cms.resourceById('cms/products').fields.specs).toBeUndefined();
        const info = await cms.db.read([{ rql: 'INFO FOR TABLE r__cms__products' }]);
        expect((info.results[0]!.rows[0]![0] as { indexes: { name: string }[] }).indexes.map(index => index.name)).not.toContain('r__cms__products__r_specs__name');
        const entries = cms.resource('cms/products');
        const skates = (await entries.list({ where: { sku: 'RS-1' } }, { principal: editor })).records[0]!;
        expect(skates).not.toHaveProperty('specs');
        await expect(cms.deleteFieldGroup('specs', admin)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await cms.saveFieldGroup({ ...specs, blocks: [fieldBlock('specs', 'text', { name: 'specs', label: 'Specs as text' })] }, admin);
        expect(cms.resourceById('cms/products').fields.specs).toMatchObject({ kind: 'string' });
    });

    it('turns a stored layout of an older version into a group on load and promotes its content field', async () => {
        const legacy = {
            name: 'events', label: 'Events', singular: 'Event', icon: 'calendar', path: 'events', slug: true, publishable: true, taxonomies: [], builtin: false,
            fields: { content: field.blocks({ search: true, label: 'Content' }), venue: field.string({ label: 'Venue' }) }, fieldOrder: ['content', 'venue'],
            layout: [fieldBlock('content', 'blocks', { name: 'content', label: 'Content' }), fieldBlock('venue', 'text', { name: 'venue', label: 'Venue', max: 80 })],
            template: [{ _id: 'text', type: 'core/richtext', data: {} }],
        };
        await cms.db.write([{ rql: 'INSERT INTO cms_collections (name, definition, updated_at, updated_by) VALUES ($name, $definition, $now, $by)', params: { $name: 'events', $definition: JSON.stringify(legacy), $now: Date.now(), $by: 'test' } }], { kind: 'test' });
        const other = createCMS({ db: service.database(), modules: [contentModule] });
        await other.ready();
        const events = other.collection('events');
        expect(events.layout).toBeUndefined();
        expect(events.fields).toEqual({});
        expect(events.features).toEqual({ content: true });
        expect(events.template).toEqual(legacy.template);
        const group = (await other.fieldGroups.get('events-fields'))!;
        expect(group.title).toBe('Events fields');
        expect(group.targets).toEqual([{ kind: 'collection', name: 'events', order: -1 }]);
        expect(group.blocks.map(block => block.data.name)).toEqual(['venue']);
        expect(Object.keys(other.resourceById('cms/events').fields)).toEqual(expect.arrayContaining(['content', 'venue']));
        expect(other.resourceById('cms/events').fields.venue).toMatchObject({ kind: 'string', max: 80 });
        // Loading again converts nothing more.
        const again = createCMS({ db: service.database(), modules: [contentModule] });
        await again.ready();
        expect((await again.fieldGroups.get('events-fields'))!.blocks).toEqual(group.blocks);
        const stored = await again.db.read([{ rql: "SELECT definition FROM cms_collections WHERE name = 'events'" }]);
        expect(JSON.parse(stored.results[0]!.rows[0]![0] as string)).not.toHaveProperty('layout');
        await again.deleteCollection('events', admin);
        expect((await again.fieldGroups.get('events-fields'))!.targets).toEqual([]);
    });
});

/** A shop plugin that ships a Shipping group for products and a Shipping tab holding it. */
const shop = {
    name: 'shop', version: '1.0.0',
    manifest: {
        schemaVersion: 1, name: 'shop', version: '1.0.0',
        fieldGroups: [{ id: 'shop-shipping', title: 'Shipping', targets: [{ kind: 'collection', name: 'products' }], blocks: [fieldBlock('weight', 'number', { name: 'weight', label: 'Weight', min: 0, index: true })] }],
        editor: [{ collection: 'products', tabs: [{ _id: 'shipping', type: 'editor/tab', data: { label: 'Shipping' }, children: [{ _id: 'box', type: 'editor/box', data: { box: 'group:shop-shipping' } }] }] }],
    },
};

describe.skipIf(!live)('editor layouts and plugin field groups', () => {
    const service = romedbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], plugins: [shop] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        await cms.saveCollection(products, admin);
    }, 30_000);

    it('stores a collection\'s editor layout and refuses an invalid one', async () => {
        const layout = { tabs: [{ _id: 'edit', type: 'editor/tab', data: { label: 'Product' }, children: [{ _id: 'content', type: 'editor/box', data: { box: 'field:content' } }] }], sidebar: [] };
        const saved = await cms.saveCollection({ ...products, editor: layout }, admin);
        expect(saved.editor).toEqual(layout);
        expect(cms.collection('products').editor).toEqual(layout);
        const other = createCMS({ db: service.database(), modules: [contentModule], plugins: [shop] });
        await other.ready();
        expect(other.collection('products').editor).toEqual(layout);
        await expect(cms.saveCollection({ ...products, editor: { tabs: [{ _id: 'main', type: 'editor/tab', data: { label: 'Main' } }], sidebar: [] } }, admin))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('The first tab is edit.') });
        // A built-in collection keeps a stored layout beside the module's definition.
        const posts = cms.collection('posts');
        await cms.saveCollection({ ...posts, editor: layout }, admin);
        expect(cms.collection('posts').editor).toEqual(layout);
        expect(cms.builtinCollection('posts')!.editor).toBeUndefined();
    });

    it('seeds a plugin\'s field groups when it is granted, read-only and attached by the manifest; its tabs apply while it is active', async () => {
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(group => group.id)).toEqual([]);
        expect(cms.editorLayoutAdditions('products')).toEqual([]);
        await cms.grantPlugin('shop', admin);
        const shipping = (await cms.fieldGroups.get('shop-shipping'))!;
        expect(shipping).toMatchObject({ plugin: 'shop', title: 'Shipping', targets: [{ kind: 'collection', name: 'products' }] });
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(group => group.id)).toEqual(['shop-shipping']);
        expect(cms.resourceById('cms/products').fields.weight).toMatchObject({ kind: 'number', index: true });
        expect(cms.editorLayoutAdditions('products')).toEqual([{ plugin: 'shop', layout: { tabs: shop.manifest.editor[0]!.tabs, sidebar: [] } }]);
        const entry = await cms.resource('cms/products').create({ title: 'Crate', weight: 12 }, { principal: admin });
        expect(entry.weight).toBe(12);
        // The dashboard cannot change, detach or delete it; the manifest owns it.
        await expect(cms.saveFieldGroup({ ...shipping, title: 'Delivery' }, admin)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.deleteFieldGroup('shop-shipping', admin)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await cms.saveCollection(cms.collection('products'), admin, { groups: [] });
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(group => group.id)).toEqual(['shop-shipping']);
        // Disabled: the tab goes, the group and its values stay.
        await cms.revokePlugin('shop', admin);
        expect(cms.editorLayoutAdditions('products')).toEqual([]);
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(group => group.id)).toEqual(['shop-shipping']);
        expect((await cms.resource('cms/products').get(entry.id, { principal: admin }))?.weight).toBe(12);
    });
});
