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
import { KeyIcon } from '@cossackframework/solar-icons/key';
import { MoonIcon } from '@cossackframework/solar-icons/moon';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier';
import { PenIcon } from '@cossackframework/solar-icons/pen';
import { PlayIcon } from '@cossackframework/solar-icons/play';
import { RefreshIcon } from '@cossackframework/solar-icons/refresh';
import { SortIcon } from '@cossackframework/solar-icons/sort';
import { StructureIcon } from '@cossackframework/solar-icons/structure';
import { SunIcon } from '@cossackframework/solar-icons/sun';
import { TrashBinMinimalisticIcon } from '@cossackframework/solar-icons/trash-bin-minimalistic';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  DatePicker,
  DropdownMenu,
  Icon,
  Input,
  Kbd,
  Sheet,
  Textarea,
  Tooltip,
} from '@cossackframework/ui';
import type {
  BrowseFilter,
  BrowseFilterOperator,
  BrowseSort,
  InsertCell,
  StudioColumn,
  StudioObject,
  StudioSchema,
  TransportQueryResult,
  TransportValue,
} from '../../../src/lib/types';
import { getStudioDatabase } from '../../../src/server/runtime';
import { CodeEditor } from '../components/CodeEditor';
import { studioSchemaCatalog } from '../schema-store';
import { studioTheme, type StudioTheme } from '../theme.client';

type CellMode = 'null' | 'value';
type StudioTab = 'browse' | 'structure' | 'sql';
type InsertMode = 'omit' | 'null' | 'value';
type ExportFormat = 'json' | 'csv';

interface CellEditor {
  rowIndex: number;
  columnName: string;
  value: string;
  mode: CellMode;
  kind: StudioColumn['declaredKind'];
}

interface DeleteTarget {
  table: string;
  keys: Array<Record<string, unknown>>;
}

interface ExportSheetState {
  rowIndexes: number[];
  format: ExportFormat;
  columns: string[];
}

interface BatchUpdateState {
  column: string;
  mode: CellMode;
  value: string;
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
  @ClientState() insertValues: Record<string, string> = {};
  @ClientState() insertModes: Record<string, InsertMode> = {};
  @ClientState() filters: BrowseFilter[] = [];
  @ClientState() sort: BrowseSort[] = [];
  @ClientState() filterColumn = '';
  @ClientState() filterOperator: BrowseFilterOperator = 'contains';
  @ClientState() filterValue = '';
  @ClientState() selectedRows: number[] = [];
  @ClientState() inlineEditor: CellEditor | null = null;
  @ClientState() sheetEditor: CellEditor | null = null;
  @ClientState() deleteTarget: DeleteTarget | null = null;
  @ClientState() exportSheet: ExportSheetState | null = null;
  @ClientState() batchUpdate: BatchUpdateState | null = null;
  @ClientState() browseLoading = false;
  @ClientState() loadedObject = '';
  @ClientState() browseLoadFailed = false;
  @ClientState() paletteOpen = false;
  @ClientState() restoringUrl = false;
  @ClientState() theme: StudioTheme = 'dark';

  private disconnectTheme?: () => void;

  onMount() {
    this.theme = studioTheme.get();
    this.disconnectTheme = studioTheme.subscribe((theme) => {
      this.theme = theme;
    });
    studioSchemaCatalog.set(this.activeSchema);
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
      this.tab = requestedTab === 'structure' || requestedTab === 'sql' ? requestedTab : 'browse';
      const requestedSize = Number(params.get('pageSize') ?? 100);
      this.pageSize = [25, 50, 100, 250, 500].includes(requestedSize) ? requestedSize : 100;
      const object = this.activeSchema.objects.find((candidate) => candidate.name === params.get('table'));
      if (!object) {
        this.selected = '';
        this.loadedObject = '';
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
    } finally {
      this.restoringUrl = false;
    }
  }

  @OnWindow('popstate')
  onHistoryNavigation() {
    void this.restoreFromUrl();
  }

  @Client()
  async chooseObject(name: string) {
    this.selected = name;
    this.loadedObject = '';
    this.browseLoadFailed = false;
    this.page = 1;
    this.tab = 'browse';
    this.filters = [];
    this.sort = [];
    this.filterColumn = this.activeSchema.objects.find((object) => object.name === name)
      ?.columns[0]?.name ?? '';
    this.searchIndex = -1;
    this.inlineEditor = null;
    this.sheetEditor = null;
    this.selectedRows = [];
    this.syncUrl(true);
    await this.reloadRows(name, 1, this.pageSize);
  }

  @Client()
  switchTab(tab: StudioTab) {
    this.startViewTransition(() => {
      this.tab = tab;
      this.syncUrl(true);
    }, ['studio-tab']);
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
  async runSqlFromEditor() {
    try {
      await this.executeStatement(this.sql, this.filters, this.sort);
      this.loadedObject = this.selected;
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  keyForRow(object: StudioObject, rowIndex: number): Record<string, unknown> {
    return Object.fromEntries(
      object.columns
        .filter((column) => column.primaryKeyPosition > 0)
        .map((column) => [column.name, this.browseResult.rows[rowIndex]?.[column.name]]),
    );
  }

  @Client()
  beginCellEdit(rowIndex: number, columnName: string) {
    const object = this.activeObject;
    const column = object?.columns.find((candidate) => candidate.name === columnName);
    if (!object?.editable || !column) return;
    const raw = this.browseResult.rows[rowIndex]?.[columnName];
    const value = editableValue(raw);
    const editor: CellEditor = {
      rowIndex,
      columnName,
      value: column.declaredKind === 'boolean'
        ? value === '1' ? 'true' : value === '0' ? 'false' : value
        : value,
      mode: raw === null ? 'null' : 'value',
      kind: column.declaredKind,
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
  setSheetMode(mode: CellMode) {
    if (this.sheetEditor) this.sheetEditor = { ...this.sheetEditor, mode };
  }

  @Client()
  setSheetKind(kind: StudioColumn['declaredKind']) {
    if (this.sheetEditor) this.sheetEditor = { ...this.sheetEditor, kind };
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
        editor.mode === 'null' ? { mode: 'null' } : { mode: 'value', value: editor.value },
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
    if (next && this.activeObject) {
      this.insertModes = Object.fromEntries(
        this.activeObject.columns
          .filter((column) => !column.hidden)
          .map((column) => [column.name, 'value']),
      );
    }
  }

  @Client()
  setInsertValue(name: string, value: string) {
    this.insertValues = { ...this.insertValues, [name]: value };
    this.insertModes = { ...this.insertModes, [name]: 'value' };
  }

  @Client()
  setInsertMode(name: string, mode: InsertMode) {
    this.insertModes = { ...this.insertModes, [name]: mode };
  }

  @Client()
  async submitInsert() {
    const object = this.activeObject;
    if (!object) return;
    const cells = Object.fromEntries(object.columns.map((column) => {
      const mode = this.insertModes[column.name] ?? 'value';
      return [column.name, mode === 'value'
        ? { mode, value: this.insertValues[column.name] ?? '' }
        : { mode }];
    })) as Record<string, InsertCell>;
    try {
      await this.insertGridRow(
        object.name,
        cells,
        this.pageSize,
        this.filters,
        this.sort,
      );
      this.loadedObject = object.name;
      this.showInsert = false;
      this.insertModes = {};
      this.insertValues = {};
      studioSchemaCatalog.set(this.activeSchema);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
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
  openExport(rowIndexes: number[]) {
    const object = this.activeObject;
    if (!object) return;
    this.exportSheet = {
      rowIndexes,
      format: 'json',
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
      ? JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2)
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
    anchor.download = `${object.name}-${rows.length === 1 ? 'row' : 'rows'}.${state.format}`;
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
  async executeStatement(statement: string, filters: BrowseFilter[] = [], sort: BrowseSort[] = []) {
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
  }

  @Server()
  async updateGridCell(
    table: string,
    key: Record<string, unknown>,
    column: string,
    value: { mode: 'null' } | { mode: 'value'; value: string },
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
  async insertGridRow(
    table: string,
    cells: Record<string, InsertCell>,
    pageSize: number,
    filters: BrowseFilter[] = [],
    sort: BrowseSort[] = [],
  ) {
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
            ${component(Input, {
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
            })}
            ${hiddenSystemTables.length ? component(DropdownMenu, {
              block: true,
              side: 'bottom',
              align: 'start',
              trigger: html`
                <span class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  ${component(Icon, { entry: FiltersIcon, size: 15 })}
                  <span>System tables</span>
                  <span class="ml-auto">${hiddenSystemTables.length}</span>
                </span>
              `,
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
            `) : ''}
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
        </aside>

        <section class="row-start-2 flex min-w-0 flex-col overflow-hidden bg-background">
          <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
            <div class="flex items-center gap-1">
              ${([
                ['browse', DatabaseIcon, 'Browse'],
                ['structure', StructureIcon, 'Structure'],
                ['sql', CodeSquareIcon, 'SQL'],
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
              ${this.tab === 'browse' && object?.editable
                ? this.iconButton(AddSquareIcon, this.showInsert ? 'Close insert form' : 'Insert row', this.toggleInsert, {
                    'data-testid': 'insert-row',
                    variant: this.showInsert ? 'secondary' : 'ghost',
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
          </div>
        </section>

        ${this.renderCellEditor(object)}
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
    const query = resultMatches
      ? this.browseResult.query ?? ''
      : `SELECT * FROM "${object.name.replaceAll('"', '""')}" LIMIT ${this.pageSize} OFFSET 0`;

    return html`
      <div class="${active ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col">
        ${!object.editable ? html`
          <div class="shrink-0 border-b bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            ${object.readOnlyReason}
          </div>
        ` : ''}

        <div class="studio-insert-collapse shrink-0" data-open="${this.showInsert}">
          <div>${this.renderInsert(object)}</div>
        </div>

        <div class="shrink-0 border-b bg-muted/15 px-4 py-2">
          <div class="mb-2 flex flex-wrap items-center gap-2">
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
            readOnly: true,
            lineNumbers: 'off',
            ariaLabel: 'Current browse query',
            'data-testid': 'browse-query',
          })}
        </div>

        ${this.selectedRows.length ? html`
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2">
            <strong class="text-sm">${this.selectedRows.length} selected</strong>
            ${object.editable ? component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': this.requestDeleteSelected,
            }, html`${component(Icon, { entry: TrashBinMinimalisticIcon, size: 15 })}Delete selected`) : ''}
            ${object.editable ? component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': this.openBatchUpdate,
            }, html`${component(Icon, { entry: PenIcon, size: 15 })}Update selected`) : ''}
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': () => this.openExport(this.selectedRows),
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
                    </th>
                  `;
                })}
                <th class="w-24 border-b px-3 py-2">Actions</th>
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
                    return html`
                      <td
                        class="studio-cell border-b border-r px-3 py-2 font-mono"
                        title="${object.editable ? 'Double-click to edit' : ''}"
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
                      ${this.iconButton(ExportIcon, 'Export row', () => this.openExport([rowIndex]))}
                      ${object.editable
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
              ${totalRows ? ` · ${formatCount(firstRow)}–${formatCount(lastRow)}` : ''}
            </span>
            <label class="flex items-center gap-2">
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
            </label>
          </div>
          <div class="flex items-center gap-2">
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
            ${this.iconButton(PlayIcon, this.loading.runSqlFromEditor ? 'Running SQL' : 'Run SQL', this.runSqlFromEditor, {
              disabled: this.loading.runSqlFromEditor,
              'data-testid': 'run-sql',
              variant: 'default',
            })}
          </div>
        </div>
        <div class="overflow-auto">
          <table class="w-full text-sm" data-testid="sql-results">
            <thead class="sticky top-0 bg-muted"><tr>
              ${this.sqlResult.columns.map((column) => html`
                <th class="border-b border-r p-2 text-left">${column}</th>
              `)}
            </tr></thead>
            <tbody>${this.sqlResult.rows.map((row) => html`<tr>
              ${this.sqlResult.columns.map((column) => html`
                <td class="border-b border-r p-2 font-mono">${displayValue(row[column])}</td>
              `)}
            </tr>`)}</tbody>
          </table>
          <div class="p-3 text-xs text-muted-foreground">
            ${this.sqlResult.affectedRows} affected row(s) · ${this.sqlResult.durationMs.toFixed(1)} ms
            ${this.sqlResult.truncated ? ' · Results truncated at 1,000 rows' : ''}
          </div>
        </div>
      </div>
    `;
  }

  renderInsert(object: StudioObject) {
    return html`
      <div class="max-h-72 overflow-auto border-b bg-muted/20 p-4" data-testid="insert-form">
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          ${object.columns.filter((column) => !column.hidden).map((column) => {
            const mode = this.insertModes[column.name] ?? 'value';
            return html`
              <label class="grid gap-1 text-sm" data-testid="insert-field-${column.name}">
                <span>${column.name} <small class="text-muted-foreground">${column.dataType}</small></span>
                <div class="flex gap-2">
                  ${component(Input, {
                    class: 'min-w-0 flex-1',
                    type: column.declaredKind === 'number' ? 'number' :
                      column.declaredKind === 'date' ? 'date' :
                        column.declaredKind === 'datetime' ? 'datetime-local' : 'text',
                    disabled: mode !== 'value',
                    '.value': this.insertValues[column.name] ?? '',
                    '@input': (event: InputEvent) => this.setInsertValue(
                      column.name,
                      (event.target as HTMLInputElement).value,
                    ),
                  })}
                  <select
                    class="w-36 rounded-md border border-input bg-background px-2 text-foreground"
                    .value="${mode}"
                    @change="${(event: InputEvent) => this.setInsertMode(
                      column.name,
                      (event.target as HTMLSelectElement).value as InsertMode,
                    )}"
                  >
                    <option value="value" ?selected="${mode === 'value'}">value</option>
                    <option value="omit" ?selected="${mode === 'omit'}">omit / default</option>
                    ${column.nullable
                      ? html`<option value="null" ?selected="${mode === 'null'}">NULL</option>`
                      : ''}
                  </select>
                </div>
              </label>
            `;
          })}
        </div>
        <div class="mt-3 flex justify-end gap-2">
          ${component(Button, {
            variant: 'ghost',
            size: 'sm',
            '@click': this.toggleInsert,
          }, 'Cancel')}
          ${component(Button, {
            size: 'sm',
            disabled: this.loading.insertGridRow,
            'data-testid': 'submit-insert',
            '@click': this.submitInsert,
          }, this.loading.insertGridRow ? 'Inserting…' : 'Insert Row')}
        </div>
      </div>
    `;
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
            Editor mode
            <select
              class="h-10 rounded-md border border-input bg-background px-3 font-normal"
              data-testid="cell-editor-mode"
              .value="${activeEditor.kind}"
              @change="${(event: InputEvent) => this.setSheetKind(
                (event.target as HTMLSelectElement).value as StudioColumn['declaredKind'],
              )}"
            >
              <option value="text">Text</option>
              <option value="varchar">Short text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="datetime">Date and time</option>
              <option value="boolean">Boolean</option>
              <option value="json">JSON</option>
              <option value="blob">Blob / binary</option>
              <option value="other">Other</option>
            </select>
          </label>
          ${activeColumn.nullable ? component(Checkbox, {
            checked: activeEditor.mode === 'null',
            '@change': (event: InputEvent) => this.setSheetMode(
              (event.target as HTMLInputElement).checked ? 'null' : 'value',
            ),
          }, 'Set an explicit NULL value') : ''}
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
            activeEditor.kind !== 'boolean' ? 'grid' : 'hidden'} h-full grid-rows-[auto_minmax(0,1fr)] gap-2">
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
          disabled: this.loading.updateGridCell,
          'data-testid': 'save-cell-editor',
          '@click': this.saveSheetEditor,
        }, this.loading.updateGridCell ? 'Saving…' : 'Save changes')}
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
          disabled: this.loading.updateGridRows,
          '@click': this.submitBatchUpdate,
        }, this.loading.updateGridRows ? 'Updating…' : 'Update selected')}
      </footer>
    `);
  }
}
