import { expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';
import * as database from '../../database/src/index.ts';
import { nodeSQLite } from '../../database/src/runtime/node.ts';
import { renderRecipe, resolveRecipe } from '../src/index.js';

async function generatedMigrations(options = {}) {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'full-stack', oauth: 'github', ...options }));
  return [...files].filter(([file]) => /^src\/migrations\/\d+_.*\.ts$/.test(file)).map(([file, value]) => {
    const { code } = transformSync(value.content.toString(), { loader: 'ts', format: 'cjs', target: 'es2022' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (name !== '@cossackframework/database') throw new Error(`Unexpected migration dependency: ${name}`);
      return database;
    }, module, module.exports);
    return { file, migration: module.exports.default };
  }).sort((a,b) => a.migration.name.localeCompare(b.migration.name));
}

async function sqliteORM() { return database.createORM({ adapter: await nodeSQLite(), entities: [] }); }
async function schema(orm) {
  return (await orm.executeFragment(orm.sql.unsafe("SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE '_cossack%' AND name NOT LIKE 'sqlite_%' ORDER BY name"), 'select')).rows;
}

it('all generated migrations have complete read-only operations, including conditional OAuth and public sessions', async () => {
  const generated = await generatedMigrations();
  expect(generated).toHaveLength(7);
  expect(generated.map(row=>row.migration.name)).toContain('0008_add_session_public_id');
  const callbacks = vi.fn(() => { throw new Error('Callbacks must not execute while planning or applying declarative migrations'); });
  const migrations = generated.map(({migration}) => ({...migration,up:callbacks,down:callbacks}));
  const orm = await sqliteORM();
  try {
    await orm.run(async () => {
      const runner = new database.MigrationRunner(orm,migrations);
      const plan = await runner.plan();
      expect(plan).toHaveLength(7);
      expect(plan.every(entry=>entry.complete && entry.statements.length>0)).toBe(true);
      expect(await schema(orm)).toEqual([]);
      await runner.up();
      expect(callbacks).not.toHaveBeenCalled();
      expect((await runner.plan('down'))[0]).toMatchObject({name:'0008_add_session_public_id',complete:true,statements:[
        {text:'DROP INDEX "sessions_public_id_unique"'},
        {text:'ALTER TABLE "sessions" DROP COLUMN "public_id"'},
      ]});
      await runner.down({count:7});
      expect(await schema(orm)).toEqual([]);
      expect(callbacks).not.toHaveBeenCalled();
    });
  } finally {await orm.close();}
});

it('declarative SQLite execution preserves the exact callback schema and rejects changed historical checksums', async () => {
  const migrations=(await generatedMigrations()).map(row=>row.migration);
  const declarations=await sqliteORM(), callbacks=await sqliteORM();
  const legacy=migrations.map(({operations,...migration})=>migration);
  try {
    await declarations.run(()=>new database.MigrationRunner(declarations,migrations).up());
    await callbacks.run(()=>new database.MigrationRunner(callbacks,legacy).up());
    const actual=await declarations.run(()=>schema(declarations));
    expect(actual).toEqual(await callbacks.run(()=>schema(callbacks)));
    expect(actual.find(row=>row.name==='sessions').sql).toContain('public_id VARCHAR(36)');
    expect(actual.find(row=>row.name==='sessions_public_id_unique')).toBeDefined();
    await callbacks.run(async()=>{
      const runner=new database.MigrationRunner(callbacks,migrations);
      await expect(runner.plan()).rejects.toThrow('changed checksum');
      await expect(runner.up()).rejects.toThrow('changed checksum');
    });
  } finally {await declarations.close();await callbacks.close();}
});

it('the minimal database recipe also emits authoritative operations for every included migration', async () => {
  const generated=await generatedMigrations({preset:'database',oauth:[]});
  expect(generated.length).toBeGreaterThan(0);
  expect(generated.every(({migration})=>migration.operations.up.length>0 && migration.operations.down.length>0)).toBe(true);
});
