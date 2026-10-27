// Render the shared application shell into this folder.
//
// This application is the `node` + `cms` recipe. The files the cms feature owns are
// tracked here (see cossack-recipe.json); every other file of the recipe comes from
// packages/scaffold/template and is written by this script, so each file has one source.
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
/** Tracked here; the recipe reads them from this folder. Adapter-specific cms files (src/cms/media.ts, pending.ts) are rendered. */
const tracked = rel => !manifest.rendered.includes(rel) && [...manifest.files, ...manifest.replaces].some(entry => entry.endsWith('/') ? rel.startsWith(entry) : rel === entry);

const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] });
const rendered = await renderRecipe(recipe, { projectName: 'cms-app' });

const previous = JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '{"files":[]}'));
const written = [];
let changed = 0;
for (const [rel, entry] of rendered) {
  if (tracked(rel) || SKIPPED.has(rel)) continue;
  const target = path.join(root, rel);
  if (rel === '.env') {
    // Created once, then owned by the developer: it holds the local RomeDB token and setup code.
    if (await exists(target)) continue;
    const local = entry.content.toString('utf8')
      .replace(/^ROMEDB_URL=.*$/m, 'ROMEDB_URL=http://127.0.0.1:4322')
      .replace(/^ROMEDB_TOKEN=.*$/m, 'ROMEDB_TOKEN=written-by-pnpm-romedb');
    await write(target, local);
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
