import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, type Middleware } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';

// Route params from a transport request are client input. Params that a more
// specific sibling route would match (`team: 'new'` next to a literal
// `/teams/new` page) describe a URL the router dispatches to that sibling, so
// they must never run the dynamic page's guards or action.
const { registry, guardLog } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} as Record<string, any> },
  guardLog: [] as string[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const guard = (name: string, param: string): Middleware => async (c, next) => {
  guardLog.push(`${name}:${c.req.param(param) ?? '-'}`);
  await next();
};

@Page({ transport: 'http', middlewares: [guard('team', 'team')] })
class TeamPage extends Cossack {
  render() { return html`<main>team</main>`; }
  @Server() async team() { guardLog.push('action'); return this.c.req.param('team') ?? null; }
}

@Page({ transport: 'http' })
class NewTeamPage extends Cossack { render() { return html`<main>new team</main>`; } }

@Page({ transport: 'http' })
class DocsPage extends Cossack { render() { return html`<main>docs</main>`; } }

@Page({ transport: 'http' })
class IntroPage extends Cossack { render() { return html`<main>intro</main>`; } }

@Page({ transport: 'durable-object' })
class RoomPage extends Cossack { render() { return html`<main>room</main>`; } }

@Page({ transport: 'durable-object' })
class LobbyPage extends Cossack { render() { return html`<main>lobby</main>`; } }

@Page({ transport: 'http' })
class TeamNotFound extends Cossack { render() { return html`<main>missing</main>`; } }

const teamPath = '/src/pages/teams/[team]/index.ts';
const newTeamPath = '/src/pages/teams/new/index.ts';
const docsPath = '/src/pages/docs/[...slug]/index.ts';
const introPath = '/src/pages/docs/intro/index.ts';
const roomPath = '/src/pages/rooms/[room]/index.ts';
const lobbyPath = '/src/pages/rooms/lobby/index.ts';
const notFoundPath = '/src/pages/teams/404.ts';
registry.pages[teamPath] = { default: TeamPage };
registry.pages[newTeamPath] = { default: NewTeamPage };
registry.pages[docsPath] = { default: DocsPage };
registry.pages[introPath] = { default: IntroPage };
registry.pages[roomPath] = { default: RoomPage };
registry.pages[lobbyPath] = { default: LobbyPage };
registry.pages[notFoundPath] = { default: TeamNotFound };

const { createApp } = await import('../src/router');
const { checkPageRouteParams } = await import('../src/transports/rpc-target');
const { checkSseRouteParams } = await import('../src/transports/security');
const { resolveRealtimeConnection } = await import('../src/transports/realtime-target');
const routeIds = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts));
const ids = routeIds.routePathToIdMap;
const ctx = {
  pages: registry.pages, layouts: registry.layouts, routeIdMap: routeIds.routeIdMap,
  routePathToFilePathMap: new Map(Object.keys(registry.pages).map(path => [path, path])), realtimeComponents: {},
} as any;

afterEach(() => { guardLog.length = 0; });

describe('route params that a more specific sibling route matches', () => {
  it('accepts params only when the router dispatches their URL to the claimed page', () => {
    expect(checkPageRouteParams(ctx, teamPath, { team: 'alpha' })).toEqual({ team: 'alpha' });
    expect(checkPageRouteParams(ctx, teamPath, { team: 'new' })).toBeUndefined();
    expect(checkPageRouteParams(ctx, newTeamPath, {})).toEqual({});
    // Encoding cannot sneak a literal sibling past the check, and a value that
    // only looks like the sibling stays with the dynamic page.
    expect(checkPageRouteParams(ctx, teamPath, { team: 'NEW' })).toEqual({ team: 'NEW' });
    expect(checkPageRouteParams(ctx, teamPath, { team: 'new/more' })).toEqual({ team: 'new/more' });
  });

  it('applies to catch-all routes segment by segment', () => {
    expect(checkPageRouteParams(ctx, docsPath, { slug: 'intro' })).toBeUndefined();
    expect(checkPageRouteParams(ctx, docsPath, { slug: 'intro/more' })).toEqual({ slug: 'intro/more' });
    expect(checkPageRouteParams(ctx, docsPath, { slug: 'guide' })).toEqual({ slug: 'guide' });
  });

  it('leaves 404 and error pages to the params of the route below them', () => {
    expect(checkPageRouteParams(ctx, notFoundPath, { team: 'new' })).toEqual({ team: 'new' });
  });

  it('rejects component RPC for the sibling URL before any guard or the action runs', async () => {
    const call = async (pageParams: unknown) => {
      const response = await createApp().request('/crpc', {
        method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: [], state: {}, componentRouteId: ids.get(teamPath), action: 'team', pageParams }),
      }, { APP_URL: 'http://localhost' } as any);
      return { status: response.status, body: await response.json() as any, guards: guardLog.splice(0) };
    };
    expect(await call({ team: 'alpha' })).toMatchObject({ status: 200, body: { _cossack_return: 'alpha' }, guards: ['team:alpha', 'action'] });
    expect(await call({ team: 'new' })).toMatchObject({ status: 400, body: { code: 'COSSACK_RPC_REQUEST_INVALID' }, guards: [] });
  });

  it('rejects a WebSocket upgrade whose params belong to a literal sibling', () => {
    const query = (params: Record<string, string>) => (name: string) =>
      ({ routePath: roomPath, params: JSON.stringify(params) } as Record<string, string>)[name];
    expect('target' in resolveRealtimeConnection(ctx, query({ room: 'alpha' }))).toBe(true);
    expect(resolveRealtimeConnection(ctx, query({ room: 'lobby' }))).toMatchObject({ error: 'params' });
  });

  it('rejects SSE params that belong to a literal sibling', () => {
    expect(checkSseRouteParams(ctx, teamPath, JSON.stringify({ team: 'alpha' }))).toEqual({ team: 'alpha' });
    expect(checkSseRouteParams(ctx, teamPath, JSON.stringify({ team: 'new' }))).toBeUndefined();
  });
});
