import { coerceCellValue, parseSingleStatement, quoteIdentifier, sqliteLiteral } from './sql.js';
import { findObject, introspectSchema } from './schema.js';
import { normalizeQueryResult } from './transport.js';
import type {
  InsertCell,
  MutationResult,
  StudioConnection,
  StudioObject,
  StudioSchema,
  TransportQueryResult,
} from './types.js';

export class StudioDatabase {
  private schema?: StudioSchema;

  constructor(readonly connection: StudioConnection) {}

  async getSchema(refresh = false): Promise<StudioSchema> {
    if (!this.schema || refresh) this.schema = await introspectSchema(this.connection);
    return this.schema;
  }

  async browse(name: string, page = 1, pageSize = 100): Promise<TransportQueryResult> {
    const object = findObject(await this.getSchema(true), name);
    const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)));
    const countResult = await this.connection.execute(
      `SELECT COUNT(*) AS ${quoteIdentifier('__cossack_total')} FROM ${quoteIdentifier(object.name)}`,
    );
    const rawTotal = countResult.rows[0]?.__cossack_total;
    const totalRows = typeof rawTotal === 'bigint'
      ? Number(rawTotal)
      : Math.max(0, Number(rawTotal ?? 0));
    const lastPage = Math.max(1, Math.ceil(totalRows / safePageSize));
    const safePage = Math.min(lastPage, Math.max(1, Math.floor(page)));
    const order = this.primaryKey(object);
    const sql = `SELECT * FROM ${quoteIdentifier(object.name)}` +
      (order.length ? ` ORDER BY ${order.map(quoteIdentifier).join(', ')}` : '') +
      ` LIMIT ${safePageSize} OFFSET ${(safePage - 1) * safePageSize}`;
    return {
      ...normalizeQueryResult(await this.connection.execute(sql)),
      totalRows,
      page: safePage,
      pageSize: safePageSize,
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
      sql = `INSERT INTO ${quoteIdentifier(object.name)} DEFAULT VALUES`;
    } else {
      const values = columns.map((column) => {
        const cell = cells[column.name];
        if (!cell || cell.mode === 'omit') throw new Error(`Missing value for ${column.name}.`);
        if (cell.mode === 'null') {
          if (!column.nullable) throw new Error(`${column.name} does not allow NULL.`);
          return null;
        }
        if (column.affinity === 'blob') {
          throw new Error(`Blob column ${column.name} cannot be edited in the grid.`);
        }
        return coerceCellValue(cell.value, column.affinity);
      });
      sql = `INSERT INTO ${quoteIdentifier(object.name)} (` +
        `${columns.map((column) => quoteIdentifier(column.name)).join(', ')}) VALUES (` +
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
    if (column.primaryKeyPosition > 0) throw new Error('Primary-key cells are read-only.');
    if (column.affinity === 'blob') throw new Error('Blob cells are read-only.');
    const nextValue = value.mode === 'null'
      ? null
      : coerceCellValue(value.value, column.affinity);
    if (nextValue === null && !column.nullable) throw new Error(`${column.name} does not allow NULL.`);
    const where = this.keyPredicate(object, key);
    let sql = `UPDATE ${quoteIdentifier(object.name)} SET ${quoteIdentifier(column.name)} = ? ` +
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
    let sql = `DELETE FROM ${quoteIdentifier(object.name)} WHERE ${where.sql}`;
    let parameters = where.parameters;
    ({ sql, parameters } = this.bind(sql, parameters));
    const result = await this.connection.execute(sql, parameters);
    if (result.affectedRows !== 1) {
      throw new Error(`Stale delete: expected one affected row, received ${result.affectedRows}.`);
    }
    return { affectedRows: result.affectedRows, schema: await this.getSchema(true) };
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
      sql: columns.map((column) => `${quoteIdentifier(column.name)} IS ?`).join(' AND '),
      parameters,
    };
  }

  private bind(sql: string, parameters: unknown[]): { sql: string; parameters: unknown[] } {
    if (!this.connection.info.remote) return { sql, parameters };
    let index = 0;
    const rendered = sql.replaceAll('?', () => {
      if (index >= parameters.length) throw new Error('Missing SQL parameter.');
      return sqliteLiteral(parameters[index++]);
    });
    if (index !== parameters.length) throw new Error('Too many SQL parameters.');
    return { sql: rendered, parameters: [] };
  }
}
