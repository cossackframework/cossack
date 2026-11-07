// Notes in a generated CMS application on Node: two signed-in users open one entry; one leaves
// a note on a selected passage, the other sees the underline and the thread at once and replies
// with a mention; the first's dashboard lists the thread; resolving and reopening travel; typing
// before the passage keeps the note on its words, as does a save and a reload; the content API
// reads and writes notes with the same rules; and the Writing setting holds publishing.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

const EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const SETTINGS = 'dashboard/(cms)/settings/index.ts';
const WEBHOOKS = 'dashboard/(cms)/tools/webhooks/index.ts';
const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Reviewed', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function nodeApp() {
  const root = await project('node', ['cms']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const database = await startRomeDBService();
  const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
  const server = await productionServer(root, { APP_SECRET: 'generated-cms-notes-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token,
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

/** A JSON write to the API as a signed-in session: same-origin, as the browser would send it. */
const json = (client, origin, method, pathname, body) => client.request(pathname, {
  method, headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe.skipIf(!liveRomeDBTests())('generated CMS notes', () => {
  it('carries notes on a passage between two editors, to the dashboard and through the API on Node', async () => {
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
      const values = { title: 'Shared post', slug: '', status: 'draft', publishedAt: '', content: [{ _id: 'rt', type: 'core/richtext', data: { text: doc('Hello world') } }] };
      const created = await ada.action(EDITOR, 'save', [values, 'draft', 0], { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
      expect(created.id, JSON.stringify(created.errors ?? created.error)).toMatch(/^[0-9a-f-]{36}$/);
      const id = created.id;
      const url = `${origin}/dashboard/content/posts/${id}`;
      const notesApi = `/api/cms/content/posts/${id}/notes`;
      // A webhook for the notes of every collection; its deliveries are queued as notes are left and resolved.
      const hooked = await ada.action(WEBHOOKS, 'save', [{ id: '', name: 'Notes hook', url: `${origin}/hooks/notes`, events: ['note.created', 'note.resolved'], collections: [], active: true }]);
      expect(hooked.error ?? '').toBe('');
      const hookId = hooked.selected;
      expect(hookId).toMatch(/\S/);

      browser = await chromium.launch({ headless: true });
      const adaPage = await open(browser, origin, ada, url, errors);
      const evePage = await open(browser, origin, eve, url, errors);
      await browserExpect(adaPage.locator('[data-room-participants]')).toHaveAttribute('data-room-participants', '2', { timeout: 20_000 });
      const adaText = adaPage.locator('[data-block-tree-item="rt"] .ProseMirror');
      const eveText = evePage.locator('[data-block-tree-item="rt"] .ProseMirror');
      await browserExpect(adaText).toHaveText('Hello world', { timeout: 20_000 });
      await browserExpect(eveText).toHaveText('Hello world', { timeout: 20_000 });

      // Ada selects "Hello" and leaves a note on it: the rail opens with the quote, and the words are underlined for both.
      await adaText.click();
      await adaPage.keyboard.press('Home');
      for (let step = 0; step < 5; step++) await adaPage.keyboard.press('Shift+ArrowRight');
      await adaPage.locator('[data-block-tree-item="rt"] [aria-label="Add a note on the selection"]').click();
      await browserExpect(adaPage.locator('[data-note-composer="new"] blockquote')).toHaveText('Hello');
      await adaPage.locator('#entry-notes-composer').fill('Needs a source.');
      await adaPage.locator('[data-note-composer="new"] button[type="submit"]').click();
      await browserExpect(adaPage.locator('[data-notes-rail] [data-note-thread]')).toHaveCount(1, { timeout: 10_000 });
      await browserExpect(adaPage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveText('Hello', { timeout: 10_000 });
      await browserExpect(evePage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveText('Hello', { timeout: 10_000 });
      await browserExpect(evePage.locator('[data-notes-toggle]')).toHaveAttribute('data-notes-toggle', '1');

      // Eve opens the rail from the header, reads the note and replies, mentioning Ada from the picker.
      await evePage.locator('[data-notes-toggle]').click();
      await browserExpect(evePage.locator('[data-notes-rail] [data-note-thread]')).toContainText('Needs a source.');
      await browserExpect(evePage.locator('[data-notes-rail] [data-note-thread]')).toContainText('“Hello”');
      await evePage.locator('[data-note-thread] button:has-text("Reply")').click();
      await evePage.locator('#entry-notes-composer').fill('Added one.');
      await evePage.locator('#entry-notes-composer-mention').fill('Ada');
      await evePage.getByRole('option', { name: 'Ada' }).click();
      await browserExpect(evePage.locator('#entry-notes-composer')).toHaveValue(/@\[Ada\]\(/);
      await evePage.locator('[data-note-composer] button[type="submit"]').click();
      await browserExpect(adaPage.locator('[data-notes-rail] [data-note-thread] [data-note]')).toHaveCount(2, { timeout: 10_000 });
      await browserExpect(adaPage.locator('[data-notes-rail] [data-mention]')).toHaveText('@Ada');
      // Ada changes her own words from the pen icon on her note; Eve reads the new text.
      await adaPage.locator('[data-notes-rail] [data-note] [aria-label="Edit"]').first().click();
      await adaPage.locator('[data-notes-rail] textarea[id^="entry-notes-edit-"]').fill('Needs a source, please.');
      await adaPage.locator('[data-notes-rail] [data-note] form button[type="submit"]').click();
      await browserExpect(evePage.locator('[data-notes-rail] [data-note-thread]')).toContainText('Needs a source, please.', { timeout: 10_000 });
      // Eve is an editor, not an administrator: Ada's note has no remove button for her, her own reply has one.
      await browserExpect(evePage.locator('[data-notes-rail] [data-note] [aria-label="Remove thread"]')).toHaveCount(0);
      await browserExpect(evePage.locator('[data-notes-rail] [data-note] [aria-label="Remove"]')).toHaveCount(1);
      // Ada's dashboard lists the thread for her, with the words it quotes.
      const home = await ada.page('/dashboard');
      expect(home).toContain('Notes for you');
      expect(home).toContain('“Hello”');

      // Eve resolves: the underline and the count go for Ada; reopening brings them back.
      await evePage.locator('[data-note-thread] button:has-text("Resolve")').click();
      await browserExpect(adaPage.locator('[data-notes-toggle]')).toHaveAttribute('data-notes-toggle', '0', { timeout: 10_000 });
      // The webhook has a delivery queued for the note and one for the reply, and one for the resolution.
      await browserExpect.poll(async () => (await ada.action(WEBHOOKS, 'load', [hookId])).deliveries.map(delivery => delivery.event).sort(), { timeout: 10_000 })
        .toEqual(['note.created', 'note.created', 'note.resolved']);
      await browserExpect(adaPage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveCount(0);
      await evePage.locator('[data-notes-rail] [role="tab"]:has-text("Resolved")').click();
      await evePage.locator('[data-note-thread][data-status="resolved"] button:has-text("Reopen")').click();
      await browserExpect(adaPage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveText('Hello', { timeout: 10_000 });

      // Ada types before the passage: the note stays on its words for both; a save writes the new place back; a reload finds it.
      await adaText.click();
      await adaPage.keyboard.press('Home');
      await adaPage.keyboard.type('Yes, ');
      await browserExpect(adaText).toHaveText('Yes, Hello world', { timeout: 10_000 });
      await browserExpect(adaPage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveText('Hello');
      await browserExpect(evePage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveText('Hello', { timeout: 10_000 });
      await adaPage.getByRole('button', { name: 'Save draft' }).click();
      await browserExpect(adaPage.locator('[data-notice]').first()).toBeVisible({ timeout: 20_000 });
      expect((await adaPage.locator('[data-notice]').allTextContents()).join(' | ')).toContain('Saved.');
      await browserExpect.poll(async () => (await (await ada.request(notesApi)).json()).threads[0]?.root.range, { timeout: 10_000 }).toEqual({ from: 6, to: 11 });
      await adaPage.reload();
      await adaPage.waitForFunction(() => window.__cossackReady === true);
      await browserExpect(adaPage.locator('[data-block-tree-item="rt"] .cms-note')).toHaveText('Hello', { timeout: 20_000 });

      // The API: Ada notes the title, Eve may not change Ada's words or remove them, Ada resolves and removes.
      const posted = await json(ada, origin, 'POST', notesApi, { target: 'field:title', body: 'Shorter title?' });
      const postedText = await posted.text();
      expect(posted.status, postedText).toBe(201);
      const titleNote = JSON.parse(postedText).note;
      expect(titleNote).toMatchObject({ target: 'field:title', status: 'open', body: 'Shorter title?' });
      const listed = await (await ada.request(notesApi)).json();
      expect(listed.threads).toHaveLength(2);
      expect(listed.threads[0].replies).toHaveLength(1);
      expect((await json(eve, origin, 'PATCH', `/api/cms/notes/${titleNote.id}`, { body: 'Longer title?' })).status).toBe(403);
      expect((await json(eve, origin, 'DELETE', `/api/cms/notes/${titleNote.id}`)).status).toBe(403);
      const resolved = await json(ada, origin, 'PATCH', `/api/cms/notes/${titleNote.id}`, { status: 'resolved' });
      expect(resolved.status, await resolved.clone().text()).toBe(200);
      expect((await resolved.json()).note.status).toBe('resolved');
      expect((await ada.request(`${notesApi}?status=open`)).ok).toBe(true);
      expect((await (await ada.request(`${notesApi}?status=open`)).json()).threads).toHaveLength(1);
      expect((await json(ada, origin, 'DELETE', `/api/cms/notes/${titleNote.id}`)).status).toBe(204);
      expect((await (await ada.request(notesApi)).json()).threads).toHaveLength(1);

      // With the Writing setting on, the open thread holds publishing until it is resolved.
      await ada.action(SETTINGS, 'saveAll', [{ document: { writing: { requireResolvedNotes: true } }, languages: null, permalinks: null, groups: {} }]);
      const entry = (await (await ada.request(`/api/cms/content/posts/${id}`)).json()).item;
      const held = await ada.action(EDITOR, 'save', [{ ...values, title: entry.title, content: entry.content, status: 'published' }, 'publish', entry.rev], { params: { collection: 'posts', id }, state: { route: 'posts', id } });
      expect(held.error).toContain('Resolve the open note before publishing.');
      const [thread] = (await (await ada.request(notesApi)).json()).threads;
      expect((await json(ada, origin, 'PATCH', `/api/cms/notes/${thread.root.id}`, { status: 'resolved' })).status).toBe(200);
      const published = await ada.action(EDITOR, 'save', [{ ...values, title: entry.title, content: entry.content, status: 'published' }, 'publish', entry.rev], { params: { collection: 'posts', id }, state: { route: 'posts', id } });
      expect(published.error ?? '').toBe('');
      expect(published.savedStatus).toBe('published');

      // Live Edit on the published page: the bar's Notes opens the same threads, and a reply written there goes through the API.
      const live = (await (await ada.request(`/api/cms/content/posts/${id}`)).json()).item.url;
      expect(live, 'the published entry has a URL').toMatch(/\S/);
      const sitePage = await open(browser, origin, ada, `${/^https?:/.test(live) ? live : origin + live}?edit`, errors);
      await browserExpect(sitePage.locator('[data-site-editor] [data-notes-toggle]')).toHaveAttribute('data-notes-toggle', '0', { timeout: 30_000 });
      await sitePage.locator('[data-site-editor] [data-notes-toggle]').click();
      await sitePage.locator('[data-notes-rail] [role="tab"]:has-text("Resolved")').click();
      await browserExpect(sitePage.locator('[data-notes-rail] [data-note-thread]')).toContainText('Needs a source, please.');
      await sitePage.locator('[data-note-thread] button:has-text("Reopen")').click();
      await browserExpect(sitePage.locator('[data-site-editor] [data-notes-toggle]')).toHaveAttribute('data-notes-toggle', '1', { timeout: 10_000 });
      await sitePage.locator('[data-notes-rail] [role="tab"]:has-text("Open")').click();
      await sitePage.locator('[data-note-thread] button:has-text("Reply")').click();
      await sitePage.locator('#site-notes-composer').fill('Seen on the site.');
      await sitePage.locator('[data-note-composer] button[type="submit"]').click();
      await browserExpect(sitePage.locator('[data-notes-rail] [data-note-thread] [data-note]')).toHaveCount(3, { timeout: 10_000 });
      const afterSite = (await (await ada.request(notesApi)).json()).threads;
      expect(afterSite[0].replies.map(reply => reply.body)).toEqual(expect.arrayContaining(['Seen on the site.']));
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
