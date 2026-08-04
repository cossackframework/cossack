import { AsyncLocalStorage } from "node:async_hooks";
import type { Adapter, Driver, QueryOperation, QueryResult } from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { createAsyncLocalScope } from "../adapter/scope.js";
import { capabilities, meta } from "./helpers.js";

export interface TursoEmbeddedOptions {
  readonly path: string;
  readonly encryption?: {
    readonly cipher: "aes128gcm" | "aes256gcm" | "aegis256" | "aegis256x2" |
      "aegis128l" | "aegis128x2" | "aegis128x4";
    readonly hexkey: string;
  };
}

export interface TursoRemoteOptions {
  readonly url: string;
  readonly authToken?: string;
}

export type TursoOptions = TursoEmbeddedOptions | TursoRemoteOptions;

interface TursoStatement {
  all(...parameters: readonly unknown[]): Promise<unknown> | unknown;
  run(...parameters: readonly unknown[]): Promise<unknown> | unknown;
}

interface TursoConnection {
  prepare(text: string): Promise<TursoStatement> | TursoStatement;
  close?(): Promise<void> | void;
}

class TursoDriver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly capabilities = capabilities({ parameterLimit: 999 });

  constructor(private readonly connection: TursoConnection) {}

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
      rows: rows as Row[],
      meta: meta("sqlite", operation, start, {
        rowsAffected: Number(result?.rowsAffected ?? result?.changes ?? 0),
        ...((result?.lastInsertRowid ?? result?.lastInsertId) === undefined
          ? {}
          : { lastInsertId: result.lastInsertRowid ?? result.lastInsertId }),
      }),
    };
  }

  async close(): Promise<void> {
    await this.connection.close?.();
  }
}

export async function turso(options: TursoOptions): Promise<Adapter> {
  let connection: TursoConnection;
  if ("url" in options) {
    const imported = await import("@tursodatabase/serverless");
    connection = imported.connect({
      url: options.url,
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    });
  } else {
    const imported = await import("@tursodatabase/database");
    connection = await imported.connect(options.path, {
      ...(options.encryption ? { encryption: options.encryption } : {}),
    });
  }
  return {
    driver: new TursoDriver(connection),
    scope: createAsyncLocalScope(new AsyncLocalStorage<unknown>()),
  };
}

export { TursoDriver };
