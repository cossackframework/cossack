export const ORM_SCHEMA_VERSION = 1 as const;

export type LogicalType =
  | "varchar"
  | "text"
  | "integer"
  | "bigint"
  | "decimal"
  | "boolean"
  | "datetime"
  | "date"
  | "json"
  | "enum"
  | "blob"
  | "uuid"
  | `custom:${string}`;

export interface ColumnSchema {
  readonly propertyName: string;
  readonly columnName: string;
  readonly logicalType: LogicalType;
  readonly databaseType?: string;
  readonly nullable: boolean;
  readonly primary: boolean;
  readonly generated: false | "increment" | "identity" | "uuid";
  readonly unique: boolean;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly default?: unknown;
  readonly enumValues?: readonly string[];
  readonly array?: boolean;
  readonly renamedFrom?: string;
  readonly insert: boolean;
  readonly update: boolean;
  readonly select: boolean;
  readonly createDate?: boolean;
  readonly updateDate?: boolean;
  readonly deleteDate?: boolean;
  readonly version?: boolean;
}

export type RelationKind = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

export interface RelationSchema {
  readonly propertyName: string;
  readonly kind: RelationKind;
  readonly targetEntity: string;
  readonly targetTableName?: string;
  readonly inverseProperty?: string;
  readonly owner: boolean;
  readonly nullable: boolean;
  readonly physical: boolean;
  readonly joinColumn?: string;
  readonly joinProperty?: string;
  readonly referencedColumn?: string;
  readonly referencedProperty?: string;
  readonly joinTable?: {
    readonly name: string;
    readonly joinColumn: string;
    readonly inverseJoinColumn: string;
    readonly referencedColumn: string;
    readonly referencedProperty: string;
    readonly referencedLogicalType: LogicalType;
    readonly inverseReferencedColumn: string;
    readonly inverseReferencedProperty: string;
    readonly inverseReferencedLogicalType: LogicalType;
  };
  readonly cascade: readonly ("insert" | "update")[];
  readonly onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
}

export interface IndexSchema {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface EntitySchema {
  readonly modelName: string;
  readonly tableName: string;
  readonly renamedFrom?: string;
  readonly columns: readonly ColumnSchema[];
  readonly relations: readonly RelationSchema[];
  readonly indexes: readonly IndexSchema[];
  readonly virtual: boolean;
}

export interface OrmSchema {
  readonly version: typeof ORM_SCHEMA_VERSION;
  readonly dialect?: "sqlite" | "postgres" | "mysql";
  readonly entities: readonly EntitySchema[];
  readonly generatedAt?: string;
  readonly databaseName?: string;
}
