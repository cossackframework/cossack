// @vitest-environment node
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
const { registry, factories, policy } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} },
  factories: { fail: false }, policy: { fail: false, delay: false },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (_c: any, next: any) => {
  if (policy.delay) await new Promise(resolve => setTimeout(resolve, 20));
  if (policy.fail) throw new Error('PRIVATE_MIDDLEWARE_SENTINEL');
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ environment: null, requirements: {}, default: { app: () => {
  if (factories.fail) throw Object.assign(new Error('PRIVATE_CONFIG_SENTINEL'), { token: 'PRIVATE_CONFIG_SENTINEL' });
  return {};
} } }));
@Page()
class RenderFailure extends Cossack { render(): never { throw Object.assign(new Error('PRIVATE_RENDER_SENTINEL'), { secret: 'PRIVATE_RENDER_SENTINEL' }); } }
@Page()
class CleanupFailure extends Cossack {
  render() { return html`<main>safe</main>`; }
  async destroyAsync(): Promise<void> { throw new Error('PRIVATE_CLEANUP_SENTINEL'); }
}
registry.pages['/src/pages/items/[id].ts'] = { default: RenderFailure };
registry.pages['/src/pages/cleanup.ts'] = { default: CleanupFailure };
const { createApp } = await import('../src/router');
afterEach(() => { factories.fail = false; policy.fail = false; policy.delay = false; vi.restoreAllMocks(); });
it('measures uncaught middleware failure from request-scope entry', async () => {
  policy.fail = true; policy.delay = true;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await createApp().request('/items/example')).status).toBe(500);
  expect(log.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(10);
});
it('correlates SSR failure with its authored template and excludes exception properties', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await createApp().request('/items/PRIVATE_PATH_SENTINEL?token=PRIVATE_QUERY_SENTINEL');
  expect(response.status).toBe(500);
  const body = await response.text();
  expect(body).not.toContain('PRIVATE_');
  expect(body).toContain(response.headers.get('X-Cossack-Request-Id'));
  expect(body).toContain('COSSACK_SSR_INTERNAL');
  const event = log.mock.calls.map(call => call[0]).find(value => value?.event === 'cossack.ssr.failure');
  expect(event).toMatchObject({ requestId: response.headers.get('X-Cossack-Request-Id'), route: '/items/:id',
    action: 'render', runtime: 'cloudflare', stage: 'render', code: 'COSSACK_SSR_INTERNAL' });
  expect(event.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
});
it.each(['config', 'middleware'])('sanitizes unhandled %s failures before the default Hono error logger', async kind => {
  factories.fail = kind === 'config'; policy.fail = kind === 'middleware';
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await createApp().request('/items/PRIVATE_PATH_SENTINEL');
  expect(response.status).toBe(500);
  const body = await response.json() as { requestId: string };
  expect(body).toMatchObject({ error: 'Internal Server Error', code: 'COSSACK_REQUEST_INTERNAL', requestId: response.headers.get('X-Cossack-Request-Id') });
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0][0]).toMatchObject({ event: 'cossack.request.failure', route: '/items/:id', requestId: body.requestId, stage: 'middleware' });
  expect(JSON.stringify([body, log.mock.calls])).not.toContain('PRIVATE_');
});
it('omits cleanup exceptions without replacing a completed response', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await createApp().request('/cleanup');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('<main>safe</main>');
  expect(log.mock.calls.map(call => call[0])).toContainEqual(expect.objectContaining({ event: 'cossack.ssr.failure',
    requestId: response.headers.get('X-Cossack-Request-Id'), code: 'COSSACK_SSR_CLEANUP_FAILED', stage: 'component-cleanup' }));
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
});
