import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import * as scaffold from '@cossackframework/scaffold';
import {
  addFeature,
  createApp,
  putBase,
  readBase,
  readManifest,
  renderRecipe,
} from '@cossackframework/scaffold';
import {
  collectCossackDeps,
  detectPackageManager,
  upgradeCommand,
} from '../src/commands/upgrade.js';
import { parseFlags } from '../src/flags.js';

// An older release, when a test sets one: loading its version gives this instead of the registry's.
const releases = vi.hoisted(() => ({ older: null }));
vi.mock('../src/upgrade-scaffold.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadUpgradeScaffold: tag => tag === releases.older?.version ? releases.older : actual.loadUpgradeScaffold(tag) };
});

let temporaryParent;
const installedVersion = JSON.parse(await fs.readFile(new URL('../../scaffold/package.json', import.meta.url), 'utf8')).version;

function sha(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function write(root, relative, content) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return sha(content);
}

async function seedProject(options = {}) {
  const result = await createApp('app', {
    cwd: temporaryParent,
    adapter: 'node',
    preset: 'minimal',
    interactive: false,
    ...options,
  });
  // Keep upgrade dependency resolution offline and deterministic: the recipe stays, the dependencies go.
  const pkg = JSON.parse(await fs.readFile(path.join(result.projectDir, 'package.json'), 'utf8'));
  await fs.writeFile(
    path.join(result.projectDir, 'package.json'),
    JSON.stringify({ name: 'app', type: 'module', cossack: pkg.cossack }, null, 2) + '\n',
  );
  return result;
}

function makeContext(root, flags) {
  const { args, flags: parsed } = parseFlags([`--tag=${installedVersion}`, ...flags]);
  return {
    args,
    context: {
      flags: parsed,
      cwd: root,
      force: parsed.force === true,
      dryRun: parsed['dry-run'] === true,
    },
  };
}

async function runUpgrade(root, flags) {
  const { args, context } = makeContext(root, flags);
  return upgradeCommand(args, context);
}

beforeEach(async () => {
  temporaryParent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-upgrade-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  releases.older = null;
  vi.restoreAllMocks();
  await fs.rm(temporaryParent, { recursive: true, force: true });
});

describe('collectCossackDeps', () => {
  it('gathers cossack and @cossackframework packages across dependency sections', () => {
    const deps = collectCossackDeps({
      dependencies: {
        '@cossackframework/framework': '^0.7.4',
        cossack: '^0.7.4',
        hono: '^4.0.0',
      },
      devDependencies: {
        '@cossackframework/core': '^0.7.4',
      },
    });
    expect(Object.keys(deps).sort()).toEqual([
      '@cossackframework/core',
      '@cossackframework/framework',
      'cossack',
    ]);
  });
});

describe('upgrade package manager detection', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ])('detects %s', async (lockfile, manager) => {
    await fs.writeFile(path.join(temporaryParent, lockfile), '');
    await expect(detectPackageManager(temporaryParent)).resolves.toBe(manager);
  });

  it('uses packageManager metadata when no lockfile exists', async () => {
    await fs.writeFile(
      path.join(temporaryParent, 'package.json'),
      JSON.stringify({ packageManager: 'bun@1.2.20' }),
    );
    await expect(detectPackageManager(temporaryParent)).resolves.toBe('bun');
  });
});

describe('recipe upgrades', () => {
  it('migrates legacy pnpm build approvals before reinstalling', async () => {
    const project = await seedProject();
    const packagePath = path.join(project.projectDir, 'package.json');
    await fs.writeFile(
      packagePath,
      JSON.stringify({
        name: 'app',
        type: 'module',
        cossack: { runtime: 'node', features: [], template: installedVersion },
        pnpm: {
          onlyBuiltDependencies: ['esbuild', 'sharp', 'workerd', 'canvas'],
        },
      }, null, 2) + '\n',
    );
    const workspacePath = path.join(project.projectDir, 'pnpm-workspace.yaml');
    await fs.rm(workspacePath);

    await runUpgrade(project.projectDir, ['--dry-run']);
    expect(JSON.parse(await fs.readFile(packagePath, 'utf8')))
      .toHaveProperty('pnpm.onlyBuiltDependencies');
    await expect(fs.access(workspacePath)).rejects.toThrow();

    await runUpgrade(project.projectDir, []);
    expect(JSON.parse(await fs.readFile(packagePath, 'utf8')))
      .not.toHaveProperty('pnpm');
    const workspace = await fs.readFile(workspacePath, 'utf8');
    expect(workspace).toContain('sharp: true');
    expect(workspace).toContain('canvas: true');
  });

  it('rejects obsolete manifests instead of taking a legacy template path', async () => {
    const project = await seedProject();
    const manifestPath = path.join(project.projectDir, '.cossack/scaffold.json');
    const manifest = { ...await readManifest(project.projectDir), schemaVersion: 1 };
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // CLI-03: command failures resolve to exit code 1 with the coded
    // message instead of throwing out of the command.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(runUpgrade(project.projectDir, ['--dry-run'])).resolves.toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported scaffold manifest schema 1'));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/** Make `relative` look as an older release wrote it: `old` on disk, in the manifest and as the merge base. */
async function seedOlderFile(projectDir, relative, old, edited = old) {
  const manifest = await readManifest(projectDir);
  manifest.files[relative].hash = sha(old);
  manifest.files[relative].base = await putBase(projectDir, old);
  await fs.writeFile(path.join(projectDir, '.cossack/scaffold.json'), JSON.stringify(manifest, null, 2) + '\n');
  await write(projectDir, relative, edited);
}

/** Run upgrade with --json and return [exit code, parsed output]. */
async function upgradeJson(root, flags) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const code = await runUpgrade(root, [...flags, '--json']);
  const output = JSON.parse(log.mock.calls.at(-1)[0]);
  return [code, output];
}

describe('projects from before the served CMS', () => {
  it('refuses a project that holds a copied CMS, and writes nothing', async () => {
    const project = await seedProject();
    const manifestPath = path.join(project.projectDir, '.cossack/scaffold.json');
    // Such a project still has its manifest, with a record of every copied file.
    const manifest = { ...await readManifest(project.projectDir), files: { 'src/cms/index.ts': { capability: 'cms', hash: sha('// copied\n') } } };
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const source = JSON.stringify(manifest, null, 2) + '\n';
    await fs.writeFile(manifestPath, source);
    const [code, output] = await upgradeJson(project.projectDir, []);
    expect(code).toBe(1);
    expect(JSON.stringify(output)).toContain('COSSACK_UPGRADE_CMS_COPIED');
    expect(JSON.stringify(output)).toContain('cossack create --features cms');
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(source);
  });
});


// A project records no file hashes: the packages it mounts serve what a release changes, and
// its files are its own. An upgrade changes its dependencies and never its files.
describe('a project\'s own files', () => {
  async function cmsProject() {
    return (await createApp('app', { cwd: temporaryParent, adapter: 'cloudflare', preset: 'minimal', features: ['cms'], interactive: false })).projectDir;
  }
  /** A stand-in for the installed CMS package: what it mounts and what it asks of the project. */
  async function installCms(root, field) {
    const directory = path.join(root, 'node_modules/@cossackframework/cms');
    await fs.mkdir(path.join(directory, 'app/src'), { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: '@cossackframework/cms', version: '0.9.0',
      cossack: { root: 'app/src', host: ['cms.config.ts', 'stores.client.ts'], ...field } }));
  }
  const exists = file => fs.access(file).then(() => true, () => false);

  it('changes dependencies only, and leaves the project\'s files as they are', async () => {
    const root = await cmsProject();
    const entry = path.join(root, 'src/index.ts');
    const edited = (await fs.readFile(entry, 'utf8')) + '\n// The project\'s own line.\n';
    await fs.writeFile(entry, edited);
    // A file the project deleted stays deleted: the upgrade cannot tell it from a file a release added.
    await fs.rm(path.join(root, 'vitest.config.ts'));
    await fs.appendFile(path.join(root, 'pnpm-workspace.yaml'), "# The project's own.\noverrides:\n  left-pad: 1.3.0\n");
    await installCms(root, {});

    const [code, output] = await upgradeJson(root, []);
    expect(code).toBe(0);
    expect(output.data.status).toBe('completed');
    // Nothing but pnpm-workspace.yaml is ever planned, and it only when the release adds a key.
    expect(output.data.plan.files.writes.map(file => file.path).filter(file => file !== 'pnpm-workspace.yaml')).toEqual([]);
    expect(output.data.plan.recipe.moves).toBe(false);
    expect(await fs.readFile(entry, 'utf8')).toBe(edited);
    expect(await exists(path.join(root, 'vitest.config.ts'))).toBe(false);
    const workspace = await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('left-pad: 1.3.0');
    expect(workspace).toContain('workerd: true');
    expect(await exists(path.join(root, '.cossack'))).toBe(false);
    expect(output.data.applied.hostSteps).toEqual([]);
    // With nothing to add, the file keeps its own text: no key is quoted again, no comment is lost.
    const [, again] = await upgradeJson(root, []);
    expect(again.data.plan.files.writes).toEqual([]);
    expect(await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace);
  });

  it('writes a host module the package needs and the project lacks, and lists the changes it asks for', async () => {
    const root = await cmsProject();
    await fs.rm(path.join(root, 'src/stores.client.ts'));
    await installCms(root, { hostTemplate: '99.0.0', hostSteps: { '99.0.0': ['wrangler.jsonc: add the SEARCH binding.'], '0.1.0': ['An old step.'] } });
    const before = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).cossack.template;

    const [code, output] = await upgradeJson(root, []);
    expect(code).toBe(0);
    expect(output.data.applied.files).toContain('src/stores.client.ts');
    expect(await exists(path.join(root, 'src/stores.client.ts'))).toBe(true);
    expect(output.data.applied.hostSteps).toEqual([{ package: '@cossackframework/cms', version: '0.9.0', template: '99.0.0',
      steps: ['wrangler.jsonc: add the SEARCH binding.'], files: ['src/stores.client.ts'] }]);
    // The project raises its template itself, when the changes are made.
    expect(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).cossack.template).toBe(before);
  });

  it('writes the files a newer template adds when the project lacks them, and a folder only when it has none', async () => {
    const root = await cmsProject();
    for (const relative of ['orm.config.ts', 'src/orm', 'src/models', 'src/seeders']) await fs.rm(path.join(root, relative), { recursive: true });
    // A folder the project has is its own: nothing goes into it.
    await fs.rm(path.join(root, 'src/migrations'), { recursive: true });
    await write(root, 'src/migrations/0001_own.ts', '// The project\'s own migration.\n');
    await installCms(root, { host: ['cms.config.ts', 'stores.client.ts', 'orm/factory.ts', 'models/User.ts'], hostTemplate: '99.0.0',
      hostSteps: { '99.0.0': ['src/bootstrap/middlewares.ts: list ormRequestMiddleware first.'] },
      hostFiles: { '99.0.0': ['orm.config.ts', 'src/orm/', 'src/models/', 'src/migrations/', 'src/seeders/'], '0.1.0': ['src/old.ts'] } });

    const [code, output] = await upgradeJson(root, []);
    expect(code).toBe(0);
    const [steps] = output.data.applied.hostSteps;
    expect(steps.steps).toEqual(['src/bootstrap/middlewares.ts: list ormRequestMiddleware first.']);
    expect(steps.files).toContain('orm.config.ts');
    expect(steps.files).toContain('src/orm/factory.ts');
    expect(steps.files).toContain('src/models/index.ts');
    expect(steps.files).toContain('src/models/User.ts');
    expect(steps.files).toContain('src/seeders/index.ts');
    expect(steps.files.filter(file => file.startsWith('src/migrations/'))).toEqual([]);
    expect(await fs.readdir(path.join(root, 'src/migrations'))).toEqual(['0001_own.ts']);
    expect(await exists(path.join(root, 'src/models/CacheItem.ts'))).toBe(true);

    // A second run writes nothing again, and replaces nothing.
    await fs.writeFile(path.join(root, 'src/models/User.ts'), '// The project\'s own model.\n');
    const [, again] = await upgradeJson(root, []);
    expect(again.data.applied.hostSteps[0].files).toEqual([]);
    expect(await fs.readFile(path.join(root, 'src/models/User.ts'), 'utf8')).toBe('// The project\'s own model.\n');
  });

  const older = text => String(text).replaceAll(`^${installedVersion}`, '^0.9.2');
  /** A project whose dependencies 0.9.2 set. */
  async function declareOlder(root) {
    const file = path.join(root, 'package.json');
    await fs.writeFile(file, older(await fs.readFile(file, 'utf8')));
  }
  /** 0.9.2 knew no romedb database: this release's reading of a CMS recipe names one. */
  const olderRelease = (overrides = {}) => ({ version: '0.9.2', close: async () => {}, api: {
    ...scaffold,
    resolveRecipe(input) {
      if (input.database === 'romedb') throw new Error('Unknown database provider "romedb". Supported values: d1, sqlite.');
      return scaffold.resolveRecipe(input);
    },
    async readManifest(root) {
      const own = await scaffold.readManifest(root);
      return { ...own, config: { ...own.config, database: undefined } };
    },
    async renderRecipe(recipe, options) {
      const files = await scaffold.renderRecipe(recipe, options);
      const pkg = files.get('package.json');
      files.set('package.json', { ...pkg, content: Buffer.from(older(pkg.content)) });
      return files;
    },
    ...overrides,
  } });

  it('renders what the declared release owned from that release\'s own reading of the recipe', async () => {
    const root = await cmsProject();
    await declareOlder(root);
    releases.older = olderRelease();
    const [code, output] = await upgradeJson(root, ['--dry-run']);
    expect(code).toBe(0);
    expect(output.data.status).toBe('dry-run');
    expect(output.data.plan.dependencies.updates).toContainEqual(expect.objectContaining({
      name: '@cossackframework/framework', from: '^0.9.2', to: `^${installedVersion}`, changed: true }));
  });

  it('names the release that refuses the recipe', async () => {
    const root = await cmsProject();
    await declareOlder(root);
    releases.older = olderRelease({ readManifest: undefined });
    const [code, output] = await upgradeJson(root, ['--dry-run']);
    expect(code).toBe(1);
    const text = JSON.stringify(output);
    expect(text).toContain('COSSACK_UPGRADE_RECIPE_REFUSED');
    expect(text).toContain('Cossack 0.9.2 cannot render this project\'s recipe: Unknown database provider \\"romedb\\"');
  });

  it('moves a recipe from an older manifest into package.json and removes the file records', async () => {
    const root = await cmsProject();
    const manifestFile = path.join(root, '.cossack/scaffold.json');
    const packageFile = path.join(root, 'package.json');
    const recorded = await readManifest(root);
    const pkg = JSON.parse(await fs.readFile(packageFile, 'utf8'));
    const { features: _features, template: _template, ...cossack } = pkg.cossack;
    await fs.writeFile(packageFile, JSON.stringify({ ...pkg, cossack }, null, 2) + '\n');
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    const base = await putBase(root, '// an old base\n');
    await fs.writeFile(manifestFile, JSON.stringify({ ...recorded, recordsFiles: undefined, templateVersion: '0.8.5',
      dependencyBaseline: { dependencies: {}, devDependencies: {} }, files: { 'src/index.ts': { capability: 'base', hash: sha('x'), base } } }));
    await installCms(root, {});

    const [code, output] = await upgradeJson(root, []);
    expect(code).toBe(0);
    expect(output.data.status).toBe('completed');
    expect(JSON.parse(await fs.readFile(packageFile, 'utf8')).cossack).toMatchObject({ runtime: 'cloudflare', packages: ['@cossackframework/cms'], features: ['cms'], template: '0.8.5' });
    expect(await exists(path.join(root, '.cossack'))).toBe(false);
    // A second run has nothing to move.
    const [, again] = await upgradeJson(root, []);
    expect(again.data.applied.recipe).toBe(false);
  });
});
