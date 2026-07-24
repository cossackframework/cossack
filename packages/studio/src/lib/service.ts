import {
  coerceCellValue,
  interpolateSqlParameters,
  parseSingleStatement,
  quoteIdentifier,
} from './sql.js';
import { findObject, introspectSchema } from './schema.js';
import { normalizeQueryResult } from './transport.js';
import type {
  BrowseFilter,
  BrowseOptions,
  BrowseSort,
  InsertCell,
  MutationResult,
  StudioColumn,
  StudioConnection,
  StudioObject,
  StudioSchema,
  TransportQueryResult,
} from './types.js';

export class StudioDatabase {
  private schema?: StudioSchema;

  constructor(
    readonly connection: StudioConnection,
    private readonly options: { applicationName?: string } = {},
  ) {}

  async getSchema(refresh = false): Promise<StudioSchema> {
    if (!this.schema || refresh) {
      this.schema = await introspectSchema(
        this.connection,
        this.options.applicationName ?? 'Cossack application',
      );
    }
    return this.schema;
  }

  async browse(
    name: string,
    optionsOrPage: BrowseOptions | number = {},
    legacyPageSize = 100,
  ): Promise<TransportQueryResult> {
    const object = findObject(await this.getSchema(true), name);
    const options = typeof optionsOrPage === 'number'
      ? { page: optionsOrPage, pageSize: legacyPageSize }
      : optionsOrPage;
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 100;
    const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)));
    const predicate = this.browsePredicate(object, options.filters ?? []);
    let countSql = `SELECT COUNT(*) AS ${this.quote('__cossack_total')} ` +
      `FROM ${this.quote(object.name)}${predicate.sql}`;
    let countParameters = [...predicate.parameters];
    ({ sql: countSql, parameters: countParameters } = this.bind(countSql, countParameters));
    const countResult = await this.connection.execute(countSql, countParameters);
    const rawTotal = countResult.rows[0]?.__cossack_total;
    const totalRows = typeof rawTotal === 'bigint'
      ? Number(rawTotal)
      : Math.max(0, Number(rawTotal ?? 0));
    const lastPage = Math.max(1, Math.ceil(totalRows / safePageSize));
    const safePage = Math.min(lastPage, Math.max(1, Math.floor(page)));
    const order = this.browseOrder(object, options.sort ?? []);
    let sql = `SELECT * FROM ${this.quote(object.name)}${predicate.sql}` +
      (order.length
        ? ` ORDER BY ${order.map((item) =>
            `${this.quote(item.column)} ${item.direction.toUpperCase()}`).join(', ')}`
        : '') +
      ` LIMIT ${safePageSize} OFFSET ${(safePage - 1) * safePageSize}`;
    const displayQuery = this.renderParameters(sql, predicate.parameters);
    let parameters = [...predicate.parameters];
    ({ sql, parameters } = this.bind(sql, parameters));
    const normalized = normalizeQueryResult(await this.connection.execute(sql, parameters));
    return {
      ...normalized,
      columns: normalized.columns.length
        ? normalized.columns
        : object.columns.filter((column) => !column.hidden).map((column) => column.name),
      totalRows,
      page: safePage,
      pageSize: safePageSize,
      objectName: object.name,
      query: displayQuery,
    };
  }

  async executeSql(input: string): Promise<TransportQueryResult> {
    const statement = parseSingleStatement(input);
    try {
      const result = normalizeQueryResult(await this.connection.execute(statement));
      await this.getSchema(true);
      return result;
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
        return this.coerceValue(cell.value, column);
      });
      sql = `INSERT INTO ${this.quote(object.name)} (` +
        `${columns.map((column) => this.quote(column.name)).join(', ')}) VALUES (` +
        `${values.map(() => '?').join(', ')})`;
      ({ sql, parameters } = this.bind(sql, values));
    }
    const result = await this.connection.execute(sql, parameters);
    return { affectedRows: result.affectedRows, schema: await this.getSchema(true) };
  }

  async update(
    tableName: string,
    key: Record<string, unknown>,
    columnName: string,
    value: { mode: 'null' } | { mode: 'value'; value: string },
  ): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    const column = object.columns.find((candidate) => candidate.name === columnName);
    if (!column) throw new Error(`Column "${columnName}" does not exist on "${tableName}".`);
    const nextValue = value.mode === 'null'
      ? null
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
    return { affectedRows: result.affectedRows, schema: await this.getSchema(true) };
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
    return { affectedRows: result.affectedRows, schema: await this.getSchema(true) };
  }

  async deleteMany(
    tableName: string,
    keys: Array<Record<string, unknown>>,
  ): Promise<MutationResult> {
    const object = await this.mutableTable(tableName);
    if (!keys.length) throw new Error('Select at least one row.');
    let affectedRows = 0;
    for (const key of keys.slice(0, 1_000)) {
      const where = this.keyPredicate(object, key);
      let sql = `DELETE FROM ${this.quote(object.name)} WHERE ${where.sql}`;
      let parameters = where.parameters;
      ({ sql, parameters } = this.bind(sql, parameters));
      const result = await this.connection.execute(sql, parameters);
      if (result.affectedRows !== 1) {
        throw new Error(
          `Batch delete stopped after ${affectedRows} row(s): a selected row was stale.`,
        );
      }
      affectedRows += result.affectedRows;
    }
    return { affectedRows, schema: await this.getSchema(true) };
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
    let affectedRows = 0;
    for (const key of keys.slice(0, 1_000)) {
      const where = this.keyPredicate(object, key);
      let sql = `UPDATE ${this.quote(object.name)} SET ${this.quote(column.name)} = ? ` +
        `WHERE ${where.sql}`;
      let parameters: unknown[] = [nextValue, ...where.parameters];
      ({ sql, parameters } = this.bind(sql, parameters));
      const result = await this.connection.execute(sql, parameters);
      if (result.affectedRows !== 1) {
        throw new Error(
          `Batch update stopped after ${affectedRows} row(s): a selected row was stale.`,
        );
      }
      affectedRows += result.affectedRows;
    }
    return { affectedRows, schema: await this.getSchema(true) };
  }

  close(): Promise<void> {
    return this.connection.close();
  }

  private primaryKey(object: StudioObject) {
    return object.columns
      .filter((column) => column.primaryKeyPosition > 0)
      .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
      .map((column) => column.name);
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

  private renderParameters(sql: string, parameters: unknown[]): string {
    return interpolateSqlParameters(sql, parameters, this.connection.info.provider);
  }

  private async mutableTable(name: string): Promise<StudioObject> {
    const object = findObject(await this.getSchema(true), name);
    if (!object.editable) throw new Error(object.readOnlyReason ?? 'This database object is read-only.');
    return object;
  }

  private keyPredicate(object: StudioObject, supplied: Record<string, unknown>) {
    const columns = object.columns
      .filter((column) => column.primaryKeyPosition > 0)
      .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
    if (!columns.length) throw new Error('A declared primary key is required.');
    const parameters = columns.map((column) => {
      const name = column.name;
      if (!Object.prototype.hasOwnProperty.call(supplied, name)) {
        throw new Error(`Primary-key value "${name}" is required.`);
      }
      const value = supplied[name];
      if (!value || typeof value !== 'object' || !('$type' in value)) return value;
      const tagged = value as { $type: string; value: string };
      if (tagged.$type === 'bigint') return BigInt(tagged.value);
      if (tagged.$type === 'blob') return Buffer.from(tagged.value, 'base64');
      return tagged.value;
    });
    return {
      sql: columns.map((column) => `${this.quote(column.name)} = ?`).join(' AND '),
      parameters,
    };
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
