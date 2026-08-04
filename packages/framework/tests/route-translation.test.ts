import { describe, it, expect } from 'vitest';
import {
  APP_ROUTE_ID,
  buildRoutesManifest,
  compareHttpRoutes,
  computeRouteIds,
  filePathToHttpRoute,
  filePathToRoutePath,
  resolvePageRouteFiles,
} from '../src/route-ids';

describe('filePathToHttpRoute', () => {
  it('converts a dynamic segment', () => {
    expect(filePathToHttpRoute('/src/pages/hello/[name]/index.ts')).toBe('/hello/:name');
  });

  it('converts a catch-all segment to :name* (Hono wildcard)', () => {
    expect(filePathToHttpRoute('/src/pages/docs/[...slug]/index.ts')).toBe('/docs/:slug*');
  });

  it('handles a catch-all at the root', () => {
    expect(filePathToHttpRoute('/src/pages/[...all]/index.ts')).toBe('/:all*');
  });

  it('mixes dynamic and catch-all segments', () => {
    expect(filePathToHttpRoute('/src/pages/users/[id]/files/[...rest]/index.ts'))
      .toBe('/users/:id/files/:rest*');
  });

  it('removes route groups', () => {
    expect(filePathToHttpRoute('/src/pages/(auth)/login/index.ts')).toBe('/login');
  });

  it('normalises the index route to /', () => {
    expect(filePathToHttpRoute('/src/pages/index.ts')).toBe('/');
    expect(filePathToHttpRoute('/src/pages/index/index.ts')).toBe('/');
  });

  it('does NOT leave the invalid :...slug token', () => {
    const route = filePathToHttpRoute('/src/pages/catch/[...path]/index.ts');
    expect(route).not.toContain('...');
    expect(route).toContain(':path*');
  });
});

describe('filePathToRoutePath (kept-bracket form for IDs)', () => {
  it('keeps bracketed segment names', () => {
    expect(filePathToRoutePath('/src/pages/hello/[name]/index.ts')).toBe('/hello/[name]');
  });

  it('exposes the reserved App route id', () => {
    expect(APP_ROUTE_ID).toBe('cossack_app');
  });
});

describe('compareHttpRoutes (registration specificity)', () => {
  // Hono's RegExpRouter lets an earlier-registered param shadow a later static
  // sibling, and import.meta.glob yields lexicographic order where `[id]`
  // sorts before `new`. So registration order MUST put statics first.
  it('ranks a static sibling before a param sibling at the same depth', () => {
    expect(compareHttpRoutes('/dashboard/users/new', '/dashboard/users/:id')).toBeLessThan(0);
    expect(compareHttpRoutes('/dashboard/roles/new', '/dashboard/roles/:id')).toBeLessThan(0);
  });

  it('ranks a literal index/list before both new and :id', () => {
    const sorted = ['/dashboard/users/:id', '/dashboard/users/new', '/dashboard/users']
      .sort(compareHttpRoutes);
    expect(sorted).toEqual(['/dashboard/users', '/dashboard/users/new', '/dashboard/users/:id']);
  });

  it('ranks catch-all last', () => {
    expect(compareHttpRoutes('/dashboard/users/new', '/dashboard/users/:rest*')).toBeLessThan(0);
    expect(compareHttpRoutes('/dashboard/users/:id', '/dashboard/users/:rest*')).toBeLessThan(0);
  });

  it('ranks a shallower route before a deeper one sharing a prefix', () => {
    expect(compareHttpRoutes('/dashboard', '/dashboard/users')).toBeLessThan(0);
  });

  it('leaves unrelated routes in a stable, deterministic order', () => {
    // Same specificity at every segment -> falls back to lexicographic.
    expect(compareHttpRoutes('/dashboard/users', '/dashboard/roles')).toBeGreaterThan(0);
  });

  it('sorts the full app route set so no param shadows a static sibling', () => {
    const routes = [
      '/dashboard/roles/:id',
      '/dashboard/roles',
      '/dashboard/roles/new',
      '/dashboard/users/:id',
      '/dashboard/users',
      '/dashboard/users/new',
    ].sort(compareHttpRoutes);
    // Every static sibling must precede its param sibling.
    const usersNew = routes.indexOf('/dashboard/users/new');
    const usersId = routes.indexOf('/dashboard/users/:id');
    const rolesNew = routes.indexOf('/dashboard/roles/new');
    const rolesId = routes.indexOf('/dashboard/roles/:id');
    expect(usersNew).toBeLessThan(usersId);
    expect(rolesNew).toBeLessThan(rolesId);
  });
});

describe('duplicate public page routes', () => {
  const direct = '/src/pages/index.ts';
  const grouped = '/src/pages/(public)/index.ts';

  it('uses the file with fewer route-group segments everywhere', () => {
    const pageKeys = [grouped, direct];
    expect(resolvePageRouteFiles(pageKeys)).toEqual([direct]);

    const maps = computeRouteIds(pageKeys, []);
    expect(maps.routePathToFilePathMap.get('/')).toBe(direct);
    expect([...maps.routePathToIdMap.keys()]).toEqual([direct]);
    expect(buildRoutesManifest(pageKeys, [], maps).pageKeys).toEqual([direct]);
  });

  it('rejects equal-precedence collisions with both source paths', () => {
    const first = '/src/pages/index.ts';
    const second = '/src/pages/index/index.ts';
    expect(() => resolvePageRouteFiles([first, second])).toThrowError(
      new RegExp(`${first}.*${second}`),
    );
  });

  it('treats differently named dynamic segments as the same public route', () => {
    expect(() => resolvePageRouteFiles([
      '/src/pages/users/[id]/index.ts',
      '/src/pages/users/[slug]/index.ts',
    ])).toThrow(/Duplicate page route/);
  });
});

describe('trailing slash handling', () => {
  // createApp() uses Hono's { strict: false } so /dashboard/ matches /dashboard.
  // Verify that Hono's getPathNoStrict (activated by strict:false) is what the
  // router is configured with — a trailing slash should not 404 a known route.
  it('strict:false strips trailing slash so /foo/ matches /foo', async () => {
    const { Hono } = await import('hono');
    // Reproduce the exact router construction from createApp().
    const app = new Hono({ strict: false });
    app.get('/foo', (c) => c.text('ok'));
    const withSlash = await app.request('/foo/');
    const withoutSlash = await app.request('/foo');
    expect(withoutSlash.status).toBe(200);
    expect(withSlash.status).toBe(200);
  });

  it('strict:true (default) 404s trailing slash — the bug we fixed', async () => {
    const { Hono } = await import('hono');
    const app = new Hono({ strict: true });
    app.get('/foo', (c) => c.text('ok'));
    const withSlash = await app.request('/foo/');
    expect(withSlash.status).toBe(404);
  });
});
