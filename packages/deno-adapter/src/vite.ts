import { DevEnvironment, createServerHotChannel, loadEnv, type Plugin } from 'vite';
import { createProxyServer } from 'http-proxy-3';
import { createServer, type IncomingMessage } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';

export interface DenoDevelopmentOptions {
  /** Source entry exporting app.fetch, env and an optional disposable runtime. */
  entry?: string;
  /** Defaults to COSSACK_DENO_BINARY, then deno on PATH. */
  executable?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}
interface RunningDeno {
  child: ChildProcess;
  target: string;
  finished: Promise<void>;
  stop?: Promise<void>;
}

/** Vite transforms modules; a private Deno process evaluates and serves them. */
export function cossackDeno(options: DenoDevelopmentOptions = {}): Plugin {
  const startupTimeout = options.startupTimeoutMs ?? 30000;
  const shutdownTimeout = options.shutdownTimeoutMs ?? 3000;
  for (const value of [startupTimeout, shutdownTimeout]) {
    if (!Number.isFinite(value) || value <= 0 || value > 2147483647)
      throw new TypeError('Deno development timeouts must be between 1 and 2147483647 milliseconds');
  }
  let close: (() => Promise<void>) | undefined;
  let refresh: (() => Promise<unknown>) | undefined;
  return {
    name: 'cossack-deno-development',
    apply: 'serve',
    config: () => ({
      appType: 'custom',
      environments: {
        ssr: {
          resolve: {
            conditions: ['deno', 'module', 'development'],
            externalConditions: ['deno', 'development'],
            noExternal: ['@cossackframework/core', '@cossackframework/deno-adapter'],
          },
          dev: {
            createEnvironment: (name, config) =>
              new DevEnvironment(name, config, {
                hot: false,
                transport: createServerHotChannel(),
              }),
          },
        },
      },
    }),
    async configureServer(vite) {
      if (vite.config.server.middlewareMode)
        throw new Error('Cossack Deno development requires a standalone Vite HTTP server');
      const environment = vite.environments.ssr;
      const token = randomUUID();
      const ready = new Map<string, (port: number) => void>();
      const control = createServer(async (request, response) => {
        if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(403).end();
          return;
        }
        try {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 65536) {
              response.writeHead(413).end();
              return;
            }
          }
          const payload = JSON.parse(body);
          if (request.url === '/invoke') {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(await environment.hot.handleInvoke(payload)));
          } else if (
            request.url === '/ready' &&
            ready.has(payload.id) &&
            Number.isInteger(payload.port) &&
            payload.port > 0 &&
            payload.port < 65536
          ) {
            ready.get(payload.id)!(payload.port);
            response.end();
          } else response.writeHead(404).end();
        } catch (error) {
          response.writeHead(500).end();
          vite.config.logger.error(`[cossack deno] module transport failed: ${error}`);
        }
      });
      await new Promise<void>((resolve, reject) => {
        control.once('error', reject);
        control.listen(0, '127.0.0.1', resolve);
      });
      const address = control.address();
      if (!address || typeof address === 'string') throw new Error('Could not bind Deno development control server');
      const controlUrl = `http://127.0.0.1:${address.port}`;
      const variables = { ...loadEnv(vite.config.mode, vite.config.envDir, ''), ...process.env };
      const proxy = createProxyServer();
      // Late upstream resets (especially sockets during reload) may be emitted
      // after the per-request callback has finished. Never let them crash Vite.
      proxy.on('error', (_error, _request, response) => {
        if (response && 'writeHead' in response && !response.headersSent) response.writeHead(502).end();
        else response?.destroy();
      });
      const sockets = new Set<Duplex>();
      const children = new Set<RunningDeno>();
      let stopped = false,
        revision = 0;
      let current: RunningDeno | undefined;
      let loading: Promise<RunningDeno> | undefined;
      const stop = (run: RunningDeno) =>
        (run.stop ??= (async () => {
          run.child.kill('SIGTERM');
          const timer = setTimeout(() => {
            vite.config.logger.warn('[cossack deno] application cleanup exceeded the shutdown deadline');
            run.child.kill('SIGKILL');
          }, shutdownTimeout);
          try {
            await run.finished;
          } finally {
            clearTimeout(timer);
            children.delete(run);
          }
        })());
      const start = async () => {
        const id = randomUUID();
        let resolveReady!: (port: number) => void, rejectReady!: (error: Error) => void;
        const listening = new Promise<number>((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        });
        ready.set(id, resolveReady);
        const child = spawn(
          options.executable ?? process.env.COSSACK_DENO_BINARY ?? 'deno',
          [
            'run',
            '--allow-env',
            '--allow-read',
            '--allow-net',
            join(dirname(fileURLToPath(import.meta.url)), 'development-runtime.js'),
          ],
          {
            cwd: vite.config.root,
            env: {
              ...variables,
              COSSACK_DENO_DEVELOPMENT: JSON.stringify({
                control: controlUrl,
                token,
                id,
                shutdownTimeoutMs: shutdownTimeout,
                entry: options.entry ?? '/src/index.ts',
              }),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        child.stdout?.pipe(process.stdout, { end: false });
        child.stderr?.pipe(process.stderr, { end: false });
        child.once('error', rejectReady);
        const run: RunningDeno = {
          child,
          target: '',
          finished: new Promise<void>((resolve) =>
            child.once('close', () => {
              rejectReady(new Error('Deno development process exited before readiness'));
              if (current === run) current = undefined;
              children.delete(run);
              resolve();
            }),
          ),
        };
        children.add(run);
        const timer = setTimeout(
          () => rejectReady(new Error('Deno development startup exceeded the deadline')),
          startupTimeout,
        );
        try {
          run.target = `http://127.0.0.1:${await listening}`;
          return run;
        } catch (error) {
          await stop(run);
          throw error;
        } finally {
          clearTimeout(timer);
          ready.delete(id);
        }
      };
      const load = (): Promise<RunningDeno> => {
        if (stopped) return Promise.reject(new Error('Deno development is closing'));
        if (current) return Promise.resolve(current);
        return (loading ??= (async () => {
          while (!stopped) {
            const expected = revision;
            const run = await start();
            if (run.child.exitCode !== null || run.child.signalCode !== null)
              throw new Error('Deno development process exited during startup');
            if (stopped || expected !== revision) {
              await stop(run);
              continue;
            }
            return (current = run);
          }
          throw new Error('Deno development is closing');
        })().finally(() => {
          loading = undefined;
        }));
      };
      refresh = async () => {
        revision++;
        environment.moduleGraph.invalidateAll();
        const previous = current;
        current = undefined;
        if (previous) await stop(previous);
        return load();
      };
      const headers = (request: IncomingMessage) => {
        const protocol = 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http';
        const url = new URL(request.url ?? '/', 'http://vite.invalid');
        return {
          'x-cossack-deno-token': token,
          'x-cossack-deno-url': `${protocol}://${request.headers.host}${url.pathname}${url.search}`,
        };
      };
      const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!request.url?.startsWith('/ws/')) return;
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        void load()
          .then((run) => {
            if (!stopped && !socket.destroyed)
              proxy.ws(request, socket, head, { target: run.target, headers: headers(request) }, () =>
                socket.destroy(),
              );
          })
          .catch((error) => {
            vite.config.logger.error(String(error));
            socket.destroy();
          });
      };
      vite.httpServer?.on('upgrade', upgrade);
      let closing: Promise<void> | undefined;
      close = () =>
        (closing ??= (async () => {
          stopped = true;
          refresh = undefined;
          vite.httpServer?.off('upgrade', upgrade);
          for (const socket of sockets) socket.destroy();
          await Promise.allSettled([...children].map(stop));
          await loading?.catch(() => {});
          proxy.close();
          control.closeAllConnections();
          await new Promise<void>((resolve) => control.close(() => resolve()));
        })());
      return () =>
        vite.middlewares.use((request, response, next) => {
          void load()
            .then((run) => {
              if (!response.destroyed)
                proxy.web(request, response, { target: run.target, headers: headers(request) }, (error) => {
                  if (response.headersSent) response.destroy(error);
                  else next(error);
                });
            })
            .catch(next);
        });
    },
    hotUpdate: {
      order: 'post',
      async handler({ file, modules, read, type, server }) {
        if (this.environment.name !== 'ssr' || !refresh) return;
        const source = relative(server.config.root, file).replaceAll('\\', '/');
        if (
          !modules.length &&
          !(source.startsWith('src/') && !source.startsWith('src/client/') && /\.[cm]?[jt]sx?$|\.mdx?$/.test(source))
        )
          return;
        if (type !== 'delete') await read();
        try {
          await refresh();
        } catch (error) {
          server.config.logger.error(`[cossack deno] reload failed: ${error}`);
        }
        return [];
      },
    },
    async closeBundle() {
      await close?.();
    },
  };
}
