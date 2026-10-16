/**
 * Template diagnostics over a project's TypeScript program.
 *
 * The renderer owns the rules (`@cossackframework/renderer/diagnostics`);
 * this module supplies the CLI's pinned compiler and the project program.
 * `cossack check templates` checks once. The Vite plugin keeps a checker
 * alive and rechecks changed files through an incremental language service.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-api';
import { checkTemplates } from '@cossackframework/renderer/diagnostics';

/** Test files may hold deliberately broken templates; checks cover application code. */
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.(?:[cm]?ts|tsx)$/;

const toPosix = (file) => file.split(path.sep).join('/');

/** Compiler options and root files from the project's tsconfig.json. */
export function readProjectConfig(root) {
  root = path.resolve(root);
  const configPath = path.join(root, 'tsconfig.json');
  const fallback = {
    options: {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true,
      experimentalDecorators: true, lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    },
    fileNames: ts.sys.readDirectory(path.join(root, 'src'), ['.ts', '.tsx']),
  };
  if (!fs.existsSync(configPath)) return { ...fallback, configPath: null, errors: [] };
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) return { ...fallback, configPath, errors: [ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n')] };
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root, { noEmit: true }, configPath);
  return { options: parsed.options, fileNames: parsed.fileNames, configPath, errors: [] };
}

/** True for application source files that template checks cover. */
export function isCheckedFile(root, file) {
  root = path.resolve(root);
  const relative = toPosix(path.relative(root, file));
  return SOURCE_FILE.test(relative) && !relative.endsWith('.d.ts') && !relative.startsWith('../') &&
    !path.isAbsolute(relative) && !relative.split('/').includes('node_modules') && !TEST_FILE.test(relative);
}

/** Add project-relative location fields to renderer diagnostics. */
function located(root, diagnostic) {
  const file = toPosix(path.relative(root, diagnostic.file));
  return { ...diagnostic, file, source: `${file}:${diagnostic.line}:${diagnostic.column}` };
}

/**
 * Check every application file of the project at `root` once.
 * @returns {{ files: number, diagnostics: object[] }}
 */
export function checkProjectTemplates(root, { hints = true } = {}) {
  const { options, fileNames } = readProjectConfig(root);
  const program = ts.createProgram(fileNames, options);
  const files = program.getSourceFiles().filter((file) => isCheckedFile(root, file.fileName));
  const diagnostics = files.flatMap((file) => checkTemplates(ts, program, file, { hints }).map((diagnostic) => located(root, diagnostic)));
  return { files: files.length, diagnostics };
}

/**
 * A long-lived checker for the Vite dev server. `update(file)` marks a file
 * changed; `check(files)` reports the diagnostics of those files from the
 * incremental program.
 */
export function createTemplateChecker(root) {
  let config = readProjectConfig(root);
  const versions = new Map();
  const host = {
    getScriptFileNames: () => config.fileNames,
    getScriptVersion: (file) => String(versions.get(path.resolve(file)) ?? 0),
    getScriptSnapshot: (file) => fs.existsSync(file) ? ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8')) : undefined,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return {
    /** Mark a file changed, added or removed. */
    update(file) {
      const absolute = path.resolve(file);
      versions.set(absolute, (versions.get(absolute) ?? 0) + 1);
      if (!config.fileNames.some((name) => path.resolve(name) === absolute)) config = readProjectConfig(root);
    },
    /** Diagnostics of the given files, or of every application file. Hints are left out. */
    check(files) {
      const program = service.getProgram();
      if (!program) return [];
      const selected = files
        ? files.map((file) => program.getSourceFile(path.resolve(file))).filter(Boolean)
        : program.getSourceFiles();
      return selected.filter((file) => isCheckedFile(root, file.fileName))
        .flatMap((file) => checkTemplates(ts, program, file, { hints: false }).map((diagnostic) => located(root, diagnostic)));
    },
    isChecked: (file) => isCheckedFile(root, path.resolve(file)),
    dispose() { service.dispose(); },
  };
}

/** One line per diagnostic, in the `file:line:column` form editors link. */
export function formatTemplateDiagnostic(diagnostic) {
  return `${diagnostic.source} - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}
