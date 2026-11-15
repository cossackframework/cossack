import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addFeature, createApp, readManifest, recipeCapabilityRequirements, recordsFiles, removeFeatureFromProject, resolveRecipe,
} from '../src/index.js';

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function project(options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-file-records-'));
  temporaryDirectories.push(root);
  return (await createApp('app', { cwd: root, preset: 'minimal', interactive: false, ...options })).projectDir;
}
const exists = file => fs.access(file).then(() => true, () => false);
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const version = async () => (await json(new URL('../package.json', import.meta.url))).version;

// A CMS project's files are its own: the package serves what a release changes, so the
// scaffold records no hash and no upstream text of them. Its recipe is in package.json.
describe('projects that record no files', () => {
  it('creates a CMS project without a manifest or a base store', async () => {
    const root = await project({ adapter: 'cloudflare', features: ['cms'] });
    expect(await exists(path.join(root, '.cossack'))).toBe(false);
    expect((await json(path.join(root, 'package.json'))).cossack).toEqual({
      runtime: 'cloudflare', packages: ['@cossackframework/cms'], features: ['cms'], template: await version(),
    });
    const manifest = await readManifest(root);
    expect(manifest).toMatchObject({ recordsFiles: false, runtime: 'cloudflare', explicitFeatures: ['cms'], templateVersion: await version() });
    expect(manifest.resolvedFeatures).toEqual(expect.arrayContaining(['ui', 'auth', 'dashboard', 'cms']));
    expect(manifest.files).toBeUndefined();
    expect(recordsFiles(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }))).toBe(false);
    expect(recordsFiles(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] }))).toBe(true);
  });

  it('records the options that are not the defaults', async () => {
    const root = await project({ adapter: 'node', features: ['cms'], theme: 'zinc' });
    expect((await json(path.join(root, 'package.json'))).cossack.options).toEqual({ theme: 'zinc' });
    expect((await readManifest(root)).config.theme).toBe('zinc');
  });

  it('names package.json as the source of what the recipe needs from the runtime', () => {
    expect(recipeCapabilityRequirements(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] })))
      .toContainEqual({ feature: 'cms', source: { file: 'package.json' }, requires: { transports: ['http'], filesystem: true } });
  });

  it('adds and removes a feature by comparing with what the recipe renders, and merges an edit', async () => {
    const root = await project({ adapter: 'cloudflare', features: ['cms'] });
    const manifestFile = path.join(root, 'package.json');
    const entry = path.join(root, 'src/index.ts');
    // The project's own edit, and a template the project raised itself.
    await fs.writeFile(entry, (await fs.readFile(entry, 'utf8')).replace("import { App } from './App';", "import { App } from './App';\nimport './instrumentation';"));
    const pkg = await json(manifestFile);
    pkg.cossack.template = '0.8.0';
    pkg.cossack.buildBudgets = { uploadKiB: { warning: 900 } };
    await fs.writeFile(manifestFile, JSON.stringify(pkg, null, 2) + '\n');

    const added = await addFeature(root, 'schedules', { interactive: false });
    expect(added.status).toBe('added');
    expect(added.addedFeatures).toEqual(expect.arrayContaining(['jobs', 'schedules']));
    const merged = await fs.readFile(entry, 'utf8');
    expect(merged).toContain("import './instrumentation';");
    expect(merged).toContain('await createSchedules(env).scheduled(controller);');
    expect(merged).toContain('cmsScheduled(env, ctx);');
    expect(await exists(path.join(root, 'src/schedules/index.ts'))).toBe(true);
    // The recipe is recorded where it was; the project's template and its own keys stay.
    expect((await json(manifestFile)).cossack).toMatchObject({ features: expect.arrayContaining(['schedules', 'cms']), template: '0.8.0', buildBudgets: { uploadKiB: { warning: 900 } } });
    expect(await exists(path.join(root, '.cossack'))).toBe(false);

    const removed = await removeFeatureFromProject(root, 'schedules', { interactive: false, yes: true });
    expect(removed.status).toBe('removed');
    expect(await exists(path.join(root, 'src/schedules/index.ts'))).toBe(false);
    const restored = await fs.readFile(entry, 'utf8');
    expect(restored).toContain("import './instrumentation';");
    expect(restored).not.toContain('createSchedules');
    expect((await json(manifestFile)).cossack.features).not.toContain('schedules');
    expect(await exists(path.join(root, '.cossack'))).toBe(false);
  });

  it('refuses a change to a file the project edited on the same lines', async () => {
    const root = await project({ adapter: 'cloudflare', features: ['cms'] });
    const entry = path.join(root, 'src/index.ts');
    await fs.writeFile(entry, (await fs.readFile(entry, 'utf8')).replace('  fetch: app.fetch,', '  fetch: (request, env, ctx) => app.fetch(request, env, ctx),'));
    await expect(addFeature(root, 'schedules', { interactive: false })).rejects.toThrow(/Scaffold conflicts: .*src\/index\.ts/);
    expect(await exists(path.join(root, 'src/schedules/index.ts'))).toBe(false);
  });

  it('keeps the copies cossack eject recorded, and nothing else, in the manifest', async () => {
    const root = await project({ adapter: 'node', features: ['cms'] });
    const manifestFile = path.join(root, '.cossack/scaffold.json');
    const ejected = { 'src/pages/auth/login/index.ts': { package: '@cossackframework/cms', path: 'pages/auth/login/index.ts', version: '0.9.0', base: 'a'.repeat(64), hash: 'b'.repeat(64) } };
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({ schemaVersion: 4, tool: '@cossackframework/scaffold', ejected }));
    expect((await readManifest(root)).ejected).toEqual(ejected);
    await addFeature(root, 'examples', { interactive: false });
    expect(await json(manifestFile)).toEqual({ schemaVersion: 4, tool: '@cossackframework/scaffold', ejected });
  });

  it('reads a CMS manifest from before the recipe moved, without its file records', async () => {
    const root = await project({ adapter: 'node', features: ['cms'] });
    const pkg = await json(path.join(root, 'package.json'));
    const { features, template, ...cossack } = pkg.cossack;
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ ...pkg, cossack }, null, 2) + '\n');
    await fs.mkdir(path.join(root, '.cossack'), { recursive: true });
    const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features });
    await fs.writeFile(path.join(root, '.cossack/scaffold.json'), JSON.stringify({ schemaVersion: 4, tool: '@cossackframework/scaffold', templateVersion: '0.9.0',
      runtime: 'node', preset: 'minimal', explicitFeatures: features, resolvedFeatures: recipe.resolvedFeatures, dashboardModules: recipe.dashboardModules, config: {},
      dependencyBaseline: { dependencies: {} }, files: { 'src/index.ts': { capability: 'base', hash: 'c'.repeat(64) } } }));
    const manifest = await readManifest(root);
    expect(manifest).toMatchObject({ recordsFiles: false, templateVersion: '0.9.0', explicitFeatures: ['cms'] });
    expect(manifest.files).toBeUndefined();
    expect(manifest.dependencyBaseline).toBeUndefined();
    // The next change writes the recipe to package.json and removes the old records.
    await addFeature(root, 'examples', { interactive: false });
    expect(await exists(path.join(root, '.cossack/scaffold.json'))).toBe(false);
    expect((await json(path.join(root, 'package.json'))).cossack.features).toEqual(expect.arrayContaining(['examples', 'cms']));
  });

  it('keeps recording the files of a project without the CMS', async () => {
    const root = await project({ adapter: 'node' });
    expect((await json(path.join(root, 'package.json'))).cossack).toEqual({ runtime: 'node' });
    const manifest = await readManifest(root);
    expect(manifest.recordsFiles).toBeUndefined();
    expect(Object.keys(manifest.files)).toContain('src/index.ts');
    expect(await exists(path.join(root, '.cossack/base'))).toBe(true);
  });
});
