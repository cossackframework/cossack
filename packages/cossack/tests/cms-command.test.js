// `cossack cms`: signs in to a CMS, keeps the application password for the user alone, and drives
// the management API with the right requests, headers, revisions and confirmations. A small fake
// CMS stands in for the application; the generated-runtime CMS test covers the real one.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../src/dispatch.js';
import { setResultSink } from '../src/output.js';
import { parseValue } from '../src/cms/input.js';
import { formatTable } from '../src/cms/output.js';
import { cmsDiagnostics } from '../src/cms/catalog.js';
import { mimeType } from '../src/cms/mime.js';

const TOKEN = `cms_0123456789abcdef.${'s'.repeat(43)}`;
const ME = { user: { id: 'u1', email: 'ada@example.com', name: 'Ada', roles: [{ id: 'admin', name: 'Administrator' }], permissions: ['*'], networkAdmin: true, account: 'network' }, token: { scope: 'write' }, network: { enabled: true, canAddSites: true, main: true } };

/** A fake CMS: records every request, signs in `ada@example.com` / `long password` (with code 123456 for `eve@`). */
function fakeCms() {
  const requests = [];
  const entries = { p1: { id: 'p1', rev: 3, title: 'Hello', status: 'draft', slug: 'hello', updatedAt: 1700000000000 } };
  const server = http.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const url = new URL(request.url, 'http://cms.test');
    let body;
    if (text && /json/.test(request.headers['content-type'] ?? '')) { try { body = JSON.parse(text); } catch { body = { invalid: text }; } }
    const site = request.headers['x-cossack-site'] ?? 'main';
    requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, site, authorization: request.headers.authorization, cookie: request.headers.cookie, origin: request.headers.origin });
    const json = (status, data, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(data === undefined ? '' : JSON.stringify(data)); };
    if (url.pathname === '/api/auth/session' && request.method === 'POST') {
      if (!request.headers.origin) return json(403, { error: 'cross-site' });
      if (body?.password !== 'long password') return json(401, { error: 'Invalid credentials' });
      if (body.email === 'eve@example.com' && body.code !== '123456') return json(401, { error: 'Enter the code.', twoFactorRequired: true });
      return json(200, { ok: true }, { 'set-cookie': ['session_id=sess-1; Path=/; HttpOnly', 'other=1; Path=/'] });
    }
    if (url.pathname === '/api/auth/session' && request.method === 'DELETE') return json(request.headers.cookie?.includes('session_id=sess-1') ? 204 : 401, undefined);
    const bearer = request.headers.authorization === `Bearer ${TOKEN}`;
    if (url.pathname === '/api/cms/me/tokens' && request.method === 'POST') {
      if (!request.headers.cookie?.includes('session_id=sess-1')) return json(401, { error: 'Sign in.', code: 'CMS_UNAUTHENTICATED' });
      return json(201, { token: TOKEN, id: '0123456789abcdef', name: body.name, scope: body.scope });
    }
    if (!bearer) return json(401, { error: 'The application password is not valid.', code: 'CMS_UNAUTHENTICATED' });
    if (url.pathname === '/api/cms/me') return json(200, { ...ME, site: { id: site, name: site === 'main' ? 'Main' : 'Blog', host: 'cms.test', url: 'http://cms.test', status: 'active' } });
    if (url.pathname === '/api/cms/me/tokens/0123456789abcdef' && request.method === 'DELETE') return json(204, undefined);
    if (url.pathname === '/api/cms/collections') return json(200, { items: [{ name: 'posts', label: 'Posts', publishable: true, fields: [{ name: 'title' }, { name: 'content' }] }] });
    if (url.pathname === '/api/cms/content/posts' && request.method === 'GET') return json(200, { items: Object.values(entries), page: 1, pages: 1, total: 1 });
    if (url.pathname === '/api/cms/content/posts' && request.method === 'POST') { entries.p2 = { id: 'p2', rev: 1, ...body }; return json(201, { item: entries.p2 }); }
    if (url.pathname === '/api/cms/content/posts/p1' && request.method === 'GET') return json(200, { item: entries.p1, patterns: {}, translations: {} });
    if (url.pathname === '/api/cms/content/posts/p1' && request.method === 'PATCH') {
      if (body.rev !== entries.p1.rev) return json(409, { error: 'The record changed since it was read.', code: 'CMS_CONFLICT' });
      entries.p1 = { ...entries.p1, ...body, rev: entries.p1.rev + 1 }; delete entries.p1.rev2; return json(200, { item: entries.p1 });
    }
    if (url.pathname === '/api/cms/content/posts/p1' && request.method === 'DELETE') return json(url.searchParams.get('rev') === String(entries.p1.rev) ? 204 : 409, undefined);
    if (url.pathname === '/api/cms/content/posts/p1/publish') return json(200, { item: { ...entries.p1, status: body.at ? 'scheduled' : 'published', publishedAt: body.at ?? 1700000001000 } });
    if (url.pathname === '/api/cms/content/posts/p1/notes' && request.method === 'POST') return json(201, { note: { id: 'n1', ...body } });
    if (url.pathname === '/api/cms/cache/purge' && request.method === 'POST') return json(200, { event: { eventId: 'e1', tags: body.tags ?? ['cms:main'], urls: body.urls ?? [] }, purgers: ['cloudflare'], results: [{ at: 1700000000000, eventId: 'e1', purger: 'cloudflare', reason: 'manual', tags: body.tags ?? ['cms:main'], urls: body.urls ?? [], ok: true, message: '' }] });
    if (url.pathname === '/api/cms/settings/general' && request.method === 'PATCH') {
      if (typeof body.siteTitle !== 'string') return json(422, { error: 'Some settings are invalid.', code: 'CMS_VALIDATION', fields: { siteTitle: 'must be text.' } });
      return json(200, { group: 'general', label: 'General', values: { siteTitle: body.siteTitle, postsPerPage: body.postsPerPage ?? 10 }, fields: [{ name: 'siteTitle', label: 'Site title' }] });
    }
    // Appearance: one menu, two locations and one widget area that starts at revision 0.
    if (url.pathname === '/api/cms/appearance/menus' && request.method === 'GET') return json(200, { items: [{ id: 'm1', name: 'Main', items: 3, locations: ['primary'], updatedAt: 1700000000000 }] });
    if (url.pathname === '/api/cms/appearance/menus' && request.method === 'POST') return json(201, { item: { id: 'm2', rev: 1, locations: [], ...body } });
    if (url.pathname === '/api/cms/appearance/menus/m1' && request.method === 'GET') return json(200, { item: { id: 'm1', name: 'Main', rev: 2, locations: ['primary'], items: [{ id: 'home', kind: 'link', label: 'Home', url: '/', children: [] }] } });
    if (url.pathname === '/api/cms/appearance/menus/m1' && request.method === 'PATCH') return body.rev === 2 ? json(200, { item: { id: 'm1', ...body, rev: 3 } }) : json(409, { error: 'This menu changed since you opened it.', code: 'CMS_CONFLICT' });
    if (url.pathname === '/api/cms/appearance/menus/m1' && request.method === 'DELETE') return json(204, undefined);
    if (url.pathname === '/api/cms/appearance/locations' && request.method === 'GET') return json(200, { items: [{ name: 'primary', label: 'Primary menu', theme: 'default-theme', active: true, menu: 'm1' }, { name: 'footer', label: 'Footer menu', theme: 'default-theme', active: true, menu: null }] });
    if (url.pathname === '/api/cms/appearance/locations/footer' && request.method === 'PATCH') return json(200, { item: { name: 'footer', label: 'Footer menu', theme: 'default-theme', active: true, menu: body.menu } });
    if (url.pathname === '/api/cms/appearance/areas' && request.method === 'GET') return json(200, { items: [{ name: 'header', label: 'Header', theme: 'default-theme', active: true, rev: 0, saved: false, blocks: [{ _id: 'a', type: 'core/site-logo', data: {} }], defaults: [] }] });
    if (url.pathname === '/api/cms/appearance/areas/header' && request.method === 'GET') return json(200, { item: { name: 'header', rev: 0, saved: false, blocks: [] } });
    if (url.pathname === '/api/cms/appearance/areas/header' && request.method === 'PUT') return body.rev === 0 ? json(200, { item: { name: 'header', rev: 1, saved: true, blocks: body.blocks } }) : json(409, { error: 'These widgets changed.', code: 'CMS_CONFLICT' });
    if (url.pathname === '/api/cms/appearance/areas/header' && request.method === 'DELETE') return json(204, undefined);
    if (url.pathname === '/api/cms/media' && request.method === 'POST') return json(201, { files: [{ id: 'f1', name: 'upload' }], contentType: request.headers['content-type'], part: /Content-Type: (\S+)/.exec(text)?.[1] ?? null, name: /filename="([^"]+)"/.exec(text)?.[1] ?? null });
    return json(404, { error: 'Not found.', code: 'CMS_NOT_FOUND' });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, requests, entries, close: () => new Promise(done => server.close(done)) })));
}

let cms, config;
const initialCwd = process.cwd();
const saved = {};
const ENV = ['COSSACK_CONFIG_DIR', 'COSSACK_CMS_URL', 'COSSACK_CMS_TOKEN', 'COSSACK_CMS_SITE', 'CMS_EMAIL', 'CMS_PASSWORD', 'XDG_CONFIG_HOME'];

beforeAll(async () => { cms = await fakeCms(); });
afterAll(async () => { await cms.close(); });
beforeEach(async () => {
  for (const name of ENV) { saved[name] = process.env[name]; delete process.env[name]; }
  config = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cms-cli-'));
  process.env.COSSACK_CONFIG_DIR = config;
  process.chdir(config); // no project: the address must come from flags, the environment or the login
  cms.requests.length = 0;
});
afterEach(async () => {
  process.chdir(initialCwd);
  setResultSink(undefined);
  vi.restoreAllMocks();
  for (const name of ENV) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  await fs.rm(config, { recursive: true, force: true });
});

/** Dispatch in-process, collecting the JSON envelope (when --json) and the human lines. */
async function run(argv) {
  const results = [];
  setResultSink(result => results.push(result));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const code = await dispatch(['cms', ...argv]);
    return { code, result: results[0], stdout: log.mock.calls.map(args => args.join(' ')).join('\n'), stderr: error.mock.calls.map(args => args.join(' ')).join('\n') };
  } finally { setResultSink(undefined); log.mockRestore(); error.mockRestore(); }
}

const login = async (extra = []) => {
  process.env.CMS_PASSWORD = 'long password';
  const { code, result } = await run(['login', '--url', cms.origin, '--email', 'ada@example.com', '--json', ...extra]);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  expect(code).toBe(0);
  return result;
};

describe('cossack cms login', () => {
  it('signs in, creates an application password through the session, ends the session and keeps the password for the user alone', async () => {
    const result = await login(['--name', 'robot']);
    expect(result.data).toMatchObject({ url: cms.origin, user: { email: 'ada@example.com' }, token: { id: '0123456789abcdef', name: 'robot', scope: 'write' }, file: path.join(config, 'cms-logins.json') });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    const calls = cms.requests.map(request => `${request.method} ${request.path}`);
    expect(calls).toEqual(['POST /api/auth/session', 'POST /api/cms/me/tokens', 'DELETE /api/auth/session', 'GET /api/cms/me']);
    expect(cms.requests[0]).toMatchObject({ origin: cms.origin, body: { email: 'ada@example.com', password: 'long password' } });
    expect(cms.requests[1]).toMatchObject({ cookie: 'session_id=sess-1; other=1', body: { name: 'robot', scope: 'write' } });
    expect(cms.requests[3].authorization).toBe(`Bearer ${TOKEN}`);
    const file = path.join(config, 'cms-logins.json');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(config)).mode & 0o777).toBe(0o700);
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(stored).toMatchObject({ version: 1, current: cms.origin, logins: { [cms.origin]: { url: cms.origin, site: null, token: TOKEN, email: 'ada@example.com', name: 'robot', scope: 'write' } } });
  });

  it('asks for a second-factor code when the account needs one, and fails plainly without a terminal', async () => {
    process.env.CMS_PASSWORD = 'long password';
    const denied = await run(['login', '--url', cms.origin, '--email', 'eve@example.com', '--json']);
    expect(denied.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_TWO_FACTOR_REQUIRED' }] });
    const ok = await run(['login', '--url', cms.origin, '--email', 'eve@example.com', '--code', '123456', '--json']);
    expect(ok.result).toMatchObject({ ok: true });
    process.env.CMS_PASSWORD = 'wrong';
    const wrong = await run(['login', '--url', cms.origin, '--email', 'ada@example.com', '--json']);
    expect(wrong.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_SIGN_IN_FAILED' }] });
    delete process.env.CMS_PASSWORD;
    const missing = await run(['login', '--url', cms.origin, '--email', 'ada@example.com', '--json']);
    expect(missing.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_CREDENTIALS_REQUIRED' }] });
  });

  it('stores a pasted application password, scoped to a site, and signs it out again', async () => {
    const { result } = await run(['login', '--url', cms.origin, '--site', 'blog', '--token', TOKEN, '--json']);
    expect(result).toMatchObject({ ok: true, data: { site: { id: 'blog' } } });
    expect(cms.requests.map(request => `${request.method} ${request.path} ${request.site}`)).toEqual(['GET /api/cms/me blog']);
    const who = await run(['whoami', '--json']);
    expect(who.result.data.site.id).toBe('blog');
    expect(cms.requests.at(-1).site).toBe('blog');
    const out = await run(['logout', '--json']);
    expect(out.result).toMatchObject({ ok: true, data: { revoked: true, forgotten: true, site: 'blog' } });
    expect(cms.requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/cms/me/tokens/0123456789abcdef', site: 'blog' });
    expect(JSON.parse(await fs.readFile(path.join(config, 'cms-logins.json'), 'utf8')).logins).toEqual({});
    const gone = await run(['whoami', '--json']);
    expect(gone.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_URL_REQUIRED' }] });
  });

  it('prefers the environment over the stored login, for CI', async () => {
    process.env.COSSACK_CMS_URL = cms.origin;
    process.env.COSSACK_CMS_TOKEN = TOKEN;
    process.env.COSSACK_CMS_SITE = 'blog';
    const who = await run(['whoami', '--json']);
    expect(who.result).toMatchObject({ ok: true, data: { user: { email: 'ada@example.com' }, site: { id: 'blog' } } });
    const main = await run(['whoami', '--site', 'main', '--json']);
    expect(main.result.data.site.id).toBe('main');
  });
});

describe('cossack cms commands', () => {
  beforeEach(() => login());

  it('reads collections and entries as tables or JSON, passing the filters through', async () => {
    const human = await run(['collections', 'list']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('NAME   LABEL  PUBLISHABLE  FIELDS');
    expect(human.stdout).toContain('posts  Posts  true         title content');
    const json = await run(['entries', 'list', 'posts', '--status', 'any', '--q', 'hello', '--per-page', '5', '--filter', 'featured=true', '--json']);
    expect(json.result).toMatchObject({ ok: true, command: 'cms', data: { total: 1, items: [{ id: 'p1' }] } });
    expect(cms.requests.at(-1)).toMatchObject({ method: 'GET', path: '/api/cms/content/posts', query: { status: 'any', q: 'hello', perPage: '5', 'filter[featured]': 'true' }, authorization: `Bearer ${TOKEN}` });
    const list = await run(['entries', 'list', 'posts']);
    expect(list.stdout).toMatch(/ID  STATUS  TITLE  SLUG   UPDATED\np1  draft   Hello  hello  2023-11-14 22:13\n1 in all\./);
    const one = await run(['entries', 'get', 'posts', 'p1']);
    expect(JSON.parse(one.stdout)).toMatchObject({ item: { id: 'p1', rev: 3 } });
  });

  it('creates and changes entries from --set and --data, reading the revision first and sending the given one', async () => {
    const created = await run(['entries', 'create', 'posts', '--set', 'title=Hello world', '--set', 'menuOrder=3', '--set', 'seo.title=SEO', '--data', '{"status":"draft","tags":["a"]}', '--json']);
    expect(created.result).toMatchObject({ ok: true, data: { item: { id: 'p2' } } });
    expect(cms.requests.at(-1).body).toEqual({ status: 'draft', tags: ['a'], title: 'Hello world', menuOrder: 3, seo: { title: 'SEO' } });
    const updated = await run(['entries', 'update', 'posts', 'p1', '--set', 'title=Renamed', '--json']);
    expect(updated.result).toMatchObject({ ok: true, data: { item: { title: 'Renamed', rev: 4 } } });
    expect(cms.requests.slice(-2).map(request => `${request.method} ${request.path}`)).toEqual(['GET /api/cms/content/posts/p1', 'PATCH /api/cms/content/posts/p1']);
    expect(cms.requests.at(-1).body).toEqual({ title: 'Renamed', rev: 3 });
    const stale = await run(['entries', 'update', 'posts', 'p1', '--set', 'title=Again', '--rev', '3', '--json']);
    expect(stale.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_CONFLICT', message: 'The record changed since it was read.' }] });
    expect(cms.requests.at(-1)).toMatchObject({ method: 'PATCH', body: { title: 'Again', rev: 3 } });
    const file = path.join(config, 'entry.json');
    await fs.writeFile(file, JSON.stringify({ title: 'From a file' }));
    await run(['entries', 'update', 'posts', 'p1', '--data', `@${file}`, '--json']);
    expect(cms.requests.at(-1).body).toEqual({ title: 'From a file', rev: 4 });
  });

  it('purges the caches in front of the site: every page, or the tags and pages given', async () => {
    const all = await run(['cache', 'purge']);
    expect(all.code).toBe(0);
    expect(cms.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/cms/cache/purge', body: {} });
    expect(all.stdout).toMatch(/cloudflare\s+yes\s+cms:main/);
    const narrow = await run(['cache', 'purge', '--tag', 'cms:main:c:posts', '--tag', 'cms:main:c:pages', '--path', 'https://example.com/', '--json']);
    expect(narrow.result).toMatchObject({ ok: true, data: { purgers: ['cloudflare'] } });
    expect(cms.requests.at(-1).body).toEqual({ tags: ['cms:main:c:posts', 'cms:main:c:pages'], urls: ['https://example.com/'] });
  });

  it('publishes, schedules, adds notes, changes settings and reports field problems', async () => {
    const published = await run(['entries', 'publish', 'posts', 'p1', '--json']);
    expect(published.result.data.item.status).toBe('published');
    expect(cms.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/cms/content/posts/p1/publish', body: {} });
    const scheduled = await run(['entries', 'publish', 'posts', 'p1', '--at', '2030-01-01T09:00:00Z', '--rev', '3', '--json']);
    expect(scheduled.result.data.item.status).toBe('scheduled');
    expect(cms.requests.at(-1).body).toEqual({ at: '2030-01-01T09:00:00Z', rev: 3 });
    const note = await run(['notes', 'add', 'posts', 'p1', '--body', 'Check the title', '--target', 'field:title', '--json']);
    expect(note.result).toMatchObject({ ok: true, data: { note: { id: 'n1', body: 'Check the title', target: 'field:title' } } });
    const reply = await run(['notes', 'add', 'posts', 'p1', '--body', 'Done', '--reply-to', 'n1', '--json']);
    expect(cms.requests.at(-1).body).toEqual({ body: 'Done', parentId: 'n1' });
    expect(reply.code).toBe(0);
    const settings = await run(['settings', 'set', 'general', '--set', 'siteTitle=My site', '--set', 'postsPerPage=12']);
    expect(settings.code).toBe(0);
    expect(settings.stdout).toMatch(/siteTitle\s+"My site"/);
    expect(cms.requests.at(-1).body).toEqual({ siteTitle: 'My site', postsPerPage: 12 });
    const invalid = await run(['settings', 'set', 'general', '--set', 'siteTitle=7', '--json']);
    expect(invalid.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_INVALID', message: 'Some settings are invalid. siteTitle must be text.' }] });
  });

  it('requires --yes before deleting, validates the command shape, and uploads files as a form', async () => {
    const refused = await run(['entries', 'delete', 'posts', 'p1', '--json']);
    expect(refused.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_CONFIRM_REQUIRED' }] });
    expect(cms.requests.filter(request => request.method === 'DELETE' && request.path.startsWith('/api/cms/'))).toEqual([]);
    const current = String(cms.entries.p1.rev);
    const deleted = await run(['entries', 'delete', 'posts', 'p1', '--yes', '--json']);
    expect(deleted.result).toMatchObject({ ok: true, data: null });
    // The revision was read first, so the delete names the current one.
    expect(cms.requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/cms/content/posts/p1', query: { rev: current } });
    const unknownNoun = await run(['widgets', 'list', '--json']);
    expect(unknownNoun.result.diagnostics[0]).toMatchObject({ code: 'COSSACK_ACTION_UNKNOWN' });
    const noVerb = await run(['entries', '--json']);
    expect(noVerb.result.diagnostics[0].message).toContain('cms entries needs a subcommand: list, get, create');
    const missing = await run(['entries', 'get', 'posts', '--json']);
    expect(missing.result.diagnostics[0]).toMatchObject({ code: 'COSSACK_ARGUMENT_MISSING', message: 'cms entries get takes <collection> <id>.' });
    const stray = await run(['entries', 'list', 'posts', '--rev', '2', '--json']);
    expect(stray.result.diagnostics[0]).toMatchObject({ code: 'COSSACK_OPTION_UNSUPPORTED' });
    expect(stray.result.diagnostics[0].message).toContain('--rev is not an option of cms entries list.');
    const unknownOption = await run(['entries', 'list', 'posts', '--bogus', '--json']);
    expect(unknownOption.result.diagnostics[0]).toMatchObject({ code: 'COSSACK_OPTION_UNKNOWN' });
    const picture = path.join(config, 'pixel.png');
    await fs.writeFile(picture, Buffer.from('89504e470d0a1a0a', 'hex'));
    const uploaded = await run(['media', 'upload', picture, '--json']);
    expect(uploaded.result).toMatchObject({ ok: true, data: { files: [{ id: 'f1' }] } });
    expect(cms.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/cms/media' });
    expect(uploaded.result.data.contentType).toMatch(/^multipart\/form-data; boundary=/);
    // The part carries the file's name and a media type from its extension, which the CMS classes files by.
    expect(uploaded.result.data).toMatchObject({ part: 'image/png', name: 'pixel.png' });
  });

  it('manages menus, their locations and widget areas, reading a revision that may be 0', async () => {
    const menus = await run(['menus', 'list']);
    expect(menus.code).toBe(0);
    expect(menus.stdout).toMatch(/ID  NAME  ITEMS  LOCATIONS  UPDATED\nm1  Main  3      primary    2023-11-14 22:13/);
    const items = [{ kind: 'link', label: 'Products', url: '/products', panel: 'pat1', children: [{ kind: 'heading', label: 'By team', children: [{ kind: 'link', label: 'Sales', url: '/sales' }] }] }];
    const created = await run(['menus', 'create', 'Header', '--location', 'primary', '--location', 'footer', '--data', JSON.stringify({ items }), '--json']);
    expect(created.result).toMatchObject({ ok: true, data: { item: { id: 'm2', name: 'Header' } } });
    expect(cms.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/cms/appearance/menus', body: { name: 'Header', items, locations: ['primary', 'footer'] } });
    const renamed = await run(['menus', 'update', 'm1', '--name', 'Main menu', '--location', 'footer', '--json']);
    expect(renamed.result).toMatchObject({ ok: true, data: { item: { rev: 3, name: 'Main menu' } } });
    expect(cms.requests.slice(-2).map(request => `${request.method} ${request.path}`)).toEqual(['GET /api/cms/appearance/menus/m1', 'PATCH /api/cms/appearance/menus/m1']);
    expect(cms.requests.at(-1).body).toEqual({ name: 'Main menu', locations: ['footer'], rev: 2 });
    const stale = await run(['menus', 'update', 'm1', '--data', JSON.stringify({ items }), '--rev', '1', '--json']);
    expect(stale.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_CONFLICT' }] });
    expect((await run(['menus', 'delete', 'm1', '--json'])).result.diagnostics[0].code).toBe('COSSACK_CMS_CONFIRM_REQUIRED');
    expect((await run(['menus', 'delete', 'm1', '--yes', '--json'])).result).toMatchObject({ ok: true, data: null });
    const locations = await run(['locations', 'list']);
    expect(locations.stdout).toMatch(/NAME     LABEL         THEME          ACTIVE  MENU\nprimary  Primary menu  default-theme  true    m1\nfooter   Footer menu   default-theme  true/);
    await run(['locations', 'set', 'footer', 'm2', '--json']);
    expect(cms.requests.at(-1)).toMatchObject({ method: 'PATCH', path: '/api/cms/appearance/locations/footer', body: { menu: 'm2' } });
    const cleared = await run(['locations', 'clear', 'footer', '--json']);
    expect(cleared.result.data.item.menu).toBeNull();
    expect(cms.requests.at(-1).body).toEqual({ menu: null });
    const areas = await run(['areas', 'list']);
    expect(areas.stdout).toMatch(/NAME    LABEL   THEME          ACTIVE  REV  SAVED  BLOCKS\nheader  Header  default-theme  true    0    false  1/);
    // An unsaved area has revision 0, which the read before a write accepts.
    const blocks = [{ _id: 'logo', type: 'core/site-logo', data: { showTagline: true } }];
    const saved = await run(['areas', 'set', 'header', '--data', JSON.stringify({ blocks }), '--json']);
    expect(saved.result).toMatchObject({ ok: true, data: { item: { rev: 1, saved: true } } });
    expect(cms.requests.slice(-2).map(request => `${request.method} ${request.path}`)).toEqual(['GET /api/cms/appearance/areas/header', 'PUT /api/cms/appearance/areas/header']);
    expect(cms.requests.at(-1).body).toEqual({ blocks, rev: 0 });
    const given = await run(['areas', 'set', 'header', '--data', JSON.stringify({ blocks }), '--rev', '4', '--json']);
    expect(given.result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CMS_CONFLICT' }] });
    expect(cms.requests.at(-1).body).toEqual({ blocks, rev: 4 });
    expect((await run(['areas', 'reset', 'header', '--json'])).result.diagnostics[0].code).toBe('COSSACK_CMS_CONFIRM_REQUIRED');
    expect((await run(['areas', 'reset', 'header', '--yes', '--json'])).result).toMatchObject({ ok: true, data: null });
    expect(cms.requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/cms/appearance/areas/header' });
  });

  it('prints the MCP client configuration for the stored login', async () => {
    const json = await run(['mcp', '--site', 'blog']);
    expect(JSON.parse(json.stdout)).toEqual({ mcpServers: { [`cms-127-0-0-1-blog`]: { type: 'http', url: `${cms.origin}/api/cms/mcp?site=blog`, headers: { Authorization: `Bearer ${TOKEN}` } } } });
    const claude = await run(['mcp', '--format', 'claude', '--name', 'blog']);
    expect(claude.stdout).toBe(`claude mcp add --transport http blog "${cms.origin}/api/cms/mcp" --header "Authorization: Bearer ${TOKEN}"`);
    const help = await run(['--help']);
    expect(help.stdout).toContain('entries publish <collection> <id>');
    expect(help.stdout).toContain('--site <value>');
  });
});

describe('cms helpers', () => {
  it('parses --set values as JSON when they are JSON', () => {
    expect(['3', 'true', 'null', '["a"]', '{"a":1}', '"quoted"', 'plain text', '1984 text', ''].map(parseValue)).toEqual([3, true, null, ['a'], { a: 1 }, 'quoted', 'plain text', '1984 text', '']);
  });
  it('names media types from file extensions', () => {
    expect(['a.PNG', 'b.jpeg', 'c.mp4', 'd.pdf', 'e.zip', 'noext', 'f.unknownext'].map(mimeType)).toEqual(['image/png', 'image/jpeg', 'video/mp4', 'application/pdf', 'application/zip', 'application/octet-stream', 'application/octet-stream']);
  });
  it('lays out tables with aligned columns', () => {
    expect(formatTable([{ a: 'x', b: null }, { a: 'longer', b: { k: 1 } }], ['a', { name: 'B', value: row => row.b }])).toBe('A       B\nx\nlonger  {"k":1}');
    expect(formatTable([], ['a'])).toBe('(none)');
  });
  it('describes the commands in diagnostics', () => {
    expect(cmsDiagnostics(['sites', 'create'], {})).toEqual([{ code: 'COSSACK_ARGUMENT_MISSING', severity: 'error', message: 'cms sites create takes <name>.' }]);
    expect(cmsDiagnostics(['notes', 'list'], {})).toEqual([]);
    expect(cmsDiagnostics(['notes', 'list', 'posts', 'p1'], { status: 'open' })).toEqual([]);
    expect(cmsDiagnostics(['login', 'extra'], {})).toEqual([{ code: 'COSSACK_ARGUMENT_UNEXPECTED', severity: 'error', message: 'cms login takes no arguments.' }]);
    expect(cmsDiagnostics(['media', 'upload', 'a.png', 'b.png', 'c.png'], {})).toEqual([]);
  });
});
