import { expect, it, vi } from 'vitest';
const { handlers } = vi.hoisted(() => ({ handlers: [] as any[] }));
vi.mock('hono/deno', () => ({
  serveStatic: () => async (_c: unknown, next: () => Promise<void>) => next(),
  upgradeWebSocket: (factory: () => unknown) => async () => {
    handlers.push(factory());
    return new Response();
  },
}));
import { createDenoAdapter } from '../src/index';
import { Hono } from 'hono';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function component() {
  return { _id: 'page', activeComponents: new Map(), getInitialState: () => ({ public: {} }), destroyAsync: vi.fn(async () => {}) };
}
async function connect(adapter: ReturnType<typeof createDenoAdapter>, factory: () => Promise<any>, target = 'one') {
  await adapter.handleWebSocketUpgrade!({} as any, {
    componentId: 'page', provider: 'page', target, pathname: '/', env: {}, createComponent: factory,
  });
  const events = handlers.pop();
  const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return { events, socket, open: () => events.onOpen({}, socket), close: () => events.onClose({}, socket) };
}
it('passes each verified upgrade context into a shared runtime action', async () => {
  const adapter = createDenoAdapter();
  const page = { ...component(), executeAction: vi.fn(async () => {}) };
  const pairs: { events: any; socket: any }[] = [];
  const app = new Hono();
  app.get('/ws', async c => {
    const user = { id: c.req.header('x-member')! };
    c.set('user' as never, user as never);
    await adapter.handleWebSocketUpgrade!(c, {
      componentId: 'page', provider: 'page', target: 'shared', pathname: '/', env: {}, user,
      createComponent: async () => page as any,
    });
    const events = handlers.pop();
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    pairs.push({ events, socket }); await events.onOpen({}, socket);
    return new Response();
  });
  await app.request('/ws', { headers: { 'x-member': 'first', 'x-bucket': 'one' } });
  await app.request('/ws', { headers: { 'x-member': 'second', 'x-bucket': 'two' } });
  for (const pair of pairs) await pair.events.onMessage({ data: JSON.stringify({ type: 'action', action: 'inspect', payload: [] }) }, pair.socket);
  const first = page.executeAction.mock.calls[0] as unknown as any[];
  const second = page.executeAction.mock.calls[1] as unknown as any[];
  expect(first[2]).toEqual({ id: 'first' }); expect(first[5].req.header('x-bucket')).toBe('one');
  expect(second[2]).toEqual({ id: 'second' }); expect(second[5].req.header('x-bucket')).toBe('two');
  expect(first[5]).not.toBe(second[5]);
  expect(adapter.instanceCount).toBe(1);
  await adapter.dispose();
});
it('shares pending creation and only evicts after the last connection closes', async () => {
  const adapter = createDenoAdapter({ idleTimeoutMs: 0 });
  const gate = deferred();
  const page = component();
  const factory = vi.fn(async () => { await gate.promise; return page; });
  const a = await connect(adapter, factory);
  const b = await connect(adapter, factory);
  const opened = Promise.all([a.open(), b.open()]);
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
  gate.resolve();
  await opened;
  expect(adapter.instanceCount).toBe(1);
  await a.close();
  expect(page.destroyAsync).not.toHaveBeenCalled();
  await b.close();
  expect(page.destroyAsync).toHaveBeenCalledTimes(1);
  expect(adapter.instanceCount).toBe(0);
});
it('does not register a socket closed while its component is initializing', async () => {
  const adapter = createDenoAdapter({ idleTimeoutMs: 0 });
  const gate = deferred();
  const page = component();
  const a = await connect(adapter, async () => { await gate.promise; return page; });
  const opening = a.open();
  const closing = a.close();
  gate.resolve();
  await Promise.all([opening, closing]);
  expect(a.socket.send).not.toHaveBeenCalled();
  expect(page.destroyAsync).toHaveBeenCalledTimes(1);
  expect(adapter.instanceCount).toBe(0);
});
it('awaits idle component disposal before replacing it at the limit', async () => {
  const adapter = createDenoAdapter({ maxInstances: 1 });
  const page = component();
  const disposal = deferred();
  page.destroyAsync.mockImplementation(() => disposal.promise);
  const a = await connect(adapter, async () => page);
  await a.open();
  await a.close();
  const next = component();
  const factory = vi.fn(async () => next);
  const b = await connect(adapter, factory, 'two');
  const opening = b.open();
  await vi.waitFor(() => expect(page.destroyAsync).toHaveBeenCalledTimes(1));
  expect(factory).not.toHaveBeenCalled();
  disposal.resolve();
  await opening;
  expect(factory).toHaveBeenCalledTimes(1);
  expect(adapter.instanceCount).toBe(1);
});
it('counts pending instances against capacity and permits retry after failed creation', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const adapter = createDenoAdapter({ maxInstances: 1 });
    const gate = deferred();
    const a = await connect(adapter, async () => { await gate.promise; throw new Error('init failed'); });
    const opening = a.open();
    const factory = vi.fn(async () => component());
    const b = await connect(adapter, factory, 'two');
    await b.open();
    expect(factory).not.toHaveBeenCalled();
    expect(b.socket.close).toHaveBeenCalledWith(1013, 'Runtime unavailable');
    gate.resolve();
    await opening;
    const retry = await connect(adapter, factory);
    await retry.open();
    expect(factory).toHaveBeenCalledTimes(1);
  } finally { vi.restoreAllMocks(); }
});
it('ignores late callbacks after close without creating a component', async () => {
  const adapter = createDenoAdapter();
  const factory = vi.fn(async () => component());
  const a = await connect(adapter, factory);
  await a.close();
  await a.open();
  await a.events.onMessage({ data: 'ping' }, a.socket);
  expect(factory).not.toHaveBeenCalled();
});
it('reports cleanup failures without rejecting the socket close callback', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const adapter = createDenoAdapter({ idleTimeoutMs: 0 });
    const page = component();
    page.destroyAsync.mockRejectedValue(new Error('cleanup failed'));
    const a = await connect(adapter, async () => page);
    await a.open();
    await expect(a.close()).resolves.toBeUndefined();
    expect(adapter.instanceCount).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'cossack.runtime.failure', runtime: 'deno', stage: 'runtime-cleanup', code: 'COSSACK_COMPONENT_CLEANUP_FAILED' }));
  } finally { log.mockRestore(); }
});
it('waits for an in-flight action before disposing an evicted component', async () => {
  const adapter = createDenoAdapter({ idleTimeoutMs: 0 });
  const gate = deferred();
  const page = { ...component(), executeAction: vi.fn(() => gate.promise) };
  const a = await connect(adapter, async () => page);
  await a.open();
  const message = a.events.onMessage({ data: JSON.stringify({ type: 'action', action: 'save', payload: [] }) }, a.socket);
  await vi.waitFor(() => expect(page.executeAction).toHaveBeenCalledTimes(1));
  const closing = a.close();
  await Promise.resolve();
  expect(page.destroyAsync).not.toHaveBeenCalled();
  const shutdown = adapter.dispose();
  gate.resolve();
  await Promise.all([message, closing, shutdown]);
  expect(page.destroyAsync).toHaveBeenCalledTimes(1);
});
it('closes clients and disposes exactly once, then rejects new upgrades', async () => {
  const adapter = createDenoAdapter();
  const page = component();
  const a = await connect(adapter, async () => page);
  await a.open();
  const first = adapter.dispose();
  expect(adapter.dispose()).toBe(first);
  await first;
  expect(a.socket.close).toHaveBeenCalledWith(1001, 'Runtime shutting down');
  expect(page.destroyAsync).toHaveBeenCalledTimes(1);
  expect(adapter.instanceCount).toBe(0);
  const response = await adapter.handleWebSocketUpgrade!({} as any, {} as any);
  expect(response.status).toBe(503);
  await a.events.onMessage({ data: 'ping' }, a.socket);
  expect(a.socket.send).toHaveBeenCalledTimes(1);
  await a.close();
  expect(page.destroyAsync).toHaveBeenCalledTimes(1);
});
it('waits for pending creation during disposal and never registers its socket', async () => {
  const adapter = createDenoAdapter();
  const gate = deferred();
  const page = component();
  const factory = vi.fn(async () => { await gate.promise; return page; });
  const a = await connect(adapter, factory);
  const opening = a.open();
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
  const shutdown = adapter.dispose();
  gate.resolve();
  await Promise.all([opening, shutdown]);
  expect(page.destroyAsync).toHaveBeenCalledTimes(1);
  expect(a.socket.send).not.toHaveBeenCalled();
  expect(adapter.instanceCount).toBe(0);
});
it('cleans every component even when one disposal fails', async () => {
  const adapter = createDenoAdapter();
  const one = component();
  const two = component();
  one.destroyAsync.mockRejectedValue(new Error('failure'));
  await (await connect(adapter, async () => one)).open();
  await (await connect(adapter, async () => two, 'two')).open();
  await expect(adapter.dispose()).rejects.toThrow('Deno runtime cleanup failed');
  expect(two.destroyAsync).toHaveBeenCalledTimes(1);
  expect(adapter.instanceCount).toBe(0);
});
it('ties native server shutdown and completion to adapter disposal and preserves native receivers', async () => {
  const completion = deferred();
  const server = {
    addr: { port: 1234 },
    finished: completion.promise,
    shutdown: vi.fn(async function(this: unknown) { expect(this).toBe(server); completion.resolve(); }),
  };
  vi.stubGlobal('Deno', { serve: () => server });
  try {
    const adapter = createDenoAdapter();
    const page = component();
    await (await connect(adapter, async () => page)).open();
    const managed = adapter.serve({ fetch: () => new Response() });
    expect((managed as any).addr.port).toBe(1234);
    await Promise.all([managed.shutdown!(), managed.shutdown!(), managed.finished]);
    expect(server.shutdown).toHaveBeenCalledTimes(1);
    expect(page.destroyAsync).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
it('disposes when the native server finishes without explicit shutdown', async () => {
  const completion = deferred();
  vi.stubGlobal('Deno', { serve: () => ({ finished: completion.promise }) });
  try {
    const adapter = createDenoAdapter();
    const page = component();
    await (await connect(adapter, async () => page)).open();
    const server = adapter.serve({ fetch: () => new Response() });
    completion.resolve();
    await server.finished;
    expect(page.destroyAsync).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
