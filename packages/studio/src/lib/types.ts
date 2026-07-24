export type StudioProvider = 'd1-local' | 'd1-remote' | 'sqlite' | 'libsql' | 'unknown';

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
  nullable: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
  autoIncrement: boolean;
  hidden: boolean;
}

export interface StudioObject {
  name: string;
  kind: 'table' | 'view';
  sql: string | null;
  columns: StudioColumn[];
  editable: boolean;
  readOnlyReason?: string;
}

export interface StudioSchema {
  connection: StudioConnectionInfo;
  objects: StudioObject[];
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
