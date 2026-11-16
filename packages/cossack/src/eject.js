/**
 * Ejected overrides (specs/upgrade-merges.md). `cossack eject` copies a file that a mounted
 * package serves into the project at its application path, where it overrides the package's.
 * The copy is recorded in `.cossack/scaffold.json` (`ejected`) with the package text it descends
 * from, so `cossack upgrade` can merge the package's later changes into it.
 *
 * Only what the application may override can be ejected: pages, layouts and loading states,
 * configuration files, and plugins as a whole. A shared module (`cms/site.ts`) cannot: the
 * package's own code imports it by relative path and would never use a copy.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mountedPackages, rewriteServedImports, servedKind } from '@cossackframework/framework/package-mounts';
import { discoverRoutes } from '@cossackframework/framework/route-codegen';
import { MANIFEST_SCHEMA_VERSION, diffLines, hasConflictMarkers, mergeText, pruneBases, putBase, readBase, readManifest as scaffoldManifest } from '@cossackframework/scaffold';

const MANIFEST = '.cossack/scaffold.json';
const sha256 = content => createHash('sha256').update(content).digest('hex');
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const posix = file => file.split(path.sep).join('/');
const exists = file => fs.access(file).then(() => true, () => false);

async function readManifest(root) {
  try { return JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8')); }
  catch (error) {
    // A project that records no scaffold files has a manifest only for its ejected copies.
    if (error.code === 'ENOENT' && (await scaffoldManifest(root))?.recordsFiles === false) {
      return { schemaVersion: MANIFEST_SCHEMA_VERSION, tool: '@cossackframework/scaffold', ejected: {} };
    }
    if (error.code === 'ENOENT') throw fail('COSSACK_EJECT_MANIFEST_MISSING', `No ${MANIFEST}: ejected files are recorded there. Create the project with cossack create.`);
    throw fail('COSSACK_EJECT_MANIFEST_INVALID', `${MANIFEST} is not valid JSON.`);
  }
}

async function writeManifest(root, manifest) {
  await fs.mkdir(path.dirname(path.join(root, MANIFEST)), { recursive: true });
  await fs.writeFile(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  await pruneBases(root);
}

function findPackage(root, name) {
  const mounted = mountedPackages(root);
  const found = mounted.find(entry => entry.name === name || entry.alias === name);
  if (!found) throw fail('COSSACK_EJECT_PACKAGE_UNKNOWN', mounted.length
    ? `${name} is not a mounted package. Mounted: ${mounted.map(entry => entry.alias ? `${entry.name} (${entry.alias})` : entry.name).join(', ')}.`
    : 'This project mounts no package (package.json#cossack.packages).');
  return found;
}

async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), `${prefix}${entry.name}/`));
    else files.push(`${prefix}${entry.name}`);
  }
  return files.sort();
}

/**
 * What `path` names in the package: an application path (`src/pages/(site)/search/index.ts`),
 * a route (`/search`), or a served plugin (`plugins/default-theme`).
 * Returns the served paths to copy and the unit copied as a whole.
 */
export async function resolveEjectTarget(root, packageName, target) {
  const mounted = findPackage(root, packageName);
  if (typeof target !== 'string' || !target) throw fail('COSSACK_EJECT_PATH_MISSING', 'Name the file, route or plugin to eject.');
  let served;
  if (target.startsWith('/')) {
    const manifest = discoverRoutes(root, true);
    const route = manifest.routes.find(entry => entry.pattern === target && manifest.packages?.[entry.filePath] === mounted.name);
    if (!route) throw fail('COSSACK_EJECT_NOT_SERVED', `${mounted.name} serves no route ${target}. cossack routes lists the routes and who serves them.`);
    served = route.filePath.slice('/src/'.length);
  } else {
    served = posix(target).replace(/^\.\//, '').replace(/^src\//, '').replace(/\/+$/, '');
  }
  if (served.split('/').some(part => part === '..' || part === '')) throw fail('COSSACK_EJECT_PATH_UNSAFE', `${target} is not a path inside the package.`);
  const kind = servedKind(mounted, served);
  if (kind === 'plugin') {
    const unit = mounted.plugins.find(entry => served === entry.slice(0, -1) || served.startsWith(entry));
    const files = (await walk(path.join(mounted.root, unit))).map(file => unit + file);
    return { mounted, kind, unit, files };
  }
  if (!await exists(path.join(mounted.root, served))) throw fail('COSSACK_EJECT_NOT_SERVED', `${mounted.name} has no file ${served}.`);
  if (!kind) throw fail('COSSACK_EJECT_NOT_OVERRIDABLE',
    `${served} is a shared module of ${mounted.name}: the package's own code imports it by relative path and would never use a copy. ` +
    'Only pages, layouts, configuration files and whole plugins can be ejected. Change behaviour there with a plugin or the project\'s configuration.');
  return { mounted, kind, unit: served, files: [served] };
}

/** The package's text for a served file as a copy holds it: TypeScript with its imports rewritten, anything else as it is. */
async function upstream(mounted, served, unit) {
  const content = await fs.readFile(path.join(mounted.root, served));
  return /\.[cm]?tsx?$/.test(served) ? Buffer.from(rewriteServedImports(content.toString('utf8'), mounted, served, unit)) : content;
}

/** Copy a served file or plugin into the project and record it. */
export async function ejectFiles(root, target, { force = false, dryRun = false } = {}) {
  const manifest = await readManifest(root);
  const written = [];
  const existing = [];
  for (const served of target.files) if (await exists(path.join(root, 'src', served))) existing.push(`src/${served}`);
  if (existing.length && !force) throw fail('COSSACK_EJECT_EXISTS', `${existing.join(', ')} already ${existing.length === 1 ? 'exists' : 'exist'}. Pass --force to replace ${existing.length === 1 ? 'it' : 'them'} with the package's version.`, { files: existing });
  if (dryRun) return { files: target.files.map(served => `src/${served}`), dryRun: true };
  manifest.ejected ??= {};
  for (const served of target.files) {
    const content = await upstream(target.mounted, served, target.unit);
    const file = path.join(root, 'src', served);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    manifest.ejected[`src/${served}`] = {
      package: target.mounted.name, version: target.mounted.version, source: served,
      ...(target.unit !== served ? { unit: target.unit } : {}),
      base: await putBase(root, content),
    };
    written.push(`src/${served}`);
  }
  await writeManifest(root, manifest);
  return { files: written, dryRun: false };
}

/** Records for a project path: the file itself, or every file of an ejected plugin directory. */
function recordsFor(manifest, target) {
  const wanted = posix(target).replace(/^\.\//, '').replace(/\/+$/, '');
  const project = wanted.startsWith('src/') ? wanted : `src/${wanted}`;
  const records = Object.entries(manifest.ejected ?? {}).filter(([file]) => file === project || file.startsWith(`${project}/`));
  if (!records.length) throw fail('COSSACK_EJECT_UNKNOWN', `${project} is not an ejected file. Ejected: ${Object.keys(manifest.ejected ?? {}).join(', ') || 'none'}.`);
  return records;
}

/** Delete an ejected copy and its record, so the package's file is served again. */
export async function restoreEjected(root, target, { force = false, dryRun = false } = {}) {
  const manifest = await readManifest(root);
  const records = recordsFor(manifest, target);
  const edited = [];
  for (const [file, record] of records) {
    const current = await fs.readFile(path.join(root, file)).catch(() => null);
    if (current && sha256(current) !== record.base) edited.push(file);
  }
  if (edited.length && !force) throw fail('COSSACK_EJECT_EDITED', `${edited.join(', ')} ${edited.length === 1 ? 'was' : 'were'} edited. Pass --force to delete ${edited.length === 1 ? 'it' : 'them'} and lose the edits.`, { files: edited });
  if (dryRun) return { files: records.map(([file]) => file), dryRun: true };
  for (const [file] of records) {
    await fs.rm(path.join(root, file), { force: true });
    delete manifest.ejected[file];
    // Directories the copy made are removed when nothing else is in them.
    for (let directory = path.dirname(path.join(root, file)); directory.startsWith(path.join(root, 'src') + path.sep); directory = path.dirname(directory)) {
      if (!await fs.rmdir(directory).then(() => true, () => false)) break;
    }
  }
  if (!Object.keys(manifest.ejected).length) delete manifest.ejected;
  await writeManifest(root, manifest);
  return { files: records.map(([file]) => file), dryRun: false };
}

/** What the package changed since the copy was made, and what the project changed in the copy. */
export async function diffEjected(root, target) {
  const manifest = await readManifest(root);
  const mounted = mountedPackages(root);
  const results = [];
  for (const [file, record] of recordsFor(manifest, target)) {
    const owner = mounted.find(entry => entry.name === record.package);
    const base = await readBase(root, record.base);
    const theirs = owner ? await upstream(owner, record.source, record.unit ?? record.source).catch(() => null) : null;
    const ours = await fs.readFile(path.join(root, file)).catch(() => null);
    results.push({
      file, package: record.package, from: record.version, to: owner?.version ?? null,
      package_changes: base && theirs ? diffLines(base, theirs) : null,
      project_changes: base && ours ? diffLines(base, ours) : null,
      ...(base ? {} : { problem: 'The text this copy was made from is missing from .cossack/base/.' }),
      ...(theirs ? {} : { problem: `${record.package} no longer serves ${record.source}.` }),
    });
  }
  return results;
}

/**
 * Merge the installed package's version of every ejected file into its copy, as `cossack upgrade`
 * does for owned files: an untouched copy takes the package's text, a copy the package did not
 * change stays, and one both changed is merged. A merge that conflicts leaves the copy as it is,
 * or carries markers when `markers` is set. Run after the package manager installed the target.
 */
export async function mergeEjected(root, { markers = false, dryRun = false } = {}) {
  const manifest = await fs.readFile(path.join(root, MANIFEST), 'utf8').then(JSON.parse, () => null);
  const results = [];
  if (!manifest?.ejected || !Object.keys(manifest.ejected).length) return results;
  const mounted = mountedPackages(root);
  let changed = false;
  for (const [file, record] of Object.entries(manifest.ejected)) {
    const owner = mounted.find(entry => entry.name === record.package);
    const theirs = owner ? await upstream(owner, record.source, record.unit ?? record.source).catch(() => null) : null;
    const ours = await fs.readFile(path.join(root, file)).catch(() => null);
    const result = { path: file, package: record.package, from: record.version, to: owner?.version ?? null };
    if (!theirs) { results.push({ ...result, status: 'removed-upstream' }); continue; }
    if (!ours) { results.push({ ...result, status: 'missing' }); continue; }
    if (hasConflictMarkers(ours.toString('utf8'))) { results.push({ ...result, status: 'unresolved' }); continue; }
    const theirHash = sha256(theirs);
    const advance = () => { if (record.base !== theirHash || record.version !== owner.version) { record.version = owner.version; changed = true; } };
    if (sha256(ours) === theirHash) {
      if (!dryRun) { record.base = await putBase(root, theirs); advance(); }
      results.push({ ...result, status: 'upToDate' });
      continue;
    }
    if (theirHash === record.base) { results.push({ ...result, status: 'local' }); continue; }
    if (sha256(ours) === record.base) {
      if (!dryRun) { await fs.writeFile(path.join(root, file), theirs); record.base = await putBase(root, theirs); advance(); changed = true; }
      results.push({ ...result, status: 'updated' });
      continue;
    }
    const base = await readBase(root, record.base);
    if (!base) { results.push({ ...result, status: 'noBase' }); continue; }
    const merge = mergeText(base, ours, theirs, { labels: { theirs: `${record.package} ${owner.version}` } });
    if (merge.status === 'unmergeable') { results.push({ ...result, status: 'modified', reason: merge.reason }); continue; }
    if (merge.status === 'conflict' && !markers) { results.push({ ...result, status: 'conflict', conflicts: merge.conflicts, text: merge.text }); continue; }
    if (!dryRun) { await fs.writeFile(path.join(root, file), merge.text); record.base = await putBase(root, theirs); advance(); changed = true; }
    results.push({ ...result, status: merge.status === 'clean' ? 'merged' : 'markers', ...(merge.conflicts ? { conflicts: merge.conflicts } : {}) });
  }
  if (changed && !dryRun) await writeManifest(root, manifest);
  return results;
}
