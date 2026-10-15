import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Page, Server, Service, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { RuntimeWebSocketUpgrade } from '../src/runtime-adapter';
import { computeRouteIds } from '../src/route-ids';
import { __resetSseStore } from '../src/transports/sse';
import { renderSsgPage } from '../src/ssg-renderer';

// SSR, the runtime `/ws` upgrade, `/crpc` and the SSE endpoint each build the
// root + layout service scope chain for a page. A page that injects a
// layout-declared service must see the same chain on every path: the same
// owners in the same order, the same route ids and scope key, and request
// facilities that carry the page's route params and user.
const { registry } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
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
  const chain: ScopeLink[] = [];
  for (let scope = component._getServiceScope(); scope; scope = scope.parent) {
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

@Service() class RootService extends CossackService {}
@Service() class GroupService extends CossackService {}
@Service() class TeamService extends CossackService {}
@Service() class DecoyService extends CossackService {}

@Page({ services: [RootService] }) class RootLayout extends Cossack { render() { return html`${this.children}`; } }
@Page({ services: [GroupService] }) class GroupLayout extends Cossack { render() { return html`${this.children}`; } }
@Page({ services: [TeamService] }) class TeamLayout extends Cossack { render() { return html`${this.children}`; } }
@Page({ services: [DecoyService] }) class DecoyLayout extends Cossack { render() { return html`${this.children}`; } }

@Page({ transport: 'sse', scope: c => `team:${c.req.param('team')}` })
class TeamPage extends Cossack {
  @Inject(TeamService) team!: TeamService;
  @State() chain: ScopeLink[] = [];
  render() {
    this.chain = describeChain(this);
    return html`<main>${this.chain.length}</main>`;
  }
  @Server() async describe() { return describeChain(this); }
}

const pagePath = '/src/pages/(admin)/teams/[team]/index.ts';
const layoutPaths = {
  root: '/src/pages/layout.ts',
  group: '/src/pages/(admin)/layout.ts',
  team: '/src/pages/(admin)/teams/[team]/layout.ts',
  // Neither is an ancestor of the page's source directory.
  otherGroup: '/src/pages/(public)/layout.ts',
  urlTwin: '/src/pages/teams/layout.ts',
};
registry.pages[pagePath] = { default: TeamPage };
registry.layouts[layoutPaths.root] = { default: RootLayout };
registry.layouts[layoutPaths.group] = { default: GroupLayout };
registry.layouts[layoutPaths.team] = { default: TeamLayout };
registry.layouts[layoutPaths.otherGroup] = { default: DecoyLayout };
registry.layouts[layoutPaths.urlTwin] = { default: DecoyLayout };

const { createApp } = await import('../src/router');
const { routePathToIdMap } = computeRouteIds([pagePath], Object.keys(registry.layouts));
const pageId = routePathToIdMap.get(pagePath)!;
const scopeKey = 'team:alpha';
const params = JSON.stringify({ team: 'alpha' });
const env = () => ({ APP_URL: 'http://localhost' }) as any;

const expected = (user: unknown): ScopeLink[] => [
  { owner: null, routeId: null, scopeKey: null, service: null, team: 'alpha', user },
  ...[[layoutPaths.root, 'RootService'], [layoutPaths.group, 'GroupService'], [layoutPaths.team, 'TeamService']]
    .map(([owner, service]) => ({ owner, routeId: routePathToIdMap.get(owner)!, scopeKey, service, team: 'alpha', user })),
];

afterEach(() => __resetSseStore());

const hydratedChain = (html: string): ScopeLink[] =>
  JSON.parse(html.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)![1]).public.chain;

async function viaSsr(): Promise<ScopeLink[]> {
  const response = await createApp().request('/teams/alpha', {}, env());
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.text();
  return hydratedChain(body);
}

async function viaWebSocket(): Promise<ScopeLink[]> {
  let chain: ScopeLink[] = [];
  const app = createApp({ runtimeAdapter: { name: 'test', handleWebSocketUpgrade: async (_context, upgrade: RuntimeWebSocketUpgrade) => {
    const instance = await upgrade.createComponent();
    try { chain = describeChain(instance); } finally { await instance.destroyAsync(); }
    return new Response('ok');
  } } });
  const query = new URLSearchParams({ routePath: '/teams/[team]', pathname: '/teams/alpha', params });
  const response = await app.request(`/ws/${encodeURIComponent(scopeKey)}?${query}`, { headers: { origin: 'http://localhost' } }, env());
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
    ['SSR', viaSsr],
    ['runtime /ws', viaWebSocket],
    ['/crpc', viaRpc],
    ['SSE cold start (Node store)', () => viaSse()],
    ['SSE cold start (Cloudflare coordinator)', () => viaSse(coordinatorEnv())],
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
