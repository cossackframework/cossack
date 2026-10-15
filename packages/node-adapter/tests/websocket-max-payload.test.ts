import { createServer } from 'node:http';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_WEBSOCKET_MAX_PAYLOAD } from '../src/index';
import { createNodeAdapter } from '../src/adapter';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

/** Opens a socket, waits for the first state frame, sends `bytes` and resolves with the close code. */
async function closeCodeAfterSending(url: string, origin: string, bytes: number) {
  const socket = new WebSocket(url, { headers: { origin } });
  await new Promise((resolve, reject) => { socket.once('message', resolve); socket.once('error', reject); });
  const closed = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
  socket.on('error', () => {});
  socket.send(Buffer.alloc(bytes, 0x20));
  return closed;
}

async function guardedAdapter(maxPayload?: number) {
  const runtime = createNodeAdapter({ idleTimeoutMs: 0, ...(maxPayload ? { maxPayload } : {}) });
  const component = { _id: 'page', activeComponents: new Map(), getInitialState: () => ({ public: { count: 1 } }), destroyAsync: vi.fn(async () => {}), executeAction: vi.fn(async () => {}) };
  const app = new Hono();
  app.get('/ws/:target', c => runtime.handleWebSocketUpgrade(c, {
    target: 'user:one', componentId: 'page', createComponent: async () => component as any,
  }));
  const server = createServer();
  runtime.attach(server, request => app.fetch(request));
  const port = await listen(server);
  cleanups.push(async () => { await runtime.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { url: `ws://127.0.0.1:${port}/ws/user:one`, origin: `http://127.0.0.1:${port}` };
}

it('defaults the WebSocket frame limit to 1 MiB', () => {
  expect(DEFAULT_WEBSOCKET_MAX_PAYLOAD).toBe(1024 * 1024);
});

it('closes with 1009 when a frame exceeds the default limit', async () => {
    const { url, origin } = await guardedAdapter();
    expect(await closeCodeAfterSending(url, origin, 1024 * 1024 + 1)).toBe(1009);
  });

it('honours a configured maxPayload', async () => {
    const { url, origin } = await guardedAdapter(1024);
    expect(await closeCodeAfterSending(url, origin, 2048)).toBe(1009);
  });

it('rejects an invalid maxPayload', () => {
  expect(() => createNodeAdapter({ maxPayload: 0 })).toThrow(TypeError);
  expect(() => createNodeAdapter({ maxPayload: -1 })).toThrow(TypeError);
});
