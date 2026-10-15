import { describe, expect, it } from 'vitest';
import {
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

type CatalogRow = Record<string, unknown>;

/** Flatten per-table catalog rows into schema-wide rows with `table_name`. */
function schemaWide(byTable: Record<string, CatalogRow[]>): CatalogRow[] {
  return Object.entries(byTable)
    .flatMap(([table, rows]) => rows.map((row) => ({ table_name: table, ...row })));
}

function catalogColumn(name: string, dataType: string, nullable: boolean | number, extra: CatalogRow = {}) {
  return {
    name,
    data_type: dataType,
    nullable,
    default_value: null,
    primary_key_position: 0,
    auto_increment: typeof nullable === 'number' ? 0 : false,
    ...extra,
  };
}

const POSTGRES_COLUMNS: Record<string, CatalogRow[]> = {
  adult_people: [catalogColumn('id', 'integer', true)],
  events: [catalogColumn('message', 'text', false)],
  external_events: [catalogColumn('message', 'text', true)],
  people: [
    catalogColumn('id', 'integer', false, {
      default_value: "nextval('people_id_seq'::regclass)",
      primary_key_position: 1,
      auto_increment: true,
    }),
    catalogColumn('name', 'character varying(80)', false),
    catalogColumn('enabled', 'boolean', false, { default_value: 'true' }),
    catalogColumn('profile', 'jsonb', true),
  ],
};

const POSTGRES_INDEXES: Record<string, CatalogRow[]> = {
  people: [{
    name: 'people_pkey',
    unique: true,
    origin: 'pk',
    partial: false,
    column_name: 'id',
    position: 0,
    descending: false,
    collation: null,
  }],
};

const POSTGRES_FOREIGN_KEYS: Record<string, CatalogRow[]> = {
  people: [{
    name: 'people_account_fk',
    referenced_table: 'accounts',
    column_name: 'id',
    referenced_column: 'owner_id',
    position: 0,
    on_update: 'CASCADE',
    on_delete: 'RESTRICT',
  }],
};

function postgresConnection() {
  return new FakeConnection(
    { provider: 'postgres', label: 'app', remote: false },
    (sql, parameters) => {
      // These views hide constraints and view definitions from roles that can
      // only SELECT, so keys, foreign keys and views come from pg_catalog.
      if (/information_schema\.(table_constraints|key_column_usage|referential_constraints|views)\b/.test(sql)) {
        throw new Error(`PostgreSQL introspection read a privilege-filtered view: ${sql}`);
      }
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
        expect(parameters).toEqual([]);
        return { rows: schemaWide(POSTGRES_COLUMNS) };
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
        expect(parameters).toEqual([]);
        return { rows: schemaWide(POSTGRES_INDEXES) };
      }
      if (sql.includes("constraint_info.contype = 'f'")) {
        expect(sql).toContain('unnest(constraint_info.conkey, constraint_info.confkey)');
        expect(parameters).toEqual([]);
        return { rows: schemaWide(POSTGRES_FOREIGN_KEYS) };
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

const MYSQL_COLUMNS: Record<string, CatalogRow[]> = {
  audit_log: [catalogColumn('message', 'text', 1)],
  nullable_unique: [catalogColumn('token', 'varchar(255)', 1)],
  sessions: [
    catalogColumn('token', 'varchar(255)', 0),
    catalogColumn('payload', 'text', 1),
  ],
  users: [
    catalogColumn('id', 'bigint unsigned', 0, { primary_key_position: 1, auto_increment: 1 }),
    catalogColumn('email', 'varchar(255)', 0),
    catalogColumn('payload', 'json', 1),
  ],
  active_users: [catalogColumn('id', 'bigint unsigned', 0)],
};

function mysqlIndex(name: string, column: string, origin: 'pk' | 'u') {
  return {
    name,
    unique: 1,
    origin,
    partial: 0,
    column_name: column,
    position: 0,
    descending: 0,
    collation: null,
  };
}

const MYSQL_INDEXES: Record<string, CatalogRow[]> = {
  nullable_unique: [mysqlIndex('nullable_token_unique', 'token', 'u')],
  sessions: [mysqlIndex('sessions_token_unique', 'token', 'u')],
  users: [
    mysqlIndex('PRIMARY', 'id', 'pk'),
    mysqlIndex('users_email_unique', 'email', 'u'),
  ],
};

const MYSQL_FOREIGN_KEYS: Record<string, CatalogRow[]> = {
  users: [{
    name: 'users_account_fk',
    referenced_table: 'accounts',
    column_name: 'id',
    referenced_column: 'owner_id',
    position: 0,
    on_update: 'CASCADE',
    on_delete: 'RESTRICT',
  }],
};

function mysqlConnection(options: { showCreate?: boolean } = {}) {
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
            { name: 'active_users', kind: 'view' },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns AS columns')) {
        expect(parameters).toEqual([]);
        return { rows: schemaWide(MYSQL_COLUMNS) };
      }
      if (sql.includes('FROM information_schema.statistics')) {
        expect(parameters).toEqual([]);
        return { rows: schemaWide(MYSQL_INDEXES) };
      }
      if (sql.includes('FROM information_schema.key_column_usage AS key_usage')) {
        // `usage` is a reserved word in MySQL; it fails as an alias.
        expect(sql).not.toMatch(/\busage\./);
        expect(parameters).toEqual([]);
        return { rows: schemaWide(MYSQL_FOREIGN_KEYS) };
      }
      if (sql.startsWith('EXPLAIN FORMAT=JSON ')) {
        return { rows: [{ EXPLAIN: '{"query_block":{"table":{"table_name":"users"}}}' }] };
      }
      if (sql.startsWith('SHOW CREATE ')) {
        if (options.showCreate === false) throw new Error('SHOW VIEW command denied');
        const name = sql.match(/`([^`]+)`/)?.[1] ?? 'users';
        return sql.startsWith('SHOW CREATE VIEW ')
          ? { rows: [{ View: name, 'Create View': `CREATE VIEW \`${name}\` AS select 1` }] }
          : { rows: [{ Table: name, 'Create Table': `CREATE TABLE \`${name}\` (...)` }] };
      }
      if (sql.includes('FROM information_schema.views')) {
        expect(parameters).toEqual(['active_users']);
        return { rows: [{ definition: 'select `users`.`id` AS `id` from `users`' }] };
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

/**
 * A PostgreSQL or MySQL catalog with `tables` tables (each with a primary key,
 * a unique index and a foreign key) and one view.
 */
function largeCatalogConnection(provider: 'postgres' | 'mysql', tables: number) {
  const names = Array.from({ length: tables }, (_, index) => `table_${index}`);
  return new FakeConnection(
    { provider, label: 'large', remote: false },
    (sql) => {
      if (/^SELECT version\(\)|^SELECT VERSION\(\)/.test(sql)) {
        return { rows: [{ version: provider === 'postgres' ? 'PostgreSQL 18.0' : '8.0.46' }] };
      }
      if (/FROM information_schema\.tables\b/.test(sql)) {
        return {
          rows: [
            ...names.map((name) => ({ name, kind: 'table', definition: null })),
            { name: 'summary', kind: 'view', definition: 'SELECT 1' },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns AS columns')) {
        return {
          rows: [...names, 'summary'].flatMap((table) => [
            { table_name: table, ...catalogColumn('id', 'integer', false, { primary_key_position: table === 'summary' ? 0 : 1 }) },
            { table_name: table, ...catalogColumn('parent_id', 'integer', true) },
          ]),
        };
      }
      if (sql.includes("contype = 'f'") || sql.includes('key_column_usage AS key_usage')) {
        return {
          rows: names.map((table) => ({
            table_name: table,
            name: `${table}_parent_fk`,
            referenced_table: table,
            column_name: 'parent_id',
            referenced_column: 'id',
            position: 0,
            on_update: 'NO ACTION',
            on_delete: 'CASCADE',
          })),
        };
      }
      if (sql.includes('pg_catalog.pg_class AS table_class') || sql.includes('FROM information_schema.statistics')) {
        return {
          rows: names.flatMap((table) => [
            { table_name: table, ...mysqlIndex(`${table}_pkey`, 'id', 'pk') },
            { table_name: table, ...mysqlIndex(`${table}_parent_key`, 'parent_id', 'u') },
          ]),
        };
      }
      throw new Error(`Unexpected ${provider} query: ${sql}`);
    },
  );
}

describe('Studio dialect detection', () => {
  it('uses ORM driver dialect metadata before environment heuristics', async () => {
    const postgres = { driver: { dialect: 'postgres' } };
    const mysql = { driver: { dialect: 'mysql' } };
    const d1 = { driver: { dialect: 'sqlite' } };
    expect(await detectStudioProvider(
      postgres as any,
      { DB_CONNECTION: 'mysql' } as NodeJS.ProcessEnv,
    )).toBe('postgres');
    expect(await detectStudioProvider(mysql as any, {})).toBe('mysql');
    expect(await detectStudioProvider(
      d1 as any,
      { DB_CONNECTION: 'd1' } as NodeJS.ProcessEnv,
    )).toBe('d1-local');
  });

  it('supports environment hints for SQLite-family ORM adapters', async () => {
    const custom = { driver: { dialect: 'sqlite' } };
    expect(await detectStudioProvider(
      custom as any,
      { TURSO_DATABASE_URL: 'https://example.turso.io' } as NodeJS.ProcessEnv,
    )).toBe('turso');
    expect(await detectStudioProvider(
      custom as any,
      { DB_CONNECTION: 'd1' } as NodeJS.ProcessEnv,
    )).toBe('d1-local');
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
    expect(connection.queries).toHaveLength(5);
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
      sql: null,
      sqlDeferred: true,
    });
    expect(connection.queries.some(({ sql }) => sql.startsWith('SHOW CREATE'))).toBe(false);
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

  it('loads deferred definitions one object at a time and caches them', async () => {
    const connection = mysqlConnection();
    const studio = new StudioDatabase(connection);
    await studio.getSchema();
    const showCreate = () => connection.queries.filter(({ sql }) => sql.startsWith('SHOW CREATE'));

    expect(await studio.getDefinition('users')).toBe('CREATE TABLE `users` (...)');
    expect(await studio.getDefinition('active_users')).toBe('CREATE VIEW `active_users` AS select 1');
    expect(await studio.getDefinition('users')).toBe('CREATE TABLE `users` (...)');
    expect(showCreate().map(({ sql }) => sql)).toEqual([
      'SHOW CREATE TABLE `users`',
      'SHOW CREATE VIEW `active_users`',
    ]);
    const schema = await studio.getSchema();
    const users = schema.objects.find((object) => object.name === 'users')!;
    expect(users.sql).toBe('CREATE TABLE `users` (...)');
    expect(users).not.toHaveProperty('sqlDeferred');
    expect(schema.objects.find((object) => object.name === 'sessions')).toMatchObject({
      sql: null,
      sqlDeferred: true,
    });

    // A schema reload defers definitions again.
    expect((await studio.getSchema(true)).objects.find((object) => object.name === 'users'))
      .toMatchObject({ sql: null, sqlDeferred: true });
  });

  it('describes objects from the catalog when SHOW CREATE is denied', async () => {
    const connection = mysqlConnection({ showCreate: false });
    const studio = new StudioDatabase(connection);
    expect(await studio.getDefinition('users')).toBe(
      'CREATE TABLE `users` (\n' +
      '  `id` bigint unsigned NOT NULL,\n' +
      '  `email` varchar(255) NOT NULL,\n' +
      '  `payload` json,\n' +
      '  PRIMARY KEY (`id`)\n' +
      ')',
    );
    expect(await studio.getDefinition('active_users')).toBe(
      'CREATE VIEW `active_users` AS\nselect `users`.`id` AS `id` from `users`',
    );
  });
});

describe('PostgreSQL and MySQL schema loads', () => {
  it.each(['postgres', 'mysql'] as const)(
    'run a constant number of %s catalog queries whatever the number of tables',
    async (provider) => {
      const counts = [];
      for (const tables of [1, 40]) {
        const connection = largeCatalogConnection(provider, tables);
        const studio = new StudioDatabase(connection);
        const schema = await studio.getSchema();
        expect(schema.objects).toHaveLength(tables + 1);
        const last = schema.objects.find((object) => object.name === `table_${tables - 1}`)!;
        expect(last.columns.map((column) => column.name)).toEqual(['id', 'parent_id']);
        expect(last.indexes.map((index) => index.name))
          .toEqual([`table_${tables - 1}_pkey`, `table_${tables - 1}_parent_key`]);
        expect(last.foreignKeys.map((foreignKey) => foreignKey.name)).toEqual([`table_${tables - 1}_parent_fk`]);
        expect(schema.objects.find((object) => object.name === 'summary')).toMatchObject({
          kind: 'view',
          indexes: [],
          foreignKeys: [],
        });
        counts.push(connection.queries.length);
        connection.queries.length = 0;
        await studio.getSchema(true);
        counts.push(connection.queries.length);
      }
      // Version, object list, columns, indexes, foreign keys; the version is
      // read once per StudioDatabase.
      expect(counts).toEqual([5, 4, 5, 4]);
    },
  );

  it.each(['postgres', 'mysql'] as const)('skip the %s catalog queries for an empty schema', async (provider) => {
    const connection = largeCatalogConnection(provider, 0);
    const original = connection.execute.bind(connection);
    connection.execute = async (sql, parameters) => {
      const result = await original(sql, parameters);
      return /FROM information_schema\.tables\b/.test(sql) ? { ...result, rows: [] } : result;
    };
    expect((await new StudioDatabase(connection).getSchema()).objects).toEqual([]);
    expect(connection.queries).toHaveLength(2);
  });
});
