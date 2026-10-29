import { beforeAll, describe, expect, it } from 'vitest';
import { ANONYMOUS, contentModule, createCMS, DEFAULT_ROLES, type CmsHost, type MenuItem, type Principal, type RichTextDoc } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const editor: Principal = { kind: 'user', id: 'editor-1', roles: ['editor'], permissions: [...DEFAULT_ROLES[1].permissions] };
const noop = () => null;
const themeUi = { theme: { layout: noop, entry: noop, archive: noop } };

const plugins = [
    { name: 'paper', version: '1.0.0', ui: themeUi, assets: { 'assets/logo.svg': '/assets/logo-1.svg', 'assets/shot.png': '/assets/shot-2.png' },
        manifest: { schemaVersion: 1, name: 'paper', version: '1.0.0', cover: 'assets/shot.png', theme: {
        label: 'Paper', locations: { primary: 'Primary menu', footer: 'Footer menu' },
        options: { accent: { kind: 'enum', values: ['blue', 'rose'], default: 'blue', label: 'Accent' } },
    } } },
    { name: 'ink', version: '1.0.0', ui: themeUi, manifest: { schemaVersion: 1, name: 'ink', version: '1.0.0', theme: { label: 'Ink', locations: { primary: 'Top', sidebar: 'Sidebar' } } } },
    // Declares a theme but its ui.ts does not export the templates.
    { name: 'broken', version: '1.0.0', ui: {}, manifest: { schemaVersion: 1, name: 'broken', version: '1.0.0', theme: { label: 'Broken' } } },
];

describe.skipIf(!live)('themes, menus and rich text', () => {
    const service = romedbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], plugins });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('lists themes from plugins and switches the active one', async () => {
        expect(cms.themes().map(theme => [theme.name, theme.problems.length > 0])).toEqual([['ink', false], ['paper', false], ['broken', true]]);
        // The manifest names the cover; the logo is found by its conventional name; ink has neither.
        expect(cms.themes().map(theme => [theme.name, theme.logo, theme.cover])).toEqual([['ink', null, null], ['paper', '/assets/logo-1.svg', '/assets/shot-2.png'], ['broken', null, null]]);
        // Theme-only plugins have nothing to grant.
        expect((await cms.status()).plugins.find(plugin => plugin.name === 'paper')).toMatchObject({ active: true, themeOnly: true, missing: [], logo: '/assets/logo-1.svg' });
        // Nothing chosen yet: the first usable theme by name.
        expect(await cms.activeTheme()).toBe('ink');
        await expect(cms.activateTheme('paper', editor)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.activateTheme('broken', admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.activateTheme('paper', admin);
        expect(await cms.activeTheme()).toBe('paper');
        expect((await cms.menuLocations()).map(location => `${location.name}:${location.active}`)).toEqual(['primary:true', 'footer:true', 'sidebar:false']);
        // Theme options are a settings group under the appearance permission.
        expect((await cms.settings.all())['paper.accent']).toBe('blue');
        await expect(cms.settings.update('paper', { accent: 'rose' }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect((await cms.settings.update('paper', { accent: 'rose' }, { principal: admin }))['paper.accent']).toBe('rose');
        await expect(cms.settings.update('paper', { accent: 'green' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('saves menus with a revision check and resolves them for visitors', async () => {
        const pages = cms.resource('cms/pages');
        const about = await pages.create({ title: 'About', status: 'published' }, { principal: admin });
        const team = await pages.create({ title: 'Team', parent: about.id, status: 'published' }, { principal: admin });
        const draft = await pages.create({ title: 'Secret plans', status: 'draft' }, { principal: admin });
        const draftChild = await pages.create({ title: 'Visible child', status: 'published' }, { principal: admin });
        const news = (await cms.taxonomies.create('categories', { name: 'News' }, { principal: admin }));
        const items: MenuItem[] = [
            { id: 'home', kind: 'link', label: 'Home', url: '/', children: [] },
            { id: 'about', kind: 'entry', label: '', collection: 'pages', entry: about.id, children: [
                { id: 'team', kind: 'entry', label: 'Our team', collection: 'pages', entry: team.id, children: [] },
            ] },
            { id: 'secret', kind: 'entry', label: '', collection: 'pages', entry: draft.id, children: [
                { id: 'child', kind: 'entry', label: '', collection: 'pages', entry: draftChild.id, children: [] },
            ] },
            { id: 'blog', kind: 'archive', label: '', collection: 'posts', children: [
                { id: 'news', kind: 'term', label: '', taxonomy: 'categories', term: news.id, children: [] },
            ] },
            { id: 'gone', kind: 'term', label: 'Gone', taxonomy: 'tags', term: 'missing', children: [] },
        ];
        await expect(cms.menus.create({ name: 'Main', items }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.menus.create({ name: 'Main', items: [{ id: 'x', kind: 'link', label: 'X', url: 'javascript:alert(1)', children: [] }] }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const menu = await cms.menus.create({ name: 'Main', items }, { principal: admin });
        await expect(cms.menus.create({ name: 'Main' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await cms.menus.forLocation('primary')).toBeNull();
        await expect(cms.menus.place(menu.id, ['nowhere'], { principal: admin, known: (await cms.menuLocations()).map(location => location.name) })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.menus.place(menu.id, ['primary', 'footer'], { principal: admin, known: ['primary', 'footer', 'sidebar'] });
        const resolved = await cms.menus.forLocation('primary');
        const shape = (list: readonly { label: string; url: string; children: readonly unknown[] }[]): unknown => list.map(entry => [entry.label, entry.url, shape(entry.children as never)]);
        expect(shape(resolved!)).toEqual([
            ['Home', '/', []],
            ['About', '/about', [['Our team', '/about/team', []]]],
            // The draft is hidden; its published child moves up.
            ['Visible child', '/visible-child', []],
            ['Posts', '/posts', [['News', `/category/${news.slug}`, []]]],
        ]);

        // A renamed page shows its new title and URL; the menu stores only its ID.
        await pages.update(about.id, { title: 'About us', slug: 'about-us' }, { principal: admin, expectedRevision: about.rev });
        expect((await cms.menus.forLocation('primary'))![1]).toMatchObject({ label: 'About us', url: '/about-us', children: [{ url: '/about-us/team' }] });

        // Two editors opened revision 1: the first save wins, the second changes nothing.
        const saved = await cms.menus.update(menu.id, { items: items.slice(0, 1) }, { principal: admin, expectedRevision: 1 });
        expect(saved.revision).toBe(2);
        await expect(cms.menus.update(menu.id, { items: [] }, { principal: admin, expectedRevision: 1 })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect((await cms.menus.get(menu.id))!.items.map(entry => entry.id)).toEqual(['home']);
        expect((await cms.menus.list()).find(entry => entry.id === menu.id)).toMatchObject({ items: 1, locations: ['footer', 'primary'] });

        // Placing in fewer locations clears the others; deleting clears all.
        await cms.menus.place(menu.id, ['footer'], { principal: admin, known: ['primary', 'footer'] });
        expect(await cms.menus.forLocation('primary')).toBeNull();
        await cms.menus.delete(menu.id, { principal: admin });
        expect(await cms.menus.forLocation('footer')).toBeNull();
        expect([...(await cms.menus.locations()).keys()]).toEqual([]);
    });

    it('serves posts at the site root with one slug namespace', async () => {
        await cms.saveCollection({ ...cms.collection('posts'), path: '' }, admin);
        expect(cms.collection('posts').path).toBe('');
        const posts = cms.resource('cms/posts');
        // A page, a route of the application and a taxonomy base already own these slugs.
        const team = await posts.create({ title: 'Team', status: 'published' }, { principal: admin });
        const search = await posts.create({ title: 'Search', status: 'published' }, { principal: admin });
        const category = await posts.create({ title: 'Category', status: 'published' }, { principal: admin });
        expect([team.slug, search.slug, category.slug]).toEqual(['team-2', 'search-2', 'category-2']);
        expect((await cms.entryUrls(cms.collection('posts'), [team])).get(team.id)).toBe('/team-2');
        // Pages avoid root posts' slugs in turn.
        expect((await cms.resource('cms/pages').create({ title: 'Team 2', status: 'published' }, { principal: admin })).slug).toBe('team-2-2');
        // The archive is the home page, or the Reading settings' posts page.
        expect(await cms.archiveUrl(cms.collection('posts'))).toBe('/');
        const blog = await cms.resource('cms/pages').create({ title: 'Blog', status: 'published' }, { principal: admin });
        await cms.settings.update('reading', { pageForPosts: blog.id }, { principal: admin });
        expect(await cms.archiveUrl(cms.collection('posts'))).toBe('/blog');
        await cms.saveCollection({ ...cms.collection('posts'), path: 'posts' }, admin);
        expect(await cms.archiveUrl(cms.collection('posts'))).toBe('/posts');
    });

    it('stores rich text in content blocks and searches their text', async () => {
        const posts = cms.resource('cms/posts');
        const text: RichTextDoc = { type: 'doc', content: [
            { type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: 'Launch notes' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'The zeppelin departs at noon.', marks: [{ type: 'italic' }] }] },
        ] };
        const post = await posts.create({ title: 'Airship', content: [{ _id: 'rt', type: 'core/richtext', data: { text } }, { _id: 'cta', type: 'core/button', data: { label: 'Book', url: '/book' } }], status: 'published' }, { principal: admin });
        // Block data gets its defaults; the rich text is stored as the document it was.
        expect(post.content).toMatchObject([{ _id: 'rt', type: 'core/richtext', data: { text: { type: 'doc' } } }, { _id: 'cta', type: 'core/button', data: { label: 'Book', url: '/book', style: 'primary' } }]);
        expect(Object.keys(post)).not.toContain('_text_content');
        expect((await posts.search('zeppelin', {}, { principal: ANONYMOUS })).map(record => record.id)).toEqual([post.id]);
        // Editing the content re-indexes its text.
        await posts.update(post.id, { content: [{ _id: 'rt', type: 'core/richtext', data: { text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Now a hot air balloon.' }] }] } } }] }, { principal: admin, expectedRevision: 1 });
        expect(await posts.search('zeppelin', {}, { principal: ANONYMOUS })).toEqual([]);
        expect((await posts.search('balloon', {}, { principal: ANONYMOUS })).map(record => record.id)).toEqual([post.id]);

        await expect(posts.create({ title: 'Bad', content: [{ _id: 'rt', type: 'core/richtext', data: { text: '<p>HTML</p>' } }] }, { principal: admin })).rejects.toMatchObject({ fields: { content: expect.stringContaining('rich text') } });
        await expect(posts.create({ title: 'Bad', content: [{ _id: 'rt', type: 'core/richtext', data: { text: { type: 'doc', content: [{ type: 'image', attrs: { src: '/media/none/x.png', mediaId: 'none' } }] } } }] }, { principal: admin }))
            .rejects.toMatchObject({ fields: { content: 'names a missing file.' } });
        await expect(posts.create({ title: 'Bad', content: [{ _id: 'b', type: 'core/button', data: { label: 'X', url: 'javascript:x' } }] }, { principal: admin }))
            .rejects.toMatchObject({ fields: { content: expect.stringContaining('b.url') } });
        // A collection's template is checked the same way, and new entries are what the dashboard starts them from.
        await expect(cms.saveCollection({ ...cms.collection('posts'), template: [{ _id: 't', type: 'core/button', data: { label: 'X', url: 'javascript:x' } }] }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const saved = await cms.saveCollection({ ...cms.collection('posts'), template: [{ _id: 'h', type: 'core/heading', data: { text: 'Overview' } }, { _id: 'm', type: 'core/meta', data: {} }], templateLock: 'insert' }, admin);
        expect(saved).toMatchObject({ template: [{ _id: 'h', type: 'core/heading' }, { _id: 'm', type: 'core/meta' }], templateLock: 'insert' });
    });
});
