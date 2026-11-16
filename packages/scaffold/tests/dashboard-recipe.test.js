import { describe, expect, it } from 'vitest';
import { DASHBOARD_MODULES, renderRecipe, resolveRecipe } from '../src/index.js';
import { DASHBOARD_PACKAGE, SERVED_DASHBOARD_PATHS, isServedDashboardPath, mountsDashboard } from '../src/dashboard-recipe.js';

const text = (files, rel) => files.get(rel).content.toString('utf8');
const render = (options, renderOptions) => renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', ...options }), renderOptions);

// Sign-in and the dashboard on the database ORM are served from @cossackframework/dashboard
// (specs/dashboard-package.md). A project holds its choices and its schema, not the shell.
describe('dashboard recipe', () => {
  it('mounts the package and holds no sign-in page, dashboard, service or auth module', async () => {
    const files = await render({ features: ['dashboard'] });
    const pkg = JSON.parse(text(files, 'package.json'));
    expect(pkg.cossack).toMatchObject({ runtime: 'node', packages: [DASHBOARD_PACKAGE] });
    expect(pkg.dependencies[DASHBOARD_PACKAGE]).toMatch(/^\^\d/);
    for (const rel of files.keys()) expect(isServedDashboardPath(rel), rel).toBe(false);
    for (const rel of ['src/auth.ts', 'src/pages/auth/login/index.ts', 'src/pages/dashboard/layout.ts', 'src/dashboard/registry.ts', 'src/services/users.ts', 'src/middlewares/auth.ts', 'src/config/auth.ts', 'src/lib/uuid.ts'])
      expect(files.has(rel), rel).toBe(false);
    // The schema is the project's: the served code reads these models through `@/models/...`.
    for (const rel of ['src/models/User.ts', 'src/models/Session.ts', 'src/models/Role.ts', 'src/models/UserRole.ts', 'src/models/OAuthAccount.ts', 'src/migrations/0001_create_users.ts',
      'src/seeders/application.seeder.ts', 'src/orm/factory.ts', 'src/middlewares/orm.ts', 'src/stores.client.ts', 'src/dashboard.config.ts'])
      expect(files.has(rel), rel).toBe(true);
    // The session and the guard are one list from the package, after the ORM's request scope.
    expect(text(files, 'src/bootstrap/middlewares.ts')).toContain(`import { authMiddlewares } from '${DASHBOARD_PACKAGE}/app/middlewares/auth';`);
    expect(text(files, 'src/bootstrap/middlewares.ts')).toMatch(/ormRequestMiddleware,\n {2}\.\.\.authMiddlewares,/);
    // Tailwind scans the served files, and the seeder takes plain helpers from the package.
    expect(text(files, 'src/style.css')).toContain(`@source "../node_modules/${DASHBOARD_PACKAGE}/app/src";`);
    expect(text(files, 'src/seeders/application.seeder.ts')).toContain(`from '${DASHBOARD_PACKAGE}/app/lib/permissions';`);
    expect(text(files, 'src/index.ts')).not.toContain('oauth');
  });

  it('keeps every served path for the package\'s own application', async () => {
    const held = await render({ features: ['dashboard'] }, { servedFiles: true });
    const project = await render({ features: ['dashboard'] });
    for (const rel of held.keys()) expect(project.has(rel), rel).toBe(!isServedDashboardPath(rel));
    // Every listed path names something the template renders.
    for (const entry of SERVED_DASHBOARD_PATHS) expect([...held.keys()].some(rel => entry.endsWith('/') ? rel.startsWith(entry) : rel === entry), entry).toBe(true);
    expect(held.has('src/pages/auth/[provider]/callback.ts')).toBe(true);
  });

  it('writes the recipe\'s choices as values in src/dashboard.config.ts', async () => {
    const all = text(await render({ features: ['dashboard'] }), 'src/dashboard.config.ts');
    expect(all).toContain(`import type { DashboardConfig } from '${DASHBOARD_PACKAGE}';`);
    expect(all).toContain("  authMethods: ['credentials'],");
    expect(all).toContain('  oauth: [],');
    expect(all).toContain(`  modules: [${DASHBOARD_MODULES.map(module => `'${module}'`).join(', ')}],`);
    expect(all).not.toContain('dashboard: false');

    const some = text(await render({ features: ['dashboard'], dashboardModules: 'sessions,settings' }), 'src/dashboard.config.ts');
    expect(some).toContain("  modules: ['sessions', 'settings'],");

    const oauth = text(await render({ preset: 'auth', authMethods: 'oauth', oauth: 'github,google' }, { authSecret: 'abcdefghijklmnopqrstuvwxyz123456' }), 'src/dashboard.config.ts');
    expect(oauth).toContain("  authMethods: ['oauth'],");
    expect(oauth).toContain("  oauth: ['github', 'google'],");
    // Sign-in without the dashboard feature: its pages answer 404, and a sign-in goes home.
    expect(oauth).toContain('  dashboard: false,');
    expect(oauth).not.toContain('modules:');
    const guarded = text(await render({ preset: 'auth', features: ['protected-route'] }), 'src/dashboard.config.ts');
    expect(guarded).toContain("  redirectAfterLogin: '/protected-route',");
  });

  it('renders the same shell whatever the recipe chose: the served code reads the choices', async () => {
    const plain = await render({ features: ['dashboard'], dashboardModules: 'sessions' }, { servedFiles: true });
    const full = await render({ preset: 'auth', features: ['dashboard'], authMethods: 'credentials,oauth', oauth: 'github' }, { servedFiles: true, authSecret: 'abcdefghijklmnopqrstuvwxyz123456' });
    for (const rel of plain.keys()) {
      if (isServedDashboardPath(rel)) expect(full.get(rel)?.content.equals(plain.get(rel).content), rel).toBe(true);
    }
    const auth = text(plain, 'src/auth.ts');
    expect(auth).toContain("import { authOptions } from './auth-options';");
    expect(auth).toContain('providers: Object.fromEntries(authOptions.oauth.map(');
    expect(auth).toContain("new OAuthError('COSSACK_OAUTH_CREDENTIALS_MISSING')");
    expect(text(plain, 'src/auth-options.ts')).toContain("import { dashboard } from '@/dashboard.config';");
    const login = text(plain, 'src/pages/auth/login/index.ts');
    expect(login).toContain('href="/auth/${provider}/redirect"');
    expect(login).toContain('if (!this.credentials) return html`');
    expect(text(plain, 'src/dashboard/registry.ts')).toContain('authOptions.modules');
    for (const module of DASHBOARD_MODULES) expect(plain.has(`src/dashboard/modules/${module}.ts`), module).toBe(true);
    expect(text(plain, 'src/dashboard/modules/roles.ts')).toContain("parent: 'users'");
    // The guard answers 404 for what is off, and lets the OAuth routes through for a signed-in user.
    const guard = text(plain, 'src/middlewares/auth.ts');
    expect(guard).toContain('if (turnedOff(path)) return c.notFound();');
    expect(guard).toContain('export const authMiddlewares = [auth.middleware, authGuard];');
  });

  it('installs roles with every ORM sign-in, and seeds them only with a dashboard', async () => {
    const sessions = await render({ features: ['dashboard'], dashboardModules: ['sessions'] });
    for (const rel of ['src/models/Role.ts', 'src/models/UserRole.ts', 'src/migrations/0003_create_roles.ts', 'src/migrations/0007_create_user_roles.ts']) expect(sessions.has(rel), rel).toBe(true);
    expect(text(sessions, 'src/migrations/index.ts')).toContain("'./0007_create_user_roles'");
    expect(text(sessions, 'src/models/User.ts')).toContain('roleAssignments');
    expect(text(sessions, 'src/seeders/application.seeder.ts')).toContain('ALL_PERMISSIONS');
    const signIn = await render({ preset: 'auth' });
    expect(signIn.has('src/models/Role.ts')).toBe(true);
    expect(text(signIn, 'src/seeders/application.seeder.ts')).toContain('// Add application seed data here.');
  });

  it('leaves the package out without ORM sign-in', async () => {
    const minimal = await render({});
    expect(JSON.parse(text(minimal, 'package.json')).cossack).not.toHaveProperty('packages');
    expect(minimal.has('src/dashboard.config.ts')).toBe(false);
    // The CMS serves its own copy of the shell and its own choices.
    const cms = resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] });
    expect(mountsDashboard(cms)).toBe(false);
    const files = await renderRecipe(cms);
    expect(files.has('src/dashboard.config.ts')).toBe(false);
    expect(JSON.parse(text(files, 'package.json')).dependencies).not.toHaveProperty(DASHBOARD_PACKAGE);
  });
});
