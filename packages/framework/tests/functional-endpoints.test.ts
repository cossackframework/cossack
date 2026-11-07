import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page()
class Home extends Cossack { render() { return html`<main>home</main>`; } }
@Page()
class NotFound extends Cossack { render() { return html`<h1>app not found</h1>`; } }
class NotAComponent { static handled = false; }

registry.pages['/src/pages/index.ts'] = { default: Home };
registry.pages['/src/pages/404/index.ts'] = { default: NotFound };
// Endpoints by their exports, at paths that are not under /api.
registry.pages['/src/pages/feed.xml/index.ts'] = { GET: (c: any) => c.text('<rss/>', 200, { 'content-type': 'application/rss+xml' }) };
registry.pages['/src/pages/webhooks/crm/index.ts'] = { POST: async (c: any) => c.json({ received: await c.req.json() }) };
registry.pages['/src/pages/downloads/[file]/index.ts'] = { default: (c: any) => c.text(`download ${c.req.param('file')}`) };
registry.pages['/src/pages/private/report/index.ts'] = { GET: () => { throw Object.assign(new Error('no'), { authorizationCode: 'COSSACK_AUTH_FORBIDDEN' }); } };
// A default export that is a class but not a component is neither a page nor a handler.
registry.pages['/src/pages/legacy/index.ts'] = { default: NotAComponent, GET: () => { NotAComponent.handled = true; return new Response('leaked'); } };
const { createApp } = await import('../src/router');

describe('functional HTTP handlers outside /api', () => {
  const app = createApp();

  it('serve their exported methods at the file path', async () => {
    const feed = await app.request('/feed.xml');
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toBe('application/rss+xml');
    expect(await feed.text()).toBe('<rss/>');
    const hook = await app.request('/webhooks/crm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 7 }) });
    expect(hook.status).toBe(200);
    expect(await hook.json()).toEqual({ received: { id: 7 } });
    const download = await app.request('/downloads/report.pdf', { method: 'DELETE' });
    expect(await download.text()).toBe('download report.pdf');
  });

  it('leave other methods to the usual 404 rules', async () => {
    const page = await app.request('/webhooks/crm', { headers: { accept: 'text/html' } });
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('app not found');
    const json = await app.request('/webhooks/crm', { headers: { accept: 'application/json' } });
    expect(json.status).toBe(404);
    expect(await json.json()).toEqual({ error: 'Not Found', code: 'COSSACK_NOT_FOUND' });
  });

  it('answer denials as JSON even to a browser navigation', async () => {
    const denied = await app.request('/private/report', { headers: { accept: 'text/html' } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('content-type')).toMatch(/application\/json/);
    expect(await denied.json()).toMatchObject({ code: 'COSSACK_AUTH_FORBIDDEN' });
  });

  it('ignore a module whose default export is not a component or a function', async () => {
    const response = await app.request('/legacy', { headers: { accept: 'text/html' } });
    expect(response.status).toBe(404);
    expect(NotAComponent.handled).toBe(false);
  });
});
