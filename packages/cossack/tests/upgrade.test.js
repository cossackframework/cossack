import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import {
  addFeature,
  createApp,
  readManifest,
  renderRecipe,
} from '@cossackframework/scaffold';
import {
  classifyFile,
  collectCossackDeps,
  upgradeCommand,
} from '../src/commands/upgrade.js';
import { parseFlags } from '../src/flags.js';

let temporaryParent;

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
  // Keep upgrade dependency resolution offline and deterministic.
  await fs.writeFile(
    path.join(result.projectDir, 'package.json'),
    JSON.stringify({ name: 'app', type: 'module' }, null, 2) + '\n',
  );
  return result;
}

function makeContext(root, flags) {
  const { args, flags: parsed } = parseFlags(flags);
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

describe('classifyFile', () => {
  const baseline = sha('baseline');
  const modified = sha('modified');
  const upstream = sha('upstream');

  it.each([
    [{ baseline, current: modified, newHash: upstream, excluded: true }, 'excluded'],
    [{ baseline, current: null, newHash: upstream }, 'missing'],
    [{ baseline, current: modified, newHash: null }, 'excluded'],
    [{ baseline, current: baseline, newHash: upstream }, 'canUpdate'],
    [{ baseline, current: modified, newHash: upstream }, 'modified'],
    [{ baseline, current: upstream, newHash: upstream }, 'upToDate'],
  ])('classifies %# as %s', (input, expected) => {
    expect(classifyFile(input)).toBe(expected);
  });
});

describe('schema-v2 recipe upgrades', () => {
  it('updates an unchanged scaffold file when its rendered recipe changes', async () => {
    const project = await seedProject();
    const relative = 'src/App.ts';
    const old = '// scaffold v1\n';
    const manifest = await readManifest(project.projectDir);
    manifest.files[relative].hash = await write(project.projectDir, relative, old);
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, ['--apply-template']);
    const expected = (await renderRecipe(project.recipe, { projectName: 'app' }))
      .get(relative).content.toString();
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toBe(expected);
  });

  it('offers and records a new upstream file for an installed capability', async () => {
    const project = await seedProject();
    const relative = 'src/vite-env.d.ts';
    const manifest = await readManifest(project.projectDir);
    delete manifest.files[relative];
    await fs.rm(path.join(project.projectDir, relative));
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, ['--apply-template']);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toContain('vite/client');
    expect((await readManifest(project.projectDir)).files[relative])
      .toMatchObject({ capability: 'base' });
  });

  it('preserves locally modified files under apply-template and force', async () => {
    const project = await seedProject();
    const relative = 'src/App.ts';
    await fs.writeFile(path.join(project.projectDir, relative), '// user edit\n');

    await runUpgrade(project.projectDir, ['--apply-template']);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toBe('// user edit\n');
    await runUpgrade(project.projectDir, ['--force']);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toBe('// user edit\n');
  });

  it('force-file replaces one explicitly selected modified file', async () => {
    const project = await seedProject();
    const relative = 'src/App.ts';
    await fs.writeFile(path.join(project.projectDir, relative), '// user edit\n');

    await runUpgrade(project.projectDir, ['--force-file', relative]);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .not.toBe('// user edit\n');
  });

  it('force restores a deleted scaffold-owned file', async () => {
    const project = await seedProject();
    const relative = 'src/App.ts';
    await fs.rm(path.join(project.projectDir, relative));

    await runUpgrade(project.projectDir, ['--force']);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toContain('class App');
  });

  it('upgrades capabilities added after initial creation', async () => {
    const project = await seedProject();
    await addFeature(project.projectDir, 'auth', { interactive: false });
    // addFeature restores the full generated package; keep dependency lookup offline.
    await fs.writeFile(
      path.join(project.projectDir, 'package.json'),
      JSON.stringify({ name: 'app', type: 'module' }, null, 2) + '\n',
    );
    const relative = 'src/pages/auth/login/index.ts';
    const old = '// auth scaffold v1\n';
    const manifest = await readManifest(project.projectDir);
    manifest.files[relative].hash = await write(project.projectDir, relative, old);
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, ['--apply-template']);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toContain('LoginPage');
  });

  it('renders adapter-specific files from the recorded Node recipe', async () => {
    const project = await seedProject();
    const relative = 'vite.config.ts';
    const old = '// node scaffold v1\n';
    const manifest = await readManifest(project.projectDir);
    manifest.files[relative].hash = await write(project.projectDir, relative, old);
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, ['--apply-template']);
    const updated = await fs.readFile(path.join(project.projectDir, relative), 'utf8');
    expect(updated).not.toContain('@cloudflare/vite-plugin');
    expect(updated).toContain('cossackPages');
  });

  it('renders project metadata from the declared package name', async () => {
    const project = await seedProject();
    const packagePath = path.join(project.projectDir, 'package.json');
    await fs.writeFile(
      packagePath,
      JSON.stringify({ name: 'renamed-app', type: 'module' }, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, ['--apply-template']);

    expect(await fs.readFile(
      path.join(project.projectDir, '.env.example'),
      'utf8',
    )).toContain('APP_NAME=renamed-app');
  });

  it('does not introduce files for capabilities absent from the recipe', async () => {
    const project = await seedProject();
    await runUpgrade(project.projectDir, ['--apply-template']);
    await expect(fs.access(
      path.join(project.projectDir, 'src/auth.ts'),
    )).rejects.toThrow();
  });

  it('rejects obsolete manifests instead of taking a legacy template path', async () => {
    const project = await seedProject();
    const manifestPath = path.join(project.projectDir, '.cossack/scaffold.json');
    const manifest = await readManifest(project.projectDir);
    manifest.schemaVersion = 1;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    await expect(runUpgrade(project.projectDir, ['--dry-run']))
      .rejects.toThrow('Unsupported scaffold manifest schema 1');
  });
});
