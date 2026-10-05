import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import { Hono, type Context } from 'hono';
import { serveStatic, upgradeWebSocket } from 'hono/deno';
import { closeUnauthorizedSocket, InMemoryWebSocketRuntime } from '@cossackframework/core';
import type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from '@cossackframework/core';

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
  clients: Set<DenoSocket>;
  actions: Set<Promise<void>>;
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
  dispose(): Promise<void>;
}

function denoGlobal(): any {
  return (globalThis as any).Deno;
}

export function createDenoAdapter(options: DenoAdapterOptions = {}): CossackDenoAdapter {
  const instances = new Map<string, RuntimeEntry>();
  const pending = new Map<string, Promise<RuntimeEntry>>();
  const retiring = new Set<Promise<void>>();
  let stopped = false;
  let disposal: Promise<void> | undefined;
  const settle = async (work: Promise<unknown>[]) => {
    const results = await Promise.allSettled(work);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Deno runtime cleanup failed');
  };
  const retire = (entry: RuntimeEntry) => {
    const work = entry.dispose();
    retiring.add(work);
    void work.then(() => retiring.delete(work), () => retiring.delete(work));
    return work;
  };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    stopped = true;
    disposal = (async () => {
      await Promise.allSettled([...pending.values()]);
      const entries = [...instances.values()];
      instances.clear();
      await settle([...retiring, ...entries.map(retire)]);
    })();
    return disposal;
  };
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
      disposals.push(retire(entry));
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
    await settle(disposals);
  };

  const handleWebSocketUpgrade = async (context: Context, upgrade: RuntimeWebSocketUpgrade): Promise<Response> => {
    if (stopped) return new Response('Runtime unavailable', { status: 503 });
    let entryPromise: Promise<RuntimeEntry> | undefined;
    let closed = false;
    const getEntry = (): Promise<RuntimeEntry> => {
      if (stopped) return Promise.reject(new Error('Deno runtime is disposed'));
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
        if (stopped) throw new Error('Deno runtime is disposed');
        const component = await upgrade.createComponent();
        try {
          let cleanup: Promise<void> | undefined;
          const entry: RuntimeEntry = {
            runtime: new InMemoryWebSocketRuntime<DenoSocket>(component, {
              onError: () => logRuntimeFailure({ runtime: 'deno' }, 'dispatch'),
            }),
            lastActive: Date.now(),
            clients: new Set(),
            actions: new Set(),
            dispose: () => cleanup ??= (async () => {
              const errors: unknown[] = [];
              for (const client of entry.clients) {
                entry.runtime.removeClient(client);
                try { client.close(1001, 'Runtime shutting down'); }
                catch (error) { errors.push(error); }
              }
              entry.clients.clear();
              await Promise.allSettled([...entry.actions]);
              try { await component.destroyAsync(); }
              catch (error) { errors.push(error); }
              if (errors.length) throw new AggregateError(errors, 'Deno component cleanup failed');
            })(),
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
        if (upgrade.rejectAuthorization) {
          closeUnauthorizedSocket(client);
          closed = true;
          return;
        }
        try {
          entryPromise ??= getEntry();
          const entry = await entryPromise;
          if (closed || stopped) {
            if (stopped) client.close(1001, 'Runtime shutting down');
            return;
          }
          entry.runtime.addClient(client, upgrade.user, upgrade.authorize ? undefined : upgrade.context ?? context, upgrade.authorize
            ? (_client, operation) => upgrade.authorize!(operation)
            : undefined);
          entry.clients.add(client);
          await entry.runtime.sendInitialState(client);
        } catch (error) {
          logRuntimeFailure({ runtime: 'deno' }, 'upgrade');
          client.close(1013, 'Runtime unavailable');
        }
      },
      async onMessage(event, socket) {
        if (closed) return;
        const client = socket as unknown as DenoSocket;
        try {
          entryPromise ??= getEntry();
          const entry = await entryPromise;
          if (closed || stopped) {
            if (stopped) client.close(1001, 'Runtime shutting down');
            return;
          }
          entry.lastActive = Date.now();
          const action = entry.runtime.onClientMessage(client, String(event.data));
          entry.actions.add(action);
          try { await action; }
          finally { entry.actions.delete(action); }
        } catch (error) {
          logRuntimeFailure({ runtime: 'deno' }, 'dispatch');
          client.close(1013, 'Runtime unavailable');
        }
      },
      async onClose(_event, socket) {
        closed = true;
        if (!entryPromise) return;
        const entry = await entryPromise.catch(() => undefined);
        if (entry) {
          entry.runtime.removeClient(socket as unknown as DenoSocket);
          entry.clients.delete(socket as unknown as DenoSocket);
          entry.lastActive = Date.now();
        }
        try { await prune(); }
        catch (error) { logRuntimeFailure({ runtime: 'deno' }, 'runtime-cleanup', 'COSSACK_COMPONENT_CLEANUP_FAILED'); }
      },
    }));
    const response = await handler(context as any, async () => {});
    return response as Response;
  };

  return {
    name: 'deno',
    dispose,
    get instanceCount() { return instances.size; },
    getClientMetadata: () => ({ platform: 'web' }),
    handleWebSocketUpgrade,
    fetch(app, request, env) {
      return getFetchHandler(app)(request, env);
    },
    serve(app) {
      if (stopped) throw new Error('Deno runtime is disposed');
      const deno = denoGlobal();
      if (!deno?.serve) throw new Error('createDenoAdapter().serve() requires Deno 2.9 or newer.');
      const serveOptions = {
        ...(options.hostname ? { hostname: options.hostname } : {}),
        ...(options.port !== undefined ? { port: options.port } : {}),
      };
      const server = deno.serve(serveOptions, (request: Request) => getFetchHandler(app)(request));
      let shutdown: Promise<void> | undefined;
      const finished = server.finished?.then(
        () => dispose(),
        (error: unknown) => settle([Promise.reject(error), dispose()]),
      );
      // Keep background failures observed even if the caller only awaits shutdown.
      void finished?.catch((error: unknown) => logRuntimeFailure({ runtime: 'deno' }, 'runtime-cleanup'));
      return new Proxy(server, {
        get(target, property) {
          if (property === 'finished') return finished;
          if (property === 'shutdown') return () => shutdown ??= settle([
            dispose(), Promise.resolve().then(() => target.shutdown?.()),
          ]);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

export type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from '@cossackframework/core';
