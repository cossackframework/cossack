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
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function component() {
  return { _id: 'page', activeComponents: new Map(), getInitialState: () => ({}), destroyAsync: vi.fn(async () => {}) };
}
async function connect(adapter: ReturnType<typeof createDenoAdapter>, factory: () => Promise<any>, target = 'one') {
  await adapter.handleWebSocketUpgrade!({} as any, {
    componentId: 'page', provider: 'page', target, pathname: '/', env: {}, createComponent: factory,
  });
  const events = handlers.pop();
  const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return { events, socket, open: () => events.onOpen({}, socket), close: () => events.onClose({}, socket) };
}
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
    expect(log).toHaveBeenCalledWith('[Cossack] Deno WebSocket cleanup failed:', expect.any(Error));
  } finally { log.mockRestore(); }
});
