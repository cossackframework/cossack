import type { DatabaseValue, QueryResult } from "../adapter/types.js";
import type { OrmSchema, ColumnSchema, LogicalType } from "./types.js";

type Execute = <Row = Record<string, unknown>>(
  text: string,
  parameters?: readonly DatabaseValue[],
) => Promise<QueryResult<Row>>;

function logicalFromDatabase(databaseType: string): LogicalType {
  const type = databaseType.toLowerCase();
  if (type.endsWith("[]")) return logicalFromDatabase(databaseType.slice(0, -2));
  const base = type.replace(/\([^)]*\)$/, "").trim();
  if (base === "boolean" || base === "bool") return "boolean";
  if (["bigint", "bigserial", "int8"].includes(base)) return "bigint";
  if (["tinyint", "smallint", "mediumint", "integer", "int", "int2", "int4", "serial", "smallserial"].includes(base)) return "integer";
  if (base === "json" || base === "jsonb") return "json";
  if (base === "date") return "date";
  if (base === "datetime" || base.startsWith("timestamp") || base === "time" || base.startsWith("time ")) return "datetime";
  if (base === "uuid") return "uuid";
  if (["decimal", "numeric", "real", "double precision", "float", "float4", "float8"].includes(base)) return "decimal";
  if (["blob", "binary", "varbinary", "bytea"].includes(base)) return "blob";
  if (["varchar", "character varying", "character", "char"].includes(base)) return "varchar";
  if (["text", "clob"].includes(base)) return "text";
  return `custom:${databaseType}`;
}

function parseLength(databaseType: string): number | undefined {
  const match = /\((\d+)\)/.exec(databaseType);
  return match ? Number(match[1]) : undefined;
}

function sqliteDefault(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);
  if (/^null$/i.test(trimmed)) return null;
  return value;
}

function postgresDefault(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const castString = /^'((?:[^']|'')*)'::[\w\s.\[\]"]+$/.exec(trimmed);
  if (castString) return castString[1]!.replaceAll("''", "'");
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^null$/i.test(trimmed)) return null;
  if (/^(?:current_timestamp|transaction_timestamp\(\))$/i.test(trimmed)) return "now()";
  return value;
}

function parsePrecision(databaseType: string): { precision?: number; scale?: number } {
  const match = /\((\d+)\s*,\s*(\d+)\)/.exec(databaseType);
  return match ? { precision: Number(match[1]), scale: Number(match[2]) } : {};
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replaceAll('""', '"');
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) return trimmed.slice(1, -1).replaceAll("``", "`");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1);
  return trimmed;
}

function stringLiterals(list: string): string[] {
  return [...list.matchAll(/(?:_\w+)?'((?:[^'\\]|''|\\.)*)'/g)]
    .map((match) => match[1]!.replaceAll("''", "'").replace(/\\(.)/g, "$1"));
}

const IDENTIFIER = /"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|[A-Za-z_][\w$]*/.source;
const LITERAL = /(?:_\w+)?'(?:[^'\\]|''|\\.)*'/.source;
const LITERAL_LIST = `${LITERAL}(?:\\s*,\\s*${LITERAL})*`;

/**
 * Finds the enum checks the ORM's own DDL emits, `CHECK ("column" IN ('a', 'b'))`,
 * in a SQLite `CREATE TABLE` statement or a MySQL check clause.
 */
function enumChecks(definition: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const pattern = new RegExp(String.raw`CHECK\s*\(\s*(${IDENTIFIER})\s+IN\s*\(\s*(${LITERAL_LIST})\s*\)\s*\)`, "gi");
  for (const match of definition.matchAll(pattern)) result.set(unquoteIdentifier(match[1]!), stringLiterals(match[2]!));
  return result;
}

/** Recognizes PostgreSQL's rendering of the ORM's enum check; other checks return undefined. */
function postgresEnumCheck(definition: string): { column: string; values: string[] } | undefined {
  const cast = String.raw`(?:::[\w\s"]+(?:\[\])?)?`;
  const column = String.raw`\(*\s*(${IDENTIFIER})\s*\)?${cast}\s*`;
  const anyArray = new RegExp(String.raw`^CHECK\s*\(+${column}=\s*ANY\s*\(+\s*ARRAY\[(.*)\]\)?${cast}\s*\)+$`, "i");
  const single = new RegExp(String.raw`^CHECK\s*\(+${column}=\s*('(?:[^']|'')*')${cast}\s*\)+$`, "i");
  const match = anyArray.exec(definition.trim()) ?? single.exec(definition.trim());
  if (!match) return undefined;
  const values = stringLiterals(match[2]!);
  return values.length ? { column: unquoteIdentifier(match[1]!), values } : undefined;
}

function postgresIndexColumn(value: string): string | undefined {
  const trimmed = value.trim();
  const quoted = /^"((?:[^"]|"")+)"$/.exec(trimmed);
  if (quoted) return quoted[1]!.replaceAll('""', '"');
  return /^[a-z_][a-z0-9_$]*$/.test(trimmed) ? trimmed : undefined;
}

export async function introspectSQLite(
  execute: Execute,
  options: { readonly excludedTablePrefixes?: readonly string[] } = {},
): Promise<OrmSchema> {
  const tables = await execute<{ name: string; sql?: string | null }>(
    // Keep catalog filtering outside SQL: workerd's SQLite authorizer rejects
    // some filtered catalog queries used by D1. This query also works on Node.
    "SELECT name, sql FROM sqlite_master WHERE type = 'table'",
  );
  const entities = [];
  const visibleTables = tables.rows.filter(table => table.name !== "_cossack_migrations" &&
    !["sqlite_", ...(options.excludedTablePrefixes ?? [])].some(prefix => table.name.startsWith(prefix)))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const table of visibleTables) {
    const escaped = table.name.replaceAll('"', '""');
    const columnsResult = await execute<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>(`PRAGMA table_info("${escaped}")`);
    const indexesResult = await execute<{ name: string; unique: number; origin?: string }>(
      `PRAGMA index_list("${escaped}")`,
    );
    const allIndexes: {
      name: string;
      columns: string[];
      unique: boolean;
      origin?: string;
    }[] = [];
    for (const index of indexesResult.rows) {
      const indexEscaped = index.name.replaceAll('"', '""');
      const details = await execute<{ name: string }>(`PRAGMA index_info("${indexEscaped}")`);
      allIndexes.push({
        name: index.name,
        columns: details.rows.map((row) => row.name),
        unique: Boolean(index.unique),
        ...(index.origin === undefined ? {} : { origin: index.origin }),
      });
    }
    const indexes = allIndexes
      .filter((index) => !index.name.startsWith("sqlite_autoindex_"))
      .map(({ name, columns, unique }) => ({ name, columns, unique }));
    const foreignKeys = await execute<{
      table: string;
      from: string;
      to: string;
      on_delete: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
    }>(`PRAGMA foreign_key_list("${escaped}")`);
    const checks = enumChecks(table.sql ?? "");
    const primaryCount = columnsResult.rows.filter((column) => column.pk).length;
    const columns: ColumnSchema[] = columnsResult.rows.map((column) => {
      const length = parseLength(column.type);
      const values = checks.get(column.name);
      return {
        propertyName: column.name,
        columnName: column.name,
        logicalType: values ? "enum" : logicalFromDatabase(column.type),
        databaseType: column.type,
        nullable: !column.notnull && !column.pk,
        primary: Boolean(column.pk),
        // Only a single-column `INTEGER PRIMARY KEY` is a rowid alias that SQLite fills in.
        generated: column.pk && primaryCount === 1 && column.type.trim().toLowerCase() === "integer" ? "increment" : false,
        // Only UNIQUE constraints (origin "u") make a column unique; explicit
        // CREATE UNIQUE INDEX statements stay in `indexes`.
        unique: allIndexes.some((index) =>
          index.unique &&
          index.origin === "u" &&
          index.columns.length === 1 &&
          index.columns[0] === column.name),
        ...(length === undefined ? {} : { length }),
        ...(logicalFromDatabase(column.type) === "decimal" ? parsePrecision(column.type) : {}),
        ...(values ? { enumValues: values } : {}),
        ...(column.dflt_value === null ? {} : { default: sqliteDefault(column.dflt_value) }),
        insert: true,
        update: true,
        select: true,
      };
    });
    entities.push({
      modelName: table.name,
      tableName: table.name,
      columns,
      relations: foreignKeys.rows.map((foreignKey) => ({
        propertyName: foreignKey.from,
        kind: "many-to-one" as const,
        targetEntity: foreignKey.table,
        targetTableName: foreignKey.table,
        owner: true,
        nullable: columns.find((column) => column.columnName === foreignKey.from)?.nullable ?? true,
        physical: true,
        joinColumn: foreignKey.from,
        referencedColumn: foreignKey.to,
        referencedProperty: foreignKey.to,
        cascade: [],
        onDelete: foreignKey.on_delete,
      })),
      indexes,
      virtual: false,
    });
  }
  return { version: 1, dialect: "sqlite", entities };
}

export async function introspectPostgres(execute: Execute): Promise<OrmSchema> {
  const columnsResult = await execute<Record<string, unknown>>(`
    SELECT
      table_class.relname AS table_name,
      attribute.attname AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
      attribute.attnotnull AS not_null,
      pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid) AS column_default,
      attribute.attidentity AS identity_kind,
      attribute.attgenerated AS generated_kind,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint primary_constraint
        WHERE primary_constraint.conrelid = table_class.oid
          AND primary_constraint.contype = 'p'
          AND attribute.attnum = ANY(primary_constraint.conkey)
      ) AS is_primary,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint unique_constraint
        WHERE unique_constraint.conrelid = table_class.oid
          AND unique_constraint.contype = 'u'
          AND cardinality(unique_constraint.conkey) = 1
          AND attribute.attnum = ANY(unique_constraint.conkey)
      ) AS is_unique
    FROM pg_catalog.pg_attribute attribute
    JOIN pg_catalog.pg_class table_class ON table_class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef column_default
      ON column_default.adrelid = attribute.attrelid
      AND column_default.adnum = attribute.attnum
    WHERE namespace.nspname = 'public'
      AND table_class.relkind IN ('r', 'p')
      AND table_class.relname <> '_cossack_migrations'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY table_class.relname, attribute.attnum
  `);
  const indexesResult = await execute<Record<string, unknown>>(`
    SELECT
      table_class.relname AS table_name,
      index_class.relname AS index_name,
      index_record.indisunique AS is_unique,
      index_record.indisprimary AS is_primary,
      access_method.amname AS access_method,
      constraint_record.contype AS constraint_type,
      index_record.indexprs IS NOT NULL AS is_expression,
      index_record.indpred IS NOT NULL AS is_partial,
      pg_catalog.pg_get_indexdef(index_record.indexrelid) AS definition,
      ARRAY(
        SELECT pg_catalog.pg_get_indexdef(index_record.indexrelid, key_position.position, true)
        FROM generate_series(1, index_record.indnkeyatts) AS key_position(position)
        ORDER BY key_position.position
      ) AS index_columns
    FROM pg_catalog.pg_index index_record
    JOIN pg_catalog.pg_class index_class ON index_class.oid = index_record.indexrelid
    JOIN pg_catalog.pg_class table_class ON table_class.oid = index_record.indrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_am access_method ON access_method.oid = index_class.relam
    -- A foreign key also records the referenced unique index in conindid; only
    -- the table's own primary, unique or exclusion constraint owns the index.
    LEFT JOIN pg_catalog.pg_constraint constraint_record ON constraint_record.conindid = index_record.indexrelid
      AND constraint_record.conrelid = index_record.indrelid
      AND constraint_record.contype IN ('p', 'u', 'x')
    WHERE namespace.nspname = 'public'
      AND table_class.relname <> '_cossack_migrations'
    ORDER BY table_class.relname, index_class.relname
  `);
  const constraintsResult = await execute<Record<string, unknown>>(`
    SELECT
      table_class.relname AS table_name,
      constraint_record.conname AS constraint_name,
      constraint_record.contype AS constraint_type,
      pg_catalog.pg_get_constraintdef(constraint_record.oid, true) AS definition
    FROM pg_catalog.pg_constraint constraint_record
    JOIN pg_catalog.pg_class table_class ON table_class.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_class.relname <> '_cossack_migrations'
      AND constraint_record.contype IN ('c', 'x')
    ORDER BY table_class.relname, constraint_record.conname
  `);

  const unsupported: string[] = [];
  for (const column of columnsResult.rows) {
    if (String(column["generated_kind"] ?? "")) {
      unsupported.push(
        `generated column ${String(column["table_name"])}.${String(column["column_name"])}`,
      );
    }
  }

  const indexesByTable = new Map<string, { name: string; columns: string[]; unique: boolean }[]>();
  for (const index of indexesResult.rows) {
    if (Boolean(index["is_primary"])) continue;
    const tableName = String(index["table_name"]);
    const name = String(index["index_name"]);
    const method = String(index["access_method"]);
    const definition = String(index["definition"] ?? "");
    const rawColumns = Array.isArray(index["index_columns"])
      ? index["index_columns"].map(String)
      : [];
    const columns = rawColumns.map(postgresIndexColumn);
    const singleColumnConstraint = index["constraint_type"] === "u" && columns.length === 1;
    if (singleColumnConstraint) continue;

    const reasons = [
      ...(method !== "btree" ? [`access method ${method}`] : []),
      ...(Boolean(index["is_expression"]) ? ["expressions"] : []),
      ...(Boolean(index["is_partial"]) ? ["a predicate"] : []),
      ...(definition.includes(" INCLUDE ") ? ["included columns"] : []),
      ...(columns.some((column) => column === undefined) ? ["operator classes or expressions"] : []),
    ];
    if (reasons.length) {
      unsupported.push(`index ${name} on ${tableName} (${reasons.join(", ")})`);
      continue;
    }
    const tableIndexes = indexesByTable.get(tableName) ?? [];
    tableIndexes.push({
      name,
      columns: columns as string[],
      unique: Boolean(index["is_unique"]),
    });
    indexesByTable.set(tableName, tableIndexes);
  }
  const enumsByColumn = new Map<string, string[]>();
  const columnKeys = new Set(columnsResult.rows.map((row) => `${String(row["table_name"])}\0${String(row["column_name"])}`));
  for (const constraint of constraintsResult.rows) {
    const tableName = String(constraint["table_name"]);
    const enumCheck = constraint["constraint_type"] === "c" ? postgresEnumCheck(String(constraint["definition"] ?? "")) : undefined;
    const key = enumCheck ? `${tableName}\0${enumCheck.column}` : "";
    if (enumCheck && columnKeys.has(key) && !enumsByColumn.has(key)) {
      enumsByColumn.set(key, enumCheck.values);
      continue;
    }
    unsupported.push(
      `constraint ${String(constraint["constraint_name"])} on ${tableName} ` +
      `(${String(constraint["definition"])})`,
    );
  }
  if (unsupported.length) {
    throw new Error(
      `[Cossack database] PostgreSQL introspection cannot safely represent ${unsupported.join("; ")}. ` +
      "Schema diff/check, schema pull, and migration baseline were stopped to avoid misleading drift. " +
      "Use model snapshots with migration status/check, or manage these objects in reviewed raw migrations.",
    );
  }

  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of columnsResult.rows) {
    const table = String(row["table_name"]);
    const group = grouped.get(table) ?? [];
    group.push(row);
    grouped.set(table, group);
  }
  return {
    version: 1,
    dialect: "postgres",
    entities: [...grouped].map(([tableName, columns]) => ({
      modelName: tableName,
      tableName,
      columns: columns.map((column) => {
        const databaseType = String(column["data_type"]);
        const baseType = databaseType.endsWith("[]") ? databaseType.slice(0, -2) : databaseType;
        const defaultValue = column["column_default"];
        const serial = typeof defaultValue === "string" && /^nextval\(.+::regclass\)$/.test(defaultValue);
        const identity = Boolean(String(column["identity_kind"] ?? ""));
        const length = logicalFromDatabase(baseType) === "varchar" ? parseLength(baseType) : undefined;
        const precision = parsePrecision(baseType);
        const values = enumsByColumn.get(`${tableName}\0${String(column["column_name"])}`);
        return {
          propertyName: String(column["column_name"]),
          columnName: String(column["column_name"]),
          logicalType: values ? "enum" as const : logicalFromDatabase(baseType),
          ...(values ? { enumValues: values } : {}),
          databaseType,
          nullable: !Boolean(column["not_null"]),
          primary: Boolean(column["is_primary"]),
          generated: identity ? "identity" as const : serial ? "increment" as const : false,
          unique: Boolean(column["is_unique"]),
          ...(length === undefined ? {} : { length }),
          ...precision,
          ...(databaseType.endsWith("[]") ? { array: true } : {}),
          ...(defaultValue === null || defaultValue === undefined || serial
            ? {}
            : { default: postgresDefault(defaultValue) }),
          insert: true,
          update: true,
          select: true,
        };
      }),
      relations: [],
      indexes: indexesByTable.get(tableName) ?? [],
      virtual: false,
    })),
  };
}

function mysqlLogicalType(columnType: string): LogicalType {
  const type = columnType.trim().toLowerCase();
  if (/^tinyint\(1\)/.test(type) || type === "boolean" || type === "bool") return "boolean";
  const base = type.replace(/\(.*?\)/g, "").replace(/\b(?:unsigned|signed|zerofill)\b/g, "").trim();
  if (base === "enum") return "enum";
  const logical = logicalFromDatabase(base);
  return logical.startsWith("custom:") ? `custom:${columnType}` : logical;
}

function mysqlDefault(value: unknown, logicalType: LogicalType, extra: string): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  // MariaDB quotes literal defaults and reports a missing default as NULL.
  if (/^null$/i.test(trimmed)) return null;
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'").replace(/\\(.)/g, "$1");
  }
  if (/^(?:current_timestamp(?:\(\d*\))?|now\(\d*\))$/i.test(trimmed)) return trimmed;
  if (/DEFAULT_GENERATED/i.test(extra)) return trimmed;
  if (["integer", "bigint", "decimal"].includes(logicalType) && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return Number(trimmed);
  }
  return value;
}

export async function introspectMySQL(execute: Execute): Promise<OrmSchema> {
  // MySQL 8 labels information_schema columns in upper case unless they are aliased.
  const columnsResult = await execute<Record<string, unknown>>(`
    SELECT
      table_name AS table_name,
      column_name AS column_name,
      column_type AS column_type,
      is_nullable AS is_nullable,
      column_default AS column_default,
      column_key AS column_key,
      extra AS extra
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name <> '_cossack_migrations'
    ORDER BY table_name, ordinal_position
  `);
  const indexesResult = await execute<Record<string, unknown>>(`
    SELECT
      table_name AS table_name,
      index_name AS index_name,
      non_unique AS non_unique,
      seq_in_index AS seq_in_index,
      column_name AS column_name,
      sub_part AS sub_part,
      index_type AS index_type
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name <> '_cossack_migrations'
    ORDER BY table_name, index_name, seq_in_index
  `);
  const foreignKeysResult = await execute<Record<string, unknown>>(`
    SELECT
      table_name AS table_name,
      constraint_name AS constraint_name,
      column_name AS column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND referenced_table_name IS NOT NULL
    ORDER BY table_name, constraint_name, ordinal_position
  `);
  let checkRows: readonly Record<string, unknown>[] = [];
  try {
    checkRows = (await execute<Record<string, unknown>>(`
      SELECT
        table_constraint.table_name AS table_name,
        table_constraint.constraint_name AS constraint_name,
        check_constraint.check_clause AS check_clause
      FROM information_schema.table_constraints table_constraint
      JOIN information_schema.check_constraints check_constraint
        ON check_constraint.constraint_schema = table_constraint.constraint_schema
        AND check_constraint.constraint_name = table_constraint.constraint_name
      WHERE table_constraint.table_schema = DATABASE()
        AND table_constraint.constraint_type = 'CHECK'
        AND table_constraint.table_name <> '_cossack_migrations'
      ORDER BY table_constraint.table_name, table_constraint.constraint_name
    `)).rows;
  } catch {
    // Servers before MySQL 8.0.16 have no check constraint catalog (and do not enforce checks).
  }

  const unsupported: string[] = [];
  const key = (table: unknown, column: unknown) => `${String(table)}\0${String(column)}`;
  const columnKeys = new Set(columnsResult.rows.map((row) => key(row["table_name"], row["column_name"])));
  for (const column of columnsResult.rows) {
    if (/\bGENERATED\b/i.test(String(column["extra"] ?? "")) && !/DEFAULT_GENERATED/i.test(String(column["extra"] ?? ""))) {
      unsupported.push(`generated column ${String(column["table_name"])}.${String(column["column_name"])}`);
    }
  }

  const enums = new Map<string, string[]>();
  for (const check of checkRows) {
    const clause = String(check["check_clause"] ?? "").replaceAll("\\'", "'");
    // Only a clause that is exactly `column IN ('a', 'b')` is the ORM's enum check.
    const match = new RegExp(`^\\(*\\s*(${IDENTIFIER})\\s+IN\\s*\\(\\s*(${LITERAL_LIST})\\s*\\)\\s*\\)*$`, "i").exec(clause.trim());
    const column = match ? unquoteIdentifier(match[1]!) : undefined;
    if (match && column && columnKeys.has(key(check["table_name"], column))) {
      enums.set(key(check["table_name"], column), stringLiterals(match[2]!));
      continue;
    }
    unsupported.push(`constraint ${String(check["constraint_name"])} on ${String(check["table_name"])} (${clause})`);
  }

  const foreignKeys = new Map<string, { name: string; columns: string[] }>();
  for (const row of foreignKeysResult.rows) {
    const id = key(row["table_name"], row["constraint_name"]);
    const entry = foreignKeys.get(id) ?? { name: String(row["constraint_name"]), columns: [] };
    entry.columns.push(String(row["column_name"]));
    foreignKeys.set(id, entry);
  }

  const rawIndexes = new Map<string, { table: string; name: string; unique: boolean; type: string; columns: (string | null)[]; prefix: boolean }>();
  for (const row of indexesResult.rows) {
    if (String(row["index_name"]) === "PRIMARY") continue;
    const id = key(row["table_name"], row["index_name"]);
    const entry = rawIndexes.get(id) ?? {
      table: String(row["table_name"]),
      name: String(row["index_name"]),
      unique: Number(row["non_unique"]) === 0,
      type: String(row["index_type"] ?? "BTREE").toUpperCase(),
      columns: [],
      prefix: false,
    };
    entry.columns.push(row["column_name"] === null || row["column_name"] === undefined ? null : String(row["column_name"]));
    if (row["sub_part"] !== null && row["sub_part"] !== undefined) entry.prefix = true;
    rawIndexes.set(id, entry);
  }

  const uniqueColumns = new Set<string>();
  const indexesByTable = new Map<string, { name: string; columns: string[]; unique: boolean }[]>();
  for (const index of rawIndexes.values()) {
    const reasons = [
      ...(index.type !== "BTREE" ? [`index type ${index.type}`] : []),
      ...(index.columns.some((column) => column === null) ? ["expressions"] : []),
      ...(index.prefix ? ["column prefixes"] : []),
    ];
    if (reasons.length) {
      unsupported.push(`index ${index.name} on ${index.table} (${reasons.join(", ")})`);
      continue;
    }
    const columns = index.columns as string[];
    // A column-level UNIQUE creates a unique index named after its column.
    if (index.unique && columns.length === 1 && index.name === columns[0]) {
      uniqueColumns.add(key(index.table, columns[0]));
      continue;
    }
    // MySQL creates an index for a foreign key that has none, named after the
    // constraint or its column. It is not part of the model.
    const foreignKeyIndex = !index.unique && [...foreignKeys.entries()].some(([id, foreignKey]) =>
      id.startsWith(`${index.table}\0`) &&
      (index.name === foreignKey.name || index.name === foreignKey.columns[0]) &&
      foreignKey.columns.join("\0") === columns.join("\0"));
    if (foreignKeyIndex) continue;
    const tableIndexes = indexesByTable.get(index.table) ?? [];
    tableIndexes.push({ name: index.name, columns, unique: index.unique });
    indexesByTable.set(index.table, tableIndexes);
  }

  if (unsupported.length) {
    throw new Error(
      `[Cossack database] MySQL introspection cannot safely represent ${unsupported.join("; ")}. ` +
      "Schema diff/check, schema pull, and migration baseline were stopped to avoid misleading drift. " +
      "Use model snapshots with migration status/check, or manage these objects in reviewed raw migrations.",
    );
  }

  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of columnsResult.rows) {
    const table = String(row["table_name"]);
    const group = grouped.get(table) ?? [];
    group.push(row);
    grouped.set(table, group);
  }
  return {
    version: 1,
    dialect: "mysql",
    entities: [...grouped].map(([tableName, columns]) => ({
      modelName: tableName,
      tableName,
      columns: columns.map((column): ColumnSchema => {
        const columnName = String(column["column_name"]);
        const columnType = String(column["column_type"]);
        const extra = String(column["extra"] ?? "");
        const checked = enums.get(key(tableName, columnName));
        const nativeEnum = mysqlLogicalType(columnType) === "enum" ? stringLiterals(columnType) : undefined;
        const enumValues = checked ?? nativeEnum;
        const logicalType = enumValues ? "enum" : mysqlLogicalType(columnType);
        const length = logicalType === "varchar" ? parseLength(columnType) : undefined;
        const precision = logicalType === "decimal" ? parsePrecision(columnType) : {};
        const defaultValue = column["column_default"];
        return {
          propertyName: columnName,
          columnName,
          logicalType,
          databaseType: columnType,
          nullable: String(column["is_nullable"]).toUpperCase() === "YES",
          primary: String(column["column_key"] ?? "") === "PRI",
          generated: /auto_increment/i.test(extra) ? "increment" : false,
          unique: uniqueColumns.has(key(tableName, columnName)),
          ...(length === undefined ? {} : { length }),
          ...precision,
          ...(enumValues ? { enumValues } : {}),
          ...(defaultValue === null || defaultValue === undefined
            ? {}
            : { default: mysqlDefault(defaultValue, logicalType, extra) }),
          insert: true,
          update: true,
          select: true,
        };
      }),
      relations: [],
      indexes: indexesByTable.get(tableName) ?? [],
      virtual: false,
    })),
  };
}
