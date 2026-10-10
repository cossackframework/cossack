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
  let shutdown;
  const stop = () => shutdown ??= server.close().catch(error => {
    console.error('[cossack dev] shutdown failed:', error);
    process.exitCode = 1;
  });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try { await server.listen(); }
  catch (error) { await stop(); throw error; }
  console.log(`\n  Cossack (Node) dev server → http://localhost:${server.httpServer.address().port}\n`);
}

main().catch(error => {
  console.error('[cossack dev] failed to start:', error);
  process.exitCode = 1;
});
