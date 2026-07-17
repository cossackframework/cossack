/**
 * Cossack Node.js dev server.
 *
 * Boots Vite in middleware mode so that:
 *   - Vite serves `/@vite/client`, applies source transforms (TS, the
 *     `virtual:cossack-*` modules, the security/code-stripping plugin), and
 *     provides HMR + the client asset pipeline — exactly as in Cloudflare dev.
 *   - For everything else (app routes + RPC), we load the user's `src/index.ts`
 *     via `vite.ssrLoadModule()` (so `virtual:cossack-pages` etc. resolve) and
 *     delegate to the Hono app's `fetch`.
 *
 * On source change we invalidate the app module so edits take effect without a
 * full process restart. This mirrors how the Cloudflare adapter runs the same
 * `createApp()` in dev — the only difference is the runtime.
 */
import { createServer } from 'vite';
import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT) || 3000;
const ENTRY = '/src/index.ts';

/** Build env bindings mirroring Cloudflare's `env` (see src/index.ts). */
async function buildEnv() {
  const env = {
    DB_PATH: process.env.DB_PATH ?? './database.sqlite',
  };
  if (process.env.SMTP_HOST) {
    // Lazy-import so projects without SMTP config don't pay the nodemailer
    // cost. The node-adapter is an ESM dependency, so use dynamic import.
    const { createNodeEmailSender } = await import('@cossackframework/node-adapter');
    env.EMAIL = createNodeEmailSender({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      from: process.env.MAIL_FROM ?? 'no-reply@example.com',
    });
  }
  return env;
}

/** Convert a Node IncomingMessage into a standard Web Request. */
function toWebRequest(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  // Treat loopback hosts as http (covers localhost, 127.0.0.1, 0.0.0.0, [::1]
  // in dev). Anything else is assumed to be behind TLS.
  const isLoopback = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(host);
  const proto = isLoopback ? 'http' : 'https';
  const url = `${proto}://${host}${req.url || '/'}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method || 'GET',
    headers: req.headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    // Required by the spec when streaming a body.
    duplex: hasBody ? 'half' : undefined,
  });
}

/** Pipe a Web Response out to a Node ServerResponse (binary-safe, backpressured, multi-cookie aware). */
async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  // `set-cookie` must be applied with res.appendHeader (setHeader overwrites,
  // which drops every cookie but the last on multi-cookie responses like
  // OAuth). Node's http.ServerResponse has appendHeader (>= 18.14), not the
  // `append` alias some other runtimes expose. Prefer Headers.getSetCookie()
  // (Node >= 18.14) — the canonical source that splits multi-value Set-Cookie
  // headers correctly — and fall back to walking the entries() for older
  // runtimes. Doing one OR the other avoids applying cookies twice.
  if (typeof response.headers.getSetCookie === 'function') {
    const cookieHeaders = response.headers.getSetCookie();
    // Copy non-cookie headers first.
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === 'set-cookie') continue;
      res.setHeader(key, value);
    }
    for (const cookie of cookieHeaders) {
      res.appendHeader('set-cookie', cookie);
    }
  } else {
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === 'set-cookie') {
        res.appendHeader('set-cookie', value);
      } else {
        res.setHeader(key, value);
      }
    }
  }
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Honor backpressure: if the kernel buffer is full, wait for 'drain'
      // before reading the next chunk (avoids unbounded memory growth on
      // large or slow-consumer responses).
      if (!res.write(value)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
  }
  res.end();
}

async function main() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom', // we handle routing ourselves
    // Inherit the project's vite.config.ts (cossackPages/lang/middlewares/
    // config + security + ssg plugins + tailwind). No Cloudflare plugin in a
    // Node project, so Vite's default SSR environment handles `ssrLoadModule`.
  });

  // Cached app + env. `app` is invalidated on source change.
  let app;
  const env = await buildEnv();

  // In-flight reload guard so rapid saves coalesce into one reload rather than
  // racing (whichever resolves first wins, and overlapping loads can observe
  // torn state). `loadApp` is always awaited before app.fetch is invoked.
  let loadingPromise = null;
  async function loadApp() {
    loadingPromise = (async () => {
      const appModule = await vite.ssrLoadModule(ENTRY);
      app = appModule.app;
      if (!app || typeof app.fetch !== 'function') {
        throw new Error(
          'Expected src/index.ts to export the Hono app as a named `app` export.',
        );
      }
    })();
    await loadingPromise;
    loadingPromise = null;
  }
  await loadApp();

  const server = http.createServer(async (req, res) => {
    // 1) Vite middleware first: serves /@vite/client, transforms, client
    //    assets, and HMR. It calls next() when it doesn't handle a request,
    //    routing us to the app handler below.
    vite.middlewares(req, res, async () => {
      try {
        // If a reload is in flight, wait for it so we never fetch with torn state.
        if (loadingPromise) await loadingPromise;
        const webReq = toWebRequest(req);
        const response = await app.fetch(webReq, env);
        await sendWebResponse(res, response);
      } catch (err) {
        vite.ssrFixStacktrace(err);
        console.error('[cossack dev] request error:', err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'text/plain');
          res.end('Internal Server Error');
        } else {
          // Headers already sent (possibly mid-stream): we can't change the
          // status or start a new body — just terminate the connection.
          res.end();
        }
      }
    });
  });

  // Delegate Vite's own WebSocket upgrades (HMR/ping) to Vite. Anything else
  // (e.g. the Cossack WS adapter) is only relevant for
  // `transport: 'durable-object'`, which is off by default.
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;
    if (pathname === '/' || pathname.startsWith('/__vite') || pathname.startsWith('/@')) {
      vite.middlewares.emit('upgrade', req, socket, head);
      return;
    }
    socket.destroy();
  });

  // Reload the app module when src/index.ts changes (client code still
  // hot-updates via Vite). Invalidate so the next ssrLoadModule re-reads disk.
  // `loadApp` itself guards against overlapping reloads via loadingPromise.
  vite.watcher.on('change', (file) => {
    if (file.endsWith('/src/index.ts') || file.endsWith('/src/index.js')) {
      console.log('[cossack dev] src/index.ts changed — reloading app module');
      const mod = vite.moduleGraph.urlToModuleMap.get(ENTRY);
      if (mod) vite.moduleGraph.invalidateModule(mod);
      loadApp().catch((e) => console.error('[cossack dev] reload failed:', e));
    }
  });

  server.listen(PORT, () => {
    console.log(`\n  Cossack (Node) dev server → http://localhost:${PORT}\n`);
  });
}

main().catch((err) => {
  console.error('[cossack dev] failed to start:', err);
  process.exit(1);
});
