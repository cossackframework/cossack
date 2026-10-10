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
      const blocked = await enforceRateLimit(c, 'route', { window: 120000, max: 2, key: () => 'member', requires: { shared: true, durable: true, atomicIncrement: true } });
      return blocked || c.json({ mutations: ++mutations });
    });
    app.get('/mutations', c => c.json({ mutations, run: c.env.RUN }));
    app.onError(c => Response.json({ error: 'Internal Server Error' }, { status: 500 }));
    app.get('/configured', async c => {
      const blocked = await enforceRateLimit(c, 'config-route', { max: 1, key: () => 'member',
        ...(c.req.query('required') ? { requires: { shared: true, atomicIncrement: true } } : {}) });
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
  await first.evictDurableObject('RATE_LIMIT_DO', { name: JSON.stringify(['route', 'member']) });
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
  expect((await configured.fetch('/configured?mode=unset&required=1')).status).toBe(500);
  expect(await (await configured.fetch('/mutations')).json()).toEqual({ mutations: 2, run: 'after' });
  expect((await configured.fetch('/configured?mode=unset')).status).toBe(200);
  expect((await configured.fetch('/configured?mode=unset')).status).toBe(429);
  expect(await (await configured.fetch('/mutations')).json()).toEqual({ mutations: 3, run: 'after' });
}, 60_000);

it('bounds native counter response bodies and cancels decisions before handler mutation', async () => {
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-rate-io-'));
  const core = fileURLToPath(new URL('../../core/dist/index.js', import.meta.url));
  const hono = fileURLToPath(new URL('../../../node_modules/hono/dist/index.js', import.meta.url));
  const main = path.join(directory, 'worker.ts');
  await fs.writeFile(main, `
    import { Hono } from ${JSON.stringify(hono)};
    import { RateLimit, DurableObjectRateLimitStore, RedisRateLimitStore } from ${JSON.stringify(core)};
    export class CounterReplies {
      state; hits = 0; cancels = 0;
      constructor(state) { this.state = state; }
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/stats') return Response.json({ hits: this.hits, cancels: this.cancels });
        this.hits++;
        const mode = url.searchParams.get('mode');
        const text = JSON.stringify({ count: 1, resetAt: Date.now() + 60000 });
        const encoder = new TextEncoder();
        if (mode === 'valid') return new Response(text.padEnd(8192, ' '));
        if (mode === 'utf8') return new Response(new Uint8Array([255]));
        if (mode === 'error') return new Response(new ReadableStream({ cancel: () => { this.cancels++; } }), { status: 503 });
        return new Response(new ReadableStream({ start(c) {
          c.enqueue(encoder.encode(mode === 'oversized' ? text.padEnd(8193, ' ') : text));
        }, cancel: () => { this.cancels++; } }));
      }
    }
    const app = new Hono();
    let mutations = 0;
    app.get('/case', async c => {
      const mode = c.req.query('mode');
      const controller = new AbortController();
      let timer;
      const stub = c.env.COUNTERS.getByName(mode);
      let observedBody;
      const namespace = { idFromName: name => name, get: () => ({
        fetch: async (input, init) => {
          const response = await stub.fetch(input + '&mode=' + mode, init);
          observedBody = response.body;
          if (mode === 'abort') timer = setTimeout(() => controller.abort('PRIVATE_REASON'), 30);
          return response;
        },
      }) };
      const guarded = new Hono();
      guarded.onError(error => Response.json({ code: error.code || 'COSSACK_RPC_INTERNAL_ERROR' }, { status: 500 }));
      guarded.get('/', RateLimit({ backendTimeoutMs: 500, key: () => 'member' }, c => c.json({ mutations: ++mutations })));
      try {
        const response = await guarded.fetch(new Request('https://guard/', { signal: controller.signal }),
          { rateLimit: 'do', RATE_LIMIT_DO: namespace });
        const body = await response.json();
        const stats = await (await stub.fetch('https://limit/stats')).json();
        return c.json({ status: response.status, body, stats, mutations, localLocked: observedBody?.locked ?? false });
      } finally { clearTimeout(timer); }
    });
    // A deliberately uncooperative custom fetch tests late-response disposal in
    // the actual Worker runtime. It is not a remote Redis service or native DO.
    app.get('/late', async c => {
      let charged = 0; let cancelled = 0; let receivedSignal;
      const provider = c.req.query('provider');
      const fetch = async (input, init) => {
        receivedSignal = init.signal; charged++;
        await new Promise(resolve => setTimeout(resolve, 80));
        return new Response(new ReadableStream({ cancel() { cancelled++; } }));
      };
      const store = provider === 'redis' ? new RedisRateLimitStore({ url: 'https://redis.test', token: 'private', fetch })
        : new DurableObjectRateLimitStore({ idFromName: name => name, get: () => ({ fetch }) });
      let code;
      try { await store.hit('member', 60000, { timeoutMs: 20 }); mutations++; }
      catch (error) { code = error.code; }
      await new Promise(resolve => setTimeout(resolve, 120));
      return c.json({ code, charged, cancelled, aborted: receivedSignal.aborted, mutations });
    });
    export default { fetch: (request, env, context) => app.fetch(request, env, context) };
  `);
  server = createTestHarness({ root: directory, workers: [{ config: { main, name: 'io',
    compatibility_date: '2026-07-29', compatibility_flags: ['nodejs_compat', 'enable_request_signal'],
    durable_objects: { bindings: [{ name: 'COUNTERS', class_name: 'CounterReplies' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['CounterReplies'] }],
  } }] });
  await server.listen();
  const worker = server.getWorker('io');
  for (const mode of ['oversized', 'utf8', 'error', 'stall', 'abort']) {
    const response = await worker.fetch('/case?mode=' + mode);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ status: 500, mutations: 0, localLocked: false, stats: { hits: 1 },
      body: { code: mode === 'abort' ? 'COSSACK_RPC_CANCELLED' : mode === 'stall' ? 'COSSACK_RPC_TIMEOUT' : 'COSSACK_RPC_INTERNAL_ERROR' } });
    // workerd does not promise delivery of a remote JS producer cancel hook.
    // The returned body's reader is released and the action never runs.
  }
  for (const provider of ['redis', 'do']) {
    expect(await (await worker.fetch('/late?provider=' + provider)).json()).toEqual({
      code: 'COSSACK_RPC_TIMEOUT', charged: 1, cancelled: 1, aborted: true, mutations: 0 });
  }
  expect(await (await worker.fetch('/case?mode=valid')).json()).toMatchObject({ status: 200, mutations: 1, stats: { hits: 1 } });
}, 30000);
