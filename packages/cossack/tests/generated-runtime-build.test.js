import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function project(adapter, features = []) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-runtime-build-'));
  roots.push(parent);
  const { projectDir } = await createApp('app', { cwd: parent, adapter, preset: 'minimal', features, interactive: false });
  const modules = path.join(projectDir, 'node_modules');
  await fs.mkdir(modules);
  for (const name of await fs.readdir(path.join(repository, 'node_modules'))) {
    if (name.startsWith('.') || name === '@cossackframework') continue;
    await fs.symlink(path.join(repository, 'node_modules', name), path.join(modules, name), 'junction');
  }
  await fs.mkdir(path.join(modules, '@cossackframework'));
  for (const name of ['framework', 'core', 'renderer', 'auth', 'database', 'ui', 'scaffold', 'node-adapter', 'deno-adapter', 'desktop']) {
    await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
  }
  return projectDir;
}
async function vite(root, args) {
  try {
    return await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/vite/bin/vite.js'), 'build', ...args], {
      cwd: root, env: { ...process.env, VITEST: '', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) { throw new Error(`${error.stdout}\n${error.stderr}`); }
}
async function assertPortableChunks(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertPortableChunks(file);
    else if (entry.name.endsWith('.js')) expect(await fs.readFile(file, 'utf8'), file).not.toContain('cloudflare:workers');
  }
}
it.each(['node', 'deno'])('builds a generated %s app through its real Vite configuration', async adapter => {
  const root = await project(adapter);
  if (adapter === 'node') {
    await fs.mkdir(path.join(root, 'src/pages/live'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/pages/live/index.ts'), `import { Cossack, Page, State } from '@cossackframework/core'; @Page({ transport: 'durable-object', stateful: false }) export default class Live extends Cossack { @State() count = 7; }`);
  }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  await assertPortableChunks(path.join(root, 'dist/server'));
  if (adapter === 'node') {
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
      `const { app, env } = await import('./dist/server/index.js'); const response = await app.request('/', {}, env); if (response.status !== 200) throw new Error('HTTP ' + response.status); const body = await response.text(); if (!body.includes('<html')) throw new Error('Missing rendered document'); console.log('NODE_SSR_OK');`],
      { cwd: root, env: { ...process.env, APP_URL: 'http://localhost:3000' }, maxBuffer: 1024 * 1024 });
    expect(result.stdout).toContain('NODE_SSR_OK');
    const websocket = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'node:http';
      import { WebSocket } from 'ws';
      const { app, env, runtime } = await import('./dist/server/index.js');
      const server = createServer();
      runtime.attach(server, request => app.fetch(request, env));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = 'http://127.0.0.1:' + server.address().port;
      env.APP_URL = origin;
      const rendered = await app.request('/live', {}, env);
      if (rendered.status !== 200 || !(await rendered.text()).includes('user:anonymous')) throw new Error('WebSocket page SSR failed');
      const query = new URLSearchParams({ routePath: '/live', pathname: '/live', params: '{}' });
      const url = origin.replace('http:', 'ws:') + '/ws/page/user:anonymous?' + query;
      const rejectUpgrade = (target, requestOrigin) => new Promise((resolve, reject) => {
        const socket = new WebSocket(target, { headers: { origin: requestOrigin } });
        socket.on('error', () => {});
        socket.once('open', () => { socket.terminate(); reject(new Error('Forbidden upgrade accepted')); });
        socket.once('unexpected-response', (_request, response) => {
          response.resume(); socket.terminate();
          if (response.statusCode !== 403) reject(new Error('Expected 403, got ' + response.statusCode));
          else resolve();
        });
      });
      try {
        await rejectUpgrade(url, 'https://untrusted.example');
        await rejectUpgrade(url.replace('user:anonymous', 'user:other'), origin);
        const socket = new WebSocket(url, { headers: { origin } });
        const state = await new Promise((resolve, reject) => {
          socket.once('message', data => resolve(JSON.parse(String(data))));
          socket.once('close', (code, reason) => reject(new Error('Closed before snapshot: ' + code + ' ' + reason)));
          socket.once('error', reject);
        });
        if (state.type !== 'state-update' || state.state.public.count !== 7) throw new Error('Incorrect WebSocket snapshot: ' + JSON.stringify(state));
        console.log('NODE_WS_GUARDS_OK');
      } finally {
        await runtime.dispose();
        await new Promise(resolve => server.close(resolve));
      }
    `], { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024 });
    expect(websocket.stdout).toContain('NODE_WS_GUARDS_OK');

  }
  expect(await fs.readdir(path.join(root, 'dist/client/assets'))).not.toHaveLength(0);
}, 120000);
it('builds the generated Node application Desktop side target with its HTTP boundary', async () => {
  const root = await project('node', ['desktop']);
  await vite(root, []);
  await vite(root, ['--mode', 'desktop', '--ssr', 'src/desktop/index.ts', '--outDir', 'dist/desktop', '--minify', 'false']);
  const output = await fs.readFile(path.join(root, 'dist/desktop/index.js'), 'utf8');
  expect(output).toContain('electron');
  await assertPortableChunks(path.join(root, 'dist/desktop'));
  await fs.mkdir(path.join(root, 'src/pages/live'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/live/index.ts'), `import { Cossack, Page } from '@cossackframework/core'; @Page({ transport: 'sse' }) export default class Live extends Cossack {}`);
  await expect(vite(root, ['--mode', 'desktop', '--ssr', 'src/desktop/index.ts', '--outDir', 'dist/desktop', '--minify', 'false']))
    .rejects.toThrow(/page transport requires transports on desktop/);
}, 120000);
