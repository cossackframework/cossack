/**
 * Put a new workspace package on npm, ready for publish.yml.
 *
 * publish.yml publishes with npm trusted publishing (GitHub OIDC), and npm sets a trusted
 * publisher only on a package that exists. A package that was never published therefore
 * needs one publish by a person first. This script makes that publish a placeholder
 * (version 0.0.0, no code, no dependencies), then names publish.yml as the package's
 * trusted publisher, as the existing packages have it. The release workflow publishes the
 * first real version.
 *
 * Usage (signed in with `npm login`; npm asks for two-factor confirmation in the browser):
 *   node scripts/first-publish.mjs             what it would do
 *   node scripts/first-publish.mjs --publish   do it
 *
 * Packages already on npm are left alone, so a run that stopped half-way can be repeated.
 * For those it prints the command that sets the trusted publisher, in case one lacks it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = fileURLToPath(new URL('../packages/', import.meta.url));
// Must equal publish.yml: its file name, this repository and the job's `environment`.
const WORKFLOW = 'publish.yml';
const REPOSITORY = 'cossackframework/cossack';
const ENVIRONMENT = 'Publish to npm';
const PLACEHOLDER = '0.0.0';

const publish = process.argv.includes('--publish');
const npm = (args, options = {}) => spawnSync('npm', args, { encoding: 'utf8', ...options });
const trustArguments = name => ['trust', 'github', name, '--file', WORKFLOW, '--repository', REPOSITORY, '--environment', ENVIRONMENT, '--allow-publish', '--yes'];
const shown = args => ['npm', ...args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg)].join(' ');

const manifests = readdirSync(PACKAGES, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(path.join(PACKAGES, entry.name, 'package.json')))
  .map(entry => JSON.parse(readFileSync(path.join(PACKAGES, entry.name, 'package.json'), 'utf8')))
  .filter(manifest => !manifest.private);

const missing = [];
for (const manifest of manifests) {
  const view = npm(['view', manifest.name, 'version']);
  if (view.status === 0) continue;
  if (!/E404/.test(view.stderr)) { console.error(`Could not ask npm about ${manifest.name}:\n${view.stderr}`); process.exit(1); }
  missing.push(manifest);
}

if (!missing.length) {
  console.log('Every public package of the workspace is on npm.');
  console.log(`To see a package's trusted publisher: npm trust list <package>`);
  process.exit(0);
}

console.log(`Not on npm yet: ${missing.map(manifest => manifest.name).join(', ')}\n`);
for (const manifest of missing) {
  console.log(`${manifest.name}`);
  console.log(`  1. npm publish --access public   (a placeholder, version ${PLACEHOLDER})`);
  console.log(`  2. ${shown(trustArguments(manifest.name))}`);
}
if (!publish) { console.log('\nNothing was changed. Run again with --publish.'); process.exit(0); }

for (const manifest of missing) {
  const directory = mkdtempSync(path.join(tmpdir(), 'cossack-first-publish-'));
  try {
    writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({
      name: manifest.name,
      version: PLACEHOLDER,
      description: manifest.description,
      license: manifest.license,
      repository: manifest.repository,
      publishConfig: { access: 'public' },
    }, null, 2)}\n`);
    writeFileSync(path.join(directory, 'README.md'), `# ${manifest.name}\n\n${manifest.description}\n\nThis version reserves the name. Install a released version instead.\n`);
    console.log(`\n== ${manifest.name}: placeholder ${PLACEHOLDER}`);
    // stdio is inherited: npm prints the browser link for the two-factor confirmation and waits.
    if (npm(['publish', '--access', 'public'], { cwd: directory, stdio: 'inherit' }).status !== 0) process.exit(1);
    console.log(`== ${manifest.name}: trusted publisher`);
    if (npm(trustArguments(manifest.name), { stdio: 'inherit' }).status !== 0) process.exit(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
console.log(`\nDone. Compare with an existing package: npm trust list cossack`);
