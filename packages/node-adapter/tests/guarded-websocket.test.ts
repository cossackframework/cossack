import { createServer } from 'node:http';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { createNodeAdapter } from '../src/adapter';
import { Cossack, Page, Server, State, RateLimit, InMemoryRateLimitStore, setRateLimitStore, isOriginAllowed } from '@cossackframework/core';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
function page() {
  return { _id: 'page', activeComponents: new Map(), getInitialState: () => ({ public: { count: 1 } }), destroyAsync: vi.fn(async () => {}), executeAction: vi.fn(async (..._args: unknown[]) => {}) };
}
async function host(configure: (app: Hono, runtime: ReturnType<typeof createNodeAdapter>) => void) {
  const runtime = createNodeAdapter({ idleTimeoutMs: 0 });
  const app = new Hono();
  configure(app, runtime);
  const server = createServer();
  runtime.attach(server, request => app.fetch(request));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  cleanups.push(async () => { await runtime.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { runtime, url: `ws://127.0.0.1:${port}/ws/user:one` };
}
function upgrade(runtime: ReturnType<typeof createNodeAdapter>, component: ReturnType<typeof page>) {
  return (c: any) => runtime.handleWebSocketUpgrade(c, {
    target: 'user:one', componentId: 'page', user: c.get('user'), createComponent: async () => component as any,
  });
}
function connected(url: string, headers: Record<string, string> = {}) {
  const socket = new WebSocket(url, { headers });
  const state = new Promise<any>((resolve, reject) => { socket.once('message', data => resolve(JSON.parse(String(data)))); socket.once('error', reject); });
  return { socket, state };
}
it('keeps each peer context for real shared-component actions and custom rate keys', async () => {
  setRateLimitStore(new InMemoryRateLimitStore());
  class Peer extends Cossack {
    count = 0;
    render() { return null as any; }
    inspect() { return { user: this.user?.id, contextUser: this.c.get('user')?.id, bucket: this.c.req.header('x-bucket') }; }
    limited() { return ++this.count; }
  }
  State()(Peer.prototype, 'count');
  Page({ transport: 'websocket', scope: () => 'shared' })(Peer);
  for (const name of ['inspect', 'limited']) Server()(Peer.prototype, name, Object.getOwnPropertyDescriptor(Peer.prototype, name)!);
  RateLimit({ max: 1, window: 60_000, key: c => c.req.header('x-bucket')! })(Peer.prototype, 'limited', Object.getOwnPropertyDescriptor(Peer.prototype, 'limited')!);
  const component = new Peer();
  const { url, runtime } = await host((app, runtime) => {
    app.use('*', async (c, next) => { c.set('user' as never, { id: c.req.header('x-member') } as never); await next(); });
    app.get('/ws/:target', c => runtime.handleWebSocketUpgrade(c, {
      target: 'shared', componentId: 'peer', user: c.get('user'),
      createComponent: async () => {
        await component.bootstrap({ context: c, env: {}, user: c.get('user'), page: '/peer',
          runtime: { platform: 'web', adapter: 'node' } });
        return component;
      },
    }));
  });
  const a = connected(url, { 'x-member': 'first', 'x-bucket': 'one' });
  const b = connected(url, { 'x-member': 'second', 'x-bucket': 'two' });
  await Promise.all([a.state, b.state]);
  const call = (socket: WebSocket, action: string) => new Promise<any>(resolve => {
    const requestId = crypto.randomUUID();
    const listener = (data: any) => {
      const frame = JSON.parse(String(data));
      if (frame.requestId !== requestId) return;
      socket.off('message', listener); resolve(frame);
    };
    socket.on('message', listener);
    socket.send(JSON.stringify({ type: 'action', action, payload: [], requestId, user: { id: 'forged' } }));
  });
  expect((await call(a.socket, 'inspect')).value).toEqual({ user: 'first', contextUser: 'first', bucket: 'one' });
  expect((await call(b.socket, 'inspect')).value).toEqual({ user: 'second', contextUser: 'second', bucket: 'two' });
  expect((await call(a.socket, 'limited')).type).toBe('done');
  expect((await call(b.socket, 'limited')).type).toBe('done');
  expect(await call(b.socket, 'limited')).toMatchObject({ type: 'error', code: 'COSSACK_RPC_RATE_LIMITED' });
  expect(component.count).toBe(2);
  expect(runtime.instanceCount).toBe(1);
});
it('runs middleware before and after routing, forwards handshake cookies, and dispatches authenticated actions', async () => {
  const component = page();
  const { url, runtime } = await host((app, runtime) => {
    app.use('*', async (c, next) => {
      c.set('user' as never, { id: 'trusted' } as never);
      await next();
      c.header('set-cookie', 'session=refreshed; HttpOnly', { append: true });
      c.header('set-cookie', 'flash=done', { append: true });
    });
    app.get('/ws/:target', upgrade(runtime, component));
  });
  const { socket, state } = connected(url);
  const headers = new Promise<any>(resolve => socket.once('upgrade', response => resolve(response.headers)));
  expect(await state).toEqual({ type: 'state-update', state: { count: 1 } });
  expect((await headers)['set-cookie']).toEqual(['session=refreshed; HttpOnly', 'flash=done']);
  socket.send(JSON.stringify({ type: 'action', action: 'save', payload: [1] }));
  await vi.waitFor(() => expect(component.executeAction).toHaveBeenCalled());
  expect(component.executeAction.mock.calls[0]?.[2]).toEqual({ id: 'trusted' });
  await runtime.dispose();
  expect(component.destroyAsync).toHaveBeenCalledTimes(1);
});
it.each(['before', 'after'])('rejects middleware denial %s the guarded handler without creating a component', async phase => {
  const component = page();
  const factory = vi.fn(async () => component as any);
  const { url } = await host((app, runtime) => {
    app.use('*', async (c, next) => { if (phase === 'after') await next(); c.res = c.text('Denied', 401); return c.res; });
    app.get('/ws/:target', c => runtime.handleWebSocketUpgrade(c, { target: 'one', componentId: 'page', createComponent: factory }));
  });
  const socket = new WebSocket(url);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); socket.terminate(); });
    socket.on('error', () => {});
    socket.once('open', () => reject(new Error('Unauthorized socket opened')));
  });
  expect(status).toBe(401);
  expect(factory).not.toHaveBeenCalled();
});
it('shares one pending scope initialization across actual simultaneous connections', async () => {
  const component = page();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const factory = vi.fn(async () => { await gate; return component as any; });
  const { url, runtime } = await host((app, runtime) => {
    app.get('/ws/:target', c => runtime.handleWebSocketUpgrade(c, { target: 'one', componentId: 'page', createComponent: factory }));
  });
  const a = connected(url); const b = connected(url);
  await Promise.all([new Promise(resolve => a.socket.once('open', resolve)), new Promise(resolve => b.socket.once('open', resolve))]);
  expect(factory).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([a.state, b.state]);
  expect(runtime.instanceCount).toBe(1);
  a.socket.close();
  await new Promise(resolve => a.socket.once('close', resolve));
  expect(component.destroyAsync).not.toHaveBeenCalled();
  b.socket.close();
  await vi.waitFor(() => expect(component.destroyAsync).toHaveBeenCalledTimes(1));
});
it('waits for a running action during shutdown', async () => {
  const component = page();
  let release!: () => void;
  component.executeAction.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const { url, runtime } = await host((app, runtime) => app.get('/ws/:target', upgrade(runtime, component)));
  const { socket, state } = connected(url);
  await state;
  socket.send(JSON.stringify({ type: 'action', action: 'save', payload: [] }));
  await vi.waitFor(() => expect(component.executeAction).toHaveBeenCalled());
  const disposal = runtime.dispose();
  await Promise.resolve();
  expect(component.destroyAsync).not.toHaveBeenCalled();
  release();
  await disposal;
  expect(component.destroyAsync).toHaveBeenCalledTimes(1);
});
it('reconstructs an https request URL for upgrades on an encrypted socket so same-origin checks pass', async () => {
  const component = page();
  const seen: string[] = [];
  const runtime = createNodeAdapter({ idleTimeoutMs: 0 });
  const app = new Hono();
  // Mirrors the framework's upgrade route: same-origin against the request URL.
  app.get('/ws/:target', c => {
    seen.push(c.req.url);
    if (!isOriginAllowed(c.req.header('origin'), c.req.url)) return c.text('Forbidden origin', 403);
    return upgrade(runtime, component)(c);
  });
  const server = createServer();
  // Stand in for a TLS listener: node:https sockets are TLSSockets with `encrypted: true`.
  server.on('connection', socket => { (socket as { encrypted?: boolean }).encrypted = true; });
  runtime.attach(server, request => app.fetch(request));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  cleanups.push(async () => { await runtime.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const { socket, state } = connected(`ws://127.0.0.1:${port}/ws/user:one`, { origin: `https://127.0.0.1:${port}` });
  expect(await state).toEqual({ type: 'state-update', state: { count: 1 } });
  expect(seen).toEqual([`https://127.0.0.1:${port}/ws/user:one`]);
  socket.close();
});
it('counts pending initializations against maxInstances and rejects the overflow scope', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = page();
  const factories = { first: vi.fn(async () => { await gate; return first as any; }), second: vi.fn(async () => page() as any) };
  const runtime = createNodeAdapter({ maxInstances: 1, idleTimeoutMs: 0 });
  const app = new Hono();
  app.get('/ws/:target', c => {
    const target = c.req.param('target') as 'first' | 'second';
    return runtime.handleWebSocketUpgrade(c, { target, componentId: target, createComponent: factories[target] });
  });
  const server = createServer();
  runtime.attach(server, request => app.fetch(request));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  cleanups.push(async () => { release(); await runtime.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); spy.mockRestore(); });
  const a = connected(`ws://127.0.0.1:${port}/ws/first`);
  await vi.waitFor(() => expect(factories.first).toHaveBeenCalledTimes(1));
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws/second`);
  const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
    b.once('error', reject); b.once('close', (code, reason) => resolve({ code, reason: String(reason) }));
  });
  expect(closed).toEqual({ code: 1013, reason: 'Runtime unavailable' });
  expect(factories.second).not.toHaveBeenCalled();
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'node', stage: 'initialization' }));
  release();
  expect(await a.state).toEqual({ type: 'state-update', state: { count: 1 } });
  a.socket.close();
});
it('keys one in-process instance by component and server-computed target', async () => {
  const created: string[] = [];
  const { url, runtime } = await host((app, runtime) => app.get('/ws/:target', c => {
    const target = c.req.param('target');
    const componentId = c.req.query('component') ?? 'inbox';
    return runtime.handleWebSocketUpgrade(c, { target, componentId,
      createComponent: async () => { created.push(`${componentId}:${target}`); return page() as any; } });
  }));
  const base = url.replace(/\/ws\/.*$/, '/ws/');
  const open = async (path: string) => { const peer = connected(base + path); await peer.state; return peer.socket; };
  const sockets = [
    await open('user:alice'), await open('user:alice'),
    await open('user:bob'), await open('user:alice?component=notes'),
  ];
  // The same target shares one instance; another target or page gets its own.
  expect(created).toEqual(['inbox:user:alice', 'inbox:user:bob', 'notes:user:alice']);
  expect(runtime.instanceCount).toBe(3);
  for (const socket of sockets) socket.close();
});
