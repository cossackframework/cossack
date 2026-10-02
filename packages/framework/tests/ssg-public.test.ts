import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { collectSsgRoutes, renderSsgPage } from '../src/ssg-renderer';
import { resolveLayoutPaths } from '../src/route-ids';
import { getRequestContext } from '@cossackframework/core';

@Page({ transport: 'http' })
class App extends Cossack {
  render() { return html`${this.children}`; }
}

function render(PageComponent: new () => Cossack, options: {
  path?: string;
  file?: string;
  params?: Record<string, string>;
  middlewares?: MiddlewareHandler[];
  layouts?: Record<string, { default: new () => Cossack }>;
} = {}) {
  return renderSsgPage(PageComponent, options.path ?? '/public', options.params,
    options.layouts ?? {}, 'https://site.example.test', App, undefined,
    options.file, undefined, undefined, undefined, {}, options.middlewares);
}

describe('public-only SSG requests', () => {
  it('renders App, layout, page and hydration without a synthetic user', async () => {
    @Page()
    class Layout extends Cossack {
      render() { return html`<div data-layout-user="${this.user?.id ?? 'anonymous'}">${this.children}</div>`; }
    }
    @Page({ ssg: true })
    class PublicPage extends Cossack {
      render() { return html`<main>${this.user?.id ?? 'anonymous'}:${this.c.get('user')?.id ?? 'anonymous'}</main>`; }
    }
    const output = await render(PublicPage, { layouts: { '/src/pages/layout.ts': { default: Layout } } });
    expect(output.replace(/<!--[\s\S]*?-->/g, '')).toContain('anonymous:anonymous');
    expect(output).toMatch(/data-layout-user=["']?anonymous/);
    expect(output).not.toContain('ssg-user');
  });

  it('runs global, grouped, dynamic layout and page middleware before lifecycle methods', async () => {
    const calls: string[] = [];
    const middleware = (name: string): MiddlewareHandler => async (c, next) => {
      expect(getRequestContext()).toBe(c);
      expect(c.req.param('id')).toBe(name === 'global' ? undefined : 'alice');
      expect(getCookie(c, 'session')).toBeUndefined();
      expect(c.env.APP_URL).toBe('https://site.example.test');
      calls.push(`${name}:before`);
      await next();
      calls.push(`${name}:after`);
    };
    @Page({ middlewares: [middleware('root')] })
    class RootLayout extends Cossack { render() { return html`${this.children}`; } }
    @Page({ middlewares: [middleware('group')] })
    class GroupLayout extends RootLayout {}
    @Page({ middlewares: [middleware('dynamic')] })
    class DynamicLayout extends RootLayout {}
    @Page({ ssg: true, middlewares: [middleware('page')] })
    class PublicPage extends Cossack {
      async init() { calls.push('init'); }
      render() { return html`<main>${this.c.req.param('id')}</main>`; }
    }
    const output = await render(PublicPage, {
      path: '/users/alice', file: '/src/pages/(public)/users/[id]/index.ts',
      middlewares: [middleware('global')], layouts: {
        '/src/pages/layout.ts': { default: RootLayout },
        '/src/pages/(public)/layout.ts': { default: GroupLayout },
        '/src/pages/(public)/users/[id]/layout.ts': { default: DynamicLayout },
      },
    });
    expect(output.replace(/<!--[\s\S]*?-->/g, '')).toContain('<main>alice</main>');
    expect(calls).toEqual(['global:before', 'root:before', 'group:before', 'dynamic:before', 'page:before',
      'init', 'page:after', 'dynamic:after', 'group:after', 'root:after', 'global:after']);
  });

  it.each(['global', 'layout', 'page'])('does not construct or initialize a page denied by %s middleware', async location => {
    const constructed = vi.fn();
    const initialized = vi.fn();
    const guard: MiddlewareHandler = async c => c.redirect('/login');
    @Page({ ssg: true, middlewares: location === 'page' ? [guard] : [] })
    class PrivatePage extends Cossack {
      constructor() { super(); constructed(); }
      async init() { initialized(); }
      render() { return html`<main>private-record</main>`; }
    }
    @Page({ middlewares: location === 'layout' ? [guard] : [] })
    class PrivateLayout extends Cossack { render() { return html`${this.children}`; } }
    await expect(render(PrivatePage, {
      file: '/src/pages/(private)/dashboard/index.ts', path: '/dashboard',
      middlewares: location === 'global' ? [guard] : [],
      layouts: { '/src/pages/(private)/layout.ts': { default: PrivateLayout } },
    })).rejects.toMatchObject({ code: 'COSSACK_SSG_NOT_PUBLIC' });
    expect(constructed).not.toHaveBeenCalled();
    expect(initialized).not.toHaveBeenCalled();
  });

  it.each([
    ['a cookie', async (c, next) => { await next(); setCookie(c, 'session', 'visitor-specific'); }],
    ['private caching', async (c, next) => { await next(); c.header('Cache-Control', 'private, max-age=60'); }],
    ['credential-dependent output', async (c, next) => { await next(); c.header('Vary', 'Accept-Encoding, Cookie'); }],
    ['an identity established after rendering', async (c, next) => { await next(); c.set('user', { id: 'signed-in' }); }],
  ] satisfies [string, MiddlewareHandler][])('rejects responses with %s', async (_, middleware) => {
    @Page({ ssg: true })
    class PublicPage extends Cossack { render() { return html`<main>public</main>`; } }
    await expect(render(PublicPage, { middlewares: [middleware] }))
      .rejects.toMatchObject({ code: 'COSSACK_SSG_NOT_PUBLIC' });
  });

  it('rejects an injected authenticated identity before running the renderer', async () => {
    const initialized = vi.fn();
    @Page({ ssg: true })
    class PrivatePage extends Cossack {
      async init() { initialized(); }
      render() { return html`<main>${this.user?.id}</main>`; }
    }
    await expect(render(PrivatePage, { middlewares: [async (c, next) => {
      c.set('user', { id: 'system-user' }); await next();
    }] })).rejects.toMatchObject({ code: 'COSSACK_SSG_NOT_PUBLIC' });
    expect(initialized).not.toHaveBeenCalled();
  });

  it('honors disabled SSG and resolves ancestry from source paths', () => {
    @Page({ ssg: { enabled: false } })
    class Disabled extends Cossack { render() { return html`disabled`; } }
    expect(collectSsgRoutes({ '/src/pages/index.ts': { default: Disabled } }, {})).toEqual([]);
    expect(resolveLayoutPaths('/src/pages/(private)/users/[id]/index.ts', [
      '/src/pages/layout.ts', '/src/pages/(private)/layout.ts',
      '/src/pages/(private)/users/[id]/layout.ts', '/src/pages/other/layout.ts',
    ])).toEqual(['/src/pages/layout.ts', '/src/pages/(private)/layout.ts', '/src/pages/(private)/users/[id]/layout.ts']);
  });

  it('renders a catch-all route with real parameters and rejects missing parameters', async () => {
    @Page({ ssg: true })
    class DocsPage extends Cossack {
      render() { return html`<main>${this.c.req.param('slug')}</main>`; }
    }
    const output = await render(DocsPage, { path: '/docs/[...slug]',
      file: '/src/pages/(public)/docs/[...slug]/index.ts', params: { slug: 'one/two' } });
    expect(output.replace(/<!--[\s\S]*?-->/g, '')).toContain('<main>one/two</main>');
    await expect(render(DocsPage, { path: '/docs/[...slug]' })).rejects.toThrow('Missing static parameter slug');
  });
});
