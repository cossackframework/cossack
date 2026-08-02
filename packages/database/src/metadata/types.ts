import type { BaseEntity } from "../entity/base-entity.js";
import type {
  ColumnSchema,
  EntitySchema,
  IndexSchema,
  LogicalType,
  RelationKind,
  RelationSchema,
} from "../schema/types.js";

export type EntityTarget<T extends object = BaseEntity> = new (...args: never[]) => T;

/**
 * Prevents legacy decorator metadata from eagerly evaluating a related class
 * in circular ESM model graphs while preserving the property's TypeScript type.
 */
export type Relation<T> = T;

export interface EntityOptions {
  readonly name?: string;
  readonly tableName?: string;
  readonly renamedFrom?: string;
  readonly virtual?: boolean;
}

export interface ColumnOptions {
  readonly name?: string;
  readonly type?: LogicalType;
  readonly nullable?: boolean;
  readonly primary?: boolean;
  readonly generated?: false | "increment" | "identity" | "uuid";
  readonly unique?: boolean;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly default?: unknown;
  readonly enum?: readonly string[] | Readonly<Record<string, string | number>>;
  readonly array?: boolean;
  readonly renamedFrom?: string;
  readonly insert?: boolean;
  readonly update?: boolean;
  readonly select?: boolean;
}

export interface RelationOptions {
  readonly nullable?: boolean;
  readonly cascade?: boolean | readonly ("insert" | "update")[];
  readonly createForeignKeyConstraints?: boolean;
  readonly onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
}

export interface JoinColumnOptions {
  readonly name?: string;
  readonly referencedColumnName?: string;
}

export interface JoinTableOptions {
  readonly name?: string;
  readonly joinColumn?: { readonly name?: string; readonly referencedColumnName?: string };
  readonly inverseJoinColumn?: { readonly name?: string; readonly referencedColumnName?: string };
}

export interface IndexOptions {
  readonly name?: string;
  readonly unique?: boolean;
}

export type LifecycleEvent =
  | "before-insert"
  | "after-insert"
  | "before-update"
  | "after-update"
  | "before-remove"
  | "after-remove"
  | "after-load";

export interface ColumnMetadata extends ColumnSchema {
  readonly reflectedType?: unknown;
}

export interface RelationMetadata extends RelationSchema {
  readonly target: EntityTarget;
}

export interface EntityMetadata extends Omit<EntitySchema, "columns" | "relations" | "indexes"> {
  readonly target: EntityTarget;
  readonly columns: readonly ColumnMetadata[];
  readonly relations: readonly RelationMetadata[];
  readonly indexes: readonly IndexSchema[];
  readonly primaryColumns: readonly ColumnMetadata[];
  readonly hooks: ReadonlyMap<LifecycleEvent, readonly string[]>;
  readonly columnByProperty: ReadonlyMap<string, ColumnMetadata>;
}

export interface DraftRelation {
  readonly propertyName: string;
  readonly kind: RelationKind;
  readonly target: () => EntityTarget;
  readonly inverse?: (object: object) => unknown;
  readonly options: RelationOptions;
  joinColumn?: JoinColumnOptions;
  joinTable?: JoinTableOptions;
}
