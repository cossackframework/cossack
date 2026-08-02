import type { CompiledQuery } from "../sql/fragment.js";
import type { OrmSchema } from "../schema/types.js";

export type DialectName = "sqlite" | "postgres" | "mysql";
export type QueryOperation = "select" | "insert" | "update" | "delete" | "ddl" | "raw";
export type DatabaseValue = string | number | bigint | boolean | Date | Uint8Array | null;

export interface DriverCapabilities {
  readonly transactions: boolean;
  readonly savepoints: boolean;
  readonly returning: boolean;
  readonly batch: boolean;
  readonly reserveConnection: boolean;
  readonly cancellation: boolean;
  readonly parameterLimit: number;
  readonly batchLimit: number;
}

export interface QueryMeta {
  readonly durationMs: number;
  readonly dialect: DialectName;
  readonly operation: QueryOperation;
  readonly rowsAffected?: number;
  readonly lastInsertId?: string | number | bigint;
}

export interface QueryResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly meta: QueryMeta;
}

export interface BatchStatement {
  readonly query: CompiledQuery;
  readonly operation?: QueryOperation;
}

export interface Driver {
  readonly dialect: DialectName;
  readonly capabilities: DriverCapabilities;
  execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation?: QueryOperation,
    signal?: AbortSignal,
  ): Promise<QueryResult<Row>>;
  batch?(statements: readonly BatchStatement[]): Promise<readonly QueryResult[]>;
  transaction?<T>(callback: (driver: Driver) => Promise<T>): Promise<T>;
  reserve?<T>(callback: (driver: Driver) => Promise<T>): Promise<T>;
  introspect?(): Promise<OrmSchema>;
  close(): Promise<void>;
}

export interface ScopeStorage<T> {
  get(): T | undefined;
  run<R>(value: T, callback: () => R): R;
}

export interface Adapter {
  readonly driver: Driver;
  readonly scope?: ScopeStorage<unknown>;
}

export interface DialectCapabilities {
  readonly returning: boolean;
  readonly generatedIdentity: boolean;
  readonly arrays: boolean;
  readonly schemas: boolean;
}

export interface Dialect {
  readonly name: DialectName;
  readonly capabilities: DialectCapabilities;
  readonly placeholder: (index: number) => string;
  quoteIdentifier(identifier: string): string;
  mapType(type: string, options?: Record<string, unknown>): string;
}

export interface LoggerEvent {
  readonly sql: string;
  readonly parameters: readonly string[];
  readonly durationMs: number;
  readonly dialect: DialectName;
  readonly operation: QueryOperation;
  readonly error?: unknown;
}

export interface ORMLogger {
  query(event: LoggerEvent): void;
}
