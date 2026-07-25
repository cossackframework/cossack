/**
 * Bump the version of every workspace package in lockstep.
 *
 * Usage:
 *   pnpm bump <version>      e.g. pnpm bump 0.7.5
 *   pnpm bump <keyword>      e.g. pnpm bump patch | minor | major
 *   pnpm bump <version> --dry-run
 *
 * What it does:
 *   1. Sets `version` in every workspace package.json to the target.
 *   2. Rewrites any `^<oldVersion>` range whose key is an in-monorepo package
 *      name to `^<newVersion>`. This covers standard dependency sections and
 *      the nested `scaffold.dependencyVersions` map uniformly.
 *
 * What it deliberately does NOT do:
 *   - Touch `workspace:*` specifiers. pnpm rewrites those to real ranges at
 *     `pnpm publish` time, so they must stay literal in source.
 *   - Touch external packages (e.g. @cossackframework/solar-icons) that live
 *     outside this repo. Only packages found in the packages folder are bumped.
 *   - Touch git. Commit and tag are left to you.
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PACKAGES_DIR = new URL('../packages/', import.meta.url).pathname;
const KEYWORDS = new Set(['patch', 'minor', 'major']);

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

async function collectPackages() {
  const entries = await readdir(PACKAGES_DIR);
  const out = [];
  for (const name of entries) {
    const pkgPath = join(PACKAGES_DIR, name, 'package.json');
    if (!(await stat(join(PACKAGES_DIR, name))).isDirectory()) continue;
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

  const target = argv.find((a) => !a.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
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

  log(`\nDone. ${totalRangeBumps} scoped range(s) rewritten across ${packages.length} packages.`);
  if (dryRun) {
    log('(dry-run: no files written)');
  } else {
    log('Next: review with `git diff`, then commit and tag:');
    log(`  git add -A && git commit -m "chore: release v${newVersion}" && git tag v${newVersion}`);
    log(`  pnpm -r publish --no-git-checks`);
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
