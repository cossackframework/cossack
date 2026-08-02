import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Adapter,
  Driver,
  QueryOperation,
  QueryResult,
} from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { createAsyncLocalScope } from "../adapter/scope.js";
import { capabilities, meta } from "./helpers.js";

export interface BunSQLResult<Row = Record<string, unknown>> extends Array<Row> {
  readonly affectedRows?: number;
  readonly lastInsertRowid?: number | bigint;
}

export interface BunSQLClient {
  unsafe<Row = Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<BunSQLResult<Row>>;
  begin?<T>(callback: (transaction: BunSQLClient) => Promise<T>): Promise<T>;
  reserve?<T>(callback: (connection: BunSQLClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class BunDriver implements Driver {
  readonly capabilities;

  constructor(
    readonly dialect: "sqlite" | "postgres" | "mysql",
    private readonly client: BunSQLClient,
  ) {
    this.capabilities = capabilities({
      returning: dialect !== "mysql",
      parameterLimit: dialect === "sqlite" ? 999 : 65_535,
      transactions: Boolean(client.begin),
      reserveConnection: Boolean(client.reserve),
    });
  }

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const result = await this.client.unsafe<Row>(query.text, query.parameters);
    return {
      rows: result,
      meta: meta(this.dialect, operation, start, {
        rowsAffected: result.affectedRows ?? 0,
        ...(result.lastInsertRowid === undefined ? {} : { lastInsertId: result.lastInsertRowid }),
      }),
    };
  }

  transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    if (!this.client.begin) throw new Error("Bun SQL client does not expose begin().");
    return this.client.begin((transaction) => callback(new BunDriver(this.dialect, transaction)));
  }

  reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    if (!this.client.reserve) throw new Error("Bun SQL client does not expose reserve().");
    return this.client.reserve((connection) => callback(new BunDriver(this.dialect, connection)));
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export interface BunAdapterOptions {
  readonly client?: BunSQLClient;
  readonly url?: string;
  readonly dialect?: "sqlite" | "postgres" | "mysql";
}

export function bun(options: BunAdapterOptions | string): Adapter {
  const normalized = typeof options === "string" ? { url: options } : options;
  const dialect = normalized.dialect ?? inferDialect(normalized.url);
  let client = normalized.client;
  if (!client) {
    const BunGlobal = globalThis as typeof globalThis & {
      Bun?: { SQL?: new (url?: string) => BunSQLClient };
    };
    if (!BunGlobal.Bun?.SQL) throw new Error("Bun.SQL is unavailable; run under a current stable Bun runtime.");
    client = new BunGlobal.Bun.SQL(normalized.url);
  }
  return {
    driver: new BunDriver(dialect, client),
    scope: createAsyncLocalScope(new AsyncLocalStorage<unknown>()),
  };
}

function inferDialect(url?: string): "sqlite" | "postgres" | "mysql" {
  if (url?.startsWith("mysql:")) return "mysql";
  if (url?.startsWith("sqlite:") || url?.endsWith(".db") || url === ":memory:") return "sqlite";
  return "postgres";
}

export { BunDriver };
