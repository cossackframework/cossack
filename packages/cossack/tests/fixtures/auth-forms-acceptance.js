import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

const privateValue = 'PRIVATE_AUTH_FORM_STORAGE';
const password = 'PRIVATE_FORM_PASSWORD_🙂_123';

export async function writeAuthFormsAcceptance(root) {
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  // Fixture setup/inspection only. All auth actions and HTML use original pages.
  await fs.writeFile(path.join(root, 'src/pages/api/auth-forms-contract.ts'), `
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { sql } from '@cossackframework/database';
import { authSessions } from '../../auth';
import { User } from '../../models/User';
import { Session } from '../../models/Session';
export const POST = async (c: Context) => {
  const { operation, email = '', fault = '' } = await c.req.json();
  if (operation === 'inspect') {
    const user = await User.findOne({ where: { email } });
    const accepted = await authSessions.validate(getCookie(c, authSessions.cookieName) ?? '', c);
    return c.json({ origin: new URL(c.req.url).origin, exists: !!user, accepted: !!accepted,
      sessions: user ? await Session.count({ userId: user.id }) : 0 });
  }
  if (operation === 'reset' || operation === 'expired-reset') {
    const user = await User.findOne({ where: { email } });
    const token = crypto.randomUUID();
    await Session.insert({ id: token, userId: user!.id, publicId: null, data: null,
      meta: { type: 'password_reset' }, createdAt: new Date(),
      expiresAt: new Date(operation === 'reset' ? Date.now() + 3600000 : 0),
      location: null, userAgent: null, ipAddress: null });
    return c.json({ token });
  }
  const failures = {
    insert: 'BEFORE INSERT ON sessions',
    delete: 'BEFORE DELETE ON sessions',
    update: 'BEFORE UPDATE ON sessions',
    user: 'BEFORE INSERT ON users',
  };
  if (operation === 'fault-on' && Object.hasOwn(failures, fault)) {
    const trigger = failures[fault as keyof typeof failures];
    await sql\`\${sql.unsafe("CREATE TRIGGER auth_form_failure " + trigger + " BEGIN SELECT RAISE(ABORT, '${privateValue}'); END")}\`;
    return c.json({ accepted: true });
  }
  if (operation === 'fault-off') {
    await sql\`\${sql.unsafe('DROP TRIGGER auth_form_failure')}\`;
    return c.json({ accepted: true });
  }
  return c.json({ error: 'Unknown fixture operation' }, 400);
};
`);
}

export async function checkAuthFormsAcceptance(request, manifest, browser, browserOrigin) {
  const ids = Object.fromEntries(['login', 'register', 'forgot-password', 'reset-password'].map(name =>
    [name, manifest.filePathToId[`/src/pages/auth/${name}/index.ts`]]));
  ids.sessions = manifest.filePathToId['/src/pages/dashboard/sessions/index.ts'];
  ids.layout = manifest.filePathToId['/src/pages/dashboard/layout.ts'];
  for (const id of Object.values(ids)) expect(id).toBeTruthy();
  const secrets = [privateValue, password];
  const fixture = async (operation, email = '', cookie = '', fault = '') => {
    const response = await request('/api/auth-forms-contract', { method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ operation, email, fault }) });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  const { origin } = await fixture('inspect');
  const safeText = async response => {
    const text = await response.text();
    for (const secret of secrets) expect(text).not.toContain(secret);
    return text;
  };
  const cookieOf = response => {
    const header = response.headers.getSetCookie().find(value => value.startsWith('session_id='));
    expect(header).toMatch(/HttpOnly;.*Secure;.*SameSite=Lax/);
    const cookie = header.split(';')[0];
    secrets.push(cookie.slice('session_id='.length));
    return cookie;
  };
  const noCookie = response => expect(response.headers.get('set-cookie') ?? '').not.toContain('session_id=');
  const rpc = async (page, action, payload = [], cookie = '', status = 200) => {
    const response = await request('/crpc', { method: 'POST', headers: {
      origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ componentRouteId: ids[page], action, payload,
        state: { public: { form: { email: 'forged@example.invalid', password }, error: 'forged' }, user: { id: 'forged' } } }) });
    expect(response.status, await response.clone().text()).toBe(status);
    const body = JSON.parse(await safeText(response));
    expect(body).not.toHaveProperty('form');
    return { response, body };
  };
  const ssr = async (route, cookie = '') => {
    const response = await request(route, { headers: cookie ? { cookie } : {} });
    expect(response.status, await response.clone().text()).toBe(200);
    const text = await safeText(response);
    const state = JSON.parse(text.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]);
    expect(state.public).not.toHaveProperty('form');
    expect(state.public).not.toHaveProperty('password');
    return state.public;
  };
  for (const route of ['login', 'register', 'forgot-password', 'reset-password']) await ssr('/auth/' + route);
  const email = 'forms-owner@example.invalid';
  for (const args of [[], [null], ['bad'], [{ name: 'Owner', email, password: 'short' }],
    [{ name: 'Owner', email: 'a'.repeat(180) + '@example.test', password }],
    [{ name: 'Owner', email, password, admin: true }], [{ name: 'Owner', email, password }, 'extra'],
    [{ name: 'Owner', email, password: '🙂'.repeat(257) }]]) {
    const rejected = await rpc('register', 'register', args, '', 400);
    noCookie(rejected.response);
    expect(await fixture('inspect', email)).toMatchObject({ exists: false, sessions: 0 });
  }
  const registered = await rpc('register', 'register', [{ name: 'Owner', email, password }]);
  expect(registered.body).toMatchObject({ _cossack_redirect: '/dashboard' });
  let cookie = cookieOf(registered.response);
  expect(await fixture('inspect', email, cookie)).toMatchObject({ exists: true, accepted: true, sessions: 1 });
  expect((await rpc('register', 'register', [{ name: 'Owner', email, password }])).body.error)
    .toBe('An account with this email already exists.');
  const invalid = await rpc('login', 'login', [{ email, password: 'wrong-password' }]);
  expect(invalid.body.error).toBe('Invalid credentials'); noCookie(invalid.response);
  for (const [route, action, submitted] of [
    ['login', 'login', { email: 'invalid', password }],
    ['forgot-password', 'requestReset', { email: ['bad'] }],
    ['reset-password', 'doReset', { token: '', password }],
  ]) expect((await rpc(route, action, [submitted], '', 400)).body.code).toBe('COSSACK_VALIDATION_FAILED');

  const fault = async (kind, work) => {
    await fixture('fault-on', '', '', kind);
    try { await work(); } finally { await fixture('fault-off'); }
  };
  await fault('user', async () => {
    const rejected = await rpc('register', 'register', [{ name: '', email: 'forms-no-user@example.invalid', password }]);
    expect(rejected.body.error).toBe('Could not create the account. Try again or sign in.'); noCookie(rejected.response);
    expect(await fixture('inspect', 'forms-no-user@example.invalid')).toMatchObject({ exists: false });
  });
  const partialEmail = 'forms-partial@example.invalid';
  await fault('insert', async () => {
    const failed = await rpc('login', 'login', [{ email, password }]);
    expect(failed.body.error).toBe('Could not sign in. Try again.'); noCookie(failed.response);
    const partial = await rpc('register', 'register', [{ name: 'Partial', email: partialEmail, password }]);
    expect(partial.body.error).toBe('Could not create the account. Try again or sign in.'); noCookie(partial.response);
    expect(await fixture('inspect', partialEmail)).toMatchObject({ exists: true, sessions: 0 });
    await rpc('forgot-password', 'requestReset', [{ email }], '', 400);
  });
  const partialLogin = await rpc('login', 'login', [{ email: partialEmail, password }]);
  expect(partialLogin.body._cossack_redirect).toBe('/dashboard'); cookieOf(partialLogin.response);
  const known = await rpc('forgot-password', 'requestReset', [{ email }]);
  const unknown = await rpc('forgot-password', 'requestReset', [{ email: 'unknown@example.invalid' }]);
  expect(known.body).toEqual(unknown.body);
  await fault('delete', async () => {
    const failed = await rpc('layout', 'doLogout', [], cookie);
    expect(failed.body.logoutError).toBe('Could not sign out. Try again.'); noCookie(failed.response);
    expect(await fixture('inspect', email, cookie)).toMatchObject({ accepted: true });
  });
  const before = (await ssr('/dashboard/sessions', cookie)).sessions.find(row => row.current).reference;
  await fault('update', async () => {
    const failed = await rpc('sessions', 'rotateCurrent', [], cookie);
    expect(failed.body.error).toBe('Could not rotate session. Try again.'); noCookie(failed.response);
    expect(await fixture('inspect', email, cookie)).toMatchObject({ accepted: true });
  });
  const rotated = await rpc('sessions', 'rotateCurrent', [], cookie);
  expect(rotated.body._cossack_redirect).toBe('/dashboard/sessions');
  const oldCookie = cookie; cookie = cookieOf(rotated.response);
  expect(cookie).not.toBe(oldCookie);
  expect(await fixture('inspect', email, oldCookie)).toMatchObject({ accepted: false });
  expect((await ssr('/dashboard/sessions', cookie)).sessions.find(row => row.current).reference).toBe(before);
  const loggedOut = await rpc('layout', 'doLogout', [], cookie);
  expect(loggedOut.body._cossack_redirect).toBe('/auth/login');
  expect(loggedOut.response.headers.get('set-cookie')).toMatch(/session_id=;.*Max-Age=0/);
  expect(await fixture('inspect', email, cookie)).toMatchObject({ accepted: false });
  await rpc('layout', 'doLogout', [], cookie, 401);

  const { token: expired } = await fixture('expired-reset', email);
  secrets.push(expired);
  for (const token of ['invalid-token', expired]) {
    expect((await rpc('reset-password', 'doReset', [{ token, password }])).body.error).toBe('Invalid or expired reset link');
  }
  const { token } = await fixture('reset', email); secrets.push(token);
  await fault('delete', async () => {
    expect((await rpc('reset-password', 'doReset', [{ token, password }])).body.error)
      .toBe('Could not reset the password. Request a new reset link.');
  });
  const races = await Promise.all([rpc('reset-password', 'doReset', [{ token, password }]),
    rpc('reset-password', 'doReset', [{ token, password }])]);
  expect(races.filter(result => result.body._cossack_redirect === '/auth/login')).toHaveLength(1);
  expect(races.filter(result => result.body.error === 'Invalid or expired reset link')).toHaveLength(1);

  // Use real browser drafts, validation, RPC hydration, redirects and cookies.
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); const errors = []; const calls = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    const replies = [];
    page.on('response', async res => {
      if (new URL(res.url()).pathname !== '/crpc') return;
      try { replies.push({ action: res.request().postDataJSON().action, status: res.status(), body: await res.json() }); } catch {}
    });
    page.on('request', req => { if (new URL(req.url()).pathname === '/crpc') calls.push(req.postDataJSON()); });
    await page.goto(browserOrigin + '/auth/login');
    await page.waitForFunction(() => window.__cossackReady === true);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toContainText('Invalid credentials');
    await browserExpect(page.getByLabel('Password', { exact: true })).toHaveValue('wrong-password');
    await fault('insert', async () => {
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await browserExpect(page.getByRole('alert')).toContainText('Could not sign in. Try again.');
      await browserExpect(page.getByLabel('Password', { exact: true })).toHaveValue(password);
      expect((await context.cookies()).some(c => c.name === 'session_id')).toBe(false);
    });
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await browserExpect(page).toHaveURL(browserOrigin + '/dashboard');
    await page.goto(browserOrigin + '/dashboard/sessions');
    await page.waitForFunction(() => window.__cossackReady === true);
    await browserExpect(page.getByText('Current', { exact: true })).toBeVisible();
    const browserCookie = (await context.cookies()).find(c => c.name === 'session_id');
    expect(browserCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    await page.getByRole('button', { name: 'Rotate current session', exact: true }).click();
    await browserExpect.poll(async () => (await context.cookies()).find(c => c.name === 'session_id')?.value).not.toBe(browserCookie.value);
    await browserExpect(page.getByText('Current', { exact: true })).toBeVisible();
    const menu = page.locator('#dashboard-account-menu');
    await fault('delete', async () => {
      await menu.click(); await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
      await browserExpect(page.getByRole('alert')).toContainText('Could not sign out. Try again.');
    });
    await menu.click(); await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
    await browserExpect(page).toHaveURL(browserOrigin + '/auth/login');
    expect((await context.cookies()).some(c => c.name === 'session_id')).toBe(false);

    await page.goto(browserOrigin + '/auth/forgot-password');
    await page.waitForFunction(() => window.__cossackReady === true);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await fault('insert', async () => {
      await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
      await browserExpect(page.getByRole('alert')).toContainText('Could not send the reset link. Try again.');
      await browserExpect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
    });
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await browserExpect(page.getByText('Check your email', { exact: true })).toBeVisible();
    const { token: browserToken } = await fixture('reset', email);
    await page.goto(browserOrigin + '/auth/reset-password?token=' + browserToken);
    await page.waitForFunction(() => window.__cossackReady === true);
    const replacement = 'PRIVATE_FORM_REPLACEMENT_123';
    await page.getByLabel('New Password', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click();
    await browserExpect(page).toHaveURL(browserOrigin + '/auth/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    try { await browserExpect(page).toHaveURL(browserOrigin + '/dashboard'); }
    catch (error) { throw new Error(`${error.stack ?? error}\nRecorded auth replies: ${JSON.stringify(replies)}\nCalls: ${JSON.stringify(calls)}`); }
    await context.clearCookies();
    await page.goto(browserOrigin + '/auth/register');
    await page.waitForFunction(() => window.__cossackReady === true);
    await page.getByLabel('Name', { exact: true }).fill('Browser');
    await page.getByLabel('Email', { exact: true }).fill('forms-browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await browserExpect(page).toHaveURL(browserOrigin + '/dashboard');
    for (const call of calls) {
      expect(call.state.public ?? {}).not.toHaveProperty('form');
      expect(JSON.stringify(call.state)).not.toContain(password);
      expect(JSON.stringify(call.state)).not.toContain(replacement);
      expect(JSON.stringify(call.state)).not.toContain(browserToken);
      expect(call.action).not.toMatch(/validate/i);
    }
    const resetCall = calls.find(call => call.action === 'doReset');
    expect(resetCall.payload).toEqual([{ token: browserToken, password: replacement }]);
    expect(calls.filter(call => call.action === 'login')).toHaveLength(4);
    expect(errors).toEqual([]);
  } catch (error) { throw new Error(`${error.stack ?? error}`); } finally { await context.close(); }
}
