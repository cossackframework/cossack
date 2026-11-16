import { ScopeError } from "../errors.js";
import type { EntityTarget } from "../metadata/types.js";
import { currentORM } from "../scope.js";
import type { SelectQueryBuilder } from "../query/builder.js";
import type { DeleteOptions, EntityShape, FindOptions, FindWhere, ReadOptions } from "../query/types.js";
import type { QueryResult } from "../adapter/types.js";

function manager<T extends BaseEntity>(target: EntityTarget<T>) {
  const orm = currentORM();
  if (!orm) {
    throw new ScopeError(
      `${target.name} was used outside an ORM.run() scope. ` +
      "Wrap each request or job in orm.run(() => ...); transaction scopes are bound automatically.",
    );
  }
  return orm.model(target);
}

export abstract class BaseEntity {
  static create<T extends BaseEntity>(
    this: EntityTarget<T>,
    values: Partial<EntityShape<T>> = {},
  ): T {
    return manager(this).create(values);
  }

  static find<T extends BaseEntity>(
    this: EntityTarget<T>,
    options: FindOptions<T> = {},
  ): Promise<readonly T[]> {
    return manager(this).find(options);
  }

  static findOne<T extends BaseEntity>(
    this: EntityTarget<T>,
    options: FindOptions<T>,
  ): Promise<T | null> {
    return manager(this).findOne(options);
  }

  static findBy<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T>,
  ): Promise<readonly T[]> {
    return manager(this).findBy(where);
  }

  static count<T extends BaseEntity>(
    this: EntityTarget<T>,
    where?: FindWhere<T>,
    options?: ReadOptions,
  ): Promise<number> {
    return manager(this).count(where, options);
  }

  static exists<T extends BaseEntity>(
    this: EntityTarget<T>,
    where?: FindWhere<T>,
    options?: ReadOptions,
  ): Promise<boolean> {
    return manager(this).exists(where, options);
  }

  static insert<T extends BaseEntity>(
    this: EntityTarget<T>,
    values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[],
  ): Promise<QueryResult> {
    return manager(this).insert(values);
  }

  static upsert<T extends BaseEntity>(
    this: EntityTarget<T>,
    values: Partial<EntityShape<T>> | readonly Partial<EntityShape<T>>[],
    conflict: readonly (keyof EntityShape<T> & string)[],
  ): Promise<QueryResult> {
    return manager(this).upsert(values, conflict);
  }

  /** Updates rows matching `where`; an empty `where` throws. Use updateAll() for every row. */
  static update<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T> | readonly FindWhere<T>[],
    values: Partial<EntityShape<T>>,
  ): Promise<QueryResult> {
    return manager(this).update(where, values);
  }

  /** Updates every row in the table. */
  static updateAll<T extends BaseEntity>(
    this: EntityTarget<T>,
    values: Partial<EntityShape<T>>,
  ): Promise<QueryResult> {
    return manager(this).updateAll(values);
  }

  /**
   * Deletes rows matching `where`; an empty `where` throws. Use deleteAll() for every row.
   * With a `@DeleteDateColumn` this stamps the column instead; `{ force: true }` deletes for real.
   */
  static delete<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T> | readonly FindWhere<T>[],
    options?: DeleteOptions,
  ): Promise<QueryResult> {
    return manager(this).delete(where, options);
  }

  /** Deletes every row in the table. With a `@DeleteDateColumn` this is a soft delete unless `force` is set. */
  static deleteAll<T extends BaseEntity>(this: EntityTarget<T>, options?: DeleteOptions): Promise<QueryResult> {
    return manager(this).deleteAll(options);
  }

  /** Soft-deletes the live rows matching `where`. Requires a `@DeleteDateColumn`. */
  static softDelete<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T> | readonly FindWhere<T>[],
  ): Promise<QueryResult> {
    return manager(this).softDelete(where);
  }

  /** Restores the soft-deleted rows matching `where`. Requires a `@DeleteDateColumn`. */
  static restore<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T> | readonly FindWhere<T>[],
  ): Promise<QueryResult> {
    return manager(this).restore(where);
  }

  static query<T extends BaseEntity>(this: EntityTarget<T>, alias?: string): SelectQueryBuilder<T> {
    return manager(this).query(alias);
  }

  async save(): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.save() requires an active ORM.run() scope.");
    return orm.save(this);
  }

  /** Removes this row. With a `@DeleteDateColumn` it is soft-deleted unless `{ force: true }`. */
  async remove(options?: DeleteOptions): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.remove() requires an active ORM.run() scope.");
    return orm.remove(this, options);
  }

  /** Clears this row's `@DeleteDateColumn`. */
  async restore(): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.restore() requires an active ORM.run() scope.");
    return orm.restore(this);
  }

  async reload(): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.reload() requires an active ORM.run() scope.");
    return orm.reload(this);
  }
}
