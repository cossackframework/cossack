import { Hono, type Context } from 'hono';
import { serveStatic, upgradeWebSocket } from 'hono/deno';
import { InMemoryWebSocketRuntime } from '@cossackframework/core';
import type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from '@cossackframework/framework/runtime-adapter';
import { getDesktopClientMetadata, isDesktopRuntime } from './desktop.js';

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

  const prune = (reserveSlot = false) => {
    const now = Date.now();
    for (const [key, entry] of instances) {
      if (entry.runtime.clientCount === 0 && now - entry.lastActive >= idleTimeoutMs) instances.delete(key);
    }
    const targetSize = Math.max(0, maxInstances - (reserveSlot ? 1 : 0));
    if (instances.size <= targetSize) return;
    const idle = [...instances.entries()]
      .filter(([, entry]) => entry.runtime.clientCount === 0)
      .sort((a, b) => a[1].lastActive - b[1].lastActive);
    for (const [key] of idle) {
      if (instances.size <= targetSize) break;
      instances.delete(key);
    }
  };

  const handleWebSocketUpgrade = async (context: Context, upgrade: RuntimeWebSocketUpgrade): Promise<Response> => {
    let entryPromise: Promise<RuntimeEntry> | undefined;
    const getEntry = async () => {
      const key = `${upgrade.componentId}:${upgrade.provider}:${upgrade.target}`;
      let entry = instances.get(key);
      if (entry) {
        entry.lastActive = Date.now();
        return entry;
      }
      prune(true);
      if (instances.size >= maxInstances) {
        throw new Error('Deno WebSocket instance limit reached');
      }
      const component = await upgrade.createComponent();
      entry = {
        runtime: new InMemoryWebSocketRuntime<DenoSocket>(component, {
          onError: (error) => console.error('[Cossack] Ignoring malformed WebSocket message:', error),
        }),
        lastActive: Date.now(),
      };
      instances.set(key, entry);
      return entry;
    };

    const handler = upgradeWebSocket(() => ({
      async onOpen(_event, socket) {
        const client = socket as unknown as DenoSocket;
        try {
          entryPromise ??= getEntry();
          const entry = await entryPromise;
          entry.runtime.addClient(client, upgrade.user);
          const state = entry.runtime.getInitialState();
          client.send(JSON.stringify({ type: 'state-update', state }));
        } catch (error) {
          console.error('[Cossack] Deno WebSocket upgrade failed:', error);
          client.close(1013, 'Runtime unavailable');
        }
      },
      async onMessage(event, socket) {
        entryPromise ??= getEntry();
        const entry = await entryPromise;
        entry.lastActive = Date.now();
        await entry.runtime.onClientMessage(socket as unknown as DenoSocket, String(event.data));
      },
      async onClose(_event, socket) {
        if (!entryPromise) return;
        const entry = await entryPromise.catch(() => undefined);
        if (entry) {
          entry.runtime.removeClient(socket as unknown as DenoSocket);
          entry.lastActive = Date.now();
        }
        prune();
      },
    }));
    const response = await handler(context as any, async () => {});
    return response as Response;
  };

  return {
    name: 'deno',
    get instanceCount() { return instances.size; },
    getClientMetadata: () => ({
      platform: isDesktopRuntime() ? 'desktop' : 'web',
      ...getDesktopClientMetadata(),
    }),
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
