import type { DatabaseValue, QueryResult } from "../adapter/types.js";
import type { OrmSchema, ColumnSchema, LogicalType } from "./types.js";

type Execute = <Row = Record<string, unknown>>(
  text: string,
  parameters?: readonly DatabaseValue[],
) => Promise<QueryResult<Row>>;

function logicalFromDatabase(databaseType: string): LogicalType {
  const type = databaseType.toLowerCase();
  if (type.includes("bool")) return "boolean";
  if (type.includes("bigint")) return "bigint";
  if (type.includes("int")) return "integer";
  if (type.includes("json")) return "json";
  if (type.includes("date") || type.includes("time")) return "datetime";
  if (type.includes("decimal") || type.includes("numeric") || type.includes("real") || type.includes("double")) return "decimal";
  if (type.includes("blob") || type.includes("binary") || type.includes("bytea")) return "blob";
  if (type.includes("char")) return "varchar";
  if (type.includes("text") || type.includes("clob")) return "text";
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
  const rows = await execute<Record<string, unknown>>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  return rowsToSchema("postgres", rows.rows);
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
