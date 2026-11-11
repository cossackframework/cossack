import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { createRouteMatcher, resolveLayoutPaths, resolveNearestSpecialPage } from '../src/route-ids';

const { registry, middlewares } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {}, owners: {} as Record<string, string> },
  middlewares: [] as any[],
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: middlewares }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page()
class Blog extends Cossack { render() { return html`<main>app blog</main>`; } }
@Page()
class Shop extends Cossack { render() { return html`<main>plugin shop</main>`; } }
@Page({ middlewares: [async (c: any, next: any) => { if (c.req.header('x-guard') === 'deny') return c.text('plugin layout guard', 418); await next(); }] })
class PluginLayout extends Cossack { render() { return html`<section>plugin layout ${this.children}</section>`; } }

registry.pages['/src/pages/blog/index.ts'] = { default: Blog };
registry.pages['/src/pages/blog/shop/index.ts'] = { default: Shop };
registry.layouts['/src/pages/blog/layout.ts'] = { default: PluginLayout };
registry.owners['/src/pages/blog/shop/index.ts'] = 'shop';
registry.owners['/src/pages/blog/layout.ts'] = 'shop';
const pluginMiddleware = vi.fn(async (c: any, next: any) => { c.header('x-plugin', 'ran'); await next(); });
middlewares.push(Object.assign((c: any, next: any) => pluginMiddleware(c, next), { cossackPlugin: 'shop' }));
const { createApp } = await import('../src/router');

const active = new Set<string>();
const isPluginActive = vi.fn(async (plugin: string) => active.has(plugin));
const accept = { accept: 'text/html' };

describe('plugin scope', () => {
  beforeEach(() => { active.clear(); pluginMiddleware.mockClear(); });

  it('wraps only the plugin\'s own pages in its layout', () => {
    const layouts = Object.keys(registry.layouts);
    expect(resolveLayoutPaths('/src/pages/blog/index.ts', layouts, registry.owners)).toEqual([]);
    expect(resolveLayoutPaths('/src/pages/blog/shop/index.ts', layouts, registry.owners)).toEqual(['/src/pages/blog/layout.ts']);
    const pages = ['/src/pages/blog/index.ts', '/src/pages/blog/error/index.ts'];
    expect(resolveNearestSpecialPage('/src/pages/blog/index.ts', pages, 'error', { '/src/pages/blog/error/index.ts': 'shop' })).toBeNull();
  });

  it('serves application pages without a plugin layout or its guards, active or not', async () => {
    const app = createApp({ isPluginActive });
    const inactive = await app.request('/blog', { headers: { ...accept, 'x-guard': 'deny' } });
    expect(inactive.status).toBe(200);
    expect(await inactive.text()).not.toContain('plugin layout');
    active.add('shop');
    const page = await app.request('/blog', { headers: { ...accept, 'x-guard': 'deny' } });
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain('plugin layout');
    const own = await app.request('/blog/shop', { headers: accept });
    expect(await own.text()).toContain('plugin layout');
  });

  it('runs a plugin\'s global middleware only while the plugin is active', async () => {
    const app = createApp({ isPluginActive });
    const inactive = await app.request('/blog', { headers: accept });
    expect(inactive.headers.get('x-plugin')).toBeNull();
    expect(pluginMiddleware).not.toHaveBeenCalled();
    active.add('shop');
    const page = await app.request('/blog', { headers: accept });
    expect(page.headers.get('x-plugin')).toBe('ran');
  });
});

describe('route matcher', () => {
  it('picks the most specific route, as the router registers them', () => {
    const match = createRouteMatcher(['/src/pages/blog/[slug]/index.ts', '/src/pages/blog/feed.xml.ts', '/src/pages/index.ts',
      '/src/pages/docs/[...path]/index.ts', '/src/pages/404/index.ts']);
    expect(match('/blog/feed.xml')).toBe('/src/pages/blog/feed.xml.ts');
    expect(match('/blog/hello')).toBe('/src/pages/blog/[slug]/index.ts');
    expect(match('/blog/hello/')).toBe('/src/pages/blog/[slug]/index.ts');
    expect(match('/docs/a/b')).toBe('/src/pages/docs/[...path]/index.ts');
    expect(match('/')).toBe('/src/pages/index.ts');
    expect(match('/404')).toBeNull();
    expect(match('/nothing')).toBeNull();
  });
});
