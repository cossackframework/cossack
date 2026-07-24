import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { renderRecipe, resolveRecipe } from '@cossackframework/scaffold';

import {
  exists,
  findProjectRoot,
  readJsonIfExists,
  hashFile,
} from '../fs-utils.js';
import { flagString, flagList } from '../flags.js';

const execFileP = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);

const COSSACK_PKG_PATTERN = /^(@cossackframework\/.+|cossack)$/;

// Files that are adapter/version-specific — never auto-updated, only reported.
const EXCLUDE_FROM_SYNC = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.declarations.json',
  'wrangler.jsonc',
  'wrangler.toml',
  '.cossack/scaffold.json',
]);

export async function upgradeCommand(args, ctx) {
  const dir = args[0];
  const tag = flagString(ctx.flags.tag) || 'latest';
  const applyTemplate = ctx.flags['apply-template'] === true;
  const forceFiles = flagList(ctx.flags['force-file']).map((p) =>
    p.replace(/\\/g, '/'),
  );

  const root = await findProjectRoot(dir || ctx.cwd);
  const projectPkg = await readJsonIfExists(path.join(root, 'package.json'));
  if (!projectPkg) {
    console.error('  error   no package.json found (is this a Cossack project?)');
    return 1;
  }
  const manifest = await readJsonIfExists(
    path.join(root, '.cossack/scaffold.json'),
  );
  if (manifest && manifest.schemaVersion !== 2) {
    throw unsupportedManifestError(manifest);
  }

  console.log(`Upgrading ${projectPkg.name || 'project'} at ${root}`);
  console.log(`Tag: ${tag}${ctx.dryRun ? '  (dry-run)' : ''}\n`);

  // 1. Collect Cossack deps and resolve the tag to concrete versions.
  const deps = collectCossackDeps(projectPkg);
  const resolved = await resolveVersions(deps, tag);

  // 2. Update package.json (unless dry-run).
  await updatePackageJson(root, projectPkg, resolved, ctx);

  // 3. Reinstall (unless dry-run).
  if (!ctx.dryRun && resolved.updates.length > 0) {
    const pm = await detectPackageManager(root);
    console.log(`Reinstalling with ${pm}...\n`);
    await runInstall(pm, root);
  }

  // 4. Drift report (always printed) + optional template apply.
  const report = await buildDriftReport(
    root,
    projectPkg.name || path.basename(root),
  );
  printReport(report);

  if (applyTemplate || ctx.force || forceFiles.length > 0) {
    const applied = await applyTemplateUpdates(root, report, forceFiles, ctx);
    if (applied.forced.length > 0) {
      console.log(
        `\nForce-updated ${applied.forced.length} file(s): ${applied.forced.join(', ')}`,
      );
    }
    if (applied.applied.length > 0) {
      console.log(`\nApplied template updates to ${applied.applied.length} file(s).`);
    } else if (!ctx.force) {
      console.log('\nNo template updates applied.');
    }
  } else if (report.canUpdate.length > 0) {
    console.log(
      `\n${report.canUpdate.length} file(s) can be updated — re-run with --apply-template.`,
    );
  }

  return 0;
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
  // `latest` / `canary` / concrete version -> concrete version via registry.
  try {
    const { stdout } = await execFileP('npm', [
      'view',
      `${name}@${tag}`,
      'version',
    ]);
    const v = stdout.trim().split('\n').pop()?.trim();
    if (v) return `^${v}`;
  } catch {
    /* fall through */
  }
  // Offline / unpublished: keep the tag literal so the install can resolve it.
  return tag === 'latest' ? null : `^${tag}`;
}

async function updatePackageJson(root, pkg, resolved, ctx) {
  let changed = false;
  const lines = [];
  for (const u of resolved.updates) {
    if (!u.to) {
      lines.push(`  ${u.name.padEnd(34)} ${u.from}  (unchanged — could not resolve)`);
      continue;
    }
    pkg[u.section] = pkg[u.section] || {};
    const current = pkg[u.section][u.name];
    if (current === u.to) {
      lines.push(`  ${u.name.padEnd(34)} ${u.to}  (already)`);
      continue;
    }
    pkg[u.section][u.name] = u.to;
    lines.push(
      `  ${u.name.padEnd(34)} ${current || '—'} → ${u.to}`,
    );
    changed = true;
  }
  console.log('Dependencies:');
  console.log(lines.join('\n') + '\n');

  if (changed && !ctx.dryRun) {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(pkg, null, 2) + '\n',
      'utf8',
    );
  }
}

async function detectPackageManager(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

async function runInstall(pm, cwd) {
  const installArgs = pm === 'yarn' ? ['install'] : ['install'];
  try {
    await execFileP(pm, installArgs, { cwd });
  } catch (err) {
    console.error(`  install failed: ${err.message}`);
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
  };

  if (!manifest) return report;
  if (manifest.schemaVersion !== 2) {
    throw unsupportedManifestError(manifest);
  }
  const recipe = resolveRecipe({
    adapter,
    preset: 'minimal',
    features: manifest.explicitFeatures ?? manifest.resolvedFeatures,
    database: manifest.config?.database,
    authMethods: manifest.config?.authMethods,
    oauth: manifest.config?.oauth,
    theme: manifest.config?.theme,
    dashboardModules: manifest.dashboardModules,
  });
  const rendered = await renderRecipe(recipe, {
    projectName,
  });
  report.rendered = rendered;
  const paths = new Set([...Object.keys(manifest.files ?? {}), ...rendered.keys()]);
  for (const rel of paths) {
    const owned = manifest.files?.[rel];
    const baseline = typeof owned === 'string' ? owned : owned?.hash;
    const current = await hashFile(path.join(root, rel));
    const candidate = rendered.get(rel);
    const newHash = candidate
      ? createHash('sha256').update(candidate.content).digest('hex')
      : null;
    const excluded = EXCLUDE_FROM_SYNC.has(rel);
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

function unsupportedManifestError(manifest) {
  return new Error(
    `Unsupported scaffold manifest schema ${manifest.schemaVersion ?? '(missing)'}. ` +
    'Recreate the project with the current alpha CLI.',
  );
}

function printReport(report) {
  console.log('Template drift:');
  if (!report.hasManifest) {
    console.log(
      '  No .cossack/scaffold.json found — skipping file-level drift analysis.\n' +
        '  Only dependency versions were updated.',
    );
    return;
  }
  section('Unchanged, update available', report.canUpdate);
  section('Modified by you (skipped)', report.modified);
  section('Up to date', report.upToDate);
  section('Excluded (adapter/version-specific)', report.excluded);
  section('Missing (deleted)', report.missing);
  console.log('');
}

function section(title, items) {
  if (!items || items.length === 0) return;
  console.log(`  ${title}:`);
  for (const f of items) console.log(`    ${f}`);
}

async function applyTemplateUpdates(root, report, forceFiles, ctx) {
  const applied = [];
  const forced = [];

  if (!report.rendered) {
    console.error('  cannot apply: schema-v2 recipe is unavailable.');
    return { applied, forced };
  }

  // Apply unmodified-but-changed files.
  for (const rel of report.canUpdate) {
    if (ctx.dryRun) {
      console.log(`  would update  ${rel}`);
      applied.push(rel);
      continue;
    }
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), report.rendered.get(rel).content);
    console.log(`  updated  ${rel}`);
    applied.push(rel);
  }

  // --force implies --apply-template and restores scaffold files that are
  // missing, but deliberately preserves locally modified files. A blanket
  // overwrite is too broad for an upgrade command: scaffolded pages, layouts,
  // styles, migrations, and assets commonly become application-owned files.
  // Callers must name each intentional overwrite with --force-file instead.
  if (ctx.force) {
    for (const rel of report.missing) {
      if (!report.rendered.has(rel)) continue;
      if (ctx.dryRun) {
        console.log(`  would force-update  ${rel}`);
        forced.push(rel);
        continue;
      }
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), report.rendered.get(rel).content);
      console.log(`  force-updated  ${rel}`);
      forced.push(rel);
    }
    if (report.modified.length > 0) {
      console.log(
        `  preserved  ${report.modified.length} locally modified file(s). ` +
          'Use --force-file <path> for each intentional overwrite.',
      );
    }
  }

  // Force-update specific modified files the user explicitly requested via
  // --force-file <path> (surgical, even without --force). Recipe rendering is
  // runtime-aware, so cross-adapter template copies are impossible.
  for (const rel of forceFiles) {
    if (!report.rendered.has(rel)) {
      console.error(`  cannot force: ${rel} is not owned by the recorded recipe`);
      continue;
    }
    if (ctx.dryRun) {
      console.log(`  would force-update  ${rel}`);
      forced.push(rel);
      continue;
    }
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), report.rendered.get(rel).content);
    console.log(`  force-updated  ${rel}`);
    forced.push(rel);
  }

  // Refresh the manifest hashes after applying so a subsequent run is accurate.
  if (!ctx.dryRun && (applied.length > 0 || forced.length > 0)) {
    await refreshManifest(root, [...applied, ...forced], report.rendered);
  }

  return { applied, forced };
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
