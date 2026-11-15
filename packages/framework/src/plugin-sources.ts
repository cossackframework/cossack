/**
 * Node-only discovery of rendered plugin source under `src/plugins/<name>/`.
 *
 * Plugins are application source rendered at build time (`cossack add plugin`).
 * Their pages overlay the application's page tree: `src/plugins/<p>/pages/a/index.ts`
 * routes exactly like `src/pages/a/index.ts`, inherits the same layouts and
 * boundaries, and a path both define is a build error. Nothing scans at request time.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanPagesDir } from './route-codegen.js';
import { filePathToHttpRoute } from './route-ids.js';
import { createHash } from 'node:crypto';
import { moduleMap, mountedPackages, projectPath, rewriteServedImports, type MapEntry } from './package-mounts.js';

export const PLUGINS_DIRECTORY = 'src/plugins';
/** Plugin directory names: lowercase letters, digits and single hyphens. */
export const PLUGIN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Separator between a plugin name and its translation or config key. */
export const PLUGIN_NAMESPACE_SEPARATOR = '::';

export const PLUGINS_MODULE_ID = 'virtual:cossack-plugins';
/** Rendered manifest beside each plugin's source. */
export const PLUGIN_MANIFEST_FILE = 'plugin.json';
/** Optional server entry; the registry imports it in server environments only. */
export const PLUGIN_SERVER_ENTRY = 'server.ts';
/** Optional UI entry (components for host slots); imported in every environment. */
export const PLUGIN_UI_ENTRY = 'ui.ts';
/** A theme's templates, one default export per file; imported in every environment. */
export const PLUGIN_TEMPLATES = 'templates/*.ts';
/** Files a plugin ships, served as build assets: its logo and cover, and a theme's stylesheets and fonts. */
export const PLUGIN_ASSETS = 'assets/*.{png,jpg,jpeg,webp,gif,avif,svg,css,woff2,woff,ttf,otf}';

export class PluginSourceError extends Error {
  readonly code: 'COSSACK_PLUGIN_NAME_INVALID' | 'COSSACK_PLUGIN_ROUTE_CONFLICT' | 'COSSACK_PLUGIN_MANIFEST_INVALID';
  readonly file: string;
  constructor(code: PluginSourceError['code'], file: string, message: string) {
    super(`[Cossack] ${code}: ${message}`);
    this.name = 'PluginSourceError';
    this.code = code;
    this.file = file;
  }
}

export interface PluginLocation {
  name: string;
  /** Absolute directory of the plugin's source. */
  directory: string;
  /** The mounted package that serves it; absent for a plugin rendered into the application. */
  package?: string;
}

/**
 * Every plugin, sorted by name: those rendered under `src/plugins/` and those a mounted
 * package serves. An application plugin shadows a package's plugin of the same name as a whole.
 * Invalid directory names are an error.
 */
export function pluginLocations(projectRoot: string): PluginLocation[] {
  const locations = new Map<string, PluginLocation>();
  const directory = resolve(projectRoot, PLUGINS_DIRECTORY);
  if (existsSync(directory)) for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!PLUGIN_NAME.test(entry.name)) {
      throw new PluginSourceError('COSSACK_PLUGIN_NAME_INVALID', `${PLUGINS_DIRECTORY}/${entry.name}`,
        `${PLUGINS_DIRECTORY}/${entry.name} is not a valid plugin name. Use lowercase letters, digits and hyphens.`);
    }
    locations.set(entry.name, { name: entry.name, directory: join(directory, entry.name) });
  }
  for (const mounted of mountedPackages(projectRoot)) for (const path of mounted.plugins) {
    const name = path.split('/')[1]!;
    const existing = locations.get(name);
    if (existing?.package) {
      throw new PluginSourceError('COSSACK_PLUGIN_ROUTE_CONFLICT', path, `${existing.package} and ${mounted.name} both serve the plugin ${name}. Mount one of them.`);
    }
    if (!existing && existsSync(join(mounted.root, path))) locations.set(name, { name, directory: join(mounted.root, path.slice(0, -1)), package: mounted.name });
  }
  return [...locations.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Plugin names, sorted. */
export function listPlugins(projectRoot: string): string[] {
  return pluginLocations(projectRoot).map(location => location.name);
}

/** What an application file or plugin replaces in a mounted package. */
export interface PackageOverride {
  /** The application path that wins: a route key, or `src/plugins/<name>`. */
  path: string;
  package: string;
  /** The package file or directory left out of the build. */
  file: string;
}

/** Where a route key's module comes from. */
export interface PageOrigin {
  kind: 'app' | 'package' | 'plugin';
  /** The package or plugin name. */
  name?: string;
  /** Absolute path of the module. */
  file: string;
}

export interface PageSources {
  pageKeys: string[];
  layoutKeys: string[];
  markdownKeys: string[];
  loadingKeys: string[];
  /**
   * Route key (`/src/pages/...`) to the module's path as the project sees it: `/src/...`
   * inside the project, a path through `..` or `node_modules` for a mounted package.
   */
  sources: Record<string, string>;
  /** Route key to the plugin that renders it, for plugin pages only. */
  plugins: Record<string, string>;
  /** Route key to where its module comes from. */
  origins: Record<string, PageOrigin>;
  /** Package files that an application file replaces. */
  overrides: PackageOverride[];
}

/** Map a plugin page module ID to its route key. Other paths return unchanged. */
export function pluginPageKey(file: string): string {
  return file.replace(/^\/src\/plugins\/[^/]+\/pages\//, '/src/pages/');
}

/**
 * Application, package and plugin pages as one tree, keyed like `src/pages`.
 * An application file overrides a package file of the same key or the same URL.
 * Any other pair of sources for one key is a conflict.
 */
export function scanPageSources(projectRoot: string, includeMarkdown = false): PageSources {
  const result: PageSources = { pageKeys: [], layoutKeys: [], markdownKeys: [], loadingKeys: [], sources: {}, plugins: {}, origins: {}, overrides: [] };
  interface Root { kind: PageOrigin['kind']; name?: string; plugin?: string; directory: string; keyPrefix: string; file?: string }
  const roots: Root[] = [{ kind: 'app', directory: resolve(projectRoot, 'src/pages'), keyPrefix: '/src/pages/' }];
  for (const mounted of mountedPackages(projectRoot)) for (const path of mounted.pages) {
    if (path.endsWith('/')) roots.push({ kind: 'package', name: mounted.name, directory: join(mounted.root, path), keyPrefix: '/src/' + path });
    else roots.push({ kind: 'package', name: mounted.name, directory: join(mounted.root, path, '..'), keyPrefix: '/src/' + path.slice(0, path.lastIndexOf('/') + 1), file: path.slice(path.lastIndexOf('/') + 1) });
  }
  const locations = pluginLocations(projectRoot);
  for (const location of locations) roots.push({ kind: 'plugin', name: location.name, plugin: location.name, directory: join(location.directory, 'pages'), keyPrefix: '/src/pages/' });
  // A package's plugin that an application plugin shadows is reported once, as a whole.
  for (const mounted of mountedPackages(projectRoot)) for (const path of mounted.plugins) {
    const name = path.split('/')[1]!;
    if (locations.find(location => location.name === name)?.package !== mounted.name && existsSync(join(mounted.root, path))) {
      result.overrides.push({ path: `${PLUGINS_DIRECTORY}/${name}`, package: mounted.name, file: join(mounted.root, path.slice(0, -1)) });
    }
  }
  for (const root of roots) {
    const only = (keys: string[]) => root.file === undefined ? keys : keys.filter(key => key === root.keyPrefix + root.file);
    const scanned = root.file === undefined || existsSync(join(root.directory, root.file))
      ? scanPagesDir(root.directory, includeMarkdown, root.keyPrefix, root.file !== undefined) : { pageKeys: [], layoutKeys: [], markdownKeys: [] };
    const loadings = root.file === undefined || root.file === 'loading.ts' ? scanLoadingFiles(root.directory, root.keyPrefix, root.file !== undefined) : [];
    const add = (list: string[], key: string) => {
      const file = join(root.directory, key.slice(root.keyPrefix.length));
      const existing = result.origins[key];
      if (existing !== undefined && existing.file !== file) {
        if (existing.kind === 'app' && root.kind === 'package') {
          result.overrides.push({ path: key.slice(1), package: root.name!, file });
          return;
        }
        throw new PluginSourceError('COSSACK_PLUGIN_ROUTE_CONFLICT', projectPath(projectRoot, file).slice(1),
          `${projectPath(projectRoot, file).slice(1)} and ${projectPath(projectRoot, existing.file).slice(1)} both define ${key.slice('/src/pages'.length)}. Move or remove one of them.`);
      }
      if (existing === undefined) list.push(key);
      result.sources[key] = projectPath(projectRoot, file);
      result.origins[key] = { kind: root.kind, ...(root.name ? { name: root.name } : {}), file };
      if (root.plugin) result.plugins[key] = root.plugin;
    };
    for (const key of only(scanned.pageKeys)) add(result.pageKeys, key);
    for (const key of only(scanned.layoutKeys)) add(result.layoutKeys, key);
    for (const key of only(loadings)) add(result.loadingKeys, key);
    // With Markdown routes enabled these keys are also page keys, added above.
    for (const key of only(scanned.markdownKeys)) {
      if (result.origins[key] && result.origins[key]!.kind !== root.kind) continue;
      result.markdownKeys.push(key);
      result.sources[key] ??= projectPath(projectRoot, join(root.directory, key.slice(root.keyPrefix.length)));
    }
  }
  // An application page also replaces a package page that answers the same URL under another key.
  const applicationRoutes = new Map(result.pageKeys.filter(key => result.origins[key]!.kind === 'app').map(key => [filePathToHttpRoute(key), key]));
  for (const key of [...result.pageKeys]) {
    const origin = result.origins[key]!;
    const winner = origin.kind === 'package' ? applicationRoutes.get(filePathToHttpRoute(key)) : undefined;
    if (winner === undefined) continue;
    result.overrides.push({ path: winner.slice(1), package: origin.name!, file: origin.file });
    result.pageKeys.splice(result.pageKeys.indexOf(key), 1);
    const markdown = result.markdownKeys.indexOf(key);
    if (markdown >= 0) result.markdownKeys.splice(markdown, 1);
    delete result.sources[key];
    delete result.origins[key];
  }
  result.pageKeys.sort();
  result.layoutKeys.sort();
  result.markdownKeys.sort();
  result.loadingKeys.sort();
  return result;
}

/**
 * One line per override, for the dev server and the build to print. An override that
 * `cossack eject` recorded (`.cossack/scaffold.json`) also says when the package changed its
 * file since the copy was made: `pnpm up` alone does not merge that change, `cossack upgrade` does.
 */
export function overrideReport(projectRoot: string, overrides: readonly PackageOverride[]): string[] {
  let ejected: Record<string, { package?: string; version?: string; source?: string; unit?: string; base?: string }> = {};
  try { ejected = JSON.parse(readFileSync(join(projectRoot, '.cossack/scaffold.json'), 'utf8')).ejected ?? {}; }
  catch { /* No manifest, or no record: the override is reported without its history. */ }
  const mounted = mountedPackages(projectRoot);
  return overrides.map(override => {
    const line = `[cossack] ${override.path} overrides ${override.package}`;
    const records = Object.entries(ejected).filter(([file, record]) => record.package === override.package && (file === override.path || file.startsWith(`${override.path}/`)));
    const owner = mounted.find(candidate => candidate.name === override.package);
    if (!records.length || !owner) return line;
    const stale = records.some(([, record]) => {
      if (!record.source || !record.base) return false;
      try {
        const content = readFileSync(join(owner.root, record.source));
        const text = /\.[cm]?tsx?$/.test(record.source) ? Buffer.from(rewriteServedImports(content.toString('utf8'), owner, record.source, record.unit ?? record.source)) : content;
        return createHash('sha256').update(text).digest('hex') !== record.base;
      } catch { return true; }
    });
    const since = records[0]![1].version;
    return stale ? `${line} ${owner.version}; the package changed it since ${since}: run cossack upgrade` : line;
  }).sort();
}

export interface RenderedPlugin {
  name: string;
  version: string;
  /** Manifest path as the project sees it (through `..` or `node_modules` for a package's plugin). */
  manifest: string;
  /** Absolute directory of the plugin's source. */
  directory: string;
  /** The mounted package that serves it. */
  package?: string;
}

/** Read each rendered manifest as data and check its identity. Never imports plugin code. */
export function readRenderedPlugins(projectRoot: string): RenderedPlugin[] {
  return pluginLocations(projectRoot).map(({ name, directory, package: served }) => {
    const manifest = projectPath(projectRoot, join(directory, PLUGIN_MANIFEST_FILE)).slice(1);
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(join(directory, PLUGIN_MANIFEST_FILE), 'utf8')); }
    catch (error) {
      throw new PluginSourceError('COSSACK_PLUGIN_MANIFEST_INVALID', manifest,
        `${manifest} is missing or is not JSON (${(error as Error).message}). Render plugins with cossack add plugin.`);
    }
    const value = parsed as { name?: unknown; version?: unknown };
    if (value === null || typeof value !== 'object' || value.name !== name || typeof value.version !== 'string' || !value.version) {
      throw new PluginSourceError('COSSACK_PLUGIN_MANIFEST_INVALID', manifest, `${manifest} must name the plugin ${JSON.stringify(name)} and give its version.`);
    }
    return { name, version: value.version, manifest, directory, ...(served ? { package: served } : {}) };
  });
}

const ASSET_EXTENSION = /\.(?:png|jpe?g|webp|gif|avif|svg|css|woff2?|ttf|otf)$/;
const moduleFile = (name: string) => name.endsWith('.ts') && !/\.(?:d|test|spec)\.ts$/.test(name);

function filesOf(directory: string, test: (name: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => !entry.isDirectory() && test(entry.name)).map(entry => entry.name).sort();
}

/**
 * A plugin's files of one kind as map entries, keyed `/src/plugins/<name>/<path>` wherever
 * the plugin's source is: `relative` is a file, or a directory (trailing slash) with a filter.
 */
export function pluginEntries(plugins: readonly PluginLocation[], relative: string, test: (name: string) => boolean = () => true): MapEntry[] {
  const entries: MapEntry[] = [];
  for (const plugin of plugins) {
    const key = `/${PLUGINS_DIRECTORY}/${plugin.name}/`;
    if (!relative.endsWith('/')) {
      if (existsSync(join(plugin.directory, relative))) entries.push({ key: key + relative, file: join(plugin.directory, relative) });
      continue;
    }
    for (const name of filesOf(join(plugin.directory, relative), test)) entries.push({ key: key + relative + name, file: join(plugin.directory, relative, name) });
  }
  return entries;
}

/**
 * Source of `virtual:cossack-plugins` for one environment. With `isolation`, server entries of
 * plugins that run isolated are left out of the application and carried as code instead.
 */
export function pluginRegistryModule(projectRoot: string, plugins: readonly RenderedPlugin[], server: boolean,
  isolation?: Readonly<Record<string, { readonly mode: 'isolated' | 'app' }>>): string {
  // Explicit imports, keyed as if every plugin were under src/plugins: a package's plugin is outside the project.
  const ui = `${moduleMap('uiModules', projectRoot, pluginEntries(plugins, PLUGIN_UI_ENTRY), { eager: true })}
    ${moduleMap('templateModules', projectRoot, pluginEntries(plugins, 'templates/', moduleFile), { eager: true })}
    ${moduleMap('assetUrls', projectRoot, pluginEntries(plugins, 'assets/', name => ASSET_EXTENSION.test(name)), { eager: true, query: '?url', importDefault: true })}
    function assetsOf(name) {
      const prefix = '/${PLUGINS_DIRECTORY}/' + name + '/';
      return Object.freeze(Object.fromEntries(Object.entries(assetUrls).filter(([file]) => file.startsWith(prefix)).map(([file, url]) => [file.slice(prefix.length), url])));
    }
    function templatesOf(name) {
      const prefix = '/${PLUGINS_DIRECTORY}/' + name + '/templates/';
      return Object.freeze(Object.fromEntries(Object.entries(templateModules).filter(([file]) => file.startsWith(prefix)).map(([file, module]) => [file.slice(prefix.length, -3), module])));
    }`;
  if (!server) {
    // The browser learns names, versions and UI modules; manifests and server entries stay on the server.
    return `${ui}
    const plugins = Object.freeze(${JSON.stringify(plugins.map(({ name, version }) => ({ name, version })))}.map(plugin => Object.freeze({ ...plugin, ui: uiModules['/${PLUGINS_DIRECTORY}/' + plugin.name + '/${PLUGIN_UI_ENTRY}'] ?? null, templates: templatesOf(plugin.name), assets: assetsOf(plugin.name) })));
    export { plugins };
    export default plugins;
    `;
  }
  const isolated = Object.entries(isolation ?? {}).filter(([, entry]) => entry.mode === 'isolated').map(([name]) => name).sort();
  // Isolated plugins' server code never enters the application bundle.
  const serverEntries = pluginEntries(plugins.filter(plugin => !isolated.includes(plugin.name)), PLUGIN_SERVER_ENTRY);
  return `
    ${moduleMap('manifests', projectRoot, pluginEntries(plugins, PLUGIN_MANIFEST_FILE), { eager: true, importDefault: true })}
    ${moduleMap('modules', projectRoot, serverEntries, { eager: true })}
    const isolation = ${JSON.stringify(isolation ?? {})};
    ${ui}
    function freeze(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const entry of Object.values(value)) freeze(entry);
      }
      return value;
    }
    const plugins = Object.freeze(Object.keys(manifests).sort().map(file => {
      const name = file.split('/')[3];
      const manifest = structuredClone(manifests[file]);
      if (!manifest || manifest.name !== name || typeof manifest.version !== 'string') {
        throw new Error('[Cossack] COSSACK_PLUGIN_MANIFEST_INVALID: ' + file.slice(1) + ' must name the plugin ' + JSON.stringify(name) + ' and give its version.');
      }
      return Object.freeze({
        name, version: manifest.version, manifest: freeze(manifest),
        module: modules['/${PLUGINS_DIRECTORY}/' + name + '/${PLUGIN_SERVER_ENTRY}'] ?? null,
        ...(isolation[name] ? { isolation: freeze(isolation[name]) } : {}),
        ui: uiModules['/${PLUGINS_DIRECTORY}/' + name + '/${PLUGIN_UI_ENTRY}'] ?? null,
        templates: templatesOf(name),
        assets: assetsOf(name),
      });
    }));
    export { plugins };
    export default plugins;
  `;
}

/** Directories watched for route changes: `src/pages` and each plugin's `pages`. */
export function pageDirectories(projectRoot: string): string[] {
  return [resolve(projectRoot, 'src/pages'), ...pluginLocations(projectRoot).map(plugin => join(plugin.directory, 'pages')),
    ...mountedPackages(projectRoot).flatMap(mounted => mounted.pages.map(path => join(mounted.root, path.endsWith('/') ? path : join(path, '..'))))];
}

function scanLoadingFiles(pagesDir: string, keyPrefix = '/src/pages/', shallow = false): string[] {
  const keys: string[] = [];
  if (!existsSync(pagesDir)) return keys;
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (shallow || ['__tests__', '__fixtures__', 'fixtures'].includes(entry.name)) continue;
        walk(join(dir, entry.name), `${rel}${entry.name}/`);
      } else if (entry.isFile() && entry.name === 'loading.ts') keys.push(`${keyPrefix}${rel}loading.ts`);
    }
  };
  walk(pagesDir, '');
  return keys;
}
