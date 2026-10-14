import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { verifyReleaseVersion } from '../../../scripts/verify-release-version.mjs';
import { publishedPackageNames } from '../../../scripts/verify-published-release.mjs';
import { COSSACK_PACKAGES } from '../src/installed-packages.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = parse(readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8'));
const manifests = directory => readdirSync(path.join(root, directory), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry =>
  JSON.parse(readFileSync(path.join(root, directory, entry.name, 'package.json'), 'utf8')));
const packages = manifests('packages').filter(pkg => !pkg.private);
const steps = workflow.jobs.publish.steps;

describe('release publishing coverage', () => {
  it('publishes every public workspace package with idempotent recursive publishes', () => {
    const commands = steps.map(step => step.run ?? '').join('\n');
    // pnpm -r publish skips versions already on the registry, so a failed run can be re-run.
    expect(commands).toContain("pnpm -r --filter '!cossack' publish --access public --no-git-checks");
    // cossack depends on framework (which devDepends on cossack), so it goes last.
    expect(commands.indexOf('pnpm -r --filter cossack publish --access public --no-git-checks'))
      .toBeGreaterThan(commands.indexOf("--filter '!cossack' publish"));
    expect(commands).not.toMatch(/pnpm publish --filter/);
    expect(commands).not.toMatch(/--force|NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(packages.map(pkg => pkg.name)).toContain('cossack');
    expect(packages.map(pkg => pkg.name)).not.toContain('@cossackframework/solar-icons');
    for (const pkg of packages) {
      expect(pkg.publishConfig?.access, pkg.name).toBe('public');
      expect(pkg.repository?.url).toContain('github.com/cossackframework/cossack');
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@cossackframework/test-utils');
    }
    // Examples are workspace members; recursive publish must skip them.
    for (const example of manifests('examples')) expect(example.private, example.name).toBe(true);
  });
  it('keeps test-utils internal and keeps the publish job identity', () => {
    const internal = JSON.parse(readFileSync(path.join(root, 'packages/test-utils/package.json'), 'utf8'));
    expect(internal.private).toBe(true);
    // The release verifier and the CLI package allowlist name only packages
    // that pnpm -r publish actually publishes (Desktop has its own gate).
    const published = packages.map(pkg => pkg.name);
    const privatePackages = manifests('packages').filter(pkg => pkg.private).map(pkg => pkg.name);
    expect([...publishedPackageNames].sort()).toEqual(published.filter(name => name !== '@cossackframework/desktop').sort());
    for (const name of privatePackages) expect(COSSACK_PACKAGES, name).not.toContain(name);
    for (const name of published) expect(COSSACK_PACKAGES, name).toContain(name);
    const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(workspace.private).toBe(true);
    expect(workspace.scripts.build).toContain('pnpm --filter @cossackframework/test-utils run build');
    expect(workflow.jobs.publish.environment).toBe('Publish to npm');
    expect(workflow.jobs.publish.permissions['id-token']).toBe('write');
  });
  it('type checks and unit tests every package, Desktop included, before publishing', () => {
    const runs = steps.map(step => step.run ?? '');
    const publishAt = runs.findIndex(run => run.includes('publish --access public'));
    const typecheckAt = runs.indexOf('pnpm run typecheck');
    const unitAt = runs.indexOf('pnpm run test:unit');
    expect(typecheckAt).toBeGreaterThan(-1);
    expect(unitAt).toBeGreaterThan(-1);
    expect(Math.max(typecheckAt, unitAt)).toBeLessThan(publishAt);
    const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(workspace.scripts['test:unit']).toContain('--filter "./packages/*"');
    expect(workspace.scripts['test:unit']).not.toContain('!@cossackframework/desktop');
    const e2e = parse(readFileSync(path.join(root, '.github/workflows/e2e-tests.yml'), 'utf8'));
    const e2eRuns = e2e.jobs['e2e-tests'].steps.map(step => step.run ?? '');
    expect(e2eRuns).toContain('pnpm run typecheck');
    expect(e2eRuns).toContain('pnpm run test:unit');
    expect(e2eRuns.join('\n')).not.toMatch(/exclude-desktop|!@cossackframework\/desktop/);
  });
  it('verifies the release tag, target branch and versions before testing or publishing', () => {
    const verify = workflow.jobs['verify-release'];
    expect(workflow.jobs.integration.needs).toBe('verify-release');
    expect(workflow.jobs.publish.needs).toEqual(expect.arrayContaining(['verify-release', 'integration']));
    const check = verify.steps.find(step => step.run?.includes('verify-release-version.mjs'));
    expect(check.env.TARGET_COMMITISH).toBe('${{ github.event.release.target_commitish }}');
    expect(check.run).toContain('"$TARGET_COMMITISH" != master');
    expect(check.run).toContain('tag="$GITHUB_REF_NAME"');
    expect(check.run).toContain('node scripts/verify-release-version.mjs "$tag"');
  });
});

describe('release version check', () => {
  function workspace(rootVersion, packageVersions) {
    const directory = mkdtempSync(path.join(tmpdir(), 'cossack-release-version-'));
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'root', version: rootVersion }));
    for (const [name, version] of Object.entries(packageVersions)) {
      mkdirSync(path.join(directory, 'packages', name), { recursive: true });
      writeFileSync(path.join(directory, 'packages', name, 'package.json'), JSON.stringify({ name, version }));
    }
    return directory;
  }
  const check = (tag, rootVersion, packageVersions) => {
    const directory = workspace(rootVersion, packageVersions);
    try {
      return verifyReleaseVersion(tag, directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it('accepts bare and v-prefixed tags that match every version', () => {
    expect(check('1.2.3', '1.2.3', { a: '1.2.3', b: '1.2.3' })).toEqual([]);
    expect(check('v1.2.3', '1.2.3', { a: '1.2.3' })).toEqual([]);
    expect(check('1.2.3-rc.1', '1.2.3-rc.1', { a: '1.2.3-rc.1' })).toEqual([]);
  });
  it('rejects branch names, mismatched root versions and mismatched packages', () => {
    expect(check('master', '1.2.3', { a: '1.2.3' })).toEqual([expect.stringContaining('is not X.Y.Z')]);
    expect(check('1.2.4', '1.2.3', { a: '1.2.4' })).toEqual([expect.stringContaining('Root package.json')]);
    expect(check('1.2.3', '1.2.3', { a: '1.2.3', b: '1.2.2' })).toEqual([expect.stringContaining('b (packages/b)')]);
  });
  it('matches the current workspace', () => {
    const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(verifyReleaseVersion(version, root)).toEqual([]);
  });
});

describe('workflow supply chain', () => {
  it('pins every third-party action in every workflow to a full commit SHA', () => {
    const directory = path.join(root, '.github/workflows');
    const references = readdirSync(directory).filter(name => /\.ya?ml$/.test(name)).flatMap(name =>
      [...readFileSync(path.join(directory, name), 'utf8').matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)]
        .map(([, ref, comment]) => ({ name, ref, comment })));
    const external = references.filter(({ ref }) => !ref.startsWith('./'));
    expect(external.length).toBeGreaterThan(0);
    for (const { name, ref, comment } of external) {
      expect(ref, `${name}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      expect(comment, `${name}: ${ref} needs a version comment`).toMatch(/^\s+# v\d+/);
    }
    for (const name of new Set(references.map(reference => reference.name))) {
      const permissions = parse(readFileSync(path.join(directory, name), 'utf8')).permissions;
      expect(permissions, `${name} top-level permissions`).toEqual({ contents: 'read' });
    }
    const dependabot = parse(readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'));
    expect(dependabot.updates).toContainEqual(expect.objectContaining({
      'package-ecosystem': 'github-actions', schedule: { interval: 'weekly' },
    }));
  });
});
