import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page, StateProvider } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page({ transport: 'durable-object' })
class Room extends Cossack { render() { return html`<main>room</main>`; } }
registry.pages['/src/pages/room/[id]/index.ts'] = { default: Room };

// Scope functions run again for the upgrade, whose URL is /ws/...: route
// params are restored there, the page's query string is not.
@Page({ transport: 'durable-object', scope: c => `board:${c.req.param('id')}:${c.req.query('view') ?? 'none'}` })
class Board extends Cossack { render() { return html`<main>board</main>`; } }
registry.pages['/src/pages/board/[id]/index.ts'] = { default: Board };

class OtherObject extends StateProvider { getConnectionTarget() { return 'id:session:u1'; } }
@Page({ transport: 'durable-object', providers: { session: new OtherObject() } })
class Inbox extends Cossack { render() { return html`<main>inbox</main>`; } }
registry.pages['/src/pages/inbox/index.ts'] = { default: Inbox };
const { createApp } = await import('../src/router');

function environment() {
  const forward = vi.fn(async () => new Response('upgraded'));
  const COSSACK_OBJECT = {
    idFromName: (name: string) => ({ toString: () => `id:${name}` }),
    idFromString: (value: string) => value,
    get: () => ({ fetch: forward }),
  };
  return { env: { COSSACK_OBJECT } as any, forward };
}

async function ssrTargets(url: string): Promise<Record<string, string>> {
  const { env } = environment();
  const response = await createApp().request(url, undefined, env);
  expect(response.status).toBe(200);
  const json = (await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!;
  return JSON.parse(json).providerTargets;
}
const ssrTarget = async (url: string) => (await ssrTargets(url)).page!;

/** Whether the proxy marks an upgrade to `id` as a valid target for the page. */
async function connect(provider: string, id: string, routePath: string, pathname: string, params: Record<string, string>) {
  const { env, forward } = environment();
  const query = new URLSearchParams({ routePath, pathname, params: JSON.stringify(params) });
  const response = await createApp().request(`/ws/${provider}/${encodeURIComponent(id)}?${query}`, { headers: { origin: 'http://localhost' } }, env);
  expect(response.status).toBe(200);
  return (forward.mock.calls[0] as unknown as [Request])[0].headers.get('X-Cossack-Realtime-Target-Valid');
}

describe('default Durable Object page identity', () => {
  it('ignores the query string and host', async () => {
    const plain = await ssrTarget('http://localhost/room/1');
    expect(await ssrTarget('http://localhost/room/1?utm=x')).toBe(plain);
    expect(await ssrTarget('http://other.example/room/1')).toBe(plain);
    expect(await ssrTarget('http://localhost/room/2')).not.toBe(plain);
  });

  it('accepts the SSR-emitted id and rejects a client-chosen mismatch on the WebSocket proxy', async () => {
    const target = await ssrTarget('http://localhost/room/1');
    const room = (id: string, params: Record<string, string>) => connect('page', id, '/room/[id]', '/room/1', params);
    expect(await room(target, { id: '1' })).toBe('true');
    expect(await room('id:some-other-room', { id: '1' })).toBe('false');
    expect(await room(target, { id: '2' })).toBe('false');
  });
});

describe('custom scope and provider targets', () => {
  it('re-evaluates the scope for the upgrade with route params but without the page query', async () => {
    const board = (target: string) => connect('page', target, '/board/[id]', '/board/7', { id: '7' });
    // A scope that reads only route params agrees with SSR.
    expect(await board(await ssrTarget('http://localhost/board/7'))).toBe('true');
    // A scope that reads the page's query string does not.
    const withQuery = await ssrTarget('http://localhost/board/7?view=grid');
    expect(withQuery).toBe('id:board:7:grid');
    expect(await board(withQuery)).toBe('false');
  });

  it('rejects a provider target that differs from the page identity', async () => {
    const targets = await ssrTargets('http://localhost/inbox');
    expect(targets.session).toBe('id:session:u1');
    expect(await connect('session', targets.session!, '/inbox', '/inbox', {})).toBe('false');
    expect(await connect('page', targets.page!, '/inbox', '/inbox', {})).toBe('true');
  });
});
