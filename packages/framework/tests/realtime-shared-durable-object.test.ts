import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Cossack, Page, State, type Middleware } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';

/**
 * Realtime layouts and realtime child components on Cloudflare: SSR emits the
 * Durable Object of each owner, the Worker proxy recomputes it and forwards
 * the owner, its kind and whose guards run, and the Durable Object runs those
 * guards and the owner's scope again for every operation.
 */
const { registry, realtime, session, guardLog } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
  realtime: { components: {} as Record<string, any> },
  session: { userId: 'alice' as string | undefined },
  guardLog: [] as string[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-realtime-components', () => ({ default: realtime }));
// Test-only authentication: the request header (upgrades) or the session (replayed checks).
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  const id = c.req.header('x-test-user') ?? (c.req.header('x-replayed') ? session.userId : undefined);
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
const deny = (name: string, value: string): Middleware => async (c, next) => {
  guardLog.push(`${name}:${c.req.param('item') ?? '-'}`);
  if (c.req.param('item') === value) return c.json({ error: 'Forbidden', code: 'COSSACK_AUTH_FORBIDDEN' }, 403);
  await next();
};

@Component({ transport: 'durable-object', scope: perUser, middlewares: [async (c, next) => { guardLog.push('cart'); await next(); }] })
class CartBadge extends Cossack {
  @State() count = 0;
  render() { return html`<span>${this.count}</span>`; }
}
@Component({ transport: 'durable-object', scope: () => '' })
class EmptyScope extends Cossack {}
const cartId = '/src/components/CartBadge.ts#CartBadge';
const emptyId = '/src/components/EmptyScope.ts#EmptyScope';
for (const [id, Class] of [[cartId, CartBadge], [emptyId, EmptyScope]] as const) {
  Object.defineProperty(Class, '__cossackRealtimeId', { value: id });
  realtime.components[id] = Class;
}

@Page({ transport: 'durable-object', scope: perUser, middlewares: [deny('layout', 'layout-denied')] })
class AppLayout extends Cossack { @State() notifications = 0; render() { return html`${this.children}`; } }
@Page({ transport: 'http' })
class Inbox extends Cossack { render() { return html`<main>${component(CartBadge)}</main>`; } }
@Page({ transport: 'http', middlewares: [deny('page', 'blocked')] })
class Item extends Cossack { render() { return html`<main>${component(CartBadge)}</main>`; } }

const layoutPath = '/src/pages/(app)/layout.ts';
const inboxPath = '/src/pages/(app)/inbox/index.ts';
const itemPath = '/src/pages/(app)/items/[item]/index.ts';
registry.layouts[layoutPath] = { default: AppLayout };
registry.pages[inboxPath] = { default: Inbox };
registry.pages[itemPath] = { default: Item };
const { createApp } = await import('../src/router');
const { AppDurableObject } = await import('../src/DurableObject');
const ids = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts)).routePathToIdMap;
const scoped = (kind: string, id: string, key: string) => `id:${kind}:${JSON.stringify([id, { scope: key }])}`;

afterEach(() => { guardLog.length = 0; session.userId = 'alice'; });

function environment() {
  const forward = vi.fn(async () => new Response('upgraded'));
  const COSSACK_OBJECT = {
    idFromName: (name: string) => ({ toString: () => `id:${name}` }),
    idFromString: (value: string) => value,
    get: () => ({ fetch: forward }),
  };
  return { env: { COSSACK_OBJECT } as any, forward };
}

async function ssr(path: string, user?: string) {
  const { env } = environment();
  const response = await createApp().request(path, { headers: user ? { 'x-test-user': user } : {} }, env);
  expect(response.status).toBe(200);
  return JSON.parse((await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!);
}

async function upgrade(target: string, owner: Record<string, string>, page: string, params: Record<string, string>, user?: string) {
  const { env, forward } = environment();
  const query = new URLSearchParams({ ...owner, page, pathname: '/x', params: JSON.stringify(params) });
  const response = await createApp().request(`/ws/${encodeURIComponent(target)}?${query}`, {
    headers: { origin: 'http://localhost', ...(user ? { 'x-test-user': user } : {}),
      // A client cannot supply the proxy's internal assertions.
      'X-Component-Path': inboxPath, 'X-Cossack-Realtime-Owner': 'page', 'X-Cossack-Realtime-Guard': inboxPath },
  }, env);
  const forwarded = (forward.mock.calls[0] as unknown as [Request] | undefined)?.[0];
  return { status: response.status, forwarded, header: (name: string) => forwarded?.headers.get(name) ?? null };
}

describe('Cloudflare realtime layout and component targets', () => {
  it('emits the Durable Object of the layout and of each rendered realtime component', async () => {
    const inbox = await ssr('/inbox', 'alice');
    const item = await ssr('/items/one', 'alice');
    expect(inbox._layout_stack[0].state.realtime).toEqual({ owner: 'layout', target: scoped('layout', layoutPath, 'user:alice') });
    expect(item._layout_stack[0].state.realtime).toEqual(inbox._layout_stack[0].state.realtime);
    expect(inbox.realtimeComponents).toEqual({ [cartId]: scoped('component', cartId, 'user:alice') });
    expect(item.realtimeComponents).toEqual(inbox.realtimeComponents);
    const anonymous = await ssr('/inbox');
    expect(anonymous._layout_stack[0].state.realtime).toBeUndefined();
    expect(anonymous.realtimeComponents).toBeUndefined();
  });

  it('forwards a layout upgrade with its own guard stack and the page params', async () => {
    const target = scoped('layout', layoutPath, 'user:alice');
    const result = await upgrade(target, { layout: ids.get(layoutPath)! }, ids.get(itemPath)!, { item: 'one' }, 'alice');
    expect(result.status).toBe(200);
    expect(result.header('X-Component-Path')).toBe(layoutPath);
    expect(result.header('X-Cossack-Realtime-Owner')).toBe('layout');
    expect(result.header('X-Cossack-Realtime-Guard')).toBe(layoutPath);
    expect(result.header('X-Cossack-Realtime-Target-Valid')).toBe('true');
    expect(decodeURIComponent(result.header('X-Cossack-Realtime-Scope')!)).toBe('user:alice');
    expect(JSON.parse(new URL(result.forwarded!.url).searchParams.get('params')!)).toEqual({ item: 'one' });
    expect(guardLog).toEqual(['layout:one']);
    expect((await upgrade(target, { layout: ids.get(layoutPath)! }, ids.get(itemPath)!, { item: 'one' }, 'bob')).header('X-Cossack-Realtime-Target-Valid')).toBe('false');
    expect((await upgrade(target, { layout: ids.get(layoutPath)! }, ids.get(itemPath)!, { item: 'layout-denied' }, 'alice')).status).toBe(403);
    expect((await upgrade(target, { layout: ids.get(layoutPath)! }, ids.get(inboxPath)!, {})).status).toBe(401);
  });

  it("forwards a component upgrade with its hosting page's guards and rejects forged ids", async () => {
    const target = scoped('component', cartId, 'user:alice');
    const result = await upgrade(target, { component: cartId }, ids.get(itemPath)!, { item: 'one' }, 'alice');
    expect(result.status).toBe(200);
    expect(result.header('X-Component-Path')).toBe(cartId);
    expect(result.header('X-Cossack-Realtime-Owner')).toBe('component');
    expect(result.header('X-Cossack-Realtime-Guard')).toBe(itemPath);
    expect(result.header('X-Cossack-Realtime-Target-Valid')).toBe('true');
    expect(guardLog).toEqual(['layout:one', 'page:one', 'cart']);
    guardLog.length = 0;
    expect((await upgrade(target, { component: cartId }, ids.get(itemPath)!, { item: 'blocked' }, 'alice')).status).toBe(403);
    expect(guardLog).toEqual(['layout:blocked', 'page:blocked']);
    expect((await upgrade(scoped('component', cartId, 'user:bob'), { component: cartId }, ids.get(inboxPath)!, {}, 'alice'))
      .header('X-Cossack-Realtime-Target-Valid')).toBe('false');
    for (const id of ['/src/components/Missing.ts#Missing', inboxPath, 'hasOwnProperty']) {
      const forged = await upgrade(target, { component: id }, ids.get(inboxPath)!, {}, 'alice');
      expect(forged.status).toBe(400);
      expect(forged.forwarded).toBeUndefined();
    }
    const empty = await upgrade(scoped('component', emptyId, 'x'), { component: emptyId }, ids.get(inboxPath)!, {}, 'alice');
    expect(empty.status).toBe(403);
    expect(empty.forwarded).toBeUndefined();
  });
});

describe('Durable Object authorization of layout and component peers', () => {
  const object = () => Object.assign(Object.create(AppDurableObject.prototype), { env: {} }) as any;
  const peer = (overrides: Record<string, unknown>) => ({
    user: { id: 'alice' }, identity: { version: 1, provider: 'fixture.session', data: { reference: 'alice' } },
    request: { url: 'https://example.test/ws/id', params: { item: 'one' }, headers: [['x-replayed', '1']] as [string, string][], locale: 'en' },
    scopeKey: 'user:alice', ...overrides,
  });

  it("runs a component peer's page guards, own guards and scope for each operation", async () => {
    const operation = vi.fn(async () => {});
    const componentPeer = peer({ componentPath: cartId, owner: 'component', guardPath: itemPath });
    expect(await object().authorizeWebSocketPeer(undefined, componentPeer, operation)).toBe(true);
    expect(guardLog).toEqual(['layout:one', 'page:one', 'cart']);
    session.userId = 'bob';
    expect(await object().authorizeWebSocketPeer(undefined, componentPeer, operation)).toBe(false);
    expect(operation).toHaveBeenCalledOnce();
    session.userId = 'alice';
    // A scope that no longer resolves denies (fail closed).
    expect(await object().authorizeWebSocketPeer(undefined, peer({ componentPath: emptyId, owner: 'component', guardPath: inboxPath }), operation)).toBe(false);
  });

  it("runs a layout peer's own guard stack, never a page's", async () => {
    const operation = vi.fn(async () => {});
    expect(await object().authorizeWebSocketPeer(undefined, peer({ componentPath: layoutPath, owner: 'layout', guardPath: itemPath }), operation)).toBe(true);
    expect(guardLog).toEqual(['layout:one']);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('rejects a peer whose owner kind or guard does not match the registry', async () => {
    const operation = vi.fn(async () => {});
    for (const forged of [
      peer({ componentPath: cartId, owner: 'page', guardPath: inboxPath }),
      peer({ componentPath: layoutPath, owner: 'component', guardPath: inboxPath }),
      peer({ componentPath: cartId, owner: 'component', guardPath: '/src/pages/missing/index.ts' }),
      peer({ componentPath: '/src/components/Missing.ts#Missing', owner: 'component', guardPath: inboxPath }),
    ]) expect(await object().authorizeWebSocketPeer(undefined, forged, operation)).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });

  it('builds a realtime component from the registry in a root scope of its own', async () => {
    const instance = object();
    const registered = await instance.getComponentRegistry();
    expect(registered.get(cartId)).toBe(CartBadge);
    expect(registered.get(layoutPath)).toBe(AppLayout);
    const { Context } = await import('hono');
    const context = new Context(new Request('https://example.test/inbox'), { env: {} });
    const built = await instance.createComponent(CartBadge, { componentPath: cartId, page: '/inbox', params: {}, scopeKey: 'user:alice', context, owner: 'component' });
    try {
      expect(built).toBeInstanceOf(CartBadge);
      expect(built.__cossack_rpcOwner).toBe(cartId);
      expect(built._getServiceScope()?.parent).toBeUndefined();
    } finally { await built.destroyAsync(); }
  });
});
