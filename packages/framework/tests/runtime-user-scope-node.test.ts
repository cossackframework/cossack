import 'reflect-metadata';
import { createServer, type Server as HttpServer } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
// The real Node adapter: one in-process instance per component and target.
import { createNodeAdapter } from '../../node-adapter/src/adapter';

/**
 * A `durable-object` page with a per-user scope, served by the Node runtime:
 * every URL of the page shares one in-process instance per user, different
 * users are isolated, and the server never accepts a target it did not compute.
 */
const { registry } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
// Test-only authentication: the user comes from a header this fixture trusts.
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  const id = c.req.header('x-test-user');
  if (id) {
    c.set('user', { id });
    c.set('cossack.captureRealtimeIdentity', async () => ({ version: 1, provider: 'fixture.session', data: { reference: id } }));
  }
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const userScope = (c: any) => {
  const user = c.get('user');
  if (!user) throw Object.assign(new Error('Authentication required'), { authorizationCode: 'COSSACK_AUTH_UNAUTHENTICATED' });
  return `user:${user.id}`;
};
@Page({ transport: 'durable-object', scope: userScope })
class Inbox extends Cossack {
  @State() count = 0;
  @Server() increment() { return ++this.count; }
  render() { return html`<main>${this.count}</main>`; }
}
@Page({ transport: 'durable-object', scope: userScope })
class Notes extends Cossack {
  @State() count = 0;
  @Server() increment() { return ++this.count; }
  render() { return html`<main>${this.count}</main>`; }
}
registry.pages['/src/pages/inbox/[folder]/index.ts'] = { default: Inbox };
registry.pages['/src/pages/notes/index.ts'] = { default: Notes };
const { createApp } = await import('../src/router');

const runtime = createNodeAdapter({ idleTimeoutMs: 60_000 });
const app = createApp({ runtimeAdapter: runtime });
let server: HttpServer;
let origin: string;
const sockets: WebSocket[] = [];
beforeAll(async () => {
  server = createServer();
  runtime.attach(server, request => app.fetch(request));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await runtime.dispose();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function ssrTarget(path: string, user: string): Promise<string> {
  const response = await app.request(path, { headers: { 'x-test-user': user } });
  expect(response.status).toBe(200);
  const json = (await response.text()).match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!;
  return JSON.parse(json).realtimeTarget;
}

interface Peer { socket: WebSocket; frames: any[]; first: Promise<any>; call(action: string): Promise<any>; next(type: string): Promise<any> }
function open(path: string, target: string, routePath: string, params: Record<string, string>, user: string): Peer {
  const query = new URLSearchParams({ routePath, pathname: routePath.replace('[folder]', params.folder ?? ''), params: JSON.stringify(params) });
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}${path}${encodeURIComponent(target)}?${query}`,
    { headers: { origin, 'x-test-user': user } });
  sockets.push(socket);
  const frames: any[] = [];
  const waiters: { match: (frame: any) => boolean; resolve: (frame: any) => void }[] = [];
  socket.on('message', data => {
    const frame = JSON.parse(String(data));
    const waiter = waiters.find(candidate => candidate.match(frame));
    if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame); }
    else frames.push(frame);
  });
  const wait = (match: (frame: any) => boolean) => new Promise<any>(resolve => {
    const seen = frames.find(match);
    if (seen) { frames.splice(frames.indexOf(seen), 1); resolve(seen); } else waiters.push({ match, resolve });
  });
  return {
    socket, frames,
    first: wait(() => true),
    next: type => wait(frame => frame.type === type),
    call: action => {
      const requestId = crypto.randomUUID();
      socket.send(JSON.stringify({ v: 1, type: 'action', requestId, action, payload: [], channel: 'global', target: 'root' }));
      return wait(frame => frame.requestId === requestId && (frame.type === 'done' || frame.type === 'error'));
    },
  };
}
const inbox = (target: string, folder: string, user: string) => open('/ws/', target, '/inbox/[folder]', { folder }, user);
const closed = (socket: WebSocket) => new Promise<number>(resolve => socket.once('close', code => resolve(code)));

it('shares one Node instance per user across the URLs of a user-scoped page', async () => {
  const alice = await ssrTarget('/inbox/work', 'alice');
  expect(await ssrTarget('/inbox/home', 'alice')).toBe(alice);
  expect(alice).toBe('user:alice');
  const bob = await ssrTarget('/inbox/work', 'bob');
  expect(bob).toBe('user:bob');

  const work = inbox(alice, 'work', 'alice');
  const home = inbox(alice, 'home', 'alice');
  const other = inbox(bob, 'work', 'bob');
  expect(await work.first).toEqual({ type: 'state-update', state: { count: 0 } });
  expect(await home.first).toEqual({ type: 'state-update', state: { count: 0 } });
  expect(await other.first).toEqual({ type: 'state-update', state: { count: 0 } });
  expect(runtime.instanceCount).toBe(2);

  // Alice's two pages see one state; Bob's instance is separate.
  expect(await work.call('increment')).toMatchObject({ type: 'done', value: 1 });
  expect(await home.next('state-update')).toEqual({ type: 'state-update', state: { count: 1 } });
  expect(await home.call('increment')).toMatchObject({ type: 'done', value: 2 });
  expect(await other.call('increment')).toMatchObject({ type: 'done', value: 1 });
});

it('rejects a client-supplied target that differs from the server-computed scope key', async () => {
  const before = runtime.instanceCount;
  for (const forged of ['user:alice', 'user:mallory', 'page:["/src/pages/inbox/[folder]/index.ts",[]]']) {
    const intruder = inbox(forged, 'work', 'bob');
    const code = closed(intruder.socket);
    expect(await intruder.first).toMatchObject({ type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED' });
    expect(await code).toBe(1008);
  }
  expect(runtime.instanceCount).toBe(before);
});

it('keeps another page with the same scope key in its own instance', async () => {
  const before = runtime.instanceCount;
  const notes = open('/ws/', 'user:alice', '/notes', {}, 'alice');
  expect(await notes.first).toEqual({ type: 'state-update', state: { count: 0 } });
  expect(runtime.instanceCount).toBe(before + 1);
});

it('fails closed for anonymous users', async () => {
  expect((await app.request('/inbox/work', { headers: { accept: 'application/json' } })).status).toBe(401);
  const query = new URLSearchParams({ routePath: '/inbox/[folder]', pathname: '/inbox/work', params: JSON.stringify({ folder: 'work' }) });
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/user%3Aanonymous?${query}`, { headers: { origin } });
  sockets.push(socket);
  const status = await new Promise<number | undefined>(resolve => {
    socket.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    socket.once('open', () => resolve(undefined));
    socket.once('error', () => {});
  });
  expect(status).toBe(401);
});
