// The access matrix (specs/cms-invariants.md rule 3): every route and server method of a
// generated CMS app, called as each kind of principal, answers as its row in the table below.
// A route or method missing from the table fails the test, so a new one needs a row.
//
// Outcomes: `allow` (not refused: answers, or rejects the arguments for another reason),
// `deny` (401/403, a redirect to sign-in or the security page, or a refusal naming permission,
// sign-in or edit rights), `skip` (not called, with a reason). A call that crashes (500) is
// reported. Principals expected to be refused get the real fixtures as arguments, so a hole
// would act on them; allowed principals get missing IDs for anything that changes data.
//
// COSSACK_ACCESS_ROOT reuses an app built earlier (for working on the table);
// COSSACK_ACCESS_OBSERVE writes every observed outcome to that file.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless, PNG } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const PRINCIPALS = ['anonymous', 'subscriber', 'gated', 'editor', 'admin'];
const SIGNED_IN = ['subscriber', 'editor', 'admin'];
const STAFF = ['editor', 'admin'];
const ADMIN = ['admin'];
const ALL = PRINCIPALS;
const NONE = [];
/** The API refuses a session still owing its second factor, except at the visitor endpoints. */
const PUBLIC = ['anonymous', 'subscriber', 'editor', 'admin'];

/**
 * Who is let in, by file (glob-free prefix, longest wins), for its pages and server methods.
 * `methods` overrides single methods; `get` overrides the page GET. Lists name who is allowed;
 * everyone else must be refused. `skip` names a reason not to call a method.
 */
const PAGES = [
  // The public site: open to all; editing on the site is for editors.
  { prefix: '(site)/', allow: ALL, methods: {
    // Stopping only drops the caller's own draft.
    'startEditing': STAFF, 'previewDraft': STAFF, 'saveDraft': STAFF, 'stopEditing': ALL, 'searchDraftMedia': STAFF,
    // Renders the caller's own drafts back to them; area drafts only for appearance managers.
    'previewAreas': SIGNED_IN,
    'doLogout': { skip: 'signs the client out' },
  } },
  { prefix: '(site)/preview/', allow: STAFF },
  // Signed-in people are sent on from the sign-in pages; the actions answer anyone.
  { prefix: 'auth/', allow: ALL, get: ['anonymous'] },
  // The dashboard: signed-in people reach their profile, security and sessions; the rest is staff or admin.
  { prefix: 'dashboard/index.ts', allow: SIGNED_IN },
  { prefix: 'dashboard/layout.ts', allow: SIGNED_IN, methods: { 'doLogout': { skip: 'signs the client out' } } },
  { prefix: 'dashboard/profile/', allow: SIGNED_IN },
  { prefix: 'dashboard/profile/security/', allow: [...SIGNED_IN, 'gated'], methods: { 'addToken': SIGNED_IN } },
  { prefix: 'dashboard/sessions/', allow: SIGNED_IN, methods: { 'revokeAll': { skip: 'ends the client\'s session' } } },
  { prefix: 'dashboard/users/', allow: ADMIN },
  { prefix: 'dashboard/roles/', allow: ADMIN },
  { prefix: 'dashboard/(cms)/', allow: ADMIN },
  // Content pages show what the principal may read; changing it needs the entry's rights.
  { prefix: 'dashboard/(cms)/content/', allow: STAFF, get: SIGNED_IN, methods: {
    'load': SIGNED_IN, 'loadLinkSuggestions': SIGNED_IN,
    // These reach only what the principal may: their own autosave, readable patterns, previews of what they send.
    'refreshPreviews': SIGNED_IN, 'restoreAutosave': SIGNED_IN, 'dismissAutosave': SIGNED_IN, 'findPatterns': SIGNED_IN, 'patternContent': SIGNED_IN, 'preview': SIGNED_IN,
    'translate': { skip: 'the site has one language, so a translation is refused before access is checked' },
    'suggest': { skip: 'the app has no AI provider, so the suggestion is refused before access is checked' },
  } },
  // A locked entry's history is for its editors.
  { prefix: 'dashboard/(cms)/content/[collection]/[id]/revisions/', allow: STAFF },
  { prefix: 'dashboard/(cms)/media/', allow: STAFF },
  // Sends on to the media library, which checks.
  { prefix: 'dashboard/(cms)/media/new/', allow: STAFF, get: SIGNED_IN },
  { prefix: 'dashboard/(cms)/comments/', allow: STAFF },
  { prefix: 'dashboard/(cms)/terms/', allow: STAFF },
  { prefix: 'dashboard/(cms)/calendar/', allow: STAFF },
  { prefix: 'dashboard/(cms)/blocks/', allow: ADMIN },
  { prefix: 'dashboard/(cms)/forms/', allow: STAFF },
  { prefix: 'dashboard/(cms)/profile/', allow: SIGNED_IN },
  { prefix: 'dashboard/(cms)/my-sites/', allow: SIGNED_IN },
  // The network is off until Settings → Network turns it on.
  { prefix: 'dashboard/(cms)/network/', allow: NONE },
];

/** API routes, by path prefix (after /api/), for every verb unless `verbs` says otherwise. */
const API = [
  // Without credentials, signing in is refused.
  { prefix: 'auth/session', allow: NONE, verbs: { DELETE: { skip: 'signs the client out' } } },
  { prefix: 'cms/', allow: ADMIN },
  // Visitor endpoints answer anyone, staff without a second factor as visitors.
  { prefix: 'cms/comments/index', verbs: { GET: ALL, POST: ALL } },
  { prefix: 'cms/forms/[slug]/index', allow: ALL },
  { prefix: 'cms/search', allow: ALL },
  { prefix: 'cms/menus/', allow: ALL },
  { prefix: 'cms/payments/webhook', allow: ALL },
  // Recovery needs CMS_RECOVERY_CODE, which this app has not set.
  { prefix: 'cms/recovery', allow: NONE },
  { prefix: 'cms/me/', allow: SIGNED_IN },
  // Content and the editorial tools editors use.
  { prefix: 'cms/content/', allow: STAFF, verbs: { GET: PUBLIC } },
  { prefix: 'cms/schema/', verbs: { GET: PUBLIC } },
  { prefix: 'cms/me/recent-blocks', verbs: { GET: PUBLIC, POST: SIGNED_IN } },
  // Readers get the groups, notes and entries they may see.
  { prefix: 'cms/settings/', allow: ADMIN, verbs: { GET: SIGNED_IN } },
  { prefix: 'cms/notes/index', verbs: { GET: SIGNED_IN } },
  { prefix: 'cms/content/[collection]/[entry]/autosave', allow: STAFF },
  { prefix: 'cms/content/[collection]/[entry]/notes', allow: STAFF },
  { prefix: 'cms/content/[collection]/[entry]/revisions', allow: STAFF },
  { prefix: 'cms/content/[collection]/[entry]/publish', allow: STAFF },
  { prefix: 'cms/content/[collection]/[entry]/unpublish', allow: STAFF },
  { prefix: 'cms/content/[collection]/[entry]/blocks/', allow: STAFF },
  { prefix: 'cms/notes/', allow: STAFF },
  { prefix: 'cms/media', allow: STAFF },
  { prefix: 'cms/uploads/', allow: STAFF },
  { prefix: 'cms/comments/queue', allow: STAFF },
  { prefix: 'cms/comments/[id]', allow: STAFF },
  { prefix: 'cms/terms/', allow: STAFF, verbs: { GET: PUBLIC } },
  { prefix: 'cms/taxonomies/', verbs: { GET: PUBLIC } },
  { prefix: 'cms/collections/', verbs: { GET: PUBLIC } },
  { prefix: 'cms/export/', allow: STAFF, verbs: { GET: SIGNED_IN } },
  { prefix: 'cms/import/', allow: STAFF },
  { prefix: 'cms/forms/[slug]/submissions/', allow: STAFF },
  // MCP signs in with application passwords only.
  { prefix: 'cms/mcp', allow: NONE },
  // The network is off until Settings → Network turns it on.
  { prefix: 'cms/network/', allow: NONE },
];

/**
 * Arguments for a principal expected to be refused: the real fixtures, so a hole would act on
 * them (the integrity check after each principal's run sees it). Methods not listed get none.
 */
const CONTENT_LIST = 'dashboard/(cms)/content/[collection]/index.ts';
const CONTENT_EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const ARGS = {
  [CONTENT_LIST]: {
    importJson: () => [JSON.stringify([{ title: 'HACKED-7f3a', status: 'published' }])],
    moveTo: f => [f.publishedId, 1, 'trash'], deleteEntry: f => [f.publishedId, 1], duplicate: f => [f.protectedId],
    runAction: f => [f.publishedId, 0], applyBulk: f => [[{ id: f.publishedId, rev: 1 }], 'trash'], translate: f => [f.protectedId, 'fr'],
  },
  [CONTENT_EDITOR]: {
    save: () => [{ title: 'HACKED-7f3a' }, 'update', 1], applyJson: () => [JSON.stringify({ title: 'HACKED-7f3a' }), 1],
    translate: () => ['fr'], addTerm: () => ['categories', 'HACKED-7f3a', ''], storeAutosave: () => [{ title: 'HACKED-7f3a' }],
    patternContent: () => ['missing'], preview: () => ['rt', 'x'], findMedia: () => ['', ''], suggest: () => ['title', { title: 'x' }],
    refreshPreviews: () => [{}], loadLinkSuggestions: () => ['Protected', ''],
  },
  'dashboard/(cms)/content/[collection]/[id]/revisions/index.ts': { restore: () => [1] },
  '(site)/[...path]/index.ts': { saveDraft: () => [{ title: 'HACKED-7f3a' }], previewDraft: () => [{ title: 'HACKED-7f3a' }], searchDraftMedia: () => [''] },
  '(site)/layout.ts': { previewAreas: () => [{ areas: [], patterns: [] }] },
};
/** Page state a method acts on: the site page names the entry it edits. */
const STATE = {
  '(site)/[...path]/index.ts': f => ({ editable: { collection: 'posts', id: f.protectedId }, frameEditable: true,
    draft: { collection: 'posts', id: f.protectedId, rev: 1, documents: [], view: { blocks: [] } } }),
};
/** A 200 that shows the method did nothing counts as a refusal. */
const IDLE = {
  '(site)/[...path]/index.ts': body => body.draft === null || body.draft === undefined,
  // Not signed in: the layout leaves the site's areas as the page sent them.
  '(site)/layout.ts': body => !body.site?.areas || Object.keys(body.site.areas).length === 0,
};
/** Request bodies for API writes by a principal expected to be refused (others send `{}`). */
const BODIES = {
  'cms/content/[collection]/[entry] PATCH': { title: 'HACKED-7f3a', rev: 1 },
  'cms/content/[collection]/index POST': { title: 'HACKED-7f3a', status: 'published' },
  'cms/import/[collection] POST': [{ title: 'HACKED-7f3a', status: 'published' }],
  'cms/terms/[taxonomy]/index POST': { name: 'HACKED-7f3a' },
  'cms/terms/[taxonomy]/[id] PATCH': { name: 'HACKED-7f3a' },
  'cms/settings/index PUT': { general: { siteTitle: 'HACKED-7f3a' } },
  'cms/media POST': 'multipart',
  'cms/settings/[group] PATCH': { siteTitle: 'HACKED-7f3a' },
  'cms/uploads/index POST': { name: 'a.png', type: 'image/png', size: 68 },
  'cms/redirects/index POST': { from: '/hacked-7f3a', to: '/', status: 301 },
  'cms/users/index POST': { name: 'Mallory', email: 'hacked-7f3a@example.com', password: 'mallory password 1', roles: ['admin'] },
  'cms/webhooks/index POST': { url: 'https://example.com/hook', events: ['resource.updated'] },
};
const MULTIPART = 'multipart';
/** Query strings for API writes by a principal expected to be refused. */
const QUERIES = { 'cms/content/[collection]/[entry] DELETE': '?rev=1' };

/** Methods whose name says they change something: allowed principals call them on missing IDs. */
const MUTATES = /^(delete|remove|revoke|reset|restore|save|apply|create|import|move|duplicate|run|moderate|reply|activate|assign|attach|toggle|ping|redeliver|forget|rebuild|clear|end|turn|regenerate|finish|store|dismiss|translate|set|change|upload|add|rotate|download|reveal)/;

function rule(table, key) {
  return table.filter(entry => key.startsWith(entry.prefix)).sort((a, b) => b.prefix.length - a.prefix.length);
}

function pageExpectation(file, method) {
  const rules = rule(PAGES, file);
  // The most specific rule that says anything about this call decides.
  for (const entry of rules) {
    if (method && entry.methods && Object.hasOwn(entry.methods, method)) return entry.methods[method];
    if (!method && entry.get) return entry.get;
    if (entry.allow) return entry.allow;
  }
  return undefined;
}

function apiExpectation(route, verb) {
  for (const entry of rule(API, route)) {
    if (entry.verbs && Object.hasOwn(entry.verbs, verb)) return entry.verbs[verb];
    if (entry.allow) return entry.allow;
  }
  return undefined;
}

/** Every page file's server methods and form handlers, read from the generated app's sources. */
async function serverMethods(root) {
  const pages = path.join(root, 'src/pages');
  const files = [];
  const walk = async dir => { for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full); else if (entry.name.endsWith('.ts')) files.push(full);
  } };
  await walk(pages);
  const found = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const relative = path.relative(pages, file).split(path.sep).join('/');
    for (const match of source.matchAll(/@Server\([^)]*\)\s*(?:(?:public|private|protected|static|override)\s+)*(?:async\s+)?(\w+)\s*\(/g)) found.push({ file: relative, method: match[1] });
  }
  return found;
}

/** A route pattern's parameters filled for a call: real fixtures when refusal is expected. */
function fill(pattern, fixtures, { real }) {
  const id = real ? fixtures.protectedId : 'missing-id';
  const values = {
    collection: 'posts', entry: id, id, revision: '1', taxonomy: 'categories', name: real ? 'posts' : 'missing-name',
    location: 'primary', group: 'general', plugin: 'example', command: 'missing', slug: 'missing-form', submission: 'missing', file: 'missing',
    path: 'posts/protected-post', rest: 'missing', block: 'missing',
  };
  return values;
}

/** A refusal reported in a nested `error` field, such as an import's failed rows. */
const NESTED_REFUSAL = /"error":"[^"]*(?:not allowed|cannot|permission|only editors|may not)[^"]*"/i;
const REFUSAL = /permission|not allowed|only (?:its )?editors|cannot (?:edit|manage|change|see|read|open|create|delete|do|use)|forbidden|sign in|signed in|two-step|not (?:yours|a member)|only (?:network )?admin|may not|unauthori[sz]ed|access/i;

/** One /crpc call, classified. */
async function callMethod(client, routeIds, file, method, params, state, payload = [], pageFile, refused = false) {
  const componentRouteId = routeIds[`/src/pages/${file}`];
  if (!componentRouteId) return { outcome: 'missing-route-id' };
  // A layout's method runs under a page it encloses.
  const response = await client.request('/crpc', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ componentRouteId, action: method, payload, state, pageParams: params, ...(pageFile ? { pageRouteId: routeIds[`/src/pages/${pageFile}`] } : {}) }) });
  const text = await response.text();
  if (response.status === 401 || response.status === 403) return { outcome: 'deny', status: response.status, text };
  if (response.status >= 500) return { outcome: 'crash', status: response.status, text };
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  // Not found answers both: a refused principal may not learn what exists, an allowed one asked for a missing ID.
  if (response.status === 404 || response.status === 409) return { outcome: 'hidden', status: response.status, text };
  if (response.status >= 400 && REFUSAL.test(text)) return { outcome: 'deny', status: response.status, text };
  if (response.status >= 400) return { outcome: 'allow', status: response.status, text };
  const redirect = body._cossack_redirect ?? '';
  if (/^\/auth\/login|^\/dashboard\/profile\/security\?required/.test(redirect)) return { outcome: 'deny', status: 200, text };
  const message = [body.error, body.failed, body.message].filter(value => typeof value === 'string').join(' ');
  if (REFUSAL.test(message) || NESTED_REFUSAL.test(text)) return { outcome: 'deny', status: 200, text };
  if (/not found|does not exist|no longer exists|changed or was deleted since|could not be run/i.test(message)) return { outcome: 'hidden', status: 200, text };
  if (refused && IDLE[file]?.(body, method)) return { outcome: 'deny', status: 200, text };
  return { outcome: 'allow', status: 200, text: `[error: ${message}] ${text}` };
}

/** One page GET or API call, classified. */
async function callRoute(client, pathname, method, body = {}) {
  const headers = { origin: client.origin, 'sec-fetch-site': 'same-origin' };
  let payload;
  if (body === MULTIPART) {
    payload = new FormData();
    payload.append('file', new Blob([PNG], { type: 'image/png' }), 'hacked-7f3a.png');
  } else { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const init = method === 'GET' ? {} : { method, headers, body: payload };
  const response = await client.request(pathname, init);
  const text = response.status === 204 ? '' : await response.text();
  const location = response.headers.get('location') ?? '';
  if (response.status === 401 || response.status === 403) return { outcome: 'deny', status: response.status, text };
  if (response.status === 404 || response.status === 409) return { outcome: 'hidden', status: response.status, text };
  if (response.status >= 500) return { outcome: 'crash', status: response.status, text };
  if (response.status === 200 && NESTED_REFUSAL.test(text)) return { outcome: 'deny', status: response.status, text };
  if (response.status >= 400 && response.status < 500 && /json/.test(response.headers.get('content-type') ?? '') && REFUSAL.test(text)) return { outcome: 'deny', status: response.status, text };
  // The dashboard sends people a page is not for back to its home.
  const away = /\/auth\/login|\/dashboard\/profile\/security\?required/.test(location) || (location === '/dashboard' && pathname !== '/dashboard');
  if (response.status >= 300 && response.status < 400) return { outcome: away ? 'deny' : 'allow', status: response.status, text: location };
  return { outcome: 'allow', status: response.status, text };
}

const SECRETS = { protectedBody: 'PROTECTED-BODY-7f3a', password: 'pw-7f3a-secret', membersBody: 'MEMBERS-BODY-7f3a', draftBody: 'DRAFT-BODY-7f3a' };
/** What each principal must never see, wherever it looks. */
const UNSEEN = {
  anonymous: [SECRETS.protectedBody, SECRETS.password, SECRETS.membersBody, SECRETS.draftBody],
  gated: [SECRETS.protectedBody, SECRETS.password, SECRETS.membersBody, SECRETS.draftBody],
  // A signed-in member reads members-only entries; protected bodies need the password.
  subscriber: [SECRETS.protectedBody, SECRETS.password, SECRETS.draftBody],
  editor: [], admin: [],
};

const EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const post = (title, body, extra = {}) => ({ title, slug: '', excerpt: '', content: [{ _id: 'rt', type: 'core/richtext', data: { text: doc(body) } }], status: 'published', publishedAt: '', sticky: false, featuredImage: '', categories: [], tags: [], ...extra });

async function savePost(web, values) {
  const result = await web.action(EDITOR, 'save', [values, 'update', 0], { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
  expect(result.id, JSON.stringify(result).slice(0, 2000)).toMatch(/^[0-9a-f-]{36}$/);
  return result.id;
}

async function signIn(origin, routeIds, diagnostics, email, password) {
  const client = browserless(origin, routeIds, diagnostics);
  const result = await client.action('auth/login/index.ts', 'login', [{ email, password }]);
  expect(result._cossack_redirect, JSON.stringify(result).slice(0, 500)).toBeTruthy();
  return client;
}

async function app() {
  if (process.env.COSSACK_ACCESS_ROOT) return { root: process.env.COSSACK_ACCESS_ROOT };
  const root = await project('node', ['cms']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  return { root };
}

describe.skipIf(!liveRomeDBTests())('generated CMS access matrix', () => {
  it('answers every route and server method as the table expects, for every kind of principal', async () => {
    const { root } = await app();
    const database = await startRomeDBService();
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    try {
      const { origin, diagnostics } = server;
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
      const routeIds = manifest.filePathToId;

      // Fixtures: an administrator, an editor, a subscriber, and four posts.
      const admin = browserless(origin, routeIds, diagnostics);
      expect((await admin.post('/auth/setup', { code: 'setup-code-for-tests', siteTitle: 'Access', name: 'Ada', email: 'ada@example.com', password: 'long password', starter: 'on' })).headers.get('location')).toBe('/dashboard');
      for (const [name, email, role] of [['Eve', 'eve@example.com', 'editor'], ['Sam', 'sam@example.com', 'subscriber'], ['Gus', 'gus@example.com', 'editor']]) {
        await admin.action('dashboard/users/new/index.ts', 'create', [name, email, `${name} password 1`, [role]]);
      }
      const fixtures = {
        publishedId: await savePost(admin, post('Open post', 'An open body')),
        protectedId: await savePost(admin, post('Protected post', SECRETS.protectedBody, { password: SECRETS.password })),
        membersId: await savePost(admin, post('Members post', SECRETS.membersBody, { membersOnly: true })),
        draftId: await savePost(admin, post('Draft post', SECRETS.draftBody, { status: 'draft' })),
      };
      const clients = {
        anonymous: browserless(origin, routeIds, diagnostics),
        subscriber: await signIn(origin, routeIds, diagnostics, 'sam@example.com', 'Sam password 1'),
        editor: await signIn(origin, routeIds, diagnostics, 'eve@example.com', 'Eve password 1'),
        admin,
      };
      for (const client of Object.values(clients)) client.origin = origin;

      const methods = await serverMethods(root);
      const routes = manifest.routes.map(route => ({ ...route, file: route.filePath.replace(/^\/src\/pages\//, '') }));
      const apiVerbs = [];
      for (const route of routes.filter(entry => entry.kind === 'api')) {
        const source = await fs.readFile(path.join(root, route.filePath), 'utf8');
        for (const match of source.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) apiVerbs.push({ route, verb: match[1] });
      }

      // Every method and route needs a row.
      const unlisted = [
        ...methods.filter(entry => pageExpectation(entry.file, entry.method) === undefined).map(entry => `${entry.file} ${entry.method}()`),
        ...routes.filter(entry => entry.kind === 'page' && pageExpectation(entry.file) === undefined).map(entry => `${entry.file} GET`),
        ...apiVerbs.filter(entry => apiExpectation(entry.route.file.replace(/^api\//, '').replace(/\.ts$/, ''), entry.verb) === undefined).map(entry => `${entry.route.file} ${entry.verb}`),
      ];
      expect(unlisted, 'routes and server methods without a row in the access table').toEqual([]);

      const observed = [];
      const problems = [];
      // Calls made with placeholder arguments may fail with 500: reported, not counted as access problems.
      const crashes = [];
      const record = (principal, label, expected, result) => {
        const want = expected.includes(principal) ? 'allow' : 'deny';
        observed.push({ principal, label, want, got: result.outcome, status: result.status });
        if (result.outcome === 'crash') crashes.push(`${label} as ${principal}`);
        else if (want === 'deny' && result.outcome !== 'deny' && result.outcome !== 'hidden') problems.push(`${label} as ${principal}: expected a refusal, answered ${result.status} ${result.text.slice(0, 200)}`);
        else if (want === 'allow' && result.outcome === 'deny') problems.push(`${label} as ${principal}: refused (${result.status}) ${result.text.slice(0, 200)}`);
        if (result.outcome !== 'deny') for (const secret of UNSEEN[principal]) {
          if (result.text.includes(secret)) problems.push(`${label} as ${principal}: shows ${Object.entries(SECRETS).find(([, value]) => value === secret)[0]}`);
        }
      };

      // After each refused principal's run: the fixtures, the site title and the lists are as they were.
      const inspector = await signIn(origin, routeIds, diagnostics, 'ada@example.com', 'long password');
      const snapshot = async () => {
        const entries = {};
        for (const [name, id] of Object.entries(fixtures)) {
          const response = await inspector.request(`/api/cms/content/posts/${id}`);
          const item = response.status === 200 ? (await response.json()).item : null;
          entries[name] = item ? { title: item.title, status: item.status, rev: item.rev } : null;
        }
        const listed = await (await inspector.request('/api/cms/content/posts?status=all&limit=100')).text();
        const media = await (await inspector.request('/api/cms/media')).text();
        const count = text => (text.match(/"id":"/g) ?? []).length;
        const terms = await (await inspector.request('/api/cms/terms/categories')).text();
        const settings = await (await inspector.request('/api/cms/settings/general')).text();
        return { entries, posts: count(listed), media: count(media), hacked: [listed, terms, settings, media].some(text => /hacked-7f3a/i.test(text)), title: /"siteTitle":"([^"]*)"/.exec(settings)?.[1] };
      };
      const before = await snapshot();
      expect(before.title).toBe('Access');
      const intact = async principal => {
        const now = await snapshot();
        if (JSON.stringify(now) !== JSON.stringify(before)) problems.push(`as ${principal}: the fixtures changed: ${JSON.stringify(before)} → ${JSON.stringify(now)}`);
      };

      const run = async principal => {
        const client = clients[principal];
        for (const { file, method } of methods) {
          const expected = pageExpectation(file, method);
          if (!Array.isArray(expected)) continue;
          const real = !expected.includes(principal) || !MUTATES.test(method);
          const route = routes.find(entry => entry.file === file);
          const params = route ? Object.fromEntries(route.parameters.map(parameter => [parameter.name, fill(route.pattern, fixtures, { real })[parameter.name]])) : {};
          const refused = !expected.includes(principal);
          const state = { route: params.collection, id: params.id, collection: params.collection, ...STATE[file]?.(fixtures) };
          const payload = refused ? ARGS[file]?.[method]?.(fixtures) ?? [] : [];
          const encloses = entry => entry.kind === 'page' && entry.layoutPaths.includes(`/src/pages/${file}`) && !entry.parameters.length;
          const under = file.endsWith('layout.ts') ? (routes.find(entry => encloses(entry) && entry.file === file.replace(/layout\.ts$/, 'index.ts')) ?? routes.find(encloses))?.file : undefined;
          record(principal, `${file} ${method}()`, expected, await callMethod(client, routeIds, file, method, params, state, payload, under, refused));
        }
        for (const route of routes.filter(entry => entry.kind === 'page')) {
          const expected = pageExpectation(route.file);
          const values = fill(route.pattern, fixtures, { real: true });
          const pathname = route.pattern.replace(/:(\w+)(\{[^}]*\})?/g, (_, name) => values[name] ?? 'x');
          record(principal, `${route.file} GET ${pathname}`, expected, await callRoute(client, pathname, 'GET'));
        }
        for (const { route, verb } of apiVerbs) {
          const key = route.file.replace(/^api\//, '').replace(/\.ts$/, '');
          const expected = apiExpectation(key, verb);
          if (!Array.isArray(expected)) continue;
          const real = !expected.includes(principal) || verb === 'GET';
          const values = fill(route.pattern, fixtures, { real });
          const pathname = route.pattern.replace(/:(\w+)(\{[^}]*\})?/g, (_, name) => values[name] ?? 'x');
          const refused = !expected.includes(principal);
          const body = refused ? BODIES[`${key} ${verb}`] ?? {} : {};
          const query = refused ? QUERIES[`${key} ${verb}`] ?? '' : '';
          record(principal, `${route.file} ${verb} ${pathname}`, expected, await callRoute(client, pathname + query, verb, body));
        }
        if (principal !== 'admin' && principal !== 'gated') await intact(principal);
      };
      for (const principal of ['anonymous', 'subscriber', 'editor', 'admin']) await run(principal);

      // Last, with two-step sign-in required: Gus signs in with a password alone.
      const adminAgain = await signIn(origin, routeIds, diagnostics, 'ada@example.com', 'long password');
      const saved = await adminAgain.action('dashboard/(cms)/settings/index.ts', 'saveAll', [{ document: { general: { requireTwoFactor: true } }, languages: null, permalinks: null, groups: {} }]);
      expect(saved._cossack_return?.error ?? '', JSON.stringify(saved).slice(0, 500)).toBe('');
      clients.gated = await signIn(origin, routeIds, diagnostics, 'gus@example.com', 'Gus password 1');
      clients.gated.origin = origin;
      await run('gated');

      if (process.env.COSSACK_ACCESS_OBSERVE) await fs.writeFile(process.env.COSSACK_ACCESS_OBSERVE, JSON.stringify({ observed, problems, crashes }, null, 1));
      expect(problems, `${problems.length} access problems:\n${problems.join('\n')}`).toEqual([]);
    } finally {
      await server.close();
      await database.stop();
    }
  }, 900_000);
});
