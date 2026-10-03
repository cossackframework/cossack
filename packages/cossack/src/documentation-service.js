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
export async function readDocumentation(root, { package: selected, symbols = false } = {}) {
  if (selected !== undefined && !COSSACK_PACKAGES.includes(selected)) {
    throw Object.assign(new Error('Select a supported Cossack package.'), { code: 'COSSACK_DOCS_PACKAGE_UNKNOWN' });
  }
  if (symbols && !selected) throw Object.assign(new Error('Select one package when requesting symbols.'), { code: 'COSSACK_DOCS_PACKAGE_REQUIRED' });
  const packages = [], diagnostics = [], installedFolders = new Map();
  for (const name of selected ? [selected] : COSSACK_PACKAGES) {
    let installed;
    try { installed = await readInstalledPackage(root, name); }
    catch (error) {
      diagnostics.push({ code: error.code, severity: 'error', message: 'Installed package metadata could not be read.', package: name });
      continue;
    }
    if (!installed) { packages.push({ name, installed: false }); continue; }
    const { folder, manifest, source } = installed;
    installedFolders.set(name, folder);
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
  if (symbols) {
    const { indexDeclarations } = await import('./declaration-index.js');
    for (const pkg of packages.filter(pkg => pkg.installed)) {
      const folder = installedFolders.get(pkg.name);
      const entries = [...pkg.exports];
      if (typeof pkg.legacyEntries?.types === 'string') {
        const target = pkg.legacyEntries.types.startsWith('./') ? pkg.legacyEntries.types : './' + pkg.legacyEntries.types;
        entries.push(await describeExport(folder, '.', { types: target }));
      }
      pkg.declarations = await indexDeclarations(folder, entries);
      if (pkg.declarations.status !== 'indexed') diagnostics.push({
        code: 'COSSACK_DOCS_DECLARATIONS_INCOMPLETE', severity: 'warning', package: pkg.name,
        message: 'Some installed declarations are unavailable, unresolved or have compiler diagnostics. Runtime imports remain unverified.',
      });
    }
  }
  const guide = await fs.readFile(new URL('./agent-guide.md', import.meta.url), 'utf8');
  return { ok: !diagnostics.some(diagnostic => diagnostic.severity === 'error'), diagnostics, data: {
    schemaVersion: 1, cliVersion: readPackageVersion(), packages,
    commands: commandCatalog(), guide: { version: readPackageVersion(), markdown: guide },
    coverage: { exportTargets: 'installed-manifests', symbols: symbols ? 'installed-declarations' : 'not-requested', runtimeSupport: 'not-verified', examples: 'not-included' },
  } };
}
