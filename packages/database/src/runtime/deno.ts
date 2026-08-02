import type {
  Adapter,
  Driver,
  QueryOperation,
  QueryResult,
  ScopeStorage,
} from "../adapter/types.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { capabilities, meta } from "./helpers.js";

export interface InjectedDenoDriver {
  readonly dialect: "sqlite" | "postgres" | "mysql";
  execute<Row = Record<string, unknown>>(
    text: string,
    parameters: readonly unknown[],
  ): Promise<{
    readonly rows: readonly Row[];
    readonly rowsAffected?: number;
    readonly lastInsertId?: string | number | bigint;
  }>;
  transaction?<T>(callback: (driver: InjectedDenoDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class DenoDriver implements Driver {
  readonly dialect;
  readonly capabilities;

  constructor(private readonly injected: InjectedDenoDriver) {
    this.dialect = injected.dialect;
    this.capabilities = capabilities({
      transactions: Boolean(injected.transaction),
      returning: injected.dialect !== "mysql",
      reserveConnection: false,
      parameterLimit: injected.dialect === "sqlite" ? 999 : 65_535,
    });
  }

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const result = await this.injected.execute<Row>(query.text, query.parameters);
    return {
      rows: result.rows,
      meta: meta(this.dialect, operation, start, {
        rowsAffected: result.rowsAffected ?? 0,
        ...(result.lastInsertId === undefined ? {} : { lastInsertId: result.lastInsertId }),
      }),
    };
  }

  transaction<T>(callback: (driver: Driver) => Promise<T>): Promise<T> {
    if (!this.injected.transaction) throw new Error("The injected Deno driver does not support transactions.");
    return this.injected.transaction((transaction) => callback(new DenoDriver(transaction)));
  }

  close(): Promise<void> {
    return this.injected.close();
  }
}

export function deno(
  driver: InjectedDenoDriver,
  options: { readonly scope?: ScopeStorage<unknown> } = {},
): Adapter {
  return {
    driver: new DenoDriver(driver),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  };
}

export { DenoDriver };
