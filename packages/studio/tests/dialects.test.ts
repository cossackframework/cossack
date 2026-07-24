import { describe, expect, it } from 'vitest';
import {
  DummyDriver,
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
      if (sql.includes('FROM information_schema.tables AS tables')) {
        return {
          rows: [
            { name: 'people', kind: 'table', definition: null },
            { name: 'adult_people', kind: 'view', definition: 'SELECT * FROM people' },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns AS columns')) {
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
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ __cossack_total: 1 }] };
      if (sql.startsWith('SELECT * FROM')) {
        return { rows: [{ id: 1, name: 'Ada', enabled: true, profile: null }] };
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
      if (sql.includes('FROM information_schema.tables') && !sql.includes('statistics')) {
        return { rows: [{ name: 'users', kind: 'table' }] };
      }
      if (sql.includes('FROM information_schema.columns AS columns')) {
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
      if (sql === 'SHOW CREATE TABLE `users`') {
        return {
          rows: [{
            Table: 'users',
            'Create Table': 'CREATE TABLE `users` (`id` bigint unsigned NOT NULL AUTO_INCREMENT)',
          }],
        };
      }
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ __cossack_total: 1 }] };
      if (sql.startsWith('SELECT * FROM')) {
        return { rows: [{ id: 1, email: 'ada@example.com', payload: null }] };
      }
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
    expect(await detectStudioProvider(
      postgres as any,
      { DB_CONNECTION: 'mysql' } as NodeJS.ProcessEnv,
    )).toBe('postgres');
    expect(await detectStudioProvider(mysql as any, {})).toBe('mysql');
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
  it('discovers metadata and generates PostgreSQL browse and mutation SQL', async () => {
    const connection = postgresConnection();
    const studio = new StudioDatabase(connection);
    const schema = await studio.getSchema();
    const people = schema.objects.find((object) => object.name === 'people')!;
    expect(people.editable).toBe(true);
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
    });
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
  });
});

describe('MySQL Studio adapter', () => {
  it('discovers metadata and uses MySQL identifiers in generated SQL', async () => {
    const connection = mysqlConnection();
    const studio = new StudioDatabase(connection);
    const schema = await studio.getSchema();
    const users = schema.objects[0];
    expect(users).toMatchObject({
      name: 'users',
      editable: true,
      sql: 'CREATE TABLE `users` (`id` bigint unsigned NOT NULL AUTO_INCREMENT)',
    });
    expect(users.columns.find((column) => column.name === 'email')?.declaredKind).toBe('varchar');
    expect(users.indexes.map((index) => index.name)).toEqual([
      'PRIMARY',
      'users_email_unique',
    ]);

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
  });
});
