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
