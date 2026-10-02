import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '@cossackframework/scaffold';
import { deployCommand } from '../src/commands/deploy.js';
import { createTestHarness } from 'wrangler';
import { readRpcStream } from '../../core/dist/index.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
let parent;
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (parent) await fs.rm(parent, { recursive: true, force: true });
});

it('builds a generated staging app and validates deployment without uploading', async () => {
  vi.stubEnv('VITEST', '');
  vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-deploy-integration-'));
  const { projectDir } = await createApp('app', {
    cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false,
  });
  // Keep Vite's temporary config module inside this fixture so package imports
  // resolve from this project, using the installed workspace dependencies.
  const modules = path.join(projectDir, 'node_modules');
  await fs.mkdir(modules);
  for (const name of await fs.readdir(path.join(repository, 'node_modules'))) {
    if (name.startsWith('.') || name === '@cossackframework') continue;
    await fs.symlink(path.join(repository, 'node_modules', name), path.join(modules, name), 'junction');
  }
  await fs.mkdir(path.join(modules, '@cossackframework'));
  for (const name of ['framework', 'core', 'renderer', 'auth', 'database', 'ui', 'scaffold']) {
    await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
  }
  await fs.mkdir(path.join(projectDir, 'src/services'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'src/services/RenderCounter.ts'), `
    import { CossackService, Service, State } from '@cossackframework/core';
    @Service()
    export class RenderCounter extends CossackService<{ APP_URL: string }> {
      @State() count = 0;
      @State() target = '';
      record() { this.count++; this.target = this.env.APP_URL + this.c.req.path; }
    }
  `);
  await fs.writeFile(path.join(projectDir, 'src/pages/layout.ts'), `
    import { Cossack, Inject, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { RenderCounter } from '../services/RenderCounter';
    @Page({ services: [RenderCounter] })
    export default class Layout extends Cossack {
      @Inject(RenderCounter) counter!: RenderCounter;
      render() { return html\`<aside>render count: \${this.counter.count}</aside>\${this.children}\`; }
    }
  `);
  const homeSource = `
    import { Cossack, Inject, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { RenderCounter } from '../services/RenderCounter';
    @Page({ transport: 'http', ssg: true })
    export default class Home extends Cossack {
      @Inject(RenderCounter) counter!: RenderCounter;
      async init() { this.counter.record(); }
      render() { return html\`<main>Welcome to Cossack: \${this.counter.target}</main>\`; }
    }
  `;
  await fs.writeFile(path.join(projectDir, 'src/pages/index.ts'), homeSource);
  await fs.mkdir(path.join(projectDir, 'src/pages/live'));
  await fs.writeFile(path.join(projectDir, 'src/pages/live/index.ts'), homeSource
    .replace('ssg: true', 'ssg: false').replace("'../services/RenderCounter'", "'../../services/RenderCounter'"));
  await fs.mkdir(path.join(projectDir, 'src/pages/stream'));
  await fs.writeFile(path.join(projectDir, 'src/pages/stream/index.ts'), `
    import { Cossack, ClientVisibleError, getRequestContext, Inject, Page, Server, State } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { config } from '@cossackframework/framework/config';
    import { sql } from '@cossackframework/database';
    import { RenderCounter } from '../../services/RenderCounter';
    let runs = 0;
    let closed = 0;
    @Page({ transport: 'sse' })
    export default class StreamPage extends Cossack {
      @Inject(RenderCounter) counter!: RenderCounter;
      @State() count = 0;
      render() { return html\`<main>streaming</main>\`; }
      @Server()
      async *generate() {
        runs++;
        try {
          for (let step = 0; step < 2; step++) {
            await new Promise(resolve => setTimeout(resolve, 1));
            this.count++;
            this.counter.record();
            const query = await sql\`SELECT \${this.count} AS value\`;
            yield { dbCount: query.rows[0].value, count: this.count, serviceCount: this.counter.count, run: runs,
              url: config('app.url'), path: getRequestContext()?.req.path };
          }
          return 'complete';
        } finally { closed++; }
      }
      @Server()
      status() { return { runs, closed }; }
      @Server()
      async *slow() {
        runs++;
        try { yield 'started'; await new Promise(resolve => setTimeout(resolve, 200)); yield 'late'; }
        finally { closed++; }
      }
      @Server()
      async *fail() { yield 'started'; throw new ClientVisibleError('Prompt is required'); }
    }
  `);
  await fs.mkdir(path.join(projectDir, 'src/pages/(private)/private'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'src/pages/(private)/layout.ts'), `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page({ middlewares: [async (c, next) => {
      if (c.req.header('x-group-access') !== 'yes') return c.text('layout denied', 401);
      await next(); c.header('x-layout-policy', 'ran');
    }] })
    export default class PrivateLayout extends Cossack { render() { return html\`\${this.children}\`; } }
  `);
  await fs.writeFile(path.join(projectDir, 'src/pages/(private)/private/index.ts'), `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page({ middlewares: [async (c, next) => {
      if (c.req.header('x-role') !== 'admin') return c.text('page denied', 403);
      await next(); c.header('x-page-policy', 'ran');
    }] })
    export default class PrivatePage extends Cossack { render() { return html\`<main>private SSR</main>\`; } }
  `);
  await fs.writeFile(path.join(projectDir, 'src/bootstrap/middlewares.ts'), `
    import type { MiddlewareHandler } from 'hono';
    import { AsyncLocalStorage } from 'node:async_hooks';
    import { createORM } from '@cossackframework/database';
    import { createAsyncLocalScope } from '@cossackframework/database/adapter';
    import { d1 } from '@cossackframework/database/cloudflare';
    import { ormMiddleware } from '@cossackframework/database/cossack';
    const database = ormMiddleware(async c => {
      const adapter = await d1(c.env.DB);
      return createORM({ adapter: { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) }, entities: [] });
    });
    const middlewares: MiddlewareHandler[] = [async (c, next) => {
      if (c.req.path.startsWith('/guarded') && c.req.header('x-role') !== 'admin') return c.text('global denied', 401);
      if (c.req.path === '/crpc') await database(c, next); else await next();
      c.header('x-worker-pipeline', 'ran');
    }];
    export default middlewares;
  `);
  for (const [directory, body] of [['private', 'private static body'], ['guarded', 'guarded static body']]) {
    await fs.mkdir(path.join(projectDir, 'public', directory), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'public', directory, 'index.html'), `<main>${body}</main>`);
    await fs.writeFile(path.join(projectDir, 'public', directory, 'record.txt'), `${body} file`);
  }
  const configPath = path.join(projectDir, 'wrangler.jsonc');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.env = { staging: { vars: { APP_URL: 'https://staging.example.test', APP_LOCALE: 'en' }, secrets: config.secrets,
    d1_databases: [{ binding: 'DB', database_name: 'stream-test-database' }] } };
  await fs.writeFile(configPath, JSON.stringify(config));
  await fs.copyFile(path.join(projectDir, '.dev.vars'), path.join(projectDir, '.dev.vars.staging'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exitCode = await deployCommand([], {
    cwd: projectDir, flags: { env: 'staging', json: true }, dryRun: true,
  });
  const result = JSON.parse(log.mock.calls[0][0]);
  expect(exitCode, JSON.stringify(result.diagnostics)).toBe(0);
  expect(log).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ ok: true, data: {
    environment: 'staging', worker: 'app-staging', dryRun: true,
    steps: [{ name: 'types', exitCode: 0 }, { name: 'build', exitCode: 0 }, { name: 'deploy', exitCode: 0 }],
  } });
  const artifact = JSON.parse(await fs.readFile(result.data.artifact, 'utf8'));
  expect(artifact.vars.APP_URL).toBe('https://staging.example.test');
  expect(artifact.vars).not.toHaveProperty('APP_SECRET');
  expect(await fs.readFile(path.join(projectDir, 'worker-configuration.d.ts'), 'utf8')).toContain('APP_SECRET');
  expect(artifact.assets.run_worker_first).toBe(true);
  const staticHome = await fs.readFile(path.join(projectDir, 'dist/client/index.html'), 'utf8');
  expect(staticHome).not.toContain('ssg-user');
  const readHydration = output => JSON.parse(output.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)[1]);
  expect(readHydration(staticHome)._layout_stack[0].state.services).toEqual({
    '0': { count: 1, target: 'https://staging.example.test/' },
  });
  // Run the actual generated, built Worker with its asset routing under
  // workerd. No remote bindings, account calls, or uploads are involved.
  const server = createTestHarness({ root: projectDir, workers: [{ configPath: result.data.artifact }] });
  try {
    const { url: serverUrl } = await server.listen();
    const home = await server.fetch('/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Welcome to Cossack');
    expect(home.headers.get('x-worker-pipeline')).toBe('ran');
    // The same published layout service must work in real SSR as well as the
    // Node build renderer; separate requests cannot inherit service mutations.
    for (let request = 0; request < 2; request++) {
      const live = await server.fetch('/live');
      expect(live.status).toBe(200);
      expect(readHydration(await live.text())._layout_stack[0].state.services).toEqual({
        '0': { count: 1, target: 'https://staging.example.test/live' },
      });
    }
    const streamPage = await server.fetch('/stream');
    const streamState = readHydration(await streamPage.text());
    const invoke = action => server.fetch('/crpc', {
      method: 'POST', headers: { origin: serverUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentRouteId: streamState.componentRouteId, scopeKey: streamState.scopeKey, action, payload: [] }),
    });
    const action = await invoke('generate');
    expect(action.status).toBe(200);
    const frames = [];
    for await (const frame of readRpcStream(action)) frames.push(frame);
    expect(frames).toMatchObject([
      { type: 'yield', state: { count: 1 }, value: { dbCount: 1, count: 1, serviceCount: 1, run: 1, url: 'https://staging.example.test', path: '/crpc' } },
      { type: 'yield', state: { count: 2 }, value: { dbCount: 2, count: 2, serviceCount: 2, run: 1 } },
      { type: 'done', value: 'complete', state: { count: 2 } },
    ]);
    expect(new Set(frames.map(frame => frame.requestId)).size).toBe(1);
    expect(frames[0].requestId).toBe(action.headers.get('X-Cossack-Request-Id'));
    expect((await (await invoke('status')).json())._cossack_return).toEqual({ runs: 1, closed: 1 });
    const failedAction = await invoke('fail');
    const failedFrames = [];
    for await (const frame of readRpcStream(failedAction)) failedFrames.push(frame);
    expect(failedFrames.at(-1)).toMatchObject({ type: 'error', code: 'COSSACK_RPC_CLIENT_ERROR', message: 'Prompt is required' });
    // Exercise cancellation through the real HTTP listener, including a
    // generator awaiting request-local I/O when the browser disconnects.
    const slow = await fetch(new URL('/crpc', serverUrl), {
      method: 'POST', headers: { origin: serverUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentRouteId: streamState.componentRouteId, scopeKey: streamState.scopeKey, action: 'slow', payload: [] }),
    });
    expect(slow.status).toBe(200);
    const slowReader = slow.body.getReader();
    expect(new TextDecoder().decode((await slowReader.read()).value)).toContain('started');
    await slowReader.cancel();
    await vi.waitFor(async () => {
      expect((await (await invoke('status')).json())._cossack_return).toEqual({ runs: 2, closed: 2 });
    }, { timeout: 2000, interval: 50 });
    for (const url of ['/private/', '/private/record.txt', '/private/index.html']) {
      const denied = await server.fetch(url, { redirect: 'manual' });
      expect(denied.status, url).toBe(401);
      expect(await denied.text()).toBe('layout denied');
      const member = await server.fetch(url, { redirect: 'manual', headers: { 'x-group-access': 'yes' } });
      expect(member.status, url).toBe(403);
      expect(await member.text()).toBe('page denied');
    }
    for (const url of ['/guarded/', '/guarded/index.html', '/guarded/record.txt']) {
      const denied = await server.fetch(url, { redirect: 'manual' });
      expect(denied.status, url).toBe(401);
      expect(await denied.text()).toBe('global denied');
    }
    const authorized = await server.fetch('/private/', { headers: { 'x-role': 'admin', 'x-group-access': 'yes' } });
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain('private static body');
    expect(authorized.headers.get('x-worker-pipeline')).toBe('ran');
    expect(authorized.headers.get('x-page-policy')).toBe('ran');
    expect(authorized.headers.get('x-layout-policy')).toBe('ran');
    const clientManifest = JSON.parse(await fs.readFile(path.join(projectDir, 'dist/client/.vite/manifest.json'), 'utf8'));
    const client = await server.fetch(`/${clientManifest['src/client/entry-client.ts'].file}`);
    expect(client.status).toBe(200);
    expect(client.headers.get('x-worker-pipeline')).toBe('ran');
    expect((await client.text()).length).toBeGreaterThan(0);
  } finally { await server.close(); }
  // A protected SSG route must fail the real Vite build before any generated
  // page HTML or sitemap is published. The previously successful output is
  // cleared by Vite rather than surviving as a deployable stale page.
  await fs.writeFile(path.join(projectDir, 'src/bootstrap/middlewares.ts'), `
    export default [async (c, next) => {
      if (c.req.path === '/') return c.redirect('/login');
      await next();
    }];
  `);
  log.mockClear();
  const failedCode = await deployCommand([], { cwd: projectDir, flags: { env: 'staging', json: true }, dryRun: true });
  expect(failedCode).toBe(1);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ ok: false,
    diagnostics: [{ code: 'COSSACK_DEPLOY_BUILD_FAILED' }] });
  await expect(fs.access(path.join(projectDir, 'dist/client/index.html'))).rejects.toThrow();
  await expect(fs.access(path.join(projectDir, 'dist/client/sitemap.xml'))).rejects.toThrow();
}, 60_000);
