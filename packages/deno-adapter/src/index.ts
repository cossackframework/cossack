import { Hono, type Context } from 'hono';
import { serveStatic, upgradeWebSocket } from 'hono/deno';
import { InMemoryWebSocketRuntime } from '@cossackframework/core';
import type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from '@cossackframework/framework/runtime-adapter';

export interface DenoAdapterOptions {
  env?: Record<string, unknown>;
  assetsRoot?: string;
  hostname?: string;
  port?: number;
  maxInstances?: number;
  idleTimeoutMs?: number;
}

interface DenoSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface RuntimeEntry {
  runtime: InMemoryWebSocketRuntime<DenoSocket>;
  lastActive: number;
  dispose(): Promise<void>;
}

export interface DenoApplication {
  fetch(request: Request, env?: Record<string, unknown>): Response | Promise<Response>;
}

export interface DenoServer {
  shutdown?(): Promise<void>;
  finished?: Promise<void>;
}

export interface CossackDenoAdapter extends CossackRuntimeAdapter {
  fetch(app: DenoApplication, request: Request, env?: Record<string, unknown>): Promise<Response>;
  serve(app: DenoApplication): DenoServer;
  readonly instanceCount: number;
}

function denoGlobal(): any {
  return (globalThis as any).Deno;
}

export function createDenoAdapter(options: DenoAdapterOptions = {}): CossackDenoAdapter {
  const instances = new Map<string, RuntimeEntry>();
  const pending = new Map<string, Promise<RuntimeEntry>>();
  const fetchHandlers = new WeakMap<DenoApplication, (
    request: Request,
    env?: Record<string, unknown>,
  ) => Promise<Response>>();
  const maxInstances = options.maxInstances ?? 512;
  const idleTimeoutMs = options.idleTimeoutMs ?? 15 * 60_000;

  const getFetchHandler = (app: DenoApplication) => {
    const cached = fetchHandlers.get(app);
    if (cached) return cached;

    const root = options.assetsRoot ?? './dist/client';
    const assetsApp = new Hono();
    assetsApp.use('*', serveStatic({ root }));
    const assets = { fetch: (request: Request) => assetsApp.fetch(request) };

    const outer = new Hono();
    outer.use('*', serveStatic({
      root,
      // Vite may emit an index.html, but Cossack owns document routing and SSR.
      rewriteRequestPath: (pathname) => pathname === '/' ? '/__cossack_ssr__' : pathname,
    }));
    outer.all('*', (context) => app.fetch(context.req.raw, context.env as Record<string, unknown>));

    const handler = async (request: Request, requestEnv: Record<string, unknown> = {}) => {
      const env = { ...(options.env ?? {}), ...requestEnv, ASSETS: assets };
      return outer.fetch(request, env);
    };
    fetchHandlers.set(app, handler);
    return handler;
  };

  const prune = async (reserveSlot = false) => {
    const disposals: Promise<void>[] = [];
    const remove = (key: string, entry: RuntimeEntry) => {
      instances.delete(key);
      disposals.push(entry.dispose());
    };
    const now = Date.now();
    for (const [key, entry] of instances) {
      if (!pending.has(key) && entry.runtime.clientCount === 0 && now - entry.lastActive >= idleTimeoutMs) remove(key, entry);
    }
    const targetSize = Math.max(0, maxInstances - pending.size - (reserveSlot ? 1 : 0));

    const idle = [...instances.entries()]
      .filter(([key, entry]) => !pending.has(key) && entry.runtime.clientCount === 0)
      .sort((a, b) => a[1].lastActive - b[1].lastActive);
    for (const [key, entry] of idle) {
      if (instances.size <= targetSize) break;
      remove(key, entry);
    }
    await Promise.all(disposals);
  };

  const handleWebSocketUpgrade = async (context: Context, upgrade: RuntimeWebSocketUpgrade): Promise<Response> => {
    let entryPromise: Promise<RuntimeEntry> | undefined;
    let closed = false;
    const getEntry = (): Promise<RuntimeEntry> => {
      const key = JSON.stringify([upgrade.componentId, upgrade.provider, upgrade.target]);
      const existing = instances.get(key);
      if (existing) {
        existing.lastActive = Date.now();
        return Promise.resolve(existing);
      }
      const creating = pending.get(key);
      if (creating) return creating;
      // Reserve before asynchronous disposal/creation so concurrent opens share
      // one component and count in the instance limit.
      const cleanup = prune(true);
      if (instances.size + pending.size >= maxInstances) {
        return cleanup.then(() => { throw new Error('Deno WebSocket instance limit reached'); });
      }
      const creation = cleanup.then(async () => {
        const component = await upgrade.createComponent();
        try {
          const entry: RuntimeEntry = {
            runtime: new InMemoryWebSocketRuntime<DenoSocket>(component, {
              onError: (error) => console.error('[Cossack] Ignoring malformed WebSocket message:', error),
            }),
            lastActive: Date.now(),
            dispose: () => component.destroyAsync(),
          };
          instances.set(key, entry);
          return entry;
        } catch (error) {
          await component.destroyAsync();
          throw error;
        }
      }).finally(() => { pending.delete(key); });
      pending.set(key, creation);
      return creation;
    };

    const handler = upgradeWebSocket(() => ({
      async onOpen(_event, socket) {
        if (closed) return;
        const client = socket as unknown as DenoSocket;
        try {
          entryPromise ??= getEntry();
          const entry = await entryPromise;
          if (closed) return;
          entry.runtime.addClient(client, upgrade.user);
          const state = entry.runtime.getInitialState();
          client.send(JSON.stringify({ type: 'state-update', state }));
        } catch (error) {
          console.error('[Cossack] Deno WebSocket upgrade failed:', error);
          client.close(1013, 'Runtime unavailable');
        }
      },
      async onMessage(event, socket) {
        if (closed) return;
        const client = socket as unknown as DenoSocket;
        try {
          entryPromise ??= getEntry();
          const entry = await entryPromise;
          if (closed) return;
          entry.lastActive = Date.now();
          await entry.runtime.onClientMessage(client, String(event.data));
        } catch (error) {
          console.error('[Cossack] Deno WebSocket message failed:', error);
          client.close(1013, 'Runtime unavailable');
        }
      },
      async onClose(_event, socket) {
        closed = true;
        if (!entryPromise) return;
        const entry = await entryPromise.catch(() => undefined);
        if (entry) {
          entry.runtime.removeClient(socket as unknown as DenoSocket);
          entry.lastActive = Date.now();
        }
        try { await prune(); }
        catch (error) { console.error('[Cossack] Deno WebSocket cleanup failed:', error); }
      },
    }));
    const response = await handler(context as any, async () => {});
    return response as Response;
  };

  return {
    name: 'deno',
    get instanceCount() { return instances.size; },
    getClientMetadata: () => ({ platform: 'web' }),
    handleWebSocketUpgrade,
    fetch(app, request, env) {
      return getFetchHandler(app)(request, env);
    },
    serve(app) {
      const deno = denoGlobal();
      if (!deno?.serve) throw new Error('createDenoAdapter().serve() requires Deno 2.9 or newer.');
      const serveOptions = {
        ...(options.hostname ? { hostname: options.hostname } : {}),
        ...(options.port !== undefined ? { port: options.port } : {}),
      };
      return deno.serve(serveOptions, (request: Request) => getFetchHandler(app)(request));
    },
  };
}

export type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from '@cossackframework/framework/runtime-adapter';
