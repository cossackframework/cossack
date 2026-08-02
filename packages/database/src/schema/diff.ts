import { DestructiveSchemaChangeError } from "../errors.js";
import type { SchemaDiff, SchemaOperation } from "./operations.js";
import type { ColumnSchema, EntitySchema, OrmSchema } from "./types.js";

function comparableColumn(column: ColumnSchema): string {
  const normalizedDefault =
    column.logicalType === "boolean"
      ? (
          column.default === true ||
          column.default === 1 ||
          column.default === "1" ||
          String(column.default).toLowerCase() === "true"
            ? true
            : column.default === false ||
                column.default === 0 ||
                column.default === "0" ||
                String(column.default).toLowerCase() === "false"
              ? false
              : column.default
        )
      : column.default;
  return JSON.stringify({
    logicalType: column.logicalType,
    nullable: column.nullable,
    primary: column.primary,
    generated: column.generated,
    unique: column.unique,
    length: column.length,
    precision: column.precision,
    scale: column.scale,
    default: normalizedDefault,
    enumValues: column.enumValues,
    array: column.array,
  });
}

function findExistingEntity(existing: OrmSchema, desired: EntitySchema): EntitySchema | undefined {
  return existing.entities.find(
    (entity) => entity.tableName === desired.tableName || entity.tableName === desired.renamedFrom,
  );
}

export function diffSchemas(
  existing: OrmSchema,
  desired: OrmSchema,
  options: { readonly allowDestructive?: boolean } = {},
): SchemaDiff {
  const operations: SchemaOperation[] = [];
  const destructive: SchemaOperation[] = [];
  const matchedTables = new Set<string>();

  for (const target of desired.entities) {
    const source = findExistingEntity(existing, target);
    if (!source) {
      operations.push({ kind: "create-table", entity: target });
      continue;
    }
    matchedTables.add(source.tableName);
    if (source.tableName !== target.tableName) {
      operations.push({ kind: "rename-table", from: source.tableName, to: target.tableName });
    }
    const matchedColumns = new Set<string>();
    for (const desiredColumn of target.columns) {
      const existingColumn = source.columns.find(
        (column) =>
          column.columnName === desiredColumn.columnName ||
          column.columnName === desiredColumn.renamedFrom,
      );
      if (!existingColumn) {
        operations.push({ kind: "add-column", tableName: target.tableName, column: desiredColumn });
        continue;
      }
      matchedColumns.add(existingColumn.columnName);
      if (existingColumn.columnName !== desiredColumn.columnName) {
        operations.push({
          kind: "rename-column",
          tableName: target.tableName,
          from: existingColumn.columnName,
          to: desiredColumn.columnName,
        });
      }
      if (comparableColumn(existingColumn) !== comparableColumn(desiredColumn)) {
        const operation: SchemaOperation = {
          kind: "alter-column",
          tableName: target.tableName,
          before: existingColumn,
          after: desiredColumn,
        };
        operations.push(operation);
        if (
          (!existingColumn.nullable && desiredColumn.nullable === false) ||
          existingColumn.logicalType !== desiredColumn.logicalType ||
          Number(desiredColumn.length ?? Infinity) < Number(existingColumn.length ?? Infinity)
        ) {
          destructive.push(operation);
        }
      }
    }
    for (const existingColumn of source.columns) {
      if (!matchedColumns.has(existingColumn.columnName)) {
        const operation: SchemaOperation = {
          kind: "drop-column",
          tableName: target.tableName,
          columnName: existingColumn.columnName,
        };
        operations.push(operation);
        destructive.push(operation);
      }
    }
    const desiredIndexes = new Map(target.indexes.map((index) => [index.name, index]));
    const existingIndexes = new Map(source.indexes.map((index) => [index.name, index]));
    for (const [name, index] of desiredIndexes) {
      const previous = existingIndexes.get(name);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(index)) {
        if (previous) operations.push({ kind: "drop-index", tableName: target.tableName, indexName: name });
        operations.push({ kind: "create-index", tableName: target.tableName, index });
      }
    }
    for (const name of existingIndexes.keys()) {
      if (!desiredIndexes.has(name)) operations.push({ kind: "drop-index", tableName: target.tableName, indexName: name });
    }
  }
  for (const source of existing.entities) {
    if (!matchedTables.has(source.tableName)) {
      const operation: SchemaOperation = { kind: "drop-table", tableName: source.tableName };
      operations.push(operation);
      destructive.push(operation);
    }
  }
  if (destructive.length && !options.allowDestructive) {
    const summary = destructive.map(describeOperation).join(", ");
    throw new DestructiveSchemaChangeError(
      `Schema diff contains destructive changes: ${summary}. Re-run with --allow-destructive after review.`,
    );
  }
  return Object.freeze({
    operations: Object.freeze(operations),
    destructive: Object.freeze(destructive),
    empty: operations.length === 0,
  });
}

export function describeOperation(operation: SchemaOperation): string {
  switch (operation.kind) {
    case "create-table": return `create table ${operation.entity.tableName}`;
    case "drop-table": return `drop table ${operation.tableName}`;
    case "rename-table": return `rename table ${operation.from} to ${operation.to}`;
    case "add-column": return `add ${operation.tableName}.${operation.column.columnName}`;
    case "drop-column": return `drop ${operation.tableName}.${operation.columnName}`;
    case "rename-column": return `rename ${operation.tableName}.${operation.from} to ${operation.to}`;
    case "alter-column": return `alter ${operation.tableName}.${operation.after.columnName}`;
    case "create-index": return `create index ${operation.index.name}`;
    case "drop-index": return `drop index ${operation.indexName}`;
  }
}
