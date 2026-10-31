import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addPlugin, listPlugins, readPluginDirectory, readPluginState, readPluginTarball, removePlugin, satisfies, upgradePlugin, validatePluginManifest,
} from '../src/plugins.js';

const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

async function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  }
}

async function pluginPackage(version = '1.0.0', files = {}, manifest = {}) {
  const dir = await tempDir('cossack-plugin-pkg-');
  await writeFiles(dir, {
    'package.json': JSON.stringify({ name: '@acme/support-desk', version, cossack: { plugin: 'cossack-plugin.json' } }),
    'cossack-plugin.json': JSON.stringify({ schemaVersion: 1, name: 'support-desk', version, description: 'Tickets', dependencies: { '@cossackframework/cms': '^0.9.0' }, ...manifest }),
    'plugin/pages/admin/tickets/index.ts': `export default class Tickets {} // ${version}\n`,
    'plugin/lang/en.json': '{"title":"Tickets"}\n',
    'plugin/server.ts': 'export const hooks = [];\n',
    ...files,
  });
  return dir;
}

async function project() {
  const dir = await tempDir('cossack-plugin-app-');
  await writeFiles(dir, { 'package.json': JSON.stringify({ name: 'app', dependencies: { hono: '^4.0.0' } }, null, 2) });
  return dir;
}

const read = (root, rel) => fs.readFile(path.join(root, rel), 'utf8');

describe('plugin recipes', () => {
  it('renders a package directory into src/plugins/<name>/ and records ownership', async () => {
    const app = await project();
    const result = await addPlugin(app, await pluginPackage());
    expect(result).toMatchObject({ status: 'added', name: 'support-desk', package: '@acme/support-desk', version: '1.0.0', from: null });
    expect(result.changes.writes.map(change => change.path).sort()).toEqual([
      'src/plugins/support-desk/lang/en.json', 'src/plugins/support-desk/pages/admin/tickets/index.ts',
      'src/plugins/support-desk/plugin.json', 'src/plugins/support-desk/server.ts',
    ]);
    const manifest = JSON.parse(await read(app, 'src/plugins/support-desk/plugin.json'));
    expect(manifest).toMatchObject({ name: 'support-desk', version: '1.0.0', package: '@acme/support-desk' });
    expect(manifest.source).toBeUndefined();
    expect(JSON.parse(await read(app, 'package.json')).dependencies).toEqual({ hono: '^4.0.0', '@cossackframework/cms': '^0.9.0' });
    const state = await readPluginState(app);
    expect(Object.keys(state.plugins['support-desk'].files)).toHaveLength(4);
    expect(state.plugins['support-desk'].source.type).toBe('directory');
    expect((await addPlugin(app, state.plugins['support-desk'].source.spec)).status).toBe('present');
  });

  it('renders an npm tarball without installing or executing it', async () => {
    const source = await pluginPackage('1.0.0', { 'package.json': JSON.stringify({
      name: '@acme/support-desk', version: '1.0.0', cossack: { plugin: 'cossack-plugin.json' }, scripts: { preinstall: 'exit 1', postinstall: 'touch pwned' },
      files: ['plugin', 'cossack-plugin.json'],
    }) });
    const out = await tempDir('cossack-plugin-tgz-');
    const name = execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', out], { cwd: source, encoding: 'utf8' }).trim().split('\n').pop();
    const tarball = path.join(out, name);
    const plugin = await readPluginTarball(tarball);
    expect(plugin.packageName).toBe('@acme/support-desk');
    expect([...plugin.files.keys()].sort()).toEqual(['lang/en.json', 'pages/admin/tickets/index.ts', 'server.ts']);
    const app = await project();
    const result = await addPlugin(app, tarball);
    expect(result.status).toBe('added');
    expect((await readPluginState(app)).plugins['support-desk'].source).toEqual({ type: 'tarball', spec: tarball });
    await expect(fs.access(path.join(app, 'pwned'))).rejects.toThrow();
    await expect(fs.access(path.join(source, 'pwned'))).rejects.toThrow();
  });

  it('upgrades unchanged files, keeps local edits and reports conflicts', async () => {
    const app = await project();
    await addPlugin(app, await pluginPackage('1.0.0', { 'plugin/lib/a.ts': 'a1\n', 'plugin/lib/b.ts': 'b1\n', 'plugin/lib/gone.ts': 'old\n' }));
    // Local edits: one to a file upstream changes, one to a file upstream keeps.
    await fs.writeFile(path.join(app, 'src/plugins/support-desk/lib/a.ts'), 'a1 local\n');
    await fs.writeFile(path.join(app, 'src/plugins/support-desk/lib/b.ts'), 'b1 local\n');
    const next = await pluginPackage('1.1.0', { 'plugin/lib/a.ts': 'a2\n', 'plugin/lib/b.ts': 'b1\n', 'plugin/lib/new.ts': 'new\n' });

    const conflict = await upgradePlugin(app, 'support-desk', { source: next }).catch(error => error);
    expect(conflict.code).toBe('COSSACK_PLUGIN_CONFLICT');
    expect(conflict.conflicts).toEqual(['src/plugins/support-desk/lib/a.ts']);
    expect(await read(app, 'src/plugins/support-desk/lib/a.ts')).toBe('a1 local\n');
    expect(await read(app, 'src/plugins/support-desk/lib/gone.ts')).toBe('old\n');

    await fs.writeFile(path.join(app, 'src/plugins/support-desk/lib/a.ts'), 'a1\n');
    const upgraded = await upgradePlugin(app, 'support-desk', { source: next });
    expect(upgraded).toMatchObject({ status: 'upgraded', from: '1.0.0', version: '1.1.0' });
    expect(upgraded.changes.preserved).toEqual([{ path: 'src/plugins/support-desk/lib/b.ts', capability: 'plugin:support-desk', reason: 'locally-modified' }]);
    expect(await read(app, 'src/plugins/support-desk/lib/a.ts')).toBe('a2\n');
    expect(await read(app, 'src/plugins/support-desk/lib/b.ts')).toBe('b1 local\n');
    expect(await read(app, 'src/plugins/support-desk/lib/new.ts')).toBe('new\n');
    await expect(fs.access(path.join(app, 'src/plugins/support-desk/lib/gone.ts'))).rejects.toThrow();

    // The preserved edit keeps its upstream baseline: a later upstream change to it conflicts.
    const third = await pluginPackage('1.2.0', { 'plugin/lib/a.ts': 'a2\n', 'plugin/lib/b.ts': 'b3\n', 'plugin/lib/new.ts': 'new\n' });
    await expect(upgradePlugin(app, 'support-desk', { source: third })).rejects.toMatchObject({ conflicts: ['src/plugins/support-desk/lib/b.ts'] });
    const forced = await upgradePlugin(app, 'support-desk', { source: third, force: true });
    expect(forced.status).toBe('upgraded');
    expect(await read(app, 'src/plugins/support-desk/lib/b.ts')).toBe('b3\n');
  });

  it('refuses to take over an unrendered directory or a name rendered from another package', async () => {
    const app = await project();
    await writeFiles(app, { 'src/plugins/support-desk/pages/index.ts': 'mine' });
    await expect(addPlugin(app, await pluginPackage())).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_CONFLICT' });
    const other = await project();
    await addPlugin(other, await pluginPackage());
    const impostor = await pluginPackage('1.0.0', { 'package.json': JSON.stringify({ name: '@evil/desk', version: '1.0.0' }) });
    await expect(addPlugin(other, impostor)).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_NAME_TAKEN' });
  });

  it('removes unmodified files and keeps edited ones unless forced', async () => {
    const app = await project();
    await addPlugin(app, await pluginPackage());
    await fs.writeFile(path.join(app, 'src/plugins/support-desk/server.ts'), 'edited\n');
    await expect(removePlugin(app, 'support-desk')).rejects.toMatchObject({ conflicts: ['src/plugins/support-desk/server.ts'] });
    const removed = await removePlugin(app, 'support-desk', { force: true });
    expect(removed.changes.deletes).toHaveLength(4);
    await expect(fs.access(path.join(app, 'src/plugins/support-desk'))).rejects.toThrow();
    expect((await readPluginState(app)).plugins).toEqual({});
  });

  it('discovers installed plugin packages by manifest field without importing them', async () => {
    const app = await project();
    const source = await pluginPackage();
    await fs.mkdir(path.join(app, 'node_modules/@acme'), { recursive: true });
    await fs.cp(source, path.join(app, 'node_modules/@acme/support-desk'), { recursive: true });
    await writeFiles(app, {
      'node_modules/plain/package.json': JSON.stringify({ name: 'plain', version: '1.0.0' }),
      'node_modules/broken/package.json': JSON.stringify({ name: 'broken', version: '1.0.0', cossack: { plugin: 'missing.json' } }),
      'node_modules/@acme/support-desk/index.js': 'throw new Error("must not run")',
    });
    let listing = await listPlugins(app);
    expect(listing.installed).toEqual([
      { package: '@acme/support-desk', version: '1.0.0', plugin: 'support-desk', rendered: false, problems: [] },
      expect.objectContaining({ package: 'broken', plugin: null }),
    ]);
    const installs = [];
    await addPlugin(app, '@acme/support-desk', { install: async spec => { installs.push(spec); } });
    expect(installs).toEqual(['@acme/support-desk']);
    listing = await listPlugins(app);
    expect(listing.rendered).toEqual([{ name: 'support-desk', package: '@acme/support-desk', version: '1.0.0', source: { type: 'npm', spec: '@acme/support-desk' } }]);
    expect(listing.installed[0].rendered).toBe(true);
    await expect(addPlugin(app, 'not-installed', { install: false })).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_NOT_INSTALLED' });
  });

  it('checks compatibility ranges against installed versions', async () => {
    const app = await project();
    const source = await pluginPackage('1.0.0', {}, { compatibility: { '@cossackframework/framework': '^1.0.0' } });
    await expect(addPlugin(app, source, { versions: { '@cossackframework/framework': '0.9.0' } })).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_INCOMPATIBLE' });
    expect((await addPlugin(app, source, { versions: { '@cossackframework/framework': '1.4.2' } })).status).toBe('added');
    expect(satisfies('0.9.3', '^0.9.0')).toBe(true);
    expect(satisfies('0.10.0', '^0.9.0')).toBe(false);
    expect(satisfies('1.2.0', '>=1.0.0 <2.0.0 || 3.x')).toBe(true);
    expect(satisfies('3.1.0', '>=1.0.0 <2.0.0 || 3.x')).toBe(true);
    expect(satisfies('2.0.0', '~1.2.0')).toBe(false);
  });

  it('rejects unsafe or invalid packages', async () => {
    expect(validatePluginManifest({ schemaVersion: 1, name: 'cms', version: '1.0.0' })).toEqual(['name "cms" is reserved.']);
    expect(validatePluginManifest({ schemaVersion: 2, name: 'Bad', version: 'x', source: '../up' })).toHaveLength(4);
    const linked = await pluginPackage();
    await fs.symlink('/etc/passwd', path.join(linked, 'plugin/passwd'));
    await expect(readPluginDirectory(linked)).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_SOURCE_UNSAFE' });
    const shadow = await pluginPackage('1.0.0', { 'plugin/plugin.json': '{}' });
    await expect(addPlugin(await project(), shadow)).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_SOURCE_UNSAFE' });
    const mismatch = await pluginPackage('1.0.0', { 'package.json': JSON.stringify({ name: '@acme/support-desk', version: '2.0.0' }) });
    await expect(readPluginDirectory(mismatch)).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_MANIFEST_INVALID' });
  });
});
