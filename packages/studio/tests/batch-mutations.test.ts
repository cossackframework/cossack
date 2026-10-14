import { createORM } from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalConnection,
  StudioDatabase,
  type LocalStudioConnection,
  type StudioConnection,
  type StudioQueryResult,
} from '../src/testing';

let connection: LocalStudioConnection;
let studio: StudioDatabase;

async function names(): Promise<Array<{ id: number; name: string | null }>> {
  return (await connection.execute('SELECT id, name FROM items ORDER BY id')).rows as any;
}

beforeEach(async () => {
  const orm = createORM({ adapter: await nodeSQLite({ filename: ':memory:' }), entities: [] });
  connection = createLocalConnection({ orm, info: { provider: 'sqlite', label: 'batch' } });
  await connection.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');
  for (let id = 1; id <= 3; id++) {
    await connection.execute('INSERT INTO items (id, name) VALUES (?, ?)', [id, `Item ${id}`]);
  }
  studio = new StudioDatabase(connection);
});

afterEach(async () => {
  await studio.close();
});

describe('Studio batch mutations', () => {
  it('rolls back a batch delete when a later row is stale', async () => {
    await expect(studio.deleteMany('items', [{ id: 1 }, { id: 2 }, { id: 999 }]))
      .rejects.toThrow(/rolled back/);
    expect(await names()).toHaveLength(3);
  });

  it('rolls back a batch update when a later row is stale', async () => {
    await expect(studio.updateMany('items', [{ id: 1 }, { id: 999 }], 'name', {
      mode: 'null',
    })).rejects.toThrow(/rolled back/);
    expect(await names()).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ]);
  });

  it('rolls back a batch update when a later row violates a constraint', async () => {
    await expect(studio.updateMany('items', [{ id: 1 }, { id: 2 }], 'name', {
      mode: 'value',
      value: 'Same',
    })).rejects.toThrow(/UNIQUE/i);
    expect((await names()).map((row) => row.name)).toEqual(['Item 1', 'Item 2', 'Item 3']);
  });

  it('keeps the connection usable after a rolled-back batch', async () => {
    await expect(studio.deleteMany('items', [{ id: 1 }, { id: 999 }])).rejects.toThrow();
    expect((await studio.deleteMany('items', [{ id: 1 }, { id: 2 }])).affectedRows).toBe(2);
    expect(await names()).toEqual([{ id: 3, name: 'Item 3' }]);
  });

  it('reports best-effort progress for connections without transactions', async () => {
    const statements: string[] = [];
    const fake: StudioConnection = {
      info: { provider: 'd1-remote', label: 'remote', remote: true },
      async execute(sql): Promise<StudioQueryResult> {
        statements.push(sql);
        if (/FROM sqlite_schema/.test(sql)) {
          return { rows: [{ name: 'items', type: 'table', sql: null }], affectedRows: 0, durationMs: 0 };
        }
        if (/^PRAGMA table_xinfo/.test(sql)) {
          return {
            rows: [{ cid: 0, name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1, hidden: 0 }],
            affectedRows: 0,
            durationMs: 0,
          };
        }
        if (/^DELETE/.test(sql)) {
          return { rows: [], affectedRows: sql.includes('999') ? 0 : 1, durationMs: 0 };
        }
        return { rows: [], affectedRows: 0, durationMs: 0 };
      },
      async close() {},
    };
    const remote = new StudioDatabase(fake);
    await expect(remote.deleteMany('items', [{ id: 1 }, { id: 999 }]))
      .rejects.toThrow('Batch delete stopped after 1 row(s)');
  });
});
