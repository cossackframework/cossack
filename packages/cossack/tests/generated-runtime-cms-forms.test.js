// Forms in a generated application against a local `fastdb serve`: a form built from input
// blocks and placed on a page with `core/form`, posted as HTML without JavaScript (errors and
// typed values come back once after the redirect) and as JSON, with conditions, the spam trap,
// the per-address throttle, the cross-site check and the submissions API.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks, visible } from './fixtures/cms-client.js';
import { liveFastDBTests, startFastDBService } from '../../fastdb/src/testing.ts';

afterEach(cleanupRoots);

const SETUP = { code: 'setup-code-for-tests', siteTitle: 'Forms', name: 'Ada', email: 'ada@example.com', password: 'long password' };
const doc = (...content) => ({ type: 'doc', content });
const paragraph = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const input = (id, type, data, extra = {}) => ({ id, type: `form/${type}`, data: { label: id, ...data }, ...extra });

/** A contact form: two columns of name and email, a topic, a message, and a phone number shown when "call me" is ticked. */
const CONTACT = [
  { id: 'row', type: 'core/columns', data: {}, children: [
    { id: 'c1', type: 'core/column', data: {}, children: [input('n', 'text', { name: 'name', label: 'Your name', required: true })] },
    { id: 'c2', type: 'core/column', data: {}, children: [input('e', 'email', { name: 'email', label: 'Email', required: true })] },
  ] },
  input('t', 'select', { name: 'topic', label: 'Topic', options: ['sales|Sales', 'support|Support'] }),
  input('m', 'textarea', { name: 'message', label: 'Message', required: true }),
  input('cb', 'checkbox', { name: 'callMe', label: 'Call me' }),
  input('p', 'phone', { name: 'phone', label: 'Phone', required: true }, { when: { rules: [{ field: 'callMe', op: 'is', value: 'true' }] } }),
  input('h', 'hidden', { name: 'source', label: 'Source', defaultValue: 'site' }),
];

/** Set the site up, and place the contact form on a published page at /write-to-us. */
async function contactPage(origin, routeIds, diagnostics) {
  const web = browserless(origin, routeIds, diagnostics);
  expect((await web.post('/auth/setup', SETUP)).headers.get('location')).toBe('/dashboard');
  const json = async (pathname, method, body) => {
    const response = await web.request(pathname, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await response.json();
    expect(response.status, JSON.stringify(answer)).toBeLessThan(300);
    return answer;
  };
  const created = await json('/api/cms/content/forms', 'POST', { title: 'Contact', body: CONTACT, settings: { message: 'Thanks, **{field:name}**!' } });
  expect(created.item.slug).toBe('contact');
  await json('/api/cms/content/pages', 'POST', { title: 'Write to us', status: 'published', body: doc(paragraph('We answer within a day.'), { type: 'cmsBlock', attrs: { id: 'f1', type: 'core/form', data: { form: 'contact' } } }) });
  return { web, form: created.item };
}

async function forms(origin, routeIds, diagnostics) {
  const { web } = await contactPage(origin, routeIds, diagnostics);

  // The page renders the form as HTML; the phone waits for its condition; the hidden field has its default.
  const html = await (await fetch(`${origin}/write-to-us?source=ad`)).text();
  // The page's HTML is minified: attribute quotes are optional.
  expect(html).toMatch(/action="?\/api\/cms\/forms\/contact"?/);
  expect(html).toMatch(/name="?_started"? value="?\d+"?/);
  expect(html).toMatch(/data-cms-when="?p"?[^>]*data-hidden/);
  expect(html).toMatch(/<input type="?hidden"? name="?source"? value="?ad"?>/);
  contains(visible(html), 'Your name');
  const headless = await (await fetch(`${origin}/api/cms/forms/contact`)).json();
  expect(headless.inputs.map(entry => entry.name)).toEqual(['name', 'email', 'topic', 'message', 'callMe', 'phone', 'source']);
  expect(headless.open).toBe(true);

  // Without JavaScript: a post with errors returns to the page once, with the errors and what was typed.
  const started = String(Date.now() - 60_000);
  const send = (fields, ip, headers = {}) => web.request('/api/cms/forms/contact', { method: 'POST', headers: { 'x-forwarded-for': ip, ...headers }, body: new URLSearchParams({ _page: '/write-to-us', _started: started, ...fields }) });
  const invalid = await send({ name: 'Bo', email: 'not mail', message: '', callMe: 'on' }, '198.51.100.1');
  expect(invalid.status).toBe(303);
  const back = invalid.headers.get('location');
  expect(back).toMatch(/^\/write-to-us\?form=contact&result=[0-9a-f-]{36}#form-contact$/);
  const returned = await (await fetch(origin + back)).text();
  contains(visible(returned), 'Enter an email address, such as name@example.com.');
  contains(visible(returned), 'This field is required.');
  expect(returned).toMatch(/name="?name"?[^>]*value="?Bo"?/);
  // The ticked box shows the phone again, which is now required.
  expect(returned).not.toMatch(/data-cms-when="?p"?[^>]*data-hidden/);
  expect(returned).toMatch(/name="?callMe"? value="?on"? checked/);
  lacks(visible(await (await fetch(origin + back)).text()), 'This field is required.');

  // With the browser's script: JSON answers.
  const sent = await send({ name: 'Cy', email: 'cy@example.com', topic: 'support', message: 'Hello *there*' }, '198.51.100.2', { accept: 'application/json' });
  expect(sent.status).toBe(201);
  expect((await sent.json()).confirmation).toEqual({ kind: 'message', html: '<p>Thanks, <strong>Cy</strong>!</p>\n' });
  const tooSoon = await send({ name: 'Cy', email: 'cy@example.com', message: 'Again' }, '198.51.100.2', { accept: 'application/json' });
  expect(tooSoon.status).toBe(413);
  const errors = await send({ name: 'Di' }, '198.51.100.3', { accept: 'application/json' });
  expect(errors.status).toBe(422);
  expect((await errors.json()).fields).toEqual({ email: 'This field is required.', message: 'This field is required.' });

  // A good post without JavaScript shows the confirmation in place of the form.
  const good = await send({ name: 'Ed', email: 'ed@example.com', message: 'Hi', callMe: 'on', phone: '+44 20 7946 0000', source: 'ad' }, '198.51.100.4');
  const thanks = visible(await (await fetch(origin + good.headers.get('location'))).text());
  contains(thanks, 'Thanks, <strong>Ed</strong>!');
  lacks(thanks, 'Your name');

  // Bots: the trap stores spam and answers like a real submission.
  const trapped = await send({ name: 'Bot', email: 'bot@example.com', message: 'Buy', _website: 'http://spam.example' }, '198.51.100.5', { accept: 'application/json' });
  expect(trapped.status).toBe(201);
  // Cross-site posts are refused.
  const forged = await fetch(`${origin}/api/cms/forms/contact`, { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: new URLSearchParams({ name: 'x' }) });
  expect(forged.status).toBe(403);

  // The submissions API needs cms:submissions; values are typed, metadata kept.
  expect((await fetch(`${origin}/api/cms/forms/contact/submissions`)).status).toBe(401);
  const inbox = await (await web.request('/api/cms/forms/contact/submissions')).json();
  expect(inbox.items.map(item => [item.values.name, item.values.callMe, item.values.source])).toEqual([['Ed', true, 'ad'], ['Cy', false, undefined]]);
  expect(inbox.items[0].values.phone).toBe('+44 20 7946 0000');
  expect(inbox.items[0].meta).toMatchObject({ ip: '198.51.100.4', page: '/write-to-us' });
  const spam = await (await web.request('/api/cms/forms/contact/submissions?status=spam')).json();
  expect(spam.items.map(item => item.values.name)).toEqual(['Bot']);
  return { web };
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

describe.skipIf(!liveFastDBTests())('generated CMS forms', () => {
  it('builds, places, posts and stores forms on Node', async () => {
    const app = await nodeApp();
    try {
      await forms(app.server.origin, app.routeIds, () => app.server.diagnostics());
    } finally { await app.close(); }
  }, 600_000);

  it('applies conditions, checks fields and sends in place in the browser', async () => {
    const app = await nodeApp();
    let browser;
    try {
      const origin = app.server.origin;
      const { web } = await contactPage(origin, app.routeIds, () => app.server.diagnostics());
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/write-to-us`);
      await page.waitForFunction(() => window.__cossackReady === true);
      const form = page.getByRole('form', { name: 'Contact' });
      // The phone shows once "Call me" is ticked.
      await browserExpect(form.getByLabel('Phone')).toBeHidden();
      await form.getByLabel('Call me').check();
      await browserExpect(form.getByLabel('Phone')).toBeVisible();
      // Sending empty shows the server's checks in place and focuses the first field.
      await form.getByRole('button', { name: 'Submit' }).click();
      await browserExpect(page.locator('#form-contact-name-error')).toHaveText('This field is required.');
      await browserExpect(page.locator('#form-contact-phone-error')).toHaveText('This field is required.');
      await browserExpect(form.getByLabel('Your name')).toBeFocused();
      await form.getByLabel('Your name').fill('Ada');
      await browserExpect(page.locator('#form-contact-name-error')).toHaveText('');
      await form.getByLabel('Email').fill('ada@example');
      await form.getByLabel('Email').blur();
      await browserExpect(page.locator('#form-contact-email-error')).toHaveText('Enter an email address, such as name@example.com.');
      await form.getByLabel('Email').fill('ada@example.com');
      await form.getByLabel('Topic').selectOption('support');
      await form.getByLabel('Message').fill('Please call.');
      await form.getByLabel('Phone').fill('+1 555 0100');
      // People take more than two seconds; faster posts are kept as spam.
      await page.waitForTimeout(2_100);
      await form.getByRole('button', { name: 'Submit' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Thanks, Ada!' })).toBeVisible();
      await browserExpect(form.getByLabel('Your name')).toBeHidden();
      expect(page.url()).toBe(`${origin}/write-to-us`);
      expect(errors).toEqual([]);
      const inbox = await (await web.request('/api/cms/forms/contact/submissions')).json();
      expect(inbox.items.map(item => item.values)).toEqual([{ name: 'Ada', email: 'ada@example.com', topic: 'support', message: 'Please call.', callMe: true, phone: '+1 555 0100', source: 'site' }]);
    } finally {
      await browser?.close();
      await app.close();
    }
  }, 600_000);
});
