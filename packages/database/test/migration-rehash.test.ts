import { expect, it, vi } from 'vitest';
import { createORM } from '../src/orm.js';
import { nodeSQLite } from '../src/runtime/node.js';
import { MemoryDriver } from '../src/adapter/memory.js';
import { MigrationRunner } from '../src/migration/runner.js';
import type { Migration } from '../src/migration/types.js';

it('accepts only selected applied checksums without changing data, batches, dates, or executing callbacks', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    const migrations: Migration[] = ['001_addresses', '002_outreach', '003_unrelated'].map(name => ({
      name, up({ schema, orm }) { schema.raw(orm.sql.unsafe(`CREATE TABLE ${name.slice(4)} (id integer)`)); },
      down({ schema }) { schema.dropTable(name.slice(4)); },
    }));
    const original = new MigrationRunner(orm, migrations, 'custom_history');
    await original.up();
    await orm.executeFragment(orm.sql.unsafe('INSERT INTO addresses VALUES (7)'), 'insert');
    const before = await original.applied();
    const callback = vi.fn(() => { throw Error('Rehash must never run migration callbacks'); });
    const edited = new MigrationRunner(orm, [
      ...migrations.slice(0, 2).map(migration => ({ ...migration, up: callback, down: callback })),
      migrations[2]!, { name: '004_pending', up: callback, down: callback },
    ], 'custom_history');
    await expect(edited.up()).rejects.toThrow('changed checksum');
    await expect(edited.plan()).rejects.toThrow('changed checksum');
    const preview = await edited.rehash(['001_addresses', '002_outreach'], { dryRun: true });
    expect(preview).toMatchObject(before.slice(0, 2).map(row => ({ name: row.name, previousChecksum: row.checksum })));
    expect(await original.applied()).toEqual(before);
    expect(await edited.rehash(['001_addresses', '002_outreach'])).toEqual(preview);
    const after = await edited.applied();
    expect(after.map(({ checksum: _checksum, ...row }) => row)).toEqual(before.map(({ checksum: _checksum, ...row }) => row));
    expect(after[2]).toEqual(before[2]);
    expect((await edited.status({ readOnly: true })).map(row => row.state)).toEqual(['applied', 'applied', 'applied', 'pending']);
    expect((await orm.executeFragment(orm.sql.unsafe('SELECT * FROM addresses'))).rows).toEqual([{ id: 7 }]);
    expect(callback).not.toHaveBeenCalled();
    expect(await edited.rehash(['001_addresses', '002_outreach'])).toEqual(preview.map(row => ({ ...row, previousChecksum: row.checksum })));
    expect(await edited.plan()).toMatchObject([{ name: '004_pending', complete: false }]);
  }); } finally { await orm.close(); }
});

it('validates every name before writing and leaves unselected changed migrations blocked', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    const original = [{ name: '001_first', operations: { up: [], down: [] } }, { name: '002_second', operations: { up: [], down: [] } }];
    await new MigrationRunner(orm, original).up();
    const runner = new MigrationRunner(orm, [
      ...original.map(migration => ({ ...migration, operations: { up: [orm.sql.unsafe('SELECT 1')], down: [] } })),
      { name: '003_pending', operations: { up: [], down: [] } },
    ]);
    const before = await runner.applied();
    for (const [names, message] of [
      [[], 'at least one'], [['001_first', '001_first'], 'unique'],
      [['001_first', 'unknown'], 'Unknown migration'], [['001_first', '003_pending'], 'not applied'],
    ] as const) {
      await expect(runner.rehash(names)).rejects.toThrow(message);
      expect(await runner.applied()).toEqual(before);
    }
    await runner.rehash(['001_first']);
    expect((await runner.status({ readOnly: true })).map(row => row.state)).toEqual(['applied', 'changed', 'pending']);
    await expect(runner.up()).rejects.toThrow('002_second');
    await expect(runner.down()).rejects.toThrow('002_second');
  }); } finally { await orm.close(); }
});

it('rejects pending migrations without creating history on a fresh database', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try {
    const runner = new MigrationRunner(orm, [{ name: '001_pending', operations: { up: [] } }]);
    await expect(runner.rehash(['001_pending'])).rejects.toThrow('not applied');
    const tables = await orm.executeFragment(orm.sql.unsafe("SELECT name FROM sqlite_master WHERE type = 'table'"));
    expect(tables.rows).toEqual([]);
  } finally { await orm.close(); }
});

it('rolls back all checksum updates if a later update fails', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [] });
  try { await orm.run(async () => {
    const migrations = ['001_first', '002_second'].map(name => ({ name, operations: { up: [], down: [] } }));
    await new MigrationRunner(orm, migrations).up();
    const runner = new MigrationRunner(orm, migrations.map(migration => ({ ...migration, operations: { up: [orm.sql.unsafe('SELECT 1')], down: [] } })));
    const before = await runner.applied();
    await orm.executeFragment(orm.sql.unsafe("CREATE TRIGGER reject_checksum BEFORE UPDATE ON _cossack_migrations WHEN NEW.name = '002_second' BEGIN SELECT RAISE(ABORT, 'rejected'); END"), 'ddl');
    await expect(runner.rehash(['001_first', '002_second'])).rejects.toThrow();
    expect(await runner.applied()).toEqual(before);
  }); } finally { await orm.close(); }
});

it.each(['sqlite', 'postgres', 'mysql'] as const)('uses one parameterized batch for a %s provider without transactions', async dialect => {
  const history = ['001_first', '002_second'].map(name => ({ name, checksum: 'old', batch: 1, applied_at: '2026-01-01T00:00:00Z' }));
  const driver = new MemoryDriver(dialect, query => ({ rows: query.text.startsWith('SELECT') && query.text.includes('checksum') ? history : [{ name: 'history' }] }));
  const batch = vi.fn(driver.batch.bind(driver));
  const orm = createORM({ adapter: { driver: {
    dialect, capabilities: { ...driver.capabilities, transactions: false },
    execute: driver.execute.bind(driver), batch, close: driver.close.bind(driver),
  } }, entities: [] });
  try {
    const runner = new MigrationRunner(orm, history.map(row => ({ name: row.name, operations: { up: [], down: [] } })));
    const results = await runner.rehash(history.map(row => row.name));
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![0]).toEqual(results.map(row => ({
      operation: 'update', query: {
        text: expect.stringContaining('UPDATE'), parameters: [row.checksum, row.name],
      },
    })));
    expect(driver.statements.filter(statement => statement.operation !== 'select')).toHaveLength(2);
  } finally { await orm.close(); }
});

it('rejects an oversized batch before writing', async () => {
  const driver = new MemoryDriver('sqlite', query => ({ rows: query.text.startsWith('PRAGMA') ? [{}] : ['001_first', '002_second'].map(name => ({ name, checksum: 'old', batch: 1, applied_at: '2026-01-01T00:00:00Z' })) }));
  const batch = vi.fn(driver.batch.bind(driver));
  const orm = createORM({ adapter: { driver: {
    dialect: driver.dialect, capabilities: { ...driver.capabilities, transactions: false, batchLimit: 1 },
    execute: driver.execute.bind(driver), batch, close: driver.close.bind(driver),
  } }, entities: [] });
  try {
    const runner = new MigrationRunner(orm, ['001_first', '002_second'].map(name => ({ name, operations: { up: [] } })));
    await expect(runner.rehash(['001_first', '002_second'])).rejects.toThrow('batch limit');
    expect(batch).not.toHaveBeenCalled();
    expect(driver.statements.every(statement => statement.operation === 'select')).toBe(true);
  } finally { await orm.close(); }
});
