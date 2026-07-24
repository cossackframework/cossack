import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DASHBOARD_MODULES,
  addFeature,
  createApp,
  readManifest,
  renderRecipe,
  resolveDashboardModules,
  resolveRecipe,
} from '../src/index.js';
import { createApp as compatibilityCreateApp } from '../../create-cossack-app/index.js';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-scaffold-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
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

  it('rejects invalid providers, invalid modules, and duplicate modules', () => {
    expect(() => resolveRecipe({ adapter: 'node', database: 'd1' }))
      .toThrow('not supported');
    expect(() => resolveDashboardModules('missing', true))
      .toThrow('Supported values: users, sessions, settings, roles');
    expect(() => resolveDashboardModules('users,users', true))
      .toThrow('Duplicate dashboard module');
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
    expect(files.has('src/App.ts')).toBe(true);
    expect(files.has('wrangler.jsonc')).toBe(adapter === 'cloudflare');
    expect(files.has('src/db/config.ts')).toBe(recipe.resolvedFeatures.includes('database'));
    expect(files.has('src/auth.ts')).toBe(recipe.resolvedFeatures.includes('auth'));
  });
});

describe('composition', () => {
  it('keeps create-cossack-app as a direct wrapper over the shared engine', () => {
    expect(compatibilityCreateApp).toBe(createApp);
  });

  it('produces the same recipe and owned file set incrementally and initially', async () => {
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
    expect(Object.keys(incrementalManifest.files).sort())
      .toEqual(Object.keys(initialManifest.files).sort());
  });

  it('installs users RBAC support without exposing Roles pages', async () => {
    const root = await temporaryDirectory();
    const project = await createApp('app', {
      cwd: root,
      adapter: 'cloudflare',
      preset: 'minimal',
      features: 'dashboard',
      dashboardModules: 'users',
      interactive: false,
    });
    const files = await renderRecipe(project.recipe, { projectName: 'app' });
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
    expect(files.get('src/auth.ts').content.toString()).toContain('GITHUB_CLIENT_ID');
    expect(files.get('src/pages/auth/login/index.ts').content.toString())
      .toContain('/auth/google/redirect');
    expect(files.get('src/style.css').content.toString())
      .toContain('@cossackframework/ui/theme/themes/green.css');
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
});
