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
  studio = new StudioDatabase(connection);
  await connection.execute(`
    CREATE TABLE people (
      tenant_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      name TEXT DEFAULT 'unknown',
      age INTEGER,
      photo BLOB,
      PRIMARY KEY (tenant_id, id)
    )
  `);
  await connection.execute('CREATE TABLE logs (message TEXT)');
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
    expect(schema.objects.find((object) => object.name === 'logs')?.readOnlyReason)
      .toContain('no declared primary key');
    expect(schema.objects.find((object) => object.name === 'adult_people')?.readOnlyReason)
      .toContain('Views');
  });

  it('paginates rows in primary-key order', async () => {
    const first = await studio.browse('people', 1);
    const second = await studio.browse('people', 2);
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(5);
    expect(second.rows[0].id).toBe(51);
  });

  it('inserts omitted defaults and nulls, then updates and deletes composite-key rows', async () => {
    await studio.insert('people', {
      tenant_id: { mode: 'value', value: '2' },
      id: { mode: 'value', value: '1' },
      name: { mode: 'omit' },
      age: { mode: 'null' },
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

    await studio.delete('people', { tenant_id: 2, id: 1 });
    selected = await studio.executeSql(
      'SELECT * FROM people WHERE tenant_id = 2 AND id = 1',
    );
    expect(selected.rows).toHaveLength(0);
  });

  it('prevents keyless/view/blob/key/stale grid mutations', async () => {
    await expect(studio.insert('logs', { message: { mode: 'value', value: 'x' } }))
      .rejects.toThrow('primary key');
    await expect(studio.delete('adult_people', { tenant_id: 1, id: 18 }))
      .rejects.toThrow('Views');
    await expect(studio.update('people', { tenant_id: 1, id: 1 }, 'id', {
      mode: 'value', value: '2',
    })).rejects.toThrow('Primary-key');
    await expect(studio.update('people', { tenant_id: 1, id: 1 }, 'photo', {
      mode: 'value', value: 'x',
    })).rejects.toThrow('Blob');
    await expect(studio.delete('people', { tenant_id: 99, id: 99 }))
      .rejects.toThrow('Stale delete');
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
