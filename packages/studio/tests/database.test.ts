import { createORM } from '@cossackframework/orm';
import { libsql } from '@cossackframework/orm/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalConnection,
  StudioDatabase,
  type LocalStudioConnection,
} from '../src/testing';

let connection: LocalStudioConnection;
let studio: StudioDatabase;

beforeEach(async () => {
  const orm = createORM({ adapter: await libsql({ url: ':memory:' }), entities: [] });
  connection = createLocalConnection({
    orm,
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
    expect(schema.connection.databaseVersion).toMatch(/^SQLite \d+/);
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
    expect(schema.objects.find((object) => object.name === 'logs')).toMatchObject({
      editable: true,
      rowLocators: [{
        kind: 'sqlite-rowid',
        columns: ['__cossack_rowid__'],
        source: 'rowid',
      }],
    });
    expect(schema.objects.find((object) => object.name === 'adult_people')?.readOnlyReason)
      .toContain('Views');
  });

  it('discovers composite SQLite foreign-key metadata', async () => {
    await connection.execute(`
      CREATE TABLE accounts (
        tenant_id INTEGER NOT NULL,
        id INTEGER NOT NULL,
        name TEXT,
        PRIMARY KEY (tenant_id, id)
      )
    `);
    await connection.execute(`
      CREATE TABLE invoices (
        tenant_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        total NUMERIC,
        CONSTRAINT invoices_account_fk
          FOREIGN KEY (tenant_id, account_id)
          REFERENCES accounts (tenant_id, id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )
    `);
    const schema = await studio.getSchema(true);
    expect(schema.objects.find((object) => object.name === 'invoices')?.foreignKeys)
      .toEqual([{
        name: 'fk_invoices_0',
        referencedTable: 'accounts',
        columns: [
          { column: 'tenant_id', referencedColumn: 'tenant_id', position: 0 },
          { column: 'account_id', referencedColumn: 'id', position: 1 },
        ],
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      }]);
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
    expect(second.query).toContain(
      'SELECT * FROM "people" ORDER BY "tenant_id" ASC, "id" ASC LIMIT 50 OFFSET 50',
    );
    expect(second.query).not.toContain('__cossack_rowid__');
    expect(second.query).not.toContain('"rowid"');
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

  it('validates explicitly selected insert value types', async () => {
    await studio.insert('people', {
      tenant_id: { mode: 'value', value: '3', valueKind: 'number' },
      id: { mode: 'value', value: '1', valueKind: 'number' },
      name: { mode: 'value', value: 'Typed insert', valueKind: 'text' },
      nickname: {
        mode: 'value',
        value: '018f6f6f-3f3b-7c4d-8f4f-a9c35f7a31d8',
        valueKind: 'uuid-v7',
      },
      age: { mode: 'value', value: '42.5', valueKind: 'number' },
      profile: { mode: 'value', value: '{"enabled":true}', valueKind: 'json' },
      created_at: { mode: 'value', value: '2026-07-25T10:30', valueKind: 'datetime' },
      photo: { mode: 'value', value: '010203', valueKind: 'blob' },
    });
    const selected = await studio.executeSql(
      'SELECT tenant_id, id, nickname, age, profile, created_at, hex(photo) AS photo ' +
      'FROM people WHERE tenant_id = 3 AND id = 1',
    );
    expect(selected.rows).toEqual([{
      tenant_id: 3,
      id: 1,
      nickname: '018f6f6f-3f3b-7c4d-8f4f-a9c35f7a31d8',
      age: 42.5,
      profile: '{"enabled":true}',
      created_at: '2026-07-25T10:30',
      photo: '010203',
    }]);

    await studio.insert('people', {
      tenant_id: { mode: 'value', value: '3', valueKind: 'number' },
      id: { mode: 'value', value: '2', valueKind: 'number' },
      name: { mode: 'value', value: 'Timestamp insert', valueKind: 'text' },
      created_at: {
        mode: 'value',
        value: '2026-07-24T22:57:08.976+02:00',
        valueKind: 'timestamp',
      },
    });
    expect((await studio.executeSql(
      'SELECT created_at FROM people WHERE tenant_id = 3 AND id = 2',
    )).rows).toEqual([{ created_at: '2026-07-24T20:57:08.976Z' }]);

    await expect(studio.insert('people', {
      tenant_id: { mode: 'value', value: '4', valueKind: 'number' },
      id: { mode: 'value', value: '1', valueKind: 'number' },
      name: { mode: 'value', value: 'Invalid JSON' },
      profile: { mode: 'value', value: '{broken', valueKind: 'json' },
    })).rejects.toThrow('Expected valid JSON for profile');
    await expect(studio.insert('people', {
      tenant_id: { mode: 'value', value: '4', valueKind: 'number' },
      id: { mode: 'value', value: '1', valueKind: 'number' },
      name: { mode: 'value', value: 'Invalid UUID' },
      nickname: { mode: 'value', value: 'not-a-uuid', valueKind: 'uuid-v4' },
    })).rejects.toThrow('Expected a UUID v4 for nickname');
    await expect(studio.insert('people', {
      tenant_id: { mode: 'value', value: '4', valueKind: 'number' },
      id: { mode: 'value', value: '1', valueKind: 'number' },
      name: { mode: 'value', value: 'Invalid timestamp' },
      created_at: {
        mode: 'value',
        value: '2026-07-24T20:57:08.976',
        valueKind: 'timestamp',
      },
    })).rejects.toThrow('Expected an ISO 8601 timestamp with a timezone');
  });

  it('edits primary keys, blobs, and SQLite rowid tables while preventing view/stale mutations', async () => {
    await studio.insert('logs', { message: { mode: 'value', value: 'x' } });
    let logs = await studio.browse('logs');
    expect(logs.columns).toEqual(['message']);
    expect(logs.rows[0]).toMatchObject({
      message: 'x',
      __cossack_rowid__: 1,
    });
    await studio.update('logs', { __cossack_rowid__: 1 }, 'message', {
      mode: 'value',
      value: 'updated',
    });
    expect((await studio.executeSql('SELECT message FROM logs')).rows)
      .toEqual([{ message: 'updated' }]);
    await studio.delete('logs', { __cossack_rowid__: 1 });
    logs = await studio.browse('logs');
    expect(logs.rows).toHaveLength(0);

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

  it('updates multiple row properties atomically from a JSON object', async () => {
    await studio.updateRow('people', { tenant_id: 1, id: 1 }, {
      id: 101,
      name: 'Edited as JSON',
      age: 64,
      profile: { enabled: true, roles: ['admin'] },
    });
    expect((await studio.executeSql(
      'SELECT id, name, age, profile FROM people WHERE tenant_id = 1 AND id = 101',
    )).rows).toEqual([{
      id: 101,
      name: 'Edited as JSON',
      age: 64,
      profile: '{"enabled":true,"roles":["admin"]}',
    }]);

    await expect(studio.updateRow('people', { tenant_id: 1, id: 2 }, {
      missing_column: 'value',
    })).rejects.toThrow('Column "missing_column" does not exist');
    await expect(studio.updateRow('people', { tenant_id: 1, id: 2 }, {
      tenant_id: null,
    })).rejects.toThrow('tenant_id does not allow NULL');
    await expect(studio.updateRow('people', { tenant_id: 99, id: 99 }, {
      name: 'stale',
    })).rejects.toThrow('Stale update');
  });

  it('falls back to SQLite rowid when a legacy primary-key value is NULL', async () => {
    await connection.execute('CREATE TABLE nullable_keys (id TEXT PRIMARY KEY, value TEXT)');
    await connection.execute('INSERT INTO nullable_keys (id, value) VALUES (NULL, ?)', ['legacy']);
    const result = await studio.browse('nullable_keys');
    expect(result.columns).toEqual(['id', 'value']);
    expect(result.rows[0]).toMatchObject({
      id: null,
      value: 'legacy',
      __cossack_rowid__: 1,
    });

    await studio.update('nullable_keys', { __cossack_rowid__: 1 }, 'id', {
      mode: 'value',
      value: 'repaired',
    });
    expect((await studio.executeSql('SELECT id, value FROM nullable_keys')).rows)
      .toEqual([{ id: 'repaired', value: 'legacy' }]);
  });

  it('does not invent a SQLite rowid when all aliases are shadowed', async () => {
    await connection.execute(
      'CREATE TABLE shadowed_rows (rowid TEXT, _rowid_ TEXT, oid TEXT, value TEXT)',
    );
    const schema = await studio.getSchema(true);
    expect(schema.objects.find((object) => object.name === 'shadowed_rows')).toMatchObject({
      editable: false,
      rowLocators: [],
      readOnlyReason: 'This table has no safe row locator.',
    });
  });

  it('avoids collisions between hidden row locators and user columns', async () => {
    await connection.execute(
      'CREATE TABLE alias_collision (__cossack_rowid__ TEXT, value TEXT)',
    );
    await connection.execute(
      'INSERT INTO alias_collision (__cossack_rowid__, value) VALUES (?, ?)',
      ['user value', 'row value'],
    );
    const schema = await studio.getSchema(true);
    expect(schema.objects.find((object) => object.name === 'alias_collision')?.rowLocators)
      .toEqual([{
        kind: 'sqlite-rowid',
        columns: ['__cossack_rowid_2__'],
        source: 'rowid',
      }]);
    const result = await studio.browse('alias_collision');
    expect(result.columns).toEqual(['__cossack_rowid__', 'value']);
    expect(result.rows[0]).toMatchObject({
      __cossack_rowid__: 'user value',
      __cossack_rowid_2__: 1,
      value: 'row value',
    });
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

  it('returns a SQLite query plan without executing the statement', async () => {
    const explained = await studio.explainSql(
      'SELECT * FROM people WHERE tenant_id = 1 AND id = 2',
    );
    expect(explained.error).toBeUndefined();
    expect(explained.columns).toContain('detail');
    expect(explained.rows.some((row) =>
      String(row.detail).includes('SEARCH people'))).toBe(true);

    const failed = await studio.explainSql('SELECT * FROM missing_table');
    expect(failed.error).toContain('missing_table');
    await expect(studio.explainSql('SELECT 1; SELECT 2'))
      .rejects.toThrow('one SQL statement');
  });

  it('reads and updates a validated set of SQLite pragmas', async () => {
    const pragmas = await studio.getPragmas();
    expect(pragmas.find((pragma) => pragma.name === 'foreign_keys')).toMatchObject({
      kind: 'boolean',
      options: [
        { value: '0', label: 'Off' },
        { value: '1', label: 'On' },
      ],
    });
    expect(pragmas.find((pragma) => pragma.name === 'user_version')).toMatchObject({
      value: '0',
      kind: 'number',
    });

    const updated = await studio.setPragma('user_version', '42');
    expect(updated.find((pragma) => pragma.name === 'user_version')?.value).toBe('42');
    await expect(studio.setPragma('not_a_real_pragma', '1'))
      .rejects.toThrow('not editable');
    await expect(studio.setPragma('user_version', '1; DROP TABLE people'))
      .rejects.toThrow('expects an integer');
    await expect(studio.setPragma('journal_mode', 'INVALID'))
      .rejects.toThrow('Invalid value');
  });
});
