import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

const privateValue = 'PRIVATE_DASHBOARD_DATABASE_PASSWORD_DATA';

export async function writeSessionDashboardAcceptance(root) {
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  // Fixture-only setup and inspection. The dashboard itself runs unmodified.
  await fs.writeFile(path.join(root, 'src/pages/api/session-dashboard-contract.ts'), `
import { input as schema } from '@cossackframework/core';
import { defineApi } from '@cossackframework/framework/api';
import { getCookie } from 'hono/cookie';
import { sql } from '@cossackframework/database';
import { authSessions, registerUser } from '../../auth';
import { User } from '../../models/User';
import { Session } from '../../models/Session';

export const POST = defineApi({
  input: { body: schema.object({ operation: schema.string(), account: schema.string(), reference: schema.string() }) },
  handler: async ({ input, c }) => {
    const { operation, account, reference } = input.body;
    const token = getCookie(c, authSessions.cookieName) ?? '';
    if (operation === 'create') {
      const email = 'dashboard-' + account + '@example.invalid';
      const user = await User.findOne({ where: { email } }) ?? await registerUser(email, 'fixture-dashboard-password', account);
      const { headers } = await authSessions.create(user.id, c);
      headers.forEach((value, key) => c.header(key, value));
      return c.json({ origin: new URL(c.req.url).origin });
    }
    if (operation === 'validate') return c.json({ accepted: (await authSessions.validate(token, c)) !== null,
      authenticated: Boolean(c.get('user')) });
    if (operation === 'rotate') {
      const rotated = await authSessions.rotate(token, c);
      if (!rotated) return c.json({ accepted: false }, 409);
      rotated.headers.forEach((value, key) => c.header(key, value));
      return c.json({ accepted: true });
    }
    if (operation === 'legacy') {
      await Session.update({ id: token }, { publicId: null, data: { credential: '${privateValue}' } });
      return c.json({ accepted: true });
    }
    if (operation === 'reset' || operation === 'state') {
      const user = await authSessions.validate(token, c);
      const id = crypto.randomUUID();
      const publicId = crypto.randomUUID();
      await Session.insert({ id, publicId, userId: user!.userId, data: { credential: '${privateValue}' },
        meta: operation === 'reset' ? { type: 'password_reset' } : { type: 'oauth_state', provider: 'fixture' },
        createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000), location: null, userAgent: null, ipAddress: null });
      c.header('Set-Cookie', 'session_id=' + id + '; Path=/; HttpOnly; Secure; SameSite=Lax');
      return c.json({ reference: publicId });
    }
    if (operation === 'exists') return c.json({ exists: await Session.exists({ id: token }) });
    if (operation === 'fault-on') {
      await sql\`\${sql.unsafe("CREATE TRIGGER dashboard_fixture_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, '${privateValue}'); END")}\`;
      return c.json({ accepted: true });
    }
    if (operation === 'fault-off') {
      await sql\`\${sql.unsafe('DROP TRIGGER dashboard_fixture_failure')}\`;
      return c.json({ accepted: true });
    }
    return c.json({ error: 'Unknown fixture operation' }, 400);
  },
});
`);
}

export async function checkSessionDashboard(request, routeId) {
  const secrets = [privateValue];
  let origin;
  const cookieOf = response => {
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('session_id='))?.split(';')[0];
    expect(cookie).toBeTruthy();
    secrets.push(cookie.slice('session_id='.length));
    return cookie;
  };
  const fixture = async (operation, cookie, account = 'owner') => {
    const response = await request('/api/session-dashboard-contract', { method: 'POST', headers: {
      'content-type': 'application/json', ...(cookie ? { cookie } : {}),
    }, body: JSON.stringify({ operation, account, reference: '' }) });
    expect(response.status, await response.clone().text()).toBe(200);
    return response;
  };
  const create = async account => {
    const response = await fixture('create', undefined, account);
    origin = (await response.clone().json()).origin;
    return cookieOf(response);
  };
  const safeText = async response => {
    const text = await response.text();
    for (const secret of secrets) expect(text).not.toContain(secret);
    return text;
  };
  const dashboard = async cookie => {
    const response = await request('/dashboard/sessions', { headers: { cookie } });
    expect(response.status, await response.clone().text()).toBe(200);
    const text = await safeText(response);
    const state = JSON.parse(text.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]);
    expect(state.public.error).toBe('');
    for (const row of state.public.sessions) {
      expect(row.reference).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Object.keys(row).sort()).toEqual(['reference', 'current', 'createdAt', 'expiresAt', 'location', 'userAgent', 'ipAddress'].sort());
    }
    return state.public.sessions;
  };
  const rpc = async (action, payload, cookie, expectedStatus = 200) => {
    const response = await request('/crpc', { method: 'POST', headers: {
      origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
    }, body: JSON.stringify({ componentRouteId: routeId, action, payload,
      state: { public: { sessions: [{ reference: 'forged', current: false }], error: 'forged' }, user: { id: 'forged-owner' } } }) });
    if (Array.isArray(expectedStatus)) expect(expectedStatus, await response.clone().text()).toContain(response.status);
    else expect(response.status, await response.clone().text()).toBe(expectedStatus);
    const text = await safeText(response);
    return { response, body: JSON.parse(text) };
  };
  const accepted = async cookie => {
    const body = await (await fixture('validate', cookie)).json();
    expect(body.authenticated).toBe(body.accepted);
    return body.accepted;
  };
  let owner = await create('owner');
  const target = await create('owner');
  const victim = await create('victim');
  const guest = await request('/dashboard/sessions');
  expect(guest.status).toBe(302);
  expect(guest.headers.get('location')).toBe('/auth/login');
  expect(guest.headers.get('set-cookie') ?? '').not.toContain('cossack_sid');
  const publicPage = await request('/');
  expect(publicPage.status).toBe(200);
  expect(publicPage.headers.get('set-cookie') ?? '').not.toContain('cossack_sid');
  expect((await rpc('revokeAll', [], undefined, 401)).body.code).toBe('COSSACK_RPC_UNAUTHENTICATED');

  await fixture('legacy', owner);
  const snapshots = await Promise.all([dashboard(owner), dashboard(owner)]);
  const current = snapshots[0].find(row => row.current);
  const other = snapshots[0].find(row => !row.current);
  expect(snapshots[0]).toHaveLength(2);
  expect(snapshots[1].find(row => row.current).reference).toBe(current.reference);
  expect(await accepted('session_id=' + current.reference)).toBe(false);
  const victimReference = (await dashboard(victim))[0].reference;
  const resetResponse = await fixture('reset', owner);
  const reset = { cookie: cookieOf(resetResponse), ...(await resetResponse.json()) };
  const stateResponse = await fixture('state', owner);
  const state = { cookie: cookieOf(stateResponse), ...(await stateResponse.json()) };

  for (const reference of [current.reference, victimReference, reset.reference, state.reference,
    target.slice('session_id='.length), crypto.randomUUID(), { reference: other.reference }]) {
    const { body } = await rpc('revoke', [reference], owner);
    expect(body.error).toBe('Could not revoke session.');
    expect(await accepted(owner)).toBe(true);
    expect(await accepted(target)).toBe(true);
    expect(await accepted(victim)).toBe(true);
  }
  for (const row of [reset, state]) expect(await (await fixture('exists', row.cookie)).json()).toEqual({ exists: true });

  const currentRace = await Promise.all([fixture('rotate', owner), rpc('revoke', [current.reference], owner, [200, 401])]);
  owner = cookieOf(currentRace[0]);
  expect(await accepted(owner)).toBe(true);
  expect(currentRace[1].body).toMatchObject(currentRace[1].response.status === 401
    ? { code: 'COSSACK_RPC_UNAUTHENTICATED' } : { error: 'Could not revoke session.' });

  await fixture('fault-on', owner);
  try {
    expect((await rpc('revoke', [other.reference], owner)).body.error).toBe('Could not revoke session.');
    expect(await accepted(owner)).toBe(true);
    expect((await rpc('revokeAllExceptCurrent', [], owner)).body.error).toBe('Could not revoke sessions.');
    expect(await accepted(owner)).toBe(true);
    const failedAll = await rpc('revokeAll', [], owner);
    expect(failedAll.body.error).toBe('Could not revoke sessions.');
    expect(failedAll.response.headers.get('set-cookie') ?? '').not.toContain('session_id=;');
    expect(await accepted(owner)).toBe(true);
    expect(await accepted(target)).toBe(true);
  } finally { await fixture('fault-off', owner); }

  const rotated = cookieOf(await fixture('rotate', target));
  const afterRotation = await dashboard(owner);
  expect(afterRotation.find(row => !row.current).reference).toBe(other.reference);
  const revocations = await Promise.all([rpc('revoke', [other.reference], owner), rpc('revoke', [other.reference], owner)]);
  expect(revocations.map(result => result.body.error).sort()).toEqual(['', 'Could not revoke session.']);
  expect(await accepted(rotated)).toBe(false);
  expect(await accepted(owner)).toBe(true);
  expect((await dashboard(owner))).toHaveLength(1);

  const bulkTarget = await create('owner');
  const bulkRace = await Promise.all([fixture('rotate', owner), rpc('revokeAllExceptCurrent', [], owner, [200, 401])]);
  owner = cookieOf(bulkRace[0]);
  expect(await accepted(owner)).toBe(true);
  expect((await rpc('revokeAllExceptCurrent', [], owner)).body.error).toBe('');
  expect(await accepted(bulkTarget)).toBe(false);
  expect(await accepted(owner)).toBe(true);
  expect(await accepted(victim)).toBe(true);
  const everywhere = await rpc('revokeAll', [], owner);
  expect(everywhere.body).toMatchObject({ _cossack_redirect: '/auth/login' });
  expect(everywhere.response.headers.get('set-cookie')).toMatch(/session_id=;.*Max-Age=0;.*HttpOnly;.*Secure;.*SameSite=Lax/);
  expect(await accepted(owner)).toBe(false);
  expect(await accepted(victim)).toBe(true);
  for (const row of [reset, state]) expect(await (await fixture('exists', row.cookie)).json()).toEqual({ exists: true });
}
