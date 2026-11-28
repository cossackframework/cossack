// @vitest-environment node
import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Cossack, Page, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { computeRouteIds } from '../src/route-ids';
import type { ServerFailure } from '../src/router';

const { registry, policy } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} }, policy: { fail: false } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (_c: any, next: any) => {
  if (policy.fail) throw new Error('PRIVATE_MIDDLEWARE_SENTINEL');
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page()
class RenderFailure extends Cossack { render(): never { throw Object.assign(new Error('FORBIDDEN: PRIVATE_RENDER_SENTINEL'), { status: 403 }); } }
@Page({ transport: 'http' })
class Actions extends Cossack {
  @Server() save() { throw new TypeError('PRIVATE_ACTION_SENTINEL'); }
  @Server() fine() { return 'saved'; }
  render() { return html`actions`; }
}
const actionsPath = '/src/pages/actions/index.ts';
registry.pages['/src/pages/items/[id].ts'] = { default: RenderFailure };
registry.pages[actionsPath] = { default: Actions };
const routeId = computeRouteIds(Object.keys(registry.pages), []).routePathToIdMap.get(actionsPath)!;
const { createApp } = await import('../src/router');

const assets = { ASSETS: { fetch: async (request: Request) => new URL(request.url).pathname === '/cossack-manifest.json'
  ? Response.json({ 'src/client/entry-client.ts': { file: 'assets/entry.abc12345.js' } }) : new Response(null, { status: 404 }) } };
const call = (app: ReturnType<typeof createApp>, action: string) => app.request('/crpc', {
  method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
  body: JSON.stringify({ componentRouteId: routeId, scopeKey: 'user:anonymous', action, state: {}, payload: [] }),
}, {} as any);
type Seen = { failure: ServerFailure; error: unknown; path: string | undefined };
const collector = () => {
  const seen: Seen[] = [];
  return { seen, onServerFailure: (failure: ServerFailure, error: unknown, c?: { req: { path: string } }) => { seen.push({ failure, error, path: c?.req.path }); } };
};

beforeEach(() => { vi.stubEnv('DEV', false); });
afterEach(() => { policy.fail = false; vi.restoreAllMocks(); vi.unstubAllEnvs(); createApp(); });

it('gives the handler the line, the error and the request of a page that fails, and logs nothing of the error', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { seen, onServerFailure } = collector();
  const response = await createApp({ onServerFailure }).request('/items/PRIVATE_PATH_SENTINEL', undefined, assets);
  expect(response.status).toBe(500);
  expect(seen).toHaveLength(1);
  expect(seen[0].failure).toEqual(log.mock.calls[0][0]);
  expect(seen[0].failure).toMatchObject({ event: 'cossack.ssr.failure', requestId: response.headers.get('X-Cossack-Request-Id'),
    route: '/items/:id', action: 'render', stage: 'render', code: 'COSSACK_SSR_INTERNAL' });
  // The error is the thrown one, with what the application put on it.
  expect((seen[0].error as Error).message).toBe('FORBIDDEN: PRIVATE_RENDER_SENTINEL');
  expect((seen[0].error as { status: number }).status).toBe(403);
  expect(seen[0].path).toBe('/items/PRIVATE_PATH_SENTINEL');
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
  expect(await response.text()).not.toContain('PRIVATE_');
});

it('covers a middleware and a server method, and leaves alone a call that works', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { seen, onServerFailure } = collector();
  const app = createApp({ onServerFailure });

  const failed = await call(app, 'save');
  expect(failed.status).toBe(500);
  const body = await failed.json() as { code: string; requestId: string };
  expect(body.code).toBe('COSSACK_RPC_INTERNAL_ERROR');
  expect(seen).toHaveLength(1);
  expect(seen[0].failure).toMatchObject({ event: 'cossack.rpc.failure', action: 'save', stage: 'action', code: 'COSSACK_RPC_INTERNAL_ERROR', requestId: body.requestId });
  expect(seen[0].error).toBeInstanceOf(TypeError);
  expect(seen[0].path).toBe('/crpc');

  expect((await call(app, 'fine')).status).toBe(200);
  expect(seen).toHaveLength(1);

  policy.fail = true;
  const refused = await app.request('/items/7');
  expect(refused.status).toBe(500);
  expect(seen).toHaveLength(2);
  expect(seen[1].failure).toMatchObject({ event: 'cossack.request.failure', route: '/items/:id', stage: 'middleware', code: 'COSSACK_REQUEST_INTERNAL' });
  expect((seen[1].error as Error).message).toBe('PRIVATE_MIDDLEWARE_SENTINEL');
});

it('keeps the answer when the handler throws or rejects, and waits for its promise where the runtime can', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const thrown = await createApp({ onServerFailure: () => { throw new Error('PRIVATE_HANDLER_SENTINEL'); } }).request('/items/7', undefined, assets);
  expect(thrown.status).toBe(500);
  expect(thrown.headers.get('X-Cossack-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);

  const waited: Promise<unknown>[] = [];
  let finished = false;
  const rejected = await createApp({ onServerFailure: async () => { await Promise.resolve(); finished = true; throw new Error('PRIVATE_HANDLER_SENTINEL'); } })
    .request('/items/7', undefined, assets, { waitUntil: (promise: Promise<unknown>) => { waited.push(promise); }, passThroughOnException() {} } as any);
  expect(rejected.status).toBe(500);
  expect(waited).toHaveLength(1);
  await expect(waited[0]).resolves.toBeUndefined();
  expect(finished).toBe(true);
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
  expect(log.mock.calls.filter(entry => entry[0]?.event === 'cossack.ssr.failure')).toHaveLength(2);
});

it('is the handler of the application made last, and none without the option', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { seen, onServerFailure } = collector();
  createApp({ onServerFailure });
  expect((await createApp().request('/items/7', undefined, assets)).status).toBe(500);
  expect(seen).toHaveLength(0);
});
