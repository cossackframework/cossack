import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, addFeature, removeFeatureFromProject, readManifest, planDependencyChanges } from '../src/index.js';

describe('dependency ownership', () => {
  it('plans additions, removals, and updates while preserving local pins and intentional deletions', () => {
    const before = { dependencies: { changed: '^1', removed: '^1', pinned: '^1', deleted: '^1' } };
    const current = { dependencies: { changed: '^1', removed: '^1', pinned: 'custom:private-value', user: '^9' } };
    const desired = { dependencies: { changed: '^2', added: '^2', pinned: '^2', deleted: '^2' } };
    const plan = planDependencyChanges(current, desired, before);
    expect(plan.next.dependencies).toEqual({ changed: '^2', added: '^2', pinned: 'custom:private-value', user: '^9' });
    expect(plan.additions.map(item => item.name)).toEqual(['added']);
    expect(plan.removals.map(item => item.name)).toEqual(['removed']);
    expect(plan.updates.map(item => item.name)).toEqual(['changed']);
    expect(plan.conflicts).toEqual([
      { name: 'deleted', reason: 'locally-deleted', resolution: 'preserve' },
      { name: 'pinned', reason: 'locally-modified', resolution: 'preserve' },
    ]);
    expect(JSON.stringify(plan.conflicts)).not.toContain('private-value');
    const repeat = planDependencyChanges(plan.next, desired, plan.baseline);
    expect([...repeat.additions, ...repeat.removals, ...repeat.updates]).toEqual([]);
    expect(repeat.baseline).toEqual(plan.baseline);
  });

  it('moves owned dependencies between sections and preserves a user move as one conflict', () => {
    const previous = { devDependencies: { owned: '^1', moved: '^1' } };
    const current = { devDependencies: { owned: '^1' }, optionalDependencies: { moved: '^1' } };
    const desired = { dependencies: { owned: '^2', moved: '^2' } };
    const plan = planDependencyChanges(current, desired, previous);
    expect(plan.next).toEqual({ devDependencies: {}, dependencies: { owned: '^2' }, optionalDependencies: { moved: '^1' } });
    expect(plan.additions).toEqual([{ name: 'owned', section: 'dependencies', to: '^2' }]);
    expect(plan.removals).toEqual([{ name: 'owned', section: 'devDependencies', from: '^1' }]);
    expect(plan.conflicts).toEqual([{ name: 'moved', reason: 'locally-modified', resolution: 'preserve' }]);
  });

  it('does not acquire an existing unowned dependency when a recipe requests the same value', () => {
    const current = { dependencies: { shared: '^1' } };
    const first = planDependencyChanges(current, current);
    expect(first.baseline.dependencies).toEqual({});
    expect(planDependencyChanges(first.next, {}, first.baseline).next).toEqual(current);
  });

  it('honors an explicit adapter force for requested dependencies without removing unrelated user packages', () => {
    const plan = planDependencyChanges({ dependencies: { requested: '^9', user: '^9' } },
      { dependencies: { requested: '^2' } }, {}, { force: true });
    expect(plan.next.dependencies).toEqual({ requested: '^2', user: '^9' });
    expect(plan.baseline.dependencies).toEqual({ requested: '^2' });
  });

  it('records generated dependencies through composition without adopting user dependencies', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-owned-dependencies-'));
    try {
      const app = await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', interactive: false });
      const file = path.join(app.projectDir, 'package.json');
      const legacy = await readManifest(app.projectDir);
      delete legacy.dependencyBaseline;
      await fs.writeFile(path.join(app.projectDir, '.cossack/scaffold.json'), JSON.stringify(legacy));
      const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
      const originalHono = pkg.dependencies.hono;
      pkg.dependencies.hono = '^999.0.0';
      pkg.dependencies['user-package'] = '^1.0.0';
      await fs.writeFile(file, JSON.stringify(pkg));
      await addFeature(app.projectDir, 'markdown', { interactive: false });
      const manifest = await readManifest(app.projectDir);
      expect(manifest.dependencyBaseline.dependencies.hono).toBe(originalHono);
      expect(manifest.dependencyBaseline.devDependencies).toHaveProperty('unified');
      expect(manifest.dependencyBaseline.dependencies).not.toHaveProperty('user-package');
      await removeFeatureFromProject(app.projectDir, 'markdown', { interactive: false });
      const next = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(next.dependencies).toMatchObject({ hono: '^999.0.0', 'user-package': '^1.0.0' });
      expect(next.devDependencies).not.toHaveProperty('unified');
      expect((await readManifest(app.projectDir)).dependencyBaseline.devDependencies).not.toHaveProperty('unified');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it('requires ownership migration before composing a different legacy template version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-legacy-dependencies-'));
    try {
      const app = await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', interactive: false });
      const file = path.join(app.projectDir, 'package.json');
      const before = await fs.readFile(file, 'utf8');
      const manifest = await readManifest(app.projectDir);
      delete manifest.dependencyBaseline;
      manifest.templateVersion = '0.0.1';
      await fs.writeFile(path.join(app.projectDir, '.cossack/scaffold.json'), JSON.stringify(manifest));
      await expect(addFeature(app.projectDir, 'markdown', { interactive: false })).rejects.toMatchObject({
        code: 'COSSACK_SCAFFOLD_DEPENDENCY_BASELINE_MISSING',
      });
      expect(await fs.readFile(file, 'utf8')).toBe(before);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it('retains reconstructed dependency ownership when composition only changes source files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-source-only-composition-'));
    try {
      const app = await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', features: ['ui'], interactive: false });
      const file = path.join(app.projectDir, 'package.json');
      const before = await fs.readFile(file, 'utf8');
      const manifest = await readManifest(app.projectDir);
      const baseline = manifest.dependencyBaseline;
      delete manifest.dependencyBaseline;
      await fs.writeFile(path.join(app.projectDir, '.cossack/scaffold.json'), JSON.stringify(manifest));
      const result = await addFeature(app.projectDir, 'ui', { theme: 'blue', interactive: false });
      expect(result.changes.writes.some(change => change.path === 'package.json')).toBe(false);
      expect(await fs.readFile(file, 'utf8')).toBe(before);
      expect((await readManifest(app.projectDir)).dependencyBaseline).toEqual(baseline);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
