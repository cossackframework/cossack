import type { ColumnSchema, EntitySchema, IndexSchema } from "./types.js";

export type SchemaOperation =
  | { readonly kind: "create-table"; readonly entity: EntitySchema }
  | { readonly kind: "drop-table"; readonly tableName: string }
  | { readonly kind: "rename-table"; readonly from: string; readonly to: string }
  | { readonly kind: "add-column"; readonly tableName: string; readonly column: ColumnSchema }
  | { readonly kind: "drop-column"; readonly tableName: string; readonly columnName: string }
  | { readonly kind: "rename-column"; readonly tableName: string; readonly from: string; readonly to: string }
  | { readonly kind: "alter-column"; readonly tableName: string; readonly before: ColumnSchema; readonly after: ColumnSchema }
  | { readonly kind: "create-index"; readonly tableName: string; readonly index: IndexSchema }
  | { readonly kind: "drop-index"; readonly tableName: string; readonly indexName: string };

export interface SchemaDiff {
  readonly operations: readonly SchemaOperation[];
  readonly destructive: readonly SchemaOperation[];
  readonly empty: boolean;
}
