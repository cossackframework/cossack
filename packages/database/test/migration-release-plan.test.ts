import 'reflect-metadata';
import { it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createORM } from '../src/orm.js';
import { nodeSQLite } from '../src/runtime/node.js';
import { MemoryDriver } from '../src/adapter/memory.js';
import { MigrationRunner } from '../src/migration/runner.js';
import type { Migration } from '../src/migration/types.js';

it('plans without running callbacks or changing SQLite data, history or generated files, then applies the declared target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cossack-rt16-sqlite-'));
  const adapter = await nodeSQLite({ filename: join(root, 'target.sqlite') });
  const orm = createORM({ adapter: { ...adapter, tooling: { provider: 'sqlite', target: 'local', databaseName: 'selected-target' } }, entities: [] });
  try {
    await orm.run(async () => {
      await orm.executeFragment(orm.sql.unsafe('CREATE TABLE original (id integer)'), 'ddl');
      await orm.executeFragment(orm.sql.unsafe('INSERT INTO original VALUES (1)'), 'insert');
      const before = await readFile(join(root, 'target.sqlite'));
      const files = await readdir(root);
      let callbacks = 0;
      const callback: Migration = { name: '001_callback', async up() {
        callbacks++; await writeFile(join(root, 'generated.ts'), 'must not be planned');
        await orm.executeFragment(orm.sql.unsafe('DELETE FROM original'), 'delete');
      }, down() {} };
      const unknownRunner = new MigrationRunner(orm, [callback]);
      const unknown = await unknownRunner.plan();
      expect(unknown).toMatchObject([{ complete: false, statements: [], reason: expect.stringContaining('not executed') }]);
      await expect(unknownRunner.applyPlan(unknown)).rejects.toThrow('incomplete');
      expect(callbacks).toBe(0); expect(await readdir(root)).toEqual(files);
      expect(await readFile(join(root, 'target.sqlite'))).toEqual(before);
      expect((await orm.executeFragment(orm.sql.unsafe('SELECT * FROM original'))).rows).toEqual([{ id: 1 }]);
      expect(await unknownRunner.applied({ readOnly: true })).toEqual([]);
      const migration: Migration = { name: '001_declared', operations: {
        up: [orm.sql.unsafe('CREATE TABLE actual (id integer, secret text)'), orm.sql.fragment`INSERT INTO actual VALUES (${7}, ${'PRIVATE_PLAN_PARAMETER'})`],
        down: [{ kind: 'drop-table', tableName: 'actual' }],
      }, up() { callbacks++; throw Error('Must not override declarations'); }, down() { callbacks++; } };
      const runner = new MigrationRunner(orm, [migration]);
      const plan = await runner.plan();
      expect(plan).toMatchObject([{ complete: true, target: { provider: 'sqlite', target: 'local', databaseName: 'selected-target', connectionId: expect.any(String) },
        atomicity: 'transaction', statements: [{ order: 1, affectedObjects: ['actual'] }, { order: 2, parameterCount: 2 }],
        bookkeeping: [{ text: expect.stringContaining('CREATE TABLE IF NOT EXISTS'), affectedObjects: ['_cossack_migrations'] }, { affectedObjects: ['_cossack_migrations'] }] }]);
      expect(JSON.stringify(plan)).not.toContain('PRIVATE_PLAN_PARAMETER');
      expect(await readFile(join(root, 'target.sqlite'))).toEqual(before);
      expect(await runner.applyPlan(plan)).toEqual(['001_declared']);
      expect(callbacks).toBe(0);
      expect((await orm.executeFragment(orm.sql.unsafe('SELECT id FROM actual'))).rows).toEqual([{ id: 7 }]);
      expect((await runner.status({ readOnly: true }))[0]?.state).toBe('applied');
      expect(await runner.plan()).toEqual([]);
      const reverse = await runner.plan('down');
      expect(reverse).toMatchObject([{ direction: 'down', mode: 'revert', statements: [{ risk: 'destructive' }] }]);
      expect(await runner.applyPlan(reverse)).toEqual(['001_declared']);
      expect(await runner.applied({ readOnly: true })).toEqual([]);
    });
  } finally { await orm.close(); await rm(root, { recursive: true, force: true }); }
});

it('rejects foreign plans, changed declarations/parameters and stale migration history before writes', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE stale_target (id integer)'), 'ddl');
    const operations = [orm.sql.fragment`INSERT INTO stale_target VALUES (${1})`];
    const definition: Migration = { name: '001_stale', operations: { up: operations, down: [] } };
    const runner = new MigrationRunner(orm, [definition]);
    const plan = await runner.plan();
    await expect(new MigrationRunner(orm, [definition]).applyPlan(plan)).rejects.toThrow('foreign');
    await expect(runner.applyPlan([...plan])).rejects.toThrow('foreign');
    operations[0] = orm.sql.fragment`INSERT INTO stale_target VALUES (${2})`;
    await expect(runner.applyPlan(plan)).rejects.toThrow('stale');
    expect(await runner.applied({ readOnly: true })).toEqual([]);
    const fresh = await runner.plan(); await new MigrationRunner(orm, [definition]).up();
    await expect(runner.applyPlan(fresh)).rejects.toThrow('stale');
    const empty = await runner.plan();
    await orm.executeFragment(orm.sql.unsafe('UPDATE _cossack_migrations SET batch = 9'), 'update');
    await expect(runner.applyPlan(empty)).rejects.toThrow('stale');
    operations[0] = orm.sql.unsafe('CREATE TABLE changed (id integer)');
    expect((await runner.status({ readOnly: true }))[0]?.state).toBe('changed');
    await expect(runner.plan()).rejects.toThrow('changed checksum');
    await expect(runner.down()).rejects.toThrow('changed checksum');
  }); } finally { await orm.close(); }
});

it('plans squash consolidation as explicit bookkeeping without reexecuting baseline SQL, and rejects partial histories', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    const original: Migration = { name: '001_original', operations: { up: [orm.sql.unsafe('CREATE TABLE squashed (id integer)')], down: [] } };
    await new MigrationRunner(orm, [original]).up();
    const baseline: Migration = { name: '010_baseline', replaces: ['001_original'], operations: { up: [orm.sql.unsafe('CREATE TABLE squashed (id integer)')] } };
    const runner = new MigrationRunner(orm, [baseline]); const plan = await runner.plan();
    expect(plan).toMatchObject([{ mode: 'consolidate', complete: true, statements: [], bookkeeping: [{ risk: 'safe' }, { risk: 'destructive' }, { parameterCount: 4 }] }]);
    expect(await runner.applyPlan(plan)).toEqual(['010_baseline']);
    expect((await runner.applied({ readOnly: true })).map(row => row.name)).toEqual(['010_baseline']);
    expect(await runner.plan('down')).toMatchObject([{ complete: false }]);
    await expect(runner.down()).rejects.toThrow('failed');
    const partial = new MigrationRunner(orm, [{ name: '020_partial', replaces: ['010_baseline', 'missing'], operations: { up: [] } }]);
    await expect(partial.plan()).rejects.toThrow('only some');
  }); } finally { await orm.close(); }
});

it('rolls back declared SQL failure and reports provider limits without pretending callbacks are safe', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    const runner = new MigrationRunner(orm, [{ name: '001_failure', operations: { up: [orm.sql.unsafe('CREATE TABLE rolled_back (id integer)'), orm.sql.unsafe('invalid SQL')] } }]);
    const plan = await runner.plan(); await expect(runner.applyPlan(plan)).rejects.toThrow('failed');
    expect(await runner.applied({ readOnly: true })).toEqual([]);
    expect((await orm.executeFragment(orm.sql.unsafe("SELECT name FROM sqlite_master WHERE name='rolled_back'"))).rows).toEqual([]);
  }); } finally { await orm.close(); }
  for (const dialect of ['sqlite', 'postgres', 'mysql'] as const) {
    const driver = new MemoryDriver(dialect); Object.assign(driver.capabilities, { transactions: false, batch: false });
    const provider = createORM({ adapter: { driver }, entities: [] });
    try {
      const runner = new MigrationRunner(provider, [{ name: '001_provider', operations: { up: [{ kind: 'drop-table', tableName: 'obsolete' }], down: [] } }]);
      const plan = await provider.run(() => runner.plan());
      expect(plan).toMatchObject([{ atomicity: 'none', limitations: expect.arrayContaining([expect.stringContaining('partial changes')]), statements: [{ text: expect.stringContaining('DROP TABLE') }] }]);
      if (dialect === 'mysql') expect(plan[0]?.limitations).toContain('MySQL DDL can commit implicitly; a transaction does not guarantee schema rollback.');
      expect(driver.statements.every(statement => statement.operation === 'select')).toBe(true);
    } finally { await provider.close(); }
  }
});

it('executes the private plan snapshot even if application SQL nodes mutate after revalidation', async () => {
  let mutate = () => {};
  const orm = createORM({ adapter: await nodeSQLite(), entities: [], logger: event => {
    if (event.sql === 'CREATE TABLE detached (id integer)') mutate();
  } });
  try { await orm.run(async () => {
    const fragment = orm.sql.fragment`INSERT INTO detached VALUES (${12})`;
    mutate = () => { (fragment.nodes.find(node => node.kind === 'value') as { value: number }).value = 99; };
    const runner = new MigrationRunner(orm, [{ name: '001_detached', operations: {
      up: [orm.sql.unsafe('CREATE TABLE detached (id integer)'), fragment], down: [],
    } }]);
    await runner.applyPlan(await runner.plan());
    expect((await orm.executeFragment(orm.sql.unsafe('SELECT * FROM detached'))).rows).toEqual([{ id: 12 }]);
  }); } finally { await orm.close(); }
});

it('applies an empty approved plan without creating a bookkeeping table', async () => {
  const driver = new MemoryDriver();
  const orm = createORM({ adapter: { driver }, entities: [] });
  try { await orm.run(async () => {
    const runner = new MigrationRunner(orm, []);
    expect(await runner.applyPlan(await runner.plan())).toEqual([]);
    expect(driver.statements.every(statement => statement.operation === 'select')).toBe(true);
  }); } finally { await orm.close(); }
});

it('recognizes unchanged callback migrations recorded with the pre-0.9 checksum and permits explicit reversal', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    let upCalls = 0, downCalls = 0;
    const migration: Migration = { name: '001_legacy',
      up({ schema, orm }) { upCalls++; schema.raw(orm.sql.unsafe('CREATE TABLE legacy_history (id integer)')); },
      down({ schema, orm }) { downCalls++; schema.raw(orm.sql.unsafe('DROP TABLE legacy_history')); },
    };
    const previousSource = `${migration.name}\n${JSON.stringify(migration.replaces ?? [])}\n${migration.up!.toString()}\n${migration.down!.toString()}`;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(previousSource));
    const previousChecksum = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const runner = new MigrationRunner(orm, [migration]);
    await runner.ensureTable();
    await orm.executeFragment(orm.sql.unsafe('CREATE TABLE legacy_history (id integer)'), 'ddl');
    await orm.executeFragment(orm.sql.fragment`INSERT INTO _cossack_migrations VALUES (${migration.name}, ${previousChecksum}, ${1}, ${'2026-01-01T00:00:00Z'})`, 'insert');
    expect(await runner.status({ readOnly: true })).toMatchObject([{ state: 'applied', checksum: previousChecksum }]);
    expect(await runner.plan()).toEqual([]);
    expect(await runner.plan('down')).toMatchObject([{ complete: false, reason: expect.stringContaining('not executed') }]);
    expect(upCalls).toBe(0); expect(downCalls).toBe(0);
    const changed = new MigrationRunner(orm, [{ ...migration, down() { throw Error('changed callback'); } }]);
    expect(await changed.status({ readOnly: true })).toMatchObject([{ state: 'changed' }]);
    await expect(changed.plan()).rejects.toThrow('changed checksum');
    await expect(changed.down()).rejects.toThrow('changed checksum');
    expect(await runner.down()).toEqual(['001_legacy']);
    expect(downCalls).toBe(1); expect(await runner.applied({ readOnly: true })).toEqual([]);
  }); } finally { await orm.close(); }
});

it('publishes only bounded own target identifiers without reading adapter getters or unexpected secrets', async () => {
  let reads = 0;
  const tooling = Object.create({ databaseName: 'inherited-not-a-target' });
  Object.assign(tooling, { provider: 'sqlite', target: 'local', password: 'PRIVATE_TARGET_PASSWORD', token: 'PRIVATE_TARGET_TOKEN',
    databaseId: 'https://user:PRIVATE_TARGET_PASSWORD@host/database', binding: 'invalid binding', environment: 'x'.repeat(129) });
  Object.defineProperty(tooling, 'accountId', { get() { reads++; return 'PRIVATE_TARGET_GETTER'; } });
  const orm = createORM({ adapter: { driver: new MemoryDriver(), tooling }, entities: [] });
  try {
    const plan = await orm.run(() => new MigrationRunner(orm, [{ name: '001_target', operations: { up: [], down: [] } }]).plan());
    expect(plan[0]?.target).toEqual({ dialect: 'sqlite', connectionId: expect.any(String), provider: 'sqlite', target: 'local' });
    expect(reads).toBe(0);
    expect(JSON.stringify(plan)).not.toContain('PRIVATE_TARGET');
    expect(JSON.stringify(plan)).not.toContain('inherited-not-a-target');
    tooling.target = 'invalid';
    const invalid = await orm.run(() => new MigrationRunner(orm, [{ name: "001_target", operations: { up: [] } }]).plan());
    expect(invalid[0]?.target).not.toHaveProperty("target");
    expect(reads).toBe(0);
  } finally { await orm.close(); }
});
