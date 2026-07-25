import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  _setPromptTestOverrides,
  DASHBOARD_MODULES,
  PromptAbortedError,
  addFeature,
  createApp,
  detectProjectRuntime,
  readManifest,
  removeFeature,
  removeFeatureFromProject,
  renderRecipe,
  resolveDashboardModules,
  resolveRecipe,
} from '../src/index.js';

const scaffoldPackage = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const dependencyVersions = scaffoldPackage.scaffold.dependencyVersions;
const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-scaffold-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  _setPromptTestOverrides();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('recipe resolution', () => {
  it('keeps Full Stack as the default and resolves all dashboard modules', () => {
    const recipe = resolveRecipe({ adapter: 'cloudflare' });
    expect(recipe.preset).toBe('full-stack');
    expect(recipe.resolvedFeatures).toEqual(['ui', 'database', 'auth', 'dashboard', 'examples']);
    expect(recipe.dashboardModules).toEqual(DASHBOARD_MODULES);
    expect(recipe.config.database).toBe('d1');
    expect(recipe.config.authMethods).toEqual(['credentials']);
  });

  it('resolves prerequisites in stable order', () => {
    const recipe = resolveRecipe({
      adapter: 'node',
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'sessions',
    });
    expect(recipe.resolvedFeatures).toEqual(['ui', 'database', 'auth', 'dashboard']);
    expect(recipe.dashboardModules).toEqual(['sessions']);
    expect(recipe.config.database).toBe('sqlite');
  });

  it('keeps Studio optional and resolves database as its prerequisite', async () => {
    expect(resolveRecipe({ preset: 'minimal' }).resolvedFeatures).not.toContain('studio');
    const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: 'studio' });
    expect(recipe.resolvedFeatures).toEqual(['database', 'studio']);
    const files = await renderRecipe(recipe);
    const pkg = JSON.parse(files.get('package.json').content.toString());
    expect(pkg.devDependencies['@cossackframework/studio']).toBe('^0.7.4');
    expect(pkg.scripts.studio).toBe('cossack studio');
  });

  it('removes dependents and then unneeded automatic prerequisites', () => {
    expect(removeFeature(['dashboard', 'examples'], 'database'))
      .toEqual(['examples']);
    expect(resolveRecipe({
      preset: 'minimal',
      features: removeFeature(['dashboard', 'examples'], 'database'),
    }).resolvedFeatures).toEqual(['ui', 'examples']);
    expect(removeFeature(['studio', 'examples'], 'database')).toEqual(['examples']);
  });

  it('rejects invalid providers, invalid modules, and duplicate modules', () => {
    expect(() => resolveRecipe({ adapter: 'node', database: 'd1' }))
      .toThrow('not supported');
    expect(() => resolveDashboardModules('missing', true))
      .toThrow('Supported values: users, sessions, settings, roles');
    expect(() => resolveDashboardModules('users,users', true))
      .toThrow('Duplicate dashboard module');
    expect(() => resolveRecipe({
      preset: 'auth',
      authMethods: 'oauth',
    })).toThrow('requires at least one provider');
  });

  it.each([
    ['cloudflare', 'minimal'],
    ['cloudflare', 'database'],
    ['cloudflare', 'auth'],
    ['cloudflare', 'full-stack'],
    ['node', 'minimal'],
    ['node', 'database'],
    ['node', 'auth'],
    ['node', 'full-stack'],
  ])('renders the %s/%s combination', async (adapter, preset) => {
    const recipe = resolveRecipe({ adapter, preset });
    const files = await renderRecipe(recipe);
    const pkg = JSON.parse(files.get('package.json').content.toString());
    expect(files.has('src/App.ts')).toBe(true);
    expect(files.has('wrangler.jsonc')).toBe(adapter === 'cloudflare');
    expect(files.has('src/db/config.ts')).toBe(recipe.resolvedFeatures.includes('database'));
    expect(files.has('src/auth.ts')).toBe(recipe.resolvedFeatures.includes('auth'));
    expect(files.has('src/pages/dashboard/layout.ts'))
      .toBe(recipe.resolvedFeatures.includes('dashboard'));
    expect(files.has('src/pages/(public)/index.ts'))
      .toBe(recipe.resolvedFeatures.includes('examples'));
    expect(Boolean(pkg.dependencies['@cossackframework/ui']))
      .toBe(recipe.resolvedFeatures.includes('ui'));
    if (recipe.resolvedFeatures.includes('ui')) {
      expect(pkg.dependencies['@cossackframework/solar-icons'])
        .toBe(dependencyVersions['@cossackframework/solar-icons']);
    }
    expect(Boolean(pkg.dependencies['@cossackframework/database']))
      .toBe(recipe.resolvedFeatures.includes('database'));
    expect(Boolean(pkg.dependencies['@cossackframework/auth']))
      .toBe(recipe.resolvedFeatures.includes('auth'));
    expect(files.has('.env')).toBe(adapter === 'node');
    expect(files.has('.env.example')).toBe(adapter === 'node');
  });
});

describe('composition', () => {
  it('adds and removes Studio with database dependency ownership', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'cloudflare',
      preset: 'minimal',
      interactive: false,
    });
    const added = await addFeature(project.projectDir, 'studio', {
      interactive: false,
    });
    expect(added.addedFeatures).toEqual(['database', 'studio']);
    let pkg = JSON.parse(await fs.readFile(
      path.join(project.projectDir, 'package.json'),
      'utf8',
    ));
    expect(pkg.dependencies).toHaveProperty('@cossackframework/database');
    expect(pkg.devDependencies).toHaveProperty('@cossackframework/studio');
    expect(pkg.scripts.studio).toBe('cossack studio');

    const removedStudio = await removeFeatureFromProject(project.projectDir, 'studio', {
      interactive: false,
      yes: true,
    });
    expect(removedStudio.recipe.resolvedFeatures).toEqual(['database']);
    pkg = JSON.parse(await fs.readFile(path.join(project.projectDir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies).not.toHaveProperty('@cossackframework/studio');
    expect(pkg.scripts).not.toHaveProperty('studio');
    expect(pkg.dependencies).toHaveProperty('@cossackframework/database');

    await addFeature(project.projectDir, 'studio', { interactive: false });
    const removedDatabase = await removeFeatureFromProject(project.projectDir, 'database', {
      interactive: false,
      yes: true,
    });
    expect(removedDatabase.recipe.resolvedFeatures).toEqual([]);
    pkg = JSON.parse(await fs.readFile(path.join(project.projectDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies).not.toHaveProperty('@cossackframework/database');
    expect(pkg.devDependencies).not.toHaveProperty('@cossackframework/studio');
    expect(pkg.scripts).not.toHaveProperty('studio');
  });

  it('produces the same recipe and owned contents incrementally and initially', async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    const incremental = await createApp('app', {
      cwd: firstRoot,
      adapter: 'cloudflare',
      preset: 'minimal',
      interactive: false,
    });
    await addFeature(incremental.projectDir, 'auth', {
      interactive: false,
      oauth: 'github,google',
      theme: 'blue',
    });
    const initial = await createApp('app', {
      cwd: secondRoot,
      adapter: 'cloudflare',
      preset: 'minimal',
      features: 'auth',
      oauth: 'github,google',
      theme: 'blue',
      interactive: false,
    });
    const incrementalManifest = await readManifest(incremental.projectDir);
    const initialManifest = await readManifest(initial.projectDir);
    expect(incrementalManifest.resolvedFeatures).toEqual(initialManifest.resolvedFeatures);
    expect(incrementalManifest.files).toEqual(initialManifest.files);
  });

  it('produces identical selected-dashboard output incrementally and initially', async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    const incremental = await createApp('app', {
      cwd: firstRoot,
      adapter: 'node',
      preset: 'minimal',
      interactive: false,
    });
    await addFeature(incremental.projectDir, 'dashboard', {
      features: 'sessions,settings',
      interactive: false,
    });
    const initial = await createApp('app', {
      cwd: secondRoot,
      adapter: 'node',
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'sessions,settings',
      interactive: false,
    });
    expect((await readManifest(incremental.projectDir)).files)
      .toEqual((await readManifest(initial.projectDir)).files);
  });

  it.each(DASHBOARD_MODULES)(
    'installs only the %s dashboard navigation descriptor',
    async (module) => {
      const recipe = resolveRecipe({
        adapter: 'cloudflare',
        preset: 'minimal',
        features: 'dashboard',
        dashboardModules: module,
      });
      const files = await renderRecipe(recipe, { projectName: 'app' });
      const registry = files.get('src/dashboard/registry.ts').content.toString();
      expect(registry).toContain(`import ${module} from './modules/${module}';`);
      for (const other of DASHBOARD_MODULES.filter((candidate) => candidate !== module)) {
        expect(registry).not.toContain(`./modules/${other}`);
      }
      expect(files.has(`src/dashboard/modules/${module}.ts`)).toBe(true);
    },
  );

  it.each([
    ['users,sessions', ['users', 'sessions']],
    ['settings,roles', ['settings', 'roles']],
    ['users,sessions,settings,roles', DASHBOARD_MODULES],
  ])('renders only selected dashboard modules for %s', async (selected, expected) => {
    const files = await renderRecipe(resolveRecipe({
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: selected,
    }));
    const registry = files.get('src/dashboard/registry.ts').content.toString();
    for (const module of DASHBOARD_MODULES) {
      expect(registry.includes(`./modules/${module}`)).toBe(expected.includes(module));
    }
  });

  it('keeps the dashboard layout stable when modules are added', async () => {
    const sessions = await renderRecipe(resolveRecipe({
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'sessions',
    }));
    const expanded = await renderRecipe(resolveRecipe({
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'sessions,settings',
    }));
    expect(sessions.get('src/pages/dashboard/layout.ts').content)
      .toEqual(expanded.get('src/pages/dashboard/layout.ts').content);
    expect(sessions.get('src/dashboard/registry.ts').content)
      .not.toEqual(expanded.get('src/dashboard/registry.ts').content);
  });

  it('installs users RBAC support without exposing Roles pages', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'cloudflare',
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'users',
    }), { projectName: 'app' });
    expect(files.has('src/models/Role.ts')).toBe(true);
    expect(files.has('src/pages/dashboard/users/index.ts')).toBe(true);
    expect(files.has('src/pages/dashboard/roles/index.ts')).toBe(false);
    expect(files.has('src/dashboard/modules/roles.ts')).toBe(false);
  });

  it('renders configured OAuth providers and UI theme', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'cloudflare',
      preset: 'auth',
      oauth: 'github,google',
      theme: 'green',
    }));
    expect(files.get('src/auth.ts').content.toString()).toContain('createOAuth');
    expect(files.get('src/auth.ts').content.toString()).toContain('createOAuthForRequest');
    expect(files.get('src/auth.ts').content.toString()).toContain('c.env.OAUTH_SECRET');
    expect(files.get('src/auth.ts').content.toString()).toContain('GITHUB_CLIENT_ID');
    expect(files.get('src/auth.ts').content.toString())
      .toContain("error: 'OAuth is not configured'");
    expect(files.get('src/auth.ts').content.toString())
      .toContain('[Cossack OAuth]');
    const login = files.get('src/pages/auth/login/index.ts').content.toString();
    expect(login).toContain('/auth/google/redirect');
    expect(login).toContain('data-oauth-provider="github"');
    expect(login).toContain('data-oauth-provider="google"');
    expect(login).toContain('<svg aria-hidden="true"');
    expect(login.indexOf('<form @submit=')).toBeLessThan(
      login.indexOf('data-oauth-provider="github"'),
    );
    expect(files.get('src/style.css').content.toString())
      .toContain('@cossackframework/ui/theme/themes/green.css');
  });

  it('supports credentials, OAuth, or both authentication methods', async () => {
    const credentials = await renderRecipe(resolveRecipe({
      preset: 'auth',
      authMethods: 'credentials',
    }));
    expect(credentials.has('src/pages/auth/register/index.ts')).toBe(true);
    expect(credentials.has('src/migrations/0005_create_oauth_accounts.ts')).toBe(false);
    expect(credentials.has('.dev.vars')).toBe(false);

    const oauth = await renderRecipe(resolveRecipe({
      preset: 'auth',
      authMethods: 'oauth',
      oauth: 'github',
    }), { authSecret: 'abcdefghijklmnopqrstuvwxyz123456' });
    expect(oauth.has('src/pages/auth/register/index.ts')).toBe(false);
    expect(oauth.has('src/migrations/0005_create_oauth_accounts.ts')).toBe(true);
    const oauthLogin = oauth.get('src/pages/auth/login/index.ts').content.toString();
    expect(oauthLogin).not.toContain('<form @submit=');
    expect(oauthLogin).not.toContain('class="mt-6 flex items-center gap-3"');
    expect(oauthLogin).toContain('Continue with GitHub');

    const both = await renderRecipe(resolveRecipe({
      preset: 'auth',
      authMethods: 'credentials,oauth',
      oauth: 'github',
    }), { authSecret: 'abcdefghijklmnopqrstuvwxyz123456' });
    expect(both.has('src/pages/auth/register/index.ts')).toBe(true);
    const bothLogin = both.get('src/pages/auth/login/index.ts').content.toString();
    expect(bothLogin).toContain('<form @submit=');
    expect(bothLogin.indexOf('<form @submit=')).toBeLessThan(
      bothLogin.indexOf('data-oauth-provider="github"'),
    );
  });

  it('generates Node environment defaults without recording local secrets', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'auth',
      authMethods: 'oauth',
      oauth: 'github',
      interactive: false,
    });
    const pkg = JSON.parse(await fs.readFile(
      path.join(project.projectDir, 'package.json'),
      'utf8',
    ));
    expect(pkg.cossack.runtime).toBe('node');
    expect(pkg.scripts.dev).toContain('--env-file-if-exists=.env');
    expect(pkg.scripts.build).toContain(
      'vite build --ssr src/index.ts --outDir dist/server',
    );
    expect(pkg.scripts.start).toContain('dist/server/index.js');
    expect(pkg.scripts.migrate).toContain('migration up');
    expect(pkg.scripts.postinstall).toBe('pnpm run migrate');
    expect(pkg.pnpm.onlyBuiltDependencies).toContain('better-sqlite3');
    expect(pkg.dependencies['better-sqlite3']).toBe('^13.0.1');
    expect(await detectProjectRuntime(project.projectDir)).toBe('node');
    const environment = await fs.readFile(path.join(project.projectDir, '.env'), 'utf8');
    const appSecret = environment.match(/^APP_SECRET=(.+)$/m)?.[1];
    const oauthSecret = environment.match(/^OAUTH_SECRET=(.+)$/m)?.[1];
    expect(appSecret?.length).toBeGreaterThanOrEqual(32);
    expect(oauthSecret?.length).toBeGreaterThanOrEqual(32);
    expect(environment).toContain('APP_URL=http://localhost:3000');
    expect(environment).toContain('DB_CONNECTION=sqlite');
    expect(environment).toContain('DB_PATH=./database.sqlite');
    expect(environment).toContain('GITHUB_CLIENT_ID=');
    const example = await fs.readFile(
      path.join(project.projectDir, '.env.example'),
      'utf8',
    );
    expect(example).toContain('APP_SECRET=replace-with-a-random-32-byte-secret');
    expect(example).toContain('GITHUB_CLIENT_ID=your-github-client-id');
    const manifest = await readManifest(project.projectDir);
    expect(manifest.config).not.toHaveProperty('appSecret');
    expect(manifest.config).not.toHaveProperty('authSecret');
    expect(manifest.files).not.toHaveProperty('.env');
    expect(manifest.files).toHaveProperty('.env.example');
    expect(manifest.files).not.toHaveProperty('src/config/oauth.ts');
  });

  it('keeps Node minimal free of database dependencies while still providing env defaults', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'node',
      preset: 'minimal',
    }), { projectName: 'minimal-app' });
    const pkg = JSON.parse(files.get('package.json').content.toString());
    const environment = files.get('.env').content.toString();

    expect(pkg.dependencies).not.toHaveProperty('better-sqlite3');
    expect(pkg.devDependencies).not.toHaveProperty('@types/better-sqlite3');
    expect(pkg.scripts).not.toHaveProperty('postinstall');
    expect(environment).toContain('APP_NAME=minimal-app');
    expect(environment).not.toContain('DB_PATH=');
    expect(files.get('.env.example').content.toString())
      .toContain('APP_URL=http://localhost:3000');
  });

  it('uses the non-deprecated better-sqlite3 release for D1 migration tooling', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'cloudflare',
      preset: 'database',
      database: 'd1',
    }));
    const pkg = JSON.parse(files.get('package.json').content.toString());
    expect(pkg.devDependencies['better-sqlite3'])
      .toBe(dependencyVersions['better-sqlite3']);
  });

  it('detects a Node minimal project before adding auth', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      interactive: false,
    });
    const initialEnvironment = await fs.readFile(
      path.join(project.projectDir, '.env'),
      'utf8',
    );
    const initialAppSecret = initialEnvironment.match(/^APP_SECRET=(.+)$/m)?.[1];
    const result = await addFeature(project.projectDir, 'auth', {
      interactive: false,
    });
    expect(result.recipe.adapter).toBe('node');
    expect(result.recipe.config.database).toBe('sqlite');
    expect(await fs.readFile(
      path.join(project.projectDir, 'src/db/config.ts'),
      'utf8',
    )).toContain("from 'better-sqlite3'");
    expect(await fs.readFile(
      path.join(project.projectDir, 'src/config/database.ts'),
      'utf8',
    )).toContain("env('DB_CONNECTION', 'sqlite')");
    expect(await fs.readFile(
      path.join(project.projectDir, '.env'),
      'utf8',
    )).toEqual(expect.stringContaining(`APP_SECRET=${initialAppSecret}`));
    expect(await fs.readFile(
      path.join(project.projectDir, '.env'),
      'utf8',
    )).toContain('DB_PATH=./database.sqlite');
    await expect(fs.access(
      path.join(project.projectDir, 'src/config/oauth.ts'),
    )).rejects.toThrow();
  });

  it('returns an unknown runtime when no reliable signal exists', async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'unknown-runtime',
      dependencies: { '@cossackframework/framework': '^0.7.4' },
    }));
    expect(await detectProjectRuntime(root)).toBeUndefined();
    await expect(addFeature(root, 'ui', { interactive: false }))
      .rejects.toThrow('Pass --runtime=cloudflare or --runtime=node');
  });

  it('adds only newly requested dashboard modules on a later run', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'sessions',
      interactive: false,
    });
    const result = await addFeature(project.projectDir, 'dashboard', {
      features: 'settings',
      interactive: false,
    });
    expect(result.recipe.dashboardModules).toEqual(['sessions', 'settings']);
    expect(result.changes.writes.map((change) => change.path)).toContain(
      'src/dashboard/modules/settings.ts',
    );
    expect(result.changes.writes.map((change) => change.path)).not.toContain(
      'src/pages/dashboard/users/index.ts',
    );
  });

  it('expands a partial dashboard to all modules on a plain repeated add', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'sessions',
      interactive: false,
    });
    const expanded = await addFeature(project.projectDir, 'dashboard', {
      interactive: false,
    });
    expect(expanded.status).toBe('added');
    expect(expanded.recipe.dashboardModules).toEqual(DASHBOARD_MODULES);
    const repeated = await addFeature(project.projectDir, 'dashboard', {
      interactive: false,
    });
    expect(repeated.status).toBe('present');
  });

  it('records an automatically resolved prerequisite when the user adds it explicitly', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      features: 'examples',
      interactive: false,
    });
    expect((await readManifest(project.projectDir)).explicitFeatures)
      .toEqual(['examples']);

    const added = await addFeature(project.projectDir, 'ui', {
      interactive: false,
    });
    expect(added.status).toBe('added');
    expect((await readManifest(project.projectDir)).explicitFeatures)
      .toEqual(['ui', 'examples']);

    const removed = await removeFeatureFromProject(project.projectDir, 'examples', {
      interactive: false,
    });
    expect(removed.recipe.resolvedFeatures).toEqual(['ui']);
  });

  it('preserves unrelated local edits and their original manifest baseline', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      interactive: false,
    });
    const before = await readManifest(project.projectDir);
    const relative = 'src/pages/index.ts';
    const page = path.join(project.projectDir, relative);
    await fs.appendFile(page, '\n// local edit\n');

    const result = await addFeature(project.projectDir, 'database', {
      interactive: false,
    });
    expect(result.status).toBe('added');
    expect(result.changes.preserved).toContainEqual({
      path: relative,
      capability: 'base',
      reason: 'locally-modified',
    });
    expect(await fs.readFile(page, 'utf8')).toContain('// local edit');
    const after = await readManifest(project.projectDir);
    expect(after.files[relative].hash).toBe(before.files[relative].hash);
  });

  it('protects user-owned collisions before writing', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'cloudflare',
      preset: 'minimal',
      interactive: false,
    });
    const collision = path.join(project.projectDir, 'src/pages/auth/login/index.ts');
    await fs.mkdir(path.dirname(collision), { recursive: true });
    await fs.writeFile(collision, '// user-owned\n');
    await expect(addFeature(project.projectDir, 'auth', { interactive: false }))
      .rejects.toThrow('Scaffold conflicts');
    expect(await fs.readFile(collision, 'utf8')).toBe('// user-owned\n');
    expect((await readManifest(project.projectDir)).resolvedFeatures).toEqual([]);
  });

  it('allows force to replace a colliding feature file', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'cloudflare',
      preset: 'minimal',
      interactive: false,
    });
    const collision = path.join(project.projectDir, 'src/pages/auth/login/index.ts');
    await fs.mkdir(path.dirname(collision), { recursive: true });
    await fs.writeFile(collision, '// user-owned\n');
    const result = await addFeature(project.projectDir, 'auth', {
      interactive: false,
      force: true,
    });
    expect(result.status).toBe('added');
    expect(await fs.readFile(collision, 'utf8')).not.toBe('// user-owned\n');
  });

  it('does not claim ownership of a matching pre-existing file', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      interactive: false,
    });
    const authRecipe = resolveRecipe({
      adapter: 'node',
      preset: 'minimal',
      features: 'auth',
    });
    const desired = await renderRecipe(authRecipe, { projectName: 'app' });
    const relative = 'src/pages/auth/login/index.ts';
    const target = path.join(project.projectDir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, desired.get(relative).content);

    const result = await addFeature(project.projectDir, 'auth', {
      interactive: false,
    });
    expect(result.changes.preserved).toContainEqual({
      path: relative,
      capability: 'auth',
      reason: 'user-owned',
    });
    expect((await readManifest(project.projectDir)).files)
      .not.toHaveProperty(relative);
  });

  it('removes dependents, unused prerequisites, and scaffold package entries', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      features: 'dashboard,examples',
      dashboardModules: 'sessions',
      interactive: false,
    });
    const packagePath = path.join(project.projectDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    pkg.dependencies['user-package'] = '^1.0.0';
    pkg.scripts.custom = 'echo custom';
    await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');

    const result = await removeFeatureFromProject(project.projectDir, 'database', {
      interactive: false,
    });
    expect(result.status).toBe('removed');
    expect(result.recipe.explicitFeatures).toEqual(['examples']);
    expect(result.recipe.resolvedFeatures).toEqual(['ui', 'examples']);
    const updated = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    expect(updated.dependencies).not.toHaveProperty('@cossackframework/auth');
    expect(updated.dependencies).not.toHaveProperty('@cossackframework/database');
    expect(updated.dependencies).toHaveProperty('user-package', '^1.0.0');
    expect(updated.scripts).not.toHaveProperty('migrate');
    expect(updated.scripts).not.toHaveProperty('postinstall');
    expect(updated.scripts.custom).toBe('echo custom');
    await expect(fs.access(
      path.join(project.projectDir, 'src/pages/dashboard/sessions/index.ts'),
    )).rejects.toThrow();
  });

  it('protects modified files during removal unless forced', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'database',
      interactive: false,
    });
    const middleware = path.join(project.projectDir, 'src/middlewares/db.ts');
    await fs.appendFile(middleware, '\n// local edit\n');
    await expect(removeFeatureFromProject(project.projectDir, 'database', {
      interactive: false,
    })).rejects.toThrow('Scaffold conflicts');
    expect(await fs.readFile(middleware, 'utf8')).toContain('// local edit');

    const forced = await removeFeatureFromProject(project.projectDir, 'database', {
      interactive: false,
      force: true,
    });
    expect(forced.status).toBe('removed');
    await expect(fs.access(middleware)).rejects.toThrow();
  });
});

describe('prompt navigation and cancellation', () => {
  function promptSequence(input, responses) {
    const names = [];
    _setPromptTestOverrides({
      input,
      prompt: async (question, hooks) => {
        names.push(question.name);
        const response = responses.shift();
        if (response === 'escape') {
          input.emit('keypress', '', { name: 'escape' });
          hooks.onCancel();
          return {};
        }
        if (response === 'ctrl-c') {
          input.emit('keypress', '', { name: 'c', ctrl: true });
          hooks.onCancel();
          return {};
        }
        return { [question.name]: response };
      },
    });
    return names;
  }

  it('uses Escape to return to the previous question', async () => {
    const root = await temporaryDirectory();
    const input = new EventEmitter();
    const names = promptSequence(input, [
      'node',
      'escape',
      'node',
      'minimal',
      false,
    ]);
    const result = await createApp('app', {
      cwd: root,
      interactive: true,
    });
    expect(result.status).toBe('cancelled');
    expect(names).toEqual([
      'adapter',
      'preset',
      'adapter',
      'preset',
      'confirmed',
    ]);
    await expect(fs.access(result.projectDir)).rejects.toThrow();
  });

  it('uses Ctrl+C to abort the entire wizard', async () => {
    const root = await temporaryDirectory();
    const input = new EventEmitter();
    promptSequence(input, ['ctrl-c']);
    await expect(createApp('app', {
      cwd: root,
      interactive: true,
    })).rejects.toBeInstanceOf(PromptAbortedError);
    await expect(fs.access(path.join(root, 'app'))).rejects.toThrow();
  });

  it('writes nothing when final confirmation is declined', async () => {
    const root = await temporaryDirectory();
    const input = new EventEmitter();
    const names = promptSequence(input, [false]);
    const result = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      interactive: true,
    });
    expect(result.status).toBe('cancelled');
    expect(names).toEqual(['confirmed']);
    await expect(fs.access(result.projectDir)).rejects.toThrow();
  });

  it('writes nothing when an add confirmation is declined', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      interactive: false,
    });
    const before = await fs.readFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      'utf8',
    );
    const input = new EventEmitter();
    const names = promptSequence(input, [false]);

    const result = await addFeature(project.projectDir, 'auth', {
      database: 'sqlite',
      theme: 'default',
      authMethods: 'credentials',
      interactive: true,
    });
    expect(result.status).toBe('cancelled');
    expect(names).toEqual(['confirmed']);
    expect(await fs.readFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      'utf8',
    )).toBe(before);
    await expect(fs.access(
      path.join(project.projectDir, 'src/auth.ts'),
    )).rejects.toThrow();
  });
});
