import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { RuntimeWebSocketUpgrade } from '../src/runtime-adapter';
import { realtimeObjectName } from '../src/realtime-scope';

/**
 * Process-local runtimes (Node) must name a `durable-object` page's shared
 * instance exactly as Cloudflare names its Durable Object: one instance per
 * page plus route params, shared by every user, independent of host and query.
 */
const { registry, session } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
  session: { userId: 'alice' },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  c.set('user', { id: session.userId });
  c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: session.userId } }));
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page({ transport: 'durable-object' })
class Room extends Cossack { render() { return html`<main>room</main>`; } }
@Page({ transport: 'durable-object', scope: c => `team:${c.req.param('id')}` })
class Team extends Cossack { render() { return html`<main>team</main>`; } }
const roomPath = '/src/pages/room/[id]/index.ts';
registry.pages[roomPath] = { default: Room };
registry.pages['/src/pages/team/[id]/index.ts'] = { default: Team };
const { createApp } = await import('../src/router');

const upgrades: RuntimeWebSocketUpgrade[] = [];
const app = createApp({ runtimeAdapter: { name: 'node', handleWebSocketUpgrade: async (_context, request) => {
  upgrades.push(request);
  return new Response('upgraded');
} } });

async function ssrTarget(path: string, userId: string): Promise<string> {
  session.userId = userId;
  const response = await app.request(path);
  expect(response.status).toBe(200);
  const json = (await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!;
  return JSON.parse(json).providerTargets.page;
}

async function connect(routePath: string, id: string, target: string, userId: string): Promise<RuntimeWebSocketUpgrade> {
  session.userId = userId;
  const query = new URLSearchParams({ routePath, pathname: routePath.replace('[id]', id), params: JSON.stringify({ id }) });
  // Clients percent-encode the target as one path segment.
  const response = await app.request(`/ws/page/${encodeURIComponent(target)}?${query}`, { headers: { origin: 'http://localhost' } });
  expect(response.status).toBe(200);
  return upgrades.at(-1)!;
}

it('emits one shared target per page plus route params, for every user', async () => {
  const expected = realtimeObjectName(undefined, 'ignored', roomPath, { id: '1' });
  expect(await ssrTarget('/room/1', 'alice')).toBe(expected);
  expect(await ssrTarget('/room/1?utm=campaign', 'bob')).toBe(expected);
  expect(await ssrTarget('/room/2', 'alice')).not.toBe(expected);
});

it('lets a second user join the shared instance and rejects a target it does not own', async () => {
  const shared = await ssrTarget('/room/1', 'alice');
  const joined = await connect('/room/[id]', '1', shared, 'bob');
  expect(joined.target).toBe(shared);
  expect(joined.rejectAuthorization).toBe(false);
  expect(await joined.authorize?.(async () => {})).toBe(true);

  // The previous per-user default and another room's instance are both refused.
  expect((await connect('/room/[id]', '1', 'user:bob', 'bob')).rejectAuthorization).toBe(true);
  expect((await connect('/room/[id]', '1', await ssrTarget('/room/2', 'bob'), 'bob')).rejectAuthorization).toBe(true);
});

it('bootstraps the shared instance with the page target', async () => {
  const shared = await ssrTarget('/room/1', 'alice');
  const upgrade = await connect('/room/[id]', '1', shared, 'alice');
  const instance = await upgrade.createComponent();
  try {
    expect(instance.getInitialState().providerTargets).toMatchObject({ page: shared });
  } finally {
    await instance.destroyAsync();
  }
});

it('keeps custom scope keys as the target', async () => {
  expect(await ssrTarget('/team/alpha', 'alice')).toBe('team:alpha');
  expect((await connect('/team/[id]', 'alpha', 'team:alpha', 'bob')).rejectAuthorization).toBe(false);
  expect((await connect('/team/[id]', 'alpha', 'team:beta', 'bob')).rejectAuthorization).toBe(true);
});
