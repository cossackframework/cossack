import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Page, Service } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { RuntimeWebSocketUpgrade } from '../src/runtime-adapter';
const { registry, session } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
  session: { userId: 'owner' },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  c.set('user', { id: session.userId });
  c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: 'opaque' } }));
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));
const disposed: number[] = [];
let sequence = 0;
const instances: Cossack[] = [];
@Service()
class Scoped extends CossackService {
  id = ++sequence;
  details() { return { team: this.c.req.param('team'), user: this.user, env: this.env }; }
  onDispose() { disposed.push(this.id); }
}
@Page({ services: [Scoped], middlewares: [async (c, next) => { c.set('inheritedGuard', true); await next(); }] }) class Root extends Cossack {}
@Page({ services: [Scoped] }) class Inner extends Cossack {}
@Page({ transport: 'durable-object', scope: c => `team:${c.req.param('team')}` })
class Team extends Cossack {
  @Inject(Scoped) service!: Scoped;
  render() { return html`<main>${this.service.id}</main>`; }
}
registry.layouts['/src/pages/layout.ts'] = { default: Root };
registry.layouts['/src/pages/team/layout.ts'] = { default: Inner };
registry.pages['/src/pages/team/[team]/index.ts'] = { default: Team };
const { createApp } = await import('../src/router');
afterEach(async () => { await Promise.all(instances.splice(0).map(instance => instance.destroyAsync())); disposed.length = 0; sequence = 0; session.userId = 'owner'; });
async function upgrade(consume: (upgrade: RuntimeWebSocketUpgrade) => Promise<Response>) {
  return createApp({ runtimeAdapter: { name: 'test', handleWebSocketUpgrade: (_context, request) => consume(request) } }).request(
    `/ws/${encodeURIComponent(`page:${JSON.stringify(['/src/pages/team/[team]/index.ts', { scope: 'team:alpha' }])}`)}?` +
      new URLSearchParams({ routePath: '/team/[team]', pathname: '/team/alpha', params: JSON.stringify({ team: 'alpha' }) }),
    { headers: { origin: 'http://localhost' } }, { APP_URL: 'http://localhost', MARKER: 'request-env' } as any);
}
it('constructs nested scopes and preserves page params, auth, and bindings through runtime bootstrap', async () => {
  const response = await upgrade(async request => {
    expect(request.context?.req.param('team')).toBe('alpha');
    expect(request.context?.get('user')).toEqual({ id: 'owner' });
    expect(request.context?.env).toMatchObject({ MARKER: 'request-env' });
    const operation = vi.fn(async (fresh: any) => {
      expect(fresh.get('user')).toEqual({ id: 'owner' });
      expect(fresh.get('inheritedGuard')).toBe(true);
      expect(fresh.req.param('team')).toBe('alpha');
      expect(fresh.env).toMatchObject({ MARKER: 'request-env' });
    });
    expect(await request.authorize?.(operation)).toBe(true);
    expect(operation).toHaveBeenCalledOnce();
    session.userId = 'revoked';
    const deniedOperation = vi.fn();
    expect(await request.authorize?.(deniedOperation)).toBe(false);
    expect(deniedOperation).not.toHaveBeenCalled();
    session.userId = 'owner';
    const instance = await request.createComponent() as Team;
    expect(instance.__cossack_rpcOwner).toBe('/src/pages/team/[team]/index.ts');
    instances.push(instance);
    expect(instance.service.id).toBe(2);
    expect(instance.service.details()).toMatchObject({ team: 'alpha', user: { id: 'owner' }, env: { MARKER: 'request-env' } });
    expect(instance.getInitialState()).not.toHaveProperty('services');
    expect(disposed).toEqual([]);
    await instance.destroyAsync();
    await instance.destroyAsync();
    expect(disposed).toEqual([2, 1]);
    return new Response('ok');
  });
  expect(response.status).toBe(200);
});
it.each(['bootstrap', 'constructor'])('cleans the whole scope tree if page %s fails', async phase => {
  class Failing extends Team {
    constructor() { super(); if (phase === 'constructor') throw new Error('creation failed'); }
    async init() { throw new Error('creation failed'); }
  }
  registry.pages['/src/pages/team/[team]/index.ts'] = { default: Failing };
  try {
    const response = await upgrade(async request => {
      await expect(request.createComponent()).rejects.toThrow('creation failed');
      expect(disposed).toEqual([2, 1]);
      return new Response('cleaned');
    });
    expect(response.status).toBe(200);
  } finally { registry.pages['/src/pages/team/[team]/index.ts'] = { default: Team }; }
});
