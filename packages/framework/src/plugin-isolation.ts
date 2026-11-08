/**
 * Node-only: which rendered plugins run isolated, and the one module each isolated plugin's
 * server code becomes (specs/cms-plugin-isolation.md).
 *
 * Only server code can run in its own Worker. A plugin with any file that runs in the
 * application at render time or in the browser (`ui.ts`, pages, components, middleware,
 * configuration, templates) runs in the application as a whole, since splitting it would
 * protect nothing. The shape decides: a manifest cannot claim isolation, only give it up.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Plugin as RolldownPlugin } from 'rolldown';
import { PLUGIN_MANIFEST_FILE, PLUGIN_SERVER_ENTRY, PLUGINS_DIRECTORY, type RenderedPlugin } from './plugin-sources.js';

/** Files and directories that run in the application, so their plugin does too. */
export const PLUGIN_IN_APP_PARTS = ['ui.ts', 'pages', 'components', 'middlewares.ts', 'config', 'templates'] as const;

/** Modules the plugin runtime may import inside the isolate; plugin code may import neither. */
export const ISOLATE_RUNTIME_IMPORTS = ['cloudflare:workers', 'node:async_hooks'] as const;

export interface PluginIsolationOptions {
  /**
   * The module that turns a plugin's server exports and manifest into the isolate's entry:
   * its default export is called as `isolate(exports, manifest)` and must return the
   * `WorkerEntrypoint` class the host calls. `@cossackframework/cms/isolate` for the CMS.
   */
  readonly runtime: string;
}

/** Where a plugin's server code runs. Server environments only. */
export type PluginIsolation =
  | {
    readonly mode: 'isolated';
    /** The bundled module, its SHA-256 and its size in bytes; absent for a plugin with no server entry. */
    readonly code?: string;
    readonly hash?: string;
    readonly bytes?: number;
  }
  | { readonly mode: 'app'; readonly reason: string };

export class PluginIsolationError extends Error {
  readonly code = 'COSSACK_PLUGIN_ISOLATED_IMPORT';
  readonly file: string;
  constructor(file: string, message: string) {
    super(`[Cossack] COSSACK_PLUGIN_ISOLATED_IMPORT: ${message}`);
    this.name = 'PluginIsolationError';
    this.file = file;
  }
}

/** Why a plugin runs in the application whatever the runtime, or null when its shape allows isolation. */
export function pluginInAppReason(projectRoot: string, plugin: RenderedPlugin): string | null {
  const directory = resolve(projectRoot, PLUGINS_DIRECTORY, plugin.name);
  const parts = PLUGIN_IN_APP_PARTS.filter(part => existsSync(resolve(directory, part)));
  if (parts.length) return `It has ${parts.map(part => part.includes('.') ? part : `${part}/`).join(', ')}, which ${parts.length === 1 ? 'runs' : 'run'} in the application.`;
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, plugin.manifest), 'utf8')) as { permissions?: { unrestricted?: unknown }; isolation?: unknown };
  if (manifest.permissions?.unrestricted === true) return 'It has unrestricted access, which reaches the application directly.';
  if (manifest.isolation === false) return 'It was added with --in-app.';
  return null;
}

/**
 * Where each plugin's server code runs. On `cloudflare`, a plugin whose shape allows it runs
 * isolated and its server entry is bundled; every other runtime keeps it in the application.
 */
export async function pluginIsolation(projectRoot: string, plugins: readonly RenderedPlugin[], options: PluginIsolationOptions, runtime: string):
  Promise<{ entries: Record<string, PluginIsolation>; watchFiles: string[] }> {
  const entries: Record<string, PluginIsolation> = {};
  const watchFiles: string[] = [];
  for (const plugin of plugins) {
    const reason = pluginInAppReason(projectRoot, plugin);
    if (reason) { entries[plugin.name] = { mode: 'app', reason }; continue; }
    if (runtime !== 'cloudflare') {
      entries[plugin.name] = { mode: 'app', reason: `${runtimeLabel(runtime)} has no Worker Loader, so its server code runs in the application.` };
      continue;
    }
    if (!existsSync(resolve(projectRoot, PLUGINS_DIRECTORY, plugin.name, PLUGIN_SERVER_ENTRY))) { entries[plugin.name] = { mode: 'isolated' }; continue; }
    const bundle = await bundleIsolatedPlugin(projectRoot, plugin, options);
    entries[plugin.name] = { mode: 'isolated', code: bundle.code, hash: bundle.hash, bytes: bundle.bytes };
    watchFiles.push(...bundle.watchFiles);
  }
  return { entries, watchFiles };
}

const ENTRY = '\0cossack-isolate-entry';

/** One ES module: the plugin's server entry and its imports, wrapped by the runtime. */
export async function bundleIsolatedPlugin(projectRoot: string, plugin: RenderedPlugin, options: PluginIsolationOptions):
  Promise<{ code: string; hash: string; bytes: number; watchFiles: string[] }> {
  const server = resolve(projectRoot, PLUGINS_DIRECTORY, plugin.name, PLUGIN_SERVER_ENTRY);
  const manifest = resolve(projectRoot, PLUGINS_DIRECTORY, plugin.name, PLUGIN_MANIFEST_FILE);
  const runtimeFile = createRequire(resolve(projectRoot, 'package.json')).resolve(options.runtime);
  const runtimeRoot = packageRoot(runtimeFile);
  const pluginsRoot = resolve(projectRoot, PLUGINS_DIRECTORY);
  const source = (file: string) => relative(projectRoot, file).split(sep).join('/');
  const guard: RolldownPlugin = {
    name: 'cossack-isolate',
    resolveId(id, importer) {
      if (id === ENTRY) return ENTRY;
      if (!id.startsWith('cloudflare:') && !isBuiltin(id)) return null;
      // The runtime's own files, never plugin source, even where an application sits inside the runtime's package.
      const fromRuntime = importer !== undefined && importer !== ENTRY && isInside(importer, runtimeRoot) && !isInside(importer, pluginsRoot);
      if (fromRuntime && (ISOLATE_RUNTIME_IMPORTS as readonly string[]).includes(id)) return { id, external: true };
      const through = importer && importer !== ENTRY ? source(importer) : source(server);
      throw new PluginIsolationError(source(server), `${source(server)} imports ${id}${through === source(server) ? '' : ` through ${through}`}, which an isolated plugin cannot use: its server code runs in its own Worker with no Node.js built-ins or platform modules. Remove the import, or add the plugin with --in-app.`);
    },
    load(id) {
      if (id !== ENTRY) return null;
      return `import * as plugin from ${JSON.stringify(server)};
import manifest from ${JSON.stringify(manifest)};
import isolate from ${JSON.stringify(runtimeFile)};
export default isolate(plugin, manifest);
`;
    },
  };
  // Loaded only when a plugin is bundled, so applications that isolate nothing never import it.
  const { rolldown } = await import('rolldown');
  const build = await rolldown({
    input: ENTRY,
    cwd: projectRoot,
    platform: 'neutral',
    plugins: [guard],
    resolve: { conditionNames: ['workerd', 'worker', 'browser', 'import', 'module', 'default'], mainFields: ['module', 'main'] },
    logLevel: 'silent',
  }).catch((error: unknown) => { throw isolationCause(error) ?? error; });
  try {
    // Rolldown resolves and loads while generating, so the import check fails here.
    const { output } = await build.generate({ format: 'esm', codeSplitting: false }).catch((error: unknown) => { throw isolationCause(error) ?? error; });
    const code = output[0].code;
    const watchFiles = (await build.watchFiles).filter(file => !file.startsWith('\0') && existsSync(file));
    return { code, hash: createHash('sha256').update(code).digest('hex'), bytes: Buffer.byteLength(code), watchFiles };
  } finally {
    await build.close();
  }
}

/** One line per isolated plugin for the build log: its size. */
export function isolationReport(entries: Readonly<Record<string, PluginIsolation>>): string[] {
  return Object.entries(entries).flatMap(([name, entry]) => entry.mode === 'isolated' && entry.bytes !== undefined
    ? [`[cossack] Isolated plugin ${name}: ${(entry.bytes / 1024).toFixed(1)} KB`] : []);
}

/** Rolldown reports a hook's error inside its own; ours is the one to show. */
function isolationCause(error: unknown): PluginIsolationError | undefined {
  // Rolldown sets its own `code` (PLUGIN_ERROR) on a hook's error and keeps ours as `pluginCode`.
  const errors = (error as { errors?: unknown[] } | null)?.errors;
  const cause = (Array.isArray(errors) ? errors : [error]).find(entry => entry instanceof PluginIsolationError
    || (entry as { pluginCode?: unknown } | null)?.pluginCode === 'COSSACK_PLUGIN_ISOLATED_IMPORT') as PluginIsolationError | undefined;
  return cause ? new PluginIsolationError(cause.file, cause.message.replace(/^\[Cossack\] COSSACK_PLUGIN_ISOLATED_IMPORT: /, '')) : undefined;
}

function runtimeLabel(runtime: string): string {
  return ({ node: 'Node.js', deno: 'Deno', desktop: 'The Desktop app' } as Record<string, string>)[runtime] ?? 'This runtime';
}

function packageRoot(file: string): string {
  let directory = dirname(file);
  while (!existsSync(resolve(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) return dirname(file);
    directory = parent;
  }
  return directory;
}

function isInside(file: string, directory: string): boolean {
  const path = relative(directory, file);
  return path !== '' && !path.startsWith('..') && !path.startsWith(sep) && !/^[A-Za-z]:/.test(path);
}
