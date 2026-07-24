import {
  columnAffinity,
  declaredColumnKind,
  quoteIdentifier,
  sqliteAffinity,
  sqliteDeclaredKind,
} from './sql.js';
import type {
  StudioColumn,
  StudioConnection,
  StudioIndex,
  StudioObject,
  StudioProvider,
  StudioSchema,
} from './types.js';

interface SchemaRow {
  name: string;
  kind?: 'table' | 'view';
  type?: 'table' | 'view';
  sql?: string | null;
  definition?: string | null;
}

interface PragmaColumn {
  name: string;
  type?: string;
  notnull?: number;
  dflt_value?: string | null;
  pk?: number;
  hidden?: number;
}

interface PragmaIndex {
  name: string;
  unique?: number;
  origin?: string;
  partial?: number;
}

interface PragmaIndexColumn {
  seqno?: number;
  name?: string | null;
  desc?: number;
  coll?: string | null;
  key?: number;
}

interface CatalogColumn {
  name: string;
  data_type?: string;
  nullable?: boolean | number | string;
  default_value?: unknown;
  primary_key_position?: number | string | null;
  auto_increment?: boolean | number | string;
  hidden?: boolean | number | string;
}

interface CatalogIndex {
  name: string;
  unique?: boolean | number | string;
  origin?: string;
  partial?: boolean | number | string;
  column_name?: string | null;
  position?: number | string;
  descending?: boolean | number | string;
  collation?: string | null;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' ||
    (typeof value === 'string' && ['yes', 'true', 't'].includes(value.toLowerCase()));
}

function editableReason(kind: 'table' | 'view', columns: StudioColumn[]): string | undefined {
  if (kind === 'view') return 'Views are read-only.';
  if (!columns.some((column) => column.primaryKeyPosition > 0)) {
    return 'This table has no declared primary key.';
  }
  return undefined;
}

function buildObject(
  row: SchemaRow,
  columns: StudioColumn[],
  indexes: StudioIndex[],
  sql: string | null,
): StudioObject {
  const kind = row.kind ?? row.type ?? 'table';
  const reason = editableReason(kind, columns);
  return {
    name: row.name,
    kind,
    sql,
    columns,
    indexes,
    editable: reason === undefined,
    readOnlyReason: reason,
  };
}

function catalogColumns(rows: CatalogColumn[]): StudioColumn[] {
  return rows.map((column) => {
    const dataType = String(column.data_type ?? '');
    return {
      name: column.name,
      dataType,
      affinity: columnAffinity(dataType),
      declaredKind: declaredColumnKind(dataType),
      nullable: truthy(column.nullable),
      defaultValue: column.default_value == null ? null : String(column.default_value),
      primaryKeyPosition: Number(column.primary_key_position ?? 0),
      autoIncrement: truthy(column.auto_increment),
      hidden: truthy(column.hidden),
    };
  });
}

function catalogIndexes(rows: CatalogIndex[]): StudioIndex[] {
  const indexes = new Map<string, StudioIndex>();
  for (const row of rows) {
    let index = indexes.get(row.name);
    if (!index) {
      index = {
        name: row.name,
        unique: truthy(row.unique),
        origin: row.origin ?? 'c',
        partial: truthy(row.partial),
        columns: [],
      };
      indexes.set(row.name, index);
    }
    index.columns.push({
      name: row.column_name ?? null,
      position: Number(row.position ?? 0),
      descending: truthy(row.descending),
      collation: row.collation ?? null,
    });
  }
  return [...indexes.values()];
}

function generatedDefinition(
  provider: StudioProvider,
  row: SchemaRow,
  columns: StudioColumn[],
): string {
  const quote = (identifier: string) => quoteIdentifier(identifier, provider);
  if ((row.kind ?? row.type) === 'view') {
    return row.definition
      ? `CREATE VIEW ${quote(row.name)} AS\n${row.definition}`
      : '';
  }
  const primaryKey = columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
  const lines = columns.map((column) => {
    let line = `  ${quote(column.name)} ${column.dataType || 'text'}`;
    if (!column.nullable) line += ' NOT NULL';
    if (column.defaultValue !== null) line += ` DEFAULT ${column.defaultValue}`;
    return line;
  });
  if (primaryKey.length) {
    lines.push(`  PRIMARY KEY (${primaryKey.map((column) => quote(column.name)).join(', ')})`);
  }
  return `CREATE TABLE ${quote(row.name)} (\n${lines.join(',\n')}\n)`;
}

async function introspectSqlite(connection: StudioConnection): Promise<StudioObject[]> {
  const result = await connection.execute(`
    SELECT name, type, sql
    FROM sqlite_schema
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `);
  const objects: StudioObject[] = [];
  for (const row of result.rows as unknown as SchemaRow[]) {
    const pragma = await connection.execute(
      `PRAGMA table_xinfo(${quoteIdentifier(row.name)})`,
    );
    const definition = row.sql ?? '';
    const columns = (pragma.rows as unknown as PragmaColumn[]).map((column) => {
      const dataType = column.type ?? '';
      const primaryKeyPosition = Number(column.pk ?? 0);
      return {
        name: column.name,
        dataType,
        affinity: sqliteAffinity(dataType),
        declaredKind: sqliteDeclaredKind(dataType),
        nullable: !column.notnull && primaryKeyPosition === 0,
        defaultValue: column.dflt_value ?? null,
        primaryKeyPosition,
        autoIncrement: primaryKeyPosition > 0 &&
          /\bAUTOINCREMENT\b/i.test(definition) &&
          sqliteAffinity(dataType) === 'integer',
        hidden: Number(column.hidden ?? 0) !== 0,
      };
    });
    const indexes: StudioIndex[] = [];
    if (row.type === 'table') {
      const indexList = await connection.execute(
        `PRAGMA index_list(${quoteIdentifier(row.name)})`,
      );
      for (const index of indexList.rows as unknown as PragmaIndex[]) {
        const indexInfo = await connection.execute(
          `PRAGMA index_xinfo(${quoteIdentifier(index.name)})`,
        );
        indexes.push({
          name: index.name,
          unique: Number(index.unique ?? 0) !== 0,
          origin: index.origin ?? 'c',
          partial: Number(index.partial ?? 0) !== 0,
          columns: (indexInfo.rows as unknown as PragmaIndexColumn[])
            .filter((column) => Number(column.key ?? 1) !== 0)
            .map((column) => ({
              name: column.name ?? null,
              position: Number(column.seqno ?? 0),
              descending: Number(column.desc ?? 0) !== 0,
              collation: column.coll ?? null,
            })),
        });
      }
    }
    objects.push(buildObject(row, columns, indexes, row.sql ?? null));
  }
  return objects;
}

async function introspectPostgres(connection: StudioConnection): Promise<StudioObject[]> {
  const result = await connection.execute(`
    SELECT
      tables.table_name AS name,
      CASE WHEN tables.table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind,
      views.view_definition AS definition
    FROM information_schema.tables AS tables
    LEFT JOIN information_schema.views AS views
      ON views.table_schema = tables.table_schema
      AND views.table_name = tables.table_name
    WHERE tables.table_schema = current_schema()
      AND tables.table_type IN ('BASE TABLE', 'FOREIGN', 'FOREIGN TABLE', 'VIEW')
    ORDER BY kind, name
  `);
  const objects: StudioObject[] = [];
  for (const row of result.rows as unknown as SchemaRow[]) {
    const columnResult = await connection.execute(`
      SELECT
        columns.column_name AS name,
        CASE
          WHEN columns.data_type = 'USER-DEFINED' THEN columns.udt_name
          WHEN columns.character_maximum_length IS NOT NULL
            THEN columns.data_type || '(' || columns.character_maximum_length || ')'
          ELSE columns.data_type
        END AS data_type,
        columns.is_nullable = 'YES' AS nullable,
        columns.column_default AS default_value,
        COALESCE(keys.ordinal_position, 0) AS primary_key_position,
        (
          columns.is_identity = 'YES'
          OR columns.column_default LIKE 'nextval(%'
        ) AS auto_increment
      FROM information_schema.columns AS columns
      LEFT JOIN (
        SELECT usage.table_schema, usage.table_name, usage.column_name, usage.ordinal_position
        FROM information_schema.table_constraints AS constraints
        JOIN information_schema.key_column_usage AS usage
          ON usage.constraint_catalog = constraints.constraint_catalog
          AND usage.constraint_schema = constraints.constraint_schema
          AND usage.constraint_name = constraints.constraint_name
        WHERE constraints.constraint_type = 'PRIMARY KEY'
      ) AS keys
        ON keys.table_schema = columns.table_schema
        AND keys.table_name = columns.table_name
        AND keys.column_name = columns.column_name
      WHERE columns.table_schema = current_schema()
        AND columns.table_name = ?
      ORDER BY columns.ordinal_position
    `, [row.name]);
    const columns = catalogColumns(columnResult.rows as unknown as CatalogColumn[]);
    let indexes: StudioIndex[] = [];
    if (row.kind === 'table') {
      const indexResult = await connection.execute(`
        SELECT
          index_class.relname AS name,
          index_info.indisunique AS unique,
          CASE
            WHEN index_info.indisprimary THEN 'pk'
            WHEN index_info.indisunique THEN 'u'
            ELSE 'c'
          END AS origin,
          index_info.indpred IS NOT NULL AS partial,
          attribute.attname AS column_name,
          key.ordinality - 1 AS position,
          (index_info.indoption[key.ordinality - 1] & 1) = 1 AS descending,
          collation.collname AS collation
        FROM pg_catalog.pg_class AS table_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = table_class.relnamespace
        JOIN pg_catalog.pg_index AS index_info
          ON index_info.indrelid = table_class.oid
        JOIN pg_catalog.pg_class AS index_class
          ON index_class.oid = index_info.indexrelid
        CROSS JOIN LATERAL unnest(index_info.indkey)
          WITH ORDINALITY AS key(attribute_number, ordinality)
        LEFT JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = table_class.oid
          AND attribute.attnum = key.attribute_number
        LEFT JOIN pg_catalog.pg_collation AS collation
          ON collation.oid = index_info.indcollation[key.ordinality - 1]
          AND index_info.indcollation[key.ordinality - 1] <> 0
        WHERE namespace.nspname = current_schema()
          AND table_class.relname = ?
        ORDER BY index_class.relname, key.ordinality
      `, [row.name]);
      indexes = catalogIndexes(indexResult.rows as unknown as CatalogIndex[]);
    }
    objects.push(buildObject(
      row,
      columns,
      indexes,
      generatedDefinition('postgres', row, columns),
    ));
  }
  return objects;
}

async function mysqlDefinition(
  connection: StudioConnection,
  row: SchemaRow,
  columns: StudioColumn[],
): Promise<string | null> {
  try {
    const result = await connection.execute(
      `SHOW CREATE ${row.kind === 'view' ? 'VIEW' : 'TABLE'} ${quoteIdentifier(row.name, 'mysql')}`,
    );
    const value = Object.entries(result.rows[0] ?? {})
      .find(([key]) => /^Create (?:Table|View)$/i.test(key))?.[1];
    if (value != null) return String(value);
  } catch {}
  return generatedDefinition('mysql', row, columns);
}

async function introspectMysql(connection: StudioConnection): Promise<StudioObject[]> {
  const result = await connection.execute(`
    SELECT
      tables.TABLE_NAME AS name,
      CASE WHEN tables.TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS kind,
      views.VIEW_DEFINITION AS definition
    FROM information_schema.tables AS tables
    LEFT JOIN information_schema.views AS views
      ON views.TABLE_SCHEMA = tables.TABLE_SCHEMA
      AND views.TABLE_NAME = tables.TABLE_NAME
    WHERE tables.TABLE_SCHEMA = DATABASE()
      AND tables.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
    ORDER BY kind, name
  `);
  const objects: StudioObject[] = [];
  for (const row of result.rows as unknown as SchemaRow[]) {
    const columnResult = await connection.execute(`
      SELECT
        columns.COLUMN_NAME AS name,
        columns.COLUMN_TYPE AS data_type,
        columns.IS_NULLABLE = 'YES' AS nullable,
        columns.COLUMN_DEFAULT AS default_value,
        COALESCE(primary_key.SEQ_IN_INDEX, 0) AS primary_key_position,
        LOCATE('auto_increment', LOWER(columns.EXTRA)) > 0 AS auto_increment
      FROM information_schema.columns AS columns
      LEFT JOIN information_schema.statistics AS primary_key
        ON primary_key.TABLE_SCHEMA = columns.TABLE_SCHEMA
        AND primary_key.TABLE_NAME = columns.TABLE_NAME
        AND primary_key.COLUMN_NAME = columns.COLUMN_NAME
        AND primary_key.INDEX_NAME = 'PRIMARY'
      WHERE columns.TABLE_SCHEMA = DATABASE()
        AND columns.TABLE_NAME = ?
      ORDER BY columns.ORDINAL_POSITION
    `, [row.name]);
    const columns = catalogColumns(columnResult.rows as unknown as CatalogColumn[]);
    let indexes: StudioIndex[] = [];
    if (row.kind === 'table') {
      const indexResult = await connection.execute(`
        SELECT
          INDEX_NAME AS name,
          NON_UNIQUE = 0 AS \`unique\`,
          CASE
            WHEN INDEX_NAME = 'PRIMARY' THEN 'pk'
            WHEN NON_UNIQUE = 0 THEN 'u'
            ELSE 'c'
          END AS origin,
          0 AS partial,
          COLUMN_NAME AS column_name,
          SEQ_IN_INDEX - 1 AS position,
          COLLATION = 'D' AS descending,
          NULL AS collation
        FROM information_schema.statistics
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `, [row.name]);
      indexes = catalogIndexes(indexResult.rows as unknown as CatalogIndex[]);
    }
    objects.push(buildObject(
      row,
      columns,
      indexes,
      await mysqlDefinition(connection, row, columns),
    ));
  }
  return objects;
}

export async function introspectSchema(
  connection: StudioConnection,
  applicationName = 'Cossack application',
): Promise<StudioSchema> {
  const provider = connection.info.provider;
  const objects = provider === 'postgres'
    ? await introspectPostgres(connection)
    : provider === 'mysql'
      ? await introspectMysql(connection)
      : provider === 'unknown'
        ? (() => {
            throw new Error(
              'Studio could not detect the database driver. Set DB_CONNECTION to ' +
              'sqlite, turso, d1, postgres, or mysql.',
            );
          })()
        : await introspectSqlite(connection);
  return { connection: connection.info, applicationName, objects };
}

export function findObject(schema: StudioSchema, name: string): StudioObject {
  const object = schema.objects.find((candidate) => candidate.name === name);
  if (!object) throw new Error(`Table or view "${name}" does not exist.`);
  return object;
}
