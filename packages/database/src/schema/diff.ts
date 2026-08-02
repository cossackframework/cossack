import { DestructiveSchemaChangeError } from "../errors.js";
import type { SchemaDiff, SchemaOperation } from "./operations.js";
import type { ColumnSchema, EntitySchema, OrmSchema } from "./types.js";

function sqliteStorageType(type: ColumnSchema['logicalType']): string {
  if (type === 'integer' || type === 'bigint' || type === 'boolean') return 'integer';
  if (type === 'decimal') return 'numeric';
  if (type === 'blob') return 'blob';
  if (type.startsWith('custom:')) {
    const declared = type.slice('custom:'.length).toLowerCase();
    if (declared.includes('int')) return 'integer';
    if (declared.includes('char') || declared.includes('clob') || declared.includes('text')) {
      return 'text';
    }
    if (declared.includes('blob') || declared.length === 0) return 'blob';
    if (declared.includes('real') || declared.includes('floa') || declared.includes('doub')) {
      return 'real';
    }
    return 'numeric';
  }
  return 'text';
}

function comparableColumn(column: ColumnSchema, dialect?: OrmSchema['dialect']): string {
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
    logicalType: dialect === 'sqlite' ? sqliteStorageType(column.logicalType) : column.logicalType,
    nullable: column.nullable,
    primary: column.primary,
    generated: column.generated,
    unique: column.unique,
    length: dialect === 'sqlite' ? undefined : column.length,
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
  const dialect = existing.dialect ?? desired.dialect;

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
      if (comparableColumn(existingColumn, dialect) !== comparableColumn(desiredColumn, dialect)) {
        const operation: SchemaOperation = {
          kind: "alter-column",
          tableName: target.tableName,
          before: existingColumn,
          after: desiredColumn,
        };
        operations.push(operation);
        if (
          (existingColumn.nullable && !desiredColumn.nullable) ||
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

export function reverseSchemaOperations(
  operations: readonly SchemaOperation[],
  previous: OrmSchema,
): readonly SchemaOperation[] {
  const previousEntity = (tableName: string): EntitySchema => {
    const entity = previous.entities.find((candidate) => candidate.tableName === tableName);
    if (!entity) throw new Error(`Cannot reverse migration: missing previous table ${tableName}.`);
    return entity;
  };
  return Object.freeze([...operations].reverse().flatMap((operation): readonly SchemaOperation[] => {
    switch (operation.kind) {
      case "create-table": {
        const joinTables = operation.entity.relations
          .filter((relation) => relation.owner && relation.joinTable)
          .map((relation): SchemaOperation => ({
            kind: "drop-table",
            tableName: relation.joinTable!.name,
          }));
        return [...joinTables, { kind: "drop-table", tableName: operation.entity.tableName }];
      }
      case "drop-table":
        return [{ kind: "create-table", entity: previousEntity(operation.tableName) }];
      case "rename-table":
        return [{ kind: "rename-table", from: operation.to, to: operation.from }];
      case "add-column":
        return [{
          kind: "drop-column",
          tableName: operation.tableName,
          columnName: operation.column.columnName,
        }];
      case "drop-column": {
        const column = previousEntity(operation.tableName).columns.find(
          (candidate) => candidate.columnName === operation.columnName,
        );
        if (!column) {
          throw new Error(
            `Cannot reverse migration: missing previous column ${operation.tableName}.${operation.columnName}.`,
          );
        }
        return [{ kind: "add-column", tableName: operation.tableName, column }];
      }
      case "rename-column":
        return [{
          kind: "rename-column",
          tableName: operation.tableName,
          from: operation.to,
          to: operation.from,
        }];
      case "alter-column":
        return [{
          kind: "alter-column",
          tableName: operation.tableName,
          before: operation.after,
          after: operation.before,
        }];
      case "create-index":
        return [{
          kind: "drop-index",
          tableName: operation.tableName,
          indexName: operation.index.name,
        }];
      case "drop-index": {
        const index = previousEntity(operation.tableName).indexes.find(
          (candidate) => candidate.name === operation.indexName,
        );
        if (!index) {
          throw new Error(
            `Cannot reverse migration: missing previous index ${operation.indexName}.`,
          );
        }
        return [{ kind: "create-index", tableName: operation.tableName, index }];
      }
    }
  }));
}
