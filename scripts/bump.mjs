/**
 * Bump the version of every workspace package in lockstep.
 *
 * Usage:
 *   pnpm bump <version>      e.g. pnpm bump 0.7.5
 *   pnpm bump <keyword>      e.g. pnpm bump patch | minor | major
 *   pnpm bump <version> --dry-run
 *
 * What it does:
 *   1. Sets `version` in every packages/* package.json and in the root
 *      package.json to the target (publish.yml requires all of them to match
 *      the release tag).
 *   2. Rewrites any `^<oldVersion>` range whose key is an in-monorepo package
 *      name to `^<newVersion>`. This covers standard dependency sections and
 *      the nested `scaffold.dependencyVersions` map uniformly.
 *   3. Sets `version` in every examples/* package.json to the target and
 *      rewrites their in-monorepo ranges the same way, so examples never drift
 *      behind the packages they demonstrate.
 *   4. Adds the target to the CMS update server's release list
 *      (services/update-server/releases.json) and sets that service's version,
 *      so the release commit carries the entry. publish.yml checks that the
 *      entry exists and deploys the server after publishing. Pass `--security`
 *      for a release that fixes a security problem, and `--minimum-from <v>`
 *      when older sites must update in two steps.
 *
 *   5. Sets `CMS_VERSION` in packages/cms/src/version.ts, which the CMS sends
 *      to the update server.
 *
 * What it deliberately does NOT do:
 *   - Touch `workspace:*` specifiers. pnpm rewrites those to real ranges at
 *     `pnpm publish` time, so they must stay literal in source.
 *   - Touch external packages (e.g. @cossackframework/solar-icons) that live
 *     outside this repo. Only packages found in the packages folder are bumped.
 *   - Touch git. Commit and tag are left to you.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL#pathname: pathname is `/C:/...` and percent-encoded on Windows.
const PACKAGES_DIR = fileURLToPath(new URL('../packages/', import.meta.url));
const EXAMPLES_DIR = fileURLToPath(new URL('../examples/', import.meta.url));
const ROOT_PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));
const UPDATE_SERVER_PACKAGE = fileURLToPath(new URL('../services/update-server/package.json', import.meta.url));
const ADD_RELEASE = fileURLToPath(new URL('../services/update-server/scripts/add-release.mjs', import.meta.url));
const CMS_VERSION_FILE = fileURLToPath(new URL('../packages/cms/src/version.ts', import.meta.url));
const KEYWORDS = new Set(['patch', 'minor', 'major']);
/** Flags that take a value: the value is not the version argument. */
const VALUE_FLAGS = new Set(['--minimum-from']);

function log(...args) {
  console.log(...args);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Stringify with 2-space indent + trailing newline (matches repo convention). */
function stringify(json) {
  return JSON.stringify(json, null, 2) + '\n';
}

async function collectPackages(directory = PACKAGES_DIR) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const name of entries) {
    const pkgPath = join(directory, name, 'package.json');
    if (!(await stat(join(directory, name))).isDirectory()) continue;
    try {
      const pkg = await readJson(pkgPath);
      out.push({ dir: name, path: pkgPath, json: pkg });
    } catch {
      // not a package directory (no package.json) — skip
    }
  }
  return out;
}

/** Bump a single component of a semver string. */
function bumpKeyword(version, keyword) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`Cannot bump "${keyword}" — current version "${version}" is not semver.`);
  }
  let [major, minor, patch] = match.slice(1).map(Number);
  if (keyword === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (keyword === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function assertSemver(v, label) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(v)) {
    throw new Error(`Invalid ${label} version "${v}". Expected e.g. 0.7.5.`);
  }
}

/**
 * Names of packages that live in THIS repo — the only ones whose ranges we
 * rewrite. External packages sharing the scope (e.g. @cossackframework/solar-icons)
 * are excluded because they're never found under packages/*.
 */
function inRepoNames(packages) {
  return new Set(packages.map((p) => p.json.name));
}

/**
 * Walk a JSON value, rewriting any `^<oldVersion>` or `~<oldVersion>` string
 * whose parent key is an in-repo package name. Mutates and returns the value.
 */
function rewriteRanges(value, oldVersion, newVersion, inRepo, parentKey) {
  if (Array.isArray(value)) {
    return value.map((v) => rewriteRanges(v, oldVersion, newVersion, inRepo, null));
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      value[k] = rewriteRanges(v, oldVersion, newVersion, inRepo, k);
    }
    return value;
  }
  if (
    typeof value === 'string' &&
    parentKey &&
    inRepo.has(parentKey) &&
    new RegExp(`^[~^]${escapeReg(oldVersion)}$`).test(value)
  ) {
    const prefix = value[0];
    return `${prefix}${newVersion}`;
  }
  return value;
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(
      'Usage: pnpm bump <version | patch | minor | major> [--dry-run]\n' +
        '  e.g. pnpm bump 0.7.5\n' +
        '       pnpm bump patch',
    );
    process.exit(1);
  }

  const target = argv.find((a, index) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[index - 1]));
  const dryRun = argv.includes('--dry-run');
  const minimumFrom = argv.includes('--minimum-from') ? argv[argv.indexOf('--minimum-from') + 1] : undefined;
  if (!target) {
    console.error('Error: missing version/keyword argument.');
    process.exit(1);
  }

  const packages = await collectPackages();
  if (packages.length === 0) {
    console.error('No packages found under packages/*.');
    process.exit(1);
  }

  const versions = new Set(packages.map((p) => p.json.version));
  if (versions.size !== 1) {
    console.error(
      `Refusing to bump: packages are out of sync. Found versions:\n  ${[
        ...versions,
      ].join(', ')}`,
    );
    process.exit(1);
  }
  const oldVersion = [...versions][0];

  const newVersion = KEYWORDS.has(target)
    ? bumpKeyword(oldVersion, target)
    : target;
  assertSemver(newVersion, 'target');
  if (newVersion === oldVersion) {
    log(`Already at ${oldVersion} — nothing to do.`);
    return;
  }

  const inRepo = inRepoNames(packages);

  log(`${dryRun ? '[dry-run] ' : ''}${oldVersion} -> ${newVersion}\n`);
  let totalRangeBumps = 0;
  for (const { json, path, dir } of packages) {
    const before = JSON.stringify(json);
    const next = structuredClone(json);
    next.version = newVersion;
    rewriteRanges(next, oldVersion, newVersion, inRepo, null);

    // Count how many ranges changed in this package for the report.
    const beforeRanges = countScopedRanges(json, oldVersion, inRepo);
    const changedRanges = beforeRanges; // version + matched ranges all rewritten
    totalRangeBumps += changedRanges;

    log(`  ${json.name.padEnd(32)} version${changedRanges ? ` +${changedRanges} range(s)` : ''}`);
    if (dryRun) continue;

    await writeFile(path, stringify(next), 'utf8');
  }

  // Examples are private and not part of the lockstep check, so they are
  // bumped to the target regardless of their current version.
  for (const { json, path } of await collectPackages(EXAMPLES_DIR)) {
    const next = structuredClone(json);
    const ranges = countScopedRanges(json, oldVersion, inRepo);
    next.version = newVersion;
    rewriteRanges(next, oldVersion, newVersion, inRepo, null);
    totalRangeBumps += ranges;
    log(`  ${('(example) ' + json.name).padEnd(32)} ${json.version ?? '(none)'} -> ${newVersion}${ranges ? ` +${ranges} range(s)` : ''}`);
    if (!dryRun) await writeFile(path, stringify(next), 'utf8');
  }

  const workspace = await readJson(ROOT_PACKAGE);
  log(`  ${'(root) ' + workspace.name}`.padEnd(34) + ` ${workspace.version} -> ${newVersion}`);
  if (!dryRun) {
    await writeFile(ROOT_PACKAGE, stringify({ ...workspace, version: newVersion }), 'utf8');
  }

  // The CMS reports this constant to the update server; a test keeps it equal to package.json.
  log(`  ${'(cms) src/version.ts'.padEnd(32)} ${newVersion}`);
  if (!dryRun) {
    const source = await readFile(CMS_VERSION_FILE, 'utf8');
    const next = source.replace(/(export const CMS_VERSION = ')[^']*(';)/, `$1${newVersion}$2`);
    if (next === source && !source.includes(`'${newVersion}'`)) throw new Error('packages/cms/src/version.ts has no CMS_VERSION to set.');
    await writeFile(CMS_VERSION_FILE, next, 'utf8');
  }

  // The CMS's update server answers "which version is the latest" from this list.
  const cms = packages.find((p) => p.json.name === '@cossackframework/cms');
  const hostTemplate = cms?.json.cossack?.hostTemplate;
  log(`  ${'(update server) releases.json'.padEnd(32)} + ${newVersion}`);
  if (!dryRun) {
    const server = await readJson(UPDATE_SERVER_PACKAGE);
    await writeFile(UPDATE_SERVER_PACKAGE, stringify({ ...server, version: newVersion }), 'utf8');
    execFileSync(process.execPath, [
      ADD_RELEASE, '--version', newVersion,
      ...(hostTemplate ? ['--host-template', hostTemplate] : []),
      ...(minimumFrom ? ['--minimum-from', minimumFrom] : []),
      ...(argv.includes('--security') ? ['--security'] : []),
    ], { stdio: 'inherit' });
  }

  log(`\nDone. ${totalRangeBumps} scoped range(s) rewritten across ${packages.length} packages.`);
  if (dryRun) {
    log('(dry-run: no files written)');
  } else {
    log('Next: review with `git diff`, commit, merge to master, then publish a');
    log(`GitHub release with tag ${newVersion} targeting master. publish.yml checks`);
    log('that the tag matches every package version and the update server\'s');
    log('release list, publishes to npm, then deploys the update server.');
  }
}

function countScopedRanges(json, oldVersion, inRepo) {
  let count = 0;
  const visit = (value, parentKey) => {
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, null));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    } else if (
      typeof value === 'string' &&
      parentKey &&
      inRepo.has(parentKey) &&
      new RegExp(`^[~^]${escapeReg(oldVersion)}$`).test(value)
    ) {
      count++;
    }
  };
  visit(json, null);
  return count;
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
