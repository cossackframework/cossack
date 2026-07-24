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
  declaredKind: 'varchar' | 'number' | 'date' | 'datetime' | 'text' | 'json' | 'blob' | 'boolean' | 'other';
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

export interface StudioObject {
  name: string;
  kind: 'table' | 'view';
  sql: string | null;
  columns: StudioColumn[];
  indexes: StudioIndex[];
  editable: boolean;
  readOnlyReason?: string;
}

export interface StudioSchema {
  connection: StudioConnectionInfo;
  applicationName: string;
  objects: StudioObject[];
}

export type BrowseFilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is-null'
  | 'is-not-null';

export interface BrowseFilter {
  column: string;
  operator: BrowseFilterOperator;
  value?: string;
}

export interface BrowseSort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface BrowseOptions {
  page?: number;
  pageSize?: number;
  filters?: BrowseFilter[];
  sort?: BrowseSort[];
}

export type TransportValue =
  | null
  | boolean
  | number
  | string
  | { $type: 'bigint' | 'date' | 'blob' | 'number' | 'unsupported'; value: string };

export interface TransportQueryResult {
  columns: string[];
  rows: Record<string, TransportValue>[];
  affectedRows: number;
  durationMs: number;
  truncated: boolean;
  totalRows?: number;
  page?: number;
  pageSize?: number;
  objectName?: string;
  query?: string;
  error?: string;
}

export type InsertCell =
  | { mode: 'omit' }
  | { mode: 'null' }
  | { mode: 'value'; value: string };

export interface MutationResult {
  affectedRows: number;
  schema: StudioSchema;
}
