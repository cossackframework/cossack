import { afterEach, expect, it, vi } from 'vitest';
const { handlers } = vi.hoisted(() => ({ handlers: [] as any[] }));
vi.mock('hono/deno', () => ({
  serveStatic: () => async (_c: unknown, next: () => Promise<void>) => next(),
  upgradeWebSocket: (factory: () => unknown) => async () => { handlers.push(factory()); return new Response(); },
}));
import { createDenoAdapter } from '../src/index';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); handlers.length = 0; });
const secret = () => Object.assign(new Error('SECRET_MESSAGE'), { stack: 'SECRET_STACK', cause: new Error('SECRET_CAUSE'), credentials: 'SECRET_VALUE' });
async function connection(adapter: ReturnType<typeof createDenoAdapter>, createComponent: () => Promise<any>) {
  await adapter.handleWebSocketUpgrade!({} as any, { componentId: 'page', provider: 'page', target: 'SECRET_TARGET', pathname: '/SECRET_PATH', env: {}, createComponent });
  const events = handlers.pop(); const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return { events, socket };
}
function safeLogs(log: ReturnType<typeof vi.spyOn>, stage: string) {
  expect(log.mock.calls).toContainEqual([expect.objectContaining({ event: 'cossack.runtime.failure', runtime: 'deno', stage })]);
  expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
}
it('redacts upgrade and repeated dispatch failures while preserving unavailable closure', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const adapter = createDenoAdapter(); const pair = await connection(adapter, async () => { throw secret(); });
  await pair.events.onOpen({}, pair.socket); safeLogs(log, 'upgrade');
  await pair.events.onMessage({ data: 'SECRET_PAYLOAD' }, pair.socket); safeLogs(log, 'dispatch');
  expect(pair.socket.close).toHaveBeenCalledWith(1013, 'Runtime unavailable');
  await adapter.dispose();
});
it('redacts malformed socket input and cleanup failures without logging targets', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const adapter = createDenoAdapter({ idleTimeoutMs: 0 });
  const page = { _id: 'page', activeComponents: new Map(), getInitialState: () => ({ public: {} }), destroyAsync: async () => { throw secret(); } };
  const pair = await connection(adapter, async () => page);
  await pair.events.onOpen({}, pair.socket);
  await pair.events.onMessage({ data: 'SECRET_INVALID_JSON' }, pair.socket);
  safeLogs(log, 'dispatch');
  await pair.events.onClose({}, pair.socket); safeLogs(log, 'runtime-cleanup');
  await adapter.dispose();
});
it('observes and redacts background server termination failures', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let reject!: (error: unknown) => void;
  const finished = new Promise<void>((_resolve, fail) => { reject = fail; });
  vi.stubGlobal('Deno', { serve: () => ({ finished, shutdown: vi.fn() }) });
  const adapter = createDenoAdapter(); const server = adapter.serve!({ fetch: async () => new Response() });
  reject(secret());
  await expect(server.finished).rejects.toThrow();
  await vi.waitFor(() => safeLogs(log, 'runtime-cleanup'));
});
