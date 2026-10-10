// Generated feature recipes: mutation/resource UI, database and Desktop targets,
// capability diagnostics, typed task commits and packaged application guidance.
// Split from one file so the four groups run in parallel; shared helpers live in
// fixtures/generated-app.js.
import { writeTestUtilitiesAcceptance, checkTestUtilitiesAcceptance } from './fixtures/test-utils-acceptance.js';
import { verifyDesktopTraceReaders } from './fixtures/desktop-trace-readers.js';
import { writeAuthPrimitivesAcceptance, checkAuthPrimitives } from './fixtures/auth-primitives-acceptance.js';
import { writeSessionDashboardAcceptance, checkSessionDashboard } from './fixtures/session-dashboard-acceptance.js';
import { writeOldInputAcceptance, checkOldInputAcceptance } from './fixtures/old-input-acceptance.js';
import { writeAuthSseAcceptance, checkAuthSseAcceptance } from './fixtures/auth-sse-acceptance.js';
import { writeAuthFormsAcceptance, checkAuthFormsAcceptance } from './fixtures/auth-forms-acceptance.js';
import { createOAuthFixtureProvider, writeOAuthReplayAcceptance, checkOAuthReplay } from './fixtures/oauth-replay-acceptance.js';
import { verifyNodeDevelopmentApplication } from './fixtures/node-development-acceptance.js';
import { verifyDevelopmentTraceApplication } from './fixtures/development-trace-acceptance.js';
import { verifyApplicationGuidance } from './fixtures/application-guidance-acceptance.js';
import { createDataTableBackend, writeDataTableAcceptance, checkDataTableBrowser } from './fixtures/data-table-acceptance.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { promisify } from 'node:util';
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
import { cleanupRoots, project, sharedApps, run, cossack, typecheck, vite, assertPortableChunks, productionServer, repository, trackRoot } from './fixtures/generated-app.js';

afterEach(cleanupRoots);

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
  trackRoot(parent);
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

it.skipIf(process.env.COSSACK_DESKTOP_ACCEPTANCE!=='1')('executes a generated Desktop application in Electron with native RPC and persistence',async()=>{
  const {writeDesktopRuntimeAcceptance,verifyDesktopRuntimeApplication}=await import('./fixtures/desktop-runtime-acceptance.js');
  const root=await project('node',['desktop']);
  await writeDesktopRuntimeAcceptance(root);
  try{await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000});}
  catch(error){throw new Error(`${error.stdout}\n${error.stderr}`);}
  await vite(root,[]);
  await vite(root,['--mode','desktop','--ssr','src/desktop/index.ts','--outDir','dist/desktop']);
  await assertPortableChunks(path.join(root,'dist/desktop'));
  await verifyDesktopRuntimeApplication(root);
},120000);

it.skipIf(process.env.COSSACK_DESKTOP_ACCEPTANCE!=='1').each([false,true])('executes Desktop development with the native Vite runner and shared traces (CLI: %s)',async launcher=>{
  const {writeDesktopRuntimeAcceptance,verifyDesktopDevelopmentApplication}=await import('./fixtures/desktop-runtime-acceptance.js');
  const root=await project('node',['desktop']);
  await writeDesktopRuntimeAcceptance(root);
  const config=path.join(root,'vite.config.ts');
  const source=await fs.readFile(config,'utf8');
  await fs.writeFile(config,source.replace('cossackPages({','cossackPages({ developmentTraces:true,').replace('plugins: [',`plugins: [{name:'acceptance-fs',config:()=>({server:{fs:{allow:${JSON.stringify([repository,root])}}}})},`));
  await verifyDesktopDevelopmentApplication(root,{launcher,startupError:launcher,crash:launcher,
    onRecorded: record => verifyDesktopTraceReaders(root,record,path.join(repository,'packages/cossack')),
  });
},120000);

it.each(['cloudflare', 'node'])('executes packaged application guidance on %s', async runtime => {
  const root = await project(runtime);
  const guides = JSON.parse(await fs.readFile(path.join(repository, 'packages/core/agent-docs.json'), 'utf8')).guides;
  await verifyApplicationGuidance(root, guides, { additionalAllowedPaths: [repository] });
}, 180000);
