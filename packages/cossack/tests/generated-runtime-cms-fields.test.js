// Field groups in a generated application against a local `fastdb serve`: a collection laid
// out in the builder, a field group with a repeater attached to it, entries with rows through
// the content API and its row filter, the boxes in the entry and term editors, and the
// field group editor and repeater rows in the browser.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless, contains } from './fixtures/cms-client.js';
import { liveFastDBTests, startFastDBService } from '../../fastdb/src/testing.ts';

afterEach(cleanupRoots);

const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Fields', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const fieldBlock = (id, kind, data, extra = {}) => ({ id, type: `field/${kind}`, data: { label: id, ...data }, ...extra });

const BUILDER = 'dashboard/(cms)/collections/[name]/index.ts';
const GROUPS = 'dashboard/(cms)/field-groups/new/index.ts';
const GROUP = 'dashboard/(cms)/field-groups/[id]/index.ts';

/** A products collection with two columns and a Sale tab, and a Specifications group with a repeater. */
const LAYOUT = [
  { id: 'cols', type: 'core/columns', data: {}, children: [
    { id: 'c1', type: 'core/column', data: {}, children: [fieldBlock('sku', 'text', { name: 'sku', label: 'SKU', unique: true, max: 40 })] },
    { id: 'c2', type: 'core/column', data: {}, children: [fieldBlock('price', 'number', { name: 'price', label: 'Price', min: 0, required: true, index: true })] },
  ] },
  { id: 'tabs', type: 'core/tabs', data: {}, children: [{ id: 'sale', type: 'core/tab', data: { label: 'Sale' }, children: [
    fieldBlock('onSale', 'boolean', { name: 'onSale', label: 'On sale' }),
    fieldBlock('salePrice', 'number', { name: 'salePrice', label: 'Sale price', min: 0, required: true }, { when: { rules: [{ field: 'onSale', op: 'is', value: 'true' }] } }),
  ] }] },
];
const SPECS = [
  { id: 'h', type: 'core/heading', data: { text: 'Specifications' } },
  fieldBlock('specs', 'repeater', { name: 'specs', label: 'Specifications', max: 10, summary: 'name' }, { children: [
    fieldBlock('name', 'text', { name: 'name', label: 'Name', required: true, index: true, search: true, width: 'half' }),
    fieldBlock('kind', 'choice', { name: 'kind', label: 'Kind', choices: ['text', 'link'], width: 'half' }),
    fieldBlock('url', 'text', { name: 'url', label: 'URL' }, { when: { rules: [{ field: 'kind', op: 'is', value: 'link' }] } }),
  ] }),
];
const DRAFT = { name: 'products', label: 'Products', singular: 'Product', description: '', icon: 'box', path: 'shop', public: true, slug: true, publishable: true, hierarchical: false, visibility: 'private', comments: false, taxonomies: ['categories'], builtin: false, templateLock: '' };

/** Set the site up, build the collection and attach the group. */
async function shop(origin, routeIds, diagnostics) {
  const web = browserless(origin, routeIds, diagnostics);
  expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
  const created = await web.action('dashboard/(cms)/collections/new/index.ts', 'create', ['Products', 'Product', 'box']);
  expect(created._cossack_redirect).toBe('/dashboard/collections/products?created=1');
  const built = await web.action(BUILDER, 'save', [DRAFT, LAYOUT, []], { params: { name: 'products' } });
  expect(built.error).toBe('');
  expect(built.layout.map(block => block.id)).toEqual(['cols', 'tabs']);
  const group = await web.action(GROUPS, 'create', ['Specifications']);
  expect(group._cossack_redirect).toBe('/dashboard/field-groups/specifications?created=1');
  const saved = await web.action(GROUP, 'save', [{ id: 'specifications', title: 'Specifications', description: 'What the product is made of.', placement: 'main', order: '' }, [{ kind: 'collection', name: 'products' }, { kind: 'taxonomy', name: 'categories' }], SPECS], { params: { id: 'specifications' } });
  expect(saved.error).toBe('');
  expect(saved.blocks[1].children.map(block => block.data.name)).toEqual(['name', 'kind', 'url']);
  return web;
}

async function fields(origin, routeIds, diagnostics) {
  const web = await shop(origin, routeIds, diagnostics);
  const json = async (pathname, method, body) => {
    const response = await web.request(pathname, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  // Entries carry the layout's fields and the group's rows; hidden fields clear; rows get IDs.
  const bad = await json('/api/cms/content/products', 'POST', { title: 'Bad', price: 1, onSale: true });
  expect(bad.status).toBe(422);
  expect(bad.body.fields).toEqual({ salePrice: 'is required.' });
  const created = await json('/api/cms/content/products', 'POST', {
    title: 'Rocket skates', status: 'published', sku: 'RS-1', price: 19.5, onSale: false, salePrice: 9,
    specs: [{ name: 'Weight', kind: 'text', url: 'gone' }, { _id: 'site', name: 'Site', kind: 'link', url: 'https://example.com' }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const item = created.body.item;
  expect(item.salePrice).toBeNull();
  expect(item.specs.map(row => [row._id, row.name, row.url ?? null])).toEqual([[expect.stringMatching(/^[A-Za-z0-9_-]+$/), 'Weight', null], ['site', 'Site', 'https://example.com']]);
  expect(item).not.toHaveProperty('specs__name');
  const other = await json('/api/cms/content/products', 'POST', { title: 'Plain board', status: 'published', sku: 'PB-1', price: 5, specs: [{ name: 'Length', kind: 'text' }] });
  expect(other.status).toBe(201);

  // The list filters on a row field through the derived index, and on scalars.
  const weighed = await (await fetch(`${origin}/api/cms/content/products?filter[specs.name]=Weight`)).json();
  expect(weighed.items.map(entry => entry.title)).toEqual(['Rocket skates']);
  const cheap = await (await fetch(`${origin}/api/cms/content/products?filter[price]=5`)).json();
  expect(cheap.items.map(entry => entry.title)).toEqual(['Plain board']);
  const nope = await fetch(`${origin}/api/cms/content/products?filter[nope]=1`);
  expect(nope.status).toBe(422);

  // The entry editor shows the layout and the group's box; the term editor shows the box too.
  const editor = await web.page(`/dashboard/content/products/${item.id}`);
  contains(editor, 'Specifications');
  contains(editor, 'What the product is made of.');
  contains(editor, 'Sale price');
  const terms = await (await web.request('/api/cms/content/products')).json();
  expect(terms.total).toBe(2);
  const list = await web.page('/dashboard/field-groups');
  contains(list, 'Specifications');
  contains(list, 'Products, Categories');
  return { web, item };
}

/** A built Node app on its own database. */
async function nodeApp() {
  const root = await project('node', ['cms']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const database = await startFastDBService();
  const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
  const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', FASTDB_URL: database.url, FASTDB_TOKEN: database.token,
    CMS_SETUP_CODE: 'setup-code-for-tests', FASTDB_PENDING_DIR: path.join(root, '.cossack/fastdb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
  return { root, server, routeIds, close: async () => { await server.close(); await database.stop(); } };
}

describe.skipIf(!liveFastDBTests())('generated CMS field groups', () => {
  it('lays collections out, attaches groups, stores rows and filters on them on Node', async () => {
    const app = await nodeApp();
    try {
      await fields(app.server.origin, app.routeIds, () => app.server.diagnostics());
    } finally { await app.close(); }
  }, 600_000);

  it('edits field groups and repeater rows in the browser', async () => {
    const app = await nodeApp();
    let browser;
    try {
      const origin = app.server.origin;
      const { web, item } = await fields(origin, app.routeIds, () => app.server.diagnostics());
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: origin })));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const ready = () => page.waitForFunction(() => window.__cossackReady === true);

      // The field group editor: a new field from the Fields category, named from its label, with a condition.
      await page.goto(`${origin}/dashboard/field-groups/specifications`);
      await ready();
      await page.getByRole('button', { name: 'Add block', exact: true }).last().click();
      const picker = page.getByRole('dialog', { name: 'Blocks' });
      await browserExpect(picker.getByRole('heading', { name: 'Fields' })).toBeVisible();
      await browserExpect(picker.getByRole('heading', { name: 'Widgets' })).toHaveCount(0);
      await picker.getByLabel('Search blocks').fill('yes');
      await picker.getByRole('button', { name: 'Yes / no', exact: true }).click();
      await browserExpect(picker).toBeHidden();
      const added = page.getByRole('region', { name: 'Yes / no 3' });
      await added.getByRole('button', { name: 'Edit Yes / no' }).click();
      const panel = page.getByRole('dialog', { name: 'Yes / no' });
      await panel.getByLabel('Label *').fill('Fragile');
      await panel.getByLabel('Conditional logic').check();
      await panel.getByLabel('Field', { exact: true }).selectOption('status');
      await panel.getByLabel('Value', { exact: true }).fill('published');
      await panel.getByRole('button', { name: 'Done' }).click();
      await browserExpect(panel).toBeHidden();
      await browserExpect(added.getByText('fragile', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Save field group' }).click();
      await browserExpect(page.getByText('Field group saved.').first()).toBeVisible();

      // The product editor: the Sale tab, the condition on the sale price, and a new repeater row.
      await page.goto(`${origin}/dashboard/content/products/${item.id}`);
      await ready();
      await browserExpect(page.getByLabel('Sale price')).toBeHidden();
      await page.getByRole('tab', { name: 'Sale' }).click();
      await page.getByLabel('On sale').check();
      await browserExpect(page.getByLabel('Sale price')).toBeVisible();
      await page.getByLabel('Sale price').fill('12');
      const specs = page.getByRole('group', { name: 'Specifications' });
      await browserExpect(specs.getByRole('region', { name: 'Specifications 1' })).toContainText('Weight');
      await specs.getByRole('button', { name: 'Add specifications' }).click();
      const row = specs.getByRole('region', { name: 'Specifications 3' });
      await row.getByLabel('Name *').fill('Colour');
      await browserExpect(row.getByLabel('URL')).toBeHidden();
      await row.getByLabel('Kind').selectOption('link');
      await browserExpect(row.getByLabel('URL')).toBeVisible();
      await row.getByLabel('URL').fill('https://example.com/colour');
      await browserExpect(row).toContainText('Colour');
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await browserExpect(page.getByText('Saved.').first()).toBeVisible();
      const saved = await (await web.request(`/api/cms/content/products/${item.id}`)).json();
      expect(saved.item.salePrice).toBe(12);
      expect(saved.item.specs.map(entry => [entry.name, entry.url ?? null])).toEqual([['Weight', null], ['Site', 'https://example.com'], ['Colour', 'https://example.com/colour']]);
      expect(saved.item.fragile).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await app.close();
    }
  }, 600_000);
});
