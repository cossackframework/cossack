import type {
  Adapter,
  BatchStatement,
  Driver,
  DriverCapabilities,
  QueryOperation,
  QueryResult,
} from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { capabilities, meta } from "./helpers.js";
import {
  introspectMySQL,
  introspectPostgres,
  introspectSQLite,
} from "../schema/introspection.js";

export interface D1Result<Row = Record<string, unknown>> {
  readonly results?: readonly Row[];
  readonly success: boolean;
  readonly meta?: {
    readonly changes?: number;
    readonly last_row_id?: number;
    readonly duration?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  all<Row = Record<string, unknown>>(): Promise<D1Result<Row>>;
  run<Row = Record<string, unknown>>(): Promise<D1Result<Row>>;
}

export interface D1DatabaseBinding {
  prepare(sql: string): D1PreparedStatement;
  batch<Row = Record<string, unknown>>(
    statements: readonly D1PreparedStatement[],
  ): Promise<readonly D1Result<Row>[]>;
}

class D1Driver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly capabilities: DriverCapabilities = capabilities({
    transactions: false,
    savepoints: false,
    reserveConnection: false,
    cancellation: false,
    parameterLimit: 100,
    batchLimit: 100,
  });

  constructor(private readonly binding: D1DatabaseBinding) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const statement = this.binding.prepare(query.text).bind(...query.parameters);
    const result = operation === "select" || /^\s*(SELECT|WITH|PRAGMA)/i.test(query.text) || /\bRETURNING\b/i.test(query.text)
      ? await statement.all<Row>()
      : await statement.run<Row>();
    return {
      rows: result.results ?? [],
      meta: {
        ...meta("sqlite", operation, start, {
          rowsAffected: result.meta?.changes ?? 0,
          ...(result.meta?.last_row_id === undefined ? {} : { lastInsertId: result.meta.last_row_id }),
        }),
        durationMs: result.meta?.duration ?? performance.now() - start,
      },
    };
  }

  async batch(statements: readonly BatchStatement[]): Promise<readonly QueryResult[]> {
    const start = performance.now();
    const results = await this.binding.batch(
      statements.map(({ query }) => this.binding.prepare(query.text).bind(...query.parameters)),
    );
    return results.map((result, index) => {
      const operation = statements[index]?.operation ?? "raw";
      return {
        rows: result.results ?? [],
        meta: meta("sqlite", operation, start, {
          rowsAffected: result.meta?.changes ?? 0,
          ...(result.meta?.last_row_id === undefined ? {} : { lastInsertId: result.meta.last_row_id }),
        }),
      };
    });
  }

  introspect() {
    return introspectSQLite((text, parameters = []) => this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {}
}

export async function d1(binding: D1DatabaseBinding): Promise<Adapter> {
  return { driver: new D1Driver(binding) };
}

export interface HyperdriveBinding {
  readonly connectionString: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

interface PGClient {
  connect(): Promise<void>;
  query(text: string, parameters?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
  end(): Promise<void>;
}

class HyperdrivePostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  readonly capabilities = capabilities({ reserveConnection: true, parameterLimit: 65_535 });

  constructor(
    private readonly createClient: () => PGClient,
    private readonly reserved?: PGClient,
  ) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const client = this.reserved ?? this.createClient();
    if (!this.reserved) await client.connect();
    try {
      const result = await client.query(query.text, query.parameters);
      return {
        rows: result.rows as Row[],
        meta: meta("postgres", operation, start, { rowsAffected: result.rowCount ?? 0 }),
      };
    } finally {
      if (!this.reserved) await client.end();
    }
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    const client = this.createClient();
    await client.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(new HyperdrivePostgresDriver(this.createClient, client));
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      await client.end();
    }
  }

  async reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    const client = this.createClient();
    await client.connect();
    try {
      return await callback(new HyperdrivePostgresDriver(this.createClient, client));
    } finally {
      await client.end();
    }
  }

  introspect() {
    return introspectPostgres((text, parameters = []) => this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {}
}

interface MySQLConnection {
  execute(text: string, parameters?: readonly unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
}

class HyperdriveMySQLDriver implements Driver {
  readonly dialect = "mysql" as const;
  readonly capabilities = capabilities({ returning: false, reserveConnection: true, parameterLimit: 65_535 });

  constructor(
    private readonly createConnection: () => Promise<MySQLConnection>,
    private readonly reserved?: MySQLConnection,
  ) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const connection = this.reserved ?? await this.createConnection();
    try {
      const [raw] = await connection.execute(query.text, query.parameters);
      const info = raw as { affectedRows?: number; insertId?: number };
      return {
        rows: Array.isArray(raw) ? raw as Row[] : [],
        meta: meta("mysql", operation, start, {
          rowsAffected: info.affectedRows ?? 0,
          ...(info.insertId === undefined ? {} : { lastInsertId: info.insertId }),
        }),
      };
    } finally {
      if (!this.reserved) await connection.end();
    }
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    const connection = await this.createConnection();
    await connection.beginTransaction();
    try {
      const result = await callback(new HyperdriveMySQLDriver(this.createConnection, connection));
      await connection.commit();
      return result;
    } catch (cause) {
      await connection.rollback();
      throw cause;
    } finally {
      await connection.end();
    }
  }

  async reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    const connection = await this.createConnection();
    try {
      return await callback(new HyperdriveMySQLDriver(this.createConnection, connection));
    } finally {
      await connection.end();
    }
  }

  introspect() {
    return introspectMySQL((text, parameters = []) => this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {}
}

export async function hyperdrivePostgres(binding: HyperdriveBinding): Promise<Adapter> {
  const moduleName = "pg";
  const imported = await import(moduleName);
  const Client = imported.Client as new (options: unknown) => PGClient;
  return {
    driver: new HyperdrivePostgresDriver(() => new Client({ connectionString: binding.connectionString })),
  };
}

export async function hyperdriveMySQL(binding: HyperdriveBinding): Promise<Adapter> {
  const moduleName = "mysql2/promise";
  const imported = await import(moduleName);
  return {
    driver: new HyperdriveMySQLDriver(() => imported.createConnection({
      host: binding.host,
      port: binding.port,
      user: binding.user,
      password: binding.password,
      database: binding.database,
      disableEval: true,
    }) as Promise<MySQLConnection>),
  };
}

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

export { D1Driver, CloudflareTursoDriver };
