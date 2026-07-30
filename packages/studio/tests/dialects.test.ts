import { describe, expect, it } from 'vitest';
import {
  DummyDriver,
  D1Adapter,
  Kysely,
  MysqlAdapter,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresQueryCompiler,
  SqliteIntrospector,
} from '@cossackframework/database';
import {
  createLocalConnection,
  detectStudioProvider,
  StudioDatabase,
  type StudioConnection,
  type StudioConnectionInfo,
  type StudioQueryResult,
} from '../src/testing';

type QueryHandler = (
  sql: string,
  parameters: readonly unknown[],
) => Partial<StudioQueryResult> | Promise<Partial<StudioQueryResult>>;

class FakeConnection implements StudioConnection {
  readonly queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];

  constructor(
    readonly info: StudioConnectionInfo,
    private readonly handler: QueryHandler,
  ) {}

  async execute(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<StudioQueryResult> {
    this.queries.push({ sql, parameters });
    const result = await this.handler(sql, parameters);
    return {
      rows: result.rows ?? [],
      affectedRows: result.affectedRows ?? 0,
      insertId: result.insertId,
      durationMs: result.durationMs ?? 1,
    };
  }

  async close(): Promise<void> {}
}

function postgresConnection() {
  return new FakeConnection(
    { provider: 'postgres', label: 'app', remote: false },
    (sql, parameters) => {
      if (sql === 'SELECT version() AS version') {
        return { rows: [{ version: 'PostgreSQL 17.2 on x86_64-pc-linux-gnu' }] };
      }
      if (sql.includes('FROM information_schema.tables AS tables')) {
        return {
          rows: [
            { name: 'people', kind: 'table', definition: null },
            { name: 'events', kind: 'table', definition: null },
            {
              name: 'external_events',
              kind: 'table',
              table_type: 'FOREIGN',
              definition: null,
            },
            { name: 'adult_people', kind: 'view', definition: 'SELECT * FROM people' },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns AS columns')) {
        if (parameters[0] === 'events') {
          return {
            rows: [{
              name: 'message',
              data_type: 'text',
              nullable: false,
              default_value: null,
              primary_key_position: 0,
              auto_increment: false,
            }],
          };
        }
        if (parameters[0] === 'external_events') {
          return {
            rows: [{
              name: 'message',
              data_type: 'text',
              nullable: true,
              default_value: null,
              primary_key_position: 0,
              auto_increment: false,
            }],
          };
        }
        if (parameters[0] === 'adult_people') {
          return {
            rows: [
              {
                name: 'id',
                data_type: 'integer',
                nullable: true,
                default_value: null,
                primary_key_position: 0,
                auto_increment: false,
              },
            ],
          };
        }
        return {
          rows: [
            {
              name: 'id',
              data_type: 'integer',
              nullable: false,
              default_value: "nextval('people_id_seq'::regclass)",
              primary_key_position: 1,
              auto_increment: true,
            },
            {
              name: 'name',
              data_type: 'character varying(80)',
              nullable: false,
              default_value: null,
              primary_key_position: 0,
              auto_increment: false,
            },
            {
              name: 'enabled',
              data_type: 'boolean',
              nullable: false,
              default_value: 'true',
              primary_key_position: 0,
              auto_increment: false,
            },
            {
              name: 'profile',
              data_type: 'jsonb',
              nullable: true,
              default_value: null,
              primary_key_position: 0,
              auto_increment: false,
            },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_class AS table_class')) {
        if (
          /\bWITH ORDINALITY AS key\b|\bkey\./.test(sql)
          || /\bpg_catalog\.pg_collation AS collation\b|\bcollation\./.test(sql)
        ) {
          throw new Error('PostgreSQL index introspection used a conflicting SQL alias');
        }
        if (
          !sql.includes('WITH ORDINALITY AS index_key(attribute_number, ordinality)')
          || !sql.includes('pg_catalog.pg_collation AS index_collation')
          || !sql.includes('index_collation.collname AS collation')
        ) {
          throw new Error('PostgreSQL index introspection did not use deterministic aliases');
        }
        if (parameters[0] === 'events' || parameters[0] === 'external_events') return { rows: [] };
        return {
          rows: [
            {
              name: 'people_pkey',
              unique: true,
              origin: 'pk',
              partial: false,
              column_name: 'id',
              position: 0,
              descending: false,
              collation: null,
            },
          ],
        };
      }
      if (sql.includes("constraints.constraint_type = 'FOREIGN KEY'")) {
        return parameters[0] === 'people'
          ? {
              rows: [{
                name: 'people_account_fk',
                referenced_table: 'accounts',
                column_name: 'id',
                referenced_column: 'owner_id',
                position: 0,
                on_update: 'CASCADE',
                on_delete: 'RESTRICT',
              }],
            }
          : { rows: [] };
      }
      if (sql.startsWith('EXPLAIN (FORMAT JSON) ')) {
        return {
          rows: [{
            'QUERY PLAN': [{
              Plan: { 'Node Type': 'Index Scan', 'Relation Name': 'people' },
            }],
          }],
        };
      }
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ __cossack_total: 1 }] };
      if (sql.includes(' FROM "events"')) {
        return {
          rows: [{
            __cossack_tableoid__: 16_384,
            __cossack_ctid__: '(0,1)',
            message: 'created',
          }],
        };
      }
      if (sql.includes(' FROM "people"')) {
        return {
          rows: [{
            __cossack_tableoid__: 16_383,
            __cossack_ctid__: '(0,1)',
            id: 1,
            name: 'Ada',
            enabled: true,
            profile: null,
          }],
        };
      }
      if (sql.startsWith('UPDATE ')) return { affectedRows: 1 };
      throw new Error(`Unexpected PostgreSQL query: ${sql}`);
    },
  );
}

function mysqlConnection() {
  return new FakeConnection(
    { provider: 'mysql', label: 'app', remote: false },
    (sql, parameters) => {
      if (sql === 'SELECT VERSION() AS version') {
        return { rows: [{ version: '8.4.0' }] };
      }
      if (sql.includes('FROM information_schema.tables') && !sql.includes('statistics')) {
        return {
          rows: [
            { name: 'users', kind: 'table' },
            { name: 'sessions', kind: 'table' },
            { name: 'nullable_unique', kind: 'table' },
            { name: 'audit_log', kind: 'table' },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns AS columns')) {
        if (parameters[0] === 'sessions') {
          return {
            rows: [
              {
                name: 'token',
                data_type: 'varchar(255)',
                nullable: 0,
                default_value: null,
                primary_key_position: 0,
                auto_increment: 0,
              },
              {
                name: 'payload',
                data_type: 'text',
                nullable: 1,
                default_value: null,
                primary_key_position: 0,
                auto_increment: 0,
              },
            ],
          };
        }
        if (parameters[0] === 'audit_log') {
          return {
            rows: [{
              name: 'message',
              data_type: 'text',
              nullable: 1,
              default_value: null,
              primary_key_position: 0,
              auto_increment: 0,
            }],
          };
        }
        if (parameters[0] === 'nullable_unique') {
          return {
            rows: [{
              name: 'token',
              data_type: 'varchar(255)',
              nullable: 1,
              default_value: null,
              primary_key_position: 0,
              auto_increment: 0,
            }],
          };
        }
        expect(parameters).toEqual(['users']);
        return {
          rows: [
            {
              name: 'id',
              data_type: 'bigint unsigned',
              nullable: 0,
              default_value: null,
              primary_key_position: 1,
              auto_increment: 1,
            },
            {
              name: 'email',
              data_type: 'varchar(255)',
              nullable: 0,
              default_value: null,
              primary_key_position: 0,
              auto_increment: 0,
            },
            {
              name: 'payload',
              data_type: 'json',
              nullable: 1,
              default_value: null,
              primary_key_position: 0,
              auto_increment: 0,
            },
          ],
        };
      }
      if (sql.includes('FROM information_schema.statistics')) {
        if (parameters[0] === 'sessions') {
          return {
            rows: [{
              name: 'sessions_token_unique',
              unique: 1,
              origin: 'u',
              partial: 0,
              column_name: 'token',
              position: 0,
              descending: 0,
              collation: null,
            }],
          };
        }
        if (parameters[0] === 'audit_log') return { rows: [] };
        if (parameters[0] === 'nullable_unique') {
          return {
            rows: [{
              name: 'nullable_token_unique',
              unique: 1,
              origin: 'u',
              partial: 0,
              column_name: 'token',
              position: 0,
              descending: 0,
              collation: null,
            }],
          };
        }
        return {
          rows: [
            {
              name: 'PRIMARY',
              unique: 1,
              origin: 'pk',
              partial: 0,
              column_name: 'id',
              position: 0,
              descending: 0,
              collation: null,
            },
            {
              name: 'users_email_unique',
              unique: 1,
              origin: 'u',
              partial: 0,
              column_name: 'email',
              position: 0,
              descending: 0,
              collation: null,
            },
          ],
        };
      }
      if (sql.includes('FROM information_schema.key_column_usage AS usage')) {
        return parameters[0] === 'users'
          ? {
              rows: [{
                name: 'users_account_fk',
                referenced_table: 'accounts',
                column_name: 'id',
                referenced_column: 'owner_id',
                position: 0,
                on_update: 'CASCADE',
                on_delete: 'RESTRICT',
              }],
            }
          : { rows: [] };
      }
      if (sql.startsWith('EXPLAIN FORMAT=JSON ')) {
        return { rows: [{ EXPLAIN: '{"query_block":{"table":{"table_name":"users"}}}' }] };
      }
      if (sql.startsWith('SHOW CREATE TABLE ')) {
        const name = String(parameters[0] ?? sql.match(/`([^`]+)`/)?.[1] ?? 'users');
        return {
          rows: [{
            Table: name,
            'Create Table': `CREATE TABLE \`${name}\` (...)`,
          }],
        };
      }
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ __cossack_total: 1 }] };
      if (sql.startsWith('SELECT * FROM `sessions`')) {
        return { rows: [{ token: 'abc', payload: null }] };
      }
      if (sql.startsWith('SELECT * FROM `users`')) {
        return { rows: [{ id: 1, email: 'ada@example.com', payload: null }] };
      }
      if (sql.startsWith('UPDATE ')) return { affectedRows: 1 };
      if (sql.startsWith('INSERT INTO')) return { affectedRows: 1 };
      throw new Error(`Unexpected MySQL query: ${sql}`);
    },
  );
}

describe('Studio dialect detection', () => {
  it('uses Kysely runtime dialect metadata before environment heuristics', async () => {
    class PostgresIntrospector {}
    class MysqlAdapter {}
    const postgres = {
      introspection: new PostgresIntrospector(),
      getExecutor: () => ({ adapter: { constructor: { name: 'UnknownAdapter' } } }),
    };
    const mysql = {
      introspection: { constructor: { name: 'UnknownIntrospector' } },
      getExecutor: () => ({ adapter: new MysqlAdapter() }),
    };
    const d1 = {
      introspection: { constructor: { name: 'UnknownIntrospector' } },
      getExecutor: () => ({ adapter: new D1Adapter() }),
    };
    expect(await detectStudioProvider(
      postgres as any,
      { DB_CONNECTION: 'mysql' } as NodeJS.ProcessEnv,
    )).toBe('postgres');
    expect(await detectStudioProvider(mysql as any, {})).toBe('mysql');
    expect(await detectStudioProvider(d1 as any, {})).toBe('d1-local');
  });

  it('supports environment hints for custom dialect wrappers', async () => {
    const custom = {
      introspection: { constructor: { name: 'CustomIntrospector' } },
      getExecutor: () => ({ adapter: { constructor: { name: 'CustomAdapter' } } }),
      executeQuery: async () => { throw new Error('not connected in unit test'); },
    };
    expect(await detectStudioProvider(
      custom as any,
      { DATABASE_URL: 'postgresql://localhost/app' } as NodeJS.ProcessEnv,
    )).toBe('postgres');
    expect(await detectStudioProvider(
      custom as any,
      { DB_CONNECTION: 'mariadb' } as NodeJS.ProcessEnv,
    )).toBe('mysql');
  });
});

describe('D1 Studio adapter', () => {
  it('excludes protected Cloudflare tables from schema introspection', async () => {
    const connection = new FakeConnection(
      { provider: 'd1-local', label: 'local D1', remote: false },
      (sql) => {
        if (sql === 'SELECT sqlite_version() AS version') {
          return { rows: [{ version: '3.51.0' }] };
        }
        if (sql.includes('FROM sqlite_schema')) {
          return {
            rows: sql.includes("name NOT GLOB '_cf_*'")
              ? [{
                  name: 'users',
                  type: 'table',
                  sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)',
                }]
              : [
                  {
                    name: 'users',
                    type: 'table',
                    sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)',
                  },
                  {
                    name: '_cf_METADATA',
                    type: 'table',
                    sql: 'CREATE TABLE _cf_METADATA (key TEXT, value BLOB)',
                  },
                ],
          };
        }
        if (sql.includes('_cf_METADATA')) {
          throw new Error('D1_ERROR: not authorized: SQLITE_AUTH');
        }
        if (sql.includes('PRAGMA table_xinfo')) {
          return {
            rows: [{
              cid: 0,
              name: 'id',
              type: 'INTEGER',
              notnull: 0,
              dflt_value: null,
              pk: 1,
              hidden: 0,
            }],
          };
        }
        if (sql.includes('PRAGMA index_list') || sql.includes('PRAGMA foreign_key_list')) {
          return { rows: [] };
        }
        throw new Error(`Unexpected D1 query: ${sql}`);
      },
    );

    const schema = await new StudioDatabase(connection).getSchema();

    expect(schema.objects.map((object) => object.name)).toEqual(['users']);
    expect(connection.queries.some(({ sql }) => sql.includes('_cf_METADATA'))).toBe(false);
  });
});

describe('local dialect parameter compilation', () => {
  function captureDialect(
    adapter: PostgresAdapter | MysqlAdapter,
    compiler: PostgresQueryCompiler | MysqlQueryCompiler,
  ) {
    const db = new Kysely<any>({
      dialect: {
        createAdapter: () => adapter,
        createDriver: () => new DummyDriver(),
        createIntrospector: (client) => new SqliteIntrospector(client),
        createQueryCompiler: () => compiler,
      },
    });
    let compiledSql = '';
    let compiledParameters: readonly unknown[] = [];
    const client = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'executeQuery') {
          return async (query: { sql: string; parameters: readonly unknown[] }) => {
            compiledSql = query.sql;
            compiledParameters = query.parameters;
            return { rows: [] };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return {
      connection: createLocalConnection({ client }),
      get query() {
        return { sql: compiledSql, parameters: compiledParameters };
      },
    };
  }

  it('lets Kysely compile portable placeholders for PostgreSQL and MySQL', async () => {
    const postgres = captureDialect(new PostgresAdapter(), new PostgresQueryCompiler());
    await postgres.connection.execute('SELECT ? AS value, \'?\' AS literal', [42]);
    expect(postgres.query).toEqual({ sql: 'SELECT $1 AS value, \'?\' AS literal', parameters: [42] });

    const mysql = captureDialect(new MysqlAdapter(), new MysqlQueryCompiler());
    await mysql.connection.execute('SELECT ? AS value, \'?\' AS literal', [42]);
    expect(mysql.query).toEqual({ sql: 'SELECT ? AS value, \'?\' AS literal', parameters: [42] });
  });
});

describe('PostgreSQL Studio adapter', () => {
  it('reports that SQLite pragmas are unsupported', async () => {
    await expect(new StudioDatabase(postgresConnection()).getPragmas())
      .rejects.toThrow('available only for SQLite');
  });

  it('discovers metadata and generates PostgreSQL browse and mutation SQL', async () => {
    const connection = postgresConnection();
    const studio = new StudioDatabase(connection);
    const schema = await studio.getSchema();
    expect(schema.connection.databaseVersion).toBe('PostgreSQL 17.2');
    const people = schema.objects.find((object) => object.name === 'people')!;
    expect(people.editable).toBe(true);
    expect(people.rowLocators.map((locator) => locator.kind)).toEqual([
      'primary-key',
      'postgres-ctid',
    ]);
    expect(people.columns.find((column) => column.name === 'id')).toMatchObject({
      declaredKind: 'number',
      primaryKeyPosition: 1,
      autoIncrement: true,
    });
    expect(people.columns.find((column) => column.name === 'profile')?.declaredKind).toBe('json');
    expect(people.indexes[0]).toMatchObject({
      name: 'people_pkey',
      unique: true,
      origin: 'pk',
      columns: [{
        name: 'id',
        position: 0,
        descending: false,
        collation: null,
      }],
    });
    expect(people.foreignKeys).toEqual([{
      name: 'people_account_fk',
      referencedTable: 'accounts',
      columns: [{ column: 'id', referencedColumn: 'owner_id', position: 0 }],
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    }]);
    expect(schema.objects.find((object) => object.name === 'adult_people')).toMatchObject({
      editable: false,
      readOnlyReason: 'Views are read-only.',
    });

    const result = await studio.browse('people', {
      filters: [{ column: 'name', operator: 'eq', value: 'Ada' }],
    });
    expect(result.query).toContain('"name" IS NOT DISTINCT FROM \'Ada\'');
    expect(connection.queries.some(({ sql, parameters }) =>
      sql.includes('"name" IS NOT DISTINCT FROM ?') && parameters[0] === 'Ada')).toBe(true);

    await studio.update('people', { id: 1 }, 'enabled', {
      mode: 'value',
      value: 'true',
    });
    expect(connection.queries.some(({ sql, parameters }) =>
      sql.startsWith('UPDATE "people" SET "enabled" = ? WHERE "id" = ?') &&
      parameters[0] === true)).toBe(true);
    expect(connection.queries.filter(({ sql }) => sql === 'SELECT version() AS version'))
      .toHaveLength(1);

    const events = schema.objects.find((object) => object.name === 'events')!;
    expect(events).toMatchObject({
      editable: true,
      rowLocators: [{
        kind: 'postgres-ctid',
        columns: ['__cossack_tableoid__', '__cossack_ctid__'],
      }],
    });
    const eventRows = await studio.browse('events');
    expect(eventRows.columns).toEqual(['message']);
    await studio.update('events', {
      __cossack_tableoid__: 16_384,
      __cossack_ctid__: '(0,1)',
    }, 'message', {
      mode: 'value',
      value: 'updated',
    });
    expect(connection.queries.some(({ sql, parameters }) =>
      sql.startsWith(
        'UPDATE "events" SET "message" = ? WHERE "tableoid" = CAST(? AS oid) ' +
        'AND "ctid" = CAST(? AS tid)',
      ) && parameters[1] === 16_384 && parameters[2] === '(0,1)')).toBe(true);
    expect(schema.objects.find((object) => object.name === 'external_events')).toMatchObject({
      editable: false,
      rowLocators: [],
      readOnlyReason: 'This table has no safe row locator.',
    });
    expect((await studio.explainSql('SELECT * FROM people')).rows[0]?.['QUERY PLAN'])
      .toMatchObject({ $type: 'unsupported' });
  });
});

describe('MySQL Studio adapter', () => {
  it('discovers metadata and uses MySQL identifiers in generated SQL', async () => {
    const connection = mysqlConnection();
    const studio = new StudioDatabase(connection);
    const schema = await studio.getSchema();
    expect(schema.connection.databaseVersion).toBe('MySQL 8.4.0');
    const users = schema.objects.find((object) => object.name === 'users')!;
    expect(users).toMatchObject({
      name: 'users',
      editable: true,
      sql: 'CREATE TABLE `users` (...)',
    });
    expect(users.columns.find((column) => column.name === 'email')?.declaredKind).toBe('varchar');
    expect(users.indexes.map((index) => index.name)).toEqual([
      'PRIMARY',
      'users_email_unique',
    ]);
    expect(users.foreignKeys).toEqual([{
      name: 'users_account_fk',
      referencedTable: 'accounts',
      columns: [{ column: 'id', referencedColumn: 'owner_id', position: 0 }],
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    }]);

    const result = await studio.browse('users', {
      filters: [{ column: 'email', operator: 'contains', value: '@example.com' }],
    });
    expect(result.query).toContain(
      "`email` LIKE '%@example.com%' ESCAPE '\\\\'",
    );
    expect(connection.queries.some(({ sql }) =>
      sql.startsWith('SELECT * FROM `users`'))).toBe(true);

    await studio.insert('users', {
      id: { mode: 'omit' },
      email: { mode: 'omit' },
      payload: { mode: 'omit' },
    });
    expect(connection.queries.some(({ sql }) =>
      sql === 'INSERT INTO `users` () VALUES ()')).toBe(true);
    expect(connection.queries.filter(({ sql }) => sql === 'SELECT VERSION() AS version'))
      .toHaveLength(1);

    const sessions = schema.objects.find((object) => object.name === 'sessions')!;
    expect(sessions).toMatchObject({
      editable: true,
      rowLocators: [{
        kind: 'unique-index',
        columns: ['token'],
        name: 'sessions_token_unique',
      }],
    });
    await studio.browse('sessions');
    await studio.update('sessions', { token: 'abc' }, 'payload', {
      mode: 'value',
      value: 'updated',
    });
    expect(connection.queries.some(({ sql, parameters }) =>
      sql.startsWith('UPDATE `sessions` SET `payload` = ? WHERE `token` = ?') &&
      parameters[1] === 'abc')).toBe(true);

    expect(schema.objects.find((object) => object.name === 'audit_log')).toMatchObject({
      editable: false,
      rowLocators: [],
      readOnlyReason: 'This table has no primary key or non-null unique index.',
    });
    expect(schema.objects.find((object) => object.name === 'nullable_unique')).toMatchObject({
      editable: false,
      rowLocators: [],
      readOnlyReason: 'This table has no primary key or non-null unique index.',
    });
    expect((await studio.explainSql('SELECT * FROM users')).rows)
      .toEqual([{ EXPLAIN: '{"query_block":{"table":{"table_name":"users"}}}' }]);
  });
});
