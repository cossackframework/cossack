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

function postgresIndexColumn(value: string): string | undefined {
  const trimmed = value.trim();
  const quoted = /^"((?:[^"]|"")+)"$/.exec(trimmed);
  if (quoted) return quoted[1]!.replaceAll('""', '"');
  return /^[a-z_][a-z0-9_$]*$/.test(trimmed) ? trimmed : undefined;
}

export async function introspectSQLite(execute: Execute): Promise<OrmSchema> {
  const tables = await execute<{ name: string }>(
    "SELECT name FROM sqlite_master " +
      "WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' " +
      "AND name <> '_cossack_migrations' " +
      "ORDER BY name",
  );
  const entities = [];
  for (const table of tables.rows) {
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
    const columns: ColumnSchema[] = columnsResult.rows.map((column) => {
      const length = parseLength(column.type);
      return {
        propertyName: column.name,
        columnName: column.name,
        logicalType: logicalFromDatabase(column.type),
        databaseType: column.type,
        nullable: !column.notnull && !column.pk,
        primary: Boolean(column.pk),
        generated: Boolean(column.pk) && column.type.toLowerCase().includes("int") ? "increment" : false,
        unique: allIndexes.some((index) =>
          index.unique &&
          index.origin !== "pk" &&
          index.columns.length === 1 &&
          index.columns[0] === column.name),
        ...(length === undefined ? {} : { length }),
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
    LEFT JOIN pg_catalog.pg_constraint constraint_record ON constraint_record.conindid = index_record.indexrelid
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
  for (const constraint of constraintsResult.rows) {
    unsupported.push(
      `constraint ${String(constraint["constraint_name"])} on ${String(constraint["table_name"])} ` +
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
        return {
          propertyName: String(column["column_name"]),
          columnName: String(column["column_name"]),
          logicalType: logicalFromDatabase(baseType),
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

export async function introspectMySQL(execute: Execute): Promise<OrmSchema> {
  const rows = await execute<Record<string, unknown>>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default, column_key, extra
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    ORDER BY table_name, ordinal_position
  `);
  return rowsToSchema("mysql", rows.rows);
}

function rowsToSchema(
  dialect: "postgres" | "mysql",
  rows: readonly Record<string, unknown>[],
): OrmSchema {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const table = String(row["table_name"]);
    const group = grouped.get(table) ?? [];
    group.push(row);
    grouped.set(table, group);
  }
  return {
    version: 1,
    dialect,
    entities: [...grouped].map(([tableName, columns]) => ({
      modelName: tableName,
      tableName,
      columns: columns.map((column) => ({
        propertyName: String(column["column_name"]),
        columnName: String(column["column_name"]),
        logicalType: logicalFromDatabase(String(column["data_type"])),
        databaseType: String(column["data_type"]),
        nullable: String(column["is_nullable"]).toUpperCase() === "YES",
        primary: String(column["column_key"] ?? "") === "PRI",
        generated: String(column["extra"] ?? "").includes("auto_increment") ? "increment" : false,
        unique: String(column["column_key"] ?? "") === "UNI",
        ...(column["column_default"] === null || column["column_default"] === undefined
          ? {}
          : { default: column["column_default"] }),
        insert: true,
        update: true,
        select: true,
      })),
      relations: [],
      indexes: [],
      virtual: false,
    })),
  };
}
