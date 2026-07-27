declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneEditor' {
  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

  export const create: typeof Monaco.editor.create;
  export const setModelLanguage: typeof Monaco.editor.setModelLanguage;
  export const setTheme: typeof Monaco.editor.setTheme;
}

declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneLanguages' {
  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

  export const registerCompletionItemProvider:
    typeof Monaco.languages.registerCompletionItemProvider;
}

declare module 'monaco-editor/esm/vs/editor/common/services/editorBaseApi' {
  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

  export const KeyMod: typeof Monaco.KeyMod;
}

declare module 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums' {
  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

  export const CompletionItemKind: typeof Monaco.languages.CompletionItemKind;
  export const KeyCode: typeof Monaco.KeyCode;
}
