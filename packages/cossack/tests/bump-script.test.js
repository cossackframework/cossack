import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Run a copy inside each fixture: the script resolves the repository from its own location.
const source = fileURLToPath(new URL('../../../scripts/bump.mjs', import.meta.url));
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function write(root, rel, json) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), JSON.stringify(json, null, 2) + '\n');
}
const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-bump-'));
  roots.push(root);
  write(root, 'package.json', { name: 'monorepo', version: '1.0.0' });
  write(root, 'packages/core/package.json', { name: '@scope/core', version: '1.0.0' });
  write(root, 'packages/cli/package.json', { name: 'cli', version: '1.0.0', scaffold: { dependencyVersions: { '@scope/core': '^1.0.0', external: '^1.0.0' } } });
  // Examples are private and historically drifted behind the packages.
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(source, path.join(root, 'scripts', 'bump.mjs'));
  write(root, 'examples/demo/package.json', { name: 'demo', private: true, version: '0.8.3', dependencies: { '@scope/core': 'workspace:*', cli: '^1.0.0' } });
  return root;
}

describe('scripts/bump.mjs', () => {
  it('bumps packages, the root and examples in lockstep', () => {
    const root = fixture();
    execFileSync(process.execPath, [path.join(root, 'scripts', 'bump.mjs'), 'minor'], { stdio: 'pipe' });
    expect(read(root, 'package.json').version).toBe('1.1.0');
    expect(read(root, 'packages/core/package.json').version).toBe('1.1.0');
    expect(read(root, 'packages/cli/package.json').scaffold.dependencyVersions).toEqual({ '@scope/core': '^1.1.0', external: '^1.0.0' });
    expect(read(root, 'examples/demo/package.json')).toMatchObject({
      version: '1.1.0',
      dependencies: { '@scope/core': 'workspace:*', cli: '^1.1.0' },
    });
  });

  it('writes nothing on --dry-run', () => {
    const root = fixture();
    execFileSync(process.execPath, [path.join(root, 'scripts', 'bump.mjs'), '2.0.0', '--dry-run'], { stdio: 'pipe' });
    expect(read(root, 'examples/demo/package.json').version).toBe('0.8.3');
    expect(read(root, 'packages/core/package.json').version).toBe('1.0.0');
  });
});
