import type {
  Adapter,
  BatchStatement,
  Driver,
  DriverCapabilities,
  QueryOperation,
  QueryResult,
} from "../adapter/types.js";
import { ConfigurationError } from "../errors.js";
import type { ORM } from "../orm.js";
import { isRecordLink, RecordLink, type RecordKey } from "../record-link.js";
import { sqliteEntitySchema, type SQLiteTableCatalog } from "../schema/introspection.js";
import type { EntitySchema, OrmSchema } from "../schema/types.js";
import { currentORM } from "../scope.js";
import type { CompiledQuery } from "../sql/fragment.js";
import { capabilities, meta } from "./helpers.js";

export { RecordLink, isRecordLink, type RecordKey } from "../record-link.js";

/** One RomeDB statement: RomeQL text and its named parameters. */
export interface RomeDBStatement {
  rql: string;
  params?: { [name: string]: unknown };
}

export interface RomeDBStatementResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly affected?: bigint | number;
}

export interface RomeDBCallOptions {
  signal?: AbortSignal;
  kind?: string;
  retryConflicts?: number;
}

/**
 * The part of `RomeDB` (`@cossackframework/romedb`) this adapter calls. Each call is one
 * request: `read` runs on one snapshot, `write` is one atomic batch.
 */
export interface RomeDBBinding {
  read(statements: RomeDBStatement[], options?: RomeDBCallOptions): Promise<{ readonly results: readonly RomeDBStatementResult[] }>;
  write(statements: RomeDBStatement[], options?: RomeDBCallOptions): Promise<{ readonly results: readonly RomeDBStatementResult[] }>;
}

/** RomeDB's value classes (`RecordId` and `Float64` of `@cossackframework/romedb`). */
export interface RomeDBValues {
  readonly RecordId: new (table: string, key: never) => { readonly table: string; readonly key: unknown };
  readonly Float64: new (value: number) => { readonly value: number };
}

export interface RomeDBAdapterOptions {
  /**
   * RomeDB's own value classes. With them a `RecordLink` is sent as a record and a record
   * read back becomes a `RecordLink`; document entities need them.
   */
  readonly values?: RomeDBValues;
  /** Label of the adapter's writes in the pending-write store. Default `orm`. */
  readonly kind?: string;
  /**
   * How often a write that lost to a concurrent write of the same rows runs again. Each ORM
   * statement and batch is complete in itself, so running it again on newer data is correct. Default 5.
   */
  readonly retryConflicts?: number;
  readonly tooling?: Adapter["tooling"];
}

/** Statements one RomeDB request carries. */
const MAX_STATEMENTS = 32;

/** Rewrite positional `?` placeholders to `$p1..$pn`, leaving quoted text and identifiers alone. */
export function numberPlaceholders(text: string): string {
  let out = "";
  let index = 0;
  for (let position = 0; position < text.length; position++) {
    const char = text[position]!;
    if (char === "'" || char === '"' || char === "`") {
      let end = position + 1;
      for (; end < text.length; end++) {
        if (text[end] !== char) continue;
        if (text[end + 1] === char) { end++; continue; }
        break;
      }
      out += text.slice(position, end + 1);
      position = end;
    } else if (char === "?") out += `$p${++index}`;
    else out += char;
  }
  return out;
}

/** A statement that changes nothing runs as a read: it needs no pending-write record. */
function reads(text: string): boolean {
  if (!/^\s*(?:SELECT|WITH|INFO)\b/i.test(text)) return false;
  return !/\b(?:RETURNING|INSERT|UPDATE|DELETE|UPSERT|RELATE)\b/i.test(text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, ""));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

class RomeDBDriver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly capabilities: DriverCapabilities;

  constructor(readonly binding: RomeDBBinding, private readonly options: RomeDBAdapterOptions) {
    this.capabilities = capabilities({
      // One request is one atomic batch; there is no transaction to hold open across requests.
      transactions: false,
      savepoints: false,
      reserveConnection: false,
      cancellation: true,
      // A request is at most 64 KiB on a local engine, which a long IN list reaches first.
      parameterLimit: 500,
      batchLimit: MAX_STATEMENTS,
      documents: options.values !== undefined,
    });
  }

  async execute<Row = Record<string, unknown>>(
    query: CompiledQuery,
    operation: QueryOperation = "raw",
    signal?: AbortSignal,
  ): Promise<QueryResult<Row>> {
    const start = performance.now();
    const pragma = /^\s*PRAGMA\s+table_info\s*\(\s*([\s\S]+?)\s*\)\s*;?\s*$/i.exec(query.text);
    if (pragma) return { rows: await this.tableInfo(unquote(pragma[1]!), signal) as Row[], meta: meta("sqlite", operation, start) };
    const statement = this.statement(query);
    const result = (await this.call([statement], reads(statement.rql), signal)).results[0]!;
    return this.result<Row>(result, operation, start);
  }

  async batch(statements: readonly BatchStatement[]): Promise<readonly QueryResult[]> {
    const start = performance.now();
    const prepared = statements.map(({ query }) => this.statement(query));
    const batch = await this.call(prepared, prepared.every((statement) => reads(statement.rql)));
    return batch.results.map((result, index) => this.result(result, statements[index]?.operation ?? "raw", start));
  }

  introspect(): Promise<OrmSchema> {
    return introspectRomeDB(async (rql) => this.objects((await this.binding.read([{ rql }])).results[0]!));
  }

  /** The RomeDB instance is the caller's, and may serve other code: closing the ORM leaves it open. */
  async close(): Promise<void> {}

  /**
   * `PRAGMA table_info`, which the service refuses, answered from `INFO FOR TABLE`: the
   * columns of a relational table, and no rows for a table that does not exist. The ORM's
   * tools use it to look for a table without creating it.
   */
  private async tableInfo(table: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    const tables = this.objects((await this.call([{ rql: "INFO FOR DB" }], true, signal)).results[0]!)[0]?.["info"] as
      { tables?: readonly { name: string }[] } | undefined;
    if (!tables?.tables?.some((entry) => entry.name === table)) return [];
    const info = this.objects((await this.call([{ rql: `INFO FOR TABLE "${table.replaceAll('"', '""')}"` }], true, signal)).results[0]!)[0]?.["info"] as
      { columns?: Record<string, unknown>[] } | undefined;
    // A document table has no declared columns; it still exists, so it reports its id.
    return info?.columns ?? [{ cid: 0, name: "id", type: "", notnull: 1, dflt_value: null, pk: 1 }];
  }

  private call(statements: RomeDBStatement[], reading: boolean, signal?: AbortSignal) {
    if (reading) return this.binding.read(statements, signal ? { signal } : {});
    return this.binding.write(statements, {
      kind: this.options.kind ?? "orm",
      retryConflicts: this.options.retryConflicts ?? 5,
      ...(signal ? { signal } : {}),
    });
  }

  private statement(query: CompiledQuery): RomeDBStatement {
    const rql = numberPlaceholders(query.text);
    if (!query.parameters.length) return { rql };
    const params: { [name: string]: unknown } = {};
    query.parameters.forEach((value, index) => { params[`$p${index + 1}`] = this.send(value); });
    return { rql, params };
  }

  private result<Row>(result: RomeDBStatementResult, operation: QueryOperation, start: number): QueryResult<Row> {
    return {
      rows: this.objects(result) as Row[],
      meta: meta("sqlite", operation, start, { rowsAffected: Number(result.affected ?? 0) }),
    };
  }

  /** RomeDB rows are positional; a repeated column name keeps its last value, as SQLite drivers do. */
  private objects(result: RomeDBStatementResult): Record<string, unknown>[] {
    return result.rows.map((row) => {
      const object: Record<string, unknown> = {};
      result.columns.forEach((name, index) => { object[name] = this.receive(row[index]); });
      return object;
    });
  }

  /** A parameter as RomeDB takes it: links become records, inside nested documents too. */
  private send(value: unknown): unknown {
    if (isRecordLink(value)) {
      if (!this.options.values) {
        throw new ConfigurationError("A record link needs RomeDB's value classes: create the adapter with romedb() from @cossackframework/romedb/database.");
      }
      return new this.options.values.RecordId(value.table, value.key as never);
    }
    if (Array.isArray(value)) return value.map((item) => this.send(item));
    if (plainObject(value)) {
      const document: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) if (item !== undefined) document[key] = this.send(item);
      return document;
    }
    return value;
  }

  /** A result value as the ORM reads it: records become links, and numbers are JavaScript numbers where they fit. */
  private receive(value: unknown): unknown {
    if (typeof value === "bigint") {
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    }
    if (typeof value !== "object" || value === null || value instanceof Uint8Array) return value;
    const values = this.options.values;
    if (values && value instanceof values.RecordId) return new RecordLink(value.table, value.key as RecordKey);
    if (values && value instanceof values.Float64) return value.value;
    if (Array.isArray(value)) return value.map((item) => this.receive(item));
    if (plainObject(value)) {
      const document: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) document[key] = this.receive(item);
      return document;
    }
    return value;
  }
}

type ReadObjects = (rql: string) => Promise<Record<string, unknown>[]>;

interface TableInfo {
  readonly model?: string;
  readonly columns?: SQLiteTableCatalog["columns"];
  readonly indexes?: readonly { name: string; unique?: number | boolean; origin?: string; path?: readonly string[]; paths?: readonly (readonly string[])[] }[];
}

function unquote(identifier: string): string {
  const trimmed = identifier.trim();
  const quoted = /^(["`])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2]!.replaceAll(quoted[1]! + quoted[1]!, quoted[1]!) : trimmed;
}

/** The columns of `CREATE INDEX ... ON t (a, "b")`; the engine reports an index's name but not its columns. */
function indexColumns(sql: string): string[] {
  const list = /\bON\s+(?:"(?:[^"]|"")+"|`[^`]+`|[\w$]+)\s*\(([\s\S]*)\)\s*(?:WHERE\b[\s\S]*)?$/i.exec(sql)?.[1];
  if (!list) return [];
  return list.split(",").map((part) => unquote(part.trim().replace(/\s+(?:ASC|DESC)$/i, "")));
}

/** The parts of a CREATE TABLE body, split at the commas outside parentheses and quotes. */
function definitions(sql: string): string[] {
  const start = sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of sql.slice(start + 1, end)) {
    if (quote) { if (char === quote) quote = ""; }
    else if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Column lists of the UNIQUE constraints in a CREATE TABLE text. The engine lists each
 * constraint's automatic index by name only, and that index has no DDL text of its own.
 */
function uniqueConstraints(sql: string): string[][] {
  const found: string[][] = [];
  for (const part of definitions(sql)) {
    const table = /^(?:CONSTRAINT\s+(?:"(?:[^"]|"")+"|`[^`]+`|[\w$]+)\s+)?UNIQUE\s*\(([\s\S]*)\)/i.exec(part);
    if (table) { found.push(table[1]!.split(",").map(unquote)); continue; }
    if (/^(?:CONSTRAINT|PRIMARY|FOREIGN|CHECK)\b/i.test(part)) continue;
    const column = /^("(?:[^"]|"")+"|`[^`]+`|[\w$]+)/.exec(part)?.[1];
    if (column && /\bUNIQUE\b/i.test(part.replace(/'(?:[^']|'')*'/g, ""))) found.push([unquote(column)]);
  }
  return found;
}

/** Foreign keys of a CREATE TABLE text, in the table-constraint and the column-constraint form. */
function foreignKeys(sql: string): SQLiteTableCatalog["foreignKeys"][number][] {
  const name = String.raw`("(?:[^"]|"")+"|\`[^\`]+\`|[\w$]+)`;
  const action = String.raw`(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?`;
  const found: SQLiteTableCatalog["foreignKeys"][number][] = [];
  const add = (from: string, table: string, to: string, onDelete: string | undefined) => {
    const column = unquote(from);
    if (found.some((key) => key.from === column)) return;
    found.push({
      from: column, table: unquote(table), to: unquote(to),
      on_delete: (onDelete?.replace(/\s+/g, " ").toUpperCase() ?? "NO ACTION") as "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION",
    });
  };
  const constraint = new RegExp(String.raw`FOREIGN\s+KEY\s*\(\s*${name}\s*\)\s*REFERENCES\s+${name}\s*\(\s*${name}\s*\)${action}`, "gi");
  for (const match of sql.matchAll(constraint)) add(match[1]!, match[2]!, match[3]!, match[4]);
  const inline = new RegExp(String.raw`(?:^|[(,])\s*${name}\s+[^,()]*?\bREFERENCES\s+${name}\s*\(\s*${name}\s*\)${action}`, "gi");
  for (const match of sql.matchAll(inline)) {
    if (!/^FOREIGN$/i.test(match[1]!)) add(match[1]!, match[2]!, match[3]!, match[4]);
  }
  return found;
}

/**
 * The database's schema from RomeDB's catalog. The service refuses PRAGMA, so tables and
 * columns come from `INFO FOR`, and index columns and foreign keys from the stored DDL text.
 */
export async function introspectRomeDB(read: ReadObjects): Promise<OrmSchema> {
  const database = (await read("INFO FOR DB"))[0]?.["info"] as { tables?: readonly { name: string; model: string }[] } | undefined;
  const master = await read("SELECT type, name, tbl_name, sql FROM sqlite_master") as { type: string; name: string; tbl_name: string; sql: string | null }[];
  const tables = [...(database?.tables ?? [])]
    .filter((table) => table.name !== "_cossack_migrations" && !table.name.startsWith("__") && !table.name.startsWith("sqlite_"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const entities: EntitySchema[] = [];
  for (const table of tables) {
    const info = (await read(`INFO FOR TABLE "${table.name.replaceAll('"', '""')}"`))[0]?.["info"] as TableInfo | undefined;
    if (table.model === "document") {
      entities.push({
        modelName: table.name,
        tableName: table.name,
        columns: [],
        relations: [],
        indexes: (info?.indexes ?? []).map((index) => ({
          name: index.name,
          columns: (index.paths ?? (index.path ? [index.path] : [])).map((path) => path.join(".")),
          unique: Boolean(index.unique),
        })).sort((left, right) => left.name.localeCompare(right.name)),
        virtual: false,
        model: "document",
      });
      continue;
    }
    const sql = master.find((row) => row.type === "table" && row.name === table.name)?.sql ?? "";
    entities.push(sqliteEntitySchema({
      name: table.name,
      sql,
      columns: info?.columns ?? [],
      indexes: [
        // Indexes made with CREATE INDEX: their columns are in their own DDL text.
        ...(info?.indexes ?? []).filter((index) => index.origin === "c" || index.origin === undefined).map((index) => ({
          name: index.name,
          columns: indexColumns(master.find((row) => row.type === "index" && row.name === index.name)?.sql ?? ""),
          unique: Boolean(index.unique),
          origin: "c",
        })),
        ...uniqueConstraints(sql).map((columns, index) => ({
          name: `sqlite_autoindex_${table.name}_u${index + 1}`, columns, unique: true, origin: "u",
        })),
      ],
      foreignKeys: foreignKeys(sql),
    }));
  }
  return { version: 1, dialect: "sqlite", entities };
}

/**
 * RomeDB as an ORM database. Relational entities are SQLite-dialect tables; with `values`,
 * `@Entity({ model: "document" })` entities are document tables. Applications use `romedb()`
 * from `@cossackframework/romedb/database`, which passes RomeDB's value classes.
 */
export async function romedb(binding: RomeDBBinding, options: RomeDBAdapterOptions = {}): Promise<Adapter> {
  return {
    driver: new RomeDBDriver(binding, options),
    tooling: options.tooling ?? { provider: "romedb", target: "remote" },
  };
}

/**
 * The RomeDB instance behind an ORM, for RomeQL the ORM does not write: documents, record
 * links, graph traversal, vectors and search. The calls share the ORM's connection,
 * pending-write store and limits. Without an argument it is the ORM of the current scope.
 */
export function romedbClient<Binding extends RomeDBBinding = RomeDBBinding>(orm: ORM | undefined = currentORM()): Binding {
  if (!orm) throw new ConfigurationError("romedbClient() needs an ORM: pass one, or call it inside orm.run().");
  const driver = orm.driver;
  if (!(driver instanceof RomeDBDriver)) throw new ConfigurationError("romedbClient() needs an ORM created with the RomeDB adapter.");
  return driver.binding as Binding;
}
