// `cossack cms` and the MCP server against a generated CMS application on Node: the CLI signs in
// and keeps an application password; entries go through draft, publish, schedule, unpublish,
// revisions and the trash; notes, users, roles, settings, terms and media follow; a read-only
// password reads only; the official MCP client lists and runs the same operations; and with a
// directory service the network adds a site that --site and ?site= reach through the network host.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { cleanupRoots, cossack, productionServer, project, repository, run, trackRoot, vite } from './fixtures/generated-app.js';
import { browserless, PNG } from './fixtures/cms-client.js';
import { liveRomeDBTests, servesDirectories, startRomeDBDirectory, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const SETTINGS = 'dashboard/(cms)/settings/index.ts';
const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Managed', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const bin = path.join(repository, 'packages/cossack/bin/cossack.js');

describe.skipIf(!liveRomeDBTests())('generated CMS management', () => {
  it('drives a CMS from the CLI and over MCP with one application password, on the main site and an added one', async () => {
    const root = await project('node', ['cms']);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const database = await startRomeDBService();
    const sites = servesDirectories() ? await startRomeDBDirectory() : null;
    const config = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cms-cli-config-'));
    trackRoot(config);
    const server = await productionServer(root, {
      APP_SECRET: 'generated-cms-cli-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token, CMS_SETUP_CODE: SETUP.code,
      ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media'),
      ...(sites ? { ROMEDB_SITES_URL: sites.url, ROMEDB_SITES_TOKEN: sites.token } : {}),
    });
    const clients = [];
    try {
      const origin = server.origin;
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      const web = browserless(origin, routeIds, () => server.diagnostics());
      expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');

      // The CLI's envelope for `cossack cms …`. The generated app's .env names another APP_URL, so the address comes from the environment, as in CI.
      const env = { ...process.env, COSSACK_CONFIG_DIR: config, CMS_PASSWORD: SETUP.password, COSSACK_CMS_URL: origin };
      const cli = async (args, options = {}) => {
        const result = await run(process.execPath, [bin, 'cms', ...args, '--json'], { cwd: options.cwd ?? root, env: { ...env, ...options.env }, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }).catch(error => error);
        const text = String(result.stdout ?? '');
        let envelope;
        try { envelope = JSON.parse(text.trim().split('\n').at(-1)); }
        catch { throw new Error(`cms ${args.join(' ')} gave no envelope:\n${text}\n${result.stderr}\n${server.diagnostics().slice(-4000)}`); }
        if (!options.failure) expect(envelope, `cms ${args.join(' ')}: ${JSON.stringify(envelope.diagnostics)}`).toMatchObject({ ok: true, command: 'cms' });
        else expect(envelope, `cms ${args.join(' ')} should fail`).toMatchObject({ ok: false, diagnostics: [{ code: options.failure }] });
        return envelope;
      };

      // Sign in: a session creates the application password, which is kept for the user alone and never printed.
      const login = await cli(['login', '--url', origin, '--email', SETUP.email, '--name', 'robot'], { env: { COSSACK_CMS_URL: '' } });
      expect(login.data).toMatchObject({ url: origin, user: { email: SETUP.email, networkAdmin: true }, token: { name: 'robot', scope: 'write' }, site: { id: 'main', name: 'Managed' } });
      const stored = JSON.parse(await fs.readFile(path.join(config, 'cms-logins.json'), 'utf8'));
      const token = stored.logins[origin].token;
      expect(token).toMatch(/^cms_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(login)).not.toContain(token);
      expect((await fs.stat(path.join(config, 'cms-logins.json'))).mode & 0o777).toBe(0o600);
      // Outside a project the stored login is the default address.
      expect((await cli(['whoami'], { cwd: config, env: { COSSACK_CMS_URL: '' } })).data).toMatchObject({ user: { email: SETUP.email }, site: { id: 'main' }, token: { scope: 'write' }, network: { enabled: false, main: true } });

      // Collections, then an entry through its life.
      const collections = await cli(['collections', 'list']);
      expect(collections.data.items.map(entry => entry.name)).toEqual(expect.arrayContaining(['posts', 'pages']));
      expect(collections.data.items.find(entry => entry.name === 'posts').fields.map(field => field.name)).toEqual(expect.arrayContaining(['title', 'slug', 'status', 'publishedAt', 'content']));
      expect((await cli(['collections', 'schema', 'posts'])).data).toMatchObject({ $id: 'urn:cossack:cms:cms/posts', properties: { title: expect.anything() } });

      const created = await cli(['entries', 'create', 'posts', '--set', 'title=From the CLI', '--data', JSON.stringify({ excerpt: 'A first draft.', content: [{ _id: 'b1', type: 'core/paragraph', data: { text: 'Hello from the command line.' } }] })]);
      const id = created.data.item.id;
      expect(created.data.item).toMatchObject({ title: 'From the CLI', status: 'draft', rev: 1, slug: 'from-the-cli' });
      expect((await cli(['entries', 'get', 'posts', id])).data.item).toMatchObject({ id, excerpt: 'A first draft.', rev: 1 });
      expect((await cli(['entries', 'update', 'posts', id, '--set', 'title=Renamed by the CLI'])).data.item).toMatchObject({ title: 'Renamed by the CLI', rev: 2 });
      await cli(['entries', 'update', 'posts', id, '--set', 'title=Stale', '--rev', '1'], { failure: 'COSSACK_CMS_CONFLICT' });

      const published = await cli(['entries', 'publish', 'posts', id]);
      expect(published.data.item.status).toBe('published');
      expect(published.data.item.publishedAt).toBeGreaterThan(0);
      // The slug came from the first title and stays.
      expect(published.data.item.url).toBe('/posts/from-the-cli');
      expect((await cli(['entries', 'list', 'posts'])).data.items.map(entry => entry.id)).toContain(id);
      expect((await cli(['entries', 'list', 'posts', '--status', 'draft'])).data.items.map(entry => entry.id)).not.toContain(id);
      const scheduled = await cli(['entries', 'publish', 'posts', id, '--at', '2031-01-01T09:00:00Z']);
      expect(scheduled.data.item).toMatchObject({ status: 'scheduled', publishedAt: Date.parse('2031-01-01T09:00:00Z') });
      expect((await cli(['entries', 'list', 'posts', '--status', 'scheduled'])).data.items.map(entry => entry.id)).toContain(id);
      expect((await cli(['entries', 'unpublish', 'posts', id])).data.item.status).toBe('draft');
      expect((await cli(['entries', 'list', 'posts', '--status', 'any', '--q', 'Renamed'])).data.items.map(entry => entry.id)).toContain(id);

      const revisions = await cli(['entries', 'revisions', 'posts', id]);
      expect(revisions.data.current).toBeGreaterThanOrEqual(5);
      expect(revisions.data.items.map(entry => entry.revision)).toContain(1);
      expect(revisions.data.items.find(entry => entry.revision === 1)).toMatchObject({ title: 'From the CLI', status: 'draft' });
      expect((await cli(['entries', 'revision', 'posts', id, '1'])).data.data.title).toBe('From the CLI');
      const reverted = await cli(['entries', 'revert', 'posts', id, '1']);
      expect(reverted.data.item).toMatchObject({ title: 'From the CLI', status: 'draft' });

      // Notes: a thread on the title, resolved, seen across the site.
      const note = await cli(['notes', 'add', 'posts', id, '--body', 'Shorter title?', '--target', 'field:title']);
      expect(note.data.note).toMatchObject({ target: 'field:title', status: 'open', recordId: id });
      await cli(['notes', 'add', 'posts', id, '--body', 'Agreed.', '--reply-to', note.data.note.id]);
      const threads = await cli(['notes', 'list', 'posts', id]);
      expect(threads.data.threads).toHaveLength(1);
      expect(threads.data.threads[0].replies).toHaveLength(1);
      expect((await cli(['notes', 'resolve', note.data.note.id])).data.note.status).toBe('resolved');
      const across = await cli(['notes', 'list', '--status', 'resolved']);
      expect(across.data.items).toEqual([expect.objectContaining({ collection: 'posts', entryId: id, title: 'From the CLI' })]);
      expect((await cli(['notes', 'list', '--status', 'open'])).data.items).toEqual([]);

      // Users and roles.
      const grace = await cli(['users', 'create', '--email', 'grace@example.com', '--password', 'grace password 1', '--name', 'Grace', '--role', 'editor']);
      expect(grace.data).toMatchObject({ email: 'grace@example.com', name: 'Grace', roles: [{ id: 'editor' }] });
      expect((await cli(['users', 'list', '--q', 'grace'])).data.items.map(user => user.email)).toEqual(['grace@example.com']);
      expect((await cli(['users', 'update', grace.data.id, '--name', 'Grace Hopper', '--role', 'author'])).data).toMatchObject({ name: 'Grace Hopper', roles: [{ id: 'author' }] });
      expect((await cli(['users', 'get', 'grace@example.com'])).data.id).toBe(grace.data.id);
      expect((await cli(['roles', 'list'])).data.items.map(role => role.id)).toEqual(expect.arrayContaining(['admin', 'editor', 'author']));
      await cli(['users', 'delete', grace.data.id], { failure: 'COSSACK_CMS_CONFIRM_REQUIRED' });

      // Settings, terms, media.
      expect((await cli(['settings', 'get', 'general'])).data).toMatchObject({ group: 'general', values: { siteTitle: 'Managed' } });
      expect((await cli(['settings', 'set', 'general', '--set', 'siteTitle=Managed by the CLI'])).data.values.siteTitle).toBe('Managed by the CLI');
      expect((await cli(['settings', 'get'])).data.document.general.siteTitle).toBe('Managed by the CLI');
      await cli(['settings', 'set', 'general', '--set', 'postsPerPage=abc'], { failure: 'COSSACK_CMS_INVALID' });
      expect((await cli(['taxonomies', 'list'])).data.items.map(taxonomy => taxonomy.name)).toEqual(expect.arrayContaining(['categories', 'tags']));
      const news = await cli(['terms', 'create', 'categories', '--name', 'News']);
      expect(news.data).toMatchObject({ taxonomy: 'categories', name: 'News', slug: 'news' });
      expect((await cli(['terms', 'list', 'categories'])).data.items.map(term => term.slug)).toContain('news');
      expect((await cli(['entries', 'update', 'posts', id, '--data', JSON.stringify({ categories: [news.data.id] })])).data.item.categories).toEqual([news.data.id]);
      const picture = path.join(config, 'pixel.png');
      await fs.writeFile(picture, PNG);
      const uploaded = await cli(['media', 'upload', picture]);
      expect(uploaded.data.files).toHaveLength(1);
      expect((await cli(['media', 'list', '--kind', 'image'])).data.items.map(file => file.id)).toContain(uploaded.data.files[0].id);

      // A read-only password reads only; a bad one is refused.
      const session = await web.request('/api/cms/me/tokens', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ name: 'reader', scope: 'read' }) });
      expect(session.status, await session.clone().text()).toBe(201);
      const reader = (await session.json()).token;
      expect((await cli(['whoami'], { env: { COSSACK_CMS_TOKEN: reader } })).data.token.scope).toBe('read');
      await cli(['entries', 'create', 'posts', '--set', 'title=Not allowed'], { env: { COSSACK_CMS_TOKEN: reader }, failure: 'COSSACK_CMS_FORBIDDEN' });
      await cli(['whoami'], { env: { COSSACK_CMS_TOKEN: `cms_0123456789abcdef.${'x'.repeat(43)}` }, failure: 'COSSACK_CMS_UNAUTHENTICATED' });
      // A password cannot make passwords.
      const forged = await fetch(`${origin}/api/cms/me/tokens`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'more' }) });
      expect(forged.status).toBe(403);

      // MCP: the official client against the site's endpoint, with the same password.
      const mcpConfig = await cli(['mcp']);
      expect(mcpConfig.data.config.mcpServers[mcpConfig.data.name]).toEqual({ type: 'http', url: `${origin}/api/cms/mcp`, headers: { Authorization: `Bearer ${token}` } });
      const connect = async (bearer, query = '') => {
        const client = new Client({ name: 'cossack-test', version: '1' });
        clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/cms/mcp${query}`), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } }));
        return client;
      };
      const mcp = await connect(token);
      expect(mcp.getServerVersion()).toMatchObject({ name: 'cossack-cms' });
      expect(mcp.getInstructions()).toContain('posts');
      const tools = await mcp.listTools();
      expect(tools.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['get_site', 'list_entries', 'create_entry', 'publish_entry', 'add_note', 'update_settings', 'create_site']));
      expect(tools.tools.find(tool => tool.name === 'delete_entry').annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
      const site = await mcp.callTool({ name: 'get_site', arguments: {} });
      expect(site.isError).toBe(false);
      expect(site.structuredContent).toMatchObject({ user: { email: SETUP.email }, site: { id: 'main', name: 'Managed by the CLI' }, collections: expect.arrayContaining([expect.objectContaining({ name: 'posts' })]) });
      const made = await mcp.callTool({ name: 'create_entry', arguments: { collection: 'posts', fields: { title: 'From MCP', excerpt: 'Spoken, not typed.' } } });
      expect(made.structuredContent.item).toMatchObject({ title: 'From MCP', status: 'draft' });
      const live = await mcp.callTool({ name: 'publish_entry', arguments: { collection: 'posts', id: made.structuredContent.item.id } });
      expect(live.structuredContent.item).toMatchObject({ status: 'published', url: '/posts/from-mcp' });
      const listed = await mcp.callTool({ name: 'list_entries', arguments: { collection: 'posts', q: 'MCP' } });
      expect(listed.structuredContent.items.map(entry => entry.id)).toEqual([made.structuredContent.item.id]);
      const missing = await mcp.callTool({ name: 'get_entry', arguments: { collection: 'posts', id: 'nope' } });
      expect(missing).toMatchObject({ isError: true, structuredContent: { code: 'CMS_NOT_FOUND' } });
      await expect(mcp.callTool({ name: 'update_entry', arguments: { collection: 'posts' } })).rejects.toThrow(/id is required/);
      expect((await cli(['entries', 'get', 'posts', 'from-mcp'])).data.item.title).toBe('From MCP');
      // Read-only passwords see the reading tools; sessions and visitors are refused.
      const reading = await connect(reader);
      expect((await reading.listTools()).tools.every(tool => tool.annotations.readOnlyHint)).toBe(true);
      await expect(reading.callTool({ name: 'create_entry', arguments: { collection: 'posts', fields: { title: 'No' } } })).rejects.toThrow(/only read/);
      const anonymous = await fetch(`${origin}/api/cms/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get('www-authenticate')).toContain('Bearer');
      const cookie = await web.request('/api/cms/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
      expect(cookie.status).toBe(401);

      // The trash, then a permanent delete, which needs --yes.
      expect((await cli(['entries', 'trash', 'posts', id])).data.item.status).toBe('trash');
      await cli(['entries', 'delete', 'posts', id], { failure: 'COSSACK_CMS_CONFIRM_REQUIRED' });
      expect((await cli(['entries', 'delete', 'posts', id, '--yes'])).data).toBeNull();
      await cli(['entries', 'get', 'posts', id], { failure: 'COSSACK_CMS_NOT_FOUND' });

      if (sites) {
        // A network: the CLI adds a site, and --site (the X-Cossack-Site header) and ?site= reach it through the network host.
        await cli(['sites', 'list'], { failure: 'COSSACK_CMS_FORBIDDEN' });
        const network = { enabled: true, name: 'Managed network', subdomainSuffix: '', defaultTheme: '', defaultPlugins: [], defaultLanguage: '', siteExports: 'request' };
        expect((await web.action(SETTINGS, 'saveAll', [{ document: null, languages: null, permalinks: null, network, groups: {} }]))._cossack_return.error).toBe('');
        const blog = await cli(['sites', 'create', 'Blog', '--host', 'blog.localhost']);
        expect(blog.data).toMatchObject({ id: 'blog', name: 'Blog', host: 'blog.localhost', status: 'active', domains: [{ host: 'blog.localhost', primary: true }] });
        expect((await cli(['sites', 'list'])).data.items.map(entry => entry.id)).toEqual(['main', 'blog']);
        expect((await cli(['whoami', '--site', 'blog'])).data).toMatchObject({ site: { id: 'blog', name: 'Blog' }, user: { email: SETUP.email }, network: { main: false } });
        const starter = await cli(['entries', 'list', 'posts', '--site', 'blog']);
        expect(starter.data.total).toBeGreaterThan(0);
        expect(starter.data.items.map(entry => entry.id)).not.toContain(made.structuredContent.item.id);
        expect((await cli(['settings', 'set', 'general', '--site', 'blog', '--set', 'siteTitle=Blog by the CLI'])).data.values.siteTitle).toBe('Blog by the CLI');
        expect((await cli(['settings', 'get', 'general'])).data.values.siteTitle).toBe('Managed by the CLI');
        await cli(['whoami', '--site', 'nope'], { failure: 'COSSACK_CMS_NOT_FOUND' });
        const blogMcp = await connect(token, '?site=blog');
        expect((await blogMcp.callTool({ name: 'get_site', arguments: {} })).structuredContent.site).toMatchObject({ id: 'blog', name: 'Blog' });
        expect((await cli(['sites', 'archive', 'blog'])).data.status).toBe('archived');
        await cli(['whoami', '--site', 'blog'], { failure: 'COSSACK_CMS_UNAVAILABLE' });
        expect((await cli(['sites', 'restore', 'blog'])).data.status).toBe('active');
        expect((await cli(['sites', 'get', 'blog'])).data.status).toBe('active');
      }

      // Logout revokes the password; the environment's address alone is not a login.
      expect((await cli(['logout'])).data).toMatchObject({ revoked: true, forgotten: true });
      await cli(['whoami'], { failure: 'COSSACK_CMS_LOGIN_REQUIRED' });
      await cli(['whoami'], { env: { COSSACK_CMS_TOKEN: token }, failure: 'COSSACK_CMS_UNAUTHENTICATED' });
    } finally {
      await Promise.all(clients.map(client => client.close().catch(() => undefined)));
      await server.close();
      await database.stop();
      await sites?.stop();
    }
  }, 600_000);
});
