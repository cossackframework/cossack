import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';

const { registry, constructed } = vi.hoisted(() => ({
  constructed: vi.fn(),
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {}, owners: {} as Record<string, string> },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page()
class Home extends Cossack { render() { return html`<main>home</main>`; } }
@Page()
class AppNotFound extends Cossack { render() { return html`<h1>app not found</h1>`; } }
@Page({ middlewares: [async (c: any, next: any) => { if (c.req.header('x-guard') === 'deny') return c.text('plugin guard', 418); await next(); }] })
class SupportHome extends Cossack { constructor() { super(); constructed(); } render() { return html`<main>support home</main>`; } }
@Page()
class SupportLayout extends Cossack { render() { return html`<section>support layout ${this.children}</section>`; } }
@Page()
class SupportNotFound extends Cossack { render() { return html`<h1>support not found</h1>`; } }
const handled = vi.fn();

const supportPage = '/src/pages/support/index.ts';
const supportLayout = '/src/pages/support/layout.ts';
registry.pages['/src/pages/index.ts'] = { default: Home };
registry.pages['/src/pages/404/index.ts'] = { default: AppNotFound };
registry.pages[supportPage] = { default: SupportHome };
registry.pages['/src/pages/support/404/index.ts'] = { default: SupportNotFound };
registry.pages['/src/pages/webhooks/support/index.ts'] = { POST: (c: any) => { handled(); return c.json({ ok: true }); } };
registry.layouts[supportLayout] = { default: SupportLayout };
for (const key of [supportPage, supportLayout, '/src/pages/support/404/index.ts', '/src/pages/webhooks/support/index.ts']) registry.owners[key] = 'support-desk';
const { createApp } = await import('../src/router');
const ids = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts)).routePathToIdMap;

const active = new Set<string>();
const isPluginActive = vi.fn(async (plugin: string) => active.has(plugin));
const html_ = { accept: 'text/html' };

describe('plugin route activation', () => {
  beforeEach(() => { active.clear(); constructed.mockClear(); handled.mockClear(); isPluginActive.mockClear(); });

  it('serves a plugin page, its boundary and its handler while the plugin is active', async () => {
    active.add('support-desk');
    const app = createApp({ isPluginActive });
    const page = await app.request('/support', { headers: html_ });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('support home');
    expect(constructed).toHaveBeenCalled();
    const missing = await app.request('/support/missing', { headers: html_ });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('support not found');
    const hook = await app.request('/webhooks/support', { method: 'POST' });
    expect(hook.status).toBe(200);
    expect(handled).toHaveBeenCalled();
    expect(isPluginActive).toHaveBeenCalledWith('support-desk', expect.anything());
  });

  it('answers an inactive plugin like an unknown URL, before its guards, and without its boundaries', async () => {
    const app = createApp({ isPluginActive });
    const page = await app.request('/support', { headers: { ...html_, 'x-guard': 'deny' } });
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('app not found');
    expect(constructed).not.toHaveBeenCalled();
    const missing = await app.request('/support/missing', { headers: html_ });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('app not found');
    const hook = await app.request('/webhooks/support', { method: 'POST', headers: { accept: 'application/json' } });
    expect(hook.status).toBe(404);
    expect(await hook.json()).toEqual({ error: 'Not Found', code: 'COSSACK_NOT_FOUND' });
    expect(handled).not.toHaveBeenCalled();
    // Application routes are untouched.
    expect((await app.request('/', { headers: html_ })).status).toBe(200);
  });

  it('covers RPC and SSE addressed to the plugin\'s components', async () => {
    const app = createApp({ isPluginActive });
    const id = ids.get(supportPage)!;
    const rpc = () => app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-guard': 'deny' },
      body: JSON.stringify({ componentRouteId: id, action: 'secret', payload: [] }) });
    const inactive = await rpc();
    expect(inactive.status).toBe(404);
    expect(await inactive.json()).toEqual({ error: 'Not Found', code: 'COSSACK_NOT_FOUND' });
    const sse = await app.request(`/sse/${id}?scopeKey=user:anonymous`, { headers: { origin: 'http://localhost', 'x-guard': 'deny' } });
    expect(sse.status).toBe(404);
    active.add('support-desk');
    // Active: the plugin's own guard is what answers now.
    const guarded = await rpc();
    expect(guarded.status).toBe(418);
    expect(await guarded.text()).toBe('plugin guard');
  });

  it('keeps every plugin route live without the option', async () => {
    const app = createApp();
    expect((await app.request('/support', { headers: html_ })).status).toBe(200);
    expect((await app.request('/webhooks/support', { method: 'POST' })).status).toBe(200);
    expect(await (await app.request('/support/missing', { headers: html_ })).text()).toContain('support not found');
  });
});
