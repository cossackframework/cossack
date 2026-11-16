import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { MiddlewareHandler as Middleware } from 'hono';
import { computeRouteIds } from '../src/route-ids';

// The development server's registry: every key from the start, a module only once it is asked
// for. The router must answer exactly as it does with every page imported up front.
const { registry, modules, loaded, log } = vi.hoisted(() => {
  const modules: Record<string, any> = {};
  const loaded: string[] = [];
  const pages: Record<string, any> = {};
  const registry = {
    pages, layouts: {} as Record<string, any>, loadings: {},
    load: async (keys: readonly (string | undefined)[]) => {
      for (const key of keys) {
        if (typeof key !== 'string' || !Object.hasOwn(pages, key) || pages[key] !== undefined) continue;
        if (!Object.hasOwn(modules, key)) throw new Error('private compiler detail');
        await Promise.resolve();
        loaded.push(key);
        pages[key] = modules[key];
      }
    },
  };
  return { registry, modules, loaded, log: [] as string[] };
});
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const guard = (name: string): Middleware => async (c, next) => { log.push(`${name}:${c.req.param('team') ?? '-'}`); await next(); };

@Page()
class Home extends Cossack { render() { return html`<main>home</main>`; } }
@Page()
class NotFound extends Cossack { render() { return html`<h1>app not found</h1>`; } }
@Page({ transport: 'http', middlewares: [guard('page')] })
class Team extends Cossack {
  render() { return html`<main>team</main>`; }
  @Server() async team() { log.push('action'); return this.c.req.param('team') ?? null; }
  async post() { return { posted: true }; }
}
@Page()
class NewTeam extends Cossack { render() { return html`<main>new team</main>`; } }
@Page()
class CatchAll extends Cossack { render() { return html`<main>catch-all</main>`; } }

const home = '/src/pages/index.ts', team = '/src/pages/teams/[team]/index.ts', fresh = '/src/pages/teams/new/index.ts';
modules[home] = { default: Home };
modules[team] = { default: Team };
modules[fresh] = { default: NewTeam };
modules['/src/pages/site/[...path]/index.ts'] = { default: CatchAll };
modules['/src/pages/feed.xml/index.ts'] = { GET: (c: any) => c.text('<rss/>') };
modules['/src/pages/webhooks/crm/index.ts'] = { POST: async (c: any) => c.json({ received: await c.req.json() }) };
modules['/src/pages/downloads/[file]/index.ts'] = { default: (c: any) => c.text(`download ${c.req.param('file')}`) };
modules['/src/pages/private/report/index.ts'] = { GET: () => { throw Object.assign(new Error('no'), { authorizationCode: 'COSSACK_AUTH_FORBIDDEN' }); } };
for (const key of Object.keys(modules)) registry.pages[key] = undefined;
// Boundaries are imported up front, as the generated registry does.
registry.pages['/src/pages/404/index.ts'] = { default: NotFound };

const { createApp } = await import('../src/router');
const ids = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts)).routePathToIdMap;
const env = () => ({ APP_URL: 'http://localhost' }) as any;
const unload = () => { for (const key of Object.keys(modules)) registry.pages[key] = undefined; loaded.length = 0; log.length = 0; };
afterEach(unload);

describe('pages that load on first use', () => {
  it('loads no page to start, and only the page a request is for', async () => {
    const app = createApp();
    expect(loaded).toEqual([]);
    const response = await app.request('/', {}, env());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('home');
    expect(loaded).toEqual([home]);
    await app.request('/', {}, env());
    expect(loaded).toEqual([home]);
  });

  it('keeps a literal route ahead of its parameter sibling, and runs page middleware', async () => {
    const app = createApp();
    expect(await (await app.request('/teams/new', {}, env())).text()).toContain('new team');
    expect(loaded).toEqual([fresh]);
    expect(await (await app.request('/teams/alpha', {}, env())).text()).toContain('<main>team</main>');
    expect(log).toEqual(['page:alpha']);
    const head = await app.request('/teams/alpha', { method: 'HEAD' }, env());
    expect(head.status).toBe(200);
  });

  it('serves a page\'s own HTTP methods and leaves the others to the 404 rules', async () => {
    const app = createApp();
    const posted = await app.request('/teams/alpha', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: '{}' }, env());
    expect(posted.status).toBe(200);
    expect(log).toEqual(['page:alpha']);
    const removed = await app.request('/teams/alpha', { method: 'DELETE', headers: { accept: 'application/json' } }, env());
    expect(removed.status).toBe(404);
  });

  it('serves functional handlers by their exports', async () => {
    const app = createApp();
    expect(await (await app.request('/feed.xml', {}, env())).text()).toBe('<rss/>');
    const hook = await app.request('/webhooks/crm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 7 }) }, env());
    expect(await hook.json()).toEqual({ received: { id: 7 } });
    expect(await (await app.request('/downloads/report.pdf', { method: 'DELETE' }, env())).text()).toBe('download report.pdf');
    const page = await app.request('/webhooks/crm', { headers: { accept: 'text/html' } }, env());
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('app not found');
    const denied = await app.request('/private/report', { headers: { accept: 'text/html' } }, env());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'COSSACK_AUTH_FORBIDDEN' });
  });

  it('loads the page an RPC call names before its guards and its action run', async () => {
    const response = await createApp().request('/crpc', {
      method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: [], state: {}, componentRouteId: ids.get(team), action: 'team', pageParams: { team: 'alpha' } }),
    }, env());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ _cossack_return: 'alpha' });
    expect(log).toEqual(['page:alpha', 'action']);
    expect(loaded).toEqual([team]);
  });

  it('fails only the route of a page that cannot load, and loads it once it can', async () => {
    const broken = '/src/pages/broken/index.ts';
    registry.pages[broken] = undefined;
    const { createApp: fresh } = await import('../src/router');
    const app = fresh();
    const failed = await app.request('/broken', { headers: { accept: 'application/json' } }, env());
    expect(failed.status).toBe(500);
    const answer = await failed.text();
    expect(JSON.parse(answer)).toMatchObject({ error: 'Internal Server Error', code: 'COSSACK_REQUEST_INTERNAL' });
    expect(answer).not.toContain('private compiler detail');
    expect((await app.request('/', {}, env())).status).toBe(200);
    @Page()
    class Repaired extends Cossack { render() { return html`<main>repaired</main>`; } }
    modules[broken] = { default: Repaired };
    expect(await (await app.request('/broken', {}, env())).text()).toContain('repaired');
    delete modules[broken];
    delete registry.pages[broken];
  });

  it('answers an unknown URL with the 404 page without loading any page', async () => {
    const response = await createApp().request('/nowhere', { headers: { accept: 'text/html' } }, env());
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('app not found');
    expect(loaded).toEqual([]);
  });
});
