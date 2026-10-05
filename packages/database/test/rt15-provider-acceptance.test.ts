import 'reflect-metadata';
import { it, expect } from 'vitest';
import { Entity, Column, PrimaryGeneratedColumn, BaseEntity } from '../src/index.js';
import { createORM } from '../src/orm.js';
import { nodeSQLite, postgres, mysql } from '../src/runtime/node.js';
import { turso } from '../src/runtime/turso.js';
import { D1Driver, type D1DatabaseBinding } from '../src/runtime/cloudflare.js';
import { SchemaBuilder } from '../src/schema/builder.js';
import type { Adapter } from '../src/adapter/types.js';

@Entity({ tableName: 'rt15_generated_acceptance' })
class ProviderGenerated extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: 'text' }) declare value: string;
}
const providers: [string, () => Promise<Adapter>, boolean][] = [
  ['sqlite', () => nodeSQLite(), true],
  ['turso', () => turso({ path: ':memory:' }), true],
  ['postgres', () => postgres(process.env.COSSACK_TEST_POSTGRES_URL!), !!process.env.COSSACK_TEST_POSTGRES_URL],
  ['mysql', () => mysql(process.env.COSSACK_TEST_MYSQL_URL!), !!process.env.COSSACK_TEST_MYSQL_URL],
];
for (const [provider, factory, available] of providers) {
  it.skipIf(!available)(`proves generated values, commit, rollback and nested savepoints on actual ${provider}`, async () => {
    const orm = createORM({ adapter: await factory(), entities: [ProviderGenerated] });
    try { await orm.run(async () => {
      await orm.executeFragment(orm.sql.unsafe(`DROP TABLE IF EXISTS rt15_generated_acceptance`), 'ddl');
      await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
      const created = ProviderGenerated.create({ value: 'generated' }); await created.save(); expect(created.id).toBeGreaterThan(0);
      const report = orm.inspectCapabilities();
      expect(report.transactions.interactive).toBe(true); expect(report.generated.increment).toBe(true);
      expect(report.transactions.ddlRollback).toBe(provider !== 'mysql');
      await orm.transaction(async () => { await ProviderGenerated.create({ value: 'committed' }).save(); });
      await expect(orm.transaction(async () => {
        await ProviderGenerated.create({ value: 'rolled-back' }).save(); throw Error('rollback requested');
      })).rejects.toThrow('rollback requested');
      expect(await ProviderGenerated.count()).toBe(2);
      await orm.transaction(async () => {
        await ProviderGenerated.create({ value: 'outer' }).save();
        await expect(orm.transaction(async () => {
          await ProviderGenerated.create({ value: 'nested-rollback' }).save(); throw Error('nested rollback');
        })).rejects.toThrow('nested rollback');
        await orm.transaction(async () => { await ProviderGenerated.create({ value: 'nested-commit' }).save(); });
      });
      const rows = await ProviderGenerated.query().orderBy('id').getMany();
      expect(rows.map(row => row.value)).toEqual(['generated', 'committed', 'outer', 'nested-commit']);
      await orm.executeFragment(orm.sql.unsafe('DROP TABLE rt15_generated_acceptance'), 'ddl');
    }); } finally { await orm.close(); }
  }, 30000);
}

it('reports D1 atomic batches and rejects interactive transactions before callbacks or SQL', async () => {
  let effects = 0;
  const binding: D1DatabaseBinding = {
    prepare() { effects++; throw Error('must not prepare SQL'); },
    async batch() { effects++; return []; },
  };
  const orm = createORM({ adapter: { driver: new D1Driver(binding), tooling: { provider: 'd1', target: 'local' } }, entities: [] });
  try {
    expect(orm.inspectCapabilities()).toMatchObject({ provider: 'd1', transactions: { interactive: false, nested: false, atomicBatch: true, ddlRollback: false } });
    await expect(orm.transaction(async () => { effects++; })).rejects.toThrow('interactive transactions');
    expect(effects).toBe(0);
  } finally { await orm.close(); }
});

it('rejects an unsupported queued SQLite schema change before earlier DDL effects', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [ProviderGenerated] });
  try { await orm.run(async () => {
    const entity = orm.schema().entities[0]!;
    const builder = new SchemaBuilder().createTable(entity);
    const original = entity.columns.find(column => column.propertyName === 'value')!;
    const operations = builder as unknown as { queue: unknown[] };
    operations.queue.push({ kind: 'alter-column', tableName: entity.tableName, before: original, after: { ...original, logicalType: 'integer' } });
    await expect(builder.execute(orm)).rejects.toThrow('direct SQLite alter column');
    expect((await orm.executeFragment(orm.sql.fragment`SELECT name FROM sqlite_master WHERE name = ${entity.tableName}`)).rows).toEqual([]);
  }); } finally { await orm.close(); }
});
