import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createServerHotChannel, type NormalizedServerHotChannel } from 'vite';
import { connectDenoDevelopmentEvents } from '../src/development-events';

let server: ReturnType<typeof createServer>;
let channel: ReturnType<typeof createServerHotChannel>;
let closeEvents: () => Promise<void>;
let origin: string;
let token: string;
const clients: WebSocket[] = [];
beforeEach(async () => {
  server = createServer();
  channel = createServerHotChannel();
  token = randomUUID();
  closeEvents = connectDenoDevelopmentEvents(server, channel as NormalizedServerHotChannel, token);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  origin = `ws://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await closeEvents();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await channel.close();
});
function connect(path = '/events', protocol = `cossack-deno-${token}`) {
  const client = new WebSocket(origin + path, protocol);
  client.on('error', () => {});
  clients.push(client);
  return client;
}

it.each([
  ['/events', 'wrong-token'],
  ['/other', 'valid-token'],
])('rejects unauthorized runner upgrades (%s, %s)', async (path, credential) => {
  const client = connect(path, credential === 'valid-token' ? `cossack-deno-${token}` : credential);
  const [, response] = await once(client, 'unexpected-response');
  expect(response.statusCode).toBe(403);
  response.resume();
  client.terminate();
  expect(channel.api!.outsideEmitter.listenerCount('send')).toBe(0);
});

it('delivers custom events and acknowledgements, tolerates pings and releases runner listeners', async () => {
  channel.on('evidence', (data, client) => client.send({ type: 'custom', event: 'ack', data }));
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = connect();
    const connected = once(client, 'message');
    await once(client, 'open');
    expect(JSON.parse(String((await connected)[0]))).toEqual({ type: 'connected' });
    expect(channel.api!.outsideEmitter.listenerCount('send')).toBe(1);
    // Source edits replace the child. Reload/update frames must not evaluate it twice.
    channel.send({ type: 'full-reload' });
    channel.send({ type: 'update', updates: [] });
    const reply = once(client, 'message');
    client.send(JSON.stringify({ type: 'ping' }));
    client.send(JSON.stringify({ type: 'custom', event: 'evidence', data: { dispatchId: 'opaque' } }));
    expect(JSON.parse(String((await reply)[0]))).toEqual({
      type: 'custom',
      event: 'ack',
      data: { dispatchId: 'opaque' },
    });
    const closed = once(client, 'close');
    client.close();
    await closed;
    await expect.poll(() => channel.api!.outsideEmitter.listenerCount('send')).toBe(0);
  }
});

it.each(['not-json', '{"type":"custom","event":1}', 'x'.repeat(65537)])(
  'closes malformed or oversized runner messages (%#)',
  async (payload) => {
    const client = connect();
    const connected = once(client, 'message');
    await once(client, 'open');
    expect(JSON.parse(String((await connected)[0]))).toEqual({ type: 'connected' });
    const closed = once(client, 'close');
    client.send(payload);
    expect((await closed)[0]).toBe(payload.length > 65536 ? 1009 : 1008);
    await expect.poll(() => channel.api!.outsideEmitter.listenerCount('send')).toBe(0);
  },
);
