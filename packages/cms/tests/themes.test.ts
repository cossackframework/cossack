import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS, contentModule, createCMS, field, manifestProblems, type CmsHost, type PluginRegistrationLike, type Principal, type ThemeLoaders } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const noop = () => null as never;
const templates = { layout: { default: noop }, entry: { default: noop }, archive: { default: noop } };

/** A portfolio theme: reads posts through a granted read, and misbehaves on purpose for the other keys. */
const folioLoaders: ThemeLoaders = {
    layout: site => ({ title: (site as { title: string }).title }),
    'entry-posts': async (entry, { cms, principal }) => {
        const list = await cms.resource('cms/posts').list({ where: { status: 'published' }, limit: 5 }, { principal });
        return { related: list.records.filter(record => record.id !== (entry as { id: string }).id).map(record => record.title) };
    },
    entry: () => { throw new Error('broken'); },
    archive: (_, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ late: true }))),
    home: () => ({ big: 'x'.repeat(200) }),
    search: () => ['not', 'an', 'object'],
};

const plainLoaders: ThemeLoaders = {
    layout: () => ({ ok: true }),
    entry: async (_, { cms, principal }) => ({ posts: (await cms.resource('cms/posts').list({}, { principal })).records }),
};

/** A theme that ships the collection it is designed for, and reads it in a loader. */
const portfolioLoaders: ThemeLoaders = {
    'entry-projects': async (entry, { cms, principal }) => {
        const list = await cms.resource('cms/projects').list({ where: { status: 'published' }, limit: 10 }, { principal });
        return { related: list.records.filter(record => record.id !== (entry as { id: string }).id).map(record => ({ title: record.title, client: record.client })) };
    },
};
const projects = { name: 'projects', label: 'Projects', singular: 'Project', path: 'projects', icon: 'case', fields: { client: field.string({ label: 'Client' }), cover: field.media({ label: 'Cover' }) } };

const plugins: PluginRegistrationLike[] = [
    {
        name: 'folio', version: '1.0.0', templates, module: { loaders: folioLoaders },
        manifest: { schemaVersion: 1, name: 'folio', version: '1.0.0', theme: { label: 'Folio', locations: { primary: 'Primary menu' }, areas: { footer: 'Footer widgets' },
            options: { accent: { kind: 'enum', values: ['blue', 'red'], default: 'blue', label: 'Accent' } },
            presets: { colors: [{ slug: 'base', name: 'Base', value: '#ffffff' }, { slug: 'brand', name: 'Brand', value: '#2563eb' }] } }, permissions: { resources: { 'cms/posts': ['read'] } } },
    },
    // Only a theme: active without a grant, so its loaders run, but it may read nothing.
    { name: 'plain', version: '1.0.0', templates: { ...templates, 'entry-wide': { default: noop }, 'entry-posts': { default: noop } }, module: { loaders: plainLoaders },
        manifest: { schemaVersion: 1, name: 'plain', version: '1.0.0', theme: { label: 'Plain' } } },
    { name: 'portfolio', version: '1.0.0', templates, module: { loaders: portfolioLoaders },
        manifest: { schemaVersion: 1, name: 'portfolio', version: '1.0.0', theme: { label: 'Portfolio' }, collections: [projects] } },
    // A child theme: its own entry template and loader over folio's layout and loaders.
    { name: 'folio-dark', version: '1.0.0', templates: { entry: { default: noop }, 'entry-dark': { default: noop } }, module: { loaders: { 'entry-posts': () => ({ child: true }) } },
        manifest: { schemaVersion: 1, name: 'folio-dark', version: '1.0.0', theme: { label: 'Folio Dark', extends: 'folio', locations: { footer: 'Footer menu' }, areas: { sidebar: 'Sidebar' },
            options: { tone: { kind: 'enum', values: ['dark', 'darker'], default: 'dark', label: 'Tone' } }, presets: { colors: [{ slug: 'brand', name: 'Brand', value: '#60a5fa' }] } } } },
    { name: 'orphan', version: '1.0.0', templates, manifest: { schemaVersion: 1, name: 'orphan', version: '1.0.0', theme: { label: 'Orphan', extends: 'missing' } } },
    { name: 'grandchild', version: '1.0.0', manifest: { schemaVersion: 1, name: 'grandchild', version: '1.0.0', theme: { label: 'Grandchild', extends: 'folio-dark' } } },
    // A collection name that is taken makes the plugin invalid, and nothing of it is hosted.
    { name: 'clash', version: '1.0.0', manifest: { schemaVersion: 1, name: 'clash', version: '1.0.0', collections: [{ ...projects, label: 'Clash' }, { ...projects, name: 'posts' }] } },
];

describe.skipIf(!live)('themes: loaders', () => {
    const service = romedbService();
    let cms: CmsHost;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    afterAll(() => warn.mockRestore());

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], plugins, themeLoaderTimeoutMs: 200, themeDataLimit: 100 });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        await cms.resource('cms/posts').create({ title: 'First', status: 'published' }, { principal: admin });
        await cms.resource('cms/posts').create({ title: 'Second', status: 'published' }, { principal: admin });
    }, 30_000);

    it('lists a theme\'s loaders', () => {
        expect(cms.themeLoaders('folio').sort()).toEqual(['archive', 'entry', 'entry-posts', 'home', 'layout', 'search']);
        expect(cms.themeLoaders('missing')).toEqual([]);
    });

    it('runs nothing for a theme that requests grants until an administrator grants them', async () => {
        const site = { title: 'Site' } as never;
        expect(cms.themes().find(theme => theme.name === 'folio')?.problems).toEqual([]);
        expect((await cms.status()).plugins.find(plugin => plugin.name === 'folio')).toMatchObject({ themeOnly: false, active: false });
        expect(await cms.themeData('folio', ['layout'], site, { principal: ANONYMOUS })).toEqual({});
        await cms.grantPlugin('folio', admin);
        expect(await cms.themeData('folio', ['layout'], site, { principal: ANONYMOUS })).toEqual({ title: 'Site' });
    });

    it('runs the first candidate it has a loader for, with the granted read as the visitor', async () => {
        const [first] = (await cms.resource('cms/posts').list({ where: { title: 'First' } }, { principal: admin })).records;
        const entry = { id: first!.id, collection: 'posts', locale: 'en' } as never;
        expect(await cms.themeData('folio', ['entry-wide', 'entry-posts', 'entry'], entry, { principal: ANONYMOUS })).toEqual({ related: ['Second'] });
        // No loader among the candidates.
        expect(await cms.themeData('folio', ['not-found'], entry, { principal: ANONYMOUS })).toEqual({});
        expect(await cms.themeData(null, ['entry'], entry, { principal: ANONYMOUS })).toEqual({});
    });

    it('renders without data when a loader fails, runs out of time or returns too much', async () => {
        const view = { kind: 'archive' } as never;
        warn.mockClear();
        expect(await cms.themeData('folio', ['entry'], view, { principal: ANONYMOUS })).toEqual({});
        expect(await cms.themeData('folio', ['archive'], view, { principal: ANONYMOUS })).toEqual({});
        expect(await cms.themeData('folio', ['home'], view, { principal: ANONYMOUS })).toEqual({});
        expect(await cms.themeData('folio', ['search'], view, { principal: ANONYMOUS })).toEqual({});
        expect(warn.mock.calls.map(call => String(call[0]))).toEqual([
            expect.stringMatching(/folio\.entry failed: broken/), expect.stringMatching(/folio\.archive failed: timed out/),
            expect.stringMatching(/folio\.home failed: it returned \d+ characters/), expect.stringMatching(/folio\.search failed: it must return an object/),
        ]);
    });

    it('keeps a theme without grants to reads it may make', async () => {
        warn.mockClear();
        expect(await cms.themeData('plain', ['layout'], { title: 'Site' } as never, { principal: ANONYMOUS })).toEqual({ ok: true });
        expect(await cms.themeData('plain', ['entry'], {} as never, { principal: ANONYMOUS })).toEqual({});
        expect(String(warn.mock.calls[0]?.[0])).toMatch(/plain\.entry failed: Plugin plain has no grant for cms\/posts/);
    });

    it('hosts a plugin\'s collections only while the plugin is active', async () => {
        expect((await cms.status()).plugins.find(plugin => plugin.name === 'portfolio')).toMatchObject({ themeOnly: false, active: false, missing: ['plugin:enabled'] });
        expect(cms.collections().map(collection => collection.name)).not.toContain('projects');
        expect(() => cms.collection('projects')).toThrow(/Unknown collection/);
        await expect(cms.resource('cms/projects').list({}, { principal: admin })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await cms.grantPlugin('portfolio', admin);
        expect(cms.collection('projects')).toMatchObject({ plugin: 'portfolio', builtin: true, path: 'projects', label: 'Projects' });
        expect(cms.collections().map(collection => collection.name)).toContain('projects');
        // Editors work with it like posts: cms/* covers it.
        const editor: Principal = { kind: 'user', id: 'editor-1', roles: ['editor'], permissions: ['cms:dashboard', 'cms/*'] };
        const rocket = await cms.resource('cms/projects').create({ title: 'Rocket', client: 'ACME', status: 'published' }, { principal: editor });
        await cms.resource('cms/projects').create({ title: 'Skates', client: 'Road Runner', status: 'published' }, { principal: editor });
        expect((await cms.entryUrls(cms.collection('projects'), [rocket])).get(rocket.id)).toBe('/projects/rocket');
        expect(await cms.archiveUrl(cms.collection('projects'))).toBe('/projects');
        // The theme reads its own collection without a grant of its own.
        expect(await cms.themeData('portfolio', ['entry-projects', 'entry'], { id: rocket.id } as never, { principal: ANONYMOUS })).toEqual({ related: [{ title: 'Skates', client: 'Road Runner' }] });
        await cms.revokePlugin('portfolio', admin);
        expect(cms.collections().map(collection => collection.name)).not.toContain('projects');
        await expect(cms.resource('cms/projects').get(rocket.id, { principal: admin })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await cms.grantPlugin('portfolio', admin);
    });

    it('rejects a plugin whose collection names are taken', async () => {
        expect((await cms.status()).plugins.find(plugin => plugin.name === 'clash')).toMatchObject({ active: false, reason: expect.stringMatching(/Collection posts is already declared/) });
        expect(manifestProblems({ schemaVersion: 1, name: 'x', version: '1.0.0', collections: [{ name: 'Bad', label: '', singular: 'B', fields: {} }, { ...projects, builtin: true }] }))
            .toEqual([expect.stringMatching(/^collection Bad: The name/), expect.stringMatching(/^collection Bad: The plural label/), 'collection projects: builtin and plugin are set by the host.']);
    });

    it('lets an editor choose one of the active theme\'s templates for an entry', async () => {
        await cms.activateTheme('plain', admin);
        // Templates named after a collection apply to it already, so they are not offered.
        expect(await cms.entryTemplates()).toEqual(['entry-wide']);
        expect(cms.resourceById('cms/pages').fields.template).toMatchObject({ kind: 'string', nullable: true });
        expect(cms.resourceById('cms/patterns').fields.template).toBeUndefined();
        const pages = cms.resource('cms/pages');
        const page = await pages.create({ title: 'About', template: 'entry-wide' }, { principal: admin });
        expect(page.template).toBe('entry-wide');
        await expect(pages.create({ title: 'Other', template: 'entry-nope' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { template: 'is not a template of the active theme.' } });
        await expect(pages.create({ title: 'Other', template: 'Wide' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // After a theme switch the stored name stays, so other edits still save; choosing it again does not.
        await cms.activateTheme('folio', admin);
        expect(await cms.entryTemplates()).toEqual([]);
        const edited = await pages.update(page.id, { title: 'About us' }, { principal: admin, expectedRevision: page.rev });
        expect(edited.template).toBe('entry-wide');
        const cleared = await pages.update(page.id, { template: '' }, { principal: admin, expectedRevision: edited.rev });
        await expect(pages.update(page.id, { template: 'entry-wide' }, { principal: admin, expectedRevision: cleared.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('layers a child theme over its parent', async () => {
        const themes = new Map(cms.themes().map(theme => [theme.name, theme]));
        const child = themes.get('folio-dark')!;
        expect(child).toMatchObject({ parent: 'folio', problems: [], locations: [{ name: 'primary', label: 'Primary menu' }, { name: 'footer', label: 'Footer menu' }],
            areas: [{ name: 'footer', label: 'Footer widgets' }, { name: 'sidebar', label: 'Sidebar' }] });
        // Its option values are its own, with its parent's options and its own.
        expect(child.options).toMatchObject({ id: 'folio-dark', fields: { accent: { kind: 'enum' }, tone: { kind: 'enum' } } });
        // Its presets layer over its parent's by slug.
        expect(child.presets.colors).toEqual([{ slug: 'brand', name: 'Brand', value: '#60a5fa' }, { slug: 'base', name: 'Base', value: '#ffffff' }]);
        expect(themes.get('plain')!.presets).toEqual({});
        expect(themes.get('orphan')!.problems).toEqual(['It extends missing, which is not an installed theme.']);
        expect(themes.get('grandchild')!.problems).toEqual(['Its parent theme folio-dark extends another theme; themes extend one level.']);
        expect(cms.themeLoaders('folio-dark').sort()).toEqual(['archive', 'entry', 'entry-posts', 'home', 'layout', 'search']);
        // The child's loader wins for its key; the parent's runs for the others, with the parent's grant.
        expect(await cms.themeData('folio-dark', ['entry-posts', 'entry'], {} as never, { principal: ANONYMOUS })).toEqual({ child: true });
        expect(await cms.themeData('folio-dark', ['layout'], { title: 'Site' } as never, { principal: ANONYMOUS })).toEqual({ title: 'Site' });
        await cms.activateTheme('folio-dark', admin);
        expect(await cms.entryTemplates()).toEqual(['entry-dark']);
        await expect(cms.activateTheme('orphan', admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('saves widget areas with a revision check', async () => {
        const areas = await cms.areaLocations();
        expect(areas.filter(area => area.active).map(area => area.name)).toEqual(['footer', 'sidebar']);
        const known = areas.map(area => area.name);
        expect(await cms.areas.get('sidebar')).toMatchObject({ blocks: [], revision: 0 });
        const blocks = [{ _id: 'hello', type: 'core/paragraph', data: { text: 'Hello **there**' } }, { _id: 'rule', type: 'core/divider', data: {} }];
        const saved = await cms.areas.save('sidebar', blocks, { principal: admin, expectedRevision: 0, known });
        expect(saved).toMatchObject({ name: 'sidebar', revision: 1, blocks: [{ _id: 'hello', type: 'core/paragraph' }, { _id: 'rule', type: 'core/divider' }] });
        await expect(cms.areas.save('sidebar', [], { principal: admin, expectedRevision: 0, known })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect((await cms.areas.save('sidebar', blocks.slice(1), { principal: admin, expectedRevision: 1, known })).revision).toBe(2);
        await expect(cms.areas.save('header', [], { principal: admin, expectedRevision: 0, known })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.areas.save('footer', [{ _id: 'x', type: 'core/nope', data: {} }], { principal: admin, expectedRevision: 0, known })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.areas.save('footer', [{ id: 'x' }], { principal: admin, expectedRevision: 0, known })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const editor: Principal = { kind: 'user', id: 'editor-1', roles: ['editor'], permissions: ['cms:dashboard', 'cms/*'] };
        await expect(cms.areas.save('footer', [], { principal: editor, expectedRevision: 0, known })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect([...(await cms.areas.all()).keys()]).toEqual(['sidebar']);
    });

    it('saves layout blocks with their children', async () => {
        const known = (await cms.areaLocations()).map(area => area.name);
        const blocks = [{ _id: 'cols', type: 'core/columns', data: { gap: 'small' }, children: [
            { _id: 'left', type: 'core/column', data: { span: 4 }, children: [{ _id: 'h', type: 'core/heading', data: { text: 'Left' } }] },
            { _id: 'right', type: 'core/column', data: {}, layout: { hide: ['sm'] }, children: [] },
        ] }];
        const saved = await cms.areas.save('footer', blocks, { principal: admin, expectedRevision: 0, known });
        const expected = [{ _id: 'cols', type: 'core/columns', data: { gap: 'small', stack: 'mobile' }, children: [
            { _id: 'left', type: 'core/column', data: { span: 4, verticalAlign: 'top' }, children: [{ _id: 'h', type: 'core/heading', data: { text: 'Left', level: 'h2' } }] },
            { _id: 'right', type: 'core/column', data: { verticalAlign: 'top' }, layout: { hide: ['sm'] }, children: [] },
        ] }];
        expect(saved.blocks).toEqual(expected);
        expect((await cms.areas.get('footer'))?.blocks).toEqual(expected);
        await expect(cms.areas.save('footer', [{ _id: 'c', type: 'core/column', data: {} }], { principal: admin, expectedRevision: 1, known }))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', message: 'c: core/column goes inside core/columns.' });
    });

    it('saves a block\'s style and keeps what its type supports', async () => {
        const known = (await cms.areaLocations()).map(area => area.name);
        const blocks = [
            { _id: 'p', type: 'core/paragraph', data: { text: 'Styled' }, style: { background: 'brand', align: 'center' }, layout: { anchor: 'intro', className: 'hero' } },
            { _id: 'd', type: 'core/divider', data: {}, style: { background: 'brand', padding: 'large' } },
        ];
        await expect(cms.areas.save('sidebar', [{ _id: 'p', type: 'core/paragraph', data: { text: 'x' }, style: { background: 'Brand' } }], { principal: admin, expectedRevision: 2, known }))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const saved = await cms.areas.save('sidebar', blocks.slice(0, 1), { principal: admin, expectedRevision: 2, known });
        expect(saved.blocks).toEqual([{ _id: 'p', type: 'core/paragraph', data: { text: 'Styled' }, style: { background: 'brand', align: 'center' }, layout: { anchor: 'intro', className: 'hero' } }]);
        // A design block supports colour and spacing; an unsupported property is dropped, not refused (the unit tests cover the drop).
        const divider = await cms.areas.save('sidebar', [{ _id: 'd', type: 'core/divider', data: {}, style: { ...blocks[1]!.style, fontSize: 'large' } }], { principal: admin, expectedRevision: 3, known });
        expect(divider.blocks[0]).toEqual({ _id: 'd', type: 'core/divider', data: { orientation: 'horizontal', thickness: 'thin', width: 'full' }, style: { background: 'brand', padding: 'large' } });
        const settings = await cms.settings.update('appearance', { presets: { 'folio-dark': { colors: { brand: '#0a0' }, custom: [{ slug: 'mine', name: 'Mine', value: '#123' }] } }, customCss: '.hero { color: red }' }, { principal: admin });
        expect(settings['appearance.presets']).toEqual({ 'folio-dark': { colors: { brand: '#0a0' }, custom: [{ slug: 'mine', name: 'Mine', value: '#123' }] } });
        expect(settings['appearance.customCss']).toBe('.hero { color: red }');
    });
});
