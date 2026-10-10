// Shared helpers for the generated-runtime-*.test.js integration files: cached
// generated apps (see linked-app.js), CLI/Vite/tsc runners and a production Node server.
import { afterAll, expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createLinkedApp, repository } from './linked-app.js';

export { repository };
const roots = [];
/** Removes `parent` in the next cleanupRoots(), for tests that create their own temp app. */
export function trackRoot(parent) { roots.push(parent); }
/** Register as `afterEach(cleanupRoots)` in each test file using project(). */
export async function cleanupRoots() { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); }
// Generated apps are copied from a cached scaffold+linked base (see fixtures/linked-app.js).
// `owner` collects parents to remove: per test by default, or a describe-level list for shared apps.
export async function project(adapter, features = [], options = {}, owner = roots) {
  const { parent, root } = await createLinkedApp({ adapter, features, options, prefix: 'cossack-runtime-build-',
    install: features.includes('dashboard') ? ['@cossackframework/solar-icons'] : [] });
  owner.push(parent);
  return root;
}
// A describe-level generated app built once in beforeAll and shared by several cases.
export function sharedApps() {
  const parents = [];
  afterAll(async () => { await Promise.all(parents.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
  return (adapter, features = [], options = {}) => project(adapter, features, options, parents);
}
export const run = promisify(execFile);
export const cossack = (root, args, options = {}) => run(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), ...args],
  { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024, ...options });
export async function typecheck(root, label) {
  try { return await run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(`${label}: ${error.stdout}\n${error.stderr}`); }
}
export async function vite(root, args) {
  try {
    return await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/vite/bin/vite.js'), 'build', ...args], {
      cwd: root, env: { ...process.env, NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) { throw new Error(`${error.stdout}\n${error.stderr}`); }
}
export async function assertPortableChunks(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertPortableChunks(file);
    else if (entry.name.endsWith('.js')) expect(await fs.readFile(file, 'utf8'), file).not.toContain('cloudflare:workers');
  }
}
export async function productionServer(root, environment = {}) {
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
  return { origin: /RECIPE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1], close, diagnostics: () => output };
}

// docs/examples/state-mechanisms.ts as a page, checked in production and development.
export async function writeStateExample(root) {
  const pageFile = path.join(root, 'src/pages/state-example/index.ts');
  await fs.mkdir(path.dirname(pageFile), { recursive: true });
  const source = await fs.readFile(path.join(repository, 'docs/examples/state-mechanisms.ts'), 'utf8');
  await fs.writeFile(pageFile, source.replace('    render() {', `
    onMount() { (window as any).__stateExample = this; }
    render() {`));
}
export async function checkStateExample(mode, server) {
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
}
