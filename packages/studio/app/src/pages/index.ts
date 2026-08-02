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
import { CommandPalette } from '@cossackframework/ui/blocks';
import { AddSquareIcon } from '@cossackframework/solar-icons/add-square';
import { CodeSquareIcon } from '@cossackframework/solar-icons/code-square';
import { DatabaseIcon } from '@cossackframework/solar-icons/database';
import { EyeIcon } from '@cossackframework/solar-icons/eye';
import { FiltersIcon } from '@cossackframework/solar-icons/filters';
import { MoonIcon } from '@cossackframework/solar-icons/moon';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier';
import { RefreshIcon } from '@cossackframework/solar-icons/refresh';
import { StructureIcon } from '@cossackframework/solar-icons/structure';
import { SunIcon } from '@cossackframework/solar-icons/sun';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import {
  AlertDialog,
  Badge,
  Button,
  Icon,
  InputGroup,
  Kbd,
  Tooltip,
} from '@cossackframework/ui';
import type {
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
} from '../../../src/lib/query-types';
import { getStudioDatabase } from '../../../src/server/runtime';
import { BrowseTab } from '../components/studio/BrowseTab';
import { CellEditorSheet } from '../components/studio/CellEditorSheet';
import { InsertRowSheet } from '../components/studio/InsertRowSheet';
import {
  BatchUpdateSheet,
  ExportSheet,
  RowEditorSheet,
} from '../components/studio/RowSheets';
import { PragmasTab } from '../components/studio/PragmasTab';
import { QueryHistorySheet } from '../components/studio/QueryHistorySheet';
import { SqlConsole } from '../components/studio/SqlConsole';
import { StructureTab } from '../components/studio/StructureTab';
import { studioSchemaCatalog } from '../schema-store';
import {
  csvCell,
  defaultInsertValueKind,
  editableValue,
  emptyResult,
  exportValue,
  FILTER_OPERATORS,
  localDateTimeDefaults,
  type BatchUpdateState,
  type CellEditor,
  type CellMode,
  type CellSelection,
  type DeleteTarget,
  type ExportFormat,
  type ExportSheetState,
  type InsertFieldState,
  type InsertSelection,
  type QueryHistoryEntry,
  type RowEditorState,
  type StudioTab,
} from '../studio-page';
import { studioTheme, type StudioTheme } from '../theme.client';

declare const __COSSACK_STUDIO_VERSION__: string;

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
      links: [{
        tag: 'link',
        attributes: {
          rel: 'icon',
          type: 'image/svg+xml',
          href: '/logo.svg',
        },
      }],
    };
  }

  visibleObjects(schema = this.activeSchema): StudioObject[] {
    const query = this.search.trim().toLowerCase();
    return schema.objects.filter((candidate) => {
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
    const paletteObjects = schema.objects;
    const remote = schema.connection.remote;

    return html`
      <main class="studio-grid grid h-screen bg-muted/20">
        <header class="col-span-2 flex items-center justify-between gap-4 border-b bg-card px-5">
          <div class="flex min-w-0 items-center gap-3">
            <strong
              class="flex shrink-0 items-center gap-2 tracking-tight"
              data-testid="studio-brand"
            >
              <img
                src="/logo.svg"
                width="20"
                height="20"
                alt="Cossack"
                class="h-5 w-5"
              />
              <span>Studio</span>
            </strong>
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
    return component(BrowseTab, {
      object,
      active,
      schema: this.activeSchema,
      result: this.browseResult,
      loadedObject: this.loadedObject,
      page: this.page,
      pageSize: this.pageSize,
      selectedRows: this.selectedRows,
      customQuery: this.customBrowseQuery,
      query: this.browseQuery,
      loading: this.browseLoading,
      loadFailed: this.browseLoadFailed,
      showFilter: this.showFilter,
      filters: this.filters,
      sort: this.sort,
      filterColumn: this.filterColumn,
      filterOperator: this.filterOperator,
      filterValue: this.filterValue,
      theme: this.theme,
      inlineEditor: this.inlineEditor,
      onToggleFilter: () => { this.showFilter = !this.showFilter; },
      onRemoveFilter: this.removeFilter,
      onRunQuery: this.runBrowseQuery,
      onFilterColumnChange: (column: string) => { this.filterColumn = column; },
      onFilterOperatorChange: (operator: BrowseFilterOperator) => {
        this.filterOperator = operator;
      },
      onFilterValueChange: (value: string) => { this.filterValue = value; },
      onApplyFilter: this.applyFilter,
      onQueryChange: this.setBrowseQuery,
      onDeleteSelected: this.requestDeleteSelected,
      onBatchUpdate: this.openBatchUpdate,
      onExport: this.openExport,
      onClearSelection: () => { this.selectedRows = []; },
      onToggleAllRows: this.toggleAllRows,
      onToggleSort: this.toggleSort,
      onToggleRow: this.toggleRowSelection,
      onBeginCellEdit: this.beginCellEdit,
      onInlineValueChange: this.updateInlineValue,
      onInlineKeydown: this.onInlineKeydown,
      onSaveInlineEditor: this.saveInlineEditor,
      onInlineModeChange: this.setInlineMode,
      onFollowForeignKey: this.followForeignKey,
      onEditRow: this.openRowEditor,
      onDeleteRow: this.requestDelete,
      onPageSizeChange: this.changePageSize,
      onPageChange: this.changePage,
    });
  }

  renderStructure(object: StudioObject | undefined, active: boolean) {
    return component(StructureTab, {
      object,
      active,
      theme: this.theme,
      schema: this.activeSchema,
    });
  }

  renderSql(active: boolean) {
    return component(SqlConsole, {
      active,
      sql: this.sql,
      theme: this.theme,
      schema: this.activeSchema,
      output: this.sqlOutput,
      sqlResult: this.sqlResult,
      explainResult: this.explainResult,
      explainJson: this.explainJson,
      running: Boolean(this.loading.runSqlFromEditor),
      explaining: Boolean(this.loading.runExplainFromEditor),
      onSqlChange: this.setSql,
      onRun: this.runSqlFromEditor,
      onExplain: this.runExplainFromEditor,
      onOpenHistory: () => { this.historyOpen = true; },
      onOutputChange: (output: 'results' | 'explain') => { this.sqlOutput = output; },
    });
  }

  renderQueryHistory() {
    return component(QueryHistorySheet, {
      open: this.historyOpen,
      connectionLabel: this.activeSchema.connection.label,
      history: this.queryHistory,
      onClose: () => { this.historyOpen = false; },
      onClear: this.clearQueryHistory,
      onToggleFavorite: this.toggleQueryFavorite,
      onLoad: this.loadHistoryQuery,
      onRun: this.runHistoryQuery,
    });
  }

  renderPragmas(active: boolean) {
    return component(PragmasTab, {
      schema: this.activeSchema,
      pragmas: this.pragmas,
      drafts: this.pragmaDrafts,
      active,
      loading: Boolean(this.loading.refreshPragmas),
      saving: Boolean(this.loading.savePragma),
      onDraftChange: this.setPragmaDraft,
      onSave: this.savePragma,
    });
  }

  renderInsert(object: StudioObject | undefined) {
    return component(InsertRowSheet, {
      object,
      open: this.showInsert,
      fields: this.insertFields,
      error: this.insertError,
      theme: this.theme,
      inserting: Boolean(this.loading.insertGridRow),
      onClose: () => { this.showInsert = false; },
      onValueChange: this.setInsertValue,
      onSelectionChange: this.setInsertSelection,
      onRegenerateValue: (column: string, kind: InsertValueKind) => {
        if (kind === 'timestamp') this.refreshInsertTimestamp(column);
        else this.regenerateInsertUuid(column);
      },
      onSubmit: this.submitInsert,
    });
  }

  renderCellEditor(object: StudioObject | undefined) {
    return component(CellEditorSheet, {
      object,
      editor: this.sheetEditor,
      theme: this.theme,
      saving: Boolean(this.loading.updateGridCell),
      onClose: () => { this.sheetEditor = null; },
      onSelectionChange: this.setSheetSelection,
      onValueChange: this.updateSheetValue,
      onSave: this.saveSheetEditor,
    });
  }

  renderRowEditor(object: StudioObject | undefined) {
    return component(RowEditorSheet, {
      object,
      editor: this.rowEditor,
      theme: this.theme,
      saving: Boolean(this.loading.updateGridRow),
      onClose: () => { this.rowEditor = null; },
      onChange: this.setRowEditorValue,
      onSave: this.saveRowEditor,
    });
  }

  renderExportSheet(object: StudioObject | undefined) {
    return component(ExportSheet, {
      object,
      state: this.exportSheet,
      browseColumns: this.browseResult.columns,
      onClose: () => { this.exportSheet = null; },
      onFormatChange: (format: ExportFormat) => {
        if (this.exportSheet) this.exportSheet = { ...this.exportSheet, format };
      },
      onToggleColumn: this.toggleExportColumn,
      onDownload: this.downloadExport,
    });
  }

  renderBatchUpdateSheet(object: StudioObject | undefined) {
    return component(BatchUpdateSheet, {
      object,
      state: this.batchUpdate,
      selectedCount: this.selectedRows.length,
      saving: Boolean(this.loading.updateGridRows),
      onClose: () => { this.batchUpdate = null; },
      onColumnChange: (column: string) => {
        if (this.batchUpdate) this.batchUpdate = { ...this.batchUpdate, column };
      },
      onNullChange: (isNull: boolean) => {
        if (this.batchUpdate) {
          this.batchUpdate = {
            ...this.batchUpdate,
            mode: isNull ? 'null' : 'value',
          };
        }
      },
      onValueChange: (value: string) => {
        if (this.batchUpdate) {
          this.batchUpdate = { ...this.batchUpdate, value, mode: 'value' };
        }
      },
      onSubmit: this.submitBatchUpdate,
    });
  }
}
