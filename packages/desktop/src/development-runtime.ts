import { createServer, isRunnableDevEnvironment, loadEnv, type ViteDevServer, type Plugin } from 'vite';
import { app, BrowserWindow, createDesktopApp, type DesktopApplication, type DesktopFetch } from './index.js';
import { relative } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { desktopDevelopmentError } from './development-error.js';
import { transformDesktopDocument } from './development-response.js';

type DevelopmentVariables = Record<string, string | undefined>;

interface DesktopDevelopmentEntry {
  frameworkApp: { fetch: DesktopFetch };
  /** App-declared bindings. Used when the entry does not export `createEnv`. */
  env?: Record<string, unknown>;
  /** Optional binding factory, matching the Node entry contract. */
  createEnv?(variables: DevelopmentVariables): Record<string, unknown> | Promise<Record<string, unknown>>;
  startDesktop(factory: typeof createDesktopApp): Promise<DesktopApplication>;
}

interface LoadedDesktopEntry {
  entry: DesktopDevelopmentEntry;
  env: Record<string, unknown>;
}

// Electron evaluates native modules; Vite owns only transformation and client
// assets. No native application handler is mounted on the loopback HTTP server.
async function main() {
  let server: ViteDevServer;
  let application: DesktopApplication | undefined;
  let current: LoadedDesktopEntry | undefined;
  let loading: Promise<LoadedDesktopEntry> | undefined;
  let stopped = false,
    dirty = false,
    revision = 0;
  let booting: Promise<void> | undefined;
  let startupFailed = false;
  // Supervision must work even while configuration or the first module is loading.
  let shutdown = () => {
    app.exit(0);
  };
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
  process.once('disconnect', () => shutdown());
  const restart = () => {
    if (process.connected) process.send?.({ type: 'cossack:desktop-restart' });
    else console.error('[desktop] Native configuration changed; restart desktop:dev to apply it.');
  };
  const load = (): Promise<LoadedDesktopEntry> => {
    if (stopped) return Promise.reject(new Error('Desktop development is closing'));
    if (current) return Promise.resolve(current);
    return (loading ??= (async () => {
      const environment = server.environments.ssr;
      if (!isRunnableDevEnvironment(environment)) throw new Error('Desktop requires a runnable Vite SSR environment');
      while (!stopped) {
        const expected = revision;
        if (dirty) {
          environment.moduleGraph.invalidateAll();
          environment.runner.clearCache();
          dirty = false;
        }
        const entry = (await environment.runner.import('/src/desktop/index.ts')) as DesktopDevelopmentEntry;
        if (typeof entry.startDesktop !== 'function' || typeof entry.frameworkApp?.fetch !== 'function')
          throw new TypeError(
            'Desktop entry must export startDesktop(factory) and frameworkApp.fetch. Apply the Desktop bootstrap migration.',
          );
        // Like production and Node development, only the app decides which
        // variables become bindings. Host and dotenv variables are not
        // exposed wholesale.
        const env = (entry.createEnv ? await entry.createEnv(variables) : entry.env) ?? {};
        if (expected !== revision) continue;
        current = { entry, env };
        return current;
      }
      throw new Error('Desktop development is closing');
    })().finally(() => {
      loading = undefined;
    }));
  };
  const report = (error: unknown) =>
    server.config.logger.error(`[desktop] ${error instanceof Error ? error.stack : error}`);
  const plugin: Plugin = {
    name: 'cossack-desktop-development',
    enforce: 'post',
    hotUpdate({ file }) {
      const source = relative(server.config.root, file).replaceAll('\\', '/');
      const sourceModule = source.startsWith('src/') && /\.(?:[cm]?[jt]sx?|mdx?)$/.test(source);
      if (!sourceModule && !server.environments.ssr.moduleGraph.getModulesByFile(file)?.size) return;
      if (this.environment.name !== 'ssr') return [];
      if (source.startsWith('src/desktop/')) {
        restart();
        return [];
      }
      current = undefined;
      dirty = true;
      revision++;
      void (
        application
          ? load().then(() => {
              // A failed navigation may have no live browser HMR connection. Native
              // reload also recovers that window after the source becomes valid.
              for (const window of BrowserWindow.getAllWindows()) {
                if (window.webContents.getURL().startsWith('cossack://app/')) window.webContents.reload();
              }
            })
          : boot()
      ).catch(report);
      return [];
    },
  };
  const assetServer = createHttpServer((request, response) => {
    if (server) server.middlewares(request, response);
    else response.writeHead(503).end();
  });
  await new Promise<void>((resolve, reject) => {
    assetServer.once('error', reject);
    assetServer.listen(0, '127.0.0.1', resolve);
  });
  const address = assetServer.address();
  if (!address || typeof address === 'string') throw new Error('Desktop development could not bind its asset server');
  const origin = `http://127.0.0.1:${address.port}`;
  server = await createServer({
    root: process.cwd(),
    mode: 'desktop',
    appType: 'custom',
    plugins: [plugin],
    server: {
      host: '127.0.0.1',
      middlewareMode: true,
      ws: { server: assetServer, host: '127.0.0.1', protocol: 'ws', clientPort: address.port },
    },
    environments: {
      ssr: {
        resolve: {
          external: ['electron', '@cossackframework/desktop'],
          noExternal: ['@cossackframework/core', '@cossackframework/renderer', '@cossackframework/framework'],
        },
      },
    },
  });
  const variables = { ...loadEnv(server.config.mode, server.config.envDir, ''), ...process.env };
  const configurationChanged = (file: string) => {
    const source = relative(server.config.root, file).replaceAll('\\', '/');
    if (file === server.config.configFile || /^\.env(?:\.[^/]+)?$/.test(source)) restart();
  };
  server.watcher.on('change', configurationChanged).on('add', configurationChanged).on('unlink', configurationChanged);
  const assets = {
    async fetch(request: Request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 404 });
      const url = new URL(request.url);
      const response = await fetch(origin + url.pathname + url.search, {
        method: request.method,
        signal: request.signal,
      });
      // fetch has already decoded content; do not leave stale transfer metadata.
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  };
  const factory: typeof createDesktopApp = (options) =>
    createDesktopApp({
      ...options,
      assets,
      fetch: async (request, requestEnv) => {
        try {
          const { entry, env } = await load();
          const response = await entry.frameworkApp.fetch(request, {
            ...requestEnv,
            ...env,
            ASSETS: requestEnv?.ASSETS,
            COSSACK_DESKTOP: requestEnv?.COSSACK_DESKTOP,
          });
          return await transformDesktopDocument(request, response, (pathname, html) =>
            server.transformIndexHtml(pathname, html),
          );
        } catch (error) {
          report(error);
          return desktopDevelopmentError(error);
        }
      },
    });
  function boot(): Promise<void> {
    return (booting ??= load()
      .then(async ({ entry }) => {
        if (!stopped && !application) {
          // Vite buffers errors until a browser connects. Replace the startup
          // error before opening the first window, so repaired source does not
          // receive a stale overlay. The first connection consumes this reload.
          if (startupFailed) server.ws.send({ type: 'full-reload' });
          startupFailed = false;
          application = await entry.startDesktop(factory);
          console.log(`[desktop] Development ready at cossack://app (assets ${origin})`);
        }
      })
      .catch((error) => {
        startupFailed = true;
        throw error;
      })
      .finally(() => {
        booting = undefined;
      }));
  }
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      stopped = true;
      const force = setTimeout(() => app.exit(1), 5000);
      try {
        await server.close();
        assetServer.closeAllConnections();
        await new Promise<void>((resolve) => assetServer.close(() => resolve()));
        app.exit(0);
      } finally {
        clearTimeout(force);
      }
    })());
  app.on('before-quit', (event) => {
    event.preventDefault();
    void close();
  });
  shutdown = () => {
    void close();
  };
  await boot().catch(report);
}

void main().catch((error) => {
  console.error('[desktop] Development startup failed', error);
  app.exit(1);
});
