import { expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import * as database from '../../database/src/index.ts';
import { nodeSQLite } from '../../database/src/runtime/node.ts';
import { renderRecipe, resolveRecipe } from '../src/index.js';

async function migrations() {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'full-stack', oauth: 'github' }));
  return [...files].filter(([file]) => /^src\/migrations\/\d+_.*\.ts$/.test(file)).map(([, value]) => {
    const { code } = transformSync(value.content.toString(), { loader: 'ts', format: 'cjs', target: 'es2022' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (name !== '@cossackframework/database') throw new Error(`Unexpected dependency ${name}`);
      return database;
    }, module, module.exports);
    return module.exports.default;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

it('preserves applied callback definitions and data while planning/applying only new declarative migrations', async () => {
  const current = await migrations();
  const pending = current.find(item => item.name === '0008_add_session_public_id');
  expect(pending).toBeDefined();
  const legacy = current.filter(item => item !== pending).map(({ operations, ...definition }) => definition);
  const orm = database.createORM({ adapter: await nodeSQLite(), entities: [] });
  try {
    await orm.run(async () => {
      const oldRunner = new database.MigrationRunner(orm, legacy);
      await oldRunner.up();
      const history = await oldRunner.applied({ readOnly: true });
      await orm.executeFragment(orm.sql.fragment`INSERT INTO sessions (id, data, meta, expires_at) VALUES (${'existing-token'}, ${'{"cart":2}'}, ${'{"type":"auth"}'}, ${'2099-01-01T00:00:00.000Z'})`, 'insert');
      const runner = new database.MigrationRunner(orm, [...legacy, pending]);
      const plan = await runner.plan();
      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({ name: pending.name, complete: true, mode: 'apply' });
      expect((await orm.executeFragment(orm.sql.unsafe('PRAGMA table_info(sessions)'), 'select')).rows.some(row => row.name === 'public_id')).toBe(false);
      expect(await runner.applyPlan(plan)).toEqual([pending.name]);
      expect((await runner.applied({ readOnly: true })).filter(row => row.name !== pending.name)).toEqual(history);
      expect((await orm.executeFragment(orm.sql.unsafe('SELECT id, data, meta, public_id FROM sessions'), 'select')).rows).toEqual([{ id: 'existing-token', data: '{"cart":2}', meta: '{"type":"auth"}', public_id: null }]);
      expect((await runner.status({ readOnly: true })).every(row => row.state === 'applied')).toBe(true);
      expect(await runner.plan()).toEqual([]);
      expect(await runner.down()).toEqual([pending.name]);
      expect(await oldRunner.applied({ readOnly: true })).toEqual(history);
      expect((await orm.executeFragment(orm.sql.unsafe('SELECT id, data FROM sessions'), 'select')).rows).toEqual([{ id: 'existing-token', data: '{"cart":2}' }]);
    });
  } finally { await orm.close(); }
});

it('blindly replacing applied callback templates rejects planning/execution and baseline does not reconcile them', async () => {
  const current = await migrations();
  const legacy = current.map(({ operations, ...definition }) => definition);
  const orm = database.createORM({ adapter: await nodeSQLite(), entities: [] });
  try {
    await orm.run(async () => {
      const oldRunner = new database.MigrationRunner(orm, legacy);
      await oldRunner.up();
      const history = await oldRunner.applied({ readOnly: true });
      const runner = new database.MigrationRunner(orm, current);
      await expect(runner.plan()).rejects.toThrow('changed checksum');
      await expect(runner.up()).rejects.toThrow('changed checksum');
      await expect(runner.down()).rejects.toThrow('changed checksum');
      expect(await oldRunner.applied({ readOnly: true })).toEqual(history);
      await runner.baseline('test-schema-fingerprint');
      await expect(runner.plan()).rejects.toThrow('changed checksum');
      expect((await runner.applied({ readOnly: true })).filter(row => !row.name.startsWith('baseline:'))).toEqual(history);
    });
  } finally { await orm.close(); }
});
