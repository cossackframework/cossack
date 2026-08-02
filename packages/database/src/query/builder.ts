import type { DatabaseValue, QueryResult } from "../adapter/types.js";
import { ConfigurationError, UnsupportedCapabilityError } from "../errors.js";
import type { BaseEntity } from "../entity/base-entity.js";
import type { EntityMetadata } from "../metadata/types.js";
import type { ORM } from "../orm.js";
import { SQLFragment, type SQLNode } from "../sql/fragment.js";
import { compileWhere, ExpressionBuilder } from "./expression.js";
import type { EntityShape, FindWhere, OrderDirection } from "./types.js";

type Predicate<T extends object> =
  | FindWhere<T>
  | readonly FindWhere<T>[]
  | SQLFragment
  | ((expressions: ExpressionBuilder<T>) => SQLFragment);

interface JoinClause {
  readonly kind: "INNER" | "LEFT";
  readonly table: string;
  readonly alias: string;
  readonly on: SQLFragment;
}

export class SelectQueryBuilder<T extends BaseEntity, Row = T> {
  private selections: SQLFragment[] = [];
  private predicate?: SQLFragment;
  private joins: JoinClause[] = [];
  private groups: SQLFragment[] = [];
  private orders: { fragment: SQLFragment; direction: OrderDirection }[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private distinctValue = false;

  constructor(
    protected readonly orm: ORM,
    protected readonly metadata: EntityMetadata,
    protected readonly alias = metadata.tableName,
  ) {}

  select<K extends keyof EntityShape<T> & string>(
    ...properties: readonly K[]
  ): SelectQueryBuilder<T, Pick<EntityShape<T>, K>> {
    this.selections = properties.map((property) => this.expression().column(property));
    return this as unknown as SelectQueryBuilder<T, Pick<EntityShape<T>, K>>;
  }

  selectRaw<R>(fragment: SQLFragment<R>): SelectQueryBuilder<T, R> {
    this.selections = [fragment];
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
    this.orders.push({
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
      : sql.fragment`${sql.id(this.alias)}.*`;
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
    if (this.orders.length) {
      const orderNodes: SQLNode[] = [];
      this.orders.forEach((order, index) => {
        if (index) orderNodes.push({ kind: "text", value: ", " });
        orderNodes.push({ kind: "fragment", value: order.fragment }, { kind: "text", value: ` ${order.direction.toUpperCase()}` });
      });
      nodes.push({ kind: "text", value: " ORDER BY " }, { kind: "fragment", value: new SQLFragment(orderNodes) });
    }
    if (this.limitValue !== undefined) nodes.push({ kind: "text", value: " LIMIT " }, { kind: "value", value: this.limitValue });
    if (this.offsetValue !== undefined) nodes.push({ kind: "text", value: " OFFSET " }, { kind: "value", value: this.offsetValue });
    return new SQLFragment(nodes);
  }

  async getRawMany(): Promise<readonly Row[]> {
    return (await this.orm.executeFragment<Row>(this.toSQL(), "select")).rows;
  }

  async getMany(): Promise<readonly T[]> {
    const rows = await this.getRawMany() as readonly Record<string, unknown>[];
    return rows.map((row) => this.orm.hydrate<T>(this.metadata, row));
  }

  async getOne(): Promise<T | null> {
    this.limit(1);
    return (await this.getMany())[0] ?? null;
  }

  async count(): Promise<number> {
    const previous = this.selections;
    this.selections = [this.orm.sql.fragment`COUNT(*) AS ${this.orm.sql.id("__count")}`];
    const row = (await this.getRawMany() as readonly Record<string, unknown>[])[0];
    this.selections = previous;
    return Number(row?.["__count"] ?? 0);
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
    const previous = this.selections;
    this.selections = [this.orm.sql.fragment`1 AS ${this.orm.sql.id("__exists")}`];
    this.limit(1);
    const exists = (await this.getRawMany()).length > 0;
    this.selections = previous;
    return exists;
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
    this.selections = [
      this.orm.sql.fragment`${this.orm.sql.unsafe(fn)}(${this.expression().column(property)}) AS ${this.orm.sql.id("__aggregate")}`,
    ];
    try {
      const row = (await this.getRawMany() as readonly Record<string, unknown>[])[0];
      const value = row?.["__aggregate"];
      return value === null || value === undefined ? null : Number(value);
    } finally {
      this.selections = previous;
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
      return column;
    });
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
          columns.forEach((column, index) => {
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
          nodes.push({ kind: "text", value: ") DO UPDATE SET " });
          columns.filter((column) => !conflicts.includes(column.columnName)).forEach((column, index) => {
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

  execute<Row = Record<string, unknown>>(): Promise<QueryResult<Row>> {
    return this.orm.executeFragment<Row>(this.toSQL(), this.kind === "upsert" ? "insert" : this.kind);
  }

  private returningNodes(): SQLNode[] {
    if (!this.returnColumns.length) return [];
    const nodes: SQLNode[] = [{ kind: "text", value: " RETURNING " }];
    this.returnColumns.forEach((property, index) => {
      const column = this.metadata.columnByProperty.get(property);
      if (!column) throw new ConfigurationError(`Unknown property ${this.metadata.modelName}.${property}.`);
      if (index) nodes.push({ kind: "text", value: ", " });
      nodes.push({ kind: "identifier", path: [column.columnName] });
    });
    return nodes;
  }
}
