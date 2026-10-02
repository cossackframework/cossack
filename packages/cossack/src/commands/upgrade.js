import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import {
  migratePnpmBuildSettings,
  renderRecipe,
  resolveRecipe,
} from '@cossackframework/scaffold';

import {
  findProjectRoot,
  readJsonIfExists,
  hashFile,
} from '../fs-utils.js';
import { flagString, flagList } from '../flags.js';
import { detectProjectPackageManager } from '../package-manager.js';

const execFileP = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);

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

import { CommandSpec, runWithSpec, createCommandOutput } from '../command-spec.js';

const spec = new CommandSpec({
  name: 'upgrade',
  positionals: ['dir'],
  flags: {
    yes: { type: 'boolean', aliases: ['y'] },
    tag: { type: 'string' },
    'force-file': { type: 'string', repeated: true },
    'apply-template': { type: 'boolean' },
  },
});

export async function upgradeCommand(args, ctx) {
  ctx.out ??= createCommandOutput(ctx);
  return runWithSpec(spec, args, ctx, () => upgradeCommandInner(args, ctx), upgradeHelp);
}

async function upgradeCommandInner(args, ctx) {
  const tag = flagString(ctx.flags.tag) || 'latest';
  const forceFiles = [...new Set(flagList(ctx.flags['force-file']).map(p => p.replace(/\\/g, '/')))];
  const root = await findProjectRoot(args[0] || ctx.cwd);
  const packageBaseline = await hashFile(path.join(root, 'package.json'));
  const workspaceBaseline = await hashFile(path.join(root, 'pnpm-workspace.yaml'));
  const projectPkg = await readJsonIfExists(path.join(root, 'package.json'));
  if (!projectPkg) throw Object.assign(new Error('No package.json found. Is this a Cossack project?'),
    { code: 'COSSACK_PROJECT_MISSING' });
  const manifest = await readJsonIfExists(path.join(root, '.cossack/scaffold.json'));
  if (manifest && manifest.schemaVersion !== 3) throw unsupportedManifestError(manifest);

  // Compute every file decision before changing package.json or installing.
  const report = await buildDriftReport(root, projectPkg.name || path.basename(root));
  for (const relative of forceFiles) {
    if (!report.rendered?.has(relative) || path.isAbsolute(relative) ||
        relative.split('/').includes('..')) {
      throw Object.assign(new Error(`Cannot force ${relative}: it is not owned by the recorded recipe.`),
        { code: 'COSSACK_UPGRADE_FILE_UNKNOWN' });
    }
  }
  const resolved = await resolveVersions(collectCossackDeps(projectPkg), tag);
  const unresolved = resolved.updates.filter(update => !update.to);
  const applyTemplate = ctx.flags['apply-template'] === true || ctx.force || forceFiles.length > 0;
  const selected = new Set(applyTemplate ? report.canUpdate : []);
  if (ctx.force) for (const relative of report.missing) {
    if (report.rendered?.has(relative)) selected.add(relative);
  }
  for (const relative of forceFiles) selected.add(relative);
  const migration = manifest
    ? await migratePnpmBuildSettings(root, recipeFromManifest(manifest), { dryRun: true })
    : { changed: false, packageChanged: false, workspaceChanged: false };
  // The build-settings migration merges user approvals. A raw template copy
  // would overwrite that merged result, so it owns this file for this run.
  if (migration.workspaceChanged) selected.delete('pnpm-workspace.yaml');
  const dependencies = {
    updates: resolved.updates.map(update => ({ ...update, changed: !!update.to && update.from !== update.to })),
    additions: resolved.added, removals: [],
  };
  const packageManager = await detectPackageManager(root);
  const dependencyChanges = dependencies.updates.some(update => update.changed);
  const nextActions = [
    ...(report.canUpdate.length && !applyTemplate ? ['cossack upgrade --apply-template'] : []),
    ...(report.modified.some(relative => !selected.has(relative))
      ? ['Review preserved files; use --force-file <path> for each intentional overwrite.'] : []),
  ];
  const plan = {
    root, tag, templateVersion: await readTemplateVersion(), adapter: report.adapter ?? null,
    hasManifest: report.hasManifest, dependencies, pnpmBuildSettings: migration,
    files: {
      writes: [...selected].map(relative => ({ path: relative, forced: forceFiles.includes(relative) || report.missing.includes(relative) })),
      preserved: report.modified.filter(relative => !selected.has(relative)),
      conflicts: report.modified.map(relative => ({ path: relative, resolution: selected.has(relative) ? 'force' : 'preserve' })),
      missing: report.missing, excluded: report.excluded, upToDate: report.upToDate,
      available: report.canUpdate,
    },
    install: { packageManager, required: dependencyChanges }, nextActions,
  };
  ctx.out.line(`Upgrading ${projectPkg.name || 'project'} at ${root}`);
  ctx.out.line(`Tag: ${tag}${ctx.dryRun ? '  (dry-run)' : ''}\n`);
  printReport(report, ctx.out);
  if (unresolved.length) return {
    exitCode: 1, data: ctx.out.data({ status: 'planning-failed', plan }),
    diagnostics: unresolved.map(update => ({ code: 'COSSACK_UPGRADE_VERSION_UNRESOLVED', severity: 'error',
      message: `Could not resolve ${update.name}@${tag}. Check the registry and retry; no changes were applied.` })),
  };
  if (ctx.dryRun) {
    if (dependencyChanges || migration.packageChanged) ctx.out.file('planned', path.join(root, 'package.json'));
    if (migration.workspaceChanged) ctx.out.file('planned', path.join(root, 'pnpm-workspace.yaml'));
    for (const relative of selected) ctx.out.file('planned', path.join(root, relative));
    return ctx.out.data({ status: 'dry-run', plan });
  }

  // Registry resolution can take time. Refuse a stale plan before any effect
  // rather than overwrite edits made while versions were being resolved.
  const expected = new Map([...selected].map(relative => [relative, report.currentHashes.get(relative)]));
  expected.set('package.json', packageBaseline);
  if (migration.workspaceChanged) expected.set('pnpm-workspace.yaml', workspaceBaseline);
  for (const [relative, baseline] of expected) {
    if (await hashFile(path.join(root, relative)) !== baseline) return {
      exitCode: 1, data: ctx.out.data({ status: 'stale-plan', plan }),
      diagnostics: [{ code: 'COSSACK_UPGRADE_PLAN_STALE', severity: 'error',
        message: `File changed during planning: ${relative}. Re-run upgrade; no changes were applied.`, path: relative }],
    };
  }

  const applied = { dependencies: false, pnpmBuildSettings: false, files: [], installed: false };
  try {
    if (dependencyChanges) {
      const next = structuredClone(projectPkg);
      for (const update of dependencies.updates) {
        if (update.changed) next[update.section][update.name] = update.to;
      }
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(next, null, 2) + '\n');
      applied.dependencies = true;
      ctx.out.file('overwritten', path.join(root, 'package.json'));
    }
    if (migration.changed) {
      await migratePnpmBuildSettings(root, recipeFromManifest(manifest));
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
    if (applied.files.length) await refreshManifest(root, applied.files, report.rendered);
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
    const version = await resolveNpmVersion(name, tag);
    updates.push({ name, from: deps[name].range, to: version, section: deps[name].section });
  }
  return { updates, added };
}

async function resolveNpmVersion(name, tag) {
  try {
    const { stdout } = await execFileP('pnpm', ['view', `${name}@${tag}`, 'version', '--json'],
      { timeout: 30_000, maxBuffer: 256 * 1024 });
    const parsed = JSON.parse(stdout);
    const version = Array.isArray(parsed) ? parsed.at(-1) : parsed;
    if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) return `^${version}`;
  } catch {}
  return null;
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
  if (newHash === null) return 'excluded'; // adapter-generated, not in template
  if (newHash === current) return 'upToDate';
  if (current === baseline) return 'canUpdate';
  return 'modified';
}

async function buildDriftReport(root, projectName) {
  const manifest = await readJsonIfExists(
    path.join(root, '.cossack/scaffold.json'),
  );
  const adapter = manifest?.runtime ?? manifest?.adapter;

  const report = {
    hasManifest: !!manifest,
    adapter,
    canUpdate: [],
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
  const recipe = recipeFromManifest(manifest);
  const rendered = await renderRecipe(recipe, {
    projectName,
  });
  report.rendered = rendered;
  const paths = new Set([...Object.keys(manifest.files ?? {}), ...rendered.keys()]);
  for (const rel of paths) {
    const owned = manifest.files?.[rel];
    const baseline = typeof owned === 'string' ? owned : owned?.hash;
    const current = await hashFile(path.join(root, rel));
    report.currentHashes.set(rel, current);
    const candidate = rendered.get(rel);
    const newHash = candidate
      ? createHash('sha256').update(candidate.content).digest('hex')
      : null;
    const excluded = EXCLUDE_FROM_SYNC.has(rel);
    if (excluded) {
      report.excluded.push(rel);
      continue;
    }
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

function recipeFromManifest(manifest) {
  const adapter = manifest.runtime ?? manifest.adapter;
  return resolveRecipe({
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
        '  Only dependency versions were updated.',
    );
    return;
  }
  section(out, 'Unchanged, update available', report.canUpdate);
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

async function refreshManifest(root, rels, rendered) {
  const manifestPath = path.join(root, '.cossack/scaffold.json');
  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest) return;
  manifest.files = manifest.files || {};
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
  manifest.templateVersion = await readTemplateVersion();
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function readTemplateVersion() {
  try {
    const pkgPath = requireFromHere.resolve('@cossackframework/scaffold/package.json');
    // eslint-disable-next-line
    const pkg = requireFromHere(pkgPath);
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function upgradeHelp() {
  return `cossack upgrade [directory]

Upgrade Cossack dependencies in the current project and report template drift.
By default this is NON-DESTRUCTIVE: it only updates package.json + reinstalls,
and prints which scaffolded files have upstream changes. Source files are never
overwritten unless you pass --apply-template or --force.

Options:
  --tag <latest|canary|<version>>   Version to upgrade to (default: latest).
  --apply-template                  Also update scaffolded files that you have
                                    NOT modified (detected via .cossack/scaffold.json).
                                    Modified files are always skipped.
  --force                           Apply safe template updates and restore
                                    deleted scaffold files. Locally modified
                                    files remain protected. Implies --apply-template.
  --force-file <path>               Force-update one specific file even if you
                                    modified it. May be repeated.
  --dry-run                         Show what would happen without writing.`;
}
