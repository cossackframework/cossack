import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';
import { chromium, expect as browserExpect } from '@playwright/test';

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
      cwd: root, env: { ...process.env, NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 4 * 1024 * 1024,
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

it('runs generated Node development WebSockets, preserves HMR, and replaces runtime state on source reload', async () => {
  const root = await project('node');
  const page = path.join(root, 'src/pages/live/index.ts');
  await fs.mkdir(path.dirname(page), { recursive: true });
  const source = count => `import { Cossack, Page, State } from '@cossackframework/core'; @Page({ transport: 'durable-object', stateful: false }) export default class Live extends Cossack { @State() count = ${count}; }`;
  await fs.writeFile(page, source(7));
  const child = spawn(process.execPath, ['scripts/dev.js'], {
    cwd: root, env: { ...process.env, PORT: '0', VITEST: '', COSSACK_LOCAL: '', APP_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  const sockets = [];
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /dev server → http:\/\/localhost:(\d+)/.exec(output)?.[1];
    }, { timeout: 30000 }).toBeTruthy();
    const port = /dev server → http:\/\/localhost:(\d+)/.exec(output)[1];
    const origin = `http://localhost:${port}`;
    const client = await (await fetch(origin + '/@vite/client')).text();
    const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
    expect(token, client.slice(0, 500)).toBeTruthy();
    const hmr = new WebSocket(origin.replace('http:', 'ws:') + '/?token=' + token, 'vite-hmr');
    sockets.push(hmr);
    const [hmrMessage] = await once(hmr, 'message');
    expect(JSON.parse(String(hmrMessage)).type).toBe('connected');
    const connect = async () => {
      const query = new URLSearchParams({ routePath: '/live', pathname: '/live', params: '{}' });
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/page/user:anonymous?' + query, { headers: { origin } });
      sockets.push(socket);
      const state = await Promise.race([
        once(socket, 'message').then(([data]) => JSON.parse(String(data))),
        once(socket, 'close').then(([code]) => { throw new Error('Closed before snapshot: ' + code + '\n' + output); }),
      ]);
      return { socket, state };
    };
    const first = await connect();
    expect(first.state.state.public.count).toBe(7);
    const closed = once(first.socket, 'close');
    await fs.writeFile(page, source(9));
    await closed;
    await expect.poll(async () => {
      try { return (await connect()).state.state.public.count; }
      catch { return undefined; }
    }, { timeout: 15000 }).toBe(9);
    await fs.writeFile(page, source(10));
    await fs.writeFile(page, source(11));
    await expect.poll(async () => {
      try { return (await connect()).state.state.public.count; }
      catch { return undefined; }
    }, { timeout: 15000 }).toBe(11);
    expect(hmr.readyState).toBe(WebSocket.OPEN);
    expect((await fetch(origin + '/')).status).toBe(200);
  } finally {
    for (const socket of sockets) socket.terminate();
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    expect({ code, signal }, output).toEqual({ code: 0, signal: null });
  }
}, 60000);

it('runs generated mutation contracts and hydrated resource/mutation UI with failure recovery', async () => {
  const root = await project('node', ['resource', 'mutation']);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated recipe types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    const code = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
    expect(code).not.toContain('Submission received for'); // Server action body is stripped.
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeId = manifest.filePathToId['/src/pages/mutation/index.ts'];
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { serve } from '@hono/node-server';
    const { app, env, runtime } = await import('./dist/server/index.js');
    const server = await new Promise(resolve => {
      const listener = serve({ fetch: request => app.fetch(request, env), port: 0, hostname: '127.0.0.1' }, () => resolve(listener));
      listener.once('error', error => { console.error(error); process.exit(1); });
    });
    env.APP_URL = 'http://127.0.0.1:' + server.address().port;
    console.log('RECIPE_ORIGIN=' + env.APP_URL);
    process.once('SIGTERM', async () => {
      await runtime.dispose();
      server.close(() => process.exit(0));
    });
  `], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  let browser;
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /RECIPE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 10000 }).toBeTruthy();
    const origin = /RECIPE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const call = async payload => {
      const response = await fetch(origin + '/crpc', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ componentRouteId: routeId, action: 'submitMessage', payload, state: { public: { acknowledgment: 'forged' } } }) });
      return { status: response.status, body: await response.json() };
    };
    for (const payload of [[], [null], ['bad input']]) {
      const result = await call(payload);
      expect(result).toMatchObject({ status: 400, body: { code: 'COSSACK_VALIDATION_FAILED', fieldErrors: { _: expect.any(String) } } });
    }
    for (const input of [{ email: 'bad', message: '' }, { email: ['a@b.test'], message: ['hello'] }, { email: 'a@b.test', message: 'x'.repeat(501) }]) {
      expect(await call([input])).toMatchObject({ status: 400, body: { code: 'COSSACK_VALIDATION_FAILED', fieldErrors: expect.any(Object) } });
    }
    expect(await call([{ email: 'AGENT@example.test', message: 'Please contact me.' }]))
      .toMatchObject({ status: 200, body: { _cossack_return: 'Submission received for agent@example.test.' } });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Generated recipe browser error:', error); });
    const rpcRequests = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') rpcRequests.push(request.postDataJSON()); });
    await page.goto(origin + '/mutation');
    expect(await page.locator('script[type="module"][src]').getAttribute('src')).toMatch(/^\/assets\/.+\.js$/);
    const email = page.getByLabel('Email', { exact: true });
    const message = page.getByLabel('Message', { exact: true });
    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    await email.fill('invalid');
    await message.fill('x');
    await submit.click();
    await browserExpect(page.locator('#mutation-email-error')).toHaveText('Enter a valid email address.');
    await browserExpect(page.locator('#mutation-message-error')).toHaveText('Enter a message of 3 to 500 characters.');
    expect(rpcRequests).toHaveLength(0); // Built-in client validation prevents a call.
    await email.fill('AGENT@example.test');
    await message.fill('Please contact me.');

    // Hold the actual request to make pending and duplicate-submit behavior observable.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/crpc', async route => { await gate; await route.continue(); });
    await submit.click();
    await browserExpect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    await browserExpect(email).toBeDisabled();
    expect(rpcRequests).toHaveLength(1);
    const sent = rpcRequests[0];
    expect(sent.payload).toEqual([{ email: 'AGENT@example.test', message: 'Please contact me.' }]);
    expect(sent.state).toEqual({}); // Client-only form/error/pending state is excluded.
    release();
    await browserExpect(page.getByRole('status')).toHaveText('Submission received for agent@example.test.');
    await browserExpect(email).toHaveValue('');
    await browserExpect(message).toHaveValue('');
    await page.unroute('**/crpc');

    await email.fill('retry@example.test');
    await message.fill('Keep this message.');
    await page.route('**/crpc', route => route.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error: 'Validation failed.', code: 'COSSACK_VALIDATION_FAILED', fieldErrors: { email: 'Email was rejected by the server.' } }) }));
    await submit.click();
    await browserExpect(page.locator('#mutation-email-error')).toHaveText('Email was rejected by the server.');
    await browserExpect(email).toHaveValue('retry@example.test');
    await page.unroute('**/crpc');
    await page.route('**/crpc', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) }));
    await submit.click();
    await browserExpect(page.getByRole('alert')).toHaveText('Could not submit. Your input is preserved; try again.');
    await browserExpect(message).toHaveValue('Keep this message.');
    await browserExpect(submit).toBeEnabled();
    await page.unroute('**/crpc');
    await submit.click();
    await browserExpect(page.getByRole('status')).toHaveText('Submission received for retry@example.test.');

    await page.goto(origin + '/resource');
    await browserExpect(page.getByText('Framework guide', { exact: true })).toBeVisible();
    const category = page.getByLabel('Category');
    const delayed = new Promise(resolve => { release = resolve; });
    await page.route('**/crpc', async route => { await delayed; await route.continue(); });
    await category.selectOption('books');
    await browserExpect(page.getByRole('status')).toHaveText('Updating results…');
    await browserExpect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
    await browserExpect(page.getByText('Project notebook', { exact: true })).toBeVisible(); // Stale results remain.
    release();
    await browserExpect(page.getByText('Project notebook', { exact: true })).toHaveCount(0);
    await page.unroute('**/crpc');
    await category.selectOption('other');
    await browserExpect(page.getByText('No products in this category.')).toBeVisible();
    await page.route('**/crpc', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) }));
    await category.selectOption('tools');
    await browserExpect(page.getByRole('alert')).toHaveText('Could not load products. Retry to try again.');
    await page.unroute('**/crpc');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await browserExpect(page.getByText('Project notebook', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    expect({ code, signal }, output).toEqual({ code: 0, signal: null });
  }
}, 120000);
it('enforces selected database recipe requirements before compiling its modules', async () => {
  const root = await project('node', ['database']);
  const file = path.join(root, 'vite.config.ts');
  const config = await fs.readFile(file, 'utf8');
  expect(config).toContain('"feature":"database/sqlite"');
  // Simulate selecting a build runtime that cannot run the recorded local database.
  // This must fail through the generated requirement, before importing native SQLite.
  await fs.writeFile(file, config.replace("mode === 'desktop' ? 'desktop' : 'node'", "mode === 'desktop' ? 'desktop' : 'cloudflare'")
    .replace('capabilities: { runtime:', 'capabilities: { bindings: [], runtime:'));
  await expect(vite(root, [])).rejects.toThrow(/\.cossack\/scaffold.json: database\/sqlite requires filesystem on cloudflare/);
}, 30000);
it('rejects a generated Desktop target that retains a native Cloudflare database', async () => {
  const root = await project('cloudflare', ['database', 'desktop']);
  await expect(vite(root, ['--mode', 'desktop', '--ssr', 'src/desktop/index.ts', '--outDir', 'dist/desktop']))
    .rejects.toThrow(/\.cossack\/scaffold.json: database\/d1 requires cloudflareBindings on desktop/);
}, 30000);

it('builds a portable Cloudflare application Desktop target without the Workers Vite plugin', async () => {
  const root = await project('cloudflare', ['desktop']);
  await vite(root, ['--mode', 'desktop', '--ssr', 'src/desktop/index.ts', '--outDir', 'dist/desktop']);
  await assertPortableChunks(path.join(root, 'dist/desktop'));
  expect(await fs.readFile(path.join(root, 'dist/desktop/index.js'), 'utf8')).toContain('electron');
}, 30000);
it('builds the resource recipe and executes SSR, filtered reads, empty results, and failures through RPC', async () => {
  const root = await project('node', ['resource']);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated resource types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const assetNames = await fs.readdir(path.join(root, 'dist/client/assets'));
  let action;
  for (const file of assetNames.filter(file => file.endsWith('.js'))) {
    const code = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
    expect(code).not.toContain('Framework guide'); // Loader data stays server-only.
    if (code.includes('Read-only resource')) action = code.match(/__cossack_server_resource_[a-z0-9]+/)?.[0];
  }
  expect(action).toBeTruthy();
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeId = manifest.filePathToId['/src/pages/resource/index.ts'];
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    const { app, env, runtime } = await import('./dist/server/index.js');
    env.APP_URL = 'http://localhost';
    try {
      const rendered = await app.request('/resource', {}, env);
      const html = await rendered.text();
      if (rendered.status !== 200 || !html.includes('Framework guide') || !html.includes('Project notebook')) throw new Error('Resource SSR failed: ' + html);
      const read = async category => {
        const response = await app.request('/crpc', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ componentRouteId: ${JSON.stringify(routeId)}, action: ${JSON.stringify(action)}, payload: [category], state: { public: { category } } }) }, env);
        return { status: response.status, body: await response.json() };
      };
      const filtered = await read('books');
      if (filtered.status !== 200 || filtered.body._cossack_return?.length !== 1 || filtered.body._cossack_return[0].id !== 'guide') throw new Error('Filtered resource RPC failed: ' + JSON.stringify(filtered));
      const empty = await read('other');
      if (empty.status !== 200 || empty.body._cossack_return?.length !== 0) throw new Error('Empty resource failed');
      const failed = await read('invalid');
      if (failed.status !== 500 || failed.body.error !== 'Internal Server Error') throw new Error('Failure was not safely reported');
      const retry = await read('tools');
      if (retry.status !== 200 || retry.body._cossack_return?.[0].id !== 'notebook') throw new Error('Read after failure failed');
      console.log('RESOURCE_RECIPE_OK');
    } finally { await runtime.dispose(); }
  `], { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024 });
  expect(result.stdout).toContain('RESOURCE_RECIPE_OK');
}, 60000);
