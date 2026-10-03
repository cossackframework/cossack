import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

let directory, server;
afterEach(async ({ task }) => {
  if (task.result?.state === 'fail') server?.debug();
  await server?.close(); server = undefined;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('uses compiled cache contracts with native KV, cross-Worker DO storage, eviction and request binding changes', async () => {
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cache-persistence-'));
  const modulePath = relative => fileURLToPath(new URL(relative, import.meta.url));
  const main = path.join(directory, 'worker.ts');
  await fs.writeFile(main, `
    import { AsyncLocalStorage } from 'node:async_hooks';
    import { Hono } from ${JSON.stringify(modulePath('../../../node_modules/hono/dist/index.js'))};
    import { setRequestContextGetter } from ${JSON.stringify(modulePath('../../core/dist/index.js'))};
    import { cache, CacheDurableObject } from ${JSON.stringify(modulePath('../../framework/dist/esm/cache.js'))};
    import { runWithConfig } from ${JSON.stringify(modulePath('../../framework/dist/esm/config.js'))};
    export { CacheDurableObject };
    export class AlternateCacheDurableObject extends CacheDurableObject {}
    const contexts = new AsyncLocalStorage(); setRequestContextGetter(() => contexts.getStore());
    const app = new Hono();
    app.onError(error => Response.json({ failed: true }, { status: 500 }));
    app.use('*', (c, next) => {
      const driver = c.req.query('driver') || 'durable-object';
      const namespace = c.req.query('namespace') ?? 'cossack:cache:';
      return contexts.run(c, () => runWithConfig({ env: c.env, config: { cache: {
        default: 'main', stores: { main: { driver, namespace, binding: driver === 'kv' ? 'CACHE' : 'CACHE_DO' } },
      } } }, next));
    });
    app.post('/action', async c => {
      const { operation, key, value, ttlMs, entries, keys } = await c.req.json();
      if (operation === 'set') { await cache.set(key, value, ttlMs); return c.json({ ok: true }); }
      if (operation === 'get') { const result = await cache.get(key); return c.json({ found: result !== undefined, value: result }); }
      if (operation === 'has') return c.json(await cache.has(key));
      if (operation === 'delete') { await cache.delete(key); return c.json({ ok: true }); }
      if (operation === 'setMany') { await cache.setMany(entries); return c.json({ ok: true }); }
      if (operation === 'getMany') return c.json((await cache.getMany(keys)).map(value => ({ found: value !== undefined, value })));
      return c.json({ failed: true }, 400);
    });
    app.post('/raw', c => c.env.CACHE_DO.get(c.env.CACHE_DO.idFromName('default')).fetch(
      'https://cache/set-many', { method: 'POST', body: JSON.stringify([{ key: 'unchanged', value: 1 }, { key: 'bad', value: 2, ttlMs: -1 }]) }));
    app.get('/retention', async c => c.json(await c.env.CACHE.get(JSON.stringify(['cossack:cache:', 'expiry']), { type: 'json' })));
    app.get('/run', c => c.json(c.env.RUN));
    export default { fetch(request, env, context) {
      const selected = { ...env };
      const binding = new URL(request.url).searchParams.get('binding');
      if (binding === 'alternate') { selected.CACHE = env.CACHE_ALT; selected.CACHE_DO = env.CACHE_DO_ALT; }
      if (binding === 'missing') { delete selected.CACHE; delete selected.CACHE_DO; }
      return app.fetch(request, selected, context);
    } };
  `);
  const common = { main, compatibility_date: '2026-07-29', compatibility_flags: ['nodejs_compat', 'enable_request_signal'], vars: { RUN: 'before' },
    kv_namespaces: [{ binding: 'CACHE', id: 'a'.repeat(32) }, { binding: 'CACHE_ALT', id: 'b'.repeat(32) }] };
  const options = { root: directory, workers: [
    { config: { ...common, name: 'first', durable_objects: { bindings: [
      { name: 'CACHE_DO', class_name: 'CacheDurableObject' },
      { name: 'CACHE_DO_ALT', class_name: 'AlternateCacheDurableObject' },
    ] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['CacheDurableObject', 'AlternateCacheDurableObject'] }] } },
    { config: { ...common, name: 'second', durable_objects: { bindings: [
      { name: 'CACHE_DO', class_name: 'CacheDurableObject', script_name: 'first' },
      { name: 'CACHE_DO_ALT', class_name: 'AlternateCacheDurableObject', script_name: 'first' },
    ] } } },
  ] };
  server = createTestHarness(options); await server.listen();
  let first = server.getWorker('first'), second = server.getWorker('second');
  const invoke = async (worker, input, query = '') => {
    const response = await worker.fetch('/action' + query, { method: 'POST', body: JSON.stringify(input) });
    expect(response.status).toBe(200); return response.json();
  };
  const keys = ['.', '..', '/', 'flush', 'get-many', '?key', '#hash', '🙂'];
  await invoke(first, { operation: 'setMany', entries: keys.map(key => ({ key, value: null })) });
  expect(await invoke(second, { operation: 'getMany', keys: [...keys, 'missing'] })).toEqual([
    ...keys.map(() => ({ found: true, value: null })), { found: false },
  ]);
  await first.evictDurableObject('CACHE_DO', { name: 'default' });
  expect(await invoke(second, { operation: 'get', key: '.' })).toEqual({ found: true, value: null });
  expect(await invoke(first, { operation: 'get', key: '.' }, '?binding=alternate')).toEqual({ found: false });
  await invoke(first, { operation: 'set', key: '.', value: 'alternate' }, '?binding=alternate');
  expect(await invoke(second, { operation: 'get', key: '.' }, '?binding=alternate')).toEqual({ found: true, value: 'alternate' });
  expect(await invoke(first, { operation: 'get', key: '.' })).toEqual({ found: true, value: null });
  for (const driver of ['kv', 'durable-object']) {
    const response = await first.fetch('/action?driver=' + driver + '&binding=missing', { method: 'POST', body: JSON.stringify({ operation: 'get', key: '.' }) });
    expect(response.status).toBe(500);
  }
  expect((await first.fetch('/raw', { method: 'POST' })).status).toBe(400);
  expect(await invoke(first, { operation: 'get', key: 'unchanged' })).toEqual({ found: false });
  await invoke(first, { operation: 'set', key: 'shared', value: null }, '?driver=kv');
  expect(await invoke(second, { operation: 'get', key: 'shared' }, '?driver=kv')).toEqual({ found: true, value: null });
  await invoke(first, { operation: 'set', key: 'shared', value: 'alternate' }, '?driver=kv&binding=alternate');
  expect(await invoke(first, { operation: 'get', key: 'shared' }, '?driver=kv')).toEqual({ found: true, value: null });
  expect(await invoke(second, { operation: 'get', key: 'shared' }, '?driver=kv&binding=alternate')).toEqual({ found: true, value: 'alternate' });
  await invoke(first, { operation: 'set', key: 'b:c', value: 'first' }, '?driver=kv&namespace=a:');
  await invoke(first, { operation: 'set', key: 'c', value: 'second' }, '?driver=kv&namespace=a:b:');
  expect(await invoke(second, { operation: 'get', key: 'b:c' }, '?driver=kv&namespace=a:')).toEqual({ found: true, value: 'first' });
  for (const driver of ['kv', 'durable-object']) {
    await invoke(first, { operation: 'set', key: 'expiry', value: 'short', ttlMs: 500 }, '?driver=' + driver);
    expect(await invoke(second, { operation: 'has', key: 'expiry' }, '?driver=' + driver)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(await invoke(second, { operation: 'has', key: 'expiry' }, '?driver=' + driver)).toBe(false);
  }
  expect(await (await first.fetch('/retention')).json()).toMatchObject({ version: 1, value: 'short' });
  await server.update({ ...options, workers: options.workers.map(worker => ({ config: { ...worker.config, vars: { RUN: 'after' } } })) });
  first = server.getWorker('first'); second = server.getWorker('second');
  expect(await (await first.fetch('/run')).json()).toBe('after');
  expect(await invoke(second, { operation: 'get', key: '.' })).toEqual({ found: true, value: null });
  expect(await invoke(second, { operation: 'get', key: 'shared' }, '?driver=kv')).toEqual({ found: true, value: null });
}, 60_000);
