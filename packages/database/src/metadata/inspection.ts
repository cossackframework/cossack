import type { EntityMetadata } from './types.js';

/** Detached finalized relationships and storage fields; defaults/hooks/classes stay private. */
export function inspectFinalizedMetadata(metadata: readonly EntityMetadata[]) {
  return Object.freeze(metadata.map(entity => Object.freeze({
    modelName: entity.modelName, tableName: entity.tableName, virtual: entity.virtual,
    primaryProperties: Object.freeze(entity.primaryColumns.map(column => column.propertyName)),
    columns: Object.freeze(entity.columns.map(column => Object.freeze({ propertyName: column.propertyName,
      columnName: column.columnName, logicalType: column.logicalType, nullable: column.nullable, primary: column.primary,
      generated: column.generated, unique: column.unique, hasDefault: column.default !== undefined }))),
    relations: Object.freeze(entity.relations.map(relation => Object.freeze({ propertyName: relation.propertyName,
      kind: relation.kind, targetEntity: relation.targetEntity, targetTableName: relation.targetTableName,
      inverseProperty: relation.inverseProperty, owner: relation.owner, nullable: relation.nullable, physical: relation.physical,
      joinColumn: relation.joinColumn, joinProperty: relation.joinProperty, referencedColumn: relation.referencedColumn,
      referencedProperty: relation.referencedProperty,
      ...(relation.joinTable ? { joinTable: Object.freeze({ ...relation.joinTable }) } : {}),
      cascade: Object.freeze([...relation.cascade]) }))),
    indexes: Object.freeze(entity.indexes.map(index => Object.freeze({ name: index.name, columns: Object.freeze([...index.columns]), unique: index.unique }))),
  })));
}
export type EntityInspection = ReturnType<typeof inspectFinalizedMetadata>[number];
