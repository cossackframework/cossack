import { describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { createAssetsMiddleware } from '../src/assets';
import { computeRouteIds, type RouterContext } from '../src/route-ids';

const privatePath = '/src/pages/(private)/users/[id]/index.ts';
const catchAllPath = '/src/pages/(private)/docs/[...slug]/index.ts';
const publicPath = '/src/pages/users/new/index.ts';

function harness() {
  const policies = vi.fn<MiddlewareHandler>(async (c, next) => {
    if (c.req.header('x-role') !== 'admin') return c.text('denied', 403);
    await next();
    c.header('x-policy-param', c.req.param('id') ?? c.req.param('slug') ?? 'none');
  });
  const fetch = vi.fn(async (request: Request) => {
    return new URL(request.url).pathname === '/missing' ? new Response('missing', { status: 404 })
      : new Response('asset-content', { headers: { 'content-type': 'text/html' } });
  });
  const files = [privatePath, catchAllPath, publicPath];
  const ctx: RouterContext = {
    ...computeRouteIds(files, []), pages: Object.fromEntries(files.map(file => [file, {}])), layouts: {},
    getMiddlewares: file => file === privatePath || file === catchAllPath ? [policies] : [],
  };
  const app = new Hono();
  app.use('*', async (c, next) => { await next(); c.header('x-global-policy', 'ran'); });
  app.use('*', createAssetsMiddleware(ctx));
  app.get('/missing', c => c.text('SSR fallback'));
  app.post('/users/alice', c => c.text('server action'));
  const env = { ASSETS: { fetch } };
  return { app, env, fetch, policies };
}

describe('Worker-first static assets', () => {
  it.each(['/users/alice', '/users/alice/file.pdf', '/users/alice/index.html', '/users/alice.html', '/docs/one/two'])
    ('applies the owning page policy before returning %s', async path => {
      const { app, env } = harness();
      const response = await app.request(path, undefined, env);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('denied');
      expect(response.headers.get('x-global-policy')).toBe('ran');
    });

  it('preserves parameters and after-next policy headers for authorized assets', async () => {
    const { app, env } = harness();
    const response = await app.request('/users/alice/photo.png', { headers: { 'x-role': 'admin' } }, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset-content');
    expect(response.headers.get('x-policy-param')).toBe('alice');
    const catchAll = await app.request('/docs/one/two', { headers: { 'x-role': 'admin' } }, env);
    expect(catchAll.headers.get('x-policy-param')).toBe('one/two');
  });

  it('uses the literal page policy ahead of a dynamic sibling', async () => {
    const { app, env, policies } = harness();
    const response = await app.request('/users/new', undefined, env);
    expect(response.status).toBe(200);
    expect(policies).not.toHaveBeenCalled();
  });

  it('redirects known HTML aliases to a canonical guarded request with its query', async () => {
    const { app, env, fetch } = harness();
    const response = await app.request('/users/alice/index.html?view=full', { headers: { 'x-role': 'admin' } }, env);
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('/users/alice?view=full');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves missing files and mutations in the normal request pipeline', async () => {
    const { app, env, fetch } = harness();
    expect(await (await app.request('/missing', undefined, env)).text()).toBe('SSR fallback');
    fetch.mockClear();
    expect(await (await app.request('/users/alice', { method: 'POST' }, env)).text()).toBe('server action');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves public client assets through global middleware and supports HEAD', async () => {
    const { app, env } = harness();
    const response = await app.request('/assets/app.js', { method: 'HEAD' }, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('x-global-policy')).toBe('ran');
  });

  it('does not delegate encoded path separators to a different asset matcher', async () => {
    const { app, env, fetch } = harness();
    const response = await app.request('/users%2falice/photo.png', undefined, env);
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
