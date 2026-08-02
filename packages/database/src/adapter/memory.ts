import type {
  BatchStatement,
  Driver,
  DriverCapabilities,
  QueryOperation,
  QueryResult,
} from "./types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import type { OrmSchema } from "../schema/types.js";

export type MemoryExecutor = (
  query: CompiledQuery,
  operation: QueryOperation,
) => Promise<Partial<QueryResult> & Pick<QueryResult, "rows">> | Partial<QueryResult> & Pick<QueryResult, "rows">;

export class MemoryDriver implements Driver {
  readonly capabilities: DriverCapabilities;
  readonly statements: { query: CompiledQuery; operation: QueryOperation }[] = [];
  private transactionLevel = 0;

  constructor(
    readonly dialect: "sqlite" | "postgres" | "mysql" = "sqlite",
    private readonly executor: MemoryExecutor = () => ({ rows: [] }),
    private readonly schemaValue?: OrmSchema,
  ) {
    this.capabilities = {
      transactions: true,
      savepoints: true,
      returning: dialect !== "mysql",
      batch: true,
      reserveConnection: true,
      cancellation: false,
      parameterLimit: dialect === "sqlite" ? 999 : 65_535,
      batchLimit: 1_000,
    };
  }

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    this.statements.push({ query, operation });
    const start = performance.now();
    const result = await this.executor(query, operation);
    return {
      rows: result.rows as readonly Row[],
      meta: result.meta ?? {
        durationMs: performance.now() - start,
        dialect: this.dialect,
        operation,
        rowsAffected: operation === "select" ? 0 : 1,
      },
    };
  }

  async batch(statements: readonly BatchStatement[]): Promise<readonly QueryResult[]> {
    return Promise.all(statements.map((statement) => this.execute(statement.query, statement.operation)));
  }

  async transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    this.transactionLevel++;
    try {
      return await callback(this);
    } finally {
      this.transactionLevel--;
    }
  }

  reserve<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async introspect(): Promise<OrmSchema> {
    return this.schemaValue ?? { version: 1, dialect: this.dialect, entities: [] };
  }

  async close(): Promise<void> {}
}
