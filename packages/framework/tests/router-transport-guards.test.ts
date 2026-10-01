import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { computeRouteIds } from '../src/route-ids';

const { constructed, registry } = vi.hoisted(() => ({
  constructed: vi.fn(), registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {} }));

const pagePath = '/src/pages/private/index.ts';
const layoutPath = '/src/pages/layout.ts';
class PrivatePage { constructor() { constructed(); } }
class RootLayout {}
Reflect.defineMetadata('page:options', { middlewares: [async (c: any, next: any) => {
  if (c.req.header('x-test-role') !== 'admin') return c.text('page guard', 403);
  await next();
}] }, PrivatePage);
Reflect.defineMetadata('page:options', { middlewares: [async (c: any, next: any) => {
  if (!c.req.header('x-test-role')) return c.text('layout guard', 401);
  await next();
}] }, RootLayout);
registry.pages[pagePath] = { default: PrivatePage };
registry.layouts[layoutPath] = { default: RootLayout };
const { createApp } = await import('../src/router');
const ids = computeRouteIds([pagePath], [layoutPath]).routePathToIdMap;

describe('router transport guard wiring', () => {
  it.each(['rpc', 'upload', 'sse', 'websocket', 'service'])('runs enclosing layout guards before %s dispatch', async (transport) => {
    const app = createApp();
    const id = ids.get(pagePath)!;
    const url = transport === 'rpc' || transport === 'service' ? '/crpc'
      : transport === 'upload' ? '/upload' : transport === 'sse' ? `/sse/${id}?scopeKey=user:anonymous`
      : '/ws/page/target?routePath=/private';
    const post = ['rpc', 'upload', 'service'].includes(transport);
    const body = transport === 'upload' ? new URLSearchParams({ componentRouteId: id, action: 'secret' })
      : JSON.stringify(transport === 'service' ? { service: { ownerRouteId: ids.get(layoutPath), slot: 'secret' } }
        : { componentRouteId: id, action: 'secret', payload: [] });
    const response = await app.request(url, {
      method: post ? 'POST' : 'GET', headers: { origin: 'http://localhost' }, ...(post ? { body } : {}),
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('layout guard');
    expect(constructed).not.toHaveBeenCalled();
    if (transport !== 'service') {
      const member = await app.request(url, {
        method: post ? 'POST' : 'GET', headers: { origin: 'http://localhost', 'x-test-role': 'member' }, ...(post ? { body } : {}),
      });
      expect(member.status).toBe(403);
      expect(await member.text()).toBe('page guard');
      expect(constructed).not.toHaveBeenCalled();
    }
  });
});


it('rejects service-name collisions with internal component methods', async () => {
  class CollisionService {}
  Reflect.defineMetadata('cossack:service', { scope: 'transient' }, CollisionService);
  Reflect.defineMetadata('cossack:server-methods', { bootstrap: {} }, CollisionService);
  const bootstrap = vi.fn(async () => {});
  class CollisionPage {
    activeComponents = new Map();
    bootstrap = bootstrap;
    _render() {}
    getPublicState() { return {}; }
  }
  Reflect.defineMetadata('design:paramtypes', [CollisionService], CollisionPage);
  registry.pages[pagePath] = { default: CollisionPage };
  try {
    const response = await createApp().request('/crpc', {
      method: 'POST', headers: { origin: 'http://localhost', 'x-test-role': 'admin' },
      body: JSON.stringify({ componentRouteId: ids.get(pagePath), action: 'bootstrap', payload: [] }),
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { error: string }).error).toContain('not a callable server method');
    expect(bootstrap).toHaveBeenCalledOnce();
  } finally {
    registry.pages[pagePath] = { default: PrivatePage };
  }
});
