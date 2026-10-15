import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
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

@Page({ transport: 'durable-object' })
class Room extends Cossack { render() { return html`<main>room</main>`; } }
registry.pages['/src/pages/room/[id]/index.ts'] = { default: Room };

// Scope functions run again for the upgrade, whose URL is /ws/...: route
// params are restored there, the page's query string is not.
@Page({ transport: 'durable-object', scope: c => `board:${c.req.param('id')}:${c.req.query('view') ?? 'none'}` })
class Board extends Cossack { render() { return html`<main>board</main>`; } }
registry.pages['/src/pages/board/[id]/index.ts'] = { default: Board };

// One real-time instance per signed-in user for every URL of this page. The
// scope fails closed: an anonymous request never falls back to a shared key.
const userScope = (c: any) => {
  const user = c.get('user');
  if (!user) throw Object.assign(new Error('Authentication required'), { authorizationCode: 'COSSACK_AUTH_UNAUTHENTICATED' });
  return `user:${user.id}`;
};
@Page({ transport: 'durable-object', scope: userScope })
class Inbox extends Cossack { render() { return html`<main>inbox</main>`; } }
registry.pages['/src/pages/inbox/[folder]/index.ts'] = { default: Inbox };
const { createApp } = await import('../src/router');

function environment() {
  const forward = vi.fn(async () => new Response('upgraded'));
  const addressed: unknown[] = [];
  const COSSACK_OBJECT = {
    idFromName: (name: string) => ({ toString: () => `id:${name}` }),
    idFromString: (value: string) => value,
    get: (id: unknown) => { addressed.push(id); return { fetch: forward }; },
  };
  return { env: { COSSACK_OBJECT } as any, forward, addressed };
}

async function ssrState(url: string, user?: string): Promise<Record<string, any>> {
  const { env } = environment();
  const response = await createApp().request(url, user ? { headers: { 'x-test-user': user } } : undefined, env);
  expect(response.status).toBe(200);
  const json = (await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!;
  return JSON.parse(json);
}
const ssrTarget = async (url: string, user?: string) => (await ssrState(url, user)).realtimeTarget as string;

/** Upgrade `/ws/:id` and report the proxy's verdict and the object it addressed. */
async function upgrade(id: string, routePath: string, pathname: string, params: Record<string, string>, user?: string) {
  const { env, forward, addressed } = environment();
  const query = new URLSearchParams({ routePath, pathname, params: JSON.stringify(params) });
  const response = await createApp().request(`/ws/${encodeURIComponent(id)}?${query}`, {
    headers: { origin: 'http://localhost', ...(user ? { 'x-test-user': user } : {}) },
  }, env);
  const forwarded = (forward.mock.calls[0] as unknown as [Request] | undefined)?.[0];
  return { response, forwarded, addressed, valid: forwarded?.headers.get('X-Cossack-Realtime-Target-Valid') };
}
async function connect(id: string, routePath: string, pathname: string, params: Record<string, string>, user?: string) {
  const result = await upgrade(id, routePath, pathname, params, user);
  expect(result.response.status).toBe(200);
  return result.valid;
}

describe('default Durable Object page identity', () => {
  it('ignores the query string and host', async () => {
    const plain = await ssrTarget('http://localhost/room/1');
    expect(await ssrTarget('http://localhost/room/1?utm=x')).toBe(plain);
    expect(await ssrTarget('http://other.example/room/1')).toBe(plain);
    expect(await ssrTarget('http://localhost/room/2')).not.toBe(plain);
  });

  it('emits the page realtime target', async () => {
    const state = await ssrState('http://localhost/room/1');
    expect(state.realtimeTarget).toMatch(/^id:page:/);
  });

  it('accepts the SSR-emitted id and rejects a client-chosen mismatch on the WebSocket proxy', async () => {
    const target = await ssrTarget('http://localhost/room/1');
    const room = (id: string, params: Record<string, string>) => connect(id, '/room/[id]', '/room/1', params);
    expect(await room(target, { id: '1' })).toBe('true');
    expect(await room('id:some-other-room', { id: '1' })).toBe('false');
    expect(await room(target, { id: '2' })).toBe('false');
  });
});

describe('custom scope targets', () => {
  it('re-evaluates the scope for the upgrade with route params but without the page query', async () => {
    const board = (target: string) => connect(target, '/board/[id]', '/board/7', { id: '7' });
    // A scope that reads only route params agrees with SSR.
    expect(await board(await ssrTarget('http://localhost/board/7'))).toBe('true');
    // A scope that reads the page's query string does not.
    const withQuery = await ssrTarget('http://localhost/board/7?view=grid');
    expect(withQuery).toBe('id:board:7:grid');
    expect(await board(withQuery)).toBe('false');
  });

  it('shares one object per user across the URLs of a user-scoped page and isolates other users', async () => {
    const work = await ssrTarget('http://localhost/inbox/work', 'alice');
    expect(await ssrTarget('http://localhost/inbox/home', 'alice')).toBe(work);
    expect(work).toBe('id:user:alice');
    const bob = await ssrTarget('http://localhost/inbox/work', 'bob');
    expect(bob).toBe('id:user:bob');

    const inbox = (target: string, folder: string, user?: string) =>
      upgrade(target, '/inbox/[folder]', `/inbox/${folder}`, { folder }, user);
    const alice = await inbox(work, 'home', 'alice');
    expect(alice.valid).toBe('true');
    expect(alice.addressed).toEqual([work]);
    expect(decodeURIComponent(alice.forwarded!.headers.get('X-Cossack-Realtime-Scope')!)).toBe('user:alice');
    // Another user naming alice's object is flagged, so the object rejects it.
    expect((await inbox(work, 'home', 'bob')).valid).toBe('false');
    expect((await inbox(bob, 'work', 'bob')).valid).toBe('true');
  });

  it('rejects a client-supplied target that differs from the server-computed scope key', async () => {
    const own = await ssrTarget('http://localhost/inbox/work', 'alice');
    const inbox = (target: string) => connect(target, '/inbox/[folder]', '/inbox/work', { folder: 'work' }, 'alice');
    expect(await inbox(own)).toBe('true');
    for (const forged of ['id:user:bob', 'id:user:alice:extra', 'user:alice', 'id:page:inbox']) {
      expect(await inbox(forged)).toBe('false');
    }
  });

  it('fails closed for anonymous users of a user-scoped page', async () => {
    const { env } = environment();
    const page = await createApp().request('http://localhost/inbox/work', { headers: { accept: 'application/json' } }, env);
    expect(page.status).toBe(401);
    const result = await upgrade('id:user:anonymous', '/inbox/[folder]', '/inbox/work', { folder: 'work' });
    expect(result.response.status).toBe(401);
    expect(result.forwarded).toBeUndefined();
  });
});
