import {
  coerceCellValue,
  interpolateSqlParameters,
  limitStatementRows,
  parseSingleStatement,
  quoteIdentifier,
  statementMayChangeSchema,
} from './sql.js';
import { findObject, introspectSchema } from './schema.js';
import { normalizeQueryResult } from './transport.js';
import { chunkStatements, runStatements } from './batch.js';
import type { DatabaseInspection } from '@cossackframework/database/tooling';
import type {
  StudioColumn,
  StudioConnection,
  StudioObject,
  StudioPragma,
  StudioPragmaOption,
  StudioExecutor,
  StudioQueryResult,
  StudioSchema,
} from './schema-types.js';
import type {
  BrowseFilter,
  BrowseOptions,
  BrowseSort,
  InsertCell,
  InsertValueKind,
  MutationResult,
  TransportQueryResult,
} from './query-types.js';

const CONSOLE_ROW_LIMIT = 1_000;

interface PragmaOption extends StudioPragmaOption {
  sql: string;
}

interface PragmaDefinition {
  name: string;
  kind: StudioPragma['kind'];
  description: string;
  options?: PragmaOption[];
  min?: number;
  max?: number;
}

const BOOLEAN_PRAGMA_OPTIONS: PragmaOption[] = [
  { value: '0', label: 'Off', sql: 'OFF' },
  { value: '1', label: 'On', sql: 'ON' },
];

const SQLITE_PRAGMAS: PragmaDefinition[] = [
  {
    name: 'application_id',
    kind: 'number',
    description: 'Application-specific 32-bit identifier stored in the database header.',
    min: 0,
    max: 2_147_483_647,
  },
  {
    name: 'auto_vacuum',
    kind: 'select',
    description: 'Controls whether free database pages are reclaimed automatically.',
    options: [
      { value: '0', label: 'None', sql: 'NONE' },
      { value: '1', label: 'Full', sql: 'FULL' },
      { value: '2', label: 'Incremental', sql: 'INCREMENTAL' },
    ],
  },
  {
    name: 'automatic_index',
    kind: 'boolean',
    description: 'Allows SQLite to create temporary indexes while planning queries.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'busy_timeout',
    kind: 'number',
    description: 'How long SQLite waits for a locked database, in milliseconds.',
    min: 0,
  },
  {
    name: 'cache_size',
    kind: 'number',
    description: 'Suggested page cache size; negative values represent kibibytes.',
  },
  {
    name: 'foreign_keys',
    kind: 'boolean',
    description: 'Enforces declared foreign-key constraints for this connection.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'ignore_check_constraints',
    kind: 'boolean',
    description: 'Temporarily disables CHECK constraint enforcement when enabled.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'journal_mode',
    kind: 'select',
    description: 'Selects the journal strategy used to make transactions atomic.',
    options: ['DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'WAL', 'OFF'].map((value) => ({
      value,
      label: value === 'WAL' ? 'WAL' : value[0] + value.slice(1).toLowerCase(),
      sql: value,
    })),
  },
  {
    name: 'legacy_alter_table',
    kind: 'boolean',
    description: 'Uses pre-3.25 ALTER TABLE rename behavior when enabled.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'query_only',
    kind: 'boolean',
    description: 'Prevents this connection from changing database content when enabled.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'read_uncommitted',
    kind: 'boolean',
    description: 'Requests read-uncommitted transaction isolation.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'recursive_triggers',
    kind: 'boolean',
    description: 'Allows triggers to invoke other triggers recursively.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'reverse_unordered_selects',
    kind: 'boolean',
    description: 'Reverses many unordered query results to detect ordering assumptions.',
    options: BOOLEAN_PRAGMA_OPTIONS,
  },
  {
    name: 'secure_delete',
    kind: 'select',
    description: 'Controls whether deleted content is overwritten with zeros.',
    options: [
      { value: '0', label: 'Off', sql: 'OFF' },
      { value: '1', label: 'On', sql: 'ON' },
      { value: '2', label: 'Fast', sql: 'FAST' },
    ],
  },
  {
    name: 'synchronous',
    kind: 'select',
    description: 'Balances transaction durability against filesystem sync overhead.',
    options: [
      { value: '0', label: 'Off', sql: 'OFF' },
      { value: '1', label: 'Normal', sql: 'NORMAL' },
      { value: '2', label: 'Full', sql: 'FULL' },
      { value: '3', label: 'Extra', sql: 'EXTRA' },
    ],
  },
  {
    name: 'temp_store',
    kind: 'select',
    description: 'Chooses where SQLite stores temporary tables and indexes.',
    options: [
      { value: '0', label: 'Default', sql: 'DEFAULT' },
      { value: '1', label: 'File', sql: 'FILE' },
      { value: '2', label: 'Memory', sql: 'MEMORY' },
    ],
  },
  {
    name: 'user_version',
    kind: 'number',
    description: 'Application-managed version integer stored in the database header.',
    min: 0,
    max: 2_147_483_647,
  },
  {
    name: 'wal_autocheckpoint',
    kind: 'number',
    description: 'WAL page threshold that triggers an automatic checkpoint.',
    min: 0,
  },
];

function isSqliteProvider(provider: StudioConnection['info']['provider']): boolean {
  return provider === 'sqlite' ||
    provider === 'turso' ||
    provider === 'd1-local' ||
    provider === 'd1-remote';
}

function pragmaEntry(
  definition: PragmaDefinition,
  result: StudioQueryResult,
): StudioPragma | undefined {
  const row = result.rows[0];
  if (!row) return undefined;
  const rawValue = row[definition.name] ?? Object.values(row)[0];
  if (rawValue === undefined || rawValue === null) return undefined;
  const rawText = String(rawValue);
  return {
    name: definition.name,
    value: definition.name === 'journal_mode' ? rawText.toUpperCase() : rawText,
    kind: definition.kind,
    description: definition.description,
    options: definition.options?.map(({ value, label }) => ({ value, label })),
  };
}

export class StudioDatabase {
  private schema?: StudioSchema;
  private schemaLoad?: Promise<StudioSchema>;
  private inspection?: DatabaseInspection;
  private inspectionLoad?: Promise<DatabaseInspection | undefined>;
  private databaseVersion?: string;
  private generation = 0;
  /** PRAGMA names this connection could read, learned on the first read. */
  private readablePragmas?: Set<string>;

  constructor(
    readonly connection: StudioConnection,
    private readonly options: { applicationName?: string } = {},
  ) {}

  /**
   * Return the introspected schema. The result is cached: Studio invalidates
   * it after statements that may change the schema (console DDL/writes and
   * PRAGMA writes). `refresh` forces a fresh introspection, e.g. to pick up
   * changes made outside Studio. Migration inspection is not part of this
   * call; it is attached only once loaded through `getInspection()`.
   */
  async getSchema(refresh = false): Promise<StudioSchema> {
    if (refresh) this.invalidateSchema();
    if (this.schema) return this.withInspection(this.schema);
    if (!this.schemaLoad) {
      const generation = this.generation;
      const load = introspectSchema(
        this.connection,
        this.options.applicationName ?? 'Cossack application',
        this.databaseVersion,
      ).then((schema) => {
        if (generation === this.generation) {
          this.schema = schema;
          this.databaseVersion = schema.connection.databaseVersion;
        }
        return schema;
      }).finally(() => {
        if (this.schemaLoad === load) this.schemaLoad = undefined;
      });
      this.schemaLoad = load;
    }
    return this.withInspection(await this.schemaLoad);
  }

  /**
   * Lazily load shared migration/capability inspection. It can be expensive
   * (remote D1 runs several Wrangler commands), so only views that display
   * it request it. The result is cached until the schema is invalidated.
   */
  async getInspection(refresh = false): Promise<DatabaseInspection | undefined> {
    if (!this.connection.inspect) return undefined;
    if (refresh) {
      this.inspection = undefined;
      this.inspectionLoad = undefined;
    }
    if (this.inspection) return this.inspection;
    if (!this.inspectionLoad) {
      const generation = this.generation;
      const load = this.connection.inspect().then((inspection) => {
        if (generation === this.generation) this.inspection = inspection;
        return inspection;
      }).finally(() => {
        if (this.inspectionLoad === load) this.inspectionLoad = undefined;
      });
      this.inspectionLoad = load;
    }
    return this.inspectionLoad;
  }

  /** Drop cached schema and inspection so the next read introspects again. */
  invalidateSchema(): void {
    this.generation++;
    this.schema = undefined;
    this.schemaLoad = undefined;
    this.inspection = undefined;
    this.inspectionLoad = undefined;
  }

  private withInspection(schema: StudioSchema): StudioSchema {
    const inspectionAvailable = typeof this.connection.inspect === 'function';
    const { inspection: _previous, ...rest } = schema;
    return {
      ...rest,
      ...(inspectionAvailable ? { inspectionAvailable } : {}),
      ...(this.inspection ? { inspection: this.inspection } : {}),
    };
  }

  /** Find an object, re-introspecting once if the cached schema lacks it. */
  private async findSchemaObject(name: string): Promise<StudioObject> {
    const cached = await this.getSchema();
    if (cached.objects.some((object) => object.name === name)) return findObject(cached, name);
    return findObject(await this.getSchema(true), name);
  }

  async browse(
    name: string,
    optionsOrPage: BrowseOptions | number = {},
    legacyPageSize = 100,
  ): Promise<TransportQueryResult> {
    const object = await this.findSchemaObject(name);
    const options = typeof optionsOrPage === 'number'
      ? { page: optionsOrPage, pageSize: legacyPageSize }
      : optionsOrPage;
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 100;
    const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)));
    const predicate = this.browsePredicate(object, options.filters ?? []);
    const count = this.bind(
      `SELECT COUNT(*) AS ${this.quote('__cossack_total')} ` +
      `FROM ${this.quote(object.name)}${predicate.sql}`,
      [...predicate.parameters],
    );
    const order = this.browseOrder(object, options.sort ?? []);
    const locatorProjection = this.locatorProjection(object);
    const selection = locatorProjection.length
      ? `${locatorProjection.join(', ')}, *`
      : '*';
    const orderExpressions = [
      ...order.map((item) =>
        `${this.quote(item.column)} ${item.direction.toUpperCase()}`),
      ...this.systemLocatorOrder(object),
    ];
    const displayOrderExpressions = order.map((item) =>
      `${this.quote(item.column)} ${item.direction.toUpperCase()}`);
    const pageQuery = (pageNumber: number) => {
      const window = ` LIMIT ${safePageSize} OFFSET ${(pageNumber - 1) * safePageSize}`;
      return {
        statement: this.bind(
          `SELECT ${selection} FROM ${this.quote(object.name)}${predicate.sql}` +
          (orderExpressions.length ? ` ORDER BY ${orderExpressions.join(', ')}` : '') +
          window,
          [...predicate.parameters],
        ),
        display: this.renderParameters(
          `SELECT * FROM ${this.quote(object.name)}${predicate.sql}` +
          (displayOrderExpressions.length ? ` ORDER BY ${displayOrderExpressions.join(', ')}` : '') +
          window,
          predicate.parameters,
        ),
      };
    };
    // Count and page run together (one Wrangler process on remote D1). The
    // page is fetched again only when the count shows it is past the end.
    const requestedPage = Math.min(1_000_000_000, Math.max(1, Math.floor(page) || 1));
    let query = pageQuery(requestedPage);
    const [countResult, firstPage] = await runStatements(this.connection, [
      { sql: count.sql, parameters: count.parameters },
      { sql: query.statement.sql, parameters: query.statement.parameters },
    ]);
    const rawTotal = countResult!.rows[0]?.__cossack_total;
    const totalRows = typeof rawTotal === 'bigint'
      ? Number(rawTotal)
      : Math.max(0, Number(rawTotal ?? 0));
    const lastPage = Math.max(1, Math.ceil(totalRows / safePageSize));
    const safePage = Math.min(lastPage, requestedPage);
    let pageResult = firstPage!;
    if (safePage !== requestedPage) {
      query = pageQuery(safePage);
      pageResult = await this.connection.execute(query.statement.sql, query.statement.parameters);
    }
    const displayQuery = query.display;
    const normalized = normalizeQueryResult(pageResult);
    const internalColumns = new Set(object.rowLocators
      .filter((locator) =>
        locator.kind === 'sqlite-rowid' || locator.kind === 'postgres-ctid')
      .flatMap((locator) => locator.columns));
    return {
      ...normalized,
      columns: normalized.columns.length
        ? normalized.columns.filter((column) => !internalColumns.has(column))
        : object.columns.filter((column) => !column.hidden).map((column) => column.name),
      totalRows,
      page: safePage,
      pageSize: safePageSize,
      objectName: object.name,
      query: displayQuery,
    };
  }

  async executeSql(input: string): Promise<TransportQueryResult> {
    const provider = this.connection.info.provider;
    const statement = parseSingleStatement(input, provider);
    try {
      let raw;
      try {
        raw = await this.executeBounded(statement);
      } finally {
        // A failed statement may still have partially applied (e.g. MySQL DDL).
        if (statementMayChangeSchema(statement, provider)) this.invalidateSchema();
      }
      return normalizeQueryResult(raw, CONSOLE_ROW_LIMIT);
    } catch (error: any) {
      return {
        columns: [],
        rows: [],
        affectedRows: 0,
        durationMs: 0,
        truncated: false,
        error: error?.message ?? String(error),
      };
    }
  }

  async explainSql(input: string): Promise<TransportQueryResult> {
    const statement = parseSingleStatement(input, this.connection.info.provider);
    const prefix = this.connection.info.provider === 'postgres'
      ? 'EXPLAIN (FORMAT JSON) '
      : this.connection.info.provider === 'mysql'
        ? 'EXPLAIN FORMAT=JSON '
        : 'EXPLAIN QUERY PLAN ';
    try {
      return normalizeQueryResult(
        await this.connection.execute(`${prefix}${statement}`),
      );
    } catch (error: any) {
      return {
        columns: [],
        rows: [],
        affectedRows: 0,
        durationMs: 0,
        truncated: false,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Run a console statement, asking the database for at most one row more
   * than the console displays so large SELECTs are not fully materialised.
   * The bounded form is a derived table; when a database rejects it (for
   * example MySQL with duplicate column names) the original query runs.
   */
  private async executeBounded(statement: string) {
    const bounded = limitStatementRows(
      statement,
      this.connection.info.provider,
      CONSOLE_ROW_LIMIT + 1,
    );
    if (bounded) {
      try {
        return await this.connection.execute(bounded);
      } catch {
        // Fall through: report errors from the statement the user wrote.
      }
    }
    return this.connection.execute(statement);
  }

  async getPragmas(): Promise<StudioPragma[]> {
    if (!isSqliteProvider(this.connection.info.provider)) {
      throw new Error('Pragmas are available only for SQLite, Turso, and D1 databases.');
    }
    // A batch fails as a whole when one PRAGMA is not allowed (D1 rejects
    // several with SQLITE_AUTH), so batching connections read the PRAGMAs
    // one by one once and then batch only those that could be read.
    const readable = this.readablePragmas;
    if (this.connection.batch && readable) {
      const definitions = SQLITE_PRAGMAS.filter((definition) => readable.has(definition.name));
      try {
        const results = await runStatements(
          this.connection,
          definitions.map((definition) => ({ sql: `PRAGMA ${definition.name}` })),
        );
        return definitions.flatMap((definition, index) =>
          pragmaEntry(definition, results[index]!) ?? []);
      } catch {
        // Read them one by one below and learn the readable set again.
      }
    }
    const pragmas: StudioPragma[] = [];
    const learned = new Set<string>();
    let firstError: unknown;
    for (const definition of SQLITE_PRAGMAS) {
      try {
        const result = await this.connection.execute(`PRAGMA ${definition.name}`);
        learned.add(definition.name);
        const entry = pragmaEntry(definition, result);
        if (entry) pragmas.push(entry);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (!pragmas.length && firstError) throw firstError;
    this.readablePragmas = learned;
    return pragmas;
  }

  async setPragma(name: string, value: string): Promise<StudioPragma[]> {
    if (!isSqliteProvider(this.connection.info.provider)) {
      throw new Error('Pragmas are available only for SQLite, Turso, and D1 databases.');
    }
    const definition = SQLITE_PRAGMAS.find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`PRAGMA "${name}" is not editable in Studio.`);

    let sqlValue: string;
    if (definition.kind === 'number') {
      const normalized = value.trim();
      const number = Number(normalized);
      if (!/^-?\d+$/.test(normalized) || !Number.isSafeInteger(number)) {
        throw new Error(`PRAGMA ${name} expects an integer.`);
      }
      if (definition.min !== undefined && number < definition.min) {
        throw new Error(`PRAGMA ${name} must be at least ${definition.min}.`);
      }
      if (definition.max !== undefined && number > definition.max) {
        throw new Error(`PRAGMA ${name} must be at most ${definition.max}.`);
      }
      sqlValue = normalized;
    } else {
      const option = definition.options?.find((candidate) => candidate.value === value);
      if (!option) throw new Error(`Invalid value for PRAGMA ${name}.`);
      sqlValue = option.sql;
    }

    try {
      await this.connection.execute(`PRAGMA ${definition.name} = ${sqlValue}`);
    } finally {
      this.invalidateSchema();
    }
    return this.getPragmas();
  }

  async insert(tableName: string, cells: Record<string, InsertCell>): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    const columns = object.columns.filter((column) => {
      const cell = cells[column.name];
      return cell && cell.mode !== 'omit';
    });
    let sql: string;
    let parameters: unknown[] = [];
    if (columns.length === 0) {
      sql = this.connection.info.provider === 'mysql'
        ? `INSERT INTO ${this.quote(object.name)} () VALUES ()`
        : `INSERT INTO ${this.quote(object.name)} DEFAULT VALUES`;
    } else {
      const values = columns.map((column) => {
        const cell = cells[column.name];
        if (!cell || cell.mode === 'omit') throw new Error(`Missing value for ${column.name}.`);
        if (cell.mode === 'null') {
          if (!column.nullable) throw new Error(`${column.name} does not allow NULL.`);
          return null;
        }
        return cell.valueKind
          ? this.coerceInsertValue(cell.value, cell.valueKind, column)
          : this.coerceValue(cell.value, column);
      });
      sql = `INSERT INTO ${this.quote(object.name)} (` +
        `${columns.map((column) => this.quote(column.name)).join(', ')}) VALUES (` +
        `${values.map(() => '?').join(', ')})`;
      ({ sql, parameters } = this.bind(sql, values));
    }
    const result = await this.connection.execute(sql, parameters);
    return { affectedRows: result.affectedRows, schema: await this.getSchema() };
  }

  async update(
    tableName: string,
    key: Record<string, unknown>,
    columnName: string,
    value: { mode: 'null' } | {
      mode: 'value';
      value: string;
      valueKind?: InsertValueKind;
    },
  ): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    const column = object.columns.find((candidate) => candidate.name === columnName);
    if (!column) throw new Error(`Column "${columnName}" does not exist on "${tableName}".`);
    const nextValue = value.mode === 'null'
      ? null
      : value.valueKind
        ? this.coerceInsertValue(value.value, value.valueKind, column)
        : this.coerceValue(value.value, column);
    if (nextValue === null && !column.nullable) throw new Error(`${column.name} does not allow NULL.`);
    const where = this.keyPredicate(object, key);
    let sql = `UPDATE ${this.quote(object.name)} SET ${this.quote(column.name)} = ? ` +
      `WHERE ${where.sql}`;
    let parameters: unknown[] = [nextValue, ...where.parameters];
    ({ sql, parameters } = this.bind(sql, parameters));
    const result = await this.connection.execute(sql, parameters);
    if (result.affectedRows !== 1) {
      throw new Error(`Stale update: expected one affected row, received ${result.affectedRows}.`);
    }
    return { affectedRows: result.affectedRows, schema: await this.getSchema() };
  }

  async updateRow(
    tableName: string,
    key: Record<string, unknown>,
    values: Record<string, unknown>,
  ): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    const entries = Object.entries(values);
    if (!entries.length) throw new Error('Change at least one row value.');
    const updates = entries.map(([columnName, value]) => {
      const column = object.columns.find((candidate) =>
        candidate.name === columnName && !candidate.hidden);
      if (!column) {
        throw new Error(`Column "${columnName}" does not exist on "${tableName}".`);
      }
      const nextValue = this.coerceJsonValue(value, column);
      if (nextValue === null && !column.nullable) {
        throw new Error(`${column.name} does not allow NULL.`);
      }
      return { column, value: nextValue };
    });
    const where = this.keyPredicate(object, key);
    let sql = `UPDATE ${this.quote(object.name)} SET ${updates
      .map(({ column }) => `${this.quote(column.name)} = ?`)
      .join(', ')} WHERE ${where.sql}`;
    let parameters = [
      ...updates.map((update) => update.value),
      ...where.parameters,
    ];
    ({ sql, parameters } = this.bind(sql, parameters));
    const result = await this.connection.execute(sql, parameters);
    if (result.affectedRows !== 1) {
      throw new Error(`Stale update: expected one affected row, received ${result.affectedRows}.`);
    }
    return { affectedRows: result.affectedRows, schema: await this.getSchema() };
  }

  async delete(tableName: string, key: Record<string, unknown>): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    const where = this.keyPredicate(object, key);
    let sql = `DELETE FROM ${this.quote(object.name)} WHERE ${where.sql}`;
    let parameters = where.parameters;
    ({ sql, parameters } = this.bind(sql, parameters));
    const result = await this.connection.execute(sql, parameters);
    if (result.affectedRows !== 1) {
      throw new Error(`Stale delete: expected one affected row, received ${result.affectedRows}.`);
    }
    return { affectedRows: result.affectedRows, schema: await this.getSchema() };
  }

  async deleteMany(
    tableName: string,
    keys: Array<Record<string, unknown>>,
  ): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    if (!keys.length) throw new Error('Select at least one row.');
    const statements = keys.slice(0, 1_000).map((key) => {
      const where = this.keyPredicate(object, key);
      return this.bind(`DELETE FROM ${this.quote(object.name)} WHERE ${where.sql}`, where.parameters);
    });
    const affectedRows = await this.runBatch('delete', statements);
    return { affectedRows, schema: await this.getSchema() };
  }

  async updateMany(
    tableName: string,
    keys: Array<Record<string, unknown>>,
    columnName: string,
    value: { mode: 'null' } | { mode: 'value'; value: string },
  ): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    const column = object.columns.find((candidate) => candidate.name === columnName);
    if (!column) throw new Error(`Column "${columnName}" does not exist on "${tableName}".`);
    if (!keys.length) throw new Error('Select at least one row.');
    const nextValue = value.mode === 'null' ? null : this.coerceValue(value.value, column);
    if (nextValue === null && !column.nullable) throw new Error(`${column.name} does not allow NULL.`);
    const statements = keys.slice(0, 1_000).map((key) => {
      const where = this.keyPredicate(object, key);
      return this.bind(
        `UPDATE ${this.quote(object.name)} SET ${this.quote(column.name)} = ? WHERE ${where.sql}`,
        [nextValue, ...where.parameters],
      );
    });
    const affectedRows = await this.runBatch('update', statements);
    return { affectedRows, schema: await this.getSchema() };
  }

  /**
   * Run single-row batch statements, each of which must affect exactly one
   * row. Local connections with transaction support apply all or nothing.
   * Connections without transactions are best-effort: rows changed before a
   * failure stay changed, and the error says how many. Connections with
   * `batch()` (remote D1) send the statements in a few batches; D1 runs each
   * batch as one transaction, so a failing statement rolls back its batch,
   * while a stale row (no change) does not stop the rest of its batch.
   */
  private async runBatch(
    kind: 'delete' | 'update',
    statements: Array<{ sql: string; parameters: unknown[] }>,
  ): Promise<number> {
    const run = async (execute: StudioExecutor, atomic: boolean) => {
      let affectedRows = 0;
      for (const statement of statements) {
        let result;
        try {
          result = await execute(statement.sql, statement.parameters);
        } catch (error: any) {
          if (!atomic) {
            throw new Error(
              `Batch ${kind} stopped after ${affectedRows} row(s): ${error?.message ?? String(error)}`,
              { cause: error },
            );
          }
          throw error;
        }
        if (result.affectedRows !== 1) {
          throw new Error(atomic
            ? `Batch ${kind} rolled back: a selected row was stale. No rows were changed.`
            : `Batch ${kind} stopped after ${affectedRows} row(s): a selected row was stale.`);
        }
        affectedRows += result.affectedRows;
      }
      return affectedRows;
    };
    if (this.connection.transaction) return this.connection.transaction(run);
    if (this.connection.batch) return this.runRemoteBatch(kind, statements);
    return run((sql, parameters) => this.connection.execute(sql, parameters), false);
  }

  private async runRemoteBatch(
    kind: 'delete' | 'update',
    statements: Array<{ sql: string; parameters: unknown[] }>,
  ): Promise<number> {
    let affectedRows = 0;
    for (const chunk of chunkStatements(statements)) {
      let results;
      try {
        results = await this.connection.batch!(chunk);
      } catch (error: any) {
        throw new Error(
          `Batch ${kind} stopped after ${affectedRows} row(s): ${error?.message ?? String(error)}`,
          { cause: error },
        );
      }
      const stale = results.filter((result) => result.affectedRows !== 1).length;
      affectedRows += results.reduce((total, result) => total + result.affectedRows, 0);
      if (stale) {
        throw new Error(
          `Batch ${kind} stopped after ${affectedRows} row(s): ` +
          `${stale} selected row(s) were stale.`,
        );
      }
    }
    return affectedRows;
  }

  close(): Promise<void> {
    return this.connection.close();
  }

  private primaryKey(object: StudioObject) {
    return object.rowLocators.find((locator) =>
      locator.kind === 'primary-key' || locator.kind === 'unique-index')?.columns ?? [];
  }

  private locatorProjection(object: StudioObject): string[] {
    return object.rowLocators.flatMap((locator) => {
      if (locator.kind === 'sqlite-rowid') {
        return [`${this.quote(locator.source)} AS ${this.quote(locator.columns[0])}`];
      }
      if (locator.kind === 'postgres-ctid') {
        return [
          `CAST(${this.quote('tableoid')} AS bigint) AS ${this.quote(locator.columns[0])}`,
          `CAST(${this.quote('ctid')} AS text) AS ${this.quote(locator.columns[1])}`,
        ];
      }
      return [];
    });
  }

  private systemLocatorOrder(object: StudioObject): string[] {
    const locator = object.rowLocators.find((candidate) =>
      candidate.kind === 'sqlite-rowid' || candidate.kind === 'postgres-ctid');
    if (locator?.kind === 'sqlite-rowid') {
      return [`${this.quote(locator.source)} ASC`];
    }
    if (locator?.kind === 'postgres-ctid') {
      return [
        `${this.quote('tableoid')} ASC`,
        `${this.quote('ctid')} ASC`,
      ];
    }
    return [];
  }

  private browsePredicate(object: StudioObject, filters: BrowseFilter[]) {
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    for (const filter of filters.slice(0, 20)) {
      const column = object.columns.find((candidate) => candidate.name === filter.column);
      if (!column) throw new Error(`Column "${filter.column}" does not exist on "${object.name}".`);
      const identifier = this.quote(column.name);
      if (filter.operator === 'is-null') {
        clauses.push(`${identifier} IS NULL`);
        continue;
      }
      if (filter.operator === 'is-not-null') {
        clauses.push(`${identifier} IS NOT NULL`);
        continue;
      }
      const input = filter.value ?? '';
      if (filter.operator === 'contains' || filter.operator === 'starts-with' ||
          filter.operator === 'ends-with') {
        const escaped = input.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
        const value = filter.operator === 'contains'
          ? `%${escaped}%`
          : filter.operator === 'starts-with' ? `${escaped}%` : `%${escaped}`;
        const escape = this.connection.info.provider === 'mysql'
          ? ` ESCAPE '\\\\'`
          : ` ESCAPE '\\'`;
        clauses.push(`${identifier} LIKE ?${escape}`);
        parameters.push(value);
        continue;
      }
      const operators = {
        eq: this.connection.info.provider === 'postgres' ? 'IS NOT DISTINCT FROM' : '=',
        ne: this.connection.info.provider === 'postgres' ? 'IS DISTINCT FROM' : '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
      } as const;
      clauses.push(`${identifier} ${operators[filter.operator]} ?`);
      parameters.push(this.coerceValue(input, column));
    }
    return {
      sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
      parameters,
    };
  }

  private browseOrder(object: StudioObject, supplied: BrowseSort[]): BrowseSort[] {
    if (supplied.length) {
      return supplied.slice(0, 5).map((sort) => {
        if (!object.columns.some((column) => column.name === sort.column)) {
          throw new Error(`Column "${sort.column}" does not exist on "${object.name}".`);
        }
        return {
          column: sort.column,
          direction: sort.direction === 'desc' ? 'desc' : 'asc',
        };
      });
    }
    return this.primaryKey(object).map((column) => ({ column, direction: 'asc' }));
  }

  private coerceValue(value: string, column: StudioColumn): unknown {
    if (column.declaredKind === 'blob') {
      const trimmed = value.trim();
      if (/^(?:[0-9a-f]{2})+$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed) || trimmed.length % 4 === 1) {
        throw new Error(`Expected ${column.name} to be base64 or an even-length hexadecimal value.`);
      }
      return Buffer.from(trimmed, 'base64');
    }
    if (column.declaredKind === 'boolean') {
      const normalized = value.trim().toLowerCase();
      const postgres = this.connection.info.provider === 'postgres';
      if (normalized === 'true' || normalized === '1') return postgres ? true : 1;
      if (normalized === 'false' || normalized === '0') return postgres ? false : 0;
      throw new Error(`Expected a boolean for ${column.name}.`);
    }
    if (
      column.declaredKind === 'varchar' ||
      column.declaredKind === 'text' ||
      column.declaredKind === 'json' ||
      column.declaredKind === 'date' ||
      column.declaredKind === 'datetime'
    ) {
      return value;
    }
    return coerceCellValue(value, column.affinity);
  }

  private coerceInsertValue(
    value: string,
    valueKind: InsertValueKind,
    column: StudioColumn,
  ): unknown {
    if (valueKind === 'blob') {
      return this.coerceValue(value, { ...column, declaredKind: 'blob' });
    }
    if (valueKind === 'boolean') {
      return this.coerceValue(value, { ...column, declaredKind: 'boolean' });
    }
    if (valueKind === 'number') {
      const normalized = value.trim();
      const number = Number(normalized);
      if (!normalized || !Number.isFinite(number)) {
        throw new Error(`Expected a number for ${column.name}.`);
      }
      return number;
    }
    if (valueKind === 'json') {
      try {
        JSON.parse(value);
      } catch {
        throw new Error(`Expected valid JSON for ${column.name}.`);
      }
      return value;
    }
    if (valueKind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Expected a date in YYYY-MM-DD format for ${column.name}.`);
      }
      return value;
    }
    if (valueKind === 'datetime') {
      if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
        throw new Error(`Expected a date and time for ${column.name}.`);
      }
      return value;
    }
    if (valueKind === 'timestamp') {
      const timestamp = Date.parse(value);
      const isoTimestamp =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
      if (!Number.isFinite(timestamp) || !isoTimestamp.test(value)) {
        throw new Error(`Expected an ISO 8601 timestamp with a timezone for ${column.name}.`);
      }
      return new Date(timestamp).toISOString();
    }
    if (valueKind === 'uuid-v4' || valueKind === 'uuid-v7') {
      const version = valueKind === 'uuid-v4' ? '4' : '7';
      const pattern = new RegExp(
        `^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
        'i',
      );
      if (!pattern.test(value.trim())) {
        throw new Error(`Expected a UUID v${version} for ${column.name}.`);
      }
      return value.trim();
    }
    return value;
  }

  private coerceJsonValue(value: unknown, column: StudioColumn): unknown {
    if (value === null) return null;
    if (column.declaredKind === 'json') {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      try {
        JSON.parse(serialized);
      } catch {
        throw new Error(`Expected valid JSON for ${column.name}.`);
      }
      return serialized;
    }
    if (typeof value === 'string') return this.coerceValue(value, column);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Expected a finite number for ${column.name}.`);
      return column.declaredKind === 'number' ? value : this.coerceValue(String(value), column);
    }
    if (typeof value === 'boolean') return this.coerceValue(String(value), column);
    throw new Error(`Expected a scalar JSON value for ${column.name}.`);
  }

  private renderParameters(sql: string, parameters: unknown[]): string {
    return interpolateSqlParameters(sql, parameters, this.connection.info.provider);
  }

  private async mutableTable(name: string): Promise<StudioObject> {
    const object = await this.findSchemaObject(name);
    if (!object.editable) throw new Error(object.readOnlyReason ?? 'This database object is read-only.');
    return object;
  }

  private keyPredicate(object: StudioObject, supplied: Record<string, unknown>) {
    const locator = object.rowLocators.find((candidate) =>
      candidate.columns.every((name) =>
        Object.prototype.hasOwnProperty.call(supplied, name) &&
        supplied[name] !== null &&
        supplied[name] !== undefined));
    if (!locator) {
      throw new Error('This row has no usable primary key or provider-specific row locator.');
    }
    const parameters = locator.columns.map((name) => this.decodeLocatorValue(supplied[name]));
    if (locator.kind === 'sqlite-rowid') {
      return {
        sql: `${this.quote(locator.source)} = ?`,
        parameters,
      };
    }
    if (locator.kind === 'postgres-ctid') {
      return {
        sql: `${this.quote('tableoid')} = CAST(? AS oid) AND ` +
          `${this.quote('ctid')} = CAST(? AS tid)`,
        parameters,
      };
    }
    return {
      sql: locator.columns.map((column) => `${this.quote(column)} = ?`).join(' AND '),
      parameters,
    };
  }

  private decodeLocatorValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || !('$type' in value)) return value;
    const tagged = value as { $type: string; value: string };
    if (tagged.$type === 'bigint') return BigInt(tagged.value);
    if (tagged.$type === 'blob') return Buffer.from(tagged.value, 'base64');
    return tagged.value;
  }

  private bind(sql: string, parameters: unknown[]): { sql: string; parameters: unknown[] } {
    if (this.connection.info.provider !== 'd1-remote') return { sql, parameters };
    return {
      sql: interpolateSqlParameters(sql, parameters, this.connection.info.provider),
      parameters: [],
    };
  }

  private quote(identifier: string): string {
    return quoteIdentifier(identifier, this.connection.info.provider);
  }
}
