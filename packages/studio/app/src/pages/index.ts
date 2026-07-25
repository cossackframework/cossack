import {
  Client,
  ClientState,
  Cossack,
  type HeadContext,
  type HeadValue,
  OnWindow,
  Page,
  Server,
  State,
  server$,
} from '@cossackframework/core';
import { component, html, repeat } from '@cossackframework/renderer';
import { CommandPalette } from '@cossackframework/framework/blocks';
import { AddSquareIcon } from '@cossackframework/solar-icons/add-square';
import { CodeSquareIcon } from '@cossackframework/solar-icons/code-square';
import { DatabaseIcon } from '@cossackframework/solar-icons/database';
import { ExportIcon } from '@cossackframework/solar-icons/export';
import { EyeIcon } from '@cossackframework/solar-icons/eye';
import { FilterIcon } from '@cossackframework/solar-icons/filter';
import { FiltersIcon } from '@cossackframework/solar-icons/filters';
import { GraphIcon } from '@cossackframework/solar-icons/graph';
import { HistoryIcon } from '@cossackframework/solar-icons/history';
import { KeyIcon } from '@cossackframework/solar-icons/key';
import { LinkIcon } from '@cossackframework/solar-icons/link';
import { MoonIcon } from '@cossackframework/solar-icons/moon';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier';
import { PenIcon } from '@cossackframework/solar-icons/pen';
import { PlayIcon } from '@cossackframework/solar-icons/play';
import { RefreshIcon } from '@cossackframework/solar-icons/refresh';
import { SortIcon } from '@cossackframework/solar-icons/sort';
import { StarIcon } from '@cossackframework/solar-icons/star';
import { StructureIcon } from '@cossackframework/solar-icons/structure';
import { SunIcon } from '@cossackframework/solar-icons/sun';
import { TrashBinMinimalisticIcon } from '@cossackframework/solar-icons/trash-bin-minimalistic';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  DatePicker,
  DropdownMenu,
  Icon,
  Input,
  InputGroup,
  Kbd,
  Select,
  Sheet,
  Switch,
  Textarea,
  Tooltip,
} from '@cossackframework/ui';
import type {
  StudioColumn,
  StudioForeignKey,
  StudioObject,
  StudioPragma,
  StudioSchema,
} from '../../../src/lib/schema-types';
import type {
  BrowseFilter,
  BrowseFilterOperator,
  BrowseSort,
  InsertCell,
  InsertValueKind,
  TransportQueryResult,
  TransportValue,
} from '../../../src/lib/query-types';
import { getStudioDatabase } from '../../../src/server/runtime';
import { CodeEditor } from '../components/CodeEditor';
import { studioSchemaCatalog } from '../schema-store';
import { studioTheme, type StudioTheme } from '../theme.client';

declare const __COSSACK_STUDIO_VERSION__: string;

type CellMode = 'null' | 'value';
type StudioTab = 'browse' | 'structure' | 'sql' | 'pragmas';
type InsertMode = 'omit' | 'null' | 'value';
type InsertSelection = InsertValueKind | Exclude<InsertMode, 'value'>;
type CellSelection = InsertValueKind | 'null';
type ExportFormat = 'json' | 'csv';

interface CellEditor {
  rowIndex: number;
  columnName: string;
  value: string;
  mode: CellMode;
  kind: InsertValueKind;
}

interface RowEditorState {
  rowIndex: number;
  value: string;
  error: string;
}

interface DeleteTarget {
  table: string;
  keys: Array<Record<string, unknown>>;
}

interface ExportSheetState {
  rowIndexes: number[];
  format: ExportFormat;
  columns: string[];
  collection: boolean;
}

interface BatchUpdateState {
  column: string;
  mode: CellMode;
  value: string;
}

interface InsertFieldState {
  mode: InsertMode;
  valueKind: InsertValueKind;
  value: string;
}

interface QueryHistoryEntry {
  id: string;
  statement: string;
  executedAt: number;
  durationMs: number;
  error: string | null;
  favorite: boolean;
  source: 'browse' | 'sql';
}

function displayValue(value: TransportValue | undefined): string {
  if (value === undefined) return '';
  if (value === null) return 'NULL';
  if (typeof value === 'object') {
    if (value.$type === 'blob') return `BLOB (${Math.floor(value.value.length * 0.75)} bytes)`;
    return value.value;
  }
  return String(value);
}

function editableValue(value: TransportValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value.value;
  return String(value);
}

function exportValue(value: TransportValue | undefined): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return value;
  return value.value;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const emptyResult: TransportQueryResult = {
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

const SYSTEM_TABLES = new Set(['kysely_migration', 'kysely_migration_lock']);
const INSERT_VALUE_KINDS: Array<{ value: InsertValueKind; label: string }> = [
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

function defaultInsertValueKind(column: StudioColumn): InsertValueKind {
  if (/\btimestamp\b/i.test(column.dataType)) return 'timestamp';
  if (column.declaredKind === 'number' || column.declaredKind === 'boolean' ||
      column.declaredKind === 'json' || column.declaredKind === 'date' ||
      column.declaredKind === 'datetime' || column.declaredKind === 'blob') {
    return column.declaredKind;
  }
  return 'text';
}

function localDateTimeDefaults(): { date: string; datetime: string; timestamp: string } {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString();
  return {
    date: local.slice(0, 10),
    datetime: local.slice(0, 16),
    timestamp: now.toISOString(),
  };
}
const FILTER_OPERATORS: Array<{ value: BrowseFilterOperator; label: string }> = [
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

@Page({ transport: 'http' })
export default class StudioPage extends Cossack {
  initialSchema = server$(
    () => getStudioDatabase().getSchema(),
    {
      initial: {
        connection: { provider: 'unknown', label: 'Database', remote: false },
        applicationName: 'Cossack application',
        objects: [],
      } satisfies StudioSchema,
    },
  );

  @State() schema: StudioSchema | null = null;
  @State() browseResult: TransportQueryResult = emptyResult;
  @State() sqlResult: TransportQueryResult = emptyResult;
  @State() explainResult: TransportQueryResult = emptyResult;
  @State() pragmas: StudioPragma[] = [];
  @State() selected = '';
  @State() page = 1;
  @State() pageSize = 100;
  @State() sql = 'SELECT sqlite_version() AS version;';
  @State() message = '';
  @State() messageError = false;

  @ClientState() search = '';
  @ClientState() searchIndex = -1;
  @ClientState() tab: StudioTab = 'browse';
  @ClientState() showInsert = false;
  @ClientState() showFilter = false;
  @ClientState() showKyselyMigration = false;
  @ClientState() showKyselyMigrationLock = false;
  @ClientState() insertFields: Record<string, InsertFieldState> = {};
  @ClientState() insertError = '';
  @ClientState() filters: BrowseFilter[] = [];
  @ClientState() sort: BrowseSort[] = [];
  @ClientState() filterColumn = '';
  @ClientState() filterOperator: BrowseFilterOperator = 'contains';
  @ClientState() filterValue = '';
  @ClientState() selectedRows: number[] = [];
  @ClientState() inlineEditor: CellEditor | null = null;
  @ClientState() sheetEditor: CellEditor | null = null;
  @ClientState() rowEditor: RowEditorState | null = null;
  @ClientState() deleteTarget: DeleteTarget | null = null;
  @ClientState() exportSheet: ExportSheetState | null = null;
  @ClientState() batchUpdate: BatchUpdateState | null = null;
  @ClientState() browseLoading = false;
  @ClientState() browseQuery = '';
  @ClientState() customBrowseQuery = false;
  @ClientState() loadedObject = '';
  @ClientState() browseLoadFailed = false;
  @ClientState() paletteOpen = false;
  @ClientState() restoringUrl = false;
  @ClientState() theme: StudioTheme = 'dark';
  @ClientState() pragmaDrafts: Record<string, string> = {};
  @ClientState() queryHistory: QueryHistoryEntry[] = [];
  @ClientState() historyOpen = false;
  @ClientState() sqlOutput: 'results' | 'explain' = 'results';

  private disconnectTheme?: () => void;
  private insertTemporalDefaults = { date: '', datetime: '', timestamp: '' };

  onMount() {
    this.theme = studioTheme.get();
    this.disconnectTheme = studioTheme.subscribe((theme) => {
      this.theme = theme;
    });
    studioSchemaCatalog.set(this.activeSchema);
    if (this.activeSchema.connection.provider === 'postgres') {
      this.sql = 'SELECT version() AS version;';
    } else if (this.activeSchema.connection.provider === 'mysql') {
      this.sql = 'SELECT VERSION() AS version;';
    }
    this.loadQueryHistory();
    void this.restoreFromUrl();
  }

  onCleanup() {
    this.disconnectTheme?.();
  }

  get activeSchema(): StudioSchema {
    return this.schema ?? this.initialSchema;
  }

  get activeObject(): StudioObject | undefined {
    return this.activeSchema.objects.find((object) => object.name === this.selected);
  }

  get queryHistoryStorageKey(): string {
    const connection = this.activeSchema.connection;
    return `cossack-studio:query-history:${connection.provider}:${connection.label}`;
  }

  get explainJson(): string | null {
    if (this.explainResult.rows.length !== 1 || this.explainResult.columns.length !== 1) {
      return null;
    }
    const value = editableValue(
      this.explainResult.rows[0]?.[this.explainResult.columns[0]],
    );
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return null;
    }
  }

  head(_context: HeadContext): HeadValue {
    return {
      title: this.selected ? `${this.selected} · Cossack Studio` : 'Cossack Studio',
      description: 'Inspect and edit the current Cossack application database.',
    };
  }

  visibleObjects(schema = this.activeSchema): StudioObject[] {
    const query = this.search.trim().toLowerCase();
    return schema.objects.filter((candidate) => {
      if (candidate.name === 'kysely_migration' && !this.showKyselyMigration) return false;
      if (candidate.name === 'kysely_migration_lock' && !this.showKyselyMigrationLock) return false;
      return candidate.name.toLowerCase().includes(query);
    });
  }

  @Client()
  toggleTheme() {
    const next = studioTheme.get() === 'dark' ? 'light' : 'dark';
    document.cookie = `cossack-studio-theme=${next}; Path=/; Max-Age=31536000; SameSite=Strict`;
    studioTheme.set(next);
  }

  @Client()
  syncUrl(push = false) {
    if (this.restoringUrl) return;
    const url = new URL(window.location.href);
    for (const key of ['table', 'tab', 'page', 'pageSize', 'filter', 'sort']) {
      url.searchParams.delete(key);
    }
    if (this.selected) url.searchParams.set('table', this.selected);
    if (this.tab !== 'browse') url.searchParams.set('tab', this.tab);
    if (this.page > 1) url.searchParams.set('page', String(this.page));
    if (this.pageSize !== 100) url.searchParams.set('pageSize', String(this.pageSize));
    for (const filter of this.filters) url.searchParams.append('filter', JSON.stringify(filter));
    for (const sort of this.sort) url.searchParams.append('sort', JSON.stringify(sort));
    window.history[push ? 'pushState' : 'replaceState']({}, '', url);
  }

  @Client()
  async restoreFromUrl() {
    if (this.restoringUrl) return;
    this.restoringUrl = true;
    try {
      const params = new URL(window.location.href).searchParams;
      const requestedTab = params.get('tab');
      this.tab = requestedTab === 'structure' ||
        requestedTab === 'sql' ||
        requestedTab === 'pragmas'
        ? requestedTab
        : 'browse';
      const requestedSize = Number(params.get('pageSize') ?? 100);
      this.pageSize = [25, 50, 100, 250, 500].includes(requestedSize) ? requestedSize : 100;
      const object = this.activeSchema.objects.find((candidate) => candidate.name === params.get('table'));
      if (!object) {
        this.selected = '';
        this.loadedObject = '';
        if (this.tab === 'pragmas') await this.refreshPragmas();
        return;
      }
      this.selected = object.name;
      this.filterColumn = object.columns[0]?.name ?? '';
      const columnNames = new Set(object.columns.map((column) => column.name));
      this.filters = params.getAll('filter').flatMap((encoded) => {
        try {
          const filter = JSON.parse(encoded) as BrowseFilter;
          return columnNames.has(filter.column) &&
            FILTER_OPERATORS.some((operator) => operator.value === filter.operator)
            ? [filter]
            : [];
        } catch {
          return [];
        }
      });
      this.sort = params.getAll('sort').flatMap((encoded) => {
        try {
          const item = JSON.parse(encoded) as BrowseSort;
          return columnNames.has(item.column) && (item.direction === 'asc' || item.direction === 'desc')
            ? [item]
            : [];
        } catch {
          return [];
        }
      });
      const requestedPage = Math.max(1, Number(params.get('page') ?? 1) || 1);
      await this.reloadRows(object.name, requestedPage, this.pageSize, false);
      if (this.tab === 'pragmas') await this.refreshPragmas();
    } finally {
      this.restoringUrl = false;
    }
  }

  @OnWindow('popstate')
  onHistoryNavigation() {
    void this.restoreFromUrl();
  }

  @Client()
  async chooseObject(name: string, filters: BrowseFilter[] = []) {
    this.selected = name;
    this.loadedObject = '';
    this.browseQuery = '';
    this.customBrowseQuery = false;
    this.browseLoadFailed = false;
    this.page = 1;
    this.tab = 'browse';
    this.filters = filters;
    this.sort = [];
    this.filterColumn = this.activeSchema.objects.find((object) => object.name === name)
      ?.columns[0]?.name ?? '';
    this.searchIndex = -1;
    this.inlineEditor = null;
    this.sheetEditor = null;
    this.showInsert = false;
    this.selectedRows = [];
    this.syncUrl(true);
    await this.reloadRows(name, 1, this.pageSize);
  }

  @Client()
  async switchTab(tab: StudioTab) {
    this.startViewTransition(() => {
      this.tab = tab;
      this.syncUrl(true);
    }, ['studio-tab']);
    if (tab === 'pragmas') await this.refreshPragmas();
  }

  @Client()
  async refreshPragmas() {
    if (!['sqlite', 'libsql', 'd1-local', 'd1-remote']
      .includes(this.activeSchema.connection.provider)) return;
    try {
      const pragmas = await this.loadPragmas();
      this.pragmaDrafts = Object.fromEntries(
        pragmas.map((pragma) => [pragma.name, pragma.value]),
      );
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  setPragmaDraft(name: string, value: string) {
    this.pragmaDrafts = { ...this.pragmaDrafts, [name]: value };
  }

  @Client()
  async savePragma(name: string) {
    const value = this.pragmaDrafts[name];
    if (value === undefined) return;
    try {
      const pragmas = await this.updatePragmaSetting(name, value);
      this.pragmaDrafts = Object.fromEntries(
        pragmas.map((pragma) => [pragma.name, pragma.value]),
      );
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  async reloadRows(
    name = this.selected,
    page = this.page,
    pageSize = this.pageSize,
    updateUrl = true,
  ) {
    if (!name) return;
    this.browseLoading = true;
    this.browseLoadFailed = false;
    this.inlineEditor = null;
    this.selectedRows = [];
    try {
      await this.loadRows(name, page, pageSize, this.filters, this.sort);
      this.loadedObject = name;
      this.browseQuery = this.browseResult.query ?? '';
      this.customBrowseQuery = false;
      if (updateUrl) this.syncUrl();
    } catch (error: any) {
      this.loadedObject = '';
      this.browseLoadFailed = true;
      this.message = error?.message ?? String(error);
      this.messageError = true;
    } finally {
      this.browseLoading = false;
    }
  }

  @Client()
  async changePage(page: number) {
    if (!this.selected || page === this.page) return;
    await this.reloadRows(this.selected, page, this.pageSize);
  }

  @Client()
  async changePageSize(value: string) {
    const pageSize = Number(value);
    if (![25, 50, 100, 250, 500].includes(pageSize)) return;
    this.pageSize = pageSize;
    this.page = 1;
    if (this.selected) await this.reloadRows(this.selected, 1, pageSize);
  }

  @Client()
  onSearchInput(value: string) {
    this.search = value;
    this.searchIndex = this.visibleObjects().length ? 0 : -1;
  }

  @Client()
  async onSearchKeydown(event: KeyboardEvent) {
    const objects = this.visibleObjects();
    if (!objects.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.searchIndex = (this.searchIndex + 1 + objects.length) % objects.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.searchIndex = (this.searchIndex - 1 + objects.length) % objects.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const object = objects[Math.max(0, this.searchIndex)];
      if (object) await this.chooseObject(object.name);
    } else if (event.key === 'Escape') {
      this.search = '';
      this.searchIndex = -1;
    }
  }

  @Client()
  async toggleSort(column: string) {
    const current = this.sort.find((item) => item.column === column);
    this.sort = current?.direction === 'asc'
      ? [{ column, direction: 'desc' }]
      : current?.direction === 'desc'
        ? []
        : [{ column, direction: 'asc' }];
    await this.reloadRows(this.selected, 1, this.pageSize);
  }

  @Client()
  async applyFilter() {
    if (!this.filterColumn) return;
    const needsValue = this.filterOperator !== 'is-null' && this.filterOperator !== 'is-not-null';
    if (needsValue && !this.filterValue.length) return;
    this.filters = [
      ...this.filters,
      {
        column: this.filterColumn,
        operator: this.filterOperator,
        ...(needsValue ? { value: this.filterValue } : {}),
      },
    ];
    this.filterValue = '';
    await this.reloadRows(this.selected, 1, this.pageSize);
  }

  @Client()
  async removeFilter(index: number) {
    this.filters = this.filters.filter((_, candidate) => candidate !== index);
    await this.reloadRows(this.selected, 1, this.pageSize);
  }

  @Client()
  setSql(value: string) {
    this.sql = value;
  }

  @Client()
  loadQueryHistory() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.queryHistoryStorageKey) ?? '[]');
      if (!Array.isArray(stored)) return;
      this.queryHistory = stored.flatMap((entry): QueryHistoryEntry[] => {
        if (
          !entry ||
          typeof entry.id !== 'string' ||
          typeof entry.statement !== 'string' ||
          typeof entry.executedAt !== 'number'
        ) {
          return [];
        }
        return [{
          id: entry.id,
          statement: entry.statement,
          executedAt: entry.executedAt,
          durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : 0,
          error: typeof entry.error === 'string' ? entry.error : null,
          favorite: entry.favorite === true,
          source: entry.source === 'browse' ? 'browse' : 'sql',
        }];
      }).slice(0, 200);
    } catch {
      this.queryHistory = [];
    }
  }

  @Client()
  persistQueryHistory() {
    try {
      localStorage.setItem(
        this.queryHistoryStorageKey,
        JSON.stringify(this.queryHistory.slice(0, 200)),
      );
    } catch {
      // History is optional when browser storage is disabled or full.
    }
  }

  @Client()
  recordQuery(
    statement: string,
    result: TransportQueryResult,
    source: QueryHistoryEntry['source'],
  ) {
    const normalized = statement.trim();
    if (!normalized) return;
    this.queryHistory = [{
      id: globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      statement: normalized,
      executedAt: Date.now(),
      durationMs: result.durationMs,
      error: result.error ?? null,
      favorite: false,
      source,
    }, ...this.queryHistory].slice(0, 200);
    this.persistQueryHistory();
  }

  @Client()
  toggleQueryFavorite(id: string) {
    this.queryHistory = this.queryHistory.map((entry) =>
      entry.id === id ? { ...entry, favorite: !entry.favorite } : entry);
    this.persistQueryHistory();
  }

  @Client()
  clearQueryHistory() {
    this.queryHistory = this.queryHistory.filter((entry) => entry.favorite);
    this.persistQueryHistory();
  }

  @Client()
  loadHistoryQuery(entry: QueryHistoryEntry) {
    this.sql = entry.statement;
    this.sqlOutput = 'results';
    this.tab = 'sql';
    this.historyOpen = false;
    this.syncUrl(true);
  }

  @Client()
  async runHistoryQuery(entry: QueryHistoryEntry) {
    this.loadHistoryQuery(entry);
    await this.runSqlFromEditor();
  }

  @Client()
  setBrowseQuery(value: string) {
    this.browseQuery = value;
  }

  @Client()
  async runBrowseQuery() {
    const statement = this.browseQuery.trim();
    if (!statement || !this.selected) return;
    this.browseLoading = true;
    this.browseLoadFailed = false;
    this.inlineEditor = null;
    this.sheetEditor = null;
    this.showInsert = false;
    this.selectedRows = [];
    try {
      const executed = await this.executeBrowseStatement(statement);
      if (executed && this.selected) {
        this.loadedObject = this.selected;
        this.customBrowseQuery = true;
        studioSchemaCatalog.set(this.activeSchema);
        this.recordQuery(statement, this.browseResult, 'browse');
      }
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    } finally {
      this.browseLoading = false;
    }
  }

  @Client()
  async runSqlFromEditor() {
    try {
      const result = await this.executeStatement(this.sql, this.filters, this.sort);
      this.loadedObject = this.selected;
      this.browseQuery = this.browseResult.query ?? this.browseQuery;
      this.customBrowseQuery = false;
      this.sqlOutput = 'results';
      this.recordQuery(this.sql, result, 'sql');
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  async runExplainFromEditor() {
    try {
      await this.explainStatement(this.sql);
      this.sqlOutput = 'explain';
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  async followForeignKey(
    foreignKey: StudioForeignKey,
    rowIndex: number,
  ) {
    const target = this.activeSchema.objects.find(
      (object) => object.name === foreignKey.referencedTable,
    );
    const row = this.browseResult.rows[rowIndex];
    if (!target || !row) return;
    const filters = foreignKey.columns.flatMap((column): BrowseFilter[] => {
      const value = row[column.column];
      return value === null || value === undefined
        ? []
        : [{
            column: column.referencedColumn,
            operator: 'eq',
            value: editableValue(value),
          }];
    });
    if (filters.length !== foreignKey.columns.length) return;
    await this.chooseObject(target.name, filters);
  }

  @Client()
  keyForRow(object: StudioObject, rowIndex: number): Record<string, unknown> {
    const row = this.browseResult.rows[rowIndex];
    const locator = object.rowLocators.find((candidate) =>
      candidate.columns.every((column) =>
        row?.[column] !== null && row?.[column] !== undefined));
    if (!locator) return {};
    return Object.fromEntries(
      locator.columns.map((column) => [column, row[column]]),
    );
  }

  @Client()
  beginCellEdit(rowIndex: number, columnName: string) {
    const object = this.activeObject;
    const column = object?.columns.find((candidate) => candidate.name === columnName);
    if (!object?.editable || !column || this.customBrowseQuery) return;
    const raw = this.browseResult.rows[rowIndex]?.[columnName];
    const value = editableValue(raw);
    const editor: CellEditor = {
      rowIndex,
      columnName,
      value: column.declaredKind === 'boolean'
        ? value === '1' ? 'true' : value === '0' ? 'false' : value
        : value,
      mode: raw === null ? 'null' : 'value',
      kind: defaultInsertValueKind(column),
    };
    if (column.declaredKind === 'varchar' || column.declaredKind === 'number') {
      this.inlineEditor = editor;
    } else {
      this.sheetEditor = editor;
    }
  }

  @Client()
  updateInlineValue(value: string) {
    if (this.inlineEditor) this.inlineEditor = { ...this.inlineEditor, value, mode: 'value' };
  }

  @Client()
  setInlineMode(mode: CellMode) {
    if (this.inlineEditor) this.inlineEditor = { ...this.inlineEditor, mode };
  }

  @Client()
  async onInlineKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.inlineEditor = null;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      await this.saveInlineEditor();
    }
  }

  @Client()
  async saveInlineEditor() {
    const editor = this.inlineEditor;
    const object = this.activeObject;
    if (!editor || !object) return;
    const originalKey = this.keyForRow(object, editor.rowIndex);
    this.inlineEditor = null;
    try {
      await this.updateGridCell(
        object.name,
        originalKey,
        editor.columnName,
        editor.mode === 'null' ? { mode: 'null' } : { mode: 'value', value: editor.value },
        this.page,
        this.pageSize,
        this.filters,
        this.sort,
      );
      this.loadedObject = object.name;
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  updateSheetValue(value: string) {
    if (this.sheetEditor) this.sheetEditor = { ...this.sheetEditor, value, mode: 'value' };
  }

  @Client()
  setSheetSelection(selection: CellSelection) {
    const editor = this.sheetEditor;
    if (!editor) return;
    if (selection === 'null') {
      this.sheetEditor = { ...editor, mode: 'null' };
      return;
    }
    let value = editor.value;
    const temporal = localDateTimeDefaults();
    if (selection === 'boolean') value = value === 'false' ? 'false' : 'true';
    if (selection === 'json' && !value.trim()) value = '{}';
    if (selection === 'date' && !value.trim()) value = temporal.date;
    if (selection === 'datetime' && !value.trim()) value = temporal.datetime;
    if (selection === 'timestamp') value = temporal.timestamp;
    if (selection === 'uuid-v4' || selection === 'uuid-v7') {
      value = this.generateInsertUuid(selection);
    }
    this.sheetEditor = {
      ...editor,
      mode: 'value',
      kind: selection,
      value,
    };
  }

  @Client()
  async saveSheetEditor() {
    const editor = this.sheetEditor;
    const object = this.activeObject;
    if (!editor || !object) return;
    if (editor.kind === 'json' && editor.mode === 'value') {
      try {
        JSON.parse(editor.value);
      } catch (error: any) {
        this.message = `Invalid JSON: ${error?.message ?? String(error)}`;
        this.messageError = true;
        return;
      }
    }
    try {
      await this.updateGridCell(
        object.name,
        this.keyForRow(object, editor.rowIndex),
        editor.columnName,
        editor.mode === 'null'
          ? { mode: 'null' }
          : { mode: 'value', value: editor.value, valueKind: editor.kind },
        this.page,
        this.pageSize,
        this.filters,
        this.sort,
      );
      this.loadedObject = object.name;
      this.sheetEditor = null;
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  rowJson(object: StudioObject, rowIndex: number): Record<string, unknown> {
    const row = this.browseResult.rows[rowIndex] ?? {};
    return Object.fromEntries(
      object.columns
        .filter((column) => !column.hidden)
        .map((column) => [column.name, exportValue(row[column.name])]),
    );
  }

  @Client()
  openRowEditor(rowIndex: number) {
    const object = this.activeObject;
    if (!object?.editable || this.customBrowseQuery) return;
    this.rowEditor = {
      rowIndex,
      value: JSON.stringify(this.rowJson(object, rowIndex), null, 2),
      error: '',
    };
  }

  @Client()
  setRowEditorValue(value: string) {
    if (this.rowEditor) this.rowEditor = { ...this.rowEditor, value, error: '' };
  }

  @Client()
  async saveRowEditor() {
    const editor = this.rowEditor;
    const object = this.activeObject;
    if (!editor || !object) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.value);
    } catch (error: any) {
      this.rowEditor = {
        ...editor,
        error: `Invalid JSON: ${error?.message ?? String(error)}`,
      };
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.rowEditor = { ...editor, error: 'The row must be a JSON object.' };
      return;
    }
    const original = this.rowJson(object, editor.rowIndex);
    const changes = Object.fromEntries(
      Object.entries(parsed).filter(([name, value]) =>
        JSON.stringify(value) !== JSON.stringify(original[name])),
    );
    if (!Object.keys(changes).length) {
      this.rowEditor = null;
      this.message = 'No row changes to save.';
      this.messageError = false;
      return;
    }
    try {
      await this.updateGridRow(
        object.name,
        this.keyForRow(object, editor.rowIndex),
        changes,
        this.page,
        this.pageSize,
        this.filters,
        this.sort,
      );
      this.loadedObject = object.name;
      this.rowEditor = null;
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.rowEditor = {
        ...editor,
        error: error?.message ?? String(error),
      };
    }
  }

  @Client()
  requestDelete(rowIndex: number) {
    const object = this.activeObject;
    if (!object?.editable) return;
    this.deleteTarget = { table: object.name, keys: [this.keyForRow(object, rowIndex)] };
  }

  @Client()
  requestDeleteSelected() {
    const object = this.activeObject;
    if (!object?.editable || !this.selectedRows.length) return;
    this.deleteTarget = {
      table: object.name,
      keys: this.selectedRows.map((index) => this.keyForRow(object, index)),
    };
  }

  @Client()
  async confirmDelete() {
    const target = this.deleteTarget;
    if (!target) return;
    this.deleteTarget = null;
    try {
      await this.deleteGridRows(
        target.table,
        target.keys,
        this.page,
        this.pageSize,
        this.filters,
        this.sort,
      );
      this.loadedObject = target.table;
      this.selectedRows = [];
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  toggleInsert() {
    const next = !this.showInsert;
    this.showInsert = next;
    this.insertError = '';
    if (next && this.activeObject) {
      const defaults = localDateTimeDefaults();
      this.insertTemporalDefaults = defaults;
      this.insertFields = Object.fromEntries(
        this.activeObject.columns
          .filter((column) => !column.hidden)
          .map((column) => {
            const valueKind = defaultInsertValueKind(column);
            let value = '';
            if (valueKind === 'boolean') value = 'true';
            if (valueKind === 'json') value = '{}';
            if (valueKind === 'date') value = defaults.date;
            if (valueKind === 'datetime') value = defaults.datetime;
            if (valueKind === 'timestamp') value = defaults.timestamp;
            return [column.name, { mode: 'value', valueKind, value }];
          }),
      );
      void this.refreshInsertTemporalDefaults(this.activeObject.name, defaults);
    }
  }

  @Client()
  async refreshInsertTemporalDefaults(
    objectName: string,
    previous: { date: string; datetime: string; timestamp: string },
  ) {
    try {
      const defaults = await this.getInsertTemporalDefaults();
      if (!this.showInsert || this.activeObject?.name !== objectName) return;
      this.insertFields = Object.fromEntries(
        Object.entries(this.insertFields).map(([name, field]) => {
          let value = field.value;
          if (field.valueKind === 'date' && (value === previous.date || !value)) {
            value = defaults.date;
          }
          if (field.valueKind === 'datetime' && (value === previous.datetime || !value)) {
            value = defaults.datetime;
          }
          if (field.valueKind === 'timestamp' && (value === previous.timestamp || !value)) {
            value = defaults.timestamp;
          }
          return [name, { ...field, value }];
        }),
      );
      this.insertTemporalDefaults = defaults;
    } catch {
      // The browser-clock fallback remains usable if the server clock cannot be read.
    }
  }

  @Client()
  setInsertValue(name: string, value: string) {
    const field = this.insertFields[name] ?? {
      mode: 'value',
      valueKind: 'text',
      value: '',
    };
    this.insertFields = {
      ...this.insertFields,
      [name]: { ...field, mode: 'value', value },
    };
  }

  @Client()
  setInsertValueKind(name: string, kind: InsertValueKind) {
    const field = this.insertFields[name] ?? {
      mode: 'value',
      valueKind: kind,
      value: '',
    };
    let value = field.value;
    if (kind === 'boolean') value = value === 'false' ? 'false' : 'true';
    if (kind === 'json' && !value.trim()) value = '{}';
    if (kind === 'date' && !value.trim()) value = this.insertTemporalDefaults.date;
    if (kind === 'datetime' && !value.trim()) value = this.insertTemporalDefaults.datetime;
    if (kind === 'timestamp') {
      value = this.insertTemporalDefaults.timestamp;
      void this.refreshInsertTimestamp(name);
    }
    if (kind === 'uuid-v4' || kind === 'uuid-v7') value = this.generateInsertUuid(kind);
    this.insertFields = {
      ...this.insertFields,
      [name]: { mode: 'value', valueKind: kind, value },
    };
  }

  @Client()
  async refreshInsertTimestamp(name: string) {
    try {
      const defaults = await this.getInsertTemporalDefaults();
      if (!this.showInsert || this.insertFields[name]?.valueKind !== 'timestamp') return;
      this.setInsertValue(name, defaults.timestamp);
      this.insertTemporalDefaults = defaults;
    } catch {
      // Keep the timestamp captured when the insert sheet opened.
    }
  }

  @Client()
  regenerateInsertUuid(name: string) {
    const kind = this.insertFields[name]?.valueKind;
    if (kind !== 'uuid-v4' && kind !== 'uuid-v7') return;
    this.setInsertValue(name, this.generateInsertUuid(kind));
  }

  @Client()
  generateInsertUuid(kind: 'uuid-v4' | 'uuid-v7'): string {
    if (kind === 'uuid-v4') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index--) {
      bytes[index] = timestamp & 0xff;
      timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  @Client()
  setInsertSelection(name: string, selection: InsertSelection) {
    const field = this.insertFields[name] ?? {
      mode: 'value',
      valueKind: 'text',
      value: '',
    };
    if (selection === 'omit' || selection === 'null') {
      this.insertFields = {
        ...this.insertFields,
        [name]: { ...field, mode: selection },
      };
      return;
    }
    this.setInsertValueKind(name, selection);
  }

  @Client()
  async submitInsert() {
    const object = this.activeObject;
    if (!object) return;
    this.insertError = '';
    const cells = Object.fromEntries(
      object.columns.filter((column) => !column.hidden).map((column) => {
        const field = this.insertFields[column.name] ?? {
          mode: 'value',
          valueKind: defaultInsertValueKind(column),
          value: '',
        };
        const mode = field.mode;
        return [column.name, mode === 'value'
          ? {
              mode,
              value: field.value,
              valueKind: field.valueKind,
            }
          : { mode }];
      }),
    ) as Record<string, InsertCell>;
    try {
      const result = await this.insertGridRow(
        object.name,
        cells,
        this.pageSize,
        this.filters,
        this.sort,
      );
      if (!result?.ok) {
        const message = result?.error ?? 'The row could not be inserted. Check the server log for details.';
        this.insertError = message;
        this.message = message;
        this.messageError = true;
        return;
      }
      this.loadedObject = object.name;
      this.showInsert = false;
      this.insertFields = {};
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      this.insertError = message;
      this.message = message;
      this.messageError = true;
    }
  }

  @Client()
  toggleRowSelection(rowIndex: number, checked: boolean) {
    this.selectedRows = checked
      ? [...new Set([...this.selectedRows, rowIndex])]
      : this.selectedRows.filter((index) => index !== rowIndex);
  }

  @Client()
  toggleAllRows(checked: boolean) {
    this.selectedRows = checked
      ? this.browseResult.rows.map((_, index) => index)
      : [];
  }

  @Client()
  openExport(rowIndexes: number[], collection = false) {
    const object = this.activeObject;
    if (!object) return;
    this.exportSheet = {
      rowIndexes,
      format: 'json',
      collection,
      columns: this.browseResult.columns.length
        ? [...this.browseResult.columns]
        : object.columns.filter((column) => !column.hidden).map((column) => column.name),
    };
  }

  @Client()
  toggleExportColumn(name: string, checked: boolean) {
    if (!this.exportSheet) return;
    this.exportSheet = {
      ...this.exportSheet,
      columns: checked
        ? [...new Set([...this.exportSheet.columns, name])]
        : this.exportSheet.columns.filter((column) => column !== name),
    };
  }

  @Client()
  downloadExport() {
    const object = this.activeObject;
    const state = this.exportSheet;
    if (!object || !state || !state.columns.length) return;
    const rows = state.rowIndexes
      .map((index) => this.browseResult.rows[index])
      .filter(Boolean)
      .map((row) => Object.fromEntries(
        state.columns.map((column) => [column, exportValue(row[column])]),
      ));
    const content = state.format === 'json'
      ? JSON.stringify(state.collection || rows.length !== 1 ? rows : rows[0], null, 2)
      : [
          state.columns.map(csvCell).join(','),
          ...rows.map((row) => state.columns.map((column) => csvCell(row[column])).join(',')),
        ].join('\r\n');
    const blob = new Blob([content], {
      type: state.format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${object.name}-${state.collection || rows.length !== 1 ? 'rows' : 'row'}.${state.format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.exportSheet = null;
  }

  @Client()
  openBatchUpdate() {
    const column = this.activeObject?.columns.find((candidate) => !candidate.hidden);
    if (column) this.batchUpdate = { column: column.name, mode: 'value', value: '' };
  }

  @Client()
  async submitBatchUpdate() {
    const object = this.activeObject;
    const update = this.batchUpdate;
    if (!object?.editable || !update || !this.selectedRows.length) return;
    try {
      await this.updateGridRows(
        object.name,
        this.selectedRows.map((index) => this.keyForRow(object, index)),
        update.column,
        update.mode === 'null' ? { mode: 'null' } : { mode: 'value', value: update.value },
        this.page,
        this.pageSize,
        this.filters,
        this.sort,
      );
      this.loadedObject = object.name;
      this.batchUpdate = null;
      this.selectedRows = [];
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Server()
  async loadRows(
    name: string,
    page: number,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ) {
    this.browseResult = await getStudioDatabase().browse(name, { page, pageSize, filters, sort });
    this.selected = name;
    this.page = this.browseResult.page ?? page;
    this.pageSize = this.browseResult.pageSize ?? pageSize;
    this.message = '';
    this.messageError = false;
  }

  @Server()
  async loadPragmas(): Promise<StudioPragma[]> {
    this.pragmas = await getStudioDatabase().getPragmas();
    this.message = '';
    this.messageError = false;
    return this.pragmas;
  }

  @Server()
  async updatePragmaSetting(name: string, value: string): Promise<StudioPragma[]> {
    this.pragmas = await getStudioDatabase().setPragma(name, value);
    this.message = `PRAGMA ${name} updated.`;
    this.messageError = false;
    return this.pragmas;
  }

  @Server()
  async executeStatement(
    statement: string,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ): Promise<TransportQueryResult> {
    this.sqlResult = await getStudioDatabase().executeSql(statement);
    this.schema = await getStudioDatabase().getSchema();
    if (this.selected && this.schema.objects.some((object) => object.name === this.selected)) {
      this.browseResult = await getStudioDatabase().browse(this.selected, {
        page: this.page,
        pageSize: this.pageSize,
        filters,
        sort,
      });
      this.page = this.browseResult.page ?? this.page;
    } else if (this.selected) {
      this.selected = '';
      this.browseResult = emptyResult;
    }
    this.message = this.sqlResult.error
      ? this.sqlResult.error
      : `Completed in ${this.sqlResult.durationMs.toFixed(1)} ms`;
    this.messageError = Boolean(this.sqlResult.error);
    return this.sqlResult;
  }

  @Server()
  async explainStatement(statement: string): Promise<TransportQueryResult> {
    this.explainResult = await getStudioDatabase().explainSql(statement);
    this.message = this.explainResult.error
      ? this.explainResult.error
      : `Query plan generated in ${this.explainResult.durationMs.toFixed(1)} ms`;
    this.messageError = Boolean(this.explainResult.error);
    return this.explainResult;
  }

  @Server()
  async executeBrowseStatement(statement: string): Promise<boolean> {
    const result = await getStudioDatabase().executeSql(statement);
    this.schema = await getStudioDatabase().getSchema();
    if (result.error) {
      this.message = result.error;
      this.messageError = true;
      return false;
    }
    if (this.selected && !this.schema.objects.some((object) => object.name === this.selected)) {
      this.selected = '';
      this.browseResult = emptyResult;
      this.message = `Completed in ${result.durationMs.toFixed(1)} ms`;
      this.messageError = false;
      return true;
    }
    this.browseResult = {
      ...result,
      totalRows: result.rows.length,
      page: 1,
      pageSize: result.rows.length || this.pageSize,
      objectName: this.selected,
      query: statement,
    };
    this.page = 1;
    this.message = result.affectedRows
      ? `${result.affectedRows} affected row${result.affectedRows === 1 ? '' : 's'} · ${result.durationMs.toFixed(1)} ms`
      : `${result.rows.length} returned row${result.rows.length === 1 ? '' : 's'} · ${result.durationMs.toFixed(1)} ms`;
    this.messageError = false;
    return true;
  }

  @Server()
  async updateGridCell(
    table: string,
    key: Record<string, unknown>,
    column: string,
    value: { mode: 'null' } | {
      mode: 'value';
      value: string;
      valueKind?: InsertValueKind;
    },
    page: number,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ) {
    const mutation = await getStudioDatabase().update(table, key, column, value);
    this.schema = mutation.schema;
    this.browseResult = await getStudioDatabase().browse(table, {
      page,
      pageSize,
      filters,
      sort,
    });
    this.page = this.browseResult.page ?? page;
    this.message = 'Row updated.';
    this.messageError = false;
  }

  @Server()
  async updateGridRow(
    table: string,
    key: Record<string, unknown>,
    values: Record<string, unknown>,
    page: number,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ) {
    const database = getStudioDatabase();
    const mutation = await database.updateRow(table, key, values);
    this.schema = mutation.schema;
    this.browseResult = await database.browse(table, { page, pageSize, filters, sort });
    this.page = this.browseResult.page ?? page;
    this.message = 'Row updated.';
    this.messageError = false;
  }

  @Server()
  async deleteGridRows(
    table: string,
    keys: Array<Record<string, unknown>>,
    page: number,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ) {
    const database = getStudioDatabase();
    const mutation = keys.length === 1
      ? await database.delete(table, keys[0])
      : await database.deleteMany(table, keys);
    this.schema = mutation.schema;
    this.browseResult = await database.browse(table, { page, pageSize, filters, sort });
    this.page = this.browseResult.page ?? page;
    this.message = `${mutation.affectedRows} row${mutation.affectedRows === 1 ? '' : 's'} deleted.`;
    this.messageError = false;
  }

  @Server()
  async updateGridRows(
    table: string,
    keys: Array<Record<string, unknown>>,
    column: string,
    value: { mode: 'null' } | { mode: 'value'; value: string },
    page: number,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ) {
    const database = getStudioDatabase();
    const mutation = await database.updateMany(table, keys, column, value);
    this.schema = mutation.schema;
    this.browseResult = await database.browse(table, { page, pageSize, filters, sort });
    this.page = this.browseResult.page ?? page;
    this.message = `${mutation.affectedRows} row${mutation.affectedRows === 1 ? '' : 's'} updated.`;
    this.messageError = false;
  }

  @Server()
  async getInsertTemporalDefaults(): Promise<{
    date: string;
    datetime: string;
    timestamp: string;
  }> {
    return localDateTimeDefaults();
  }

  @Server()
  async insertGridRow(
    table: string,
    cells: Record<string, InsertCell>,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const database = getStudioDatabase();
      const mutation = await database.insert(table, cells);
      this.schema = mutation.schema;
      this.browseResult = await database.browse(table, {
        page: 1,
        pageSize,
        filters,
        sort,
      });
      this.page = 1;
      this.message = 'Row inserted.';
      this.messageError = false;
      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? String(error),
      };
    }
  }

  iconButton(
    icon: IconEntry,
    label: string,
    onClick: () => unknown,
    options: Record<string, unknown> = {},
  ) {
    return component(Tooltip, { label, side: 'bottom' }, component(Button, {
      variant: 'ghost',
      size: 'icon',
      'aria-label': label,
      title: label,
      '@click': onClick,
      ...options,
    }, component(Icon, { entry: icon, size: 17 })));
  }

  render() {
    const schema = this.activeSchema;
    const object = this.activeObject;
    const objects = this.visibleObjects(schema);
    const paletteObjects = schema.objects.filter((candidate) => {
      if (candidate.name === 'kysely_migration') return this.showKyselyMigration;
      if (candidate.name === 'kysely_migration_lock') return this.showKyselyMigrationLock;
      return true;
    });
    const hiddenSystemTables = schema.objects.filter((candidate) => SYSTEM_TABLES.has(candidate.name));
    const remote = schema.connection.remote;

    return html`
      <main class="studio-grid grid h-screen bg-muted/20">
        <header class="col-span-2 flex items-center justify-between gap-4 border-b bg-card px-5">
          <div class="flex min-w-0 items-center gap-3">
            <strong class="shrink-0 tracking-tight">Cossack Studio</strong>
            <span class="hidden h-4 w-px bg-border sm:block"></span>
            <span class="hidden min-w-0 truncate text-sm font-medium sm:block" title="${schema.applicationName}">
              ${schema.applicationName}
            </span>
            ${component(Badge, { variant: remote ? 'destructive' : 'secondary' },
              `${schema.connection.label}${remote ? ' · REMOTE D1' : ' · local'}`)}
            ${schema.connection.databaseVersion ? html`
              <span
                class="hidden shrink-0 text-xs text-muted-foreground md:inline"
                data-testid="database-version"
              >
                ${schema.connection.databaseVersion}
              </span>
            ` : ''}
          </div>
          <div class="flex items-center gap-3">
            ${remote ? html`
              <div class="hidden rounded-md bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive md:block">
                Writes affect deployed data immediately
              </div>
            ` : ''}
            ${this.iconButton(
              this.theme === 'dark' ? SunIcon : MoonIcon,
              this.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
              this.toggleTheme,
              { 'data-testid': 'theme-toggle' },
            )}
          </div>
        </header>

        <aside class="row-start-2 flex min-h-0 flex-col border-r bg-sidebar">
          <div class="space-y-2 border-b p-3">
            ${component(Button, {
              variant: 'outline',
              class: 'w-full justify-between gap-3 bg-background',
              'data-testid': 'open-command-palette',
              '@click': () => { this.paletteOpen = true; },
            }, html`
              <span class="inline-flex min-w-0 items-center gap-2">
                ${component(Icon, { entry: MagnifierIcon, size: 16 })}
                <span class="truncate">Command palette</span>
              </span>
              ${component(Kbd, {}, 'Ctrl K')}
            `)}
            ${component(InputGroup, {
              placeholder: 'Search tables and views…',
              role: 'combobox',
              'aria-expanded': Boolean(objects.length),
              'aria-controls': 'studio-object-list',
              'aria-activedescendant': this.searchIndex >= 0
                ? `studio-object-${this.searchIndex}`
                : undefined,
              'data-testid': 'object-search',
              '.value': this.search,
              '@input': (event: InputEvent) => this.onSearchInput(
                (event.target as HTMLInputElement).value,
              ),
              '@keydown': this.onSearchKeydown,
              suffix: hiddenSystemTables.length
                ? component(DropdownMenu, {
                    side: 'bottom',
                    align: 'end',
                    trigger: component(Tooltip, {
                      label: `System table: ${hiddenSystemTables.length}`,
                      side: 'right',
                    }, html`
                      <span
                        class="inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        data-testid="system-table-trigger"
                      >
                        ${component(Icon, { entry: FiltersIcon, size: 15 })}
                        <span class="sr-only">System table: ${hiddenSystemTables.length}</span>
                      </span>
                    `),
                  }, html`
                    <div class="grid gap-2 p-2" data-testid="system-table-menu">
                      ${hiddenSystemTables.map((candidate) => component(Checkbox, {
                        checked: candidate.name === 'kysely_migration'
                          ? this.showKyselyMigration
                          : this.showKyselyMigrationLock,
                        '@change': (event: InputEvent) => {
                          const checked = (event.target as HTMLInputElement).checked;
                          if (candidate.name === 'kysely_migration') this.showKyselyMigration = checked;
                          else this.showKyselyMigrationLock = checked;
                        },
                      }, candidate.name))}
                    </div>
                  `)
                : component(Tooltip, {
                    label: 'System table: 0',
                    side: 'right',
                  }, html`
                    <span class="inline-flex h-7 w-7 items-center justify-center opacity-50">
                      ${component(Icon, { entry: FiltersIcon, size: 15 })}
                    </span>
                  `),
            })}
          </div>
          <nav
            id="studio-object-list"
            class="min-h-0 flex-1 overflow-y-auto p-2"
            aria-label="Database objects"
            role="listbox"
          >
            ${repeat(objects, (candidate) => candidate.name, (candidate, index) => {
              const selected = candidate.name === this.selected;
              const highlighted = index === this.searchIndex && Boolean(this.search);
              return html`
                <button
                  id="studio-object-${index}"
                  role="option"
                  aria-selected="${selected}"
                  class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-sidebar-accent ${selected || highlighted ? 'bg-sidebar-accent font-medium' : ''}"
                  data-testid="object-${candidate.name}"
                  title="${candidate.kind === 'view' ? 'View' : 'Table'}: ${candidate.name}"
                  @mousemove="${() => { if (this.search) this.searchIndex = index; }}"
                  @click="${() => this.chooseObject(candidate.name)}"
                >
                  <span class="shrink-0 ${selected
                    ? candidate.kind === 'view' ? 'text-chart-2' : 'text-primary'
                    : 'text-muted-foreground'}">
                    ${component(Icon, {
                      entry: candidate.kind === 'view' ? EyeIcon : DatabaseIcon,
                      style: selected ? 'bold-duotone' : candidate.kind === 'view' ? 'line' : 'duotone',
                      size: 16,
                    })}
                  </span>
                  <span class="truncate">${candidate.name}</span>
                </button>
              `;
            })}
          </nav>
          <div
            class="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground"
            data-testid="studio-version"
          >
            Studio v${__COSSACK_STUDIO_VERSION__}
          </div>
        </aside>

        <section class="row-start-2 flex min-w-0 flex-col overflow-hidden bg-background">
          <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
            <div class="flex items-center gap-1">
              ${([
                ['browse', DatabaseIcon, 'Browse'],
                ['structure', StructureIcon, 'Structure'],
                ['sql', CodeSquareIcon, 'SQL'],
                ['pragmas', FiltersIcon, 'Pragmas'],
              ] as const).map(([item, icon, label]) => component(Button, {
                variant: this.tab === item ? 'secondary' : 'ghost',
                size: 'sm',
                class: 'gap-2',
                'data-testid': `tab-${item}`,
                '@click': () => this.switchTab(item),
              }, html`${component(Icon, { entry: icon, size: 16 })}<span>${label}</span>`))}
            </div>
            <div class="flex items-center gap-1">
              ${this.tab === 'browse' && object
                ? this.iconButton(RefreshIcon, 'Refresh rows', () => this.reloadRows(), {
                    disabled: this.browseLoading,
                    'data-testid': 'refresh-rows',
                  })
                : ''}
              ${this.tab === 'browse' && object?.editable && !this.customBrowseQuery
                ? this.iconButton(AddSquareIcon, this.showInsert ? 'Close insert form' : 'Insert row', this.toggleInsert, {
                    'data-testid': 'insert-row',
                    variant: this.showInsert ? 'secondary' : 'ghost',
                  })
                : ''}
              ${this.tab === 'pragmas' &&
                ['sqlite', 'libsql', 'd1-local', 'd1-remote']
                  .includes(this.activeSchema.connection.provider)
                ? this.iconButton(RefreshIcon, 'Refresh pragmas', this.refreshPragmas, {
                    disabled: Boolean(this.loading.refreshPragmas),
                    'data-testid': 'refresh-pragmas',
                  })
                : ''}
            </div>
          </div>

          ${this.message ? html`
            <div class="${this.messageError ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-muted-foreground'} shrink-0 border-b px-4 py-2 text-sm" role="status">
              ${this.message}
            </div>
          ` : ''}

          <div class="studio-tab-panel flex min-h-0 flex-1 flex-col">
            ${this.renderBrowse(object, this.tab === 'browse')}
            ${this.renderStructure(object, this.tab === 'structure')}
            ${this.renderSql(this.tab === 'sql')}
            ${this.renderPragmas(this.tab === 'pragmas')}
          </div>
        </section>

        ${this.renderInsert(object)}
        ${this.renderQueryHistory()}
        ${this.renderCellEditor(object)}
        ${this.renderRowEditor(object)}
        ${this.renderExportSheet(object)}
        ${this.renderBatchUpdateSheet(object)}
        ${component(CommandPalette, {
          open: this.paletteOpen,
          commands: paletteObjects.map((candidate) => ({
            id: candidate.name,
            label: candidate.name,
            group: candidate.kind === 'view' ? 'Views' : 'Tables',
            icon: candidate.kind === 'view' ? EyeIcon : DatabaseIcon,
          })),
          placeholder: 'Search tables and views…',
          onOpenChange: (open: boolean) => { this.paletteOpen = open; },
          onSelect: (id: string) => { void this.chooseObject(id); },
          'data-testid': 'studio-command-palette',
        })}
        ${component(AlertDialog, {
          open: Boolean(this.deleteTarget),
          title: `Delete ${this.deleteTarget?.keys.length ?? 0} selected row${this.deleteTarget?.keys.length === 1 ? '' : 's'}?`,
          description: `This action runs immediately against ${this.deleteTarget?.table ?? 'the table'} and cannot be undone.`,
          cancelLabel: 'Cancel',
          actionLabel: this.loading.deleteGridRows ? 'Deleting…' : 'Delete',
          onClose: () => { this.deleteTarget = null; },
          onAction: this.confirmDelete,
          'data-testid': 'delete-dialog',
        })}
      </main>
    `;
  }

  renderBrowse(object: StudioObject | undefined, active: boolean) {
    if (!object) return html`
      <div class="${active ? 'grid' : 'hidden'} min-h-0 flex-1 place-items-center text-muted-foreground">
        Select a table or view to browse it.
      </div>
    `;

    const resultMatches = this.loadedObject === object.name;
    const rows = resultMatches ? this.browseResult.rows : [];
    const columns = resultMatches && this.browseResult.columns.length
      ? this.browseResult.columns
      : object.columns.filter((column) => !column.hidden).map((column) => column.name);
    const totalRows = resultMatches ? this.browseResult.totalRows ?? rows.length : 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / this.pageSize));
    const firstRow = totalRows ? (this.page - 1) * this.pageSize + 1 : 0;
    const lastRow = Math.min(totalRows, firstRow + rows.length - 1);
    const allSelected = rows.length > 0 && this.selectedRows.length === rows.length;
    const quote = this.activeSchema.connection.provider === 'mysql'
      ? `\`${object.name.replaceAll('`', '``')}\``
      : `"${object.name.replaceAll('"', '""')}"`;
    const generatedQuery = resultMatches
      ? this.browseResult.query ?? ''
      : `SELECT * FROM ${quote} LIMIT ${this.pageSize} OFFSET 0`;
    const query = this.browseQuery || generatedQuery;
    const gridEditable = object.editable && !this.customBrowseQuery;

    return html`
      <div class="${active ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col">
        ${!object.editable ? html`
          <div class="shrink-0 border-b bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            ${object.readOnlyReason}
          </div>
        ` : ''}

        <div class="shrink-0 border-b bg-muted/15 px-4 py-2">
          <div class="mb-2 flex flex-wrap items-center gap-2" data-testid="browse-toolbar">
            ${this.iconButton(FilterIcon, this.showFilter ? 'Hide filters' : 'Add filter', () => {
              this.showFilter = !this.showFilter;
            }, { variant: this.showFilter ? 'secondary' : 'ghost' })}
            ${this.filters.map((filter, index) => html`
              <button
                type="button"
                class="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent"
                title="Remove filter"
                @click="${() => this.removeFilter(index)}"
              >
                ${filter.column} ${FILTER_OPERATORS.find((operator) => operator.value === filter.operator)?.label}
                ${filter.value === undefined ? '' : ` “${filter.value}”`} ×
              </button>
            `)}
            ${this.sort.length ? html`
              <span class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">
                ${component(Icon, { entry: SortIcon, size: 13 })}
                ${this.sort[0].column} ${this.sort[0].direction.toUpperCase()}
              </span>
            ` : ''}
            <span class="ml-auto">
              ${this.iconButton(
                PlayIcon,
                this.browseLoading ? 'Running browse query' : 'Execute browse query',
                this.runBrowseQuery,
                {
                  disabled: this.browseLoading,
                  'data-testid': 'run-browse-query',
                  variant: 'default',
                  class: 'h-8 w-8 shadow-sm',
                },
              )}
            </span>
          </div>
          ${this.showFilter ? html`
            <div class="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
              <select
                class="h-9 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="filter-column"
                .value="${this.filterColumn || object.columns[0]?.name || ''}"
                @change="${(event: InputEvent) => {
                  this.filterColumn = (event.target as HTMLSelectElement).value;
                }}"
              >
                ${object.columns.filter((column) => !column.hidden).map((column) => html`
                  <option value="${column.name}" ?selected="${column.name === this.filterColumn}">
                    ${column.name}
                  </option>
                `)}
              </select>
              <select
                class="h-9 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="filter-operator"
                .value="${this.filterOperator}"
                @change="${(event: InputEvent) => {
                  this.filterOperator = (event.target as HTMLSelectElement).value as BrowseFilterOperator;
                }}"
              >
                ${FILTER_OPERATORS.map((operator) => html`
                  <option value="${operator.value}" ?selected="${operator.value === this.filterOperator}">
                    ${operator.label}
                  </option>
                `)}
              </select>
              ${this.filterOperator === 'is-null' || this.filterOperator === 'is-not-null' ? '' : component(Input, {
                class: 'max-w-64',
                placeholder: 'Filter value',
                '.value': this.filterValue,
                '@input': (event: InputEvent) => {
                  this.filterValue = (event.target as HTMLInputElement).value;
                },
                '@keydown': (event: KeyboardEvent) => {
                  if (event.key === 'Enter') void this.applyFilter();
                },
              })}
              ${component(Button, {
                size: 'sm',
                '@click': this.applyFilter,
              }, 'Apply')}
            </div>
          ` : ''}
          ${component(CodeEditor, {
            class: 'h-[5rem]',
            value: query,
            language: 'sql',
            theme: this.theme,
            schema: this.activeSchema,
            enabled: active,
            lineNumbers: 'off',
            ariaLabel: 'Current browse query',
            'data-testid': 'browse-query',
            onChange: this.setBrowseQuery,
            onRun: this.runBrowseQuery,
          })}
        </div>

        ${this.selectedRows.length ? html`
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2">
            <strong class="text-sm">${this.selectedRows.length} selected</strong>
            ${gridEditable ? component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': this.requestDeleteSelected,
            }, html`${component(Icon, { entry: TrashBinMinimalisticIcon, size: 15 })}Delete selected`) : ''}
            ${gridEditable ? component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': this.openBatchUpdate,
            }, html`${component(Icon, { entry: PenIcon, size: 15 })}Update selected`) : ''}
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': () => this.openExport(this.selectedRows, true),
            }, html`${component(Icon, { entry: ExportIcon, size: 15 })}Export selected`)}
            ${component(Button, {
              variant: 'ghost',
              size: 'sm',
              '@click': () => { this.selectedRows = []; },
            }, 'Clear')}
          </div>
        ` : ''}

        <div class="min-h-0 flex-1 overflow-auto" data-testid="data-grid">
          <table class="w-full border-collapse text-sm">
            <thead class="sticky top-0 z-10 bg-muted">
              <tr>
                <th class="w-10 border-b border-r px-3 py-2">
                  ${component(Checkbox, {
                    checked: allSelected,
                    indeterminate: this.selectedRows.length > 0 && !allSelected,
                    'aria-label': 'Select all rows on this page',
                    '@change': (event: InputEvent) => this.toggleAllRows(
                      (event.target as HTMLInputElement).checked,
                    ),
                  })}
                </th>
                ${columns.map((column) => {
                  const sorting = this.sort.find((item) => item.column === column);
                  return html`
                    <th class="studio-cell border-b border-r px-3 py-2 text-left font-medium">
                      ${this.customBrowseQuery ? html`<span>${column}</span>` : html`
                        <button
                          type="button"
                          class="flex w-full items-center gap-1.5 text-left hover:text-primary"
                          title="Sort by ${column}"
                          @click="${() => this.toggleSort(column)}"
                        >
                          <span>${column}</span>
                          ${sorting ? html`
                            <span class="text-xs text-primary">${sorting.direction === 'asc' ? '↑' : '↓'}</span>
                          ` : ''}
                        </button>
                      `}
                    </th>
                  `;
                })}
                <th class="w-28 border-b px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr class="${this.browseLoading ? '' : 'hidden'}" data-testid="rows-loading">
                <td class="p-8 text-center text-muted-foreground" colspan="${columns.length + 2}">
                  Loading rows…
                </td>
              </tr>
              <tr class="${!this.browseLoading && (this.browseLoadFailed || !resultMatches)
                ? ''
                : 'hidden'}">
                <td class="p-8 text-center text-destructive" colspan="${columns.length + 2}">
                  Rows could not be loaded. Use Refresh to try again.
                </td>
              </tr>
              ${rows.map((row, rowIndex) => html`
                <tr
                  class="${this.browseLoading ? 'hidden' : ''} hover:bg-muted/40"
                  data-testid="grid-row"
                >
                  <td class="border-b border-r px-3 py-2">
                    ${component(Checkbox, {
                      checked: this.selectedRows.includes(rowIndex),
                      'aria-label': `Select row ${rowIndex + 1}`,
                      '@change': (event: InputEvent) => this.toggleRowSelection(
                        rowIndex,
                        (event.target as HTMLInputElement).checked,
                      ),
                    })}
                  </td>
                  ${columns.map((columnName) => {
                    const column = object.columns.find((candidate) => candidate.name === columnName);
                    const editing = this.inlineEditor?.rowIndex === rowIndex &&
                      this.inlineEditor.columnName === columnName;
                    const foreignKey = object.foreignKeys.find((candidate) =>
                      candidate.columns.some((item) => item.column === columnName) &&
                      this.activeSchema.objects.some(
                        (target) => target.name === candidate.referencedTable,
                      ) &&
                      candidate.columns.every((item) =>
                        row[item.column] !== null && row[item.column] !== undefined));
                    return html`
                      <td
                        class="studio-cell border-b border-r px-3 py-2 font-mono"
                        title="${gridEditable ? 'Double-click to edit' : ''}"
                        @dblclick="${() => this.beginCellEdit(rowIndex, columnName)}"
                      >
                        ${editing ? html`
                          <div class="flex min-w-52 items-center gap-1">
                            <input
                              autofocus
                              type="${column?.declaredKind === 'number' ? 'number' : 'text'}"
                              class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                              data-testid="inline-editor"
                              ?disabled="${this.inlineEditor?.mode === 'null'}"
                              .value="${this.inlineEditor?.value ?? ''}"
                              @input="${(event: InputEvent) => this.updateInlineValue(
                                (event.target as HTMLInputElement).value,
                              )}"
                              @keydown="${this.onInlineKeydown}"
                              @blur="${this.saveInlineEditor}"
                            />
                            ${column?.nullable ? html`
                              <button
                                type="button"
                                class="h-8 rounded-md border px-2 text-[10px] ${this.inlineEditor?.mode === 'null' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}"
                                title="Toggle an explicit NULL value"
                                @mousedown="${(event: MouseEvent) => event.preventDefault()}"
                                @click="${() => this.setInlineMode(
                                  this.inlineEditor?.mode === 'null' ? 'value' : 'null',
                                )}"
                              >NULL</button>
                            ` : ''}
                          </div>
                        ` : foreignKey ? html`
                          <button
                            type="button"
                            class="inline-flex max-w-full items-center gap-1.5 text-primary hover:underline"
                            title="Open ${foreignKey.referencedTable}"
                            data-testid="foreign-key-${columnName}-${rowIndex}"
                            @click="${() => this.followForeignKey(foreignKey, rowIndex)}"
                            @dblclick="${(event: MouseEvent) => event.stopPropagation()}"
                          >
                            <span class="truncate">${displayValue(row[columnName])}</span>
                            ${component(Icon, { entry: LinkIcon, size: 13 })}
                          </button>
                        ` : html`
                          <span class="studio-cell-value ${row[columnName] === null ? 'italic text-muted-foreground' : ''}">
                            ${displayValue(row[columnName])}
                          </span>
                        `}
                      </td>
                    `;
                  })}
                  <td class="border-b px-2 text-center">
                    <div class="flex justify-center gap-1">
                      ${gridEditable
                        ? this.iconButton(PenIcon, 'Edit row as JSON', () => this.openRowEditor(rowIndex), {
                            'data-testid': `edit-row-${rowIndex}`,
                          })
                        : ''}
                      ${this.iconButton(ExportIcon, 'Export row', () => this.openExport([rowIndex]))}
                      ${gridEditable
                        ? this.iconButton(TrashBinMinimalisticIcon, 'Delete row', () => this.requestDelete(rowIndex))
                        : ''}
                    </div>
                  </td>
                </tr>
              `)}
              <tr
                class="${!this.browseLoading && resultMatches && !rows.length ? '' : 'hidden'}"
                data-testid="rows-empty"
              >
                <td class="p-8 text-center text-muted-foreground" colspan="${columns.length + 2}">
                  No rows found.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-2">
          <div class="flex items-center gap-3 text-sm text-muted-foreground">
            <span data-testid="row-count">
              ${formatCount(totalRows)} row${totalRows === 1 ? '' : 's'}
              ${totalRows && !this.customBrowseQuery
                ? ` · ${formatCount(firstRow)}–${formatCount(lastRow)}`
                : ''}
            </span>
            ${this.customBrowseQuery ? html`
              <span>
                Custom query · read-only results
                ${this.browseResult.truncated ? ' · truncated at 1,000 rows' : ''}
                · Refresh to reset
              </span>
            ` : html`<label class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                class="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                data-testid="page-size"
                .value="${String(this.pageSize)}"
                @change="${(event: InputEvent) => this.changePageSize(
                  (event.target as HTMLSelectElement).value,
                )}"
              >
                ${[25, 50, 100, 250, 500].map((size) => html`
                  <option value="${size}" ?selected="${size === this.pageSize}">${size}</option>
                `)}
              </select>
            </label>`}
          </div>
          <div class="${this.customBrowseQuery ? 'hidden' : 'flex'} items-center gap-2">
            <span class="mr-1 text-sm text-muted-foreground">Page ${this.page} of ${totalPages}</span>
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              disabled: Boolean(this.page <= 1 || this.browseLoading),
              '@click': () => this.changePage(this.page - 1),
            }, 'Previous')}
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              disabled: Boolean(this.page >= totalPages || this.browseLoading),
              '@click': () => this.changePage(this.page + 1),
            }, 'Next')}
          </div>
        </footer>
      </div>
    `;
  }

  renderStructure(object: StudioObject | undefined, active: boolean) {
    if (!object) return html`
      <div class="${active ? 'block' : 'hidden'} min-h-0 flex-1 p-6 text-muted-foreground">
        Select a database object.
      </div>
    `;
    return html`
      <div class="${active ? 'block' : 'hidden'} min-h-0 flex-1 overflow-auto p-5">
        <table class="w-full text-sm" data-testid="structure-table">
          <thead><tr class="border-b text-left">
            <th class="p-2">Column</th><th class="p-2">Type</th><th class="p-2">Affinity</th>
            <th class="p-2 text-center">Nullable</th><th class="p-2">Default</th><th class="p-2">Key</th>
          </tr></thead>
          <tbody>${object.columns.map((column) => html`
            <tr class="border-b">
              <td class="p-2 font-medium">${column.name}</td>
              <td class="p-2 font-mono">${column.dataType || '—'}</td>
              <td class="p-2">${column.affinity}</td>
              <td class="p-2 text-center">${component(Checkbox, {
                checked: column.nullable,
                disabled: true,
                'aria-label': `${column.name} ${column.nullable ? 'is nullable' : 'is required'}`,
              })}</td>
              <td class="p-2 font-mono">${column.defaultValue ?? '—'}</td>
              <td class="p-2">
                ${column.primaryKeyPosition ? component(Tooltip, {
                  label: `Primary key position ${column.primaryKeyPosition}${column.autoIncrement ? ' · auto increment' : ''}`,
                }, html`
                  <span class="inline-flex items-center gap-1.5 text-primary">
                    ${component(Icon, { entry: KeyIcon, size: 16 })}
                    <span>PK ${column.primaryKeyPosition}${column.autoIncrement ? ' · auto' : ''}</span>
                  </span>
                `) : '—'}
              </td>
            </tr>
          `)}</tbody>
        </table>

        <section class="mt-6">
          <h3 class="mb-2 font-semibold">Row identity</h3>
          ${object.rowLocators.length ? html`
            <div class="flex flex-wrap gap-2" data-testid="row-locators">
              ${object.rowLocators.map((locator) => component(Badge, {
                variant: locator.kind === 'primary-key' ? 'default' : 'secondary',
              }, locator.kind === 'primary-key'
                ? `Primary key: ${locator.columns.join(', ')}`
                : locator.kind === 'unique-index'
                  ? `Unique index: ${locator.name}`
                  : locator.kind === 'sqlite-rowid'
                    ? `SQLite ${locator.source} fallback`
                    : 'PostgreSQL tableoid + ctid fallback'))}
            </div>
          ` : html`
            <p class="text-sm text-muted-foreground">${object.readOnlyReason}</p>
          `}
        </section>

        <section class="mt-6">
          <h3 class="mb-2 font-semibold">Foreign keys</h3>
          ${object.foreignKeys.length ? html`
            <table class="w-full text-sm" data-testid="foreign-key-table">
              <thead><tr class="border-b text-left">
                <th class="p-2">Name</th><th class="p-2">Columns</th>
                <th class="p-2">References</th><th class="p-2">On update</th>
                <th class="p-2">On delete</th>
              </tr></thead>
              <tbody>${object.foreignKeys.map((foreignKey) => html`
                <tr class="border-b">
                  <td class="p-2 font-mono">${foreignKey.name}</td>
                  <td class="p-2 font-mono">
                    ${foreignKey.columns.map((column) => column.column).join(', ')}
                  </td>
                  <td class="p-2 font-mono">
                    ${foreignKey.referencedTable}
                    (${foreignKey.columns.map((column) => column.referencedColumn).join(', ')})
                  </td>
                  <td class="p-2">${foreignKey.onUpdate ?? '—'}</td>
                  <td class="p-2">${foreignKey.onDelete ?? '—'}</td>
                </tr>
              `)}</tbody>
            </table>
          ` : html`<p class="text-sm text-muted-foreground">No foreign keys declared.</p>`}
        </section>

        <section class="mt-6">
          <h3 class="mb-2 font-semibold">Indexes</h3>
          ${object.indexes.length ? html`
            <table class="w-full text-sm" data-testid="index-table">
              <thead><tr class="border-b text-left">
                <th class="p-2">Name</th><th class="p-2">Columns</th>
                <th class="p-2">Unique</th><th class="p-2">Origin</th><th class="p-2">Partial</th>
              </tr></thead>
              <tbody>${object.indexes.map((index) => html`
                <tr class="border-b">
                  <td class="p-2 font-mono">${index.name}</td>
                  <td class="p-2 font-mono">${index.columns
                    .map((column) => `${column.name ?? '(expression)'}${column.descending ? ' DESC' : ''}`)
                    .join(', ')}</td>
                  <td class="p-2">${component(Checkbox, { checked: index.unique, disabled: true })}</td>
                  <td class="p-2">${index.origin}</td>
                  <td class="p-2">${component(Checkbox, { checked: index.partial, disabled: true })}</td>
                </tr>
              `)}</tbody>
            </table>
          ` : html`<p class="text-sm text-muted-foreground">No indexes declared.</p>`}
        </section>

        ${object.sql ? html`
          <section class="mt-6">
            <h3 class="mb-2 font-semibold">Definition</h3>
            ${component(CodeEditor, {
              class: 'h-[12rem]',
              value: object.sql,
              language: 'sql',
              theme: this.theme,
              schema: this.activeSchema,
              enabled: active,
              readOnly: true,
              ariaLabel: `${object.name} SQL definition`,
              'data-testid': 'structure-sql',
            })}
          </section>
        ` : ''}
      </div>
    `;
  }

  renderSql(active: boolean) {
    const output = this.sqlOutput === 'explain' ? this.explainResult : this.sqlResult;
    return html`
      <div class="${active ? 'grid' : 'hidden'} min-h-0 flex-1 grid-rows-[17rem_minmax(0,1fr)]">
        <div class="border-b bg-muted/20 p-4">
          ${component(CodeEditor, {
            class: 'h-[13rem]',
            value: this.sql,
            language: 'sql',
            theme: this.theme,
            schema: this.activeSchema,
            enabled: active,
            ariaLabel: 'SQL statement',
            'data-testid': 'sql-editor',
            onChange: this.setSql,
            onRun: this.runSqlFromEditor,
          })}
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">
              Ctrl/Cmd+Enter to execute · schema-aware completion is cached in browser memory
            </span>
            <div class="flex items-center gap-1">
              ${this.iconButton(HistoryIcon, 'Query history', () => {
                this.historyOpen = true;
              }, {
                'data-testid': 'open-query-history',
              })}
              ${this.iconButton(
                GraphIcon,
                this.loading.runExplainFromEditor ? 'Generating query plan' : 'Explain query',
                this.runExplainFromEditor,
                {
                  disabled: Boolean(this.loading.runExplainFromEditor || !this.sql.trim()),
                  'data-testid': 'explain-sql',
                  variant: this.sqlOutput === 'explain' ? 'secondary' : 'ghost',
                },
              )}
              ${this.iconButton(PlayIcon, this.loading.runSqlFromEditor ? 'Running SQL' : 'Run SQL', this.runSqlFromEditor, {
                disabled: Boolean(this.loading.runSqlFromEditor),
                'data-testid': 'run-sql',
                variant: 'default',
              })}
            </div>
          </div>
        </div>
        <div class="flex min-h-0 flex-col overflow-hidden">
          <div class="flex h-10 shrink-0 items-center gap-1 border-b px-3">
            ${component(Button, {
              variant: this.sqlOutput === 'results' ? 'secondary' : 'ghost',
              size: 'sm',
              'data-testid': 'sql-output-results',
              '@click': () => { this.sqlOutput = 'results'; },
            }, 'Results')}
            ${component(Button, {
              variant: this.sqlOutput === 'explain' ? 'secondary' : 'ghost',
              size: 'sm',
              'data-testid': 'sql-output-explain',
              '@click': () => { this.sqlOutput = 'explain'; },
            }, 'Explain')}
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            ${this.sqlOutput === 'explain' && this.explainJson
              ? component(CodeEditor, {
                  class: 'h-full min-h-[14rem] rounded-none border-0',
                  value: this.explainJson,
                  language: 'json',
                  theme: this.theme,
                  enabled: active,
                  readOnly: true,
                  ariaLabel: 'JSON query plan',
                  'data-testid': 'explain-json',
                })
              : html`
                  <table
                    class="w-full text-sm"
                    data-testid="${this.sqlOutput === 'explain' ? 'explain-results' : 'sql-results'}"
                  >
                    <thead class="sticky top-0 bg-muted"><tr>
                      ${output.columns.map((column) => html`
                        <th class="border-b border-r p-2 text-left">${column}</th>
                      `)}
                    </tr></thead>
                    <tbody>${output.rows.map((row) => html`<tr>
                      ${output.columns.map((column) => html`
                        <td class="border-b border-r p-2 font-mono">
                          ${displayValue(row[column])}
                        </td>
                      `)}
                    </tr>`)}</tbody>
                  </table>
                `}
            <div class="p-3 text-xs text-muted-foreground">
              ${this.sqlOutput === 'explain'
                ? `Plan generated in ${output.durationMs.toFixed(1)} ms`
                : `${output.affectedRows} affected row(s) · ${output.durationMs.toFixed(1)} ms`}
              ${output.truncated ? ' · Results truncated at 1,000 rows' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderQueryHistory() {
    const history = [...this.queryHistory].sort((left, right) =>
      Number(right.favorite) - Number(left.favorite) ||
      right.executedAt - left.executedAt);
    return component(Sheet, {
      open: this.historyOpen,
      side: 'right',
      size: 'min(36rem, 94vw)',
      onClose: () => { this.historyOpen = false; },
      'data-testid': 'query-history',
    }, html`
      <header class="flex shrink-0 items-start justify-between gap-4 border-b p-5">
        <div>
          <h2 class="font-semibold">Query history</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Stored only in this browser for ${this.activeSchema.connection.label}.
          </p>
        </div>
        ${component(Button, {
          variant: 'outline',
          size: 'sm',
          disabled: !history.some((entry) => !entry.favorite),
          '@click': this.clearQueryHistory,
        }, 'Clear history')}
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-4">
        ${history.length ? html`
          <div class="grid gap-3">
            ${history.map((entry) => html`
              <article
                class="rounded-lg border bg-card p-3"
                data-testid="query-history-entry"
              >
                <div class="mb-2 flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    ${component(Badge, {
                      variant: entry.error ? 'destructive' : 'secondary',
                    }, entry.source === 'browse' ? 'Browse' : 'SQL')}
                    <span>${new Date(entry.executedAt).toLocaleString()}</span>
                    <span>${entry.durationMs.toFixed(1)} ms</span>
                  </div>
                  <button
                    type="button"
                    class="${entry.favorite ? 'text-warning' : 'text-muted-foreground'} rounded-md p-1.5 hover:bg-accent"
                    aria-label="${entry.favorite ? 'Remove from saved queries' : 'Save query'}"
                    @click="${() => this.toggleQueryFavorite(entry.id)}"
                  >
                    ${component(Icon, {
                      entry: StarIcon,
                      style: entry.favorite ? 'bold' : 'line',
                      size: 17,
                    })}
                  </button>
                </div>
                <pre class="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">${entry.statement}</pre>
                ${entry.error ? html`
                  <p class="mt-2 line-clamp-2 text-xs text-destructive">${entry.error}</p>
                ` : ''}
                <div class="mt-3 flex justify-end gap-2">
                  ${component(Button, {
                    variant: 'outline',
                    size: 'sm',
                    '@click': () => this.loadHistoryQuery(entry),
                  }, 'Load')}
                  ${component(Button, {
                    size: 'sm',
                    class: 'gap-1.5',
                    '@click': () => this.runHistoryQuery(entry),
                  }, html`${component(Icon, { entry: PlayIcon, size: 14 })}Run`)}
                </div>
              </article>
            `)}
          </div>
        ` : html`
          <div class="grid min-h-64 place-items-center rounded-lg border border-dashed p-6 text-center">
            <div>
              ${component(Icon, { entry: HistoryIcon, size: 28 })}
              <p class="mt-2 text-sm font-medium">No query history yet</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Queries executed from Browse or SQL will appear here.
              </p>
            </div>
          </div>
        `}
      </div>
    `);
  }

  renderPragmas(active: boolean) {
    const supported = ['sqlite', 'libsql', 'd1-local', 'd1-remote']
      .includes(this.activeSchema.connection.provider);
    if (!supported) {
      return html`
        <div
          class="${active ? 'grid' : 'hidden'} min-h-0 flex-1 place-items-center p-6"
          data-testid="pragmas-panel"
        >
          <div class="max-w-lg text-center">
            <h2 class="text-lg font-semibold">Pragmas are not available</h2>
            <p class="mt-2 text-sm text-muted-foreground">
              PRAGMA is a SQLite-family interface. PostgreSQL and MySQL expose their
              server settings through different commands and system views.
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div
        class="${active ? 'block' : 'hidden'} min-h-0 flex-1 overflow-auto p-5"
        data-testid="pragmas-panel"
      >
        <header class="mb-5">
          <h2 class="text-lg font-semibold">SQLite pragmas</h2>
          <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
            Inspect and edit commonly used SQLite settings. Changes are applied immediately;
            whether they affect this connection or the database file depends on the setting.
          </p>
        </header>

        ${!this.pragmas.length && this.loading.refreshPragmas
          ? html`<p class="text-sm text-muted-foreground">Loading pragmas…</p>`
          : ''}
        ${!this.pragmas.length && !this.loading.refreshPragmas
          ? html`
              <div class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No editable pragmas were reported by this database.
              </div>
            `
          : html`
              <div class="overflow-hidden rounded-lg border">
                <table class="w-full text-sm" data-testid="pragmas-table">
                  <thead>
                    <tr class="border-b bg-muted/40 text-left">
                      <th class="w-52 p-3">Pragma</th>
                      <th class="p-3">Description</th>
                      <th class="w-64 p-3">Value</th>
                      <th class="w-24 p-3"><span class="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.pragmas.map((pragma) => {
                      const value = this.pragmaDrafts[pragma.name] ?? pragma.value;
                      const changed = value !== pragma.value;
                      return html`
                        <tr class="border-b last:border-b-0" data-testid="pragma-${pragma.name}">
                          <td class="p-3 align-top font-mono font-medium">${pragma.name}</td>
                          <td class="p-3 align-top text-muted-foreground">${pragma.description}</td>
                          <td class="p-3 align-top">
                            ${pragma.kind === 'boolean'
                              ? html`
                                  <div class="flex h-8 items-center gap-3">
                                    ${component(Switch, {
                                      checked: value === '1',
                                      'aria-label': `${pragma.name} value`,
                                      '@change': (event: InputEvent) => this.setPragmaDraft(
                                        pragma.name,
                                        (event.target as HTMLInputElement).checked ? '1' : '0',
                                      ),
                                    })}
                                    <span class="text-xs text-muted-foreground">
                                      ${value === '1' ? 'On' : 'Off'}
                                    </span>
                                  </div>
                                `
                              : pragma.kind === 'number'
                              ? component(Input, {
                                  type: 'number',
                                  size: 'sm',
                                  '.value': value,
                                  'aria-label': `${pragma.name} value`,
                                  '@input': (event: InputEvent) => this.setPragmaDraft(
                                    pragma.name,
                                    (event.target as HTMLInputElement).value,
                                  ),
                                })
                              : component(Select, {
                                  size: 'sm',
                                  '.value': value,
                                  'aria-label': `${pragma.name} value`,
                                  '@change': (event: InputEvent) => this.setPragmaDraft(
                                    pragma.name,
                                    (event.target as HTMLSelectElement).value,
                                  ),
                                }, html`
                                  ${pragma.options?.map((option) => html`
                                    <option value="${option.value}">${option.label}</option>
                                  `)}
                                `)}
                          </td>
                          <td class="p-3 text-right align-top">
                            ${component(Button, {
                              variant: changed ? 'default' : 'outline',
                              size: 'sm',
                              disabled: Boolean(!changed || this.loading.savePragma),
                              'data-testid': `apply-pragma-${pragma.name}`,
                              '@click': () => this.savePragma(pragma.name),
                            }, this.loading.savePragma ? 'Applying…' : 'Apply')}
                          </td>
                        </tr>
                      `;
                    })}
                  </tbody>
                </table>
              </div>
            `}
      </div>
    `;
  }

  renderInsert(object: StudioObject | undefined) {
    return component(Sheet, {
      open: Boolean(this.showInsert && object?.editable),
      side: 'right',
      size: 'min(42rem, 94vw)',
      onClose: () => { this.showInsert = false; },
      'data-testid': 'insert-form',
    }, html`
      <header class="shrink-0 border-b p-5">
        <h2 class="font-semibold">Insert row</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Add a new row to ${object?.name ?? 'the selected table'}.
        </p>
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-5">
        ${this.insertError ? component(Alert, {
          variant: 'destructive',
          title: 'Could not insert row',
          class: 'mb-4',
          'data-testid': 'insert-error',
        }, this.insertError) : ''}
        <div class="grid grid-cols-1 gap-4">
          ${object?.columns.filter((column) => !column.hidden).map((column) => {
            const field = this.insertFields[column.name] ?? {
              mode: 'value',
              valueKind: defaultInsertValueKind(column),
              value: '',
            };
            const mode = field.mode;
            const valueKind = field.valueKind;
            const selection: InsertSelection = mode === 'value' ? valueKind : mode;
            const value = field.value;
            const activeClass = mode === 'value'
              ? 'studio-insert-value'
              : 'bg-muted/60';
            return html`
              <div class="grid gap-1.5 text-sm" data-testid="insert-field-${column.name}">
                <label class="font-medium" for="insert-value-${column.name}">
                  ${column.name}
                  <small class="ml-1 font-normal text-muted-foreground">${column.dataType}</small>
                </label>
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1 ${mode === 'value'
                    ? ''
                    : 'pointer-events-none opacity-60'}">
                    ${valueKind === 'json' ? component(CodeEditor, {
                      class: `h-[10rem] ${activeClass}`,
                      value,
                      language: 'json',
                      theme: this.theme,
                      readOnly: mode !== 'value',
                      lineNumbers: 'off',
                      ariaLabel: `JSON value for ${column.name}`,
                      'data-testid': `insert-value-${column.name}`,
                      onChange: (nextValue: string) => this.setInsertValue(column.name, nextValue),
                    }) : valueKind === 'date' ? html`
                      <div
                        id="insert-value-${column.name}"
                        class="rounded-md ${activeClass}"
                        data-testid="insert-value-${column.name}"
                      >
                        ${component(DatePicker, {
                          value,
                          onChange: (nextValue: string) =>
                            this.setInsertValue(column.name, nextValue),
                        })}
                      </div>
                    ` : valueKind === 'boolean' ? html`
                      <select
                        id="insert-value-${column.name}"
                        class="h-10 w-full rounded-md border border-input px-3 ${activeClass}"
                        data-testid="insert-value-${column.name}"
                        ?disabled="${mode !== 'value'}"
                        .value="${value}"
                        @change="${(event: InputEvent) => this.setInsertValue(
                          column.name,
                          (event.target as HTMLSelectElement).value,
                        )}"
                      >
                        <option value="true" ?selected="${value !== 'false'}">True</option>
                        <option value="false" ?selected="${value === 'false'}">False</option>
                      </select>
                    ` : html`
                      <div class="flex gap-2">
                        ${component(Input, {
                          id: `insert-value-${column.name}`,
                          class: `min-w-0 flex-1 font-mono ${activeClass}`,
                          type: valueKind === 'number' ? 'number' :
                            valueKind === 'datetime' ? 'datetime-local' : 'text',
                          disabled: mode !== 'value',
                          'data-testid': `insert-value-${column.name}`,
                          '.value': value,
                          '@input': (event: InputEvent) => this.setInsertValue(
                            column.name,
                            (event.target as HTMLInputElement).value,
                          ),
                        })}
                        ${valueKind === 'uuid-v4' || valueKind === 'uuid-v7' ||
                          valueKind === 'timestamp'
                          ? component(Button, {
                              variant: 'outline',
                              size: 'icon',
                              title: valueKind === 'timestamp'
                                ? 'Use current server timestamp'
                                : `Generate another ${valueKind === 'uuid-v4'
                                  ? 'UUID v4'
                                  : 'UUID v7'}`,
                              'aria-label': valueKind === 'timestamp'
                                ? 'Use current server timestamp'
                                : `Generate another ${valueKind === 'uuid-v4'
                                  ? 'UUID v4'
                                  : 'UUID v7'}`,
                              '@click': () => valueKind === 'timestamp'
                                ? this.refreshInsertTimestamp(column.name)
                                : this.regenerateInsertUuid(column.name),
                            }, component(Icon, { entry: RefreshIcon, size: 16 }))
                          : ''}
                      </div>
                    `}
                    ${valueKind === 'blob' ? html`
                      <p class="mt-1 text-xs text-muted-foreground">
                        Enter base64 or an even-length hexadecimal value.
                      </p>
                    ` : ''}
                  </div>
                  <select
                    class="studio-insert-option h-10 w-40 shrink-0 rounded-md border border-input bg-background px-2 text-foreground"
                    data-testid="insert-option-${column.name}"
                    aria-label="Value type or insert mode for ${column.name}"
                    .value="${selection}"
                    @change="${(event: InputEvent) => this.setInsertSelection(
                      column.name,
                      (event.target as HTMLSelectElement).value as InsertSelection,
                    )}"
                  >
                    <optgroup label="Value type">
                      ${INSERT_VALUE_KINDS.map((kind) => html`
                        <option value="${kind.value}" ?selected="${selection === kind.value}">
                          ${kind.label}
                        </option>
                      `)}
                    </optgroup>
                    <optgroup label="Special">
                      <option value="omit" ?selected="${selection === 'omit'}">
                        Omit / default
                      </option>
                      ${column.nullable
                        ? html`<option value="null" ?selected="${selection === 'null'}">NULL</option>`
                        : ''}
                    </optgroup>
                  </select>
                </div>
              </div>
            `;
          }) ?? ''}
        </div>
      </div>
      <footer class="flex shrink-0 justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': this.toggleInsert,
        }, 'Cancel')}
        ${component(Button, {
          disabled: Boolean(this.loading.insertGridRow),
          'data-testid': 'submit-insert',
          '@click': this.submitInsert,
        }, this.loading.insertGridRow ? 'Inserting…' : 'Insert Row')}
      </footer>
    `);
  }

  renderCellEditor(object: StudioObject | undefined) {
    const editor = this.sheetEditor;
    const column = object?.columns.find((candidate) => candidate.name === editor?.columnName);
    const activeEditor: CellEditor = editor ?? {
      rowIndex: 0,
      columnName: '',
      value: '',
      mode: 'value',
      kind: 'text',
    };
    const activeColumn: StudioColumn = column ?? {
      name: 'value',
      dataType: 'TEXT',
      affinity: 'text',
      declaredKind: 'text',
      nullable: true,
      defaultValue: null,
      primaryKeyPosition: 0,
      autoIncrement: false,
      hidden: false,
    };
    return component(Sheet, {
      open: Boolean(editor && column),
      side: 'right',
      size: 'min(42rem, 92vw)',
      onClose: () => { this.sheetEditor = null; },
      'data-testid': 'cell-editor-sheet',
    }, html`
      <header class="flex shrink-0 items-start justify-between border-b p-5">
        <div>
          <h2 class="font-semibold">Edit ${activeColumn.name}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            ${object?.name ?? ''} · ${activeColumn.dataType || activeColumn.affinity}
          </p>
        </div>
        ${component(Button, {
          variant: 'ghost',
          size: 'sm',
          '@click': () => { this.sheetEditor = null; },
        }, 'Close')}
      </header>
      <div class="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <div class="flex flex-wrap items-end gap-4">
          <label class="grid min-w-48 gap-1 text-sm font-medium">
            Value type
            <select
              class="studio-insert-option h-10 rounded-md border border-input bg-background px-3 font-normal text-foreground"
              data-testid="cell-editor-mode"
              aria-label="Value type or edit mode for ${activeColumn.name}"
              .value="${activeEditor.mode === 'null' ? 'null' : activeEditor.kind}"
              @change="${(event: InputEvent) => this.setSheetSelection(
                (event.target as HTMLSelectElement).value as CellSelection,
              )}"
            >
              <optgroup label="Value type">
                ${INSERT_VALUE_KINDS.map((kind) => html`
                  <option
                    value="${kind.value}"
                    ?selected="${activeEditor.mode === 'value' && activeEditor.kind === kind.value}"
                  >
                    ${kind.label}
                  </option>
                `)}
              </optgroup>
              ${activeColumn.nullable || activeEditor.mode === 'null' ? html`
                <optgroup label="Special">
                  <option value="null" ?selected="${activeEditor.mode === 'null'}">NULL</option>
                </optgroup>
              ` : ''}
            </select>
          </label>
        </div>
        <p class="text-xs text-muted-foreground">
          SQLite does not retain application-level TypeScript types. Change the editor mode when
          the declared database type is not specific enough.
        </p>
        <div class="min-h-0 flex-1 ${activeEditor.mode === 'null' ? 'pointer-events-none opacity-50' : ''}">
          <div class="${activeEditor.kind === 'json' ? 'block' : 'hidden'} h-full">
            ${component(CodeEditor, {
              class: 'h-full min-h-[20rem]',
              value: activeEditor.kind === 'json' ? activeEditor.value : '',
              language: 'json',
              theme: this.theme,
              enabled: Boolean(editor?.kind === 'json'),
              ariaLabel: `JSON value for ${activeColumn.name}`,
              'data-testid': 'json-editor',
              onChange: this.updateSheetValue,
              onRun: this.saveSheetEditor,
            })}
          </div>
          <div class="${activeEditor.kind === 'date' ? 'block' : 'hidden'}">
            <div class="grid max-w-sm gap-2">
              <label class="text-sm font-medium">Date</label>
              ${component(DatePicker, {
                value: activeEditor.kind === 'date' ? activeEditor.value.slice(0, 10) : '',
                onChange: this.updateSheetValue,
              })}
            </div>
          </div>
          <div class="${activeEditor.kind === 'datetime' ? 'block' : 'hidden'}">
            <label class="grid max-w-sm gap-2 text-sm font-medium">
              Date and time
              <input
                type="datetime-local"
                class="h-10 rounded-md border border-input bg-background px-3 font-normal"
                .value="${activeEditor.kind === 'datetime'
                  ? activeEditor.value.replace(' ', 'T').slice(0, 16)
                  : ''}"
                @input="${(event: InputEvent) => this.updateSheetValue(
                  (event.target as HTMLInputElement).value,
                )}"
              />
            </label>
          </div>
          <div class="${activeEditor.kind === 'timestamp' ||
            activeEditor.kind === 'uuid-v4' ||
            activeEditor.kind === 'uuid-v7' ? 'block' : 'hidden'}">
            <div class="flex max-w-xl gap-2">
              ${component(Input, {
                class: 'min-w-0 flex-1 font-mono',
                disabled: activeEditor.mode === 'null',
                '.value': activeEditor.kind === 'timestamp' ||
                  activeEditor.kind === 'uuid-v4' ||
                  activeEditor.kind === 'uuid-v7'
                  ? activeEditor.value
                  : '',
                '@input': (event: InputEvent) => this.updateSheetValue(
                  (event.target as HTMLInputElement).value,
                ),
              })}
              ${component(Button, {
                variant: 'outline',
                size: 'icon',
                title: activeEditor.kind === 'timestamp'
                  ? 'Use current timestamp'
                  : 'Generate another UUID',
                'aria-label': activeEditor.kind === 'timestamp'
                  ? 'Use current timestamp'
                  : 'Generate another UUID',
                '@click': () => this.setSheetSelection(activeEditor.kind),
              }, component(Icon, { entry: RefreshIcon, size: 16 }))}
            </div>
          </div>
          <div class="${activeEditor.kind === 'number' ? 'block' : 'hidden'}">
            ${component(Input, {
              type: 'number',
              class: 'max-w-sm font-mono',
              disabled: activeEditor.mode === 'null',
              '.value': activeEditor.kind === 'number' ? activeEditor.value : '',
              '@input': (event: InputEvent) => this.updateSheetValue(
                (event.target as HTMLInputElement).value,
              ),
            })}
          </div>
          <div class="${activeEditor.kind === 'boolean' ? 'block' : 'hidden'}">
            <select
              class="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3"
              .value="${activeEditor.kind === 'boolean' ? activeEditor.value : ''}"
              @change="${(event: InputEvent) => this.updateSheetValue(
                (event.target as HTMLSelectElement).value,
              )}"
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </div>
          <div class="${activeEditor.kind !== 'json' &&
            activeEditor.kind !== 'date' &&
            activeEditor.kind !== 'datetime' &&
            activeEditor.kind !== 'number' &&
            activeEditor.kind !== 'boolean' &&
            activeEditor.kind !== 'timestamp' &&
            activeEditor.kind !== 'uuid-v4' &&
            activeEditor.kind !== 'uuid-v7' ? 'grid' : 'hidden'} h-full grid-rows-[auto_minmax(0,1fr)] gap-2">
            <div class="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2">
              ${activeEditor.kind === 'blob' ? html`
                <p class="text-xs text-muted-foreground">Enter a base64 or even-length hexadecimal blob value.</p>
              ` : ''}
              ${component(Textarea, {
                class: 'h-full min-h-[20rem] resize-none bg-background font-mono',
                'data-testid': 'long-text-editor',
                disabled: activeEditor.mode === 'null',
                '.value': activeEditor.value,
                '@input': (event: InputEvent) => this.updateSheetValue(
                  (event.target as HTMLTextAreaElement).value,
                ),
              })}
            </div>
          </div>
        </div>
      </div>
      <footer class="flex shrink-0 justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': () => { this.sheetEditor = null; },
        }, 'Cancel')}
        ${component(Button, {
          disabled: Boolean(this.loading.updateGridCell),
          'data-testid': 'save-cell-editor',
          '@click': this.saveSheetEditor,
        }, this.loading.updateGridCell ? 'Saving…' : 'Save changes')}
      </footer>
    `);
  }

  renderRowEditor(object: StudioObject | undefined) {
    const editor = this.rowEditor;
    return component(Sheet, {
      open: Boolean(editor && object),
      side: 'right',
      size: 'min(48rem, 94vw)',
      onClose: () => { this.rowEditor = null; },
      'data-testid': 'row-editor-sheet',
    }, html`
      <header class="flex shrink-0 items-start justify-between border-b p-5">
        <div>
          <h2 class="font-semibold">Edit row as JSON</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            ${object?.name ?? ''} · only changed properties are written
          </p>
        </div>
        ${component(Button, {
          variant: 'ghost',
          size: 'sm',
          '@click': () => { this.rowEditor = null; },
        }, 'Close')}
      </header>
      <div class="flex min-h-0 flex-1 flex-col gap-4 p-5">
        ${editor?.error ? component(Alert, {
          variant: 'destructive',
        }, editor.error) : ''}
        ${component(CodeEditor, {
          class: 'min-h-[24rem] flex-1',
          value: editor?.value ?? '{}',
          language: 'json',
          theme: this.theme,
          enabled: Boolean(editor),
          ariaLabel: `JSON row for ${object?.name ?? 'table'}`,
          'data-testid': 'row-json-editor',
          onChange: this.setRowEditorValue,
          onRun: this.saveRowEditor,
        })}
        <p class="text-xs text-muted-foreground">
          Ctrl/Cmd+Enter saves. Remove a property to leave that column unchanged; use
          <code class="mx-1 rounded bg-muted px-1 py-0.5">null</code>
          to write SQL NULL.
        </p>
      </div>
      <footer class="flex shrink-0 justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': () => { this.rowEditor = null; },
        }, 'Cancel')}
        ${component(Button, {
          disabled: Boolean(this.loading.updateGridRow),
          'data-testid': 'save-row-editor',
          '@click': this.saveRowEditor,
        }, this.loading.updateGridRow ? 'Saving…' : 'Save row')}
      </footer>
    `);
  }

  renderExportSheet(object: StudioObject | undefined) {
    const state = this.exportSheet;
    const columns = this.browseResult.columns.length
      ? this.browseResult.columns
      : object?.columns.filter((column) => !column.hidden).map((column) => column.name) ?? [];
    return component(Sheet, {
      open: Boolean(state && object),
      side: 'right',
      size: 'min(32rem, 92vw)',
      onClose: () => { this.exportSheet = null; },
      'data-testid': 'export-sheet',
    }, html`
      <header class="border-b p-5">
        <h2 class="font-semibold">Export ${state?.rowIndexes.length ?? 0} row${state?.rowIndexes.length === 1 ? '' : 's'}</h2>
        <p class="mt-1 text-sm text-muted-foreground">Choose a format and the columns to include.</p>
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-5">
        <label class="grid gap-1 text-sm font-medium">
          Format
          <select
            class="h-10 rounded-md border border-input bg-background px-3 font-normal"
            .value="${state?.format ?? 'json'}"
            @change="${(event: InputEvent) => {
              if (this.exportSheet) {
                this.exportSheet = {
                  ...this.exportSheet,
                  format: (event.target as HTMLSelectElement).value as ExportFormat,
                };
              }
            }}"
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <fieldset class="mt-5 grid gap-3">
          <legend class="mb-2 text-sm font-medium">Columns</legend>
          ${columns.map((column) => component(Checkbox, {
            checked: state?.columns.includes(column) ?? false,
            '@change': (event: InputEvent) => this.toggleExportColumn(
              column,
              (event.target as HTMLInputElement).checked,
            ),
          }, column))}
        </fieldset>
      </div>
      <footer class="flex justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': () => { this.exportSheet = null; },
        }, 'Cancel')}
        ${component(Button, {
          class: 'gap-2',
          disabled: !state?.columns.length,
          '@click': this.downloadExport,
        }, html`${component(Icon, { entry: ExportIcon, size: 16 })}Export`)}
      </footer>
    `);
  }

  renderBatchUpdateSheet(object: StudioObject | undefined) {
    const state = this.batchUpdate;
    const column = object?.columns.find((candidate) => candidate.name === state?.column);
    return component(Sheet, {
      open: Boolean(state && object),
      side: 'right',
      size: 'min(32rem, 92vw)',
      onClose: () => { this.batchUpdate = null; },
      'data-testid': 'batch-update-sheet',
    }, html`
      <header class="border-b p-5">
        <h2 class="font-semibold">Update ${this.selectedRows.length} selected rows</h2>
        <p class="mt-1 text-sm text-muted-foreground">Set one column to the same value for every selected row.</p>
      </header>
      <div class="flex-1 space-y-4 p-5">
        <label class="grid gap-1 text-sm font-medium">
          Column
          <select
            class="h-10 rounded-md border border-input bg-background px-3 font-normal"
            .value="${state?.column ?? ''}"
            @change="${(event: InputEvent) => {
              if (this.batchUpdate) {
                this.batchUpdate = {
                  ...this.batchUpdate,
                  column: (event.target as HTMLSelectElement).value,
                };
              }
            }}"
          >
            ${object?.columns.filter((candidate) => !candidate.hidden).map((candidate) => html`
              <option value="${candidate.name}" ?selected="${candidate.name === state?.column}">
                ${candidate.name}
              </option>
            `)}
          </select>
        </label>
        ${column?.nullable ? component(Checkbox, {
          checked: state?.mode === 'null',
          '@change': (event: InputEvent) => {
            if (this.batchUpdate) {
              this.batchUpdate = {
                ...this.batchUpdate,
                mode: (event.target as HTMLInputElement).checked ? 'null' : 'value',
              };
            }
          },
        }, 'Set an explicit NULL value') : ''}
        ${component(Textarea, {
          class: 'min-h-44 bg-background font-mono',
          disabled: state?.mode === 'null',
          '.value': state?.value ?? '',
          '@input': (event: InputEvent) => {
            if (this.batchUpdate) {
              this.batchUpdate = {
                ...this.batchUpdate,
                value: (event.target as HTMLTextAreaElement).value,
                mode: 'value',
              };
            }
          },
        })}
      </div>
      <footer class="flex justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': () => { this.batchUpdate = null; },
        }, 'Cancel')}
        ${component(Button, {
          disabled: Boolean(this.loading.updateGridRows),
          '@click': this.submitBatchUpdate,
        }, this.loading.updateGridRows ? 'Updating…' : 'Update selected')}
      </footer>
    `);
  }
}
