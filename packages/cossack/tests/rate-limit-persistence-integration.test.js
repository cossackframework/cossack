import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

let directory;
let server;
afterEach(async ({ task }) => {
  if (task.result?.state === 'fail') server?.debug();
  await server?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('persists exact fixed-window counters across concurrent Workers and actual DO eviction', async () => {
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-rate-persistence-'));
  const core = fileURLToPath(new URL('../../core/dist/index.js', import.meta.url));
  const hono = fileURLToPath(new URL('../../../node_modules/hono/dist/index.js', import.meta.url));
  const main = path.join(directory, 'worker.ts');
  await fs.writeFile(main, `
    import { Hono } from ${JSON.stringify(hono)};
    import { DurableObjectRateLimitStore, RateLimitDurableObject, enforceRateLimit } from ${JSON.stringify(core)};
    export { RateLimitDurableObject };
    export class AlternateRateLimitDurableObject extends RateLimitDurableObject {}
    const app = new Hono();
    app.get('/hit', async c => c.json(await new DurableObjectRateLimitStore(c.env.RATE_LIMIT_DO)
      .hit(c.req.query('key') || 'shared', Number(c.req.query('window') || '120000'))));
    app.get('/raw', c => c.env.RATE_LIMIT_DO.getByName('invalid')
      .fetch('https://limit/?window=' + c.req.query('window')));
    let mutations = 0;
    app.post('/limited', async c => {
      const blocked = await enforceRateLimit(c, 'route', { window: 120000, max: 2, key: () => 'member' });
      return blocked || c.json({ mutations: ++mutations });
    });
    app.get('/mutations', c => c.json({ mutations, run: c.env.RUN }));
    app.onError(c => Response.json({ error: 'Internal Server Error' }, { status: 500 }));
    app.get('/configured', async c => {
      const blocked = await enforceRateLimit(c, 'config-route', { max: 1, key: () => 'member' });
      return blocked || c.json({ mutations: ++mutations });
    });
    export default { fetch(request, env, context) {
      const url = new URL(request.url);
      if (url.pathname !== '/configured') return app.fetch(request, env, context);
      const selected = { ...env, rateLimit: url.searchParams.get('mode') || 'do' };
      if (selected.rateLimit === 'unset') delete selected.rateLimit;
      if (selected.rateLimit === 'null') selected.rateLimit = null;
      if (url.searchParams.get('store') === 'alternate') selected.RATE_LIMIT_DO = env.RATE_LIMIT_ALTERNATE;
      if (url.searchParams.get('store') === 'missing') delete selected.RATE_LIMIT_DO;
      return app.fetch(request, selected, context);
    } };
  `);
  const common = { main, compatibility_date: '2026-07-29', compatibility_flags: ['nodejs_compat'],
    vars: { rateLimit: 'durable-object', RUN: 'before' } };
  const options = { root: directory, workers: [
    { config: { ...common, name: 'first', durable_objects: { bindings: [
      { name: 'RATE_LIMIT_DO', class_name: 'RateLimitDurableObject' },
      { name: 'RATE_LIMIT_ALTERNATE', class_name: 'AlternateRateLimitDurableObject' },
    ] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['RateLimitDurableObject', 'AlternateRateLimitDurableObject'] }] } },
    { config: { ...common, name: 'second', durable_objects: { bindings: [
      { name: 'RATE_LIMIT_DO', class_name: 'RateLimitDurableObject', script_name: 'first' },
      { name: 'RATE_LIMIT_ALTERNATE', class_name: 'AlternateRateLimitDurableObject', script_name: 'first' },
    ] } } },
  ] };
  server = createTestHarness(options);
  await server.listen();
  const first = server.getWorker('first');
  const second = server.getWorker('second');
  const hit = async (worker, key = 'shared') => {
    const response = await worker.fetch('/hit?key=' + key);
    expect(response.status).toBe(200);
    return response.json();
  };
  const initial = await hit(first);
  expect(initial.count).toBe(1);
  const burst = await Promise.all(Array.from({ length: 20 }, (_, index) => hit(index % 2 ? first : second)));
  expect(burst.map(result => result.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 2));
  expect(new Set(burst.map(result => result.resetAt))).toEqual(new Set([initial.resetAt]));
  expect((await hit(first, 'other')).count).toBe(1);

  // This evicts the actual native DO instance; only its durable storage survives.
  await first.evictDurableObject('RATE_LIMIT_DO', { name: 'shared' });
  expect(await hit(second)).toEqual({ count: 22, resetAt: initial.resetAt });
  await first.evictDurableObject('RateLimitDurableObject', { name: 'shared' });
  expect(await hit(first)).toEqual({ count: 23, resetAt: initial.resetAt });

  expect((await first.fetch('/limited', { method: 'POST' })).status).toBe(200);
  expect((await second.fetch('/limited', { method: 'POST' })).status).toBe(200);
  await first.evictDurableObject('RATE_LIMIT_DO', { name: 'route:member' });
  const blocked = await first.fetch('/limited', { method: 'POST' });
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED' });
  expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(await (await first.fetch('/mutations')).json()).toEqual({ mutations: 1, run: 'before' });

  // Reload both Worker entrypoints too, retaining native object storage.
  await server.update({ ...options, workers: options.workers.map(worker => ({ config: { ...worker.config,
    vars: { ...worker.config.vars, RUN: 'after' } } })) });
  expect(await hit(server.getWorker('second'))).toEqual({ count: 24, resetAt: initial.resetAt });
  expect((await server.getWorker('first').fetch('/limited', { method: 'POST' })).status).toBe(429);
  expect(await (await server.getWorker('first').fetch('/mutations')).json()).toEqual({ mutations: 0, run: 'after' });
  for (const window of ['0', '-1', 'NaN', 'Infinity', '1.5']) {
    expect((await server.getWorker('first').fetch('/raw?window=' + window)).status).toBe(400);
  }
  const configured = server.getWorker('first');
  expect((await configured.fetch('/configured')).status).toBe(200);
  expect((await configured.fetch('/configured?store=alternate')).status).toBe(200);
  expect((await server.getWorker('second').fetch('/configured')).status).toBe(429);
  expect((await server.getWorker('second').fetch('/configured?store=alternate')).status).toBe(429);
  expect((await configured.fetch('/configured?mode=unknown')).status).toBe(500);
  expect((await configured.fetch('/configured?mode=null')).status).toBe(500);
  expect((await configured.fetch('/configured?store=missing')).status).toBe(500);
  expect((await configured.fetch('/configured?mode=unset')).status).toBe(200);
  expect((await configured.fetch('/configured?mode=unset')).status).toBe(429);
  expect(await (await configured.fetch('/mutations')).json()).toEqual({ mutations: 3, run: 'after' });
}, 60_000);
