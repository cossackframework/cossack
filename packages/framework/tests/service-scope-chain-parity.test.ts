import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Page, Server, Service, State, type Middleware, type ServiceScope } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { RuntimeWebSocketUpgrade } from '../src/runtime-adapter';
import { computeRouteIds } from '../src/route-ids';
import { __resetSseStore } from '../src/transports/sse';
import { renderSsgPage } from '../src/ssg-renderer';

// SSR, the runtime `/ws` upgrade, the Cloudflare Durable Object, `/crpc`, the
// SSE endpoint and layout-service RPC each build the root + layout service
// scope chain for a page. A page or layout service must see the same chain on
// every path: the same owners in the same order, the same route ids and scope
// key, and request facilities that carry the page's route params and user.
const { registry, guardLog } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
  guardLog: [] as string[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  c.set('user', { id: 'u1' });
  c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: 'opaque' } }));
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

interface ScopeLink {
  owner: string | null;
  routeId: string | null;
  scopeKey: string | null;
  service: string | null;
  team: string | null;
  user: unknown;
}

function describeChain(component: Cossack): ScopeLink[] {
  return describeScope(component._getServiceScope());
}

function describeScope(innermost: ServiceScope | undefined): ScopeLink[] {
  const chain: ScopeLink[] = [];
  for (let scope = innermost; scope; scope = scope.parent) {
    const facilities = scope.getRequestContext();
    chain.unshift({
      owner: scope.ownerRoutePath ?? null,
      routeId: scope.ownerRouteId ?? null,
      scopeKey: scope.scopeKey ?? null,
      service: scope.getOwnedService('0')?.serviceClass.name ?? null,
      team: facilities.context?.req.param('team') ?? null,
      user: (facilities.user as { id?: unknown } | undefined)?.id ?? null,
    });
  }
  return chain;
}

/** A layout or page guard: records that it ran and the route param it saw. */
const guard = (name: string): Middleware => async (c, next) => {
  guardLog.push(`${name}:${c.req.param('team') ?? '-'}`);
  await next();
};
/** A page policy that decides on the route param, as SSR runs it. */
const denyTeamBeta: Middleware = async (c, next) => {
  if (c.req.param('team') === 'beta') return c.json({ error: 'Forbidden', code: 'COSSACK_AUTH_FORBIDDEN' }, 403);
  await next();
};

@Service() class RootService extends CossackService {}
@Service() class GroupService extends CossackService {}
@Service() class TeamService extends CossackService {
  @Server() async describe() {
    guardLog.push('service');
    return describeScope((this as unknown as { __cossackServiceScope?: ServiceScope }).__cossackServiceScope);
  }
}
@Service() class DecoyService extends CossackService {}

@Page({ services: [RootService], middlewares: [guard('root')] }) class RootLayout extends Cossack { render() { return html`${this.children}`; } }
@Page({ services: [GroupService], middlewares: [guard('group')] }) class GroupLayout extends Cossack { render() { return html`${this.children}`; } }
@Page({ services: [TeamService], middlewares: [guard('team')] }) class TeamLayout extends Cossack { render() { return html`${this.children}`; } }
@Page({ services: [DecoyService], middlewares: [guard('decoy')] }) class DecoyLayout extends Cossack { render() { return html`${this.children}`; } }

@Page({ transport: 'sse', scope: c => `team:${c.req.param('team')}`, middlewares: [guard('page'), denyTeamBeta] })
class TeamPage extends Cossack {
  @Inject(TeamService) team!: TeamService;
  @State() chain: ScopeLink[] = [];
  render() {
    this.chain = describeChain(this);
    return html`<main>${this.chain.length}</main>`;
  }
  @Server() async describe() { return describeChain(this); }
}

// The same layouts host a real-time page whose instance is a Durable Object.
@Page({ transport: 'durable-object', scope: c => `team:${c.req.param('team')}` })
class LivePage extends Cossack {
  @Inject(TeamService) team!: TeamService;
  @State() chain: ScopeLink[] = [];
  render() {
    this.chain = describeChain(this);
    return html`<main>${this.chain.length}</main>`;
  }
}

// A page outside the team layout, with a route param of the same name.
@Page({}) class AboutPage extends Cossack { render() { return html`<main>about</main>`; } }

const pagePath = '/src/pages/(admin)/teams/[team]/index.ts';
const livePath = '/src/pages/(admin)/teams/[team]/live/index.ts';
const aboutPath = '/src/pages/(public)/about/[team]/index.ts';
const layoutPaths = {
  root: '/src/pages/layout.ts',
  group: '/src/pages/(admin)/layout.ts',
  team: '/src/pages/(admin)/teams/[team]/layout.ts',
  // Neither is an ancestor of the page's source directory.
  otherGroup: '/src/pages/(public)/layout.ts',
  urlTwin: '/src/pages/teams/layout.ts',
};
registry.pages[pagePath] = { default: TeamPage };
registry.pages[livePath] = { default: LivePage };
registry.pages[aboutPath] = { default: AboutPage };
registry.layouts[layoutPaths.root] = { default: RootLayout };
registry.layouts[layoutPaths.group] = { default: GroupLayout };
registry.layouts[layoutPaths.team] = { default: TeamLayout };
registry.layouts[layoutPaths.otherGroup] = { default: DecoyLayout };
registry.layouts[layoutPaths.urlTwin] = { default: DecoyLayout };

const { createApp } = await import('../src/router');
const { AppDurableObject } = await import('../src/DurableObject');
const { routePathToIdMap } = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts));
const pageId = routePathToIdMap.get(pagePath)!;
const teamLayoutId = routePathToIdMap.get(layoutPaths.team)!;
const scopeKey = 'team:alpha';
const params = JSON.stringify({ team: 'alpha' });
const env = () => ({ APP_URL: 'http://localhost' }) as any;

const expected = (user: unknown): ScopeLink[] => [
  { owner: null, routeId: null, scopeKey: null, service: null, team: 'alpha', user },
  ...[[layoutPaths.root, 'RootService'], [layoutPaths.group, 'GroupService'], [layoutPaths.team, 'TeamService']]
    .map(([owner, service]) => ({ owner, routeId: routePathToIdMap.get(owner)!, scopeKey, service, team: 'alpha', user })),
];

afterEach(() => {
  __resetSseStore();
  guardLog.length = 0;
  vi.unstubAllGlobals();
});

const hydrationState = (html: string) => JSON.parse(html.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)![1]);
const hydratedChain = (html: string): ScopeLink[] => hydrationState(html).public.chain;

async function viaSsr(url = '/teams/alpha', bindings: Record<string, unknown> = env()): Promise<ScopeLink[]> {
  const response = await createApp().request(url, {}, bindings);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.text();
  return hydratedChain(body);
}

/**
 * Cloudflare: the Worker's WebSocket proxy forwards the upgrade to a real
 * AppDurableObject, which builds the page it hosts.
 */
function durableObjectEnv() {
  const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn(), serializeAttachment: vi.fn(), deserializeAttachment: vi.fn() });
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  vi.stubGlobal('WebSocketPair', class { 0 = socket(); 1 = socket(); });
  const state = {
    storage: { get: async () => new Map(), put: async () => {} },
    setWebSocketAutoResponse: () => {}, getWebSockets: () => [], acceptWebSocket: () => {}, waitUntil: () => {},
  };
  const bindings: Record<string, unknown> = { ...env() };
  const object = new AppDurableObject(state as unknown as DurableObjectState, bindings);
  bindings.COSSACK_OBJECT = {
    idFromName: (name: string) => ({ toString: () => `id:${name}` }),
    idFromString: (value: string) => value,
    get: () => ({
      fetch: async (request: Request) => {
        try { return await object.fetch(request); }
        catch (error) {
          // Node's Response rejects the 101 upgrade status that workerd accepts.
          if (error instanceof RangeError && object.componentInstance) return new Response('upgraded');
          throw error;
        }
      },
    }),
  };
  return { bindings, object };
}

async function viaDurableObject(): Promise<ScopeLink[]> {
  const { bindings, object } = durableObjectEnv();
  const response = await createApp().request('/teams/alpha/live', {}, bindings);
  expect(response.status, await response.clone().text()).toBe(200);
  const target = hydrationState(await response.text()).realtimeTarget as string;
  const query = new URLSearchParams({ routePath: '/teams/[team]/live', pathname: '/teams/alpha/live', params });
  const upgrade = await createApp().request(`/ws/${encodeURIComponent(target)}?${query}`,
    { headers: { origin: 'http://localhost', upgrade: 'websocket' } }, bindings);
  expect(upgrade.status, await upgrade.clone().text()).toBe(200);
  const instance = object.componentInstance!;
  try { return describeChain(instance); } finally { await instance.destroyAsync(); }
}

/** A layout-service call from the browser on `/teams/alpha` (or a forged variant). */
async function serviceRpc(overrides: Record<string, unknown> = {}): Promise<Response> {
  return createApp().request('/crpc', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: { ownerRouteId: teamLayoutId, slot: '0' }, componentRouteId: pageId,
      pageParams: { team: 'alpha' }, action: 'describe', payload: [], state: {}, ...overrides }),
  }, env());
}

async function viaServiceRpc(): Promise<ScopeLink[]> {
  const response = await serviceRpc();
  const body = await response.json() as any;
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body._cossack_return;
}

async function viaWebSocket(): Promise<ScopeLink[]> {
  let chain: ScopeLink[] = [];
  const app = createApp({ runtimeAdapter: { name: 'test', handleWebSocketUpgrade: async (_context, upgrade: RuntimeWebSocketUpgrade) => {
    const instance = await upgrade.createComponent();
    try { chain = describeChain(instance); } finally { await instance.destroyAsync(); }
    return new Response('ok');
  } } });
  // WebSocket upgrades address realtime owners: the Durable Object page under the same layouts.
  const query = new URLSearchParams({ routePath: '/teams/[team]/live', pathname: '/teams/alpha/live', params });
  const target = `page:${JSON.stringify([livePath, { scope: scopeKey }])}`;
  const response = await app.request(`/ws/${encodeURIComponent(target)}?${query}`, { headers: { origin: 'http://localhost' } }, env());
  expect(response.status, await response.clone().text()).toBe(200);
  return chain;
}

async function viaRpc(): Promise<ScopeLink[]> {
  const response = await createApp().request('/crpc', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ componentRouteId: pageId, action: 'describe', payload: [], state: {}, scopeKey, pageParams: { team: 'alpha' } }),
  }, env());
  const body = await response.json() as any;
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body._cossack_return;
}

/** Minimal Cloudflare SSE coordinator: an empty scope that keeps the first snapshot. */
function coordinatorEnv() {
  let snapshot: { state: string; cursor: number } | null = null;
  const scope = {
    currentState: async () => snapshot,
    initialize: async (state: string) => { snapshot ??= { state, cursor: 0 }; return { ...snapshot, fresh: true }; },
    updates: async () => ({ snapshot: snapshot!, resync: false, events: [] }),
    cancelWait: async () => {},
  };
  return { ...env(), COSSACK_SSE: { getByName: () => scope } };
}

async function viaSse(bindings: Record<string, unknown> = env()): Promise<ScopeLink[]> {
  const controller = new AbortController();
  const query = new URLSearchParams({ scopeKey, params });
  const response = await createApp().request(`/sse/${pageId}?${query}`, { signal: controller.signal }, bindings);
  expect(response.status, response.status === 200 ? '' : await response.text()).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frame = /event: state-update\n(?:id: \d+\n)?data: (.*)\n\n/;
  let text = '';
  try {
    while (!frame.test(text)) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(frame.exec(text)![1]).chain;
}

describe('layout service scope chain', () => {
  it.each([
    ['SSR', () => viaSsr()],
    ['runtime /ws', viaWebSocket],
    ['/crpc', viaRpc],
    ['SSE cold start (Node store)', () => viaSse()],
    ['SSE cold start (Cloudflare coordinator)', () => viaSse(coordinatorEnv())],
    ['SSR of a Durable Object page', () => viaSsr('/teams/alpha/live', durableObjectEnv().bindings)],
    ['Durable Object /ws', viaDurableObject],
    ['layout-service /crpc', viaServiceRpc],
  ])('%s builds the root, route-group and nested layout scopes with page facilities', async (_path, build) => {
    expect(await build()).toEqual(expected('u1'));
  });

  it('SSG builds the same chain for an anonymous static request', async () => {
    const layouts = Object.fromEntries(Object.entries(registry.layouts).map(([path, module]) => [path, module]));
    const output = await renderSsgPage(TeamPage, '/teams/[team]', { team: 'alpha' }, layouts, 'http://localhost',
      undefined, undefined, pagePath, pageId, undefined, undefined, Object.fromEntries(routePathToIdMap));
    expect(hydratedChain(output)).toEqual(expected(null));
  });
});

describe('layout-service RPC route params', () => {
  const ssrGuards = async (url: string) => {
    guardLog.length = 0;
    const response = await createApp().request(url, { headers: { accept: 'text/html' } }, env());
    return { status: response.status, guards: guardLog.splice(0) };
  };
  const rpcGuards = async (overrides: Record<string, unknown> = {}) => {
    guardLog.length = 0;
    const response = await serviceRpc(overrides);
    return { status: response.status, guards: guardLog.splice(0) };
  };

  it('runs the layout and page guards of the page with its route params, as SSR does', async () => {
    const ssr = await ssrGuards('/teams/alpha');
    expect(ssr).toEqual({ status: 200, guards: ['root:alpha', 'group:alpha', 'team:alpha', 'page:alpha'] });
    expect(await rpcGuards()).toEqual({ status: 200, guards: [...ssr.guards, 'service'] });
  });

  it('lets a page policy deny the route params it denies on SSR, before the service runs', async () => {
    expect((await ssrGuards('/teams/beta')).status).toBe(403);
    expect(await rpcGuards({ pageParams: { team: 'beta' } }))
      .toEqual({ status: 403, guards: ['root:beta', 'group:beta', 'team:beta', 'page:beta'] });
  });

  it('computes the scope key on the server instead of using one the browser sends', async () => {
    const response = await serviceRpc({ scopeKey: 'team:other' });
    expect(response.status).toBe(200);
    expect(((await response.json()) as any)._cossack_return).toEqual(expected('u1'));
  });

  it.each([
    ['missing params', { pageParams: undefined }],
    ['no params', { pageParams: {} }],
    ['an extra param', { pageParams: { team: 'alpha', role: 'admin' } }],
    ['an empty param', { pageParams: { team: '' } }],
    ['a non-string param', { pageParams: { team: 1 } }],
    ['a dot segment', { pageParams: { team: '..' } }],
    ['an array', { pageParams: ['alpha'] }],
    ['no page', { componentRouteId: undefined }],
    ['an unknown page', { componentRouteId: 'cmp_unknown' }],
    ['a page outside the owning layout', { componentRouteId: routePathToIdMap.get(aboutPath) }],
    ['a layout named as the page', { componentRouteId: teamLayoutId }],
    ['a page named as the owner', { service: { ownerRouteId: pageId, slot: '0' } }],
  ])('rejects %s before any guard or service runs', async (_case, overrides) => {
    const response = await serviceRpc(overrides);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'COSSACK_RPC_REQUEST_INVALID' });
    expect(guardLog).toEqual([]);
  });
});
