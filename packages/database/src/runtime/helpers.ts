import type {
  DriverCapabilities,
  QueryMeta,
  QueryOperation,
} from "../adapter/types.js";

export function capabilities(
  overrides: Partial<DriverCapabilities> = {},
): DriverCapabilities {
  return Object.freeze({
    transactions: true,
    savepoints: true,
    returning: true,
    batch: true,
    reserveConnection: true,
    cancellation: false,
    parameterLimit: 32_767,
    batchLimit: 1_000,
    ...overrides,
  });
}

export function meta(
  dialect: "sqlite" | "postgres" | "mysql",
  operation: QueryOperation,
  start: number,
  extras: Partial<Pick<QueryMeta, "rowsAffected" | "lastInsertId">> = {},
): QueryMeta {
  return {
    durationMs: performance.now() - start,
    dialect,
    operation,
    ...extras,
  };
}

/**
 * MySQL does not prepare SAVEPOINT statements. Framework-owned savepoint
 * control has no parameters and must use the text protocol (`query()`).
 */
export function isMySQLSavepointControl(query: { readonly text: string; readonly parameters: readonly unknown[] }): boolean {
  return query.parameters.length === 0 &&
    /^\s*(?:SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)\b/i.test(query.text);
}

type PostgresTypeParser = (value: string) => unknown;

export interface PostgresTypes {
  getTypeParser(oid: number, format?: string): PostgresTypeParser;
}

const POSTGRES_DATE = 1082;
const POSTGRES_TIMESTAMP = 1114;

/**
 * node-postgres parses DATE and TIMESTAMP (without time zone) into Dates in the
 * process time zone. The ORM reads offset-less values as UTC, so a `date` column
 * holding 2026-01-02 must not come back as 2026-01-01T17:00Z in UTC+7. Other
 * types, and values outside the plain form (such as `infinity`), keep the
 * node-postgres parsers.
 */
export function postgresTypes(fallback: PostgresTypes): PostgresTypes {
  return {
    getTypeParser(oid, format = "text") {
      const parse = fallback.getTypeParser(oid, format);
      if (format !== "text") return parse;
      if (oid === POSTGRES_DATE) {
        return (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : parse(value);
      }
      if (oid === POSTGRES_TIMESTAMP) {
        return (value) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
          ? new Date(`${value.replace(" ", "T")}Z`) : parse(value);
      }
      return parse;
    },
  };
}
