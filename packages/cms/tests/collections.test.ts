import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, field, type CmsHost, type CollectionDefinition, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const editor: Principal = { kind: 'user', id: 'editor-1', roles: ['editor'], permissions: [...DEFAULT_ROLES[1].permissions] };

const products: CollectionDefinition = {
    name: 'products',
    label: 'Products',
    singular: 'Product',
    icon: 'box',
    path: 'shop',
    taxonomies: ['brands'],
    features: { content: { blocks: ['core/paragraph', 'core/heading', 'core/button'] } },
    fields: {
        price: field.number({ required: true, min: 0, label: 'Price' }),
        sku: field.string({ max: 40, unique: true, label: 'SKU' }),
    },
};

describe.skipIf(!live)('collections built in the dashboard', () => {
    const service = romedbService();
    let cms: CmsHost;
    const plugin = { name: 'promo', version: '1.0.0', manifest: { schemaVersion: 1, name: 'promo', version: '1.0.0', blocks: [{ name: 'promo/banner', label: 'Banner', fields: { text: field.string({ required: true }) } }] } };

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], plugins: [plugin] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('creates a collection with its own taxonomy and stores entries schemaless', async () => {
        await expect(cms.saveCollection(products, editor)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.saveCollection(products, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('brands') });
        await cms.saveTaxonomy({ name: 'brands', label: 'Brands', singular: 'Brand', hierarchical: false, path: 'brand' }, admin);
        const saved = await cms.saveCollection(products, admin);
        expect(saved).toMatchObject({ name: 'products', taxonomies: ['brands'] });
        expect(cms.collections().map(collection => collection.name)).toEqual(['pages', 'patterns', 'posts', 'products']);
        const info = await cms.db.read([{ rql: 'INFO FOR TABLE r__cms__products' }]);
        const table = info.results[0]!.rows[0]![0] as { strict: boolean; fields: { path: string[] }[]; indexes: { name: string; kind: string }[] };
        expect(table.strict).toBe(false);
        expect(table.fields.map(entry => entry.path[0])).toEqual(['_rev', '_op', '_createdAt', '_updatedAt', '_owner']);
        expect(table.indexes.map(index => `${index.name}:${index.kind}`)).toEqual(expect.arrayContaining(['r__cms__products__u_sku:scalar', 'r__cms__products__brands:array', 'r__cms__products__text:fulltext']));

        const brand = (await cms.taxonomies.ensure('brands', ['Acme'], { principal: editor }))[0]!;
        const entries = cms.resource('cms/products');
        const entry = await entries.create({
            title: 'Rocket skates', price: 19.5, sku: 'RS-1', brands: [brand], status: 'published',
            content: [{ id: 'intro', type: 'core/heading', data: { text: 'Fast' } }, { id: 'buy', type: 'core/button', data: { label: 'Buy', url: '/shop/rocket-skates' } }],
        }, { principal: editor });
        expect(entry).toMatchObject({ slug: 'rocket-skates', price: 19.5, publishedAt: expect.any(Number) });
        expect(entry.content).toEqual([
            { id: 'intro', type: 'core/heading', data: { text: 'Fast', level: 'h2' } },
            { id: 'buy', type: 'core/button', data: { label: 'Buy', url: '/shop/rocket-skates', style: 'primary' } },
        ]);
        await expect(entries.create({ title: 'Bad', price: 1, content: [{ id: 'x', type: 'core/image', data: {} }] }, { principal: editor }))
            .rejects.toMatchObject({ fields: { content: expect.stringContaining('not an available block') } });
        await expect(entries.create({ title: 'Bad', price: 1, content: [{ id: 'x', type: 'core/button', data: { label: 'Go', url: 'javascript:alert(1)' } }] }, { principal: editor }))
            .rejects.toMatchObject({ fields: { content: expect.stringContaining('x.url') } });
        await expect(entries.create({ title: 'Clash', price: 1, sku: 'RS-1' }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect((await entries.list({ where: { brands: { contains: brand } } }, { principal: { kind: 'anonymous' } })).records.map(record => record.title)).toEqual(['Rocket skates']);
        expect((await entries.search('rocket', {}, { principal: { kind: 'anonymous' } })).map(record => record.id)).toEqual([entry.id]);
    });

    it('changes fields without DDL, drops indexes it no longer needs, and tolerates old values', async () => {
        const entries = cms.resource('cms/products');
        const before = (await entries.list({}, { principal: admin })).records[0]!;
        const changed: CollectionDefinition = {
            ...products, features: {},
            fields: { price: field.string({ label: 'Price text' }), sku: field.string({ max: 40, label: 'SKU' }), color: field.enum(['red', 'blue'], { default: 'red', label: 'Color' }) },
        };
        await cms.saveCollection(changed, admin);
        const info = await cms.db.read([{ rql: 'INFO FOR TABLE r__cms__products' }]);
        const indexes = (info.results[0]!.rows[0]![0] as { indexes: { name: string }[] }).indexes.map(index => index.name);
        expect(indexes).not.toContain('r__cms__products__u_sku');
        const after = (await entries.get(before.id, { principal: admin }))!;
        // The stored number no longer fits the text field: it reads as the default.
        expect(after).toMatchObject({ price: null, color: 'red', sku: 'RS-1' });
        expect(after).not.toHaveProperty('content');
        const updated = await entries.update(before.id, { price: 'on request', color: 'blue' }, { principal: admin, expectedRevision: after.rev });
        expect(updated).toMatchObject({ price: 'on request', color: 'blue' });
        await cms.saveCollection(products, admin);
    });

    it('lets another isolate pick up a changed collection without waiting', async () => {
        const other = createCMS({ db: service.database(), modules: [contentModule], plugins: [plugin] });
        await other.ready();
        expect((await other.resource('cms/products').list({}, { principal: admin })).records).toHaveLength(1);
        await cms.saveCollection({ ...products, fields: { ...products.fields, weight: field.number({ label: 'Weight' }) } }, admin);
        // The other host still holds the old definition; its next write reloads it.
        const entry = await other.resource('cms/products').create({ title: 'Heavy', price: 3, weight: 2.5 }, { principal: admin });
        expect(entry).toMatchObject({ weight: 2.5 });
    });

    it('extends built-in collections and keeps their core fields', async () => {
        await expect(cms.deleteCollection('posts', admin)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.saveCollection({ ...cms.collection('posts'), fields: { title: field.string() } }, admin)).rejects.toMatchObject({ message: expect.stringContaining('title is a core field') });
        const extended = await cms.saveCollection({ ...cms.collection('posts'), label: 'Articles', path: 'blog', fields: { ...cms.collection('posts').fields, subtitle: field.string({ max: 120, label: 'Subtitle' }) } }, admin);
        expect(extended).toMatchObject({ label: 'Articles', path: 'blog', builtin: true });
        expect(Object.keys(extended.fields)).toEqual(['sticky', 'subtitle']);
        expect(extended.features).toEqual({ content: true, excerpt: true, featuredImage: true });
        expect(Object.keys(cms.resourceById('cms/posts').fields)).toEqual(expect.arrayContaining(['subtitle', 'content', 'featuredImage', 'sticky']));
        const post = await cms.resource('cms/posts').create({ title: 'With subtitle', subtitle: 'Below the title' }, { principal: admin });
        expect(post).toMatchObject({ subtitle: 'Below the title', slug: 'with-subtitle' });
        const stored = await cms.db.read([{ rql: "SELECT definition FROM cms_collections WHERE name = 'posts'" }]);
        expect(Object.keys(JSON.parse(stored.results[0]!.rows[0]![0] as string).fields)).toEqual(['subtitle']);
    });

    it('offers plugin blocks only while the plugin is active', async () => {
        expect((await cms.blocks()).map(block => block.name)).not.toContain('promo/banner');
        expect(cms.blockTypes.has('promo/banner')).toBe(true);
        await cms.grantPlugin('promo', admin);
        expect((await cms.blocks()).map(block => block.name)).toContain('promo/banner');
    });

    it('deletes collections and taxonomies only when nothing depends on them', async () => {
        await expect(cms.deleteTaxonomy('brands', admin)).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await expect(cms.deleteTaxonomy('categories', admin)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await cms.deleteCollection('products', admin);
        // Posts were relabelled Articles above, so they sort first.
        expect(cms.collections().map(collection => collection.name)).toEqual(['posts', 'pages', 'patterns']);
        expect(() => cms.resource('cms/products')).toThrow(/Unknown resource/);
        const tables = await cms.db.read([{ rql: 'INFO FOR DB' }]);
        expect((tables.results[0]!.rows[0]![0] as { tables: { name: string }[] }).tables.map(table => table.name)).not.toContain('r__cms__products');
        await cms.deleteTaxonomy('brands', admin);
        expect(cms.taxonomies.declarations.map(taxonomy => taxonomy.name)).toEqual(['categories', 'tags']);
    });
});
