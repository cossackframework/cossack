// Isolated CMS plugins (specs/cms-plugin-isolation.md): a plugin with only server code runs in a
// Worker of its own on Cloudflare, built and in development, and in the application on Node.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { cleanupRoots, cossack, productionServer, project, repository, run, trackRoot, typecheck, vite } from './fixtures/generated-app.js';
import { packIsolated } from './fixtures/cms-plugin-package.js';
import { browserless } from './fixtures/cms-client.js';
import { findRomeDBBinary, liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';
import { parseAst } from 'rolldown/parseAst';

afterEach(cleanupRoots);

const env = { ...process.env, CMS_PASSWORD: 'long password' };
const json = async (root, args) => JSON.parse((await cossack(root, [...args, '--json'], { env }).catch(error => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); })).stdout);
const command = async (root, origin, name, options = []) => (await json(root, [`tickets-probe:${name}`, ...options, '--url', origin, '--email', 'ada@example.com'])).data.result;

/** Set up the site, grant the plugin, and run what the plugin does: a filter, an after-commit action, a job and its probe. */
async function exercise(root, origin, routeIds, diagnostics) {
  const web = browserless(origin, routeIds, diagnostics);
  const setup = await web.post('/auth/setup', { code: 'setup', siteTitle: 'Isolated', name: 'Ada', email: 'ada@example.com', password: 'long password' });
  expect(setup.headers.get('location'), await setup.text()).toBe('/dashboard');
  await web.post('/dashboard/plugins', { plugin: 'tickets-probe', _action: 'grant' });
  const page = await web.page('/dashboard/plugins');
  // The before-write filter runs where the plugin does.
  const opened = await command(root, origin, 'open', ['--subject', ' Printer jam ']);
  expect(opened.subject).toBe('Printer jam [checked]');
  // The after-commit action queues a job, and the outbox runs it after the request.
  await expect.poll(async () => (await command(root, origin, 'show', ['--id', opened.id]))?.status, { timeout: 30_000 }).toBe('triaged');
  return { page, probe: await command(root, origin, 'probe') };
}

/**
 * How the plugin's marker string appears in a bundle: as a string of its own (the plugin's code
 * is part of the bundle) or only inside a longer string (its code is carried as data).
 */
async function markerIn(directory) {
  const counts = { code: 0, data: 0 };
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const text = node.type === 'Literal' && typeof node.value === 'string' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : undefined;
    if (text === 'tickets-probe-marker') counts.code++;
    else if (text?.includes('tickets-probe-marker')) counts.data++;
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
  };
  for (const file of (await fs.readdir(directory, { recursive: true })).filter(name => name.endsWith('.js'))) {
    const code = await fs.readFile(path.join(directory, file), 'utf8');
    if (code.includes('tickets-probe-marker')) visit(parseAst(code));
  }
  return counts;
}

describe.skipIf(!liveRomeDBTests())('isolated CMS plugins', () => {
  let plugin;
  beforeAll(async () => { plugin = await packIsolated(); }, 60_000);
  afterAll(async () => { if (plugin) await fs.rm(plugin.directory, { recursive: true, force: true }); });

  it('runs a server-only plugin in a Worker of its own on Cloudflare, with the binding the first one adds', async () => {
    const root = await project('cloudflare', ['cms']);
    const added = (await json(root, ['add', 'plugin', plugin.tarball])).data;
    expect(added).toMatchObject({ status: 'added', name: 'tickets-probe', runtime: 'isolated', workerLoader: 'wrangler.jsonc' });
    const wrangler = await fs.readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"worker_loaders": [{"binding":"LOADER"}]');
    expect((await json(root, ['plugins', 'list'])).data.rendered.find(entry => entry.name === 'tickets-probe')).toMatchObject({ runtime: 'isolated' });
    // The lints pass code that evades them; the Worker is what holds it.
    expect((await json(root, ['plugins', 'check'])).data.plugins.find(entry => entry.plugin === 'tickets-probe')).toMatchObject({ errors: 0 });

    // Without the binding the build fails: the plugin's code is not in the application to fall back to.
    await fs.writeFile(path.join(root, 'wrangler.jsonc'), wrangler.replace('"binding":"LOADER"', '"binding":"ELSEWHERE"'));
    await expect(vite(root, [])).rejects.toThrow(/COSSACK_PLUGIN_ISOLATION_BINDING[^\n]*tickets-probe runs isolated/);
    await fs.writeFile(path.join(root, 'wrangler.jsonc'), wrangler);

    await vite(root, []);
    await run(process.execPath, [path.join(repository, 'node_modules/wrangler/bin/wrangler.js'), 'types', '--env-interface', 'CloudflareBindings'], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    await typecheck(root, 'isolated plugin Workers application');
    const configPath = path.join(root, 'dist/ssr/wrangler.json');
    expect(JSON.parse(await fs.readFile(configPath, 'utf8')).worker_loaders).toEqual([{ binding: 'LOADER' }]);
    // The Worker carries the plugin's bundle as data and never imports it.
    expect(await markerIn(path.join(root, 'dist/ssr'))).toEqual({ code: 0, data: 1 });

    const database = await startRomeDBService();
    try {
      await fs.writeFile(path.join(path.dirname(configPath), '.dev.vars'), [
        'APP_SECRET=isolation-test-secret-0123456789abcdef', `ROMEDB_URL=${database.url}`, `ROMEDB_TOKEN=${database.token}`, 'CMS_SETUP_CODE=setup',
      ].join('\n') + '\n');
      const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
      const { createTestHarness } = await import('wrangler');
      const runtime = createTestHarness({ root, workers: [{ configPath }] });
      try {
        const { url } = await runtime.listen();
        const { page, probe } = await exercise(root, new URL(url).origin, routeIds, () => '');
        expect(page).toMatch(/data-testid="?plugin-isolated-tickets-probe/);
        expect(probe).toEqual({
          fetch: expect.stringContaining('not permitted to access the internet'),
          env: 0, ungranted: 'CMS_FORBIDDEN', forged: 'CMS_FORBIDDEN', given: 'user', marker: 'tickets-probe-marker',
        });
      } finally { await runtime.close(); }
    } finally { await database.stop(); }

    // --in-app keeps it in the application from now on.
    expect((await json(root, ['plugins', 'upgrade', 'tickets-probe', '--in-app'])).data).toMatchObject({ runtime: 'app', runtimeReason: 'It was added with --in-app.' });
    expect(JSON.parse(await fs.readFile(path.join(root, 'src/plugins/tickets-probe/plugin.json'), 'utf8')).isolation).toBe(false);
  }, 600_000);

  it('runs it isolated in Workers development', async () => {
    const root = await project('cloudflare', ['cms']);
    await json(root, ['add', 'plugin', plugin.tarball]);
    const devVars = await fs.readFile(path.join(root, '.dev.vars'), 'utf8');
    const port = await freePort();
    const devPort = await freePort();
    const vars = devVars.replace(/^ROMEDB_URL=.*$/m, `ROMEDB_URL=http://127.0.0.1:${port}`).replace(/^APP_URL=.*\n?/m, '').replace(/^CMS_SETUP_CODE=.*$/m, 'CMS_SETUP_CODE=setup');
    await fs.writeFile(path.join(root, '.dev.vars'), `${vars.trimEnd()}\nAPP_URL=http://127.0.0.1:${devPort}\n`);
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'vite';
      const server = await createServer({ root: process.cwd(), server: { port: ${devPort}, strictPort: true, host: '127.0.0.1' } });
      await server.listen();
      console.log('CMS_DEV_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
      process.on('message', async message => { if (message === 'STOP') { await server.close(); process.exit(0); } });
    `], { cwd: root, env: { ...process.env, ROMEDB_BIN: findRomeDBBinary(), NODE_ENV: 'development', VITEST: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
      await expect.poll(() => {
        if (child.exitCode !== null) throw new Error(output);
        return /CMS_DEV_ORIGIN=(\S+)/.exec(output)?.[1];
      }, { timeout: 90_000 }).toBeTruthy();
      const origin = /CMS_DEV_ORIGIN=(\S+)/.exec(output)[1];
      const routeIds = JSON.parse((await cossack(root, ['routes', '--json'])).stdout).data.manifest.filePathToId;
      const { probe } = await exercise(root, origin, routeIds, () => output);
      expect(probe).toMatchObject({ fetch: expect.stringContaining('not permitted to access the internet'), env: 0, forged: 'CMS_FORBIDDEN' });
      expect(output).toContain('[plugin tickets-probe] [tickets-probe] triaged');
    } finally {
      if (child.connected) child.send('STOP'); else child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(kill);
    }
  }, 400_000);

  it('runs the same plugin in the application on Node, and says so', async () => {
    const root = await project('node', ['cms']);
    expect((await json(root, ['add', 'plugin', plugin.tarball])).data).toMatchObject({ runtime: 'app', runtimeReason: 'Node.js has no Worker Loader, so its server code runs in the application.' });
    await fs.access(path.join(root, 'wrangler.jsonc')).then(() => { throw new Error('a Node application has no Wrangler configuration'); }, () => undefined);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    // Here the plugin's code is part of the application's server bundle.
    expect((await markerIn(path.join(root, 'dist/server'))).code).toBeGreaterThan(0);
    const database = await startRomeDBService();
    try {
      const server = await productionServer(root, { APP_SECRET: 'isolation-test-secret-0123456789abcdef', ROMEDB_URL: database.url, ROMEDB_TOKEN: database.token, CMS_SETUP_CODE: 'setup', ROMEDB_PENDING_DIR: path.join(root, '.cossack/romedb-pending') });
      try {
        const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;
        const { page, probe } = await exercise(root, server.origin, routeIds, () => server.diagnostics());
        expect(page).toMatch(/data-testid="?plugin-in-app-tickets-probe/);
        // In the application the same code reaches what the lints could not see, and a forged principal is believed.
        expect(probe.fetch).not.toContain('not permitted');
        expect(probe.env).toBeGreaterThan(0);
        expect(probe).toMatchObject({ ungranted: 'CMS_FORBIDDEN', forged: 'allowed', given: 'user' });
      } finally { await server.close(); }
    } finally { await database.stop(); }
  }, 400_000);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
