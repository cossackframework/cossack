import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { RefreshIcon } from '@cossackframework/solar-icons/refresh';
import {
  Button,
  DatePicker,
  Icon,
  Input,
  Sheet,
  Textarea,
} from '@cossackframework/ui';
import type {
  StudioColumn,
  StudioObject,
} from '../../../../src/lib/schema-types';
import {
  INSERT_VALUE_KINDS,
  type CellEditor,
  type CellSelection,
} from '../../studio-page';
import type { StudioTheme } from '../../theme.client';
import { CodeEditor } from '../CodeEditor';

interface CellEditorSheetProps {
  object?: StudioObject;
  editor: CellEditor | null;
  theme: StudioTheme;
  saving: boolean;
  onClose: () => void;
  onSelectionChange: (selection: CellSelection) => void;
  onValueChange: (value: string) => void;
  onSave: () => void;
  [key: string]: unknown;
}

const fallbackEditor: CellEditor = {
  rowIndex: 0,
  columnName: '',
  value: '',
  mode: 'value',
  kind: 'text',
};

const fallbackColumn: StudioColumn = {
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

@Component()
export class CellEditorSheet extends Cossack {
  declare props: CellEditorSheetProps;

  render() {
    const { editor, object } = this.props;
    const column = object?.columns.find(
      (candidate) => candidate.name === editor?.columnName,
    );
    const activeEditor = editor ?? fallbackEditor;
    const activeColumn = column ?? fallbackColumn;
    const generatedValue = activeEditor.kind === 'timestamp' ||
      activeEditor.kind === 'uuid-v4' ||
      activeEditor.kind === 'uuid-v7';
    const longText = activeEditor.kind !== 'json' &&
      activeEditor.kind !== 'date' &&
      activeEditor.kind !== 'datetime' &&
      activeEditor.kind !== 'number' &&
      activeEditor.kind !== 'boolean' &&
      !generatedValue;

    return component(Sheet, {
      open: Boolean(editor && column),
      side: 'right',
      size: 'min(42rem, 92vw)',
      onClose: this.props.onClose,
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
          '@click': this.props.onClose,
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
              @change="${(event: InputEvent) => this.props.onSelectionChange(
                (event.target as HTMLSelectElement).value as CellSelection,
              )}"
            >
              <optgroup label="Value type">
                ${INSERT_VALUE_KINDS.map((kind) => html`
                  <option
                    value="${kind.value}"
                    ?selected="${activeEditor.mode === 'value' &&
                      activeEditor.kind === kind.value}"
                  >
                    ${kind.label}
                  </option>
                `)}
              </optgroup>
              ${activeColumn.nullable || activeEditor.mode === 'null' ? html`
                <optgroup label="Special">
                  <option value="null" ?selected="${activeEditor.mode === 'null'}">
                    NULL
                  </option>
                </optgroup>
              ` : ''}
            </select>
          </label>
        </div>
        <p class="text-xs text-muted-foreground">
          SQLite does not retain application-level TypeScript types. Change the editor mode when
          the declared database type is not specific enough.
        </p>
        <div
          class="min-h-0 flex-1 ${activeEditor.mode === 'null'
            ? 'pointer-events-none opacity-50'
            : ''}"
        >
          <div class="${activeEditor.kind === 'json' ? 'block' : 'hidden'} h-full">
            ${component(CodeEditor, {
              class: 'h-full min-h-[20rem]',
              value: activeEditor.kind === 'json' ? activeEditor.value : '',
              language: 'json',
              theme: this.props.theme,
              enabled: Boolean(editor?.kind === 'json'),
              ariaLabel: `JSON value for ${activeColumn.name}`,
              'data-testid': 'json-editor',
              onChange: this.props.onValueChange,
              onRun: this.props.onSave,
            })}
          </div>
          <div class="${activeEditor.kind === 'date' ? 'block' : 'hidden'}">
            <div class="grid max-w-sm gap-2">
              <label class="text-sm font-medium">Date</label>
              ${component(DatePicker, {
                value: activeEditor.kind === 'date'
                  ? activeEditor.value.slice(0, 10)
                  : '',
                onChange: this.props.onValueChange,
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
                @input="${(event: InputEvent) => this.props.onValueChange(
                  (event.target as HTMLInputElement).value,
                )}"
              />
            </label>
          </div>
          <div class="${generatedValue ? 'block' : 'hidden'}">
            <div class="flex max-w-xl gap-2">
              ${component(Input, {
                class: 'min-w-0 flex-1 font-mono',
                disabled: activeEditor.mode === 'null',
                '.value': generatedValue ? activeEditor.value : '',
                '@input': (event: InputEvent) => this.props.onValueChange(
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
                '@click': () => this.props.onSelectionChange(activeEditor.kind),
              }, component(Icon, { entry: RefreshIcon, size: 16 }))}
            </div>
          </div>
          <div class="${activeEditor.kind === 'number' ? 'block' : 'hidden'}">
            ${component(Input, {
              type: 'number',
              class: 'max-w-sm font-mono',
              disabled: activeEditor.mode === 'null',
              '.value': activeEditor.kind === 'number' ? activeEditor.value : '',
              '@input': (event: InputEvent) => this.props.onValueChange(
                (event.target as HTMLInputElement).value,
              ),
            })}
          </div>
          <div class="${activeEditor.kind === 'boolean' ? 'block' : 'hidden'}">
            <select
              class="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3"
              .value="${activeEditor.kind === 'boolean' ? activeEditor.value : ''}"
              @change="${(event: InputEvent) => this.props.onValueChange(
                (event.target as HTMLSelectElement).value,
              )}"
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </div>
          <div class="${longText ? 'grid' : 'hidden'} h-full grid-rows-[auto_minmax(0,1fr)] gap-2">
            <div class="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2">
              ${activeEditor.kind === 'blob' ? html`
                <p class="text-xs text-muted-foreground">
                  Enter a base64 or even-length hexadecimal blob value.
                </p>
              ` : ''}
              ${component(Textarea, {
                class: 'h-full min-h-[20rem] resize-none bg-background font-mono',
                'data-testid': 'long-text-editor',
                disabled: activeEditor.mode === 'null',
                '.value': activeEditor.value,
                '@input': (event: InputEvent) => this.props.onValueChange(
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
          '@click': this.props.onClose,
        }, 'Cancel')}
        ${component(Button, {
          disabled: this.props.saving,
          'data-testid': 'save-cell-editor',
          '@click': this.props.onSave,
        }, this.props.saving ? 'Saving…' : 'Save changes')}
      </footer>
    `);
  }
}
