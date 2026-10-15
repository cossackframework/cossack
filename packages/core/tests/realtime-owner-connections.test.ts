// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, RootContext } from '../src/shared/cossack';
import { Component, Page, Server } from '../src/shared/decorators';
import { setupServerMethodProxies } from '../src/shared/method-proxy';
import { connectWebSocket, disconnectWebSocket, realtimeStatus } from '../src/shared/transport-connections';
import { RealtimeHostContext } from '../src/shared/realtime-owner';

/**
 * Realtime owners in the browser: a page, a realtime layout and a realtime
 * child component each open their own connection to their own server-computed
 * target, and a child without a transport uses its host's connection.
 */
const urls: string[] = [];
const sent: any[] = [];
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: unknown; onmessage: unknown; onclose: unknown; onerror: unknown;
  constructor(url: string) { urls.push(url); }
  send(message: string) { if (message !== 'ping') sent.push(JSON.parse(message)); }
  close() {}
}
afterEach(() => { urls.length = 0; sent.length = 0; vi.unstubAllGlobals(); });
const stubSockets = () => vi.stubGlobal('WebSocket', FakeWebSocket);
const query = (url: string) => Object.fromEntries(new URL(url).searchParams);
const target = (url: string) => decodeURIComponent(new URL(url).pathname.split('/')[2]!);

/** The page payload SSR emitted for `/items/one`. */
const pageState = (page = 'cmp_page', params: Record<string, string> = { item: 'one' }) => ({
  componentRouteId: page, realtimeTarget: 'PAGE', routePath: '/items/[item]', pathname: '/items/one',
  metadata: { pathname: `/items/${params.item}`, params },
  realtimeComponents: { '/src/components/Cart.ts#Cart': 'CART' },
});

@Component({ transport: 'durable-object', scope: () => 'user:alice' })
class Cart extends Cossack { @Server() add() { return 1; } }
Object.defineProperty(Cart, '__cossackRealtimeId', { value: '/src/components/Cart.ts#Cart' });
// Not registered: a subclass needs its own registry id.
class UnregisteredCart extends Cart {}

describe('realtime connections', () => {
  it("connects a realtime component to its registry id's target with the page it is on", () => {
    stubSockets();
    let state = pageState();
    const cart = { constructor: Cart, _phase: 'Mounted', getInitialStateFromWindow: () => state, requestUpdate() {} } as any;
    connectWebSocket(cart);
    expect(target(urls[0]!)).toBe('CART');
    expect(query(urls[0]!)).toEqual({ component: '/src/components/Cart.ts#Cart', page: 'cmp_page', pathname: '/items/one', params: '{"item":"one"}' });
    // After client navigation, a reconnect carries the page the browser is on now.
    vi.useFakeTimers();
    try {
      state = pageState('cmp_other', { item: 'two' });
      (cart.websocket as FakeWebSocket & { onclose(): void }).onclose();
      vi.advanceTimersByTime(600);
      expect(target(urls[1]!)).toBe('CART');
      expect(query(urls[1]!)).toMatchObject({ page: 'cmp_other', pathname: '/items/two', params: '{"item":"two"}' });
    } finally {
      disconnectWebSocket(cart);
      vi.useRealTimers();
    }
  });

  it('keeps a realtime component offline without a server-computed target', () => {
    stubSockets();
    for (const component of [
      { constructor: Cart, getInitialStateFromWindow: () => ({ ...pageState(), realtimeComponents: {} }) },
      { constructor: Cart, getInitialStateFromWindow: () => ({ ...pageState(), realtimeComponents: { constructor: 'x' } }) },
    ] as any[]) {
      component.requestUpdate = () => {};
      connectWebSocket(component);
      expect(component.websocket).toBeUndefined();
      expect(realtimeStatus(component).websocket).toMatchObject({ state: 'closed', lastError: expect.stringContaining('did not authorize') });
    }
    // A subclass without its own registration is not a realtime component.
    const sub = { constructor: UnregisteredCart, getInitialStateFromWindow: () => ({ routePath: '/x' }), requestUpdate() {} } as any;
    connectWebSocket(sub);
    expect(urls).toEqual([]);
  });

  it("connects a layout to its own target, never the page's", () => {
    stubSockets();
    let state = pageState();
    const layout = { __cossack_realtime: { owner: 'layout', target: 'LAYOUT' }, __cossack_componentRouteId: 'cmp_layout',
      getInitialStateFromWindow: () => state, requestUpdate() {} } as any;
    connectWebSocket(layout);
    expect(target(urls[0]!)).toBe('LAYOUT');
    expect(query(urls[0]!)).toEqual({ layout: 'cmp_layout', page: 'cmp_page', pathname: '/items/one', params: '{"item":"one"}' });
    disconnectWebSocket(layout);
    state = pageState('cmp_other', { item: 'two' });
    connectWebSocket(layout);
    expect(query(urls[1]!)).toMatchObject({ layout: 'cmp_layout', page: 'cmp_other', params: '{"item":"two"}' });
    disconnectWebSocket(layout);
    // A layout the server gave no target (its scope failed) stays offline.
    const offline = { __cossack_realtime: null, getInitialStateFromWindow: () => state, requestUpdate() {} } as any;
    connectWebSocket(offline);
    expect(urls).toHaveLength(2);
    expect(realtimeStatus(offline).websocket.state).toBe('closed');
  });
});

describe('server method routing', () => {
  const host = (Host: new () => Cossack, socket?: FakeWebSocket) => {
    const instance = new Host();
    (instance as any).websocket = socket;
    instance.provide(RootContext, instance);
    return instance;
  };
  const child = <T extends Cossack>(Child: new () => T, parent: Cossack, id: string): T => {
    const instance = new Child();
    (instance as any).__parent = parent;
    instance._id = id;
    (instance as any).getInitialStateFromWindow = () => pageState();
    setupServerMethodProxies(instance);
    return instance;
  };

  @Component()
  class Badge extends Cossack { @Server() ping() { return 'pong'; } }

  it("sends a child without a transport over its realtime page's connection", async () => {
    stubSockets();
    @Page({ transport: 'durable-object' }) class LivePage extends Cossack {}
    const socket = new FakeWebSocket('ws://x/ws/PAGE');
    const badge = child(Badge, host(LivePage, socket), 'root:0');
    void (badge as any).ping();
    expect(sent).toEqual([expect.objectContaining({ type: 'action', action: 'ping', target: 'root:0' })]);
  });

  it('uses HTTP for a child without a transport on an HTTP page', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ _cossack_return: 'pong' }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    @Page({ transport: 'http' }) class Plain extends Cossack {}
    const badge = child(Badge, host(Plain), 'root:0');
    expect(await (badge as any).ping()).toBe('pong');
    expect(fetch).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
  });

  it("sends a realtime component's calls on its own connection and its children's calls relative to it", async () => {
    stubSockets();
    @Page({ transport: 'durable-object' }) class LivePage extends Cossack {}
    const page = host(LivePage, new FakeWebSocket('ws://x/ws/PAGE'));
    const cart = child(Cart, page, 'root:3');
    (cart as any).websocket = new FakeWebSocket('ws://x/ws/CART');
    cart.provide(RealtimeHostContext, cart);
    void (cart as any).add();
    // Its server instance is the root of its own live instance.
    expect(sent.at(-1)).toMatchObject({ action: 'add', target: 'root' });
    const badge = child(Badge, cart, 'root:3:1');
    void (badge as any).ping();
    expect(sent.at(-1)).toMatchObject({ action: 'ping', target: 'root:1' });
  });
});
