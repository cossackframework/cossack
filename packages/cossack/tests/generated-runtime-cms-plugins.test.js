// CMS plugin trust: a plugin adds a resource, a hook, a view, a block and a command; it runs only
// after its schema is migrated and an administrator grants it; policy violations fail the
// build; a failed migration leaves it inactive.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, cossack, productionServer, project, trackRoot, typecheck, vite } from './fixtures/generated-app.js';
import { packDesk, violations } from './fixtures/cms-plugin-package.js';
import { browserless, contains, lacks } from './fixtures/cms-client.js';
import { liveFastDBTests, startFastDBService } from '../../fastdb/src/testing.ts';

afterEach(cleanupRoots);

const build = async root => {
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
};

describe.skipIf(!liveFastDBTests())('CMS plugin trust', () => {
  let service;
  beforeAll(async () => { service = await startFastDBService(); }, 30_000);
  afterAll(async () => { await service?.stop(); });

  it('hosts a granted plugin, rejects policy violations at build time and keeps a failed migration inactive', async () => {
    const root = await project('node', ['cms']);
    const v1 = await packDesk('1.0.0');
    trackRoot(v1.directory);
    expect(JSON.parse((await cossack(root, ['add', 'plugin', v1.tarball, '--json'])).stdout).data).toMatchObject({ status: 'added', name: 'support-desk' });
    // The default theme is a rendered plugin too, and passes the same lints.
    expect(JSON.parse((await cossack(root, ['plugins', 'check', '--json'])).stdout).data.plugins).toEqual([{ plugin: 'default-theme', files: 4, errors: 0 }, { plugin: 'support-desk', files: 4, errors: 0 }]);
    await cossack(root, ['config', '--generate']);
    await typecheck(root, 'cms plugin application');

    // Each policy violation fails the build with its code.
    for (const [rule, files] of Object.entries(violations)) {
      const variant = await packDesk('1.0.0', { files });
      trackRoot(variant.directory);
      await cossack(root, ['plugins', 'upgrade', 'support-desk', '--source', variant.directory, '--force', '--json']);
      const code = { raw: 'COSSACK_PLUGIN_RAW_QUERY', network: 'COSSACK_PLUGIN_NETWORK', permission: 'COSSACK_PLUGIN_PERMISSION' }[rule];
      await expect(vite(root, []), rule).rejects.toThrow(new RegExp(`${code}[^\\n]*`));
      const check = await cossack(root, ['plugins', 'check', '--json']).catch(error => error);
      expect(JSON.parse(check.stdout).diagnostics[0].code).toBe(code);
    }
    await cossack(root, ['plugins', 'upgrade', 'support-desk', '--source', v1.tarball, '--force', '--json']);
    await build(root);

    const environment = { APP_SECRET: 'cms-plugin-test-secret-0123456789abcdef', FASTDB_URL: service.url, FASTDB_TOKEN: service.token, CMS_SETUP_CODE: 'setup', FASTDB_PENDING_DIR: path.join(root, '.cossack/fastdb-pending') };
    const routeIds = async () => JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
    const editor = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
    const ticket = subject => ({ subject, status: 'open', body: '' });
    let server = await productionServer(root, environment);
    try {
      const web = browserless(server.origin, await routeIds(), () => server.diagnostics());
      expect((await web.post('/auth/setup', { code: 'setup', siteTitle: 'Desk', name: 'Ada', email: 'ada@example.com', password: 'long password' })).headers.get('location')).toBe('/dashboard');
      // Setup applied every schema, so the plugin waits only for its grant.
      expect(await web.page('/dashboard/plugins')).toMatch(/data-plugin="?support-desk"? data-version="?1\.0\.0"? data-active="?false/);
      contains(await web.page('/dashboard/plugins'), 'Not enabled.');
      contains(await web.page('/dashboard/content/support-desk.tickets'), 'Plugin support-desk is not active.');
      lacks(await web.page('/dashboard'), 'data-testid="support-widget"');
      lacks((await web.action('dashboard/(cms)/collections/[name]/index.ts', 'load', ['pages'], { params: { name: 'pages' } })).blocks.map(block => block.name).join(','), 'support-desk/contact');

      await web.post('/dashboard/plugins', { plugin: 'support-desk', _action: 'grant' });
      expect(await web.page('/dashboard/plugins')).toMatch(/data-plugin="?support-desk"? data-version="?1\.0\.0"? data-active="?true/);
      const created = await web.action(editor, 'save', [ticket('  Printer jam  '), 'update', 0], { params: { collection: 'support-desk.tickets', id: 'new' }, state: { route: 'support-desk.tickets', id: 'new' } });
      expect(created._cossack_redirect).toMatch(/^\/dashboard\/content\/support-desk\.tickets\/[0-9a-f-]{36}\?saved=1$/);
      await web.action(editor, 'save', [ticket('Printer jam'), 'update', 0], { params: { collection: 'support-desk.tickets', id: 'new' }, state: { route: 'support-desk.tickets', id: 'new' } });
      // The plugin's before-write hook trimmed the subject.
      const list = await web.page('/dashboard/content/support-desk.tickets');
      expect(list.match(/>Printer jam</g)).toHaveLength(2);
      const overview = await web.page('/dashboard');
      contains(overview, 'Support desk is active');
      contains(overview, 'href="/dashboard/support"');
      contains(overview, 'href="/dashboard/content/support-desk.tickets"');
      contains(await web.page('/dashboard/support'), 'Open tickets: 2');

      // The plugin's block type: added to pages through the builder, rendered by its ui.ts.
      const builder = await web.action('dashboard/(cms)/collections/[name]/index.ts', 'save', [
        { name: 'pages', label: 'Pages', singular: 'Page', description: '', icon: 'notebook', path: '', public: true, slug: true, publishable: true, hierarchical: true, visibility: 'private', taxonomies: [], builtin: true },
        [{ name: 'sections', label: 'Sections', type: 'blocks', required: false, description: '', placement: '', unique: false, search: false, max: '', min: '', choices: '', defaultValue: '', target: '', blocks: [], locked: false }],
      ], { params: { name: 'pages' } });
      expect(builder.error).toBe('');
      await web.action(editor, 'save', [{ title: 'Contact', slug: '', status: 'draft', publishedAt: '', body: '', excerpt: '', showInMenu: true, featuredImage: '', parent: '', menuOrder: '0',
        sections: [{ id: 'c1', type: 'support-desk/contact', data: { email: 'help@example.com' } }] }, 'publish', 0], { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
      contains(await web.page('/contact'), 'Write to help@example.com');

      // The plugin command runs in the application as the signed-in user.
      const env = { ...process.env, CMS_PASSWORD: 'long password' };
      const help = (await cossack(root, ['support-desk:close-all', '--help'], { env })).stdout;
      expect(help).toContain('Close every open ticket.');
      expect(help).toContain('--reason <string>');
      const ran = JSON.parse((await cossack(root, ['support-desk:close-all', '--reason', 'resolved', '--url', server.origin, '--email', 'ada@example.com', '--json'], { env })
        .catch(error => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); })).stdout);
      expect(ran).toMatchObject({ ok: true, command: 'support-desk:close-all', data: { result: { closed: 2, reason: 'resolved' } } });
      contains(await web.page('/dashboard/support'), 'Open tickets: 0');
      const denied = await cossack(root, ['support-desk:close-all', '--url', server.origin, '--email', 'ada@example.com'], { env: { ...env, CMS_PASSWORD: 'wrong password' } }).catch(error => error);
      expect(denied.stderr).toContain('Sign-in failed');
    } finally { await server.close(); }

    // v2 adds a unique index that the existing data violates: the migration fails and rolls back.
    const v2 = await packDesk('1.1.0', { manifest: { uniqueSubject: true } });
    trackRoot(v2.directory);
    await cossack(root, ['plugins', 'upgrade', 'support-desk', '--source', v2.tarball, '--json']);
    await build(root);
    server = await productionServer(root, environment);
    try {
      const web = browserless(server.origin, await routeIds(), () => server.diagnostics());
      const session = await web.request('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ada@example.com', password: 'long password' }) });
      expect(session.status).toBe(200);
      contains(await web.page('/dashboard/plugins'), 'Waiting for a migration of support-desk/tickets.');
      await web.post('/dashboard/tools/schema', {});
      expect(await web.page('/dashboard/tools/schema')).toMatch(/failed and was rolled back/);
      expect(await web.page('/dashboard/plugins')).toMatch(/data-plugin="?support-desk"? data-version="?1\.1\.0"? data-active="?false/);
      contains(await web.page('/dashboard/content/support-desk.tickets'), 'waiting for a schema migration');
      lacks(await web.page('/dashboard'), 'Support desk is active');
    } finally { await server.close(); }
  }, 600_000);
});
