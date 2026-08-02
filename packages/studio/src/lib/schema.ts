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
  StudioForeignKey,
  StudioIndex,
  StudioObject,
  StudioProvider,
  StudioRowLocator,
  StudioSchema,
} from './schema-types.js';
import type { OrmSchema } from '@cossackframework/orm';

const SQLITE_ROWID_ALIAS = '__cossack_rowid__';
const POSTGRES_TABLEOID_ALIAS = '__cossack_tableoid__';
const POSTGRES_CTID_ALIAS = '__cossack_ctid__';
const INTERNAL_TABLES = new Set([
  '_cossack_migrations',
  'kysely_migration',
  'kysely_migration_lock',
]);

interface SchemaRow {
  name: string;
  kind?: 'table' | 'view' | undefined;
  type?: 'table' | 'view' | undefined;
  table_type?: string | undefined;
  sql?: string | null | undefined;
  definition?: string | null | undefined;
}

interface PragmaColumn {
  name: string;
  type?: string | undefined;
  notnull?: number | undefined;
  dflt_value?: string | null | undefined;
  pk?: number | undefined;
  hidden?: number | undefined;
}

interface PragmaIndex {
  name: string;
  unique?: number | undefined;
  origin?: string | undefined;
  partial?: number | undefined;
}

interface PragmaIndexColumn {
  seqno?: number | undefined;
  name?: string | null | undefined;
  desc?: number | undefined;
  coll?: string | null | undefined;
  key?: number | undefined;
}

interface PragmaForeignKey {
  id?: number | undefined;
  seq?: number | undefined;
  table?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  on_update?: string | undefined;
  on_delete?: string | undefined;
}

interface CatalogColumn {
  name: string;
  data_type?: string | undefined;
  nullable?: boolean | number | string | undefined;
  default_value?: unknown;
  primary_key_position?: number | string | null | undefined;
  auto_increment?: boolean | number | string | undefined;
  hidden?: boolean | number | string | undefined;
}

interface CatalogIndex {
  name: string;
  unique?: boolean | number | string | undefined;
  origin?: string | undefined;
  partial?: boolean | number | string | undefined;
  column_name?: string | null | undefined;
  position?: number | string | undefined;
  descending?: boolean | number | string | undefined;
  collation?: string | null | undefined;
}

interface CatalogForeignKey {
  name: string;
  referenced_table: string;
  column_name: string;
  referenced_column: string;
  position?: number | string | undefined;
  on_update?: string | null | undefined;
  on_delete?: string | null | undefined;
}

type RawRow = Record<string, unknown>;
type Scalar = boolean | number | string;

function stringField(row: RawRow, key: string): string | undefined {
  return typeof row[key] === 'string' ? row[key] : undefined;
}

function nullableStringField(row: RawRow, key: string): string | null | undefined {
  return row[key] === null ? null : stringField(row, key);
}

function scalarField(row: RawRow, key: string): Scalar | undefined {
  const value = row[key];
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined;
}

function numberOrStringField(row: RawRow, key: string): number | string | undefined {
  const value = row[key];
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
}

function numberField(row: RawRow, key: string): number | undefined {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : undefined;
}

function schemaRows(rows: RawRow[]): SchemaRow[] {
  return rows.flatMap((row): SchemaRow[] => {
    const name = stringField(row, 'name');
    if (!name) return [];
    const rawKind = stringField(row, 'kind');
    const rawType = stringField(row, 'type');
    return [{
      name,
      kind: rawKind === 'table' || rawKind === 'view' ? rawKind : undefined,
      type: rawType === 'table' || rawType === 'view' ? rawType : undefined,
      table_type: stringField(row, 'table_type'),
      sql: nullableStringField(row, 'sql'),
      definition: nullableStringField(row, 'definition'),
    }];
  });
}

function pragmaColumns(rows: RawRow[]): PragmaColumn[] {
  return rows.flatMap((row): PragmaColumn[] => {
    const name = stringField(row, 'name');
    if (!name) return [];
    return [{
      name,
      type: stringField(row, 'type'),
      notnull: numberField(row, 'notnull'),
      dflt_value: nullableStringField(row, 'dflt_value'),
      pk: numberField(row, 'pk'),
      hidden: numberField(row, 'hidden'),
    }];
  });
}

function pragmaIndexes(rows: RawRow[]): PragmaIndex[] {
  return rows.flatMap((row): PragmaIndex[] => {
    const name = stringField(row, 'name');
    return name
      ? [{
          name,
          unique: numberField(row, 'unique'),
          origin: stringField(row, 'origin'),
          partial: numberField(row, 'partial'),
        }]
      : [];
  });
}

function pragmaIndexColumns(rows: RawRow[]): PragmaIndexColumn[] {
  return rows.map((row) => ({
    seqno: numberField(row, 'seqno'),
    name: nullableStringField(row, 'name'),
    desc: numberField(row, 'desc'),
    coll: nullableStringField(row, 'coll'),
    key: numberField(row, 'key'),
  }));
}

function pragmaForeignKeys(rows: RawRow[]): PragmaForeignKey[] {
  return rows.map((row) => ({
    id: numberField(row, 'id'),
    seq: numberField(row, 'seq'),
    table: stringField(row, 'table'),
    from: stringField(row, 'from'),
    to: stringField(row, 'to'),
    on_update: stringField(row, 'on_update'),
    on_delete: stringField(row, 'on_delete'),
  }));
}

function catalogColumnRows(rows: RawRow[]): CatalogColumn[] {
  return rows.flatMap((row): CatalogColumn[] => {
    const name = stringField(row, 'name');
    if (!name) return [];
    return [{
      name,
      data_type: stringField(row, 'data_type'),
      nullable: scalarField(row, 'nullable'),
      default_value: row.default_value,
      primary_key_position: row.primary_key_position === null
        ? null
        : numberOrStringField(row, 'primary_key_position'),
      auto_increment: scalarField(row, 'auto_increment'),
      hidden: scalarField(row, 'hidden'),
    }];
  });
}

function catalogIndexRows(rows: RawRow[]): CatalogIndex[] {
  return rows.flatMap((row): CatalogIndex[] => {
    const name = stringField(row, 'name');
    if (!name) return [];
    return [{
      name,
      unique: scalarField(row, 'unique'),
      origin: stringField(row, 'origin'),
      partial: scalarField(row, 'partial'),
      column_name: nullableStringField(row, 'column_name'),
      position: numberOrStringField(row, 'position'),
      descending: scalarField(row, 'descending'),
      collation: nullableStringField(row, 'collation'),
    }];
  });
}

function catalogForeignKeyRows(rows: RawRow[]): CatalogForeignKey[] {
  return rows.flatMap((row): CatalogForeignKey[] => {
    const name = stringField(row, 'name');
    const referencedTable = stringField(row, 'referenced_table');
    const columnName = stringField(row, 'column_name');
    const referencedColumn = stringField(row, 'referenced_column');
    if (!name || !referencedTable || !columnName || !referencedColumn) return [];
    return [{
      name,
      referenced_table: referencedTable,
      column_name: columnName,
      referenced_column: referencedColumn,
      position: numberOrStringField(row, 'position'),
      on_update: nullableStringField(row, 'on_update'),
      on_delete: nullableStringField(row, 'on_delete'),
    }];
  });
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' ||
    (typeof value === 'string' && ['yes', 'true', 't'].includes(value.toLowerCase()));
}

function editableReason(
  kind: 'table' | 'view',
  rowLocators: StudioRowLocator[],
  provider: StudioProvider,
): string | undefined {
  const providerName = String(provider);
  if (kind === 'view') return 'Views are read-only.';
  if (!rowLocators.length) {
    return providerName === 'mysql'
      ? 'This table has no primary key or non-null unique index.'
      : 'This table has no safe row locator.';
  }
  return undefined;
}

function uniqueIndexLocators(
  columns: StudioColumn[],
  indexes: StudioIndex[],
): StudioRowLocator[] {
  return indexes
    .filter((index) => index.unique && !index.partial && index.origin !== 'pk')
    .map((index): StudioRowLocator | undefined => {
      const names = [...index.columns]
        .sort((left, right) => left.position - right.position)
        .map((column) => column.name);
      const safeNames = names.filter((name): name is string => name !== null);
      if (safeNames.length !== names.length) return undefined;
      if (safeNames.some((name) => columns.find((column) => column.name === name)?.nullable !== false)) {
        return undefined;
      }
      return { kind: 'unique-index', columns: safeNames, name: index.name };
    })
    .filter((locator): locator is Extract<StudioRowLocator, { kind: 'unique-index' }> =>
      locator !== undefined)
    .sort((left, right) =>
      left.columns.length - right.columns.length || left.name.localeCompare(right.name));
}

function internalAlias(base: string, columns: StudioColumn[], reserved: string[] = []): string {
  const names = new Set([
    ...columns.map((column) => column.name.toLowerCase()),
    ...reserved.map((name) => name.toLowerCase()),
  ]);
  let alias = base;
  let suffix = 2;
  while (names.has(alias.toLowerCase())) {
    alias = `${base.slice(0, -2)}_${suffix}__`;
    suffix++;
  }
  return alias;
}

function availableSqliteRowid(
  row: SchemaRow,
  columns: StudioColumn[],
  sql: string | null,
): Extract<StudioRowLocator, { kind: 'sqlite-rowid' }> | undefined {
  if ((row.kind ?? row.type) !== 'table') return undefined;
  if (/\bWITHOUT\s+ROWID\b/i.test(sql ?? '')) return undefined;
  if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(sql ?? '')) return undefined;
  const declared = new Set(columns.map((column) => column.name.toLowerCase()));
  const source = (['rowid', '_rowid_', 'oid'] as const)
    .find((candidate) => !declared.has(candidate));
  return source
    ? {
        kind: 'sqlite-rowid',
        columns: [internalAlias(SQLITE_ROWID_ALIAS, columns)],
        source,
      }
    : undefined;
}

function rowLocators(
  provider: StudioProvider,
  row: SchemaRow,
  columns: StudioColumn[],
  indexes: StudioIndex[],
  sql: string | null,
): StudioRowLocator[] {
  const providerName = String(provider);
  if ((row.kind ?? row.type) === 'view') return [];
  const primaryKey = columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    .map((column) => column.name);
  const locators: StudioRowLocator[] = primaryKey.length
    ? [{ kind: 'primary-key', columns: primaryKey }]
    : [];
  locators.push(...uniqueIndexLocators(columns, indexes));
  if (
    providerName === 'postgres' &&
    row.table_type !== 'FOREIGN' &&
    row.table_type !== 'FOREIGN TABLE'
  ) {
    const tableoidAlias = internalAlias(POSTGRES_TABLEOID_ALIAS, columns);
    const ctidAlias = internalAlias(POSTGRES_CTID_ALIAS, columns, [tableoidAlias]);
    locators.push({
      kind: 'postgres-ctid',
      columns: [tableoidAlias, ctidAlias],
    });
  } else if (
    providerName === 'sqlite' ||
    providerName === 'libsql' ||
    providerName === 'd1-local' ||
    providerName === 'd1-remote'
  ) {
    const rowid = availableSqliteRowid(row, columns, sql);
    if (rowid) locators.push(rowid);
  }
  return locators;
}

function buildObject(
  provider: StudioProvider,
  row: SchemaRow,
  columns: StudioColumn[],
  indexes: StudioIndex[],
  foreignKeys: StudioForeignKey[],
  sql: string | null,
): StudioObject {
  const kind = row.kind ?? row.type ?? 'table';
  const locators = rowLocators(provider, row, columns, indexes, sql);
  const reason = editableReason(kind, locators, provider);
  return {
    name: row.name,
    kind,
    sql,
    columns,
    indexes,
    foreignKeys,
    rowLocators: locators,
    editable: reason === undefined,
    ...(reason ? { readOnlyReason: reason } : {}),
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

function catalogForeignKeys(rows: CatalogForeignKey[]): StudioForeignKey[] {
  const foreignKeys = new Map<string, StudioForeignKey>();
  for (const row of rows) {
    let foreignKey = foreignKeys.get(row.name);
    if (!foreignKey) {
      foreignKey = {
        name: row.name,
        referencedTable: row.referenced_table,
        columns: [],
        onUpdate: row.on_update ?? null,
        onDelete: row.on_delete ?? null,
      };
      foreignKeys.set(row.name, foreignKey);
    }
    foreignKey.columns.push({
      column: row.column_name,
      referencedColumn: row.referenced_column,
      position: Number(row.position ?? 0),
    });
  }
  return [...foreignKeys.values()].map((foreignKey) => ({
    ...foreignKey,
    columns: [...foreignKey.columns].sort((left, right) => left.position - right.position),
  }));
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
  // D1 exposes protected metadata tables that reject PRAGMA inspection with SQLITE_AUTH.
  const excludeCloudflareTables = connection.info.provider === 'd1-local' ||
    connection.info.provider === 'd1-remote'
    ? "\n      AND name NOT GLOB '_cf_*'"
    : '';
  const result = await connection.execute(`
    SELECT name, type, sql
    FROM sqlite_schema
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'${excludeCloudflareTables}
    ORDER BY type, name
  `);
  const objects: StudioObject[] = [];
  for (const row of schemaRows(result.rows)) {
    const pragma = await connection.execute(
      `PRAGMA table_xinfo(${quoteIdentifier(row.name)})`,
    );
    const definition = row.sql ?? '';
    const columns = pragmaColumns(pragma.rows).map((column) => {
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
    const foreignKeys: StudioForeignKey[] = [];
    if (row.type === 'table') {
      const indexList = await connection.execute(
        `PRAGMA index_list(${quoteIdentifier(row.name)})`,
      );
      for (const index of pragmaIndexes(indexList.rows)) {
        const indexInfo = await connection.execute(
          `PRAGMA index_xinfo(${quoteIdentifier(index.name)})`,
        );
        indexes.push({
          name: index.name,
          unique: Number(index.unique ?? 0) !== 0,
          origin: index.origin ?? 'c',
          partial: Number(index.partial ?? 0) !== 0,
          columns: pragmaIndexColumns(indexInfo.rows)
            .filter((column) => Number(column.key ?? 1) !== 0)
            .map((column) => ({
              name: column.name ?? null,
              position: Number(column.seqno ?? 0),
              descending: Number(column.desc ?? 0) !== 0,
              collation: column.coll ?? null,
            })),
        });
      }
      const foreignKeyList = await connection.execute(
        `PRAGMA foreign_key_list(${quoteIdentifier(row.name)})`,
      );
      const grouped = new Map<number, StudioForeignKey>();
      for (const foreignKey of pragmaForeignKeys(foreignKeyList.rows)) {
        const id = Number(foreignKey.id ?? 0);
        const referencedTable = foreignKey.table;
        const column = foreignKey.from;
        const referencedColumn = foreignKey.to;
        if (!referencedTable || !column || !referencedColumn) continue;
        let definition = grouped.get(id);
        if (!definition) {
          definition = {
            name: `fk_${row.name}_${id}`,
            referencedTable,
            columns: [],
            onUpdate: foreignKey.on_update ?? null,
            onDelete: foreignKey.on_delete ?? null,
          };
          grouped.set(id, definition);
        }
        definition.columns.push({
          column,
          referencedColumn,
          position: Number(foreignKey.seq ?? 0),
        });
      }
      foreignKeys.push(...[...grouped.values()].map((foreignKey) => ({
        ...foreignKey,
        columns: [...foreignKey.columns]
          .sort((left, right) => left.position - right.position),
      })));
    }
    objects.push(buildObject(
      connection.info.provider,
      row,
      columns,
      indexes,
      foreignKeys,
      row.sql ?? null,
    ));
  }
  return objects;
}

async function introspectPostgres(connection: StudioConnection): Promise<StudioObject[]> {
  const result = await connection.execute(`
    SELECT
      tables.table_name AS name,
      CASE WHEN tables.table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind,
      tables.table_type AS table_type,
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
  for (const row of schemaRows(result.rows)) {
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
    const columns = catalogColumns(catalogColumnRows(columnResult.rows));
    let indexes: StudioIndex[] = [];
    let foreignKeys: StudioForeignKey[] = [];
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
          index_key.ordinality - 1 AS position,
          (index_info.indoption[index_key.ordinality - 1] & 1) = 1 AS descending,
          index_collation.collname AS collation
        FROM pg_catalog.pg_class AS table_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = table_class.relnamespace
        JOIN pg_catalog.pg_index AS index_info
          ON index_info.indrelid = table_class.oid
        JOIN pg_catalog.pg_class AS index_class
          ON index_class.oid = index_info.indexrelid
        CROSS JOIN LATERAL unnest(index_info.indkey)
          WITH ORDINALITY AS index_key(attribute_number, ordinality)
        LEFT JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = table_class.oid
          AND attribute.attnum = index_key.attribute_number
        LEFT JOIN pg_catalog.pg_collation AS index_collation
          ON index_collation.oid = index_info.indcollation[index_key.ordinality - 1]
          AND index_info.indcollation[index_key.ordinality - 1] <> 0
        WHERE namespace.nspname = current_schema()
          AND table_class.relname = ?
        ORDER BY index_class.relname, index_key.ordinality
      `, [row.name]);
      indexes = catalogIndexes(catalogIndexRows(indexResult.rows));
      const foreignKeyResult = await connection.execute(`
        SELECT
          constraints.constraint_name AS name,
          foreign_usage.table_name AS referenced_table,
          usage.column_name AS column_name,
          foreign_usage.column_name AS referenced_column,
          usage.ordinal_position - 1 AS position,
          referential.update_rule AS on_update,
          referential.delete_rule AS on_delete
        FROM information_schema.table_constraints AS constraints
        JOIN information_schema.key_column_usage AS usage
          ON usage.constraint_catalog = constraints.constraint_catalog
          AND usage.constraint_schema = constraints.constraint_schema
          AND usage.constraint_name = constraints.constraint_name
        JOIN information_schema.referential_constraints AS referential
          ON referential.constraint_catalog = constraints.constraint_catalog
          AND referential.constraint_schema = constraints.constraint_schema
          AND referential.constraint_name = constraints.constraint_name
        JOIN information_schema.key_column_usage AS foreign_usage
          ON foreign_usage.constraint_catalog = referential.unique_constraint_catalog
          AND foreign_usage.constraint_schema = referential.unique_constraint_schema
          AND foreign_usage.constraint_name = referential.unique_constraint_name
          AND foreign_usage.ordinal_position = usage.position_in_unique_constraint
        WHERE constraints.constraint_type = 'FOREIGN KEY'
          AND constraints.table_schema = current_schema()
          AND constraints.table_name = ?
        ORDER BY constraints.constraint_name, usage.ordinal_position
      `, [row.name]);
      foreignKeys = catalogForeignKeys(catalogForeignKeyRows(foreignKeyResult.rows));
    }
    objects.push(buildObject(
      'postgres',
      row,
      columns,
      indexes,
      foreignKeys,
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
  for (const row of schemaRows(result.rows)) {
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
    const columns = catalogColumns(catalogColumnRows(columnResult.rows));
    let indexes: StudioIndex[] = [];
    let foreignKeys: StudioForeignKey[] = [];
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
      indexes = catalogIndexes(catalogIndexRows(indexResult.rows));
      const foreignKeyResult = await connection.execute(`
        SELECT
          usage.CONSTRAINT_NAME AS name,
          usage.REFERENCED_TABLE_NAME AS referenced_table,
          usage.COLUMN_NAME AS column_name,
          usage.REFERENCED_COLUMN_NAME AS referenced_column,
          usage.ORDINAL_POSITION - 1 AS position,
          referential.UPDATE_RULE AS on_update,
          referential.DELETE_RULE AS on_delete
        FROM information_schema.key_column_usage AS usage
        JOIN information_schema.referential_constraints AS referential
          ON referential.CONSTRAINT_SCHEMA = usage.CONSTRAINT_SCHEMA
          AND referential.CONSTRAINT_NAME = usage.CONSTRAINT_NAME
          AND referential.TABLE_NAME = usage.TABLE_NAME
        WHERE usage.TABLE_SCHEMA = DATABASE()
          AND usage.TABLE_NAME = ?
          AND usage.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY usage.CONSTRAINT_NAME, usage.ORDINAL_POSITION
      `, [row.name]);
      foreignKeys = catalogForeignKeys(catalogForeignKeyRows(foreignKeyResult.rows));
    }
    objects.push(buildObject(
      'mysql',
      row,
      columns,
      indexes,
      foreignKeys,
      await mysqlDefinition(connection, row, columns),
    ));
  }
  return objects;
}

export async function introspectSchema(
  connection: StudioConnection,
  applicationName = 'Cossack application',
  knownDatabaseVersion?: string,
): Promise<StudioSchema> {
  const provider = connection.info.provider;
  const providerName = String(provider);
  const databaseVersion = knownDatabaseVersion ?? await readDatabaseVersion(connection);
  const physicalObjects = providerName === 'postgres'
    ? await introspectPostgres(connection)
    : providerName === 'mysql'
      ? await introspectMysql(connection)
      : providerName === 'unknown'
        ? (() => {
            throw new Error(
              'Studio could not detect the database driver. Set DB_CONNECTION to ' +
              'sqlite, turso, d1, postgres, or mysql.',
            );
          })()
        : await introspectSqlite(connection);
  const objects = physicalObjects.filter((object) => !INTERNAL_TABLES.has(object.name));
  const drift = mergeLogicalSchema(objects, connection.logicalSchema);
  return {
    connection: {
      ...connection.info,
      ...(databaseVersion ? { databaseVersion } : {}),
    },
    applicationName,
    objects,
    ...(drift.length ? { drift } : {}),
  };
}

export function mergeLogicalSchema(
  objects: StudioObject[],
  logical?: OrmSchema,
): string[] {
  if (!logical) return [];
  const drift: string[] = [];
  const byTable = new Map(objects.map((object) => [object.name, object]));
  const modeledTables = new Set(logical.entities.map((entity) => entity.tableName));
  for (const entity of logical.entities) {
    const object = byTable.get(entity.tableName);
    if (!object) {
      drift.push(`Missing table ${entity.tableName} for model ${entity.modelName}`);
      continue;
    }
    object.modelName = entity.modelName;
    object.relations = entity.relations.map((relation) => ({
      propertyName: relation.propertyName,
      kind: relation.kind,
      targetEntity: relation.targetEntity,
      provenance: 'orm' as const,
    }));
    const physicalColumns = new Map(object.columns.map((column) => [column.name, column]));
    for (const logicalColumn of entity.columns) {
      const physical = physicalColumns.get(logicalColumn.columnName);
      if (!physical) {
        drift.push(
          `Missing column ${entity.tableName}.${logicalColumn.columnName} ` +
          `for ${entity.modelName}.${logicalColumn.propertyName}`,
        );
        continue;
      }
      physical.logicalType = logicalColumn.logicalType;
      physical.propertyName = logicalColumn.propertyName;
    }
  }
  for (const object of objects) {
    if (object.kind === 'table' && !modeledTables.has(object.name)) {
      drift.push(`Unmanaged table ${object.name}`);
    }
  }
  return drift;
}

async function readDatabaseVersion(connection: StudioConnection): Promise<string | undefined> {
  const provider = connection.info.provider;
  const providerName = String(provider);
  const sql = providerName === 'postgres'
    ? 'SELECT version() AS version'
    : providerName === 'mysql'
      ? 'SELECT VERSION() AS version'
      : 'SELECT sqlite_version() AS version';
  try {
    const result = await connection.execute(sql);
    const raw = String(result.rows[0]?.version ?? '').trim();
    if (!raw) return undefined;
    if (providerName === 'postgres') {
      const version = raw.match(/^PostgreSQL\s+([^\s,]+)/i)?.[1];
      return version ? `PostgreSQL ${version}` : raw;
    }
    if (providerName === 'mysql') {
      const mariaVersion = raw.match(/^([^\s-]+).*MariaDB/i)?.[1];
      return mariaVersion ? `MariaDB ${mariaVersion}` : `MySQL ${raw}`;
    }
    return `SQLite ${raw}`;
  } catch {
    return undefined;
  }
}

export function findObject(schema: StudioSchema, name: string): StudioObject {
  const object = schema.objects.find((candidate) => candidate.name === name);
  if (!object) throw new Error(`Table or view "${name}" does not exist.`);
  return object;
}
