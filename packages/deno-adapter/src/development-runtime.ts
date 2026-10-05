/// <reference types="@types/deno" />
import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import { ModuleRunner, createWebSocketModuleRunnerTransport } from 'vite/module-runner';

interface DevelopmentEntry {
  app: { fetch(request: Request, env?: Record<string, unknown>): Response | Promise<Response> };
  env?: Record<string, unknown>;
  runtime?: { dispose(): void | Promise<void> };
}

const config = JSON.parse(Deno.env.get('COSSACK_DENO_DEVELOPMENT') ?? '{}') as {
  control: string;
  token: string;
  id: string;
  entry: string;
  shutdownTimeoutMs: number;
};
Deno.env.delete('COSSACK_DENO_DEVELOPMENT');
const runner = new ModuleRunner({
  hmr: true,
  sourcemapInterceptor: false,
  transport: {
    ...createWebSocketModuleRunnerTransport({
      createConnection: () =>
        new WebSocket(config.control.replace('http:', 'ws:') + '/events', `cossack-deno-${config.token}`),
    }),
    async invoke(payload) {
      const response = await fetch(`${config.control}/invoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.token}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Vite module request failed (${response.status})`);
      return response.json();
    },
  },
});
const abort = new AbortController();
let entry: DevelopmentEntry | undefined;
let server: Deno.HttpServer<Deno.NetAddr> | undefined;
let stopping: Promise<void> | undefined;
const loading = runner.import<DevelopmentEntry>(config.entry).then((value) => {
  entry = value;
  if (typeof entry.app?.fetch !== 'function')
    throw new TypeError('Cossack Deno development entry must export app.fetch');
  return value;
});
const stop = () =>
  (stopping ??= (async () => {
    // This bound must survive a crashed or force-killed Vite parent.
    const timer = setTimeout(() => Deno.exit(1), config.shutdownTimeoutMs);
    abort.abort();
    await loading.catch(() => {});
    const results = await Promise.allSettled([
      Promise.resolve().then(() => entry?.runtime?.dispose()),
      server?.finished,
      runner.close(),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');
    for (const _failure of failures) logRuntimeFailure({ runtime: 'deno' }, 'runtime-cleanup');
    clearTimeout(timer);
    Deno.exit(failures.length ? 1 : 0);
  })());
Deno.addSignalListener('SIGTERM', () => {
  void stop();
});
// Losing the Vite parent must not leave a development server behind.
void (async () => {
  for await (const _ of Deno.stdin.readable) {
    /* parent ownership pipe */
  }
})()
  .finally(() => stop())
  .catch(() => {});

try {
  await loading;
  if (!stopping) {
    server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: abort.signal, onListen() {} }, (request) => {
      if (request.headers.get('x-cossack-deno-token') !== config.token)
        return new Response('Forbidden', { status: 403 });
      const url = request.headers.get('x-cossack-deno-url');
      if (!url || !/^https?:\/\//.test(url)) return new Response('Missing public URL', { status: 400 });
      const headers = new Headers(request.headers);
      headers.delete('x-cossack-deno-token');
      headers.delete('x-cossack-deno-url');
      // Deno associates upgrade state with the original native request. A new
      // Request would lose it. Forward getters and bind methods to that request.
      const forwarded = new Proxy(request, {
        get(target, property) {
          if (property === 'url') return url;
          if (property === 'headers') return headers;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return entry!.app.fetch(forwarded, entry!.env);
    });
    const ready = await fetch(`${config.control}/ready`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ id: config.id, port: server.addr.port }),
    });
    if (!ready.ok) throw new Error(`Vite rejected Deno startup (${ready.status})`);
  }
} catch (error) {
  logRuntimeFailure({ runtime: 'deno' }, 'initialization');
  await runner.close();
  Deno.exit(1);
}
