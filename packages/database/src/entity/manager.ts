import type { QueryResult } from "../adapter/types.js";
import type { BaseEntity } from "./base-entity.js";
import type { EntityMetadata, EntityTarget } from "../metadata/types.js";
import type { ORM } from "../orm.js";
import { matchesEveryRow, MutationQueryBuilder, SelectQueryBuilder } from "../query/builder.js";
import { ConfigurationError } from "../errors.js";
import { SQLFragment } from "../sql/fragment.js";
import { IsNotNull, IsNull, type DeleteOptions, type FindOperator, type EntityShape, type FindOptions, type FindWhere, type OrderDirection, type ReadOptions } from "../query/types.js";

export class ModelManager<T extends BaseEntity> {
  constructor(
    readonly orm: ORM,
    readonly target: EntityTarget<T>,
    readonly metadata: EntityMetadata,
  ) {}

  create(values: Partial<EntityShape<T>> = {}): T {
    const entity = new this.target() as T;
    Object.assign(entity, values);
    this.orm.markNew(entity, this.metadata);
    return entity;
  }

  query(alias?: string): SelectQueryBuilder<T> {
    return new SelectQueryBuilder<T>(this.orm, this.metadata, alias);
  }

  async find(options: FindOptions<T> = {}): Promise<readonly T[]> {
    const builder = this.query();
    if (options.select) builder.select(...options.select);
    if (options.where) builder.where(options.where);
    if (options.withDeleted) builder.withDeleted();
    for (const [property, direction] of Object.entries(options.order ?? {})) {
      if (direction) builder.orderBy(
        property as keyof EntityShape<T> & string,
        direction as OrderDirection,
      );
    }
    if (options.take !== undefined) builder.limit(options.take);
    if (options.skip !== undefined) builder.offset(options.skip);
    const entities = await builder.getMany();
    const relations = options.relations ?? options.with;
    if (relations?.length) await this.orm.loadRelations(entities, this.metadata, relations);
    return entities;
  }

  async findOne(options: FindOptions<T>): Promise<T | null> {
    const values = await this.find({ ...options, take: 1 });
    return values[0] ?? null;
  }

  findBy(where: FindWhere<T>): Promise<readonly T[]> {
    return this.find({ where });
  }

  count(where?: FindWhere<T>, options: ReadOptions = {}): Promise<number> {
    const builder = this.query();
    if (where) builder.where(where);
    if (options.withDeleted) builder.withDeleted();
    return builder.count();
  }

  exists(where?: FindWhere<T>, options: ReadOptions = {}): Promise<boolean> {
    const builder = this.query();
    if (where) builder.where(where);
    if (options.withDeleted) builder.withDeleted();
    return builder.exists();
  }

  insert(values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[]): Promise<QueryResult> {
    return this.insertQuery(values).execute();
  }

  insertQuery(values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[]): MutationQueryBuilder<T> {
    return new MutationQueryBuilder(this.orm, this.metadata, "insert", Array.isArray(values) ? values : [values]);
  }

  upsert(
    values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[],
    conflict: readonly (keyof EntityShape<T> & string)[],
  ): Promise<QueryResult> {
    return new MutationQueryBuilder(
      this.orm,
      this.metadata,
      "upsert",
      Array.isArray(values) ? values : [values],
      undefined,
      conflict,
    ).execute();
  }

  /** Updates the rows matching `where`. An empty `where` is rejected; use updateAll(). */
  update(where: FindWhere<T> | readonly FindWhere<T>[], values: Partial<EntityShape<T>>): Promise<QueryResult> {
    return new MutationQueryBuilder(this.orm, this.metadata, "update", [values], where as FindWhere<T>).execute();
  }

  /**
   * Deletes the rows matching `where`. An empty `where` is rejected; use deleteAll().
   * With a `@DeleteDateColumn` this is a soft delete unless `force` is set.
   */
  async delete(where: FindWhere<T> | readonly FindWhere<T>[], options: DeleteOptions = {}): Promise<QueryResult> {
    if (!options.force && this.deleteDateColumn()) return this.softDelete(where);
    return new MutationQueryBuilder(this.orm, this.metadata, "delete", undefined, where as FindWhere<T>).execute();
  }

  /** Deletes every row in the table. With a `@DeleteDateColumn` this is a soft delete unless `force` is set. */
  async deleteAll(options: DeleteOptions = {}): Promise<QueryResult> {
    if (!options.force) {
      const column = this.deleteDateColumn();
      // Only live rows: an already deleted row keeps the date it was deleted on.
      if (column) {
        return new MutationQueryBuilder(this.orm, this.metadata, "update",
          [{ [column.propertyName]: new Date() } as Partial<EntityShape<T>>],
          { [column.propertyName]: IsNull() } as FindWhere<T>).execute();
      }
    }
    return new MutationQueryBuilder(this.orm, this.metadata, "delete", undefined, undefined, undefined, { all: true }).execute();
  }

  /** Stamps the `@DeleteDateColumn` of the live rows matching `where`. */
  async softDelete(where: FindWhere<T> | readonly FindWhere<T>[]): Promise<QueryResult> {
    const column = this.requireDeleteDateColumn("softDelete");
    return new MutationQueryBuilder(
      this.orm, this.metadata, "update",
      [{ [column.propertyName]: new Date() } as Partial<EntityShape<T>>],
      this.onlyDeleted(where, false) as FindWhere<T>,
    ).execute();
  }

  /** Clears the `@DeleteDateColumn` of the soft-deleted rows matching `where`. */
  async restore(where: FindWhere<T> | readonly FindWhere<T>[]): Promise<QueryResult> {
    const column = this.requireDeleteDateColumn("restore");
    return new MutationQueryBuilder(
      this.orm, this.metadata, "update",
      [{ [column.propertyName]: null } as Partial<EntityShape<T>>],
      this.onlyDeleted(where, true) as FindWhere<T>,
    ).execute();
  }

  deleteDateColumn() {
    return this.metadata.columns.find((column) => column.deleteDate);
  }

  private requireDeleteDateColumn(operation: string) {
    const column = this.deleteDateColumn();
    if (!column) throw new ConfigurationError(`${this.metadata.modelName}.${operation}() requires a @DeleteDateColumn().`);
    return column;
  }

  /** Narrows `where` to rows whose delete date is set (`deleted`) or clear (`!deleted`). */
  private onlyDeleted(
    where: FindWhere<T> | readonly FindWhere<T>[] | SQLFragment,
    deleted: boolean,
  ): FindWhere<T> | readonly FindWhere<T>[] | SQLFragment {
    const operation = deleted ? "restore" : "softDelete";
    const column = this.requireDeleteDateColumn(operation);
    if (matchesEveryRow(where)) {
      throw new ConfigurationError(`${this.metadata.modelName}.${operation}() with an empty where would affect every row; name the rows to ${operation}.`);
    }
    if (where instanceof SQLFragment) {
      const id = this.orm.sql.id(column.columnName);
      return this.orm.sql.fragment`(${where}) AND ${deleted ? this.orm.sql.fragment`${id} IS NOT NULL` : this.orm.sql.fragment`${id} IS NULL`}`;
    }
    const guard = { [column.propertyName]: deleted ? IsNotNull() : IsNull() } as FindWhere<T>;
    // The guard is ANDed with the caller's own condition on the delete-date column, never put in
    // its place. SQL comparisons are false for NULL, so a condition there either implies the guard
    // (restore: any comparison means "set") or contradicts it (softDelete: only live rows have
    // NULL), and a contradiction is refused rather than turned into "every live row".
    const narrow = (part: FindWhere<T>): FindWhere<T> => {
      const key = column.propertyName as keyof FindWhere<T>;
      if (!Object.hasOwn(part, key)) return { ...part, ...guard };
      const condition = part[key] as unknown;
      const isNull = condition === null || (isFindOperator(condition) && condition.operator === "is-null");
      if (deleted ? !isNull : isNull) return deleted ? part : { ...part, ...guard };
      throw new ConfigurationError(deleted
        ? `${this.metadata.modelName}.restore() with ${column.propertyName} IS NULL matches no deleted row.`
        : `${this.metadata.modelName}.${operation}() of rows by their ${column.propertyName} matches no live row; pass { force: true } to delete soft-deleted rows for real.`);
    };
    return Array.isArray(where)
      ? (where as readonly FindWhere<T>[]).map(narrow)
      : narrow(where as FindWhere<T>);
  }

  /** Updates every row in the table. */
  updateAll(values: Partial<EntityShape<T>>): Promise<QueryResult> {
    return new MutationQueryBuilder(this.orm, this.metadata, "update", [values], undefined, undefined, { all: true }).execute();
  }
}

function isFindOperator(value: unknown): value is FindOperator<unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date) && typeof (value as { operator?: unknown }).operator === "string";
}
