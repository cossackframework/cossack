import { createServer } from 'node:http';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { createNodeAdapter } from '../src/adapter';
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
  return { runtime, url: `ws://127.0.0.1:${port}/ws/page/user:one` };
}
function upgrade(runtime: ReturnType<typeof createNodeAdapter>, component: ReturnType<typeof page>) {
  return (c: any) => runtime.handleWebSocketUpgrade(c, {
    target: 'user:one', provider: 'page', componentId: 'page', user: c.get('user'), createComponent: async () => component as any,
  });
}
function connected(url: string) {
  const socket = new WebSocket(url);
  const state = new Promise<any>((resolve, reject) => { socket.once('message', data => resolve(JSON.parse(String(data)))); socket.once('error', reject); });
  return { socket, state };
}
it('runs middleware before and after routing, forwards handshake cookies, and dispatches authenticated actions', async () => {
  const component = page();
  const { url, runtime } = await host((app, runtime) => {
    app.use('*', async (c, next) => {
      c.set('user' as never, { id: 'trusted' } as never);
      await next();
      c.header('set-cookie', 'session=refreshed; HttpOnly', { append: true });
      c.header('set-cookie', 'flash=done', { append: true });
    });
    app.get('/ws/:provider/:target', upgrade(runtime, component));
  });
  const { socket, state } = connected(url);
  const headers = new Promise<any>(resolve => socket.once('upgrade', response => resolve(response.headers)));
  expect(await state).toEqual({ type: 'state-update', state: { public: { count: 1 } } });
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
    app.get('/ws/:provider/:target', c => runtime.handleWebSocketUpgrade(c, { target: 'one', provider: 'page', componentId: 'page', createComponent: factory }));
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
    app.get('/ws/:provider/:target', c => runtime.handleWebSocketUpgrade(c, { target: 'one', provider: 'page', componentId: 'page', createComponent: factory }));
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
  const { url, runtime } = await host((app, runtime) => app.get('/ws/:provider/:target', upgrade(runtime, component)));
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
