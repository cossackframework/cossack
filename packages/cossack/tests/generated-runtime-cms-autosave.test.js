// The entry editor's autosave in a browser: a new post keeps its typed content and its focus
// through the 30-second autosave, an unchanged editor sends nothing, and the stored draft comes
// back after a reload. Guards against the autosave re-rendering or reloading the editor.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Autosave', name: 'Ada', email: 'ada@example.com', password: 'long password' };

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

describe.skipIf(!liveRomeDBTests())('generated CMS autosave', () => {
  it('autosaves a new post without re-rendering or reloading the editor, only when it changed', async () => {
    const app = await nodeApp();
    let browser;
    try {
      const origin = app.server.origin;
      const web = browserless(origin, app.routeIds, () => app.server.diagnostics());
      expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: origin })));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const consoled = [];
      page.on('console', message => consoled.push(`${message.type()}: ${message.text()}`));
      const started = Date.now();
      page.on('request', request => { if (request.url().includes('/autosave')) consoled.push(`request autosave at +${Math.round((Date.now() - started) / 1000)}s`); });
      const ready = () => page.waitForFunction(() => window.__cossackReady === true);

      await page.goto(`${origin}/dashboard/content/posts/new`);
      await ready();
      // From here on, a load of the main frame is a failure (dialogs push history state, which is not one).
      const navigations = [];
      page.on('load', () => navigations.push('load'));
      page.on('domcontentloaded', () => navigations.push('domcontentloaded'));
      const autosaves = [];
      page.on('response', response => { if (response.url().includes('/autosave')) autosaves.push(response.status()); });

      await page.getByPlaceholder('Add title').fill('Autosaved draft');
      const surface = page.locator('[data-block-tree-item] .ProseMirror').first();
      await surface.click();
      await page.keyboard.type('Kept while autosaving');
      // Add a second block from the inserter: it must survive the autosave too.
      await page.getByRole('button', { name: 'Add block', exact: true }).first().click();
      const picker = page.getByRole('dialog', { name: 'Blocks' });
      await picker.getByLabel('Search blocks').fill('heading');
      await picker.getByRole('button', { name: 'Heading', exact: true }).click();
      await browserExpect(picker).toBeHidden();
      await browserExpect(page.getByRole('region', { name: 'Heading 2' })).toBeVisible();
      await surface.click();
      await page.keyboard.press('End');

      // The first tick after a change stores the draft; the editor keeps its text, blocks and focus.
      await page.waitForResponse(response => response.url().includes('/autosave'), { timeout: 45_000 });
      await browserExpect(page.getByText('Draft autosaved at')).toBeVisible();
      expect(autosaves).toEqual([200]);
      expect(navigations).toEqual([]);
      await browserExpect(surface).toContainText('Kept while autosaving');
      await browserExpect(page.getByRole('region', { name: 'Heading 2' })).toBeVisible();
      await browserExpect(page.getByPlaceholder('Add title')).toHaveValue('Autosaved draft');
      expect(await surface.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.type(' and after');
      await browserExpect(surface).toContainText('Kept while autosaving and after');

      // Another tick after the last change stores it; one more with nothing changed sends nothing.
      await page.waitForResponse(response => response.url().includes('/autosave'), { timeout: 65_000 }).catch(error => { throw new Error(`${error.message}\n${consoled.join('\n')}`); });
      expect(autosaves).toEqual([200, 200]);
      await page.waitForTimeout(32_000);
      expect(autosaves).toEqual([200, 200]);
      expect(navigations).toEqual([]);
      expect(errors).toEqual([]);

      // A reload (the browser's or the dev server's) keeps unsaved values and puts them straight back.
      await page.keyboard.type(' then reload');
      await page.reload();
      await ready();
      await browserExpect(page.getByText('kept through the reload')).toBeVisible();
      await browserExpect(page.getByText('You have unsaved work from')).toHaveCount(0);
      await browserExpect(page.getByPlaceholder('Add title')).toHaveValue('Autosaved draft');
      await browserExpect(page.locator('[data-block-tree-item] .ProseMirror').first()).toContainText('Kept while autosaving and after then reload');
      await browserExpect(page.getByRole('region', { name: 'Heading 2' })).toBeVisible();
      expect(errors).toEqual([]);

      // Another tab has no session storage of this one: it is offered the autosave, and restoring brings the text and the added block.
      const other = await context.newPage();
      await other.goto(`${origin}/dashboard/content/posts/new`);
      await other.waitForFunction(() => window.__cossackReady === true);
      await browserExpect(other.getByText('You have unsaved work from')).toBeVisible();
      await other.getByRole('button', { name: 'Restore the autosave' }).click();
      await browserExpect(other.getByPlaceholder('Add title')).toHaveValue('Autosaved draft');
      await browserExpect(other.locator('[data-block-tree-item] .ProseMirror').first()).toContainText('Kept while autosaving and after');
      await browserExpect(other.getByRole('region', { name: 'Heading 2' })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await app.close();
    }
  }, 600_000);
});
