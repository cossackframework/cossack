import type { Dialect } from "../adapter/types.js";
import { ConfigurationError } from "../errors.js";

function doubleQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function backtick(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

const sqliteTypes: Record<string, string> = {
  string: "varchar",
  varchar: "varchar",
  text: "text",
  integer: "integer",
  bigint: "bigint",
  decimal: "decimal",
  boolean: "boolean",
  datetime: "datetime",
  date: "date",
  json: "json",
  enum: "text",
  blob: "blob",
  binary: "blob",
  uuid: "text",
};

const postgresTypes: Record<string, string> = {
  string: "varchar",
  varchar: "varchar",
  text: "text",
  integer: "integer",
  bigint: "bigint",
  decimal: "numeric",
  boolean: "boolean",
  datetime: "timestamptz",
  date: "date",
  json: "jsonb",
  enum: "varchar",
  blob: "bytea",
  binary: "bytea",
  uuid: "uuid",
};

const mysqlTypes: Record<string, string> = {
  string: "varchar",
  varchar: "varchar",
  text: "text",
  integer: "int",
  bigint: "bigint",
  decimal: "decimal",
  boolean: "boolean",
  datetime: "datetime",
  date: "date",
  json: "json",
  enum: "varchar",
  blob: "blob",
  binary: "blob",
  uuid: "char",
};

function typeMapper(types: Record<string, string>) {
  return (logicalType: string, options: Record<string, unknown> = {}): string => {
    const base = types[logicalType] ?? (logicalType.startsWith("custom:") ? logicalType.slice(7) : undefined);
    if (!base) throw new ConfigurationError(`Unsupported logical column type "${logicalType}".`);
    if (logicalType === "varchar" || logicalType === "string") {
      return `${base}(${String(options.length ?? 255)})`;
    }
    if (logicalType === "decimal") {
      const precision = options.precision;
      const scale = options.scale;
      return precision === undefined ? base : `${base}(${String(precision)},${String(scale ?? 0)})`;
    }
    if (logicalType === "uuid" && types === mysqlTypes) return `${base}(36)`;
    return base;
  };
}

export const sqliteDialect: Dialect = Object.freeze({
  name: "sqlite",
  capabilities: { returning: true, generatedIdentity: false, arrays: false, schemas: false },
  placeholder: () => "?",
  quoteIdentifier: doubleQuote,
  mapType: typeMapper(sqliteTypes),
});

export const postgresDialect: Dialect = Object.freeze({
  name: "postgres",
  capabilities: { returning: true, generatedIdentity: true, arrays: true, schemas: true },
  placeholder: (index: number) => `$${index}`,
  quoteIdentifier: doubleQuote,
  mapType: typeMapper(postgresTypes),
});

export const mysqlDialect: Dialect = Object.freeze({
  name: "mysql",
  capabilities: { returning: false, generatedIdentity: true, arrays: false, schemas: true },
  placeholder: () => "?",
  quoteIdentifier: backtick,
  mapType: typeMapper(mysqlTypes),
});

export function dialectFor(name: "sqlite" | "postgres" | "mysql"): Dialect {
  if (name === "postgres") return postgresDialect;
  if (name === "mysql") return mysqlDialect;
  return sqliteDialect;
}
