// Forms in a generated application against a local `romedb serve`: a form built from input
// blocks and placed on a page with `core/form`, posted as HTML without JavaScript (errors and
// typed values come back once after the redirect) and as JSON, with conditions, the spam trap,
// the per-address throttle, the cross-site check and the submissions API.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, productionServer, project, vite } from './fixtures/generated-app.js';
import { browserless, contains, lacks, visible } from './fixtures/cms-client.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

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
  const created = await json('/api/cms/content/forms', 'POST', { title: 'Contact', status: 'published', body: CONTACT, settings: { message: 'Thanks, **{field:name}**!' } });
  expect(created.item.slug).toBe('contact');
  await json('/api/cms/content/pages', 'POST', { title: 'Write to us', status: 'published', content: [{ id: 'rt', type: 'core/richtext', data: { text: doc(paragraph('We answer within a day.')) } }, { id: 'f1', type: 'core/form', data: { form: 'contact' } }] });
  return { web, form: created.item };
}

/** A booking: an email, guest names (a multiple input), and up to three passengers, each a name, a special-meal box and, when ticked, the meal. */
const BOOKING = [
  input('e', 'email', { name: 'email', label: 'Email', required: true }),
  input('gn', 'text', { name: 'guests', label: 'Guest names', multiple: true, maxItems: 3, minLength: 2, maxLength: 10, addLabel: 'Add guest' }),
  input('r', 'repeater', { name: 'pax', label: 'Passengers', rowLabel: 'Passenger', min: 1, max: 3 }, { children: [
    input('n', 'text', { name: 'name', label: 'Name', required: true }),
    input('sm', 'checkbox', { name: 'special', label: 'Special meal' }),
    input('ml', 'text', { name: 'meal', label: 'Meal', required: true }, { when: { rules: [{ field: 'special', op: 'is', value: 'true' }] } }),
  ] }),
];

/** Publish the booking form and place it on a page at /book. */
async function bookingPage(web) {
  const json = async (pathname, body) => {
    const response = await web.request(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await response.json();
    expect(response.status, JSON.stringify(answer)).toBeLessThan(300);
    return answer;
  };
  const created = await json('/api/cms/content/forms', { title: 'Booking', status: 'published', body: BOOKING, settings: { message: 'Booked for {field:email}: {field:pax}' } });
  await json('/api/cms/content/pages', { title: 'Book', status: 'published', content: [{ id: 'f1', type: 'core/form', data: { form: 'booking' } }] });
  return created.item;
}

const INBOX = 'dashboard/(cms)/forms/[id]/submissions/index.ts';

async function forms(origin, routeIds, diagnostics) {
  const { web, form } = await contactPage(origin, routeIds, diagnostics);

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
  // Workers read the sender from cf-connecting-ip, Node from x-forwarded-for.
  const send = (fields, ip, headers = {}) => web.request('/api/cms/forms/contact', { method: 'POST', headers: { 'x-forwarded-for': ip, 'cf-connecting-ip': ip, ...headers }, body: new URLSearchParams({ _page: '/write-to-us', _started: started, ...fields }) });
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

  // The dashboard: the section counts new submissions; the forms list; the inbox; one submission.
  contains(await web.page('/dashboard'), 'Forms (2)');
  const list = await web.page('/dashboard/forms');
  contains(list, 'Contact');
  contains(list, '2 new');
  const inboxPage = await web.page(`/dashboard/forms/${form.id}/submissions`);
  contains(inboxPage, 'Ed');
  contains(inboxPage, 'cy@example.com');
  lacks(inboxPage, 'bot@example.com');
  const [ed, cy] = inbox.items;
  const detail = await web.page(`/dashboard/forms/${form.id}/submissions/${ed.id}`);
  contains(detail, '+44 20 7946 0000');
  contains(detail, '198.51.100.4');
  contains(detail, '/write-to-us');
  // Opening a submission marks it read.
  contains(await web.page('/dashboard'), 'Forms (1)');
  // Bulk actions run through the inbox's server method.
  await web.action(INBOX, 'apply', [[cy.id], 'trash'], { params: { id: form.id } });
  expect((await (await web.request('/api/cms/forms/contact/submissions?status=trash')).json()).items.map(item => item.id)).toEqual([cy.id]);
  await web.action(INBOX, 'apply', [[cy.id], 'read'], { params: { id: form.id } });
  // The export: a header from the inputs' labels, a row per submission, formulas defused.
  const exported = await web.request('/api/cms/forms/contact/submissions/export');
  expect(exported.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  expect(exported.headers.get('content-disposition')).toMatch(/^attachment; filename="contact-submissions-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = new Uint8Array(await exported.arrayBuffer());
  // A byte order mark, so spreadsheets read the file as UTF-8.
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes).split('\r\n');
  expect(csv[0]).toBe('Submitted at,Status,Your name,Email,Topic,Message,Call me,Phone,Source,IP address,Page,Browser,User,Note,ID');
  expect(csv[1]).toContain(",read,Ed,ed@example.com,,Hi,Yes,'+44 20 7946 0000,ad,198.51.100.4,/write-to-us,");
  expect(csv[2]).toContain(',read,Cy,cy@example.com,Support,Hello *there*,No,,,198.51.100.2,');
  expect(csv).toHaveLength(4);
  expect((await fetch(`${origin}/api/cms/forms/contact/submissions/export`)).status).toBe(401);
  // The form's editor names its slug and links to its submissions.
  const editor = await web.page(`/dashboard/content/forms/${form.id}`);
  contains(editor, 'Place the form on a page with the Form block and this slug.');
  contains(editor, `/dashboard/forms/${form.id}/submissions`);

  // A repeater: the page starts with one row and a hidden, disabled template row the script copies.
  const booking = await bookingPage(web);
  const book = await (await fetch(`${origin}/book`)).text();
  expect(book).toMatch(/name="?pax\[r1\]\[name\]"?/);
  expect(book).toMatch(/data-cms-when="?r1:ml"?[^>]*data-hidden/);
  expect(book).toMatch(/data-cms-row-template[^>]*>/);
  expect(book).toMatch(/<fieldset disabled[^>]*>[\s\S]*name="?pax\[__row__\]\[name\]"?/);
  expect(book).toMatch(/name="?_add"? value="?pax"?/);
  const described = await (await fetch(`${origin}/api/cms/forms/booking`)).json();
  expect(described.inputs[1]).toMatchObject({ name: 'guests', kind: 'string', multiple: true });
  expect(described.inputs[2]).toMatchObject({ name: 'pax', kind: 'rows', inputs: [{ name: 'name', kind: 'string' }, { name: 'special', kind: 'boolean' }, { name: 'meal', kind: 'string' }] });
  // A multiple input: one control per value, a hidden template item with its control disabled, and Add and Remove that work without the script.
  expect(book).toMatch(/data-cms-multiple="?guests"?/);
  expect(book).toMatch(/<fieldset disabled[^>]*>[\s\S]*?name="?guests"?[^>]*aria-label="?Guest names 0"?/);
  expect(book).toMatch(/name="?_add"? value="?guests"?/);
  const post = (fields, ip, headers = {}) => web.request('/api/cms/forms/booking', { method: 'POST', headers: { 'x-forwarded-for': ip, 'cf-connecting-ip': ip, ...headers }, body: new URLSearchParams({ _page: '/book', _started: started, ...fields }) });
  // Without the script, Add posts the form back and it returns with one more row, nothing checked.
  const added = await post({ 'pax[r1][name]': 'Ada', _add: 'pax' }, '198.51.100.11');
  expect(added.status).toBe(303);
  const twoRows = await (await fetch(origin + added.headers.get('location'))).text();
  expect(twoRows).toMatch(/name="?pax\[r1\]\[name\]"? [^>]*value="?Ada"?/);
  expect(twoRows.match(/data-cms-row="?r[a-z0-9]+"?/g)).toHaveLength(2);
  lacks(visible(twoRows), 'This field is required.');
  const addedItem = await post({ guests: 'Ann', _add: 'guests' }, '198.51.100.16');
  const twoItems = await (await fetch(origin + addedItem.headers.get('location'))).text();
  expect(twoItems).toMatch(/name="?guests"? [^>]*value="?Ann"?/);
  expect(twoItems.match(/data-cms-error="?guests\.[0-9]+"?/g)).toHaveLength(3);
  // An item that fails its check is marked where it sits.
  const longItem = await web.request('/api/cms/forms/booking', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.17', 'cf-connecting-ip': '198.51.100.17' },
    body: new URLSearchParams([['_page', '/book'], ['_started', started], ['email', 'ada@example.com'], ['pax[a][name]', 'Ada'], ['guests', 'Ann'], ['guests', 'A very long guest name']]) });
  const withLong = await (await fetch(origin + longItem.headers.get('location'))).text();
  expect(withLong).toMatch(/data-cms-server-error="?guests\.2"?[^>]*>(?:<!--[^>]*-->)?Use at most 10 characters\./);
  // A post with errors: the meal is required where the box is ticked; the error sits in the row.
  const wrongRows = await post({ 'pax[a][name]': 'Ada', 'pax[a][special]': 'on', 'pax[b][name]': 'Bob', email: 'ada@example.com' }, '198.51.100.12');
  const withErrors = await (await fetch(origin + wrongRows.headers.get('location'))).text();
  // The renderer marks the text with a comment.
  expect(withErrors).toMatch(/data-cms-server-error="?pax\.a\.meal"?[^>]*>(?:<!--[^>]*-->)?This field is required\./);
  expect(withErrors).toMatch(/name="?pax\[b\]\[name\]"? [^>]*value="?Bob"?/);
  // JSON rows: ids are given, unticked boxes are no, the confirmation lists the rows.
  const sentRows = await web.request('/api/cms/forms/booking', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.14', 'cf-connecting-ip': '198.51.100.14', accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ _started: started, email: 'ada@example.com', guests: ['Ann', 'Bea'], pax: [{ name: 'Ada', special: true, meal: 'Vegan' }, { name: 'Bob' }] }) });
  expect(sentRows.status).toBe(201);
  expect((await sentRows.json()).confirmation.html).toContain('Name: Ada, Special meal: Yes, Meal: Vegan');
  const tooMany = await web.request('/api/cms/forms/booking', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.15', 'cf-connecting-ip': '198.51.100.15', accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ _started: started, email: 'ada@example.com', pax: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] }) });
  expect((await tooMany.json()).fields).toEqual({ pax: 'Add at most 3 Passenger rows.' });
  const bookings = await (await web.request('/api/cms/forms/booking/submissions')).json();
  expect(bookings.items.map(item => item.values)).toEqual([{ email: 'ada@example.com', guests: ['Ann', 'Bea'], pax: [{ _id: 'r1', name: 'Ada', special: true, meal: 'Vegan' }, { _id: 'r2', name: 'Bob', special: false }] }]);
  // The inbox counts the rows; the submission shows them as a table; the export has them in one cell.
  contains(await web.page(`/dashboard/forms/${booking.id}/submissions`), 'Passenger × 2');
  const bookingDetail = await web.page(`/dashboard/forms/${booking.id}/submissions/${bookings.items[0].id}`);
  contains(bookingDetail, 'Vegan');
  contains(bookingDetail, '<th');
  const bookingCsv = new TextDecoder().decode(new Uint8Array(await (await web.request('/api/cms/forms/booking/submissions/export')).arrayBuffer()));
  expect(bookingCsv).toContain('"Name: Ada, Special meal: Yes, Meal: Vegan\nName: Bob, Special meal: No"');
  expect(bookingCsv).toContain('"Ann, Bea"');
  contains(bookingDetail, 'Ann\nBea');
  return { web };
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

describe.skipIf(!liveRomeDBTests())('generated CMS forms', () => {
  it('builds, places, posts and stores forms on Node', async () => {
    const app = await nodeApp();
    try {
      await forms(app.server.origin, app.routeIds, () => app.server.diagnostics());
    } finally { await app.close(); }
  }, 600_000);

  it('posts and stores forms on Cloudflare Workers', async () => {
    const root = await project('cloudflare', ['cms']);
    const database = await startRomeDBService();
    try {
      await vite(root, []);
      const configPath = path.join(root, 'dist/ssr/wrangler.json');
      await fs.writeFile(path.join(path.dirname(configPath), '.dev.vars'), [
        'APP_SECRET=generated-cms-test-secret-0123456789abcdef', `ROMEDB_URL=${database.url}`, `ROMEDB_TOKEN=${database.token}`, 'CMS_SETUP_CODE=setup-code-for-tests',
      ].join('\n') + '\n');
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      const { createTestHarness } = await import('wrangler');
      const runtime = createTestHarness({ root, workers: [{ configPath }] });
      try {
        const { url } = await runtime.listen();
        await forms(new URL(url).origin, routeIds, () => '');
      } finally { await runtime.close(); }
    } finally { await database.stop(); }
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

      // A repeater in the browser: Add copies a row, conditions settle per row, Remove drops one, the limit disables Add.
      await bookingPage(web);
      await page.goto(`${origin}/book`);
      await page.waitForFunction(() => window.__cossackReady === true);
      const booking = page.getByRole('form', { name: 'Booking' });
      const rows = booking.locator('[data-cms-rows] > [data-cms-row]');
      await browserExpect(rows).toHaveCount(1);
      await browserExpect(rows.nth(0).getByRole('textbox', { name: 'Meal' })).toBeHidden();
      await booking.getByRole('button', { name: 'Add another' }).click();
      await browserExpect(rows).toHaveCount(2);
      expect(await rows.nth(1).innerHTML()).toMatch(/Passenger\s*(?:<!--[^>]*-->)?\s*<span[^>]*>2<\/span>/);
      await browserExpect(rows.nth(1).getByLabel('Name')).toBeFocused();
      await rows.nth(0).getByLabel('Name').fill('Ada');
      await rows.nth(0).getByLabel('Special meal').check();
      await browserExpect(rows.nth(0).getByRole('textbox', { name: 'Meal' })).toBeVisible();
      await browserExpect(rows.nth(1).getByRole('textbox', { name: 'Meal' })).toBeHidden();
      await rows.nth(0).getByRole('textbox', { name: 'Meal' }).fill('Vegan');
      await rows.nth(1).getByLabel('Name').fill('Bob');
      await booking.getByRole('button', { name: 'Add another' }).click();
      await browserExpect(rows).toHaveCount(3);
      await browserExpect(booking.getByRole('button', { name: 'Add another' })).toBeDisabled();
      await rows.nth(2).getByRole('button', { name: 'Remove' }).click();
      await browserExpect(rows).toHaveCount(2);
      await browserExpect(booking.getByRole('button', { name: 'Add another' })).toBeEnabled();
      // A multiple input in the browser: a value too short is marked where it sits, Add copies a control, Remove drops one and the rest renumber.
      const guests = booking.locator('[data-cms-multiple="guests"] [data-cms-items] > [data-cms-item]');
      await browserExpect(guests).toHaveCount(1);
      await booking.getByRole('textbox', { name: 'Guest names 1', exact: true }).fill('Z');
      await booking.getByRole('button', { name: 'Add guest' }).click();
      await browserExpect(guests).toHaveCount(2);
      await browserExpect(booking.getByRole('textbox', { name: 'Guest names 2', exact: true })).toBeFocused();
      await browserExpect(page.locator('#form-booking-guests-1-error')).toHaveText('Use at least 2 characters.');
      await booking.getByRole('textbox', { name: 'Guest names 2', exact: true }).fill('Bea');
      await booking.getByRole('button', { name: 'Remove Guest names 1' }).click();
      await browserExpect(guests).toHaveCount(1);
      await browserExpect(booking.getByRole('textbox', { name: 'Guest names 1', exact: true })).toHaveValue('Bea');
      await browserExpect(page.locator('#form-booking-guests-1-error')).toHaveText('');
      // Sending without the email shows the check; a row's own check sits in its row.
      await booking.getByRole('button', { name: 'Submit' }).click();
      await browserExpect(page.locator('#form-booking-email-error')).toHaveText('This field is required.');
      await rows.nth(1).getByLabel('Special meal').check();
      await booking.getByRole('button', { name: 'Submit' }).click();
      await browserExpect(rows.nth(1).locator('[data-cms-error]').last()).toHaveText('This field is required.');
      await rows.nth(1).getByLabel('Special meal').uncheck();
      await booking.getByLabel('Email').fill('ada@example.com');
      await page.waitForTimeout(2_100);
      await booking.getByRole('button', { name: 'Submit' }).click();
      await browserExpect(page.getByRole('status').filter({ hasText: 'Booked for ada@example.com' })).toBeVisible();
      const bookings = await (await web.request('/api/cms/forms/booking/submissions')).json();
      expect(bookings.items.map(item => item.values.pax.map(row => [row.name, row.special, row.meal]))).toEqual([[['Ada', true, 'Vegan'], ['Bob', false, undefined]]]);
      expect(bookings.items[0].values.guests).toEqual(['Bea']);

      // In the dashboard: a new form from input blocks, a field shown on a checkbox, and an email.
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: origin })));
      const admin = await context.newPage();
      admin.on('pageerror', error => errors.push(error.message));
      const ready = () => admin.waitForFunction(() => window.__cossackReady === true);
      const addBlock = async (search, name) => {
        await admin.getByRole('button', { name: 'Add block', exact: true }).last().click();
        const picker = admin.getByRole('dialog', { name: 'Blocks' });
        await browserExpect(picker.getByRole('heading', { name: 'Form inputs' })).toBeVisible();
        await picker.getByLabel('Search blocks').fill(search);
        await picker.getByRole('button', { name, exact: true }).click();
        await browserExpect(picker).toBeHidden();
      };
      // A block's settings, conditional logic included, are in its panel.
      const editBlock = async (region, type, fill) => {
        await admin.getByRole('region', { name: region }).getByRole('button', { name: `Edit ${type}` }).click();
        const panel = admin.getByRole('dialog', { name: type });
        await fill(panel);
        await panel.getByRole('button', { name: 'Done' }).click();
        await browserExpect(panel).toBeHidden();
      };
      await admin.goto(`${origin}/dashboard/content/forms/new`);
      await ready();
      await admin.getByPlaceholder('Add title').fill('Newsletter');
      await addBlock('email', 'Email');
      await editBlock('Email 1', 'Email', panel => panel.getByLabel('Label *').fill('Your email'));
      await addBlock('checkbox', 'Checkbox');
      await editBlock('Checkbox 2', 'Checkbox', panel => panel.getByLabel('Label *').fill('Tell us more'));
      await addBlock('text', 'Text');
      await editBlock('Text 3', 'Text', async panel => {
        await panel.getByLabel('Label *').fill('Interests');
        await panel.getByLabel('Conditional logic').check();
        await panel.getByLabel('Field', { exact: true }).selectOption('tellUsMore');
        await panel.getByLabel('Value', { exact: true }).fill('true');
      });
      await browserExpect(admin.getByRole('region', { name: 'Text 3' }).getByText('Shown if…')).toBeVisible();
      await admin.getByRole('button', { name: 'Add notification' }).click();
      // Forms publish like other content: a draft is nowhere on the site.
      await admin.getByLabel('Status', { exact: true }).selectOption('published');
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await admin.waitForURL(/\/dashboard\/content\/forms\/[0-9a-f-]{36}$/);
      const built = await (await fetch(`${origin}/api/cms/forms/newsletter`)).json();
      expect(built.inputs.map(entry => [entry.name, entry.kind])).toEqual([['yourEmail', 'email'], ['tellUsMore', 'boolean'], ['interests', 'string']]);
      expect(built.blocks[2].when).toEqual({ rules: [{ field: 'tellUsMore', op: 'is', value: 'true' }] });
      const saved = await (await web.request(`/api/cms/content/forms/${built.id}`)).json();
      expect(saved.item.notifications.rules).toEqual([expect.objectContaining({ label: 'Admin notification', to: '{admin_email}' })]);
      // Other content does not offer input blocks.
      await admin.goto(`${origin}/dashboard/content/posts/new`);
      await ready();
      await admin.getByRole('button', { name: 'Add block' }).click();
      const picker = admin.getByRole('dialog', { name: 'Blocks' });
      await browserExpect(picker.getByRole('heading', { name: 'Widgets' })).toBeVisible();
      await browserExpect(picker.getByRole('heading', { name: 'Form inputs' })).toHaveCount(0);
      await browserExpect(picker.getByRole('button', { name: 'Form', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await app.close();
    }
  }, 600_000);
});
