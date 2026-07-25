import { Component, Cossack } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { ExportIcon } from '@cossackframework/solar-icons/export';
import {
  Alert,
  Button,
  Checkbox,
  Icon,
  Sheet,
  Textarea,
} from '@cossackframework/ui';
import type { StudioObject } from '../../../../src/lib/schema-types';
import type {
  BatchUpdateState,
  ExportFormat,
  ExportSheetState,
  RowEditorState,
} from '../../studio-page';
import type { StudioTheme } from '../../theme.client';
import { CodeEditor } from '../CodeEditor';

interface RowEditorSheetProps {
  object?: StudioObject;
  editor: RowEditorState | null;
  theme: StudioTheme;
  saving: boolean;
  onClose: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  [key: string]: unknown;
}

@Component()
export class RowEditorSheet extends Cossack {
  declare props: RowEditorSheetProps;

  render() {
    const { editor, object } = this.props;
    return component(Sheet, {
      open: Boolean(editor && object),
      side: 'right',
      size: 'min(48rem, 94vw)',
      onClose: this.props.onClose,
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
          '@click': this.props.onClose,
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
          theme: this.props.theme,
          enabled: Boolean(editor),
          ariaLabel: `JSON row for ${object?.name ?? 'table'}`,
          'data-testid': 'row-json-editor',
          onChange: this.props.onChange,
          onRun: this.props.onSave,
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
          '@click': this.props.onClose,
        }, 'Cancel')}
        ${component(Button, {
          disabled: this.props.saving,
          'data-testid': 'save-row-editor',
          '@click': this.props.onSave,
        }, this.props.saving ? 'Saving…' : 'Save row')}
      </footer>
    `);
  }
}

interface ExportSheetProps {
  object?: StudioObject;
  state: ExportSheetState | null;
  browseColumns: string[];
  onClose: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onToggleColumn: (name: string, checked: boolean) => void;
  onDownload: () => void;
  [key: string]: unknown;
}

@Component()
export class ExportSheet extends Cossack {
  declare props: ExportSheetProps;

  render() {
    const { state, object } = this.props;
    const columns = this.props.browseColumns.length
      ? this.props.browseColumns
      : object?.columns.filter((column) => !column.hidden).map((column) => column.name) ?? [];
    return component(Sheet, {
      open: Boolean(state && object),
      side: 'right',
      size: 'min(32rem, 92vw)',
      onClose: this.props.onClose,
      'data-testid': 'export-sheet',
    }, html`
      <header class="border-b p-5">
        <h2 class="font-semibold">
          Export ${state?.rowIndexes.length ?? 0}
          row${state?.rowIndexes.length === 1 ? '' : 's'}
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Choose a format and the columns to include.
        </p>
      </header>
      <div class="min-h-0 flex-1 overflow-auto p-5">
        <label class="grid gap-1 text-sm font-medium">
          Format
          <select
            class="h-10 rounded-md border border-input bg-background px-3 font-normal"
            .value="${state?.format ?? 'json'}"
            @change="${(event: InputEvent) => this.props.onFormatChange(
              (event.target as HTMLSelectElement).value as ExportFormat,
            )}"
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <fieldset class="mt-5 grid gap-3">
          <legend class="mb-2 text-sm font-medium">Columns</legend>
          ${columns.map((column) => component(Checkbox, {
            checked: state?.columns.includes(column) ?? false,
            '@change': (event: InputEvent) => this.props.onToggleColumn(
              column,
              (event.target as HTMLInputElement).checked,
            ),
          }, column))}
        </fieldset>
      </div>
      <footer class="flex justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': this.props.onClose,
        }, 'Cancel')}
        ${component(Button, {
          class: 'gap-2',
          disabled: !state?.columns.length,
          '@click': this.props.onDownload,
        }, html`${component(Icon, { entry: ExportIcon, size: 16 })}Export`)}
      </footer>
    `);
  }
}

interface BatchUpdateSheetProps {
  object?: StudioObject;
  state: BatchUpdateState | null;
  selectedCount: number;
  saving: boolean;
  onClose: () => void;
  onColumnChange: (column: string) => void;
  onNullChange: (isNull: boolean) => void;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  [key: string]: unknown;
}

@Component()
export class BatchUpdateSheet extends Cossack {
  declare props: BatchUpdateSheetProps;

  render() {
    const { state, object } = this.props;
    const column = object?.columns.find((candidate) => candidate.name === state?.column);
    return component(Sheet, {
      open: Boolean(state && object),
      side: 'right',
      size: 'min(32rem, 92vw)',
      onClose: this.props.onClose,
      'data-testid': 'batch-update-sheet',
    }, html`
      <header class="border-b p-5">
        <h2 class="font-semibold">Update ${this.props.selectedCount} selected rows</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Set one column to the same value for every selected row.
        </p>
      </header>
      <div class="flex-1 space-y-4 p-5">
        <label class="grid gap-1 text-sm font-medium">
          Column
          <select
            class="h-10 rounded-md border border-input bg-background px-3 font-normal"
            .value="${state?.column ?? ''}"
            @change="${(event: InputEvent) => this.props.onColumnChange(
              (event.target as HTMLSelectElement).value,
            )}"
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
          '@change': (event: InputEvent) => this.props.onNullChange(
            (event.target as HTMLInputElement).checked,
          ),
        }, 'Set an explicit NULL value') : ''}
        ${component(Textarea, {
          class: 'min-h-44 bg-background font-mono',
          disabled: state?.mode === 'null',
          '.value': state?.value ?? '',
          '@input': (event: InputEvent) => this.props.onValueChange(
            (event.target as HTMLTextAreaElement).value,
          ),
        })}
      </div>
      <footer class="flex justify-end gap-2 border-t p-4">
        ${component(Button, {
          variant: 'ghost',
          '@click': this.props.onClose,
        }, 'Cancel')}
        ${component(Button, {
          disabled: this.props.saving,
          '@click': this.props.onSubmit,
        }, this.props.saving ? 'Updating…' : 'Update selected')}
      </footer>
    `);
  }
}
