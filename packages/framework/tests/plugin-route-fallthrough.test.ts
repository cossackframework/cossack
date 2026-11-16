import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry, guarded } = vi.hoisted(() => ({
  guarded: { count: 0 },
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {}, owners: {} as Record<string, string> },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page()
class CatchAll extends Cossack { render() { return html`<main>site page</main>`; } }
@Page()
class Events extends Cossack { render() { return html`<main>plugin events</main>`; } }
// An app layout's guard over the plugin's page: it must not run for a page that steps aside.
@Page({ middlewares: [async (c: any, next: any) => { guarded.count++; if (c.req.header('x-deny')) return c.text('denied', 403); await next(); }] })
class Area extends Cossack { render() { return html`<section>${this.children}</section>`; } }
const feed = vi.fn((c: any) => c.text('plugin feed'));

registry.pages['/src/pages/[...path]/index.ts'] = { default: CatchAll };
registry.pages['/src/pages/events/index.ts'] = { default: Events };
registry.layouts['/src/pages/events/layout.ts'] = { default: Area };
registry.pages['/src/pages/events/feed/index.ts'] = { GET: feed };
registry.owners['/src/pages/events/index.ts'] = 'events';
registry.owners['/src/pages/events/feed/index.ts'] = 'events';
const { createApp } = await import('../src/router');

describe('inactive plugin routes', () => {
  it('step aside for the app route that also matches, as an unknown URL would', async () => {
    let on = false;
    const app = createApp({ isPluginActive: async () => on });
    const page = await app.request('/events', { headers: { accept: 'text/html', 'x-deny': '1' } });
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('site page');
    expect(body).not.toContain('plugin events');
    expect(guarded.count).toBe(0);
    const hook = await app.request('/events/feed', { headers: { accept: 'text/html' } });
    expect(await hook.text()).toContain('site page');
    expect(feed).not.toHaveBeenCalled();
    // Active, the plugin's routes answer as before.
    on = true;
    expect(await (await app.request('/events', { headers: { accept: 'text/html' } })).text()).toContain('plugin events');
    expect(await (await app.request('/events/feed')).text()).toBe('plugin feed');
  });
});
