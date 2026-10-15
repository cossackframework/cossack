// Studio introspection against real PostgreSQL and MySQL servers.
//
// Runs only when COSSACK_TEST_POSTGRES_URL and/or COSSACK_TEST_MYSQL_URL are
// set (docs/testing.md), and skips otherwise. With COSSACK_TEST_REQUIRE_LIVE=1
// (CI) a missing URL fails instead. The tests create and drop their own `sl_*`
// objects (live-schema-fixture.ts) in the database the URL names.
//
// The pinned results in __snapshots__/live-introspection.*.json were recorded
// with the earlier per-table introspection (three or four queries per table)
// and must not change. The PostgreSQL file was re-recorded once on purpose,
// when keys and foreign keys moved to pg_catalog, to add the fixture objects
// that the information_schema queries read wrongly. Re-record them only for
// an intended change, against the server versions CI uses
// (.github/workflows/integration-tests.yml).
import { createORM } from '@cossackframework/database';
import { mysql, postgres } from '@cossackframework/database/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLocalConnection,
  StudioDatabase,
  type LocalStudioConnection,
  type StudioObject,
} from '../src/testing';
import {
  dropFixtureSchema,
  extraTables,
  fixtureCounts,
  fixtureSchema,
  fixtureSnapshot,
  FIXTURE_PREFIX,
  type LiveDialect,
} from './live-schema-fixture';

const urls: Record<LiveDialect, string | undefined> = {
  postgres: process.env.COSSACK_TEST_POSTGRES_URL || undefined,
  mysql: process.env.COSSACK_TEST_MYSQL_URL || undefined,
};
if (process.env.COSSACK_TEST_REQUIRE_LIVE === '1' && (!urls.postgres || !urls.mysql)) {
  throw new Error(
    'COSSACK_TEST_REQUIRE_LIVE=1 requires COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL.',
  );
}

/** Record every statement the connection runs from now on. */
function recordQueries(connection: LocalStudioConnection): string[] {
  const queries: string[] = [];
  const execute = connection.execute.bind(connection);
  connection.execute = (sql, parameters) => {
    queries.push(sql);
    return execute(sql, parameters);
  };
  return queries;
}

function fixtureObjects(objects: StudioObject[]): StudioObject[] {
  return objects.filter((object) => object.name.startsWith(FIXTURE_PREFIX));
}

for (const dialect of ['postgres', 'mysql'] as const) {
  const url = urls[dialect];

  describe.skipIf(!url)(`live ${dialect} introspection`, () => {
    let connection: LocalStudioConnection;
    let queries: string[];

    async function run(statements: string[]): Promise<void> {
      for (const statement of statements) await connection.execute(statement);
    }

    beforeAll(async () => {
      const adapter = dialect === 'postgres' ? await postgres(url!) : await mysql(url!);
      connection = createLocalConnection({
        orm: createORM({ adapter, entities: [] }),
        info: { provider: dialect, label: `live ${dialect}` },
      });
      await run(dropFixtureSchema(dialect));
      await run(fixtureSchema(dialect));
      queries = recordQueries(connection);
    }, 60_000);

    afterAll(async () => {
      if (!connection) return;
      try {
        await run(dropFixtureSchema(dialect));
      } finally {
        await connection.close();
      }
    }, 60_000);

    it('loads the schema in five queries whatever the number of tables', async () => {
      const studio = new StudioDatabase(connection);
      queries.length = 0;
      const schema = await studio.getSchema();
      // Version, object list, then columns, indexes and foreign keys of every table.
      expect(queries).toHaveLength(5);
      const objects = fixtureObjects(schema.objects);
      expect(objects.filter((object) => object.kind === 'table')).toHaveLength(fixtureCounts(dialect).tables);
      expect(objects.filter((object) => object.kind === 'view')).toHaveLength(fixtureCounts(dialect).views);

      await run(extraTables(dialect));
      queries.length = 0;
      const larger = await studio.getSchema(true);
      expect(queries).toHaveLength(4);
      expect(fixtureObjects(larger.objects)).toHaveLength(objects.length + 3);
      expect(larger.objects.find((object) => object.name === 'sl_extra_3')?.foreignKeys
        .map((foreignKey) => foreignKey.referencedTable)).toEqual(['sl_accounts']);
      await run(dropFixtureSchema(dialect).filter((statement) => statement.includes('sl_extra_')));
    }, 60_000);

    it('reads keys, indexes and foreign keys of every table', async () => {
      const schema = await new StudioDatabase(connection).getSchema();
      const object = (name: string) => schema.objects.find((candidate) => candidate.name === name)!;
      const primaryKey = (name: string) => object(name).columns
        .filter((column) => column.primaryKeyPosition > 0)
        .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
        .map((column) => column.name);
      const foreignKey = (table: string, referencedTable: string) => object(table).foreignKeys
        .filter((candidate) => candidate.referencedTable === referencedTable)
        .map((candidate) => candidate.columns.map((column) => [column.column, column.referencedColumn]));

      expect(primaryKey('sl_stock')).toEqual(['product_id', 'region', 'code']);
      expect(primaryKey('sl_members')).toEqual(['team_id', 'account_id']);
      expect(foreignKey('sl_stock', 'sl_warehouses')).toEqual([[['region', 'region'], ['code', 'code']]]);
      expect(foreignKey('sl_categories', 'sl_categories')).toEqual([[['parent_id', 'id']]]);
      expect(foreignKey('sl_employees', 'sl_employees')).toEqual([[['manager_id', 'id']]]);
      expect(object('sl_teams').indexes.find((index) => index.name === 'sl_teams_account_slug_key'))
        .toMatchObject({ unique: true, columns: [{ name: 'account_id' }, { name: 'slug' }] });
      expect(object('sl_orders').indexes.find((index) => index.name === 'sl_orders_account_placed_idx'))
        .toMatchObject({ columns: [{ name: 'account_id', descending: false }, { name: 'placed_at', descending: true }] });
      expect(object('sl_sessions').rowLocators[0])
        .toEqual({ kind: 'unique-index', columns: ['token'], name: 'sl_sessions_token_key' });
      expect(object('sl_open_orders')).toMatchObject({ kind: 'view', editable: false, indexes: [], foreignKeys: [] });
      expect(object('sl_audit_log').editable).toBe(dialect === 'postgres');
    }, 60_000);

    it.skipIf(dialect !== 'postgres')('keeps each table\'s own columns for foreign keys that share a name', async () => {
      const schema = await new StudioDatabase(connection).getSchema();
      const foreignKeys = (name: string) =>
        schema.objects.find((object) => object.name === name)?.foreignKeys;

      expect(foreignKeys('sl_dup_left')).toEqual([{
        name: 'sl_dup_fk',
        referencedTable: 'sl_warehouses',
        columns: [
          { column: 'region', referencedColumn: 'region', position: 0 },
          { column: 'code', referencedColumn: 'code', position: 1 },
        ],
        onUpdate: 'NO ACTION',
        onDelete: 'CASCADE',
      }]);
      // Foreign key order, not table column order.
      expect(foreignKeys('sl_dup_right')).toEqual([{
        name: 'sl_dup_fk',
        referencedTable: 'sl_warehouses',
        columns: [
          { column: 'warehouse_region', referencedColumn: 'region', position: 0 },
          { column: 'warehouse_code', referencedColumn: 'code', position: 1 },
        ],
        onUpdate: 'CASCADE',
        onDelete: 'NO ACTION',
      }]);
      expect(foreignKeys('sl_dup_single')).toEqual([{
        name: 'sl_dup_fk',
        referencedTable: 'sl_accounts',
        columns: [{ column: 'account_id', referencedColumn: 'id', position: 0 }],
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
      }]);
      // One foreign key, not one more per partition of sl_part.
      expect(foreignKeys('sl_part_refs')?.map((foreignKey) => [foreignKey.name, foreignKey.referencedTable]))
        .toEqual([['sl_part_refs_part_fk', 'sl_part']]);
      // The referenced column has a unique index but no unique constraint.
      expect(foreignKeys('sl_badges')?.map((foreignKey) => [foreignKey.name, foreignKey.referencedTable]))
        .toEqual([['sl_badges_employee_fk', 'sl_employees']]);
    }, 60_000);

    it.skipIf(dialect !== 'postgres')('shows a SELECT-only role the same keys and foreign keys as the owner', async (context) => {
      const owner = await new StudioDatabase(connection).getSchema();
      const objects = fixtureObjects(owner.objects);
      const role = `sl_reader_${Math.random().toString(36).slice(2, 10)}`;
      const password = 'sl_reader_password';
      try {
        await connection.execute(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      } catch (error) {
        context.skip(`the test user cannot create roles: ${(error as Error).message}`);
      }
      let reader: LocalStudioConnection | undefined;
      try {
        const schemaName = String((await connection.execute('SELECT current_schema() AS name')).rows[0]?.name);
        await connection.execute(`ALTER ROLE ${role} SET search_path = "${schemaName}"`);
        await connection.execute(`GRANT USAGE ON SCHEMA "${schemaName}" TO ${role}`);
        await connection.execute(
          `GRANT SELECT ON ${objects.map((object) => `"${object.name}"`).join(', ')} TO ${role}`,
        );
        const readerUrl = new URL(url!);
        readerUrl.username = role;
        readerUrl.password = password;
        reader = createLocalConnection({
          orm: createORM({ adapter: await postgres(readerUrl.href), entities: [] }),
          info: { provider: 'postgres', label: 'live postgres reader' },
        });
        // information_schema hides every constraint from this role.
        const visible = await reader.execute(
          `SELECT COUNT(*) AS count FROM information_schema.table_constraints WHERE table_name LIKE 'sl\\_%'`,
        );
        expect(Number(visible.rows[0]?.count)).toBe(0);

        const read = await new StudioDatabase(reader).getSchema();
        const stock = read.objects.find((object) => object.name === 'sl_stock')!;
        expect(stock.rowLocators[0]).toEqual({ kind: 'primary-key', columns: ['product_id', 'region', 'code'] });
        expect(stock.foreignKeys.map((foreignKey) => foreignKey.name))
          .toEqual(['sl_stock_product_id_fkey', 'sl_stock_warehouse_fk']);
        expect(fixtureSnapshot(read.objects, 'unused')).toBe(fixtureSnapshot(owner.objects, 'unused'));
      } finally {
        await reader?.close();
        await connection.execute(`DROP OWNED BY ${role}`);
        await connection.execute(`DROP ROLE ${role}`);
      }
    }, 60_000);

    it('matches the pinned introspection result, with definitions loaded on demand', async () => {
      const studio = new StudioDatabase(connection);
      const schema = await studio.getSchema();
      const objects = fixtureObjects(schema.objects);
      queries.length = 0;
      for (const object of objects) await studio.getDefinition(object.name);
      // MySQL defers SHOW CREATE to one query per displayed object.
      expect(queries).toHaveLength(dialect === 'mysql' ? objects.length : 0);
      expect(queries.every((sql) => sql.startsWith('SHOW CREATE '))).toBe(true);

      const loaded = fixtureObjects((await studio.getSchema()).objects);
      expect(loaded.every((object) => object.sqlDeferred === undefined && object.sql)).toBe(true);
      await expect(fixtureSnapshot(loaded, new URL(url!).pathname.slice(1)))
        .toMatchFileSnapshot(`./__snapshots__/live-introspection.${dialect}.json`);
    }, 60_000);
  });
}
