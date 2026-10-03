// @vitest-environment node
import { expect, it } from 'vitest';
import { buildRoutesManifest, computeRouteIds, createNotFoundResolver, resolvePageRouteFiles } from '../src/route-ids';

const root = '/src/pages/404/index.ts';
const group = '/src/pages/(account)/404/index.ts';
const dynamic = '/src/pages/(account)/users/[id]/404/index.ts';
const literal = '/src/pages/users/new/404/index.ts';
const keys = [root, group, dynamic, literal, '/src/pages/(account)/users/[id]/index.ts',
    '/src/pages/(account)/dashboard/index.ts', '/src/pages/users/new/index.ts', '/src/pages/direct/index.ts',
    '/src/pages/(account)/direct/index.ts', '/src/pages/(first)/area/one/index.ts', '/src/pages/(second)/area/two/index.ts',
    '/src/pages/(first)/404/index.ts', '/src/pages/(second)/404/index.ts'];

it.each([
    ['/users/a/missing', dynamic, { id: 'a' }], ['/users/%E9%9B%AA%2Fa/missing', dynamic, { id: '雪/a' }],
    ['/users/a/missing/', dynamic, { id: 'a' }], ['/users/new/missing', literal, {}],
    ['/dashboard/missing', group, {}], ['/direct/missing', root, {}], ['/unknown', root, {}],
    ['/area/one/missing', '/src/pages/(first)/404/index.ts', {}], ['/area/two/missing', '/src/pages/(second)/404/index.ts', {}],
])('matches source ancestry for %s', (pathname, path, params) => {
    expect(createNotFoundResolver(keys)(pathname)).toMatchObject({ path, params, ambiguous: false });
});

it('falls back to a common source ancestor for equally ranked disjoint owners', () => {
    expect(createNotFoundResolver(keys)('/area/missing')).toMatchObject({ path: root, scope: '/src/pages', params: {}, ambiguous: true });
    const scoped = [root, '/src/pages/users/404/index.ts', '/src/pages/users/(a)/[id]/one/index.ts', '/src/pages/users/(b)/[id]/two/index.ts'];
    expect(createNotFoundResolver(scoped)('/users/a/missing')).toMatchObject({ path: '/src/pages/users/404/index.ts', scope: '/src/pages/users', params: {}, ambiguous: true });
});

it('retains a matching parameter in the common dynamic source ancestor', () => {
    const base = '/src/pages/users/[id]';
    const boundary = '/src/pages/users/404/index.ts';
    const resolve = createNotFoundResolver([root, boundary, base + '/(a)/one/index.ts', base + '/(b)/two/index.ts']);
    expect(resolve('/users/alice/missing')).toMatchObject({ path: boundary, scope: base, params: { id: 'alice' }, ambiguous: true });
});

it('owns an explicit namespace even when it has only a 404 boundary', () => {
    expect(createNotFoundResolver([root, dynamic])('/users/a/missing')).toMatchObject({ path: dynamic, params: { id: 'a' } });
    expect(createNotFoundResolver([root, dynamic])('/user/a/missing')?.path).toBe(root);
});

it('selects a deeper namespace alongside a file route with the same prefix', () => {
    const boundary = '/src/pages/(g)/docs/item/404/index.ts';
    expect(createNotFoundResolver([root, '/src/pages/(g)/docs/item.ts', boundary])('/docs/item/missing')).toMatchObject({ path: boundary, ambiguous: false });
});

it('matches nonempty catch-all scopes and keeps decoded separators inside captures', () => {
    const boundary = '/src/pages/(g)/files/[...path]/404/index.ts';
    const resolve = createNotFoundResolver([root, boundary]);
    expect(resolve('/files/a/%E9%9B%AA%2Fb/missing')).toMatchObject({ path: boundary, params: { path: 'a/雪/b/missing' } });
    expect(resolve('/files')?.path).toBe(root);
});

it('escapes literal regular-expression punctuation and keeps malformed captures on the owning scope', () => {
    const boundary = '/src/pages/v1.0/[id]/404/index.ts'; const resolve = createNotFoundResolver([root, boundary]);
    expect(resolve('/v1X0/a/missing')?.path).toBe(root);
    expect(resolve('/v1.0/%broken/missing')).toMatchObject({ path: boundary, params: { id: '%broken' } });
});

it('snapshots source keys and gives a plain fallback when no boundary exists', () => {
    const source = [root]; const resolve = createNotFoundResolver(source); source.splice(0);
    expect(resolve('/x')?.path).toBe(root);
    expect(createNotFoundResolver(['/src/pages/x/index.ts'])('/x/missing')).toBeNull();
    expect(resolve('relative')).toBeNull();
});

it('preserves source-specific boundary IDs without exposing a public route alias', () => {
    const sources = [root, group, '/src/pages/error/index.ts', '/src/pages/(account)/error/index.ts', '/src/pages/(account)/dashboard/index.ts'];
    expect(resolvePageRouteFiles(sources)).toHaveLength(sources.length);
    const maps = computeRouteIds(sources, []); const manifest = buildRoutesManifest(sources, [], maps);
    expect(new Set(Object.values(manifest.filePathToId)).size).toBe(sources.length);
    expect(maps.routePathToFilePathMap.has('/404')).toBe(false); expect(maps.routePathToFilePathMap.has('/error')).toBe(false);
    expect(manifest.routes.filter(route => route.kind === '404')).toHaveLength(2);
    expect(manifest.routes.filter(route => route.kind === '404' || route.kind === 'error').every(route => !route.addressable)).toBe(true);
});
