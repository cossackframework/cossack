// The cms feature in a generated application against a local `fastdb serve`: template and
// type checks, setup through /auth/setup, the shared /dashboard with users and settings,
// posts with rich text, terms and media, a collection built in the dashboard with blocks,
// themes, menus, the content API, the public site and background outbox delivery. The same
// flow runs on Node and on Workers; a browser case drives the editors.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, cossack, productionServer, project, typecheck, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks, PNG, visible } from './fixtures/cms-client.js';
import { liveFastDBTests, startFastDBService } from '../../fastdb/src/testing.ts';

afterEach(cleanupRoots);

const doc = (...content) => ({ type: 'doc', content });
const paragraph = (...content) => ({ type: 'paragraph', content });
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks: marks.map(type => ({ type })) } : {}) });

async function exercise(origin, routeIds, diagnostics) {
  const web = browserless(origin, routeIds, diagnostics);
  // Before setup the site is unavailable and sign-in leads to setup.
  const early = await web.request('/');
  expect(early.status).toBe(503);
  contains(await early.text(), 'This site is being set up');
  expect((await web.request('/posts')).status).toBe(503);
  expect((await web.request('/dashboard')).headers.get('location')).toBe('/auth/login');
  expect((await web.request('/auth/login')).headers.get('location')).toBe('/auth/setup');
  contains(await web.page('/auth/setup'), 'Set up your site');
  expect((await web.post('/auth/setup', { code: 'wrong', siteTitle: 'x', name: 'Ada', email: 'ada@example.com', password: 'long password' })).headers.get('location')).toBe('/auth/setup');
  const setup = await web.post('/auth/setup', { code: 'setup-code-for-tests', siteTitle: 'The Daily', name: 'Ada', email: 'ada@example.com', password: 'long password' });
  expect(setup.headers.get('location'), await setup.text()).toBe('/dashboard');
  expect([...web.jar.keys()]).toContain('session_id');

  // The shared dashboard: CMS navigation, users and the site name.
  const dashboard = await web.page('/dashboard');
  for (const link of ['/dashboard/content/posts', '/dashboard/content/pages', '/dashboard/media', '/dashboard/collections', '/dashboard/settings/general', '/dashboard/users', '/dashboard/terms/categories'])
    contains(dashboard, `href="${link}"`);
  contains(dashboard, 'At a glance');
  contains(dashboard, 'The Daily');
  contains(await web.page('/dashboard/users'), 'ada@example.com');
  contains(await web.page('/dashboard/roles'), 'Editor');

  // Terms: nested categories.
  const terms = 'dashboard/(cms)/terms/[taxonomy]/index.ts';
  const categories = { taxonomy: { name: 'categories', label: 'Categories', singular: 'Category', hierarchical: true, path: 'category' } };
  await web.action(terms, 'create', [{ name: 'News', slug: '', parent: '', description: 'Daily news' }], { params: { taxonomy: 'categories' }, state: categories });
  const tree = await web.action(terms, 'load', [], { params: { taxonomy: 'categories' } });
  const news = tree.rows.find(row => row.name === 'News');
  await web.action(terms, 'create', [{ name: 'Local', slug: '', parent: news.id, description: '' }], { params: { taxonomy: 'categories' }, state: categories });
  expect(await web.page('/dashboard/terms/categories')).toMatch(/— Local/);

  // Media: upload, then serve with a safe content type.
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'pixel.png');
  const uploaded = await web.request('/api/cms/media', { method: 'POST', body: form });
  const upload = await uploaded.json();
  expect(uploaded.status, JSON.stringify(upload)).toBe(201);
  const image = upload.files[0];
  expect(image).toMatchObject({ width: 1, height: 1, contentType: 'image/png' });
  const served = await fetch(origin + image.url);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-type')).toBe('image/png');
  expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG);
  const disguised = new FormData();
  disguised.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
  expect((await web.request('/api/cms/media', { method: 'POST', body: disguised })).status).toBe(422);
  contains(await web.page('/dashboard/media'), 'pixel');

  // A post with a generated slug, a category, typed tags and a featured image.
  const editor = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
  const created = await web.action(editor, 'save', [{
    title: 'Hello, World!', slug: '', excerpt: '', content: [{ id: 'rt', type: 'core/richtext', data: { text: doc(paragraph(text('First '), text('post', ['bold']), text(' about a zeppelin <script>alert(1)</script>'))) } }], status: 'draft', publishedAt: '',
    sticky: false, featuredImage: image.id, categories: [news.id], tags: ['Intro', 'Weather'],
  }, 'publish', 0], { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  expect(created._cossack_redirect).toMatch(/^\/dashboard\/content\/posts\/[0-9a-f-]{36}\?saved=1$/);
  const edit = await web.page(created._cossack_redirect);
  contains(edit, '/posts/hello-world');
  contains(edit, 'Saved.');
  const post = visible(await web.page('/posts/hello-world'));
  contains(post, '<strong>post</strong>');
  contains(post, '&lt;script&gt;');
  lacks(post, '<script>alert(1)</script>');
  contains(post, image.url);
  contains(await web.page('/category/news'), 'Hello, World!');
  contains(await web.page('/tag/intro'), 'Hello, World!');
  contains(await web.page('/posts'), 'Hello, World!');
  contains(await web.page('/search?q=hello'), 'Hello, World!');
  // Rich text bodies are searched by their text.
  contains(await web.page('/search?q=zeppelin'), 'Hello, World!');
  const feed = await fetch(origin + '/feed');
  expect(feed.headers.get('content-type')).toContain('application/rss+xml');
  expect(await feed.text()).toContain('<title>Hello, World!</title>');
  const list = await web.page('/dashboard/content/posts');
  contains(list, 'Hello, World!');
  expect(/Published\s*<span[^>]*>\(1\)/.test(list), 'one published post in the status tabs').toBe(true);
  // A draft saved from the editor shows in the Drafts tab.
  await web.action(editor, 'save', [{ title: 'Quick idea', slug: '', status: 'draft', publishedAt: '', content: [{ id: 'q1', type: 'core/paragraph', data: { text: 'Line one' } }] }, 'draft', 0],
    { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  contains(await web.page('/dashboard/content/posts?status=draft'), 'Quick idea');

  // A collection built in the dashboard, with a blocks field and a taxonomy.
  const collections = 'dashboard/(cms)/collections/new/index.ts';
  expect((await web.action(collections, 'create', ['Products', 'Product', 'box']))._cossack_redirect).toBe('/dashboard/collections/products?created=1');
  // The builder lays fields out as field blocks.
  const field = (name, label, kind, extra = {}) => ({ id: name, type: `field/${kind}`, data: { name, label, ...extra } });
  const builder = await web.action('dashboard/(cms)/collections/[name]/index.ts', 'save', [
    { name: 'products', label: 'Products', singular: 'Product', description: 'Things we sell.', icon: 'box', path: 'shop', public: true, slug: true, publishable: true,
      hierarchical: false, visibility: 'private', taxonomies: ['tags'], builtin: false },
    [field('price', 'Price', 'number', { required: true, min: 0 }), field('sku', 'SKU', 'text', { unique: true }), field('content', 'Content', 'blocks')],
  ], { params: { name: 'products' } });
  expect(builder.error).toBe('');
  contains(await web.page('/dashboard'), 'href="/dashboard/content/products"');
  const product = await web.action(editor, 'save', [{
    title: 'Rocket skates', slug: '', status: 'draft', publishedAt: '', price: '19.5', sku: 'RS-1', tags: ['Intro'],
    content: [{ id: 'b1', type: 'core/heading', data: { text: 'Fast wheels', level: 'h2' } }, { id: 'b2', type: 'core/paragraph', data: { text: 'Very **fast**' } },
      { id: 'b3', type: 'core/image', data: { image: image.id, caption: 'A pixel', link: '' } }, { id: 'b4', type: 'core/button', data: { label: 'Buy', url: 'javascript:alert(1)', style: 'primary' } }],
  }, 'publish', 0], { params: { collection: 'products', id: 'new' }, state: { route: 'products', id: 'new' } });
  // A button that links to script is refused.
  expect(product.errors.content).toContain('b4.url');
  const saved = await web.action(editor, 'save', [{
    title: 'Rocket skates', slug: '', status: 'draft', publishedAt: '', price: '19.5', sku: 'RS-1', tags: ['Intro'],
    content: [{ id: 'b1', type: 'core/heading', data: { text: 'Fast wheels', level: 'h2' } }, { id: 'b2', type: 'core/paragraph', data: { text: 'Very **fast**' } },
      { id: 'b3', type: 'core/image', data: { image: image.id, caption: 'A pixel', link: '' } }],
  }, 'publish', 0], { params: { collection: 'products', id: 'new' }, state: { route: 'products', id: 'new' } });
  expect(saved._cossack_redirect).toMatch(/^\/dashboard\/content\/products\//);
  const productPage = await web.page('/shop/rocket-skates');
  contains(productPage, 'Fast wheels');
  contains(productPage, 'Very <strong>fast</strong>');
  contains(productPage, '19.5');
  contains(productPage, 'A pixel');
  contains(await web.page('/shop'), 'Rocket skates');
  contains(await web.page('/tag/intro'), 'Hello, World!');

  // Settings change the site title, registration and the home page.
  const settings = 'dashboard/(cms)/settings/[group]/index.ts';
  const visitor = browserless(origin, routeIds, diagnostics);
  contains(await visitor.page('/auth/register'), 'Registration is closed');
  expect((await web.action(settings, 'save', [{ siteTitle: 'Rocket News', usersCanRegister: true }], { params: { group: 'general' } })).error).toBe('');
  contains(await visitor.page('/'), 'Rocket News');
  lacks(await visitor.page('/auth/register'), 'Registration is closed');
  const registered = await visitor.action('auth/register/index.ts', 'register', [{ name: 'Bob', email: 'bob@example.com', password: 'another password' }]);
  expect(registered._cossack_redirect).toBe('/dashboard');
  lacks(await visitor.page('/dashboard'), 'href="/dashboard/content/posts"');
  contains(await web.page('/dashboard/users'), 'bob@example.com');

  // Add user: an administrator chooses the roles.
  const newUser = 'dashboard/users/new/index.ts';
  contains(await web.page('/dashboard/users/new'), '<legend');
  expect((await web.action(newUser, 'create', ['Eve', 'eve@example.com', 'eve password 1', ['editor']]))._cossack_redirect).toBe('/dashboard/users');
  contains(await web.page('/dashboard/users?role=Editor'), 'eve@example.com');
  // A user manager without cms:roles adds users with the default role and cannot take over administrators.
  await web.action('dashboard/roles/new/index.ts', 'create', ['User manager', ['cms:dashboard', 'cms:users']]);
  await web.action(newUser, 'create', ['Max', 'max@example.com', 'max password 1', ['user-manager']]);
  const manager = browserless(origin, routeIds, diagnostics);
  expect((await manager.request('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'max@example.com', password: 'max password 1' }) })).status).toBe(200);
  const managerForm = await manager.page('/dashboard/users/new');
  lacks(managerForm, '<legend');
  contains(managerForm, 'The new user gets the default role');
  await manager.action(newUser, 'create', ['Mallory', 'mallory@example.com', 'mallory password', ['admin']]);
  lacks(await web.page('/dashboard/users?role=Administrator'), 'mallory@example.com');
  contains(await web.page('/dashboard/users?role=Subscriber'), 'mallory@example.com');
  expect((await manager.request('/dashboard/roles')).headers.get('location')).toBe('/dashboard');
  lacks(await manager.page('/dashboard'), 'href="/dashboard/roles"');
  const adaId = /href="\/dashboard\/users\/([0-9a-f-]{36})"/.exec(await web.page('/dashboard/users?search=ada%40example.com'))?.[1];
  expect(adaId).toBeTruthy();
  contains(await manager.page(`/dashboard/users/${adaId}`), 'Only an administrator can change this account.');
  const takeover = await manager.action('dashboard/users/[id]/index.ts', 'applyPasswordChange', ['taken over!'], { params: { id: adaId }, state: { userDetail: { id: adaId, name: 'Ada', email: 'ada@example.com', avatar: null, createdAt: new Date().toISOString(), roles: [] } } }).catch(error => error);
  expect(String(takeover?.message ?? JSON.stringify(takeover))).toContain('Only an administrator');

  const home = await web.action(editor, 'save', [{ title: 'Home', slug: '', status: 'draft', publishedAt: '', content: [{ id: 'rt', type: 'core/richtext', data: { text: doc(paragraph(text('Welcome home'))) } }], excerpt: '', featuredImage: '', parent: '', menuOrder: '0' }, 'publish', 0],
    { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
  const homeId = home._cossack_redirect.split('/').at(-1).split('?')[0];
  const team = await web.action(editor, 'save', [{ title: 'Team', slug: '', status: 'draft', publishedAt: '', content: [{ id: 'rt', type: 'core/richtext', data: { text: doc(paragraph(text('Our team'))) } }], excerpt: '', featuredImage: '', parent: homeId, menuOrder: '1' }, 'publish', 0],
    { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
  const teamId = team._cossack_redirect.split('/').at(-1).split('?')[0];
  contains(await visitor.page('/home/team'), 'Our team');
  const moved = await fetch(origin + '/team', { redirect: 'manual' });
  expect(moved.status).toBe(301);
  expect(moved.headers.get('location')).toBe('/home/team');
  expect((await web.action(settings, 'save', [{ showOnFront: 'page', pageOnFront: homeId }], { params: { group: 'reading' } })).error).toBe('');
  const front = await visitor.page('/');
  contains(front, 'Welcome home');
  // Without a menu, the primary location lists the top-level pages.
  contains(front, 'href="/home"');
  expect((await fetch(origin + '/missing-page')).status).toBe(404);
  expect((await fetch(origin + '/api/missing')).status).toBe(404);

  // Themes: the default theme is active and its options apply on the site.
  contains(await web.page('/dashboard'), 'href="/dashboard/appearance"');
  const themes = await web.page('/dashboard/appearance');
  contains(themes, 'Cossack Default');
  // The default theme ships its logo and cover as build assets; Vite inlines small ones.
  const covers = [...themes.matchAll(/<img src="?([^"\s>]+)/g)].map(match => match[1]).filter(src => src.startsWith('data:image/svg+xml') || /\.svg$/.test(src));
  expect(covers.length, 'theme logo and cover').toBeGreaterThanOrEqual(2);
  for (const src of covers.filter(entry => entry.startsWith('/'))) {
    const response = await fetch(origin + src);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
  }
  const plugins = await web.page('/dashboard/plugins');
  expect(plugins).toMatch(/data-plugin="?default-theme/);
  contains(plugins, 'Manage in Appearance');
  const customize = 'dashboard/(cms)/appearance/customize/index.ts';
  const customized = await web.action(customize, 'save', [{ accent: 'rose', width: 'wide', showSearch: false, footerText: 'Made with rockets', fontFamily: 'serif', baseSize: 'large', headingWeight: 'semibold' }, [], [], ''], { state: { theme: { name: 'default-theme', label: 'Cossack Default' } } });
  expect(customized.error).toBe('');
  const themed = await visitor.page('/');
  contains(themed, 'Made with rockets');
  contains(themed, '--primary: oklch(0.586');
  // The typography options render as a stylesheet in the head.
  expect(themed).toMatch(/<style data-theme-typography[^>]*>[^<]*html\s*\{\s*font-size:\s*18px;?\s*\}[^<]*font-weight:\s*600/);
  contains(themed, 'Georgia');
  lacks(themed, 'role="search"');
  expect((await visitor.request('/dashboard/appearance')).headers.get('location')).toBe('/dashboard');

  // Menus: a nested page, a category and a link in the primary location.
  const created2 = await web.action('dashboard/(cms)/appearance/menus/index.ts', 'create', ['Main menu']);
  expect(created2._cossack_redirect).toMatch(/^\/dashboard\/appearance\/menus\/[0-9a-f-]{36}$/);
  const menuId = created2._cossack_redirect.split('/').at(-1);
  const menuEditor = 'dashboard/(cms)/appearance/menus/[id]/index.ts';
  const rows = [
    { id: 'home', kind: 'entry', label: '', collection: 'pages', entry: homeId, depth: 0 },
    { id: 'team', kind: 'entry', label: 'Meet the team', collection: 'pages', entry: teamId, depth: 1 },
    { id: 'news', kind: 'term', label: '', taxonomy: 'categories', term: news.id, depth: 0 },
    { id: 'docs', kind: 'link', label: 'Docs', url: 'https://example.com/docs', newTab: true, depth: 0 },
  ];
  const savedMenu = await web.action(menuEditor, 'save', ['Main menu', rows, 1, ['primary']], { params: { id: menuId }, state: { id: menuId } });
  expect(savedMenu.error).toBe('');
  expect(savedMenu.revision).toBe(2);
  // A second editor that opened revision 1 changes nothing.
  const stale = await web.action(menuEditor, 'save', ['Main menu', rows.slice(0, 1), 1, ['primary']], { params: { id: menuId }, state: { id: menuId } });
  expect(stale.error).toContain('changed since');
  const menuSite = visible(await visitor.page('/posts'));
  contains(menuSite, 'href="/home/team"');
  contains(menuSite, 'Meet the team');
  contains(menuSite, 'href="/category/news"');
  contains(menuSite, 'href="https://example.com/docs"');
  const menuApi = await (await fetch(origin + '/api/cms/menus/primary')).json();
  expect(menuApi.items.map(item => [item.label, item.url, item.children.map(child => child.url)])).toEqual([
    ['Home', '/home', ['/home/team']], ['News', '/category/news', []], ['Docs', 'https://example.com/docs', []],
  ]);
  contains(await web.page('/dashboard/appearance/menus'), 'Main menu');

  // The content API returns the content as blocks with rich text as JSON, or rendered on request.
  const apiList = await (await fetch(origin + '/api/cms/content/posts')).json();
  expect(apiList.items.map(item => item.title)).toEqual(['Hello, World!']);
  expect(apiList.items[0].content[0]).toMatchObject({ type: 'core/richtext', data: { text: { type: 'doc' } } });
  expect(apiList.items[0].url).toBe('/posts/hello-world');
  const apiEntry = await (await fetch(origin + '/api/cms/content/posts/hello-world?format=html')).json();
  expect(apiEntry.item.html.content).toContain('<strong>post</strong>');
  expect(apiEntry.item.html.content).toContain('&lt;script&gt;');
  expect((await (await fetch(origin + '/api/cms/content/posts?term=categories:news')).json()).total).toBe(1);
  expect((await fetch(origin + '/api/cms/content/nothing')).status).toBe(404);

  // Permalinks: posts move to the site root, and a posts page lists them.
  const permalinks = 'dashboard/(cms)/settings/permalinks/index.ts';
  expect((await web.action(permalinks, 'save', [true, 'posts', [{ name: 'categories', path: 'category' }, { name: 'tags', path: 'tag' }]])).error).toBe('');
  contains(await visitor.page('/hello-world'), 'zeppelin');
  // Old addresses redirect to the new ones.
  const oldPost = await fetch(origin + '/posts/hello-world', { redirect: 'manual' });
  expect([oldPost.status, oldPost.headers.get('location')]).toEqual([301, '/hello-world']);
  const blogPage = await web.action(editor, 'save', [{ title: 'Blog', slug: '', status: 'draft', publishedAt: '', content: [], excerpt: '', featuredImage: '', parent: '', menuOrder: '5' }, 'publish', 0],
    { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
  expect((await web.action(settings, 'save', [{ pageForPosts: blogPage._cossack_redirect.split('/').at(-1).split('?')[0] }], { params: { group: 'reading' } })).error).toBe('');
  contains(await visitor.page('/blog'), 'Hello, World!');
  contains(await visitor.page('/blog'), 'href="/hello-world"');
  // A new post cannot take a slug the site's routes own.
  const reserved = await web.action(editor, 'save', [{ title: 'Search', slug: '', excerpt: '', content: [], status: 'draft', publishedAt: '', sticky: false, featuredImage: '', categories: [], tags: [] }, 'publish', 0],
    { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  contains(await web.page(reserved._cossack_redirect), '/search-2');
  expect((await web.action(permalinks, 'save', [false, 'posts', [{ name: 'categories', path: 'category' }, { name: 'tags', path: 'tag' }]])).error).toBe('');
  contains(await visitor.page('/posts/hello-world'), 'zeppelin');

  // Every dashboard screen renders for the administrator.
  for (const pathname of ['/dashboard/settings/general', '/dashboard/settings/writing', '/dashboard/settings/reading', '/dashboard/settings/media', `/dashboard/media/${image.id}`,
    `/dashboard/terms/categories/${news.id}`, '/dashboard/terms/tags', '/dashboard/taxonomies', '/dashboard/taxonomies/categories', '/dashboard/blocks', '/dashboard/collections',
    '/dashboard/collections/posts', '/dashboard/collections/products', '/dashboard/tools/schema', '/dashboard/plugins', '/dashboard/content/pages', '/dashboard/content/products',
    '/dashboard/content/products/new', '/dashboard/profile', '/dashboard/sessions', '/dashboard/users/new', '/dashboard/roles/new', '/dashboard/appearance', '/dashboard/appearance/customize',
    '/dashboard/appearance/menus', `/dashboard/appearance/menus/${menuId}`, '/dashboard/settings/permalinks']) await web.page(pathname);
  contains(await web.page('/dashboard/settings/general'), 'Anyone can register');
  contains(await web.page('/dashboard/blocks'), 'core/paragraph');
  expect((await web.request('/dashboard/settings')).headers.get('location')).toBe('/dashboard/settings/general');
  expect((await web.request('/dashboard/media/new')).headers.get('location')).toBe('/dashboard/media?upload=1');
  // Subscribers reach their profile but not content tools.
  expect((await visitor.request('/dashboard/media')).headers.get('location')).toBe('/dashboard');
  expect((await visitor.request('/dashboard/collections')).headers.get('location')).toBe('/dashboard');
  await visitor.page('/dashboard/profile');

  // Outbox events are delivered in the background after the writes.
  let overview = '';
  await expect.poll(async () => /data-testid="?outbox"?[^>]*>0</.test(overview = await web.page('/dashboard')), { timeout: 15_000 })
    .toBe(true).catch(error => { throw new Error(`${error.message}\n${overview.slice(overview.indexOf('<main'), overview.indexOf('<main') + 1500)}\n${diagnostics()}`); });

  // The CLI signs in with JSON; the dashboard signs out.
  const session = await fetch(origin + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ada@example.com', password: 'long password' }) });
  expect(session.status).toBe(200);
  expect(session.headers.getSetCookie().some(cookie => cookie.startsWith('session_id='))).toBe(true);
  expect((await web.action('dashboard/layout.ts', 'doLogout', [], { page: 'dashboard/index.ts' }))._cossack_redirect).toBe('/auth/login');
  expect((await web.request('/dashboard')).headers.get('location')).toBe('/auth/login');
}

describe.skipIf(!liveFastDBTests())('generated CMS application', () => {
  let service;
  beforeAll(async () => { service = await startFastDBService(); }, 30_000);
  afterAll(async () => { await service?.stop(); });

  it('sets up, manages content and collections, and serves the site on Node', async () => {
    const root = await project('node', ['cms'], {}, process.env.CMS_KEEP ? [] : undefined);
    const templates = JSON.parse((await cossack(root, ['check', 'templates', '--json'])).stdout);
    expect(templates.data, JSON.stringify(templates.diagnostics, null, 2)).toMatchObject({ errors: 0, warnings: 0 });
    await cossack(root, ['config', '--generate']);
    await typecheck(root, 'cms application');
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const read = async directory => {
      let text = '';
      for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && entry.name.endsWith('.js')) text += await fs.readFile(path.join(entry.parentPath, entry.name), 'utf8');
      }
      return text;
    };
    const client = await read(path.join(root, 'dist/client'));
    for (const secret of ['INSERT INTO cms_', 'FASTDB_TOKEN', 'MarkdownIt', 'password_hash', 'S3Client']) expect(client).not.toContain(secret);
    // The editor ships to the browser only; the server gets the client-only stub.
    expect(client).toContain('ProseMirror-hideselection');
    expect(await read(path.join(root, 'dist/server'))).not.toContain('ProseMirror-hideselection');
    const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
    const environment = { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', FASTDB_URL: service.url, FASTDB_TOKEN: service.token, CMS_SETUP_CODE: 'setup-code-for-tests',
      FASTDB_PENDING_DIR: path.join(root, '.cossack/fastdb-pending'), MEDIA_DIR: path.join(root, 'storage/media') };
    const server = await productionServer(root, environment);
    try { await exercise(server.origin, routeIds, () => server.diagnostics()); }
    finally { await server.close(); }
  }, 400_000);

  it('edits posts and builds a collection in the browser', async () => {
    const root = await project('node', ['cms']);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const database = await startFastDBService();
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', FASTDB_URL: database.url, FASTDB_TOKEN: database.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', FASTDB_PENDING_DIR: path.join(root, '.cossack/fastdb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    let browser;
    try {
      const web = browserless(server.origin, JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId);
      await web.post('/auth/setup', { code: 'setup-code-for-tests', siteTitle: 'Browser Site', name: 'Ada', email: 'ada@example.com', password: 'long password' });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: server.origin })));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const ready = () => page.waitForFunction(() => window.__cossackReady === true);

      await page.goto(server.origin + '/dashboard/content/posts/new');
      await ready();
      await page.getByPlaceholder('Add title').fill('Browser post: first try');
      await browserExpect(page.getByText('/posts/browser-post-first-try')).toBeVisible();
      // The post starts from its template, a Rich text block: type, make a word bold, publish; the site renders the JSON document.
      const surface = page.locator('[data-block-tree-item] .ProseMirror').first();
      await surface.click();
      await page.keyboard.type('Some ');
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      await page.keyboard.type('bold');
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      await page.keyboard.type(' words');
      await browserExpect(surface.locator('strong')).toHaveText('bold');
      // The status select picks Published; the button follows it.
      await page.getByLabel('Status', { exact: true }).selectOption('published');
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await page.waitForURL(/\/dashboard\/content\/posts\/[0-9a-f-]{36}\?saved=1$/);
      await browserExpect(page.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible();
      await browserExpect(page.locator('[data-block-tree-item] .ProseMirror strong').first()).toHaveText('bold');
      await page.goto(server.origin + '/posts/browser-post-first-try');
      await browserExpect(page.getByRole('heading', { name: 'Browser post: first try' })).toBeVisible();
      await browserExpect(page.locator('article .cms-prose strong')).toHaveText('bold');

      // A profile picture: an animated GIF uploads to the media library and shows at once.
      await page.goto(server.origin + '/dashboard/profile');
      await ready();
      await page.locator('#avatar').setInputFiles({ name: 'me.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
      await browserExpect(page.getByRole('status').filter({ hasText: 'Picture updated.' }).first()).toBeVisible();
      await browserExpect(page.locator('main img[src^="/media/"]').first()).toBeAttached();
      await page.reload();
      await browserExpect(page.locator('main img[src^="/media/"]').first()).toBeAttached();

      // A menu built by dragging: Team goes under About, then out and back with the keyboard.
      for (const title of ['About', 'Team']) {
        await web.action('dashboard/(cms)/content/[collection]/[id]/index.ts', 'save', [{ title, slug: '', status: 'draft', publishedAt: '', content: [], excerpt: '', featuredImage: '', parent: '', menuOrder: '0' }, 'publish', 0],
          { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
      }
      await page.goto(server.origin + '/dashboard/appearance/menus');
      await ready();
      await page.getByLabel('Menu name').fill('Main');
      await page.getByRole('button', { name: 'Create menu' }).click();
      await page.waitForURL(/\/dashboard\/appearance\/menus\/[0-9a-f-]{36}$/);
      await ready();
      // The summary carries the collection's icon before its label.
      const pagesBox = page.locator('details', { has: page.locator('summary', { hasText: 'Pages' }) });
      await pagesBox.getByLabel('About').check();
      await pagesBox.getByLabel('Team').check();
      await pagesBox.getByRole('button', { name: 'Add to menu' }).click();
      const teamRow = page.locator('li[data-menu-item]', { hasText: 'Team' });
      await browserExpect(teamRow).toHaveAttribute('data-depth', '0');
      const handle = teamRow.locator('[data-handle]');
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 2, { steps: 4 });
      await page.mouse.move(box.x + box.width / 2 + 44, box.y + box.height / 2 + 2, { steps: 4 });
      await page.mouse.up();
      await browserExpect(teamRow).toHaveAttribute('data-depth', '1');
      await handle.focus();
      await page.keyboard.press('ArrowLeft');
      await browserExpect(teamRow).toHaveAttribute('data-depth', '0');
      await page.keyboard.press('ArrowRight');
      await browserExpect(teamRow).toHaveAttribute('data-depth', '1');
      await page.getByLabel('Primary menu').check();
      await page.getByRole('button', { name: 'Save menu' }).first().click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Menu saved.' }).first()).toBeVisible();
      await page.goto(server.origin + '/posts');
      const primary = page.locator('nav[aria-label="Primary"]');
      await browserExpect(primary.locator('li li a', { hasText: 'Team' }).first()).toHaveAttribute('href', '/team');

      await page.goto(server.origin + '/dashboard/collections/new');
      await ready();
      await page.getByLabel('Plural name').fill('Events');
      await page.getByLabel('Singular name').fill('Event');
      await page.getByRole('button', { name: 'Create collection' }).click();
      await page.waitForURL(/\/dashboard\/collections\/events/);
      await ready();
      await page.getByLabel('New field label').fill('Venue');
      await page.getByRole('button', { name: 'Add field' }).click();
      await browserExpect(page.locator('code', { hasText: 'venue' })).toBeVisible();
      await page.getByRole('button', { name: 'Save collection' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Collection saved.' }).first()).toBeVisible();
      await page.goto(server.origin + '/dashboard/content/events/new');
      await browserExpect(page.getByLabel('Venue')).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await server.close();
      await database.stop();
    }
  }, 400_000);

  it('runs the same CMS on Cloudflare Workers with R2 media and Durable Object pending writes', async () => {
    const root = await project('cloudflare', ['cms']);
    // Each case gets its own database through a fresh service.
    const database = await startFastDBService();
    try {
      await vite(root, []);
      const configPath = path.join(root, 'dist/ssr/wrangler.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      expect(config.durable_objects.bindings).toContainEqual({ name: 'FASTDB_PENDING', class_name: 'FastDBPendingWrites' });
      expect(config.r2_buckets).toContainEqual(expect.objectContaining({ binding: 'MEDIA' }));
      await fs.writeFile(path.join(path.dirname(configPath), '.dev.vars'), [
        'APP_SECRET=generated-cms-test-secret-0123456789abcdef', `FASTDB_URL=${database.url}`, `FASTDB_TOKEN=${database.token}`, 'CMS_SETUP_CODE=setup-code-for-tests',
      ].join('\n') + '\n');
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      const { createTestHarness } = await import('wrangler');
      const runtime = createTestHarness({ root, workers: [{ configPath }] });
      try {
        const { url } = await runtime.listen();
        await exercise(new URL(url).origin, routeIds, () => '');
      } finally { await runtime.close(); }
    } finally { await database.stop(); }
  }, 400_000);
});
