import { createORM } from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalConnection,
  StudioDatabase,
  type LocalStudioConnection,
} from '../src/testing';

let connection: LocalStudioConnection;
let studio: StudioDatabase;
let introspections = 0;
let inspect: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const orm = createORM({ adapter: await nodeSQLite({ filename: ':memory:' }), entities: [] });
  connection = createLocalConnection({ orm, info: { provider: 'sqlite', label: 'cache' } });
  await connection.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
  for (let id = 1; id <= 3; id++) {
    await connection.execute('INSERT INTO items (id, name) VALUES (?, ?)', [id, `Item ${id}`]);
  }
  introspections = 0;
  const execute = connection.execute.bind(connection);
  vi.spyOn(connection, 'execute').mockImplementation((sql, parameters) => {
    if (/FROM\s+sqlite_schema/i.test(sql)) introspections++;
    return execute(sql, parameters);
  });
  const originalInspect = connection.inspect.bind(connection);
  inspect = vi.fn(() => originalInspect());
  connection.inspect = inspect as any;
  studio = new StudioDatabase(connection);
});

afterEach(async () => {
  await studio.close();
});

describe('Studio schema cache', () => {
  it('introspects once for repeated browses and does not run migration inspection', async () => {
    await studio.browse('items');
    await studio.browse('items', { page: 1, pageSize: 2 });
    expect(introspections).toBe(1);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('does not re-introspect for row mutations', async () => {
    await studio.getSchema();
    await studio.update('items', { id: 1 }, 'name', { mode: 'value', value: 'Renamed' });
    await studio.updateRow('items', { id: 2 }, { name: 'Changed' });
    await studio.insert('items', {
      id: { mode: 'value', value: '4' },
      name: { mode: 'value', value: 'Four' },
    });
    await studio.delete('items', { id: 4 });
    await studio.deleteMany('items', [{ id: 3 }]);
    await studio.updateMany('items', [{ id: 1 }], 'name', { mode: 'null' });
    await studio.browse('items');
    expect(introspections).toBe(1);
  });

  it('keeps the cache for read-only console statements', async () => {
    await studio.getSchema();
    expect((await studio.executeSql('SELECT * FROM items')).error).toBeUndefined();
    expect((await studio.executeSql('WITH x AS (SELECT 1) SELECT * FROM x')).error)
      .toBeUndefined();
    await studio.getSchema();
    expect(introspections).toBe(1);
  });

  it('invalidates the cache after DDL from the SQL console', async () => {
    await studio.getSchema();
    expect((await studio.executeSql('CREATE TABLE extra (id INTEGER PRIMARY KEY)')).error)
      .toBeUndefined();
    const schema = await studio.getSchema();
    expect(schema.objects.map((object) => object.name)).toContain('extra');
    expect(introspections).toBe(2);
    await studio.browse('extra');
    expect(introspections).toBe(2);
  });

  it('invalidates the cache after console writes and PRAGMA statements', async () => {
    await studio.getSchema();
    await studio.executeSql("INSERT INTO items (id, name) VALUES (9, 'nine')");
    await studio.getSchema();
    expect(introspections).toBe(2);
    await studio.executeSql('PRAGMA user_version = 3');
    await studio.getSchema();
    expect(introspections).toBe(3);
  });

  it('invalidates the cache after PRAGMA writes from the pragma editor', async () => {
    await studio.getSchema();
    await studio.setPragma('user_version', '7');
    await studio.getSchema();
    expect(introspections).toBe(2);
  });

  it('refreshes when a browsed object is missing from the cached schema', async () => {
    await studio.getSchema();
    await connection.execute('CREATE TABLE created_elsewhere (id INTEGER PRIMARY KEY)');
    await expect(studio.browse('created_elsewhere')).resolves.toMatchObject({
      objectName: 'created_elsewhere',
    });
    expect(introspections).toBe(2);
  });

  it('forces a fresh introspection on explicit refresh', async () => {
    await studio.getSchema();
    await studio.getSchema(true);
    expect(introspections).toBe(2);
  });

  it('loads migration inspection lazily and caches it until invalidated', async () => {
    const initial = await studio.getSchema();
    expect(initial.inspectionAvailable).toBe(true);
    expect(initial.inspection).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
    const inspection = await studio.getInspection();
    expect(inspection).toBeDefined();
    await studio.getInspection();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect((await studio.getSchema()).inspection).toEqual(inspection);
    await studio.executeSql('CREATE TABLE extra (id INTEGER PRIMARY KEY)');
    expect((await studio.getSchema()).inspection).toBeUndefined();
    await studio.getInspection();
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
