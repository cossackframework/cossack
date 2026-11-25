import { commandSpecs } from '../command-specs.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MANIFEST_SCHEMA_VERSION,
  dependencyBaseline,
  planDependencyChanges,
  readManifest,
  recipeRecord,
  dropFileRecords,
  resolveRecipe,
} from '@cossackframework/scaffold';
import { hostFilesSince, hostStepsSince, mountedPackages, projectTemplate, versionBelow } from '@cossackframework/framework/package-mounts';
import { readPluginState, upgradePlugin } from '@cossackframework/scaffold/plugins';
import { loadUpgradeScaffold, resolveRegistryVersion } from '../upgrade-scaffold.js';
import { mergeEjected } from '../eject.js';

import {
  findProjectRoot,
  readJsonIfExists,
  hashFile,
} from '../fs-utils.js';
import { flagString } from '../flags.js';
import { detectProjectPackageManager, execPackageManager } from '../package-manager.js';


const COSSACK_PKG_PATTERN = /^(@cossackframework\/.+|cossack)$/;

import { runWithSpec, createCommandOutput } from '../command-spec.js';

const spec = commandSpecs.upgrade;
// Schema 3 and 4 manifests held file records; only their recipe is read now.
const supportedManifest = manifest => manifest.schemaVersion === 3 || manifest.schemaVersion === MANIFEST_SCHEMA_VERSION;
const safeRelative = value => typeof value === 'string' && value.length > 0 &&
  !path.isAbsolute(value) && !/^(?:[a-z]:|\\)/i.test(value) && !value.includes('\0') && !value.includes('\\') &&
  !value.split(/[\\/]/).some(part => part === '..' || part === '.');
const publicVersion = value => typeof value === 'string' && /^(?:workspace:)?(?:[*xX]|[~^<>=\s]*\d[\dA-Za-z.*+~^<>=| -]*)$/.test(value)
  ? value : value == null ? value : '[custom specifier]';
const publicChange = change => ({ ...change,
  ...(Object.hasOwn(change, 'from') ? { from: publicVersion(change.from) } : {}),
  ...(Object.hasOwn(change, 'to') ? { to: publicVersion(change.to) } : {}),
});

async function assertOwnedPath(root, relative) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    let entry;
    try { entry = await fs.lstat(current); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (entry.isSymbolicLink()) throw Object.assign(new Error(`Upgrade cannot replace ownership through a symbolic link: ${relative}.`),
      { code: 'COSSACK_UPGRADE_PATH_UNSAFE' });
  }
}

export async function upgradeCommand(args, ctx) {
  ctx.out ??= createCommandOutput(ctx);
  return runWithSpec(spec, args, ctx, async () => {
    try { return await upgradeCommandInner(args, ctx); }
    catch (error) {
      if (ctx.flags.json !== true && error.cause) {
        ctx.out.warn(error.cause.stderr || error.cause.stdout || error.cause.message);
      }
      throw error;
    }
  }, upgradeHelp);
}

/**
 * A project's files are its own: the packages it mounts serve what a release changes. The
 * upgrade sets the dependencies the recipe owns to the release's versions, installs, writes
 * a host module a package needs and the project lacks, lists the changes a package asks of
 * the project's files, and merges the copies `cossack eject` made and the npm plugins.
 */
async function upgradeCommandInner(args, ctx) {
  const tag = flagString(ctx.flags.tag) || 'latest';
  const root = await findProjectRoot(args[0] || ctx.cwd);
  for (const relative of ['package.json', 'pnpm-workspace.yaml', '.cossack/scaffold.json']) await assertOwnedPath(root, relative);
  const projectPkg = await readJsonIfExists(path.join(root, 'package.json'));
  if (!projectPkg) throw Object.assign(new Error('No package.json found. Is this a Cossack project?'),
    { code: 'COSSACK_PROJECT_MISSING' });
  const stored = await fs.readFile(path.join(root, '.cossack/scaffold.json'), 'utf8')
    .then(source => {
      const value = JSON.parse(source);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid manifest');
      return value;
    }).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw Object.assign(new Error('Cannot read .cossack/scaffold.json. Restore valid JSON before upgrading.'),
        { code: 'COSSACK_UPGRADE_MANIFEST_INVALID' });
    });
  if (stored && !supportedManifest(stored)) throw unsupportedManifestError(stored);
  // Releases before the served CMS copied the CMS application into the project. Those copies are
  // not migrated (specs/upgrade-merges.md): the project is created again on the served CMS.
  if (stored?.files && Object.hasOwn(stored.files, 'src/cms/index.ts')) throw Object.assign(new Error(
    'This project holds a copied CMS (src/cms/, src/pages/dashboard/(cms)/, ...), which this release no longer updates. ' +
    'Create a new project with cossack create --features cms, then copy your plugins (src/plugins/<name>), content and seed scripts into it. ' +
    'See docs/upgrading.md.'), { code: 'COSSACK_UPGRADE_CMS_COPIED' });
  // The recipe: in package.json#cossack, or still in a manifest from before it moved there.
  const found = await readManifest(root);
  const record = found?.recordsFiles === false ? found : null;
  const expected = new Map();
  for (const relative of ['package.json', 'pnpm-workspace.yaml', '.cossack/scaffold.json']) expected.set(relative, await hashFile(path.join(root, relative)));
  const target = await loadUpgradeScaffold(tag);
  let original;
  try {
    const projectName = projectPkg.name || path.basename(root);
    let rendered = null;
    let merged = null;
    if (record) {
      // The dependencies were last set by the release the project declares: what that release
      // renders for the recipe is what the recipe owns, and everything else is the project's.
      const declared = declaredRelease(projectPkg) ?? record.templateVersion;
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(declared ?? '')) throw Object.assign(
        new Error('The project must declare an exact Cossack release (its @cossackframework/framework dependency, or cossack.template) before its dependencies can be planned.'),
        { code: 'COSSACK_UPGRADE_BASELINE_MISSING' });
      original = declared === target.version ? target : await loadUpgradeScaffold(declared);
      // The declared release reads the recipe itself: this release's reading fills in its own
      // defaults (a CMS project's database became romedb in 0.9.3), which an older release refuses.
      const baseline = original === target ? record : await ownReading(original.api, root) ?? record;
      const prior = await renderRelease(original, baseline, projectName);
      rendered = await renderRelease(target, record, projectName);
      for (const rel of rendered.keys()) if (!safeRelative(rel)) throw Object.assign(new Error('Target scaffold contains an invalid relative path.'),
        { code: 'COSSACK_UPGRADE_TEMPLATE_INVALID' });
      merged = planDependencyChanges(projectPkg, JSON.parse(rendered.get('package.json').content.toString()),
        dependencyBaseline(JSON.parse(prior.get('package.json').content.toString())));
    }
    const resolved = merged ?? await resolveVersions(collectCossackDeps(projectPkg), tag);
    const unresolved = resolved.updates.filter(update => !update.to);
    const markers = flagString(ctx.flags.conflicts) === 'markers';
    // Ejected copies are merged after the install; this is the merge against the package installed now.
    const ejectedPreview = await mergeEjected(root, { markers, dryRun: true });
    const unresolvedConflicts = ejectedPreview.filter(entry => entry.status === 'unresolved').map(entry => entry.path);
    if (unresolvedConflicts.length) return {
      exitCode: 1, data: ctx.out.data({ status: 'unresolved-conflicts', files: unresolvedConflicts }),
      diagnostics: unresolvedConflicts.map(relative => ({ code: 'COSSACK_UPGRADE_UNRESOLVED_CONFLICT', severity: 'error', path: relative,
        message: `${relative} still has conflict markers from an earlier upgrade. Resolve them and remove the marker lines, then run upgrade again.` })),
    };
    const migration = record
      ? await target.api.migratePnpmBuildSettings(root, recipeFromManifest(record, target.api.resolveRecipe), { dryRun: true })
      : { changed: false, packageChanged: false, workspaceChanged: false };
    // The release's keys of pnpm-workspace.yaml (build approvals, overrides) go over the project's
    // file; its own stay. The build-settings migration writes the file itself when it runs.
    let workspace = null;
    if (record && !migration.workspaceChanged && rendered.has('pnpm-workspace.yaml') && typeof target.api.upgradedPnpmWorkspace === 'function') {
      const next = Buffer.from(await target.api.upgradedPnpmWorkspace(root, rendered.get('pnpm-workspace.yaml').content));
      const current = await fs.readFile(path.join(root, 'pnpm-workspace.yaml')).catch(() => null);
      if (!current || !current.equals(next)) workspace = next;
    }
    const dependencies = {
      updates: resolved.updates.map(update => publicChange({ ...update, changed: !!update.to && update.from !== update.to })),
      additions: (resolved.additions ?? []).map(publicChange), removals: (resolved.removals ?? []).map(publicChange),
      preserved: resolved.preserved ?? [], conflicts: resolved.conflicts ?? [], ownershipSource: record ? 'recipe' : 'unmanaged',
    };
    const packageManager = await detectPackageManager(root);
    const dependencyChanges = dependencies.updates.some(update => update.changed) ||
      dependencies.additions.length > 0 || dependencies.removals.length > 0;
    // A recipe still in a manifest moves to package.json, and the manifest's file records go.
    const recordMoves = !!record && (!Array.isArray(projectPkg.cossack?.features) || (!!stored && (stored.files !== undefined || stored.explicitFeatures !== undefined)));
    const nextActions = [
      ...(dependencies.conflicts.length ? ['Review preserved dependency edits in package.json before changing their versions.'] : []),
      ...ejectedPreview.filter(entry => entry.status === 'conflict').map(entry => `Resolve ${entry.path}: cossack eject --diff ${entry.path} shows both sides.`),
    ];
    const plan = {
      root, tag, templateVersion: target.version, adapter: record?.runtime ?? null,
      hasRecipe: !!record, dependencies, pnpmBuildSettings: migration,
      // The project's own files are never compared or changed. `writes` is pnpm-workspace.yaml at most.
      files: { writes: workspace ? [{ path: 'pnpm-workspace.yaml', merged: true }] : [] },
      // Copies made by cossack eject: `status` is what merging the installed package's version does to each.
      ejected: ejectedPreview.map(({ text: _text, ...entry }) => entry),
      recipe: { moves: recordMoves, path: 'package.json' },
      install: { packageManager, required: dependencyChanges }, nextActions,
    };
    ctx.out.line(`Upgrading ${projectPkg.name || 'project'} at ${root}`);
    ctx.out.line(`Tag: ${tag}${ctx.dryRun ? '  (dry-run)' : ''}\n`);
    ctx.out.line(record
      ? 'Project files: yours. The packages this project mounts serve what a release changes;\n  the upgrade changes dependencies only.\n'
      : 'No recipe in package.json#cossack: only the Cossack packages are planned.\n');
    ctx.out.line('Dependencies:');
    for (const item of dependencies.updates.filter(item => item.changed)) ctx.out.line(`  update ${item.name}: ${item.from} -> ${item.to}`);
    for (const item of dependencies.additions) ctx.out.line(`  add ${item.name}: ${item.to} (${item.section})`);
    for (const item of dependencies.removals) ctx.out.line(`  remove ${item.name}: ${item.from} (${item.section})`);
    for (const item of dependencies.conflicts) ctx.out.line(`  preserve ${item.name}: ${item.reason}`);
    if (!dependencyChanges) ctx.out.line('  No generated dependency changes.');
    if (unresolved.length) return {
      exitCode: 1, data: ctx.out.data({ status: 'planning-failed', plan }),
      diagnostics: unresolved.map(update => ({ code: 'COSSACK_UPGRADE_VERSION_UNRESOLVED', severity: 'error',
        message: `Could not resolve ${update.name}@${tag}. Check the registry and retry; no changes were applied.` })),
    };
    if (ctx.dryRun) {
      if (dependencyChanges || migration.packageChanged || recordMoves) ctx.out.file('planned', path.join(root, 'package.json'));
      if (migration.workspaceChanged || workspace) ctx.out.file('planned', path.join(root, 'pnpm-workspace.yaml'));
      if (recordMoves && stored) ctx.out.file('planned-delete', path.join(root, '.cossack/scaffold.json'));
      return ctx.out.data({ status: 'dry-run', plan });
    }

    // Registry resolution can take time. Refuse a stale plan before any effect
    // rather than overwrite edits made while versions were being resolved.
    for (const [relative, baseline] of expected) {
      await assertOwnedPath(root, relative);
      if (await hashFile(path.join(root, relative)) !== baseline) return {
        exitCode: 1, data: ctx.out.data({ status: 'stale-plan', plan }),
        diagnostics: [{ code: 'COSSACK_UPGRADE_PLAN_STALE', severity: 'error',
          message: `File changed during planning: ${relative}. Re-run upgrade; no changes were applied.`, path: relative }],
      };
    }

    const applied = { dependencies: false, pnpmBuildSettings: false, files: [], recipe: false, installed: false, ejected: [], plugins: [], hostSteps: [] };
    try {
      if (dependencyChanges) {
        const next = structuredClone(projectPkg);
        if (merged) Object.assign(next, merged.next);
        else for (const update of dependencies.updates) {
          if (update.changed) next[update.section][update.name] = update.to;
        }
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(next, null, 2) + '\n');
        applied.dependencies = true;
        ctx.out.file('overwritten', path.join(root, 'package.json'));
      }
      if (migration.changed) {
        await target.api.migratePnpmBuildSettings(root, recipeFromManifest(record, target.api.resolveRecipe));
        applied.pnpmBuildSettings = true;
        if (migration.packageChanged && !dependencyChanges) ctx.out.file('overwritten', path.join(root, 'package.json'));
        if (migration.workspaceChanged) ctx.out.file('overwritten', path.join(root, 'pnpm-workspace.yaml'));
      }
      if (workspace) {
        await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), workspace);
        applied.files.push('pnpm-workspace.yaml');
        ctx.out.file('overwritten', path.join(root, 'pnpm-workspace.yaml'));
      }
      if (recordMoves) {
        const current = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
        const recipe = recipeFromManifest(record);
        current.cossack = { ...current.cossack, runtime: recipe.adapter, ...recipeRecord(recipe),
          // The project's files are as old as its last template, not as new as this release.
          template: record.templateVersion ?? recipeRecord(recipe).template };
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(current, null, 2) + '\n');
        await dropFileRecords(root, record);
        applied.recipe = true;
        if (!dependencyChanges) ctx.out.file('overwritten', path.join(root, 'package.json'));
      }
      if (dependencyChanges) {
        ctx.out.line(`Reinstalling with ${packageManager}...`);
        await runInstall(packageManager, root);
        applied.installed = true;
      }
      if (record) {
        // With the target installed: a host module a package needs and the project lacks is written,
        // and the changes a package asks of the project's own files are listed, never made.
        let mounted = [];
        try { mounted = mountedPackages(root); } catch (error) { ctx.out.warn(error.message); }
        const template = projectTemplate(root).version;
        for (const entry of mounted) {
          const behind = versionBelow(template, entry.hostTemplate);
          // The files a newer template adds come first, so a folder the project lacks is written
          // whole before a host module goes into it. A folder the project has is its own.
          const wanted = [];
          if (behind) for (const file of hostFilesSince(entry, template)) {
            if (!file.endsWith('/')) wanted.push(file);
            else if (!await fs.access(path.join(root, file)).then(() => true, () => false)) {
              wanted.push(...[...rendered.keys()].filter(relative => relative.startsWith(file)).sort());
            }
          }
          wanted.push(...entry.host.map(module => `src/${module}`));
          const written = [];
          for (const relative of new Set(wanted)) {
            if (!rendered.has(relative) || await hashFile(path.join(root, relative)) !== null) continue;
            await assertOwnedPath(root, relative);
            await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
            await fs.writeFile(path.join(root, relative), rendered.get(relative).content);
            applied.files.push(relative);
            written.push(relative);
            ctx.out.file('created', path.join(root, relative));
          }
          if (!behind) continue;
          const steps = hostStepsSince(entry, template);
          applied.hostSteps.push({ package: entry.name, version: entry.version, template: entry.hostTemplate, steps, files: written });
          ctx.out.warn(`${entry.name} ${entry.version} needs changes in this project's own files (template ${entry.hostTemplate}; the project is at ${template}):`);
          for (const step of steps) ctx.out.warn(`  - ${step}`);
          if (!steps.length) ctx.out.warn(`  See the release notes of ${entry.name} ${entry.hostTemplate}.`);
          ctx.out.warn(`  Then set cossack.template to "${entry.hostTemplate}" in package.json. The build stops until then.`);
        }
      }
      // With the target installed: merge the package's new text into each ejected copy, and
      // render each plugin that came from an npm package again from its installed version.
      applied.ejected = (await mergeEjected(root, { markers })).map(({ text: _text, ...entry }) => entry);
      for (const entry of applied.ejected) {
        if (['updated', 'merged', 'markers'].includes(entry.status)) ctx.out.file('overwritten', path.join(root, entry.path));
        if (entry.status === 'conflict') ctx.out.warn(`${entry.path} conflicts with ${entry.package} ${entry.to}: kept as it is. Run cossack eject --diff ${entry.path}, then edit it or rerun with --conflicts=markers.`);
        if (entry.status === 'removed-upstream') ctx.out.warn(`${entry.package} no longer serves ${entry.path}. The copy stays; remove it with cossack eject --restore ${entry.path} --force when it is not needed.`);
      }
      const plugins = await readPluginState(root).catch(() => ({ plugins: {} }));
      for (const [name, plugin] of Object.entries(plugins.plugins)) {
        if (plugin.source?.type !== 'npm') { applied.plugins.push({ name, status: 'skipped', reason: 'It was rendered from a local source: run cossack plugins upgrade with the new source.' }); continue; }
        try {
          const result = await upgradePlugin(root, name, { install: false, allowUnrestricted: plugin.unrestricted === true });
          applied.plugins.push({ name, status: result.status, from: result.from, version: result.version });
        } catch (error) {
          applied.plugins.push({ name, status: 'failed', code: error.code ?? null, message: error.message, ...(error.conflicts ? { conflicts: error.conflicts } : {}) });
          ctx.out.warn(`Plugin ${name} was not upgraded: ${error.message}`);
        }
      }
      return ctx.out.data({ status: 'completed', plan, applied });
    } catch (error) {
      const recovery = dependencyChanges && !applied.installed
        ? [`${packageManager} install`, ...nextActions] : nextActions;
      if (ctx.flags.json !== true) ctx.out.warn(error.message);
      return { exitCode: 1, data: ctx.out.data({ status: 'partial-failure', plan, applied, nextActions: recovery }),
        diagnostics: [{ code: error.code ?? 'COSSACK_UPGRADE_APPLY_FAILED', severity: 'error',
          message: error.code === 'COSSACK_UPGRADE_INSTALL_FAILED'
            ? `Dependency installation failed. Changes are recorded in applied; run ${packageManager} install to retry.`
            : 'Upgrade application failed. Review recorded applied changes before retrying.' }] };
    }
  } finally {
    if (original && original !== target) await original.close();
    await target.close();
  }
}

/** The release a project's dependencies declare (`^0.9.0` gives 0.9.0), or undefined for a link or a tag. */
function declaredRelease(pkg) {
  const range = pkg.dependencies?.['@cossackframework/framework'] ?? pkg.dependencies?.cossack ?? pkg.devDependencies?.cossack;
  return /^[~^]?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(range ?? '')?.[1];
}

export function collectCossackDeps(pkg) {
  const out = {};
  for (const section of ['dependencies', 'devDependencies']) {
    const deps = pkg[section] || {};
    for (const name of Object.keys(deps)) {
      if (COSSACK_PKG_PATTERN.test(name)) {
        out[name] = { range: deps[name], section };
      }
    }
  }
  return out;
}

async function resolveVersions(deps, tag) {
  const updates = [];
  const added = [];
  for (const name of Object.keys(deps)) {
    const version = await resolveRegistryVersion(name, tag);
    updates.push({ name, from: deps[name].range, to: version ? `^${version}` : null, section: deps[name].section });
  }
  return { updates, added };
}

export async function detectPackageManager(root) {
  return detectProjectPackageManager(root);
}

async function runInstall(pm, cwd) {
  try {
    await execPackageManager(pm, ['install'], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 });
  } catch (err) {
    throw Object.assign(new Error(`Dependency installation with ${pm} failed.`),
      { code: 'COSSACK_UPGRADE_INSTALL_FAILED' });
  }
}

/** A release's own reading of the project's recipe, or null when it has none to give. */
async function ownReading(api, root) {
  if (typeof api.readManifest !== 'function') return null;
  try {
    const found = await api.readManifest(root);
    return Array.isArray(found?.explicitFeatures ?? found?.resolvedFeatures) ? found : null;
  } catch { return null; }
}

/** What a release renders for the recipe; a refusal names the release. */
async function renderRelease(release, manifest, projectName) {
  try { return await release.api.renderRecipe(recipeFromManifest(manifest, release.api.resolveRecipe), { projectName }); }
  catch (error) {
    throw Object.assign(new Error(`Cossack ${release.version} cannot render this project's recipe: ${error.message}`),
      { code: 'COSSACK_UPGRADE_RECIPE_REFUSED' });
  }
}

function recipeFromManifest(manifest, resolve = resolveRecipe) {
  const adapter = manifest.runtime ?? manifest.adapter;
  return resolve({
    adapter,
    preset: 'minimal',
    features: manifest.explicitFeatures ?? manifest.resolvedFeatures,
    database: manifest.config?.database,
    authMethods: manifest.config?.authMethods,
    oauth: manifest.config?.oauth,
    theme: manifest.config?.theme,
    dashboardModules: manifest.dashboardModules,
  });
}

function unsupportedManifestError(manifest) {
  if (manifest.schemaVersion === 2) {
    return Object.assign(new Error(
      'Scaffold manifest schema 2 uses the removed legacy Kysely database API. ' +
      'Back up the database, convert models and queries to the Active Record ' +
      '@cossackframework/database API, ' +
      'run `cossack schema check`, and baseline migration history before upgrading.',
    ), { code: 'COSSACK_UPGRADE_MANIFEST_UNSUPPORTED' });
  }
  return Object.assign(new Error(
    `Unsupported scaffold manifest schema ${manifest.schemaVersion ?? '(missing)'}. ` +
    'Recreate the project with the current alpha CLI.',
  ), { code: 'COSSACK_UPGRADE_MANIFEST_UNSUPPORTED' });
}

export function upgradeHelp() {
  return commandSpecs.upgrade.help(`cossack upgrade [directory]

Upgrade the project to the release selected by --tag (default: latest).
The dependencies the recipe owns follow the release; local pins, deleted
dependencies and packages you added are preserved and reported. The project's
own files are never compared or changed: the packages it mounts serve what a
release changes. After the install, the upgrade writes a host module a package
needs and the project lacks, lists the changes a package asks of the project's
files (the build then requires them), and merges the copies cossack eject made
and the plugins that came from npm. A copy whose merge conflicts is left as it
is and listed; --conflicts=markers writes both versions into it instead.
Dry runs leave the application unchanged; target templates may be fetched with
pnpm into temporary storage and removed after planning.`);
}
