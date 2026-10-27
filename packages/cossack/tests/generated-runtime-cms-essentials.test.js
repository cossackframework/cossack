// The CMS essentials in a generated application against a local `romedb serve`: scheduling and
// preview links, autosave, revisions, redirects, SEO tags, sitemaps and robots.txt, image
// variants, application passwords and the content API's writes, signed webhooks, moderated
// comments, synced patterns, translations under /fr and two-step sign-in. The HTTP flow runs on
// Node and on Workers; a browser case drives the Publish box, field ordering and passkeys.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks, visible } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';
import { totpCode, totpStep } from '../../auth/src/two-factor.ts';

afterEach(cleanupRoots);

const doc = (...content) => ({ type: 'doc', content });
const paragraph = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Essentials', name: 'Ada', email: 'ada@example.com', password: 'long password', starter: 'on' };

/** A local receiver for webhook deliveries. */
async function receiver() {
  const deliveries = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => { deliveries.push({ headers: request.headers, body }); response.writeHead(204).end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, deliveries, close: () => new Promise(resolve => server.close(resolve)) };
}

/** Save an entry through the editor's server method; returns the new entry's ID. */
async function save(web, collection, values, id = 'new', rev = 0) {
  const result = await web.action(EDITOR, 'save', [values, 'update', rev], { params: { collection, id }, state: { route: collection, id } });
  if (id === 'new') {
    // The editor adopts the new entry: its ID comes back with the state. A failed save shows its answer instead.
    expect(typeof result.id === 'string' && result.id !== 'new' ? result.id : JSON.stringify(result)).toMatch(/^[0-9a-f-]{36}$/);
    return result.id;
  }
  expect(result.error, JSON.stringify(result.errors)).toBe('');
  return result;
}

const richText = (...content) => [{ id: 'rt', type: 'core/richtext', data: { text: doc(...content) } }];
const post = (title, extra = {}) => ({ title, slug: '', excerpt: '', content: richText(paragraph(`${title} body`)), status: 'published', publishedAt: '', sticky: false, featuredImage: '', categories: [], tags: [], ...extra });

async function essentials(origin, routeIds, diagnostics, { runtime }) {
  const web = browserless(origin, routeIds, diagnostics);
  expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
  // Setup added the starter content: a first post in Uncategorized, and a Contact page with its form.
  contains(await web.page('/posts/hello-world'), 'This is your first post');
  contains(await web.page('/category/uncategorized'), 'Hello World!');
  const contactPage = await web.page('/contact');
  contains(contactPage, 'Send us a message');
  expect(contactPage).toMatch(/action="?\/api\/cms\/forms\/contact-form"?/);
  // The server refuses a blank title too; the editor catches it before sending.
  const untitled = await web.action(EDITOR, 'save', [post('   '), 'draft', 0], { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  expect(untitled._cossack_redirect).toBeUndefined();
  expect(untitled.errors).toEqual({ title: 'is required.' });

  // Password protection: visitors see the title and a form; the password unlocks it for ten days; editors and search behave.
  const visitorOf = () => browserless(origin, routeIds, diagnostics);
  const secretId = await save(web, 'posts', post('Members only', { password: 'open sesame', excerpt: 'For members' }));
  const locked = visitorOf();
  const lockedPage = await locked.page('/posts/members-only');
  contains(lockedPage, 'Members only');
  contains(lockedPage, 'password protected');
  lacks(lockedPage, 'Members only body');
  const wrongTry = await locked.post('/posts/members-only', { password: 'nope' });
  expect(wrongTry.headers.get('location')).toBe('/posts/members-only?password=wrong#password');
  contains(await locked.page('/posts/members-only?password=wrong'), 'not right');
  const right = await locked.post('/posts/members-only', { password: 'open sesame' });
  expect(right.headers.get('location')).toBe('/posts/members-only');
  expect(right.headers.get('set-cookie')).toMatch(new RegExp(`^cms_unlock_${secretId}=[0-9a-f]{64}; Path=/posts/members-only;`));
  contains(await locked.page('/posts/members-only'), 'Members only body');
  // The editor reads it without the password; the API keeps the content and the password from visitors.
  contains(await web.page('/posts/members-only'), 'Members only body');
  const secretItem = (await (await fetch(`${origin}/api/cms/content/posts/${secretId}`)).json()).item;
  expect(secretItem).toMatchObject({ title: 'Members only', protected: true });
  expect(secretItem.password).toBeUndefined();
  expect(secretItem.content).toBeUndefined();
  expect(secretItem.excerpt).toBeUndefined();
  expect((await (await web.request(`/api/cms/content/posts/${secretId}`)).json()).item).toMatchObject({ password: 'open sesame', excerpt: 'For members' });
  lacks(await visitorOf().page('/search?q=sesame'), 'Members only');
  lacks(await visitorOf().page('/'), 'For members');

  // Scheduling: a future time schedules; the list shows it; visitors do not see it yet.
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const scheduledId = await save(web, 'posts', post('Coming soon', { publishedAt: future }));
  contains(await web.page(`/dashboard/content/posts/${scheduledId}`), 'Update schedule');
  contains(await web.page('/dashboard/content/posts?status=scheduled'), 'Coming soon');
  expect((await fetch(`${origin}/posts/coming-soon`)).status).toBe(404);
  const pendingId = await save(web, 'posts', post('Needs review', { status: 'pending' }));
  contains(await web.page('/dashboard/content/posts?status=pending'), 'Needs review');
  contains(await web.page('/dashboard'), 'pending review');

  // Preview links show the scheduled entry to anyone with the link, until revoked.
  const editorState = { route: 'posts', id: scheduledId };
  const linked = await web.action(EDITOR, 'createPreviewLink', [], { params: { collection: 'posts', id: scheduledId }, state: editorState });
  expect(linked.previewLink).toMatch(new RegExp(`/preview/posts/${scheduledId}\\?token=[A-Za-z0-9_-]{43}$`));
  const previewPath = linked.previewLink.slice(linked.previewLink.indexOf('/preview/'));
  const preview = await fetch(origin + previewPath);
  expect(preview.status).toBe(200);
  expect(preview.headers.get('x-robots-tag')).toBe('noindex');
  contains(visible(await preview.text()), 'Coming soon body');
  const token = new URL(linked.previewLink).searchParams.get('token');
  expect((await (await fetch(`${origin}/api/cms/content/posts/${scheduledId}?preview=${token}`)).json()).item.title).toBe('Coming soon');
  await web.action(EDITOR, 'revokePreviewLinks', [], { params: { collection: 'posts', id: scheduledId }, state: editorState });
  expect((await fetch(origin + previewPath)).status).toBe(404);

  // Autosave: the editor posts changed values to the autosave API, and they come back when it opens.
  const autosaved = await web.request(`/api/cms/content/posts/${pendingId}/autosave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...post('Needs review, edited'), status: 'pending' }) });
  expect(autosaved.status).toBe(200);
  expect((await autosaved.json()).at).toEqual(expect.any(Number));
  expect((await web.request('/api/cms/content/posts/nope/autosave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' })).status).toBe(400);
  contains(await web.page(`/dashboard/content/posts/${pendingId}`), 'There is an autosave of this entry');
  const restored = await web.action(EDITOR, 'restoreAutosave', [], { params: { collection: 'posts', id: pendingId }, state: { ...editorState, id: pendingId } });
  expect(restored.values.title).toBe('Needs review, edited');

  // Revisions: compare two versions word by word, then restore the first.
  const draftId = await save(web, 'posts', post('Versioned', { status: 'draft', content: richText(paragraph('The quick brown fox')) }));
  await save(web, 'posts', post('Versioned', { status: 'draft', slug: 'versioned', content: richText(paragraph('The slow brown fox jumps')) }), draftId, 1);
  const compare = await web.page(`/dashboard/content/posts/${draftId}/revisions?from=1&to=2`);
  expect(compare).toMatch(/<del[^>]*>quick<\/del>/);
  expect(compare).toMatch(/<ins[^>]*>slow<\/ins>/);
  const back = await web.action(`${EDITOR.replace('/index.ts', '')}/revisions/index.ts`, 'restore', [1], { params: { collection: 'posts', id: draftId }, state: { route: 'posts', id: draftId, current: 2 } });
  expect(back._cossack_redirect).toBe(`/dashboard/content/posts/${draftId}?saved=1`);
  contains(JSON.stringify(await (await web.request(`/api/cms/content/posts/${draftId}`)).json()), 'The quick brown fox');

  // Redirects: a published slug change answers 301 at the old URL; Tools adds others.
  const movingId = await save(web, 'posts', post('Moving day'));
  await save(web, 'posts', post('Moving day', { slug: 'moved-day' }), movingId, 1);
  const old = await fetch(`${origin}/posts/moving-day?ref=mail`, { redirect: 'manual' });
  expect(old.status).toBe(301);
  expect(old.headers.get('location')).toBe('/posts/moved-day?ref=mail');
  const tools = 'dashboard/(cms)/tools/redirects/index.ts';
  const form = (source, target, status, id = '') => ({ id, source, target, status, note: '' });
  expect((await web.action(tools, 'save', [form('/old-campaign', '', 410)])).error).toBe('');
  expect((await web.action(tools, 'save', [form('/docs/*', 'https://docs.example.com/*', 302)])).error).toBe('');
  expect((await fetch(`${origin}/old-campaign`, { redirect: 'manual' })).status).toBe(410);
  const docs = await fetch(`${origin}/docs/start/here`, { redirect: 'manual' });
  expect([docs.status, docs.headers.get('location')]).toEqual([302, 'https://docs.example.com/start/here']);
  contains(await web.page('/dashboard/tools/redirects'), '/posts/moving-day');

  // SEO: the entry's SEO box drives its head, structured data, sitemap and robots.txt.
  const seoId = await save(web, 'posts', post('Search friendly', { seo: { title: 'A better title', description: 'For search results', image: null, canonical: '', noindex: false } }));
  const seoPage = await (await fetch(`${origin}/posts/search-friendly`)).text();
  expect(seoPage).toMatch(/<title[^>]*>A better title – Essentials<\/title>/);
  expect(seoPage).toMatch(/<meta name="?description"? content="?For search results/);
  expect(seoPage).toMatch(/<link rel="?canonical"? href="?https?:\/\/[^/"\s]+\/posts\/search-friendly/);
  expect(seoPage).toMatch(/<meta property="?og:type"? content="?article/);
  const jsonLd = JSON.parse(/<script type="?application\/ld\+json"?[^>]*>([^<]+)<\/script>/.exec(seoPage)[1]);
  expect(jsonLd).toMatchObject({ '@type': 'BlogPosting', headline: 'Search friendly', author: { name: 'Ada' } });
  await save(web, 'posts', post('Hidden one', { seo: { title: '', description: '', image: null, canonical: '', noindex: true } }));
  expect(await (await fetch(`${origin}/posts/hidden-one`)).text()).toMatch(/<meta name="?robots"? content="?noindex/);
  const index = await (await fetch(`${origin}/sitemap.xml`)).text();
  expect(index).toContain('/sitemaps/posts-1.xml');
  expect(index).toContain('/sitemaps/terms-categories.xml');
  const sitemap = await (await fetch(`${origin}/sitemaps/posts-1.xml`)).text();
  expect(sitemap).toContain('/posts/search-friendly</loc>');
  expect(sitemap).not.toContain('hidden-one');
  expect(sitemap).not.toContain('coming-soon');
  const robots = await (await fetch(`${origin}/robots.txt`)).text();
  expect(robots).toContain('Disallow: /dashboard/');
  expect(robots).toMatch(/Sitemap: https?:\/\/[^/\s]+\/sitemap\.xml/);
  void seoId;

  // Images: variants in the browser's best format, cropped around the focal point.
  const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3366cc' } }).png().toBuffer();
  const upload = new FormData();
  upload.append('file', new Blob([photo], { type: 'image/png' }), 'photo.png');
  const uploaded = await (await web.request('/api/cms/media', { method: 'POST', body: upload })).json();
  const image = uploaded.files[0];
  const variant = await fetch(`${origin}${image.url}?w=640&v=1`, { headers: { accept: 'image/avif,image/webp,*/*' } });
  expect(variant.status).toBe(200);
  expect(variant.headers.get('vary')).toBe('Accept');
  const variantType = variant.headers.get('content-type');
  expect(variantType).toBe('image/avif');
  const resized = await sharp(Buffer.from(await variant.arrayBuffer())).metadata();
  expect(runtime === 'node' ? [resized.width, resized.height] : [resized.width]).toEqual(runtime === 'node' ? [640, 427] : [640]);
  await web.action('dashboard/(cms)/media/[id]/index.ts', 'saveEdits', [{ crop: { x: 400, y: 0, width: 800, height: 800 }, focus: { x: 0.5, y: 0.5 } }], { params: { id: image.id } });
  const square = await fetch(`${origin}${image.url}?w=320&v=2`, { headers: { accept: 'image/webp' } });
  expect(square.headers.get('content-type')).toBe('image/webp');
  if (runtime === 'node') expect(await sharp(Buffer.from(await square.arrayBuffer())).metadata()).toMatchObject({ width: 320, height: 320 });
  // Site and app icons from Settings → General: the head links them, the manifest lists resized app icons.
  expect((await web.action('dashboard/(cms)/settings/[group]/index.ts', 'save', [{ favicon: image.url, appIcon: image.url }], { params: { group: 'general' } })).error).toBe('');
  const homeHead = await (await fetch(`${origin}/`)).text();
  expect(homeHead).toMatch(new RegExp(`<link rel="?icon"? href="?${image.url.replaceAll('.', '\\.')}"?`));
  expect(homeHead).toMatch(/rel="?apple-touch-icon"? sizes="?180x180"? href="?\/media\/[^"\s>]+\?w=180&(?:amp;)?h=180/);
  expect(homeHead).toMatch(/rel="?manifest"? href="?\/manifest\.webmanifest/);
  const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json();
  expect(manifest.name).toBe('Essentials');
  expect(manifest.icons.map(entry => entry.sizes)).toEqual(['192x192', '512x512']);
  expect(manifest.icons[0].src).toBe(`${image.url}?w=192&h=192`);
  expect((await fetch(`${origin}${manifest.icons[0].src}`)).status).toBe(200);
  const imaged = await save(web, 'posts', post('Pictured', { featuredImage: image.id }));
  void imaged;
  // The featured image fills a 16:9 frame around its focal point.
  expect(await (await fetch(`${origin}/posts/pictured`)).text()).toMatch(/srcset="?[^"]*\?w=320&(?:amp;)?h=180&(?:amp;)?v=\d+ 320w/);

  // Application passwords sign API writes in; read-only ones cannot write.
  const security = 'dashboard/profile/security/index.ts';
  const writer = (await web.action(security, 'addToken', ['Mobile app', 'write'])).newToken;
  const reader = (await web.action(security, 'addToken', ['Reader', 'read'])).newToken;
  expect(writer).toMatch(/^cms_/);
  const created = await fetch(`${origin}/api/cms/content/posts`, { method: 'POST', headers: { authorization: `Bearer ${writer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'From the app', content: richText(paragraph('Written over the API')), status: 'published' }) });
  const createdBody = await created.json();
  expect(created.status, JSON.stringify(createdBody)).toBe(201);
  expect(createdBody.item).toMatchObject({ title: 'From the app', url: '/posts/from-the-app' });
  const patched = await fetch(`${origin}/api/cms/content/posts/${createdBody.item.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${writer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rev: 1, title: 'From the app, edited' }) });
  expect((await patched.json()).item.rev).toBe(2);
  const stalePatch = await fetch(`${origin}/api/cms/content/posts/${createdBody.item.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${writer}`, 'content-type': 'application/json' }, body: JSON.stringify({ rev: 1, title: 'x' }) });
  expect(stalePatch.status).toBe(409);
  expect((await fetch(`${origin}/api/cms/content/posts`, { method: 'POST', headers: { authorization: `Bearer ${reader}`, 'content-type': 'application/json' }, body: '{"title":"No"}' })).status).toBe(403);
  expect((await fetch(`${origin}/api/cms/content/posts/${pendingId}`, { headers: { authorization: `Bearer ${reader}` } })).status).toBe(200);
  expect((await fetch(`${origin}/api/cms/content/posts`, { method: 'POST', headers: { authorization: 'Bearer cms_nope.nope', 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  // Cookie sessions still need same-origin writes.
  expect((await fetch(`${origin}/api/cms/content/posts`, { method: 'POST', headers: { cookie: `session_id=${web.jar.get('session_id')}`, 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: '{"title":"Forged"}' })).status).toBe(403);
  const deleted = await fetch(`${origin}/api/cms/content/posts/${createdBody.item.id}?rev=2`, { method: 'DELETE', headers: { authorization: `Bearer ${writer}` } });
  expect(deleted.status).toBe(204);

  // Comments: a visitor's first comment waits; once approved it shows and the next one appears at once.
  const commentsOn = await save(web, 'posts', post('Discuss this'));
  const visitor = browserless(origin, routeIds, diagnostics);
  const commentForm = { collection: 'posts', entry: commentsOn, content: 'Great read!', authorName: 'Ann', authorEmail: 'ann@example.com', authorUrl: '', website: '' };
  const posted = await visitor.post('/api/cms/comments', commentForm);
  expect(posted.status).toBe(303);
  expect(posted.headers.get('location')).toBe('/posts/discuss-this?comment=held#comments');
  contains(await visitor.page('/posts/discuss-this?comment=held'), 'awaiting moderation');
  const moderation = await web.page('/dashboard/comments?status=pending');
  contains(moderation, 'Great read!');
  contains(await web.page('/dashboard'), 'Comments (1)');
  const commentId = /data-comment="?([0-9a-f-]{36})/.exec(moderation)[1];
  await web.action('dashboard/(cms)/comments/index.ts', 'moderate', [[commentId], 'approved']);
  contains(await visitor.page('/posts/discuss-this'), 'Great read!');
  // Workers report the client address, and one address comments once every 15 seconds.
  if (runtime === 'workers') {
    expect((await visitor.post('/api/cms/comments', commentForm)).headers.get('location')).toContain('comment=too-fast');
    await new Promise(resolve => setTimeout(resolve, 15_500));
  }
  const spam = await visitor.post('/api/cms/comments', { ...commentForm, content: 'Bots fill this', website: 'https://spam.example' });
  expect(spam.headers.get('location')).toContain('comment=held');
  lacks(await visitor.page('/posts/discuss-this'), 'Bots fill this');
  contains(await web.page('/dashboard/comments?status=spam'), 'Bots fill this');
  const comments = await (await fetch(`${origin}/api/cms/comments?collection=posts&entry=${commentsOn}`)).json();
  expect(comments.items.map(item => item.content)).toEqual(['Great read!']);

  // Synced patterns render their current content wherever they are used.
  const patternId = await save(web, 'patterns', { title: 'Call to action', content: [{ id: 'cta', type: 'core/paragraph', data: { text: 'Subscribe to our newsletter' } }], synced: true, starter: '' });
  await save(web, 'posts', post('With a pattern', { content: [...richText(paragraph('Intro')), { id: 'p1', type: 'core/pattern', data: { pattern: patternId } }] }));
  contains(visible(await visitor.page('/posts/with-a-pattern')), 'Subscribe to our newsletter');
  await save(web, 'patterns', { title: 'Call to action', content: [{ id: 'cta', type: 'core/paragraph', data: { text: 'Follow us everywhere' } }], synced: true, starter: '' }, patternId, 1);
  const updatedPattern = visible(await visitor.page('/posts/with-a-pattern'));
  contains(updatedPattern, 'Follow us everywhere');
  lacks(updatedPattern, 'Subscribe to our newsletter');
  expect(Object.values((await (await fetch(`${origin}/api/cms/content/posts/with-a-pattern`)).json()).patterns)).toEqual([expect.objectContaining({ title: 'Call to action' })]);
  expect((await fetch(`${origin}/api/cms/content/patterns`)).status).toBe(401);

  // Translations: French pages under /fr with alternates and a language switcher.
  expect((await web.action('dashboard/(cms)/settings/languages/index.ts', 'save', ['en', ['fr']])).error).toBe('');
  const aboutId = await save(web, 'pages', { title: 'About us', slug: '', status: 'published', publishedAt: '', content: richText(paragraph('Who we are')), excerpt: '', featuredImage: '', parent: '', menuOrder: '0', locale: 'en' });
  const translated = await web.action(EDITOR, 'translate', ['fr'], { params: { collection: 'pages', id: aboutId }, state: { route: 'pages', id: aboutId } });
  const frenchId = translated._cossack_redirect.split('/').at(-1);
  await save(web, 'pages', { title: 'À propos', slug: 'a-propos', status: 'published', publishedAt: '', content: richText(paragraph('Qui sommes-nous')), excerpt: '', featuredImage: '', parent: '', menuOrder: '0' }, frenchId, 1);
  const french = await visitor.page('/fr/a-propos');
  contains(french, 'Qui sommes-nous');
  expect(french).toMatch(/<link rel="?alternate"? hreflang="?en"? href="?https?:\/\/[^/"\s]+\/about-us/);
  // The language switcher links the English page.
  expect(french).toMatch(/<a href="?\/about-us"? hreflang="?en"? lang="?en"?/);
  expect((await fetch(`${origin}/a-propos`, { redirect: 'manual' })).headers.get('location')).toBe('/fr/a-propos');
  expect((await fetch(`${origin}/fr`)).status).toBe(200);
  contains(await web.page('/dashboard/content/pages?lang=fr'), 'À propos');
  expect((await web.action('dashboard/(cms)/settings/languages/index.ts', 'save', ['en', []])).error).toBe('');

  // Webhooks need a receiver the runtime can reach: this process, from Node.
  if (runtime === 'node') await webhooks(web);

  // Two-step sign-in: an authenticator app, then sign-in asks for its code.
  const setupApp = await web.action(security, 'beginSetup', []);
  const secret = setupApp.setup.secret;
  const confirmed = await web.action(security, 'finishSetup', [await totpCode(secret, totpStep(Date.now()))]);
  expect(confirmed.error).toBe('');
  expect(confirmed.recoveryCodes).toHaveLength(10);
  const fresh = browserless(origin, routeIds, diagnostics);
  const login = await fresh.action('auth/login/index.ts', 'login', [{ email: 'ada@example.com', password: 'long password' }]);
  expect(login._cossack_redirect).toBe('/auth/two-factor');
  expect(fresh.jar.has('session_id')).toBe(false);
  expect(fresh.jar.has('two_factor')).toBe(true);
  const wrong = await fresh.action('auth/two-factor/index.ts', 'verify', ['000000']);
  expect(wrong.error).toContain('tries left');
  const verified = await fresh.action('auth/two-factor/index.ts', 'verify', [confirmed.recoveryCodes[0]]);
  expect(verified._cossack_redirect).toBe('/dashboard/profile/security?recovered=1');
  expect(fresh.jar.has('session_id')).toBe(true);
  const json = await fetch(`${origin}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ada@example.com', password: 'long password' }) });
  expect([json.status, (await json.json()).twoFactorRequired]).toEqual([401, true]);
  const withCode = await fetch(`${origin}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ada@example.com', password: 'long password', code: confirmed.recoveryCodes[1] }) });
  expect(withCode.status).toBe(200);

  // Required two-step sign-in sends staff without it to set it up.
  const editorUser = 'dashboard/users/new/index.ts';
  await web.action(editorUser, 'create', ['Eve', 'eve@example.com', 'eve password 1', ['editor']]);
  expect((await web.action('dashboard/(cms)/settings/[group]/index.ts', 'save', [{ requireTwoFactor: true }], { params: { group: 'general' } })).error).toBe('');
  const eve = browserless(origin, routeIds, diagnostics);
  await eve.action('auth/login/index.ts', 'login', [{ email: 'eve@example.com', password: 'eve password 1' }]);
  expect((await eve.request('/dashboard')).headers.get('location')).toBe('/dashboard/profile/security?required=1');
  contains(await eve.page('/dashboard/profile/security?required=1'), 'This site requires two-step sign-in');
  expect((await web.action('dashboard/(cms)/settings/[group]/index.ts', 'save', [{ requireTwoFactor: false }], { params: { group: 'general' } })).error).toBe('');

  // An administrator issues an application password for Eve from her user screen; it acts as Eve.
  const eveId = (await (await web.request('/dashboard/users?search=eve')).text()).match(/\/dashboard\/users\/(?!new\b)([A-Za-z0-9_-]{8,})/)[1];
  const userScreen = 'dashboard/users/[id]/index.ts';
  const issued = await web.action(userScreen, 'addToken', ['Eve build', 'read'], { params: { id: eveId } });
  expect(issued._cossack_return).toBe(true);
  expect(issued.newToken).toMatch(/^cms_/);
  expect(issued.tokens.map(entry => entry.name)).toEqual(['Eve build']);
  expect((await fetch(`${origin}/api/cms/content/posts/${pendingId}`, { headers: { authorization: `Bearer ${issued.newToken}` } })).status).toBe(200);
  const revoked = await web.action(userScreen, 'deleteToken', [issued.tokens[0].id], { params: { id: eveId } });
  expect(revoked.tokens).toEqual([]);
  expect((await fetch(`${origin}/api/cms/content/posts/${pendingId}`, { headers: { authorization: `Bearer ${issued.newToken}` } })).status).toBe(401);
  // Editors cannot open user screens; a user manager who is not an administrator sees no
  // Sessions or Application passwords there, and the server refuses the actions.
  await expect(eve.action(userScreen, 'addToken', ['Not mine', 'write'], { params: { id: eveId } })).rejects.toThrow(/answered 403/);
  await web.action('dashboard/roles/new/index.ts', 'create', ['User manager', ['cms:dashboard', 'cms:users']]);
  await web.action(editorUser, 'create', ['Max', 'max@example.com', 'max password 1', ['user-manager']]);
  const max = browserless(origin, routeIds, diagnostics);
  await max.action('auth/login/index.ts', 'login', [{ email: 'max@example.com', password: 'max password 1' }]);
  const maxView = await max.page(`/dashboard/users/${eveId}`);
  contains(maxView, 'Edit user details.');
  expect(maxView).not.toContain('Application passwords');
  await expect(max.action(userScreen, 'addToken', ['Not mine', 'write'], { params: { id: eveId } })).rejects.toThrow(/answered 400.*Only the user and administrators/);
  await expect(max.action(userScreen, 'endOtherSessions', [], { params: { id: eveId } })).rejects.toThrow(/answered 400/);

  // Every new screen renders.
  for (const pathname of ['/dashboard/tools/webhooks', '/dashboard/settings/discussion', '/dashboard/settings/seo', '/dashboard/settings/languages', `/dashboard/media/${image.id}`,
    '/dashboard/content/patterns', '/dashboard/content/patterns/new', '/dashboard/profile/security']) await web.page(pathname);
}

/** A webhook on published posts: signed deliveries reach a receiver in this process. */
async function webhooks(web) {
  const hook = await receiver();
  try {
    const page = 'dashboard/(cms)/tools/webhooks/index.ts';
    const saved = await web.action(page, 'save', [{ id: '', name: 'Rebuild', url: hook.url, events: ['entry.published'], collections: ['posts'], active: true }]);
    expect(saved.error).toBe('');
    const secret = saved.hooks[0].secret;
    expect((await web.action(page, 'ping', [saved.selected]))._cossack_return).toMatchObject({ ok: true, status: 204 });
    await save(web, 'posts', post('Rebuild me'));
    await expect.poll(() => hook.deliveries.filter(delivery => delivery.headers['x-cossack-event'] === 'entry.published').length, { timeout: 20_000 }).toBe(1);
    const delivery = hook.deliveries.find(entry => entry.headers['x-cossack-event'] === 'entry.published');
    const expected = createHmac('sha256', secret).update(`${delivery.headers['x-cossack-timestamp']}.${delivery.body}`).digest('hex');
    expect(delivery.headers['x-cossack-signature']).toBe(`sha256=${expected}`);
    expect(JSON.parse(delivery.body)).toMatchObject({ event: 'entry.published', collection: 'posts', entry: { title: 'Rebuild me', url: '/posts/rebuild-me' } });
    contains(await web.page(`/dashboard/tools/webhooks?id=${saved.selected}`), 'Delivered 204');
  } finally { await hook.close(); }
}

describe.skipIf(!liveRomeDBTests())('generated CMS essentials', () => {
  let service;
  beforeAll(async () => { service = await startRomeDBService(); }, 30_000);
  afterAll(async () => { await service?.stop(); });

  it('schedules, previews, redirects, describes, resizes, authorizes, moderates and translates on Node', async () => {
    const root = await project('node', ['cms']);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: service.url, ROMEDB_TOKEN: service.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    try {
      await essentials(server.origin, routeIds, () => server.diagnostics(), { runtime: 'node' });
    } finally { await server.close(); }
  }, 600_000);

  it('runs the essentials on Cloudflare Workers with the Images binding', async () => {
    const root = await project('cloudflare', ['cms']);
    const database = await startRomeDBService();
    try {
      await vite(root, []);
      const configPath = path.join(root, 'dist/ssr/wrangler.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      expect(config.images).toEqual({ binding: 'IMAGES' });
      expect(config.triggers.crons).toContain('* * * * *');
      await fs.writeFile(path.join(path.dirname(configPath), '.dev.vars'), [
        'APP_SECRET=generated-cms-test-secret-0123456789abcdef', `ROMEDB_URL=${database.url}`, `ROMEDB_TOKEN=${database.token}`, 'CMS_SETUP_CODE=setup-code-for-tests',
      ].join('\n') + '\n');
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      const { createTestHarness } = await import('wrangler');
      const runtime = createTestHarness({ root, workers: [{ configPath }] });
      try {
        const { url } = await runtime.listen();
        await essentials(new URL(url).origin, routeIds, () => '', { runtime: 'workers' });
      } finally { await runtime.close(); }
    } finally { await database.stop(); }
  }, 600_000);

  it('picks statuses, orders fields and signs in with a passkey in the browser', async () => {
    const root = await project('node', ['cms']);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const database = await startRomeDBService();
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    let browser;
    try {
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      // Passkeys need a host name: an IP address cannot be a WebAuthn relying party.
      const origin = server.origin.replace('127.0.0.1', 'localhost');
      const web = browserless(origin, routeIds);
      await web.post('/auth/setup', SETUP);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: origin })));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const ready = () => page.waitForFunction(() => window.__cossackReady === true);

      // The Publish box: pick Pending review from the status select.
      await page.goto(origin + '/dashboard/content/posts/new');
      await ready();
      await page.getByPlaceholder('Add title').fill('Picked status');
      await page.getByLabel('Status', { exact: true }).selectOption('pending');
      await page.getByRole('button', { name: 'Submit for review' }).click();
      await page.waitForURL(/\/dashboard\/content\/posts\/[0-9a-f-]{36}$/);
      await browserExpect(page.getByLabel('Status', { exact: true })).toHaveValue('pending');
      // The list shows the author's avatar and the slug.
      await page.goto(origin + '/dashboard/content/posts?status=pending');
      await browserExpect(page.locator('td code', { hasText: 'picked-status' })).toBeVisible();

      // A blank title is caught before saving.
      await page.goto(origin + '/dashboard/content/posts/new');
      await ready();
      await page.getByRole('button', { name: 'Save draft' }).click();
      await browserExpect(page.locator('#field-title-error')).toHaveText('Enter a title.');
      await browserExpect(page.locator('#field-title')).toBeFocused();
      expect(page.url()).toBe(origin + '/dashboard/content/posts/new');
      // The block inserter groups blocks by category and searches them.
      await page.getByRole('button', { name: 'Add block' }).click();
      const blocks = page.getByRole('dialog', { name: 'Blocks' });
      await browserExpect(blocks.getByRole('heading', { name: 'Media' })).toBeVisible();
      await blocks.getByLabel('Search blocks').fill('divid');
      await browserExpect(blocks.getByRole('heading')).toHaveText(['Design']);
      await blocks.getByRole('button', { name: 'Divider' }).click();
      await browserExpect(blocks).toBeHidden();
      // The block joins the content tree after the Rich text block the post starts with.
      await browserExpect(page.locator('[data-block-tree-item]').filter({ hasText: 'Divider' })).toBeVisible();

      // With two languages the posts list has a language column, and the sidebar still
      // reaches it from other screens without a reload.
      expect((await web.action('dashboard/(cms)/settings/languages/index.ts', 'save', ['en', ['fr']])).error).toBe('');
      const navigation = page.locator('#dashboard-navigation');
      for (const start of ['/dashboard/media', '/dashboard/content/pages', '/dashboard/settings/general']) {
        await page.goto(origin + start);
        await ready();
        const allPosts = navigation.getByRole('link', { name: 'All posts' });
        if (!(await allPosts.isVisible())) await navigation.locator('summary', { hasText: 'Posts' }).click();
        await allPosts.click();
        await page.waitForURL(origin + '/dashboard/content/posts');
        await browserExpect(page.getByRole('columnheader', { name: 'Language' })).toBeVisible();
      }

      // Users: when each last signed in, and the Sessions tab for the user and administrators.
      await page.goto(origin + '/dashboard/users');
      await ready();
      await browserExpect(page.getByRole('columnheader', { name: 'Last signed in' })).toBeVisible();
      const adaRow = page.getByRole('row').filter({ hasText: SETUP.email });
      await browserExpect(adaRow.locator('time')).toHaveCount(1);
      await adaRow.getByRole('link').first().click();
      await ready();
      await page.getByRole('tab', { name: /^Sessions/ }).click();
      await browserExpect(page.locator('#user-sessions')).toBeVisible();
      await browserExpect(page.locator('#user-sessions').getByText('Current')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('tab')).toBe('sessions');
      // Application passwords on the user screen, shown once after creation.
      await page.getByRole('tab', { name: /^Application passwords/ }).click();
      await page.locator('#token-name').fill('Build server');
      await page.getByRole('button', { name: 'Add application password' }).click();
      await browserExpect(page.locator('[data-new-token]')).toHaveValue(/^cms_/);
      await browserExpect(page.locator('li[data-token="Build server"]')).toBeVisible();
      await browserExpect(page.locator('#token-name')).toHaveValue('');
      expect(new URL(page.url()).searchParams.get('tab')).toBe('passwords');

      // Collection fields: a group made from the collection manager is attached to it, and the post editor shows its field.
      await page.goto(origin + '/dashboard/collections/posts');
      await ready();
      await browserExpect(page.getByLabel('Content')).toBeChecked();
      await browserExpect(page.getByLabel('Content')).toBeDisabled();
      await page.getByRole('link', { name: 'New field group' }).click();
      await page.waitForURL(/\/dashboard\/field-groups\/new\?collection=posts$/);
      await ready();
      await page.getByLabel('Title').fill('Post extras');
      await page.getByRole('button', { name: 'Create field group' }).click();
      await page.waitForURL(/\/dashboard\/field-groups\/post-extras/);
      await ready();
      await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
      const picker = page.getByRole('dialog', { name: 'Blocks' });
      await picker.getByLabel('Search blocks').fill('text');
      await picker.getByRole('button', { name: 'Single line', exact: true }).click();
      const subtitle = page.getByRole('region', { name: 'Single line 1' });
      await subtitle.getByRole('button', { name: 'Edit Single line' }).click();
      const panel = page.getByRole('dialog', { name: 'Single line' });
      await panel.getByLabel('Label *').fill('Subtitle');
      await panel.getByRole('button', { name: 'Done' }).click();
      await page.getByRole('button', { name: 'Save field group' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Field group saved.' }).first()).toBeVisible();
      await page.goto(origin + '/dashboard/collections/posts');
      await ready();
      await browserExpect(page.locator('li[data-group="post-extras"]')).toBeVisible();
      await page.getByRole('button', { name: 'Save collection' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Collection saved.' }).first()).toBeVisible();
      await page.reload();
      await ready();
      await browserExpect(page.locator('li[data-group="post-extras"]')).toBeVisible();
      await page.goto(origin + '/dashboard/content/posts/new');
      await ready();
      await browserExpect(page.getByLabel('Subtitle')).toBeVisible();

      // Passkeys: add one with a virtual authenticator, then sign in with it alone.
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      await page.goto(origin + '/dashboard/profile/security');
      await ready();
      await page.getByLabel('Name', { exact: true }).first().fill('Test key');
      await page.getByRole('button', { name: 'Add a passkey' }).click();
      await browserExpect(page.getByText('Test key')).toBeVisible();
      await context.clearCookies();
      await page.goto(origin + '/auth/login');
      await ready();
      await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
      await page.waitForURL(/\/dashboard$/);
      await browserExpect(page.getByText('At a glance')).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await server.close();
      await database.stop();
    }
  }, 400_000);
});
