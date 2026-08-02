import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Adapter,
  DatabaseValue,
  Driver,
  DriverCapabilities,
  QueryOperation,
  QueryResult,
} from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { createAsyncLocalScope } from "../adapter/scope.js";
import { capabilities, meta } from "./helpers.js";
import {
  introspectMySQL,
  introspectPostgres,
  introspectSQLite,
} from "../schema/introspection.js";

interface SQLiteStatement {
  all(...parameters: readonly unknown[]): unknown[];
  run(...parameters: readonly unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
}

interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
  exec(sql: string): void;
  close(): void;
}

class SQLiteDriver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly capabilities: DriverCapabilities = capabilities({
    parameterLimit: 999,
    cancellation: false,
  });

  constructor(private readonly database: SQLiteDatabase) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const statement = this.database.prepare(query.text);
    if (
      operation === "select" ||
      /^\s*(SELECT|WITH|PRAGMA)/i.test(query.text) ||
      /\bRETURNING\b/i.test(query.text)
    ) {
      const rows = statement.all(...query.parameters) as Row[];
      return { rows, meta: meta("sqlite", operation, start, { rowsAffected: 0 }) };
    }
    const result = statement.run(...query.parameters);
    return {
      rows: [],
      meta: meta("sqlite", operation, start, {
        rowsAffected: Number(result.changes),
        lastInsertId: result.lastInsertRowid,
      }),
    };
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    this.database.exec("BEGIN");
    try {
      const result = await callback(this);
      this.database.exec("COMMIT");
      return result;
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    return callback(this);
  }

  introspect() {
    return introspectSQLite((text, parameters = []) => this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {
    this.database.close();
  }
}

interface PGClient {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: unknown[];
    rowCount?: number | null;
    command?: string;
  }>;
  release?(): void;
  end?(): Promise<void>;
}

interface PGPool extends PGClient {
  connect(): Promise<PGClient>;
}

class PostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  readonly capabilities = capabilities({ parameterLimit: 65_535 });

  constructor(
    private readonly client: PGClient,
    private readonly owner?: PGPool,
    private readonly releaseOnClose = false,
  ) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const result = await this.client.query(query.text, query.parameters);
    return {
      rows: result.rows as Row[],
      meta: meta("postgres", operation, start, { rowsAffected: result.rowCount ?? 0 }),
    };
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    const client = this.owner ? await this.owner.connect() : this.client;
    const driver = new PostgresDriver(client);
    await client.query("BEGIN");
    try {
      const result = await callback(driver);
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      if (this.owner) client.release?.();
    }
  }

  async reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    if (!this.owner) return callback(this);
    const client = await this.owner.connect();
    try {
      return await callback(new PostgresDriver(client));
    } finally {
      client.release?.();
    }
  }

  introspect() {
    return introspectPostgres((text, parameters = []) => this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {
    if (this.releaseOnClose) this.client.release?.();
    else await this.owner?.end?.();
  }
}

interface MySQLConnection {
  execute(sql: string, parameters?: readonly unknown[]): Promise<[unknown, unknown]>;
  query(sql: string): Promise<unknown>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release?(): void;
  end?(): Promise<void>;
}

interface MySQLPool extends MySQLConnection {
  getConnection(): Promise<MySQLConnection>;
}

class MySQLDriver implements Driver {
  readonly dialect = "mysql" as const;
  readonly capabilities = capabilities({ returning: false, parameterLimit: 65_535 });

  constructor(
    private readonly connection: MySQLConnection,
    private readonly pool?: MySQLPool,
  ) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const [raw] = await this.connection.execute(query.text, query.parameters);
    const object = raw as { affectedRows?: number; insertId?: number };
    return {
      rows: Array.isArray(raw) ? raw as Row[] : [],
      meta: meta("mysql", operation, start, {
        rowsAffected: object.affectedRows ?? 0,
        ...(object.insertId === undefined ? {} : { lastInsertId: object.insertId }),
      }),
    };
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    const connection = this.pool ? await this.pool.getConnection() : this.connection;
    await connection.beginTransaction();
    try {
      const result = await callback(new MySQLDriver(connection));
      await connection.commit();
      return result;
    } catch (cause) {
      await connection.rollback();
      throw cause;
    } finally {
      if (this.pool) connection.release?.();
    }
  }

  async reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    if (!this.pool) return callback(this);
    const connection = await this.pool.getConnection();
    try {
      return await callback(new MySQLDriver(connection));
    } finally {
      connection.release?.();
    }
  }

  introspect() {
    return introspectMySQL((text, parameters = []) => this.execute({ text, parameters }, "select"));
  }

  async close(): Promise<void> {
    await this.pool?.end?.();
  }
}

function adapter(driver: Driver): Adapter {
  return {
    driver,
    scope: createAsyncLocalScope(new AsyncLocalStorage<unknown>()),
  };
}

export interface NodeSQLiteOptions {
  readonly filename?: string;
  readonly database?: SQLiteDatabase;
  readonly foreignKeys?: boolean;
}

export async function nodeSQLite(options: NodeSQLiteOptions = {}): Promise<Adapter> {
  let database = options.database;
  if (!database) {
    const sqlite = await import("node:sqlite");
    database = new sqlite.DatabaseSync(options.filename ?? ":memory:") as unknown as SQLiteDatabase;
  }
  if (options.foreignKeys ?? true) database.exec("PRAGMA foreign_keys = ON");
  return adapter(new SQLiteDriver(database));
}

export async function betterSQLite(
  options: { readonly filename?: string } = {},
): Promise<Adapter> {
  const moduleName = "better-sqlite3";
  const imported = await import(moduleName);
  const Constructor = imported.default as new (filename: string) => SQLiteDatabase;
  return adapter(new SQLiteDriver(new Constructor(options.filename ?? ":memory:")));
}

export async function postgres(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const moduleName = "pg";
  const imported = await import(moduleName);
  const Pool = imported.Pool as new (options: unknown) => PGPool;
  const pool = new Pool(typeof options === "string" ? { connectionString: options } : options);
  return adapter(new PostgresDriver(pool, pool));
}

export async function mysql(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const moduleName = "mysql2/promise";
  const imported = await import(moduleName);
  const pool = imported.createPool(options) as MySQLPool;
  return adapter(new MySQLDriver(pool, pool));
}

export async function libsql(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const moduleName = "@libsql/client";
  const imported = await import(moduleName);
  const client = imported.createClient(typeof options === "string" ? { url: options } : options) as {
    execute(input: { sql: string; args: readonly unknown[] }): Promise<{
      rows: unknown[];
      rowsAffected: number;
      lastInsertRowid?: string | number | bigint;
    }>;
    close(): void;
  };
  const driver: Driver = {
    dialect: "sqlite",
    capabilities: capabilities({ parameterLimit: 999 }),
    async execute<Row = Record<string, unknown>>(
      query: CompiledQuery,
      operation: QueryOperation = "raw",
    ): Promise<QueryResult<Row>> {
      const start = performance.now();
      const result = await client.execute({ sql: query.text, args: query.parameters });
      return {
        rows: result.rows as Row[],
        meta: meta("sqlite", operation, start, {
          rowsAffected: result.rowsAffected,
          ...(result.lastInsertRowid === undefined ? {} : { lastInsertId: result.lastInsertRowid }),
        }),
      };
    },
    async close() { client.close(); },
  };
  return adapter(driver);
}

export { SQLiteDriver, PostgresDriver, MySQLDriver };
