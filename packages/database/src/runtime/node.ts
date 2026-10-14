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
import { UnsupportedCapabilityError } from "../errors.js";
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

/**
 * One synchronous SQLite connection shared by the whole process. Transactions on
 * it are exclusive: overlapping `transaction()` calls queue, and statements from
 * other async contexts wait until the open transaction commits or rolls back, so
 * they never run inside (or get rolled back with) someone else's transaction.
 */
class SQLiteDriver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly capabilities: DriverCapabilities = capabilities({
    parameterLimit: 999,
    cancellation: false,
  });
  private readonly owner = new AsyncLocalStorage<symbol>();
  private activeTransaction: symbol | undefined;
  private queued = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly database: SQLiteDatabase) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    // Statements are synchronous, so with no transaction open or queued nothing can interleave.
    if (this.queued === 0 || this.ownsTransaction()) return this.run<Row>(query, operation);
    return this.exclusive(async () => this.run<Row>(query, operation));
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    if (this.ownsTransaction()) {
      throw new UnsupportedCapabilityError("nested SQLite driver transactions (use savepoints)", "sqlite");
    }
    return this.exclusive(() => {
      const token = Symbol("sqlite-transaction");
      this.activeTransaction = token;
      return this.owner.run(token, async () => {
        try {
          this.database.exec("BEGIN");
          try {
            const result = await callback(this);
            this.database.exec("COMMIT");
            return result;
          } catch (cause) {
            this.database.exec("ROLLBACK");
            throw cause;
          }
        } finally {
          this.activeTransaction = undefined;
        }
      });
    });
  }

  reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    return callback(this);
  }

  private ownsTransaction(): boolean {
    return this.activeTransaction !== undefined && this.owner.getStore() === this.activeTransaction;
  }

  private async exclusive<T>(callback: () => Promise<T>): Promise<T> {
    this.queued++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await previous;
      return await callback();
    } finally {
      this.queued--;
      release();
    }
  }

  private run<Row>(query: CompiledQuery, operation: QueryOperation): QueryResult<Row> {
    const start = performance.now();
    const statement = this.database.prepare(query.text);
    const reads = operation === "select" || /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)/i.test(query.text);
    if (reads || /\bRETURNING\b/i.test(query.text)) {
      const rows = statement.all(...query.parameters) as Row[];
      // DML with RETURNING yields one row per affected row.
      return { rows, meta: meta("sqlite", operation, start, { rowsAffected: reads ? 0 : rows.length }) };
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
    // MySQL does not prepare SAVEPOINT statements. Framework-owned savepoint
    // control has no parameters and must use the text protocol on this connection.
    const savepoint = query.parameters.length === 0 && /^\s*(?:SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)\b/i.test(query.text);
    const [raw] = (savepoint ? await this.connection.query(query.text)
      : await this.connection.execute(query.text, query.parameters)) as [unknown, unknown];
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

/**
 * mysql2 reads and writes DATETIME values in the process time zone by default.
 * The ORM stores datetimes in UTC, so default the connection time zone to UTC
 * unless the caller chose one.
 */
function mysqlPoolOptions(options: string | Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (typeof options === "string") {
    return /[?&]timezone=/i.test(options) ? { uri: options } : { uri: options, timezone: "Z" };
  }
  return { timezone: "Z", ...options };
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
  const imported = await import(/* @vite-ignore */ moduleName);
  const Constructor = imported.default as new (filename: string) => SQLiteDatabase;
  return adapter(new SQLiteDriver(new Constructor(options.filename ?? ":memory:")));
}

export async function postgres(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const moduleName = "pg";
  const imported = await import(/* @vite-ignore */ moduleName);
  const Pool = imported.Pool as new (options: unknown) => PGPool;
  const pool = new Pool(typeof options === "string" ? { connectionString: options } : options);
  return adapter(new PostgresDriver(pool, pool));
}

export async function mysql(
  options: string | Readonly<Record<string, unknown>>,
): Promise<Adapter> {
  const moduleName = "mysql2/promise";
  const imported = await import(/* @vite-ignore */ moduleName);
  const pool = imported.createPool(mysqlPoolOptions(options)) as MySQLPool;
  return adapter(new MySQLDriver(pool, pool));
}

export { SQLiteDriver, PostgresDriver, MySQLDriver };
export { turso, type TursoOptions, type TursoEmbeddedOptions, type TursoRemoteOptions } from "./turso.js";
export { SQL } from "../sql/node-client.js";
export type { SQLClient, SQLOptions } from "../sql/client.js";
