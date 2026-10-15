import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { RESERVED_TRANSPORT_PATHS, TRANSPORT_ROUTES, findReservedTransportPath } from '../src/transport-routes';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

/** Paths the router lets application routes own. */
const allowed = ['/crpcx', '/websocket', '/sse-info', '/ws', '/sse', '/crpc/x', '/upload/files', '/api/crpc', '/wsx/chat'];
for (const path of allowed) {
  @Page({ transport: 'http' })
  class Allowed extends Cossack { render() { return html`<p data-page=${path}>page</p>`; } }
  registry.pages[`/src/pages${path}/index.ts`] = { default: Allowed };
}
const { createApp } = await import('../src/router');

describe('reserved transport paths', () => {
  it('derives exact paths and namespaces from the router patterns', () => {
    expect(RESERVED_TRANSPORT_PATHS.map(({ path, match, route }) => ({ path, match, route }))).toEqual([
      { path: '/crpc', match: 'exact', route: '/crpc' },
      { path: '/upload', match: 'exact', route: '/upload' },
      { path: '/sse', match: 'namespace', route: '/sse/:componentRouteId' },
      { path: '/ws', match: 'namespace', route: '/ws/:id' },
    ]);
    expect(Object.isFrozen(TRANSPORT_ROUTES)).toBe(true);
    expect(Object.isFrozen(RESERVED_TRANSPORT_PATHS)).toBe(true);
  });

  it.each([
    ['/crpc', '/crpc'], ['/crpc/', '/crpc'], ['/upload', '/upload'],
    ['/sse/:id', '/sse'], ['/sse/stream/deep', '/sse'], ['/sse/:path{.+}', '/sse'],
    ['/ws/:room', '/ws'], ['/ws/chat', '/ws'], ['/ws/a/b/c', '/ws'],
  ])('reserves %s', (pattern, path) => {
    expect(findReservedTransportPath(pattern)?.path).toBe(path);
  });

  it.each([...allowed, '/', '/:slug', '/:section/:id', '/CRPC', '/upload-files', '/assets/ws'])('allows %s', pattern => {
    expect(findReservedTransportPath(pattern)).toBeUndefined();
  });

  it('covers every route the router registers ahead of application routes', () => {
    // Global middleware is registered as '/*'; application routes are the pages above.
    const framework = new Set(createApp().routes.map(route => route.path).filter(path => path !== '/*' && !allowed.includes(path)));
    for (const path of framework) expect(findReservedTransportPath(path), path).toBeDefined();
    for (const route of Object.values(TRANSPORT_ROUTES)) expect(framework).toContain(route);
    expect(framework).toContain(`${TRANSPORT_ROUTES.websocket}/*`);
  });

  it.each(allowed)('lets the page at %s render', async path => {
    const response = await createApp().request(path, { headers: { accept: 'text/html' } }, {} as any);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`data-page="${path}"`);
  });
});
