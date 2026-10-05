import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), proxy: { on: vi.fn(), web: vi.fn(), ws: vi.fn(), close: vi.fn() } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('http-proxy-3', () => ({ createProxyServer: () => mocks.proxy }));
import { cossackDeno } from '../src/vite';
let middleware: any; let server: any; let plugin: any; let control: string; let token: string;
let failStartup = false; let close: (() => Promise<void>) | undefined;
const secret = () => Object.assign(new Error('SECRET_MESSAGE'), { stack: 'SECRET_STACK', cause: 'SECRET_CAUSE' });
beforeEach(async () => {
  vi.clearAllMocks(); failStartup = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.spawn.mockImplementation((_exe, _args, options) => {
    const settings = JSON.parse(options.env.COSSACK_DENO_DEVELOPMENT); control = settings.control; token = settings.token;
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn(() => { queueMicrotask(() => child.emit('close')); return true; }) });
    queueMicrotask(() => {
      if (failStartup) child.emit('error', secret());
      else void fetch(control + '/ready', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ id: settings.id, port: 12345 }) });
    });
    return child;
  });
  server = { config: { root: process.cwd(), mode: 'development', envDir: process.cwd(), logger: { error: vi.fn(), warn: vi.fn() }, server: {} }, httpServer: new EventEmitter(), middlewares: { use: (handler: any) => { middleware = handler; } }, environments: { ssr: { hot: { handleInvoke: vi.fn() }, moduleGraph: { invalidateAll: vi.fn() } } } };
  plugin = cossackDeno({ startupTimeoutMs: 1000, shutdownTimeoutMs: 1000 }) as any;
  const install = await plugin.configureServer(server); install(); close = () => plugin.closeBundle();
});
afterEach(async () => { await close?.(); close = undefined; vi.restoreAllMocks(); });
async function request() {
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const response = { destroyed: false, headersSent: false, writeHead: vi.fn(), end: vi.fn(() => finish()), destroy: vi.fn(() => finish()) };
  const incoming = { url: '/SECRET_PATH?token=SECRET_QUERY', headers: { host: 'localhost' }, socket: {} };
  const next = vi.fn(); middleware(incoming, response, next); await finished; return { response, next };
}
function safe() { expect(JSON.stringify([vi.mocked(console.error).mock.calls, server.config.logger.error.mock.calls])).not.toContain('SECRET'); }
it('sanitizes startup failure before middleware or Vite error rendering', async () => {
  failStartup = true;
  const result = await request(); expect(result.response.writeHead).toHaveBeenCalledWith(500); expect(result.next).not.toHaveBeenCalled(); safe();
});
it('preserves upstream failure status and exposes no proxy exception', async () => {
  mocks.proxy.web.mockImplementation((_req, _res, _opts, callback) => callback(secret()));
  const result = await request(); expect(result.response.writeHead).toHaveBeenCalledWith(502); expect(result.next).not.toHaveBeenCalled(); safe();
});
it('keeps authenticated compiler result transport and sanitizes thrown invoke failures', async () => {
  mocks.proxy.web.mockImplementation((_req, res) => res.end()); await request();
  const invoke = server.environments.ssr.hot.handleInvoke;
  const compiler = { error: { code: 'COMPILER_PARSE', message: 'Compiler syntax diagnostic', loc: { line: 2 } } };
  invoke.mockResolvedValueOnce(compiler);
  const options = { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{}' };
  expect(await (await fetch(control + '/invoke', options)).json()).toEqual(compiler);
  invoke.mockRejectedValueOnce(secret()); expect((await fetch(control + '/invoke', options)).status).toBe(500); safe();
});
it('sanitizes websocket startup and hot reload failures while permitting recovery', async () => {
  failStartup = true;
  const socket = Object.assign(new EventEmitter(), { destroyed: false, destroy: vi.fn() });
  server.httpServer.emit('upgrade', { url: '/ws/SECRET_SOCKET' }, socket, Buffer.alloc(0));
  await vi.waitFor(() => expect(socket.destroy).toHaveBeenCalled()); safe();
  await plugin.hotUpdate.handler.call({ environment: { name: 'ssr' } }, { file: process.cwd() + '/src/index.ts', modules: [{}], read: async () => '', type: 'update', server });
  safe(); expect(server.environments.ssr.moduleGraph.invalidateAll).toHaveBeenCalled();
  failStartup = false; mocks.proxy.web.mockImplementation((_req, res) => res.end());
  const result = await request(); expect(result.response.writeHead).not.toHaveBeenCalled();
});
