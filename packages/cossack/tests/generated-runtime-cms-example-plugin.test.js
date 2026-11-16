// The example plugin from packages/cms/app/src/plugins/example in a generated CMS app that has
// Markdown pages: it passes the lints, the type check and the build, does nothing until it is
// granted, then adds its menu link, screen, notice, taskbar count, quick action, Markdown page
// and the note under every entry's Markdown.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupRoots, cossack, productionServer, project, typecheck, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const EXAMPLE = fileURLToPath(new URL('../../cms/app/src/plugins/example', import.meta.url));
const SCREEN = 'dashboard/example/index.ts';

describe.skipIf(!liveRomeDBTests())('the example CMS plugin in a generated application', () => {
  let service;
  beforeAll(async () => { service = await startRomeDBService(); }, 30_000);
  afterAll(async () => { await service?.stop(); });

  it('adds its screen, dashboard parts, Markdown page and Markdown note once granted', async () => {
    const root = await project('node', ['cms']);
    // A rendered plugin is application source: the folder is what `cossack add plugin` writes.
    await fs.cp(EXAMPLE, path.join(root, 'src/plugins/example'), { recursive: true });
    expect(JSON.parse((await cossack(root, ['plugins', 'check', '--json'])).stdout).data.plugins).toContainEqual({ plugin: 'example', files: 8, errors: 0 });
    await cossack(root, ['config', '--generate']);
    await typecheck(root, 'example plugin application');
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);

    const environment = { APP_SECRET: 'cms-example-test-secret-0123456789abcdef', ROMEDB_URL: service.url, ROMEDB_TOKEN: service.token, CMS_SETUP_CODE: 'setup', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending') };
    const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
    const server = await productionServer(root, environment);
    try {
      const web = browserless(server.origin, routeIds, () => server.diagnostics());
      expect((await web.post('/auth/setup', { code: 'setup', siteTitle: 'Example', name: 'Ada', email: 'ada@example.com', password: 'long password' })).headers.get('location')).toBe('/dashboard');

      // Not granted yet: its routes answer like unknown ones, and the dashboard shows none of it.
      expect((await web.request('/example/guide')).status).toBe(404);
      lacks(await web.page('/dashboard'), 'href="/dashboard/example"');
      lacks(await web.page('/dashboard'), 'Reading list');

      await web.post('/dashboard/plugins', { plugin: 'example', _action: 'grant' });
      // Its own records, written as the user through its screen; the data rule refuses a script address.
      const refused = await web.action(SCREEN, 'add', [{ title: 'Bad', url: 'javascript:alert(1)', note: '' }]);
      expect(refused.error).toMatch(/must start with https:\/\/, http:\/\/ or \//);
      expect((await web.action(SCREEN, 'add', [{ title: '  Read me  ', url: '/dashboard', note: 'Soon' }])).error).toBe('');
      const screen = await web.page('/dashboard/example');
      contains(screen, 'Read me');
      contains(screen, 'Posts by status');

      // The dashboard: the menu link, the notice, the overview box and the taskbar count.
      const dashboard = await web.page('/dashboard');
      contains(dashboard, 'href="/dashboard/example"');
      expect(dashboard).toMatch(/data-notice-id="?example\.welcome"?/);
      contains(dashboard, 'The example plugin is active');
      expect(dashboard).toMatch(/data-testid="?example-widget"?/);
      const taskbar = dashboard.slice(dashboard.indexOf('data-dashboard-taskbar'));
      const statuses = [...taskbar.matchAll(/data-status="?([^" >]+)"?[^>]*>([^<]*)(?:<span[^>]*>(\d+))?/g)].map(match => match.slice(1).filter(Boolean).map(part => part.trim()).join('|'));
      expect(statuses).toContain('example.unread|Reading list|1');

      // The Markdown page in the plugin's pages/(site) routes like one in src/pages/(site): inside the
      // theme's frame, rendered per request, never at build time, since the plugin is active per request.
      const guide = await web.page('/example/guide');
      contains(guide, 'The example plugin');
      contains(guide, 'pages/(site)/example/guide.md');
      expect(guide).toMatch(/data-theme="?default-theme"?/);
      expect(guide).toMatch(/class="?mdx-content"?/);
      expect(guide.indexOf('mdx-content')).toBeGreaterThan(guide.indexOf('<header'));
      await expect(fs.access(path.join(root, 'dist/client/example/guide/index.html'))).rejects.toThrow();

      // A post: its list offers the quick action, and its Markdown ends with the plugin's note.
      const created = await web.request('/api/cms/content/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Hello', slug: 'hello', status: 'published', content: [] }) });
      expect(created.status, await created.clone().text()).toBe(201);
      const { url } = (await created.json()).item;
      contains(await web.page('/dashboard/content/posts'), 'Add to reading list');
      const markdown = await (await web.request(`${url}?format=md`)).text();
      expect(markdown).toContain('# Hello');
      expect(markdown.trimEnd().endsWith('Served with a note from the example plugin, through the cms.site.markdown hook.')).toBe(true);
    } finally { await server.close(); }
  }, 600_000);
});
