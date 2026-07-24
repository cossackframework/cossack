import {
  Client,
  ClientState,
  Cossack,
  Page,
  Server,
  State,
  server$,
} from '@cossackframework/core';
import { component, html, repeat } from '@cossackframework/renderer';
import { DatabaseIcon } from '@cossackframework/solar-icons/database';
import { EyeIcon } from '@cossackframework/solar-icons/eye';
import { FiltersIcon } from '@cossackframework/solar-icons/filters';
import { MoonIcon } from '@cossackframework/solar-icons/moon';
import { SunIcon } from '@cossackframework/solar-icons/sun';
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  Icon,
  Input,
  Sheet,
  Textarea,
} from '@cossackframework/ui';
import type {
  InsertCell,
  StudioColumn,
  StudioObject,
  StudioSchema,
  TransportQueryResult,
  TransportValue,
} from '../../../src/lib/types';
import { getStudioDatabase } from '../../../src/server/runtime';
import { CodeEditor } from '../components/CodeEditor';
import { studioTheme, type StudioTheme } from '../theme.client';

type CellMode = 'null' | 'value';

interface CellEditor {
  rowIndex: number;
  columnName: string;
  value: string;
  mode: CellMode;
  json: boolean;
}

interface DeleteTarget {
  table: string;
  key: Record<string, unknown>;
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
  return value === null || value === undefined ? '' : displayValue(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

const emptyResult: TransportQueryResult = {
  columns: [],
  rows: [],
  affectedRows: 0,
  durationMs: 0,
  truncated: false,
};

const SYSTEM_TABLES = new Set(['kysely_migration', 'kysely_migration_lock']);

@Page({ transport: 'http' })
export default class StudioPage extends Cossack {
  initialSchema = server$(
    () => getStudioDatabase().getSchema(),
    {
      initial: {
        connection: { provider: 'unknown', label: 'Database', remote: false },
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
  @ClientState() tab: 'browse' | 'structure' | 'sql' = 'browse';
  @ClientState() showInsert = false;
  @ClientState() showKyselyMigration = false;
  @ClientState() showKyselyMigrationLock = false;
  @ClientState() insertValues: Record<string, string> = {};
  @ClientState() insertModes: Record<string, 'omit' | 'null' | 'value'> = {};
  @ClientState() inlineEditor: CellEditor | null = null;
  @ClientState() sheetEditor: CellEditor | null = null;
  @ClientState() deleteTarget: DeleteTarget | null = null;
  @ClientState() theme: StudioTheme = 'dark';

  private disconnectTheme?: () => void;

  onMount() {
    this.theme = studioTheme.get();
    this.disconnectTheme = studioTheme.subscribe((theme) => {
      this.theme = theme;
    });
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

  @Client()
  toggleTheme() {
    const next = studioTheme.get() === 'dark' ? 'light' : 'dark';
    document.cookie = `cossack-studio-theme=${next}; Path=/; Max-Age=31536000; SameSite=Strict`;
    studioTheme.set(next);
  }

  @Client()
  async chooseObject(name: string) {
    this.selected = name;
    this.page = 1;
    this.tab = 'browse';
    this.inlineEditor = null;
    this.sheetEditor = null;
    await this.loadRows(name, 1, this.pageSize);
  }

  @Client()
  async changePage(page: number) {
    if (!this.selected || page === this.page) return;
    await this.loadRows(this.selected, page, this.pageSize);
  }

  @Client()
  async changePageSize(value: string) {
    const pageSize = Number(value);
    if (!Number.isFinite(pageSize)) return;
    this.pageSize = pageSize;
    this.page = 1;
    if (this.selected) await this.loadRows(this.selected, 1, pageSize);
  }

  @Client()
  setSql(value: string) {
    this.sql = value;
  }

  @Client()
  async runSqlFromEditor() {
    try {
      await this.executeStatement(this.sql);
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
  usesSheet(column: StudioColumn, value: string): boolean {
    return /\bJSON\b/i.test(column.dataType) ||
      value.length > 160 ||
      (/\b(TEXT|CLOB)\b/i.test(column.dataType) && /[\r\n]/.test(value));
  }

  @Client()
  isJsonColumn(column: StudioColumn, value: string): boolean {
    if (/\bJSON\b/i.test(column.dataType)) return true;
    if (!/(json|metadata|payload|config|settings|data)/i.test(column.name)) return false;
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  }

  @Client()
  beginCellEdit(rowIndex: number, columnName: string) {
    const object = this.activeObject;
    const column = object?.columns.find((candidate) => candidate.name === columnName);
    if (!object?.editable || !column || column.primaryKeyPosition || column.affinity === 'blob') return;
    const raw = this.browseResult.rows[rowIndex]?.[columnName];
    const value = editableValue(raw);
    const editor: CellEditor = {
      rowIndex,
      columnName,
      value,
      mode: raw === null ? 'null' : 'value',
      json: this.isJsonColumn(column, value),
    };
    if (this.usesSheet(column, value)) this.sheetEditor = editor;
    else this.inlineEditor = editor;
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
    this.inlineEditor = null;
    try {
      await this.updateGridCell(
        object.name,
        this.keyForRow(object, editor.rowIndex),
        editor.columnName,
        editor.mode === 'null' ? { mode: 'null' } : { mode: 'value', value: editor.value },
        this.page,
        this.pageSize,
      );
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
  async saveSheetEditor() {
    const editor = this.sheetEditor;
    const object = this.activeObject;
    if (!editor || !object) return;
    if (editor.json && editor.mode === 'value') {
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
      );
      this.sheetEditor = null;
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  requestDelete(rowIndex: number) {
    const object = this.activeObject;
    if (!object?.editable) return;
    this.deleteTarget = {
      table: object.name,
      key: this.keyForRow(object, rowIndex),
    };
  }

  @Client()
  async confirmDelete() {
    const target = this.deleteTarget;
    if (!target) return;
    this.deleteTarget = null;
    try {
      await this.deleteGridRow(target.table, target.key, this.page, this.pageSize);
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Client()
  setInsertValue(name: string, value: string) {
    this.insertValues = { ...this.insertValues, [name]: value };
    this.insertModes = { ...this.insertModes, [name]: 'value' };
  }

  @Client()
  setInsertMode(name: string, mode: 'omit' | 'null' | 'value') {
    this.insertModes = { ...this.insertModes, [name]: mode };
  }

  @Client()
  async submitInsert() {
    if (!this.activeObject) return;
    const cells = Object.fromEntries(this.activeObject.columns.map((column) => {
      const mode = this.insertModes[column.name] ?? 'omit';
      return [column.name, mode === 'value'
        ? { mode, value: this.insertValues[column.name] ?? '' }
        : { mode }];
    })) as Record<string, InsertCell>;
    try {
      await this.insertGridRow(this.activeObject.name, cells, this.pageSize);
      this.showInsert = false;
      this.insertModes = {};
      this.insertValues = {};
    } catch (error: any) {
      this.message = error?.message ?? String(error);
      this.messageError = true;
    }
  }

  @Server()
  async loadRows(name: string, page: number, pageSize: number) {
    this.browseResult = await getStudioDatabase().browse(name, page, pageSize);
    this.selected = name;
    this.page = this.browseResult.page ?? page;
    this.pageSize = this.browseResult.pageSize ?? pageSize;
    this.message = '';
    this.messageError = false;
  }

  @Server()
  async executeStatement(statement: string) {
    this.sqlResult = await getStudioDatabase().executeSql(statement);
    this.schema = await getStudioDatabase().getSchema();
    if (this.selected && this.schema.objects.some((object) => object.name === this.selected)) {
      this.browseResult = await getStudioDatabase().browse(this.selected, this.page, this.pageSize);
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
  ) {
    const mutation = await getStudioDatabase().update(table, key, column, value);
    this.schema = mutation.schema;
    this.browseResult = await getStudioDatabase().browse(table, page, pageSize);
    this.page = this.browseResult.page ?? page;
    this.message = 'Row updated.';
    this.messageError = false;
  }

  @Server()
  async deleteGridRow(
    table: string,
    key: Record<string, unknown>,
    page: number,
    pageSize: number,
  ) {
    const mutation = await getStudioDatabase().delete(table, key);
    this.schema = mutation.schema;
    this.browseResult = await getStudioDatabase().browse(table, page, pageSize);
    this.page = this.browseResult.page ?? page;
    this.message = 'Row deleted.';
    this.messageError = false;
  }

  @Server()
  async insertGridRow(table: string, cells: Record<string, InsertCell>, pageSize: number) {
    const mutation = await getStudioDatabase().insert(table, cells);
    this.schema = mutation.schema;
    this.browseResult = await getStudioDatabase().browse(table, 1, pageSize);
    this.page = 1;
    this.message = 'Row inserted.';
    this.messageError = false;
  }

  render() {
    const schema = this.activeSchema;
    const object = this.activeObject;
    const query = this.search.trim().toLowerCase();
    const objects = schema.objects.filter((candidate) => {
      if (candidate.name === 'kysely_migration' && !this.showKyselyMigration) return false;
      if (candidate.name === 'kysely_migration_lock' && !this.showKyselyMigrationLock) return false;
      return candidate.name.toLowerCase().includes(query);
    });
    const hiddenSystemTables = schema.objects.filter((candidate) => SYSTEM_TABLES.has(candidate.name));
    const remote = schema.connection.remote;

    return html`
      <main class="studio-grid grid h-screen bg-muted/20">
        <header class="col-span-2 flex items-center justify-between gap-4 border-b bg-card px-5">
          <div class="flex min-w-0 items-center gap-3">
            <strong class="shrink-0 tracking-tight">Cossack Studio</strong>
            ${component(Badge, { variant: remote ? 'destructive' : 'secondary' },
              `${schema.connection.label}${remote ? ' · REMOTE D1' : ' · local'}`)}
          </div>
          <div class="flex items-center gap-3">
            ${remote ? html`
              <div class="hidden rounded-md bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive md:block">
                Writes affect deployed data immediately
              </div>
            ` : ''}
            ${component(Button, {
              variant: 'ghost',
              size: 'icon',
              title: this.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
              'aria-label': 'Toggle theme',
              'data-testid': 'theme-toggle',
              '@click': this.toggleTheme,
            }, component(Icon, {
              entry: this.theme === 'dark' ? SunIcon : MoonIcon,
              size: 18,
            }))}
          </div>
        </header>

        <aside class="row-start-2 flex min-h-0 flex-col border-r bg-sidebar">
          <div class="space-y-2 border-b p-3">
            ${component(Input, {
              placeholder: 'Search tables and views…',
              'data-testid': 'object-search',
              '.value': this.search,
              '@input': (event: InputEvent) => {
                this.search = (event.target as HTMLInputElement).value;
              },
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
          <nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Database objects">
            ${repeat(objects, (candidate) => candidate.name, (candidate) => html`
              <button
                class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-sidebar-accent ${candidate.name === this.selected ? 'bg-sidebar-accent font-medium' : ''}"
                data-testid="object-${candidate.name}"
                title="${candidate.kind === 'view' ? 'View' : 'Table'}: ${candidate.name}"
                @click="${() => this.chooseObject(candidate.name)}"
              >
                <span class="shrink-0 text-muted-foreground">
                  ${component(Icon, {
                    entry: candidate.kind === 'view' ? EyeIcon : DatabaseIcon,
                    style: candidate.kind === 'view' ? 'line' : 'duotone',
                    size: 16,
                  })}
                </span>
                <span class="truncate">${candidate.name}</span>
              </button>
            `)}
          </nav>
        </aside>

        <section class="row-start-2 flex min-w-0 flex-col overflow-hidden bg-background">
          <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
            <div class="flex items-center gap-1">
              ${(['browse', 'structure', 'sql'] as const).map((item) => component(Button, {
                variant: this.tab === item ? 'secondary' : 'ghost',
                size: 'sm',
                'data-testid': `tab-${item}`,
                '@click': () => { this.tab = item; },
              }, item[0].toUpperCase() + item.slice(1)))}
            </div>
            ${this.tab === 'browse' && object?.editable
              ? component(Button, {
                  size: 'sm',
                  'data-testid': 'insert-row',
                  '@click': () => { this.showInsert = !this.showInsert; },
                }, 'Insert row')
              : ''}
          </div>

          ${this.message ? html`
            <div class="${this.messageError ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-muted-foreground'} shrink-0 border-b px-4 py-2 text-sm" role="status">
              ${this.message}
            </div>
          ` : ''}

          ${this.renderBrowse(object, this.tab === 'browse')}
          ${this.renderStructure(object, this.tab === 'structure')}
          ${this.renderSql(this.tab === 'sql')}
        </section>

        ${this.renderSheetEditor(object)}
        ${component(AlertDialog, {
          open: Boolean(this.deleteTarget),
          title: `Delete row from ${this.deleteTarget?.table ?? 'table'}?`,
          description: 'This action runs immediately and cannot be undone.',
          cancelLabel: 'Cancel',
          actionLabel: this.loading.deleteGridRow ? 'Deleting…' : 'Delete row',
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

    const totalRows = this.browseResult.totalRows ?? this.browseResult.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / this.pageSize));
    const firstRow = totalRows ? (this.page - 1) * this.pageSize + 1 : 0;
    const lastRow = Math.min(totalRows, firstRow + this.browseResult.rows.length - 1);

    return html`
      <div class="${active ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col">
        ${!object.editable ? html`
          <div class="shrink-0 border-b bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            ${object.readOnlyReason}
          </div>
        ` : ''}
        ${this.showInsert ? this.renderInsert(object) : ''}
        <div class="min-h-0 flex-1 overflow-auto" data-testid="data-grid">
          <table class="w-full border-collapse text-sm">
            <thead class="sticky top-0 z-10 bg-muted">
              <tr>
                ${this.browseResult.columns.map((column) => html`
                  <th class="studio-cell border-b border-r px-3 py-2 text-left font-medium">${column}</th>
                `)}
                ${object.editable ? html`<th class="w-20 border-b px-3 py-2">Actions</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${this.browseResult.rows.length ? this.browseResult.rows.map((row, rowIndex) => html`
                <tr class="hover:bg-muted/40" data-testid="grid-row">
                  ${this.browseResult.columns.map((columnName) => {
                    const column = object.columns.find((candidate) => candidate.name === columnName);
                    const editable = object.editable && column &&
                      !column.primaryKeyPosition && column.affinity !== 'blob';
                    const editing = this.inlineEditor?.rowIndex === rowIndex &&
                      this.inlineEditor.columnName === columnName;
                    return html`
                      <td
                        class="studio-cell border-b border-r px-3 py-2 font-mono"
                        title="${editable ? 'Double-click to edit' : ''}"
                        @dblclick="${() => this.beginCellEdit(rowIndex, columnName)}"
                      >
                        ${editing ? html`
                          <div class="flex min-w-52 items-center gap-1">
                            <input
                              autofocus
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
                  ${object.editable ? html`
                    <td class="border-b px-2 text-center">
                      ${component(Button, {
                        variant: 'ghost',
                        size: 'sm',
                        'aria-label': 'Delete row',
                        '@click': () => this.requestDelete(rowIndex),
                      }, 'Delete')}
                    </td>
                  ` : ''}
                </tr>
              `) : html`
                <tr>
                  <td
                    class="p-8 text-center text-muted-foreground"
                    colspan="${Math.max(1, this.browseResult.columns.length + (object.editable ? 1 : 0))}"
                  >No rows found.</td>
                </tr>
              `}
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
                ${[25, 50, 100, 250].map((size) => html`
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
              disabled: Boolean(this.page <= 1 || this.loading.loadRows),
              '@click': () => this.changePage(this.page - 1),
            }, 'Previous')}
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              disabled: Boolean(this.page >= totalPages || this.loading.loadRows),
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
            <th class="p-2">Nullable</th><th class="p-2">Default</th><th class="p-2">Key</th>
          </tr></thead>
          <tbody>${object.columns.map((column) => html`
            <tr class="border-b">
              <td class="p-2 font-medium">${column.name}</td>
              <td class="p-2 font-mono">${column.dataType || '—'}</td>
              <td class="p-2">${column.affinity}</td>
              <td class="p-2">${column.nullable ? 'yes' : 'no'}</td>
              <td class="p-2 font-mono">${column.defaultValue ?? '—'}</td>
              <td class="p-2">${column.primaryKeyPosition ? `PK ${column.primaryKeyPosition}` : '—'}${column.autoIncrement ? ' auto' : ''}</td>
            </tr>
          `)}</tbody>
        </table>
        ${object.sql ? html`
          <pre class="mt-5 overflow-auto rounded-md border bg-muted/40 p-4 text-xs">${object.sql}</pre>
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
              Ctrl/Cmd+Enter to execute · table and column completion included
            </span>
            ${component(Button, {
              size: 'sm',
              disabled: this.loading.runSqlFromEditor,
              'data-testid': 'run-sql',
              '@click': this.runSqlFromEditor,
            }, this.loading.runSqlFromEditor ? 'Running…' : 'Run')}
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
      <div class="max-h-72 shrink-0 overflow-auto border-b bg-muted/20 p-4" data-testid="insert-form">
        <div class="grid grid-cols-2 gap-3">
          ${object.columns.filter((column) => !column.hidden).map((column) => html`
            <label class="grid gap-1 text-sm">
              <span>${column.name} <small class="text-muted-foreground">${column.dataType}</small></span>
              <div class="flex gap-2">
                <select
                  class="rounded-md border border-input bg-background px-2 text-foreground"
                  .value="${this.insertModes[column.name] ?? 'omit'}"
                  @change="${(event: InputEvent) => this.setInsertMode(
                    column.name,
                    (event.target as HTMLSelectElement).value as 'omit' | 'null' | 'value',
                  )}"
                >
                  <option value="omit">omit / default</option>
                  ${column.nullable ? html`<option value="null">NULL</option>` : ''}
                  ${column.affinity !== 'blob' ? html`<option value="value">value</option>` : ''}
                </select>
                ${component(Input, {
                  disabled: (this.insertModes[column.name] ?? 'omit') !== 'value',
                  '.value': this.insertValues[column.name] ?? '',
                  '@input': (event: InputEvent) => this.setInsertValue(
                    column.name,
                    (event.target as HTMLInputElement).value,
                  ),
                })}
              </div>
            </label>
          `)}
        </div>
        <div class="mt-3 flex justify-end gap-2">
          ${component(Button, {
            variant: 'ghost',
            size: 'sm',
            '@click': () => { this.showInsert = false; },
          }, 'Cancel')}
          ${component(Button, {
            size: 'sm',
            disabled: this.loading.insertGridRow,
            'data-testid': 'submit-insert',
            '@click': this.submitInsert,
          }, 'Insert')}
        </div>
      </div>
    `;
  }

  renderSheetEditor(object: StudioObject | undefined) {
    const editor = this.sheetEditor;
    const column = object?.columns.find((candidate) => candidate.name === editor?.columnName);
    const activeEditor: CellEditor = editor ?? {
      rowIndex: 0,
      columnName: '',
      value: '',
      mode: 'value',
      json: true,
    };
    const activeColumn: StudioColumn = column ?? {
      name: 'value',
      dataType: 'TEXT',
      affinity: 'text',
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
        ${activeColumn.nullable ? component(Checkbox, {
          checked: activeEditor.mode === 'null',
          '@change': (event: InputEvent) => this.setSheetMode(
            (event.target as HTMLInputElement).checked ? 'null' : 'value',
          ),
        }, 'Set an explicit NULL value') : ''}
        <div class="min-h-0 flex-1 ${activeEditor.mode === 'null' ? 'pointer-events-none opacity-50' : ''}">
          <div class="${activeEditor.json ? 'block' : 'hidden'} h-full">
            ${component(CodeEditor, {
              class: 'h-full min-h-[20rem]',
              value: activeEditor.json ? activeEditor.value : '',
              language: 'json',
              theme: this.theme,
              enabled: Boolean(editor?.json),
              ariaLabel: `JSON value for ${activeColumn.name}`,
              'data-testid': 'json-editor',
              onChange: this.updateSheetValue,
              onRun: this.saveSheetEditor,
            })}
          </div>
          <div class="${activeEditor.json ? 'hidden' : 'block'} h-full">
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
}
