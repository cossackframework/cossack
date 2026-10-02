import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { readRpcStream } from '../../core/dist/index.js';

let directory;
let server;
afterEach(async () => {
  await server?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('coordinates native RPC callbacks across Workers and keeps SQLite state after reload', async () => {
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-sse-coordinator-'));
  const coordinator = fileURLToPath(new URL('../../framework/src/SseDurableObject.ts', import.meta.url));
  const rpcStream = fileURLToPath(new URL('../../framework/src/transports/rpc-stream.ts', import.meta.url));
  const main = path.join(directory, 'worker.ts');
  await fs.writeFile(main, `
    import { AsyncLocalStorage } from 'node:async_hooks';
    import { SseDurableObject } from ${JSON.stringify(coordinator)};
    import { createRpcStreamResponse } from ${JSON.stringify(rpcStream)};
    export { SseDurableObject };
    const scope = new AsyncLocalStorage();
    let closed = 0;
    export default {
      async fetch(request, env) {
        const url = new URL(request.url);
        const stub = env.COSSACK_SSE.getByName(JSON.stringify(['page', url.searchParams.get('scope') || 'shared']));
        const initial = await stub.initialize(JSON.stringify({ count: 0 }));
        if (url.pathname === '/state') return Response.json(initial);
        if (url.pathname === '/updates') return Response.json(await stub.updates(Number(url.searchParams.get('after') || 0)));
        if (url.pathname === '/closed') return Response.json({ closed });
        return scope.run(env.MARK, async () => {
          const inRequest = AsyncLocalStorage.snapshot();
          return stub.execute(state => inRequest(async () => {
            const snapshot = JSON.parse(state);
            return createRpcStreamResponse({
              requestId: crypto.randomUUID(), signal: request.signal,
              getState: () => snapshot, cleanup: async () => { closed++; },
              result: (async function* () {
                await new Promise(resolve => setTimeout(resolve, 10));
                snapshot.count++;
                yield { count: snapshot.count, worker: scope.getStore() };
                if (url.pathname === '/slow') await new Promise(resolve => setTimeout(resolve, 100));
                return snapshot.count;
              })(),
            });
          }));
        });
      },
    };
  `);
  const common = { main, compatibility_date: '2026-06-06', compatibility_flags: ['nodejs_compat'] };
  const options = { root: directory, workers: [
    { config: { ...common, name: 'first', vars: { MARK: 'first' },
      durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['SseDurableObject'] }] } },
    { config: { ...common, name: 'second', vars: { MARK: 'second' },
      durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject', script_name: 'first' }] } } },
  ] };
  server = createTestHarness(options);
  const { url } = await server.listen();
  const invoke = async (worker, route = '/increment') => {
    const response = await server.getWorker(worker).fetch(new URL(route, url));
    expect(response.status).toBe(200);
    const frames = [];
    for await (const frame of readRpcStream(response)) frames.push(frame);
    return frames;
  };
  const calls = await Promise.all(Array.from({ length: 6 }, (_, i) => invoke(i % 2 ? 'second' : 'first')));
  expect(calls.map(frames => frames.at(-1).value).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  calls.forEach((frames, i) => expect(frames[0].value.worker).toBe(i % 2 ? 'second' : 'first'));
  const state = async () => (await server.fetch('/state')).json();
  expect(JSON.parse((await state()).state)).toEqual({ count: 6 });
  const other = await invoke('second', '/increment?scope=other');
  expect(other.at(-1).value).toBe(1);
  const updates = await (await server.fetch('/updates')).json();
  expect(updates.snapshot.cursor).toBe(12);
  expect(updates.events.at(-1)).toMatchObject({ event: 'state-update', data: '{"count":6}' });
  await server.update({ ...options, workers: options.workers.map(worker => ({ config: {
    ...worker.config, vars: { ...worker.config.vars, RELOAD: true },
  } })) });
  expect(JSON.parse((await state()).state)).toEqual({ count: 6 });
  expect((await invoke('second')).at(-1).value).toBe(7);
  const slow = await fetch(new URL('/slow', url));
  const reader = slow.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('yield');
  await reader.cancel();
  // The canceled response must release the serialization slot.
  expect((await invoke('first')).at(-1).value).toBeGreaterThan(7);
}, 30_000);
