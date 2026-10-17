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
/** Images a plugin ships, such as its logo and cover, served as build assets. */
export const PLUGIN_ASSETS = 'assets/*.{png,jpg,jpeg,webp,gif,avif,svg}';

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

/** Rendered plugin names, sorted. Invalid directory names are an error. */
export function listPlugins(projectRoot: string): string[] {
  const directory = resolve(projectRoot, PLUGINS_DIRECTORY);
  if (!existsSync(directory)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!PLUGIN_NAME.test(entry.name)) {
      throw new PluginSourceError('COSSACK_PLUGIN_NAME_INVALID', `${PLUGINS_DIRECTORY}/${entry.name}`,
        `${PLUGINS_DIRECTORY}/${entry.name} is not a valid plugin name. Use lowercase letters, digits and hyphens.`);
    }
    names.push(entry.name);
  }
  return names.sort();
}

export interface PageSources {
  pageKeys: string[];
  layoutKeys: string[];
  markdownKeys: string[];
  loadingKeys: string[];
  /** Route key (`/src/pages/...`) to the real source path (`/src/...`). */
  sources: Record<string, string>;
  /** Route key to the plugin that renders it, for plugin pages only. */
  plugins: Record<string, string>;
}

/** Map a plugin page module ID to its route key. Other paths return unchanged. */
export function pluginPageKey(file: string): string {
  return file.replace(/^\/src\/plugins\/[^/]+\/pages\//, '/src/pages/');
}

/** Application and plugin pages as one tree, keyed like `src/pages`. */
export function scanPageSources(projectRoot: string, includeMarkdown = false): PageSources {
  const result: PageSources = { pageKeys: [], layoutKeys: [], markdownKeys: [], loadingKeys: [], sources: {}, plugins: {} };
  const roots: { plugin?: string; directory: string; prefix: string }[] = [
    { directory: resolve(projectRoot, 'src/pages'), prefix: '/src/pages/' },
    ...listPlugins(projectRoot).map(plugin => ({ plugin, directory: resolve(projectRoot, PLUGINS_DIRECTORY, plugin, 'pages'), prefix: `/${PLUGINS_DIRECTORY}/${plugin}/pages/` })),
  ];
  for (const root of roots) {
    const scanned = scanPagesDir(root.directory, includeMarkdown);
    const loadings = scanLoadingFiles(root.directory);
    const add = (list: string[], key: string) => {
      const source = root.prefix + key.slice('/src/pages/'.length);
      const existing = result.sources[key];
      if (existing !== undefined && existing !== source) {
        throw new PluginSourceError('COSSACK_PLUGIN_ROUTE_CONFLICT', source.slice(1),
          `${source.slice(1)} and ${existing.slice(1)} both define ${key.slice('/src/pages'.length)}. Move or remove one of them.`);
      }
      if (existing === undefined) list.push(key);
      result.sources[key] = source;
      if (root.plugin) result.plugins[key] = root.plugin;
    };
    for (const key of scanned.pageKeys) add(result.pageKeys, key);
    for (const key of scanned.layoutKeys) add(result.layoutKeys, key);
    for (const key of loadings) add(result.loadingKeys, key);
    // With Markdown routes enabled these keys are also page keys, added above.
    for (const key of scanned.markdownKeys) {
      result.markdownKeys.push(key);
      result.sources[key] ??= root.prefix + key.slice('/src/pages/'.length);
    }
  }
  result.pageKeys.sort();
  result.layoutKeys.sort();
  result.markdownKeys.sort();
  result.loadingKeys.sort();
  return result;
}

export interface RenderedPlugin {
  name: string;
  version: string;
  /** Project-relative manifest path. */
  manifest: string;
}

/** Read each rendered manifest as data and check its identity. Never imports plugin code. */
export function readRenderedPlugins(projectRoot: string): RenderedPlugin[] {
  return listPlugins(projectRoot).map(name => {
    const manifest = `${PLUGINS_DIRECTORY}/${name}/${PLUGIN_MANIFEST_FILE}`;
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(resolve(projectRoot, manifest), 'utf8')); }
    catch (error) {
      throw new PluginSourceError('COSSACK_PLUGIN_MANIFEST_INVALID', manifest,
        `${manifest} is missing or is not JSON (${(error as Error).message}). Render plugins with cossack add plugin.`);
    }
    const value = parsed as { name?: unknown; version?: unknown };
    if (value === null || typeof value !== 'object' || value.name !== name || typeof value.version !== 'string' || !value.version) {
      throw new PluginSourceError('COSSACK_PLUGIN_MANIFEST_INVALID', manifest, `${manifest} must name the plugin ${JSON.stringify(name)} and give its version.`);
    }
    return { name, version: value.version, manifest };
  });
}

/** Source of `virtual:cossack-plugins` for one environment. */
export function pluginRegistryModule(plugins: readonly RenderedPlugin[], server: boolean): string {
  const ui = `const uiModules = import.meta.glob('/${PLUGINS_DIRECTORY}/*/${PLUGIN_UI_ENTRY}', { eager: true });
    const assetUrls = import.meta.glob('/${PLUGINS_DIRECTORY}/*/${PLUGIN_ASSETS}', { eager: true, query: '?url', import: 'default' });
    function assetsOf(name) {
      const prefix = '/${PLUGINS_DIRECTORY}/' + name + '/';
      return Object.freeze(Object.fromEntries(Object.entries(assetUrls).filter(([file]) => file.startsWith(prefix)).map(([file, url]) => [file.slice(prefix.length), url])));
    }`;
  if (!server) {
    // The browser learns names, versions and UI modules; manifests and server entries stay on the server.
    return `${ui}
    const plugins = Object.freeze(${JSON.stringify(plugins.map(({ name, version }) => ({ name, version })))}.map(plugin => Object.freeze({ ...plugin, ui: uiModules['/${PLUGINS_DIRECTORY}/' + plugin.name + '/${PLUGIN_UI_ENTRY}'] ?? null, assets: assetsOf(plugin.name) })));
    export { plugins };
    export default plugins;
    `;
  }
  return `
    const manifests = import.meta.glob('/${PLUGINS_DIRECTORY}/*/${PLUGIN_MANIFEST_FILE}', { eager: true, import: 'default' });
    const modules = import.meta.glob('/${PLUGINS_DIRECTORY}/*/${PLUGIN_SERVER_ENTRY}', { eager: true });
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
        ui: uiModules['/${PLUGINS_DIRECTORY}/' + name + '/${PLUGIN_UI_ENTRY}'] ?? null,
        assets: assetsOf(name),
      });
    }));
    export { plugins };
    export default plugins;
  `;
}

/** Directories watched for route changes: `src/pages` and each plugin's `pages`. */
export function pageDirectories(projectRoot: string): string[] {
  return [resolve(projectRoot, 'src/pages'), ...listPlugins(projectRoot).map(plugin => resolve(projectRoot, PLUGINS_DIRECTORY, plugin, 'pages'))];
}

function scanLoadingFiles(pagesDir: string): string[] {
  const keys: string[] = [];
  if (!existsSync(pagesDir)) return keys;
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['__tests__', '__fixtures__', 'fixtures'].includes(entry.name)) continue;
        walk(join(dir, entry.name), `${rel}${entry.name}/`);
      } else if (entry.isFile() && entry.name === 'loading.ts') keys.push(`/src/pages/${rel}loading.ts`);
    }
  };
  walk(pagesDir, '');
  return keys;
}
