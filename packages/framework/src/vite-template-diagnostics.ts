/**
 * Template diagnostics in Vite: builds fail on template errors and print
 * warnings; the dev server reports diagnostics as files change.
 *
 * The rules live in the renderer and the TypeScript program in the cossack
 * CLI (`cossack check templates`), so both are loaded from the project. A
 * project without the CLI gets one warning and no template checks.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

export interface TemplateDiagnosticRecord {
  code: string;
  severity: 'error' | 'warning' | 'hint';
  message: string;
  /** Project-relative, with forward slashes. */
  file: string;
  line: number;
  column: number;
  /** `file:line:column`. */
  source: string;
}

interface TemplateCheckModule {
  checkProjectTemplates(root: string, options?: { hints?: boolean }): { files: number; diagnostics: TemplateDiagnosticRecord[] };
}

const MISSING = '[cossack] Template diagnostics need the cossack CLI. Install it as a project dependency to check html templates.';

/** Resolve a module of the project's cossack CLI package. */
const resolveCli = (root: string, module: string): string | undefined => {
  try {
    return createRequire(join(root, 'package.json')).resolve(`cossack/src/${module}`);
  } catch {
    return undefined;
  }
};

export const formatTemplateDiagnostic = (diagnostic: TemplateDiagnosticRecord): string =>
  `${diagnostic.source} - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;

/** Check the whole project once, for a build. */
export async function checkTemplatesForBuild(root: string): Promise<{ errors: TemplateDiagnosticRecord[]; warnings: TemplateDiagnosticRecord[] } | { unavailable: string }> {
  const file = resolveCli(root, 'template-check.js');
  if (!file) return { unavailable: MISSING };
  const check = await import(pathToFileURL(file).href) as TemplateCheckModule;
  const { diagnostics } = check.checkProjectTemplates(root, { hints: false });
  return {
    errors: diagnostics.filter(diagnostic => diagnostic.severity === 'error'),
    warnings: diagnostics.filter(diagnostic => diagnostic.severity === 'warning'),
  };
}

export interface DevelopmentTemplateChecks {
  /** Recheck after these files changed. */
  changed(files: readonly string[]): void;
  close(): void;
}

/**
 * Check templates in a worker as files change. `report` receives the lines
 * of each file whose diagnostics changed since the last report; a file that
 * became clean reports an empty list.
 */
export function startDevelopmentTemplateChecks(root: string, report: (file: string, diagnostics: TemplateDiagnosticRecord[]) => void,
  warn: (message: string) => void): DevelopmentTemplateChecks | undefined {
  const script = resolveCli(root, 'template-check-worker.js');
  if (!script) {
    warn(MISSING);
    return undefined;
  }
  const worker = new Worker(script, { workerData: { root } });
  worker.unref();
  let reported = new Map<string, string>();
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let next = 0;
  worker.on('message', (message: { id: number; diagnostics?: TemplateDiagnosticRecord[]; error?: string }) => {
    running = false;
    if (message.error) warn(`[cossack] Template diagnostics failed: ${message.error}`);
    else {
      const byFile = new Map<string, TemplateDiagnosticRecord[]>();
      for (const diagnostic of message.diagnostics ?? []) {
        if (diagnostic.severity === 'hint') continue;
        const list = byFile.get(diagnostic.file) ?? [];
        list.push(diagnostic);
        byFile.set(diagnostic.file, list);
      }
      const current = new Map([...byFile].map(([file, list]) => [file, list.map(formatTemplateDiagnostic).join('\n')]));
      for (const [file, text] of current) if (reported.get(file) !== text) report(file, byFile.get(file)!);
      for (const file of reported.keys()) if (!current.has(file)) report(file, []);
      reported = current;
    }
    if (pending.length) flush();
  });
  worker.on('error', (error) => warn(`[cossack] Template diagnostics stopped: ${error.message}`));
  const flush = () => {
    if (running) return;
    running = true;
    const files = pending;
    pending = [];
    worker.postMessage({ id: next++, files });
  };
  flush();
  return {
    changed(files) {
      pending.push(...files);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, 100);
      timer.unref?.();
    },
    close() {
      if (timer) clearTimeout(timer);
      void worker.terminate();
    },
  };
}
