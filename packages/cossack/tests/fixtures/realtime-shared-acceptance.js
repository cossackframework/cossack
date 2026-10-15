// Realtime state shared across different page files: a realtime layout with a
// per-user scope, and a realtime child component embedded in several pages.
// The same fixture runs in a generated production Node app and in workerd.
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
import { WebSocket } from 'ws';

const layoutPath = '/src/pages/(live)/layout.ts';
const cartId = '/src/components/CartBadge.ts#CartBadge';
const emptyId = '/src/components/BrokenScopes.ts#EmptyScope';
const throwingId = '/src/components/BrokenScopes.ts#ThrowingScope';

export async function writeRealtimeSharedAcceptance(root) {
  const write = async (file, code) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, code);
  };
  // Test-only identity source. This is not an authentication example. A
  // replayed realtime check carries the captured reference, not the cookie.
  await write('src/bootstrap/middlewares.ts', `export default [async (c: any, next: () => Promise<void>) => {
    const replayed = c.get('cossack.realtimeIdentity')?.data?.reference;
    const cookie = /(?:^|;\\s*)test-viewer=([A-Za-z0-9_-]+)/.exec(c.req.header('cookie') ?? '')?.[1];
    const id = typeof replayed === 'string' ? replayed : cookie;
    if (id) {
      c.set('user', { id });
      c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: id } }));
    }
    await next();
  }];`);
  await write('src/realtime-fixture.ts', `
    // One live instance per signed-in user. Anonymous requests never get a key.
    export function perUser(c: any): string {
      const user = c.get('user');
      if (!user?.id) throw Object.assign(new Error('Authentication required'), { authorizationCode: 'COSSACK_AUTH_UNAUTHENTICATED' });
      return 'user:' + user.id;
    }
  `);
  await write('src/components/CartBadge.ts', `
    import { Component, Cossack, Server, State } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { perUser } from '../realtime-fixture';
    @Component({ transport: 'durable-object', scope: perUser })
    export class CartBadge extends Cossack {
      @State() count = 0;
      @Server() add() { return ++this.count; }
      render() {
        return html\`<p><span data-testid="cart-count">\${this.count}</span>
          <span data-testid="cart-status">\${this.realtime.websocket.state}</span>
          <button data-testid="cart-add" @click=\${this.add}>Add</button></p>\`;
      }
    }
  `);
  // Registered realtime components whose scope fails closed.
  await write('src/components/BrokenScopes.ts', `
    import { Component, Cossack } from '@cossackframework/core';
    @Component({ transport: 'durable-object', scope: () => '' }) export class EmptyScope extends Cossack {}
    @Component({ transport: 'durable-object', scope: () => { throw new Error('scope failed'); } }) export class ThrowingScope extends Cossack {}
  `);
  // A child without a transport runs in its realtime page's instance.
  await write('src/components/Echo.ts', `
    import { Client, ClientState, Component, Cossack, Server } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Component() export class Echo extends Cossack {
      @ClientState() reply = '';
      @Server() hello() { return 'hello ' + (this.user?.id ?? 'guest'); }
      @Client() async ask() { this.reply = await this.hello(); }
      render() { return html\`<button data-testid="echo" @click=\${this.ask}>Echo</button><output data-testid="echo-reply">\${this.reply}</output>\`; }
    }
  `);
  await write('src/pages/(live)/layout.ts', `
    import { Cossack, Page, Server, State } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { perUser } from '../../realtime-fixture';
    @Page({ transport: 'durable-object', scope: perUser })
    export default class LiveLayout extends Cossack {
      @State() notifications = 0;
      @Server() notify() { return ++this.notifications; }
      render() {
        return html\`<section>
          <span data-testid="layout-count">\${this.notifications}</span>
          <span data-testid="layout-status">\${this.realtime.websocket.state}</span>
          <button data-testid="layout-notify" @click=\${this.notify}>Notify</button>
          <a data-testid="to-a" href="/live-a">A</a> <a data-testid="to-b" href="/live-b/one">B</a>
          \${this.children}
        </section>\`;
      }
    }
  `);
  await write('src/pages/(live)/live-a/index.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { component, html } from '@cossackframework/renderer';
    import { CartBadge } from '../../../components/CartBadge';
    @Page({ transport: 'http' })
    export default class LiveA extends Cossack { render() { return html\`<h1>Page A</h1>\${component(CartBadge)}\`; } }
  `);
  await write('src/pages/(live)/live-b/[item]/index.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { component, html } from '@cossackframework/renderer';
    import { CartBadge } from '../../../../components/CartBadge';
    // A page policy that denies one param value.
    const denyBlocked = async (c: any, next: () => Promise<void>) => {
      if (c.req.param('item') === 'blocked') return c.json({ error: 'Forbidden', code: 'COSSACK_AUTH_FORBIDDEN' }, 403);
      await next();
    };
    @Page({ transport: 'http', middlewares: [denyBlocked] })
    export default class LiveB extends Cossack { render() { return html\`<h1>Page B \${this.c.req.param('item')}</h1>\${component(CartBadge)}\`; } }
  `);
  await write('src/pages/shop/index.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { component, html } from '@cossackframework/renderer';
    import { CartBadge } from '../../components/CartBadge';
    @Page({ transport: 'http' })
    export default class Shop extends Cossack { render() { return html\`<h1>Shop</h1>\${component(CartBadge)}\`; } }
  `);
  await write('src/pages/echo-room/index.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { component, html } from '@cossackframework/renderer';
    import { Echo } from '../../components/Echo';
    @Page({ transport: 'durable-object' })
    export default class EchoRoom extends Cossack { render() { return html\`<h1>Echo room</h1>\${component(Echo)}\`; } }
  `);
  // Cloudflare: the application Durable Object hosts every realtime owner.
  const configPath = path.join(root, 'wrangler.jsonc');
  let config;
  try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (config) {
    config.durable_objects.bindings.push({ name: 'COSSACK_OBJECT', class_name: 'AppDurableObject' });
    config.migrations.push({ tag: 'realtime-v2', new_sqlite_classes: ['AppDurableObject'] });
    await fs.writeFile(configPath, JSON.stringify(config));
  }
}

async function initialState(origin, pathname, user) {
  const response = await fetch(origin + pathname, { headers: user ? { cookie: `test-viewer=${user}` } : {} });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]);
}
const layoutState = state => state._layout_stack.find(entry => entry.path === layoutPath).state;
const onPage = state => ({ page: state.componentRouteId, pathname: state.pathname, params: JSON.stringify(state.metadata.params) });

/** Upgrade `/ws/:target`: the HTTP status, and the first frame of an accepted socket. */
function upgrade(origin, target, query, user) {
  return new Promise((resolve, reject) => {
    const url = `${origin.replace('http', 'ws')}/ws/${encodeURIComponent(target)}?${new URLSearchParams(query)}`;
    const socket = new WebSocket(url, { headers: { origin, ...(user ? { cookie: `test-viewer=${user}` } : {}) } });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error(`No upgrade outcome for ${url}`)); }, 15000);
    socket.on('error', () => {});
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer); response.resume(); socket.terminate(); resolve({ status: response.statusCode });
    });
    socket.once('message', data => { clearTimeout(timer); socket.close(); resolve({ status: 101, frame: JSON.parse(String(data)) }); });
  });
}

/** Targets, guards and fail-closed scopes on the wire. */
export async function checkRealtimeSharedProtocol(origin) {
  const a = await initialState(origin, '/live-a', 'alice');
  const b = await initialState(origin, '/live-b/one', 'alice');
  const shop = await initialState(origin, '/shop', 'alice');
  const bob = await initialState(origin, '/live-a', 'bob');
  const anonymous = await initialState(origin, '/live-a');
  // One layout instance per user for both pages; one component instance per
  // user for every page that embeds it.
  expect(layoutState(a).realtime.target).toBe(layoutState(b).realtime.target);
  expect(layoutState(bob).realtime.target).not.toBe(layoutState(a).realtime.target);
  expect(a.realtimeComponents[cartId]).toBe(b.realtimeComponents[cartId]);
  expect(shop.realtimeComponents[cartId]).toBe(a.realtimeComponents[cartId]);
  expect(bob.realtimeComponents[cartId]).not.toBe(a.realtimeComponents[cartId]);
  // An anonymous visitor gets the page, without realtime targets.
  expect(layoutState(anonymous).realtime).toBeUndefined();
  expect(anonymous.realtimeComponents).toBeUndefined();

  const layout = { layout: a._layout_stack.find(entry => entry.path === layoutPath).componentRouteId };
  const cart = { component: cartId };
  const aliceLayout = layoutState(a).realtime.target;
  const aliceCart = a.realtimeComponents[cartId];
  expect(await upgrade(origin, aliceLayout, { ...layout, ...onPage(b) }, 'alice')).toMatchObject({ status: 101, frame: { type: 'state-update' } });
  expect(await upgrade(origin, aliceCart, { ...cart, ...onPage(shop) }, 'alice')).toMatchObject({ status: 101, frame: { type: 'state-update' } });
  // Forged targets are recomputed and rejected.
  for (const [target, owner] of [[layoutState(bob).realtime.target, layout], [bob.realtimeComponents[cartId], cart], [aliceLayout, cart]]) {
    expect(await upgrade(origin, target, { ...owner, ...onPage(a) }, 'alice'))
      .toMatchObject({ status: 101, frame: { type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED' } });
  }
  // A forged registry id, or a page outside the layout, never reaches an instance.
  for (const id of ['/src/components/Missing.ts#Missing', '/src/components/Echo.ts#Echo', layoutPath]) {
    expect((await upgrade(origin, aliceCart, { component: id, ...onPage(a) }, 'alice')).status).toBe(400);
  }
  expect((await upgrade(origin, aliceLayout, { ...layout, ...onPage(shop) }, 'alice')).status).toBe(400);
  // The hosting page's policy decides on the page's checked params.
  const blocked = { ...onPage(b), pathname: '/live-b/blocked', params: JSON.stringify({ item: 'blocked' }) };
  expect((await upgrade(origin, aliceCart, { ...cart, ...blocked }, 'alice')).status).toBe(403);
  expect((await upgrade(origin, aliceCart, { ...cart, ...onPage(b), params: JSON.stringify({ item: 'one', role: 'admin' }) }, 'alice')).status).toBe(400);
  // Anonymous users are rejected, and a scope that is empty or throws fails closed.
  expect((await upgrade(origin, aliceLayout, { ...layout, ...onPage(a) })).status).toBe(401);
  expect((await upgrade(origin, aliceCart, { ...cart, ...onPage(a) })).status).toBe(401);
  expect((await upgrade(origin, aliceCart, { component: emptyId, ...onPage(a) }, 'alice')).status).toBe(403);
  expect((await upgrade(origin, aliceCart, { component: throwingId, ...onPage(a) }, 'alice')).status).toBe(500);
}

async function signedIn(browser, origin, user) {
  const context = await browser.newContext();
  if (user) await context.addCookies([{ name: 'test-viewer', value: user, url: origin }]);
  return context;
}
async function open(context, url) {
  const page = await context.newPage();
  const sockets = [];
  const errors = [];
  page.on('websocket', socket => sockets.push(new URL(socket.url())));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__cossackReady === true);
  return { page, sockets, errors };
}
const owned = (sockets, key) => sockets.filter(url => url.searchParams.has(key));

/** Two page files, two tabs, two users, client navigation and an anonymous visitor. */
export async function checkRealtimeSharedBrowser(browser, origin) {
  const alice = await signedIn(browser, origin, 'alice');
  const bob = await signedIn(browser, origin, 'bob');
  const anonymous = await signedIn(browser, origin);
  try {
    const first = await open(alice, `${origin}/live-a`);
    const second = await open(alice, `${origin}/live-b/one`);
    for (const { page } of [first, second]) {
      await browserExpect(page.getByTestId('layout-status')).toHaveText('open');
      await browserExpect(page.getByTestId('cart-status')).toHaveText('open');
    }
    // Each owner has exactly one connection of its own; the pages have none.
    expect(owned(first.sockets, 'layout')).toHaveLength(1);
    expect(owned(first.sockets, 'component')).toHaveLength(1);
    expect(owned(first.sockets, 'routePath')).toHaveLength(0);

    // Layout state set from page A is live on page B, and component state the other way.
    const layoutBefore = Number(await second.page.getByTestId('layout-count').textContent());
    await first.page.getByTestId('layout-notify').click();
    await browserExpect(second.page.getByTestId('layout-count')).toHaveText(String(layoutBefore + 1));
    const cartBefore = Number(await first.page.getByTestId('cart-count').textContent());
    await second.page.getByTestId('cart-add').click();
    await browserExpect(first.page.getByTestId('cart-count')).toHaveText(String(cartBefore + 1));
    // A page outside the layout that embeds the component joins with the live state.
    const shop = await open(alice, `${origin}/shop`);
    await browserExpect(shop.page.getByTestId('cart-count')).toHaveText(String(cartBefore + 1));

    // Client navigation between the pages keeps the layout and its one connection.
    await first.page.getByTestId('to-b').click();
    await browserExpect(first.page.getByRole('heading', { name: 'Page B one' })).toBeVisible();
    await browserExpect(first.page.getByTestId('layout-count')).toHaveText(String(layoutBefore + 1));
    await first.page.getByTestId('layout-notify').click();
    await browserExpect(second.page.getByTestId('layout-count')).toHaveText(String(layoutBefore + 2));
    await first.page.getByTestId('to-a').click();
    await browserExpect(first.page.getByRole('heading', { name: 'Page A' })).toBeVisible();
    expect(owned(first.sockets, 'layout')).toHaveLength(1);
    // The page's component is the new page's own, and still the user's instance.
    await browserExpect(first.page.getByTestId('cart-status')).toHaveText('open');
    await browserExpect(first.page.getByTestId('cart-count')).toHaveText(String(cartBefore + 1));

    // Another user is isolated.
    const other = await open(bob, `${origin}/live-a`);
    await browserExpect(other.page.getByTestId('layout-status')).toHaveText('open');
    await browserExpect(other.page.getByTestId('cart-status')).toHaveText('open');
    const bobLayout = Number(await other.page.getByTestId('layout-count').textContent());
    await other.page.getByTestId('layout-notify').click();
    await browserExpect(other.page.getByTestId('layout-count')).toHaveText(String(bobLayout + 1));
    await browserExpect(second.page.getByTestId('layout-count')).toHaveText(String(layoutBefore + 2));

    // An anonymous visitor gets the page, and no realtime connection.
    const guest = await open(anonymous, `${origin}/live-a`);
    await browserExpect(guest.page.getByRole('heading', { name: 'Page A' })).toBeVisible();
    await browserExpect(guest.page.getByTestId('layout-status')).toHaveText('closed');
    await browserExpect(guest.page.getByTestId('cart-status')).toHaveText('closed');
    expect(guest.sockets).toEqual([]);

    // A child without a transport uses its realtime page's one connection.
    const room = await open(alice, `${origin}/echo-room`);
    const rpc = [];
    room.page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') rpc.push(request.url()); });
    await browserExpect.poll(() => owned(room.sockets, 'routePath').length).toBe(1);
    await room.page.getByTestId('echo').click();
    await browserExpect(room.page.getByTestId('echo-reply')).toHaveText('hello alice');
    expect(rpc).toEqual([]);
    expect(room.sockets).toHaveLength(1);
    for (const tab of [first, second, shop, other, guest, room]) expect(tab.errors).toEqual([]);
  } finally {
    await Promise.all([alice.close(), bob.close(), anonymous.close()]);
  }
}
