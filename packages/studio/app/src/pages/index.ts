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
import { Badge, Button, Input, Textarea } from '@cossackframework/ui';
import type {
  InsertCell,
  StudioObject,
  StudioSchema,
  TransportQueryResult,
  TransportValue,
} from '../../../src/lib/types';
import { getStudioDatabase } from '../../../src/server/runtime';

function displayValue(value: TransportValue | undefined): string {
  if (value === undefined) return '';
  if (value === null) return 'NULL';
  if (typeof value === 'object') {
    if (value.$type === 'blob') return `BLOB (${Math.floor(value.value.length * 0.75)} bytes)`;
    return value.value;
  }
  return String(value);
}

const emptyResult: TransportQueryResult = {
  columns: [],
  rows: [],
  affectedRows: 0,
  durationMs: 0,
  truncated: false,
};

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
  @State() result: TransportQueryResult = emptyResult;
  @State() selected = '';
  @State() page = 1;
  @State() sql = 'SELECT sqlite_version() AS version;';
  @State() message = '';
  @ClientState() search = '';
  @ClientState() tab: 'browse' | 'structure' | 'sql' = 'browse';
  @ClientState() showInsert = false;
  @ClientState() insertValues: Record<string, string> = {};
  @ClientState() insertModes: Record<string, 'omit' | 'null' | 'value'> = {};

  get activeSchema(): StudioSchema {
    return this.schema ?? this.initialSchema;
  }

  get activeObject(): StudioObject | undefined {
    return this.activeSchema.objects.find((object) => object.name === this.selected);
  }

  @Client()
  async chooseObject(name: string) {
    this.selected = name;
    this.page = 1;
    this.tab = 'browse';
    await this.loadRows(name, 1);
  }

  @Client()
  async changePage(delta: number) {
    const next = Math.max(1, this.page + delta);
    this.page = next;
    await this.loadRows(this.selected, next);
  }

  @Client()
  async runSqlFromEditor() {
    await this.executeStatement(this.sql);
  }

  @Client()
  onSqlKeydown(event: any) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.runSqlFromEditor();
    }
  }

  @Client()
  async editCell(rowIndex: number, columnName: string) {
    const object = this.activeObject;
    const column = object?.columns.find((candidate) => candidate.name === columnName);
    if (!object?.editable || !column || column.primaryKeyPosition || column.affinity === 'blob') return;
    const current = displayValue(this.result.rows[rowIndex]?.[columnName]);
    const value = window.prompt(`New value for ${columnName} (type NULL for an explicit null)`, current);
    if (value === null) return;
    const key = Object.fromEntries(
      object.columns
        .filter((candidate) => candidate.primaryKeyPosition > 0)
        .map((candidate) => [candidate.name, this.result.rows[rowIndex]?.[candidate.name]]),
    );
    await this.updateGridCell(object.name, key, columnName, value === 'NULL'
      ? { mode: 'null' }
      : { mode: 'value', value });
  }

  @Client()
  async confirmDelete(rowIndex: number) {
    const object = this.activeObject;
    if (!object?.editable || !window.confirm(`Delete this row from ${object.name}?`)) return;
    const key = Object.fromEntries(
      object.columns
        .filter((column) => column.primaryKeyPosition > 0)
        .map((column) => [column.name, this.result.rows[rowIndex]?.[column.name]]),
    );
    await this.deleteGridRow(object.name, key);
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
    await this.insertGridRow(this.activeObject.name, cells);
    this.showInsert = false;
    this.insertModes = {};
    this.insertValues = {};
  }

  @Server()
  async loadRows(name: string, page: number) {
    this.result = await getStudioDatabase().browse(name, page);
    this.selected = name;
    this.page = page;
    this.message = '';
  }

  @Server()
  async executeStatement(statement: string) {
    this.result = await getStudioDatabase().executeSql(statement);
    this.schema = await getStudioDatabase().getSchema();
    this.message = this.result.error
      ? this.result.error
      : `Completed in ${this.result.durationMs.toFixed(1)} ms`;
  }

  @Server()
  async updateGridCell(
    table: string,
    key: Record<string, unknown>,
    column: string,
    value: { mode: 'null' } | { mode: 'value'; value: string },
  ) {
    const mutation = await getStudioDatabase().update(table, key, column, value);
    this.schema = mutation.schema;
    this.result = await getStudioDatabase().browse(table, this.page);
    this.message = 'Row updated.';
  }

  @Server()
  async deleteGridRow(table: string, key: Record<string, unknown>) {
    const mutation = await getStudioDatabase().delete(table, key);
    this.schema = mutation.schema;
    this.result = await getStudioDatabase().browse(table, this.page);
    this.message = 'Row deleted.';
  }

  @Server()
  async insertGridRow(table: string, cells: Record<string, InsertCell>) {
    const mutation = await getStudioDatabase().insert(table, cells);
    this.schema = mutation.schema;
    this.result = await getStudioDatabase().browse(table, 1);
    this.page = 1;
    this.message = 'Row inserted.';
  }

  render() {
    const schema = this.activeSchema;
    const object = this.activeObject;
    const objects = schema.objects.filter((candidate) =>
      candidate.name.toLowerCase().includes(this.search.toLowerCase()),
    );
    const remote = schema.connection.remote;
    return html`
      <main class="studio-grid grid h-screen">
        <header class="col-span-2 flex items-center justify-between border-b bg-card px-5">
          <div class="flex items-center gap-3">
            <strong class="tracking-tight">Cossack Studio</strong>
            ${component(Badge, { variant: remote ? 'destructive' : 'secondary' },
              `${schema.connection.label}${remote ? ' · REMOTE D1' : ' · local'}`)}
          </div>
          ${remote ? html`
            <div class="rounded-md bg-destructive/15 px-3 py-1.5 text-sm font-medium text-destructive">
              Writes affect deployed data immediately
            </div>
          ` : ''}
        </header>

        <aside class="row-start-2 overflow-hidden border-r bg-sidebar">
          <div class="border-b p-3">
            ${component(Input, {
              placeholder: 'Search tables and views…',
              'data-testid': 'object-search',
              '.value': this.search,
              '@input': (event: InputEvent) => { this.search = (event.target as HTMLInputElement).value; },
            })}
          </div>
          <nav class="h-[calc(100%-4rem)] overflow-y-auto p-2" aria-label="Database objects">
            ${repeat(objects, (candidate) => candidate.name, (candidate) => html`
              <button
                class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-sidebar-accent ${candidate.name === this.selected ? 'bg-sidebar-accent font-medium' : ''}"
                data-testid="object-${candidate.name}"
                @click="${() => this.chooseObject(candidate.name)}"
              >
                <span class="truncate">${candidate.name}</span>
                <span class="text-xs text-muted-foreground">${candidate.kind}</span>
              </button>
            `)}
          </nav>
        </aside>

        <section class="row-start-2 min-w-0 overflow-hidden">
          <div class="flex h-12 items-center justify-between border-b px-4">
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
            <div class="${this.result.error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'} border-b px-4 py-2 text-sm" role="status">
              ${this.message}
            </div>
          ` : ''}

          ${this.tab === 'sql' ? this.renderSql() :
            this.tab === 'structure' ? this.renderStructure(object) :
            this.renderBrowse(object)}
        </section>
      </main>
    `;
  }

  renderBrowse(object: StudioObject | undefined) {
    if (!object) return html`
      <div class="grid h-full place-items-center text-muted-foreground">
        Select a table or view to browse it.
      </div>
    `;
    return html`
      ${!object.editable ? html`
        <div class="border-b bg-warning/10 px-4 py-2 text-sm text-warning-foreground">
          ${object.readOnlyReason}
        </div>
      ` : ''}
      ${this.showInsert ? this.renderInsert(object) : ''}
      <div class="h-[calc(100%-6rem)] overflow-auto" data-testid="data-grid">
        <table class="w-full border-collapse text-sm">
          <thead class="sticky top-0 z-10 bg-muted">
            <tr>
              ${this.result.columns.map((column) => html`
                <th class="studio-cell border-b border-r px-3 py-2 text-left font-medium">${column}</th>
              `)}
              ${object.editable ? html`<th class="w-20 border-b px-3 py-2">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${this.result.rows.map((row, rowIndex) => html`
              <tr class="hover:bg-muted/40" data-testid="grid-row">
                ${this.result.columns.map((columnName) => {
                  const column = object.columns.find((candidate) => candidate.name === columnName);
                  const editable = object.editable && column &&
                    !column.primaryKeyPosition && column.affinity !== 'blob';
                  return html`
                    <td
                      class="studio-cell border-b border-r px-3 py-2 font-mono"
                      title="${editable ? 'Double-click to edit' : ''}"
                      @dblclick="${() => this.editCell(rowIndex, columnName)}"
                    >
                      <span class="studio-cell-value ${row[columnName] === null ? 'italic text-muted-foreground' : ''}">
                        ${displayValue(row[columnName])}
                      </span>
                    </td>
                  `;
                })}
                ${object.editable ? html`
                  <td class="border-b px-2 text-center">
                    ${component(Button, {
                      variant: 'ghost',
                      size: 'sm',
                      'aria-label': 'Delete row',
                      '@click': () => this.confirmDelete(rowIndex),
                    }, 'Delete')}
                  </td>
                ` : ''}
              </tr>
            `)}
          </tbody>
        </table>
      </div>
      <footer class="flex h-12 items-center justify-between border-t px-4">
        <span class="text-sm text-muted-foreground">Page ${this.page} · 50 rows per page</span>
        <div class="flex gap-2">
          ${component(Button, {
            variant: 'outline',
            size: 'sm',
            disabled: Boolean(this.page <= 1 || this.loading.loadRows),
            '@click': () => this.changePage(-1),
          }, 'Previous')}
          ${component(Button, {
            variant: 'outline',
            size: 'sm',
            disabled: Boolean(this.result.rows.length < 50 || this.loading.loadRows),
            '@click': () => this.changePage(1),
          }, 'Next')}
        </div>
      </footer>
    `;
  }

  renderStructure(object: StudioObject | undefined) {
    if (!object) return html`<div class="p-6 text-muted-foreground">Select a database object.</div>`;
    return html`
      <div class="h-[calc(100%-3rem)] overflow-auto p-5">
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
        ${object.sql ? html`<pre class="mt-5 overflow-auto rounded-md bg-muted p-4 text-xs">${object.sql}</pre>` : ''}
      </div>
    `;
  }

  renderSql() {
    return html`
      <div class="grid h-[calc(100%-3rem)] grid-rows-[14rem_minmax(0,1fr)]">
        <div class="border-b p-4">
          ${component(Textarea, {
            class: 'h-36 font-mono',
            'data-testid': 'sql-editor',
            '.value': this.sql,
            '@input': (event: InputEvent) => { this.sql = (event.target as HTMLTextAreaElement).value; },
            '@keydown': this.onSqlKeydown,
          })}
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">Ctrl/Cmd+Enter to execute one statement</span>
            ${component(Button, {
              size: 'sm',
              disabled: this.loading.executeStatement,
              'data-testid': 'run-sql',
              '@click': this.runSqlFromEditor,
            }, this.loading.executeStatement ? 'Running…' : 'Run')}
          </div>
        </div>
        <div class="overflow-auto">
          <table class="w-full text-sm" data-testid="sql-results">
            <thead class="sticky top-0 bg-muted"><tr>
              ${this.result.columns.map((column) => html`<th class="border-b border-r p-2 text-left">${column}</th>`)}
            </tr></thead>
            <tbody>${this.result.rows.map((row) => html`<tr>
              ${this.result.columns.map((column) => html`
                <td class="border-b border-r p-2 font-mono">${displayValue(row[column])}</td>
              `)}
            </tr>`)}</tbody>
          </table>
          <div class="p-3 text-xs text-muted-foreground">
            ${this.result.affectedRows} affected row(s) · ${this.result.durationMs.toFixed(1)} ms
            ${this.result.truncated ? ' · Results truncated at 1,000 rows' : ''}
          </div>
        </div>
      </div>
    `;
  }

  renderInsert(object: StudioObject) {
    return html`
      <div class="max-h-72 overflow-auto border-b bg-card p-4" data-testid="insert-form">
        <div class="grid grid-cols-2 gap-3">
          ${object.columns.filter((column) => !column.hidden).map((column) => html`
            <label class="grid gap-1 text-sm">
              <span>${column.name} <small class="text-muted-foreground">${column.dataType}</small></span>
              <div class="flex gap-2">
                <select
                  class="rounded-md border bg-background px-2"
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
          ${component(Button, { variant: 'ghost', size: 'sm', '@click': () => { this.showInsert = false; } }, 'Cancel')}
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
}
