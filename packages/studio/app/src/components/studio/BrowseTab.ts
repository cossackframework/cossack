import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { ExportIcon } from '@cossackframework/solar-icons/export';
import { FilterIcon } from '@cossackframework/solar-icons/filter';
import { LinkIcon } from '@cossackframework/solar-icons/link';
import { PenIcon } from '@cossackframework/solar-icons/pen';
import { PlayIcon } from '@cossackframework/solar-icons/play';
import { SortIcon } from '@cossackframework/solar-icons/sort';
import { TrashBinMinimalisticIcon } from '@cossackframework/solar-icons/trash-bin-minimalistic';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import {
  Button,
  Checkbox,
  Icon,
  Input,
  Tooltip,
} from '@cossackframework/ui';
import type {
  StudioForeignKey,
  StudioObject,
  StudioSchema,
} from '../../../../src/lib/schema-types';
import type {
  BrowseFilter,
  BrowseFilterOperator,
  BrowseSort,
  TransportQueryResult,
} from '../../../../src/lib/query-types';
import {
  displayValue,
  FILTER_OPERATORS,
  formatCount,
  type CellEditor,
  type CellMode,
} from '../../studio-page';
import type { StudioTheme } from '../../theme.client';
import { CodeEditor } from '../CodeEditor';

interface BrowseTabProps {
  object?: StudioObject;
  active: boolean;
  schema: StudioSchema;
  result: TransportQueryResult;
  loadedObject: string;
  page: number;
  pageSize: number;
  selectedRows: number[];
  customQuery: boolean;
  query: string;
  loading: boolean;
  loadFailed: boolean;
  showFilter: boolean;
  filters: BrowseFilter[];
  sort: BrowseSort[];
  filterColumn: string;
  filterOperator: BrowseFilterOperator;
  filterValue: string;
  theme: StudioTheme;
  inlineEditor: CellEditor | null;
  onToggleFilter: () => void;
  onRemoveFilter: (index: number) => void;
  onRunQuery: () => void;
  onFilterColumnChange: (column: string) => void;
  onFilterOperatorChange: (operator: BrowseFilterOperator) => void;
  onFilterValueChange: (value: string) => void;
  onApplyFilter: () => void;
  onQueryChange: (query: string) => void;
  onDeleteSelected: () => void;
  onBatchUpdate: () => void;
  onExport: (rowIndexes: number[], collection?: boolean) => void;
  onClearSelection: () => void;
  onToggleAllRows: (checked: boolean) => void;
  onToggleSort: (column: string) => void;
  onToggleRow: (rowIndex: number, checked: boolean) => void;
  onBeginCellEdit: (rowIndex: number, columnName: string) => void;
  onInlineValueChange: (value: string) => void;
  onInlineKeydown: (event: KeyboardEvent) => void;
  onSaveInlineEditor: () => void;
  onInlineModeChange: (mode: CellMode) => void;
  onFollowForeignKey: (foreignKey: StudioForeignKey, rowIndex: number) => void;
  onEditRow: (rowIndex: number) => void;
  onDeleteRow: (rowIndex: number) => void;
  onPageSizeChange: (value: string) => void;
  onPageChange: (page: number) => void;
  [key: string]: unknown;
}

function iconButton(
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

@Component()
export class BrowseTab extends Cossack {
  declare props: BrowseTabProps;

  render() {
    const { object } = this.props;
    if (!object) return html`
      <div
        class="${this.props.active
          ? 'grid'
          : 'hidden'} min-h-0 flex-1 place-items-center text-muted-foreground"
      >
        Select a table or view to browse it.
      </div>
    `;

    const resultMatches = this.props.loadedObject === object.name;
    const rows = resultMatches ? this.props.result.rows : [];
    const columns = resultMatches && this.props.result.columns.length
      ? this.props.result.columns
      : object.columns.filter((column) => !column.hidden).map((column) => column.name);
    const totalRows = resultMatches
      ? this.props.result.totalRows ?? rows.length
      : 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / this.props.pageSize));
    const firstRow = totalRows
      ? (this.props.page - 1) * this.props.pageSize + 1
      : 0;
    const lastRow = Math.min(totalRows, firstRow + rows.length - 1);
    const allSelected = rows.length > 0 &&
      this.props.selectedRows.length === rows.length;
    const quote = this.props.schema.connection.provider === 'mysql'
      ? `\`${object.name.replaceAll('`', '``')}\``
      : `"${object.name.replaceAll('"', '""')}"`;
    const generatedQuery = resultMatches
      ? this.props.result.query ?? ''
      : `SELECT * FROM ${quote} LIMIT ${this.props.pageSize} OFFSET 0`;
    const query = this.props.query || generatedQuery;
    const gridEditable = object.editable && !this.props.customQuery;

    return html`
      <div class="${this.props.active ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col">
        ${!object.editable ? html`
          <div class="shrink-0 border-b bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            ${object.readOnlyReason}
          </div>
        ` : ''}

        <div class="shrink-0 border-b bg-muted/15 px-4 py-2">
          <div class="mb-2 flex flex-wrap items-center gap-2" data-testid="browse-toolbar">
            ${iconButton(
              FilterIcon,
              this.props.showFilter ? 'Hide filters' : 'Add filter',
              this.props.onToggleFilter,
              { variant: this.props.showFilter ? 'secondary' : 'ghost' },
            )}
            ${this.props.filters.map((filter, index) => html`
              <button
                type="button"
                class="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent"
                title="Remove filter"
                @click="${() => this.props.onRemoveFilter(index)}"
              >
                ${filter.column}
                ${FILTER_OPERATORS.find(
                  (operator) => operator.value === filter.operator,
                )?.label}
                ${filter.value === undefined ? '' : ` “${filter.value}”`} ×
              </button>
            `)}
            ${this.props.sort.length ? html`
              <span class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">
                ${component(Icon, { entry: SortIcon, size: 13 })}
                ${this.props.sort[0].column}
                ${this.props.sort[0].direction.toUpperCase()}
              </span>
            ` : ''}
            <span class="ml-auto">
              ${iconButton(
                PlayIcon,
                this.props.loading ? 'Running browse query' : 'Execute browse query',
                this.props.onRunQuery,
                {
                  disabled: this.props.loading,
                  'data-testid': 'run-browse-query',
                  variant: 'default',
                  class: 'h-8 w-8 shadow-sm',
                },
              )}
            </span>
          </div>
          ${this.props.showFilter ? html`
            <div class="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
              <select
                class="h-9 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="filter-column"
                .value="${this.props.filterColumn || object.columns[0]?.name || ''}"
                @change="${(event: InputEvent) =>
                  this.props.onFilterColumnChange(
                    (event.target as HTMLSelectElement).value,
                  )}"
              >
                ${object.columns.filter((column) => !column.hidden).map((column) => html`
                  <option
                    value="${column.name}"
                    ?selected="${column.name === this.props.filterColumn}"
                  >
                    ${column.name}
                  </option>
                `)}
              </select>
              <select
                class="h-9 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="filter-operator"
                .value="${this.props.filterOperator}"
                @change="${(event: InputEvent) =>
                  this.props.onFilterOperatorChange(
                    (event.target as HTMLSelectElement).value as BrowseFilterOperator,
                  )}"
              >
                ${FILTER_OPERATORS.map((operator) => html`
                  <option
                    value="${operator.value}"
                    ?selected="${operator.value === this.props.filterOperator}"
                  >
                    ${operator.label}
                  </option>
                `)}
              </select>
              ${this.props.filterOperator === 'is-null' ||
                this.props.filterOperator === 'is-not-null'
                ? ''
                : component(Input, {
                    class: 'max-w-64',
                    placeholder: 'Filter value',
                    '.value': this.props.filterValue,
                    '@input': (event: InputEvent) =>
                      this.props.onFilterValueChange(
                        (event.target as HTMLInputElement).value,
                      ),
                    '@keydown': (event: KeyboardEvent) => {
                      if (event.key === 'Enter') this.props.onApplyFilter();
                    },
                  })}
              ${component(Button, {
                size: 'sm',
                '@click': this.props.onApplyFilter,
              }, 'Apply')}
            </div>
          ` : ''}
          ${component(CodeEditor, {
            class: 'h-[5rem]',
            value: query,
            language: 'sql',
            theme: this.props.theme,
            schema: this.props.schema,
            enabled: this.props.active,
            lineNumbers: 'off',
            ariaLabel: 'Current browse query',
            'data-testid': 'browse-query',
            onChange: this.props.onQueryChange,
            onRun: this.props.onRunQuery,
          })}
        </div>

        ${this.props.selectedRows.length ? html`
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2">
            <strong class="text-sm">${this.props.selectedRows.length} selected</strong>
            ${gridEditable ? component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': this.props.onDeleteSelected,
            }, html`
              ${component(Icon, { entry: TrashBinMinimalisticIcon, size: 15 })}
              Delete selected
            `) : ''}
            ${gridEditable ? component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': this.props.onBatchUpdate,
            }, html`
              ${component(Icon, { entry: PenIcon, size: 15 })}
              Update selected
            `) : ''}
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              class: 'gap-2',
              '@click': () =>
                this.props.onExport(this.props.selectedRows, true),
            }, html`
              ${component(Icon, { entry: ExportIcon, size: 15 })}
              Export selected
            `)}
            ${component(Button, {
              variant: 'ghost',
              size: 'sm',
              '@click': this.props.onClearSelection,
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
                    indeterminate: this.props.selectedRows.length > 0 && !allSelected,
                    'aria-label': 'Select all rows on this page',
                    '@change': (event: InputEvent) => this.props.onToggleAllRows(
                      (event.target as HTMLInputElement).checked,
                    ),
                  })}
                </th>
                ${columns.map((column) => {
                  const sorting = this.props.sort.find(
                    (item) => item.column === column,
                  );
                  return html`
                    <th class="studio-cell border-b border-r px-3 py-2 text-left font-medium">
                      ${this.props.customQuery ? html`<span>${column}</span>` : html`
                        <button
                          type="button"
                          class="flex w-full items-center gap-1.5 text-left hover:text-primary"
                          title="Sort by ${column}"
                          @click="${() => this.props.onToggleSort(column)}"
                        >
                          <span>${column}</span>
                          ${sorting ? html`
                            <span class="text-xs text-primary">
                              ${sorting.direction === 'asc' ? '↑' : '↓'}
                            </span>
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
              <tr class="${this.props.loading ? '' : 'hidden'}" data-testid="rows-loading">
                <td class="p-8 text-center text-muted-foreground" colspan="${columns.length + 2}">
                  Loading rows…
                </td>
              </tr>
              <tr class="${!this.props.loading &&
                (this.props.loadFailed || !resultMatches)
                ? ''
                : 'hidden'}">
                <td class="p-8 text-center text-destructive" colspan="${columns.length + 2}">
                  Rows could not be loaded. Use Refresh to try again.
                </td>
              </tr>
              ${rows.map((row, rowIndex) => html`
                <tr
                  class="${this.props.loading ? 'hidden' : ''} hover:bg-muted/40"
                  data-testid="grid-row"
                >
                  <td class="border-b border-r px-3 py-2">
                    ${component(Checkbox, {
                      checked: this.props.selectedRows.includes(rowIndex),
                      'aria-label': `Select row ${rowIndex + 1}`,
                      '@change': (event: InputEvent) => this.props.onToggleRow(
                        rowIndex,
                        (event.target as HTMLInputElement).checked,
                      ),
                    })}
                  </td>
                  ${columns.map((columnName) => {
                    const column = object.columns.find(
                      (candidate) => candidate.name === columnName,
                    );
                    const editing = this.props.inlineEditor?.rowIndex === rowIndex &&
                      this.props.inlineEditor.columnName === columnName;
                    const foreignKey = object.foreignKeys.find((candidate) =>
                      candidate.columns.some(
                        (item) => item.column === columnName,
                      ) &&
                      this.props.schema.objects.some(
                        (target) => target.name === candidate.referencedTable,
                      ) &&
                      candidate.columns.every(
                        (item) =>
                          row[item.column] !== null &&
                          row[item.column] !== undefined,
                      ));
                    return html`
                      <td
                        class="studio-cell border-b border-r px-3 py-2 font-mono"
                        title="${gridEditable ? 'Double-click to edit' : ''}"
                        @dblclick="${() =>
                          this.props.onBeginCellEdit(rowIndex, columnName)}"
                      >
                        ${editing ? html`
                          <div class="flex min-w-52 items-center gap-1">
                            <input
                              autofocus
                              type="${column?.declaredKind === 'number' ? 'number' : 'text'}"
                              class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                              data-testid="inline-editor"
                              ?disabled="${this.props.inlineEditor?.mode === 'null'}"
                              .value="${this.props.inlineEditor?.value ?? ''}"
                              @input="${(event: InputEvent) =>
                                this.props.onInlineValueChange(
                                  (event.target as HTMLInputElement).value,
                                )}"
                              @keydown="${this.props.onInlineKeydown}"
                              @blur="${this.props.onSaveInlineEditor}"
                            />
                            ${column?.nullable ? html`
                              <button
                                type="button"
                                class="h-8 rounded-md border px-2 text-[10px] ${this.props.inlineEditor?.mode === 'null'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-background text-muted-foreground'}"
                                title="Toggle an explicit NULL value"
                                @mousedown="${(event: MouseEvent) => event.preventDefault()}"
                                @click="${() => this.props.onInlineModeChange(
                                  this.props.inlineEditor?.mode === 'null'
                                    ? 'value'
                                    : 'null',
                                )}"
                              >
                                NULL
                              </button>
                            ` : ''}
                          </div>
                        ` : foreignKey ? html`
                          <button
                            type="button"
                            class="inline-flex max-w-full items-center gap-1.5 text-primary hover:underline"
                            title="Open ${foreignKey.referencedTable}"
                            data-testid="foreign-key-${columnName}-${rowIndex}"
                            @click="${() =>
                              this.props.onFollowForeignKey(foreignKey, rowIndex)}"
                            @dblclick="${(event: MouseEvent) => event.stopPropagation()}"
                          >
                            <span class="truncate">${displayValue(row[columnName])}</span>
                            ${component(Icon, { entry: LinkIcon, size: 13 })}
                          </button>
                        ` : html`
                          <span class="studio-cell-value ${row[columnName] === null
                            ? 'italic text-muted-foreground'
                            : ''}">
                            ${displayValue(row[columnName])}
                          </span>
                        `}
                      </td>
                    `;
                  })}
                  <td class="border-b px-2 text-center">
                    <div class="flex justify-center gap-1">
                      ${gridEditable ? iconButton(
                        PenIcon,
                        'Edit row as JSON',
                        () => this.props.onEditRow(rowIndex),
                        { 'data-testid': `edit-row-${rowIndex}` },
                      ) : ''}
                      ${iconButton(
                        ExportIcon,
                        'Export row',
                        () => this.props.onExport([rowIndex]),
                      )}
                      ${gridEditable ? iconButton(
                        TrashBinMinimalisticIcon,
                        'Delete row',
                        () => this.props.onDeleteRow(rowIndex),
                      ) : ''}
                    </div>
                  </td>
                </tr>
              `)}
              <tr
                class="${!this.props.loading && resultMatches && !rows.length
                  ? ''
                  : 'hidden'}"
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
              ${totalRows && !this.props.customQuery
                ? ` · ${formatCount(firstRow)}–${formatCount(lastRow)}`
                : ''}
            </span>
            ${this.props.customQuery ? html`
              <span>
                Custom query · read-only results
                ${this.props.result.truncated ? ' · truncated at 1,000 rows' : ''}
                · Refresh to reset
              </span>
            ` : html`
              <label class="flex items-center gap-2">
                <span>Rows per page</span>
                <select
                  class="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                  data-testid="page-size"
                  .value="${String(this.props.pageSize)}"
                  @change="${(event: InputEvent) => this.props.onPageSizeChange(
                    (event.target as HTMLSelectElement).value,
                  )}"
                >
                  ${[25, 50, 100, 250, 500].map((size) => html`
                    <option value="${size}" ?selected="${size === this.props.pageSize}">
                      ${size}
                    </option>
                  `)}
                </select>
              </label>
            `}
          </div>
          <div class="${this.props.customQuery ? 'hidden' : 'flex'} items-center gap-2">
            <span class="mr-1 text-sm text-muted-foreground">
              Page ${this.props.page} of ${totalPages}
            </span>
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              disabled: Boolean(this.props.page <= 1 || this.props.loading),
              '@click': () => this.props.onPageChange(this.props.page - 1),
            }, 'Previous')}
            ${component(Button, {
              variant: 'outline',
              size: 'sm',
              disabled: Boolean(
                this.props.page >= totalPages || this.props.loading,
              ),
              '@click': () => this.props.onPageChange(this.props.page + 1),
            }, 'Next')}
          </div>
        </footer>
      </div>
    `;
  }
}
