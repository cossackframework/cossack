import { readPackageGuidance } from './package-guidance.js';
import { discoverExports, describeExport } from './export-discovery.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readInstalledPackage, COSSACK_PACKAGES } from './installed-packages.js';
import { commandSpecs } from './command-specs.js';
import { readPackageVersion } from './pkg.js';

function commandCatalog() {
  // Command metadata is package-owned. No application configuration is loaded.
  return Object.values(commandSpecs).map(spec => ({
    name: spec.name, aliases: spec.aliases, positionals: spec.positionals,
    minPositionals: spec.minPositionals, forwardsArgs: spec.forwardsArgs,
    options: spec.definitions([]), subcommands: spec.subcommands ?? {},
  }));
}

/** Fresh offline facts from the bound project's installed manifests, not workspace sources. */
export async function readDocumentation(root, { package: selected, symbols = false, symbol } = {}) {
  if (selected !== undefined && !COSSACK_PACKAGES.includes(selected)) {
    throw Object.assign(new Error('Select a supported Cossack package.'), { code: 'COSSACK_DOCS_PACKAGE_UNKNOWN' });
  }
  if (symbols && !selected) throw Object.assign(new Error('Select one package when requesting symbols.'), { code: 'COSSACK_DOCS_PACKAGE_REQUIRED' });
  if (symbol !== undefined && (!symbols || typeof symbol !== 'string' || !symbol.trim() || symbol.length > 256)) {
    throw Object.assign(new Error('symbol requires symbols and a nonempty name of at most 256 characters.'), { code: 'COSSACK_DOCS_SYMBOL_INVALID' });
  }
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
    const discovered = await discoverExports(folder, name, map);
    if (discovered.discovery.status === 'partial') diagnostics.push({ code: 'COSSACK_DOCS_EXPORTS_INCOMPLETE', severity: 'warning', package: name,
      message: 'Some export patterns cannot be enumerated completely. See exportDiscovery reasons.' });
    const guidance = await readPackageGuidance(folder, name, manifest.version, discovered.entries);
    if (['invalid', 'partial'].includes(guidance.status)) diagnostics.push({
      code: 'COSSACK_DOCS_GUIDANCE_INCOMPLETE', severity: 'warning', package: name,
      message: 'Installed usage guidance is invalid or references unavailable imports.',
    });
    packages.push({ guidance, name, version: manifest.version, installed: true,
      manifestHash: createHash('sha256').update(source).digest('hex'),
      exports: discovered.entries, exportDiscovery: discovered.discovery,
      legacyEntries: exports === undefined ? { main: manifest.main ?? null, types: manifest.types ?? null } : null,
    });
  }
  if (symbols) {
    const { indexDeclarations } = await import('./declaration-index.js');
    for (const pkg of packages.filter(pkg => pkg.installed)) {
      const folder = installedFolders.get(pkg.name);
      const entries = [...pkg.exports];
      if (pkg.legacyEntries) {
        const legacy = pkg.legacyEntries.types ?? pkg.legacyEntries.main ?? 'index.js';
        if (typeof legacy === 'string') {
          const target = legacy.startsWith('./') ? legacy : './' + legacy;
          entries.push({ import: pkg.name, ...await describeExport(folder, '.', { [pkg.legacyEntries.types ? 'types' : 'default']: target }) });
        }
      }
      pkg.declarations = await indexDeclarations(folder, entries, { symbol });
      if (symbol !== undefined) {
        const matched = pkg.declarations.entries.some(entry => entry.symbols.some(item => item.name === symbol));
        pkg.declarations.selection = { name: symbol, matched };
        if (!matched) diagnostics.push({ code: 'COSSACK_DOCS_SYMBOL_NOT_FOUND', severity: 'warning', package: pkg.name,
          message: 'The requested public declaration was not found. See availableSymbols in declaration entries.' });
      }
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
    coverage: { exportTargets: 'installed-manifests', symbols: symbols ? 'installed-declarations' : 'not-requested', runtimeSupport: 'not-verified', examples: 'package-owned-when-available', guidance: 'installed-package-files' },
  } };
}
