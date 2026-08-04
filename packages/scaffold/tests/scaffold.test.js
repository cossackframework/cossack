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
    expect(recipe.resolvedFeatures).toEqual([
      'ui', 'database', 'auth', 'dashboard', 'markdown', 'examples',
    ]);
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
    expect(pkg.devDependencies['@cossackframework/studio']).toBe(`^${scaffoldPackage.version}`);
    expect(pkg.scripts.studio).toBe('cossack studio');
  });

  it('removes dependents and then unneeded automatic prerequisites', () => {
    expect(removeFeature(['dashboard', 'examples'], 'database'))
      .toEqual(['examples']);
    expect(resolveRecipe({
      preset: 'minimal',
      features: removeFeature(['dashboard', 'examples'], 'database'),
    }).resolvedFeatures).toEqual(['ui', 'markdown', 'examples']);
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
    ['deno', 'minimal'],
    ['deno', 'database'],
    ['deno', 'auth'],
    ['deno', 'full-stack'],
  ])('renders the %s/%s combination', async (adapter, preset) => {
    const recipe = resolveRecipe({ adapter, preset });
    const files = await renderRecipe(recipe);
    const pkg = JSON.parse(files.get('package.json').content.toString());
    const pnpmWorkspace = files.get('pnpm-workspace.yaml').content.toString();
    expect(files.has('README.md')).toBe(true);
    expect(files.has('AGENTS.md')).toBe(true);
    expect(pkg).not.toHaveProperty('pnpm');
    expect(pnpmWorkspace).toContain('allowBuilds:');
    expect(pnpmWorkspace).toContain('sharp: true');
    expect(files.has('src/App.ts')).toBe(true);
    expect(files.has('wrangler.jsonc')).toBe(adapter === 'cloudflare');
    expect(files.has('src/orm/factory.ts')).toBe(recipe.resolvedFeatures.includes('database'));
    expect(files.has('orm.config.ts')).toBe(recipe.resolvedFeatures.includes('database'));
    expect(files.has('src/auth.ts')).toBe(recipe.resolvedFeatures.includes('auth'));
    expect(files.has('src/pages/dashboard/layout.ts'))
      .toBe(recipe.resolvedFeatures.includes('dashboard'));
    if (recipe.resolvedFeatures.includes('dashboard')) {
      const layout = files.get('src/pages/dashboard/layout.ts').content.toString();
      expect(layout).toContain('component(Sidebar');
      expect(layout).toContain('component(DropdownMenu');
      expect(layout).toContain('collapsible:');
      expect(layout).toContain('accountModules.map');
      expect(layout).toContain('dashboardModules');
    }
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
    if (recipe.resolvedFeatures.includes('database')) {
      expect(files.get('src/orm/factory.ts').content.toString())
        .toContain('createORM');
      expect(files.get('orm.config.ts').content.toString())
        .toContain('createToolingAdapter');
      expect(files.get('orm.config.ts').content.toString())
        .toContain("migrationDirectory: './src/migrations'");
    }
    expect(Boolean(pkg.dependencies['reflect-metadata']))
      .toBe(recipe.resolvedFeatures.includes('database'));
    expect(files.get('src/index.ts').content.toString())
      .not.toContain("import 'reflect-metadata'");
    expect(JSON.parse(files.get('tsconfig.json').content.toString()).compilerOptions.types)
      .not.toContain('reflect-metadata');
    expect(Boolean(pkg.dependencies['@cossackframework/auth']))
      .toBe(recipe.resolvedFeatures.includes('auth'));
    expect(files.has('.env')).toBe(adapter !== 'cloudflare');
    expect(files.has('.env.example')).toBe(adapter !== 'cloudflare');
    expect(files.has('deno.json')).toBe(adapter === 'deno');
    expect(files.get('vite.config.ts').content.toString())
      .toContain('minify: true');
    expect(files.get('vite.config.ts').content.toString())
      .toContain("dedupe: [");
    expect(files.get('vite.config.ts').content.toString())
      .toContain("'@cossackframework/solar-icons'");
    expect(files.get('vite.config.ts').content.toString())
      .toContain("'hono'");
    expect(files.get('vite.config.ts').content.toString())
      .toContain("exclude: ['@cossackframework/solar-icons']");
    expect(files.get('vite.config.ts').content.toString()).toMatch(
      /environments: \{[\s\S]*ssr: \{[\s\S]*resolve: \{[\s\S]*noExternal: \['@cossackframework\/ui', '@cossackframework\/solar-icons', 'hono'\]/,
    );
    expect(files.get('vite.config.ts').content.toString())
      .toContain("ignored: ['**/.wrangler/**']");
    expect(files.get('vite.config.ts').content.toString())
      .toContain("path.resolve(import.meta.dirname, './src')");
    expect(files.get('vite.config.ts').content.toString())
      .not.toContain('__dirname');
  });

  it('preserves the pre-paint theme through hydration', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'cloudflare',
      preset: 'full-stack',
    }));
    const root = files.get('src/root.ts').content.toString();
    const app = files.get('src/App.ts').content.toString();
    const store = files.get('src/stores.client.ts').content.toString();

    expect(root.indexOf('prefers-color-scheme')).toBeLessThan(
      root.indexOf('{{ cossackScripts }}'),
    );
    expect(store).toContain("document.documentElement.classList.contains('dark')");
    expect(app).not.toContain('themeStore.set(');
    expect(app).not.toContain('savedTheme');
  });

  it('loads only the selected Solar icon variant in generated application code', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'cloudflare',
      preset: 'full-stack',
    }));
    const iconImports = [...files.values()]
      .filter((file) => file.type !== 'binary')
      .flatMap((file) => file.content.toString().match(
        /from '@cossackframework\/solar-icons\/(?!types)[^']+'/g,
      ) ?? []);

    expect(iconImports.length).toBeGreaterThan(0);
    expect(iconImports.every((statement) => statement.endsWith("/line'"))).toBe(true);

    const viteConfig = files.get('vite.config.ts').content.toString();
    expect(viteConfig).toContain("include: [");
    expect(viteConfig).toContain("'@cossackframework/ui'");
    expect(viteConfig).toContain("'@cossackframework/auth'");
    expect(viteConfig).toContain("'@cossackframework/database'");
    expect(viteConfig).toContain("'@cossackframework/framework/cache'");
    expect(viteConfig).toContain("'hono/cookie'");
  });
});

describe('composition', () => {
  it('creates, adds, and removes application-owned Markdown support', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'cloudflare',
      preset: 'minimal',
      interactive: false,
    });

    let viteConfig = await fs.readFile(
      path.join(project.projectDir, 'vite.config.ts'),
      'utf8',
    );
    let pkg = JSON.parse(await fs.readFile(
      path.join(project.projectDir, 'package.json'),
      'utf8',
    ));
    expect(viteConfig).toContain('cossackPages(),');
    expect(viteConfig).not.toContain('processMarkdown');
    expect(pkg.devDependencies).not.toHaveProperty('unified');

    const added = await addFeature(project.projectDir, 'markdown', {
      interactive: false,
    });
    expect(added.status).toBe('added');
    await expect(fs.readFile(
      path.join(project.projectDir, 'src/markdown-processor.ts'),
      'utf8',
    )).resolves.toContain('export async function processMarkdown');
    viteConfig = await fs.readFile(path.join(project.projectDir, 'vite.config.ts'), 'utf8');
    pkg = JSON.parse(await fs.readFile(path.join(project.projectDir, 'package.json'), 'utf8'));
    expect(viteConfig).toContain('cossackPages({ markdownProcessor: processMarkdown })');
    expect(viteConfig).toContain("from './src/markdown-processor.ts'");
    expect(pkg.devDependencies).toHaveProperty('unified');
    expect(pkg.devDependencies).toHaveProperty('remark-parse');

    const removed = await removeFeatureFromProject(project.projectDir, 'markdown', {
      interactive: false,
      yes: true,
    });
    expect(removed.status).toBe('removed');
    await expect(fs.access(
      path.join(project.projectDir, 'src/markdown-processor.ts'),
    )).rejects.toThrow();
    viteConfig = await fs.readFile(path.join(project.projectDir, 'vite.config.ts'), 'utf8');
    pkg = JSON.parse(await fs.readFile(path.join(project.projectDir, 'package.json'), 'utf8'));
    expect(viteConfig).toContain('cossackPages(),');
    expect(viteConfig).not.toContain('processMarkdown');
    expect(pkg.devDependencies).not.toHaveProperty('unified');
  });

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
      const descriptor = files.get(`src/dashboard/modules/${module}.ts`).content.toString();
      expect(descriptor).toContain('@cossackframework/solar-icons/');
      expect(descriptor).toContain('icon,');
      if (module === 'users' || module === 'roles') {
        expect(descriptor).toContain('children:');
        expect(descriptor).toContain(`/dashboard/${module}/new`);
      } else {
        expect(descriptor).toContain("placement: 'account'");
      }
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
    expect(files.has('src/models/OAuthAccount.ts')).toBe(true);
    expect(files.has('src/models/CacheItem.ts')).toBe(true);
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
    expect(credentials.has('src/migrations/0005_create_oauth_accounts.ts')).toBe(true);
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
    expect(pkg.scripts).not.toHaveProperty('postinstall');
    expect(pkg).not.toHaveProperty('pnpm');
    expect(await fs.readFile(
      path.join(project.projectDir, 'pnpm-workspace.yaml'),
      'utf8',
    )).not.toContain('better-sqlite3');
    expect(pkg.dependencies).not.toHaveProperty('better-sqlite3');
    const devEntry = await fs.readFile(
      path.join(project.projectDir, 'scripts/dev.js'),
      'utf8',
    );
    const productionEntry = await fs.readFile(
      path.join(project.projectDir, 'src/index.ts'),
      'utf8',
    );
    expect(devEntry).toContain('...process.env');
    expect(devEntry.indexOf('...process.env')).toBeLessThan(
      devEntry.indexOf("DB_PATH: process.env.DB_PATH ?? './database.sqlite'"),
    );
    expect(devEntry.indexOf('...process.env')).toBeLessThan(
      devEntry.indexOf('env.EMAIL = createNodeEmailSender'),
    );
    expect(productionEntry).toContain('...process.env');
    expect(productionEntry).toContain("import { serveStatic } from '@cossackframework/node-adapter'");
    expect(productionEntry).toContain("new URL('../client', import.meta.url)");
    expect(productionEntry).toContain("urlPath.startsWith('/assets/')");
    expect(productionEntry).toContain("/\\.[a-zA-Z0-9_-]{8,}\\.[^/]+$/");
    expect(productionEntry).toContain("'public, max-age=31536000, immutable'");
    expect(productionEntry.indexOf("app.use('*', serveStatic"))
      .toBeLessThan(productionEntry.indexOf("app.route('/', frameworkApp)"));
    expect(productionEntry.indexOf('...process.env')).toBeLessThan(
      productionEntry.indexOf("DB_PATH: process.env.DB_PATH ?? './database.sqlite'"),
    );
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

  it('keeps arbitrary Node bindings and explicit overrides in the raw dev template', async () => {
    const rawDevEntry = await fs.readFile(
      new URL('../template/scripts/dev.js', import.meta.url),
      'utf8',
    );

    expect(rawDevEntry).toContain('...process.env');
    expect(rawDevEntry.indexOf('...process.env')).toBeLessThan(
      rawDevEntry.indexOf("DB_PATH: process.env.DB_PATH ?? './database.sqlite'"),
    );
    expect(rawDevEntry.indexOf('...process.env')).toBeLessThan(
      rawDevEntry.indexOf('env.EMAIL = createNodeEmailSender'),
    );
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

  it('uses Wrangler local D1 for migrations without native SQLite dependencies', async () => {
    const files = await renderRecipe(resolveRecipe({
      adapter: 'cloudflare',
      preset: 'database',
      database: 'd1',
    }), { projectName: 'd1-app' });
    const pkg = JSON.parse(files.get('package.json').content.toString());
    expect(pkg.dependencies).not.toHaveProperty('better-sqlite3');
    expect(pkg.devDependencies).not.toHaveProperty('better-sqlite3');
    expect(pkg.devDependencies).not.toHaveProperty('@types/better-sqlite3');
    expect(pkg).not.toHaveProperty('pnpm');
    expect(files.get('pnpm-workspace.yaml').content.toString())
      .not.toContain('better-sqlite3: true');
    expect(pkg.scripts.migrate).toBe('cossack migration up');
    expect(pkg.scripts.dev).toBe('vite dev');
    const runtimeConfig = files.get('src/orm/factory.ts').content.toString();
    const toolingConfig = files.get('src/orm/tooling.ts').content.toString();
    const cliConfig = files.get('orm.config.ts').content.toString();
    expect(runtimeConfig).toContain("from '@cossackframework/database/cloudflare'");
    expect(runtimeConfig).not.toContain('wrangler');
    expect(toolingConfig).toContain("from 'wrangler'");
    expect(toolingConfig).toContain('getPlatformProxy');
    expect(cliConfig).toContain('createToolingAdapter');
    expect(cliConfig).toContain("migrationDirectory: './src/migrations'");
    const wrangler = files.get('wrangler.jsonc').content.toString();
    expect(wrangler).toContain('"database_id": "00000000-0000-0000-0000-000000000000"');
    expect(wrangler).toContain('"preview_database_id": "d1-app-local"');
  });

  it('renders isolated recipes for every runtime/provider target', async () => {
    const targets = [
      ['node', 'sqlite', 'nodeSQLite', undefined, undefined],
      ['node', 'turso', 'turso', '@tursodatabase/serverless', undefined],
      ['node', 'postgres', 'postgres', 'pg', undefined],
      ['node', 'mysql', 'mysql', 'mysql2', undefined],
      ['deno', 'sqlite', 'denoSQLite', '@tursodatabase/database', undefined],
      ['deno', 'turso', 'turso', '@tursodatabase/serverless', undefined],
      ['deno', 'postgres', 'postgres', 'pg', undefined],
      ['deno', 'mysql', 'mysql', 'mysql2', undefined],
      ['cloudflare', 'd1', 'd1', undefined, 'nodejs_als'],
      ['cloudflare', 'turso', 'turso', '@tursodatabase/serverless', 'nodejs_als'],
      ['cloudflare', 'hyperdrive-postgres', 'hyperdrivePostgres', 'pg', 'nodejs_compat'],
      ['cloudflare', 'hyperdrive-mysql', 'hyperdriveMySQL', 'mysql2', 'nodejs_compat'],
    ];

    for (const [adapter, database, factory, driver, compatibilityFlag] of targets) {
      const files = await renderRecipe(resolveRecipe({
        adapter,
        preset: 'database',
        database,
      }));
      const pkg = JSON.parse(files.get('package.json').content.toString());
      const runtime = files.get('src/orm/factory.ts').content.toString();
      expect(runtime).toContain(factory);
      for (const candidate of ['@tursodatabase/database', '@tursodatabase/serverless', 'pg', 'mysql2']) {
        expect(Boolean(pkg.dependencies[candidate])).toBe(candidate === driver);
      }
      if (adapter === 'cloudflare') {
        expect(files.get('wrangler.jsonc').content.toString())
          .toContain(`"compatibility_flags": ["${compatibilityFlag}"]`);
        expect(runtime).not.toContain('wrangler');
      } else {
        expect(files.has('wrangler.jsonc')).toBe(false);
      }
    }
  });

  it('adds a Deno Desktop target beside every web adapter and selects the embedded Turso client for Deno', async () => {
    for (const adapter of ['cloudflare', 'node', 'deno']) {
      const target = resolveRecipe({ adapter, preset: 'minimal', features: 'desktop' });
      const targetFiles = await renderRecipe(target, { projectName: `${adapter}-desktop` });
      const targetPackage = JSON.parse(targetFiles.get('package.json').content.toString());
      const targetDeno = JSON.parse(targetFiles.get('deno.json').content.toString());

      expect(targetPackage.dependencies['@cossackframework/deno-adapter']).toBeDefined();
      expect(targetPackage.scripts['build:desktop']).toContain('src/desktop/index.ts');
      expect(targetPackage.scripts['desktop:dev']).toContain('dist/desktop-server/index.js');
      expect(targetFiles.has('src/desktop/index.ts')).toBe(true);
      expect(targetDeno.tasks['build:desktop']).toBe('pnpm run build:desktop');
      expect(targetDeno.desktop.backend).toBe('webview');
      expect(targetDeno.desktop.output.linux).toBe('./dist/desktop');
    }

    const recipe = resolveRecipe({ adapter: 'deno', preset: 'database', features: 'desktop' });
    const files = await renderRecipe(recipe, { projectName: 'desktop-app' });
    const pkg = JSON.parse(files.get('package.json').content.toString());
    const deno = JSON.parse(files.get('deno.json').content.toString());
    expect(recipe.config.database).toBe('turso');
    expect(pkg.dependencies['@tursodatabase/database']).toBeDefined();
    expect(pkg.dependencies['@tursodatabase/serverless']).toBeUndefined();
    expect(pkg.scripts['desktop:dev']).toContain('deno desktop -A --hmr');
    expect(pkg.scripts.deploy).toBe('deno task build && deno deploy');
    expect(deno.tasks.build).toBe('pnpm run build');
    expect(deno.imports.hono).toMatch(/^npm:hono@/);
    expect(deno.imports.vite).toMatch(/^npm:vite@/);
    expect(deno.desktop.backend).toBe('webview');
    expect(files.has('src/desktop/index.ts')).toBe(true);
    expect(files.get('src/orm/factory.ts').content.toString()).toContain("turso({ path:");

    const cefRecipe = resolveRecipe({
      adapter: 'deno', preset: 'minimal', features: 'desktop', desktopBackend: 'cef',
    });
    const cefFiles = await renderRecipe(cefRecipe);
    expect(JSON.parse(cefFiles.get('deno.json').content.toString()).desktop.backend).toBe('cef');
    expect(() => resolveRecipe({
      adapter: 'deno', preset: 'minimal', features: 'desktop', desktopBackend: 'raw',
    })).toThrow('requires an HTML backend');
  });

  it('copies project guidance files and scaffolds actionable auth/database metadata', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'cloudflare',
      preset: 'full-stack',
      interactive: false,
    });

    await expect(fs.readFile(path.join(project.projectDir, 'README.md'), 'utf8'))
      .resolves.toContain('# Cossack Framework');
    await expect(fs.readFile(path.join(project.projectDir, 'AGENTS.md'), 'utf8'))
      .resolves.toContain('Cossack Framework');

    const auth = await fs.readFile(path.join(project.projectDir, 'src/auth.ts'), 'utf8');
    expect(auth).toContain('Session database is unavailable; continuing as guest.');
    expect(auth).toContain('run `pnpm migrate`');

    const post = await fs.readFile(
      path.join(project.projectDir, 'src/pages/(public)/blog/hello-world.md'),
      'utf8',
    );
    expect(post).toContain('date: 2026-07-26');
    expect(post).toContain('author: Cossack Team');
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
      path.join(project.projectDir, 'src/orm/factory.ts'),
      'utf8',
    )).toContain('nodeSQLite');
    expect(await fs.readFile(
      path.join(project.projectDir, 'orm.config.ts'),
      'utf8',
    )).toContain('createToolingAdapter');
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
      .rejects.toThrow('Pass --runtime=cloudflare or --runtime=node or --runtime=deno');
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

  it('migrates legacy pnpm build approvals and preserves explicit workspace choices', async () => {
    const root = await temporaryDirectory();
    const legacy = await createApp('legacy', {
      cwd: root,
      adapter: 'node',
      preset: 'minimal',
      interactive: false,
    });
    const legacyPackagePath = path.join(legacy.projectDir, 'package.json');
    const legacyPackage = JSON.parse(await fs.readFile(legacyPackagePath, 'utf8'));
    legacyPackage.pnpm = {
      onlyBuiltDependencies: ['esbuild', 'sharp', 'workerd', 'canvas'],
    };
    await fs.writeFile(
      legacyPackagePath,
      JSON.stringify(legacyPackage, null, 2) + '\n',
    );
    await fs.rm(path.join(legacy.projectDir, 'pnpm-workspace.yaml'));

    await addFeature(legacy.projectDir, 'database', { interactive: false });

    const migratedPackage = JSON.parse(await fs.readFile(legacyPackagePath, 'utf8'));
    const migratedWorkspace = await fs.readFile(
      path.join(legacy.projectDir, 'pnpm-workspace.yaml'),
      'utf8',
    );
    expect(migratedPackage).not.toHaveProperty('pnpm');
    expect(migratedWorkspace).not.toContain('better-sqlite3');
    expect(migratedWorkspace).toContain('canvas: true');

    const workspacePath = path.join(legacy.projectDir, 'pnpm-workspace.yaml');
    await fs.writeFile(
      workspacePath,
      migratedWorkspace.replace('sharp: true', 'sharp: false') +
        'customSetting: kept\n',
    );
    await addFeature(legacy.projectDir, 'ui', { interactive: false });
    const preservedWorkspace = await fs.readFile(workspacePath, 'utf8');
    expect(preservedWorkspace).toContain('sharp: false');
    expect(preservedWorkspace).toContain('customSetting: kept');
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
    expect(result.recipe.resolvedFeatures).toEqual(['ui', 'markdown', 'examples']);
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
    const middleware = path.join(project.projectDir, 'src/middlewares/orm.ts');
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
