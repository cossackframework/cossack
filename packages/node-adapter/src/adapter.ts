import { WebSocket, WebSocketServer } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Context } from 'hono';
import { InMemoryWebSocketRuntime, type Cossack } from '@cossackframework/core';

/** Structural router contract: the Node library does not import the framework. */
export interface NodeWebSocketUpgrade {
  target: string;
  provider: string;
  componentId: string;
  user?: unknown;
  createComponent(): Promise<Cossack>;
}
export interface NodeAdapterOptions {
  maxInstances?: number;
  idleTimeoutMs?: number;
}
interface Entry {
  runtime: InMemoryWebSocketRuntime<WebSocket>;
  clients: Set<WebSocket>;
  actions: Set<Promise<void>>;
  lastActive: number;
  dispose(): Promise<void>;
}

/** Run the entire application's middleware before accepting a Node upgrade. */
export function createNodeAdapter(options: NodeAdapterOptions = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const handshakeHeaders = new WeakMap<IncomingMessage, Headers>();
  wss.on('headers', (headers, request) => {
    const response = handshakeHeaders.get(request);
    if (!response) return;
    for (const [name, value] of response) {
      if (/^(connection|upgrade|content-length|transfer-encoding|set-cookie|sec-websocket-.*|x-cossack-upgrade)$/i.test(name)) continue;
      headers.push(`${name}: ${value}`);
    }
    for (const cookie of response.getSetCookie()) headers.push(`set-cookie: ${cookie}`);
  });
  const requests = new WeakMap<Request, { upgrade?: NodeWebSocketUpgrade; token: string }>();
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry>>();
  const retiring = new Set<Promise<void>>();
  const sockets = new Set<Duplex>();
  const detach = new Set<() => void>();
  const limit = options.maxInstances ?? 512;
  const idleMs = options.idleTimeoutMs ?? 15 * 60_000;
  let stopped = false;
  let disposal: Promise<void> | undefined;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(idleMs) || idleMs < 0) {
    throw new TypeError('Node runtime requires positive integer maxInstances and nonnegative finite idleTimeoutMs');
  }
  const settle = async (work: Promise<unknown>[]) => {
    const results = await Promise.allSettled(work);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Node runtime cleanup failed');
  };
  const retire = (entry: Entry) => {
    const work = entry.dispose();
    retiring.add(work);
    void work.then(() => retiring.delete(work), () => retiring.delete(work));
    return work;
  };
  const prune = async (reserve = false) => {
    const work: Promise<void>[] = [];
    const idle = [...entries].filter(([key, entry]) => !pending.has(key) && entry.clients.size === 0)
      .sort((a, b) => a[1].lastActive - b[1].lastActive);
    for (const [key, entry] of idle) {
      if (Date.now() - entry.lastActive < idleMs && entries.size + pending.size < limit + (reserve ? 0 : 1)) continue;
      entries.delete(key);
      work.push(retire(entry));
    }
    await settle(work);
  };
  const acquire = (upgrade: NodeWebSocketUpgrade): Promise<Entry> => {
    if (stopped) return Promise.reject(new Error('Node runtime is disposed'));
    const key = JSON.stringify([upgrade.componentId, upgrade.provider, upgrade.target]);
    const creating = pending.get(key);
    if (creating) return creating;
    const cached = entries.get(key);
    if (cached) return Promise.resolve(cached);
    const cleanup = prune(true);
    if (entries.size + pending.size >= limit) {
      return cleanup.then(() => { throw new Error('Node runtime instance limit reached'); });
    }
    const creation = cleanup.then(async () => {
      if (stopped) throw new Error('Node runtime is disposed');
      const component = await upgrade.createComponent();
      let completion: Promise<void> | undefined;
      try {
        const entry: Entry = {
          runtime: new InMemoryWebSocketRuntime<WebSocket>(component),
          clients: new Set(), actions: new Set(), lastActive: Date.now(),
          dispose: () => completion ??= (async () => {
            for (const client of entry.clients) {
              entry.runtime.removeClient(client);
              client.close(1001, 'Runtime shutting down');
              // Do not let an unresponsive peer hold process shutdown open.
              client.terminate();
            }
            entry.clients.clear();
            await Promise.allSettled([...entry.actions]);
            await component.destroyAsync();
          })(),
        };
        entries.set(key, entry);
        return entry;
      } catch (error) { await component.destroyAsync(); throw error; }
    }).finally(() => pending.delete(key));
    pending.set(key, creation);
    return creation;
  };
  const connect = async (ws: WebSocket, upgrade: NodeWebSocketUpgrade) => {
    ws.on('error', error => console.error('[Cossack] Node WebSocket error:', error));
    try {
      const entry = await acquire(upgrade);
      if (stopped || ws.readyState !== WebSocket.OPEN) { await prune(); return; }
      entry.clients.add(ws);
      entry.runtime.addClient(ws, upgrade.user);
      entry.lastActive = Date.now();
      ws.on('close', () => {
        entry.clients.delete(ws);
        entry.runtime.removeClient(ws);
        entry.lastActive = Date.now();
        void prune().catch(error => console.error('[Cossack] Node runtime cleanup failed:', error));
      });
      ws.on('message', data => {
        if (stopped || ws.readyState !== WebSocket.OPEN) return;
        entry.lastActive = Date.now();
        const action = entry.runtime.onClientMessage(ws, data.toString());
        entry.actions.add(action);
        void action.catch(error => {
          console.error('[Cossack] Node WebSocket action failed:', error);
          ws.close(1013, 'Runtime unavailable');
        }).finally(() => entry.actions.delete(action));
      });
      ws.send(JSON.stringify({ type: 'state-update', state: entry.runtime.getInitialState() }));
    } catch (error) {
      console.error('[Cossack] Node WebSocket initialization failed:', error);
      ws.close(1013, 'Runtime unavailable');
    }
  };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    stopped = true;
    for (const remove of detach) remove();
    detach.clear();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    disposal = (async () => {
      await Promise.allSettled([...pending.values()]);
      const active = [...entries.values()];
      entries.clear();
      try { await settle([...retiring, ...active.map(retire)]); }
      finally { wss.close(); }
    })();
    return disposal;
  };
  return {
    name: 'node',
    get instanceCount() { return entries.size; },
    getClientMetadata: () => ({ platform: 'web' }),
    dispose,
    handleWebSocketUpgrade(context: Context, upgrade: NodeWebSocketUpgrade): Response {
      const request = requests.get(context.req.raw);
      if (stopped || !request) return new Response('WebSocket upgrade unavailable', { status: 503 });
      request.upgrade = upgrade;
      return new Response(null, { status: 204, headers: { 'x-cossack-upgrade': request.token } });
    },
    attach(server: Server, fetch: (request: Request) => Response | Promise<Response>) {
      if (stopped) throw new Error('Node runtime is disposed');
      const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!request.url?.startsWith('/ws/')) return;
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        void (async () => {
          const headers = new Headers();
          for (let i = 0; i < request.rawHeaders.length; i += 2) headers.append(request.rawHeaders[i]!, request.rawHeaders[i + 1]!);
          const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
          const webRequest = new Request(new URL(request.url!, `${protocol}://${request.headers.host}`), { headers });
          const state = { token: crypto.randomUUID(), upgrade: undefined as NodeWebSocketUpgrade | undefined };
          requests.set(webRequest, state);
          let response: Response;
          try { response = await fetch(webRequest); }
          finally { requests.delete(webRequest); }
          if (stopped || socket.destroyed) return;
          if (!state.upgrade || response.status !== 204 || response.headers.get('x-cossack-upgrade') !== state.token) {
            // Only the framework's successful guarded route can approve this request.
            const status = response.status >= 400 && response.status <= 599 ? response.status : 403;
            await response.body?.cancel();
            socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
            return;
          }
          handshakeHeaders.set(request, response.headers);
          try { wss.handleUpgrade(request, socket, head, ws => { void connect(ws, state.upgrade!); }); }
          finally { handshakeHeaders.delete(request); }
        })().catch(error => {
          console.error('[Cossack] Node WebSocket upgrade failed:', error);
          socket.destroy();
        });
      };
      const onClose = () => { void dispose().catch(error => console.error('[Cossack] Node runtime cleanup failed:', error)); };
      server.on('upgrade', onUpgrade);
      server.once('close', onClose);
      const remove = () => { server.off('upgrade', onUpgrade); server.off('close', onClose); detach.delete(remove); };
      detach.add(remove);
      return remove;
    },
  };
}
