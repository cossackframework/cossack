import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const installedRoot = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Usage: node scripts/verify-database-plans.mjs <installed-project>');
const run = promisify(execFile);
async function resolveInstalled(name) {
  const result = await run(process.execPath, ['--input-type=module', '-e', `process.stdout.write(import.meta.resolve(${JSON.stringify(name)}))`], { cwd: installedRoot });
  const file = fileURLToPath(result.stdout);
  assert.ok((await fs.realpath(file)).startsWith(installedRoot + path.sep), 'Use an installed package');
  return file;
}
const { createORM, MigrationRunner, SeederRunner, defineSeeder } = await import(pathToFileURL(await resolveInstalled('@cossackframework/database')).href);
const { nodeSQLite } = await import(pathToFileURL(await resolveInstalled('@cossackframework/database/node')).href);
const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-installed-plans-'));
const adapter = await nodeSQLite({ filename: path.join(parent, 'selected.sqlite') });
const orm = createORM({ adapter: { ...adapter, tooling: { provider: 'sqlite', target: 'local', databaseName: 'selected' } }, entities: [] });
try {
  await orm.run(async () => {
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE source_data (id integer)'), 'ddl');
    await orm.executeFragment(orm.sql.unsafe('INSERT INTO source_data VALUES (1)'), 'insert');
    const initial = await fs.readFile(path.join(parent, 'selected.sqlite'));
    let callbacks = 0;
    const legacy = new MigrationRunner(orm, [{ name: 'legacy', up() { callbacks++; }, down() {} }]);
    const unknown = await legacy.plan();
    assert.equal(unknown[0].complete, false);
    await assert.rejects(legacy.applyPlan(unknown), /incomplete/);
    assert.equal(callbacks, 0);
    assert.deepEqual(await fs.readFile(path.join(parent, 'selected.sqlite')), initial);
    const operations = { up: [orm.sql.unsafe('CREATE TABLE declared_data (id integer, note text)')], down: [{ kind: 'drop-table', tableName: 'declared_data' }] };
    const runner = new MigrationRunner(orm, [{ name: 'declared', operations }]);
    const plan = await runner.plan();
    const stalePlan = await runner.plan();
    assert.equal(plan[0].complete, true);
    assert.equal(plan[0].target.databaseName, 'selected');
    assert.deepEqual(await runner.applied({ readOnly: true }), []);
    assert.deepEqual(await runner.applyPlan(plan), ['declared']);
    const seed = new SeederRunner(orm, [defineSeeder({ name: 'declared_seed', transaction: 'required', operations: [orm.sql.fragment`INSERT INTO declared_data VALUES (${7}, ${'PRIVATE_INSTALLED_PLAN_PARAMETER'})`] })]);
    const seedPlan = await seed.plan();
    assert.equal(seedPlan[0].complete, true);
    assert.ok(!JSON.stringify(seedPlan).includes('PRIVATE_INSTALLED_PLAN_PARAMETER'));
    await seed.applyPlan(seedPlan);
    assert.equal((await orm.executeFragment(orm.sql.unsafe('SELECT count(*) AS count FROM declared_data'))).rows[0].count, 1);
    const failing = new SeederRunner(orm, [defineSeeder({ name: 'rollback', transaction: 'required', operations: [orm.sql.unsafe('INSERT INTO declared_data VALUES (8, NULL)'), orm.sql.unsafe('INSERT INTO nonexistent VALUES (1)')] })]);
    await assert.rejects(failing.applyPlan(await failing.plan()));
    assert.equal((await orm.executeFragment(orm.sql.unsafe('SELECT count(*) AS count FROM declared_data'))).rows[0].count, 1);
    await assert.rejects(runner.applyPlan(stalePlan), /changed|stale/);
    const down = await runner.plan('down');
    assert.equal(down[0].direction, 'down');
    assert.deepEqual(await runner.applyPlan(down), ['declared']);
  });
  const contract = path.join(installedRoot, 'rt16-plan-contract.ts');
  try {
    await fs.writeFile(contract, `import { type Migration, type MigrationOperation, type DatabasePlanTarget, type SeederPlanEntry, defineSeeder, sql } from '@cossackframework/database';
const operation:MigrationOperation={kind:'drop-table',tableName:'old'};
const migration:Migration={name:'typed',operations:{up:[operation],down:[]}};
defineSeeder({name:'typed',operations:[sql.fragment\`SELECT \${1}\`]});
// @ts-expect-error invalid schema operation is rejected
const invalid:MigrationOperation={kind:'erase-table',tableName:'old'};
// @ts-expect-error seeder declarations require SQL fragments
const invalidSeed=defineSeeder({name:'bad',operations:['DELETE FROM old']});
declare const target:DatabasePlanTarget;declare const plan:SeederPlanEntry;void target;void plan;void migration;void invalid;void invalidSeed;
`);
    const compiler = await resolveInstalled('typescript');
    await run(process.execPath, [path.join(path.dirname(compiler), '../bin/tsc'), '--ignoreConfig', '--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--strict', contract], { cwd: installedRoot, timeout: 30000 });
  } finally { await fs.rm(contract, { force: true }); }
  console.log('Installed database plan types, safe unknown callbacks, selected SQLite apply/revert, seed commit/rollback and stale-plan rejection passed.');
} finally { await orm.close(); await fs.rm(parent, { recursive: true, force: true }); }
