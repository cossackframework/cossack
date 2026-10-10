import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeAuthSseAcceptance(root) {
  await fs.mkdir(path.join(root, 'src/pages/live-session'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/config/realtime.ts'), `export default ({ env }: { env: (key: string) => string }) => ({ enabled: !!env('APP_SECRET') });`);
  await fs.writeFile(path.join(root, 'src/pages/live-session/layout.ts'), `
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { MiddlewareHandler } from 'hono';
import { config } from '@cossackframework/framework/config';
const authorize: MiddlewareHandler = async (c, next) => {
  if (!c.get('user')?.meta?.allowed || !config('realtime.enabled')) return c.json({ code: 'FIXTURE_ACCESS_DENIED' }, 401);
  await next();
};
@Page({ middlewares: [authorize] })
export default class LiveSessionLayout extends Cossack {
  render() { return html\`\${this.children}\`; }
}
`);
  await fs.writeFile(path.join(root, 'src/pages/live-session/index.ts'), `
import { Cossack, Page, Server, State, input } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
@Page({ transport: 'sse', scope: c => 'team:' + c.get('user')?.meta?.team })
export default class LiveSession extends Cossack {
  @State() value = 'initial';
  @Server({ input: input.string() })
  async publish(value: string) { this.value = value; return 'published'; }
  render() { return html\`<p id="live-value">\${this.value}</p>
    <p id="live-status">\${this.realtime.sse.state}</p><p id="live-error">\${this.realtime.sse.lastError ?? ''}</p>\`; }
}
`);
  await fs.writeFile(path.join(root, 'src/pages/api/live-session.ts'), `
import { defineApi } from '@cossackframework/framework/api';
import { input as schema } from '@cossackframework/core';
import { getCookie } from 'hono/cookie';
import { authSessions, logout, updateUserProfile } from '../../auth';
import { User } from '../../models/User';
import { Session } from '../../models/Session';
import { sql } from '@cossackframework/database';
export const POST = defineApi({
  input: { body: schema.object({ operation: schema.string(), team: schema.string() }) },
  handler: async ({ input, c }) => {
    const { operation, team } = input.body;
    const token = getCookie(c, 'session_id') ?? '';
    if (operation === 'create') {
      const id = crypto.randomUUID();
      await User.insert({ id, email: id + '@example.invalid', name: 'Fixture', passwordHash: null,
        avatar: null, meta: { team, allowed: true }, createdAt: new Date() });
      const created = await authSessions.create(id, c);
      created.headers.forEach((value, key) => c.header(key, value));
      return c.json({ accepted: true });
    }
    if (!c.get('user')) return c.json({ accepted: false }, 401);
    if (operation === 'rotate') {
      const rotated = await authSessions.rotate(token, c);
      if (!rotated) return c.json({ accepted: false }, 409);
      rotated.headers.forEach((value, key) => c.header(key, value));
    } else if (operation === 'logout') {
      const result = await logout(c); result.headers.forEach((value, key) => c.header(key, value));
    } else if (operation === 'expire') await Session.update({ id: token }, { expiresAt: new Date(0) });
    else if (operation === 'scope') await updateUserProfile(c.get('user').id, { meta: { allowed: true, team: team + '-changed' } });
    else if (operation === 'permission') await updateUserProfile(c.get('user').id, { meta: { allowed: false, team } });
    else if (operation === 'purpose') await Session.update({ id: token }, { meta: { type: 'password_reset' } });
    else if (operation === 'storage-failure') await sql\`DROP TABLE sessions\`;
    else return c.json({ accepted: false }, 400);
    return c.json({ accepted: true });
  },
});
`);
}

export function sseReader(response) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
  return {
    async until(marker, timeout = 5000) {
      const deadline = Date.now() + timeout;
      const completeFrame = () => {
        const index = text.indexOf(marker);
        return index !== -1 && text.indexOf('\n\n', index) !== -1;
      };
      while (!completeFrame()) {
        let timer;
        try {
          const next = await Promise.race([reader.read(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('SSE timeout: ' + text)), Math.max(1, deadline - Date.now()));
          })]);
          if (next.done) throw new Error('SSE closed before marker: ' + text);
          text += decoder.decode(next.value, { stream: true });
        } finally { clearTimeout(timer); }
      }
      return text;
    },
    async ended() { expect((await reader.read()).done).toBe(true); },
    close: () => reader.cancel(),
  };
}

export async function checkAuthSseAcceptance(request, manifest, browser, origin) {
  const routeId = manifest.filePathToId['/src/pages/live-session/index.ts']; expect(routeId).toBeTruthy();
  const operate = async (operation, cookie, team) => {
    const response = await request('/api/live-session', { method: 'POST', headers: {
      'content-type': 'application/json', ...(cookie ? { cookie } : {}),
    }, body: JSON.stringify({ operation, team }) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.clone().json()).toEqual({ accepted: true }); return response;
  };
  const cookieOf = response => {
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('session_id='))?.split(';')[0];
    expect(cookie).toMatch(/^session_id=[0-9a-f]{64}$/); return cookie;
  };
  const publish = async (cookie, value, team) => {
    const response = await request('/crpc', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ componentRouteId: routeId, action: 'publish', payload: [value], scopeKey: 'team:' + team, state: {} }) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ _cossack_return: 'published' });
  };
  const subscribe = async (cookie, team, cursor) => {
    const controller = new AbortController();
    const response = await request('/sse/' + routeId + '?scopeKey=' + encodeURIComponent('team:' + team), {
      signal: controller.signal, headers: { origin, cookie, ...(cursor ? { 'last-event-id': cursor } : {}) },
    });
    expect(response.status, response.status === 200 ? '' : await response.text()).toBe(200);
    const reader = sseReader(response); await reader.until('event: connected');
    return { ...reader, close: async () => { try { await reader.close(); } finally { controller.abort(); } } };
  };

  for (const operation of ['logout', 'expire', 'scope', 'permission', 'purpose']) {
    const team = 'room-' + operation;
    const first = cookieOf(await operate('create', undefined, team));
    const other = cookieOf(await operate('create', undefined, team));
    const subscriber = await subscribe(first, team); const peer = await subscribe(other, team);
    try {
      await operate(operation, first, team);
      const value = 'PRIVATE_AFTER_' + operation; await publish(other, value, team);
      const terminal = await subscriber.until('event: authorization-error');
      expect(terminal).toContain('COSSACK_REALTIME_AUTH_CHANGED'); expect(terminal).not.toContain(value);
      expect(terminal).not.toContain(first.slice('session_id='.length)); expect(terminal).not.toContain('fingerprint');
      await subscriber.ended(); expect(await peer.until(value)).toContain(value);
    } finally { await subscriber.close(); await peer.close(); }
  }

  // A second tab rotates the shared cookie. Both old subscriptions terminate;
  // reloading that tab establishes a fresh subscription with the replacement.
  const team = 'room-rotation'; const first = cookieOf(await operate('create', undefined, team));
  const other = cookieOf(await operate('create', undefined, team)); const context = await browser.newContext();
  try {
    await context.addCookies([{ name: 'session_id', value: first.slice('session_id='.length), url: origin, httpOnly: true, secure: true }]);
    const tabs = await Promise.all([context.newPage(), context.newPage()]); const errors = []; const subscriptions = [];
    for (const page of tabs) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/sse/')) subscriptions.push(req.url()); });
      await page.goto(origin + '/live-session'); await page.waitForFunction(() => window.__cossackReady);
      await browserExpect(page.locator('#live-status')).toHaveText('open');
    }
    const rotated = await tabs[1].evaluate(async team => {
      const response = await fetch('/api/live-session', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'rotate', team }) }); return response.status;
    }, team); expect(rotated).toBe(200);
    const replacement = (await context.cookies()).find(cookie => cookie.name === 'session_id')?.value;
    expect(replacement).toMatch(/^[0-9a-f]{64}$/); expect(replacement).not.toBe(first.slice('session_id='.length));
    await publish(other, 'PRIVATE_AFTER_ROTATION', team);
    for (const page of tabs) {
      await browserExpect(page.locator('#live-status')).toHaveText('closed');
      await browserExpect(page.locator('#live-error')).toHaveText('Realtime authorization changed. Reload the page to reconnect.');
      await browserExpect(page.locator('#live-value')).not.toHaveText('PRIVATE_AFTER_ROTATION');
    }
    // EventSource normally retries after EOF. Its default retry interval is
    // allowed to pass to verify that the terminal event stopped those retries.
    await new Promise(resolve => setTimeout(resolve, 3500)); expect(subscriptions).toHaveLength(2);
    await tabs[1].reload(); await tabs[1].waitForFunction(() => window.__cossackReady);
    await browserExpect(tabs[1].locator('#live-status')).toHaveText('open');
    await publish(other, 'fresh-delivery', team);
    await browserExpect(tabs[1].locator('#live-value')).toHaveText('fresh-delivery');
    await browserExpect(tabs[0].locator('#live-value')).not.toHaveText('fresh-delivery');
    expect(errors).toEqual([]);
  } finally { await context.close(); }

  // An idle subscription must revalidate before its next heartbeat, even when
  // no other authenticated client can publish because storage has disappeared.
  const idleTeam = 'room-storage'; const idleCookie = cookieOf(await operate('create', undefined, idleTeam));
  const idle = await subscribe(idleCookie, idleTeam);
  try {
    await operate('storage-failure', idleCookie, idleTeam);
    const terminal = await idle.until('event: authorization-error', 18000);
    expect(terminal).toContain('COSSACK_REALTIME_AUTH_CHANGED'); expect(terminal).not.toContain('no such table');
    await idle.ended();
  } finally { await idle.close(); }
}
