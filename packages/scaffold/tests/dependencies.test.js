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

  it('adds and removes a feature\'s dependencies without adopting the project\'s own', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-owned-dependencies-'));
    try {
      const app = await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', interactive: false });
      const file = path.join(app.projectDir, 'package.json');
      const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
      // A pin and a package of the project's own. What the recipe renders now is the baseline.
      pkg.dependencies.hono = '^999.0.0';
      pkg.dependencies['user-package'] = '^1.0.0';
      await fs.writeFile(file, JSON.stringify(pkg));
      await addFeature(app.projectDir, 'database', { interactive: false });
      expect(JSON.parse(await fs.readFile(file, 'utf8')).dependencies).toHaveProperty('@cossackframework/database');
      await removeFeatureFromProject(app.projectDir, 'database', { interactive: false });
      const next = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(next.dependencies).toMatchObject({ hono: '^999.0.0', 'user-package': '^1.0.0' });
      expect(next.dependencies).not.toHaveProperty('@cossackframework/database');
      expect((await readManifest(app.projectDir)).dependencyBaseline).toBeUndefined();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it('leaves package.json as it is when composition only changes source files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-source-only-composition-'));
    try {
      const app = await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', features: ['ui'], interactive: false });
      const file = path.join(app.projectDir, 'package.json');
      const before = JSON.parse(await fs.readFile(file, 'utf8'));
      await addFeature(app.projectDir, 'ui', { theme: 'blue', interactive: false });
      const after = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(after.dependencies).toEqual(before.dependencies);
      expect(after.devDependencies).toEqual(before.devDependencies);
      // The recipe's option is the only change.
      expect(after.cossack.options).toEqual({ theme: 'blue' });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
