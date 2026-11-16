// Write this development application's project files from the scaffold.
//
// This folder holds two kinds of file. The served sources (the sign-in pages, the dashboard,
// their modules; the scaffold's SERVED_DASHBOARD_PATHS) are this package's own: they are
// tracked here, edited here and shipped. Around them, this script writes the project files of
// the `node` + `dashboard` recipe (entry files, models, migrations), so the folder runs as an
// application on SQLite. A project mounts the served sources from the package
// (package.json#cossack.packages); this application holds them and mounts nothing.
// Local state is kept: `.env` is created once and the database file is never touched.
// Files written by an earlier run that the recipe no longer renders are removed
// (`.cossack/sync.json` lists them).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isServedDashboardPath, renderRecipe, resolveRecipe } from '@cossackframework/scaffold';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const statePath = path.join(root, '.cossack/sync.json');
const WORKSPACE_PACKAGES = /^(?:@cossackframework\/(?!solar-icons)[^/]+|cossack)$/;
/** Recipe files this folder provides itself or does not want. */
const SKIPPED = new Set(['package.json', 'pnpm-workspace.yaml', '.gitignore', '.gitattributes', 'README.md', 'AGENTS.md']);

const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] });
// The served sources are here already, tracked: the render leaves them out, as for a project.
const rendered = await renderRecipe(recipe, { projectName: 'Cossack' });

const previous = JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '{"files":[]}'));
const written = [];
let changed = 0;
for (const [rel, entry] of rendered) {
  if (SKIPPED.has(rel) || isServedDashboardPath(rel)) continue;
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
  // A served source is never this script's to remove.
  if (written.includes(rel) || isServedDashboardPath(rel)) continue;
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
