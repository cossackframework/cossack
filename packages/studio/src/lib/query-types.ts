import type { StudioSchema } from './schema-types.js';

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

export type InsertValueKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'json'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'uuid-v4'
  | 'uuid-v7'
  | 'blob';

export type InsertCell =
  | { mode: 'omit' }
  | { mode: 'null' }
  | { mode: 'value'; value: string; valueKind?: InsertValueKind };

export interface MutationResult {
  affectedRows: number;
  schema: StudioSchema;
}
