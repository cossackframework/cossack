/**
 * Plugin recipes: render a plugin package into `src/plugins/<name>/` as application source.
 *
 * A plugin package carries `cossack-plugin.json` (named by `package.json#cossack.plugin`)
 * and a source tree. Packages are read as data, never executed: npm installs use
 * `--ignore-scripts`, tarballs are unpacked in memory, and nothing is imported.
 * Rendered files are tracked by hash in `.cossack/plugins.json`, so upgrades keep
 * local edits and report a conflict when a locally edited file also changed upstream.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

export const PLUGIN_PACKAGE_FIELD = 'cossack';
export const PLUGIN_MANIFEST_DEFAULT = 'cossack-plugin.json';
export const PLUGINS_DIRECTORY = 'src/plugins';
export const PLUGINS_STATE = '.cossack/plugins.json';
export const PLUGIN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Names owned by Cossack recipes. */
export const RESERVED_PLUGIN_NAMES = new Set(['cms', 'cossack', 'core', 'framework', 'app']);

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 16_777_216;
const MAX_MANIFEST_BYTES = 262_144;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const hash = content => createHash('sha256').update(content).digest('hex');

export class PluginError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    Object.assign(this, details);
  }
}

/** Structural checks shared by every plugin. Hosts such as the CMS validate their own fields. */
export function validatePluginManifest(manifest, packageJson) {
  const problems = [];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return ['The plugin manifest must be a JSON object.'];
  if (manifest.schemaVersion !== 1) problems.push('schemaVersion must be 1.');
  if (typeof manifest.name !== 'string' || !PLUGIN_NAME.test(manifest.name) || manifest.name.length > 64) problems.push('name must be 1-64 lowercase letters, digits and single hyphens.');
  else if (RESERVED_PLUGIN_NAMES.has(manifest.name)) problems.push(`name "${manifest.name}" is reserved.`);
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) problems.push('version must be a semantic version.');
  if (packageJson && packageJson.version !== manifest.version) problems.push(`version ${manifest.version} must match the package version ${packageJson.version}.`);
  if (manifest.source !== undefined && (typeof manifest.source !== 'string' || !safeRelative(manifest.source))) problems.push('source must be a relative directory inside the package.');
  if (manifest.description !== undefined && (typeof manifest.description !== 'string' || manifest.description.length > 500)) problems.push('description must be at most 500 characters.');
  if (manifest.compatibility !== undefined) {
    if (!plain(manifest.compatibility)) problems.push('compatibility must map package names to version ranges.');
    else for (const [name, range] of Object.entries(manifest.compatibility)) if (typeof range !== 'string' || !parseRange(range)) problems.push(`compatibility.${name} is not a supported version range.`);
  }
  if (manifest.dependencies !== undefined) {
    if (!plain(manifest.dependencies)) problems.push('dependencies must map package names to version ranges.');
    else for (const [name, range] of Object.entries(manifest.dependencies)) {
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || !parseRange(range)) {
        problems.push(`dependencies.${name} must be a package name with a version range.`);
      }
    }
  }
  return problems;
}

/** Read a plugin from a package directory as data. */
export async function readPluginDirectory(directory) {
  const root = await fs.realpath(directory);
  const packageJson = await readJsonFile(path.join(root, 'package.json'), MAX_MANIFEST_BYTES, 'package.json');
  const manifestPath = packageJson?.[PLUGIN_PACKAGE_FIELD]?.plugin ?? PLUGIN_MANIFEST_DEFAULT;
  if (typeof manifestPath !== 'string' || !safeRelative(manifestPath)) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', 'package.json#cossack.plugin must name a manifest file inside the package.');
  const manifest = await readJsonFile(path.join(root, manifestPath), MAX_MANIFEST_BYTES, manifestPath);
  const sourceRoot = manifest?.source ?? 'plugin';
  checkManifest(manifest, packageJson);
  const files = new Map();
  let total = 0;
  const base = path.join(root, sourceRoot);
  const walk = async (directoryPath, prefix) => {
    let entries;
    try { entries = await fs.readdir(directoryPath, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT' && prefix === '') throw new PluginError('COSSACK_PLUGIN_SOURCE_MISSING', `The plugin has no ${sourceRoot}/ source directory.`);
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', `Plugin source cannot contain symbolic links: ${rel}.`);
      if (entry.isDirectory()) { await walk(path.join(directoryPath, entry.name), rel + '/'); continue; }
      if (!entry.isFile()) throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', `Plugin source contains a special file: ${rel}.`);
      const content = await fs.readFile(path.join(directoryPath, entry.name));
      total += content.length;
      addSourceFile(files, rel, content, total);
    }
  };
  await walk(base, '');
  return finishPackage(packageJson, manifest, files);
}

/** Read a plugin from an npm tarball (`npm pack` output) in memory. */
export async function readPluginTarball(file) {
  const archive = await fs.readFile(file);
  if (archive.length > MAX_TOTAL_BYTES) throw new PluginError('COSSACK_PLUGIN_SOURCE_LIMIT', 'The plugin tarball exceeds 16 MiB.');
  let tar;
  try { tar = gunzipSync(archive, { maxOutputLength: MAX_TOTAL_BYTES * 2 }); }
  catch { throw new PluginError('COSSACK_PLUGIN_TARBALL_INVALID', 'The plugin tarball is not a gzip archive.'); }
  const entries = readTar(tar);
  const strip = name => name.replace(/^[^/]+\//, '');
  const byName = new Map(entries.map(entry => [strip(entry.name), entry.content]));
  const packageJson = parseJson(byName.get('package.json'), 'package.json');
  const manifestPath = packageJson?.[PLUGIN_PACKAGE_FIELD]?.plugin ?? PLUGIN_MANIFEST_DEFAULT;
  if (typeof manifestPath !== 'string' || !safeRelative(manifestPath)) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', 'package.json#cossack.plugin must name a manifest file inside the package.');
  const manifest = parseJson(byName.get(manifestPath), manifestPath);
  checkManifest(manifest, packageJson);
  const prefix = (manifest.source ?? 'plugin').replace(/\/$/, '') + '/';
  const files = new Map();
  let total = 0;
  for (const [name, content] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.startsWith(prefix)) continue;
    total += content.length;
    addSourceFile(files, name.slice(prefix.length), content, total);
  }
  if (!files.size) throw new PluginError('COSSACK_PLUGIN_SOURCE_MISSING', `The plugin has no ${prefix} source directory.`);
  return finishPackage(packageJson, manifest, files);
}

/** Files to write under `src/plugins/<name>/`, including the rendered `plugin.json`. */
export function renderPlugin(plugin) {
  const rendered = new Map();
  const capability = `plugin:${plugin.manifest.name}`;
  const directory = `${PLUGINS_DIRECTORY}/${plugin.manifest.name}`;
  for (const [rel, content] of plugin.files) {
    if (rel === 'plugin.json') throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', 'Plugin source cannot provide plugin.json; it is rendered from the manifest.');
    rendered.set(`${directory}/${rel}`, { content, capability });
  }
  const { source: _source, ...manifest } = plugin.manifest;
  rendered.set(`${directory}/plugin.json`, { content: Buffer.from(JSON.stringify({ ...manifest, package: plugin.packageName }, null, 2) + '\n'), capability });
  return rendered;
}

export async function readPluginState(projectDir) {
  const file = path.join(projectDir, PLUGINS_STATE);
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state?.schemaVersion !== 1 || !plain(state.plugins)) throw new PluginError('COSSACK_PLUGIN_STATE_INVALID', `${PLUGINS_STATE} is not a plugin state file.`);
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, plugins: {} };
    if (error instanceof PluginError) throw error;
    throw new PluginError('COSSACK_PLUGIN_STATE_INVALID', `${PLUGINS_STATE} could not be read: ${error.message}`);
  }
}

/**
 * Plan writes and deletes for one plugin against its recorded hashes:
 * unchanged local files follow upstream; a locally edited file that upstream also
 * changed is a conflict; a locally edited file that upstream did not change is kept.
 */
export async function planPlugin(projectDir, rendered, previousFiles = {}, force = false) {
  const writes = [], deletes = [], conflicts = [], preserved = [];
  for (const [rel, entry] of rendered) {
    await assertSafeTarget(projectDir, rel);
    const existing = await currentHash(path.join(projectDir, rel));
    const next = hash(entry.content);
    const baseline = previousFiles[rel]?.hash;
    if (existing === next) continue;
    const modified = baseline !== undefined && existing !== baseline;
    const upstreamChanged = baseline !== undefined && next !== baseline;
    if (modified && !upstreamChanged && !force) {
      preserved.push({ path: rel, capability: entry.capability, reason: existing === null ? 'locally-deleted' : 'locally-modified' });
      continue;
    }
    if (((existing !== null && baseline === undefined) || (modified && upstreamChanged)) && !force) { conflicts.push(rel); continue; }
    writes.push({ path: rel, capability: entry.capability, overwrite: existing !== null });
  }
  for (const [rel, entry] of Object.entries(previousFiles)) {
    if (rendered.has(rel)) continue;
    await assertSafeTarget(projectDir, rel);
    const existing = await currentHash(path.join(projectDir, rel));
    if (existing === null) continue;
    if (existing !== entry.hash && !force) { conflicts.push(rel); continue; }
    deletes.push({ path: rel, capability: entry.capability });
  }
  return { writes, deletes, conflicts, preserved };
}

/**
 * Render a plugin into the project.
 * `source`: a package directory, an npm tarball (`.tgz`), or an npm package spec.
 * Options: `force`, `dryRun`, `install(spec, projectDir)` for npm specs.
 */
export async function addPlugin(projectDir, source, options = {}) {
  const root = path.resolve(projectDir);
  const resolved = await resolvePluginSource(root, source, options);
  const plugin = resolved.plugin;
  const name = plugin.manifest.name;
  const state = await readPluginState(root);
  const previous = state.plugins[name];
  if (previous && previous.package !== plugin.packageName) {
    throw new PluginError('COSSACK_PLUGIN_NAME_TAKEN', `Plugin "${name}" is already rendered from ${previous.package}.`);
  }
  if (!previous) {
    const occupied = await exists(path.join(root, PLUGINS_DIRECTORY, name));
    if (occupied && !options.force) throw new PluginError('COSSACK_PLUGIN_CONFLICT', `${PLUGINS_DIRECTORY}/${name}/ already exists and is not a rendered plugin. Move it or re-run with --force.`, { conflicts: [`${PLUGINS_DIRECTORY}/${name}/`] });
  }
  return applyPluginRender(root, state, plugin, resolved.record, previous, options, previous ? 'upgraded' : 'added');
}

/** Re-render an installed plugin from its recorded source, or from `options.source`. */
export async function upgradePlugin(projectDir, name, options = {}) {
  const root = path.resolve(projectDir);
  const state = await readPluginState(root);
  const previous = state.plugins[name];
  if (!previous) throw new PluginError('COSSACK_PLUGIN_UNKNOWN', `No rendered plugin named "${name}".`);
  const spec = options.source ?? previous.source.spec;
  const resolved = await resolvePluginSource(root, spec, { ...options, install: options.source ? options.install : (options.install ?? false) });
  if (resolved.plugin.manifest.name !== name) throw new PluginError('COSSACK_PLUGIN_NAME_TAKEN', `The new source renders "${resolved.plugin.manifest.name}", not "${name}".`);
  return applyPluginRender(root, state, resolved.plugin, resolved.record, previous, options, 'upgraded');
}

/** Delete a rendered plugin's unmodified files. Locally edited files are conflicts unless forced. */
export async function removePlugin(projectDir, name, options = {}) {
  const root = path.resolve(projectDir);
  const state = await readPluginState(root);
  const previous = state.plugins[name];
  if (!previous) throw new PluginError('COSSACK_PLUGIN_UNKNOWN', `No rendered plugin named "${name}".`);
  const plan = await planPlugin(root, new Map(), previous.files, options.force);
  if (plan.conflicts.length) throw conflictError(plan);
  if (options.dryRun) return { status: 'dry-run', name, changes: plan };
  const next = structuredClone(state);
  delete next.plugins[name];
  await applyAtomically(root, new Map(), plan, next);
  await removeEmptyDirectories(path.join(root, PLUGINS_DIRECTORY, name));
  return { status: 'removed', name, changes: plan };
}

/**
 * Rendered plugins plus installed packages that declare `package.json#cossack.plugin`.
 * Reads manifests only; never imports package code.
 */
export async function listPlugins(projectDir) {
  const root = path.resolve(projectDir);
  const state = await readPluginState(root);
  const rendered = Object.entries(state.plugins).map(([name, entry]) => ({ name, package: entry.package, version: entry.version, source: entry.source }));
  const installed = [];
  const modules = path.join(root, 'node_modules');
  const candidates = [];
  for (const entry of await fs.readdir(modules, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of await fs.readdir(path.join(modules, entry.name), { withFileTypes: true }).catch(() => [])) candidates.push(`${entry.name}/${scoped.name}`);
    } else candidates.push(entry.name);
  }
  for (const name of candidates.sort()) {
    const packageJson = await readJsonFile(path.join(modules, name, 'package.json'), MAX_MANIFEST_BYTES, 'package.json').catch(() => null);
    const field = packageJson?.[PLUGIN_PACKAGE_FIELD]?.plugin;
    if (typeof field !== 'string') continue;
    let plugin = null;
    let problems = [];
    try {
      const manifest = await readJsonFile(path.join(modules, name, field), MAX_MANIFEST_BYTES, field);
      problems = validatePluginManifest(manifest, packageJson);
      plugin = manifest?.name;
    } catch (error) { problems = [error.message]; }
    installed.push({ package: name, version: packageJson.version, plugin, rendered: rendered.some(entry => entry.package === name), problems });
  }
  return { rendered, installed };
}

/** Minimal semantic version range check: `*`, `x`, exact, `^`, `~`, comparators, spaces (and) and `||` (or). */
export function satisfies(version, range) {
  const parsed = parseRange(range);
  const v = parseVersion(version);
  if (!parsed || !v) return false;
  return parsed.some(set => set.every(([operator, target]) => {
    const order = compareVersions(v, target);
    return operator === '>=' ? order >= 0 : operator === '>' ? order > 0 : operator === '<' ? order < 0 : operator === '<=' ? order <= 0 : order === 0;
  }));
}

async function applyPluginRender(root, state, plugin, record, previous, options, status) {
  const name = plugin.manifest.name;
  const compatibility = options.versions ? incompatible(plugin.manifest.compatibility, options.versions) : [];
  if (compatibility.length) {
    throw new PluginError('COSSACK_PLUGIN_INCOMPATIBLE', `Plugin "${name}" requires ${compatibility.join(', ')}.`, { requirements: compatibility });
  }
  const rendered = renderPlugin(plugin);
  const plan = await planPlugin(root, rendered, previous?.files ?? {}, options.force);
  if (plan.conflicts.length) throw conflictError(plan);
  const dependencies = await packageDependencyChanges(root, plugin.manifest.dependencies ?? {});
  const unchanged = !plan.writes.length && !plan.deletes.length && !dependencies.length && previous?.version === plugin.manifest.version;
  const result = { status: unchanged ? 'present' : status, name, package: plugin.packageName, version: plugin.manifest.version, from: previous?.version ?? null, changes: plan, dependencies };
  if (unchanged || options.dryRun) return unchanged ? result : { ...result, status: 'dry-run' };
  const next = structuredClone(state);
  next.plugins[name] = { package: plugin.packageName, version: plugin.manifest.version, source: record, files: {} };
  await applyAtomically(root, rendered, plan, next, previous?.files ?? {}, dependencies);
  return result;
}

async function applyAtomically(root, rendered, plan, nextState, previousFiles = {}, dependencies = []) {
  const affected = new Set([...plan.writes.map(change => change.path), ...plan.deletes.map(change => change.path), PLUGINS_STATE, ...(dependencies.length ? ['package.json'] : [])]);
  const snapshots = new Map();
  for (const rel of affected) snapshots.set(rel, await fs.readFile(path.join(root, rel)).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));
  try {
    for (const change of plan.deletes) await fs.rm(path.join(root, change.path), { force: true });
    for (const change of plan.writes) {
      const absolute = path.join(root, change.path);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, rendered.get(change.path).content);
    }
    if (dependencies.length) {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      pkg.dependencies ??= {};
      for (const change of dependencies) pkg.dependencies[change.name] = change.to;
      await writeAtomic(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    }
    // Record what the plugin owns now. A preserved local edit keeps its upstream baseline,
    // so a later upstream change to that file is reported as a conflict.
    const preserved = new Set(plan.preserved.map(change => change.path));
    for (const plugin of Object.values(nextState.plugins)) {
      if (plugin.files && Object.keys(plugin.files).length) continue;
      plugin.files = {};
      for (const [rel, entry] of rendered) {
        const baseline = previousFiles[rel]?.hash;
        plugin.files[rel] = { capability: entry.capability, hash: preserved.has(rel) && baseline ? baseline : hash(entry.content) };
      }
    }
    await fs.mkdir(path.join(root, '.cossack'), { recursive: true });
    await writeAtomic(path.join(root, PLUGINS_STATE), JSON.stringify(sortState(nextState), null, 2) + '\n');
  } catch (error) {
    for (const [rel, content] of snapshots) {
      const absolute = path.join(root, rel);
      if (content === null) await fs.rm(absolute, { force: true }).catch(() => {});
      else { await fs.mkdir(path.dirname(absolute), { recursive: true }).catch(() => {}); await fs.writeFile(absolute, content).catch(() => {}); }
    }
    throw error;
  }
}

async function resolvePluginSource(root, source, options) {
  if (typeof source !== 'string' || !source) throw new PluginError('COSSACK_PLUGIN_SOURCE_INVALID', 'Name a plugin package directory, tarball or npm package.');
  const local = source.startsWith('.') || source.startsWith('/') || source.startsWith('file:');
  const target = local ? path.resolve(root, source.replace(/^file:/, '')) : undefined;
  if (target && /\.(?:tgz|tar\.gz)$/.test(target)) {
    return { plugin: await readPluginTarball(target), record: { type: 'tarball', spec: portable(root, target) } };
  }
  if (target) {
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isDirectory()) throw new PluginError('COSSACK_PLUGIN_SOURCE_INVALID', `${source} is not a plugin package directory or tarball.`);
    return { plugin: await readPluginDirectory(target), record: { type: 'directory', spec: portable(root, target) } };
  }
  const packageName = source.replace(/^(@[^/]+\/[^@]+|[^@]+)@.*$/, '$1');
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) throw new PluginError('COSSACK_PLUGIN_SOURCE_INVALID', `${source} is not an npm package name.`);
  if (options.install !== false) await (options.install ?? installPackage)(source, root);
  const directory = path.join(root, 'node_modules', packageName);
  if (!(await exists(path.join(directory, 'package.json')))) throw new PluginError('COSSACK_PLUGIN_NOT_INSTALLED', `${packageName} is not installed. Install it as a dev dependency, then re-run.`);
  const plugin = await readPluginDirectory(directory);
  if (plugin.packageName !== packageName) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `node_modules/${packageName} declares the name ${plugin.packageName}.`);
  return { plugin, record: { type: 'npm', spec: packageName } };
}

/** Install without lifecycle scripts, so the package never runs during installation. */
function installPackage(spec, cwd) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(command, ['add', '--save-dev', '--ignore-scripts', spec], { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', error => reject(new PluginError('COSSACK_PLUGIN_INSTALL_FAILED', `pnpm could not start: ${error.message}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new PluginError('COSSACK_PLUGIN_INSTALL_FAILED', `pnpm add ${spec} failed with exit code ${code}.`)));
  });
}

function checkManifest(manifest, packageJson) {
  if (!plain(packageJson) || typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', 'The plugin package needs a package.json with a name and version.');
  }
  const problems = validatePluginManifest(manifest, packageJson);
  if (problems.length) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `Invalid plugin manifest: ${problems.join(' ')}`, { problems });
}

function finishPackage(packageJson, manifest, files) {
  return Object.freeze({ packageName: packageJson.name, packageVersion: packageJson.version, manifest: Object.freeze(manifest), files });
}

function addSourceFile(files, rel, content, total) {
  if (!safeRelative(rel)) throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', `Unsafe plugin source path: ${rel}.`);
  if (files.size >= MAX_FILES) throw new PluginError('COSSACK_PLUGIN_SOURCE_LIMIT', `Plugin source exceeds ${MAX_FILES} files.`);
  if (content.length > MAX_FILE_BYTES) throw new PluginError('COSSACK_PLUGIN_SOURCE_LIMIT', `${rel} exceeds 1 MiB.`);
  if (total > MAX_TOTAL_BYTES) throw new PluginError('COSSACK_PLUGIN_SOURCE_LIMIT', 'Plugin source exceeds 16 MiB.');
  files.set(rel, content);
}

function readTar(buffer) {
  const entries = [];
  let offset = 0;
  let longName;
  let paxPath;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > buffer.length) throw new PluginError('COSSACK_PLUGIN_TARBALL_INVALID', 'The plugin tarball is truncated.');
    const content = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = content.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x') { paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(content.toString('utf8'))?.[1]; continue; }
    if (type === 'g') continue;
    const prefix = field(345, 155);
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = paxPath = undefined;
    if (type === '5') continue;
    if (type !== '0') throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', `Plugin tarball entry ${name} is not a regular file.`);
    entries.push({ name, content: Buffer.from(content) });
  }
  return entries;
}

async function packageDependencyChanges(root, dependencies) {
  if (!Object.keys(dependencies).length) return [];
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8').catch(() => '{}'));
  const present = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  return Object.entries(dependencies).filter(([name]) => present[name] === undefined).map(([name, range]) => ({ name, from: null, to: range }));
}

function incompatible(requirements = {}, versions) {
  return Object.entries(requirements).filter(([name, range]) => versions[name] !== undefined && !satisfies(versions[name], range)).map(([name, range]) => `${name} ${range} (found ${versions[name]})`);
}

function conflictError(plan) {
  return new PluginError('COSSACK_PLUGIN_CONFLICT', `Plugin conflicts: ${plan.conflicts.join(', ')}. Resolve them, or re-run with --force to overwrite.`, { conflicts: plan.conflicts, changes: plan });
}

function parseVersion(value) {
  const match = SEMVER.exec(String(value).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function parseRange(range) {
  if (typeof range !== 'string' || range.length > 200) return null;
  const sets = [];
  for (const part of range.split('||')) {
    const comparators = [];
    for (const token of part.trim().split(/\s+/).filter(Boolean)) {
      if (token === '*' || token === 'x' || token === 'X') continue;
      const match = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(-[0-9A-Za-z.-]+)?$/.exec(token);
      if (!match) return null;
      const [, operator = '', major, minor, patch] = match;
      const wild = value => value === undefined || value === 'x' || value === '*';
      const base = [Number(major), wild(minor) ? 0 : Number(minor), wild(patch) ? 0 : Number(patch)];
      if (operator === '^') {
        const upper = base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 || !wild(minor) && wild(patch) ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
        comparators.push(['>=', base], ['<', upper]);
      } else if (operator === '~' || (!operator && (wild(minor) || wild(patch)))) {
        const upper = wild(minor) ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
        comparators.push(['>=', base], ['<', upper]);
      } else comparators.push([operator || '=', base]);
    }
    sets.push(comparators);
  }
  return sets;
}

function sortState(state) {
  return { schemaVersion: 1, plugins: Object.fromEntries(Object.entries(state.plugins).sort(([a], [b]) => a.localeCompare(b)).map(([name, plugin]) => [name, {
    ...plugin, files: Object.fromEntries(Object.entries(plugin.files).sort(([a], [b]) => a.localeCompare(b))),
  }])) };
}

async function readJsonFile(file, limit, label) {
  const handle = await fs.open(file, 'r').catch(error => { throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `${label} is missing (${error.code}).`); });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `${label} must be a JSON file of at most ${limit} bytes.`);
    return parseJson(await handle.readFile(), label);
  } finally { await handle.close(); }
}

function parseJson(content, label) {
  if (!content) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `${label} is missing.`);
  if (content.length > MAX_MANIFEST_BYTES) throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `${label} exceeds ${MAX_MANIFEST_BYTES} bytes.`);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { throw new PluginError('COSSACK_PLUGIN_MANIFEST_INVALID', `${label} is not valid JSON.`); }
}

async function assertSafeTarget(root, rel) {
  if (!rel.startsWith(`${PLUGINS_DIRECTORY}/`) || !safeRelative(rel)) throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', `Plugins render only under ${PLUGINS_DIRECTORY}/: ${rel}.`);
  let current = root;
  for (const segment of rel.split('/')) {
    current = path.join(current, segment);
    const entry = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!entry) return;
    if (entry.isSymbolicLink()) throw new PluginError('COSSACK_PLUGIN_SOURCE_UNSAFE', `Plugins cannot write through a symbolic link: ${rel}.`);
  }
}

async function removeEmptyDirectories(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const entry of entries) if (entry.isDirectory()) await removeEmptyDirectories(path.join(directory, entry.name));
  await fs.rmdir(directory).catch(() => {});
}

async function currentHash(file) {
  try { return hash(await fs.readFile(file)); } catch { return null; }
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function writeAtomic(file, content) {
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try { await fs.writeFile(temporary, content); await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

function portable(root, target) {
  const relative = path.relative(root, target).split(path.sep).join('/');
  return relative.startsWith('..') || path.isAbsolute(relative) ? target : `./${relative}`;
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 400 && !path.isAbsolute(value) && !/^(?:[a-z]:|\\)/i.test(value) &&
    !value.includes('\0') && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.' || part === '');
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
