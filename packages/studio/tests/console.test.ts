import { createORM } from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { describe, expect, it, vi } from 'vitest';
import {
  createLocalConnection,
  StudioDatabase,
  type StudioConnection,
  type StudioConnectionInfo,
  type StudioQueryResult,
} from '../src/testing';

class FakeConnection implements StudioConnection {
  readonly queries: string[] = [];
  constructor(
    readonly info: StudioConnectionInfo,
    private readonly handler: (sql: string) => Partial<StudioQueryResult>,
  ) {}
  async execute(sql: string): Promise<StudioQueryResult> {
    this.queries.push(sql);
    const result = this.handler(sql);
    return { rows: result.rows ?? [], affectedRows: result.affectedRows ?? 0, durationMs: 1 };
  }
  async close() {}
}

describe('SQL console', () => {
  it('bounds SELECT results in the database instead of materialising every row', async () => {
    const orm = createORM({ adapter: await nodeSQLite({ filename: ':memory:' }), entities: [] });
    const connection = createLocalConnection({ orm, info: { provider: 'sqlite', label: 'big' } });
    await connection.execute(
      'CREATE TABLE big AS WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500) SELECT i FROM n',
    );
    const execute = vi.spyOn(connection, 'execute');
    const studio = new StudioDatabase(connection);
    try {
      const result = await studio.executeSql('SELECT i FROM big ORDER BY i; -- all rows');
      expect(result.error).toBeUndefined();
      expect(result.rows).toHaveLength(1_000);
      expect(result.rows[999]).toEqual({ i: 1_000 });
      expect(result.truncated).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith('SELECT i FROM big ORDER BY i\nLIMIT 1001');
      expect((await execute.mock.results[0]!.value).rows).toHaveLength(1_001);
      const small = await studio.executeSql('SELECT i FROM big WHERE i <= 3');
      expect(small.rows).toHaveLength(3);
      expect(small.truncated).toBe(false);
    } finally {
      await studio.close();
    }
  });

  it('bounds joins with duplicate column names in the database and keeps their columns', async () => {
    const orm = createORM({ adapter: await nodeSQLite({ filename: ':memory:' }), entities: [] });
    const local = createLocalConnection({ orm, info: { provider: 'sqlite', label: 'join' } });
    await local.execute(
      'CREATE TABLE a AS WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 1500) SELECT id, id * 2 AS x FROM n',
    );
    await local.execute('CREATE TABLE b AS SELECT id, id % 3 AS y FROM a');
    // MySQL rejects a derived table that repeats a column name; the bound must
    // not depend on one.
    const mysql = new FakeConnection({ provider: 'mysql', label: 'app', remote: false }, () => ({}));
    mysql.execute = async (sql: string) => {
      mysql.queries.push(sql);
      if (sql.includes('AS __q')) throw new Error("Duplicate column name 'id'");
      return local.execute(sql);
    };
    const statement = 'SELECT * FROM a JOIN b ON b.id = a.id ORDER BY a.id';
    for (const connection of [local, mysql]) {
      const execute = vi.spyOn(connection, 'execute');
      const studio = new StudioDatabase(connection);
      const result = await studio.executeSql(statement);
      expect(result.error).toBeUndefined();
      expect(result.truncated).toBe(true);
      expect(result.rows).toHaveLength(1_000);
      expect(result.columns).toEqual(['id', 'x', 'y']);
      expect(execute.mock.calls.map(([sql]) => sql)).toEqual([`${statement}\nLIMIT 1001`]);
      expect((await execute.mock.results[0]!.value).rows).toHaveLength(1_001);
      execute.mockRestore();
    }
    await local.close();
  });

  it('falls back to the original statement when the bounded form is rejected', async () => {
    const connection = new FakeConnection(
      { provider: 'mysql', label: 'app', remote: false },
      (sql) => {
        if (sql.includes('AS __q')) throw new Error("Duplicate column name 'id'");
        if (sql.startsWith('SELECT a.id')) return { rows: [{ id: 1 }] };
        return { rows: [] };
      },
    );
    const studio = new StudioDatabase(connection);
    const result = await studio.executeSql('SELECT a.id, b.id FROM a JOIN b LIMIT 10');
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([{ id: 1 }]);
  });

  it('parses console input with the connection dialect', async () => {
    const connection = new FakeConnection(
      { provider: 'postgres', label: 'app', remote: false },
      () => ({ rows: [] }),
    );
    const studio = new StudioDatabase(connection);
    const body = 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql';
    expect((await studio.executeSql(`${body};`)).error).toBeUndefined();
    expect(connection.queries).toContain(body);
  });
});
