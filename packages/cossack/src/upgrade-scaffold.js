import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as installed from '@cossackframework/scaffold';
import { execPackageManager } from './package-manager.js';

const require = createRequire(import.meta.url);
const NAME = '@cossackframework/scaffold';
const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

export async function resolveRegistryVersion(name, tag) {
  try {
    const { stdout } = await execPackageManager('pnpm', ['view', `${name}@${tag}`, 'version', '--json'],
      { timeout: 30_000, maxBuffer: 256 * 1024 });
    const parsed = JSON.parse(stdout);
    const version = Array.isArray(parsed) ? parsed.at(-1) : parsed;
    return typeof version === 'string' && VERSION.test(version) ? version : null;
  } catch { return null; }
}

/** Load exactly the requested release, without modifying the application. */
export async function loadUpgradeScaffold(tag) {
  if (typeof tag !== 'string' || !tag.trim()) throw Object.assign(new Error('The manifest must record a scaffold template version before dependency ownership can be reconstructed.'),
    { code: 'COSSACK_UPGRADE_BASELINE_MISSING' });
  const version = VERSION.test(tag) ? tag : await resolveRegistryVersion(NAME, tag);
  if (!version) throw Object.assign(new Error('Could not resolve the requested scaffold release. Check the registry and --tag.'),
    { code: 'COSSACK_UPGRADE_VERSION_UNRESOLVED' });
  const local = JSON.parse(await fs.readFile(require.resolve(`${NAME}/package.json`), 'utf8'));
  if (version === local.version) return { version, api: installed, close: async () => {} };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-upgrade-scaffold-'));
  const close = () => fs.rm(directory, { recursive: true, force: true });
  try {
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    await execPackageManager('pnpm', ['add', '--ignore-scripts', '--ignore-workspace', '--lockfile=false', '--save-exact', `${NAME}@${version}`],
      { cwd: directory, timeout: 120_000, maxBuffer: 1024 * 1024 });
    const fromTemporary = createRequire(path.join(directory, 'package.json'));
    const packagePath = fromTemporary.resolve(`${NAME}/package.json`);
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    if (pkg.name !== NAME || pkg.version !== version) throw new Error('Scaffold identity mismatch');
    // createRequire.resolve(NAME) uses the require condition, while scaffold
    // intentionally publishes an import-only entry.
    const exported = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'];
    const entry = typeof exported === 'string' ? exported : exported?.import ?? exported?.default ?? pkg.main;
    if (typeof entry !== 'string') throw new Error('Scaffold import entry unavailable');
    const api = await import(pathToFileURL(path.resolve(path.dirname(packagePath), entry)).href);
    if (!['renderRecipe', 'resolveRecipe', 'migratePnpmBuildSettings'].every(key => typeof api[key] === 'function')) {
      throw new Error('Scaffold API unavailable');
    }
    return { version, api, close };
  } catch (cause) {
    await close();
    throw Object.assign(new Error('Cannot load the requested scaffold release. Check package availability and compatibility; no project changes were applied.', { cause }),
      { code: 'COSSACK_UPGRADE_TEMPLATE_UNAVAILABLE' });
  }
}
