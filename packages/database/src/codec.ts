import type { ColumnMetadata } from "./metadata/types.js";

export function encodeValue(column: ColumnMetadata, value: unknown, dialect: string): unknown {
  if (value === undefined || value === null) return value ?? null;
  switch (column.logicalType) {
    case "boolean":
      return dialect === "sqlite" ? (value ? 1 : 0) : Boolean(value);
    case "datetime":
    case "date":
      return value instanceof Date ? value.toISOString() : value;
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
      return value instanceof Date ? value : new Date(String(value));
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
