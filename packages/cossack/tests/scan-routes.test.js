import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  filePathToHttpRoute,
  classifyRoute,
  scanPagesDir,
  buildRouteModel,
  buildEffectiveRouteModel,
  extractRouteParams,
  extractPageOptions,
  nearestSpecialPage,
  layoutStackForPage,
} from '../src/scan-routes.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-routes-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('filePathToHttpRoute (mirrors router.ts)', () => {
  it('basic page', () => {
    expect(filePathToHttpRoute('/src/pages/contact/index.ts')).toBe('/contact');
  });
  it('root index', () => {
    expect(filePathToHttpRoute('/src/pages/index/index.ts')).toBe('/');
  });
  it('flat index file', () => {
    expect(filePathToHttpRoute('/src/pages/index.ts')).toBe('/');
  });
  it('dynamic param', () => {
    expect(filePathToHttpRoute('/src/pages/hello/[name]/index.ts')).toBe(
      '/hello/:name',
    );
  });
  it('route group stripped', () => {
    expect(filePathToHttpRoute('/src/pages/(auth)/login/index.ts')).toBe(
      '/login',
    );
  });
  it('nested route group', () => {
    expect(
      filePathToHttpRoute('/src/pages/dashboard/(admin)/settings/index.ts'),
    ).toBe('/dashboard/settings');
  });
  it('mdx extension', () => {
    expect(filePathToHttpRoute('/src/pages/blog/post.mdx')).toBe('/blog/post');
  });
});

describe('classifyRoute', () => {
  it('detects 404', () => {
    expect(classifyRoute('/404')).toBe('404');
  });
  it('detects error', () => {
    expect(classifyRoute('/error')).toBe('error');
  });
  it('detects api', () => {
    expect(classifyRoute('/api/hello')).toBe('api');
  });
  it('defaults to page', () => {
    expect(classifyRoute('/contact')).toBe('page');
  });
});

describe('scanPagesDir + buildRouteModel', () => {
  it('collects pages and layouts, excludes loading.ts', () => {
    mk('src/pages/index/index.ts', '');
    mk('src/pages/contact/index.ts', '');
    mk('src/pages/contact/layout.ts', '');
    mk('src/pages/contact/loading.ts', '');
    mk('src/pages/blog/post.mdx', '');
    mk('src/pages/hello/[name]/index.ts', '');

    const model = buildRouteModel(tmp);
    const routes = model.pages.map((p) => p.route).sort();
    expect(routes).toEqual(['/', '/blog/post', '/contact', '/hello/:name']);
    expect(model.layouts.map((l) => l.filePath)).toEqual([
      '/src/pages/contact/layout.ts',
    ]);
  });

  it('handles missing pages dir gracefully', () => {
    const model = buildRouteModel(tmp);
    expect(model.pages).toEqual([]);
    expect(model.layouts).toEqual([]);
  });
});

describe('layoutStackForPage', () => {
  it('collects root-first layout chain', () => {
    const layoutKeys = [
      '/src/pages/layout.ts',
      '/src/pages/dashboard/layout.ts',
    ];
    const stack = layoutStackForPage(
      '/src/pages/dashboard/settings/index.ts',
      layoutKeys,
    );
    expect(stack).toEqual([
      '/src/pages/layout.ts',
      '/src/pages/dashboard/layout.ts',
    ]);
  });
  it('returns empty when no layouts', () => {
    expect(layoutStackForPage('/src/pages/x/index.ts', [])).toEqual([]);
  });
});

function mk(rel, content) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}


describe('effective route metadata (RT-07)', () => {
  function write(relative, content) {
    const target = path.join(tmp, 'proj', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  function project() { return path.join(tmp, 'proj'); }

  it('extracts dynamic and catch-all parameters', () => {
    expect(extractRouteParams('/users/:id/posts')).toEqual([{ name: 'id', catchAll: false }]);
    // Framework catch-all form: :name{.+} (Hono multi-segment parameter).
    expect(extractRouteParams('/files/:path{.+}')).toEqual([{ name: 'path', catchAll: true }]);
    expect(extractRouteParams('/plain/route')).toEqual([]);
    // Route derivation mirrors the framework, including catch-alls.
    expect(filePathToHttpRoute('/src/pages/docs/[...path]/index.ts')).toBe('/docs/:path{.+}');
  });

  it('extracts @Page options from source without executing modules', () => {
    expect(extractPageOptions("@Page({ transport: 'sse', ssg: true })\nclass P {}"))
      .toEqual({ transport: 'sse', ssg: true, middlewares: 0, decoratorLine: 1 });
    expect(extractPageOptions("import x;\n@Page({ middlewares: [async (c, n) => { await n(); }, (c) => c.text('x')] })"))
      .toMatchObject({ transport: null, ssg: null, middlewares: 2, decoratorLine: 2 });
    expect(extractPageOptions('class Plain {}')).toEqual({ transport: null, ssg: null, middlewares: 0, decoratorLine: null });
  });

  it('builds per-page effective metadata: id, params, layouts, boundaries', () => {
    write('src/pages/layout.ts', 'export default class Layout {}');
    write('src/pages/dashboard/layout.ts', 'export default class DashLayout {}');
    write('src/pages/dashboard/users/[id]/index.ts', "@Page({ transport: 'http' })\nexport default class UserPage {}");
    write('src/pages/dashboard/404/index.ts', 'export default class NotFound {}');
    write('src/pages/docs/[...path]/index.ts', "@Page({ transport: 'http', ssg: true })\nexport default class DocPage {}");

    const model = buildEffectiveRouteModel(project());
    const user = model.pages.find((page) => page.route === '/dashboard/users/:id');
    expect(user).toMatchObject({
      routeId: expect.stringMatching(/^cmp_/),
      params: [{ name: 'id', catchAll: false }],
      layouts: ['/src/pages/layout.ts', '/src/pages/dashboard/layout.ts'],
      notFoundBoundary: '/src/pages/dashboard/404/index.ts',
      transport: 'http',
    });
    const doc = model.pages.find((page) => page.route === '/docs/:path{.+}');
    expect(doc).toMatchObject({ params: [{ name: 'path', catchAll: true }], ssg: true });
    // Route ids are unique and stable across the sorted index space.
    const ids = model.pages.map((page) => page.routeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds the nearest special page without executing it', () => {
    const pages = [
      { filePath: '/src/pages/404/index.ts' },
      { filePath: '/src/pages/dashboard/404/index.ts' },
      { filePath: '/src/pages/dashboard/users/index.ts' },
    ];
    expect(nearestSpecialPage('/src/pages/dashboard/users/index.ts', pages, '404'))
      .toBe('/src/pages/dashboard/404/index.ts');
    expect(nearestSpecialPage('/src/pages/contact/index.ts', pages, '404'))
      .toBe('/src/pages/404/index.ts');
  });
});
