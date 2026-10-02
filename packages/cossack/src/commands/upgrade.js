import { commandSpecs } from '../command-specs.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  dependencyBaseline,
  planDependencyChanges,
  resolveRecipe,
} from '@cossackframework/scaffold';
import { loadUpgradeScaffold, resolveRegistryVersion } from '../upgrade-scaffold.js';

import {
  findProjectRoot,
  readJsonIfExists,
  hashFile,
} from '../fs-utils.js';
import { flagString, flagList } from '../flags.js';
import { detectProjectPackageManager } from '../package-manager.js';

const execFileP = promisify(execFile);

const COSSACK_PKG_PATTERN = /^(@cossackframework\/.+|cossack)$/;

// Files that are adapter/version-specific — never auto-updated, only reported.
const EXCLUDE_FROM_SYNC = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'tsconfig.json',
  'tsconfig.declarations.json',
  'wrangler.jsonc',
  'wrangler.toml',
  '.cossack/scaffold.json',
]);

import { runWithSpec, createCommandOutput } from '../command-spec.js';

const spec = commandSpecs.upgrade;
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

async function upgradeCommandInner(args, ctx) {
  const tag = flagString(ctx.flags.tag) || 'latest';
  const forceFiles = [...new Set(flagList(ctx.flags['force-file']).map(p => p.replace(/\\/g, '/')))];
  const root = await findProjectRoot(args[0] || ctx.cwd);
  for (const relative of ['package.json', 'pnpm-workspace.yaml', '.cossack/scaffold.json']) await assertOwnedPath(root, relative);
  const packageBaseline = await hashFile(path.join(root, 'package.json'));
  const workspaceBaseline = await hashFile(path.join(root, 'pnpm-workspace.yaml'));
  const projectPkg = await readJsonIfExists(path.join(root, 'package.json'));
  if (!projectPkg) throw Object.assign(new Error('No package.json found. Is this a Cossack project?'),
    { code: 'COSSACK_PROJECT_MISSING' });
  const manifest = await fs.readFile(path.join(root, '.cossack/scaffold.json'), 'utf8')
    .then(source => {
      const value = JSON.parse(source);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid manifest');
      return value;
    }).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw Object.assign(new Error('Cannot read the scaffold ownership manifest. Restore valid JSON before upgrading.'),
        { code: 'COSSACK_UPGRADE_MANIFEST_INVALID' });
    });
  if (manifest && manifest.schemaVersion !== 3) throw unsupportedManifestError(manifest);
  if (manifest?.dependencyBaseline !== undefined && (!manifest.dependencyBaseline ||
    typeof manifest.dependencyBaseline !== 'object' || Array.isArray(manifest.dependencyBaseline) ||
    Object.values(manifest.dependencyBaseline).some(section => !section || typeof section !== 'object' ||
      Array.isArray(section) || Object.values(section).some(value => typeof value !== 'string')))) {
    throw Object.assign(new Error('Scaffold dependency ownership must contain dependency names and version strings.'),
      { code: 'COSSACK_UPGRADE_MANIFEST_INVALID' });
  }
  for (const relative of forceFiles) if (!safeRelative(relative) || EXCLUDE_FROM_SYNC.has(relative)) {
    throw Object.assign(new Error(`Cannot force ${relative}: this path cannot be replaced by a template.`),
      { code: 'COSSACK_UPGRADE_FILE_UNKNOWN' });
  }
  const expected = new Map([['package.json', packageBaseline], ['pnpm-workspace.yaml', workspaceBaseline],
    ['.cossack/scaffold.json', await hashFile(path.join(root, '.cossack/scaffold.json'))]]);
  for (const relative of Object.keys(manifest?.files ?? {})) {
    if (!safeRelative(relative)) throw Object.assign(new Error('Scaffold ownership contains an invalid relative path.'),
      { code: 'COSSACK_UPGRADE_MANIFEST_INVALID' });
    await assertOwnedPath(root, relative);
    if (!expected.has(relative)) expected.set(relative, await hashFile(path.join(root, relative)));
  }
  const target = await loadUpgradeScaffold(tag);
  let original;
  try {
    let previousDependencies = manifest?.dependencyBaseline;
    const ownershipSource = previousDependencies ? 'recorded' : manifest ? 'reconstructed' : 'unmanaged';
    if (manifest && !previousDependencies) {
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.templateVersion ?? '')) throw Object.assign(
        new Error('The ownership manifest must record an exact template version before dependency ownership can be reconstructed.'),
        { code: 'COSSACK_UPGRADE_BASELINE_MISSING' });
      original = manifest.templateVersion === target.version ? target : await loadUpgradeScaffold(manifest.templateVersion);
      const prior = await original.api.renderRecipe(recipeFromManifest(manifest, original.api.resolveRecipe),
        { projectName: projectPkg.name || path.basename(root) });
      previousDependencies = dependencyBaseline(JSON.parse(prior.get('package.json').content.toString()));
    }

    // Compute every file decision before changing package.json or installing.
    const report = await buildDriftReport(root, projectPkg.name || path.basename(root), manifest, target.api);
    for (const relative of forceFiles) {
      if (!report.rendered?.has(relative) || EXCLUDE_FROM_SYNC.has(relative) ||
          report.rendered.get(relative).capability === 'local-environment' || !safeRelative(relative)) {
        throw Object.assign(new Error(`Cannot force ${relative}: it is not owned by the recorded recipe.`),
          { code: 'COSSACK_UPGRADE_FILE_UNKNOWN' });
      }
    }
    const merged = manifest ? planDependencyChanges(projectPkg,
      JSON.parse(report.rendered.get('package.json').content.toString()), previousDependencies) : null;
    const resolved = merged ?? await resolveVersions(collectCossackDeps(projectPkg), tag);
    const unresolved = resolved.updates.filter(update => !update.to);
    const applyTemplate = ctx.flags['apply-template'] === true || ctx.force || forceFiles.length > 0;
    const selected = new Set(applyTemplate ? report.canUpdate : []);
    const selectedDeletes = applyTemplate ? report.canDelete : [];
    if (ctx.force) for (const relative of report.missing) {
      if (report.rendered?.has(relative)) selected.add(relative);
    }
    for (const relative of forceFiles) selected.add(relative);
    const migration = manifest
      ? await target.api.migratePnpmBuildSettings(root, recipeFromManifest(manifest, target.api.resolveRecipe), { dryRun: true })
      : { changed: false, packageChanged: false, workspaceChanged: false };
    // The build-settings migration merges user approvals. A raw template copy
    // would overwrite that merged result, so it owns this file for this run.
    if (migration.workspaceChanged) selected.delete('pnpm-workspace.yaml');
    const dependencies = {
      updates: resolved.updates.map(update => publicChange({ ...update, changed: !!update.to && update.from !== update.to })),
      additions: (resolved.additions ?? []).map(publicChange), removals: (resolved.removals ?? []).map(publicChange),
      preserved: resolved.preserved ?? [], conflicts: resolved.conflicts ?? [], ownershipSource,
    };
    const packageManager = await detectPackageManager(root);
    const dependencyChanges = dependencies.updates.some(update => update.changed) ||
      dependencies.additions.length > 0 || dependencies.removals.length > 0;
    const manifestChanges = !!manifest && (selected.size > 0 || selectedDeletes.length > 0 || dependencyChanges || migration.changed ||
      manifest.templateVersion !== target.version || JSON.stringify(manifest.dependencyBaseline) !== JSON.stringify(merged.baseline));
    const nextActions = [
      ...((report.canUpdate.length || report.canDelete.length) && !applyTemplate ? [`cossack upgrade --tag=${target.version} --apply-template`] : []),
      ...(report.modified.some(relative => !selected.has(relative))
        ? ['Review preserved files; use --force-file <path> for each intentional overwrite.'] : []),
      ...(dependencies.conflicts.length ? ['Review preserved dependency edits in package.json before changing their versions.'] : []),
    ];
    const plan = {
      root, tag, templateVersion: target.version, adapter: report.adapter ?? null,
      hasManifest: report.hasManifest, dependencies, pnpmBuildSettings: migration,
      files: {
        writes: [...selected].map(relative => ({ path: relative, forced: forceFiles.includes(relative) || report.missing.includes(relative) })),
        deletes: selectedDeletes,
        preserved: report.modified.filter(relative => !selected.has(relative)),
        conflicts: report.modified.map(relative => ({ path: relative, resolution: selected.has(relative) ? 'force' : 'preserve' })),
        missing: report.missing, excluded: report.excluded, upToDate: report.upToDate,
        available: report.canUpdate,
        availableDeletions: report.canDelete,
      },
      manifest: { changed: manifestChanges, path: '.cossack/scaffold.json' },
      install: { packageManager, required: dependencyChanges }, nextActions,
    };
    ctx.out.line(`Upgrading ${projectPkg.name || 'project'} at ${root}`);
    ctx.out.line(`Tag: ${tag}${ctx.dryRun ? '  (dry-run)' : ''}\n`);
    printReport(report, ctx.out);
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
      if (dependencyChanges || migration.packageChanged) ctx.out.file('planned', path.join(root, 'package.json'));
      if (migration.workspaceChanged) ctx.out.file('planned', path.join(root, 'pnpm-workspace.yaml'));
      for (const relative of selected) ctx.out.file('planned', path.join(root, relative));
      for (const relative of selectedDeletes) ctx.out.file('planned-delete', path.join(root, relative));
      if (manifestChanges) ctx.out.file('planned', path.join(root, '.cossack/scaffold.json'));
      return ctx.out.data({ status: 'dry-run', plan });
    }

    // Registry resolution can take time. Refuse a stale plan before any effect
    // rather than overwrite edits made while versions were being resolved.
    for (const relative of selected) if (!expected.has(relative)) expected.set(relative, report.currentHashes.get(relative));
    for (const [relative, baseline] of expected) {
      await assertOwnedPath(root, relative);
      if (await hashFile(path.join(root, relative)) !== baseline) return {
        exitCode: 1, data: ctx.out.data({ status: 'stale-plan', plan }),
        diagnostics: [{ code: 'COSSACK_UPGRADE_PLAN_STALE', severity: 'error',
          message: `File changed during planning: ${relative}. Re-run upgrade; no changes were applied.`, path: relative }],
      };
    }

    const applied = { dependencies: false, pnpmBuildSettings: false, files: [], deleted: [], manifest: false, installed: false };
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
        await target.api.migratePnpmBuildSettings(root, recipeFromManifest(manifest, target.api.resolveRecipe));
        applied.pnpmBuildSettings = true;
        if (migration.packageChanged && !dependencyChanges) ctx.out.file('overwritten', path.join(root, 'package.json'));
        if (migration.workspaceChanged) ctx.out.file('overwritten', path.join(root, 'pnpm-workspace.yaml'));
      }
      // Applying uses the already reviewed rendering; an installer cannot alter
      // which template files were selected after the plan was computed.
      for (const relative of selected) {
        await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
        await fs.writeFile(path.join(root, relative), report.rendered.get(relative).content);
        applied.files.push(relative);
        ctx.out.file(report.currentHashes.get(relative) === null ? 'created' : 'overwritten', path.join(root, relative));
      }
      for (const relative of selectedDeletes) {
        await fs.rm(path.join(root, relative));
        applied.deleted.push(relative);
        ctx.out.file('deleted', path.join(root, relative));
      }
      if (manifestChanges) {
        await refreshManifest(root, [...applied.files,
          ...(dependencyChanges || migration.packageChanged ? ['package.json'] : []),
          ...(migration.workspaceChanged ? ['pnpm-workspace.yaml'] : [])], report.rendered, target.version, merged.baseline, applied.deleted);
        applied.manifest = true;
        ctx.out.file('overwritten', path.join(root, '.cossack/scaffold.json'));
      }
      if (dependencyChanges) {
        ctx.out.line(`Reinstalling with ${packageManager}...`);
        await runInstall(packageManager, root);
        applied.installed = true;
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
    await execFileP(pm, ['install'], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 });
  } catch (err) {
    throw Object.assign(new Error(`Dependency installation with ${pm} failed.`),
      { code: 'COSSACK_UPGRADE_INSTALL_FAILED' });
  }
}

/**
 * Pure per-file drift classification.
 *  - baseline: hash recorded in .cossack/scaffold.json at create time
 *  - current : hash of the file on disk now (null if deleted)
 *  - newHash : hash of the equivalent file in the new template (null if absent)
 *  - excluded: file is in the adapter/version-specific exclude set
 */
export function classifyFile({ baseline, current, newHash, excluded }) {
  if (excluded) return 'excluded';
  if (current === null) return 'missing';
  if (newHash === null) return current === baseline ? 'canDelete' : 'modified';
  if (newHash === current) return 'upToDate';
  if (current === baseline) return 'canUpdate';
  return 'modified';
}

async function buildDriftReport(root, projectName, manifest, api) {
  const adapter = manifest?.runtime ?? manifest?.adapter;

  const report = {
    hasManifest: !!manifest,
    adapter,
    canUpdate: [],
    canDelete: [],
    modified: [],
    upToDate: [],
    excluded: [],
    missing: [],
    rendered: null,
    currentHashes: new Map(),
  };

  if (!manifest) return report;
  if (manifest.schemaVersion !== 3) {
    throw unsupportedManifestError(manifest);
  }
  const recipe = recipeFromManifest(manifest, api.resolveRecipe);
  const rendered = await api.renderRecipe(recipe, {
    projectName,
  });
  report.rendered = rendered;
  for (const rel of rendered.keys()) if (!safeRelative(rel)) throw Object.assign(new Error('Target scaffold contains an invalid relative path.'),
    { code: 'COSSACK_UPGRADE_TEMPLATE_INVALID' });
  const paths = new Set([...Object.keys(manifest.files ?? {}), ...rendered.keys()]);
  for (const rel of paths) {
    const owned = manifest.files?.[rel];
    const baseline = typeof owned === 'string' ? owned : owned?.hash;
    const candidate = rendered.get(rel);
    const newHash = candidate
      ? createHash('sha256').update(candidate.content).digest('hex')
      : null;
    const excluded = EXCLUDE_FROM_SYNC.has(rel) || candidate?.capability === 'local-environment' || owned?.capability === 'local-environment';
    if (excluded) {
      report.excluded.push(rel);
      continue;
    }
    await assertOwnedPath(root, rel);
    const current = await hashFile(path.join(root, rel));
    report.currentHashes.set(rel, current);
    if (!owned) {
      if (current === null && candidate) report.canUpdate.push(rel);
      else if (candidate && current === newHash) report.upToDate.push(rel);
      else report.modified.push(rel);
      continue;
    }
    const bucket = classifyFile({ baseline, current, newHash, excluded });
    report[bucket].push(rel);
  }
  return report;
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

function printReport(report, out) {
  out.line('Template drift:');
  if (!report.hasManifest) {
    out.line(
      '  No .cossack/scaffold.json found — skipping file-level drift analysis.\n' +
        '  Only dependency versions are planned.',
    );
    return;
  }
  section(out, 'Unchanged, update available', report.canUpdate);
  section(out, 'Unchanged, removed by target template', report.canDelete);
  section(out, 'Modified by you (skipped)', report.modified);
  section(out, 'Up to date', report.upToDate);
  section(out, 'Excluded (adapter/version-specific)', report.excluded);
  section(out, 'Missing (deleted)', report.missing);
  out.line('');
}

function section(out, title, items) {
  if (!items || items.length === 0) return;
  out.line(`  ${title}:`);
  for (const f of items) out.line(`    ${f}`);
}

async function refreshManifest(root, rels, rendered, version, baseline, deleted = []) {
  const manifestPath = path.join(root, '.cossack/scaffold.json');
  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest) return;
  manifest.files = manifest.files || {};
  for (const rel of deleted) delete manifest.files[rel];
  for (const rel of rels) {
    const h = await hashFile(path.join(root, rel));
    if (h) {
      const previous = manifest.files[rel];
      manifest.files[rel] = {
        capability: rendered?.get(rel)?.capability ??
          (typeof previous === 'object' ? previous.capability : 'base'),
        hash: h,
      };
    }
  }
  manifest.templateVersion = version;
  manifest.dependencyBaseline = baseline;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function upgradeHelp() {
  return commandSpecs.upgrade.help(`cossack upgrade [directory]

Upgrade dependencies and compare templates from the release selected by --tag.
Owned dependencies follow the target recipe; local pins, deleted dependencies,
and user-added packages are preserved and reported. Source file updates and
removal of unchanged obsolete files require --apply-template or --force.
--force-file replaces one edited source file; configuration and secret files
cannot be forced. Dry runs leave the application unchanged; target templates
may be fetched with pnpm into temporary storage and removed after planning.`);
}
