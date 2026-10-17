import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-api';
import { createRequire } from 'node:module';
import { readPackageGuidance } from '../src/package-guidance.js';
import { discoverExports } from '../src/export-discovery.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = ['fastdb', 'cms'];
const hono = createRequire(path.join(root, 'packages/framework/package.json')).resolve('hono');

it('FastDB and CMS guide examples typecheck strictly against declared public entries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cms-guides-'));
  try {
    const paths = { hono: [path.join(hono, '../../types/index.d.ts')], 'hono/*': [path.join(hono, '../../types/*')] };
    const files = [];
    // Core entries resolve to their built declarations, like an installed package.
    const core = JSON.parse(await fs.readFile(path.join(root, 'packages/core/package.json'), 'utf8'));
    for (const [subpath, target] of Object.entries(core.exports)) if (target?.types) paths['@cossackframework/core' + subpath.slice(1)] = [path.join(root, 'packages/core', target.types)];
    for (const pkg of packages) {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'packages', pkg, 'package.json'), 'utf8'));
      for (const [subpath, target] of Object.entries(manifest.exports)) if (subpath !== './package.json') paths[manifest.name + subpath.slice(1)] = [path.join(root, 'packages', pkg, target)];
      const metadata = JSON.parse(await fs.readFile(path.join(root, 'packages', pkg, 'agent-docs.json'), 'utf8'));
      for (const guide of metadata.guides) {
        expect(guide.markdown.length, guide.id).toBeGreaterThan(300);
        for (const example of guide.examples) { const file = path.join(directory, `${example.id}.ts`); await fs.writeFile(file, example.source); files.push(file); }
      }
    }
    const program = ts.createProgram(files, { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')], paths });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => !diagnostic.file?.fileName.includes('/packages/auth/src/'));
    expect(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n' })).toBe('');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}, 60000);

it('FastDB and CMS catalogs validate through production guidance discovery', async () => {
  for (const pkg of packages) {
    const directory = path.join(root, 'packages', pkg);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const discovered = await discoverExports(directory, manifest.name, manifest.exports);
    const guidance = await readPackageGuidance(directory, manifest.name, manifest.version, discovered.entries);
    expect(guidance.status, pkg).toBe('available');
    expect(guidance.omitted, pkg).toEqual([]);
  }
});
