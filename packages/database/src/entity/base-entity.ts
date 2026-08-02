import { ScopeError } from "../errors.js";
import type { EntityTarget } from "../metadata/types.js";
import { currentORM } from "../scope.js";
import type { SelectQueryBuilder } from "../query/builder.js";
import type { EntityShape, FindOptions, FindWhere } from "../query/types.js";
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
  ): Promise<number> {
    return manager(this).count(where);
  }

  static exists<T extends BaseEntity>(
    this: EntityTarget<T>,
    where?: FindWhere<T>,
  ): Promise<boolean> {
    return manager(this).exists(where);
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

  static update<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T>,
    values: Partial<EntityShape<T>>,
  ): Promise<QueryResult> {
    return manager(this).update(where, values);
  }

  static delete<T extends BaseEntity>(
    this: EntityTarget<T>,
    where: FindWhere<T>,
  ): Promise<QueryResult> {
    return manager(this).delete(where);
  }

  static query<T extends BaseEntity>(this: EntityTarget<T>, alias?: string): SelectQueryBuilder<T> {
    return manager(this).query(alias);
  }

  async save(): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.save() requires an active ORM.run() scope.");
    return orm.save(this);
  }

  async remove(): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.remove() requires an active ORM.run() scope.");
    return orm.remove(this);
  }

  async reload(): Promise<this> {
    const orm = currentORM();
    if (!orm) throw new ScopeError("entity.reload() requires an active ORM.run() scope.");
    return orm.reload(this);
  }
}
