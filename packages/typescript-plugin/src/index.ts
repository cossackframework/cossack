/**
 * TypeScript language service plugin for Cossack templates. It adds the
 * template diagnostics of `cossack check templates` to the editor (errors and
 * warnings as semantic diagnostics, hints as suggestions) and completes tag
 * names, attributes, `@events`, `.properties`, `?booleans`, component props
 * and enumerated values inside `html` and `svg` templates.
 *
 * Enable it in tsconfig.json:
 *   "compilerOptions": { "plugins": [{ "name": "@cossackframework/typescript-plugin" }] }
 */
import type * as TS from 'typescript-api';
import { checkTemplates, completeTemplate, type TemplateCompletionKind, type TemplateDiagnosticSeverity } from '@cossackframework/renderer/diagnostics';

type TypeScript = typeof TS;

/** A stable number for a diagnostic code; TypeScript diagnostics need numeric codes. */
const codeNumber = (code: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) hash = Math.imul(hash ^ code.charCodeAt(i), 0x01000193) >>> 0;
  return 91000 + (hash % 9000);
};

function init(modules: { typescript: TypeScript }) {
  const ts = modules.typescript;
  const kinds: Record<TemplateCompletionKind, TS.ScriptElementKind> = {
    element: ts.ScriptElementKind.keyword,
    'end-tag': ts.ScriptElementKind.keyword,
    attribute: ts.ScriptElementKind.jsxAttribute,
    boolean: ts.ScriptElementKind.jsxAttribute,
    event: ts.ScriptElementKind.memberFunctionElement,
    property: ts.ScriptElementKind.memberVariableElement,
    prop: ts.ScriptElementKind.memberVariableElement,
    value: ts.ScriptElementKind.string,
  };
  const categories: Record<TemplateDiagnosticSeverity, TS.DiagnosticCategory> = {
    error: ts.DiagnosticCategory.Error,
    warning: ts.DiagnosticCategory.Warning,
    hint: ts.DiagnosticCategory.Suggestion,
  };

  function create(info: TS.server.PluginCreateInfo): TS.LanguageService {
    const service = info.languageService;
    const log = (message: string) => info.project.projectService.logger.info(`[cossack] ${message}`);
    const proxy = Object.create(null) as TS.LanguageService;
    for (const key of Object.keys(service) as (keyof TS.LanguageService)[]) {
      const member = service[key];
      (proxy as unknown as Record<string, unknown>)[key] = typeof member === 'function' ? (...args: unknown[]) => (member as Function).apply(service, args) : member;
    }

    const templateDiagnostics = (fileName: string, severities: readonly TemplateDiagnosticSeverity[]): TS.DiagnosticWithLocation[] => {
      try {
        const program = service.getProgram();
        const sourceFile = program?.getSourceFile(fileName);
        if (!program || !sourceFile) return [];
        return checkTemplates(ts, program, sourceFile)
          .filter((diagnostic) => severities.includes(diagnostic.severity))
          .map((diagnostic) => ({
            file: sourceFile, start: diagnostic.start, length: diagnostic.length, source: 'cossack',
            messageText: `${diagnostic.message} (${diagnostic.code})`,
            category: categories[diagnostic.severity], code: codeNumber(diagnostic.code),
          }));
      } catch (error) {
        log(`template diagnostics failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        return [];
      }
    };

    proxy.getSemanticDiagnostics = (fileName) => [...service.getSemanticDiagnostics(fileName), ...templateDiagnostics(fileName, ['error', 'warning'])];
    proxy.getSuggestionDiagnostics = (fileName) => [...service.getSuggestionDiagnostics(fileName), ...templateDiagnostics(fileName, ['hint'])];
    proxy.getCompletionsAtPosition = (fileName, position, options, formatting) => {
      try {
        const program = service.getProgram();
        const sourceFile = program?.getSourceFile(fileName);
        const completions = program && sourceFile ? completeTemplate(ts, program, sourceFile, position) : undefined;
        if (completions) {
          return {
            isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false,
            entries: completions.entries.map((entry) => ({
              name: entry.name, kind: kinds[entry.kind], kindModifiers: '', sortText: entry.kind === 'end-tag' ? '0' : '1',
              replacementSpan: completions.replace, ...(entry.type ? { labelDetails: { detail: `: ${entry.type}` } } : {}),
            })),
          };
        }
      } catch (error) {
        log(`template completions failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      }
      return service.getCompletionsAtPosition(fileName, position, options, formatting);
    };
    log('template diagnostics and completions enabled');
    return proxy;
  }

  return { create };
}

export default init;
