import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { cleanupRoots, project } from './fixtures/generated-app.js';
import { browserless } from './fixtures/cms-client.js';
import { findRomeDBBinary, liveRomeDBTests } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

// requests.md C8 (ACME, 2026-11-19): adding src/plugins/<name>/middlewares.ts while `pnpm dev`
// ran answered every request with 500 ("Cannot read properties of undefined (reading 'modules')")
// until the server restarted. The served CMS had an import cycle through the pages registry, and
// the new file changed the order the development server evaluated it in: the dashboard registry
// read `authOptions.modules` before auth-options.ts had run (tests/served-import-cycles.test.ts in
// the CMS package keeps that code free of cycles). Here: a set-up site with the plugin granted,
// whose new middleware runs at once and shares a module with its server code.
// Needs a RomeDB executable, like the other live CMS suites; CI without one skips it.
it.skipIf(!liveRomeDBTests())('keeps answering, and runs the new middleware, when a granted plugin gains middlewares.ts while the Workers development server runs', async () => {
  const root = await project('cloudflare', ['cms']);
  const devVars = await fs.readFile(path.join(root, '.dev.vars'), 'utf8');
  const port = await freePort();
  const devPort = await freePort();
  const vars = devVars.replace(/^ROMEDB_URL=.*$/m, `ROMEDB_URL=http://127.0.0.1:${port}`).replace(/^(?:APP_URL|CMS_SETUP_CODE)=.*\n?/gm, '');
  await fs.writeFile(path.join(root, '.dev.vars'), `${vars.trimEnd()}\nAPP_URL=http://127.0.0.1:${devPort}\nCMS_SETUP_CODE=setup\n`);
  const plugin = path.join(root, 'src/plugins/probe');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'plugin.json'), JSON.stringify({ schemaVersion: 1, name: 'probe', version: '1.0.0', description: 'Probe.', compatibility: { '@cossackframework/cms': '>=0.9.0' }, permissions: { unrestricted: true } }, null, 2));
  await fs.mkdir(path.join(plugin, 'server'), { recursive: true });
  await fs.writeFile(path.join(plugin, 'server/scope.ts'), "import { AsyncLocalStorage } from 'node:async_hooks';\nimport { Float64 } from '@cossackframework/romedb';\nexport const scope = new AsyncLocalStorage<{ signal?: AbortSignal }>();\nexport const one = new Float64(1);\n");
  await fs.writeFile(path.join(plugin, 'server.ts'), "import { scope } from './server/scope';\nexport default { scope };\n");
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
  try {
    await expect.poll(() => { if (child.exitCode !== null) throw new Error(output); return /CMS_DEV_ORIGIN=(\S+)/.exec(output)?.[1]; }, { timeout: 90_000 }).toBeTruthy();
    const origin = /CMS_DEV_ORIGIN=(\S+)/.exec(output)[1];
    const web = browserless(origin, {}, () => output);
    const setup = await web.post('/auth/setup', { code: 'setup', siteTitle: 'Probe', name: 'Ada', email: 'ada@example.com', password: 'long password' });
    expect(setup.headers.get('location'), output).toBe('/dashboard');
    // Unrestricted access is confirmed on the plugin's own row.
    await web.post('/dashboard/plugins', { _row: 'grant:probe', 'accept-unrestricted': 'probe' });
    await fs.writeFile(path.join(plugin, 'middlewares.ts'), "import type { MiddlewareHandler } from 'hono';\nimport { scope } from './server/scope';\n" +
      "const probe: MiddlewareHandler = async (c, next) => { await scope.run({ signal: c.req.raw.signal }, next); c.header('x-probe', 'ran'); };\nexport default [probe];\n");
    await new Promise(resolve => setTimeout(resolve, 3000));
    const answers = [];
    for (const path of ['/', '/dashboard', '/dashboard/plugins', '/']) {
      const response = await web.request(path);
      answers.push(response.status < 500 ? `${path} ${response.headers.get('x-probe')}` : `${path} ${response.status} ${(await response.text()).slice(0, 500)}`);
    }
    expect(answers, output).toEqual(['/ ran', '/dashboard ran', '/dashboard/plugins ran', '/ ran']);
  } finally {
    if (child.connected) child.send('STOP'); else child.kill('SIGTERM');
    await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 15000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}, 300_000);
