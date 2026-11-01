// Settings through a generated, built application: declaration-only plugin forms, scoped
// runtime reads, atomic JSON patches and browser drafts shared across Settings routes.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, cossack, productionServer, project, typecheck, vite } from './fixtures/generated-app.js';
import { browserless, PNG } from './fixtures/cms-client.js';
import { connect } from '../../romedb/src/client.ts';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const SETTINGS_PAGE = 'dashboard/(cms)/settings/index.ts';
const JSON_PAGE = 'dashboard/(cms)/settings/json/index.ts';

async function writeSettingsPlugin(root, name, label) {
  const directory = path.join(root, 'src/plugins', name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify({
    schemaVersion: 1, name, version: '1.0.0',
    settings: {
      label, description: `${label} delivery configuration.`,
      sections: [{ id: 'delivery', label: 'Delivery' }],
      fields: {
        senderName: { kind: 'string', label: 'Sender name', description: 'The name shown to recipients.', default: 'Original sender', max: 120, section: 'delivery' },
        enabled: { kind: 'boolean', label: 'Enable delivery', description: 'Turn delivery on for this plugin.', default: false, section: 'delivery' },
        retryLimit: { kind: 'integer', label: 'Retry limit', min: 0, max: 10, default: 3, section: 'delivery' },
        accentColor: { kind: 'string', control: 'color', label: 'Accent color', default: '#336699' },
        brandAsset: { kind: 'string', control: 'file', fileKinds: ['image'], label: 'Brand asset', default: '' },
        optionalText: { kind: 'string', label: 'Optional text', nullable: true, default: null },
        optionalNumber: { kind: 'number', label: 'Optional number', nullable: true, default: null },
        optionalChoice: { kind: 'enum', label: 'Optional choice', values: ['first', 'second'], nullable: true, default: null },
        optionalBoolean: { kind: 'boolean', label: 'Optional boolean', nullable: true, default: null },
      },
    },
    commands: [{ name: 'read-settings', description: 'Read this plugin settings.' }],
  }, null, 2));
  await fs.writeFile(path.join(directory, 'server.ts'), `import type { PluginContext } from '@cossackframework/cms/server';
export function register(context: PluginContext) {
    context.commands.add('read-settings', async () => ({
        senderName: await context.settings.get('senderName'),
        values: await context.settings.all(),
    }));
}
`);
}

const returned = response => response._cossack_return;

// CodeMirror virtualizes lines outside the viewport. Inspect its document, rather than
// asserting against only the rendered lines (the same lookup as EditorView.findFromDOM).
const editorText = editor => editor.evaluate(content => content.cmTile.root.view.state.doc.toString());
async function replaceEditor(tab, editor, text) {
  await editor.focus();
  await editor.press('ControlOrMeta+A');
  await tab.keyboard.insertText(text);
}

describe.skipIf(!liveRomeDBTests())('CMS unified settings', () => {
  it('loads settings sections on demand, filters the menu and fields, and keeps drafts through JSON saves', async () => {
    const root = await project('node', ['cms']);
    await writeSettingsPlugin(root, 'newsletter', 'Newsletter');
    await writeSettingsPlugin(root, 'receipts', 'Receipts');
    await cossack(root, ['plugins', 'check', '--json']);
    await cossack(root, ['config', '--generate']);
    await typecheck(root, 'unified CMS settings application');
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);

    const database = await startRomeDBService();
    const server = await productionServer(root, {
      APP_SECRET: 'cms-settings-test-secret-0123456789abcdef',
      ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token, CMS_SETUP_CODE: 'setup',
      ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'),
    });
    let browser;
    let storage;
    let tab;
    const errors = [];
    try {
      storage = await connect({ url: database.url, token: database.token });
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      const web = browserless(server.origin, routeIds, () => server.diagnostics());
      const visitor = browserless(server.origin, routeIds);
      await web.post('/auth/setup', { code: 'setup', siteTitle: 'Settings test', name: 'Ada', email: 'ada@example.com', password: 'long password' });
      const command = () => web.request('/api/cms/commands/newsletter/read-settings', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: {} }),
      });
      const saved = async () => JSON.parse(returned(await web.action(JSON_PAGE, 'download', [])));

      const pluginsPage = await web.page('/dashboard/settings');
      expect(pluginsPage).toContain('Newsletter');
      expect(pluginsPage).toContain('Receipts');
      expect((await command()).status).not.toBe(200);
      expect(returned(await web.action(SETTINGS_PAGE, 'save', [{ 'plugin:newsletter': { senderName: 'Configured while disabled' } }])).error).toBe('');
      expect((await saved())['plugin:newsletter'].senderName).toBe('Configured while disabled');
      expect((await command()).status).not.toBe(200);

      await web.post('/dashboard/plugins', { plugin: 'newsletter', _action: 'grant' });
      const read = await command();
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ result: { senderName: 'Configured while disabled', values: { enabled: false, retryLimit: 3 } } });

      // One invalid field refuses the entire patch, including otherwise valid built-in edits.
      const invalid = returned(await web.action(JSON_PAGE, 'apply', [{ general: { siteTitle: 'Must not be saved' }, 'plugin:newsletter': { retryLimit: 11 } }]));
      expect(invalid.error).toBeTruthy();
      expect(invalid.fields).toHaveProperty('plugin:newsletter.retryLimit');
      expect((await saved()).general.siteTitle).toBe('Settings test');
      for (const text of [
        '{"general":{"siteTitle":"A","siteTitle":"B"}}',
        '{"plugin:newsletter":{"enabled":{"nested":true}}}',
        '{"appearance":{"theme":"default-theme"}}',
        '{"languages":{"default":"fr"}}',
        '{"plugin:newsletter":{"unknown":true}}',
      ]) expect(returned(await web.action(JSON_PAGE, 'preview', [text])).error, text).toBeTruthy();
      expect((await saved()).general.siteTitle).toBe('Settings test');
      await expect(visitor.action(SETTINGS_PAGE, 'save', [{ general: { siteTitle: 'Anonymous edit' } }])).rejects.toThrow();
      await expect(visitor.action(JSON_PAGE, 'download', [])).rejects.toThrow();
      await expect(visitor.action(JSON_PAGE, 'apply', [{ general: { siteTitle: 'Anonymous edit' } }])).rejects.toThrow();

      // The settings catalog is one scrolling page. Only visible sections create
      // their controls, while the full catalog remains available to the menu/search.
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: server.origin })));
      tab = await context.newPage();
      const documentNavigations = [];
      tab.on('request', request => { if (request.resourceType() === 'document') documentNavigations.push(request.url()); });
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await tab.goto(server.origin + '/dashboard/settings');
      const menu = tab.getByRole('navigation', { name: 'Settings', exact: true });
      const search = tab.getByRole('searchbox', { name: 'Search settings', exact: true });
      const jsonButton = tab.getByRole('link', { name: 'Edit settings JSON', exact: true });
      const toolbar = tab.locator('[data-settings-toolbar]');
      const saveChanges = toolbar.getByRole('button', { name: 'Save changes', exact: true });
      const section = id => tab.locator(`[data-settings-section="${id}"]`);
      const menuLink = id => menu.locator(`[data-settings-menu-group="${id}"]`);
      const openGroup = async id => {
        await menuLink(id).click();
        await browserExpect(section(id)).toHaveAttribute('data-settings-loaded', 'true');
      };
      const newsletter = tab.locator('[data-plugin-settings="newsletter"]');
      const receipts = tab.locator('[data-plugin-settings="receipts"]');
      await browserExpect(tab.getByLabel('Site title', { exact: true })).toHaveValue('Settings test');
      await browserExpect(search).toHaveCount(1);
      await browserExpect(saveChanges).toBeDisabled();
      await browserExpect(tab.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
      await browserExpect(jsonButton.locator('svg')).toHaveCount(1);
      await browserExpect(tab.getByLabel('Settings search results', { exact: true })).toHaveCount(0);
      await browserExpect(menu.getByRole('link', { name: 'JSON', exact: true })).toHaveCount(0);
      await browserExpect(menu.locator('[data-settings-menu-parent="plugins"] [data-settings-menu-group="plugin:newsletter"]')).toBeVisible();
      await browserExpect(menu.locator('[data-settings-menu-parent="plugins"] [data-settings-menu-group="plugin:receipts"]')).toBeVisible();
      await browserExpect(section('plugin:newsletter')).toHaveAttribute('data-settings-loaded', 'false');
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toHaveCount(0);
      const totalSections = await tab.locator('[data-settings-section]').count();
      expect(await tab.locator('[data-settings-loaded="true"]').count()).toBeLessThan(totalSections);
      await tab.screenshot({ path: '/tmp/cossack-settings-unified.png', animations: 'disabled' });

      // Scrolling mounts deferred sections without visiting another route.
      await section('plugin:receipts').scrollIntoViewIfNeeded();
      await browserExpect(section('plugin:receipts')).toHaveAttribute('data-settings-loaded', 'true');
      await browserExpect(receipts.getByLabel('Sender name', { exact: true })).toHaveValue('Original sender');
      await browserExpect.poll(() => tab.evaluate(() => window.scrollY)).toBeGreaterThan(300);
      await browserExpect(search).toBeInViewport();
      await browserExpect(saveChanges).toBeInViewport();
      await browserExpect(menuLink('general')).toBeInViewport();

      // Ordinary scrolling updates the menu in both directions without route navigation.
      const beforeScroll = tab.url();
      await section('plugin:receipts').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await browserExpect(menuLink('plugin:receipts')).toHaveAttribute('aria-current', 'location');
      await section('general').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await browserExpect(menuLink('general')).toHaveAttribute('aria-current', 'location');
      expect(tab.url()).toBe(beforeScroll);
      await openGroup('plugin:newsletter');
      await browserExpect(menuLink('plugin:newsletter')).toHaveAttribute('aria-current', 'location');
      await browserExpect(section('languages')).toHaveAttribute('data-settings-loaded', 'true');
      await browserExpect(section('permalinks')).toHaveAttribute('data-settings-loaded', 'true');
      await browserExpect.poll(async () => {
        const heading = await section('plugin:newsletter').boundingBox();
        const bar = await toolbar.boundingBox();
        const gap = heading.y - bar.y - bar.height;
        return gap >= 0 && gap <= 32;
      }).toBe(true);
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toHaveValue('Configured while disabled');
      expect(new URL(tab.url()).pathname).toBe('/dashboard/settings');
      expect(await tab.locator('[id^="setting-"]').evaluateAll(elements => {
        const ids = elements.map(element => element.id);
        return ids.length === new Set(ids).size;
      })).toBe(true);
      await newsletter.getByLabel('Sender name', { exact: true }).fill('Browser draft');
      await browserExpect(saveChanges).toBeEnabled();

      // Rich controls edit the same scalar draft as JSON. Uploading creates a library
      // file immediately, while attaching its URL to settings still requires Save.
      const color = newsletter.getByLabel('Accent color', { exact: true });
      const colorPicker = newsletter.getByLabel('Choose color: Accent color', { exact: true });
      const asset = newsletter.getByLabel('Brand asset', { exact: true });
      await browserExpect(color).toHaveValue('#336699');
      await browserExpect(colorPicker).toHaveAttribute('type', 'color');
      await colorPicker.evaluate(input => {
        input.value = '#663399';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await browserExpect(color).toHaveValue('#663399');
      await color.fill('#663399cc');
      await newsletter.getByLabel('Upload file: Brand asset', { exact: true }).setInputFiles({ name: 'settings-logo.png', mimeType: 'image/png', buffer: PNG });
      await browserExpect(asset).toHaveValue(/\/media\/.+\/settings-logo\.png$/);
      const assetUrl = await asset.inputValue();
      expect((await saved())['plugin:newsletter']).toMatchObject({ accentColor: '#336699', brandAsset: '' });
      expect((await fetch(server.origin + assetUrl)).status).toBe(200);
      await newsletter.getByRole('button', { name: 'Clear file: Brand asset', exact: true }).click();
      await browserExpect(asset).toHaveValue('');
      await newsletter.getByRole('button', { name: 'Choose file', exact: true }).click();
      const chooser = tab.getByRole('dialog', { name: 'Choose media', exact: true });
      await browserExpect(chooser.getByLabel('Media type', { exact: true })).toHaveValue('image');
      await chooser.getByRole('button', { name: /settings-logo/ }).click();
      await browserExpect(asset).toHaveValue(assetUrl);
      await browserExpect(saveChanges).toBeInViewport();

      // Search filters the sidebar and rendered fields, with per-group and parent totals.
      await search.fill('sender name');
      await browserExpect(menuLink('general')).toHaveCount(0);
      await browserExpect(menuLink('plugins')).toHaveAttribute('data-settings-count', '2');
      await browserExpect(menuLink('plugin:newsletter')).toHaveAttribute('data-settings-count', '1');
      await browserExpect(menuLink('plugin:receipts')).toHaveAttribute('data-settings-count', '1');
      await browserExpect(newsletter.getByLabel('Retry limit', { exact: true })).toHaveCount(0);
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toHaveValue('Browser draft');
      await menuLink('plugin:receipts').click();
      await browserExpect(search).toHaveValue('sender name');
      await browserExpect(receipts.getByLabel('Sender name', { exact: true })).toBeVisible();
      await tab.screenshot({ path: '/tmp/cossack-settings-search.png', animations: 'disabled' });
      await search.fill('newsletter sender name');
      await browserExpect(menuLink('plugins')).toHaveAttribute('data-settings-count', '1');
      await browserExpect(menuLink('plugin:receipts')).toHaveCount(0);
      await browserExpect(receipts).toHaveCount(0);
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toHaveValue('Browser draft');
      await search.fill('general.siteTitle');
      await browserExpect(menuLink('general')).toHaveAttribute('data-settings-count', '1');
      await browserExpect(menuLink('plugins')).toHaveCount(0);
      await menuLink('general').focus();
      await menuLink('general').press('Enter');
      await browserExpect(tab.getByLabel('Site title', { exact: true })).toBeVisible();
      await tab.getByLabel('Site title', { exact: true }).fill('Search draft title');
      await browserExpect(search).toHaveValue('general.siteTitle');

      await search.fill('AI training');
      await browserExpect(menuLink('seo')).toHaveAttribute('data-settings-count', '1');
      await browserExpect(menuLink('crawlers')).toHaveAttribute('data-settings-count', '1');
      await openGroup('crawlers');
      await browserExpect(tab.getByLabel('AI training', { exact: true })).toBeVisible();
      await search.fill('Default language');
      await openGroup('languages');
      await browserExpect(tab.getByLabel('Default language', { exact: true })).toBeVisible();
      await tab.getByLabel('Default language', { exact: true }).selectOption('fr');
      await search.fill('Post permalinks');
      await openGroup('permalinks');
      await browserExpect(tab.getByRole('group', { name: 'Post permalinks', exact: true })).toBeVisible();
      const postsAtRoot = await tab.getByRole('radio', { name: /^Post name/ }).isChecked();
      if (postsAtRoot) await tab.getByRole('radio', { name: /^Under a base/ }).check();
      const originalPostsBase = await tab.getByLabel('Posts base', { exact: true }).inputValue();
      await tab.getByLabel('Posts base', { exact: true }).fill('settings-test-posts');
      await search.fill('Default language');
      await openGroup('languages');
      await browserExpect(tab.getByLabel('Default language', { exact: true })).toHaveValue('fr');
      await tab.getByRole('button', { name: 'Save languages', exact: true }).click();
      await browserExpect(tab.getByText('Languages saved.', { exact: true })).toBeVisible();
      await browserExpect(tab.getByRole('button', { name: 'Save languages', exact: true })).toBeDisabled();
      await tab.getByLabel('Default language', { exact: true }).selectOption('en');
      await tab.getByRole('button', { name: 'Save languages', exact: true }).click();
      await browserExpect(tab.getByRole('button', { name: 'Save languages', exact: true })).toBeDisabled();
      await search.fill('Posts base');
      await openGroup('permalinks');
      await browserExpect(tab.getByLabel('Posts base', { exact: true })).toHaveValue('settings-test-posts');
      await tab.getByRole('button', { name: 'Save permalinks', exact: true }).click();
      await browserExpect(tab.getByText('Permalink structure updated.', { exact: true })).toBeVisible();
      await browserExpect(tab.getByRole('button', { name: 'Save permalinks', exact: true })).toBeDisabled();
      await tab.getByLabel('Posts base', { exact: true }).fill(originalPostsBase);
      if (postsAtRoot) await tab.getByRole('radio', { name: /^Post name/ }).check();
      await tab.getByRole('button', { name: 'Save permalinks', exact: true }).click();
      await browserExpect(tab.getByRole('button', { name: 'Save permalinks', exact: true })).toBeDisabled();

      await search.fill('no-match-723bab05');
      await browserExpect(menu.locator('[data-settings-menu-group]')).toHaveCount(0);
      await browserExpect(tab.getByText('No settings match your search.', { exact: true }).first()).toBeVisible();
      expect((await menu.boundingBox()).height).toBeGreaterThanOrEqual(600);
      await search.press('Escape');
      await browserExpect(search).toHaveValue('');
      await openGroup('plugin:newsletter');
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toHaveValue('Browser draft');
      expect(documentNavigations).toHaveLength(1);
      expect((await saved()).general.siteTitle).toBe('Settings test');

      // Keep mobile checks in a compact-sidebar session, separate from the desktop draft.
      const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await mobileContext.addCookies([
          ...[...web.jar].map(([name, value]) => ({ name, value, url: server.origin })),
          { name: 'cs-sidebar-collapsed', value: 'true', url: server.origin },
        ]);
        const mobile = await mobileContext.newPage();
        mobile.on('pageerror', error => errors.push(error.message));
        mobile.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await mobile.goto(server.origin + '/dashboard/settings');
        const mobileSearch = mobile.getByRole('searchbox', { name: 'Search settings', exact: true });
        const mobileJson = mobile.getByRole('link', { name: 'Edit settings JSON', exact: true });
        await mobileSearch.fill('general.siteTitle');
        const mobileMenu = mobile.getByRole('navigation', { name: 'Settings', exact: true });
        await mobileMenu.locator('[data-settings-menu-group="general"]').click();
        await browserExpect(mobile.getByLabel('Site title', { exact: true })).toBeVisible();
        const searchBox = await mobileSearch.boundingBox();
        const codeBox = await mobileJson.boundingBox();
        expect(searchBox.width).toBeGreaterThanOrEqual(160);
        expect(codeBox.x).toBeGreaterThanOrEqual(0);
        expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(390);
        const mobileToolbar = mobile.locator('[data-settings-toolbar]');
        await browserExpect(mobileToolbar.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
        await browserExpect(mobile.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
        await mobile.screenshot({ path: '/tmp/cossack-settings-search-mobile.png', animations: 'disabled' });
        await mobileJson.click();
        await browserExpect(mobile).toHaveURL(server.origin + '/dashboard/settings/json');
      } finally { await mobileContext.close(); }

      await jsonButton.click();
      await browserExpect(tab).toHaveURL(server.origin + '/dashboard/settings/json');
      await browserExpect(jsonButton).toHaveAttribute('aria-current', 'page');
      await browserExpect(toolbar.getByRole('button', { name: 'Preview changes', exact: true })).toBeInViewport();
      await browserExpect(tab.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
      const editor = tab.locator('[data-language="json"] .cm-content').first();
      await browserExpect.poll(() => editorText(editor)).toContain('Browser draft');
      await browserExpect.poll(() => editorText(editor)).toContain('Search draft title');
      await browserExpect.poll(() => editorText(editor)).toContain('#663399cc');
      await browserExpect.poll(() => editorText(editor)).toContain(assetUrl);
      await tab.screenshot({ path: '/tmp/cossack-settings-json.png', animations: 'disabled' });
      expect((await saved())['plugin:newsletter'].senderName).toBe('Configured while disabled');
      await openGroup('plugin:newsletter');
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toHaveValue('Browser draft');

      // A filtered-out edit must remain part of the shared save.
      await search.fill('Receipts');
      await browserExpect(newsletter).toHaveCount(0);
      await tab.getByRole('button', { name: 'Save changes', exact: true }).click();
      await browserExpect.poll(async () => (await saved())['plugin:newsletter'].senderName).toBe('Browser draft');
      expect((await saved()).general.siteTitle).toBe('Search draft title');
      expect((await saved())['plugin:newsletter']).toMatchObject({ accentColor: '#663399cc', brandAsset: assetUrl });
      await search.fill('');

      await openGroup('plugin:newsletter');
      await color.fill('#112233');
      await newsletter.getByRole('button', { name: 'Clear file: Brand asset', exact: true }).click();
      await color.fill('#663399cc');
      await asset.fill(assetUrl);
      await browserExpect(color).toHaveValue('#663399cc');
      await browserExpect(asset).toHaveValue(assetUrl);
      await browserExpect(saveChanges).toBeDisabled();

      await jsonButton.click();
      await browserExpect(editor).toBeVisible();
      const nullValues = {
        'plugin:newsletter': { optionalText: '', optionalNumber: 0, optionalChoice: 'first', optionalBoolean: false },
      };
      await replaceEditor(tab, editor, JSON.stringify(nullValues, null, 2));
      await openGroup('plugin:newsletter');
      await browserExpect(newsletter.getByLabel('Optional text', { exact: true })).toHaveValue('');
      await browserExpect(newsletter.getByLabel('Optional number', { exact: true })).toHaveValue('0');
      await browserExpect(newsletter.getByLabel('Optional choice', { exact: true })).toHaveValue('first');
      await browserExpect(newsletter.getByLabel('Optional boolean', { exact: true })).not.toBeChecked();
      await jsonButton.click();
      await replaceEditor(tab, editor, '{"plugin:newsletter":');
      await openGroup('plugin:newsletter');
      await browserExpect(newsletter.getByLabel('Sender name', { exact: true })).toBeDisabled();
      await jsonButton.click();
      await browserExpect(editor).toHaveText('{"plugin:newsletter":');
      tab.once('dialog', dialog => dialog.accept());
      await tab.locator('a[href="/dashboard"]').first().click();
      await browserExpect(tab).toHaveURL(server.origin + '/dashboard');
      await tab.locator('a[href="/dashboard/settings"]').first().click();
      await jsonButton.click();
      await browserExpect.poll(() => editorText(editor)).toContain('Browser draft');

      const importDocument = { 'plugin:newsletter': { senderName: 'Imported sender', optionalText: null, optionalNumber: null, optionalChoice: null, optionalBoolean: null } };
      const importFile = { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importDocument)) };
      await tab.getByLabel('Import settings JSON', { exact: true }).setInputFiles(importFile);
      await browserExpect(tab.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible();
      await browserExpect.poll(() => editorText(tab.locator('#settings-json-diff .cm-content'))).toContain('Imported sender');
      expect((await saved())['plugin:newsletter'].senderName).toBe('Browser draft');
      await tab.getByRole('button', { name: 'Cancel preview', exact: true }).click();
      expect((await saved())['plugin:newsletter'].senderName).toBe('Browser draft');
      await tab.getByLabel('Import settings JSON', { exact: true }).setInputFiles(importFile);
      await tab.getByRole('button', { name: 'Apply changes', exact: true }).click();
      await browserExpect.poll(async () => (await saved())['plugin:newsletter'].senderName).toBe('Imported sender');
      expect((await saved())['plugin:newsletter']).toMatchObject(importDocument['plugin:newsletter']);
      expect((await saved())['plugin:receipts'].senderName).toBe('Original sender');
      expect(await (await command()).json()).toMatchObject({ result: { senderName: 'Imported sender' } });
      // Explicitly importing a default pins that value, even when the effective value is unchanged.
      const pinned = (await storage.read([{ rql: 'SELECT key, value FROM cms_settings WHERE key = $key', params: { $key: 'plugin:newsletter.optionalText' } }])).results[0].rows;
      expect(pinned).toEqual([['plugin:newsletter.optionalText', 'null']]);

      const downloadPromise = tab.waitForEvent('download');
      await tab.getByRole('button', { name: 'Export saved settings', exact: true }).click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      expect(exported['plugin:newsletter']).toMatchObject(importDocument['plugin:newsletter']);
      for (const excluded of ['appearance', 'languages', 'permalinks', 'default-theme']) expect(exported).not.toHaveProperty(excluded);

      await replaceEditor(tab, editor, '{"general":{"siteTitle":"Unsaved navigation"}}');
      tab.once('dialog', dialog => dialog.dismiss());
      await tab.locator('a[href="/dashboard"]').first().click();
      await browserExpect(tab).toHaveURL(server.origin + '/dashboard/settings/json');
      await browserExpect(editor).toContainText('Unsaved navigation');
      tab.once('dialog', dialog => dialog.accept());
      await tab.locator('a[href="/dashboard"]').first().click();
      await browserExpect(tab).toHaveURL(server.origin + '/dashboard');
      await tab.locator('a[href="/dashboard/settings"]').first().click();
      await jsonButton.click();
      await browserExpect.poll(() => editorText(editor)).not.toContain('Unsaved navigation');
      await browserExpect.poll(() => editorText(editor)).toContain('Imported sender');

      // A changed declaration can leave an invalid stored value. The form must remain
      // usable so the administrator can repair it instead of losing the whole page.
      await storage.writeAtomic([{ rql: 'UPDATE cms_settings SET value = $value WHERE key = $key', params: { $key: 'plugin:newsletter.senderName', $value: '42' } }]);
      await expect(web.action(JSON_PAGE, 'download', [])).rejects.toThrow();
      await tab.goto(server.origin + '/dashboard/settings');
      await openGroup('plugin:newsletter');
      await browserExpect(tab.getByRole('alert').first()).toBeVisible();
      await newsletter.getByLabel('Sender name', { exact: true }).fill('Repaired sender');
      await tab.getByRole('button', { name: 'Save changes', exact: true }).click();
      await browserExpect(tab.getByText('Settings saved.', { exact: true })).toBeVisible();
      expect((await saved())['plugin:newsletter'].senderName).toBe('Repaired sender');
      expect(errors).toEqual([]);
    } catch (error) {
      if (tab) {
        console.error('Settings scroll diagnostics:', await tab.evaluate(() => ({
          scrollY: window.scrollY, height: document.documentElement.scrollHeight, viewport: window.innerHeight,
          toolbar: document.querySelector('[data-settings-toolbar]')?.getBoundingClientRect().toJSON(),
          active: [...document.querySelectorAll('[data-settings-menu-group][aria-current="location"]')].map(element => element.getAttribute('data-settings-menu-group')),
          sections: [...document.querySelectorAll('[data-settings-section]')].map(element => ({
            id: element.getAttribute('data-settings-section'), loaded: element.getAttribute('data-settings-loaded'),
            top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height,
          })),
        })).catch(() => null));
        await tab.screenshot({ path: '/tmp/cossack-settings-failure-viewport.png', animations: 'disabled' }).catch(() => {});
        await tab.screenshot({ path: '/tmp/cossack-settings-failure.png', fullPage: true }).catch(() => {});
        console.error('Settings browser diagnostics:', { url: tab.url(), errors, text: (await tab.locator('body').innerText().catch(() => '')).slice(0, 6000) });
      }
      throw error;
    } finally {
      await browser?.close();
      await server.close();
      await storage?.close();
      await database.stop();
    }
  }, 600_000);
});
