export type StudioProvider =
  | 'd1-local'
  | 'd1-remote'
  | 'sqlite'
  | 'libsql'
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

export interface StudioConnection {
  readonly info: StudioConnectionInfo;
  execute(sql: string, parameters?: readonly unknown[]): Promise<StudioQueryResult>;
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
}

export interface StudioSchema {
  connection: StudioConnectionInfo;
  applicationName: string;
  objects: StudioObject[];
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
