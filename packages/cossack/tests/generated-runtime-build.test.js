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
async function productionServer(root, environment = {}) {
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
it('runs inferred client RPC views for HTTP/SSE methods, function fields, and scoped services', async () => {
  const root = await project('node');
  const write = async (relative, source) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), source);
  };
  await write('src/services/rpc-report.ts', `
    import { Server, Service, CossackService } from '@cossackframework/core';
    @Service() export class ReportService extends CossackService {
      @Server({ input: { title: { required: true } } }) async *files(input: { title: string; nested: { files: File[] } }) {
        yield await input.nested.files[0].text(); await new Promise(resolve => setTimeout(resolve, 500)); return input.nested.files[0].name;
      }
      @Server() native() { return new Response(new Uint8Array([0, 255, 128]), { headers: { 'Content-Type': 'application/octet-stream', 'X-Native': 'service' } }); }
      @Server() report = async function* (label: string) {
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
    import { Cossack, Page, Server, Client, ClientState, Inject, rpc$ } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { ReportService } from '../../../services/rpc-report';
    @Page({ transport: '${transport}' })
    export default class RpcPage extends Cossack {
      @Inject(ReportService) private report!: ReportService;
      @ClientState() output = '';
      @ClientState() failure = '';
      @ClientState() pending = false;
      @ClientState() uploadFilesProgress = 0;
      @Server({ input: { title: { required: true } } }) async *uploadFiles(input: { title: string; nested: { files: File[] } }) {
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
      @Server() field = async function* (amount: number) {
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
    import { cookie, flash, flashInput, Server, Service, CossackService } from '@cossackframework/core';
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
  await fs.writeFile(serviceFile, (await fs.readFile(serviceFile, 'utf8')).replace('  @Server()', `
  @Shared()
  onDispose() {
    if (typeof window !== 'undefined') {
      const observed = window as Window & { __serviceDisposals?: number };
      observed.__serviceDisposals = (observed.__serviceDisposals ?? 0) + 1;
    }
  }
  @Server()`));
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

    await page.getByRole('link', { name: 'Sibling page', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Sibling page', exact: true })).toBeVisible();
    await browserExpect(count).toHaveText('Count: 2');
    await browserExpect(page.getByTestId('nested-service-count')).toHaveText('Count: 2');
    expect(await page.evaluate(() => window.__serviceDisposals ?? 0)).toBe(0);
    await page.getByRole('link', { name: 'Counter page', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Increment', exact: true })).toBeVisible();
    await browserExpect(count).toHaveText('Count: 2');
    expect(await page.evaluate(() => window.__serviceDisposals ?? 0)).toBe(0);
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
