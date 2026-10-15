import type {
  Adapter,
  BatchStatement,
  Driver,
  DriverCapabilities,
  QueryOperation,
  QueryResult,
} from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { capabilities, isMySQLSavepointControl, meta, postgresTypes, type PostgresTypes } from "./helpers.js";
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
    return introspectSQLite((text, parameters = []) => this.execute({ text, parameters }, "select"), {
      excludedTablePrefixes: ["_cf_"],
    });
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
  on?(event: "error" | "end", listener: () => void): unknown;
}

/**
 * One lazily opened connection shared by a driver instance. A failed connect,
 * an `error` or an `end` event drops it so the next query opens a new one.
 * Create the adapter per request in Workers: sockets cannot cross requests.
 */
class SharedConnection<Connection extends { end(): Promise<void>; on?(event: "error" | "end", listener: () => void): unknown }> {
  private current: Promise<Connection> | undefined;

  constructor(private readonly open: () => Promise<Connection>) {}

  get(): Promise<Connection> {
    if (this.current) return this.current;
    const opening = this.open().then((connection) => {
      const drop = () => { if (this.current === opening) this.current = undefined; };
      connection.on?.("error", drop);
      connection.on?.("end", drop);
      return connection;
    });
    this.current = opening;
    opening.catch(() => { if (this.current === opening) this.current = undefined; });
    return opening;
  }

  async close(): Promise<void> {
    const current = this.current;
    this.current = undefined;
    const connection = await current?.catch(() => undefined);
    await connection?.end();
  }
}

class HyperdrivePostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  readonly capabilities = capabilities({ reserveConnection: true, parameterLimit: 65_535 });
  private readonly shared = new SharedConnection(async () => {
    const client = this.createClient();
    await client.connect();
    return client;
  });

  constructor(
    private readonly createClient: () => PGClient,
    private readonly reserved?: PGClient,
  ) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const client = this.reserved ?? await this.shared.get();
    const result = await client.query(query.text, query.parameters);
    return {
      rows: result.rows as Row[],
      meta: meta("postgres", operation, start, { rowsAffected: result.rowCount ?? 0 }),
    };
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

  async close(): Promise<void> {
    await this.shared.close();
  }
}

interface MySQLConnection {
  execute(text: string, parameters?: readonly unknown[]): Promise<[unknown, unknown]>;
  query(text: string): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
  on?(event: "error" | "end", listener: () => void): unknown;
}

class HyperdriveMySQLDriver implements Driver {
  readonly dialect = "mysql" as const;
  readonly capabilities = capabilities({ returning: false, reserveConnection: true, parameterLimit: 65_535 });
  private readonly shared = new SharedConnection(() => this.createConnection());

  constructor(
    private readonly createConnection: () => Promise<MySQLConnection>,
    private readonly reserved?: MySQLConnection,
  ) {}

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const connection = this.reserved ?? await this.shared.get();
    const [raw] = isMySQLSavepointControl(query) ? await connection.query(query.text)
      : await connection.execute(query.text, query.parameters);
    const info = raw as { affectedRows?: number; insertId?: number };
    return {
      rows: Array.isArray(raw) ? raw as Row[] : [],
      meta: meta("mysql", operation, start, {
        rowsAffected: info.affectedRows ?? 0,
        ...(info.insertId === undefined ? {} : { lastInsertId: info.insertId }),
      }),
    };
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

  async close(): Promise<void> {
    await this.shared.close();
  }
}

export async function hyperdrivePostgres(binding: HyperdriveBinding): Promise<Adapter> {
  const moduleName = "pg";
  const imported = await import(moduleName);
  const Client = imported.Client as new (options: unknown) => PGClient;
  const types = imported.types ? postgresTypes(imported.types as PostgresTypes) : undefined;
  return {
    driver: new HyperdrivePostgresDriver(() => new Client({ connectionString: binding.connectionString, types })),
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
      // The ORM stores DATETIME values in UTC; keep mysql2 from applying the local zone.
      timezone: "Z",
      disableEval: true,
    }) as Promise<MySQLConnection>),
  };
}

export { D1Driver, HyperdrivePostgresDriver, HyperdriveMySQLDriver };
