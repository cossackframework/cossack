import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createRouteBuilder, routeParameters, RouteUrlError } from '../src/shared/routes';

const registry = { home: '/', user: '/users/:id', docs: '/docs/:language/:path{.+}' } as const;
const routes = createRouteBuilder(registry);
const untyped = routes as (...args: any[]) => string;

describe('URL parameter contracts', () => {
    it('reaches Hono handlers with encoded ordinary and catch-all parameters', async () => {
        const app = new Hono();
        app.get(registry.user, c => c.json({ id: c.req.param('id') }));
        app.get(registry.docs, c => c.json(c.req.param()));
        for (const id of ['a/b', '雪', 'a?b#c', 'a+b', '%2F', '$&', '\\']) {
            const url = routes('user', { id });
            expect(new URL(url, 'https://example.test').pathname).toBe(url);
            const response = await app.request(url);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ id });
        }
        const response = await app.request(routes('docs', { language: 'ไทย', path: ['first', '雪/?#%'] }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ language: 'ไทย', path: 'first/雪/?#%' });
        expect(routes('home')).toBe('/');
    });

    it.each([
        ['user'], ['user', {}], ['user', { id: 1 }], ['user', { id: '' }],
        ['user', { id: '.' }], ['user', { id: '..' }], ['user', { id: '\uD800' }],
        ['user', { id: 'ok', extra: 'wrong' }], ['user', { id: 'ok', [Symbol()]: 1 }],
        ['user', Object.create({ id: 'inherited' })], ['user', { id: ['ok'] }], ['user', null],
        ['user', { id: 'ok' }, {}], ['home', {}],
        ['docs', { language: 'en', path: [] }], ['docs', { language: 'en', path: 'a/b' }],
        ['docs', { language: 'en', path: ['ok', ''] }], ['docs', { language: 'en', path: Array(1) }],
    ])('rejects invalid runtime arguments %#', (...args) => {
        expect(() => untyped(...args)).toThrowError(expect.objectContaining({ code: 'COSSACK_ROUTE_PARAMETER_INVALID' }));
    });

    it('does not execute parameter getters', () => {
        const getter = () => { throw new Error('must not run'); };
        expect(() => untyped('user', { get id() { return getter(); } })).toThrow(RouteUrlError);
        const path = ['x'];
        Object.defineProperty(path, '0', { get: getter });
        expect(() => untyped('docs', { language: 'en', path })).toThrow(RouteUrlError);
    });

    it('snapshots the registry and reports unknown names with route identity', () => {
        const mutable = { name: '/original' };
        const build = (createRouteBuilder as (registry: Record<string, string>) => (...args: any[]) => string)(mutable);
        mutable.name = '/replacement';
        expect(build('name')).toBe('/original');
        expect(() => untyped('missing')).toThrowError(expect.objectContaining({ code: 'COSSACK_ROUTE_UNKNOWN', route: 'missing' }));
    });

    it.each(['/a/:id?', '/a/:id{[0-9]+}', '/:id/:id', '/a/*', '/a/foo:id', '/a/../b', '/a/./b', '/a/%2e%2E/b', '/a?x', '//a', '/a\\b', '/a b'])('rejects unsupported patterns %s', pattern => {
        const create = createRouteBuilder as (registry: Record<string, string>) => unknown;
        expect(() => create({ invalid: pattern })).toThrowError(expect.objectContaining({ code: 'COSSACK_ROUTE_PATTERN_UNSUPPORTED' }));
    });

    it('exposes parameter metadata in path order', () => {
        expect(routeParameters(registry.docs)).toEqual([{ name: 'language', catchAll: false }, { name: 'path', catchAll: true }]);
    });
});
