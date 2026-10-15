import 'reflect-metadata';
import { createServer, type Server as HttpServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Component, Cossack, Page, Server, State, type Middleware } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { createNodeAdapter } from '../../node-adapter/src/adapter';
import { computeRouteIds } from '../src/route-ids';

/**
 * Realtime state shared across different page files, on the Node runtime:
 * a realtime layout is one live instance per layout plus scope key, shared by
 * every page below it; a realtime child component is one live instance per
 * registry id plus scope key, shared by every page that embeds it.
 */
const { registry, realtime, guardLog } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
  realtime: { components: {} as Record<string, any> },
  guardLog: [] as string[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-realtime-components', () => ({ default: realtime }));
// Test-only authentication: the user comes from a header this fixture trusts.
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  const id = c.req.header('x-test-user');
  if (id) {
    c.set('user', { id });
    c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: id } }));
  }
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const perUser = (c: any) => {
  const user = c.get('user');
  if (!user) throw Object.assign(new Error('Authentication required'), { authorizationCode: 'COSSACK_AUTH_UNAUTHENTICATED' });
  return `user:${user.id}`;
};
const deny = (name: string, param: string, value: string): Middleware => async (c, next) => {
  guardLog.push(`${name}:${c.req.param(param) ?? '-'}`);
  if (c.req.param(param) === value) return c.json({ error: 'Forbidden', code: 'COSSACK_AUTH_FORBIDDEN' }, 403);
  await next();
};

@Component({ transport: 'durable-object', scope: perUser, middlewares: [async (c, next) => { guardLog.push('cart'); await next(); }] })
class CartBadge extends Cossack {
  @State() count = 0;
  @Server() add() { return ++this.count; }
  @Server() whoami() { return { user: this.user?.id ?? null, item: this.c.req.param('item') ?? null, count: this.count }; }
  render() { return html`<span>${this.count}</span>`; }
}
@Component({ transport: 'durable-object', scope: () => '' })
class EmptyScope extends Cossack { render() { return html`<i></i>`; } }
@Component({ transport: 'durable-object', scope: () => { throw new Error('scope failed'); } })
class ThrowingScope extends Cossack { render() { return html`<i></i>`; } }
const cartId = '/src/components/CartBadge.ts#CartBadge';
const emptyId = '/src/components/EmptyScope.ts#EmptyScope';
const throwingId = '/src/components/ThrowingScope.ts#ThrowingScope';
for (const [id, Class] of [[cartId, CartBadge], [emptyId, EmptyScope], [throwingId, ThrowingScope]] as const) {
  // What the Vite plugin attaches to each registered class.
  Object.defineProperty(Class, '__cossackRealtimeId', { value: id });
  realtime.components[id] = Class;
}

@Page({ transport: 'durable-object', scope: perUser, middlewares: [deny('layout', 'item', 'layout-denied')] })
class AppLayout extends Cossack {
  @State() notifications = 0;
  @Server() notify() { return ++this.notifications; }
  @Server() whoami() { return { user: this.user?.id ?? null, item: this.c.req.param('item') ?? null, notifications: this.notifications }; }
  render() { return html`<header>${this.notifications}</header>${this.children}`; }
}
@Page({ transport: 'http' })
class Inbox extends Cossack { render() { return html`<main>inbox ${component(CartBadge)}</main>`; } }
@Page({ transport: 'http', middlewares: [deny('page', 'item', 'blocked')] })
class Item extends Cossack { render() { return html`<main>item ${component(CartBadge)}</main>`; } }
@Page({ transport: 'http' })
class Public extends Cossack { render() { return html`<main>public ${component(CartBadge)}</main>`; } }

const layoutPath = '/src/pages/(app)/layout.ts';
const inboxPath = '/src/pages/(app)/inbox/index.ts';
const itemPath = '/src/pages/(app)/items/[item]/index.ts';
const publicPath = '/src/pages/public/index.ts';
registry.layouts[layoutPath] = { default: AppLayout };
registry.pages[inboxPath] = { default: Inbox };
registry.pages[itemPath] = { default: Item };
registry.pages[publicPath] = { default: Public };
const { createApp } = await import('../src/router');
const ids = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts)).routePathToIdMap;

const runtime = createNodeAdapter({ idleTimeoutMs: 60_000 });
const app = createApp({ runtimeAdapter: runtime });
let server: HttpServer;
let origin: string;
const sockets: WebSocket[] = [];
beforeAll(async () => {
  server = createServer();
  runtime.attach(server, request => app.fetch(request));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await runtime.dispose();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function ssr(path: string, user?: string): Promise<Record<string, any>> {
  const response = await app.request(path, { headers: user ? { 'x-test-user': user } : {} });
  expect(response.status).toBe(200);
  return JSON.parse((await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!);
}
const layoutTarget = async (path: string, user?: string) => (await ssr(path, user))._layout_stack[0].state.realtime?.target as string | undefined;
const cartTarget = async (path: string, user?: string) => (await ssr(path, user)).realtimeComponents?.[cartId] as string | undefined;

/** The page the browser is on: its route id and params. */
const pages = {
  inbox: { page: ids.get(inboxPath)!, pathname: '/inbox', params: {} },
  item: (item: string) => ({ page: ids.get(itemPath)!, pathname: `/items/${item}`, params: { item } }),
  public: { page: ids.get(publicPath)!, pathname: '/public', params: {} },
};
type PageRef = { page: string; pathname: string; params: Record<string, string> };

interface Peer { socket: WebSocket; status: Promise<number | undefined>; first: Promise<any>; call(action: string): Promise<any>; next(type: string): Promise<any> }
function open(target: string, owner: Record<string, string>, on: PageRef, user?: string): Peer {
  const query = new URLSearchParams({ ...owner, page: on.page, pathname: on.pathname, params: JSON.stringify(on.params) });
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/${encodeURIComponent(target)}?${query}`,
    { headers: { origin, ...(user ? { 'x-test-user': user } : {}) } });
  sockets.push(socket);
  const frames: any[] = [];
  const waiters: { match: (frame: any) => boolean; resolve: (frame: any) => void }[] = [];
  socket.on('message', data => {
    const frame = JSON.parse(String(data));
    const waiter = waiters.find(candidate => candidate.match(frame));
    if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame); }
    else frames.push(frame);
  });
  socket.on('error', () => {});
  const wait = (match: (frame: any) => boolean) => new Promise<any>(resolve => {
    const seen = frames.find(match);
    if (seen) { frames.splice(frames.indexOf(seen), 1); resolve(seen); } else waiters.push({ match, resolve });
  });
  return {
    socket,
    status: new Promise(resolve => {
      socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
      socket.once('open', () => resolve(101));
    }),
    first: wait(() => true),
    next: type => wait(frame => frame.type === type),
    call: action => {
      const requestId = crypto.randomUUID();
      socket.send(JSON.stringify({ v: 1, type: 'action', requestId, action, payload: [], channel: 'global', target: 'root' }));
      return wait(frame => frame.requestId === requestId && (frame.type === 'done' || frame.type === 'error'));
    },
  };
}
const layout = (target: string, on: PageRef, user?: string) => open(target, { layout: ids.get(layoutPath)! }, on, user);
const cart = (target: string, on: PageRef, user?: string, id = cartId) => open(target, { component: id }, on, user);
const instanceName = (kind: string, id: string, key: string) => `${kind}:${JSON.stringify([id, { scope: key }])}`;

describe('a realtime layout shared by different page files', () => {
  it('emits one target per layout and user for every page below it, and none for anonymous visitors', async () => {
    const alice = await layoutTarget('/inbox', 'alice');
    expect(alice).toBe(instanceName('layout', layoutPath, 'user:alice'));
    expect(await layoutTarget('/items/one', 'alice')).toBe(alice);
    expect(await layoutTarget('/inbox', 'bob')).toBe(instanceName('layout', layoutPath, 'user:bob'));
    // The per-user scope fails closed for an anonymous visitor: the page
    // renders, its layout has no target and stays offline.
    expect(await layoutTarget('/inbox')).toBeUndefined();
    expect((await ssr('/inbox')).realtimeComponents).toBeUndefined();
  });

  it('shares one live instance between pages and tabs of one user and isolates other users', async () => {
    const target = (await layoutTarget('/inbox', 'alice'))!;
    const before = runtime.instanceCount;
    const onInbox = layout(target, pages.inbox, 'alice');
    const onItem = layout(target, pages.item('one'), 'alice');
    expect(await onInbox.first).toEqual({ type: 'state-update', state: { notifications: 0 } });
    expect(await onItem.first).toEqual({ type: 'state-update', state: { notifications: 0 } });
    expect(runtime.instanceCount).toBe(before + 1);
    // Server methods run in the shared instance, with each caller's page params.
    expect(await onInbox.call('notify')).toMatchObject({ type: 'done', value: 1 });
    expect(await onItem.next('state-update')).toEqual({ type: 'state-update', state: { notifications: 1 } });
    expect((await onItem.call('whoami')).value).toEqual({ user: 'alice', item: 'one', notifications: 1 });
    // A later tab joins with the live state, not the layout's defaults.
    const tab = layout(target, pages.item('two'), 'alice');
    expect(await tab.first).toEqual({ type: 'state-update', state: { notifications: 1 } });

    const bob = layout((await layoutTarget('/inbox', 'bob'))!, pages.inbox, 'bob');
    expect(await bob.first).toEqual({ type: 'state-update', state: { notifications: 0 } });
    expect(await bob.call('notify')).toMatchObject({ type: 'done', value: 1 });
    expect((await onInbox.call('whoami')).value.notifications).toBe(1);
  });

  it('runs the layout guards with the checked params of the page the browser is on', async () => {
    const target = (await layoutTarget('/inbox', 'alice'))!;
    guardLog.length = 0;
    expect(await layout(target, pages.item('layout-denied'), 'alice').status).toBe(403);
    // Only the layout's guard stack runs, not the page's own guards.
    expect(guardLog).toEqual(['layout:layout-denied']);
    guardLog.length = 0;
    const allowed = layout(target, pages.item('blocked'), 'alice');
    expect(await allowed.status).toBe(101);
    await allowed.first;
    // The upgrade, and again the delivery of the snapshot frame.
    expect(guardLog).toEqual(['layout:blocked', 'layout:blocked']);
    // A page outside the layout, forged params or an unknown page never reach a guard.
    guardLog.length = 0;
    for (const on of <PageRef[]>[pages.public, { ...pages.item('one'), params: {} }, { ...pages.item('one'), params: { item: 'one', role: 'admin' } },
      { ...pages.inbox, page: 'cmp_unknown' }]) {
      expect(await layout(target, on, 'alice').status).toBe(400);
    }
    expect(guardLog).toEqual([]);
  });

  it('rejects anonymous users, forged targets and non-realtime layouts', async () => {
    const before = runtime.instanceCount;
    expect(await layout(instanceName('layout', layoutPath, 'user:anonymous'), pages.inbox).status).toBe(401);
    const alice = (await layoutTarget('/inbox', 'alice'))!;
    for (const forged of [alice, instanceName('layout', layoutPath, 'user:mallory'), instanceName('page', inboxPath, 'user:bob'), 'user:bob']) {
      const intruder = layout(forged, pages.inbox, 'bob');
      expect(await intruder.first).toMatchObject({ type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED' });
    }
    expect(runtime.instanceCount).toBe(before);
    // A layout file or route path never addresses a layout without its page.
    expect(await open(alice, { routePath: layoutPath }, pages.inbox, 'alice').status).toBe(400);
  });
});

describe('a realtime child component embedded in different page files', () => {
  it('emits one target per registry id and user on every page that renders it', async () => {
    const alice = await cartTarget('/inbox', 'alice');
    expect(alice).toBe(instanceName('component', cartId, 'user:alice'));
    expect(await cartTarget('/items/one', 'alice')).toBe(alice);
    expect(await cartTarget('/public', 'alice')).toBe(alice);
    expect(await cartTarget('/inbox', 'bob')).toBe(instanceName('component', cartId, 'user:bob'));
  });

  it('shares one live instance per user across pages and isolates users', async () => {
    const target = (await cartTarget('/inbox', 'alice'))!;
    const onInbox = cart(target, pages.inbox, 'alice');
    const onItem = cart(target, pages.item('one'), 'alice');
    expect(await onInbox.first).toEqual({ type: 'state-update', state: { count: 0 } });
    expect(await onItem.first).toEqual({ type: 'state-update', state: { count: 0 } });
    expect(await onItem.call('add')).toMatchObject({ type: 'done', value: 1 });
    expect(await onInbox.next('state-update')).toEqual({ type: 'state-update', state: { count: 1 } });
    expect((await onItem.call('whoami')).value).toEqual({ user: 'alice', item: 'one', count: 1 });
    const bob = cart((await cartTarget('/inbox', 'bob'))!, pages.inbox, 'bob');
    expect(await bob.first).toEqual({ type: 'state-update', state: { count: 0 } });
    expect(await bob.call('add')).toMatchObject({ type: 'done', value: 1 });
    expect((await onInbox.call('whoami')).value.count).toBe(1);
  });

  it("runs the hosting page's guards with checked params, then the component's own guards", async () => {
    const target = (await cartTarget('/inbox', 'alice'))!;
    guardLog.length = 0;
    expect(await cart(target, pages.item('blocked'), 'alice').status).toBe(403);
    expect(guardLog).toEqual(['layout:blocked', 'page:blocked']);
    guardLog.length = 0;
    const allowed = cart(target, pages.item('ok'), 'alice');
    expect(await allowed.status).toBe(101);
    await allowed.first;
    // The upgrade, and again the delivery of the snapshot frame.
    expect(guardLog).toEqual(['layout:ok', 'page:ok', 'cart', 'layout:ok', 'page:ok', 'cart']);
    guardLog.length = 0;
    for (const on of <PageRef[]>[{ ...pages.item('one'), params: {} }, { ...pages.inbox, params: { item: 'x' } }, { ...pages.inbox, page: 'cmp_unknown' }]) {
      expect(await cart(target, on, 'alice').status).toBe(400);
    }
    expect(guardLog).toEqual([]);
  });

  it('rejects forged registry ids and targets and fails closed when the scope is empty or throws', async () => {
    const target = (await cartTarget('/inbox', 'alice'))!;
    const before = runtime.instanceCount;
    for (const id of ['/src/components/Missing.ts#Missing', inboxPath, layoutPath, 'constructor', '__proto__']) {
      expect(await cart(target, pages.inbox, 'alice', id).status).toBe(400);
    }
    for (const forged of [target, instanceName('component', cartId, 'user:mallory'), instanceName('layout', layoutPath, 'user:bob')]) {
      const intruder = cart(forged, pages.inbox, 'bob');
      expect(await intruder.first).toMatchObject({ type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED' });
    }
    expect(await cart(instanceName('component', cartId, 'user:anonymous'), pages.inbox).status).toBe(401);
    expect(await cart(instanceName('component', emptyId, ''), pages.inbox, 'alice', emptyId).status).toBe(403);
    expect(await cart(instanceName('component', throwingId, 'x'), pages.inbox, 'alice', throwingId).status).toBe(500);
    expect(runtime.instanceCount).toBe(before);
  });

  it('checks each action again with the same user and scope', async () => {
    const target = (await cartTarget('/inbox', 'carol'))!;
    const peer = cart(target, pages.inbox, 'carol');
    expect(await peer.first).toEqual({ type: 'state-update', state: { count: 0 } });
    expect(await peer.call('add')).toMatchObject({ type: 'done', value: 1 });
    const removed = vi.spyOn(CartBadge.prototype as any, 'add');
    try {
      // The registry no longer resolves a scope key for this component.
      const scope = Reflect.getMetadata('page:options', CartBadge).scope;
      Reflect.getMetadata('page:options', CartBadge).scope = () => '';
      try {
        expect(await peer.call('add')).toMatchObject({ type: 'error', code: 'COSSACK_REALTIME_AUTH_CHANGED' });
      } finally { Reflect.getMetadata('page:options', CartBadge).scope = scope; }
      expect(removed).not.toHaveBeenCalled();
    } finally { removed.mockRestore(); }
  });
});
