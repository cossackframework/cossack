// Scaffolds generated applications that resolve dependencies from this repository.
//
// A generated app has no installed dependencies. Tests link the repository's
// root node_modules entries plus the workspace @cossackframework packages into it.
// `createLinkedApp` caches each scaffolded+linked base app in os.tmpdir() and
// copies it per case (symlinks are copied verbatim), so repeated cases skip
// scaffolding, linking and any extra package installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('../../../../', import.meta.url));
export const workspacePackages = Object.freeze([
  'framework', 'core', 'renderer', 'auth', 'database', 'ui', 'scaffold', 'test-utils', 'node-adapter', 'desktop', 'typescript-plugin', 'romedb', 'cms',
]);

/**
 * Links repository dependencies into `<root>/node_modules`.
 * @param {string} root Application directory.
 * @param {{ packages?: readonly string[], includeHidden?: boolean, exclude?: readonly string[], modules?: string }} [options]
 *   `packages`: workspace packages linked under @cossackframework (default: all).
 *   `includeHidden`: also link dot entries such as `.bin`.
 *   `exclude`: root node_modules entries that are not linked.
 */
export async function linkRepositoryModules(root, { packages = workspacePackages, includeHidden = false, exclude = [], modules = path.join(root, 'node_modules') } = {}) {
  const source = path.join(repository, 'node_modules');
  await fs.mkdir(path.join(modules, '@cossackframework'), { recursive: true });
  await Promise.all((await fs.readdir(source)).map(async name => {
    if ((!includeHidden && name.startsWith('.')) || name === '@cossackframework' || exclude.includes(name)) return;
    await fs.symlink(path.join(source, name), path.join(modules, name), 'junction');
  }));
  await Promise.all(packages.map(name =>
    fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction')));
  // Generated apps depend on the CLI package too (vite.config imports cossack/plugin-policy).
  await fs.symlink(path.join(repository, 'packages/cossack'), path.join(modules, 'cossack'), 'junction').catch(error => { if (error.code !== 'EEXIST') throw error; });
  return modules;
}

/**
 * Links `dependency`, installed at `target`, into an app's `modules`. Scopes arrive from
 * `linkRepositoryModules` as links to the repository's own folders, so the scope becomes a real
 * folder first. Written through the link, this would replace the repository's package with a
 * link into the cache, and two workers doing so at once would fail with EEXIST.
 */
export async function linkInstalledPackage(modules, target, dependency) {
  const link = path.join(modules, dependency);
  const scope = path.dirname(link);
  if ((await fs.lstat(scope).catch(() => null))?.isSymbolicLink()) {
    const source = await fs.realpath(scope);
    await fs.unlink(scope);
    await fs.mkdir(scope);
    await Promise.all((await fs.readdir(source)).map(name => fs.symlink(path.join(source, name), path.join(scope, name), 'junction')));
  }
  await fs.mkdir(scope, { recursive: true });
  await fs.rm(link, { force: true, recursive: true });
  await fs.symlink(target, link, 'junction');
}

const CACHE_NAME = 'cossack-linked-app-cache';

/**
 * Fails when a package in the repository's node_modules links into the cache: something wrote
 * through a linked folder, and every run after it uses those links, not the installed packages.
 */
export async function assertRepositoryModulesIntact(modules = path.join(repository, 'node_modules')) {
  const links = [];
  const inspect = async (folder, name) => {
    const target = await fs.readlink(path.join(folder, name)).catch(() => null);
    if (target?.includes(CACHE_NAME)) links.push(path.join(folder, name));
  };
  for (const entry of await fs.readdir(modules, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      const scope = path.join(modules, entry.name);
      await Promise.all((await fs.readdir(scope)).map(name => inspect(scope, name)));
    } else if (entry.isSymbolicLink()) await inspect(modules, entry.name);
  }
  if (links.length) {
    throw new Error(`The repository's node_modules links into the test cache:\n${links.join('\n')}\n`
      + 'Delete these links, then run `pnpm install --frozen-lockfile --config.optimistic-repeat-install=false`.');
  }
}

const cacheRoot = path.join(os.tmpdir(), CACHE_NAME);
const pending = new Map();
let scaffoldFingerprint;

async function fingerprintScaffold() {
  scaffoldFingerprint ??= (async () => {
    const hash = crypto.createHash('sha256');
    // The scaffold, and the CMS application `cossack add cms` renders files from (its theme among them).
    const sources = [path.join(repository, 'packages/scaffold'), path.join(repository, 'packages/cms/app')];
    const visit = async (root, directory) => {
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (['node_modules', 'tests', 'dist', 'storage', '.cossack', '.env'].includes(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(root, file);
        else { const stat = await fs.stat(file); hash.update(`${path.relative(repository, file)}:${stat.size}:${stat.mtimeMs}\n`); }
      }
    };
    for (const source of sources) await visit(source, source);
    hash.update((await fs.readdir(path.join(repository, 'node_modules'))).sort().join('\n'));
    return hash.digest('hex');
  })();
  return scaffoldFingerprint;
}

async function buildBase(key, entry, { name, adapter, features, options, packages, includeHidden, install }) {
  await fs.mkdir(cacheRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(cacheRoot, `.${key.slice(0, 12)}-`));
  try {
    const { createApp } = await import('@cossackframework/scaffold');
    const { projectDir } = await createApp(name, { cwd: staging, adapter, preset: 'minimal', features, interactive: false, ...options });
    if (path.relative(staging, projectDir) !== name) throw new Error(`Unexpected scaffold directory: ${projectDir}`);
    await linkRepositoryModules(projectDir, { packages, includeHidden });
    if (install.length) {
      // Dependencies that are not in the repository install once per cache entry.
      const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
      const installed = path.join(entry, 'installed');
      const stagingInstalled = path.join(staging, 'installed');
      await fs.mkdir(stagingInstalled);
      await fs.writeFile(path.join(stagingInstalled, 'package.json'), JSON.stringify({ private: true,
        dependencies: Object.fromEntries(install.map(dependency => [dependency, pkg.dependencies?.[dependency] ?? pkg.devDependencies?.[dependency] ?? 'latest'])) }));
      await promisify(execFile)('pnpm', ['install', '--ignore-workspace', '--ignore-scripts'], { cwd: stagingInstalled, timeout: 60000, maxBuffer: 1024 * 1024 });
      for (const dependency of install) {
        // Points at the final cache location; valid once `staging` is renamed.
        await linkInstalledPackage(path.join(projectDir, 'node_modules'), path.join(installed, 'node_modules', dependency), dependency);
      }
    }
    try { await fs.rename(staging, entry); }
    catch (error) {
      // A concurrent worker published the same entry first.
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      await fs.rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function cachedBase(settings) {
  const key = crypto.createHash('sha256').update(JSON.stringify({
    version: 2, fingerprint: await fingerprintScaffold(), name: settings.name, adapter: settings.adapter,
    features: settings.features, options: settings.options, packages: settings.packages,
    includeHidden: settings.includeHidden, install: settings.install,
  })).digest('hex');
  const entry = path.join(cacheRoot, key);
  if (!pending.has(key)) pending.set(key, (async () => {
    try { await fs.access(path.join(entry, settings.name, 'package.json')); const now = new Date(); await fs.utimes(entry, now, now); }
    catch { await buildBase(key, entry, settings); await pruneCache(entry); }
    await assertRepositoryModulesIntact();
    return path.join(entry, settings.name);
  })().catch(error => { pending.delete(key); throw error; }));
  return pending.get(key);
}

// Entries for older scaffold sources are dropped once unused for two days.
async function pruneCache(keep) {
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const name of await fs.readdir(cacheRoot).catch(() => [])) {
    const entry = path.join(cacheRoot, name);
    if (entry === keep) continue;
    const stat = await fs.stat(entry).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(entry, { recursive: true, force: true }).catch(() => {});
  }
}

// Like fs.cp(..., { recursive: true, verbatimSymlinks: true }), but copies entries
// concurrently; a linked app holds hundreds of node_modules symlinks.
async function copyTree(source, target) {
  await fs.mkdir(target);
  await Promise.all((await fs.readdir(source, { withFileTypes: true })).map(async entry => {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) await fs.symlink(await fs.readlink(from), to, 'junction');
    else if (entry.isDirectory()) await copyTree(from, to);
    else await fs.copyFile(from, to);
  }));
}

/**
 * Scaffolds a minimal-preset application at `<parent>/<name>` whose dependencies resolve from this repository.
 * @param {string} parent Existing directory that receives the application.
 * @param {{ adapter: string, features?: string[], options?: Record<string, unknown>, name?: string,
 *   packages?: readonly string[], includeHidden?: boolean, install?: string[], cache?: boolean, scaffold?: Function }} settings
 *   `options`: extra createApp options (for example `dashboardModules`).
 *   `packages`/`includeHidden`: see linkRepositoryModules.
 *   `install`: app dependencies absent from the repository, installed with pnpm once per cache entry.
 *   `cache: false` (implied by a custom `scaffold` createApp) scaffolds and links in place.
 * @returns {Promise<string>} The application directory.
 */
export async function scaffoldLinkedApp(parent, { adapter, features = [], options = {}, name = 'app', packages = workspacePackages,
  includeHidden = false, install = [], cache = true, scaffold } = {}) {
  if (!cache || scaffold) {
    if (install.length) throw new Error('`install` requires the cache');
    const createApp = scaffold ?? (await import('@cossackframework/scaffold')).createApp;
    const { projectDir } = await createApp(name, { cwd: parent, adapter, preset: 'minimal', features, interactive: false, ...options });
    await linkRepositoryModules(projectDir, { packages, includeHidden });
    return projectDir;
  }
  const base = await cachedBase({ name, adapter, features, options, packages: [...packages], includeHidden, install });
  const root = path.join(parent, name);
  await copyTree(base, root);
  return root;
}

/**
 * Like scaffoldLinkedApp, in a new os.tmpdir() directory named with `prefix`.
 * The caller owns (and removes) the returned `parent` directory.
 * @param {Parameters<typeof scaffoldLinkedApp>[1] & { prefix?: string }} settings
 * @returns {Promise<{ parent: string, root: string }>}
 */
export async function createLinkedApp({ prefix = 'cossack-linked-app-', ...settings } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try { return { parent, root: await scaffoldLinkedApp(parent, settings) }; }
  catch (error) {
    await fs.rm(parent, { recursive: true, force: true });
    throw error;
  }
}
