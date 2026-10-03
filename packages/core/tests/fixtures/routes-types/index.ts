import { createRouteBuilder, type RouteParameters } from '@cossackframework/core/routes';
import { Page, type PageOptions } from '@cossackframework/core';
// @ts-expect-error file paths define routes; the unused alias option is removed
const unusedAlias: PageOptions = { route: '/alias' };
// @ts-expect-error a decorator cannot silently promise an unregistered URL
Page({ route: '/alias' });

const widenedRegistry = { user: '/users/:id' };
// @ts-expect-error erased patterns cannot establish parameter types
createRouteBuilder(widenedRegistry);
declare const dynamicRegistry: Record<string, string>;
// @ts-expect-error use a literal registry for typed construction
createRouteBuilder(dynamicRegistry);
declare const unionPattern: '/users/:id' | '/articles/:slug';
// @ts-expect-error a runtime-selected pattern cannot define one parameter contract
createRouteBuilder({ selected: unionPattern });

const routes = createRouteBuilder({ home: '/', user: '/users/:id', docs: '/docs/:language/:path{.+}' });
routes('home');
routes('user', { id: 'alice' });
routes('docs', { language: 'en', path: ['intro', 'first'] });
const segments = ['intro', 'first'] as const;
routes('docs', { language: 'en', path: segments });
const params: RouteParameters<'/users/:id'> = { id: 'bob' };
routes('user', params);
// @ts-expect-error unknown route name
routes('missing');
// @ts-expect-error missing ordinary parameter
routes('user');
// @ts-expect-error missing a declared catch-all
routes('docs', { language: 'en' });
// @ts-expect-error ordinary parameters are strings
routes('user', { id: 1 });
// @ts-expect-error catch-alls require path segments
routes('docs', { language: 'en', path: 'one/two' });
// @ts-expect-error catch-alls cannot be empty
routes('docs', { language: 'en', path: [] });
// @ts-expect-error static routes accept no parameters
routes('home', {});
// @ts-expect-error extra literal parameter
routes('user', { id: 'alice', extra: 'x' });
const extra = { id: 'alice', extra: 'x' };
// @ts-expect-error extra variable parameter
routes('user', extra);
declare const possibleExtra: { id: string } | { id: string; extra: string };
// @ts-expect-error a union parameter object cannot hide an extra key
routes('user', possibleExtra);
declare const name: 'home' | 'user';
// @ts-expect-error narrow a union name before supplying its parameters
routes(name, { id: 'alice' });
// @ts-expect-error union name cannot bypass required parameters
routes(name);
declare const unknownName: string;
// @ts-expect-error arbitrary strings do not name a generated route
routes(unknownName);
