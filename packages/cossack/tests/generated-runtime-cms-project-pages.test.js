// A CMS project's own pages (docs/cms/custom-pages.md): files under src/pages route as in any
// Cossack project and read the CMS through the request: the host, the principal, the user.
// The pages here are the ones the documentation shows.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, productionServer, project, typecheck, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Project Pages', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const paragraph = text => [{ _id: 'rt', type: 'core/richtext', data: { text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } }];
const post = (title, status) => ({ title, slug: '', excerpt: '', content: paragraph(`${title} body`), status, publishedAt: '', sticky: false, featuredImage: '', categories: [], tags: [] });

const PAGES = {
  // A page outside the site layout: settings, a collection as the visitor may read it, the user, a server method.
  'src/pages/custom-route/index.ts': `import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class CustomRoute extends Cossack {
  @State() site = '';
  @State() visitor = 'Guest';
  @State() titles: string[] = [];

  async init() {
    const cms = this.c.get('cms');
    this.site = String(await cms.settings.get('general.siteTitle'));
    this.visitor = this.c.get('user')?.name ?? 'Guest';
    const posts = await cms.resource('cms/posts').list({ limit: 10 }, { principal: this.c.get('principal') });
    this.titles = posts.records.map(record => String(record.title));
  }

  @Server()
  async count(): Promise<number> {
    return this.c.get('cms').resource('cms/posts').count({ where: { status: 'published' } }, { principal: this.c.get('principal') });
  }

  render() {
    return html\`<main>
      <h1>Custom route on \${this.site}</h1>
      <p>Hello, \${this.visitor}</p>
      <ul>\${this.titles.map(title => html\`<li>\${title}</li>\`)}</ul>
    </main>\`;
  }
}
`,
  // Under (site): inside the theme's header and footer.
  'src/pages/(site)/inside/index.ts': `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class Inside extends Cossack {
  render() {
    return html\`<h1>Inside the site layout</h1>\`;
  }
}
`,
  // A guarded page: signed-in holders of a permission only.
  'src/pages/members/index.ts': `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '@cossackframework/cms/app/cms/guards';

@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.dashboard)] })
export default class Members extends Cossack {
  render() {
    return html\`<h1>Members only: \${this.c.get('user')?.email}</h1>\`;
  }
}
`,
  // An API route.
  'src/pages/api/custom/titles.ts': `import type { Context } from 'hono';

export async function GET(c: Context) {
  const posts = await c.get('cms').resource('cms/posts').list({ where: { status: 'published' }, limit: 10 }, { principal: c.get('principal') });
  return c.json({ titles: posts.records.map(record => record.title) });
}
`,
};

describe.skipIf(!liveRomeDBTests())('pages of a CMS project', () => {
  let service;
  beforeAll(async () => { service = await startRomeDBService(); }, 30_000);
  afterAll(async () => { await service?.stop(); });

  it('routes src/pages beside the CMS and gives them the host, the principal and the user', async () => {
    const root = await project('node', ['cms']);
    for (const [file, text] of Object.entries(PAGES)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), text);
    }
    await typecheck(root, 'project pages');
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: service.url, ROMEDB_TOKEN: service.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    try {
      const web = browserless(server.origin, routeIds, () => server.diagnostics());
      expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
      const save = async values => (await web.action(EDITOR, 'save', [values, 'update', 0], { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } }));
      expect((await save(post('Shipped', 'published'))).id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await save(post('Unfinished', 'draft'))).id).toMatch(/^[0-9a-f-]{36}$/);

      // Signed in: the user, and what an administrator may read.
      const signedIn = await web.page('/custom-route');
      contains(signedIn, 'Custom route on Project Pages');
      contains(signedIn, 'Hello, Ada');
      contains(signedIn, 'Shipped');
      contains(signedIn, 'Unfinished');
      contains(await web.page('/members'), 'Members only: ada@example.com');
      expect((await web.action('custom-route/index.ts', 'count', []))._cossack_return).toBe(1);

      // A visitor: the same page, with only what the public may read.
      const visitor = browserless(server.origin, routeIds, () => server.diagnostics());
      const anonymous = await visitor.page('/custom-route');
      contains(anonymous, 'Hello, Guest');
      contains(anonymous, 'Shipped');
      lacks(anonymous, 'Unfinished');
      expect((await visitor.request('/members')).status).toBe(302);
      expect(await (await visitor.request('/api/custom/titles')).json()).toEqual({ titles: ['Shipped'] });

      // Under (site) the theme frames the page; outside it nothing does.
      const inside = await visitor.page('/inside');
      contains(inside, 'Inside the site layout');
      contains(inside, '<footer');
      lacks(anonymous, '<footer');

      // The page owns its address: an entry of that name gets another slug.
      const clash = await web.action(EDITOR, 'save', [{ title: 'Custom route', slug: 'custom-route', excerpt: '', content: [], status: 'draft', publishedAt: '', parent: '' }, 'update', 0],
        { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
      contains(await web.page(`/dashboard/content/pages/${clash.id}`), 'custom-route-2');
    } finally { await server.close(); }
  }, 600_000);
});
