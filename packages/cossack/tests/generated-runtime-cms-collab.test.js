// Co-editing in a generated CMS application on Node: two signed-in users open one entry, and
// its room carries their changes to each other: a title typed by one appears for the other,
// rich text typed by both merges, a block's settings typed in the side panel reach the other's
// tree and open panel, presence names who is where (the title, a search-box row, the status),
// a save by one refreshes the other, and a reload comes back to the shared draft.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Together', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function nodeApp() {
  const root = await project('node', ['cms']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const database = await startRomeDBService();
  const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
  const server = await productionServer(root, { APP_SECRET: 'generated-cms-collab-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token,
    CMS_SETUP_CODE: 'setup-code-for-tests', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
  return { root, server, routeIds, close: async () => { await server.close(); await database.stop(); } };
}

/** A browser page signed in as a client, on the entry's editor, with its page errors collected. */
async function open(browser, origin, client, url, errors) {
  const context = await browser.newContext();
  await context.addCookies([...client.jar].map(([name, value]) => ({ name, value, url: origin })));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__cossackReady === true);
  return page;
}

describe.skipIf(!liveRomeDBTests())('generated CMS co-editing', () => {
  it('carries two editors’ changes, presence and saves through the entry’s room on Node', async () => {
    const app = await nodeApp();
    let browser;
    const errors = [];
    try {
      const origin = app.server.origin;
      const diagnostics = () => app.server.diagnostics();
      const ada = browserless(origin, app.routeIds, diagnostics);
      expect((await ada.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
      await ada.action('dashboard/users/new/index.ts', 'create', ['Eve', 'eve@example.com', 'eve password 1', ['editor']]);
      const eve = browserless(origin, app.routeIds, diagnostics);
      await eve.action('auth/login/index.ts', 'login', [{ email: 'eve@example.com', password: 'eve password 1' }]);
      expect(eve.jar.has('session_id')).toBe(true);
      // A post with one rich text block, saved as a draft by Ada.
      const created = await ada.action(EDITOR, 'save', [{ title: 'Shared post', slug: '', status: 'draft', publishedAt: '',
        content: [{ _id: 'rt', type: 'core/richtext', data: { text: doc('Hello') } }, { _id: 'hd', type: 'core/heading', data: { text: 'Head', level: 'h2' } }] }, 'draft', 0],
        { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
      expect(created.id, JSON.stringify(created.errors ?? created.error)).toMatch(/^[0-9a-f-]{36}$/);
      const url = `${origin}/dashboard/content/posts/${created.id}`;

      browser = await chromium.launch({ headless: true });
      const adaPage = await open(browser, origin, ada, url, errors);
      const evePage = await open(browser, origin, eve, url, errors);
      // The header stack shows both once both joined the room, the viewer first.
      await browserExpect(adaPage.locator('[data-room-participants]')).toHaveAttribute('data-room-participants', '2', { timeout: 20_000 });
      await browserExpect(evePage.locator('[data-room-participants]')).toHaveAttribute('data-room-participants', '2', { timeout: 20_000 });
      await browserExpect(adaPage.locator('[data-room-participants] [data-presence-user]')).toHaveCount(2);
      // Neither has a picture: the avatars show initials; the names mark the viewer.
      await browserExpect(adaPage.locator('[data-room-participants] .cs-avatar__fallback')).toHaveText(['A', 'E']);
      await browserExpect(evePage.locator('[data-room-participants] .cs-avatar__fallback')).toHaveText(['E', 'A']);
      await browserExpect(adaPage.locator('[data-room-participants] [data-presence]')).toHaveAttribute('title', 'Ada (you), Eve');

      // A title typed by Ada reaches Eve, who did not touch it.
      const adaTitle = adaPage.locator('#field-title');
      await adaTitle.click();
      await adaTitle.fill('Shared post, by Ada');
      await browserExpect(evePage.locator('#field-title')).toHaveValue('Shared post, by Ada', { timeout: 10_000 });
      // Ada's focus in the title shows on Eve's screen, with Ada's name.
      await browserExpect(evePage.locator('[data-field="title"] [data-presence-chip]')).toContainText('Ada', { timeout: 10_000 });
      // The meta description, a key of the search box, and the status select in the sidebar carry the chip on their rows too.
      const adaMeta = adaPage.locator('#seo-description');
      await adaMeta.click();
      await adaMeta.fill('Described by Ada');
      await browserExpect(evePage.locator('#seo-description')).toHaveValue('Described by Ada', { timeout: 10_000 });
      await browserExpect(evePage.locator('[data-field="seo.description"] [data-presence-chip]')).toContainText('Ada', { timeout: 10_000 });
      await adaPage.locator('#field-status').focus();
      await browserExpect(evePage.locator('[data-field="status"] [data-presence-chip]')).toContainText('Ada', { timeout: 10_000 });
      await browserExpect(evePage.locator('[data-field="seo.description"] [data-presence-chip]')).toHaveCount(0);

      // A heading's text typed in Ada's side panel reaches Eve's tree; Eve opens the same panel and it follows Ada's next change.
      await adaPage.locator('[data-block-tree-item="hd"] [aria-label="Edit Heading"]').click();
      await adaPage.locator('#block-hd-text').fill('Head by Ada');
      await browserExpect(evePage.locator('[data-block-tree-item="hd"] header')).toContainText('Head by Ada', { timeout: 10_000 });
      // Ada's focus in the panel counts as the heading block: Eve sees her there.
      await browserExpect(evePage.locator('[data-block-tree-item="hd"] [data-presence-chip]')).toContainText('Ada', { timeout: 10_000 });
      await evePage.locator('[data-block-tree-item="hd"] [aria-label="Edit Heading"]').click();
      await browserExpect(evePage.locator('#block-hd-text')).toHaveValue('Head by Ada');
      await browserExpect(evePage.locator('[data-block-sheet="hd"] [data-presence-chip]')).toContainText('Ada', { timeout: 10_000 });
      await adaPage.locator('#block-hd-text').fill('Head by Ada, again');
      await adaPage.locator('#block-hd-level').selectOption('h3');
      await browserExpect(evePage.locator('#block-hd-text')).toHaveValue('Head by Ada, again', { timeout: 10_000 });
      await browserExpect(evePage.locator('#block-hd-level')).toHaveValue('h3', { timeout: 10_000 });
      await adaPage.keyboard.press('Escape');
      await evePage.keyboard.press('Escape');
      await browserExpect(adaPage.locator('[data-block-sheet]')).toHaveCount(0);
      await browserExpect(evePage.locator('[data-block-sheet]')).toHaveCount(0);

      // Both type into the same rich text block; the room merges the text.
      const adaText = adaPage.locator('[data-block-tree-item="rt"] .ProseMirror');
      const eveText = evePage.locator('[data-block-tree-item="rt"] .ProseMirror');
      await browserExpect(adaText).toHaveText('Hello', { timeout: 20_000 });
      await browserExpect(eveText).toHaveText('Hello', { timeout: 20_000 });
      await adaText.click();
      await adaPage.keyboard.press('End');
      await adaPage.keyboard.type(' from Ada');
      await browserExpect(adaText).toHaveText('Hello from Ada', { timeout: 10_000 });
      await browserExpect(eveText).toHaveText('Hello from Ada', { timeout: 10_000 });
      await eveText.click();
      await evePage.keyboard.press('Home');
      await evePage.keyboard.type('Eve says: ');
      await browserExpect(adaText).toHaveText('Eve says: Hello from Ada', { timeout: 10_000 });
      // Ada's caret shows in Eve's editor while Ada is in the text.
      await adaText.click();
      await browserExpect(evePage.locator('[data-block-tree-item="rt"] .cms-caret')).toHaveCount(1, { timeout: 10_000 });

      // Ada saves: Eve learns of it, and the saved entry holds both editors' words.
      await browserExpect(adaPage.locator('[data-room-participants]')).toHaveCount(1);
      await adaPage.getByRole('button', { name: 'Save draft' }).click();
      // The notice names the outcome: "Saved.", or the error that stopped the save.
      await browserExpect(adaPage.locator('[data-notice]').first()).toBeVisible({ timeout: 20_000 });
      await browserExpect(adaPage.locator('[data-room-participants]')).toHaveCount(1);
      expect((await adaPage.locator('[data-notice]').allTextContents()).join(' | ')).toContain('Saved.');
      await browserExpect(evePage.getByText('Ada saved this entry.').first()).toBeVisible({ timeout: 20_000 });
      const saved = await (await ada.request(`/api/cms/content/posts/${created.id}`)).json();
      expect(saved.item.title).toBe('Shared post, by Ada');
      expect(JSON.stringify(saved.item.content)).toContain('Eve says: Hello from Ada');
      expect(JSON.stringify(saved.item.content)).toContain('"Head by Ada, again"');

      // The entries list names who is in the room: both editors, on the entry's row.
      expect(await ada.page('/dashboard/content/posts')).toMatch(/data-presence="?2"?/);

      // Eve types after the save; a reload of Ada's editor comes back to the shared draft, not the saved entry.
      await eveText.click();
      await evePage.keyboard.press('End');
      await evePage.keyboard.type(' (unsaved)');
      await browserExpect(adaText).toHaveText('Eve says: Hello from Ada (unsaved)', { timeout: 10_000 });
      await adaPage.reload();
      await adaPage.waitForFunction(() => window.__cossackReady === true);
      await browserExpect(adaPage.locator('[data-block-tree-item="rt"] .ProseMirror')).toHaveText('Eve says: Hello from Ada (unsaved)', { timeout: 20_000 });
      expect(errors, errors.join('\n')).toEqual([]);
    } catch (error) {
      console.log('page errors:', errors.join('\n'));
      console.log('server:', app.server.diagnostics().slice(-3000));
      throw error;
    } finally {
      await browser?.close();
      await app.close();
    }
  }, 900_000);
});
