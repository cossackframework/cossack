import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  filePathToHttpRoute,
  classifyRoute,
  scanPagesDir,
  buildRouteModel,
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
