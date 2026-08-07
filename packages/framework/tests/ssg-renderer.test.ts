import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { filePathToRoutePath, renderSsgPage } from '../src/ssg-renderer';

// Minimal Cossack App used to exercise renderSsgPage end-to-end.
// The real App uses @Page({ transport: 'http' }); we mirror that here so
// getInitialState() takes the http/sse early-return path and does not try to
// resolve a Durable Object namespace.
@Page({ transport: 'http' })
class TestApp extends Cossack {
  render() {
    return html`<div id="app">${this.children}</div>`;
  }
}

@Page({ ssg: true, transport: 'http' })
class SsgTestPage extends Cossack {
  head() {
    return { title: 'SSG Test Title' };
  }
  render() {
    return html`<main><h1>Hello SSG</h1></main>`;
  }
}

@Page({ transport: 'http' })
class CookieReadingApp extends Cossack {
  theme = 'unset';

  async init() {
    this.theme = getCookie(this.c, 'cs-theme') ?? 'none';
  }

  render() {
    return html`<div data-theme="${this.theme}">${this.children}</div>`;
  }
}

describe('ssg-renderer', () => {
  describe('filePathToRoutePath', () => {
    it('should convert page file paths to route paths', () => {
      expect(filePathToRoutePath('/src/pages/index/index.ts')).toBe('/');
      expect(filePathToRoutePath('/src/pages/about/index.ts')).toBe('/about');
      expect(filePathToRoutePath('/src/pages/contact/index.ts')).toBe('/contact');
    });

    it('should convert nested page file paths to route paths', () => {
      expect(filePathToRoutePath('/src/pages/blog/posts/index.ts')).toBe('/blog/posts');
      expect(filePathToRoutePath('/src/pages/docs/api/reference/index.ts')).toBe('/docs/api/reference');
    });

    it('should handle dynamic route segments', () => {
      expect(filePathToRoutePath('/src/pages/hello/[name]/index.ts')).toBe('/hello/[name]');
      expect(filePathToRoutePath('/src/pages/users/[id]/posts/[postId]/index.ts')).toBe('/users/[id]/posts/[postId]');
    });

    it('should handle MDX files', () => {
      expect(filePathToRoutePath('/src/pages/docs/index.mdx')).toBe('/docs');
      expect(filePathToRoutePath('/src/pages/blog/my-post/index.mdx')).toBe('/blog/my-post');
    });

    it('should handle root index correctly', () => {
      expect(filePathToRoutePath('/src/pages/index.ts')).toBe('/');
    });

    it('removes route groups from public SSG paths', () => {
      expect(filePathToRoutePath('/src/pages/(public)/blog/hello-world.md'))
        .toBe('/blog/hello-world');
      expect(filePathToRoutePath('/src/pages/(public)/index.ts')).toBe('/');
    });
  });

  describe('renderSsgPage', () => {
    it('produces HTML containing the client hydration script tag', async () => {
      const html = await renderSsgPage(SsgTestPage, '/ssg-test', undefined, {}, 'https://example.com', TestApp);
      // No manifest on disk in test env -> dev fallback path is used, which
      // still emits the module script tag pointing at the dev entry-client.
      // When a build manifest IS present (e.g. after `vite build`), the
      // production asset path is used instead. Accept either form.
      expect(html).toContain('<script type="module"');
      expect(html).toMatch(/src=["']?(\/src\/client\/entry-client\.ts|\/assets\/entry-client\.[\w.-]+\.js)["']?/);
    });

    it('provides a real request to App lifecycle methods during SSG', async () => {
      const output = await renderSsgPage(
        SsgTestPage,
        '/ssg-test',
        undefined,
        {},
        'https://example.com',
        CookieReadingApp,
      );

      expect(output).toMatch(/data-theme=["']?none["']?/);
    });

    it('uses a server-safe fallback when no App component is supplied', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const output = await renderSsgPage(SsgTestPage, '/ssg-test');

      expect(output).toContain('<h1>Hello SSG</h1>');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('No AppComponent'));
      warn.mockRestore();
    });

    it('produces HTML containing window.__INITIAL_STATE__', async () => {
      const html = await renderSsgPage(SsgTestPage, '/ssg-test', undefined, {}, 'https://example.com', TestApp);
      expect(html).toContain('window.__INITIAL_STATE__');
    });

    it('produces HTML containing the page <title>', async () => {
      const html = await renderSsgPage(SsgTestPage, '/ssg-test', undefined, {}, 'https://example.com', TestApp);
      // renderTag adds a data-cossack attribute marker to head tags.
      expect(html).toMatch(/<title[^>]*>SSG Test Title<\/title>/);
    });

    it('respects a custom htmlTemplate function', async () => {
      const stringTemplate =
        '<!DOCTYPE html><html lang="zz"><head><meta charset="utf-8">{{ cossackScripts }}</head><body class="custom">{{ cossackBody }}</body></html>';

      const html = await renderSsgPage(
        SsgTestPage,
        '/ssg-test',
        undefined,
        {},
        'https://example.com',
        TestApp,
        stringTemplate,
        '/src/pages/ssg-test/index.ts',
      );

      expect(html).toMatch(/<html lang=["']?zz["']?>/);
      expect(html).toMatch(/<body class=["']?custom["']?>/);
      // Template helpers are still invoked inside the custom template:
      expect(html).toContain('<script type="module"');
      expect(html).toContain('window.__INITIAL_STATE__');
    });

    it('includes a CSS <link> tag when manifest has CSS', async () => {
      // Without a real manifest on disk (no dist/client/.vite/manifest.json
      // during unit tests), renderRoot falls back to the dev CSS link. Verify
      // that fallback is present — the production path is covered by the
      // build integration test (ssg-build.test.ts).
      const html = await renderSsgPage(SsgTestPage, '/ssg-test', undefined, {}, 'https://example.com', TestApp);
      expect(html).toMatch(/rel=["']?stylesheet["']?/);
    });

    it('uses the route PATTERN (not concrete path) in initial state for dynamic routes', async () => {
      // The client's routeToFilePath map uses patterns like "/users/[name]"
      // to look up module loaders. If routePath in the initial state contains
      // the concrete value (e.g. "/users/alice"), hydration breaks with
      // "Component module loader not found for path".
      const html = await renderSsgPage(
        SsgTestPage,
        '/users/alice', // concrete route path (params filled in)
        { name: 'alice' }, // static params
        {},
        'https://example.com',
        TestApp,
        undefined, // htmlTemplate
        '/src/pages/users/[name]/index.ts', // pageFilePath with bracket pattern
        'cmp_test',
      );

      // routePath in initial state must preserve the [name] bracket pattern
      expect(html).toContain('"routePath":"/users/[name]"');
      // pathname must be the concrete URL
      expect(html).toContain('"pathname":"/users/alice"');
    });

    it('applies the supplied AppComponent head() (wraps title + contributes global links)', async () => {
      // Regression: SSG must use the project's own App (not fall back to the
      // framework default). If it falls back, the custom title and the global
      // font <link> below would be missing from the output.
      @Page({ transport: 'http' })
      class AppWithGlobals extends Cossack {
        head(context: any) {
          return {
            title: `My App - ${context.title || 'Welcome'}`,
            links: [{ tag: 'link', attributes: { rel: 'stylesheet', href: '/fonts.css' } }],
          };
        }
        render() {
          return html`<div id="app">${this.children}</div>`;
        }
      }

      const output = await renderSsgPage(
        SsgTestPage,
        '/ssg-test',
        undefined,
        {},
        'https://example.com',
        AppWithGlobals,
      );

      // App title wraps the page title.
      expect(output).toMatch(/<title[^>]*>My App - SSG Test Title<\/title>/);
      // App global link is present (head arrays accumulate, not replace).
      expect(output).toContain('/fonts.css');
    });
  });
});
