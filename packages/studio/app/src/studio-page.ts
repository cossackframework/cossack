import type {
  StudioColumn,
  StudioObject,
  StudioRelation,
  StudioSchema,
} from '../../src/lib/schema-types';
import type {
  BrowseFilterOperator,
  InsertValueKind,
  TransportQueryResult,
  TransportValue,
} from '../../src/lib/query-types';

export type CellMode = 'null' | 'value';
export type StudioTab = 'browse' | 'structure' | 'sql' | 'pragmas';
export type InsertMode = 'omit' | 'null' | 'value';
export type InsertSelection = InsertValueKind | Exclude<InsertMode, 'value'>;
export type CellSelection = InsertValueKind | 'null';
export type ExportFormat = 'json' | 'csv';

export interface CellEditor {
  rowIndex: number;
  columnName: string;
  value: string;
  mode: CellMode;
  kind: InsertValueKind;
}

export interface RowEditorState {
  rowIndex: number;
  value: string;
  error: string;
}

export interface DeleteTarget {
  table: string;
  keys: Array<Record<string, unknown>>;
}

export interface StudioRelationNavigation {
  sourceColumn: string;
  targetColumn: string;
  targetTable: string;
  through: boolean;
}

export interface RelationExpansion {
  relationProperty: string;
  relationKind: StudioRelation['kind'];
  targetEntity: string;
  targetTable: string;
  loading: boolean;
  error: string;
  result: TransportQueryResult;
}

const RELATION_KIND_LABELS: Record<StudioRelation['kind'], string> = {
  'one-to-one': '1-1',
  'one-to-many': '1-∞',
  'many-to-one': '∞-1',
  'many-to-many': '∞-∞',
};

export function relationKindLabel(kind: StudioRelation['kind']): string {
  return RELATION_KIND_LABELS[kind];
}

export function relationNavigation(
  schema: StudioSchema,
  object: StudioObject,
  relation: StudioRelation,
): StudioRelationNavigation | undefined {
  const available = (
    navigation: StudioRelationNavigation,
  ): StudioRelationNavigation | undefined => {
    const target = schema.objects.find(
      (candidate) => candidate.name === navigation.targetTable,
    );
    return object.columns.some((column) => column.name === navigation.sourceColumn) &&
      target?.columns.some((column) => column.name === navigation.targetColumn)
      ? navigation
      : undefined;
  };
  if (relation.joinTable) {
    const join = relation.joinTable;
    return available({
      sourceColumn: join.referencedColumn,
      targetColumn: join.joinColumn,
      targetTable: join.name,
      through: true,
    });
  }
  if (relation.joinColumn && relation.referencedColumn && relation.targetTableName) {
    return available({
      sourceColumn: relation.joinColumn,
      targetColumn: relation.referencedColumn,
      targetTable: relation.targetTableName,
      through: false,
    });
  }
  if (!relation.inverseProperty || !relation.targetTableName) return undefined;
  const target = schema.objects.find(
    (candidate) => candidate.name === relation.targetTableName,
  );
  const inverse = target?.relations?.find(
    (candidate) => candidate.propertyName === relation.inverseProperty,
  );
  if (!target || !inverse) return undefined;
  if (inverse.joinTable) {
    const join = inverse.joinTable;
    return available({
      sourceColumn: join.inverseReferencedColumn,
      targetColumn: join.inverseJoinColumn,
      targetTable: join.name,
      through: true,
    });
  }
  if (!inverse.joinColumn || !inverse.referencedColumn) return undefined;
  return available({
    sourceColumn: inverse.referencedColumn,
    targetColumn: inverse.joinColumn,
    targetTable: target.name,
    through: false,
  });
}

export interface ExportSheetState {
  rowIndexes: number[];
  format: ExportFormat;
  columns: string[];
  collection: boolean;
}

export interface BatchUpdateState {
  column: string;
  mode: CellMode;
  value: string;
}

export interface InsertFieldState {
  mode: InsertMode;
  valueKind: InsertValueKind;
  value: string;
}

export interface QueryHistoryEntry {
  id: string;
  statement: string;
  executedAt: number;
  durationMs: number;
  error: string | null;
  favorite: boolean;
  source: 'browse' | 'sql';
}

export function displayValue(value: TransportValue | undefined): string {
  if (value === undefined) return '';
  if (value === null) return 'NULL';
  if (typeof value === 'object') {
    if (value.$type === 'blob') {
      return `BLOB (${Math.floor(value.value.length * 0.75)} bytes)`;
    }
    return value.value;
  }
  return String(value);
}

export function editableValue(value: TransportValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value.value;
  return String(value);
}

export function exportValue(
  value: TransportValue | undefined,
): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return value;
  return value.value;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const emptyResult: TransportQueryResult = {
  columns: [],
  rows: [],
  affectedRows: 0,
  durationMs: 0,
  truncated: false,
  totalRows: 0,
  page: 1,
  pageSize: 100,
  objectName: '',
  query: '',
};

export const INSERT_VALUE_KINDS: Array<{ value: InsertValueKind; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'json', label: 'JSON' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Datetime (local)' },
  { value: 'timestamp', label: 'Timestamp (UTC)' },
  { value: 'uuid-v4', label: 'UUID v4' },
  { value: 'uuid-v7', label: 'UUID v7' },
  { value: 'blob', label: 'Blob' },
];

export function defaultInsertValueKind(column: StudioColumn): InsertValueKind {
  if (/\btimestamp\b/i.test(column.dataType)) return 'timestamp';
  if (
    column.declaredKind === 'number' ||
    column.declaredKind === 'boolean' ||
    column.declaredKind === 'json' ||
    column.declaredKind === 'date' ||
    column.declaredKind === 'datetime' ||
    column.declaredKind === 'blob'
  ) {
    return column.declaredKind;
  }
  return 'text';
}

export function localDateTimeDefaults(): {
  date: string;
  datetime: string;
  timestamp: string;
} {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
  return {
    date: local.slice(0, 10),
    datetime: local.slice(0, 16),
    timestamp: now.toISOString(),
  };
}

export const FILTER_OPERATORS: Array<{
  value: BrowseFilterOperator;
  label: string;
}> = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'starts-with', label: 'starts with' },
  { value: 'ends-with', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'is-null', label: 'is NULL' },
  { value: 'is-not-null', label: 'is not NULL' },
];
