import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
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

async function ssrTarget(url: string) {
  const { env } = environment();
  const response = await createApp().request(url, undefined, env);
  expect(response.status).toBe(200);
  const json = (await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!;
  return JSON.parse(json).providerTargets.page as string;
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
    const connect = async (id: string, params: Record<string, string>) => {
      const { env, forward } = environment();
      const query = new URLSearchParams({ routePath: '/room/[id]', pathname: '/room/1', params: JSON.stringify(params) });
      const response = await createApp().request(`/ws/page/${encodeURIComponent(id)}?${query}`, { headers: { origin: 'http://localhost' } }, env);
      expect(response.status).toBe(200);
      return (forward.mock.calls[0] as unknown as [Request])[0].headers.get('X-Cossack-Realtime-Target-Valid');
    };
    expect(await connect(target, { id: '1' })).toBe('true');
    expect(await connect('id:some-other-room', { id: '1' })).toBe('false');
    expect(await connect(target, { id: '2' })).toBe('false');
  });
});
