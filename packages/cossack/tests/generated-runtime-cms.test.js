// The cms feature in a generated application, on Node against a RomeDB file in the server's
// process (the default) and a local `romedb serve`, and on Workers against `romedb serve`: template and
// type checks, setup through /auth/setup, the shared /dashboard with users and settings,
// posts with rich text, terms and media, a collection built in the dashboard with blocks,
// themes, menus, the content API, the public site and background outbox delivery. The same
// flow runs on Node and on Workers; a browser case drives the editors.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, cossack, productionServer, project, typecheck, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks, PNG, visible } from './fixtures/cms-client.js';
import { findRomeDBBinary, liveRomeDBTests, servesDirectories, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const SETTINGS = 'dashboard/(cms)/settings/index.ts';

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
  for (const link of ['/dashboard/content/posts', '/dashboard/content/pages', '/dashboard/media', '/dashboard/collections', '/dashboard/settings', '/dashboard/users', '/dashboard/terms/categories'])
    contains(dashboard, `href="${link}"`);
  contains(dashboard, 'At a glance');
  contains(dashboard, 'The Daily');
  // Roles are in the Users menu, not a menu of their own.
  contains(dashboard, 'data-sidebar-value="module:users:/dashboard/roles/new"');
  lacks(dashboard, 'data-sidebar-value="module:roles"');
  contains(await web.page('/dashboard/users'), 'ada@example.com');
  contains(await web.page('/dashboard/roles'), 'Editor');
  // Files → Summary counts the library once a day; Refresh counts again.
  const summary = await web.page('/dashboard/media/summary');
  contains(summary, 'Files summary');
  contains(summary, 'Resized copies');

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
    title: 'Hello, World!', slug: '', excerpt: '', content: [{ _id: 'rt', type: 'core/richtext', data: { text: doc(paragraph(text('First '), text('post', ['bold']), text(' about a zeppelin <script>alert(1)</script>'))) } }], status: 'draft', publishedAt: '',
    sticky: false, featuredImage: image.id, categories: [news.id], tags: ['Intro', 'Weather'],
  }, 'publish', 0], { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  // The editor keeps the new entry in place: its ID and the message come back with the state.
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(created.message).toBe('Published.');
  const edit = await web.page(`/dashboard/content/posts/${created.id}`);
  contains(edit, '/posts/hello-world');
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
  await web.action(editor, 'save', [{ title: 'Quick idea', slug: '', status: 'draft', publishedAt: '', content: [{ _id: 'q1', type: 'core/paragraph', data: { text: 'Line one' } }] }, 'draft', 0],
    { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  contains(await web.page('/dashboard/content/posts?status=draft'), 'Quick idea');

  // A collection built in the dashboard, with a blocks field and a taxonomy.
  const collections = 'dashboard/(cms)/collections/new/index.ts';
  expect((await web.action(collections, 'create', ['Products', 'Product', 'box']))._cossack_redirect).toBe('/dashboard/collections/products?created=1');
  // Its fields are a group made from the collection manager, laid out as field blocks; content is a feature.
  const field = (name, label, kind, extra = {}) => ({ _id: name, type: `field/${kind}`, data: { name, label, ...extra } });
  // A new group is made on the group editor itself, in one step: its ID comes from the title.
  expect((await web.action('dashboard/(cms)/field-groups/[id]/index.ts', 'save', [{ id: '', title: 'Product details', description: '', placement: 'main', order: '' }, [{ kind: 'collection', name: 'products', order: 0 }], []], { state: { fresh: true }, params: { id: 'new' } }))._cossack_redirect).toBe('/dashboard/field-groups/product-details?created=1');
  const group = await web.action('dashboard/(cms)/field-groups/[id]/index.ts', 'save', [
    { id: 'product-details', title: 'Product details', description: '', placement: 'main', order: '' }, [{ kind: 'collection', name: 'products', order: 0 }],
    [field('price', 'Price', 'number', { required: true, min: 0 }), field('sku', 'SKU', 'text', { unique: true })],
  ], { params: { id: 'product-details' } });
  expect(group.error).toBe('');
  const builder = await web.action('dashboard/(cms)/collections/[name]/index.ts', 'save', [
    { name: 'products', label: 'Products', singular: 'Product', description: 'Things we sell.', icon: 'box', path: 'shop', public: true, slug: true, publishable: true,
      hierarchical: false, visibility: 'private', comments: false, taxonomies: ['tags'], builtin: false, content: true, excerpt: false, featuredImage: false, revisions: true, templateLock: '', sitemap: true, password: false, schemaType: 'WebPage', schemaMap: {}, noindex: false, nofollow: false, archiveNoindex: false, seoTitle: '', seoDescription: '', archiveTitle: '' },
    ['product-details'], [],
  ], { params: { name: 'products' } });
  expect(builder.error).toBe('');
  contains(await web.page('/dashboard'), 'href="/dashboard/content/products"');
  const product = await web.action(editor, 'save', [{
    title: 'Rocket skates', slug: '', status: 'draft', publishedAt: '', price: '19.5', sku: 'RS-1', tags: ['Intro'],
    content: [{ _id: 'b1', type: 'core/heading', data: { text: 'Fast wheels', level: 'h2' } }, { _id: 'b2', type: 'core/paragraph', data: { text: 'Very **fast**' } },
      { _id: 'b3', type: 'core/image', data: { image: image.id, caption: 'A pixel', link: '' } }, { _id: 'b4', type: 'core/button', data: { label: 'Buy', url: 'javascript:alert(1)', style: 'primary' } }],
  }, 'publish', 0], { params: { collection: 'products', id: 'new' }, state: { route: 'products', id: 'new' } });
  // A button that links to script is refused.
  expect(product.errors.content).toContain('b4.url');
  // A field of the entry reaches the page through a binding in a block's text; the theme lists no fields on its own.
  const saved = await web.action(editor, 'save', [{
    title: 'Rocket skates', slug: '', status: 'draft', publishedAt: '', price: '19.5', sku: 'RS-1', tags: ['Intro'],
    content: [{ _id: 'b1', type: 'core/heading', data: { text: 'Fast wheels', level: 'h2' } }, { _id: 'b2', type: 'core/paragraph', data: { text: 'Very **fast**' } },
      { _id: 'b3', type: 'core/image', data: { image: image.id, caption: 'A pixel', link: '' } }, { _id: 'b5', type: 'core/paragraph', data: { text: 'Price: **{{ $.price }}**' } }],
  }, 'publish', 0], { params: { collection: 'products', id: 'new' }, state: { route: 'products', id: 'new' } });
  expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
  const productPage = await web.page('/shop/rocket-skates');
  contains(productPage, 'Fast wheels');
  contains(productPage, 'Very <strong>fast</strong>');
  contains(productPage, 'Price: <strong>19.5</strong>');
  // The SKU is in the page's state for editing, but the theme prints no field list of its own.
  lacks(productPage, '>SKU</dt>');
  // The editor's bar has an SEO list of its own; the page above it has none.
  lacks(productPage.split('Live Edit')[0], '<dl');
  // The signed-in user's taskbar is on the page; the SEO list is its inspector.
  contains(productPage, 'data-cms-taskbar');
  contains(productPage, 'A pixel');
  contains(await web.page('/shop'), 'Rocket skates');
  contains(await web.page('/tag/intro'), 'Hello, World!');
  // Links reads the site as visitors do: the private Products collection is left out, not an error.
  const links = await web.page('/dashboard/tools/links');
  contains(links, 'Orphaned entries');
  lacks(links, 'Not allowed to read');

  // Settings change the site title, registration and the home page.
  const visitor = browserless(origin, routeIds, diagnostics);
  contains(await visitor.page('/auth/register'), 'Registration is closed');
  expect((await web.action(SETTINGS, 'saveAll', [{ document: { general: { siteTitle: 'Rocket News', usersCanRegister: true } }, languages: null, permalinks: null, groups: {} }]))._cossack_return.error).toBe('');
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
  const takeover = await manager.action('dashboard/users/[id]/index.ts', 'applyPasswordChange', ['taken over!', '', 'taken over!'], { params: { id: adaId }, state: { userDetail: { id: adaId, name: 'Ada', email: 'ada@example.com', avatar: null, createdAt: new Date().toISOString(), roles: [] } } }).catch(error => error);
  expect(String(takeover?.message ?? JSON.stringify(takeover))).toContain('Only an administrator');

  const home = await web.action(editor, 'save', [{ title: 'Home', slug: '', status: 'draft', publishedAt: '', content: [{ _id: 'rt', type: 'core/richtext', data: { text: doc(paragraph(text('Welcome home'))) } }], excerpt: '', featuredImage: '', parent: '', menuOrder: '0' }, 'publish', 0],
    { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
  const homeId = home.id;
  const team = await web.action(editor, 'save', [{ title: 'Team', slug: '', status: 'draft', publishedAt: '', content: [{ _id: 'rt', type: 'core/richtext', data: { text: doc(paragraph(text('Our team'))) } }], excerpt: '', featuredImage: '', parent: homeId, menuOrder: '1' }, 'publish', 0],
    { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
  const teamId = team.id;
  contains(await visitor.page('/home/team'), 'Our team');
  const moved = await fetch(origin + '/team', { redirect: 'manual' });
  expect(moved.status).toBe(301);
  expect(moved.headers.get('location')).toBe('/home/team');
  expect((await web.action(SETTINGS, 'saveAll', [{ document: { reading: { showOnFront: 'page', pageOnFront: homeId } }, languages: null, permalinks: null, groups: {} }]))._cossack_return.error).toBe('');
  const front = await visitor.page('/');
  contains(front, 'Welcome home');
  // The static front page is edited in place at /?edit, from the editor's taskbar. Every signed-in user has
  // a taskbar (`visitor` registered Bob above); a reader who is not signed in gets none.
  contains(front, 'data-cms-taskbar');
  lacks(await browserless(origin, routeIds, diagnostics).page('/'), 'data-cms-taskbar');
  expect(await web.page('/')).toMatch(/href="?\/\?edit/);
  contains(await web.page('/?edit'), 'data-site-editing');
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
  expect((await web.action(SETTINGS, 'saveAll', [{ document: null, languages: null, permalinks: { postsAtRoot: true, postsBase: 'posts', withCategory: false, bases: [{ name: 'categories', path: 'category' }, { name: 'tags', path: 'tag' }] }, groups: {} }]))._cossack_return.error).toBe('');
  contains(await visitor.page('/hello-world'), 'zeppelin');
  // Old addresses redirect to the new ones.
  const oldPost = await fetch(origin + '/posts/hello-world', { redirect: 'manual' });
  expect([oldPost.status, oldPost.headers.get('location')]).toEqual([301, '/hello-world']);
  const blogPage = await web.action(editor, 'save', [{ title: 'Blog', slug: '', status: 'draft', publishedAt: '', content: [], excerpt: '', featuredImage: '', parent: '', menuOrder: '5' }, 'publish', 0],
    { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
  expect((await web.action(SETTINGS, 'saveAll', [{ document: { reading: { pageForPosts: blogPage.id } }, languages: null, permalinks: null, groups: {} }]))._cossack_return.error).toBe('');
  contains(await visitor.page('/blog'), 'Hello, World!');
  contains(await visitor.page('/blog'), 'href="/hello-world"');
  // A new post cannot take a slug the site's routes own.
  const reserved = await web.action(editor, 'save', [{ title: 'Search', slug: '', excerpt: '', content: [], status: 'draft', publishedAt: '', sticky: false, featuredImage: '', categories: [], tags: [] }, 'publish', 0],
    { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  contains(await web.page(`/dashboard/content/posts/${reserved.id}`), '/search-2');
  expect((await web.action(SETTINGS, 'saveAll', [{ document: null, languages: null, permalinks: { postsAtRoot: false, postsBase: 'posts', withCategory: false, bases: [{ name: 'categories', path: 'category' }, { name: 'tags', path: 'tag' }] }, groups: {} }]))._cossack_return.error).toBe('');
  contains(await visitor.page('/posts/hello-world'), 'zeppelin');

  // Every dashboard screen renders for the administrator.
  for (const pathname of ['/dashboard/settings', `/dashboard/media/${image.id}`,
    `/dashboard/terms/categories/${news.id}`, '/dashboard/terms/tags', '/dashboard/taxonomies', '/dashboard/taxonomies/categories', '/dashboard/blocks', '/dashboard/collections',
    '/dashboard/collections/posts', '/dashboard/collections/products', '/dashboard/tools/schema', '/dashboard/plugins', '/dashboard/content/pages', '/dashboard/content/products',
    '/dashboard/content/products/new', '/dashboard/profile', '/dashboard/sessions', '/dashboard/users/new', '/dashboard/roles/new', '/dashboard/appearance', '/dashboard/appearance/customize',
    '/dashboard/appearance/menus', `/dashboard/appearance/menus/${menuId}`]) await web.page(pathname);
  const general = await web.page('/dashboard/settings');
  contains(general, 'Anyone can register');
  // Settings has a secondary sidebar against the dashboard's own, so the main area drops its padding.
  contains(general, 'data-subnav');
  contains(await web.page('/dashboard/blocks'), 'core/paragraph');
  for (const group of ['general', 'writing', 'reading', 'media', 'permalinks']) {
    expect(general).toMatch(new RegExp(`data-settings-menu-group="?${group}(?:"|\\s|>)`));
    expect(general).toMatch(new RegExp(`data-settings-section="?${group}(?:"|\\s|>)`));
    expect((await web.request(`/dashboard/settings/${group}`)).headers.get('location')).toBe(`/dashboard/settings#settings-${group}`);
  }
  contains(general, 'aria-label="Edit settings JSON"');
  expect((await web.request('/dashboard/settings')).status).toBe(200);
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

describe.skipIf(!liveRomeDBTests())('generated CMS application', () => {
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
    // markdown-it is no longer a server-only marker: the JSON Schema editor (codemirror-json-schema) renders its hover help with it in the browser.
    for (const secret of ['INSERT INTO cms_', 'ROMEDB_TOKEN', 'password_hash', 'S3Client']) expect(client).not.toContain(secret);
    // The editor ships to the browser only; the server gets the client-only stub.
    expect(client).toContain('ProseMirror-hideselection');
    expect(await read(path.join(root, 'dist/server'))).not.toContain('ProseMirror-hideselection');
    const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
    // ROMEDB_URL defaults to the file storage/romedb/app.romedb, opened in the server's process.
    expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toMatch(/^ROMEDB_URL=storage\/romedb\/app\.romedb$/m);
    const environment = { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: path.join(root, 'storage/romedb/app.romedb'), ROMEDB_TOKEN: '', CMS_SETUP_CODE: 'setup-code-for-tests',
      ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') };
    const server = await productionServer(root, environment);
    try { await exercise(server.origin, routeIds, () => server.diagnostics()); }
    finally { await server.close(); }
    expect((await fs.stat(path.join(root, 'storage/romedb/app.romedb'))).mode & 0o777).toBe(0o600);
  }, 400_000);

  it('edits posts and builds a collection in the browser', async () => {
    const root = await project('node', ['cms']);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const database = await startRomeDBService();
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    let browser;
    try {
      const web = browserless(server.origin, JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId);
      await web.post('/auth/setup', { code: 'setup-code-for-tests', siteTitle: 'Browser Site', name: 'Ada', email: 'ada@example.com', password: 'long password' });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: server.origin })));
      const page = await context.newPage();
      // Playwright turns on file chooser interception when the first listener is added, without
      // waiting for it, so a key press right after waitForEvent('filechooser') can open the native
      // picker instead. Listen from the start.
      page.on('filechooser', () => {});
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
      await page.waitForURL(/\/dashboard\/content\/posts\/[0-9a-f-]{36}$/);
      await browserExpect(page.getByRole('status').filter({ hasText: 'Published.' }).first()).toBeVisible();
      await browserExpect(page.locator('[data-block-tree-item] .ProseMirror strong').first()).toHaveText('bold');
      // JSON sits at the far edge; keyboard switching retains the editor and its unsaved title.
      const editorTabs = page.getByRole('tablist', { name: 'Editor view' });
      const editTab = editorTabs.getByRole('tab', { name: 'Edit', exact: true });
      const jsonTab = editorTabs.getByRole('tab', { name: 'JSON', exact: true });
      const tabsBounds = await editorTabs.boundingBox(), jsonBounds = await jsonTab.boundingBox();
      expect(Math.abs(tabsBounds.x + tabsBounds.width - jsonBounds.x - jsonBounds.width)).toBeLessThan(8);
      expect(jsonBounds.x - (await editTab.boundingBox()).x).toBeGreaterThan(100);
      const titleInput = page.getByPlaceholder('Add title');
      await titleInput.fill('Unsaved title');
      const richTextNode = await surface.elementHandle();
      await editTab.focus();
      await page.keyboard.press('End');
      await browserExpect(jsonTab).toBeFocused();
      await browserExpect(jsonTab).toHaveAttribute('aria-selected', 'true');
      await browserExpect(page.getByRole('tabpanel', { name: 'JSON', exact: true })).toBeVisible();
      await page.keyboard.press('Home');
      await browserExpect(editTab).toHaveAttribute('aria-selected', 'true');
      await browserExpect(titleInput).toHaveValue('Unsaved title');
      expect(await richTextNode.evaluate(node => node.isConnected)).toBe(true);
      await browserExpect(surface.locator('strong')).toHaveText('bold');
      await titleInput.fill('Browser post: first try');
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible();
      await page.goto(server.origin + '/posts/browser-post-first-try');
      await browserExpect(page.getByRole('heading', { name: 'Browser post: first try' })).toBeVisible();
      await browserExpect(page.locator('article .cms-prose strong')).toHaveText('bold');

      // Icon actions retain accessible names, a native download and a keyboard file picker.
      await page.goto(server.origin + '/dashboard/content/posts');
      await ready();
      const exportJson = page.getByRole('link', { name: 'Export JSON', exact: true });
      await browserExpect(exportJson.locator('svg')).toHaveCount(1);
      expect(await exportJson.innerText()).toBe('');
      const downloadPromise = page.waitForEvent('download');
      await exportJson.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.json$/);
      const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      expect(exported.items.some(entry => entry.title === 'Browser post: first try')).toBe(true);
      const importJson = page.getByRole('button', { name: 'Import JSON', exact: true });
      await browserExpect(importJson.locator('svg')).toHaveCount(1);
      expect(await importJson.innerText()).toBe('');
      await importJson.focus();
      const chooserPromise = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      await (await chooserPromise).setFiles({ name: 'posts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
      await browserExpect(page.getByRole('status').filter({ hasText: '0 created, 1 updated' }).first()).toBeVisible();
      await browserExpect(importJson).toBeEnabled();

      // A profile picture: an animated GIF uploads to the media library and shows at once.
      await page.goto(server.origin + '/dashboard/profile');
      await ready();
      await page.locator('#avatar').setInputFiles({ name: 'me.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
      await browserExpect(page.getByRole('status').filter({ hasText: 'Picture updated.' }).first()).toBeVisible();
      await browserExpect(page.locator('main img[src^="/media/"]').first()).toBeAttached();
      await page.reload();
      await browserExpect(page.locator('main img[src^="/media/"]').first()).toBeAttached();

      // A menu built by dragging: Team goes under About, then out and back with the keyboard.
      const pageIds = {};
      for (const title of ['About', 'Team']) {
        pageIds[title] = (await web.action('dashboard/(cms)/content/[collection]/[id]/index.ts', 'save', [{ title, slug: '', status: 'draft', publishedAt: '', content: [], excerpt: '', featuredImage: '', parent: '', menuOrder: '0' }, 'publish', 0],
          { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } })).id;
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

      // A static front page is edited in place at /: the taskbar's Live Edit opens /?edit, Exit leaves it; Edit opens the dashboard's editor.
      expect((await web.action(SETTINGS, 'saveAll', [{ document: { reading: { showOnFront: 'page', pageOnFront: pageIds.About } }, languages: null, permalinks: null, groups: {} }]))._cossack_return.error).toBe('');
      await page.goto(server.origin + '/');
      await ready();
      const taskbar = page.getByRole('navigation', { name: 'Site taskbar' });
      await browserExpect(taskbar.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', `/dashboard/content/pages/${pageIds.About}`);
      // The SEO button carries an icon before its label.
      await browserExpect(taskbar.getByRole('button', { name: 'SEO', exact: true }).locator('svg')).toHaveCount(1);
      await taskbar.getByRole('link', { name: 'Live Edit', exact: true }).click();
      const editing = page.getByRole('region', { name: 'Editing' });
      await browserExpect(editing.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await browserExpect(taskbar).toBeHidden();
      expect(new URL(page.url()).search).toBe('?edit');
      await editing.getByRole('button', { name: 'Exit', exact: true }).click();
      await browserExpect(taskbar).toBeVisible();
      expect(new URL(page.url()).search).toBe('');

      // Screen options, from the dashboard's taskbar: hide the Slug column and list one page per screen; a reload keeps both.
      await page.goto(server.origin + '/dashboard/content/pages');
      await ready();
      await browserExpect(page.locator('tr[data-entry]')).toHaveCount(2);
      await browserExpect(page.getByRole('columnheader', { name: 'Slug' })).toBeVisible();
      await page.getByRole('button', { name: 'Screen options' }).click();
      const screenOptions = page.locator('#screen-options');
      await screenOptions.getByLabel('Slug').uncheck();
      await screenOptions.getByLabel('Number of items per page').fill('1');
      await screenOptions.getByRole('button', { name: 'Apply' }).click();
      await browserExpect(screenOptions).toBeHidden();
      await browserExpect(page.locator('tr[data-entry]')).toHaveCount(1);
      await browserExpect(page.getByRole('columnheader', { name: 'Slug' })).toHaveCount(0);
      await page.reload();
      await ready();
      await browserExpect(page.locator('tr[data-entry]')).toHaveCount(1);
      await browserExpect(page.getByRole('columnheader', { name: 'Slug' })).toHaveCount(0);

      await page.goto(server.origin + '/dashboard/collections/new');
      await ready();
      await page.getByLabel('Plural name').fill('Events');
      await page.getByLabel('Singular name').fill('Event');
      await page.getByRole('button', { name: 'Create collection' }).click();
      await page.waitForURL(/\/dashboard\/collections\/events/);
      await ready();
      // The manager's Features and a group made from it: its editor lays fields out as field blocks, a Text field from the picker, named from its label.
      await browserExpect(page.getByLabel('Content')).toBeChecked();
      await page.getByRole('link', { name: 'New field group' }).click();
      await page.waitForURL(/\/dashboard\/field-groups\/new\?collection=events$/);
      await ready();
      await page.getByLabel('Title').fill('Event details');
      await page.getByRole('button', { name: 'Create field group' }).click();
      await page.waitForURL(/\/dashboard\/field-groups\/event-details/);
      await ready();
      await browserExpect(page.getByLabel('Events', { exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
      const picker = page.getByRole('dialog', { name: 'Blocks' });
      await picker.getByLabel('Search blocks').fill('text');
      await picker.getByRole('button', { name: 'Single line', exact: true }).click();
      const venue = page.getByRole('region', { name: 'Single line 1' });
      // A new block opens its panel at once.
      const panel = page.getByRole('dialog', { name: 'Single line' });
      await browserExpect(panel.getByLabel('Label *')).toBeFocused();
      await panel.getByLabel('Label *').fill('Venue');
      await panel.getByRole('button', { name: 'Done' }).click();
      await browserExpect(venue.locator('code', { hasText: 'venue' })).toBeVisible();
      await page.getByRole('button', { name: 'Save field group' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Field group saved.' }).first()).toBeVisible();
      // The manager lists the group; saving the collection keeps it attached.
      await page.goto(server.origin + '/dashboard/collections/events');
      await ready();
      // The collection tabs keep unsaved fields mounted and support keyboard switching.
      await page.getByLabel('Plural name').fill('Events revised');
      const collectionGeneral = page.getByRole('tab', { name: 'General', exact: true });
      await collectionGeneral.focus();
      await page.keyboard.press('ArrowRight');
      await browserExpect(page.getByRole('tab', { name: 'Search engines' })).toBeFocused();
      await browserExpect(page.getByRole('tabpanel', { name: 'Search engines' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('tab')).toBe('seo');
      const collectionIndicator = page.locator('#collection-list > .cs-tabs__indicator');
      await browserExpect.poll(() => collectionIndicator.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(0);
      await page.keyboard.press('ArrowLeft');
      await browserExpect(collectionGeneral).toHaveAttribute('aria-selected', 'true');
      await browserExpect(page.getByLabel('Plural name')).toHaveValue('Events revised');
      await page.getByLabel('Plural name').fill('Events');
      await browserExpect(page.locator('li[data-group="event-details"]')).toBeVisible();
      await page.getByRole('button', { name: 'Save collection' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Collection saved.' }).first()).toBeVisible();
      await browserExpect(page.locator('li[data-group="event-details"]')).toBeVisible();
      await page.goto(server.origin + '/dashboard/content/events/new');
      await browserExpect(page.getByLabel('Venue')).toBeVisible();

      // The network is off until Settings → Network turns it on; saving reloads the page, with Network in the menu.
      await page.goto(server.origin + '/dashboard');
      await ready();
      await browserExpect(page.locator('a[data-status="network"]')).toHaveCount(0);
      await page.goto(server.origin + '/dashboard/settings#settings-network');
      await ready();
      await page.getByLabel('Run a network of sites').check();
      await browserExpect(page.getByLabel('Network name')).toBeVisible();
      await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save changes' }).click()]);
      await ready();
      await browserExpect(page.getByLabel('Run a network of sites')).toBeChecked();
      // The taskbar's Network link opens the network dashboard, whose pages load in the browser too.
      await page.goto(server.origin + '/dashboard');
      await ready();
      await page.locator('a[data-status="network"]').click();
      await page.waitForURL(/\/dashboard\/network$/);
      await browserExpect(page.locator('main h1')).toHaveText('Network');
      await page.locator('main').getByRole('link', { name: 'Plugins', exact: true }).click();
      await page.waitForURL(/\/dashboard\/network\/plugins$/);
      await browserExpect(page.locator('main h1')).toHaveText('Network plugins');
      // Sites and Users are list tables with pages of their own; the main site leads Sites.
      await page.goto(server.origin + '/dashboard/network/sites');
      await ready();
      await browserExpect(page.locator('tr[data-site="main"]')).toContainText('main site');
      await page.goto(server.origin + '/dashboard/network/users');
      await ready();
      await page.locator('tr[data-account]').first().getByRole('link', { name: 'Edit' }).click();
      await page.waitForURL(/\/dashboard\/network\/users\/[0-9a-f-]{36}$/);
      await browserExpect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
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
    const database = await startRomeDBService();
    try {
      await vite(root, []);
      const configPath = path.join(root, 'dist/ssr/wrangler.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      expect(config.durable_objects.bindings).toContainEqual({ name: 'ROMEDB_PENDING', class_name: 'RomeDBPendingWrites' });
      expect(config.r2_buckets).toContainEqual(expect.objectContaining({ binding: 'MEDIA' }));
      await fs.writeFile(path.join(path.dirname(configPath), '.dev.vars'), [
        'APP_SECRET=generated-cms-test-secret-0123456789abcdef', `ROMEDB_URL=${database.url}`, `ROMEDB_TOKEN=${database.token}`, 'CMS_SETUP_CODE=setup-code-for-tests',
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

  it('starts romedb serve for a loopback ROMEDB_URL in Workers development', async () => {
    const root = await project('cloudflare', ['cms']);
    const devVars = await fs.readFile(path.join(root, '.dev.vars'), 'utf8');
    // Local Workers development names a loopback service and no token: pnpm dev reads it from serve.
    expect(devVars).toMatch(/^ROMEDB_URL=http:\/\/127\.0\.0\.1:4321$/m);
    expect(devVars).not.toMatch(/^ROMEDB_TOKEN=/m);
    const port = await freePort();
    // Once the network has added sites, only APP_URL's host serves the main site.
    const devPort = await freePort();
    const vars = devVars.replace(/^ROMEDB_URL=.*$/m, `ROMEDB_URL=http://127.0.0.1:${port}`).replace(/^APP_URL=.*\n?/m, '');
    await fs.writeFile(path.join(root, '.dev.vars'), `${vars.trimEnd()}\nAPP_URL=http://127.0.0.1:${devPort}\n`);
    const code = /^CMS_SETUP_CODE=(.*)$/m.exec(devVars)[1];
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'vite';
      const server = await createServer({ root: process.cwd(), server: { port: ${devPort}, strictPort: true, host: '127.0.0.1' } });
      await server.listen();
      console.log('CMS_DEV_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
      process.on('message', async message => { if (message === 'STOP') { await server.close(); process.exit(0); } });
    `], { cwd: root, env: { ...process.env, ROMEDB_BIN: findRomeDBBinary(), NODE_ENV: 'development', VITEST: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
      await expect.poll(() => {
        if (child.exitCode !== null) throw new Error(output);
        return /CMS_DEV_ORIGIN=(\S+)/.exec(output)?.[1];
      }, { timeout: 60_000 }).toBeTruthy();
      const origin = /CMS_DEV_ORIGIN=(\S+)/.exec(output)[1];
      expect(output).toContain(`started romedb serve for storage/romedb/app.romedb at http://127.0.0.1:${port}`);
      // Route IDs from the CLI, which match the dev server's without a build.
      const routeIds = JSON.parse((await cossack(root, ['routes', '--json'])).stdout).data.manifest.filePathToId;
      const web = browserless(origin, routeIds, () => output);
      contains(await web.page('/auth/setup'), 'Set up your site');
      const setup = await web.post('/auth/setup', { code, siteTitle: 'Workers Dev', name: 'Ada', email: 'ada@example.com', password: 'long password' });
      expect(setup.headers.get('location'), await setup.text()).toBe('/dashboard');
      await fs.access(path.join(root, 'storage/romedb/token'));
      // The network dashboard waits until Settings → Network turns the network on.
      expect((await web.request('/dashboard/network')).headers.get('location')).toBe('/dashboard');
      const network = { enabled: true, name: 'Dev network', subdomainSuffix: '', defaultTheme: '', defaultPlugins: [], defaultLanguage: '', siteExports: 'request' };
      expect((await web.action(SETTINGS, 'saveAll', [{ document: null, languages: null, permalinks: null, network, groups: {} }]))._cossack_return.error).toBe('');
      // Beside it, a directory service holds added sites' databases, which the Worker creates through ROMEDB_SITES_URL.
      if (servesDirectories()) {
        expect(output).toContain(`started romedb serve --directory storage/romedb/sites for added sites at http://127.0.0.1:${port + 1}`);
        contains(await web.page('/dashboard/network/sites/new'), 'Add site');
        const added = await web.post('/dashboard/network/sites/new', { name: 'Blog', host: 'blog.localhost', admin: '', starter: 'on' });
        expect(added.status, await added.text()).toBe(302);
        expect(added.headers.get('location')).toBe('/dashboard/network/sites/blog');
        contains(await web.page('/dashboard/network/sites/blog'), 'Blog is ready.');
        contains(await web.page('/dashboard/network/sites'), 'blog.localhost');
        expect((await fs.readdir(path.join(root, 'storage/romedb/sites'))).filter(name => name.endsWith('.romedb'))).toHaveLength(1);
      }
      // Add account has its own page, then the account's page adds it to sites.
      const account = await web.post('/dashboard/network/users/new', { name: 'Grace', email: 'grace@example.com', password: 'long password' });
      expect(account.status, await account.text()).toBe(302);
      const accountPage = account.headers.get('location');
      expect(accountPage).toMatch(/^\/dashboard\/network\/users\/[0-9a-f-]{36}$/);
      contains(await web.page(accountPage), 'Grace can sign in now.');
      if (servesDirectories()) {
        expect((await web.post(accountPage, { action: 'add-site', site: 'blog', role: 'author' })).status).toBe(302);
        contains(await web.page(accountPage), 'Grace is a member now.');
        contains(await web.page('/dashboard/network/sites/blog'), 'grace@example.com');
        // The blog's sign-in links the network's: a network account signs in there and comes back with a child session.
        const blogOrigin = `http://blog.localhost:${devPort}`;
        const blogAdmin = browserless(blogOrigin, routeIds, () => output, { connect: '127.0.0.1' });
        contains(await blogAdmin.page('/auth/login'), 'data-network-sign-in');
        const toNetwork = new URL((await blogAdmin.request('/auth/handoff?next=/dashboard')).headers.get('location'));
        expect(toNetwork.toString()).toBe(`${origin}/auth/handoff?site=blog&next=%2Fdashboard`);
        const back = new URL((await web.request(toNetwork.pathname + toNetwork.search)).headers.get('location'));
        expect(back.origin).toBe(blogOrigin);
        expect((await blogAdmin.request(back.pathname + back.search)).headers.get('location')).toBe('/dashboard');
        // A user added on the blog is a site account: listed on the blog and on its network page, not among the network's accounts.
        await blogAdmin.action('dashboard/users/new/index.ts', 'create', ['Thanh', 'thanh@example.com', 'long password', ['author']]);
        const blogUsers = await blogAdmin.page('/dashboard/users');
        contains(blogUsers, 'thanh@example.com');
        contains(blogUsers, 'Network account');
        lacks(await web.page('/dashboard/network/users'), 'thanh@example.com');
        contains(await web.page('/dashboard/network/sites/blog'), 'Site account');
        // It signs in on the blog's own sign-in, where a network account's password does not.
        const reader = browserless(blogOrigin, routeIds, () => output, { connect: '127.0.0.1' });
        await reader.action('auth/login/index.ts', 'login', [{ email: 'thanh@example.com', password: 'long password' }]);
        contains(await reader.page('/dashboard'), 'thanh@example.com');
        const outsider = browserless(blogOrigin, routeIds, () => output, { connect: '127.0.0.1' });
        expect(JSON.stringify(await outsider.action('auth/login/index.ts', 'login', [{ email: 'grace@example.com', password: 'long password' }]))).toContain('Invalid credentials');
        expect((await outsider.request('/dashboard')).status).toBe(302);
        // A site admin with a site account manages a network account's roles there, not its profile, password or sign-in methods.
        await blogAdmin.action('dashboard/users/new/index.ts', 'create', ['Lan', 'lan@example.com', 'long password', ['admin']]);
        const siteAdmin = browserless(blogOrigin, routeIds, () => output, { connect: '127.0.0.1' });
        await siteAdmin.action('auth/login/index.ts', 'login', [{ email: 'lan@example.com', password: 'long password' }]);
        const grace = accountPage.split('/').pop();
        contains(await siteAdmin.page(`/dashboard/users/${grace}`), 'data-locked-profile');
        await expect(siteAdmin.action('dashboard/users/[id]/index.ts', 'applyPasswordChange', ['taken over', '', 'taken over'], { params: { id: grace } })).rejects.toThrow(/network account/i);
      }
      contains(await web.page('/dashboard/network/users'), 'grace@example.com');
      // Sites show their icons; a site without one shows the network's, which is the main site's.
      expect((await web.action(SETTINGS, 'saveAll', [{ document: { general: { favicon: '/network-icon.svg' } }, languages: null, permalinks: null, network: null, groups: {} }]))._cossack_return.error).toBe('');
      const icons = [...(await web.page('/dashboard/network/sites')).matchAll(/<img src="?([^"\s>]+)"?[^>]*data-site-icon/g)].map(match => match[1]);
      expect(icons).toEqual(Array(servesDirectories() ? 2 : 1).fill(`${origin}/network-icon.svg`));
      // Tools → Export downloads the main site's database at once, without accounts or sessions; network admins download any site's.
      contains(await web.page('/dashboard/tools/export'), 'Download export');
      const own = await web.request('/api/cms/site-export');
      expect(own.status).toBe(200);
      expect(own.headers.get('content-disposition')).toMatch(/^attachment; filename="main-\d{4}-\d{2}-\d{2}\.json"$/);
      const exported = await own.json();
      expect(exported).toMatchObject({ format: 'cossack-site-export', version: 1, site: { id: 'main', name: 'Workers Dev' } });
      expect(exported.tables.map(table => table.name)).toContain('cms_settings');
      expect(exported.tables.map(table => table.name)).not.toContain('cms_accounts');
      expect(exported.tables.map(table => table.name)).not.toContain('cms_auth_sessions');
      if (servesDirectories()) {
        const blogExport = await (await web.request('/api/cms/network/sites/blog/export')).json();
        expect(blogExport.site).toEqual({ id: 'blog', name: 'Blog', host: 'blog.localhost' });
        expect(blogExport.tables.find(table => table.name === 'r__cms__posts').rows.length).toBeGreaterThan(0);
        contains(await web.page('/dashboard/network/sites/blog'), 'Download export');
      }
      // The network home counts the main site as active, beside any added one.
      expect(await web.page('/dashboard/network')).toMatch(new RegExp(`Active sites</p>\\s*<a href="/dashboard/network/sites"[^>]*>\\s*${servesDirectories() ? 2 : 1}\\s*<`));
    } finally {
      if (child.connected) child.send('STOP'); else child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(kill);
    }
    // The services stop with the dev server.
    await expect.poll(() => fetch(`http://127.0.0.1:${port}/v1/database`).then(() => 'answers', () => 'stopped'), { timeout: 10_000 }).toBe('stopped');
    await expect.poll(() => fetch(`http://127.0.0.1:${port + 1}/v1/database`).then(() => 'answers', () => 'stopped'), { timeout: 10_000 }).toBe('stopped');
    // Development warns about @State changes that do not re-render; the pages this case visits make none.
    expect(output).not.toContain('[Cossack] Nested');
  }, 400_000);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
