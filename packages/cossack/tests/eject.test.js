import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { overrideReport, scanPageSources } from '@cossackframework/framework/plugin-sources';
import { readBase } from '@cossackframework/scaffold';
import { diffEjected, ejectFiles, mergeEjected, resolveEjectTarget, restoreEjected } from '../src/eject.js';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

const page = body => `import { helper } from '#app/lib/helper';\nimport { format } from './format';\nimport type { Host } from '@/kit/host';\n\nexport default class Page {\n  title = 'Kit';\n  render() {\n    return helper(${JSON.stringify(body)});\n  }\n  footer() {\n    return format('footer');\n  }\n}\n`;

async function write(root, files) {
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
}

/** A project that mounts @acme/kit 1.0.0. */
async function project() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-eject-')));
  roots.push(root);
  await write(root, {
    'package.json': JSON.stringify({ name: 'app', cossack: { packages: ['@acme/kit'] } }),
    '.cossack/scaffold.json': JSON.stringify({ schemaVersion: 4, templateVersion: '0.9.0', runtime: 'node', explicitFeatures: [], files: {} }),
    'src/kit/host.ts': 'export interface Host {}\n',
    'node_modules/@acme/kit/package.json': JSON.stringify({ name: '@acme/kit', version: '1.0.0', exports: { './app/*': './app/src/*.ts' },
      cossack: { root: 'app/src', alias: 'kit', pages: ['pages/kit/'], plugins: ['plugins/kit-theme/'], config: ['config/kit.ts'], host: ['kit/host.ts'] } }),
    'node_modules/@acme/kit/app/src/pages/kit/index.ts': page('first'),
    'node_modules/@acme/kit/app/src/pages/kit/format.ts': 'export const format = (text: string) => text;\n',
    'node_modules/@acme/kit/app/src/pages/kit/layout.ts': 'export default class Layout {}\n',
    'node_modules/@acme/kit/app/src/lib/helper.ts': 'export const helper = (text: string) => text;\n',
    'node_modules/@acme/kit/app/src/config/kit.ts': "import { helper } from '../lib/helper';\nexport default () => ({ name: helper('kit') });\n",
    'node_modules/@acme/kit/app/src/plugins/kit-theme/plugin.json': JSON.stringify({ name: 'kit-theme', version: '1.0.0' }),
    'node_modules/@acme/kit/app/src/plugins/kit-theme/templates/entry.ts': "import { part } from '../parts/part';\nimport { helper } from '#app/lib/helper';\nexport default () => helper(part);\n",
    'node_modules/@acme/kit/app/src/plugins/kit-theme/parts/part.ts': "export const part = 'part';\n",
    'node_modules/@acme/kit/app/src/plugins/kit-theme/assets/logo.svg': '<svg/>',
  });
  return root;
}

const read = (root, file) => fs.readFile(path.join(root, file), 'utf8');
const manifestOf = async root => JSON.parse(await read(root, '.cossack/scaffold.json'));
/** A new version of the package: its files change, and so does its version. */
async function release(root, version, files) {
  const file = path.join(root, 'node_modules/@acme/kit/package.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  // The package manifest is cached by its size and time: a new version has both.
  await fs.writeFile(file, JSON.stringify({ ...manifest, version, released: Date.now() }));
  await write(path.join(root, 'node_modules/@acme/kit'), files);
}

describe('cossack eject', () => {
  it('copies a served page with its imports rewritten, and records it', async () => {
    const root = await project();
    const target = await resolveEjectTarget(root, 'kit', 'src/pages/kit/index.ts');
    expect(target).toMatchObject({ kind: 'page', unit: 'pages/kit/index.ts', files: ['pages/kit/index.ts'] });
    expect(await ejectFiles(root, target)).toEqual({ files: ['src/pages/kit/index.ts'], dryRun: false });
    const copy = await read(root, 'src/pages/kit/index.ts');
    // Imports that stay in the package are named by the package: the copy and the package share each module.
    expect(copy).toContain("import { helper } from '@acme/kit/app/lib/helper';");
    expect(copy).toContain("import { format } from '@acme/kit/app/pages/kit/format';");
    // The application's own modules are still the application's.
    expect(copy).toContain("import type { Host } from '@/kit/host';");
    const record = (await manifestOf(root)).ejected['src/pages/kit/index.ts'];
    expect(record).toMatchObject({ package: '@acme/kit', version: '1.0.0', source: 'pages/kit/index.ts' });
    expect((await readBase(root, record.base)).toString()).toBe(copy);
    // The copy now serves the route, and the build says so.
    const sources = scanPageSources(root);
    expect(sources.origins['/src/pages/kit/index.ts']).toEqual({ kind: 'app', file: path.join(root, 'src/pages/kit/index.ts') });
    expect(overrideReport(root, sources.overrides)).toEqual(['[cossack] src/pages/kit/index.ts overrides @acme/kit']);
  });

  it('takes the package by name, and the file by route', async () => {
    const root = await project();
    expect((await resolveEjectTarget(root, '@acme/kit', '/kit')).files).toEqual(['pages/kit/index.ts']);
    await expect(resolveEjectTarget(root, 'kit', '/absent')).rejects.toMatchObject({ code: 'COSSACK_EJECT_NOT_SERVED' });
    await expect(resolveEjectTarget(root, 'other', '/kit')).rejects.toMatchObject({ code: 'COSSACK_EJECT_PACKAGE_UNKNOWN' });
    expect((await resolveEjectTarget(root, 'kit', 'src/config/kit.ts')).kind).toBe('config');
    expect((await resolveEjectTarget(root, 'kit', 'src/pages/kit/layout.ts')).kind).toBe('page');
  });

  it('refuses a shared module, and a file that exists', async () => {
    const root = await project();
    await expect(resolveEjectTarget(root, 'kit', 'src/lib/helper.ts')).rejects.toMatchObject({ code: 'COSSACK_EJECT_NOT_OVERRIDABLE', message: expect.stringContaining('would never use a copy') });
    await expect(resolveEjectTarget(root, 'kit', '../outside.ts')).rejects.toMatchObject({ code: 'COSSACK_EJECT_PATH_UNSAFE' });
    await write(root, { 'src/pages/kit/index.ts': '// mine\n' });
    // The route is the application's now, so the file is named by its path.
    await expect(resolveEjectTarget(root, 'kit', '/kit')).rejects.toMatchObject({ code: 'COSSACK_EJECT_NOT_SERVED' });
    const target = await resolveEjectTarget(root, 'kit', 'src/pages/kit/index.ts');
    await expect(ejectFiles(root, target)).rejects.toMatchObject({ code: 'COSSACK_EJECT_EXISTS', files: ['src/pages/kit/index.ts'] });
    expect(await read(root, 'src/pages/kit/index.ts')).toBe('// mine\n');
    await ejectFiles(root, target, { force: true });
    expect(await read(root, 'src/pages/kit/index.ts')).toContain('export default class Page');
    // A dry run writes nothing.
    await fs.rm(path.join(root, 'src/config'), { recursive: true, force: true });
    expect(await ejectFiles(root, await resolveEjectTarget(root, 'kit', 'src/config/kit.ts'), { dryRun: true })).toEqual({ files: ['src/config/kit.ts'], dryRun: true });
    await expect(fs.access(path.join(root, 'src/config/kit.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ejects a plugin whole: its own imports stay, the others name the package', async () => {
    const root = await project();
    const target = await resolveEjectTarget(root, 'kit', 'plugins/kit-theme');
    expect(target).toMatchObject({ kind: 'plugin', unit: 'plugins/kit-theme/' });
    const { files } = await ejectFiles(root, target);
    expect(files).toEqual(['src/plugins/kit-theme/assets/logo.svg', 'src/plugins/kit-theme/parts/part.ts', 'src/plugins/kit-theme/plugin.json', 'src/plugins/kit-theme/templates/entry.ts']);
    const entry = await read(root, 'src/plugins/kit-theme/templates/entry.ts');
    expect(entry).toContain("import { part } from '../parts/part';");
    expect(entry).toContain("import { helper } from '@acme/kit/app/lib/helper';");
    expect(await read(root, 'src/plugins/kit-theme/assets/logo.svg')).toBe('<svg/>');
    // The application's plugin replaces the package's as a whole.
    const sources = scanPageSources(root);
    expect(overrideReport(root, sources.overrides)).toEqual(['[cossack] src/plugins/kit-theme overrides @acme/kit']);
    expect(Object.keys((await manifestOf(root)).ejected)).toHaveLength(4);
    // Restoring the plugin's folder removes every file of it.
    expect((await restoreEjected(root, 'src/plugins/kit-theme')).files).toHaveLength(4);
    await expect(fs.access(path.join(root, 'src/plugins'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manifestOf(root)).ejected).toBeUndefined();
  });

  it('merges the package\'s later changes into the copy, as an upgrade does', async () => {
    const root = await project();
    await ejectFiles(root, await resolveEjectTarget(root, 'kit', '/kit'));
    await ejectFiles(root, await resolveEjectTarget(root, 'kit', 'src/config/kit.ts'));
    const first = (await manifestOf(root)).ejected['src/pages/kit/index.ts'].base;
    // The project edits the page's last method; the config copy stays as it was.
    const edited = (await read(root, 'src/pages/kit/index.ts')).replace("format('footer')", "format('my footer')");
    await write(root, { 'src/pages/kit/index.ts': edited });
    expect((await mergeEjected(root)).map(entry => entry.status)).toEqual(['local', 'upToDate']);

    // The package changes the page's body, and the config file.
    await release(root, '1.1.0', {
      'app/src/pages/kit/index.ts': page('second'),
      'app/src/config/kit.ts': "import { helper } from '../lib/helper';\nexport default () => ({ name: helper('kit'), color: 'blue' });\n",
    });
    // pnpm up alone merges nothing, and the build says which override fell behind.
    expect(overrideReport(root, scanPageSources(root).overrides)).toEqual([
      '[cossack] src/pages/kit/index.ts overrides @acme/kit 1.1.0; the package changed it since 1.0.0: run cossack upgrade',
    ]);
    expect((await mergeEjected(root, { dryRun: true })).map(entry => [entry.path, entry.status])).toEqual([['src/pages/kit/index.ts', 'merged'], ['src/config/kit.ts', 'updated']]);
    expect(await read(root, 'src/pages/kit/index.ts')).toBe(edited);

    const merged = await mergeEjected(root);
    expect(merged).toEqual([
      { path: 'src/pages/kit/index.ts', package: '@acme/kit', from: '1.0.0', to: '1.1.0', status: 'merged' },
      { path: 'src/config/kit.ts', package: '@acme/kit', from: '1.0.0', to: '1.1.0', status: 'updated' },
    ]);
    const copy = await read(root, 'src/pages/kit/index.ts');
    expect(copy).toContain('helper("second")');
    expect(copy).toContain("format('my footer')");
    expect(copy).toContain("from '@acme/kit/app/lib/helper'");
    expect(await read(root, 'src/config/kit.ts')).toContain("color: 'blue'");
    const record = (await manifestOf(root)).ejected['src/pages/kit/index.ts'];
    expect(record.version).toBe('1.1.0');
    expect(record.base).not.toBe(first);
    // The old base has no reference left, and a second run changes nothing.
    expect(await readBase(root, first)).toBeNull();
    expect((await mergeEjected(root)).map(entry => entry.status)).toEqual(['local', 'upToDate']);
    expect(overrideReport(root, scanPageSources(root).overrides)).toEqual(['[cossack] src/pages/kit/index.ts overrides @acme/kit']);
  });

  it('keeps a conflicting copy, writes markers on request, and waits until they are resolved', async () => {
    const root = await project();
    await ejectFiles(root, await resolveEjectTarget(root, 'kit', '/kit'));
    const mine = (await read(root, 'src/pages/kit/index.ts')).replace('helper("first")', 'helper("mine")');
    await write(root, { 'src/pages/kit/index.ts': mine });
    await release(root, '1.1.0', { 'app/src/pages/kit/index.ts': page('theirs') });
    const [kept] = await mergeEjected(root);
    expect(kept).toMatchObject({ status: 'conflict', conflicts: 1 });
    expect(kept.text).toContain('<<<<<<< yours');
    expect(kept.text).toContain('>>>>>>> @acme/kit 1.1.0');
    expect(await read(root, 'src/pages/kit/index.ts')).toBe(mine);
    // Both sides, for a person or an agent to compare.
    const [diff] = await diffEjected(root, 'src/pages/kit/index.ts');
    expect(diff).toMatchObject({ file: 'src/pages/kit/index.ts', package: '@acme/kit', from: '1.0.0', to: '1.1.0' });
    expect(diff.package_changes).toContain('-    return helper("first");\n+    return helper("theirs");');
    expect(diff.project_changes).toContain('+    return helper("mine");');

    expect((await mergeEjected(root, { markers: true }))[0]).toMatchObject({ status: 'markers', conflicts: 1 });
    expect(await read(root, 'src/pages/kit/index.ts')).toContain('<<<<<<< yours');
    expect((await mergeEjected(root))[0].status).toBe('unresolved');
    await write(root, { 'src/pages/kit/index.ts': mine.replace('helper("mine")', 'helper("resolved")') });
    expect((await mergeEjected(root))[0].status).toBe('local');
  });

  it('restores the package\'s file, and asks before it deletes an edited copy', async () => {
    const root = await project();
    await ejectFiles(root, await resolveEjectTarget(root, 'kit', '/kit'));
    await fs.appendFile(path.join(root, 'src/pages/kit/index.ts'), '// edited\n');
    await expect(restoreEjected(root, 'src/pages/kit/index.ts')).rejects.toMatchObject({ code: 'COSSACK_EJECT_EDITED' });
    await expect(restoreEjected(root, 'src/pages/other.ts')).rejects.toMatchObject({ code: 'COSSACK_EJECT_UNKNOWN' });
    expect(await restoreEjected(root, 'pages/kit/index.ts', { force: true })).toEqual({ files: ['src/pages/kit/index.ts'], dryRun: false });
    await expect(fs.access(path.join(root, 'src/pages'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(scanPageSources(root).origins['/src/pages/kit/index.ts']).toMatchObject({ kind: 'package' });
    await expect(fs.readdir(path.join(root, '.cossack/base'))).resolves.toEqual([]);
  });
});
