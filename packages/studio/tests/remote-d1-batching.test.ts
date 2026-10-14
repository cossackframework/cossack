import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RemoteD1Connection,
  StudioDatabase,
  type WranglerCommandResult,
} from '../src/testing';
import { chunkStatements } from '../src/lib/batch';

const { unstable_splitSqlQuery: splitSql } = createRequire(import.meta.url)('wrangler') as {
  unstable_splitSqlQuery(sql: string): string[];
};
// PRAGMAs D1 allows; the others fail with SQLITE_AUTH like on D1.
const D1_PRAGMAS = new Set([
  'table_list', 'table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo',
  'quick_check', 'foreign_key_check', 'foreign_key_list', 'case_sensitive_like',
  'ignore_check_constraints', 'legacy_alter_table', 'recursive_triggers',
  'reverse_unordered_selects', 'foreign_keys', 'defer_foreign_keys', 'optimize',
]);

/**
 * A stand-in for `wrangler d1 execute --remote --json --command`: each call
 * is one Wrangler process. Statements of one command run as one D1 batch in
 * a transaction, against an in-memory SQLite database.
 */
class FakeWrangler {
  readonly database = new DatabaseSync(':memory:');
  commands: string[][] = [];

  constructor() {
    this.database.exec('PRAGMA foreign_keys = OFF');
  }

  readonly execute = async (
    _command: string,
    args: readonly string[],
  ): Promise<WranglerCommandResult> => {
    const statements = splitSql(args[args.indexOf('--command') + 1]!);
    this.commands.push(statements);
    const results: unknown[] = [];
    this.database.exec('BEGIN');
    try {
      for (const statement of statements) {
        const pragma = /^\s*PRAGMA\s+(\w+)/i.exec(statement)?.[1]?.toLowerCase();
        if (pragma && !D1_PRAGMAS.has(pragma)) throw new Error('not authorized: SQLITE_AUTH');
        const prepared = this.database.prepare(statement);
        if (/^\s*(SELECT|PRAGMA|WITH)/i.test(statement)) {
          results.push({ success: true, results: prepared.all(), meta: { changes: 0 } });
        } else {
          const run = prepared.run();
          results.push({ success: true, results: [], meta: { changes: Number(run.changes) } });
        }
      }
      this.database.exec('COMMIT');
    } catch (error: any) {
      this.database.exec('ROLLBACK');
      return { stdout: '', stderr: error.message, exitCode: 1 };
    }
    return { stdout: JSON.stringify(results), stderr: '', exitCode: 0 };
  };

  /** Wrangler processes started since the last call. */
  take(): string[][] {
    const commands = this.commands;
    this.commands = [];
    return commands;
  }
}

let wrangler: FakeWrangler;
let studio: StudioDatabase;

function createTables(count: number) {
  for (let table = 0; table < count; table++) {
    wrangler.database.exec(`
      CREATE TABLE t${table} (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, parent_id INTEGER REFERENCES t0(id));
      CREATE INDEX t${table}_name ON t${table}(name);
      CREATE UNIQUE INDEX t${table}_code ON t${table}(code, parent_id);
    `);
    const insert = wrangler.database.prepare(
      `INSERT INTO t${table} (id, name, code, parent_id) VALUES (?, ?, ?, ?)`,
    );
    for (let id = 1; id <= 120; id++) insert.run(id, `row ${id}`, `c${id}`, id % 5);
  }
}

beforeEach(() => {
  wrangler = new FakeWrangler();
  studio = new StudioDatabase(new RemoteD1Connection(
    { projectRoot: process.cwd(), execute: wrangler.execute, wrangler: { command: 'wrangler', args: [] } },
    { binding: 'DB' },
  ));
});

afterEach(async () => {
  await studio.close();
  wrangler.database.close();
});

describe('remote D1 batching', () => {
  it('introspects with a fixed number of Wrangler processes regardless of table count', async () => {
    createTables(3);
    const small = await studio.getSchema();
    expect(small.objects).toHaveLength(3);
    // sqlite_version(), object list, per-object PRAGMAs, per-index PRAGMAs.
    expect(wrangler.take()).toHaveLength(4);
    wrangler.database.exec(Array.from({ length: 9 }, (_, index) =>
      `CREATE TABLE extra${index} (id INTEGER PRIMARY KEY, label TEXT);` +
      `CREATE INDEX extra${index}_label ON extra${index}(label);`).join('\n'));
    const large = await studio.getSchema(true);
    expect(large.objects).toHaveLength(12);
    expect(wrangler.take()).toHaveLength(3);
    const t1 = large.objects.find((object) => object.name === 't1')!;
    expect(t1.indexes.map((index) => [index.name, index.columns.map((column) => column.name)]))
      .toEqual(expect.arrayContaining([['t1_name', ['name']], ['t1_code', ['code', 'parent_id']]]));
    expect(t1.foreignKeys).toEqual([expect.objectContaining({
      referencedTable: 't0',
      columns: [{ column: 'parent_id', referencedColumn: 'id', position: 0 }],
    })]);
    expect(t1.rowLocators[0]).toEqual({ kind: 'primary-key', columns: ['id'] });
  });

  it('browses with one process, reuses the cached schema, and refreshes after DDL', async () => {
    createTables(2);
    await studio.getSchema();
    wrangler.take();
    const first = await studio.browse('t1', { page: 2, pageSize: 50 });
    expect(first).toMatchObject({ totalRows: 120, page: 2, pageSize: 50 });
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]).toMatchObject({ id: 51 });
    expect(wrangler.take()).toEqual([[
      expect.stringMatching(/^SELECT COUNT\(\*\)/),
      expect.stringMatching(/LIMIT 50 OFFSET 50$/),
    ]]);
    await studio.browse('t1', { page: 1, pageSize: 50 });
    expect(wrangler.take()).toHaveLength(1);
    expect((await studio.executeSql('CREATE TABLE added (id INTEGER PRIMARY KEY)')).error)
      .toBeUndefined();
    wrangler.take();
    await studio.browse('added');
    const reload = wrangler.take();
    expect(reload.flat().filter((sql) => /FROM\s+sqlite_schema/i.test(sql))).toHaveLength(1);
    expect(reload).toHaveLength(4);
  });

  it('fetches the last page again only when the requested page is past the end', async () => {
    createTables(1);
    await studio.getSchema();
    wrangler.take();
    const result = await studio.browse('t0', { page: 9, pageSize: 50 });
    expect(result).toMatchObject({ page: 3, totalRows: 120 });
    expect(result.rows.map((row) => row.id)).toEqual(Array.from({ length: 20 }, (_, index) => 101 + index));
    expect(result.query).toMatch(/LIMIT 50 OFFSET 100$/);
    expect(wrangler.take()).toHaveLength(2);
  });

  it('runs a single-row mutation and the following browse with two processes', async () => {
    createTables(1);
    await studio.getSchema();
    wrangler.take();
    await studio.update('t0', { id: 1 }, 'name', { mode: 'value', value: 'renamed' });
    const page = await studio.browse('t0', { page: 1, pageSize: 10 });
    expect(page.rows[0]).toMatchObject({ id: 1, name: 'renamed' });
    expect(wrangler.take()).toHaveLength(2);
  });

  it('sends batch deletes and updates in chunks instead of one process per row', async () => {
    createTables(1);
    await studio.getSchema();
    wrangler.take();
    const keys = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }));
    expect((await studio.deleteMany('t0', keys)).affectedRows).toBe(60);
    expect(wrangler.take().map((command) => command.length)).toEqual([50, 10]);
    const remaining = Array.from({ length: 60 }, (_, index) => ({ id: index + 61 }));
    expect((await studio.updateMany('t0', remaining, 'name', { mode: 'value', value: 'bulk' }))
      .affectedRows).toBe(60);
    expect(wrangler.take()).toHaveLength(2);
    expect(wrangler.database.prepare("SELECT COUNT(*) AS n FROM t0 WHERE name = 'bulk'").get())
      .toEqual({ n: 60 });
  });

  it('reports stale rows and failing batches with the number of changed rows', async () => {
    createTables(1);
    await studio.getSchema();
    await expect(studio.deleteMany('t0', [{ id: 1 }, { id: 999 }, { id: 2 }]))
      .rejects.toThrow('Batch delete stopped after 2 row(s): 1 selected row(s) were stale.');
    const ids = Array.from({ length: 55 }, (_, index) => ({ id: index + 10 }));
    await expect(studio.updateMany('t0', ids, 'code', { mode: 'value', value: 'same' }))
      .rejects.toThrow(/Batch update stopped after 0 row\(s\): .*UNIQUE/);
    expect(wrangler.database.prepare("SELECT COUNT(*) AS n FROM t0 WHERE code = 'same'").get())
      .toEqual({ n: 0 });
  });

  it('learns which PRAGMAs D1 allows once and then reads them in one process', async () => {
    createTables(1);
    const first = await studio.getPragmas();
    expect(first.map((pragma) => pragma.name)).toEqual([
      'foreign_keys', 'ignore_check_constraints', 'legacy_alter_table',
      'recursive_triggers', 'reverse_unordered_selects',
    ]);
    wrangler.take();
    expect(await studio.getPragmas()).toEqual(first);
    expect(wrangler.take()).toHaveLength(1);
    const updated = await studio.setPragma('recursive_triggers', '1');
    expect(updated.find((pragma) => pragma.name === 'recursive_triggers')?.value).toBe('1');
    expect(wrangler.take()).toHaveLength(2);
  });
});

describe('batch chunking', () => {
  it('limits statements and characters per batch', () => {
    const statements = Array.from({ length: 7 }, (_, index) => ({ sql: `SELECT ${index}` }));
    expect(chunkStatements(statements, 3, 1_000).map((chunk) => chunk.length)).toEqual([3, 3, 1]);
    const long = [{ sql: 'x'.repeat(40) }, { sql: 'y'.repeat(40) }, { sql: 'z'.repeat(100) }];
    expect(chunkStatements(long, 50, 90).map((chunk) => chunk.length)).toEqual([2, 1]);
  });
});
