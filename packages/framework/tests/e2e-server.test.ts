import { afterEach, expect, it } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/e2e-server.mjs', import.meta.url));
const { probeServer, startServer } = await import(/* @vite-ignore */ script) as {
  probeServer(address: string, timeout?: number): Promise<boolean>;
  startServer(options: { root: string; mode: string; host: string; port: number; reuse?: boolean }): Promise<unknown>;
};

const servers: Server[] = [];
const launchers: ChildProcess[] = [];
async function listen(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port.');
  return { port: address.port, url: `http://127.0.0.1:${address.port}` };
}
afterEach(async () => {
  await Promise.all(launchers.splice(0).map(async launcher => {
    if (launcher.exitCode !== null || launcher.signalCode !== null) return;
    const closed = once(launcher, 'close');
    launcher.kill();
    await closed;
  }));
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

it('bounds an availability check even when the server never sends a response', async () => {
  const { url } = await listen(() => {});
  expect(await probeServer(url, 50)).toBe(false);
});

it.each([200, 302, 400, 401, 403])('accepts readiness status %i', async status => {
  const { url } = await listen((_request, response) => { response.writeHead(status).end(); });
  expect(await probeServer(url)).toBe(true);
});

it.each([404, 500, 503])('rejects readiness status %i', async status => {
  const { url } = await listen((_request, response) => { response.writeHead(status).end(); });
  expect(await probeServer(url)).toBe(false);
});

it('rejects a server that drops the connection', async () => {
  const { url } = await listen(request => { request.socket.destroy(); });
  expect(await probeServer(url)).toBe(false);
});

it('rejects an occupied dedicated port before running a build or launching Vite', async () => {
  const { port } = await listen((_request, response) => { response.end('existing server'); });
  await expect(startServer({ root: '/missing-app', mode: 'production', host: '127.0.0.1', port }))
    .rejects.toThrow('is already in use');
});

it('reuses a listener only when reuse is explicitly permitted', async () => {
  const { port, url } = await listen((_request, response) => { response.end('existing server'); });
  expect(await startServer({ root: '/missing-app', mode: 'dev', host: '127.0.0.1', port, reuse: true })).toBeNull();
  expect(await probeServer(url)).toBe(true);
});

it('leaves the reused server running when the launcher is terminated', async () => {
  const { port, url } = await listen((_request, response) => { response.end('existing server'); });
  const launcher = spawn(process.execPath, [script, '--mode', 'dev', '--host', '127.0.0.1',
    '--port', String(port), '--reuse'], { stdio: ['ignore', 'pipe', 'pipe'] });
  launchers.push(launcher);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    launcher.on('error', reject);
    launcher.on('exit', () => reject(new Error('Launcher exited before reporting readiness.')));
    launcher.stdout!.on('data', data => {
      output += data.toString();
      if (output.includes(`[e2e] Server ready at ${url}`)) resolve();
    });
  });
  const closed = once(launcher, 'close');
  launcher.kill();
  await closed;
  expect(await probeServer(url)).toBe(true);
});
