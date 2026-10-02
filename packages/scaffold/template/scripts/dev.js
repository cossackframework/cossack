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
import { createServer, mergeConfig } from 'vite';
import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT ?? 3000);
const ENTRY = '/src/index.ts';

/**
 * When COSSACK_LOCAL is set, merge in vite.config.dev.ts — an overlay that
 * pre-bundles locally-linked @cossackframework packages for the SSR environment
 * so a cold dev start doesn't spend ~14s re-transforming their TS source each
 * boot. No-op for normal installs (packages ship pre-built from npm). See
 * vite.config.dev.ts for the full rationale and how to edit the package list.
 */
async function loadInlineConfig() {
  if (!process.env.COSSACK_LOCAL) return {};
  try {
    const devConfig = (await import('../vite.config.dev.ts')).default;
    return mergeConfig({}, devConfig);
  } catch (e) {
    console.warn('[cossack dev] COSSACK_LOCAL set but vite.config.dev.ts could not be loaded; ignoring.', e?.message ?? e);
    return {};
  }
}

/** Build env bindings mirroring Cloudflare's `env` (see src/index.ts). */
async function buildEnv() {
  const env = {
    ...process.env,
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
  const server = http.createServer();
  const inlineConfig = await loadInlineConfig();
  const vite = await createServer({
    ...inlineConfig,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'custom', // we handle routing ourselves
    // Inherit the project's vite.config.ts (cossackPages/lang/middlewares/
    // config + security + ssg plugins + tailwind). No Cloudflare plugin in a
    // Node project, so Vite's default SSR environment handles `ssrLoadModule`.
  });

  let app;
  let runtime;
  const env = await buildEnv();
  let loadingPromise = null;
  let reloadRequested = false;
  let stopping = false;
  function loadApp() {
    if (stopping) return Promise.resolve();
    reloadRequested = true;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      do {
        reloadRequested = false;
        // Invalidate SSR dependencies too: a changed page may already have
        // finished transforming while another reload was still draining actions.
        vite.moduleGraph.invalidateAll();
        const appModule = await vite.ssrLoadModule(ENTRY);
        if (!appModule.app || typeof appModule.app.fetch !== 'function' ||
            !appModule.runtime?.attach || !appModule.runtime?.dispose) {
          throw new Error('Expected src/index.ts to export app and a createNodeAdapter() runtime.');
        }
        if (stopping) { await appModule.runtime.dispose(); return; }
        const previous = runtime;
        if (previous && previous !== appModule.runtime) {
          try { await previous.dispose(); }
          catch (error) { console.error('[cossack dev] previous runtime cleanup failed:', error); }
        }
        app = appModule.app;
        runtime = appModule.runtime;
        if (runtime !== previous) runtime.attach(server, request => app.fetch(request, env));
      } while (reloadRequested && !stopping);
    })().finally(() => { loadingPromise = null; });
    return loadingPromise;
  }
  await loadApp();

  server.on('request', async (req, res) => {
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

  // Vite owns its HMR upgrades through server.hmr.server; the runtime owns /ws/.
  // Do not add a catch-all upgrade listener that closes either connection.

  // Reload the app module when any src/ server file changes (client code still
  // hot-updates via Vite for CSS/client-only modules). Previously only
  // src/index.ts triggered a reload, so edits to pages/services/middlewares
  // were invisible until a manual restart. We invalidate the entry and its
  // transitive SSR graph so the next request re-reads the changed modules.
  // `loadApp` itself guards against overlapping reloads via loadingPromise.
  vite.watcher.on('change', (file) => {
    const normalized = file.replace(/\\/g, '/');
    const isSrcChange =
      normalized.includes('/src/') &&
      /\.(ts|tsx|js|jsx|md|mdx)$/.test(normalized) &&
      !normalized.includes('/src/client/');
    if (!isSrcChange) return;
    console.log(`[cossack dev] ${normalized.split('/src/')[1]} changed — reloading app module`);
    loadApp().catch((e) => console.error('[cossack dev] reload failed:', e));
  });

  let shutdown;
  const stop = () => shutdown ??= (async () => {
    stopping = true;
    await loadingPromise?.catch(() => {});
    const results = await Promise.allSettled([
      runtime?.dispose(),
      vite.close(),
      new Promise((resolve, reject) => server.close(error =>
        error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())),
    ]);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Development server cleanup failed');
  })().catch(error => { console.error('[cossack dev] shutdown failed:', error); process.exitCode = 1; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  server.listen(PORT, () => {
    console.log(`\n  Cossack (Node) dev server → http://localhost:${server.address().port}\n`);
  });
}

main().catch((err) => {
  console.error('[cossack dev] failed to start:', err);
  process.exit(1);
});
