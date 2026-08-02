export { createORM, ORM, type ORMOptions } from "./orm.js";
export { BaseEntity } from "./entity/base-entity.js";
export { ModelManager } from "./entity/manager.js";
export { sql, createSQLTag, type SQLTag, type SQLInterpolation } from "./sql/tag.js";
export { SQL, type SQLClient, type SQLOptions } from "./sql/client.js";
export {
  SQLFragment,
  compileSQL,
  isSQLFragment,
  type CompiledQuery,
  type ExecutableSQL,
  type SQLNode,
} from "./sql/fragment.js";
export {
  Entity,
  Column,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  VersionColumn,
  OneToOne,
  OneToMany,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
  Unique,
  BeforeInsert,
  AfterInsert,
  BeforeUpdate,
  AfterUpdate,
  BeforeRemove,
  AfterRemove,
  AfterLoad,
} from "./metadata/decorators.js";
export {
  defaultNamingStrategy,
  snakeCase,
  type NamingStrategy,
} from "./metadata/naming.js";
export type {
  ColumnOptions,
  EntityMetadata,
  EntityOptions,
  EntityTarget,
  IndexOptions,
  JoinColumnOptions,
  JoinTableOptions,
  RelationOptions,
  Relation,
} from "./metadata/types.js";
export { SelectQueryBuilder, MutationQueryBuilder } from "./query/builder.js";
export {
  Equal,
  Not,
  MoreThan,
  MoreThanOrEqual,
  LessThan,
  LessThanOrEqual,
  Like,
  In,
  NotIn,
  IsNull,
  type EntityShape,
  type FindOperator,
  type FindOptions,
  type FindWhere,
} from "./query/types.js";
export { ExpressionBuilder } from "./query/expression.js";
export { defineConfig, type ORMConfig } from "./config.js";
export { SchemaBuilder } from "./schema/builder.js";
export { diffSchemas, describeOperation } from "./schema/diff.js";
export { renderOperation, createTableDDL, columnDDL } from "./schema/ddl.js";
export type { SchemaDiff, SchemaOperation } from "./schema/operations.js";
export {
  ORM_SCHEMA_VERSION,
  type OrmSchema,
  type EntitySchema,
  type ColumnSchema,
  type RelationSchema,
  type IndexSchema,
  type LogicalType,
  type RelationKind,
} from "./schema/types.js";
export { MigrationRunner } from "./migration/runner.js";
export type {
  Migration,
  MigrationContext,
  AppliedMigration,
  MigrationStatus,
} from "./migration/types.js";
export { SeederRunner } from "./seeding/runner.js";
export {
  defineSeeder,
  type Seeder,
  type SeederContext,
  type SeederFunction,
  type SeederInfo,
  type SeederInput,
  type SeederResult,
  type SeederRunOptions,
  type SeederTransaction,
} from "./seeding/types.js";
export {
  ORMError,
  ConfigurationError,
  MetadataError,
  ScopeError,
  QueryError,
  UnsupportedCapabilityError,
  DestructiveSchemaChangeError,
  MigrationError,
  SeederError,
} from "./errors.js";
export type {
  Adapter,
  Driver,
  DriverCapabilities,
  QueryResult,
  QueryMeta,
  QueryOperation,
  ORMLogger,
} from "./adapter/types.js";
