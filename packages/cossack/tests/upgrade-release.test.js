import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '@cossackframework/scaffold';

const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));
const scaffold = fileURLToPath(new URL('../../scaffold/', import.meta.url));
let root, app, release, tools;
const hash = content => createHash('sha256').update(content).digest('hex');
const read = relative => fs.readFile(path.join(app, relative), 'utf8');
const json = async relative => JSON.parse(await read(relative));
const write = (relative, value) => fs.writeFile(path.join(app, relative), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-release-upgrade-'));
  app = (await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', features: ['auth'], interactive: false })).projectDir;
  const applicationPackage = await json('package.json');
  applicationPackage.packageManager = 'pnpm@11.19.0';
  await write('package.json', applicationPackage);
  release = path.join(root, 'release');
  await fs.mkdir(release);
  for (const directory of ['src', 'template']) await fs.cp(path.join(scaffold, directory), path.join(release, directory), { recursive: true });
  await fs.copyFile(path.join(scaffold, 'tsconfig.template.json'), path.join(release, 'tsconfig.template.json'));
  const pkg = JSON.parse(await fs.readFile(path.join(scaffold, 'package.json'), 'utf8'));
  pkg.version = '1.2.3';
  await fs.writeFile(path.join(release, 'package.json'), JSON.stringify(pkg));
  await fs.mkdir(path.join(release, 'node_modules'));
  // The isolated release needs its declared dependencies, including workspace
  // packages that pnpm links at package level rather than hoisting to the root.
  for (const [name, directory] of Object.entries({
    '@cossackframework': path.join(scaffold, 'node_modules/@cossackframework'),
    prompts: fileURLToPath(new URL('../../../node_modules/prompts', import.meta.url)),
    yaml: fileURLToPath(new URL('../../../node_modules/yaml', import.meta.url)),
  })) await fs.symlink(directory, path.join(release, 'node_modules', name), 'junction');
  let source = await fs.readFile(path.join(release, 'src/index.js'), 'utf8');
  source = source.replace("dependencies.ws = dependencyVersion('ws');", "dependencies['release-added'] = '^2.0.0';");
  await fs.writeFile(path.join(release, 'src/index.js'), source);
  await fs.appendFile(path.join(release, 'template/src/App.ts'), '\n// target release 1.2.3\n');
  tools = path.join(root, 'tools'); await fs.mkdir(tools);
  await fs.writeFile(path.join(tools, 'pnpm'), `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'view') console.log(JSON.stringify('1.2.3'));
else if (args[0] === 'add') {
  if (!['--ignore-scripts', '--ignore-workspace', '--save-exact', '--lockfile=false', '@cossackframework/scaffold@1.2.3'].every(value => args.includes(value))) process.exit(9);
  fs.appendFileSync(process.env.FIXTURE_DOWNLOADS, process.cwd() + '\\n');
  if (process.env.FIXTURE_FAIL_DOWNLOAD) { console.error('download-private-value'); process.exit(1); }
  fs.mkdirSync('node_modules/@cossackframework', { recursive: true });
  fs.symlinkSync(process.env.FIXTURE_RELEASE, path.resolve('node_modules/@cossackframework/scaffold'), 'junction');
  if (process.env.FIXTURE_EDIT) fs.appendFileSync(process.env.FIXTURE_EDIT, '\\n');
} else if (args[0] === 'install') {
  fs.appendFileSync(process.env.FIXTURE_INSTALLS, 'install\\n');
  if (process.env.FIXTURE_FAIL_INSTALL) { console.error('install-private-value'); process.exit(1); }
} else process.exit(8);
`, { mode: 0o755 });
}, 15000);
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function environment(overrides = {}) {
  return { ...process.env, PATH: tools + path.delimiter + process.env.PATH,
    FIXTURE_RELEASE: release, FIXTURE_DOWNLOADS: path.join(root, 'downloads'), FIXTURE_INSTALLS: path.join(root, 'installs'), ...overrides };
}

async function run(args = [], env = {}) {
  let result;
  try {
    result = { ...await exec(process.execPath, [bin, 'upgrade', '--json', ...args], { cwd: app, timeout: 20000,
      env: environment(env) }), code: 0 };
  } catch (error) { result = error; }
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('private-value');
  expect(result.stdout.trim().split('\n')).toHaveLength(1);
  const value = JSON.parse(result.stdout);
  expect(value).toMatchObject({ schemaVersion: 1, command: 'upgrade', ok: result.code === 0 });
  // Every foreign-release installation is temporary, including failed loads.
  const downloads = await fs.readFile(path.join(root, 'downloads'), 'utf8').catch(() => '');
  for (const directory of downloads.trim().split('\n').filter(Boolean)) await expect(fs.access(directory)).rejects.toThrow();
  return value;
}

async function snapshot() {
  const entries = {};
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else entries[path.relative(app, target)] = await fs.readFile(target, 'base64');
    }
  }
  await visit(app); return entries;
}

describe('release-aligned upgrade planning and application', () => {
  it('plans the requested release, preserves edits, applies owned changes, and repeats without effects', async () => {
    const pkg = await json('package.json');
    pkg.dependencies.hono = '^999.0.0';
    pkg.dependencies['@cossackframework/auth'] = '^999.0.0';
    pkg.dependencies['user-only'] = 'file:private-value';
    delete pkg.devDependencies.typescript;
    await write('package.json', pkg);
    await write('src/auth.ts', '// local authentication module\n');
    const manifest = await json('.cossack/scaffold.json');
    for (const name of ['obsolete', 'edited-obsolete']) {
      const relative = `src/${name}.ts`;
      await write(relative, '// old generated file\n');
      manifest.files[relative] = { capability: 'base', hash: hash('// old generated file\n') };
    }
    await write('src/edited-obsolete.ts', '// user-owned implementation\n');
    await write('.cossack/scaffold.json', manifest);
    const before = await snapshot();
    const preview = await run(['--tag=next', '--apply-template', '--dry-run']);
    expect(preview.ok).toBe(true);
    expect(preview.data.plan.templateVersion).toBe('1.2.3');
    expect(preview.data.plan.dependencies.additions).toContainEqual({ name: 'release-added', section: 'dependencies', to: '^2.0.0' });
    expect(preview.data.plan.dependencies.removals).toContainEqual(expect.objectContaining({ name: 'ws' }));
    expect(preview.data.plan.dependencies.conflicts.map(item => item.name)).toEqual(expect.arrayContaining(['hono', '@cossackframework/auth', 'typescript']));
    expect(preview.data.plan.files.deletes).toContain('src/obsolete.ts');
    expect(preview.data.plan.files.preserved).toEqual(expect.arrayContaining(['src/auth.ts', 'src/edited-obsolete.ts']));
    expect(await snapshot()).toEqual(before);
    const applied = await run(['--tag=1.2.3', '--apply-template']);
    expect(applied.ok, JSON.stringify(applied.diagnostics)).toBe(true);
    expect(await read('src/App.ts')).toContain('// target release 1.2.3');
    expect(await read('src/auth.ts')).toBe('// local authentication module\n');
    await expect(read('src/obsolete.ts')).rejects.toThrow();
    expect(await read('src/edited-obsolete.ts')).toBe('// user-owned implementation\n');
    const changed = await json('package.json');
    expect(changed.dependencies).toMatchObject({ '@cossackframework/core': '^1.2.3', '@cossackframework/auth': '^999.0.0',
      hono: '^999.0.0', 'release-added': '^2.0.0', 'user-only': 'file:private-value' });
    expect(changed.dependencies).not.toHaveProperty('ws');
    expect(changed.devDependencies).not.toHaveProperty('typescript');
    const owned = await json('.cossack/scaffold.json');
    expect(owned.templateVersion).toBe('1.2.3');
    expect(owned.dependencyBaseline.dependencies['@cossackframework/core']).toBe('^1.2.3');
    expect(owned.dependencyBaseline.dependencies).not.toHaveProperty('user-only');
    expect(owned.files).not.toHaveProperty('src/obsolete.ts');
    const completed = await snapshot();
    const repeat = await run(['--tag=1.2.3', '--apply-template']);
    expect(repeat.ok).toBe(true);
    expect(repeat.data.effects).toEqual([]);
    expect(repeat.data.plan.install.required).toBe(false);
    expect(await snapshot()).toEqual(completed);
    expect(await fs.readFile(path.join(root, 'installs'), 'utf8')).toBe('install\n');
  }, 20000);

  it('reconstructs older schema-v3 dependency ownership using its recorded release', async () => {
    const manifest = await json('.cossack/scaffold.json'); delete manifest.dependencyBaseline;
    await write('.cossack/scaffold.json', manifest);
    const pkg = await json('package.json'); pkg.dependencies.hono = '^999.0.0'; await write('package.json', pkg);
    const result = await run(['--tag=1.2.3', '--dry-run']);
    expect(result.ok).toBe(true);
    expect(result.data.plan.dependencies.ownershipSource).toBe('reconstructed');
    expect(result.data.plan.dependencies.updates).toContainEqual(expect.objectContaining({ name: '@cossackframework/core', to: '^1.2.3' }));
    expect(result.data.plan.dependencies.conflicts).toContainEqual({ name: 'hono', reason: 'locally-modified', resolution: 'preserve' });
  });

  it('fails before project effects when the requested template cannot load', async () => {
    const before = await snapshot();
    const result = await run(['--tag=1.2.3'], { FIXTURE_FAIL_DOWNLOAD: '1' });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('COSSACK_UPGRADE_TEMPLATE_UNAVAILABLE');
    await expect(exec(process.execPath, [bin, 'upgrade', '--tag=1.2.3'], {
      cwd: app, timeout: 10000, env: environment({ FIXTURE_FAIL_DOWNLOAD: '1' }),
    })).rejects.toMatchObject({ stderr: expect.stringContaining('download-private-value') });
    expect(await snapshot()).toEqual(before);
  });

  it('records applied changes and recovery when dependency installation fails', async () => {
    const result = await run(['--tag=1.2.3'], { FIXTURE_FAIL_INSTALL: '1' });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ status: 'partial-failure', applied: { dependencies: true, manifest: true, installed: false } });
    expect(result.diagnostics[0].code).toBe('COSSACK_UPGRADE_INSTALL_FAILED');
    expect(result.data.nextActions).toContain('pnpm install');
    expect((await json('package.json')).dependencies['@cossackframework/core']).toBe('^1.2.3');
  });

  it('detects ownership manifest edits made during target package loading', async () => {
    const before = await read('package.json');
    const result = await run(['--tag=1.2.3', '--apply-template'], { FIXTURE_EDIT: path.join(app, '.cossack/scaffold.json') });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('COSSACK_UPGRADE_PLAN_STALE');
    expect(await read('package.json')).toBe(before);
  });

  it('rejects force-file for package.json and preserves local environment secrets', async () => {
    const before = await snapshot();
    for (const relative of ['package.json', '.env', '../outside.ts']) {
      const result = await run(['--tag=1.2.3', `--force-file=${relative}`]);
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0].code).toBe('COSSACK_UPGRADE_FILE_UNKNOWN');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('rejects malformed ownership instead of silently treating the application as unmanaged', async () => {
    const before = await read('package.json');
    await write('.cossack/scaffold.json', '{"secret":"parser-private-value"');
    const result = await run(['--tag=1.2.3']);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('COSSACK_UPGRADE_MANIFEST_INVALID');
    expect(await read('package.json')).toBe(before);
  });

  it('rejects symbolic links in owned paths before changing the app or linked file', async () => {
    const outside = path.join(root, 'shared.ts');
    const original = await read('src/App.ts');
    await fs.writeFile(outside, original);
    await fs.rm(path.join(app, 'src/App.ts'));
    await fs.symlink(outside, path.join(app, 'src/App.ts'));
    const before = await read('package.json');
    const result = await run(['--tag=1.2.3', '--apply-template']);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('COSSACK_UPGRADE_PATH_UNSAFE');
    expect(await fs.readFile(outside, 'utf8')).toBe(original);
    expect(await read('package.json')).toBe(before);
  });

  it('redacts custom specifiers from an unmanaged application dependency plan', async () => {
    await fs.rm(path.join(app, '.cossack/scaffold.json'));
    await write('package.json', { dependencies: { '@cossackframework/core': 'https://user:private-value@example.test/core.tgz' } });
    const result = await run(['--tag=1.2.3', '--dry-run']);
    expect(result.ok).toBe(true);
    expect(result.data.plan.dependencies.updates).toEqual([
      { name: '@cossackframework/core', section: 'dependencies', from: '[custom specifier]', to: '^1.2.3', changed: true },
    ]);
  });

  it('uses real pnpm to fetch an ESM-only release tarball from a local registry', async () => {
    const stage = path.join(root, 'packed'); await fs.mkdir(path.join(stage, 'package'), { recursive: true });
    const packageJson = { name: '@cossackframework/scaffold', version: '1.2.3', type: 'module',
      exports: { '.': { import: './index.js' }, './package.json': './package.json' } };
    await fs.writeFile(path.join(stage, 'package/package.json'), JSON.stringify(packageJson));
    const source = pathToFileURL(path.join(scaffold, 'src/index.js')).href;
    await fs.writeFile(path.join(stage, 'package/index.js'), `
      import { renderRecipe as render } from ${JSON.stringify(source)};
      export { resolveRecipe, migratePnpmBuildSettings } from ${JSON.stringify(source)};
      export async function renderRecipe(...args) {
        const files = await render(...args);
        const pkg = JSON.parse(files.get('package.json').content.toString());
        pkg.dependencies['@cossackframework/core'] = '^1.2.3';
        files.get('package.json').content = Buffer.from(JSON.stringify(pkg));
        files.get('src/App.ts').content = Buffer.from('// fetched release tarball\\n' + files.get('src/App.ts').content);
        return files;
      }
    `);
    const tarball = path.join(root, 'release.tgz');
    await exec('tar', ['-czf', tarball, '-C', stage, 'package']);
    const bytes = await fs.readFile(tarball);
    let origin;
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      if (req.url === '/release.tgz') { res.end(bytes); return; }
      if (!decodeURIComponent(req.url).includes('@cossackframework/scaffold')) { res.writeHead(404); res.end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: packageJson.name, 'dist-tags': { latest: '1.2.3' },
        time: { '1.2.3': '2020-01-01T00:00:00.000Z' },
        versions: { '1.2.3': { ...packageJson, dist: { tarball: origin + '/release.tgz',
          shasum: createHash('sha1').update(bytes).digest('hex') } } } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const before = await snapshot();
      const { stdout, stderr } = await exec(process.execPath, [bin, 'upgrade', '--tag=1.2.3', '--apply-template', '--dry-run', '--json'],
        { cwd: app, timeout: 45000, env: { ...process.env, pnpm_config_registry: origin, CI: 'true' } });
      expect(stderr).toBe('');
      const result = JSON.parse(stdout);
      expect(result.ok).toBe(true);
      expect(result.data.plan.templateVersion).toBe('1.2.3');
      expect(result.data.plan.dependencies.updates).toContainEqual(expect.objectContaining({ name: '@cossackframework/core', to: '^1.2.3' }));
      expect(result.data.plan.files.writes).toContainEqual({ path: 'src/App.ts', forced: false });
      expect(requests).toContain('/release.tgz');
      expect(await snapshot()).toEqual(before);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }, 60000);
});
