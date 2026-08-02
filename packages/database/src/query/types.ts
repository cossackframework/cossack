import type { BaseEntity } from "../entity/base-entity.js";
import type { SQLFragment } from "../sql/fragment.js";

export type EntityShape<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: T[K];
};

export type FindWhere<T> = {
  [K in keyof EntityShape<T>]?: EntityShape<T>[K] | FindOperator<EntityShape<T>[K]>;
};

export interface FindOperator<T = unknown> {
  readonly operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "not-in" | "is-null";
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
export const IsNull = (): FindOperator => ({ operator: "is-null" });
