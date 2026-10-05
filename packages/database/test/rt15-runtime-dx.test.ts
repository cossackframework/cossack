import 'reflect-metadata';
import { it, expect } from 'vitest';
import { BaseEntity, Entity, Column, PrimaryGeneratedColumn, PrimaryColumn, ManyToOne, OneToMany, JoinColumn } from '../src/index.js';
import { createORM } from '../src/orm.js';
import { nodeSQLite } from '../src/runtime/node.js';
import { MemoryDriver } from '../src/adapter/memory.js';
import type { LoggerEvent } from '../src/adapter/types.js';
import { SchemaBuilder } from '../src/schema/builder.js';
import { redactSqlStructure } from '../src/query/diagnostics.js';

@Entity()
class OrderedRecord extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: 'integer' }) declare rank: number;
  @Column({ type: 'text', default: 'PRIVATE_METADATA_DEFAULT' }) declare name: string;
}
@Entity() class TargetRecord extends BaseEntity { @PrimaryColumn({ type: 'integer' }) declare id: number; }

it('exposes detached finalized metadata without classes, hooks or default values', async () => {
  const orm = createORM({ adapter: { driver: new MemoryDriver() }, entities: [OrderedRecord] });
  const metadata = orm.inspectMetadata();
  expect(metadata).toMatchObject([{ modelName: 'OrderedRecord', primaryProperties: ['id'], columns: expect.arrayContaining([
    { propertyName: 'name', columnName: 'name', logicalType: 'text', nullable: false, primary: false, generated: false, unique: false, hasDefault: true },
  ]) }]);
  expect(JSON.stringify(metadata)).not.toContain('PRIVATE_METADATA_DEFAULT');
  expect(Object.isFrozen(metadata[0]?.columns)).toBe(true);
  await orm.close();
});

it('reports both relationship entities and fields before any query effect', () => {
  @Entity() class MissingReference extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) declare id: number;
    @ManyToOne(() => TargetRecord) @JoinColumn({ referencedColumnName: 'missing' }) declare parent: TargetRecord;
  }
  const driver = new MemoryDriver();
  expect(() => createORM({ adapter: { driver }, entities: [MissingReference, TargetRecord] }))
    .toThrow('MissingReference.parent references missing field TargetRecord.missing');
  @Entity() class WrongInverse extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) declare id: number;
    @ManyToOne(() => TargetRecord, target => (target as unknown as { absent: unknown }).absent) declare target: TargetRecord;
  }
  expect(() => createORM({ adapter: { driver }, entities: [WrongInverse, TargetRecord] })).toThrow('WrongInverse.target points to missing inverse TargetRecord.absent');
  @Entity() class MismatchedParent extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) declare id: number;
    @OneToMany(() => MismatchedChild, child => child.parent) declare children: MismatchedChild[];
  }
  @Entity() class MismatchedChild extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) declare id: number;
    @ManyToOne(() => TargetRecord) declare parent: TargetRecord;
  }
  expect(() => createORM({ adapter: { driver }, entities: [MismatchedParent, MismatchedChild, TargetRecord] }))
    .toThrow('MismatchedParent.children inverse MismatchedChild.parent does not target MismatchedParent');
  expect(driver.statements).toEqual([]);
});

it('emits SQL structure, typed parameter markers and provider/outcome without literals or driver errors', async () => {
  const events: LoggerEvent[] = [];
  const privateFailure = Object.assign(Error('PRIVATE_DRIVER_MESSAGE'), { token: 'PRIVATE_DRIVER_TOKEN' });
  const driver = new MemoryDriver('postgres', query => { if (query.text.includes('FAIL')) throw privateFailure; return { rows: [] }; });
  const orm = createORM({ adapter: { driver, tooling: { provider: 'postgres', target: 'local' } }, entities: [], logger: event => events.push(event) });
  try { await orm.run(async () => {
    await orm.executeFragment(orm.sql.fragment`SELECT ${'PRIVATE_PARAMETER'}, ${42}, ${new Uint8Array([1, 2])}`);
    await expect(orm.executeFragment(orm.sql.unsafe("SELECT 'PRIVATE_LITERAL', $$PRIVATE_DOLLAR$$, 123 /* PRIVATE_COMMENT */ -- PRIVATE_LINE\n FAIL"))).rejects.toThrow();
    expect(events).toMatchObject([{ provider: 'postgres', outcome: 'success', parameters: ['<string>', '<number>', '<binary:2>'] },
      { provider: 'postgres', outcome: 'failure', code: 'COSSACK_DATABASE_QUERY_FAILED', sql: 'SELECT ?, ?, ? FAIL' }]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
    expect(events.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0)).toBe(true);
    expect(events.every(event => !Object.hasOwn(event, 'error'))).toBe(true);
    expect(redactSqlStructure('SELECT "PRIVATE_SQLITE_LITERAL", `PRIVATE_MYSQL_LITERAL`')).not.toContain('PRIVATE_');
  }); } finally { await orm.close(); }
});

it('rejects parameter limits and unsupported generated values before effects or application hooks', async () => {
  const driver = new MemoryDriver(); Object.assign(driver.capabilities, { parameterLimit: 1 });
  const orm = createORM({ adapter: { driver }, entities: [] });
  try { await expect(orm.run(() => orm.executeFragment(orm.sql.fragment`SELECT ${1}, ${2}`))).rejects.toThrow('query parameter limit');
    expect(driver.statements).toEqual([]);
  } finally { await orm.close(); }
  @Entity() class IdentityRecord extends BaseEntity { @PrimaryGeneratedColumn('identity') declare id: number; }
  const unsupported = new MemoryDriver('sqlite');
  expect(() => createORM({ adapter: { driver: unsupported }, entities: [IdentityRecord] })).toThrow('IdentityRecord.id');
  expect(unsupported.statements).toEqual([]);
  const mysqlUnsupported = new MemoryDriver('mysql');
  const mysqlORM = createORM({ adapter: { driver: mysqlUnsupported }, entities: [] });
  expect(mysqlORM.inspectCapabilities().generated).toMatchObject({ increment: true, identity: false });
  await mysqlORM.close();
  expect(() => createORM({ adapter: { driver: mysqlUnsupported }, entities: [IdentityRecord] })).toThrow('IdentityRecord.id');
  expect(mysqlUnsupported.statements).toEqual([]);
});

it('keeps tied offset pages in primary-key order, handles offset without limit and restores aggregate pagination', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [OrderedRecord] });
  try { await orm.run(async () => {
    await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
    for (let id = 1; id <= 6; id++) await orm.model(OrderedRecord).insertQuery({ id, rank: 1, name: 'record' }).execute();
    const pages = await Promise.all([0, 2, 4].map(offset => OrderedRecord.query().orderBy('rank').offset(offset).limit(2).getMany()));
    expect(pages.map(page => page.map(record => record.id))).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect((await OrderedRecord.query().offset(4).getMany()).map(record => record.id)).toEqual([5, 6]);
    const query = OrderedRecord.query().orderBy('rank').limit(2).offset(2);
    expect(await query.count()).toBe(6); expect(await query.sum('id')).toBe(21);
    expect((await query.getMany()).map(record => record.id)).toEqual([3, 4]);
    expect(() => OrderedRecord.query().orderBy('rank', 'desc;DROP' as 'desc')).toThrow('direction');
    expect(() => OrderedRecord.query().select('rank').limit(2).toSQL()).toThrow('explicit unique ordering');
  }); } finally { await orm.close(); }
});

it('keeps actual SQLite transaction results when a diagnostic observer throws', async () => {
  const orm = createORM({ adapter: await nodeSQLite(), entities: [OrderedRecord], logger() { throw Error('observer failure'); } });
  try { await orm.run(async () => {
    await new SchemaBuilder().createTable(orm.schema().entities[0]!).execute(orm);
    await orm.transaction(async () => { await OrderedRecord.create({ rank: 1, name: 'committed' }).save(); });
    expect(await OrderedRecord.count()).toBe(1);
    await expect(orm.transaction(async () => {
      await OrderedRecord.create({ rank: 1, name: 'rolled back' }).save(); throw Error('requested rollback');
    })).rejects.toThrow('requested rollback');
    expect(await OrderedRecord.count()).toBe(1);
  }); } finally { await orm.close(); }
});

it('rejects unsupported nested transactions before the callback or savepoint SQL', async () => {
  const driver = new MemoryDriver(); Object.assign(driver.capabilities, { savepoints: false });
  const orm = createORM({ adapter: { driver }, entities: [] });
  let nestedEntries = 0;
  try { await orm.transaction(async () => {
    const before = driver.statements.length;
    await expect(orm.transaction(async () => { nestedEntries++; })).rejects.toThrow('nested transactions/savepoints');
    expect(nestedEntries).toBe(0); expect(driver.statements.length).toBe(before);
  }); } finally { await orm.close(); }
});
