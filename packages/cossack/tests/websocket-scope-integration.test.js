import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

// A `durable-object` page with a per-user scope, served through the real
// Cloudflare WebSocket proxy and Durable Objects in workerd.
let directory;
let server;
const sockets = [];
afterEach(async ({ task }) => {
  if (task.result?.state === 'fail') server?.debug();
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('shares one Durable Object per user across the URLs of a user-scoped page and rejects other targets', async () => {
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-ws-scope-'));
  const core = fileURLToPath(new URL('../../core/dist/index.js', import.meta.url));
  const proxy = fileURLToPath(new URL('../../framework/src/transports/websocket.ts', import.meta.url));
  const hono = fileURLToPath(new URL('../../../node_modules/hono/dist/index.js', import.meta.url));
  const main = path.join(directory, 'worker.ts');
  await fs.writeFile(main, `
    import { Hono } from ${JSON.stringify(hono)};
    import { Cossack, CossackDurableObject, Page, Server, State } from ${JSON.stringify(core)};
    import { handleWebSocketProxy } from ${JSON.stringify(proxy)};
    const inboxPath = '/src/pages/inbox/[folder]/index.ts';
    const notesPath = '/src/pages/notes/index.ts';
    // One instance per signed-in user; anonymous requests never get a shared key.
    const perUser = c => {
      const user = c.get('user');
      if (!user) throw Object.assign(new Error('Authentication required'), { authorizationCode: 'COSSACK_AUTH_UNAUTHENTICATED' });
      return 'user:' + user.id;
    };
    class Inbox extends Cossack {
      count = 0;
      render() { return null; }
      increment() { return ++this.count; }
      whoami() { return { user: this.user?.id ?? null, folder: this.c.req.param('folder'), count: this.count }; }
    }
    class Notes extends Inbox {}
    for (const Component of [Inbox, Notes]) Page({ transport: 'durable-object', scope: perUser })(Component);
    State()(Inbox.prototype, 'count');
    for (const name of ['increment', 'whoami'])
      Server()(Inbox.prototype, name, Object.getOwnPropertyDescriptor(Inbox.prototype, name));
    export class ScopeObject extends CossackDurableObject {
      async getComponentRegistry() { return new Map([[inboxPath, Inbox], [notesPath, Notes]]); }
    }
    const app = new Hono();
    app.use('*', async (c, next) => {
      // Test-only authentication, supplied by this Worker.
      const id = c.req.header('x-test-user');
      if (id) {
        c.set('user', { id });
        c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: id } }));
      }
      await next();
    });
    app.onError((error, c) => error?.authorizationCode ? c.json({ code: error.authorizationCode }, 401) : c.json({ code: 'INTERNAL' }, 500));
    // What SSR emits for a scoped page: the id of the object named by the scope key.
    app.get('/id', c => c.json({ id: c.env.COSSACK_OBJECT.idFromName(c.req.query('name')).toString() }));
    app.get('/ws/:id', handleWebSocketProxy({
      pages: { [inboxPath]: { default: Inbox }, [notesPath]: { default: Notes } }, layouts: {},
      allowedOrigins: ['http://localhost'],
      routePathToFilePathMap: new Map([['/inbox/[folder]', inboxPath], ['/notes', notesPath]]),
    }));
    export default { fetch: (request, env, context) => app.fetch(request, env, context) };
  `);
  server = createTestHarness({ root: directory, workers: [{ config: {
    name: 'scope', main, compatibility_date: '2026-06-06', compatibility_flags: ['nodejs_compat'],
    durable_objects: { bindings: [{ name: 'COSSACK_OBJECT', class_name: 'ScopeObject' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['ScopeObject'] }],
  } }] });
  const { url } = await server.listen();
  const worker = server.getWorker('scope');
  const idFor = async name => (await (await worker.fetch(new URL('/id?name=' + encodeURIComponent(name), url))).json()).id;

  const connect = async ({ target, user, routePath = '/inbox/[folder]', folder = 'work' }) => {
    const route = new URL('/ws/' + encodeURIComponent(target), url);
    route.searchParams.set('routePath', routePath);
    route.searchParams.set('pathname', routePath === '/notes' ? '/notes' : '/inbox/' + folder);
    route.searchParams.set('params', JSON.stringify(routePath === '/notes' ? {} : { folder }));
    const response = await worker.fetch(route, { headers: { Upgrade: 'websocket', Origin: 'http://localhost',
      ...(user ? { 'x-test-user': user } : {}) } });
    if (response.status !== 101) return { status: response.status, body: await response.json() };
    const socket = response.webSocket; socket.accept(); sockets.push(socket);
    const frames = [];
    const waiters = [];
    socket.addEventListener('message', ({ data }) => {
      const frame = JSON.parse(data);
      const waiter = waiters.find(candidate => candidate.match(frame));
      if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame); }
      else frames.push(frame);
    });
    const next = match => new Promise(resolve => {
      const seen = frames.find(match);
      if (seen) { frames.splice(frames.indexOf(seen), 1); resolve(seen); } else waiters.push({ match, resolve });
    });
    return { status: 101, next,
      call(action) {
        const requestId = crypto.randomUUID();
        socket.send(JSON.stringify({ v: 1, type: 'action', requestId, action, payload: [] }));
        return next(frame => frame.requestId === requestId && (frame.type === 'done' || frame.type === 'error'));
      } };
  };

  const alice = await idFor('user:alice');
  const bob = await idFor('user:bob');
  expect(alice).not.toBe(bob);

  // Two URLs of the page, one user: one Durable Object and one state.
  const work = await connect({ target: alice, user: 'alice', folder: 'work' });
  const home = await connect({ target: alice, user: 'alice', folder: 'home' });
  expect(await work.call('increment')).toMatchObject({ type: 'done', value: 1 });
  expect(await home.next(frame => frame.type === 'state-update')).toEqual({ type: 'state-update', state: { count: 1 } });
  expect((await home.call('whoami')).value).toEqual({ user: 'alice', folder: 'home', count: 1 });

  // Another user gets another Durable Object.
  const other = await connect({ target: bob, user: 'bob' });
  expect(await other.call('increment')).toMatchObject({ type: 'done', value: 1 });
  expect((await work.call('whoami')).value.count).toBe(1);

  // A target that differs from the server-computed scope key is rejected.
  for (const [target, user] of [[alice, 'bob'], [await idFor('user:mallory'), 'alice'], [await idFor('page:inbox'), 'alice']]) {
    const intruder = await connect({ target, user });
    expect(intruder.status).toBe(101);
    // The object accepts only to send the terminal frame, then closes with 1008.
    expect(await intruder.next(() => true)).toMatchObject({ type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED' });
  }
  expect((await work.call('whoami')).value.count).toBe(1);

  // Another page with the same key cannot join the object that hosts the inbox.
  expect(await connect({ target: alice, user: 'alice', routePath: '/notes' }))
    .toEqual({ status: 403, body: expect.objectContaining({ code: 'COSSACK_WS_SCOPE_MISMATCH' }) });

  // The scope fails closed for anonymous users before reaching an object.
  expect(await connect({ target: await idFor('user:anonymous') })).toEqual({ status: 401, body: { code: 'COSSACK_AUTH_UNAUTHENTICATED' } });
}, 60_000);
