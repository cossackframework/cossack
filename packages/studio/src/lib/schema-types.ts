import type { DatabaseInspection } from '@cossackframework/database/tooling';
export type StudioProvider =
  | 'd1-local'
  | 'd1-remote'
  | 'sqlite'
  | 'turso'
  | 'postgres'
  | 'mysql'
  | 'unknown';

export interface StudioConnectionInfo {
  provider: StudioProvider;
  label: string;
  remote: boolean;
  databaseVersion?: string;
  binding?: string;
  environment?: string;
}

export interface StudioQueryResult {
  rows: Record<string, unknown>[];
  affectedRows: number;
  insertId?: string;
  durationMs: number;
}

export type StudioExecutor = (
  sql: string,
  parameters?: readonly unknown[],
) => Promise<StudioQueryResult>;

export interface StudioStatement {
  sql: string;
  parameters?: readonly unknown[];
}

export interface StudioConnection {
  readonly info: StudioConnectionInfo;
  readonly logicalSchema?: OrmSchema;
  inspect?(): Promise<DatabaseInspection>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<StudioQueryResult>;
  /**
   * Run several statements exclusively on this connection. When `atomic` is
   * true the statements run in one transaction that rolls back if the
   * callback throws; otherwise they run in order without rollback.
   */
  transaction?<T>(
    callback: (execute: StudioExecutor, atomic: boolean) => Promise<T>,
  ): Promise<T>;
  /**
   * Run several statements in one round trip and return one result per
   * statement, in order. Connections implement it when a round trip is
   * expensive: remote D1 starts one Wrangler process per call and sends the
   * statements as one D1 batch, which D1 runs as a transaction. Callers keep
   * each batch small with `runStatements()`/`chunkStatements()`.
   */
  batch?(statements: readonly StudioStatement[]): Promise<StudioQueryResult[]>;
  close(): Promise<void>;
}

export interface StudioColumn {
  name: string;
  dataType: string;
  affinity: 'integer' | 'real' | 'text' | 'blob' | 'numeric';
  declaredKind:
    | 'varchar'
    | 'number'
    | 'date'
    | 'datetime'
    | 'text'
    | 'json'
    | 'blob'
    | 'boolean'
    | 'other';
  nullable: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
  autoIncrement: boolean;
  hidden: boolean;
  logicalType?: LogicalType;
  propertyName?: string;
}

export interface StudioIndexColumn {
  name: string | null;
  position: number;
  descending: boolean;
  collation: string | null;
}

export interface StudioIndex {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: StudioIndexColumn[];
}

export interface StudioForeignKeyColumn {
  column: string;
  referencedColumn: string;
  position: number;
}

export interface StudioForeignKey {
  name: string;
  referencedTable: string;
  columns: StudioForeignKeyColumn[];
  onUpdate: string | null;
  onDelete: string | null;
}

export interface StudioRelation extends RelationSchema {
  readonly kind: RelationKind;
  readonly provenance: 'orm';
}

export type StudioRowLocator =
  | {
      kind: 'primary-key';
      columns: string[];
    }
  | {
      kind: 'unique-index';
      columns: string[];
      name: string;
    }
  | {
      kind: 'sqlite-rowid';
      columns: [string];
      source: 'rowid' | '_rowid_' | 'oid';
    }
  | {
      kind: 'postgres-ctid';
      columns: [string, string];
    };

export interface StudioObject {
  name: string;
  kind: 'table' | 'view';
  sql: string | null;
  columns: StudioColumn[];
  indexes: StudioIndex[];
  foreignKeys: StudioForeignKey[];
  rowLocators: StudioRowLocator[];
  editable: boolean;
  readOnlyReason?: string;
  modelName?: string;
  relations?: StudioRelation[];
}

export interface StudioSchema {
  /** Loaded lazily through `StudioDatabase.getInspection()`. */
  inspection?: DatabaseInspection;
  /** Whether the connection can provide `inspection` on demand. */
  inspectionAvailable?: boolean;
  connection: StudioConnectionInfo;
  applicationName: string;
  objects: StudioObject[];
  drift?: string[];
}

export interface StudioPragmaOption {
  value: string;
  label: string;
}

export interface StudioPragma {
  name: string;
  value: string;
  kind: 'boolean' | 'number' | 'select';
  description: string;
  options?: StudioPragmaOption[];
}
import type {
  LogicalType,
  OrmSchema,
  RelationKind,
  RelationSchema,
} from '@cossackframework/database';
