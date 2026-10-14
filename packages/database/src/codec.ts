import type { ColumnMetadata } from "./metadata/types.js";

/**
 * SQLite and MySQL store datetimes as text without an offset, the same
 * `YYYY-MM-DD HH:MM:SS` shape `CURRENT_TIMESTAMP` produces, always in UTC. That
 * keeps application values and database defaults comparable and sortable.
 * PostgreSQL `timestamptz` receives an ISO string with an explicit `Z`.
 */
export function encodeDateTime(value: Date, dialect: string): string {
  const iso = value.toISOString();
  return dialect === "postgres" ? iso : `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** Parses database timestamps; values without an offset are UTC, never local time. */
function decodeDateTime(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "bigint") return new Date(Number(value));
  const text = String(value).trim();
  const match = TIMESTAMP.exec(text);
  if (!match) return new Date(text);
  let zone = match[3] ?? "Z";
  if (/^[+-]\d{2}$/.test(zone)) zone += ":00";
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return new Date(`${match[1]}T${match[2]}${zone.toUpperCase()}`);
}

export function encodeValue(column: ColumnMetadata, value: unknown, dialect: string): unknown {
  if (value === undefined || value === null) return value ?? null;
  switch (column.logicalType) {
    case "boolean":
      return dialect === "sqlite" ? (value ? 1 : 0) : Boolean(value);
    case "datetime":
      return value instanceof Date ? encodeDateTime(value, dialect) : value;
    case "date":
      return value instanceof Date ? value.toISOString().slice(0, 10) : value;
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "bigint":
      return typeof value === "bigint" && dialect !== "postgres" ? value.toString() : value;
    case "decimal":
      return typeof value === "number" ? value.toString() : value;
    case "blob":
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      return value;
    case "enum":
      if (column.enumValues && !column.enumValues.includes(String(value))) {
        throw new TypeError(`${column.propertyName} must be one of: ${column.enumValues.join(", ")}.`);
      }
      return String(value);
    default:
      return value;
  }
}

export function decodeValue(column: ColumnMetadata, value: unknown): unknown {
  if (value === undefined || value === null) return value ?? null;
  switch (column.logicalType) {
    case "boolean":
      return value === true || value === 1 || value === "1" || value === "true";
    case "datetime":
    case "date":
      return decodeDateTime(value);
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "bigint":
      return typeof value === "bigint" ? value : BigInt(String(value));
    case "blob":
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      return value;
    default:
      return value;
  }
}
