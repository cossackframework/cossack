/**
 * The example plugin in packages/cms/app/src/plugins/example: its hooks, data rule and command work
 * against a real host, and it never ships: not in the npm package, not in source archives, not in
 * what `cossack add cms` renders.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { dashboardNotices, dashboardTaskbar, entryActions, manifestProblems, siteMarkdown, systemPrincipal } from '../src/index';
import { contentModule, createCMS, type CmsHost } from '../src/server/index';
import { register } from '../app/src/plugins/example/server';
import { live, romedbService } from './helpers';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const FOLDER = 'app/src/plugins/example';
const manifest = JSON.parse(readFileSync(new URL(`../${FOLDER}/plugin.json`, import.meta.url), 'utf8')) as { name: string; version: string };

describe('the example plugin', () => {
    it('has a valid manifest', () => {
        expect(manifestProblems(manifest)).toEqual([]);
    });

    it('is left out of the npm package, source archives and `cossack add cms`', () => {
        const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: PACKAGE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { files: { path: string }[] }[];
        const files = packed[0]!.files.map(file => file.path);
        expect(files.some(file => file.startsWith('app/src/plugins/default-theme/'))).toBe(true);
        expect(files.filter(file => file.startsWith(`${FOLDER}/`))).toEqual([]);
        const attribute = execFileSync('git', ['check-attr', 'export-ignore', '--', `${FOLDER}/server.ts`], { cwd: PACKAGE, encoding: 'utf8' });
        expect(attribute.trim()).toMatch(/: export-ignore: set$/);
        const recipe = JSON.parse(readFileSync(new URL('../app/cossack-recipe.json', import.meta.url), 'utf8')) as { files: string[] };
        expect(recipe.files.filter(entry => `src/plugins/example/`.startsWith(entry) || entry.startsWith('src/plugins/example'))).toEqual([]);
    });
});

describe.skipIf(!live)('the example plugin on a host', () => {
    const service = romedbService();
    const admin = systemPrincipal('example plugin test');
    const actor = { kind: 'system' as const, id: 'system:example plugin test' };
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], plugins: [{ name: manifest.name, version: manifest.version, manifest, module: { register } }] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        expect(await cms.grantPlugin('example', admin)).toMatchObject({ active: true });
    }, 60_000);

    it('keeps its own records under its data rule', async () => {
        const bookmarks = cms.pluginCms('example').resource('example/bookmarks');
        await expect(bookmarks.create({ title: 'Bad', url: 'javascript:alert(1)' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const saved = await bookmarks.create({ title: '  Read later  ', url: '/dashboard/content/posts' }, { principal: admin });
        expect(saved).toMatchObject({ title: 'Read later', url: '/dashboard/content/posts', done: false });
        expect(await bookmarks.count({ where: { done: false } }, { principal: admin })).toBe(1);
    });

    it('adds a notice, a taskbar count and a quick action to the dashboard', async () => {
        expect(await cms.hooks.applyFilters(dashboardNotices, [], { actor })).toEqual([expect.objectContaining({ id: 'example.welcome', tone: 'info', href: '/dashboard/example' })]);
        expect(await cms.hooks.applyFilters(dashboardTaskbar, [], { actor })).toEqual([{ id: 'example.unread', label: 'Reading list', href: '/dashboard/example', count: 1 }]);
        const actions = await cms.hooks.applyFilters(entryActions, [], { resource: 'cms/posts', actor, record: { id: 'p1', rev: 1, title: 'Hello', createdAt: 0, updatedAt: 0 } as never });
        expect(actions).toEqual([{ id: 'example.bookmark', label: 'Add to reading list', href: '/dashboard/example?title=Hello&url=%2Fdashboard%2Fcontent%2Fposts%2Fp1' }]);
    });

    it('ends every entry\'s Markdown with its note, and counts posts in its command', async () => {
        const markdown = await cms.hooks.applyFilters(siteMarkdown, '# Hello\n', { collection: 'posts', id: 'p1', url: 'https://example.com/hello', record: { id: 'p1' } as never });
        expect(markdown).toBe('# Hello\n\n---\n\nServed with a note from the example plugin, through the cms.site.markdown hook.\n');
        await cms.resource('cms/posts').create({ title: 'Draft one', slug: 'draft-one', status: 'draft' }, { principal: admin });
        expect(await cms.runCommand('example', 'stats', {}, { principal: admin })).toEqual({ posts: { draft: 1, pending: 0, scheduled: 0, published: 0 }, unread: 1 });
    });
});
