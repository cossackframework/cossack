// A generated project whose ORM is on RomeDB (`--database romedb`), without the CMS: the
// sign-in pages of the dashboard package run on it, and the server applies the migrations.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, project, cossack, typecheck, vite, productionServer, routeId as servedRouteId } from './fixtures/generated-app.js';
import { liveRomeDBTests, startRomeDBService } from '../../romedb/src/testing.ts';

afterEach(cleanupRoots);

it('runs ORM sign-in on a RomeDB file and applies migrations when the server starts', async () => {
  const root = await project('node', ['protected-route'], { database: 'romedb' });
  const manifestFile = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  expect(manifestFile.dependencies).toMatchObject({ '@cossackframework/romedb': expect.any(String), '@romedb/client': expect.any(String), '@romedb/node': expect.any(String) });
  expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toContain('ROMEDB_URL=storage/romedb/app.romedb');
  expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toContain('storage/romedb/');
  await typecheck(root, 'Generated RomeDB ORM project');

  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  // The build imported the server's modules and did not open the database.
  await expect(fs.stat(path.join(root, 'storage/romedb/app.romedb'))).rejects.toMatchObject({ code: 'ENOENT' });

  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeId = manifest.filePathToId['/src/pages/protected-route/index.ts'];
  const registerId = servedRouteId(manifest, '/src/pages/auth/register/index.ts');
  const loginId = servedRouteId(manifest, '/src/pages/auth/login/index.ts');
  const environment = { APP_SECRET: 'generated-romedb-orm-test-secret' };
  const call = (origin, componentRouteId, action, payload = [], cookie = '') => fetch(origin + '/crpc', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ componentRouteId, action, payload, state: {} }),
  });

  // No `cossack migration up` ran: the first request creates the tables.
  let server = await productionServer(root, environment);
  try {
    const { origin } = server;
    const denied = await fetch(origin + '/protected-route', { redirect: 'manual' });
    expect(denied.status, server.diagnostics()).toBe(302);
    const registered = await call(origin, registerId, 'register', [{ name: 'Agent', email: 'agent@example.test', password: 'test-password-123' }]);
    expect(registered.status, server.diagnostics()).toBe(200);
    const cookie = registered.headers.getSetCookie().find(value => value.startsWith('session_id='))?.split(';')[0];
    expect(cookie).toBeTruthy();
    const authenticated = await call(origin, routeId, 'verifyIdentity', [], cookie);
    expect(await authenticated.json()).toMatchObject({ _cossack_return: 'Authenticated account: agent@example.test' });
    // A second account with the same email is refused by the page, not by a database error.
    const again = await call(origin, registerId, 'register', [{ name: 'Agent', email: 'agent@example.test', password: 'test-password-123' }]);
    expect(JSON.stringify(await again.json())).toContain('already exists');
  } finally { await server.close(); }
  await fs.stat(path.join(root, 'storage/romedb/app.romedb'));

  // With the server stopped, a command opens the file: every migration is recorded as applied.
  const status = JSON.parse((await cossack(root, ['migration', 'status', '--json']).catch(async error => { const plain = await cossack(root, ['migration', 'status']).catch(detail => detail); throw new Error(`migration status: ${error.stdout}\n${error.stderr}\n${plain.stdout}\n${plain.stderr}`); })).stdout);
  expect(JSON.stringify(status)).not.toContain('"pending"');

  // The data is kept, and a second start has nothing to apply.
  server = await productionServer(root, environment);
  try {
    const { origin } = server;
    const signedIn = await call(origin, loginId, 'login', [{ email: 'agent@example.test', password: 'test-password-123' }]);
    expect(signedIn.status, server.diagnostics()).toBe(200);
    expect(signedIn.headers.getSetCookie().some(value => value.startsWith('session_id='))).toBe(true);
  } finally { await server.close(); }
}, 300000);

// Workers reach RomeDB over HTTP, so this case needs a RomeDB executable.
(liveRomeDBTests() ? it : it.skip)('runs ORM sign-in on Workers against a RomeDB service', async () => {
  const root = await project('cloudflare', ['protected-route'], { database: 'romedb' });
  const wrangler = await fs.readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
  expect(wrangler).toContain('{ "name": "ROMEDB_PENDING", "class_name": "RomeDBPendingWrites" }');
  expect(wrangler).toContain('{ "tag": "romedb-v1", "new_sqlite_classes": ["RomeDBPendingWrites"] }');
  expect(await fs.readFile(path.join(root, 'src/index.ts'), 'utf8')).toContain("export { RomeDBPendingWrites } from '@cossackframework/romedb/cloudflare';");
  expect(await fs.readFile(path.join(root, '.dev.vars'), 'utf8')).toContain('ROMEDB_URL=http://127.0.0.1:4321');
  await typecheck(root, 'Generated RomeDB ORM Worker');

  const database = await startRomeDBService();
  try {
    await vite(root, []);
    const configPath = path.join(root, 'dist/ssr/wrangler.json');
    await fs.writeFile(path.join(path.dirname(configPath), '.dev.vars'), [
      'APP_SECRET=generated-romedb-orm-test-secret', `ROMEDB_URL=${database.url}`, `ROMEDB_TOKEN=${database.token}`,
    ].join('\n') + '\n');
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
    const routeId = manifest.filePathToId['/src/pages/protected-route/index.ts'];
    const registerId = servedRouteId(manifest, '/src/pages/auth/register/index.ts');
    const { createTestHarness } = await import('wrangler');
    const runtime = createTestHarness({ root, workers: [{ configPath }] });
    try {
      const origin = new URL((await runtime.listen()).url).origin;
      const call = (componentRouteId, action, payload = [], cookie = '') => fetch(origin + '/crpc', {
        method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ componentRouteId, action, payload, state: {} }),
      });
      // No command ran: the isolate's first request creates the tables.
      const registered = await call(registerId, 'register', [{ name: 'Agent', email: 'agent@example.test', password: 'test-password-123' }]);
      expect(registered.status, await registered.clone().text()).toBe(200);
      const cookie = registered.headers.getSetCookie().find(value => value.startsWith('session_id='))?.split(';')[0];
      expect(cookie).toBeTruthy();
      const authenticated = await call(routeId, 'verifyIdentity', [], cookie);
      expect(await authenticated.json()).toMatchObject({ _cossack_return: 'Authenticated account: agent@example.test' });
    } finally { await runtime.close(); }
  } finally { await database.stop(); }
}, 600000);

it('shares the CMS\'s RomeDB instance with the ORM in a CMS project', async () => {
  const root = await project('node', ['cms', 'database'], { database: 'romedb' });
  expect(await fs.readFile(path.join(root, 'src/orm/factory.ts'), 'utf8')).toContain("const { cmsFor } = await import('@cossackframework/cms/app/cms/index');");
  await typecheck(root, 'Generated CMS project with the ORM on RomeDB');
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const server = await productionServer(root, { APP_SECRET: 'generated-romedb-orm-test-secret-0123456789', CMS_SETUP_CODE: 'setup-code-for-tests' });
  try {
    // One process owns the file: the CMS and the ORM open it once, and both create their tables.
    const response = await fetch(server.origin + '/auth/setup');
    expect(response.status, server.diagnostics()).toBe(200);
  } finally { await server.close(); }
  const status = JSON.parse((await cossack(root, ['migration', 'status', '--json']).catch(error => { throw new Error(`migration status: ${error.stdout}\n${error.stderr}`); })).stdout);
  expect(status.ok).toBe(true);
  expect(JSON.stringify(status)).toContain('"applied"');
  expect(JSON.stringify(status)).not.toContain('"pending"');
}, 600000);
