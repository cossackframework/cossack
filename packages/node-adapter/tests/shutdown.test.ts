import { it, expect } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { installNodeShutdown } from '../src/shutdown';

it('drains accepted HTTP work and cleanup exactly once while closing admission', async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const work = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (_request, response) => { entered(); await work; response.end('complete'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let cleaned = 0;
  const control = installNodeShutdown(server, { timeoutMs: 2000, dispose: async () => { cleaned++; } });
  const response = fetch(`http://127.0.0.1:${(server.address() as any).port}`);
  await waiting;
  const draining = control.shutdown(); expect(control.shutdown()).toBe(draining);
  expect(server.listening).toBe(false);
  release(); expect(await (await response).text()).toBe('complete');
  expect(await draining).toEqual({ forced: false, cleanupCompleted: true, cleanupFailed: false });
  expect(cleaned).toBe(1);
});

it('bounds uncooperative HTTP and cleanup without claiming they completed', async () => {
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const server = createServer(() => entered());
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const control = installNodeShutdown(server, { timeoutMs: 50, dispose: () => new Promise<void>(() => {}) });
  const client = request(`http://127.0.0.1:${(server.address() as any).port}`);
  const failure = new Promise<void>(resolve => client.on('error', () => resolve())); client.end();
  await waiting;
  expect(await control.shutdown()).toEqual({ forced: true, cleanupCompleted: false, cleanupFailed: false });
  await failure;
});

it('records cleanup failures without exposing exceptions or leaking signal listeners', async () => {
  const listeners = process.listenerCount('SIGTERM');
  const server = createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const control = installNodeShutdown(server,{dispose:async()=>{throw new Error('private');}});
  expect(await control.shutdown()).toEqual({forced:false,cleanupCompleted:true,cleanupFailed:true});
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
  expect(() => installNodeShutdown(server,{timeoutMs:0,dispose:async()=>{}})).toThrow(TypeError);
});

it('destroys upgraded sockets at the deadline and completes only once', async () => {
  const {connect} = await import('node:net');
  const server = createServer();
  let upgraded!: () => void;
  const ready = new Promise<void>(resolve => { upgraded = resolve; });
  server.on('upgrade', (_request, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');upgraded(); });
  let completed = 0;
  const control = installNodeShutdown(server,{timeoutMs:50,dispose:async()=>{},onComplete:()=>{completed++;}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const socket=connect((server.address() as any).port,'127.0.0.1');socket.resume();
  const closed=once(socket,'close');
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');
  await ready;
  expect(await control.shutdown()).toEqual({forced:true,cleanupCompleted:true,cleanupFailed:false});
  await closed;await control.shutdown();expect(completed).toBe(1);
});

it('sends HTTP/2 GOAWAY and drains accepted streams before closing sessions', async () => {
  const {createServer: createHttp2Server, connect} = await import('node:http2');
  let entered!:()=>void, release!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const work=new Promise<void>(resolve=>{release=resolve;});
  const server=createHttp2Server();
  server.on('stream',async stream=>{entered();await work;stream.respond({':status':200});stream.end('complete');});
  const control=installNodeShutdown(server,{timeoutMs:2000,dispose:async()=>{}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=connect(`http://127.0.0.1:${(server.address() as any).port}`);
  const stream=client.request({':path':'/'});let body='';stream.on('data',chunk=>{body+=chunk;});
  const finished=once(stream,'end'),goaway=once(client,'goaway');stream.end();await waiting;
  const closing=control.shutdown();await goaway;release();await finished;
  expect(body).toBe('complete');expect(await closing).toEqual({forced:false,cleanupCompleted:true,cleanupFailed:false});
  client.destroy();
});
