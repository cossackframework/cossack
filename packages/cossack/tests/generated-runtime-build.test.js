import { createDataTableBackend, writeDataTableAcceptance, checkDataTableBrowser } from './fixtures/data-table-acceptance.js';
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
import { writeWorkerOptimisticRecovery, checkWorkerOptimisticRecovery } from './fixtures/worker-optimistic-recovery.js';
import { writeWorkerOptimisticSse, checkWorkerOptimisticSse } from './fixtures/worker-optimistic-sse.js';
import { writeWorkerOptimisticStreams, checkWorkerOptimisticStreams } from './fixtures/worker-optimistic-streams.js';
import { writeApiContractAcceptance, checkApiContractAcceptance, checkApiContractAssets } from './fixtures/api-contract-acceptance.js';
import { createTestHarness } from 'wrangler';
import { writeRouteBoundaryAcceptance, checkRouteBoundaryAcceptance, checkRouteBoundaryBrowser } from './fixtures/route-boundary-acceptance.js';
import { checkSameUrlHistory } from './fixtures/same-url-history-acceptance.js';
import { writeUrlStateAcceptance, checkUrlStateBrowser, createUrlStateBackend } from './fixtures/url-state-acceptance.js';
import { createRuntimeProxy, checkRuntimeOwnership } from './fixtures/runtime-owner-acceptance.js';
import { writeNavigationOwnershipAcceptance, checkNavigationOwnershipBrowser } from './fixtures/navigation-ownership-acceptance.js';

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
async function productionServer(root, environment = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { serve } from '@hono/node-server';
    const { app, env, runtime } = await import('./dist/server/index.js');
    const server = await new Promise(resolve => {
      const listener = serve({ fetch: request => app.fetch(request, env), port: 0, hostname: '127.0.0.1' }, () => resolve(listener));
      listener.once('error', error => { console.error(error); process.exit(1); });
    });
    env.APP_URL = 'http://127.0.0.1:' + server.address().port;
    runtime.attach(server, request => app.fetch(request, env));
    console.log('RECIPE_ORIGIN=' + env.APP_URL);
    process.once('SIGTERM', async () => {
      await runtime.dispose();
      server.close(() => process.exit(0));
    });
  `], { cwd: root, env: { ...process.env, NODE_ENV: 'production', VITEST: '', ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  const close = async () => {
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    expect({ code, signal }, output).toEqual({ code: 0, signal: null });
  };
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /RECIPE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 10000 }).toBeTruthy();
  } catch (error) {
    await close();
    throw error;
  }
  return { origin: /RECIPE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1], close };
}
it('replaces navigation owners when a browser moves between production Node and workerd', async () => {
  const nodeRoot=await project('node'); const workerRoot=await project('cloudflare');
  await writeNavigationOwnershipAcceptance(nodeRoot); await writeNavigationOwnershipAcceptance(workerRoot);
  await vite(nodeRoot,[]); await vite(nodeRoot,['--ssr','src/index.ts','--outDir','dist/server']);
  await vite(workerRoot,[]);
  const node=await productionServer(nodeRoot);
  try {
    const harness=createTestHarness({root:workerRoot,workers:[{configPath:path.join(workerRoot,'dist/ssr/wrangler.json')}]});
    try {
      const {url}=await harness.listen();
      const proxy=await createRuntimeProxy(node.origin);
      try {
        const browser=await chromium.launch({headless:true});
        try { await checkRuntimeOwnership(browser,proxy,node.origin,new URL(url).origin); }
        finally { await browser.close(); }
      } finally { await proxy.close(); }
    } finally { await harness.close(); }
  } finally { await node.close(); }
},120000);
it.each(['node', 'cloudflare'])('isolates navigation ownership in a generated production %s app', async adapter => {
  const root = await project(adapter); await writeNavigationOwnershipAcceptance(root);
  await vite(root, []);
  if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const browser = await chromium.launch({ headless: true });
  try {
    if (adapter === 'node') {
      const runtime = await productionServer(root);
      try { await checkNavigationOwnershipBrowser(browser, runtime.origin); }
      finally { await runtime.close(); }
    } else {
      const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
      try { const { url } = await harness.listen(); await checkNavigationOwnershipBrowser(browser, new URL(url).origin); }
      finally { await harness.close(); }
    }
  } finally { await browser.close(); }
}, 120000);
it.each(['node', 'cloudflare'])('parses and navigates typed URL state in a generated production %s app', async adapter => {
  const backend = await createUrlStateBackend();
  try {
    const root = await project(adapter); await writeUrlStateAcceptance(root, backend.origin);
    await vite(root, []);
    if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const browser = await chromium.launch({ headless: true });
    try {
      if (adapter === 'node') {
        const runtime = await productionServer(root);
        try { await checkUrlStateBrowser(browser, runtime.origin, backend); await checkSameUrlHistory(browser, runtime.origin, backend); }
        finally { await runtime.close(); }
      } else {
        const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
        try { const { url } = await harness.listen(); await checkUrlStateBrowser(browser, new URL(url).origin, backend); await checkSameUrlHistory(browser, new URL(url).origin, backend); }
        finally { await harness.close(); }
      }
    } finally { await browser.close(); }
  } finally { await backend.close(); }
}, 120000);
it.each(['node', 'cloudflare'])('selects and hydrates source boundaries in a generated production %s app', async adapter => {
  const root = await project(adapter); await writeRouteBoundaryAcceptance(root);
  await vite(root, []);
  if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const cli = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'routes', '--json'], { cwd: root, timeout: 30000 });
  const inspected = JSON.parse(cli.stdout).data;
  expect(inspected.manifest).toEqual(manifest);
  const checkInspection = states => {
    for (const state of states) {
      expect(manifest.filePathToId[state.componentPath]).toBe(state.componentRouteId);
      const page = inspected.routes.find(route => route.filePath === state.componentPath);
      expect(page.routeId).toBe(state.componentRouteId);
      expect(page.layoutAndPageMiddlewareCount).toBe(state.public.order.split(',').length - 1);
      expect(page.middlewareStack.map(entry => entry.source.split(':')[0])).toEqual([
        ...page.layouts, state.componentPath,
      ]);
    }
  };
  const browser = await chromium.launch({ headless: true });
  if (adapter === 'node') {
    const runtime = await productionServer(root);
    try {
      const states = await checkRouteBoundaryAcceptance((url, options) => fetch(runtime.origin + url, options));
      checkInspection(states);
      await checkRouteBoundaryBrowser(browser, runtime.origin);
    } finally { await browser.close(); await runtime.close(); }
  } else {
    const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
    try {
      const { url } = await harness.listen();
      const states = await checkRouteBoundaryAcceptance((path, options) => harness.fetch(path, options));
      checkInspection(states);
      await checkRouteBoundaryBrowser(browser, new URL(url).origin);
    } finally { await browser.close(); await harness.close(); }
  }
}, 120000);
it.each(['node', 'cloudflare'])('executes declared API contracts in a generated production %s app', async adapter => {
  const root = await project(adapter);
  await writeApiContractAcceptance(root);
  if (adapter === 'cloudflare') {
    const configPath = path.join(root, 'wrangler.jsonc');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.d1_databases = [{ binding: 'DB', database_name: 'native-api-test' }];
    await fs.writeFile(configPath, JSON.stringify(config));
  }
  await vite(root, []);
  if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  else await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/wrangler/bin/wrangler.js'), 'types'], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 30000 });
  await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, timeout: 30000 })
    .catch(error => { throw new Error(`${error.stdout}\n${error.stderr}`); });
  const cli = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'routes', '--json'], { cwd: root, timeout: 30000 });
  const inspected = JSON.parse(cli.stdout).data;
  expect(inspected.routes.find(route => route.name === '/api/declared/[id]').apiContracts.methods).toEqual([
    expect.objectContaining({ method: 'POST', declaration: 'defineApi', inputLocations: ['params', 'query', 'body'], output: 'json', authorization: 'declared' }),
    expect.objectContaining({ method: 'GET', output: 'response', authorization: 'none' }),
  ]);
  expect(inspected.routes.find(route => route.name === '/api/native').routeStyle).toBe('http-handlers');
  await checkApiContractAssets(root);
  if (adapter === 'node') {
    const runtime = await productionServer(root);
    try { await checkApiContractAcceptance((url, options) => fetch(runtime.origin + url, options)); }
    finally { await runtime.close(); }
  } else {
    const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
    try { await harness.listen(); await checkApiContractAcceptance((url, options) => harness.fetch(url, options)); }
    finally { await harness.close(); }
  }
}, 120000);
it('generates typed URLs that execute real grouped, dynamic, catch-all and API handlers in production', async () => {
  const root = await project('node');
  const write = async (file, source) => {
    const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, source);
  };
  await write('src/pages/index.ts', `
    import { Cossack, Page as View } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { routes } from 'virtual:cossack-routes';
    @View() class Home extends Cossack {
      render() { return html\`<a id="user-link" href=\${routes('/users/[id]', {id:'雪/a?b#c'})}>User</a>
        <a id="docs-link" href=\${routes('/docs/[...path]', {path:['intro','雪/?#%']})}>Docs</a>\`; }
    }
    export { Home as default };
  `);
  // The minimal recipe uses pages/index/index.ts. Keep one resolved owner.
  await fs.rm(path.join(root, 'src/pages/index'), { recursive: true, force: true });
  for (const [file, label] of [['layout.ts', 'root'], ['(account)/layout.ts', 'group']]) {
    await write('src/pages/' + file, `
      import { Cossack, Page } from '@cossackframework/core'; import { html } from '@cossackframework/renderer';
      @Page({middlewares:[async(c,next)=>{c.set('urlTrace',[...(c.get('urlTrace')??[]),'${label}']);await next();}]})
      export default class Layout extends Cossack { render(){return html\`<section>\${this.children}</section>\`;} }
    `);
  }
  await write('src/pages/(account)/users/[id]/index.ts', `
    import { Cossack, Page as View, State } from '@cossackframework/core'; import { html } from '@cossackframework/renderer';
    @View({middlewares:[async(c,next)=>{c.set('urlTrace',[...(c.get('urlTrace')??[]),'page']);await next();}]})
    class User extends Cossack {
      @State() id=''; @State() order='';
      async init(){this.id=this.c.req.param('id')??'';this.order=(this.c.get('urlTrace') as string[]).join(',');if(this.id==='fail')throw new Error('private-url-error');}
      render(){return html\`<main><p id="user-id">\${this.id}</p><p id="order">\${this.order}</p></main>\`;}
    }
    export {User as default};
  `);
  await write('src/pages/docs/[...path]/index.ts', `
    import { Cossack, Page, State } from '@cossackframework/core'; import { html } from '@cossackframework/renderer';
    @Page() export default class Docs extends Cossack {
      @State() path=''; async init(){this.path=this.c.req.param('path')??'';}
      render(){return html\`<p id="doc-path">\${this.path}</p>\`;}
    }
  `);
  await write('src/pages/(account)/api/items/[id].ts', `import type {Context} from 'hono';
    export const GET=(c:Context)=>c.json({handler:'functional',id:c.req.param('id')});
  `);
  await write('src/pages/api/init/[id].ts', `import {Cossack,Page} from '@cossackframework/core';
    @Page() export default class InitApi extends Cossack { async init(){return this.c.json({handler:'class-init',id:this.c.req.param('id')});} }
  `);
  for (const [file, marker] of [['(account)/error/index.ts', 'GROUP_ERROR'], ['error/index.ts', 'ROOT_ERROR'], ['404/index.ts', 'ROOT_NOT_FOUND']]) {
    await write('src/pages/' + file, `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
      @Page() export default class Boundary extends Cossack{render(){return html\`<p>${marker}</p>\`;}}
    `);
  }
  // This source is checked through the generated virtual import and published declarations.
  // It lives outside the route tree so its negative examples never become handlers.
  await write('src/route-types.ts', `import {routes} from 'virtual:cossack-routes';
    routes('/users/[id]',{id:'ok'});routes('/docs/[...path]',{path:['intro']});routes('/');
    // @ts-expect-error required parameter
    routes('/users/[id]');
    // @ts-expect-error invalid ordinary parameter
    routes('/users/[id]',{id:2});
    const extra={id:'ok',extra:'bad'};
    // @ts-expect-error extra variable parameter
    routes('/users/[id]',extra);
    // @ts-expect-error empty catch-all
    routes('/docs/[...path]',{path:[]});
    // @ts-expect-error boundaries do not have addressable routes
    routes('/error');
  `);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const user = manifest.routes.find(route => route.name === '/users/[id]');
  expect(user).toMatchObject({ pattern: '/users/:id', layoutPaths: ['/src/pages/layout.ts', '/src/pages/(account)/layout.ts'], errorBoundary: '/src/pages/(account)/error/index.ts' });
  expect(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).scripts.typecheck).toBe('cossack routes --generate && tsc --noEmit');
  await fs.rm(path.join(root, '.cossack/routes.ts'));
  const cli = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'routes', '--generate', '--json'], { cwd: root, timeout: 30000 });
  const inspected = JSON.parse(cli.stdout).data;
  expect(inspected.manifest).toEqual(manifest);
  expect(inspected.routes.find(route => route.name === '/users/[id]').middlewareStack).toEqual([
    { source: '/src/pages/layout.ts:3', count: 1 },
    { source: '/src/pages/(account)/layout.ts:3', count: 1 },
    { source: '/src/pages/(account)/users/[id]/index.ts:3', count: 1 },
  ]);
  expect(inspected.routes.find(route => route.name === '/api/items/[id]').layouts).toEqual([]);
  const typecheck = await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, timeout: 30000 })
    .catch(error => { throw new Error(`${error.stdout}\n${error.stderr}`); });
  expect(typecheck.stderr).toBe('');
  const runtime = await productionServer(root);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(runtime.origin);
    const url = await page.locator('#user-link').getAttribute('href');
    expect(url).toBe('/users/%E9%9B%AA%2Fa%3Fb%23c');
    await page.locator('#user-link').click();
    await browserExpect(page.locator('#user-id')).toHaveText('雪/a?b#c');
    await browserExpect(page.locator('#order')).toHaveText('root,group,page');
    await page.goto(runtime.origin); await page.locator('#docs-link').click();
    await browserExpect(page.locator('#doc-path')).toHaveText('intro/雪/?#%');
    for (const [name, handler] of [['items', 'functional'], ['init', 'class-init']]) {
      const response = await fetch(runtime.origin + '/api/' + name + '/%E9%9B%AA%2Fa%3Fb%23c');
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ handler, id: '雪/a?b#c' });
    }
    const failed = await fetch(runtime.origin + '/users/fail');
    expect(failed.status).toBe(500); const body = await failed.text();
    expect(body).toContain('GROUP_ERROR'); expect(body).not.toContain('ROOT_ERROR'); expect(body).not.toContain('private-url-error');
    const missing = await fetch(runtime.origin + '/unknown'); expect(missing.status).toBe(404); expect(await missing.text()).toContain('ROOT_NOT_FOUND');
    const assets = path.join(root, 'dist/client/assets');
    for (const file of await fs.readdir(assets)) if (file.endsWith('.js')) {
      const body = await fs.readFile(path.join(assets, file), 'utf8');
      expect(body).not.toContain('node:fs'); expect(body).not.toContain('private-url-error');
    }
  } finally { await browser.close(); await runtime.close(); }
}, 120000);
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
        if (state.type !== 'state-update' || state.state.count !== 7) throw new Error('Incorrect WebSocket snapshot: ' + JSON.stringify(state));
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
it('runs inferred client RPC views for HTTP/SSE methods, function fields, and scoped services', async () => {
  const root = await project('node');
  const write = async (relative, source) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), source);
  };
  await write('src/services/rpc-report.ts', `
    import { Server, Service, CossackService, input } from '@cossackframework/core';
    @Service() export class ReportService extends CossackService {
      @Server({ input: input.object({title:input.string({required:true}),nested:input.object({files:input.array(input.file({maxBytes:1024}),{minItems:1,maxItems:4})})}) }) async *files(input: { title: string; nested: { files: File[] } }) {
        yield await input.nested.files[0].text(); await new Promise(resolve => setTimeout(resolve, 500)); return input.nested.files[0].name;
      }
      @Server() native() { return new Response(new Uint8Array([0, 255, 128]), { headers: { 'Content-Type': 'application/octet-stream', 'X-Native': 'service' } }); }
      @Server({input:input.string({required:true})}) report = async function* (label: string) {
        const serverMarker = 'private-service-generator-marker';
        yield { label };
        return { length: label.length, marker: serverMarker };
      };
    }
  `);
  await write('src/pages/rpc/layout.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { ReportService } from '../../services/rpc-report';
    @Page({ transport: 'http', services: [ReportService] })
    export default class RpcLayout extends Cossack { render() { return html\`\${this.children}\`; } }
  `);
  for (const transport of ['http', 'sse']) await write(`src/pages/rpc/${transport}/index.ts`, `
    import { Cossack, Page, Server, Client, ClientState, Inject, rpc$, input } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { ReportService } from '../../../services/rpc-report';
    @Page({ transport: '${transport}' })
    export default class RpcPage extends Cossack {
      @Inject(ReportService) private report!: ReportService;
      @ClientState() output = '';
      @ClientState() failure = '';
      @ClientState() pending = false;
      @ClientState() uploadFilesProgress = 0;
      @Server({ input: input.object({title:input.string({required:true}),nested:input.object({files:input.array(input.file({maxBytes:1024}),{minItems:1,maxItems:4})})}) }) async *uploadFiles(input: { title: string; nested: { files: File[] } }) {
        yield await input.nested.files[0].text(); await new Promise(resolve => setTimeout(resolve, 500)); return input.nested.files[0].name;
      }
      @Client() async readFiles(service: boolean) {
        this.failure = ''; this.output = '';
        const input = { title: 'valid', nested: { files: [new File(['привет🙂'], 'nested.txt')] } };
        try {
          const call = service ? rpc$(this.report.files(input)) : rpc$(this.uploadFiles(input));
          for await (const value of call) this.output = 'first:' + value;
          this.output = 'done:' + await call + '/' + (service ? 'service' : this.uploadFilesProgress);
        } catch (error) { this.failure = error instanceof Error ? error.message : 'Upload failed'; }
      }
      @Client() readPageFiles() { return this.readFiles(false); }
      @Client() readServiceFiles() { return this.readFiles(true); }
      @Server() async *steps(limit: number) {
        for (let step = 1; step <= limit; step++) yield { step };
        return { total: limit };
      }
      @Server({input:input.number({integer:true,min:1})}) field = async function* (amount: number) {
        const marker = 'private-page-generator-marker';
        yield { amount };
        return { amount, marker };
      };
      @Server() async native() { return new Response('native page', { status: 202, headers: { 'X-Native': 'page' } }); }
      @Server() async ordinary(amount: number) { return { amount }; }
      @Server() async *serialized() {
        yield { when: new Date('2026-10-03'), list: [undefined] };
        return { toJSON() { return { when: new Date('2026-10-03'), count: 3 }; } };
      }
      @Client() async run() {
        this.pending = true; this.failure = ''; this.output = '';
        try {
          const values: string[] = [];
          const steps = rpc$(this.steps(2));
          for await (const value of steps) values.push('step:' + value.step);
          const first = await steps;
          const repeated = await steps;
          if (first.total !== repeated.total) throw new Error('Changed terminal result');
          const field = rpc$(this.field(3));
          for await (const value of field) values.push('field:' + value.amount);
          const second = await field;
          const report = rpc$(this.report.report('report'));
          for await (const value of report) values.push('service:' + value.label);
          const third = await report;
          const ordinary = rpc$(this.ordinary(7));
          for await (const value of ordinary) values.push('unexpected ordinary yield:' + value);
          const fourth = await ordinary;
          const serialized = rpc$(this.serialized());
          for await (const value of serialized) values.push('wire:' + value.when.split('T')[0] + '/' + String(value.list[0]));
          const fifth = await serialized;
          const nativePage = await rpc$(this.native());
          if (!nativePage) throw new Error('Missing page response');
          values.push('native:' + nativePage.status + '/' + nativePage.headers.get('X-Native') + '/' + await nativePage.text());
          const nativeService = await rpc$(this.report.native());
          if (!nativeService) throw new Error('Missing service response');
          values.push('binary:' + [...new Uint8Array(await nativeService.arrayBuffer())].join('/'));
          this.output = values.join(',') + '|done:' + [first.total, second.amount, third.length, fourth.amount, fifth.count].join('/');
        } catch (error) { this.failure = error instanceof Error ? error.message : 'RPC failed'; }
        finally { this.pending = false; }
      }
      render() { return html\`<main><h1>Typed ${transport} RPC</h1>
        <button @click=\${this.run} ?disabled=\${this.pending}>Run</button>
        <button @click=\${this.readPageFiles}>Page files</button><button @click=\${this.readServiceFiles}>Service files</button>
        <p role="status">\${this.output}</p><p role="alert">\${this.failure}</p></main>\`; }
    }
  `);
  await write('src/pages/native-upload/index.ts', `
    import { Cossack, Page, Server, Client, ClientState, rpc$ } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page({ transport: 'http' }) export default class NativeUpload extends Cossack {
      @ClientState() output = ''; @ClientState() failure = ''; @ClientState() uploadProgress = 0;
      @Server() async upload(file: File) {
        return new Response(await file.arrayBuffer(), { status: 201, headers: { 'Content-Type': 'application/octet-stream', 'X-Native': file.name } });
      }
      @Client() async run() {
        try {
          const response = await rpc$(this.upload(new File([new Uint8Array([0, 255, 128])], 'binary.dat')));
          if (!response) throw new Error('Missing upload response');
          this.output = response.status + '/' + response.headers.get('Content-Type') + '/' + response.headers.get('X-Native') + '/' + [...new Uint8Array(await response.arrayBuffer())].join('/');
        } catch (error) { this.failure = error instanceof Error ? error.message : 'Upload failed'; }
      }
      render() { return html\`<main><button @click=\${this.run}>Upload</button><p role="status">\${this.output}</p><p role="alert">\${this.failure}</p></main>\`; }
    }
  `);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated authored RPC types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  await assertPortableChunks(path.join(root, 'dist/server'));
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    const code = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
    expect(code).not.toContain('private-service-generator-marker');
    expect(code).not.toContain('private-page-generator-marker');
  }
  const server = await productionServer(root);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const transport of ['http', 'sse']) {
      const page = await browser.newPage();
      const errors = [];
      const actions = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') actions.push(request.postDataJSON()); });
      await page.goto(server.origin + '/rpc/' + transport);
      await browserExpect(page.getByRole('heading', { name: 'Typed ' + transport + ' RPC' })).toBeVisible();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await browserExpect(page.getByRole('status')).toHaveText('step:1,step:2,field:3,service:report,wire:2026-10-03/null,native:202/page/native page,binary:0/255/128|done:2/3/6/7/3');
      await browserExpect(page.getByRole('alert')).toHaveText('');
      expect(actions.map(action => action.action)).toEqual(['steps', 'field', 'report', 'ordinary', 'serialized', 'native', 'native']);
      expect(actions[2]).toMatchObject({ service: { slot: '0' }, payload: ['report'] });
      for (const label of ['Page files', 'Service files']) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await browserExpect(page.getByRole('status')).toHaveText('first:привет🙂');
        await browserExpect(page.getByRole('status')).toHaveText('done:nested.txt/' + (label === 'Page files' ? '100' : 'service'));
        await browserExpect(page.getByRole('alert')).toHaveText('');
      }
      expect(errors).toEqual([]);
      await page.close();
    }
    const uploadPage = await browser.newPage();
    await uploadPage.goto(server.origin + '/native-upload');
    await uploadPage.getByRole('button', { name: 'Upload', exact: true }).click();
    await browserExpect(uploadPage.getByRole('status')).toHaveText('201/application/octet-stream/binary.dat/0/255/128');
    await browserExpect(uploadPage.getByRole('alert')).toHaveText('');
    await uploadPage.close();
  } finally { await browser?.close(); await server.close(); }
}, 120000);
it('preserves native RPC cookies and consumes flash after a real browser redirect', async () => {
  const root = await project('node');
  const write = async (relative, source) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), source);
  };
  await write('src/services/cookie-result.ts', `
    import { cookie, flash, flashInput, Server, Service, CossackService, input } from '@cossackframework/core';
    export function cookieResult() {
      cookie().set('context_cookie', 'from_action', { httpOnly: true, path: '/' });
      flash('success', 'Saved'); flashInput({ title: 'Draft' });
      const headers = new Headers({ Location: '/cookie-rpc/target' });
      headers.append('Set-Cookie', 'native_one=1; HttpOnly; Path=/');
      headers.append('Set-Cookie', 'native_two=2; HttpOnly; Path=/');
      return new Response(null, { status: 303, headers });
    }
    @Service() export class CookieService extends CossackService {
      @Server() complete() { return cookieResult(); }
    }
  `);
  await write('src/pages/cookie-rpc/layout.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { CookieService } from '../../services/cookie-result';
    @Page({ transport: 'http', services: [CookieService] })
    export default class CookieLayout extends Cossack { render() { return html\`\${this.children}\`; } }
  `);
  await write('src/pages/cookie-rpc/index.ts', `
    import { Cossack, Page, Server, Client, ClientState, Inject, cookie, rpc$ } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { cookieResult, CookieService } from '../../services/cookie-result';
    @Page({ transport: 'http' }) export default class CookiePage extends Cossack {
      @Inject(CookieService) private service!: CookieService;
      @ClientState() failure = '';
      @ClientState() progress = '';
      @Server() complete() { return cookieResult(); }
      @Server() async *late() { yield 'first'; cookie().set('late_cookie', 'lost'); return 'unreachable'; }
      @Server() async early() {
        cookie().set('early_cookie', 'kept', { httpOnly: true, path: '/' });
        return (async function* () { yield 'first'; return 'finished'; })();
      }
      @Client() async savePage() { await rpc$(this.complete()); }
      @Client() async saveService() { await rpc$(this.service.complete()); }
      @Client() async readLate() {
        this.failure = ''; this.progress = '';
        try { for await (const value of rpc$(this.late())) this.progress = value; }
        catch (error) { this.failure = (error as { code?: string }).code ?? 'failed'; }
      }
      @Client() async readEarly() {
        this.failure = ''; this.progress = '';
        const call = rpc$(this.early());
        for await (const value of call) this.progress = value;
        this.progress = await call;
      }
      render() { return html\`<main><h1>Cookie RPC</h1>
        <button @click=\${this.savePage}>Save page</button><button @click=\${this.saveService}>Save service</button>
        <button @click=\${this.readLate}>Late cookie</button><button @click=\${this.readEarly}>Early cookie</button>
        <p role="status">\${this.progress}</p><p role="alert">\${this.failure}</p></main>\`; }
    }
  `);
  await write('src/pages/cookie-rpc/target/index.ts', `
    import { Cossack, Page, State, flashed, old } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page({ transport: 'http' }) export default class Target extends Cossack {
      @State() notice = ''; @State() title = '';
      async init() { this.notice = flashed<string>('success') ?? ''; this.title = old<string>('title') ?? ''; }
      render() { return html\`<main><h1>Saved target</h1><p role="status">\${this.notice}:\${this.title}</p></main>\`; }
    }
  `);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated cookie RPC types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const server = await productionServer(root, { APP_SECRET: 'generated-cookie-rpc-test-secret' });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const label of ['Save page', 'Save service']) {
      await page.goto(server.origin + '/cookie-rpc');
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/crpc');
      await page.getByRole('button', { name: label, exact: true }).click();
      const response = await responsePromise;
      expect(response.status(), response.status() === 200 ? undefined : await response.text()).toBe(200);
      const setCookies = (await response.headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie');
      expect(setCookies.map(header => header.value.split('=')[0]).sort()).toEqual(['context_cookie', 'cossack_flash', 'native_one', 'native_two'].sort());
      await browserExpect(page).toHaveURL(server.origin + '/cookie-rpc/target');
      await browserExpect(page.getByRole('status')).toHaveText('Saved:Draft');
      const cookies = await context.cookies();
      for (const name of ['context_cookie', 'native_one', 'native_two']) expect(cookies.find(cookie => cookie.name === name)).toMatchObject({ httpOnly: true });
      expect(cookies.some(cookie => cookie.name === 'cossack_flash')).toBe(false);
      await page.reload();
      await browserExpect(page.getByRole('status')).toHaveText(':');
    }
    await page.goto(server.origin + '/cookie-rpc');
    await page.getByRole('button', { name: 'Late cookie', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toHaveText('COSSACK_RESPONSE_HEADERS_COMMITTED');
    await browserExpect(page.getByRole('status')).toHaveText('first');
    expect((await context.cookies()).some(cookie => cookie.name === 'late_cookie')).toBe(false);
    await page.getByRole('button', { name: 'Early cookie', exact: true }).click();
    await browserExpect(page.getByRole('status')).toHaveText('finished');
    await browserExpect(page.getByRole('alert')).toHaveText('');
    expect((await context.cookies()).find(cookie => cookie.name === 'early_cookie')).toMatchObject({ value: 'kept', httpOnly: true });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 120000);
it('runs the scoped-service recipe across sibling navigation, nested injection, RPC, and disposal', async () => {
  const root = await project('node', ['scoped-service']);
  const serviceFile = path.join(root, 'src/services/scoped-counter.ts');
  // Observe the framework's actual disposal hook without shipping test counters
  // in the application recipe or replacing its service/ownership declarations.
  await fs.writeFile(serviceFile, (await fs.readFile(serviceFile, 'utf8'))
    .replace('CossackService, Server,', 'CossackService, optimistic, Optimistic, Server,')
    .replace('  @Server()', `
  @Shared()
  onDispose() {
    if (typeof window !== 'undefined') {
      const observed = window as Window & { __serviceDisposals?: number };
      observed.__serviceDisposals = (observed.__serviceDisposals ?? 0) + 1;
    }
  }
  @Optimistic('increment')
  preview() { optimistic<ScopedCounterService>(this).increment('count', 1); }
  @Server()`));
  for (const route of ['index.ts', 'other/index.ts', 'layout.ts']) {
    const file = path.join(root, 'src/pages/scoped-service', route);
    const source = await fs.readFile(file, 'utf8');
    const label = route === 'layout.ts' ? 'layout' : route === 'index.ts' ? 'counter' : 'sibling';
    await fs.writeFile(file, source.replace('<main>', `<main><p data-testid="${label}-service-loading">\${this.loading.increment ?? 0}</p>`)
      .replace('<section>', `<section><p data-testid="layout-service-loading">\${this.loading.increment ?? 0}</p>`)
      .replace('<p data-testid="nested-service-count">', '<span data-testid="nested-service-loading">${this.loading.increment ?? 0}</span><p data-testid="nested-service-count">'));
  }
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated service types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  await assertPortableChunks(path.join(root, 'dist/server'));
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    expect(await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8')).not.toContain('Counter updated on the server.');
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const ownerRouteId = manifest.filePathToId['/src/pages/scoped-service/layout.ts'];
  expect(ownerRouteId).toBeTruthy();
  const server = await productionServer(root);
  let browser;
  try {
    const { origin } = server;
    const rendered = await (await fetch(origin + '/scoped-service/other')).text();
    expect(rendered).toContain('nested-service-count');
    expect(rendered).toContain('Count: 0');
    const rpc = async (action, service = { ownerRouteId, slot: '0' }) => {
      const response = await fetch(origin + '/crpc', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ service, action, payload: [], state: { count: 4 } }) });
      return { status: response.status, body: await response.json() };
    };
    expect(await rpc('increment')).toMatchObject({ status: 200, body: {
      _cossack_service_state: { count: 5 }, _cossack_return: 'Counter updated on the server.',
    } });
    expect((await rpc('formatCount')).status).toBe(403);
    expect((await rpc('increment', { ownerRouteId, slot: 'missing' })).status).toBe(404);
    expect((await rpc('increment', { ownerRouteId: 'missing', slot: '0' })).status).toBe(400);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/scoped-service');
    const count = page.getByTestId('page-service-count');
    const layoutCount = page.getByTestId('layout-service-count');
    await browserExpect(count).toHaveText('Count: 0');
    const sent = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') sent.push(request.postDataJSON()); });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/crpc', async route => { await gate; await route.continue(); });
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ service: { ownerRouteId, slot: '0' }, action: 'increment', state: { count: 0 } });
    release();
    await browserExpect(count).toHaveText('Count: 1');
    await browserExpect(layoutCount).toHaveText('Count: 1');
    await browserExpect(page.getByRole('status')).toHaveText('Counter updated on the server.');
    await page.unroute('**/crpc');

    await page.route('**/crpc', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) }));
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toHaveText('Could not update the counter. Try again.');
    await browserExpect(count).toHaveText('Count: 1');
    await page.unroute('**/crpc');
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await browserExpect(layoutCount).toHaveText('Count: 2');

    // The originating page exits while its service invocation stays pending.
    // Reused layout, newly injected sibling and nested consumer share ownership.
    let releaseRetained;
    const retainedGate = new Promise(resolve => { releaseRetained = resolve; });
    await page.route('**/crpc', async route => { await retainedGate; await route.continue(); });
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await browserExpect(layoutCount).toHaveText('Count: 3');
    await browserExpect(page.getByTestId('layout-service-loading')).toHaveText('1');
    await page.getByRole('link', { name: 'Sibling page', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Sibling page', exact: true })).toBeVisible();
    await browserExpect(count).toHaveText('Count: 3');
    await browserExpect(page.getByTestId('nested-service-count')).toHaveText('Count: 3');
    await browserExpect(page.getByTestId('sibling-service-loading')).toHaveText('1');
    await browserExpect(page.getByTestId('nested-service-loading')).toHaveText('1');
    releaseRetained();
    await browserExpect(page.getByTestId('layout-service-loading')).toHaveText('0');
    await browserExpect(page.getByTestId('sibling-service-loading')).toHaveText('0');
    await browserExpect(page.getByTestId('nested-service-loading')).toHaveText('0');
    await browserExpect(count).toHaveText('Count: 3');
    await page.unroute('**/crpc');
    expect(await page.evaluate(() => window.__serviceDisposals ?? 0)).toBe(0);
    await page.getByRole('link', { name: 'Counter page', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Increment', exact: true })).toBeVisible();
    await browserExpect(count).toHaveText('Count: 3');
    let rejectRetained;
    const rejectGate = new Promise(resolve => { rejectRetained = resolve; });
    await page.route('**/crpc', async route => {
      await rejectGate;
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({
        code: 'COSSACK_RPC_VALIDATION_FAILED', error: 'Invalid counter update',
      }) });
    });
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await browserExpect(layoutCount).toHaveText('Count: 4');
    await page.getByRole('link', { name: 'Sibling page', exact: true }).click();
    await browserExpect(page.getByTestId('sibling-service-loading')).toHaveText('1');
    await browserExpect(page.getByTestId('nested-service-loading')).toHaveText('1');
    await browserExpect(count).toHaveText('Count: 4');
    rejectRetained();
    await browserExpect(page.getByTestId('layout-service-loading')).toHaveText('0');
    await browserExpect(page.getByTestId('sibling-service-loading')).toHaveText('0');
    await browserExpect(page.getByTestId('nested-service-loading')).toHaveText('0');
    await browserExpect(layoutCount).toHaveText('Count: 3');
    await browserExpect(count).toHaveText('Count: 3');
    await browserExpect(page.getByTestId('nested-service-count')).toHaveText('Count: 3');
    expect(sent.filter(request => request.action === 'increment')).toHaveLength(5);
    await page.unroute('**/crpc');
    expect(await page.evaluate(() => window.__serviceDisposals ?? 0)).toBe(0);
    await page.getByRole('link', { name: 'Counter page', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Increment', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Leave the layout', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Layout-scoped service', exact: true })).toHaveCount(0);
    await browserExpect.poll(() => page.evaluate(() => window.__serviceDisposals ?? 0)).toBe(1);
    await page.goBack();
    await browserExpect(page.getByRole('button', { name: 'Increment', exact: true })).toBeVisible();
    await browserExpect(count).toHaveText('Count: 0');
    await browserExpect(layoutCount).toHaveText('Count: 0');
    expect(await page.evaluate(() => window.__serviceDisposals ?? 0)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 120000);
it('runs the protected-route recipe with real sessions, nested guards, forged state, and expiry', async () => {
  const root = await project('node', ['protected-route']);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated protected route types: ${error.stdout}\n${error.stderr}`); }
  let migrated;
  try { migrated = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'migration', 'up', '--json'],
    { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) {
    let detail;
    try { detail = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'migration', 'plan'], { cwd: root, timeout: 30000 }); }
    catch (diagnostic) { detail = diagnostic; }
    throw new Error(`Generated auth migrations: ${error.stdout}\n${error.stderr}\n${detail.stdout}\n${detail.stderr}`);
  }
  expect(JSON.parse(migrated.stdout)).toMatchObject({ ok: true });
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  await assertPortableChunks(path.join(root, 'dist/server'));
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    const code = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
    expect(code).not.toContain('Authenticated account:');
    expect(code).not.toContain('pbkdf2$');
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeId = manifest.filePathToId['/src/pages/protected-route/index.ts'];
  const server = await productionServer(root, { APP_SECRET: 'generated-protected-route-test-secret' });
  let browser;
  try {
    const { origin } = server;
    for (const route of ['/protected-route', '/protected-route/details']) {
      const denied = await fetch(origin + route, { redirect: 'manual' });
      expect(denied.status).toBe(302);
      expect(denied.headers.get('location')).toBe('/auth/login');
      expect(await denied.text()).not.toContain('Signed in as');
    }
    const call = async (componentRouteId, action, payload = [], cookie = '') => fetch(origin + '/crpc', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ componentRouteId, action, payload,
        state: { public: { email: 'forged@example.test' }, user: { id: 'forged', email: 'forged@example.test' } } }),
    });
    const guest = await call(routeId, 'verifyIdentity');
    expect(guest.status).toBe(401);
    expect(await guest.json()).toMatchObject({ code: 'COSSACK_RPC_UNAUTHENTICATED' });
    const registerId = manifest.filePathToId['/src/pages/auth/register/index.ts'];
    const registered = await call(registerId, 'register', ['Agent', 'agent@example.test', 'test-password-123']);
    expect(registered.status).toBe(200);
    expect(await registered.json()).toMatchObject({ _cossack_redirect: '/protected-route' });
    const sessionCookie = registered.headers.getSetCookie().find(value => value.startsWith('session_id='))?.split(';')[0];
    expect(sessionCookie).toBeTruthy();
    const authenticated = await call(routeId, 'verifyIdentity', [], sessionCookie);
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toMatchObject({ _cossack_return: 'Authenticated account: agent@example.test' });
    const details = await fetch(origin + '/protected-route/details', { headers: { cookie: sessionCookie } });
    expect(details.status).toBe(200);
    expect((await details.text()).replace(/<!--[\s\S]*?-->/g, '')).toContain('Welcome, Agent.');
    const fakeSession = await call(routeId, 'verifyIdentity', [], 'session_id=unrecognized');
    expect(fakeSession.status).toBe(401);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/protected-route');
    await browserExpect(page).toHaveURL(origin + '/auth/login');
    await page.getByPlaceholder('user@example.com').fill('agent@example.test');
    await page.locator('input[type="password"]').fill('test-password-123');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await browserExpect(page).toHaveURL(origin + '/protected-route');
    await browserExpect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await browserExpect(page.getByText('agent@example.test', { exact: true })).toBeVisible();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/crpc', async route => { await gate; await route.continue(); });
    await page.getByRole('button', { name: 'Verify session', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
    release();
    await browserExpect(page.getByRole('status')).toHaveText('Authenticated account: agent@example.test');
    await page.unroute('**/crpc');
    await page.getByRole('link', { name: 'Account details', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Account details', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Account', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Verify session', exact: true })).toBeVisible();

    // Revoke the real persisted session; the already-hydrated page must reject
    // its next action instead of trusting the user's cached identity/state.
    const browserSession = (await context.cookies()).find(cookie => cookie.name === 'session_id');
    expect(browserSession?.httpOnly).toBe(true);
    expect(browserSession?.secure).toBe(true);
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync('./database.sqlite');
      db.prepare('UPDATE sessions SET expires_at = ? WHERE id IN (?, ?)').run('2000-01-01T00:00:00.000Z', ${JSON.stringify(sessionCookie.slice('session_id='.length))}, ${JSON.stringify(browserSession?.value)});
      db.close();
    `], { cwd: root, timeout: 10000 });
    await page.getByRole('button', { name: 'Verify session', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toContainText('Your session ended. Sign in again.');
    await browserExpect(page.getByRole('status')).toHaveCount(0);
    expect((await call(routeId, 'verifyIdentity', [], sessionCookie)).status).toBe(401);
    const expired = await fetch(origin + '/protected-route/details', { headers: { cookie: sessionCookie }, redirect: 'manual' });
    expect(expired.status).toBe(302);
    expect(expired.headers.get('location')).toBe('/auth/login');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
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
    expect(first.state.state.count).toBe(7);
    const closed = once(first.socket, 'close');
    await fs.writeFile(page, source(9));
    await closed;
    await expect.poll(async () => {
      try { return (await connect()).state.state.count; }
      catch { return undefined; }
    }, { timeout: 15000 }).toBe(9);
    await fs.writeFile(page, source(10));
    await fs.writeFile(page, source(11));
    await expect.poll(async () => {
      try { return (await connect()).state.state.count; }
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
  const resourceFile = path.join(root, 'src/pages/resource/index.ts');
  const resourceSource = await fs.readFile(resourceFile, 'utf8');
  await fs.writeFile(resourceFile, resourceSource
    .replace('  render() {', '  onCleanup() { if (typeof window === "undefined") return; (window as any).__resourceCleanups = ((window as any).__resourceCleanups ?? 0) + 1; }\n\n  render() {')
    .replace('<main>', '<main><a id="resource-leave" href="/mutation">Leave resource</a>'));
  const pageFile = path.join(root, 'src/pages/mutation/index.ts');
  const pageSource = await fs.readFile(pageFile, 'utf8');
  await fs.writeFile(pageFile, pageSource
    .replace('const inputRules =', "const privateRejection = 'PRIVATE_SCHEMA_REJECTION_SENTINEL';\nfunction acceptMessage(value: string) { return value !== privateRejection; }\nconst inputRules =")
    .replace('message: input.string(inputRules.message!),', 'message: input.string(inputRules.message!).refine(acceptMessage),'));
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated recipe types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    const code = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
    expect(code).not.toContain('Submission received for'); // Server action body is stripped.
    expect(code).not.toContain('PRIVATE_SCHEMA_REJECTION_SENTINEL');
    expect(code).not.toContain('acceptMessage');
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeId = manifest.filePathToId['/src/pages/mutation/index.ts'];
  const server = await productionServer(root);
  let browser;
  try {
    const { origin } = server;
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
    for (const payload of [
      [{email:'a@b.test',message:'valid',canEdit:true}],
      [{email:'a@b.test',message:'valid'},'forged'],
      [{email:'a@b.test',message:'PRIVATE_SCHEMA_REJECTION_SENTINEL'}],
    ]) {
      expect(await call(payload)).toMatchObject({status:400,body:{code:'COSSACK_VALIDATION_FAILED',fieldErrors:expect.any(Object)}});
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

    const beforeHydration = rpcRequests.length;
    const resourceResponse = await page.goto(origin + '/resource');
    expect(await resourceResponse.text()).toContain('"argsKey":"[\\"all\\"]"');
    await browserExpect(page.getByText('Framework guide', { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(rpcRequests).toHaveLength(beforeHydration); // Hydration reuses SSR data without an initial RPC.
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

    // A delayed old dependency response cannot replace a newer empty result.
    let slowRoute;
    let slowArrived;
    const arrived = new Promise(resolve => { slowArrived = resolve; });
    await page.route('**/crpc', route => {
      if (route.request().postDataJSON().payload?.[0] === 'books') {
        slowRoute = route;
        slowArrived();
      } else return route.continue();
    });
    await category.selectOption('books');
    await arrived;
    await category.selectOption('other');
    await browserExpect(page.getByText('No products in this category.')).toBeVisible();
    const obsoleteResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/crpc' &&
      response.request().postDataJSON().payload?.[0] === 'books');
    await slowRoute.continue();
    await (await obsoleteResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await browserExpect(page.getByText('Framework guide', { exact: true })).toHaveCount(0);
    await browserExpect(page.getByText('No products in this category.')).toBeVisible();
    expect(rpcRequests.at(-1).state?.public ?? {}).not.toHaveProperty('category');
    await page.unroute('**/crpc');

    // Navigate within the live client while its next read is still pending.
    let abandonedRoute;
    let abandonedArrived;
    const abandoned = new Promise(resolve => { abandonedArrived = resolve; });
    await page.route('**/crpc', route => { abandonedRoute = route; abandonedArrived(); });
    await category.selectOption('tools');
    await abandoned;
    await page.getByRole('link', { name: 'Leave resource' }).click();
    await browserExpect(page.getByRole('heading', { name: 'Validated mutation' })).toBeVisible();
    expect(await page.evaluate(() => window.__resourceCleanups)).toBe(1);
    await abandonedRoute.continue();
    await page.unroute('**/crpc');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await browserExpect(page.getByRole('heading', { name: 'Validated mutation' })).toBeVisible();
    await browserExpect(page.getByRole('heading', { name: 'Read-only resource' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
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
  const root = await project('cloudflare', ['database']);
  // Defense in depth for manually configured targets: ordinary scaffold
  // planning already rejects adding Desktop to a native database recipe.
  await expect(vite(root, ['--mode', 'desktop', '--ssr', 'src/desktop/index.ts', '--outDir', 'dist/desktop']))
    .rejects.toThrow(/\.cossack\/scaffold.json: database\/d1 requires cloudflareBindings on desktop/);
}, 30000);

it('returns source-bearing capability diagnostics from CLI create/add before unsupported recipes change files', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-recipe-plan-'));
  roots.push(parent);
  const bin = path.join(repository, 'packages/cossack/bin/cossack.js');
  const rejected = async (cwd, args) => {
    try { await promisify(execFile)(process.execPath, [bin, ...args, '--json', '--yes'], { cwd, timeout: 15000 }); }
    catch (error) {
      expect(error.code).toBe(1);
      expect(error.stderr).toBe('');
      const result = JSON.parse(error.stdout);
      expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_CAPABILITY_UNSUPPORTED',
        message: expect.stringContaining('.cossack/scaffold.json: database/d1 requires cloudflareBindings on desktop') }] });
      return;
    }
    throw new Error('Unsupported recipe unexpectedly passed');
  };
  await rejected(parent, ['create', 'bad', '--adapter=cloudflare', '--preset=minimal', '--features=protected-route,desktop']);
  expect(await fs.readdir(parent)).toEqual([]);
  const root = await project('cloudflare', ['protected-route']);
  const original = await fs.readFile(path.join(root, '.cossack/scaffold.json'), 'utf8');
  await rejected(root, ['add', 'desktop']);
  expect(await fs.readFile(path.join(root, '.cossack/scaffold.json'), 'utf8')).toBe(original);
  await expect(fs.access(path.join(root, 'src/desktop/index.ts'))).rejects.toThrow();
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

it('gates typed task commits across rapid changes, sibling navigation and layout service disposal', async () => {
  const root = await project('node', ['scoped-service']);
  const serviceFile = path.join(root, 'src/services/scoped-counter.ts');
  await fs.writeFile(serviceFile, (await fs.readFile(serviceFile, 'utf8')).replace('  @Server()', `
  @Shared()
  onDispose() {
    if (typeof window !== 'undefined') {
      const observed = window as any;
      observed.__taskServiceDisposals = (observed.__taskServiceDisposals ?? 0) + 1;
      observed.__tasksAtServiceDisposal = observed.__taskRuns.map((run: any) => run.task.signal.aborted);
    }
  }
  @Server()`));
  await fs.mkdir(path.join(root, 'src/pages/scoped-service/tasks'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/scoped-service/tasks/index.ts'), `
    import { Cossack, Page, ClientTask, ServerTask, ClientState, State, Inject, Client, type TaskContext } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { ScopedCounterService } from '../../../services/scoped-counter';
    @Page({ transport: 'http' })
    export default class Tasks extends Cossack {
      @Inject(ScopedCounterService) private counter!: ScopedCounterService;
      @ClientState() query = 1;
      @ClientState() result = 'initial';
      @State() serverResult = '';
      @ServerTask<Tasks>({ track: ['serverResult'] })
      setup() { this.serverResult = 'typed-task-private-server-sentinel'; }
      @ClientTask<Tasks>({ track: ['query'] as const })
      async load(_signal: AbortSignal, task: TaskContext<Tasks>) {
        const observed = window as any;
        observed.__taskRuns ??= [];
        const run: any = { task, page: this, service: this.counter, query: this.query, cleaned: 0 };
        observed.__taskRuns.push(run);
        const value = await new Promise<string>(resolve => { run.resolve = resolve; });
        run.applied = task.commit({ result: value });
        return () => { run.cleaned++; run.abortedAtCleanup = task.signal.aborted; };
      }
      @Client() next() { this.query++; }
      render() { return html\
        \`<h2>Task ownership</h2><span data-testid="task-result">\${this.result}</span>
          <button @click=\${this.next}>Next query</button>\`; }
    }
  `);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated task types: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    expect(await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8')).not.toContain('typed-task-private-server-sentinel');
  }
  const server = await productionServer(root);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.origin + '/scoped-service/tasks');
    await browserExpect(page.getByRole('heading', { name: 'Task ownership' })).toBeVisible();
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns?.length)).toBe(1);
    await page.getByRole('button', { name: 'Next query' }).click();
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns.length)).toBe(2);
    await page.evaluate(() => window.__taskRuns[1].resolve('new'));
    await browserExpect(page.getByTestId('task-result')).toHaveText('new');
    await page.evaluate(() => window.__taskRuns[0].resolve('old'));
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns[0].applied)).toBe(false);
    await browserExpect(page.getByTestId('task-result')).toHaveText('new');
    await page.getByRole('button', { name: 'Next query' }).click();
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns.length)).toBe(3);
    await page.getByRole('link', { name: 'Sibling page', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Sibling page', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__taskRuns.every(run => run.task.signal.aborted))).toBe(true);
    expect(await page.evaluate(() => window.__taskServiceDisposals ?? 0)).toBe(0);
    await page.evaluate(() => window.__taskRuns[2].resolve('after-sibling-navigation'));
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns[2].cleaned)).toBe(1);
    expect(await page.evaluate(() => window.__taskRuns.map(run => ({ applied: run.applied, cleaned: run.cleaned, aborted: run.abortedAtCleanup })))).toEqual([
      { applied: false, cleaned: 1, aborted: true }, { applied: true, cleaned: 1, aborted: true }, { applied: false, cleaned: 1, aborted: true },
    ]);
    await page.evaluate(async () => { await window.__taskRuns[0].page.navigate('/scoped-service/tasks'); });
    await browserExpect(page.getByRole('heading', { name: 'Task ownership' })).toBeVisible();
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns.length)).toBe(4);
    expect(await page.evaluate(() => window.__taskRuns[3].service === window.__taskRuns[0].service)).toBe(true);
    await page.getByRole('link', { name: 'Leave the layout', exact: true }).click();
    await browserExpect.poll(() => page.evaluate(() => window.__taskServiceDisposals)).toBe(1);
    expect(await page.evaluate(() => window.__tasksAtServiceDisposal)).toEqual([true, true, true, true]);
    await page.evaluate(() => window.__taskRuns[3].resolve('after-layout-disposal'));
    await browserExpect.poll(() => page.evaluate(() => window.__taskRuns[3].cleaned)).toBe(1);
    expect(await page.evaluate(() => ({ applied: window.__taskRuns[3].applied, value: window.__taskRuns[3].page.result, aborted: window.__taskRuns[3].abortedAtCleanup }))).toEqual({ applied: false, value: 'initial', aborted: true });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 120000);

async function developmentServer(root) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'vite';
    import { getRequestListener } from '@hono/node-server';
    const runtimes = new Set();
    // The harness serves the generated app through Vite's real SSR loader.
    // Node scaffold currently has no first-party Vite HTTP middleware (CF-10).
    const bridge = {
      name: 'state-example-ssr-harness',
      configureServer(viteServer) {
        const handle = getRequestListener(async request => {
          const { app, env, runtime } = await viteServer.ssrLoadModule('/src/index.ts');
          runtimes.add(runtime);
          env.APP_URL = new URL(request.url).origin;
          return app.fetch(request, env);
        });
        viteServer.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url, 'http://localhost').pathname;
          if (['/state-example', '/crpc'].includes(pathname)) return handle(request, response);
          next();
        });
      },
    };
    const server = await createServer({ root: process.cwd(), server: { port: 0, host: '127.0.0.1' }, plugins: [bridge] });
    await server.listen();
    console.log('STATE_DEV_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
    process.on('message', async message => { if (message === 'STOP') { for (const runtime of runtimes) await runtime.dispose(); await server.close(); process.exit(0); } });
  `], { cwd: root, env: { ...process.env, NODE_ENV: 'development', VITEST: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  const close = async () => {
    if (child.connected) child.send('STOP');
    else child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    expect({ code, signal }, output).toEqual({ code: 0, signal: null });
  };
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /STATE_DEV_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 20000 }).toBeTruthy();
  } catch (error) { await close(); throw error; }
  return { origin: /STATE_DEV_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1], close, output: () => output };
}

it('owns optimistic rollback across overlapping HTTP/SSE browser calls', async () => {
  const root = await project('node');
  for (const transport of ['http', 'sse']) {
    const directory = path.join(root, 'src/pages/optimistic', transport);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'index.ts'), `
      import { Cossack, Page, State, Store, ClientState, ClientStore, Server, Client, Optimistic, optimistic, input } from '@cossackframework/core';
      import { html } from '@cossackframework/renderer';
      @Page({ transport: '${transport}' }) export default class OptimisticPage extends Cossack {
        @State() count = 0;
        @Store() cart = { rows: [1] };
        @ClientState() local = 0;
        @ClientState() accepted = 0;
        @ClientStore() items: string[] = [];
        @Optimistic('append') previewAppend(value: { value: number; label: string }) {
          const edits = optimistic<OptimisticPage>(this); edits.increment('accepted', 1); edits.append('items', value.label);
        }
        @Server({ input: input.object({ value: input.number({ min: 0 }), label: input.string(), delay: input.number({ min: 0 }) }) })
        async append(value: { value: number; label: string; delay: number }) { await new Promise(resolve => setTimeout(resolve, value.delay)); return value.label; }
        @Optimistic('edit') preview(value: { value: number }) { this.count = value.value; this.cart.rows.push(value.value); this.local = value.value; }
        @Server({ input: input.object({ value: input.number({ min: 0 }), delay: input.number({ min: 0 }) }) })
        async edit(value: { value: number; delay: number }) {
          await new Promise(resolve => setTimeout(resolve, value.delay));
          this.count = value.value * 10; this.cart.rows.push(this.count); return this.count;
        }
        @Client() onMount() { (window as any).__optimistic = this; }
        @Client() editLocal(value: number) { this.count = value; }
        render() { return html\`<main><span data-testid="count">\${this.count}</span><span data-testid="rows">\${this.cart.rows.join(',')}</span><span data-testid="local">\${this.local}</span><span data-testid="loading">\${this.loading.edit || 0}</span><span data-testid="accepted">\${this.accepted}</span><span data-testid="items">\${this.items.join(',')}</span><span data-testid="append-loading">\${this.loading.append || 0}</span></main>\`; }
      }
    `);
  }
  await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, maxBuffer: 1024 * 1024 });
  await vite(root, []); await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const server = await productionServer(root);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    for (const transport of ['http', 'sse']) {
      await page.goto(`${server.origin}/optimistic/${transport}`);
      await page.waitForFunction(() => !!window.__optimistic);
      if (transport === 'sse') await page.waitForFunction(() => window.__optimistic.realtime.sse.state === 'open');
      const dispatched = [];
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/crpc**', async route => {
        const body = route.request().postDataJSON(); dispatched.push(body);
        if (body.action === 'edit' && body.payload[0].value < 0) await held;
        await route.continue();
      });
      await page.evaluate(() => {
        window.__old = window.__optimistic.edit({ value: -1, delay: 0 }).catch(error => { window.__oldError = error.code; });
        window.__next = window.__optimistic.edit({ value: 2, delay: 30 });
      });
      await browserExpect(page.getByTestId('count')).toHaveText('20');
      await browserExpect(page.getByTestId('loading')).toHaveText('1');
      expect(dispatched.map(body => body.state.count)).toEqual([0, 0]);
      for (const body of dispatched) expect(body.state).not.toHaveProperty('local');
      release();
      await page.evaluate(async () => { await window.__old; await window.__next; });
      expect(await page.evaluate(() => window.__oldError)).toBe('COSSACK_VALIDATION_FAILED');
      await browserExpect(page.getByTestId('count')).toHaveText('20');
      await browserExpect(page.getByTestId('rows')).toHaveText('1,20');
      await browserExpect(page.getByTestId('local')).toHaveText('2');
      await browserExpect(page.getByTestId('loading')).toHaveText('0');
      await page.unroute('**/crpc**');
      await page.evaluate(() => {
        window.__pending = window.__optimistic.edit({ value: 3, delay: 75 });
        window.__optimistic.editLocal(99);
      });
      await page.evaluate(async () => { await window.__pending; });
      await browserExpect(page.getByTestId('count')).toHaveText('99');
      await browserExpect(page.getByTestId('loading')).toHaveText('0');
      for (const [iteration, order] of [['1', 'old-first'], ['2', 'new-first']]) {
        let releaseOld, releaseNext;
        const oldHeld = new Promise(resolve => { releaseOld = resolve; });
        const nextHeld = new Promise(resolve => { releaseNext = resolve; });
        const sent = [];
        await page.route('**/crpc**', async route => {
          const body = route.request().postDataJSON(); sent.push(body);
          if (body.action === 'append') await (body.payload[0].value < 0 ? oldHeld : nextHeld);
          await route.continue();
        });
        await page.evaluate(() => {
          window.__oldAppend = window.__optimistic.append({ value: -1, label: 'old', delay: 0 }).catch(error => { window.__appendError = error.code; });
          window.__nextAppend = window.__optimistic.append({ value: 1, label: 'next', delay: 0 });
        });
        await expect.poll(() => sent.length).toBe(2);
        await browserExpect(page.getByTestId('accepted')).toHaveText(String(Number(iteration) + 1));
        await browserExpect(page.getByTestId('append-loading')).toHaveText('2');
        for (const body of sent) { expect(body.state).not.toHaveProperty('accepted'); expect(body.state).not.toHaveProperty('items'); }
        if (order === 'old-first') {
          releaseOld(); await page.evaluate(async () => { await window.__oldAppend; });
          await browserExpect(page.getByTestId('accepted')).toHaveText(iteration);
          await browserExpect(page.getByTestId('items')).toHaveText('next');
          await browserExpect(page.getByTestId('append-loading')).toHaveText('1');
          releaseNext(); await page.evaluate(async () => { await window.__nextAppend; });
        } else {
          releaseNext(); await page.evaluate(async () => { await window.__nextAppend; });
          await browserExpect(page.getByTestId('accepted')).toHaveText('3');
          await browserExpect(page.getByTestId('append-loading')).toHaveText('1');
          releaseOld(); await page.evaluate(async () => { await window.__oldAppend; });
        }
        expect(await page.evaluate(() => window.__appendError)).toBe('COSSACK_VALIDATION_FAILED');
        await browserExpect(page.getByTestId('accepted')).toHaveText(iteration);
        await browserExpect(page.getByTestId('items')).toHaveText(Array(Number(iteration)).fill('next').join(','));
        await browserExpect(page.getByTestId('append-loading')).toHaveText('0');
        await page.unroute('**/crpc**');
      }
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); await server.close(); }
}, 120000);

it.each(['development', 'production'])('runs state documentation examples and diagnostics in a published %s app', async mode => {
  const root = await project('node');
  const pageFile = path.join(root, 'src/pages/state-example/index.ts');
  await fs.mkdir(path.dirname(pageFile), { recursive: true });
  const source = await fs.readFile(path.join(repository, 'docs/examples/state-mechanisms.ts'), 'utf8');
  await fs.writeFile(pageFile, source.replace('    render() {', `
    onMount() { (window as any).__stateExample = this; }
    render() {`));
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated state types: ${error.stdout}\n${error.stderr}`); }
  if (mode === 'production') {
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  }
  const server = mode === 'development' ? await developmentServer(root) : await productionServer(root);
  let browser;
  try {
    const response = await fetch(server.origin + '/state-example');
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const initial = JSON.parse(body.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]);
    const state = initial;
    expect(state.public).toMatchObject({ count: 1, profile: { name: 'Ada' }, cart: { lines: [{ quantity: 1, price: 3 }], tags: [] } });
    for (const name of ['selected', 'panelOpen', 'draft', 'total', 'record']) expect(state.public).not.toHaveProperty(name);
    expect(state.serverResources.record).toEqual({ argsKey: '[1]', value: { id: 1, label: 'Record 1' } });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const warnings = [];
    const errors = [];
    const requests = [];
    page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') requests.push(request.postDataJSON()); });
    await page.goto(server.origin + '/state-example');
    await page.waitForFunction(() => window.__stateExample);
    await browserExpect(page.getByTestId('profile-name')).toHaveText('Ada');
    await page.getByRole('button', { name: 'Mutate shallow state', exact: true }).click();
    expect(await page.evaluate(() => window.__stateExample.profile.name)).toBe('Unobserved');
    await browserExpect(page.getByTestId('profile-name')).toHaveText('Ada');
    await page.getByRole('button', { name: 'Replace profile', exact: true }).click();
    await browserExpect(page.getByTestId('profile-name')).toHaveText('Grace');
    await page.getByRole('button', { name: 'Edit nested cart', exact: true }).click();
    await browserExpect(page.getByTestId('cart-total')).toHaveText('6');
    await browserExpect(page.getByTestId('cart-tags')).toHaveText('edited');
    await page.getByRole('button', { name: 'Edit local draft', exact: true }).click();
    await browserExpect(page.getByTestId('draft-tags')).toHaveText('first,next');
    await browserExpect(page.getByTestId('panel-open')).toHaveText('true');
    await page.getByRole('button', { name: 'Save count', exact: true }).click();
    await browserExpect(page.getByTestId('state-count')).toHaveText('2');
    await browserExpect(page.getByTestId('draft-tags')).toHaveText('first,next');
    await page.getByRole('button', { name: 'Next record', exact: true }).click();
    await browserExpect(page.getByTestId('record-label')).toHaveText('Record 2');
    await browserExpect.poll(() => requests.length).toBe(2);
    for (const request of requests) {
      expect(request.state).toHaveProperty('cart');
      for (const name of ['selected', 'panelOpen', 'draft', 'total']) expect(request.state).not.toHaveProperty(name);
    }
    await page.evaluate(() => {
      window.__stateExample.profile.extra = new Map();
      window.__stateExample.getPublicState();
    });
    if (mode === 'development') {
      expect(warnings.some(message => message.includes("StateMechanisms at profile.name"))).toBe(true);
      expect(warnings.some(message => message.includes("StateMechanisms field 'profile' during public state: state.profile.extra (Map)"))).toBe(true);
    } else expect(warnings.filter(message => message.startsWith('[Cossack]'))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 120000);


it('reconciles component and service mutations after their committed replies are lost', async () => {
  const root = await project('node'); await writeWorkerOptimisticRecovery(root);
  // Process-owned records survive the fresh component instances for HTTP RPC.
  // Native Worker acceptance uses the same UI against actual D1 records.
  await fs.writeFile(path.join(root, 'src/private-optimistic-recovery.ts'), `
    const records = new Map<string, {count:number;mutations:number;reads:number}>();
    function record(scope:string) {
      let value = records.get(scope);
      if (!value) { value = {count:0,mutations:0,reads:0}; records.set(scope,value); }
      return value;
    }
    export async function readCounter(scope:string) { const value=record(scope); value.reads++; return {count:value.count}; }
    export async function incrementCounter(scope:string) { const value=record(scope); value.count++; value.mutations++; return {count:value.count}; }
    export async function auditCounter(scope:string) { return {...record(scope)}; }
  `);
  try { await promisify(execFile)('pnpm', ['exec','tsc','--noEmit'], {cwd:root,timeout:30000,maxBuffer:1024*1024}); }
  catch(error) { throw new Error(error.stdout + '\n' + error.stderr); }
  await vite(root, []); await vite(root, ['--ssr','src/index.ts','--outDir','dist/server']);
  const server = await productionServer(root);
  try {
    await checkWorkerOptimisticRecovery({fetch:(path, init)=>fetch(server.origin+path,init)}, new URL(server.origin), 'session_id=test');
  } finally { await server.close(); }
}, 120000);

it('orders SSE action broadcasts and delayed replies against newer server snapshots', async () => {
  const root=await project('node'); await writeWorkerOptimisticSse(root);
  await fs.writeFile(path.join(root,'src/private-sse-optimistic.ts'), `
    let count=0; const operations:Array<{id:string}>=[];
    export async function read(_db?:unknown) { return {count}; }
    export async function commit(_db:unknown,id:string) { operations.push({id}); count++; return {count}; }
    export async function replace(_db:unknown,value:number) { count=value; return count; }
    export async function waitForRelease(_db:unknown,_id:string) { throw new Error('Node test only uses the failure stream'); }
    export async function audit(_db?:unknown) { return {count,operations:operations.map(row=>({...row}))}; }
  `);
  const pageFile=path.join(root,'src/pages/resource-check/optimistic-sse/index.ts');
  await fs.writeFile(pageFile,(await fs.readFile(pageFile,'utf8')).replaceAll('this.env.DB','undefined').replace('Cossack<Env>','Cossack'));
  await fs.writeFile(path.join(root,'src/pages/api/rpc-check/optimistic-sse.ts'), `
    import type {Context} from 'hono';
    import {audit} from '../../../private-sse-optimistic';
    export const GET=async(c:Context)=>c.json(await audit());
  `);
  try { await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000,maxBuffer:1024*1024}); }
  catch(error) { throw new Error(error.stdout+'\n'+error.stderr); }
  await vite(root,[]); await vite(root,['--ssr','src/index.ts','--outDir','dist/server']);
  await assertPortableChunks(path.join(root,'dist/server'));
  const server=await productionServer(root);
  try { await checkWorkerOptimisticSse({fetch:(route,init)=>fetch(server.origin+route,init)},new URL(server.origin),'session_id=test',{native:false}); }
  finally { await server.close(); }
},120000);


it('retains confirmed optimistic component and service yields through failures and cancellation', async () => {
  const root=await project('node');await writeWorkerOptimisticStreams(root);
  await fs.writeFile(path.join(root,'src/private-optimistic-streams.ts'), `
    const records=new Map<string,{count:number;mutations:number;released:number}>();
    function record(scope:string) {
      let value=records.get(scope);if(!value){value={count:0,mutations:0,released:0};records.set(scope,value);}return value;
    }
    export async function audit(scope:string){return {...record(scope)};}
    export async function commit(scope:string){const value=record(scope);value.count++;value.mutations++;return {count:value.count};}
    export async function release(scope:string){record(scope).released=1;}
    export async function waitForRelease(scope:string){
      const deadline=Date.now()+15000;
      while(!record(scope).released){if(Date.now()>deadline)throw new Error('Test did not release stream');await new Promise(resolve=>setTimeout(resolve,10));}
    }
  `);
  await fs.writeFile(path.join(root,'src/private/optimistic-stream.server.ts'), `
    import {audit,commit} from '../private-optimistic-streams';
    export async function readCounter(){return {count:(await audit('docs-example')).count};}
    export async function incrementCounter(){return commit('docs-example');}
  `);
  try {await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000,maxBuffer:1024*1024});}
  catch(error){throw new Error(error.stdout+'\n'+error.stderr);}
  await vite(root,[]);await vite(root,['--ssr','src/index.ts','--outDir','dist/server']);
  await assertPortableChunks(path.join(root,'dist/server'));
  const server=await productionServer(root);
  try {await checkWorkerOptimisticStreams({fetch:(route,init)=>fetch(server.origin+route,init)},new URL(server.origin),'session_id=test');}
  finally {await server.close();}
},120000);

it.each(['node', 'cloudflare'])('integrates the DataTable with URL state and server resources in generated %s', async adapter => {
  const backend=await createDataTableBackend();
  try {
    const root=await project(adapter,['ui']);await writeDataTableAcceptance(root,backend.origin);
    try { await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000,maxBuffer:1024*1024}); }
    catch(error){throw new Error(`Generated DataTable types: ${error.stdout}\n${error.stderr}`);}
    await vite(root,[]);
    if(adapter==='node')await vite(root,['--ssr','src/index.ts','--outDir','dist/server']);
    const browser=await chromium.launch({headless:true});
    try {
      if(adapter==='node'){
        const runtime=await productionServer(root);
        try{await checkDataTableBrowser(browser,runtime.origin,backend);}finally{await runtime.close();}
      }else{
        const harness=createTestHarness({root,workers:[{configPath:path.join(root,'dist/ssr/wrangler.json')}]});
        try{const {url}=await harness.listen();await checkDataTableBrowser(browser,new URL(url).origin,backend);}finally{await harness.close();}
      }
    }finally{await browser.close();}
  }finally{await backend.close();}
},120000);
