import type { DatabaseValue, QueryResult } from "../adapter/types.js";
import { ConfigurationError, UnsupportedCapabilityError } from "../errors.js";
import type { BaseEntity } from "../entity/base-entity.js";
import type { ColumnMetadata, EntityMetadata } from "../metadata/types.js";
import type { ORM } from "../orm.js";
import { SQLFragment, type SQLNode } from "../sql/fragment.js";
import { compileWhere, ExpressionBuilder } from "./expression.js";
import type { EntityShape, FindWhere, OrderDirection } from "./types.js";

type Predicate<T extends object> =
  | FindWhere<T>
  | readonly FindWhere<T>[]
  | SQLFragment
  | ((expressions: ExpressionBuilder<T>) => SQLFragment);

/** True when a structured predicate has no conditions, so it would match every row. */
function matchesEveryRow(predicate: unknown): boolean {
  if (predicate === undefined || predicate === null) return true;
  if (predicate instanceof SQLFragment) return false;
  if (Array.isArray(predicate)) return predicate.some(matchesEveryRow);
  return typeof predicate === "object" && Object.keys(predicate).length === 0;
}

/** Text for a validated LIMIT/OFFSET value; refuses anything but a safe non-negative integer. */
function integerLiteral(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new ConfigurationError("Pagination requires a non-negative integer.");
  return String(value);
}

interface JoinClause {
  readonly kind: "INNER" | "LEFT";
  readonly table: string;
  readonly alias: string;
  readonly on: SQLFragment;
}

/**
 * Columns a query loads when it does not name its own selection. `select: false`
 * columns are omitted, except primary, version and owned relation join columns,
 * which identity, optimistic locking and relation loading depend on.
 */
export function defaultSelectColumns(metadata: EntityMetadata): readonly ColumnMetadata[] {
  const required = new Set<string>();
  for (const relation of metadata.relations) {
    if (relation.owner && relation.joinColumn && relation.kind !== "many-to-many") required.add(relation.joinColumn);
    if (relation.joinTable) required.add(metadata.columnByProperty.get(relation.joinTable.referencedProperty)?.columnName ?? "");
  }
  return metadata.columns.filter((column) =>
    column.select !== false || column.primary || column.version || required.has(column.columnName));
}

export class SelectQueryBuilder<T extends BaseEntity, Row = T> {
  private selections: SQLFragment[] = [];
  /** Entity properties named by select()/addSelect(); undefined for default or raw selections. */
  private selectedProperties: string[] | undefined;
  private predicate?: SQLFragment;
  private joins: JoinClause[] = [];
  private groups: SQLFragment[] = [];
  private orders: { fragment: SQLFragment; direction: OrderDirection; property?: string }[] = [];
  private limitValue: number | undefined;
  private offsetValue: number | undefined;
  private distinctValue = false;
  private aggregateMode = false;

  constructor(
    protected readonly orm: ORM,
    protected readonly metadata: EntityMetadata,
    protected readonly alias = metadata.tableName,
  ) {}

  select<K extends keyof EntityShape<T> & string>(
    ...properties: readonly K[]
  ): SelectQueryBuilder<T, Pick<EntityShape<T>, K>> {
    this.selections = properties.map((property) => this.expression().column(property));
    this.selectedProperties = [...properties];
    return this as unknown as SelectQueryBuilder<T, Pick<EntityShape<T>, K>>;
  }

  /**
   * Adds properties to the current selection. Without a prior select(), this
   * extends the default columns, so it is the way to load `select: false` columns.
   */
  addSelect(...properties: readonly (keyof EntityShape<T> & string)[]): this {
    if (this.selections.length && !this.selectedProperties) {
      this.selections = [...this.selections, ...properties.map((property) => this.expression().column(property))];
      return this;
    }
    const base = this.selectedProperties ?? defaultSelectColumns(this.metadata).map((column) => column.propertyName);
    const merged = [...new Set([...base, ...properties])];
    this.selections = merged.map((property) => this.expression().column(property as keyof EntityShape<T> & string));
    this.selectedProperties = merged;
    return this;
  }

  selectRaw<R>(fragment: SQLFragment<R>): SelectQueryBuilder<T, R> {
    this.selections = [fragment];
    this.selectedProperties = undefined;
    return this as unknown as SelectQueryBuilder<T, R>;
  }

  distinct(value = true): this { this.distinctValue = value; return this; }

  where(predicate: Predicate<T>): this {
    this.predicate = this.resolvePredicate(predicate);
    return this;
  }

  andWhere(predicate: Predicate<T>): this {
    const part = this.resolvePredicate(predicate);
    this.predicate = this.predicate
      ? this.orm.sql.fragment`(${this.predicate}) AND (${part})`
      : part;
    return this;
  }

  orWhere(predicate: Predicate<T>): this {
    const part = this.resolvePredicate(predicate);
    this.predicate = this.predicate
      ? this.orm.sql.fragment`(${this.predicate}) OR (${part})`
      : part;
    return this;
  }

  innerJoin(table: string, alias: string, on: SQLFragment): this {
    this.joins.push({ kind: "INNER", table, alias, on });
    return this;
  }

  leftJoin(table: string, alias: string, on: SQLFragment): this {
    this.joins.push({ kind: "LEFT", table, alias, on });
    return this;
  }

  groupBy(...properties: readonly (keyof EntityShape<T> & string)[]): this {
    this.groups.push(...properties.map((property) => this.expression().column(property)));
    return this;
  }

  orderBy(property: keyof EntityShape<T> & string | SQLFragment, direction: OrderDirection = "asc"): this {
    if (direction !== "asc" && direction !== "desc") throw new ConfigurationError("orderBy() direction must be asc or desc.");
    this.orders.push({
      ...(typeof property === "string" ? { property } : {}),
      fragment: property instanceof SQLFragment ? property : this.expression().column(property),
      direction,
    });
    return this;
  }

  limit(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0) throw new ConfigurationError("limit() requires a non-negative integer.");
    this.limitValue = value;
    return this;
  }

  offset(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0) throw new ConfigurationError("offset() requires a non-negative integer.");
    this.offsetValue = value;
    return this;
  }

  toSQL(): SQLFragment {
    const sql = this.orm.sql;
    const selections = this.selections.length
      ? sql.join(this.selections)
      : sql.join(defaultSelectColumns(this.metadata).map((column) => sql.id(this.alias, column.columnName)));
    const nodes: SQLNode[] = [
      { kind: "text", value: `SELECT${this.distinctValue ? " DISTINCT" : ""} ` },
      { kind: "fragment", value: selections },
      { kind: "text", value: " FROM " },
      { kind: "identifier", path: [this.metadata.tableName] },
      { kind: "text", value: " AS " },
      { kind: "identifier", path: [this.alias] },
    ];
    for (const join of this.joins) {
      nodes.push(
        { kind: "text", value: ` ${join.kind} JOIN ` },
        { kind: "identifier", path: [join.table] },
        { kind: "text", value: " AS " },
        { kind: "identifier", path: [join.alias] },
        { kind: "text", value: " ON " },
        { kind: "fragment", value: join.on },
      );
    }
    if (this.predicate) nodes.push({ kind: "text", value: " WHERE " }, { kind: "fragment", value: this.predicate });
    if (this.groups.length) nodes.push({ kind: "text", value: " GROUP BY " }, { kind: "fragment", value: sql.join(this.groups) });
    const paginated = this.limitValue !== undefined || this.offsetValue !== undefined;
    const entityRows = !this.selections.length || Boolean(this.metadata.primaryColumns.length && this.selectedProperties
      && this.metadata.primaryColumns.every((primary) => this.selectedProperties!.includes(primary.propertyName)));
    const simple = !this.joins.length && !this.groups.length && !this.distinctValue && entityRows;
    if (paginated && !simple && !this.aggregateMode && !this.orders.length) {
      throw new ConfigurationError("Pagination of joined, grouped, distinct or projected results requires explicit unique ordering.");
    }
    const orders = this.aggregateMode ? [] : [...this.orders];
    if (paginated && simple && !this.aggregateMode) {
      if (!this.metadata.primaryColumns.length) throw new ConfigurationError(`${this.metadata.modelName} pagination requires a primary key or explicit unique ordering.`);
      for (const primary of this.metadata.primaryColumns) {
        if (!orders.some(order => order.property === primary.propertyName)) orders.push({
          fragment: this.expression().column(primary.propertyName as keyof EntityShape<T> & string), direction: "asc", property: primary.propertyName,
        });
      }
    }
    if (orders.length) {
      const orderNodes: SQLNode[] = [];
      orders.forEach((order, index) => {
        if (index) orderNodes.push({ kind: "text", value: ", " });
        orderNodes.push({ kind: "fragment", value: order.fragment }, { kind: "text", value: ` ${order.direction.toUpperCase()}` });
      });
      nodes.push({ kind: "text", value: " ORDER BY " }, { kind: "fragment", value: new SQLFragment(orderNodes) });
    }
    // LIMIT and OFFSET are inlined: limit() and offset() only accept safe
    // non-negative integers. The Node MySQL driver binds JavaScript numbers as DOUBLE, and
    // MySQL 8.0.22+ rejects a DOUBLE LIMIT in a prepared statement.
    if (this.limitValue !== undefined) nodes.push({ kind: "text", value: ` LIMIT ${integerLiteral(this.limitValue)}` });
    if (this.offsetValue !== undefined && this.limitValue === undefined) {
      if (this.orm.driver.dialect === "mysql") nodes.push({ kind: "text", value: " LIMIT 18446744073709551615" });
      else if (this.orm.driver.dialect === "sqlite") nodes.push({ kind: "text", value: " LIMIT -1" });
    }
    if (this.offsetValue !== undefined) nodes.push({ kind: "text", value: ` OFFSET ${integerLiteral(this.offsetValue)}` });
    return new SQLFragment(nodes);
  }

  async getRawMany(): Promise<readonly Row[]> {
    return (await this.orm.executeFragment<Row>(this.toSQL(), "select")).rows;
  }

  async getMany(): Promise<readonly T[]> {
    const rows = await this.getRawMany() as readonly Record<string, unknown>[];
    const entities: T[] = [];
    // Hydrate in order so `@AfterLoad` hooks finish (or throw) before entities are returned.
    for (const row of rows) entities.push(await this.orm.hydrate<T>(this.metadata, row));
    return entities;
  }

  async getOne(): Promise<T | null> {
    this.limit(1);
    return (await this.getMany())[0] ?? null;
  }

  async count(): Promise<number> {
    const previous = this.selections, limit = this.limitValue, offset = this.offsetValue;
    this.selections = [this.orm.sql.fragment`COUNT(*) AS ${this.orm.sql.id("__count")}`];
    this.limitValue = undefined; this.offsetValue = undefined; this.aggregateMode = true;
    try {
      const row = (await this.getRawMany() as readonly Record<string, unknown>[])[0];
      return Number(row?.["__count"] ?? 0);
    } finally { this.selections = previous; this.limitValue = limit; this.offsetValue = offset; this.aggregateMode = false; }
  }

  sum(property: keyof EntityShape<T> & string): Promise<number | null> {
    return this.aggregate("SUM", property);
  }

  average(property: keyof EntityShape<T> & string): Promise<number | null> {
    return this.aggregate("AVG", property);
  }

  minimum(property: keyof EntityShape<T> & string): Promise<number | null> {
    return this.aggregate("MIN", property);
  }

  maximum(property: keyof EntityShape<T> & string): Promise<number | null> {
    return this.aggregate("MAX", property);
  }

  async exists(): Promise<boolean> {
    const previous = { selections: this.selections, limit: this.limitValue, offset: this.offsetValue, aggregate: this.aggregateMode };
    this.selections = [this.orm.sql.fragment`1 AS ${this.orm.sql.id("__exists")}`];
    this.limitValue = 1;
    this.offsetValue = undefined;
    this.aggregateMode = true;
    try { return (await this.getRawMany()).length > 0; }
    finally {
      this.selections = previous.selections;
      this.limitValue = previous.limit;
      this.offsetValue = previous.offset;
      this.aggregateMode = previous.aggregate;
    }
  }

  protected expression(): ExpressionBuilder<T> {
    return new ExpressionBuilder<T>(
      this.metadata,
      this.orm.sql,
      this.alias,
      (column, value) => this.orm.encode(column, value),
    );
  }

  private resolvePredicate(predicate: Predicate<T>): SQLFragment {
    return typeof predicate === "function"
      ? predicate(this.expression())
      : compileWhere(
          this.metadata,
          this.orm.sql,
          predicate,
          this.alias,
          (column, value) => this.orm.encode(column, value),
        );
  }

  private async aggregate(
    fn: "SUM" | "AVG" | "MIN" | "MAX",
    property: keyof EntityShape<T> & string,
  ): Promise<number | null> {
    const previous = this.selections;
    const limit = this.limitValue, offset = this.offsetValue;
    this.limitValue = undefined; this.offsetValue = undefined; this.aggregateMode = true;
    this.selections = [
      this.orm.sql.fragment`${this.orm.sql.unsafe(fn)}(${this.expression().column(property)}) AS ${this.orm.sql.id("__aggregate")}`,
    ];
    try {
      const row = (await this.getRawMany() as readonly Record<string, unknown>[])[0];
      const value = row?.["__aggregate"];
      return value === null || value === undefined ? null : Number(value);
    } finally {
      this.selections = previous; this.limitValue = limit; this.offsetValue = offset; this.aggregateMode = false;
    }
  }
}

export class MutationQueryBuilder<T extends BaseEntity> {
  private returnColumns: string[] = [];

  constructor(
    private readonly orm: ORM,
    private readonly metadata: EntityMetadata,
    private readonly kind: "insert" | "update" | "delete" | "upsert",
    private readonly values?: readonly Partial<EntityShape<T>>[],
    private readonly predicate?: FindWhere<T> | SQLFragment,
    private readonly conflict?: readonly (keyof EntityShape<T> & string)[],
    private readonly options: { readonly all?: boolean } = {},
  ) {}

  returning(...properties: readonly (keyof EntityShape<T> & string)[]): this {
    if (!this.orm.driver.capabilities.returning) {
      throw new UnsupportedCapabilityError("returning", this.orm.driver.dialect);
    }
    this.returnColumns = [...properties];
    return this;
  }

  toSQL(): SQLFragment {
    const sql = this.orm.sql;
    if ((this.kind === "delete" || this.kind === "update") && !this.options.all && matchesEveryRow(this.predicate)) {
      const name = this.metadata.modelName;
      throw new ConfigurationError(this.kind === "delete"
        ? `${name}.delete() requires a where clause with at least one condition. Use ${name}.deleteAll() to delete every row.`
        : `${name}.update() requires a where clause with at least one condition. Use ${name}.updateAll(values) to update every row.`);
    }
    if (this.kind === "delete") {
      const where = this.predicate
        ? compileWhere(this.metadata, sql, this.predicate, undefined, (column, value) => this.orm.encode(column, value))
        : undefined;
      return new SQLFragment([
        { kind: "text", value: "DELETE FROM " },
        { kind: "identifier", path: [this.metadata.tableName] },
        ...(where ? [{ kind: "text", value: " WHERE " } as const, { kind: "fragment", value: where } as const] : []),
        ...this.returningNodes(),
      ]);
    }
    const rows = this.values ?? [];
    if (rows.length === 0) throw new ConfigurationError(`${this.kind} requires at least one value object.`);
    const properties = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const columns = properties.map((property) => {
      const column = this.metadata.columnByProperty.get(property);
      if (!column) throw new ConfigurationError(`Unknown property ${this.metadata.modelName}.${property}.`);
      if (this.kind !== "update" && !column.insert) {
        throw new ConfigurationError(`${this.metadata.modelName}.${property} cannot be inserted: its column is declared with insert: false.`);
      }
      if (this.kind === "update" && !column.update) {
        throw new ConfigurationError(`${this.metadata.modelName}.${property} cannot be updated: its column is declared with update: false.`);
      }
      return column;
    });
    if (columns.length === 0) {
      if (this.kind !== "insert") throw new ConfigurationError(`${this.kind} requires at least one column value.`);
      return this.defaultValuesInsert(rows.length);
    }
    // An upsert inserts every given column but only overwrites updatable ones on conflict.
    const updatable = columns.filter((column) => column.update);
    if (this.kind === "insert" || this.kind === "upsert") {
      const nodes: SQLNode[] = [
        { kind: "text", value: "INSERT INTO " },
        { kind: "identifier", path: [this.metadata.tableName] },
        { kind: "text", value: " (" },
      ];
      columns.forEach((column, index) => {
        if (index) nodes.push({ kind: "text", value: ", " });
        nodes.push({ kind: "identifier", path: [column.columnName] });
      });
      nodes.push({ kind: "text", value: ") VALUES " });
      rows.forEach((row, rowIndex) => {
        if (rowIndex) nodes.push({ kind: "text", value: ", " });
        nodes.push({ kind: "text", value: "(" });
        columns.forEach((column, columnIndex) => {
          if (columnIndex) nodes.push({ kind: "text", value: ", " });
          nodes.push({
            kind: "value",
            value: this.orm.encode(column, (row as Record<string, unknown>)[column.propertyName]) as DatabaseValue,
          });
        });
        nodes.push({ kind: "text", value: ")" });
      });
      if (this.kind === "upsert") {
        const conflicts = this.conflict?.map((property) => this.metadata.columnByProperty.get(property)?.columnName);
        if (!conflicts?.length || conflicts.some((item) => !item)) {
          throw new ConfigurationError("upsert() requires valid conflict columns.");
        }
        if (this.orm.driver.dialect === "mysql") {
          nodes.push({ kind: "text", value: " ON DUPLICATE KEY UPDATE " });
          const assignments = updatable.length ? updatable : [this.metadata.columns.find((column) => column.columnName === conflicts[0])!];
          assignments.forEach((column, index) => {
            if (index) nodes.push({ kind: "text", value: ", " });
            nodes.push(
              { kind: "identifier", path: [column.columnName] },
              { kind: "text", value: " = VALUES(" },
              { kind: "identifier", path: [column.columnName] },
              { kind: "text", value: ")" },
            );
          });
        } else {
          nodes.push({ kind: "text", value: " ON CONFLICT (" });
          conflicts.forEach((column, index) => {
            if (index) nodes.push({ kind: "text", value: ", " });
            nodes.push({ kind: "identifier", path: [column!] });
          });
          const assignments = updatable.filter((column) => !conflicts.includes(column.columnName));
          nodes.push({ kind: "text", value: assignments.length ? ") DO UPDATE SET " : ") DO NOTHING" });
          assignments.forEach((column, index) => {
            if (index) nodes.push({ kind: "text", value: ", " });
            nodes.push(
              { kind: "identifier", path: [column.columnName] },
              { kind: "text", value: " = excluded." },
              { kind: "identifier", path: [column.columnName] },
            );
          });
        }
      }
      nodes.push(...this.returningNodes());
      return new SQLFragment(nodes);
    }
    const row = rows[0] as Record<string, unknown>;
    const nodes: SQLNode[] = [
      { kind: "text", value: "UPDATE " },
      { kind: "identifier", path: [this.metadata.tableName] },
      { kind: "text", value: " SET " },
    ];
    columns.forEach((column, index) => {
      if (index) nodes.push({ kind: "text", value: ", " });
      nodes.push(
        { kind: "identifier", path: [column.columnName] },
        { kind: "text", value: " = " },
        { kind: "value", value: this.orm.encode(column, row[column.propertyName]) as DatabaseValue },
      );
    });
    if (this.predicate) nodes.push(
      { kind: "text", value: " WHERE " },
      {
        kind: "fragment",
        value: compileWhere(
          this.metadata,
          sql,
          this.predicate,
          undefined,
          (column, value) => this.orm.encode(column, value),
        ),
      },
    );
    nodes.push(...this.returningNodes());
    return new SQLFragment(nodes);
  }

  async execute<Row = Record<string, unknown>>(): Promise<QueryResult<Row>> {
    const rows = this.values ?? [];
    if (this.kind === "insert" && rows.length > 1 && this.orm.driver.dialect !== "mysql" &&
      rows.every((row) => Object.keys(row).length === 0)) {
      // SQLite and PostgreSQL insert all-default rows with one DEFAULT VALUES statement each.
      const results: QueryResult<Row>[] = [];
      for (let index = 0; index < rows.length; index++) {
        results.push(await this.orm.executeFragment<Row>(this.defaultValuesInsert(1), "insert"));
      }
      const last = results.at(-1)!;
      return {
        rows: results.flatMap((result) => result.rows),
        meta: { ...last.meta, rowsAffected: results.reduce((sum, result) => sum + (result.meta.rowsAffected ?? 0), 0) },
      };
    }
    return this.orm.executeFragment<Row>(this.toSQL(), this.kind === "upsert" ? "insert" : this.kind);
  }

  /** `INSERT ... DEFAULT VALUES` (SQLite, PostgreSQL) or `INSERT ... () VALUES ()` (MySQL). */
  private defaultValuesInsert(count: number): SQLFragment {
    const nodes: SQLNode[] = [
      { kind: "text", value: "INSERT INTO " },
      { kind: "identifier", path: [this.metadata.tableName] },
    ];
    if (this.orm.driver.dialect === "mysql") {
      nodes.push({ kind: "text", value: ` () VALUES ${Array.from({ length: count }, () => "()").join(", ")}` });
    } else {
      if (count !== 1) {
        throw new ConfigurationError("Inserting several rows without column values needs one statement per row; use execute().");
      }
      nodes.push({ kind: "text", value: " DEFAULT VALUES" });
    }
    nodes.push(...this.returningNodes());
    return new SQLFragment(nodes);
  }

  private returningNodes(): SQLNode[] {
    if (!this.returnColumns.length) return [];
    const nodes: SQLNode[] = [{ kind: "text", value: " RETURNING " }];
    this.returnColumns.forEach((property, index) => {
      const column = this.metadata.columnByProperty.get(property);
      if (!column) throw new ConfigurationError(`Unknown property ${this.metadata.modelName}.${property}.`);
      if (index) nodes.push({ kind: "text", value: ", " });
      nodes.push({ kind: "identifier", path: [column.columnName] }, { kind: "text", value: " AS " }, { kind: "identifier", path: [column.columnName] });
    });
    return nodes;
  }
}
