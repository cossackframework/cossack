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
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { prebundleDependencies } from '@cossackframework/core/prebundle-dependencies';
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
  /**
   * How the package exports its served root, from an `exports` entry such as
   * `"./app/*": "./app/src/*.ts"`: the subpath before the star, and the suffix the target adds.
   */
  exported?: { subpath: string; suffix: string };
}

/**
 * The import specifier of a served file (`@cossackframework/cms/app/pages/x`), or null when the
 * package does not export its served root. Generated types use it: unlike an install path, it
 * does not change with the package's version or the package manager's layout.
 */
export function servedSpecifier(mounted: MountedPackage, path: string): string | null {
  if (!mounted.exported) return null;
  if (mounted.exported.suffix && !path.endsWith(mounted.exported.suffix)) return null;
  return `${mounted.name}/${mounted.exported.subpath}${path.slice(0, path.length - mounted.exported.suffix.length)}`;
}

/**
 * The served file an import specifier names (`@cossackframework/cms/app/auth`), or null.
 * The dev server would otherwise pre-bundle such an import as a dependency: a second copy of
 * the module beside the one the page registry loads, and one the security transform never saw.
 */
export function servedSpecifierFile(projectRoot: string, specifier: string): string | null {
  for (const mounted of mountedPackages(projectRoot)) {
    if (!mounted.exported) continue;
    const prefix = `${mounted.name}/${mounted.exported.subpath}`;
    if (!specifier.startsWith(prefix)) continue;
    const [path, query = ''] = specifier.slice(prefix.length).split(/(?=[?#])/, 2) as [string, string?];
    if (!safe(path)) return null;
    for (const candidate of [path + mounted.exported.suffix, path]) {
      const file = join(mounted.root, candidate);
      if (existsSync(file) && statSync(file).isFile()) return file + query;
    }
  }
  return null;
}

function exportedRoot(exports: unknown, root: string): MountedPackage['exported'] {
  if (!exports || typeof exports !== 'object') return undefined;
  for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
    const target = typeof value === 'string' ? value : value && typeof value === 'object'
      ? (value as Record<string, unknown>).import ?? (value as Record<string, unknown>).default : undefined;
    const prefix = `./${root.replace(/\/+$/, '')}/*`;
    if (!key.startsWith('./') || !key.endsWith('/*') || typeof target !== 'string' || !target.startsWith(prefix)) continue;
    return { subpath: key.slice(2, -1), suffix: target.slice(prefix.length) };
  }
  return undefined;
}

const posix = (path: string) => path.split(sep).join('/');
const safe = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && !isAbsolute(path) &&
  !path.includes('\\') && !path.split('/').some(part => part === '..' || part === '.');

interface Cached { stamp: string; packages: MountedPackage[]; /** Each mounted package's manifest file and its stamp. */ manifests: [string, string][] }
const stampOf = (file: string): string => { try { const stat = statSync(file); return `${stat.mtimeMs}:${stat.size}`; } catch { return ''; } };
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
  const stamp = stampOf(manifestPath);
  if (!stamp) return [];
  const cached = cache.get(projectRoot);
  // A package update changes the package's own manifest, not the application's.
  if (cached?.stamp === stamp && cached.manifests.every(([file, known]) => stampOf(file) === known)) return cached.packages;
  const invalid = (message: string) => new PackageMountError('COSSACK_PACKAGE_MOUNT_INVALID', message);
  let names: unknown;
  try { names = JSON.parse(readFileSync(manifestPath, 'utf8'))?.cossack?.packages; }
  catch { names = undefined; }
  if (names === undefined) { cache.set(projectRoot, { stamp, packages: [], manifests: [] }); return []; }
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
      ...(exportedRoot(manifest.exports, field.root) ? { exported: exportedRoot(manifest.exports, field.root) } : {}),
    });
  }
  cache.set(projectRoot, { stamp, packages, manifests: packages.map(mounted => { const file = join(mounted.directory, 'package.json'); return [file, stampOf(file)]; }) });
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

const packageOf = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/**
 * Bare imports of the served files that Vite must pre-bundle up front, for the browser and
 * for the server. A dependency the package declares itself is named through the package
 * (`<package> > <import>`): under a strict install the application cannot resolve it.
 */
export function servedPrebundle(projectRoot: string): { client: string[]; server: string[] } {
  const client = new Set<string>(), server = new Set<string>();
  let application: Record<string, unknown> = {};
  try {
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    application = { ...manifest.dependencies, ...manifest.devDependencies };
  } catch { /* No application dependencies to name. */ }
  for (const mounted of mountedPackages(projectRoot)) {
    const sources: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) { if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) visit(join(directory, entry.name)); continue; }
        if (entry.name.endsWith('.ts') && !/\.(?:d|test|spec)\.ts$/.test(entry.name)) sources.push(readFileSync(join(directory, entry.name), 'utf8'));
      }
    };
    visit(mounted.root);
    let own: Record<string, unknown> = {};
    try { own = JSON.parse(readFileSync(join(mounted.directory, 'package.json'), 'utf8')).dependencies ?? {}; } catch { /* Listed plainly. */ }
    const viaPackage = (specifier: string) => packageOf(specifier) !== mounted.name && Object.hasOwn(own, packageOf(specifier));
    // A dependency the application declares too is also listed plainly: the application's
    // `resolve.dedupe` sends the served file's import to the application's copy, which is
    // another file than the package's when the package is linked from a workspace.
    const names = (specifier: string) => !viaPackage(specifier) ? [specifier]
      : Object.hasOwn(application, packageOf(specifier)) ? [`${mounted.name} > ${specifier}`, specifier] : [`${mounted.name} > ${specifier}`];
    const found = prebundleDependencies(sources);
    for (const specifier of found.client) for (const name of names(specifier)) client.add(name);
    for (const specifier of found.server) for (const name of names(specifier)) server.add(name);
  }
  return { client: [...client].sort(), server: [...server].sort() };
}

/**
 * The text of a served file as a copy in the application holds it: an import that leaves the
 * copied unit and stays inside the package becomes the package specifier
 * (`'../../../cms/site'` → `'@cossackframework/cms/app/cms/site'`), so the copy and the package
 * share one instance of every module. `unit` is the served path of what is copied as a whole:
 * the file itself, or a plugin's directory (`plugins/default-theme/`), whose own files keep
 * their relative imports. A pure function of the text and the paths: an upgrade applies it to
 * the package's new text before it merges.
 */
export function rewriteServedImports(text: string, mounted: MountedPackage, path: string, unit: string = path): string {
  const directory = path.slice(0, path.lastIndexOf('/') + 1);
  const inUnit = (target: string) => unit.endsWith('/') ? target.startsWith(unit) : target === unit;
  return text.replace(/((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)')(\.{1,2}\/[^']*)(')/g, (all, before: string, specifier: string, after: string) => {
    const [bare, query = ''] = specifier.split(/(?=[?#])/, 2) as [string, string?];
    const parts: string[] = [];
    for (const part of (directory + bare).split('/')) {
      if (part === '..') { if (!parts.length) return all; parts.pop(); }
      else if (part !== '.' && part !== '') parts.push(part);
    }
    const stem = parts.join('/');
    const target = [stem, `${stem}.ts`, `${stem}/index.ts`].find(candidate => existsSync(join(mounted.root, candidate)) && statSync(join(mounted.root, candidate)).isFile());
    if (!target || inUnit(target)) return all;
    const named = servedSpecifier(mounted, target) ?? (mounted.exported ? `${mounted.name}/${mounted.exported.subpath}${target}` : null);
    return named ? `${before}${named}${query}${after}` : all;
  });
}

/** What a served path is, for overriding: only these can be replaced by an application file. */
export function servedKind(mounted: MountedPackage, path: string): 'page' | 'config' | 'plugin' | null {
  const plugin = mounted.plugins.find(entry => path === entry.slice(0, -1) || path.startsWith(entry));
  if (plugin) return 'plugin';
  if (mounted.config.includes(path)) return 'config';
  if (mounted.pages.some(entry => entry.endsWith('/') ? path.startsWith(entry) : path === entry)) return 'page';
  return null;
}
