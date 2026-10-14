import { createServer } from 'node:http';
import { connect } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, expect, it } from 'vitest';
import { createNodeAdapter, type NodeAdapterOptions } from '../src/adapter';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });

async function host(options: NodeAdapterOptions = {}, configure?: (server: ReturnType<typeof createServer>) => void) {
  const runtime = createNodeAdapter(options);
  const server = createServer();
  // Upgraded sockets leave the HTTP server's tracking; destroy leftovers explicitly.
  const connections = new Set<import('node:net').Socket>();
  server.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  runtime.attach(server, () => new Response('unused', { status: 404 }));
  configure?.(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  cleanups.push(async () => {
    await runtime.dispose();
    for (const socket of connections) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return port;
}

/** Sends a raw upgrade request and resolves with what the server wrote before closing, or 'open' if it stays open. */
function rawUpgrade(port: number, path: string, waitMs = 500) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    const timer = setTimeout(() => { socket.destroy(); resolve('open'); }, waitMs);
    socket.on('data', chunk => { received += chunk.toString(); });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); resolve(received); });
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n`
      + 'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  });
}

it('rejects upgrades outside /ws/ with 404 when it is the only upgrade listener', async () => {
  const port = await host();
  const response = await rawUpgrade(port, '/other');
  expect(response).toMatch(/^HTTP\/1\.1 404 Not Found\r\n/);
});

it('leaves upgrades outside /ws/ to another listener such as Vite HMR', async () => {
  const hmr = new WebSocketServer({ noServer: true });
  cleanups.push(async () => { hmr.close(); });
  const port = await host({}, server => server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/__hmr')) hmr.handleUpgrade(request, socket, head, ws => ws.send('hmr-connected'));
  }));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/__hmr`);
  const message = await new Promise<string>((resolve, reject) => {
    socket.once('message', data => resolve(String(data)));
    socket.once('error', reject);
  });
  expect(message).toBe('hmr-connected');
  socket.close();
});

it('rejects unmatched upgrades even beside another listener when destroyUnmatchedUpgrades is true', async () => {
  const port = await host({ destroyUnmatchedUpgrades: true }, server => server.on('upgrade', () => {}));
  expect(await rawUpgrade(port, '/other')).toMatch(/^HTTP\/1\.1 404 Not Found\r\n/);
});

it('leaves unmatched upgrades untouched when destroyUnmatchedUpgrades is false', async () => {
  const port = await host({ destroyUnmatchedUpgrades: false });
  expect(await rawUpgrade(port, '/other', 200)).toBe('open');
});
