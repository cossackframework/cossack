import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, type Middleware } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { RuntimeWebSocketUpgrade } from '../src/runtime-adapter';
import { computeRouteIds } from '../src/route-ids';

// Component RPC and WebSocket upgrades run the page's layout and page guards
// with the page's route params, checked as client input, exactly as SSR of
// that URL runs them. A policy that decides on a route param must decide the
// same way on every path, and forged params never reach a guard.
const { registry, guardLog } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
  guardLog: [] as string[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  c.set('user', { id: 'u1' });
  c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: 'u1' } }));
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const guard = (name: string, param: string): Middleware => async (c, next) => {
  guardLog.push(`${name}:${c.req.param(param) ?? '-'}`);
  await next();
};
/** Members of team beta and room beta are not allowed in. */
const denyBeta = (param: string): Middleware => async (c, next) => {
  if (c.req.param(param) === 'beta') return c.json({ error: 'Forbidden', code: 'COSSACK_AUTH_FORBIDDEN' }, 403);
  await next();
};

@Page({ transport: 'http', middlewares: [guard('layout', 'team')] })
class TeamLayout extends Cossack {
  render() { return html`${this.children}`; }
  @Server() async layoutTeam() { guardLog.push('layout-action'); return this.c.req.param('team') ?? null; }
}

@Page({ transport: 'http', middlewares: [guard('page', 'team'), denyBeta('team')] })
class TeamPage extends Cossack {
  render() { return html`<main>team</main>`; }
  @Server() async team() { guardLog.push('action'); return this.c.req.param('team') ?? null; }
}

@Page({ transport: 'http' })
class AboutPage extends Cossack { render() { return html`<main>about</main>`; } }

@Page({ transport: 'durable-object', middlewares: [guard('room', 'room'), denyBeta('room')] })
class RoomPage extends Cossack { render() { return html`<main>room</main>`; } }

const layoutPath = '/src/pages/teams/[team]/layout.ts';
const teamPath = '/src/pages/teams/[team]/index.ts';
const aboutPath = '/src/pages/about/index.ts';
const roomPath = '/src/pages/rooms/[room]/index.ts';
registry.layouts[layoutPath] = { default: TeamLayout };
registry.pages[teamPath] = { default: TeamPage };
registry.pages[aboutPath] = { default: AboutPage };
registry.pages[roomPath] = { default: RoomPage };

const { createApp } = await import('../src/router');
const { realtimeInstanceName } = await import('../src/realtime-scope');
const ids = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts)).routePathToIdMap;
const env = () => ({ APP_URL: 'http://localhost' }) as any;

afterEach(() => { guardLog.length = 0; });

async function rpc(body: Record<string, unknown>) {
  const response = await createApp().request('/crpc', {
    method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: [], state: {}, ...body }),
  }, env());
  return { status: response.status, body: await response.json() as any, guards: guardLog.splice(0) };
}

const forged = [
  ['no params', {}],
  ['an extra param', { team: 'alpha', role: 'admin' }],
  ['an empty param', { team: '' }],
  ['a non-string param', { team: 1 }],
  ['a dot segment', { team: '..' }],
] as const;

describe('component RPC route params', () => {
  const call = (pageParams: unknown) => rpc({ componentRouteId: ids.get(teamPath), action: 'team', pageParams });

  it('runs the layout and page guards with the page params, as SSR does', async () => {
    const ssr = await createApp().request('/teams/alpha', {}, env());
    expect(ssr.status).toBe(200);
    const ssrGuards = guardLog.splice(0);
    expect(ssrGuards).toEqual(['layout:alpha', 'page:alpha']);
    expect(await call({ team: 'alpha' })).toMatchObject({ status: 200, body: { _cossack_return: 'alpha' },
      guards: [...ssrGuards, 'action'] });
  });

  it('lets a page policy deny the param it denies on SSR, before the action runs', async () => {
    expect((await createApp().request('/teams/beta', { headers: { accept: 'application/json' } }, env())).status).toBe(403);
    guardLog.length = 0;
    expect(await call({ team: 'beta' })).toMatchObject({ status: 403, guards: ['layout:beta', 'page:beta'] });
  });

  it.each(forged)('rejects %s with 400 before any guard runs', async (_case, pageParams) => {
    expect(await call(pageParams)).toMatchObject({ status: 400, body: { code: 'COSSACK_RPC_REQUEST_INVALID' }, guards: [] });
  });

  it('runs a layout action under the page the browser is on', async () => {
    const layout = (pageRouteId: unknown, pageParams: unknown) =>
      rpc({ componentRouteId: ids.get(layoutPath), action: 'layoutTeam', pageRouteId, pageParams });
    expect(await layout(ids.get(teamPath), { team: 'alpha' })).toMatchObject({ status: 200, body: { _cossack_return: 'alpha' },
      guards: ['layout:alpha', 'page:alpha', 'layout-action'] });
    expect(await layout(ids.get(teamPath), { team: 'beta' })).toMatchObject({ status: 403, guards: ['layout:beta', 'page:beta'] });
    for (const [pageRouteId, pageParams] of [[undefined, { team: 'alpha' }], [ids.get(aboutPath), {}], [ids.get(teamPath), { team: '' }]]) {
      expect(await layout(pageRouteId, pageParams)).toMatchObject({ status: 400, guards: [] });
    }
  });
});

describe('WebSocket upgrade route params', () => {
  const query = (room: unknown, params: unknown = { room }) => new URLSearchParams({
    routePath: '/rooms/[room]', pathname: `/rooms/${String(room)}`, params: JSON.stringify(params),
  });
  const headers = { origin: 'http://localhost', upgrade: 'websocket' };

  it('runs the page guards with the upgrade params before the Durable Object proxy', async () => {
    const forward = vi.fn(async () => new Response('forwarded'));
    const bindings = { ...env(), COSSACK_OBJECT: {
      idFromName: (name: string) => ({ toString: () => `id:${name}` }),
      idFromString: (value: string) => value,
      get: () => ({ fetch: forward }),
    } };
    const upgrade = (room: string, params?: unknown) => createApp().request(
      `/ws/${encodeURIComponent(`id:${realtimeInstanceName({ kind: 'page', id: roomPath, options: undefined }, undefined, { room })}`)}?${query(room, params)}`, { headers }, bindings);
    const allowed = await upgrade('alpha');
    expect(allowed.status).toBe(200);
    expect(guardLog.splice(0)).toEqual(['room:alpha']);
    expect(forward).toHaveBeenCalledOnce();
    const denied = await upgrade('beta');
    expect(denied.status).toBe(403);
    expect(guardLog.splice(0)).toEqual(['room:beta']);
    expect(forward).toHaveBeenCalledOnce();
    for (const params of [{}, { room: 'alpha', role: 'admin' }, { room: '' }, { room: '.' }, ['alpha']]) {
      expect((await upgrade('alpha', params)).status).toBe(400);
    }
    expect(guardLog).toEqual([]);
    expect(forward).toHaveBeenCalledOnce();
  });

  it('runs the page guards with the upgrade params before a runtime upgrade', async () => {
    const upgrades: RuntimeWebSocketUpgrade[] = [];
    const app = createApp({ runtimeAdapter: { name: 'test', handleWebSocketUpgrade: async (_context, upgrade: RuntimeWebSocketUpgrade) => {
      upgrades.push(upgrade);
      return new Response('upgraded');
    } } });
    const upgrade = (room: string, params?: unknown) => app.request(
      `/ws/${encodeURIComponent(realtimeInstanceName({ kind: 'page', id: roomPath, options: undefined }, undefined, { room }))}?${query(room, params)}`, { headers }, env());
    expect((await upgrade('alpha')).status).toBe(200);
    expect(guardLog.splice(0)).toEqual(['room:alpha']);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0].rejectAuthorization).toBe(false);
    expect((await upgrade('beta')).status).toBe(403);
    expect(guardLog.splice(0)).toEqual(['room:beta']);
    for (const params of [{}, { room: 'alpha', extra: 'x' }, { room: '..' }]) {
      expect((await upgrade('alpha', params)).status).toBe(400);
    }
    expect(guardLog).toEqual([]);
    expect(upgrades).toHaveLength(1);
  });
});
