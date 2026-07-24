import { createClient } from '@libsql/client';
import { createDatabase } from '@cossackframework/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalConnection,
  StudioDatabase,
  type LocalStudioConnection,
} from '../src/testing';

let connection: LocalStudioConnection;
let studio: StudioDatabase;

beforeEach(async () => {
  const client = createClient({ url: ':memory:' });
  connection = createLocalConnection({
    client: createDatabase({ dialect: 'libsql', client }),
    info: { provider: 'libsql', label: 'fixture' },
  });
  studio = new StudioDatabase(connection, { applicationName: 'Fixture application' });
  await connection.execute(`
    CREATE TABLE people (
      tenant_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      name TEXT DEFAULT 'unknown',
      nickname VARCHAR(80),
      age INTEGER,
      created_at DATETIME,
      profile JSON,
      photo BLOB,
      PRIMARY KEY (tenant_id, id)
    )
  `);
  await connection.execute('CREATE TABLE logs (message TEXT)');
  await connection.execute('CREATE UNIQUE INDEX people_nickname_idx ON people (nickname)');
  await connection.execute('CREATE TABLE blob_keys (id BLOB PRIMARY KEY, value TEXT)');
  await connection.execute(
    'INSERT INTO blob_keys (id, value) VALUES (?, ?)',
    [new Uint8Array([1, 2, 3]), 'blob row'],
  );
  await connection.execute('CREATE VIEW adult_people AS SELECT * FROM people WHERE age >= 18');
  for (let index = 1; index <= 55; index++) {
    await connection.execute(
      'INSERT INTO people (tenant_id, id, name, age) VALUES (?, ?, ?, ?)',
      [1, index, `Person ${index}`, index],
    );
  }
});

afterEach(async () => {
  await studio.close();
});

describe('StudioDatabase', () => {
  it('discovers tables, views, columns, composite keys, and read-only objects', async () => {
    const schema = await studio.getSchema(true);
    expect(schema.applicationName).toBe('Fixture application');
    expect(schema.objects.map((object) => object.name)).toEqual([
      'blob_keys',
      'logs',
      'people',
      'adult_people',
    ]);
    const people = schema.objects.find((object) => object.name === 'people')!;
    expect(people.editable).toBe(true);
    expect(people.columns.filter((column) => column.primaryKeyPosition).map((column) => column.name))
      .toEqual(['tenant_id', 'id']);
    expect(people.columns.find((column) => column.name === 'name')?.declaredKind).toBe('text');
    expect(people.columns.find((column) => column.name === 'nickname')?.declaredKind).toBe('varchar');
    expect(people.columns.find((column) => column.name === 'created_at')?.declaredKind).toBe('datetime');
    expect(people.columns.find((column) => column.name === 'profile')?.declaredKind).toBe('json');
    expect(people.indexes.find((index) => index.name === 'people_nickname_idx')).toMatchObject({
      unique: true,
      columns: [{ name: 'nickname', position: 0, descending: false, collation: 'BINARY' }],
    });
    expect(schema.objects.find((object) => object.name === 'logs')?.readOnlyReason)
      .toContain('no declared primary key');
    expect(schema.objects.find((object) => object.name === 'adult_people')?.readOnlyReason)
      .toContain('Views');
  });

  it('paginates rows in primary-key order', async () => {
    const defaultPage = await studio.browse('people', 1);
    const first = await studio.browse('people', 1, 50);
    const second = await studio.browse('people', 2, 50);
    expect(defaultPage.rows).toHaveLength(55);
    expect(defaultPage.pageSize).toBe(100);
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(5);
    expect(second.rows[0].id).toBe(51);
    expect(second.totalRows).toBe(55);
    expect(second.page).toBe(2);
    expect(second.pageSize).toBe(50);
    expect(second.query).toContain('ORDER BY "tenant_id" ASC, "id" ASC LIMIT 50 OFFSET 50');
  });

  it('filters, sorts, counts, and reports the generated browse query', async () => {
    const result = await studio.browse('people', {
      page: 1,
      pageSize: 25,
      filters: [
        { column: 'name', operator: 'contains', value: 'Person 1' },
        { column: 'age', operator: 'gte', value: '10' },
      ],
      sort: [{ column: 'age', direction: 'desc' }],
    });
    expect(result.totalRows).toBe(10);
    expect(result.rows[0].age).toBe(19);
    expect(result.query).toContain(`"name" LIKE '%Person 1%'`);
    expect(result.query).toContain('"age" >= 10');
    expect(result.query).toContain('ORDER BY "age" DESC');
  });

  it('keeps placeholders inside escaped identifiers while binding browse filters', async () => {
    await connection.execute(
      'CREATE TABLE "odd?""table" ("id?" INTEGER PRIMARY KEY, "value?""column" TEXT)',
    );
    await connection.execute(
      'INSERT INTO "odd?""table" ("id?", "value?""column") VALUES (1, \'matched\')',
    );
    const result = await studio.browse('odd?"table', {
      filters: [{ column: 'value?"column', operator: 'eq', value: 'matched' }],
      sort: [{ column: 'id?', direction: 'desc' }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.query).toContain('"odd?""table"');
    expect(result.query).toContain('"value?""column" = \'matched\'');
    expect(result.query).toContain('ORDER BY "id?" DESC');
  });

  it('inserts omitted defaults and nulls, then updates and deletes composite-key rows', async () => {
    await studio.insert('people', {
      tenant_id: { mode: 'value', value: '2' },
      id: { mode: 'value', value: '1' },
      name: { mode: 'omit' },
      nickname: { mode: 'omit' },
      age: { mode: 'null' },
      created_at: { mode: 'omit' },
      profile: { mode: 'omit' },
      photo: { mode: 'omit' },
    });
    let selected = await studio.executeSql(
      'SELECT name, age FROM people WHERE tenant_id = 2 AND id = 1',
    );
    expect(selected.rows).toEqual([{ name: 'unknown', age: null }]);

    await studio.update('people', { tenant_id: 2, id: 1 }, 'name', {
      mode: 'value',
      value: 'Updated',
    });
    selected = await studio.executeSql(
      'SELECT name FROM people WHERE tenant_id = 2 AND id = 1',
    );
    expect(selected.rows).toEqual([{ name: 'Updated' }]);

    await studio.update('people', { tenant_id: 2, id: 1 }, 'profile', {
      mode: 'value',
      value: '{"enabled":true}',
    });
    await studio.update('people', { tenant_id: 2, id: 1 }, 'created_at', {
      mode: 'value',
      value: '2026-07-25 09:30:00',
    });
    selected = await studio.executeSql(
      'SELECT profile, created_at FROM people WHERE tenant_id = 2 AND id = 1',
    );
    expect(selected.rows).toEqual([{
      profile: '{"enabled":true}',
      created_at: '2026-07-25 09:30:00',
    }]);

    await studio.delete('people', { tenant_id: 2, id: 1 });
    selected = await studio.executeSql(
      'SELECT * FROM people WHERE tenant_id = 2 AND id = 1',
    );
    expect(selected.rows).toHaveLength(0);
  });

  it('edits primary keys and blobs while preventing keyless/view/stale mutations', async () => {
    await expect(studio.insert('logs', { message: { mode: 'value', value: 'x' } }))
      .rejects.toThrow('primary key');
    await expect(studio.delete('adult_people', { tenant_id: 1, id: 18 }))
      .rejects.toThrow('Views');
    await studio.update('people', { tenant_id: 1, id: 1 }, 'id', {
      mode: 'value', value: '101',
    });
    expect((await studio.executeSql(
      'SELECT id FROM people WHERE tenant_id = 1 AND id = 101',
    )).rows).toEqual([{ id: 101 }]);
    await expect(studio.update('people', { tenant_id: 1, id: 1 }, 'photo', {
      mode: 'value', value: 'not base64!',
    })).rejects.toThrow('base64');
    await studio.update('people', { tenant_id: 1, id: 2 }, 'photo', {
      mode: 'value', value: 'AQID',
    });
    expect((await studio.executeSql(
      'SELECT hex(photo) AS photo FROM people WHERE tenant_id = 1 AND id = 2',
    )).rows).toEqual([{ photo: '010203' }]);
    await expect(studio.delete('people', { tenant_id: 99, id: 99 }))
      .rejects.toThrow('Stale delete');
  });

  it('updates and deletes selected rows in batches', async () => {
    const keys = [
      { tenant_id: 1, id: 3 },
      { tenant_id: 1, id: 4 },
    ];
    expect((await studio.updateMany('people', keys, 'name', {
      mode: 'value',
      value: 'Batch updated',
    })).affectedRows).toBe(2);
    expect((await studio.executeSql(
      `SELECT COUNT(*) AS total FROM people WHERE name = 'Batch updated'`,
    )).rows).toEqual([{ total: 2 }]);
    expect((await studio.deleteMany('people', keys)).affectedRows).toBe(2);
    expect((await studio.executeSql(
      'SELECT * FROM people WHERE id IN (3, 4)',
    )).rows).toHaveLength(0);
  });

  it('can identify rows whose primary key is a transported blob', async () => {
    await studio.delete('blob_keys', {
      id: { $type: 'blob', value: 'AQID' },
    });
    expect((await studio.executeSql('SELECT * FROM blob_keys')).rows).toHaveLength(0);
  });

  it('returns SQL errors and refreshes schema after DDL', async () => {
    const failed = await studio.executeSql('SELECT * FROM missing_table');
    expect(failed.error).toContain('missing_table');
    await studio.executeSql('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)');
    expect((await studio.getSchema()).objects.some((object) => object.name === 'projects')).toBe(true);
  });
});
