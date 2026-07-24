import {
  Client,
  ClientTask,
  Component,
  Cossack,
  createRef,
  type RefObject,
} from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import 'monaco-editor/min/vs/editor/editor.main.css';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { StudioSchema } from '../../../src/lib/types';
import { studioSchemaCatalog } from '../schema-store';

export interface CodeEditorProps {
  value: string;
  language: 'sql' | 'json' | 'plaintext';
  theme?: 'light' | 'dark';
  schema?: StudioSchema;
  enabled?: boolean;
  readOnly?: boolean;
  lineNumbers?: 'on' | 'off';
  ariaLabel?: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  [key: string]: unknown;
}

interface MonacoEnvironment {
  getWorker(_moduleId: string, label: string): Worker;
}

function sqlIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `"${name.replaceAll('"', '""')}"`;
}

@Component()
export class CodeEditor extends Cossack {
  declare props: CodeEditorProps;

  containerRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
  private editor?: Monaco.editor.IStandaloneCodeEditor;
  private monaco?: typeof Monaco;
  private completionProvider?: Monaco.IDisposable;
  private disposed = false;
  private initializing = false;

  onMount() {
    void this.initializeEditor();
  }

  @Client()
  private async initializeEditor() {
    if (this.props.enabled === false || this.editor || this.initializing || this.disposed) return;
    const container = this.containerRef.value;
    if (!container) return;
    this.initializing = true;

    try {
      (globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment }).MonacoEnvironment = {
        getWorker(_moduleId, label) {
          return label === 'json' ? new JsonWorker() : new EditorWorker();
        },
      };

      const [monaco] = await Promise.all([
        import('monaco-editor/esm/vs/editor/editor.api'),
        import('monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController'),
        import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution'),
        import('monaco-editor/esm/vs/language/json/monaco.contribution'),
      ]);
      if (this.disposed || !this.containerRef.value) return;
      this.monaco = monaco;
      this.editor = monaco.editor.create(this.containerRef.value, {
        value: this.props.value,
        language: this.props.language,
        theme: this.props.theme === 'light' ? 'vs' : 'vs-dark',
        automaticLayout: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        padding: { top: 10, bottom: 10 },
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: this.props.language === 'sql' ? 'off' : 'on',
        readOnly: this.props.readOnly ?? false,
        lineNumbers: this.props.lineNumbers ?? 'on',
        folding: this.props.lineNumbers !== 'off',
        glyphMargin: false,
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: 'off',
        ariaLabel: this.props.ariaLabel ?? 'Code editor',
      });
      this.editor.onDidChangeModelContent(() => {
        this.props.onChange?.(this.editor?.getValue() ?? '');
      });
      this.editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => this.props.onRun?.(),
      );
      this.registerSqlCompletions();
    } finally {
      this.initializing = false;
    }
  }

  onCleanup() {
    this.disposed = true;
    this.completionProvider?.dispose();
    this.editor?.dispose();
  }

  @ClientTask()
  async syncEditor() {
    await this.initializeEditor();
    if (!this.editor || !this.monaco) return;
    const value = this.props.value ?? '';
    if (this.editor.getValue() !== value) this.editor.setValue(value);
    const model = this.editor.getModel();
    if (model && model.getLanguageId() !== this.props.language) {
      this.monaco.editor.setModelLanguage(model, this.props.language);
      this.registerSqlCompletions();
    }
    this.monaco.editor.setTheme(this.props.theme === 'light' ? 'vs' : 'vs-dark');
    this.editor.updateOptions({
      readOnly: this.props.readOnly ?? false,
      lineNumbers: this.props.lineNumbers ?? 'on',
      folding: this.props.lineNumbers !== 'off',
    });
  }

  @Client()
  private registerSqlCompletions() {
    if (!this.monaco || this.props.language !== 'sql') return;
    this.completionProvider?.dispose();
    const monaco = this.monaco;
    this.completionProvider = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const schema = this.props.schema ?? studioSchemaCatalog.get();
        const objects = schema?.objects ?? [];
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const qualifierMatch = line.match(
          /(?:^|[\s,(])(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|([A-Za-z_][\w$]*))\.\w*$/,
        );
        const qualifier = qualifierMatch
          ? (qualifierMatch[1]?.replaceAll('""', '"') ??
              qualifierMatch[2] ??
              qualifierMatch[3] ??
              qualifierMatch[4])
          : undefined;
        const qualifiedObject = qualifier
          ? objects.find((object) => object.name.toLowerCase() === qualifier.toLowerCase())
          : undefined;
        const catalog = qualifiedObject ? [qualifiedObject] : objects;
        const suggestions: Monaco.languages.CompletionItem[] = catalog.flatMap((object) => [
          ...(qualifiedObject ? [] : [{
            label: object.name,
            insertText: sqlIdentifier(object.name),
            detail: object.kind === 'view' ? 'Database view' : 'Database table',
            kind: object.kind === 'view'
              ? monaco.languages.CompletionItemKind.Interface
              : monaco.languages.CompletionItemKind.Struct,
            range,
          }]),
          ...object.columns.map((column) => ({
            label: column.name,
            insertText: sqlIdentifier(column.name),
            detail: `${object.name} · ${column.dataType || column.affinity}`,
            kind: monaco.languages.CompletionItemKind.Field,
            range,
          })),
        ]);
        return { suggestions };
      },
    });
  }

  render() {
    const {
      value: _value,
      language: _language,
      theme: _theme,
      schema: _schema,
      enabled: _enabled,
      readOnly: _readOnly,
      lineNumbers: _lineNumbers,
      ariaLabel: _ariaLabel,
      onChange: _onChange,
      onRun: _onRun,
      class: className = '',
      ...rest
    } = this.props;
    return html`
      <div
        class="studio-code-editor overflow-hidden rounded-md border bg-background ${String(className)}"
        ...=${rest}
      >
        <div
          ref=${this.containerRef}
          class="h-full ${this.props.lineNumbers === 'off' ? 'min-h-0' : 'min-h-[8rem]'}"
        ></div>
      </div>
    `;
  }
}
