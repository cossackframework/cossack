/**
 * Fail unless a release tag matches the workspace version.
 *
 * Usage:
 *   node scripts/verify-release-version.mjs <tag> [--root <dir>]
 *
 * The tag must be `X.Y.Z` or `vX.Y.Z` (existing release tags are bare, e.g.
 * `0.9.0`; prerelease suffixes such as `1.0.0-rc.1` are allowed). Its version
 * must equal the root package.json version and every packages/* package.json
 * version, so publish.yml never publishes a version nobody tagged.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function verifyReleaseVersion(tag, root) {
  const errors = [];
  const match = TAG.exec(tag ?? '');
  if (!match) {
    return [`Release tag "${tag ?? ''}" is not X.Y.Z or vX.Y.Z.`];
  }
  const version = match[1];
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const workspace = read(path.join(root, 'package.json'));
  if (workspace.version !== version) {
    errors.push(`Root package.json version ${workspace.version} does not match tag ${tag}.`);
  }
  const packages = path.join(root, 'packages');
  let checked = 0;
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    const manifest = path.join(packages, entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    const pkg = read(manifest);
    checked += 1;
    if (pkg.version !== version) {
      errors.push(`${pkg.name} (packages/${entry.name}) version ${pkg.version} does not match tag ${tag}.`);
    }
  }
  if (checked === 0) errors.push('No packages/*/package.json found.');
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex === -1
    ? fileURLToPath(new URL('../', import.meta.url))
    : path.resolve(args.splice(rootIndex, 2)[1]);
  const [tag] = args;
  const errors = verifyReleaseVersion(tag, root);
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(`Release tag ${tag} matches the root and all packages/* versions.`);
}
