/** Node development uses the same Vite plugin as `cossack dev` and `vite dev`. */
import { createServer, mergeConfig } from 'vite';

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

async function main() {
  const overlay = await loadInlineConfig();
  const server = await createServer(mergeConfig(overlay, {
    server: { port: Number(process.env.PORT ?? 3000) },
  }));
  const close = () => server.close().catch(error => {
    console.error('[cossack dev] shutdown failed:', error);
    process.exitCode = 1;
  });
  // Exit once the server is closed: database connections, timers and background work the
  // application still holds would otherwise keep the process alive after Ctrl-C, and a leaked
  // dev server keeps running against a database that was stopped with it.
  let shutdown;
  const stop = () => shutdown ??= (() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 5000).unref();
    return close().then(() => process.exit(process.exitCode ?? 0));
  })();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try { await server.listen(); }
  catch (error) { await close(); throw error; }
  console.log(`\n  Cossack (Node) dev server → http://localhost:${server.httpServer.address().port}\n`);
}

main().catch(error => {
  console.error('[cossack dev] failed to start:', error);
  process.exitCode = 1;
});
