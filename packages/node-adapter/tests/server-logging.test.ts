import 'reflect-metadata';
import { createServer } from 'node:http';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { createNodeAdapter } from '../src/adapter';
const SENTINEL = 'PRIVATE_ADAPTER_EXCEPTION_SENTINEL';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
  vi.restoreAllMocks();
});
function logs() { return vi.spyOn(console, 'error').mockImplementation(() => {}); }
function assertSafe(spy: ReturnType<typeof logs>, stages: string[]) {
  const entries = spy.mock.calls.flat();
  for (const stage of stages) expect(entries).toContainEqual(expect.objectContaining({ event: 'cossack.runtime.failure', runtime: 'node', stage }));
  expect(JSON.stringify(entries)).not.toMatch(/PRIVATE_ADAPTER_EXCEPTION_SENTINEL|PRIVATE_QUERY_SENTINEL|PRIVATE_SCOPE_SENTINEL|PRIVATE_USER_SENTINEL|PRIVATE_FRAME_SENTINEL|PRIVATE_REQUEST_ID_SENTINEL/);
  for (const entry of entries) {
    expect(entry).not.toBeInstanceOf(Error);
    expect(entry).toMatchObject({ route: 'unknown', action: 'unknown', component: 'unknown', requestId: 'unavailable' });
  }
}
async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
function closed(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve, reject) => {
    socket.once('error', reject); socket.once('close', (code, reason) => resolve({ code, reason: String(reason) }));
  });
}
async function guarded(component: any, options: { createFails?: boolean } = {}) {
  const adapter = createNodeAdapter({ idleTimeoutMs: 0 }); const app = new Hono();
  app.get('/ws/:provider/:target', c => adapter.handleWebSocketUpgrade(c, {
    target: 'PRIVATE_SCOPE_SENTINEL', provider: 'page', componentId: 'authored', user: { id: 'PRIVATE_USER_SENTINEL' },
    createComponent: async () => { if (options.createFails) throw new Error(SENTINEL); return component; },
  }));
  const server = createServer(); adapter.attach(server, request => app.fetch(request));
  const origin = await listen(server);
  cleanups.unshift(() => adapter.dispose().catch(() => {}));
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/page/PRIVATE_SCOPE_SENTINEL?token=PRIVATE_QUERY_SENTINEL');
  return { adapter, socket };
}
function component() { return { _id: 'authored', activeComponents: new Map(), getInitialState: () => ({ public: {} }), executeAction: vi.fn(async () => {}), destroyAsync: vi.fn(async () => {}) }; }
it('redacts guarded bootstrap failures and closes with a static reason', async () => {
  const spy = logs(); const { socket } = await guarded(component(), { createFails: true });
  expect(await closed(socket)).toEqual({ code: 1013, reason: 'Runtime unavailable' });
  assertSafe(spy, ['initialization']);
});
it('drops malformed guarded frames without exposing parser excerpts and can still dispatch the next frame', async () => {
  const spy = logs(); const page = component(); const { socket } = await guarded(page);
  await new Promise<void>((resolve, reject) => { socket.once('message', () => resolve()); socket.once('error', reject); });
  socket.send('PRIVATE_FRAME_SENTINEL{"token":"' + SENTINEL + '"');
  await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  assertSafe(spy, ['dispatch']);
  socket.send(JSON.stringify({ type: 'action', action: 'save', payload: [], requestId: 'PRIVATE_REQUEST_ID_SENTINEL' }));
  await vi.waitFor(() => expect(page.executeAction).toHaveBeenCalled());
  expect(socket.readyState).toBe(WebSocket.OPEN);
  const closing = closed(socket); socket.close(); await closing;
});
it('redacts guarded action and component cleanup failures while retiring the peer', async () => {
  const spy = logs(); const page = component();
  page.executeAction.mockRejectedValue(new Error(SENTINEL)); page.destroyAsync.mockRejectedValue(new Error(SENTINEL));
  const { socket } = await guarded(page);
  await new Promise<void>((resolve, reject) => { socket.once('message', () => resolve()); socket.once('error', reject); });
  const closing = closed(socket);
  socket.send(JSON.stringify({ type: 'action', action: 'save', payload: [], requestId: 'PRIVATE_REQUEST_ID_SENTINEL' }));
  expect(await closing).toEqual({ code: 1013, reason: 'Runtime unavailable' });
  await vi.waitFor(() => expect(page.destroyAsync).toHaveBeenCalled());
  await vi.waitFor(() => assertSafe(spy, ['dispatch', 'runtime-cleanup']));
});
it('redacts guarded HTTP upgrade failures instead of logging thrown request details', async () => {
  const spy = logs(); const adapter = createNodeAdapter(); const server = createServer();
  adapter.attach(server, () => { throw new Error(SENTINEL); });
  const origin = await listen(server); cleanups.unshift(() => adapter.dispose().catch(() => {}));
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/page/PRIVATE_SCOPE_SENTINEL?token=PRIVATE_QUERY_SENTINEL');
  await new Promise<void>(resolve => { socket.once('error', () => resolve()); });
  await vi.waitFor(() => assertSafe(spy, ['upgrade']));
});
