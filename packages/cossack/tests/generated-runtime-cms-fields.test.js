// Field groups in a generated application against a local `romedb serve`: a collection whose
// fields come from a group made for it and a group with a repeater attached to it, in order
// from the collection manager; entries with rows through the content API and its row filter;
// the boxes in the entry and term editors; and the field group editor and repeater rows in
// the browser.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless, contains } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Fields', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const fieldBlock = (id, kind, data, extra = {}) => ({ _id: id, type: `field/${kind}`, data: { label: id, ...data }, ...extra });

const BUILDER = 'dashboard/(cms)/collections/[name]/index.ts';
/** A new group is made on the group editor itself: `save` with an empty ID and the fresh state. */
const newGroup = (web, title, collection) => web.action(GROUP, 'save', [{ id: '', title, description: '', placement: 'main', order: '' }, collection ? [{ kind: 'collection', name: collection, order: 0 }] : [], []], { state: { fresh: true }, params: { id: 'new' } });
const GROUP = 'dashboard/(cms)/field-groups/[id]/index.ts';

/** A Details group with two columns and a Sale tab, made for products, and a Specifications group with a repeater. */
const DETAILS = [
  { _id: 'cols', type: 'core/columns', data: {}, children: [
    { _id: 'c1', type: 'core/column', data: {}, children: [
      fieldBlock('sku', 'text', { name: 'sku', label: 'SKU', unique: true, max: 40 }),
      // A Multiple text: several values of the kind, each checked, indexed as an array.
      fieldBlock('tags', 'text', { name: 'tags', label: 'Tags', multiple: true, max: 10, maxItems: 3, index: true, addLabel: 'Add tag' }),
    ] },
    { _id: 'c2', type: 'core/column', data: {}, children: [fieldBlock('price', 'number', { name: 'price', label: 'Price', min: 0, required: true, index: true })] },
  ] },
  { _id: 'tabs', type: 'core/tabs', data: {}, children: [{ _id: 'sale', type: 'core/tab', data: { label: 'Sale' }, children: [
    fieldBlock('onSale', 'boolean', { name: 'onSale', label: 'On sale' }),
    fieldBlock('salePrice', 'number', { name: 'salePrice', label: 'Sale price', min: 0, required: true }, { when: { rules: [{ field: 'onSale', op: 'is', value: 'true' }] } }),
  ] }] },
];
const SPECS = [
  { _id: 'h', type: 'core/heading', data: { text: 'Specifications' } },
  fieldBlock('specs', 'repeater', { name: 'specs', label: 'Specifications', max: 10, summary: 'name' }, { children: [
    fieldBlock('name', 'text', { name: 'name', label: 'Name', required: true, index: true, search: true, width: 'half' }),
    fieldBlock('kind', 'choice', { name: 'kind', label: 'Kind', choices: ['text', 'link'], width: 'half' }),
    fieldBlock('url', 'text', { name: 'url', label: 'URL' }, { when: { rules: [{ field: 'kind', op: 'is', value: 'link' }] } }),
  ] }),
];
const DRAFT = { name: 'products', label: 'Products', singular: 'Product', description: '', icon: 'box', path: 'shop', public: true, slug: true, publishable: true, hierarchical: false, visibility: 'private', comments: false, taxonomies: ['categories'], builtin: false, content: true, excerpt: false, featuredImage: true, revisions: true, templateLock: '', sitemap: true, password: false, schemaType: 'WebPage', schemaMap: {}, noindex: false, nofollow: false, archiveNoindex: false, seoTitle: '', seoDescription: '', archiveTitle: '' };

/** Set the site up, create the collection, make its Details group from it and attach Specifications in order. */
async function shop(origin, routeIds, diagnostics) {
  const web = browserless(origin, routeIds, diagnostics);
  expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
  const created = await web.action('dashboard/(cms)/collections/new/index.ts', 'create', ['Products', 'Product', 'box']);
  expect(created._cossack_redirect).toBe('/dashboard/collections/products?created=1');
  // A group made from the collection manager is attached to the collection when it is created.
  const details = await newGroup(web, 'Details', 'products');
  expect(details._cossack_redirect).toBe('/dashboard/field-groups/details?created=1');
  const laid = await web.action(GROUP, 'save', [{ id: 'details', title: 'Details', description: '', placement: 'main', order: '' }, [{ kind: 'collection', name: 'products', order: 0 }], DETAILS], { params: { id: 'details' } });
  expect(laid.error).toBe('');
  expect(laid.blocks.map(block => block._id)).toEqual(['cols', 'tabs']);
  const group = await newGroup(web, 'Specifications');
  expect(group._cossack_redirect).toBe('/dashboard/field-groups/specifications?created=1');
  const saved = await web.action(GROUP, 'save', [{ id: 'specifications', title: 'Specifications', description: 'What the product is made of.', placement: 'main', order: '' }, [{ kind: 'collection', name: 'products' }, { kind: 'taxonomy', name: 'categories' }], SPECS], { params: { id: 'specifications' } });
  expect(saved.error).toBe('');
  expect(saved.blocks[1].children.map(block => block.data.name)).toEqual(['name', 'kind', 'url']);
  // The collection manager lists the attached groups in order and saves that order with the features.
  const loaded = await web.action(BUILDER, 'load', ['products'], { params: { name: 'products' } });
  expect(loaded.groups.map(entry => entry.id)).toEqual(['details', 'specifications']);
  expect(loaded.available).toEqual([]);
  const built = await web.action(BUILDER, 'save', [DRAFT, ['specifications', 'details'], []], { params: { name: 'products' } });
  expect(built.error).toBe('');
  expect(built.groups.map(entry => entry.id)).toEqual(['specifications', 'details']);
  const reordered = await web.action(BUILDER, 'save', [DRAFT, ['details', 'specifications'], []], { params: { name: 'products' } });
  expect(reordered.groups.map(entry => entry.id)).toEqual(['details', 'specifications']);
  // Without a stored layout the manager shows the default: one Edit tab with the main boxes, and the sidebar's.
  expect(reordered.layoutStored).toBe(false);
  expect(reordered.layout.tabs.map(tab => tab._id)).toEqual(['edit']);
  expect(reordered.layout.tabs[0].children.map(block => block.data.box)).toEqual(['field:content', 'group:details', 'group:specifications', 'seo']);
  expect(reordered.boxes.map(box => box.id)).toContain('taxonomy:categories');
  // An editor layout: the Details group moves to a Pricing tab; boxes the layout does not name follow on the Edit tab and in the sidebar.
  const laidOut = await web.action(BUILDER, 'save', [DRAFT, ['details', 'specifications'], [], LAYOUT], { params: { name: 'products' } });
  expect(laidOut.error).toBe('');
  expect(laidOut.layoutStored).toBe(true);
  expect(laidOut.layout.tabs.map(tab => [tab._id, tab.data.label])).toEqual([['edit', 'Product'], ['pricing', 'Pricing']]);
  expect(laidOut.layout.tabs[0].children.map(block => block.data.box)).toEqual(['field:content', 'group:specifications', 'seo']);
  expect(laidOut.layout.tabs[1].children.map(block => block.data.box)).toEqual(['group:details']);
  return web;
}

/** The product editor's layout: the content on the Product tab, the Details group on a Pricing tab. */
const LAYOUT = {
  tabs: [
    { _id: 'edit', type: 'editor/tab', data: { label: 'Product', icon: '' }, children: [{ _id: 'content', type: 'editor/box', data: { box: 'field:content' } }] },
    { _id: 'pricing', type: 'editor/tab', data: { label: 'Pricing', icon: 'tag' }, children: [{ _id: 'details', type: 'editor/box', data: { box: 'group:details' } }] },
  ],
  sidebar: [],
};

async function fields(origin, routeIds, diagnostics) {
  const web = await shop(origin, routeIds, diagnostics);
  const json = async (pathname, method, body) => {
    const response = await web.request(pathname, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  // Entries carry the Details fields and the Specifications rows; hidden fields clear; rows get IDs.
  const bad = await json('/api/cms/content/products', 'POST', { title: 'Bad', price: 1, onSale: true });
  expect(bad.status).toBe(422);
  expect(bad.body.fields).toEqual({ salePrice: 'is required.' });
  const tooMany = await json('/api/cms/content/products', 'POST', { title: 'Tagged', price: 1, tags: ['a', 'b', 'c', 'd'] });
  expect(tooMany.status).toBe(422);
  expect(tooMany.body.fields).toEqual({ tags: 'must be a list of at most 3 items.' });
  const tooLong = await json('/api/cms/content/products', 'POST', { title: 'Tagged', price: 1, tags: ['a', 'much too long'] });
  expect(tooLong.body.fields).toEqual({ tags: 'item 2 must be at most 10 characters.' });
  const created = await json('/api/cms/content/products', 'POST', {
    title: 'Rocket skates', status: 'published', sku: 'RS-1', price: 19.5, onSale: false, salePrice: 9, tags: ['fast', 'red'],
    specs: [{ name: 'Weight', kind: 'text', url: 'gone' }, { _id: 'site', name: 'Site', kind: 'link', url: 'https://example.com' }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const item = created.body.item;
  expect(item.salePrice).toBeNull();
  expect(item.tags).toEqual(['fast', 'red']);
  expect(item.specs.map(row => [row._id, row.name, row.url ?? null])).toEqual([[expect.stringMatching(/^[A-Za-z0-9_-]+$/), 'Weight', null], ['site', 'Site', 'https://example.com']]);
  expect(item).not.toHaveProperty('specs__name');
  const other = await json('/api/cms/content/products', 'POST', { title: 'Plain board', status: 'published', sku: 'PB-1', price: 5, specs: [{ name: 'Length', kind: 'text' }] });
  expect(other.status).toBe(201);

  // The list filters on a row field through the array index on its path, and on scalars.
  const weighed = await (await fetch(`${origin}/api/cms/content/products?filter[specs.name]=Weight`)).json();
  expect(weighed.items.map(entry => entry.title)).toEqual(['Rocket skates']);
  const cheap = await (await fetch(`${origin}/api/cms/content/products?filter[price]=5`)).json();
  expect(cheap.items.map(entry => entry.title)).toEqual(['Plain board']);
  const red = await (await fetch(`${origin}/api/cms/content/products?filter[tags]=red`)).json();
  expect(red.items.map(entry => entry.title)).toEqual(['Rocket skates']);
  const nope = await fetch(`${origin}/api/cms/content/products?filter[nope]=1`);
  expect(nope.status).toBe(422);

  // The entry editor shows both boxes; the term editor shows the Specifications box too.
  const editor = await web.page(`/dashboard/content/products/${item.id}`);
  contains(editor, 'Specifications');
  contains(editor, 'What the product is made of.');
  contains(editor, 'Sale price');
  // The layout's tabs: Product and Pricing, then JSON; every tab's boxes are in the page.
  contains(editor, 'entry-tab-pricing');
  contains(editor, 'entry-tab-json');
  contains(editor, 'id=entry-pricing');
  const terms = await (await web.request('/api/cms/content/products')).json();
  expect(terms.total).toBe(2);
  const list = await web.page('/dashboard/field-groups');
  contains(list, 'Specifications');
  contains(list, 'Products, Categories');
  const manager = await web.page('/dashboard/collections/products');
  contains(manager, 'data-group=details');
  contains(manager, 'Content template');
  // Search engines is a tab of its own.
  expect(manager).not.toContain('Structured data type');
  contains(manager, 'collection-tab-seo');
  contains(await web.page('/dashboard/collections/products?tab=seo'), 'Structured data type');
  return { web, item };
}

/** A built Node app on its own database. */
async function nodeApp() {
  const root = await project('node', ['cms']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const database = await startRomeDBService();
  const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
  const server = await productionServer(root, { APP_SECRET: 'generated-cms-test-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token,
    CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
  return { root, server, routeIds, close: async () => { await server.close(); await database.stop(); } };
}

describe.skipIf(!liveRomeDBTests())('generated CMS field groups', () => {
  it('attaches groups from the collection, stores rows and filters on them on Node', async () => {
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
      await browserExpect(picker.getByRole('heading', { name: 'Entry fields' })).toBeVisible();
      await browserExpect(picker.getByRole('heading', { name: 'Widgets' })).toHaveCount(0);
      await picker.getByLabel('Search blocks').fill('yes');
      await picker.getByRole('button', { name: 'Yes / no', exact: true }).click();
      await browserExpect(picker).toBeHidden();
      const added = page.getByRole('region', { name: 'Yes / no 3' });
      // A new block opens its panel at once.
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

      // The collection manager's tabs keep the open one in the address.
      await page.goto(`${origin}/dashboard/collections/products`);
      await ready();
      await page.getByRole('tab', { name: 'Search engines' }).click();
      await browserExpect(page.getByLabel('Structured data type')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('tab')).toBe('seo');

      // The Editor tab: the tabs and the sidebar in one tree; a new Inventory tab, its ID from its label, saved with the collection.
      await page.getByRole('tab', { name: 'Editor', exact: true }).click();
      await browserExpect(page.getByRole('tab', { name: 'Editor', exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(new URL(page.url()).searchParams.get('tab')).toBe('editor');
      await browserExpect(page.locator('[data-box="group:details"]')).toContainText('Pricing');
      // Tabs go at the top level, whose inserter follows the sidebar row.
      await page.getByRole('button', { name: 'Add block', exact: true }).last().click();
      const layoutPicker = page.getByRole('dialog', { name: 'Blocks' });
      await layoutPicker.getByRole('button', { name: 'Tab', exact: true }).click();
      const tabPanel = page.getByRole('dialog', { name: 'Tab' });
      await tabPanel.getByLabel('Label *').fill('Inventory');
      await browserExpect(tabPanel.getByLabel('ID', { exact: true })).toHaveValue('inventory');
      await tabPanel.getByRole('button', { name: 'Done' }).click();
      await browserExpect(tabPanel).toBeHidden();
      // Drag the Specifications meta box from the Product tab into the sidebar, then into Inventory: a meta box's row shows its label.
      const drag = async (handle, target) => {
        const from = await handle.boundingBox();
        const x = from.x + from.width / 2;
        await page.mouse.move(x, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(x, from.y + from.height / 2 + 8, { steps: 2 });
        const to = await target.boundingBox();
        await page.mouse.move(x, to.y + to.height * 0.75, { steps: 10 });
        await page.mouse.up();
      };
      // The whole tree in view for the drags; the edge scrolling is checked after them.
      await page.setViewportSize({ width: 1280, height: 1800 });
      const productTab = page.getByRole('region', { name: 'Tab 1' });
      const specsRow = productTab.getByRole('region', { name: 'Meta box 2', exact: true });
      await browserExpect(specsRow).toContainText('Specifications');
      const sidebarRow = page.getByRole('region', { name: /^Sidebar \d+$/ });
      await drag(specsRow.locator('[data-handle]'), sidebarRow.locator('header').first());
      await browserExpect(page.locator('[data-box="group:specifications"]')).toContainText('Sidebar');
      await browserExpect(sidebarRow.getByRole('region', { name: 'Meta box 1', exact: true })).toContainText('Specifications');
      const inventoryTab = page.getByRole('region', { name: 'Tab 3' });
      await drag(sidebarRow.getByRole('region', { name: 'Meta box 1', exact: true }).locator('[data-handle]'), inventoryTab.locator('header').first());
      await browserExpect(page.locator('[data-box="group:specifications"]')).toContainText('Inventory');
      await browserExpect(inventoryTab.getByRole('region', { name: 'Meta box 1', exact: true })).toContainText('Specifications');
      // Near the window's bottom a drag scrolls the page; Escape cancels it, and the layout stays.
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const contentHandle = productTab.getByRole('region', { name: 'Meta box 1', exact: true }).locator('[data-handle]');
      const start = await contentHandle.boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(start.x + start.width / 2, 715, { steps: 6 });
      await page.waitForFunction(() => window.scrollY > 50);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await browserExpect(page.locator('[data-box="field:content"]')).toContainText('Product');
      await browserExpect(productTab.getByRole('region', { name: 'Meta box 1', exact: true })).toContainText('Content');
      // Every meta box is placed, so a new one has none to offer; it is removed again.
      await inventoryTab.getByRole('button', { name: 'Add block', exact: true }).click();
      await layoutPicker.getByRole('button', { name: 'Meta box', exact: true }).click();
      const boxPanel = page.getByRole('dialog', { name: 'Meta box' });
      await browserExpect(boxPanel).toContainText('Every meta box is placed.');
      await boxPanel.getByRole('button', { name: 'Done' }).click();
      await browserExpect(boxPanel).toBeHidden();
      await inventoryTab.getByRole('region', { name: 'Meta box 2', exact: true }).getByRole('button', { name: 'Remove Meta box' }).click();
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await browserExpect(inventoryTab.getByRole('region', { name: 'Meta box 2', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Save collection' }).click();
      await browserExpect(page.getByText('Collection saved.').first()).toBeVisible();

      // The product editor: the Details group on the Pricing tab, and a refused save opens the tab that holds the error.
      await page.goto(`${origin}/dashboard/content/products/${item.id}`);
      await ready();
      await browserExpect(page.getByRole('tab', { name: 'Inventory' })).toBeVisible();
      // A tab's icon shows before its label.
      await browserExpect(page.getByRole('tab', { name: 'Pricing' }).locator('svg')).toHaveCount(1);
      await browserExpect(page.getByLabel('Price *')).toBeHidden();
      await page.getByRole('tab', { name: 'Pricing' }).click();
      expect(new URL(page.url()).searchParams.get('tab')).toBe('pricing');
      // An empty required field is left out of an update; a price below the minimum is refused.
      await page.getByLabel('Price *').fill('-1');
      await page.getByRole('tab', { name: 'Product', exact: true }).click();
      await browserExpect(page.getByLabel('Price *')).toBeHidden();
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await browserExpect(page.getByRole('tab', { name: /^Pricing/ })).toHaveAttribute('aria-selected', 'true');
      await browserExpect(page.getByLabel('Price *')).toBeVisible();
      await page.getByLabel('Price *').fill('19.5');
      // The Sale tab inside the group, the condition on the sale price, and a new repeater row.
      await browserExpect(page.getByLabel('Sale price')).toBeHidden();
      await page.getByRole('tab', { name: 'Sale' }).click();
      await page.getByLabel('On sale').check();
      await browserExpect(page.getByLabel('Sale price')).toBeVisible();
      await page.getByLabel('Sale price').fill('12');
      // The Multiple text: one input per value, Add tag within the most values, Move up and Remove.
      const tags = page.locator('[data-cms-multiple="tags"]');
      await browserExpect(tags.locator('input')).toHaveCount(2);
      await tags.getByRole('button', { name: 'Add tag' }).click();
      await tags.locator('input').nth(2).fill('blue');
      await browserExpect(tags.getByRole('button', { name: 'Add tag' })).toBeDisabled();
      await tags.getByRole('button', { name: 'Move up Tags 3' }).click();
      await tags.getByRole('button', { name: 'Remove Tags 1' }).click();
      await browserExpect(tags.locator('input')).toHaveCount(2);
      await page.getByRole('tab', { name: 'Inventory' }).click();
      expect(new URL(page.url()).searchParams.get('tab')).toBe('inventory');
      const specs = page.getByRole('group', { name: 'Specifications' });
      await browserExpect(specs.getByRole('region', { name: 'Specifications 1' })).toContainText('Weight');
      await specs.getByRole('button', { name: 'Add specifications' }).click();
      const row = specs.getByRole('region', { name: 'Specifications 3' });
      await row.getByLabel('Name *').fill('Color');
      await browserExpect(row.getByLabel('URL')).toBeHidden();
      await row.getByLabel('Kind').selectOption('link');
      await browserExpect(row.getByLabel('URL')).toBeVisible();
      await row.getByLabel('URL').fill('https://example.com/color');
      await browserExpect(row).toContainText('Color');
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await browserExpect(page.getByText('Saved.').first()).toBeVisible();
      const saved = await (await web.request(`/api/cms/content/products/${item.id}`)).json();
      expect(saved.item.salePrice).toBe(12);
      expect(saved.item.tags).toEqual(['blue', 'red']);
      expect(saved.item.specs.map(entry => [entry.name, entry.url ?? null])).toEqual([['Weight', null], ['Site', 'https://example.com'], ['Color', 'https://example.com/color']]);
      expect(saved.item.fragile).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await app.close();
    }
  }, 600_000);
});
