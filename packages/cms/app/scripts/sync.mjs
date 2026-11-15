// Render the shared application shell into this folder.
//
// This application is the `node` + `cms` recipe, with one difference: a project mounts the
// CMS from the package (package.json#cossack.packages), and this folder is that package's
// served source, so it holds the files themselves and mounts nothing. cossack-recipe.json
// lists them in two groups. `served` is tracked here. `shell` (the sign-in pages, the
// dashboard and its kit) comes from packages/dashboard/app/src (its tracked home) and is written by this script,
// like every project file of the recipe, so each file has one source. The package ships both
// groups: `pnpm pack` runs this script first (prepack).
// Local state is kept: `.env` is created once, `storage/` and plugins other than
// default-theme are never touched. Files rendered by an earlier run that the recipe no
// longer produces are removed (`.cossack/sync.json` lists them).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRecipe, resolveRecipe, writeManifest } from '@cossackframework/scaffold';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const statePath = path.join(root, '.cossack/sync.json');
const WORKSPACE_PACKAGES = /^(?:@cossackframework\/(?!solar-icons)[^/]+|cossack)$/;
/** Recipe files this folder provides itself or does not want. */
const SKIPPED = new Set(['package.json', 'pnpm-workspace.yaml', '.gitignore', 'README.md', 'AGENTS.md']);

const manifest = JSON.parse(await fs.readFile(path.join(root, 'cossack-recipe.json'), 'utf8'));
/** Tracked here, never rendered: the package's own served sources. */
const tracked = rel => !manifest.rendered.includes(rel) && manifest.served.some(entry => entry.endsWith('/') ? rel.startsWith(entry) : rel === entry);

const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] });
// This folder is where the package serves the shell from, so the render keeps it.
const rendered = await renderRecipe(recipe, { projectName: 'Cossack', servedFiles: true });
// This application runs on Node and holds the served files as source, the Workers entry
// module among them, which needs Workers types. A Workers project checks it through its own
// src/index.ts, which exports it.
// It mounts no package either, so its Vite configuration names the CMS's part itself.
const vite = rendered.get('vite.config.ts');
rendered.set('vite.config.ts', { ...vite, content: Buffer.from(vite.content.toString('utf8')
  .replace("import { cossackApp } from 'cossack/vite';", "import { cossackApp } from 'cossack/vite';\nimport { cossackVite } from '@cossackframework/cms/vite';")
  .replace('export default cossackApp({\n', 'export default cossackApp({\n  parts: [cossackVite],\n')) });
const tsconfig = rendered.get('tsconfig.json');
rendered.set('tsconfig.json', { ...tsconfig, content: Buffer.from(JSON.stringify({ ...JSON.parse(tsconfig.content.toString('utf8')), exclude: ['src/cms/worker.ts'] }, null, 2) + '\n') });

const previous = JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '{"files":[]}'));
const written = [];
let changed = 0;
for (const [rel, entry] of rendered) {
  if (tracked(rel) || SKIPPED.has(rel)) continue;
  const target = path.join(root, rel);
  if (rel === '.env') {
    // Created once, then owned by the developer: it holds the database address and setup code.
    if (await exists(target)) continue;
    await write(target, entry.content);
    changed++;
    continue;
  }
  written.push(rel);
  const current = await fs.readFile(target).catch(() => null);
  if (current && Buffer.compare(current, entry.content) === 0) continue;
  await write(target, entry.content);
  changed++;
}

let removed = 0;
for (const rel of previous.files ?? []) {
  if (written.includes(rel)) continue;
  await fs.rm(path.join(root, rel), { force: true });
  removed++;
}

await syncPackageJson(rendered.get('package.json').content.toString('utf8'));
// `cossack` commands (routes, plugin add) read the scaffold manifest of the project.
await writeManifest(root, recipe, rendered);
await fs.mkdir(path.dirname(statePath), { recursive: true });
await fs.writeFile(statePath, JSON.stringify({ files: written.sort() }, null, 2) + '\n');
console.log(`[cms-app] shell synced from the scaffold: ${changed} file(s) written, ${removed} removed, ${written.length} rendered.`);

/** Dependencies follow the recipe; workspace packages link to the workspace. */
async function syncPackageJson(renderedSource) {
  const file = path.join(root, 'package.json');
  const current = JSON.parse(await fs.readFile(file, 'utf8'));
  const generated = JSON.parse(renderedSource);
  const workspace = deps => Object.fromEntries(Object.entries(deps ?? {}).map(([name, version]) => [name, WORKSPACE_PACKAGES.test(name) ? 'workspace:*' : version]));
  const next = {
    ...current,
    dependencies: workspace(generated.dependencies),
    devDependencies: { ...workspace(generated.devDependencies), '@cossackframework/scaffold': 'workspace:*' },
  };
  const source = JSON.stringify(next, null, 2) + '\n';
  if (source !== await fs.readFile(file, 'utf8')) {
    await fs.writeFile(file, source);
    console.log('[cms-app] package.json dependencies updated from the recipe; run `pnpm install` and commit it.');
  }
}

async function write(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}
