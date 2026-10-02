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
    let started = 0;
    const stubFor = (env, request) => env.COSSACK_SSE.getByName(
      JSON.stringify(['page', new URL(request.url).searchParams.get('scope') || 'shared']));
    export default {
      async fetch(request, env) {
        const url = new URL(request.url);
        const stub = stubFor(env, request);
        if (url.pathname === '/state') {
          return Response.json(await stub.currentState());
        }
        if (url.pathname === '/updates') {
          return Response.json(await stub.updates(Number(url.searchParams.get('after') || 0)));
        }
        if (url.pathname === '/initialize') {
          return Response.json(await stub.initialize(url.searchParams.get('state') || JSON.stringify({ count: 0 })));
        }
        if (url.pathname === '/publish') {
          return Response.json(await stub.publish(url.searchParams.get('state') || '{"count":100}'));
        }
        if (url.pathname === '/broadcast') {
          return Response.json(await stub.broadcast('event', JSON.stringify({ eventName: 'ping', payload: [url.searchParams.get('value') || 'x'] })));
        }
        if (url.pathname === '/counts') return Response.json({ started, closed });
        return scope.run(env.MARK, async () => {
          const inRequest = AsyncLocalStorage.snapshot();
          return stub.execute(state => inRequest(async () => {
            const snapshot = JSON.parse(state);
            started++;
            return createRpcStreamResponse({
              requestId: crypto.randomUUID(), signal: request.signal,
              getState: () => url.pathname === '/invalid-state' ? undefined : snapshot,
              cleanup: async () => { closed++; },
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
  // The harness enables the experimental abort_signal compatibility flag for
  // AbortSignal-over-RPC only where the installed workerd supports it; the
  // framework itself must work without it (see the router's stream-cancel
  // fallback). Request-body cancel propagation is the baseline mechanism.
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

  // Uninitialized scopes report no snapshot; initialization is first-write-wins.
  expect(await (await server.fetch('/state')).json()).toBe(null);
  const firstInit = await (await server.fetch(`/initialize?state=${encodeURIComponent('{"count":5}')}`)).json();
  expect(firstInit).toEqual({ state: '{"count":5}', cursor: 0, fresh: true });
  const secondInit = await (await server.fetch(`/initialize?state=${encodeURIComponent('{"count":0}')}`)).json();
  expect(secondInit).toEqual({ state: '{"count":5}', cursor: 0, fresh: false });

  const calls = await Promise.all(Array.from({ length: 6 }, (_, i) => invoke(i % 2 ? 'second' : 'first')));
  expect(calls.map(frames => frames.at(-1).value).sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11]);
  calls.forEach((frames, i) => expect(frames[0].value.worker).toBe(i % 2 ? 'second' : 'first'));
  const state = async () => (await server.fetch('/state')).json();
  expect(JSON.parse((await state()).state)).toEqual({ count: 11 });
  await server.fetch(`/initialize?scope=other&state=${encodeURIComponent('{"count":0}')}`);
  const other = await invoke('second', '/increment?scope=other');
  expect(other.at(-1).value).toBe(1);

  // Ordinary JSON responses pass through the coordinator unchanged; an
  // explicit publish makes their state authoritative for later actions.
  const published = await (await server.fetch(`/publish?state=${encodeURIComponent('{"count":100}')}`)).json();
  expect(published.cursor).toBeGreaterThan(0);
  expect((await invoke('first')).at(-1).value).toBe(101);

  // Broadcasts append events without replacing the authoritative state.
  await server.fetch('/broadcast?value=hello');
  const updates = await (await server.fetch('/updates')).json();
  expect(JSON.parse(updates.snapshot.state)).toEqual({ count: 101 });
  expect(updates.events.at(-1)).toMatchObject({ event: 'event', data: '{"eventName":"ping","payload":["hello"]}' });

  // A caller that disconnects while queued cannot deadlock the scope: its
  // action runs at most once (result discarded, never replayed) and later
  // actions still acquire the serialization slot.
  const slow = invoke('first', '/slow');
  await new Promise(resolve => setTimeout(resolve, 20));
  const abandoned = new AbortController();
  const queued = fetch(new URL('/increment', url), { signal: abandoned.signal })
    .catch(() => 'aborted');
  await new Promise(resolve => setTimeout(resolve, 15));
  abandoned.abort();
  await queued;
  expect((await slow).at(-1).value).toBe(102);
  expect((await invoke('second')).at(-1).value).toBeGreaterThan(102);

  // Frames without object state fail the stream explicitly and release the slot.
  const invalid = await server.getWorker('first').fetch(new URL('/invalid-state', url));
  expect(invalid.status).toBe(200);
  await expect((async () => { for await (const frame of readRpcStream(invalid)) void frame; })())
    .rejects.toThrow();
  expect((await invoke('first')).at(-1).value).toBeGreaterThan(103);

  await server.update({ ...options, workers: options.workers.map(worker => ({ config: {
    ...worker.config, vars: { ...worker.config.vars, RELOAD: true },
  } })) });
  const beforeReload = JSON.parse((await state()).state).count;
  expect(beforeReload).toBeGreaterThanOrEqual(104);
  expect(JSON.parse((await state()).state)).toEqual({ count: beforeReload });

  // Bounded history: after more than MAX_EVENTS publications, an old cursor no
  // longer has a complete log — updates() reports resync and the subscriber
  // receives the authoritative snapshot instead of a gap.
  for (let index = 0; index < 140; index++) {
    await server.fetch(`/publish?state=${encodeURIComponent(`{"count":${200 + index}}`)}`);
  }
  const pruned = await (await server.fetch('/updates?after=2')).json();
  expect(pruned.resync).toBe(true);
  expect(pruned.events).toEqual([]);
  expect(JSON.parse(pruned.snapshot.state)).toEqual({ count: 339 });
  const resumedFromStale = await (await server.fetch('/updates?after=100')).json();
  expect(resumedFromStale.resync).toBe(false);
  expect(resumedFromStale.events.length).toBeGreaterThan(0);
  // The coordinator survives the reload with its SQLite state intact.
  expect((await invoke('second')).at(-1).value).toBe(340);
  const slowHttp = await fetch(new URL('/slow', url));
  const reader = slowHttp.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('yield');
  await reader.cancel();
  // The canceled response must release the serialization slot.
  expect((await invoke('first')).at(-1).value).toBeGreaterThan(340);
}, 60_000);
