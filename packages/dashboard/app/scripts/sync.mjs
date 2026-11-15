// Write this folder from packages/scaffold/template.
//
// This application is the `node` + `dashboard` recipe (sign-in, dashboard, SQLite), with one
// difference: a project mounts the sign-in pages and the dashboard from the package
// (package.json#cossack.packages), and this folder is that package's served source, so it
// holds the files themselves and mounts nothing. cossack-recipe.json lists the served paths;
// the other files are this development application's own project files. The package ships
// the served ones: `pnpm pack` runs this script first (prepack).
// Local state is kept: `.env` is created once and the database file is never touched.
// Files written by an earlier run that the recipe no longer renders are removed
// (`.cossack/sync.json` lists them).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRecipe, resolveRecipe } from '@cossackframework/scaffold';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const statePath = path.join(root, '.cossack/sync.json');
const WORKSPACE_PACKAGES = /^(?:@cossackframework\/(?!solar-icons)[^/]+|cossack)$/;
/** Recipe files this folder provides itself or does not want. */
const SKIPPED = new Set(['package.json', 'pnpm-workspace.yaml', '.gitignore', '.gitattributes', 'README.md', 'AGENTS.md']);

const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] });
// This folder is where the package serves the shell from, so the render keeps it.
const rendered = await renderRecipe(recipe, { projectName: 'Cossack', servedFiles: true });

const previous = JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '{"files":[]}'));
const written = [];
let changed = 0;
for (const [rel, entry] of rendered) {
  if (SKIPPED.has(rel)) continue;
  const target = path.join(root, rel);
  if (rel === '.env') {
    // Created once, then owned by the developer.
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
await fs.mkdir(path.dirname(statePath), { recursive: true });
await fs.writeFile(statePath, JSON.stringify({ files: written.sort() }, null, 2) + '\n');
console.log(`[dashboard-app] synced from the scaffold: ${changed} file(s) written, ${removed} removed, ${written.length} rendered.`);

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
    console.log('[dashboard-app] package.json dependencies updated from the recipe; run `pnpm install` and commit it.');
  }
}

async function write(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}
