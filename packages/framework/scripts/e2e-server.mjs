// Playwright's URL availability check has no request deadline, including its
// check before starting the server. Closed localhost ports can drop connection
// attempts on WSL. Bound both connection and response time before announcing
// readiness through Playwright's stdout wait instead.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function probeServer(address, timeout = 1000) {
  return new Promise(resolve => {
    let request;
    const finish = available => {
      clearTimeout(timer);
      request?.destroy();
      resolve(available);
    };
    // An absolute deadline also covers TCP connection attempts. A socket's
    // inactivity timeout alone does not reliably bound the connection phase.
    const timer = setTimeout(() => finish(false), timeout);
    request = http.get(address, { headers: { Accept: '*/*' } }, response => {
      response.resume();
      finish(response.statusCode >= 200 && response.statusCode < 404);
    });
    request.on('error', () => finish(false));
  });
}

export async function startServer({ root, mode, host, port, reuse = false }) {
  const address = `http://${host}:${port}`;
  console.log(`[e2e] Checking ${address} (1s probe deadline)...`);
  if (await probeServer(address)) {
    if (!reuse) throw new Error(`${address} is already in use. Stop that server or choose COSSACK_E2E_PORT.`);
    console.log('[e2e] Reusing the existing server.');
    return null;
  }

  if (mode === 'production') {
    const build = spawn(process.execPath, [path.join(root, 'scripts/e2e-build.mjs')], { cwd: root, stdio: 'inherit' });
    const [code] = await once(build, 'exit');
    if (code !== 0) throw new Error(`Production build failed (exit ${code}).`);
  }

  const vite = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin', 'vite.js');
  console.log(`[e2e] Starting the ${mode} server...`);
  // Report startup here without piping every Worker access log into the tests.
  const child = spawn(process.execPath, [vite, mode === 'dev' ? 'dev' : 'preview',
    '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  let launchError;
  child.on('error', error => { launchError = error; });
  const deadline = Date.now() + 120_000;
  try {
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`The ${mode} server exited before becoming ready (exit ${child.exitCode ?? child.signalCode}).`);
      }
      if (await probeServer(address) && !launchError && child.exitCode === null && child.signalCode === null) return child;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`The ${mode} server did not become ready within 120s.`);
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'production' },
    host: { type: 'string', default: 'localhost' },
    port: { type: 'string', default: '4173' },
    reuse: { type: 'boolean', default: false },
  } });
  if (!['dev', 'production'].includes(values.mode)) throw new Error('Invalid e2e server mode.');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid e2e server port.');
  const started = performance.now();
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const child = await startServer({ root, ...values, port });
  console.log(`[e2e] Server ready at http://${values.host}:${port} (${((performance.now() - started) / 1000).toFixed(1)}s startup).`);
  if (child) {
    const [code] = child.exitCode !== null || child.signalCode !== null
      ? [child.exitCode] : await once(child, 'exit');
    process.exitCode = code ?? 1;
  } else {
    // Keep the launcher alive for Playwright. Its process group owns no part of
    // the reused listener, so teardown cannot terminate the user's server.
    setInterval(() => {}, 60_000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[e2e] ${error.message}`); process.exitCode = 1; });
}
