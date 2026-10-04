import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export async function writeAuthPrimitivesAcceptance(root) {
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/api/auth-contract.ts'), `
import { input as schema } from '@cossackframework/core';
import { defineApi } from '@cossackframework/framework/api';
import { getCookie } from 'hono/cookie';
import { auth, authSessions, registerUser, loginUser, logout } from '../../auth';
import { User } from '../../models/User';
import { Session } from '../../models/Session';

export const POST = defineApi({
  input: { body: schema.object({ operation: schema.string(), email: schema.string(), password: schema.string() }) },
  handler: async ({ input, c }) => {
    const { operation, email, password } = input.body;
    const token = getCookie(c, authSessions.cookieName) ?? '';
    if (operation === 'register') {
      const user = await registerUser(email, password, 'Fixture');
      const stored = await User.findOne({ where: { id: user.id } });
      return c.json({ accepted: true, versionedHash: stored!.passwordHash!.startsWith('pbkdf2-sha256$100000$') });
    }
    if (operation === 'login' || operation === 'create') {
      const user = await loginUser(email, password);
      if (user && operation === 'create') {
        const { headers } = await auth.createSession!(user, c);
        headers.forEach((value, key) => c.header(key, value));
      }
      return c.json({ accepted: user !== null, email: user?.email ?? null });
    }
    if (operation === 'validate') return c.json({ accepted: (await authSessions.validate(token, c)) !== null,
      authenticated: Boolean(c.get('user')) });
    if (operation === 'rotate') {
      const replacement = await authSessions.rotate(token, c);
      if (!replacement) return c.json({ accepted: false }, 409);
      replacement.headers.forEach((value, key) => c.header(key, value));
      return c.json({ accepted: true });
    }
    if (operation === 'logout') {
      const { headers } = await logout(c);
      headers.forEach((value, key) => c.header(key, value));
      return c.json({ accepted: true });
    }
    if (operation === 'expire') {
      await Session.update({ id: token }, { expiresAt: new Date(0) });
      return c.json({ accepted: true });
    }
    if (operation === 'reset-token') {
      const user = await User.findOne({ where: { email } });
      const id = crypto.randomUUID();
      await Session.insert({ id, userId: user!.id, data: null, meta: { type: 'password_reset' },
        createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000), location: null, userAgent: null, ipAddress: null });
      c.header('Set-Cookie', 'session_id=' + id + '; Path=/; HttpOnly; Secure; SameSite=Lax');
      return c.json({ accepted: true });
    }
    if (operation === 'reset-exists') return c.json({ exists: await Session.exists({ id: token }) });
    return c.json({ error: 'Unknown fixture operation' }, 400);
  },
});
`);
}

export async function checkAuthPrimitives(request) {
  const email = 'primitives-fixture@example.invalid';
  const password = 'FIXTURE_PASSWORD_PRIVATE_HASH_SESSION_POLICY';
  const send = async (operation, cookie, suppliedPassword = password) => {
    const response = await request('/api/auth-contract', { method: 'POST', headers: {
      'content-type': 'application/json', ...(cookie ? { cookie } : {}),
    }, body: JSON.stringify({ operation, email, password: suppliedPassword }) });
    const text = await response.clone().text();
    expect(text).not.toContain(password);
    expect(text).not.toContain('passwordHash');
    return response;
  };
  const cookie = response => {
    expect(response.headers.get('set-cookie')).toMatch(/session_id=[0-9a-f]{64};.*HttpOnly;.*Secure;.*SameSite=Lax/);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const registration = await send('register');
  expect(registration.status, await registration.clone().text()).toBe(200);
  expect(await registration.json()).toEqual({ accepted: true, versionedHash: true });
  expect(await (await send('login', undefined, 'wrong-password')).json()).toEqual({ accepted: false, email: null });
  expect(await (await send('login')).json()).toEqual({ accepted: true, email });
  const creation = await send('create');
  expect(creation.status).toBe(200);
  const original = cookie(creation);
  expect(await (await send('validate', original)).json()).toEqual({ accepted: true, authenticated: true });
  const rotations = await Promise.all([send('rotate', original), send('rotate', original)]);
  expect(rotations.map(response => response.status).sort()).toEqual([200, 409]);
  const replacement = cookie(rotations.find(response => response.status === 200));
  expect(replacement).not.toBe(original);
  expect(await (await send('validate', original)).json()).toEqual({ accepted: false, authenticated: false });
  expect(await (await send('validate', replacement)).json()).toEqual({ accepted: true, authenticated: true });
  const revoked = await send('logout', replacement);
  expect(revoked.headers.get('set-cookie')).toMatch(/session_id=;.*Max-Age=0;.*Path=\/;.*HttpOnly;.*Secure;.*SameSite=Lax/);
  expect(await (await send('validate', replacement)).json()).toEqual({ accepted: false, authenticated: false });
  const expiring = cookie(await send('create'));
  expect((await send('expire', expiring)).status).toBe(200);
  expect(await (await send('validate', expiring)).json()).toEqual({ accepted: false, authenticated: false });
  expect((await send('rotate', expiring)).status).toBe(409);
  const reset = (await send('reset-token')).headers.get('set-cookie').split(';')[0];
  expect(await (await send('validate', reset)).json()).toEqual({ accepted: false, authenticated: false });
  expect((await send('rotate', reset)).status).toBe(409);
  await send('logout', reset);
  expect(await (await send('reset-exists', reset)).json()).toEqual({ exists: true });
}
