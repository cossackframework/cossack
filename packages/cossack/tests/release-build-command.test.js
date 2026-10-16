import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseBuildPlan, buildRelease } from '../../../scripts/build-release.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const folders = ['renderer', 'typescript-plugin', 'core', 'ui', 'database', 'auth', 'framework', 'node-adapter', 'test-utils', 'studio'];
const manifests = Object.fromEntries(await Promise.all(folders.map(async name => [name, JSON.parse(await fs.readFile(path.join(root, 'packages', name, 'package.json'), 'utf8'))])));

describe('non-Desktop release build command', () => {
  it('preserves native root stages in serial dependency order and builds test-utils', () => {
    const plan = createReleaseBuildPlan(manifests);
    expect(plan.map(stage => stage.directory)).toEqual(['renderer', 'typescript-plugin', 'core', 'ui', 'database', 'framework', 'node-adapter', 'test-utils', 'studio']);
    const before = (dependency, consumer) => expect(plan.findIndex(stage => stage.directory === dependency)).toBeLessThan(plan.findIndex(stage => stage.directory === consumer));
    before('renderer', 'core'); before('core', 'ui'); before('ui', 'framework');
    before('framework', 'node-adapter');
    before('core', 'test-utils'); before('database', 'studio'); before('ui', 'studio'); before('framework', 'studio');
    expect(plan.find(stage => stage.directory === 'framework').script).toBe('build:types');
    expect(plan.some(stage => stage.packageName.includes('desktop'))).toBe(false);
  });

  it('includes Auth when its manifest supplies a build and refuses missing required scripts', () => {
    const changed = { ...manifests, auth: { ...manifests.auth, scripts: { build: 'native-auth-build' } } };
    expect(createReleaseBuildPlan(changed).find(stage => stage.directory === 'auth').script).toBe('build');
    expect(() => createReleaseBuildPlan({ ...manifests, studio: { ...manifests.studio, scripts: {} } })).toThrow('Missing release build script: studio/build');
  });

  it('executes pnpm arguments without overlap and labels Desktop as waived', async () => {
    let active = false;
    const calls = [], logs = [];
    const runner = async (command, args, options) => {
      expect(active).toBe(false); active = true;
      await Promise.resolve(); calls.push({ command, args, options }); active = false; return 0;
    };
    expect(await buildRelease({ root, manifests, runner, log: line => logs.push(line) })).toBe(0);
    expect(calls).toEqual(createReleaseBuildPlan(manifests).map(stage => ({ command: 'pnpm', args: ['--filter', stage.packageName, 'run', stage.script], options: { cwd: root } })));
    expect(logs[0]).toBe('Desktop build excluded by the release waiver; not reported as passed.');
    expect(logs.some(line => line.includes('Auth has no build script'))).toBe(true);
  });

  it('propagates the first failed build exit code and never starts later builds', async () => {
    const calls = [];
    expect(await buildRelease({ root, manifests, log: () => {}, runner: async (_command, args) => { calls.push(args[1]); return calls.length === 3 ? 37 : 0; } })).toBe(37);
    expect(calls).toEqual(['@cossackframework/renderer', '@cossackframework/typescript-plugin', '@cossackframework/core']);
  });
});
