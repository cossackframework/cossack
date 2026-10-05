// @vitest-environment node
import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { loggingMiddleware } from '../src/middlewares/logging';
afterEach(() => vi.restoreAllMocks());
it('logs the authored route without private parameters and queries', async () => {
  const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
  const app = new Hono();
  app.use('*', loggingMiddleware);
  app.get('/items/:id', c => c.text('ok'));
  expect((await app.request('/items/PRIVATE_PATH?token=PRIVATE_QUERY')).status).toBe(200);
  expect(logged).toHaveBeenCalledExactlyOnceWith({ event: 'cossack.request', method: 'GET', route: '/items/:id' });
  expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_');
});
