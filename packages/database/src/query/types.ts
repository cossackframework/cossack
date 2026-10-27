import type { BaseEntity } from "../entity/base-entity.js";
import type { SQLFragment } from "../sql/fragment.js";

export type EntityShape<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: T[K];
};

export type FindWhere<T> = {
  [K in keyof EntityShape<T>]?: EntityShape<T>[K] | FindOperator<EntityShape<T>[K]>;
};

export interface FindOperator<T = unknown> {
  readonly operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "not-in" | "is-null" | "is-not-null";
  readonly value?: T | readonly T[];
}

export type OrderDirection = "asc" | "desc";

export interface FindOptions<T extends BaseEntity> {
  readonly where?: FindWhere<T> | readonly FindWhere<T>[] | SQLFragment;
  readonly select?: readonly (keyof EntityShape<T> & string)[];
  readonly order?: Partial<Record<keyof EntityShape<T> & string, OrderDirection>>;
  readonly take?: number;
  readonly skip?: number;
  readonly relations?: readonly (keyof EntityShape<T> & string)[];
  readonly with?: readonly (keyof EntityShape<T> & string)[];
  /** Include soft-deleted rows (entities with a `@DeleteDateColumn`). */
  readonly withDeleted?: boolean;
}

/** Options for reads that take a `where` instead of `FindOptions` (count, exists). */
export interface ReadOptions {
  /** Include soft-deleted rows (entities with a `@DeleteDateColumn`). */
  readonly withDeleted?: boolean;
}

/** Options for `delete()`/`deleteAll()` on an entity with a `@DeleteDateColumn`. */
export interface DeleteOptions {
  /** Delete the rows for real instead of stamping the delete-date column. */
  readonly force?: boolean;
}

export const Equal = <T>(value: T): FindOperator<T> => ({ operator: "eq", value });
export const Not = <T>(value: T): FindOperator<T> => ({ operator: "ne", value });
export const MoreThan = <T>(value: T): FindOperator<T> => ({ operator: "gt", value });
export const MoreThanOrEqual = <T>(value: T): FindOperator<T> => ({ operator: "gte", value });
export const LessThan = <T>(value: T): FindOperator<T> => ({ operator: "lt", value });
export const LessThanOrEqual = <T>(value: T): FindOperator<T> => ({ operator: "lte", value });
export const Like = (value: string): FindOperator<string> => ({ operator: "like", value });
export const In = <T>(value: readonly T[]): FindOperator<T> => ({ operator: "in", value });
export const NotIn = <T>(value: readonly T[]): FindOperator<T> => ({ operator: "not-in", value });
/** Matches NULL. Typed loosely so it fits any nullable column (`Date | string | null`, …). */
export const IsNull = (): FindOperator<any> => ({ operator: "is-null" });
/** Matches any non-NULL value. */
export const IsNotNull = (): FindOperator<any> => ({ operator: "is-not-null" });
