/// <reference lib="dom" />

// Core's Durable Object declarations share the public entry point with the
// process adapters. The smoke test only needs the global name to exist.
declare global {
  interface DurableObjectState {}
}

import { Hono } from 'hono';
import { createDenoAdapter } from '../src/index.ts';

Deno.test('serves HTTP and upgrades a real WebSocket', async () => {
  let action: { name: string; payload: unknown[]; user: unknown } | undefined;
  let resolveAction!: () => void;
  const actionReceived = new Promise<void>((resolve) => { resolveAction = resolve; });
  const component = {
    _id: 'root',
    activeComponents: new Map(),
    getInitialState: () => ({ public: { count: 0 } }),
    executeAction: async (name: string, payload: unknown[], user: unknown) => {
      action = { name, payload, user };
      resolveAction();
    },
  };

  const adapter = createDenoAdapter({ port: 0, assetsRoot: './missing' });
  const app = new Hono();
  app.get('/health', (c) => c.text('ok'));
  app.get('/ws', (c) => adapter.handleWebSocketUpgrade!(c, {
    target: 'scope', provider: 'page', componentId: 'counter', pathname: '/',
    user: { id: 'smoke-user' }, env: {}, createComponent: async () => component as any,
  }));

  const server = adapter.serve(app) as any;
  const port = server.addr.port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (await response.text() !== 'ok') throw new Error('HTTP smoke response mismatch');

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.onerror = () => reject(new Error('WebSocket smoke connection failed'));
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'state-update') return;
        socket.send(JSON.stringify({ type: 'action', action: 'increment', payload: [2] }));
        resolve();
      };
    });
    await actionReceived;
    if (action?.name !== 'increment' || action.payload[0] !== 2 ||
        (action.user as any)?.id !== 'smoke-user') {
      throw new Error('WebSocket action dispatch mismatch');
    }
    socket.close();
  } finally {
    await server.shutdown();
  }
});

Deno.test('closes the socket when a WebSocket action fails', async () => {
  const component = {
    _id: 'root',
    activeComponents: new Map(),
    getInitialState: () => ({ public: {} }),
    executeAction: async () => { throw new Error('action failed'); },
  };
  const adapter = createDenoAdapter({ port: 0, assetsRoot: './missing' });
  const app = new Hono();
  app.get('/ws', (c) => adapter.handleWebSocketUpgrade!(c, {
    target: 'scope', provider: 'page', componentId: 'counter', pathname: '/',
    user: undefined, env: {}, createComponent: async () => component as any,
  }));

  const server = adapter.serve(app) as any;
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.addr.port}/ws`);
    const closed = new Promise<CloseEvent>((resolve, reject) => {
      socket.onerror = () => reject(new Error('WebSocket failure test could not connect'));
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'state-update') {
          socket.send(JSON.stringify({ type: 'action', action: 'fail', payload: [] }));
        }
      };
      socket.onclose = resolve;
    });
    const event = await closed;
    if (event.code !== 1013 || event.reason !== 'Runtime unavailable') {
      throw new Error(`Unexpected WebSocket close: ${event.code} ${event.reason}`);
    }
  } finally {
    await server.shutdown();
  }
});
