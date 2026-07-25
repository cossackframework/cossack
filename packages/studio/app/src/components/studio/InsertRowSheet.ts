import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { RefreshIcon } from '@cossackframework/solar-icons/refresh';
import {
  Alert,
  Button,
  DatePicker,
  Icon,
  Input,
  Sheet,
} from '@cossackframework/ui';
import type { StudioObject } from '../../../../src/lib/schema-types';
import type { InsertValueKind } from '../../../../src/lib/query-types';
import {
  defaultInsertValueKind,
  INSERT_VALUE_KINDS,
  type InsertFieldState,
  type InsertSelection,
} from '../../studio-page';
import type { StudioTheme } from '../../theme.client';
import { CodeEditor } from '../CodeEditor';

interface InsertRowSheetProps {
  object?: StudioObject;
  open: boolean;
  fields: Record<string, InsertFieldState>;
  error: string;
  theme: StudioTheme;
  inserting: boolean;
  onClose: () => void;
  onValueChange: (column: string, value: string) => void;
  onSelectionChange: (column: string, selection: InsertSelection) => void;
  onRegenerateValue: (column: string, kind: InsertValueKind) => void;
  onSubmit: () => void;
  [key: string]: unknown;
}

@Component()
export class InsertRowSheet extends Cossack {
  declare props: InsertRowSheetProps;

  render() {
    const { object } = this.props;
    return component(Sheet, {
      open: Boolean(this.props.open && object?.editable),
      side: 'right',
      size: 'min(42rem, 94vw)',
      onClose: this.props.onClose,
      'data-testid': 'insert-form',
    }, html`
      <header class="shrink-0 border-b p-5">
        <h2 class="font-semibold">Insert row</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Add a new row to ${object?.name ?? 'the selected table'}.
        </p>
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-5">
        ${this.props.error ? component(Alert, {
          variant: 'destructive',
          title: 'Could not insert row',
          class: 'mb-4',
          'data-testid': 'insert-error',
        }, this.props.error) : ''}
        <div class="grid grid-cols-1 gap-4">
          ${object?.columns.filter((column) => !column.hidden).map((column) => {
            const field = this.props.fields[column.name] ?? {
              mode: 'value',
              valueKind: defaultInsertValueKind(column),
              value: '',
            };
            const { mode, valueKind, value } = field;
            const selection: InsertSelection = mode === 'value' ? valueKind : mode;
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
                      theme: this.props.theme,
                      readOnly: mode !== 'value',
                      lineNumbers: 'off',
                      ariaLabel: `JSON value for ${column.name}`,
                      'data-testid': `insert-value-${column.name}`,
                      onChange: (nextValue: string) =>
                        this.props.onValueChange(column.name, nextValue),
                    }) : valueKind === 'date' ? html`
                      <div
                        id="insert-value-${column.name}"
                        class="rounded-md ${activeClass}"
                        data-testid="insert-value-${column.name}"
                      >
                        ${component(DatePicker, {
                          value,
                          onChange: (nextValue: string) =>
                            this.props.onValueChange(column.name, nextValue),
                        })}
                      </div>
                    ` : valueKind === 'boolean' ? html`
                      <select
                        id="insert-value-${column.name}"
                        class="h-10 w-full rounded-md border border-input px-3 ${activeClass}"
                        data-testid="insert-value-${column.name}"
                        ?disabled="${mode !== 'value'}"
                        .value="${value}"
                        @change="${(event: InputEvent) => this.props.onValueChange(
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
                          type: valueKind === 'number'
                            ? 'number'
                            : valueKind === 'datetime'
                              ? 'datetime-local'
                              : 'text',
                          disabled: mode !== 'value',
                          'data-testid': `insert-value-${column.name}`,
                          '.value': value,
                          '@input': (event: InputEvent) => this.props.onValueChange(
                            column.name,
                            (event.target as HTMLInputElement).value,
                          ),
                        })}
                        ${valueKind === 'uuid-v4' ||
                          valueKind === 'uuid-v7' ||
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
                              '@click': () =>
                                this.props.onRegenerateValue(column.name, valueKind),
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
                    @change="${(event: InputEvent) => this.props.onSelectionChange(
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
          '@click': this.props.onClose,
        }, 'Cancel')}
        ${component(Button, {
          disabled: this.props.inserting,
          'data-testid': 'submit-insert',
          '@click': this.props.onSubmit,
        }, this.props.inserting ? 'Inserting…' : 'Insert Row')}
      </footer>
    `);
  }
}
