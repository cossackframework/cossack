/**
 * CodeMirror 6 behind the CodeEditor component. Loaded in the browser on first use, so pages
 * that never show an editor never download it. Languages beyond the common six load on demand
 * from `@codemirror/language-data`.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, placeholder as placeholderOf } from '@codemirror/view';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { unifiedMergeView } from '@codemirror/merge';

export interface CodeEditorOptions {
    value: string;
    language: string;
    readOnly: boolean;
    placeholder: string;
    label: string;
    /** Compare the value with this text: a read-only unified diff. */
    original: string | null;
    /** JSON: the schema to lint and complete against. */
    schema: object | null;
    onChange(value: string): void;
}

export interface CodeEditorHandle {
    /** Replace the text from outside, without reporting it as a change. */
    setValue(value: string): void;
    setLanguage(name: string): Promise<void>;
    focus(): void;
    destroy(): void;
}

const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx', md: 'markdown', yml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', htm: 'html', py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', cs: 'c#', 'c++': 'cpp', 'c#': 'csharp' };

/** The language support for a name such as `json`, `ts` or `python`, or null for plain text. */
export async function languageFor(name: string): Promise<LanguageSupport | null> {
    const wanted = (ALIASES[name.trim().toLowerCase()] ?? name.trim().toLowerCase());
    if (!wanted) return null;
    switch (wanted) {
        case 'json': return (await import('@codemirror/lang-json')).json();
        case 'javascript': return (await import('@codemirror/lang-javascript')).javascript();
        case 'typescript': return (await import('@codemirror/lang-javascript')).javascript({ typescript: true });
        case 'jsx': return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
        case 'tsx': return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
        case 'html': return (await import('@codemirror/lang-html')).html();
        case 'css': return (await import('@codemirror/lang-css')).css();
        case 'markdown': return (await import('@codemirror/lang-markdown')).markdown();
    }
    const description = languages.find(entry => entry.name.toLowerCase() === wanted || entry.alias.includes(wanted) || entry.extensions.includes(wanted));
    return description ? description.load() : null;
}

/** The editor in the site's colors: the theme tokens, so light and dark follow the page. */
const theme = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--foreground)', fontSize: '0.8125rem' },
    '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', caretColor: 'var(--foreground)', padding: '0.5rem 0' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 40%, transparent)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
    '.cm-placeholder': { color: 'var(--muted-foreground)' },
    '.cm-changedLine, .cm-deletedChunk': { backgroundColor: 'color-mix(in oklab, var(--primary) 8%, transparent)' },
    '.cm-insertedLine': { backgroundColor: 'color-mix(in oklab, #10b981 14%, transparent)' },
    '.cm-deletedChunk': { backgroundColor: 'color-mix(in oklab, var(--destructive) 12%, transparent)' },
    '.cm-deletedText': { textDecoration: 'line-through' },
});

export function mountCodeEditor(parent: HTMLElement, options: CodeEditorOptions): CodeEditorHandle {
    const language = new Compartment();
    const editable = new Compartment();
    const schemaSupport = new Compartment();
    let held = options.value;
    const extensions: Extension[] = [
        lineNumbers(), highlightSpecialChars(), history(), drawSelection(), indentOnInput(), bracketMatching(), foldGutter(), highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        theme, EditorView.lineWrapping,
        language.of([]),
        editable.of([EditorView.editable.of(!options.readOnly), EditorState.readOnly.of(options.readOnly)]),
        EditorView.contentAttributes.of({ 'aria-label': options.label }),
        ...(options.placeholder ? [placeholderOf(options.placeholder)] : []),
        ...(options.original !== null ? [unifiedMergeView({ original: options.original, mergeControls: false, highlightChanges: true, gutter: true })] : []),
        schemaSupport.of([]),
        EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            const value = update.state.doc.toString();
            if (value === held) return;
            held = value;
            options.onChange(value);
        }),
    ];
    const view = new EditorView({ parent, state: EditorState.create({ doc: options.value, extensions }) });
    const apply = async (name: string) => {
        const support = await languageFor(name);
        if (view.dom.isConnected) view.dispatch({ effects: language.reconfigure(support ?? []) });
    };
    void apply(options.language);
    // The schema's linting, completion and hover help load with the first JSON document that has one.
    if (options.schema && ['json', 'jsonc', 'json5'].includes(options.language.trim().toLowerCase())) {
        void import('codemirror-json-schema').then(({ jsonSchema }) => {
            if (view.dom.isConnected) view.dispatch({ effects: schemaSupport.reconfigure(jsonSchema(options.schema as Parameters<typeof jsonSchema>[0])) });
        }).catch(error => console.warn('[ui] the JSON schema support could not load', error));
    }
    return {
        setValue(value) {
            if (value === held) return;
            held = value;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
        },
        setLanguage: apply,
        focus() { view.focus(); },
        destroy() { view.destroy(); },
    };
}
