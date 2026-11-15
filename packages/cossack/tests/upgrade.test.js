import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import {
  addFeature,
  createApp,
  putBase,
  readBase,
  readManifest,
  renderRecipe,
} from '@cossackframework/scaffold';
import {
  classifyFile,
  collectCossackDeps,
  detectPackageManager,
  upgradeCommand,
} from '../src/commands/upgrade.js';
import { parseFlags } from '../src/flags.js';

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
  // Keep upgrade dependency resolution offline and deterministic.
  await fs.writeFile(
    path.join(result.projectDir, 'package.json'),
    JSON.stringify({ name: 'app', type: 'module' }, null, 2) + '\n',
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

describe('classifyFile', () => {
  const baseline = sha('baseline');
  const modified = sha('modified');
  const upstream = sha('upstream');

  it.each([
    [{ baseline, current: modified, newHash: upstream, excluded: true }, 'excluded'],
    [{ baseline, current: null, newHash: upstream }, 'missing'],
    [{ baseline, current: modified, newHash: null }, 'modified'],
    [{ baseline, current: baseline, newHash: null }, 'canDelete'],
    [{ baseline, current: baseline, newHash: upstream }, 'canUpdate'],
    [{ baseline, current: modified, newHash: upstream }, 'modified'],
    [{ baseline, current: upstream, newHash: upstream }, 'upToDate'],
  ])('classifies %# as %s', (input, expected) => {
    expect(classifyFile(input)).toBe(expected);
  });
});

describe('recipe upgrades', () => {
  it.each([false, true])('preserves excluded Wrangler configuration for explicit disconnect-flag migration (%s)', async modified => {
    const project = await seedProject({ adapter: 'cloudflare' });
    const relative = 'wrangler.jsonc';
    const manifest = await readManifest(project.projectDir);
    const config = JSON.parse(await fs.readFile(path.join(project.projectDir, relative), 'utf8'));
    config.compatibility_flags = config.compatibility_flags.filter(flag => flag !== 'enable_request_signal');
    const previous = JSON.stringify(config, null, 2) + '\n';
    manifest.files[relative].hash = await write(project.projectDir, relative, previous);
    await fs.writeFile(path.join(project.projectDir, '.cossack/scaffold.json'), JSON.stringify(manifest));
    if (modified) await write(project.projectDir, relative, previous + '// User environment configuration\n');
    await runUpgrade(project.projectDir, []);
    const after = await fs.readFile(path.join(project.projectDir, relative), 'utf8');
    if (modified) expect(after).toBe(previous + '// User environment configuration\n');
    else expect(after).toBe(previous);
    expect(after).not.toContain('enable_request_signal');
    expect((await renderRecipe(project.recipe, { projectName: 'app' })).get(relative).content.toString()).toContain('enable_request_signal');
  });

  it('migrates legacy pnpm build approvals before reinstalling', async () => {
    const project = await seedProject();
    const packagePath = path.join(project.projectDir, 'package.json');
    await fs.writeFile(
      packagePath,
      JSON.stringify({
        name: 'app',
        type: 'module',
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

  it('updates an unchanged scaffold file when its rendered recipe changes', async () => {
    const project = await seedProject();
    const relative = 'src/App.ts';
    const old = '// scaffold v1\n';
    const manifest = await readManifest(project.projectDir);
    manifest.files[relative].hash = await write(project.projectDir, relative, old);
    manifest.files[relative].base = await putBase(project.projectDir, old);
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, []);
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

    await runUpgrade(project.projectDir, []);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toContain('vite/client');
    expect((await readManifest(project.projectDir)).files[relative])
      .toMatchObject({ capability: 'base' });
  });

  it('preserves a file that only the project changed, also under force', async () => {
    const project = await seedProject();
    const relative = 'src/App.ts';
    await fs.writeFile(path.join(project.projectDir, relative), '// user edit\n');

    await runUpgrade(project.projectDir, []);
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
    manifest.files[relative].base = await putBase(project.projectDir, old);
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, []);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8'))
      .toContain('LoginPage');
  });

  it('renders adapter-specific files from the recorded Node recipe', async () => {
    const project = await seedProject();
    const relative = 'vite.config.ts';
    const old = '// node scaffold v1\n';
    const manifest = await readManifest(project.projectDir);
    manifest.files[relative].hash = await write(project.projectDir, relative, old);
    manifest.files[relative].base = await putBase(project.projectDir, old);
    await fs.writeFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    await runUpgrade(project.projectDir, []);
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

    await runUpgrade(project.projectDir, []);

    expect(await fs.readFile(
      path.join(project.projectDir, '.env.example'),
      'utf8',
    )).toContain('APP_NAME=renamed-app');
  });

  it('does not introduce files for capabilities absent from the recipe', async () => {
    const project = await seedProject();
    await runUpgrade(project.projectDir, []);
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
    const manifest = await readManifest(project.projectDir);
    manifest.files['src/cms/index.ts'] = { capability: 'cms', hash: sha('// copied\n') };
    const source = JSON.stringify(manifest, null, 2) + '\n';
    await fs.writeFile(manifestPath, source);
    const [code, output] = await upgradeJson(project.projectDir, []);
    expect(code).toBe(1);
    expect(JSON.stringify(output)).toContain('COSSACK_UPGRADE_CMS_COPIED');
    expect(JSON.stringify(output)).toContain('cossack create --features cms');
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(source);
  });
});

describe('upgrades merge local edits', () => {
  const relative = 'src/App.ts';
  const current = async project => (await renderRecipe(project.recipe, { projectName: 'app' })).get(relative).content.toString();
  /** The template's text with its first line changed: what an older release rendered. */
  const olderOf = text => '// older first line\n' + text.split('\n').slice(1).join('\n');

  it('merges a file that both the project and the template changed', async () => {
    const project = await seedProject();
    const theirs = await current(project);
    const old = olderOf(theirs);
    await seedOlderFile(project.projectDir, relative, old, old + '// A note the project added.\n');

    const [code, output] = await upgradeJson(project.projectDir, ['--dry-run']);
    expect(code).toBe(0);
    expect(output.data.plan.files.merges).toEqual([{ path: relative, result: 'clean', conflicts: 0 }]);
    expect(output.data.plan.files.writes).toContainEqual({ path: relative, forced: false, merged: true });
    // A dry run writes nothing.
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8')).toBe(old + '// A note the project added.\n');

    await runUpgrade(project.projectDir, []);
    const merged = theirs + '// A note the project added.\n';
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8')).toBe(merged);
    const entry = (await readManifest(project.projectDir)).files[relative];
    expect(entry).toMatchObject({ hash: sha(merged), base: sha(theirs) });
    expect((await readBase(project.projectDir, entry.base)).toString()).toBe(theirs);
    // The old base has no reference left.
    expect(await readBase(project.projectDir, sha(old))).toBeNull();

    // A second upgrade sees a file that only the project changed, and does not merge again.
    const [, again] = await upgradeJson(project.projectDir, ['--dry-run']);
    expect(again.data.plan.files.merges).toEqual([]);
    expect(again.data.plan.files.local).toEqual([relative]);
    expect(again.data.plan.files.writes).toEqual([]);
  });

  it('keeps a conflicting file, lists it, and carries the marked text in the plan', async () => {
    const project = await seedProject();
    const theirs = await current(project);
    const old = olderOf(theirs);
    const ours = '// the project changed this line\n' + old.split('\n').slice(1).join('\n');
    await seedOlderFile(project.projectDir, relative, old, ours);

    const [code, output] = await upgradeJson(project.projectDir, []);
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8')).toBe(ours);
    const { files, nextActions } = output.data.plan;
    expect(files.conflicts).toContainEqual({ path: relative, reason: 'merge-conflict', resolution: 'preserve' });
    expect(files.preserved).toContain(relative);
    expect(files.merges[0]).toMatchObject({ path: relative, result: 'conflict', conflicts: 1 });
    expect(files.merges[0].text).toContain('<<<<<<< yours\n// the project changed this line\n||||||| base\n// older first line\n=======\n');
    expect(files.merges[0].text).toContain(`>>>>>>> cossack ${installedVersion}\n`);
    expect(nextActions.join('\n')).toContain(`Resolve ${relative}`);
    // The base is unchanged, so the next upgrade offers the same merge.
    expect((await readManifest(project.projectDir)).files[relative].base).toBe(sha(old));
  });

  it('writes conflict markers on request, then refuses to run until they are resolved', async () => {
    const project = await seedProject();
    const theirs = await current(project);
    const old = olderOf(theirs);
    await seedOlderFile(project.projectDir, relative, old, '// the project changed this line\n' + old.split('\n').slice(1).join('\n'));

    await runUpgrade(project.projectDir, ['--conflicts=markers']);
    const marked = await fs.readFile(path.join(project.projectDir, relative), 'utf8');
    expect(marked).toContain('<<<<<<< yours');
    expect((await readManifest(project.projectDir)).files[relative].base).toBe(sha(theirs));

    const [code, output] = await upgradeJson(project.projectDir, []);
    expect(code).toBe(1);
    expect(output.diagnostics[0]).toMatchObject({ code: 'COSSACK_UPGRADE_UNRESOLVED_CONFLICT', path: relative });

    // Resolved by hand: the file is now a local edit over the new base.
    await write(project.projectDir, relative, theirs.replace(/^.*\n/, '// resolved\n'));
    const [resolvedCode, resolved] = await upgradeJson(project.projectDir, ['--dry-run']);
    expect(resolvedCode).toBe(0);
    expect(resolved.data.plan.files.local).toEqual([relative]);
  });

  it('reads a schema-3 manifest without bases: an edited file is kept and reported', async () => {
    const project = await seedProject();
    const manifestPath = path.join(project.projectDir, '.cossack/scaffold.json');
    const manifest = await readManifest(project.projectDir);
    manifest.schemaVersion = 3;
    for (const entry of Object.values(manifest.files)) delete entry.base;
    // One file is as an older release wrote it, one is edited.
    manifest.files['vite.config.ts'].hash = await write(project.projectDir, 'vite.config.ts', '// older\n');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await fs.rm(path.join(project.projectDir, '.cossack/base'), { recursive: true });
    await write(project.projectDir, relative, '// user edit\n');

    const [code, output] = await upgradeJson(project.projectDir, []);
    expect(code).toBe(0);
    expect(output.data.plan.files.noBase).toEqual([relative]);
    expect(output.data.plan.files.conflicts).toContainEqual({ path: relative, reason: 'no-base', resolution: 'preserve' });
    expect(await fs.readFile(path.join(project.projectDir, relative), 'utf8')).toBe('// user edit\n');
    expect(await fs.readFile(path.join(project.projectDir, 'vite.config.ts'), 'utf8')).toContain('cossackPages');

    // The first write moves the manifest to schema 4, with a base for every file equal to the template's.
    const upgraded = await readManifest(project.projectDir);
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.files['vite.config.ts'].base).toBe(upgraded.files['vite.config.ts'].hash);
    expect(upgraded.files['.gitignore'].base).toBe(upgraded.files['.gitignore'].hash);
    expect(upgraded.files[relative].base).toBeUndefined();
  });

  it('keeps an edited file that the template removed', async () => {
    const project = await seedProject();
    const manifest = await readManifest(project.projectDir);
    manifest.files['src/gone.ts'] = { capability: 'base', hash: sha('// old\n'), base: await putBase(project.projectDir, '// old\n') };
    manifest.files['src/gone-too.ts'] = { capability: 'base', hash: sha('// old\n'), base: sha('// old\n') };
    await fs.writeFile(path.join(project.projectDir, '.cossack/scaffold.json'), JSON.stringify(manifest, null, 2) + '\n');
    await write(project.projectDir, 'src/gone.ts', '// old\n// edited\n');
    await write(project.projectDir, 'src/gone-too.ts', '// old\n');

    const [, output] = await upgradeJson(project.projectDir, []);
    expect(output.data.plan.files.conflicts).toContainEqual({ path: 'src/gone.ts', reason: 'removed-upstream', resolution: 'preserve' });
    expect(await fs.readFile(path.join(project.projectDir, 'src/gone.ts'), 'utf8')).toBe('// old\n// edited\n');
    await expect(fs.access(path.join(project.projectDir, 'src/gone-too.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readManifest(project.projectDir)).files['src/gone-too.ts']).toBeUndefined();
  });
});
