import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readInstalledPackage, COSSACK_PACKAGES } from './installed-packages.js';
import { commandSpecs } from './command-specs.js';
import { readPackageVersion } from './pkg.js';

function targets(value, conditions = []) {
  if (typeof value === 'string' || value === null) return [{ conditions, target: value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => targets(entry, [...conditions, `fallback:${index}`]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => targets(entry, [...conditions, key]));
  return [];
}
async function describeExport(folder, subpath, value) {
  const entries = await Promise.all(targets(value).map(async entry => {
    if (entry.target === null) return { ...entry, status: 'blocked' };
    if (!entry.target.startsWith('./') || entry.target.split(/[\\/]/).includes('..')) return { conditions: entry.conditions, target: null, status: 'invalid' };
    if (subpath.includes('*') || entry.target.includes('*')) return { ...entry, status: 'pattern-not-expanded' };
    try { return { ...entry, status: (await fs.stat(path.join(folder, entry.target))).isFile() ? 'present' : 'missing' }; }
    catch { return { ...entry, status: 'missing' }; }
  }));
  return { subpath, targets: entries, runtime: 'not-verified' };
}
function commandCatalog() {
  // Command metadata is package-owned. No application configuration is loaded.
  return Object.values(commandSpecs).map(spec => ({
    name: spec.name, aliases: spec.aliases, positionals: spec.positionals,
    minPositionals: spec.minPositionals, forwardsArgs: spec.forwardsArgs,
    options: spec.definitions([]), subcommands: spec.subcommands ?? {},
  }));
}

/** Fresh offline facts from the bound project's installed manifests, not workspace sources. */
export async function readDocumentation(root, { package: selected } = {}) {
  if (selected !== undefined && !COSSACK_PACKAGES.includes(selected)) {
    throw Object.assign(new Error('Select a supported Cossack package.'), { code: 'COSSACK_DOCS_PACKAGE_UNKNOWN' });
  }
  const packages = [], diagnostics = [];
  for (const name of selected ? [selected] : COSSACK_PACKAGES) {
    let installed;
    try { installed = await readInstalledPackage(root, name); }
    catch (error) {
      diagnostics.push({ code: error.code, severity: 'error', message: 'Installed package metadata could not be read.', package: name });
      continue;
    }
    if (!installed) { packages.push({ name, installed: false }); continue; }
    const { folder, manifest, source } = installed;
    const exports = manifest.exports;
    const map = exports && typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith('.'))
      ? exports : exports === undefined ? {} : { '.': exports };
    packages.push({ name, version: manifest.version, installed: true,
      manifestHash: createHash('sha256').update(source).digest('hex'),
      exports: await Promise.all(Object.entries(map).map(async ([subpath, value]) => ({
        import: subpath === '.' ? name : name + subpath.slice(1), ...await describeExport(folder, subpath, value),
      }))),
      legacyEntries: exports === undefined ? { main: manifest.main ?? null, types: manifest.types ?? null } : null,
    });
  }
  const guide = await fs.readFile(new URL('./agent-guide.md', import.meta.url), 'utf8');
  return { ok: diagnostics.length === 0, diagnostics, data: {
    schemaVersion: 1, cliVersion: readPackageVersion(), packages,
    commands: commandCatalog(), guide: { version: readPackageVersion(), markdown: guide },
    coverage: { exportTargets: 'installed-manifests', symbols: 'not-indexed', runtimeSupport: 'not-verified', examples: 'not-included' },
  } };
}
