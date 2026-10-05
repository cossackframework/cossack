import type { Adapter, Driver, QueryOperation, QueryResult } from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { capabilities, meta } from "./helpers.js";
import { introspectSQLite } from "../schema/introspection.js";

export interface CloudflareTursoOptions {
  readonly url: string;
  readonly authToken?: string;
}

interface TursoServerlessConnection {
  prepare(text: string): Promise<{
    all(...parameters: readonly unknown[]): Promise<unknown>;
    run(...parameters: readonly unknown[]): Promise<unknown>;
  }> | {
    all(...parameters: readonly unknown[]): Promise<unknown>;
    run(...parameters: readonly unknown[]): Promise<unknown>;
  };
  close?(): void | Promise<void>;
}

class CloudflareTursoDriver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly capabilities = capabilities({
    transactions: false,
    savepoints: false,
    reserveConnection: false,
    parameterLimit: 999,
  });

  constructor(private readonly connection: TursoServerlessConnection) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const statement = await this.connection.prepare(query.text);
    const readsRows = operation === "select" || /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)/i.test(query.text) ||
      /\bRETURNING\b/i.test(query.text);
    const result = await (readsRows
      ? statement.all(...query.parameters)
      : statement.run(...query.parameters)) as any;
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    return {
      rows: rows as readonly Row[],
      meta: meta("sqlite", operation, start, {
        rowsAffected: Number(result?.rowsAffected ?? result?.changes ?? 0),
        ...(result?.lastInsertRowid === undefined
          ? {}
          : { lastInsertId: result.lastInsertRowid }),
      }),
    };
  }

  introspect() {
    return introspectSQLite((text, parameters = []) =>
      this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {
    await this.connection.close?.();
  }
}

/** Workers-safe remote Turso adapter using the current fetch-only client. */
export async function turso(
  options: string | CloudflareTursoOptions,
): Promise<Adapter> {
  const imported = await import("@tursodatabase/serverless");
  const connection = imported.connect(
    typeof options === "string" ? { url: options } : options,
  ) as TursoServerlessConnection;
  return { driver: new CloudflareTursoDriver(connection) };
}

export { CloudflareTursoDriver };
