// Generated auth and session recipes: scoped services, protected routes, dashboard
// session revalidation and authentication/OAuth primitives.
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
import { cleanupRoots, project, sharedApps, run, cossack, typecheck, vite, assertPortableChunks, productionServer, repository } from './fixtures/generated-app.js';

afterEach(cleanupRoots);

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
  const pageRouteId = manifest.filePathToId['/src/pages/scoped-service/other/index.ts'];
  expect(ownerRouteId).toBeTruthy();
  expect(pageRouteId).toBeTruthy();
  const server = await productionServer(root);
  let browser;
  try {
    const { origin } = server;
    const rendered = await (await fetch(origin + '/scoped-service/other')).text();
    expect(rendered).toContain('nested-service-count');
    expect(rendered).toContain('Count: 0');
    const rpc = async (action, service = { ownerRouteId, slot: '0' }) => {
      const response = await fetch(origin + '/crpc', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ service, componentRouteId: pageRouteId, pageParams: {}, action, payload: [], state: { count: 4 } }) });
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
    expect(sent[0]).toMatchObject({ service: { ownerRouteId, slot: '0' }, componentRouteId: manifest.filePathToId['/src/pages/scoped-service/index.ts'],
      pageParams: {}, action: 'increment', state: { count: 0 } });
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
    expect(code).not.toContain('pbkdf2-sha256$');
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
    const registered = await call(registerId, 'register', [{ name: 'Agent', email: 'agent@example.test', password: 'test-password-123' }]);
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
    // A click before hydration submits the form natively and stays on the login page.
    await page.waitForFunction(() => window.__cossackReady === true);
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
    await browserExpect(page.getByRole('status').filter({ hasText: 'Authenticated account:' })).toHaveText('Authenticated account: agent@example.test');
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
    await browserExpect(page.getByRole('status').filter({ hasText: 'Authenticated account:' })).toHaveCount(0);
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

// Session-auth dashboard apps carry both the SSE and form fixtures; each case
// restores the freshly migrated database (Node) or applies the plan to fresh bindings (workerd).
describe.each(['node', 'cloudflare'])('generated %s dashboard session app', adapter => {
  const shared = sharedApps();
  const environment = { APP_SECRET: 'fixture-auth-forms-secret-0123456789' };
  let root, generatedConfig, migrationPlan, manifest, database;
  beforeAll(async () => {
    root = await shared(adapter, ['dashboard'], { dashboardModules: ['sessions'] });
    await writeAuthSseAcceptance(root);
    await writeAuthFormsAcceptance(root);
    generatedConfig = await cossack(root, ['config', '--generate', '--json']);
    if (adapter === 'cloudflare') await run('pnpm', ['exec', 'wrangler', 'types', '--env-interface', 'CloudflareBindings'],
      { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
    await typecheck(root, 'Generated auth SSE/form types');
    if (adapter === 'cloudflare') migrationPlan = JSON.parse((await cossack(root, ['migration', 'plan', '--local', '--json'])).stdout).data.migrations;
    await cossack(root, ['migration', 'up', '--local', '--json']);
    if (adapter === 'node') database = await fs.readFile(path.join(root, 'database.sqlite'));
    await vite(root, ['--sourcemap']);
    if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  }, 300000);
  async function clientFiles(privateMarkers) {
    const files = (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => /\.(js|map)$/.test(file));
    expect(files.some(file => file.endsWith('.map'))).toBe(true);
    for (const file of files) {
      const text = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
      for (const marker of privateMarkers) expect(text, file).not.toContain(marker);
    }
  }
  async function start() {
    if (adapter === 'node') {
      for (const suffix of ['-wal', '-shm']) await fs.rm(path.join(root, 'database.sqlite' + suffix), { force: true });
      await fs.writeFile(path.join(root, 'database.sqlite'), database);
      const server = await productionServer(root, environment);
      return { close: server.close, origin: server.origin, diagnostics: server.diagnostics,
        request: (url, options = {}) => fetch(server.origin + url, { redirect: 'manual', ...options }) };
    }
    const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json'), secrets: environment }] });
    const close = () => harness.close();
    try {
      const origin = new URL((await harness.listen()).url).origin;
      const bindings = await harness.getWorker().getEnv();
      for (const migration of migrationPlan) for (const statement of migration.statements) {
        expect(statement.parameterCount).toBe(0);
        await bindings.DB.prepare(statement.text).run();
      }
      return { close, origin, diagnostics: () => JSON.stringify(harness.getLogs()),
        request: (url, options = {}) => harness.fetch(url, { redirect: 'manual', ...options }) };
    } catch (error) { await close(); throw error; }
  }
  it(`revalidates generated authenticated SSE sessions on ${adapter} before delivery`, async () => {
    expect(JSON.parse(generatedConfig.stdout)).toMatchObject({ ok: true, command: 'config' });
    await clientFiles(['Password exceeds its size limit.', 'pbkdf2-sha256$', 'Session ended before subscription.', 'DROP TABLE sessions', 'sessionFingerprint']);
    const { close, request, origin, diagnostics } = await start();
    const browser = await chromium.launch({ headless: true });
    try { await checkAuthSseAcceptance(request, manifest, browser, origin); }
    catch (error) { throw new Error(`${error.stack ?? error}\n${diagnostics()}`); }
    finally { await browser.close(); await close(); }
  }, 180000);
  it(`operates actual generated auth forms and session actions on ${adapter} without sharing credentials`, async () => {
    await clientFiles(['Password exceeds its size limit.', 'pbkdf2-sha256$', 'PRIVATE_AUTH_FORM_STORAGE']);
    const { close, request, origin, diagnostics } = await start();
    const browser = await chromium.launch({ headless: true });
    try { await checkAuthFormsAcceptance(request, manifest, browser, origin); }
    catch (error) { throw new Error(`${error.stack ?? error}\n${diagnostics()}`); }
    finally { await browser.close(); await close(); }
  }, 180000);
});

it.each(['node', 'cloudflare'])('serves generated authentication primitives and OAuth diagnostics on %s without exposing credentials', async adapter => {
  const root = await project(adapter, ['dashboard'], { oauth: 'github', dashboardModules: ['sessions'] });
  const fixtureProvider = await createOAuthFixtureProvider();
  try {
  await writeAuthPrimitivesAcceptance(root);
  await writeSessionDashboardAcceptance(root);
  await writeOAuthReplayAcceptance(root, fixtureProvider.origin);
  if (adapter === 'cloudflare') await promisify(execFile)('pnpm', ['exec', 'wrangler', 'types', '--env-interface', 'CloudflareBindings'],
    { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated OAuth types: ${error.stdout}\n${error.stderr}`); }
  let migrationPlan;
  if (adapter === 'cloudflare') {
    const plan = await promisify(execFile)(process.execPath,
      [path.join(repository, 'packages/cossack/bin/cossack.js'), 'migration', 'plan', '--local', '--json'],
      { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(plan.stdout);
    expect(result).toMatchObject({ ok: true, data: { complete: true } });
    migrationPlan = result.data.migrations;
    expect(migrationPlan.length).toBeGreaterThan(0);
  }
  try { await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'migration', 'up', '--local', '--json'],
    { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`Generated OAuth migrations (${error.code}, ${error.signal}): ${error.stdout}\n${error.stderr}`); }
  try {
    const checked = await promisify(execFile)(process.execPath,
      [path.join(repository, 'packages/cossack/bin/cossack.js'), 'schema', 'check', '--local', '--json'],
      { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(checked.stdout)).toMatchObject({ ok: true });
  } catch (error) { throw new Error(`Generated auth schema: ${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const sessionsRouteId = manifest.filePathToId['/src/pages/dashboard/sessions/index.ts'];
  expect(sessionsRouteId).toBeTruthy();
  const privateValue = 'PRIVATE_OAUTH_CREDENTIAL_CODE_DESCRIPTION';
  for (const configured of [true, false]) {
    const environment = { APP_SECRET: 'fixture-application-secret-0123456789', OAUTH_SECRET: 'fixture-state-secret-01234567890123456789',
      GITHUB_CLIENT_ID: configured ? 'fixture-client' : '', GITHUB_CLIENT_SECRET: privateValue };
    let close, request, diagnostics;
    if (adapter === 'node') {
      const server = await productionServer(root, environment);
      close = server.close;
      diagnostics = server.diagnostics;
      request = (url, options = {}) => fetch(server.origin + url, { redirect: 'manual', ...options });
    } else {
      const configPath = path.join(root, 'dist/ssr/wrangler.json');
      const harness = createTestHarness({ root, workers: [{ configPath, secrets: environment }] });
      close = () => harness.close();
      try {
        const { url } = await harness.listen();
        const origin = new URL(url).origin;
        request = (url, options = {}) => fetch(origin + url, { redirect: 'manual', ...options });
        // The harness deliberately uses fresh in-memory bindings, separate from
        // the CLI's persistent database. Apply the generated CLI SQL plan here.
        const bindings = await harness.getWorker().getEnv();
        expect(bindings.APP_SECRET).toBe(environment.APP_SECRET);
        for (const migration of migrationPlan) for (const statement of migration.statements) {
          expect(statement.parameterCount).toBe(0);
          await bindings.DB.prepare(statement.text).run();
        }
      } catch (error) { await close(); throw error; }
    }
    try {
      if (configured) {
        await checkAuthPrimitives(request);
        await checkSessionDashboard(request, sessionsRouteId);
        await checkOAuthReplay(request, fixtureProvider);
      }
      if (!configured) {
        for (const route of ['redirect', 'callback']) {
          const response = await request(`/auth/github/${route}`);
          expect(response.status).toBe(500);
          const body = await response.json();
          expect(body).toMatchObject({ code: 'COSSACK_OAUTH_CREDENTIALS_MISSING', stage: 'configuration' });
          expect(JSON.stringify(body)).not.toContain(privateValue);
        }
        continue;
      }
      const redirect = await request('/auth/github/redirect');
      expect(redirect.status, await redirect.clone().text()).toBe(302);
      expect(new URL(redirect.headers.get('location')).searchParams.get('code_challenge_method')).toBe('S256');
      const cookie = redirect.headers.get('set-cookie').split(';')[0];
      for (const [query, code, stage, status] of [
        ['', 'COSSACK_OAUTH_CALLBACK_INVALID', 'callback', 400],
        [`?error=access_denied&error_description=${privateValue}`, 'COSSACK_OAUTH_CONSENT_DENIED', 'callback', 403],
        [`?code=${privateValue}&state=wrong-state`, 'COSSACK_OAUTH_STATE_MISMATCH', 'state', 400],
      ]) {
        const response = await request('/auth/github/callback' + query, { headers: { cookie } });
        expect(response.status).toBe(status);
        const body = await response.json();
        expect(body).toMatchObject({ code, stage, status });
        expect(JSON.stringify(body)).not.toContain(privateValue);
        expect(response.headers.get('set-cookie')).toMatch(/cossack_oauth_state=;.*Max-Age=0/i);
      }
    } catch (error) {
      throw new Error(`${error.stack ?? error}\n${diagnostics?.() ?? ''}`);
    } finally { await close(); }
  }
  } finally { await fixtureProvider.close(); }
}, 120000);
