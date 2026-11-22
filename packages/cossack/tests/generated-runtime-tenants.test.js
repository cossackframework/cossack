// Tenants of the dashboard package (src/dashboard.config.ts: `tenants`): a database per tenant,
// shared accounts, members and roles per tenant. The same flow on SQLite and on a RomeDB file.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupRoots, project, cossack, vite, productionServer, routeId as servedRouteId } from './fixtures/generated-app.js';
import { browserless } from './fixtures/cms-client.js';

afterEach(cleanupRoots);

const PAGES = ['auth/login/index.ts', 'auth/register/index.ts', 'auth/setup/index.ts', 'dashboard/tenants/index.ts', 'dashboard/users/new/index.ts'];

async function tenants(database) {
  const root = await project('node', ['dashboard'], { database });
  const configFile = path.join(root, 'src/dashboard.config.ts');
  await fs.writeFile(configFile, (await fs.readFile(configFile, 'utf8')).replace('export const dashboard: DashboardConfig = {',
    'export const dashboard: DashboardConfig = {\n  tenants: { enabled: true },'));
  // SQLite takes its migrations from the command; a RomeDB project applies them itself.
  if (database === 'sqlite') await cossack(root, ['migration', 'up', '--json']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeIds = Object.fromEntries(PAGES.map(page => [`/src/pages/${page}`, servedRouteId(manifest, `/src/pages/${page}`)]));
  const server = await productionServer(root, { APP_SECRET: 'generated-tenants-test-secret', SETUP_CODE: 'setup-code-for-tests', TEST_APP_HOST: 'app.test' });
  try {
    const { origin } = server;
    const port = new URL(origin).port;
    const on = host => browserless(`http://${host}:${port}`, routeIds, server.diagnostics, { connect: '127.0.0.1' });
    const [login, register, setup, screen, newUser] = PAGES;
    const admin = { name: 'Ada', email: 'ada@example.test', password: 'test-password-123' };
    const grace = { name: 'Grace', email: 'grace@example.test', password: 'test-password-456' };

    // The first account, on the main host. An unknown host is nobody's.
    const owner = on('app.test');
    expect((await owner.action(setup, 'setup', [{ code: 'setup-code-for-tests', ...admin }]))._cossack_redirect).toBe('/dashboard');
    expect((await on('nobody.app.test').request('/auth/login')).status).toBe(404);

    // The administrator makes a tenant and is its first administrator.
    const made = await owner.action(screen, 'create', ['Acme', 'acme']);
    expect(made.error).toBe('');
    expect(made.tenants).toMatchObject([{ name: 'Acme', slug: 'acme', status: 'active', members: 1, address: `http://acme.app.test:${port}` }]);
    expect(made.members).toMatchObject([{ email: admin.email, roles: ['admin'] }]);
    expect((await owner.action(screen, 'create', ['Other', 'acme'])).error).toContain('already exists');
    expect((await owner.action(screen, 'create', ['Bad', 'www'])).error).toContain('reserved');

    // Its host has its own sign-in; the account is the shared one.
    const acme = on('acme.app.test');
    expect((await acme.request('/auth/login')).status).toBe(200);
    expect((await acme.action(login, 'login', [{ email: admin.email, password: admin.password }])).error ?? '').toBe('');
    expect(acme.jar.has('session_id')).toBe(true);
    expect(await acme.page('/dashboard/users')).toContain(admin.email);
    // Tenants are managed on the main host only.
    expect((await acme.request('/dashboard/tenants')).status).toBe(404);

    // A second account registers on the main host. It is no member of Acme: its host refuses the sign-in.
    const second = on('app.test');
    await second.action(register, 'register', [grace]);
    expect(second.jar.has('session_id')).toBe(true);
    const stranger = on('acme.app.test');
    expect((await stranger.action(login, 'login', [{ email: grace.email, password: grace.password }])).error).toContain('not a member of Acme');
    expect(stranger.jar.has('session_id')).toBe(false);
    // Nobody registers on a tenant's host.
    expect((await on('acme.app.test').action(register, 'register', [{ name: 'Eve', email: 'eve@example.test', password: 'test-password-789' }])).error).toContain('closed');

    // The tenant's administrator adds the account as a member, on the tenant's own Users screen.
    const added = await acme.action(newUser, 'create', ['', grace.email, '', [], false]);
    expect(added.error ?? '').toBe('');
    const member = on('acme.app.test');
    expect((await member.action(login, 'login', [{ email: grace.email, password: grace.password }])).error ?? '').toBe('');
    expect(member.jar.has('session_id')).toBe(true);

    // Each database has its own users: the main host lists both accounts, and Acme its two members.
    const mainUsers = await owner.page('/dashboard/users');
    expect(mainUsers).toContain(admin.email);
    expect(mainUsers).toContain(grace.email);
    expect((await owner.action(screen, 'open', [made.tenants[0].id])).members.map(entry => entry.email).sort()).toEqual([admin.email, grace.email]);

    // Removed from the tenant, the account's session there is a guest's; the account stays.
    expect((await owner.action(screen, 'removeMember', [made.tenants[0].id, added.id ?? (await owner.action(screen, 'open', [made.tenants[0].id])).members.find(entry => entry.email === grace.email).id], { state: { selected: made.tenants[0].id } })).error).toBe('');
    expect((await member.request('/dashboard')).status).toBe(302);
    expect((await second.request('/dashboard')).status).toBe(200);

    // Reaching every tenant is the account's own flag. The first account has it; the last one keeps it.
    expect((await owner.action(screen, 'open', [''])).admins).toMatchObject([{ email: admin.email }]);
    expect((await owner.action(screen, 'networkAdmin', [admin.email, false])).error).toContain('last network administrator');
    // Grace is no member of Acme any more, and no administrator anywhere: the Tenants screen is not hers.
    expect((await second.request('/dashboard/tenants')).status).toBe(302);
    expect((await owner.action(screen, 'networkAdmin', [grace.email, true])).admins.map(entry => entry.email).sort()).toEqual([admin.email, grace.email]);
    // Now she signs in on Acme's host without being its member, with every permission.
    const reach = on('acme.app.test');
    expect((await reach.action(login, 'login', [{ email: grace.email, password: grace.password }])).error ?? '').toBe('');
    expect(await reach.page('/dashboard/users')).toContain(admin.email);
    expect((await second.request('/dashboard/tenants')).status).toBe(200);
    expect((await owner.action(screen, 'networkAdmin', [grace.email, false])).error).toBe('');
    expect((await reach.request('/dashboard')).status).toBe(302);

    // An archived tenant answers 503 and comes back.
    expect((await owner.action(screen, 'archive', [made.tenants[0].id, true])).error).toBe('');
    // Hosts are remembered for half a minute in a process; the server that changed it forgets at once.
    expect((await acme.request('/auth/login')).status).toBe(503);
    expect((await owner.action(screen, 'archive', [made.tenants[0].id, false])).error).toBe('');
    expect((await acme.request('/dashboard')).status).toBe(200);

    // A domain of its own reaches the tenant.
    expect((await owner.action(screen, 'addDomain', [made.tenants[0].id, 'app.acme.test'])).error).toBe('');
    expect((await on('app.acme.test').request('/auth/login')).status).toBe(200);
  } finally { await server.close(); }
}

it('runs tenants with a database each on SQLite', () => tenants('sqlite'), 300000);
it('runs tenants with a database each on a RomeDB file', () => tenants('romedb'), 300000);

/** Shared sign-in: people sign in on the main host, and a tenant's host gets its session from a one-time code. */
it('signs in once for every host with shared sign-in', async () => {
  const root = await project('node', ['dashboard'], { database: 'sqlite' });
  const configFile = path.join(root, 'src/dashboard.config.ts');
  await fs.writeFile(configFile, (await fs.readFile(configFile, 'utf8')).replace('export const dashboard: DashboardConfig = {',
    "export const dashboard: DashboardConfig = {\n  tenants: { enabled: true, signIn: 'shared' },"));
  await cossack(root, ['migration', 'up', '--json']);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeIds = Object.fromEntries(PAGES.map(page => [`/src/pages/${page}`, servedRouteId(manifest, `/src/pages/${page}`)]));
  const server = await productionServer(root, { APP_SECRET: 'generated-tenants-test-secret', SETUP_CODE: 'setup-code-for-tests', TEST_APP_HOST: 'app.test' });
  try {
    const port = new URL(server.origin).port;
    const on = host => browserless(`http://${host}:${port}`, routeIds, server.diagnostics, { connect: '127.0.0.1' });
    const [login, register, setup, screen] = PAGES;
    const admin = { name: 'Ada', email: 'ada@example.test', password: 'test-password-123' };
    const main = on('app.test');
    await main.action(setup, 'setup', [{ code: 'setup-code-for-tests', ...admin }]);
    expect((await main.action(screen, 'create', ['Acme', 'acme'])).error).toBe('');
    const pathOf = response => { const url = new URL(response.headers.get('location'), 'http://app.test'); return [url.hostname, url.pathname + url.search]; };

    // A browser: one jar per host, as cookies are. The tenant's sign-in page sends it to the main host.
    const acme = on('acme.app.test');
    const start = await acme.request('/auth/login?redirect=%2Fdashboard%2Fusers');
    expect(start.status).toBe(302);
    expect(acme.jar.has('tenant_state')).toBe(true);
    const [mainHost, issue] = pathOf(start);
    expect([mainHost, issue.split('?')[0]]).toEqual(['app.test', '/auth/tenant/redirect']);
    // Signed in there already: it comes back with a code, which makes a session on the tenant's host.
    const issued = await main.request(issue);
    expect(issued.status).toBe(302);
    const [tenantHost, callback] = pathOf(issued);
    expect([tenantHost, callback.split('?')[0]]).toEqual(['acme.app.test', '/auth/tenant/callback']);
    // The code counts only in the browser that started: another one, without the state cookie, is refused.
    expect((await on('acme.app.test').request(callback)).status).toBe(400);
    const done = await acme.request(callback);
    expect([done.status, done.headers.get('location')]).toEqual([302, '/dashboard/users']);
    expect(acme.jar.has('session_id')).toBe(true);
    expect(await acme.page('/dashboard/users')).toContain(admin.email);
    // The code was spent.
    expect((await acme.request(callback)).status).toBe(400);

    // A visitor who is not signed in signs in on the main host and is brought back.
    const grace = { name: 'Grace', email: 'grace@example.test', password: 'test-password-456' };
    await on('app.test').action(register, 'register', [grace]);
    expect((await main.action(screen, 'addMember', [(await main.action(screen, 'open', [''])).tenants[0].id, grace.email])).error).toBe('');
    const tenantSide = on('acme.app.test');
    const mainSide = on('app.test');
    const [, toMain] = pathOf(await tenantSide.request('/auth/login'));
    const asked = await mainSide.request(toMain);
    expect([asked.status, asked.headers.get('location')]).toEqual([302, '/auth/login']);
    expect((await mainSide.action(login, 'login', [{ email: grace.email, password: grace.password }])).error ?? '').toBe('');
    const resumed = await mainSide.request('/dashboard');
    expect(resumed.status).toBe(302);
    expect(pathOf(resumed)[1].split('?')[0]).toBe('/auth/tenant/redirect');
    const [, back] = pathOf(await mainSide.request(pathOf(resumed)[1]));
    expect((await tenantSide.request(back)).status).toBe(302);
    expect((await tenantSide.request('/dashboard')).status).toBe(200);

    // Signing out on the main host ends the session on the tenant's host too.
    await mainSide.request('/dashboard');
    const layout = 'dashboard/layout.ts';
    for (const file of [layout, 'dashboard/index.ts']) routeIds[`/src/pages/${file}`] = servedRouteId(manifest, `/src/pages/${file}`);
    expect((await mainSide.action(layout, 'doLogout', [], { page: 'dashboard/index.ts' }))._cossack_redirect).toBe('/auth/login');
    expect((await mainSide.request('/dashboard')).status).toBe(302);
    expect((await tenantSide.request('/dashboard')).status).toBe(302);
    // The administrator's sessions are untouched.
    expect((await acme.request('/dashboard')).status).toBe(200);
  } finally { await server.close(); }
}, 300000);
