/**
 * Node-only: packages an application mounts (specs/package-routes.md).
 *
 * The application names them in its `package.json`:
 *   "cossack": { "packages": ["@cossackframework/cms"] }
 * Each package states what it serves in its own `package.json`:
 *   "cossack": { "root": "app/src", "pages": ["pages/(site)/"], "plugins": ["plugins/default-theme/"],
 *                "config": ["config/cms.ts"], "middlewares": "cms/middleware.ts", "host": ["cms/database.ts"] }
 * A served file at `<root>/<path>` takes the application path `/src/<path>`. A file the
 * application has at that path overrides the package's.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class PackageMountError extends Error {
  readonly code: 'COSSACK_PACKAGE_MOUNT_INVALID' | 'COSSACK_PACKAGE_HOST_MISSING' | 'COSSACK_PACKAGE_HOST_OUTDATED';
  constructor(code: PackageMountError['code'], message: string) {
    super(`[Cossack] ${code}: ${message}`);
    this.name = 'PackageMountError';
    this.code = code;
  }
}

export interface MountedPackage {
  name: string;
  version: string;
  /** Short name for `cossack eject <alias> <path>`. */
  alias?: string;
  /** Real path of the package directory. */
  directory: string;
  /** Real path of the served root. Served paths are relative to it. */
  root: string;
  /** The package directory is a workspace link, so its files can change while a dev server runs. */
  linked: boolean;
  /** Page directories (trailing slash) and page files, each beginning with `pages/`. */
  pages: string[];
  /** Plugin directories as `plugins/<name>/`. */
  plugins: string[];
  /** Config factory files, each `config/<file>.ts`. */
  config: string[];
  /** Global middleware module. */
  middlewares?: string;
  /** `@/` modules the application must provide. */
  host: string[];
  /** Oldest scaffold template whose host modules the served code works with. */
  hostTemplate?: string;
}

const posix = (path: string) => path.split(sep).join('/');
const safe = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && !isAbsolute(path) &&
  !path.includes('\\') && !path.split('/').some(part => part === '..' || part === '.');

interface Cached { stamp: string; packages: MountedPackage[] }
const cache = new Map<string, Cached>();

function locate(projectRoot: string, name: string): string | null {
  try { return dirname(createRequire(join(projectRoot, 'package.json')).resolve(`${name}/package.json`)); }
  catch { /* No `./package.json` export, or not installed: look in node_modules. */ }
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(directory) === directory) return null;
  }
}

/** The packages named in the application's `package.json#cossack.packages`, in that order. */
export function mountedPackages(projectRoot: string): MountedPackage[] {
  const manifestPath = join(projectRoot, 'package.json');
  let stamp: string;
  try { const stat = statSync(manifestPath); stamp = `${stat.mtimeMs}:${stat.size}`; }
  catch { return []; }
  const cached = cache.get(projectRoot);
  if (cached?.stamp === stamp) return cached.packages;
  const invalid = (message: string) => new PackageMountError('COSSACK_PACKAGE_MOUNT_INVALID', message);
  let names: unknown;
  try { names = JSON.parse(readFileSync(manifestPath, 'utf8'))?.cossack?.packages; }
  catch { names = undefined; }
  if (names === undefined) { cache.set(projectRoot, { stamp, packages: [] }); return []; }
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw invalid('package.json#cossack.packages must be a list of package names.');
  const packages: MountedPackage[] = [];
  for (const name of new Set(names as string[])) {
    const found = locate(projectRoot, name);
    if (!found) throw invalid(`${name} is named in package.json#cossack.packages and is not installed.`);
    const directory = realpathSync(found);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const field = manifest.cossack;
    if (!field || typeof field !== 'object' || !safe(field.root)) throw invalid(`${name} serves nothing: its package.json has no cossack.root.`);
    const root = join(directory, field.root);
    if (!existsSync(root)) throw invalid(`${name} names the served root ${field.root}, which does not exist.`);
    const list = (key: string, test: (path: string) => boolean, shape: string): string[] => {
      const value = field[key] ?? [];
      if (!Array.isArray(value) || value.some(path => !safe(path) || !test(path))) throw invalid(`${name}: package.json#cossack.${key} must list ${shape}.`);
      return value;
    };
    if (field.middlewares !== undefined && !safe(field.middlewares)) throw invalid(`${name}: package.json#cossack.middlewares must be a path under the served root.`);
    packages.push({
      name, version: String(manifest.version ?? ''), directory, root,
      ...(typeof field.alias === 'string' ? { alias: field.alias } : {}),
      linked: !posix(directory).split('/').includes('node_modules'),
      pages: list('pages', path => path.startsWith('pages/'), 'paths that begin with pages/'),
      plugins: list('plugins', path => /^plugins\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/$/.test(path), 'plugin directories as plugins/<name>/'),
      config: list('config', path => /^config\/[^/]+\.ts$/.test(path), 'files as config/<name>.ts'),
      ...(field.middlewares !== undefined ? { middlewares: field.middlewares } : {}),
      host: list('host', () => true, 'paths under the application\'s src'),
      ...(typeof field.hostTemplate === 'string' ? { hostTemplate: field.hostTemplate } : {}),
    });
  }
  cache.set(projectRoot, { stamp, packages });
  return packages;
}

/** The mounted package that holds `file` under its served root, with the file's path under that root. */
export function servedFile(projectRoot: string, file: string): { package: MountedPackage; path: string } | null {
  const normalized = posix(file);
  for (const mounted of mountedPackages(projectRoot)) {
    const root = posix(mounted.root) + '/';
    if (normalized.startsWith(root)) return { package: mounted, path: normalized.slice(root.length) };
  }
  return null;
}

/**
 * A file's path as the project sees it, with a leading slash: `/src/pages/a.ts` inside the
 * project, `/../shared/pkg/app/src/pages/a.ts` or `/node_modules/...` for a mounted package.
 * `resolve(projectRoot, path.slice(1))` gives the file back, and without the slash it is the
 * file's key in Vite's build manifest.
 */
export function projectPath(projectRoot: string, file: string): string {
  return '/' + posix(relative(projectRoot, file));
}

/** An import specifier Vite resolves from a virtual module: root-relative inside the project, absolute outside. */
export function importSpecifier(projectRoot: string, file: string): string {
  const path = posix(relative(projectRoot, file));
  return path.startsWith('../') || isAbsolute(path) ? posix(file) : '/' + path;
}

export interface MapEntry {
  /** The key the module is stored under, in application shape (`/src/...`). */
  key: string;
  /** Absolute path of the module. */
  file: string;
}

let mapCounter = 0;

/**
 * JavaScript that declares `const <name> = { <key>: <module>, ... }` from explicit imports.
 * It replaces `import.meta.glob`, which cannot reach a mounted package's files.
 * `eager` stores module namespaces (or `default` with `importDefault`); otherwise loaders.
 */
export function moduleMap(name: string, projectRoot: string, entries: readonly MapEntry[],
  options: { eager?: boolean; query?: string; importDefault?: boolean } = {}): string {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const specifier = (entry: MapEntry) => JSON.stringify(importSpecifier(projectRoot, entry.file) + (options.query ?? ''));
  if (!options.eager) {
    const pick = options.importDefault ? '.then(module => module.default)' : '';
    return `const ${name} = {${sorted.map(entry => `\n  ${JSON.stringify(entry.key)}: () => import(${specifier(entry)})${pick},`).join('')}\n};\n`;
  }
  const prefix = `__cossack_${name}_${mapCounter++}_`;
  const imports = sorted.map((entry, index) => options.importDefault
    ? `import ${prefix}${index} from ${specifier(entry)};`
    : `import * as ${prefix}${index} from ${specifier(entry)};`).join('\n');
  return `${imports}\nconst ${name} = {${sorted.map((entry, index) => `\n  ${JSON.stringify(entry.key)}: ${prefix}${index},`).join('')}\n};\n`;
}

/** Compare two dotted versions; a missing or unreadable one compares as equal. */
export function versionBelow(version: string | undefined, minimum: string | undefined): boolean {
  const parse = (value: string | undefined) => /^(\d+)\.(\d+)\.(\d+)/.exec(value ?? '')?.slice(1).map(Number);
  const a = parse(version), b = parse(minimum);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! < b[index]!;
  return false;
}

/**
 * The `@/` modules a mounted package needs must exist, and the project's template must not be
 * older than the package asks for. Returns the problems; an empty list is a pass.
 */
export function hostContractProblems(projectRoot: string): PackageMountError[] {
  const problems: PackageMountError[] = [];
  let templateVersion: string | undefined;
  try { templateVersion = JSON.parse(readFileSync(join(projectRoot, '.cossack/scaffold.json'), 'utf8')).templateVersion; }
  catch { templateVersion = undefined; }
  for (const mounted of mountedPackages(projectRoot)) {
    const missing = mounted.host.filter(path => !existsSync(resolve(projectRoot, 'src', path)));
    if (missing.length) problems.push(new PackageMountError('COSSACK_PACKAGE_HOST_MISSING',
      `${mounted.name} needs ${missing.map(path => 'src/' + path).join(', ')} in the application. Run cossack upgrade to write the missing files.`));
    if (versionBelow(templateVersion, mounted.hostTemplate)) problems.push(new PackageMountError('COSSACK_PACKAGE_HOST_OUTDATED',
      `${mounted.name} ${mounted.version} needs project files from template ${mounted.hostTemplate}, and this project is at ${templateVersion}. Run cossack upgrade.`));
  }
  return problems;
}
