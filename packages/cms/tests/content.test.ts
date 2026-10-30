import { beforeAll, describe, expect, it } from 'vitest';
import type { StorageProvider } from '@cossackframework/core/storage';
import { contentModule, createCMS, DEFAULT_ROLES, userPrincipal, type CmsHost, type Principal } from '../src/server/index';
import { renameStoredBlockIds } from '../src/server/block-ids';
import type { RomeDB } from '@cossackframework/romedb';
import { romedbService, live } from './helpers';

const system: Principal = { kind: 'system', reason: 'test' };

function memoryStorage(): StorageProvider & { objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>();
    return {
        name: 'memory', objects,
        async put(key, body, options) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); return { key, size: options.size }; },
        async get(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! } : null; },
        async head(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length } : null; },
        async delete(key) { objects.delete(key); },
    };
}

describe.skipIf(!live)('content, taxonomies, settings, users and media', () => {
    const service = romedbService();
    let cms: CmsHost;
    let editor: Principal;
    let author: Principal;
    let otherAuthor: Principal;
    const storage = memoryStorage();
    let db: RomeDB;

    beforeAll(async () => {
        db = service.database();
        cms = createCMS({ db, modules: [contentModule], storage });
        expect((await cms.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        const principal = async (email: string, role: string) => (await cms.users.principal((await cms.users.create({ email, name: email.split('@')[0]!, roles: [role] })).id))!;
        editor = await principal('editor@example.com', 'editor');
        author = await principal('author@example.com', 'author');
        otherAuthor = await principal('other@example.com', 'author');
    }, 30_000);

    it('derives unique slugs from titles and keeps edited ones unique', async () => {
        const posts = cms.resource('cms/posts');
        const first = await posts.create({ title: 'Hello World' }, { principal: author });
        const second = await posts.create({ title: 'Hello world!' }, { principal: author });
        const typed = await posts.create({ title: 'Other', slug: 'hello-world' }, { principal: author });
        expect([first.slug, second.slug, typed.slug]).toEqual(['hello-world', 'hello-world-2', 'hello-world-3']);
        // Clearing the slug derives it again from the current title.
        const renamed = await posts.update(second.id, { title: 'Renamed post', slug: '' }, { principal: author, expectedRevision: 1 });
        expect(renamed.slug).toBe('renamed-post');
        // A record keeps its own slug on update.
        expect((await posts.update(first.id, { title: 'Hello World', slug: 'hello-world' }, { principal: author, expectedRevision: 1 })).slug).toBe('hello-world');
        expect((await posts.create({ title: '日本語' }, { principal: author })).slug).toBe('untitled');
    });

    it('keeps drafts private and publishes with a time', async () => {
        const posts = cms.resource('cms/posts');
        const draft = await posts.create({ title: 'Secret draft' }, { principal: author });
        expect(draft).toMatchObject({ status: 'draft', publishedAt: null });
        const anonymous = { kind: 'anonymous' } as const;
        expect(await posts.get(draft.id, { principal: anonymous })).toBeNull();
        expect(await posts.get(draft.id, { principal: otherAuthor })).toBeNull();
        expect(await posts.get(draft.id, { principal: author })).not.toBeNull();
        expect(await posts.get(draft.id, { principal: editor })).not.toBeNull();
        expect((await posts.list({}, { principal: anonymous })).records.map(record => record.id)).not.toContain(draft.id);
        expect((await posts.search('Secret', {}, { principal: anonymous }))).toEqual([]);
        await expect(posts.update(draft.id, { title: 'Taken' }, { principal: otherAuthor, expectedRevision: 1 })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        const published = await posts.update(draft.id, { status: 'published' }, { principal: author, expectedRevision: 1 });
        expect(published.publishedAt).toEqual(expect.any(Number));
        expect(await posts.get(draft.id, { principal: anonymous })).toMatchObject({ title: 'Secret draft' });
        expect((await posts.search('Secret', {}, { principal: anonymous })).map(record => record.id)).toEqual([draft.id]);
        // Subscribers and visitors cannot write posts.
        await expect(posts.create({ title: 'Nope' }, { principal: anonymous })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
    });

    it('filters, sorts, pages and counts records', async () => {
        const pages = cms.resource('cms/pages');
        for (const [index, status] of ['published', 'draft', 'trash', 'published'].entries()) {
            await pages.create({ title: `Filter ${index}`, status, menuOrder: index }, { principal: editor });
        }
        const context = { principal: editor };
        const filter = { title: { in: ['Filter 0', 'Filter 1', 'Filter 2', 'Filter 3'] } } as const;
        expect(await pages.countMany([{ where: filter }, { where: { ...filter, status: 'published' } }, { where: { ...filter, status: { ne: 'trash' } } }], context)).toEqual([4, 2, 3]);
        const sorted = await pages.list({ where: { ...filter, menuOrder: { gte: 1 } }, order: { field: 'menuOrder', direction: 'asc' }, limit: 2 }, context);
        expect(sorted.records.map(record => record.title)).toEqual(['Filter 1', 'Filter 2']);
        expect(sorted.more).toBe(true);
        const next = await pages.list({ where: { ...filter, menuOrder: { gte: 1 } }, order: { field: 'menuOrder', direction: 'asc' }, limit: 2, offset: 2 }, context);
        expect(next.records.map(record => record.title)).toEqual(['Filter 3']);
        expect(next.more).toBeUndefined();
        await expect(pages.list({ order: { field: 'content' } }, context)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await pages.count({ owner: editor.kind === 'user' ? editor.id : '' }, context)).toBeGreaterThanOrEqual(4);
    });

    it('nests pages without cycles', async () => {
        const pages = cms.resource('cms/pages');
        const parent = await pages.create({ title: 'About' }, { principal: editor });
        const child = await pages.create({ title: 'Team', parent: parent.id }, { principal: editor });
        await expect(pages.update(parent.id, { parent: child.id }, { principal: editor, expectedRevision: 1 })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { parent: 'would make a cycle.' } });
        await expect(pages.update(parent.id, { parent: parent.id }, { principal: editor, expectedRevision: 1 })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(pages.create({ title: 'Lost', parent: 'missing-page' }, { principal: editor })).rejects.toMatchObject({ fields: { parent: 'names a missing record.' } });
        // Ancestor chains come through the parent link in one request; an ancestor a visitor cannot read cuts the chain and hides the URL.
        const grandchild = await pages.create({ title: 'Leads', parent: child.id, status: 'published' }, { principal: editor });
        expect((await pages.ancestors([grandchild.id, parent.id], 'parent', { principal: editor })).get(grandchild.id)!.map(entry => entry.id)).toEqual([child.id, parent.id]);
        expect((await pages.ancestors([parent.id], 'parent', { principal: editor })).get(parent.id)).toEqual([]);
        expect((await pages.ancestors([grandchild.id], 'parent', { principal: { kind: 'anonymous' } })).get(grandchild.id)).toEqual([]);
        expect((await cms.entryUrls(cms.collection('pages'), [grandchild], { principal: editor })).get(grandchild.id)).toBe('/about/team/leads');
        expect((await cms.entryUrls(cms.collection('pages'), [grandchild])).get(grandchild.id)).toBeNull();
        // Authors cannot create pages.
        await expect(pages.create({ title: 'Mine' }, { principal: author })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
    });

    it('manages nested categories by path and lists posts by term', async () => {
        const terms = cms.taxonomies;
        await expect(terms.create('categories', { name: 'News' }, { principal: author })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const news = await terms.create('categories', { name: 'News' }, { principal: editor });
        const local = await terms.create('categories', { name: 'Local', parent: news.id }, { principal: editor });
        const city = await terms.create('categories', { name: 'City Hall', parent: local.id }, { principal: editor });
        const sports = await terms.create('categories', { name: 'Sports' }, { principal: editor });
        expect(city).toMatchObject({ slug: 'city-hall', depth: 2, path: `/${news.id}/${local.id}/${city.id}/` });
        expect((await terms.create('categories', { name: 'news' }, { principal: editor })).slug).toBe('news-2');
        expect((await terms.tree('categories')).map(term => `${'-'.repeat(term.depth)}${term.name}`)).toEqual(['news', 'News', '-Local', '--City Hall', 'Sports']);
        expect((await terms.subtree(news.id)).sort()).toEqual([news.id, local.id, city.id].sort());
        expect((await terms.ancestors(city)).map(term => term.name)).toEqual(['News', 'Local']);

        const posts = cms.resource('cms/posts');
        const report = await posts.create({ title: 'Council meets', status: 'published', categories: [city.id] }, { principal: editor });
        await posts.create({ title: 'Match day', status: 'published', categories: [sports.id] }, { principal: editor });
        await expect(posts.create({ title: 'Bad', categories: ['nope'] }, { principal: editor })).rejects.toMatchObject({ fields: { categories: 'names a missing term.' } });
        const under = async (id: string) => (await posts.list({ where: { categories: { containsAny: await terms.subtree(id) } } }, { principal: { kind: 'anonymous' } })).records.map(record => record.title);
        expect(await under(news.id)).toEqual(['Council meets']);
        expect((await terms.counts('categories', [city.id, sports.id, news.id])).get(city.id)).toBe(1);

        // Move Local under Sports: the subtree's paths change in one batch.
        await expect(terms.update(news.id, { parent: city.id }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const moved = await terms.update(local.id, { parent: sports.id }, { principal: editor });
        expect(moved).toMatchObject({ parent: sports.id, depth: 1, path: `/${sports.id}/${local.id}/` });
        expect(await terms.get(city.id)).toMatchObject({ depth: 2, path: `/${sports.id}/${local.id}/${city.id}/` });
        expect(await under(news.id)).toEqual([]);
        expect((await under(sports.id)).sort()).toEqual(['Council meets', 'Match day']);

        // Deleting Local moves City Hall up to Sports.
        await terms.delete(local.id, { principal: editor });
        expect(await terms.get(city.id)).toMatchObject({ parent: sports.id, depth: 1, path: `/${sports.id}/${city.id}/` });
        expect((await posts.get(report.id, { principal: editor }))!.categories).toEqual([city.id]);
    });

    it('renames stored block IDs on the automatic upgrade, collections stored with id included', async () => {
        const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
        await cms.saveCollection({ name: 'notes', label: 'Notes', singular: 'Note', icon: 'notebook', path: 'notes', fields: {}, features: { content: true }, template: [{ _id: 'lead', type: 'core/paragraph', data: { text: 'Lead' } }] }, admin);
        expect((await cms.migrate()).failed).toBeUndefined();
        const note = await cms.resource('cms/notes').create({ title: 'Old note', content: [{ _id: 'a', type: 'core/paragraph', data: { text: 'A' } }] }, { principal: editor });
        const { storage: table } = cms.resourceById('cms/notes');
        // As stored before host step 12: `id` in the collection's template and in the record, and the step not yet applied.
        const stored = JSON.parse((await db.read([{ rql: "SELECT definition FROM cms_collections WHERE name = 'notes'" }])).results[0]!.rows[0]![0] as string) as { template: unknown };
        await db.write([
            { rql: "UPDATE cms_collections SET definition = $definition WHERE name = 'notes'", params: { $definition: JSON.stringify({ ...stored, template: [{ id: 'lead', type: 'core/paragraph', data: { text: 'Lead' } }] }) } },
            { rql: `UPDATE ${table} SET "content" = $content WHERE id = type::record('${table}', $key)`, params: { $content: [{ id: 'a', type: 'core/paragraph', data: { text: 'A' } }], $key: note.id } },
            { rql: "DELETE FROM cms_migrations WHERE id = 'cms#host-12'" },
        ]);
        const upgraded = createCMS({ db, modules: [contentModule] });
        await upgraded.ready();
        expect(upgraded.collections().map(collection => collection.name)).toContain('notes');
        expect(upgraded.collection('notes').template).toEqual([{ _id: 'lead', type: 'core/paragraph', data: { text: 'Lead' } }]);
        expect((await upgraded.resource('cms/notes').get(note.id, { principal: editor }))!.content).toEqual([{ _id: 'a', type: 'core/paragraph', data: { text: 'A' } }]);
    });

    it('rewrites block trees stored with id to _id once', async () => {
        const posts = cms.resource('cms/posts');
        const post = await posts.create({ title: 'Old blocks', content: [{ _id: 'keep', type: 'core/paragraph', data: { text: 'New' } }] }, { principal: editor });
        const { storage: table } = cms.resourceById('cms/posts');
        // A tree as versions before host step 12 stored it.
        await db.write([{ rql: `UPDATE ${table} SET "content" = $content WHERE id = type::record('${table}', $key)`, params: { $content: [{ id: 'old', type: 'core/columns', data: {}, children: [{ id: 'inner', type: 'core/paragraph', data: { text: 'Old' } }] }], $key: post.id } }], { kind: 'test' });
        expect(await renameStoredBlockIds(db, cms.resources)).toBe(1);
        expect((await posts.get(post.id, { principal: editor }))!.content).toEqual([{ _id: 'old', type: 'core/columns', data: {}, children: [{ _id: 'inner', type: 'core/paragraph', data: { text: 'Old' } }] }]);
        expect(await renameStoredBlockIds(db, cms.resources)).toBe(0);
    });

    it('creates typed tags for writers and applies the default category', async () => {
        const terms = cms.taxonomies;
        const ids = await terms.ensure('tags', ['Breaking', 'breaking', ' Weather '], { principal: author });
        expect(ids).toHaveLength(2);
        expect(await terms.ensure('tags', ['Weather'], { principal: author })).toEqual([ids[1]]);
        await expect(terms.ensure('tags', ['Spam'], { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const fallback = await terms.create('categories', { name: 'Uncategorized' }, { principal: editor });
        await cms.settings.update('writing', { defaultCategory: fallback.id }, { principal: system });
        const post = await cms.resource('cms/posts').create({ title: 'Tagged', tags: ids }, { principal: author });
        expect(post).toMatchObject({ tags: ids, categories: [fallback.id] });
    });

    it('stores validated settings with defaults', async () => {
        expect(await cms.settings.get('general.siteTitle')).toBe('My Site');
        await expect(cms.settings.update('general', { siteTitle: 'News' }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.settings.update('reading', { postsPerPage: 0 }, { principal: system })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { postsPerPage: expect.any(String) } });
        await expect(cms.settings.update('reading', { unknown: 1 }, { principal: system })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const values = await cms.settings.update('general', { siteTitle: 'The Daily', usersCanRegister: true }, { principal: system });
        expect(values).toMatchObject({ 'general.siteTitle': 'The Daily', 'general.usersCanRegister': true, 'reading.postsPerPage': 10 });
        // Another host reads the stored values.
        const other = createCMS({ db: service.database(), modules: [contentModule] });
        expect(await other.settings.get('general.siteTitle')).toBe('The Daily');
    });

    it('lists, searches and deletes users and roles, and resets passwords once', async () => {
        const users = cms.users;
        const created = await users.create({ email: 'Grace@Example.com', name: 'Grace Hopper', password: 'first password', roles: ['subscriber'] });
        const page = await users.list({ search: 'grace', limit: 5 });
        expect(page).toMatchObject({ total: 1, items: [{ email: 'grace@example.com', roles: ['subscriber'] }] });
        expect((await users.list({ role: 'author' })).total).toBe(2);
        expect((await users.list({ search: '%' })).total).toBe(0);
        await expect(users.update(created.id, { email: 'editor@example.com' })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await users.update(created.id, { name: 'Grace B. Hopper', avatar: 'https://example.com/a.png' });
        expect(await users.get(created.id)).toMatchObject({ name: 'Grace B. Hopper', avatar: 'https://example.com/a.png' });
        await expect(users.update(created.id, { avatar: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });

        const role = await users.createRole({ name: 'Moderator', permissions: ['cms:dashboard'] });
        expect(role.id).toBe('moderator');
        await expect(users.createRole({ name: 'Moderator', permissions: [] })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await users.setRoles(created.id, ['moderator']);
        expect((await users.roles()).find(entry => entry.id === 'moderator')).toMatchObject({ userCount: 1 });
        await expect(users.deleteRole('admin')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await users.deleteRole('moderator')).toBe(true);
        expect((await users.get(created.id))!.roles).toEqual([]);

        expect(await users.createPasswordReset('nobody@example.com')).toBeNull();
        const reset = (await users.createPasswordReset('grace@example.com'))!;
        await expect(users.resetPassword(reset.token, 'short')).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('consumes a reset token once and ends sessions', async () => {
        const users = cms.users;
        await users.create({ email: 'reset@example.com', name: 'Reset', password: 'first password' });
        const reset = (await users.createPasswordReset('reset@example.com'))!;
        const stored = await cms.db.read([{ rql: 'SELECT id FROM cms_password_resets WHERE user_id = $user', params: { $user: reset.user.id } }]);
        expect(stored.results[0]!.rows[0]![0]).not.toBe(reset.token);
        const [first, second] = await Promise.all([users.resetPassword(reset.token, 'second password'), users.resetPassword(reset.token, 'third password')]);
        expect([first, second].filter(Boolean)).toHaveLength(1);
        expect(await users.verifier.verify('reset@example.com', first ? 'second password' : 'third password')).toMatchObject({ email: 'reset@example.com' });
        expect(await users.resetPassword(reset.token, 'fourth password')).toBe(false);
    });

    it('deletes a user with their sessions', async () => {
        const user = await cms.users.create({ email: 'gone@example.com', name: 'Gone', password: 'long password' });
        await cms.authSessions.create({ id: 'a'.repeat(64), userId: user.id, kind: 'auth', createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
        expect(await cms.users.delete(user.id)).toBe(true);
        expect(await cms.authSessions.read('a'.repeat(64))).toBeNull();
        expect(await cms.users.get(user.id)).toBeNull();
    });

    it('accepts media by signature, records image sizes and lists the library', async () => {
        const files = cms.files!;
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 48, 8, 6, 0, 0, 0]);
        const upload = (name: string, contentType: string, bytes: Uint8Array, principal: Principal) =>
            files.upload({ name, contentType, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! }, { principal });
        await expect(upload('evil.png', 'image/png', new TextEncoder().encode('<html><script>alert(1)</script>'), author)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(upload('page.svg', 'image/svg+xml', new TextEncoder().encode('<svg/>'), author)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(upload('x.png', 'image/png', png, { kind: 'anonymous' })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        const image = await upload('Sunset over the bay.png', 'image/png', png, author);
        expect(image).toMatchObject({ title: 'Sunset over the bay', width: 64, height: 48, contentType: 'image/png' });
        await upload('notes.txt', 'text/plain', new TextEncoder().encode('plain notes'), author);
        expect((await files.list({ kind: 'image' })).items.map(file => file.id)).toEqual([image.id]);
        expect((await files.list({ search: 'notes' })).total).toBe(1);
        await expect(files.update(image.id, { alt: 'Not mine' }, { principal: otherAuthor })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await files.update(image.id, { alt: 'The sun sets' }, { principal: editor })).toMatchObject({ alt: 'The sun sets' });

        const posts = cms.resource('cms/posts');
        const post = await posts.create({ title: 'With image', featuredImage: image.id }, { principal: author });
        expect(post.featuredImage).toBe(image.id);
        await expect(posts.create({ title: 'Missing image', featuredImage: 'missing' }, { principal: author })).rejects.toMatchObject({ fields: { featuredImage: 'names a missing file.' } });
        await files.delete(image.id, { principal: author });
        expect(storage.objects.has(`cms/files/${image.id}`)).toBe(false);
    });

    it('stores avatars, animated ones included, for their user or a user manager', async () => {
        const gif = new TextEncoder().encode('GIF89a\x01\x00\x01\x00\x00\x00\x00;');
        const body = (bytes: Uint8Array) => ({ name: 'me.gif', contentType: 'image/gif', size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! });
        const subscriber = (await cms.users.principal((await cms.users.create({ email: 'reader@example.com', name: 'Reader', roles: ['subscriber'] })).id))!;
        const id = subscriber.kind === 'user' ? subscriber.id : '';
        // A subscriber cannot upload media, but may set their own picture.
        const url = await cms.uploadAvatar(id, body(gif), { principal: subscriber });
        expect(url).toMatch(/^\/media\/[0-9a-f-]{36}\/me\.gif$/);
        expect((await cms.users.get(id))!.avatar).toBe(url);
        const file = await cms.files!.get(url.split('/')[2]!);
        expect(file).toMatchObject({ owner: id, title: 'Avatar of Reader', contentType: 'image/gif' });
        await expect(cms.uploadAvatar(id, body(gif), { principal: author })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.uploadAvatar(id, { ...body(new TextEncoder().encode('plain')), name: 'a.txt', contentType: 'text/plain' }, { principal: subscriber })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const admin = { kind: 'user' as const, id: 'admin-1', roles: ['admin'], permissions: ['*'] };
        expect(await cms.uploadAvatar(id, body(gif), { principal: admin })).toMatch(/^\/media\//);
    });
});
