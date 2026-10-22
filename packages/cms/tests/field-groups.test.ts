import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, field, type Block, type CmsHost, type CollectionDefinition, type FieldGroup, type Principal } from '../src/server/index';
import { fastdbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const editor: Principal = { kind: 'user', id: 'editor-1', roles: ['editor'], permissions: [...DEFAULT_ROLES[1].permissions] };

const fieldBlock = (id: string, kind: string, data: { [key: string]: unknown }, extra: Partial<Block> = {}): Block => ({ id, type: `field/${kind}`, data: { label: id, ...data }, ...extra });

/** Products: a layout of two columns and a pricing tab, saved with the collection. */
const products: CollectionDefinition = {
    name: 'products', label: 'Products', singular: 'Product', icon: 'box', path: 'shop', fields: {},
    layout: [
        { id: 'cols', type: 'core/columns', data: {}, children: [
            { id: 'c1', type: 'core/column', data: {}, children: [fieldBlock('sku', 'text', { name: 'sku', label: 'SKU', unique: true, max: 40 })] },
            { id: 'c2', type: 'core/column', data: {}, children: [fieldBlock('price', 'number', { name: 'price', label: 'Price', min: 0, required: true, index: true })] },
        ] },
        { id: 'tabs', type: 'core/tabs', data: {}, children: [{ id: 'sale', type: 'core/tab', data: { label: 'Sale' }, children: [
            fieldBlock('onSale', 'boolean', { name: 'onSale', label: 'On sale' }),
            fieldBlock('salePrice', 'number', { name: 'salePrice', label: 'Sale price', min: 0, required: true }, { when: { rules: [{ field: 'onSale', op: 'is', value: 'true' }] } }),
        ] }] },
    ],
};

/** Specifications: a repeater with a nested notes repeater, attached to products. */
const specs: FieldGroup = {
    id: 'specs', title: 'Specifications', placement: 'main', targets: [{ kind: 'collection', name: 'products' }],
    blocks: [
        { id: 'h', type: 'core/heading', data: { text: 'Specifications' } },
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
        fieldBlock('color', 'choice', { name: 'color', label: 'Colour', choices: ['red', 'blue'] }),
        fieldBlock('badge', 'text', { name: 'badge', label: 'Badge', max: 20 }, { when: { rules: [{ field: 'color', op: 'is', value: 'red' }] } }),
        fieldBlock('links', 'repeater', { name: 'links', label: 'Links' }, { children: [fieldBlock('href', 'text', { name: 'href', label: 'URL', required: true })] }),
    ],
};

describe.skipIf(!live)('field groups', () => {
    const service = fastdbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('compiles a collection layout to fields and attaches a group with a repeater', async () => {
        const saved = await cms.saveCollection(products, admin);
        expect(Object.keys(saved.fields)).toEqual(['sku', 'price', 'onSale', 'salePrice']);
        expect(saved.fields.price).toMatchObject({ kind: 'number', required: true, min: 0, index: true });
        expect(saved.layout?.map(block => block.id)).toEqual(['cols', 'tabs']);

        await expect(cms.saveFieldGroup({ ...specs, targets: [{ kind: 'collection', name: 'nope' }] }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('nope') });
        await expect(cms.saveFieldGroup({ ...specs, blocks: [fieldBlock('x', 'text', { name: 'price', label: 'Price' })] }, admin)).rejects.toMatchObject({ message: expect.stringContaining('used by the target') });
        await expect(cms.saveFieldGroup(specs, editor)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const group = await cms.saveFieldGroup(specs, admin);
        expect(group.blocks[1]!.children!.map(block => block.data.name)).toEqual(['name', 'kind', 'url', 'notes']);
        expect(cms.fieldGroupsFor({ kind: 'collection', name: 'products' }).map(entry => entry.id)).toEqual(['specs']);

        const resource = cms.resourceById('cms/products');
        expect(resource.fields.specs).toMatchObject({ kind: 'rows', max: 10 });
        expect(resource.fields.specs__name).toMatchObject({ kind: 'list', items: 'string', index: true, derived: ['specs', 'name'] });
        expect(resource.fields.specs__notes__tag).toMatchObject({ derived: ['specs', 'notes', 'tag'] });
        const info = await cms.db.read([{ sql: 'INFO FOR TABLE r__cms__products' }]);
        const table = info.results[0]!.rows[0]![0] as { indexes: { name: string; kind: string }[] };
        expect(table.indexes.map(index => `${index.name}:${index.kind}`)).toEqual(expect.arrayContaining(['r__cms__products__price:scalar', 'r__cms__products__specs__name:array', 'r__cms__products__specs__notes__tag:array', 'r__cms__products__text:fulltext']));
    });

    it('stores rows with ids, keeps derived lists and search text, clears hidden fields and filters on row fields', async () => {
        const entries = cms.resource('cms/products');
        await expect(entries.create({ title: 'Bad', price: 1, specs: [{ kind: 'text' }] }, { principal: editor })).rejects.toMatchObject({ fields: { specs: 'row 1: Name is required.' } });
        await expect(entries.create({ title: 'Bad', price: 1, specs__name: ['x'] }, { principal: editor })).rejects.toMatchObject({ fields: { specs__name: 'is kept by the host.' } });
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

        const stored = await cms.db.read([{ sql: 'SELECT "specs__name", "specs__notes__tag", "_text_specs" FROM r__cms__products WHERE "sku" = $sku', params: { $sku: 'RS-1' } }]);
        expect(stored.results[0]!.rows[0]).toEqual([['Weight', 'Site'], ['fun', 'web'], 'Weight\nlight as air\nSite\nofficial']);

        const found = await entries.list({ where: { 'specs.notes.tag': { contains: 'web' } } }, { principal: editor });
        expect(found.records.map(record => record.title)).toEqual(['Rocket skates']);
        expect((await entries.list({ where: { 'specs.name': { containsAny: ['Nope'] } } }, { principal: editor })).records).toEqual([]);
        await expect(entries.list({ where: { specs__name: { contains: 'Weight' } } }, { principal: editor })).rejects.toMatchObject({ message: 'Cannot filter on specs__name.' });
        const plan = await cms.db.read([{ sql: 'EXPLAIN SELECT id FROM r__cms__products WHERE array::contains("specs__notes__tag", $tag)', params: { $tag: 'web' } }]);
        expect(JSON.stringify(plan.results[0]!.rows, (_, value) => typeof value === 'bigint' ? Number(value) : value)).toMatch(/r__cms__products__specs__notes__tag/);

        // Changing the rows keeps the derived lists current; the unique SKU still holds.
        const updated = await entries.update(entry.id, { specs: [{ _id: 'site', name: 'Site', kind: 'text' }] }, { principal: editor, expectedRevision: entry.rev });
        expect((updated.specs as { _id: string }[]).map(row => row._id)).toEqual(['site']);
        expect((await cms.db.read([{ sql: 'SELECT "specs__name", "specs__notes__tag" FROM r__cms__products WHERE "sku" = $sku', params: { $sku: 'RS-1' } }])).results[0]!.rows[0]).toEqual([['Site'], []]);
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
        const info = await cms.db.read([{ sql: 'INFO FOR TABLE r__cms__products' }]);
        expect((info.results[0]!.rows[0]![0] as { indexes: { name: string }[] }).indexes.map(index => index.name)).not.toContain('r__cms__products__specs__name');
        const entries = cms.resource('cms/products');
        const skates = (await entries.list({ where: { sku: 'RS-1' } }, { principal: editor })).records[0]!;
        expect(skates).not.toHaveProperty('specs');
        await expect(cms.deleteFieldGroup('specs', admin)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await cms.saveFieldGroup({ ...specs, blocks: [fieldBlock('specs', 'text', { name: 'specs', label: 'Specs as text' })] }, admin);
        expect(cms.resourceById('cms/products').fields.specs).toMatchObject({ kind: 'string' });
    });
});
