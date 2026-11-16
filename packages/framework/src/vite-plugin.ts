export { cossackWorkflows } from './vite-workflows.js';
export { cossackSchedules } from './vite-schedules.js';
export { cossackBuildBudgets } from './vite-build-budgets.js';
import { checkConfigBuildRequirements } from './config-preflight.js';
import type { ConfigRuntime } from './config-requirements.js';
import { generateConfigTypes, discoverConfigSources } from './config-codegen.js';
import { parseSync, searchForWorkspaceRoot, type Plugin, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { installDevelopmentTraceBridge, TRACE_BRIDGE_MODULE } from './vite-development-traces.js';
import { installPublicReloadPrivacy } from './vite-public-diagnostics.js';
import { checkTemplatesForBuild, formatTemplateDiagnostic, startDevelopmentTemplateChecks } from './vite-template-diagnostics.js';
import { clientOptimizedDependencies, linkedDependenciesConfig, linkedDependencyFolders, restartOnLinkedRebuilds, ssrOptimizedDependencies, type LinkedDependency } from './vite-dependency-optimization.js';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { discoverGetHandlers, generateRoutes, ROUTES_MODULE_ID, ROUTES_SOURCE_PATH } from './route-codegen.js';
import { PLUGINS_MODULE_ID, overrideReport, pageDirectories, pluginEntries, pluginLocations, pluginRegistryModule, readRenderedPlugins, scanPageSources } from './plugin-sources.js';
import { hostContractProblems, moduleMap, mountedPackages, projectPath, servedFile, servedPrebundle, servedSpecifierFile, type MapEntry } from './package-mounts.js';
import { isolationReport, PLUGIN_LOADER_BINDING, pluginIsolation, PluginIsolationError, type PluginIsolationOptions } from './plugin-isolation.js';
export { scanPagesDir } from './route-codegen.js';
import { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';
import { checkCapabilityRequirements, type CapabilityUse, type RuntimeName } from './runtime-capabilities.js';
import { extractPageOptionsFromAst, isHttpHandlerModule } from './page-inspection.js';
import { readBuildBindingNames } from './build-bindings.js';
import { classifyRoute, filePathToHttpRoute, filePathToRoutePath } from './route-ids.js';
import { validateMarkdownFrontmatter, isValidatedMarkdownFrontmatter } from './markdown-frontmatter.js';
import { describeUncoveredClientOutput, uncoveredClientOutput, type StaticAssetRouteFact } from './static-asset-routing.js';
import { checkReservedPaths, type ReservedPathDiagnostic } from './reserved-paths.js';
import { findRealtimeComponents, realtimeFileLabel, realtimeIdAssignments, realtimeRegistryModule, scanRealtimeComponents,
  REALTIME_COMPONENTS_MODULE_ID, type RealtimeRegistryDiagnostic } from './realtime-registry.js';
export { findRealtimeComponents, scanRealtimeComponents, realtimeRegistryModule, REALTIME_COMPONENTS_MODULE_ID } from './realtime-registry.js';

export { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

const resolvedRealtimeComponentsModuleId = '\0' + REALTIME_COMPONENTS_MODULE_ID;
const resolvedPluginsModuleId = '\0' + PLUGINS_MODULE_ID;

const langVirtualModuleId = 'virtual:cossack-lang';
const resolvedLangVirtualModuleId = '\0' + langVirtualModuleId;

/** Regular files of a directory that pass `test`, as map entries keyed `<keyPrefix><name>`. */
function directoryEntries(directory: string, keyPrefix: string, test: (name: string) => boolean): MapEntry[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => !entry.isDirectory() && test(entry.name))
    .map(entry => ({ key: keyPrefix + entry.name, file: resolve(directory, entry.name) }));
}

const posixPath = (file: string) => file.replaceAll('\\', '/');
const isUnder = (directory: string, file: string) => posixPath(file).startsWith(posixPath(directory).replace(/\/?$/, '/'));

/**
 * Reload a generated module when a file it lists is added or removed. `import.meta.glob`
 * did this by itself; the explicit maps that replace it do not.
 */
function reloadOnTreeChange(server: ViteDevServer, moduleId: string, affects: (file: string) => boolean): void {
  const changed = (file: string) => {
    if (!affects(resolve(file))) return;
    let found = false;
    for (const environment of Object.values(server.environments ?? {})) {
      const module = environment.moduleGraph.getModuleById(moduleId);
      if (module) { environment.moduleGraph.invalidateModule(module); found = true; }
    }
    if (found) server.ws.send({ type: 'full-reload' });
  };
  server.watcher.on('add', changed).on('unlink', changed);
  server.httpServer?.once('close', () => { server.watcher.off('add', changed).off('unlink', changed); });
}

/** Route key of a page file, wherever its source is. */
function routeKeyOf(projectRoot: string, file: string): string {
  const served = servedFile(projectRoot, file);
  const path = served ? '/src/' + served.path : projectPath(projectRoot, file);
  return path.replace(/^\/src\/plugins\/[^/]+\/pages\//, '/src/pages/');
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function injectMarkdownByline(html: string, author: string, date: string): string {
  if (!author && !date) return html;
  const authorMarkup = author ? `<span>By ${escapeHtmlText(author)}</span>` : '';
  const separator = author && date ? '<span aria-hidden="true">·</span>' : '';
  const dateMarkup = date
    ? `<time datetime="${escapeHtmlText(date)}">${escapeHtmlText(date)}</time>`
    : '';
  const byline = `<p class="mdx-byline mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">${authorMarkup}${separator}${dateMarkup}</p>`;
  const headingEnd = html.indexOf('</h1>');
  const insertionIndex = headingEnd >= 0 ? headingEnd + '</h1>'.length : 0;
  return html.slice(0, insertionIndex) + byline + html.slice(insertionIndex);
}

/**
 * Public path the SSR runtime uses to fetch the Vite manifest via the
 * Cloudflare ASSETS binding. The Cloudflare Vite plugin generates a
 * `.assetsignore` that excludes the `.vite` directory from the ASSETS
 * binding, so the manifest cannot be served from its default location.
 * The `writeBundle` hook below copies it to this non-ignored path after
 * the client build so `env.ASSETS.fetch` can reach it in production.
 */
export interface MarkdownResult {
  html: string;
  frontmatter: unknown;
}

export type MarkdownProcessor = (
  source: string,
  id: string,
) => MarkdownResult | Promise<MarkdownResult>;


/** The page and layout source files (the project's, its plugins' and the mounted packages'), as glob patterns for Vite's dependency scan. */
export function scanEntryFiles(root: string, markdown: boolean): string[] {
  const { origins, pageKeys, layoutKeys } = scanPageSources(root, markdown);
  const files = new Set<string>();
  for (const key of [...pageKeys, ...layoutKeys]) {
    const file = origins[key]?.file;
    if (file && /\.[cm]?tsx?$/.test(file)) files.add(file.replaceAll('\\', '/').replace(/[()[\]{}!*?@+|]/g, '\\$&'));
  }
  return [...files].sort();
}

export interface CossackPagesOptions {
  /** Cloudflare source config for build binding checks; relative to the Vite root. */
  configPath?: string;
  /** Opt in to project-local browser trace records for CLI/MCP. Development only. */
  developmentTraces?: boolean;
  /** Selected build features. Bindings are names only, never secret values. */
  capabilities?: {
    runtime: Exclude<RuntimeName, 'unknown'>;
    bindings?: readonly string[];
    /** Defaults to CLOUDFLARE_ENV when reading project bindings. */
    environment?: string;
    requirements?: readonly CapabilityUse[];
  };
  /**
   * Application-owned Markdown compiler. Install one with
   * `cossack add markdown`.
   */
  markdownProcessor?: MarkdownProcessor;
  /**
   * Run plugins' server code in their own Workers where the shape allows it
   * (specs/cms-plugin-isolation.md). On Cloudflare each isolated plugin's
   * `server.ts` is bundled with `runtime` and kept out of the application;
   * other runtimes keep it in the application and say why.
   */
  pluginIsolation?: PluginIsolationOptions;
  /**
   * Check html and svg templates (`cossack check templates`): builds fail on
   * template errors, and the dev server reports diagnostics as files change.
   * Default true.
   */
  templateDiagnostics?: boolean;
  /**
   * Development server: load a page's module with the first request that names it, rather than
   * every page before the server answers. Default true; false imports every page up front, as
   * a build does.
   */
  deferPages?: boolean;
}

let configuredMarkdownProcessor: MarkdownProcessor | undefined;

/** @internal Used by the SSG runner to reproduce the application's page plugin. */
export function getConfiguredMarkdownProcessor(): MarkdownProcessor | undefined {
  return configuredMarkdownProcessor;
}

export function cossackPages(options: CossackPagesOptions = {}): Plugin {
  let projectRoot = process.cwd();
  let templatesChecked = false;
  let overridesReported = false;
  let publicDirectory: string | false = 'public';
  let developmentBase = '/';
  let traceBridge: ReturnType<typeof installDevelopmentTraceBridge> | undefined;
  /** Linked packages Vite pre-bundles, watched while the dev server runs. */
  let linkedFolders: LinkedDependency[] = [];
  if (options.markdownProcessor) {
    configuredMarkdownProcessor = options.markdownProcessor;
  }
  const markdownEnabled = typeof options.markdownProcessor === 'function';
  let warnedAboutMarkdown = false;
  const warnIfMarkdownIsUnconfigured = (warn: (message: string) => void) => {
    if (markdownEnabled || warnedAboutMarkdown) return;
    const { markdownKeys } = scanPageSources(projectRoot, false);
    if (markdownKeys.length === 0) return;
    warnedAboutMarkdown = true;
    warn(
      '[cossack] Markdown routes were omitted because no markdownProcessor is configured. ' +
      'Run `cossack add markdown` to enable .md and .mdx pages.',
    );
  };

  // Development warns about each reserved-path conflict once: at startup and
  // again only after a route change introduces it. Builds fail instead.
  let reportedReservedPaths = new Set<string>();
  const unreportedReservedPaths = (diagnostics: readonly ReservedPathDiagnostic[]) => {
    const messages = diagnostics.map(diagnostic => diagnostic.message);
    const fresh = messages.filter(message => !reportedReservedPaths.has(message));
    reportedReservedPaths = new Set(messages);
    return fresh.length ? `[cossack] ${fresh.join('\n')}` : undefined;
  };
  const reservedPaths = (routes: readonly StaticAssetRouteFact[]) =>
    checkReservedPaths(projectRoot, { publicDir: publicDirectory, routes });

  let reportedRealtime = new Set<string>();
  const unreportedRealtime = (diagnostics: readonly RealtimeRegistryDiagnostic[]) => {
    const messages = diagnostics.map(diagnostic => diagnostic.message);
    const fresh = messages.filter(message => !reportedRealtime.has(message));
    reportedRealtime = new Set(messages);
    return fresh.length ? `[cossack] ${fresh.join('\n')}` : undefined;
  };

  let capabilityPages = new Set<string>();
  let capabilityBindings: readonly string[] = [];
  /** Whether `capabilityBindings` came from the project, so an absent binding means something. */
  let bindingsRead = false;
  const refreshCapabilityPages = () => {
    const { pageKeys, sources } = scanPageSources(projectRoot, markdownEnabled);
    capabilityPages = new Set(pageKeys.map(key => resolve(projectRoot, (sources[key] ?? key).slice(1)).replaceAll('\\', '/')));
  };
  const pageRequirement = async (file: string) => {
    const key = routeKeyOf(projectRoot, file);
    let transport = 'http';
    let stateful = false;
    let line: number | undefined;
    if (file.endsWith('.ts')) {
      const source = readFileSync(file, 'utf8');
      // Functional handlers serve any path (/feed.xml, /webhooks/x), and need no page transport.
      if (await isHttpHandlerModule(source)) return {};
      const facts = await extractPageOptionsFromAst(source);
      if (facts?.method !== 'ast' || !facts.options) return {
        parseError: !!(facts && 'parseError' in facts && facts.parseError),
        diagnostic: {
          code: 'COSSACK_CAPABILITY_REQUIREMENTS_UNKNOWN', id: file,
          message: `${key}: page transport requirements are unknown. ${facts?.reason ?? 'Source parser unavailable.'}`,
        },
      };
      transport = facts.options.transport ?? 'http';
      stateful = facts.options.stateful === true;
      line = facts.decoratorLine ?? undefined;
    }
    // The Markdown transform fixes its generated transport to HTTP.
    const requirement: CapabilityUse = { feature: 'page transport', source: { file, line },
      requires: { transports: [transport as 'http' | 'sse' | 'durable-object'],
        ...(transport === 'durable-object' && stateful ? { durableState: true } : {}) } };
    return { requirement };
  };

  return {
    name: 'cossack-pages',
    enforce: 'pre',
    // The framework runtime imports the virtual modules provided by this
    // plugin. If Vite externalizes the package during SSR, Node evaluates the
    // published JS directly and cannot resolve the `virtual:cossack-*` scheme.
    // Keep it in Vite's module graph so both virtual modules and package-local
    // ESM imports are transformed consistently for external applications.
    // UI and Solar Icons must also stay in the SSR graph: Solar Icons 0.7.2
    // exposes some runtime entry points as TypeScript, which recent Node
    // versions refuse to strip when Vite externalizes the transitive import.
    config(userConfig, env) {
      const include = clientOptimizedDependencies(import.meta.url);
      // Vite keys its pre-bundle cache on the lockfile and the config, never on a linked
      // package's files, and the browser keeps a bundle for good under that key's hash. An
      // environment that bundles linked packages carries their fingerprint in its config, so
      // a changed one is bundled again under a new address (see the helper).
      const root = userConfig.root ? resolve(userConfig.root) : process.cwd();
      // A mounted package's served files are application source: they stay in Vite's graph on the
      // server (Node cannot strip types inside node_modules), and their imports are pre-bundled
      // up front like the application's own, which the generated config lists for its files.
      const mounted = mountedPackages(root);
      const served = servedPrebundle(root);
      include.push(...served.client.filter(name => !include.includes(name)));
      const serverInclude = [...ssrOptimizedDependencies(), ...served.server];
      const inlined = ['@cossackframework/framework', '@cossackframework/ui', '@cossackframework/solar-icons', ...mounted.map(entry => entry.name)];
      // A linked package's files are outside the project, where the dev server serves nothing by default.
      const linkedRoots = mounted.filter(entry => entry.linked).map(entry => entry.directory);
      const client = [...include, ...(userConfig.environments?.client?.optimizeDeps?.include ?? []), ...(userConfig.optimizeDeps?.include ?? [])];
      const ssr = [...serverInclude, ...(userConfig.environments?.ssr?.optimizeDeps?.include ?? []), ...(userConfig.ssr?.optimizeDeps?.include ?? [])];
      const clientLinked = env.command === 'serve' ? linkedDependencyFolders(root, client) : [];
      const ssrLinked = env.command === 'serve' ? linkedDependencyFolders(root, ssr) : [];
      // A running server watches them too: one rebuilt meanwhile restarts it (see configureServer).
      linkedFolders = [...new Map([...clientLinked, ...ssrLinked].map(entry => [entry.folder, entry])).values()];
      // The development server loads a page with the first request for it, so Vite's scan of the
      // server entry does not reach what pages import. A dependency first met in a page would
      // be bundled during that request, beside the copies the running server already holds
      // (a page then read `config()` from a second, empty copy of the framework's config
      // module, in an installed project). Every page and layout is an entry of the scan, so
      // their dependencies are in the first bundle. Each is a file path, written as a glob.
      const scanEntries = env.command === 'serve' && env.mode !== 'desktop' && options.deferPages !== false
        ? scanEntryFiles(root, markdownEnabled) : [];
      const devServer = {
        // CORS is the application's (src/config/cors.ts), in development as in production.
        // Vite's own CORS runs ahead of the application and answers every preflight itself, for
        // localhost origins only: an origin in CORS_ORIGINS never reached the application.
        // Turned off, Vite's own files carry no CORS headers, so another origin cannot read
        // them. A project that sets `server.cors` keeps its setting, and Desktop, whose window
        // loads its assets across origins, keeps Vite's default.
        ...(env.command === 'serve' && env.mode !== 'desktop' && userConfig.server?.cors === undefined ? { cors: false } : {}),
        ...(linkedRoots.length && env.command === 'serve' ? { fs: { allow: [searchForWorkspaceRoot(root), ...linkedRoots] } } : {}),
      };
      return {
        ...(Object.keys(devServer).length ? { server: devServer } : {}),
        ssr: {
          noExternal: inlined,
        },
        environments: {
          client: {
            optimizeDeps: {
              // The framework client app stays in Vite's graph for its
              // virtual modules and HMR when linked; see the helper for why
              // an installed framework also lists its devtools entry.
              include,
              ...linkedDependenciesConfig(clientLinked),
            },
          },
          ssr: {
            // CommonJS reached through installed packages is pre-bundled up front; see the helper.
            optimizeDeps: { include: serverInclude, ...(scanEntries.length ? { entries: scanEntries } : {}), ...linkedDependenciesConfig(ssrLinked) },
            resolve: {
              noExternal: inlined,
            },
          },
        },
      };
    },
    configResolved(config) {
      projectRoot = config.root;
      publicDirectory = config.publicDir || false;
      developmentBase = config.base;
      generateRoutes(projectRoot, { includeMarkdown: markdownEnabled });
    },
    async buildStart() {
      // Every src/plugins/<name>/ needs a valid rendered manifest; route conflicts fail below.
      readRenderedPlugins(projectRoot);
      const { manifest } = generateRoutes(projectRoot, { includeMarkdown: markdownEnabled });
      // A mounted package's served code imports '@/...' modules that the application provides.
      const host = hostContractProblems(projectRoot)[0];
      if (host) this.error({ code: host.code, message: host.message });
      if (!overridesReported) {
        overridesReported = true;
        for (const line of overrideReport(projectRoot, scanPageSources(projectRoot, markdownEnabled).overrides)) this.info(line);
      }
      // Builds check every template once, before any module is transformed.
      if (options.templateDiagnostics !== false && this.environment?.mode !== 'dev' && !templatesChecked) {
        templatesChecked = true;
        const result = await checkTemplatesForBuild(projectRoot);
        if ('unavailable' in result) this.warn(result.unavailable);
        else {
          if (result.warnings.length) this.warn(`[cossack] Template warnings:\n${result.warnings.map(formatTemplateDiagnostic).join('\n')}`);
          const first = result.errors[0];
          if (first) this.error({
            code: first.code,
            message: `[cossack] Template errors:\n${result.errors.map(formatTemplateDiagnostic).join('\n')}`,
            id: resolve(projectRoot, first.file),
            loc: { file: resolve(projectRoot, first.file), line: first.line, column: first.column - 1 },
          });
        }
      }
      // `/assets/*` skips the request pipeline (Cloudflare static routing and
      // the generated Node server), and the router answers transport paths
      // before application routes, so no route may live there.
      const reserved = reservedPaths(manifest.routes);
      if (this.environment?.mode === 'dev') {
        const message = unreportedReservedPaths(reserved);
        if (message) this.warn(message);
      } else if (reserved.length) {
        const message = `[cossack] ${reserved.map(diagnostic => diagnostic.message).join('\n')}`;
        this.error({ code: reserved[0]!.code, message, id: reserved[0]!.file });
      }
      if (options.capabilities) {
        const { runtime } = options.capabilities;
        const bindings = options.capabilities.bindings ?? (runtime === 'cloudflare'
          ? await readBuildBindingNames(projectRoot, options.capabilities.environment ?? process.env.CLOUDFLARE_ENV, options.configPath) : []);
        const requirements: CapabilityUse[] = [...(options.capabilities.requirements ?? [])];
        capabilityBindings = bindings;
        bindingsRead = true;
        refreshCapabilityPages();
        for (const file of [...capabilityPages].sort()) {
          this.addWatchFile(file);
          const result = await pageRequirement(file);
          if (result.diagnostic) {
            // Syntax still fails transformation. Preserve the development
            // watcher so source repair can recover; builds remain fail-closed.
            if (this.environment?.mode === 'dev' && result.parseError) {
              this.warn(result.diagnostic);
              continue;
            }
            this.error(result.diagnostic);
          }
          if (result.requirement) requirements.push(result.requirement);
        }
        // Realtime layouts and realtime components need the same runtime
        // support as a realtime page.
        const pageSources = scanPageSources(projectRoot, false);
        for (const key of pageSources.layoutKeys) {
          const file = resolve(projectRoot, (pageSources.sources[key] ?? key).slice(1));
          const facts = await extractPageOptionsFromAst(readFileSync(file, 'utf8'));
          if (facts?.method !== 'ast' || facts.options?.transport !== 'durable-object') continue;
          requirements.push({ feature: 'realtime layout', source: { file, line: facts.decoratorLine ?? undefined },
            requires: { transports: ['durable-object'], ...(facts.options.stateful === true ? { durableState: true } : {}) } });
        }
        for (const component of scanRealtimeComponents(projectRoot).components) {
          requirements.push({ feature: 'realtime component', source: { file: component.path ?? resolve(projectRoot, component.file.slice(1)), line: component.line },
            requires: { transports: ['durable-object'] } });
        }
        const diagnostics = checkCapabilityRequirements(runtime, requirements, bindings);
        const first = diagnostics[0];
        if (first) this.error({
          code: first.code,
          message: diagnostics.map(diagnostic => `${diagnostic.source.file}${diagnostic.source.line ? `:${diagnostic.source.line}` : ''}: ${diagnostic.message}`).join('\n'),
          id: first.source.file,
          ...(first.source.line ? { loc: { file: first.source.file, line: first.source.line, column: first.source.column ?? 0 } } : {}),
        });
      }
      // Realtime components: builds fail on a component the server could not
      // build from the registry; development warns and keeps serving.
      const realtime = scanRealtimeComponents(projectRoot);
      if (realtime.diagnostics.length) {
        const message = `[cossack] ${realtime.diagnostics.map(diagnostic => diagnostic.message).join('\n')}`;
        if (this.environment?.mode === 'dev') {
          const fresh = unreportedRealtime(realtime.diagnostics);
          if (fresh) this.warn(fresh);
        } else this.error({ code: realtime.diagnostics[0]!.code, message, id: resolve(projectRoot, realtime.diagnostics[0]!.file.slice(1)) });
      }
      warnIfMarkdownIsUnconfigured((message) => this.warn(message));
    },
    resolveId(id) {
      if (id === TRACE_BRIDGE_MODULE) return '\0' + id;
      if (id === ROUTES_MODULE_ID) return resolve(projectRoot, ROUTES_SOURCE_PATH);
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      if (id === REALTIME_COMPONENTS_MODULE_ID) return resolvedRealtimeComponentsModuleId;
      if (id === PLUGINS_MODULE_ID) return resolvedPluginsModuleId;
      // A served file imported by its package name is the file itself, not a dependency to pre-bundle.
      if (id.charCodeAt(0) !== 46 && id.charCodeAt(0) !== 47 && id.charCodeAt(0) !== 0) return servedSpecifierFile(projectRoot, id) ?? undefined;
    },
    load(id) {
      if (id === '\0' + TRACE_BRIDGE_MODULE) {
        if (!traceBridge) return 'export {};';
        const entry = fileURLToPath(new URL('./client/development-trace-bridge.js', import.meta.url)).replaceAll('\\', '/');
        // Resolve the inspector through the same public import as application
        // code. A filesystem import here creates a second copy beside Vite's
        // optimized dependency, splitting the toolbar and capture ownership.
        return `import { enableDevTools } from '@cossackframework/framework/client/devtools';
          import { connectDevelopmentTraceBridge } from ${JSON.stringify(entry)};
          connectDevelopmentTraceBridge(${JSON.stringify(traceBridge.token)}, import.meta.hot, enableDevTools());`;
      }
      if (id === resolvedPluginsModuleId) {
        // One static registry of rendered plugins, built from their manifests.
        const plugins = readRenderedPlugins(projectRoot);
        for (const plugin of plugins) this.addWatchFile(resolve(projectRoot, plugin.manifest));
        const server = this.environment?.name !== 'client';
        if (!server || !options.pluginIsolation) return pluginRegistryModule(projectRoot, plugins, server);
        const isolationOptions = options.pluginIsolation;
        return pluginIsolation(projectRoot, plugins, isolationOptions, options.capabilities?.runtime ?? 'unknown').then(({ entries, watchFiles }) => {
          for (const file of watchFiles) this.addWatchFile(file);
          // Isolated code was left out of the application, so without the binding it could not run at all.
          const needing = Object.entries(entries).filter(([, entry]) => entry.mode === 'isolated' && entry.code !== undefined).map(([name]) => name);
          const bindings = bindingsRead ? capabilityBindings : options.capabilities?.bindings;
          if (needing.length && options.capabilities?.runtime === 'cloudflare' && bindings && !bindings.includes(PLUGIN_LOADER_BINDING)) {
            this.error({ code: 'COSSACK_PLUGIN_ISOLATION_BINDING', message: `[cossack] COSSACK_PLUGIN_ISOLATION_BINDING: ${needing.join(', ')} ${needing.length === 1 ? 'runs' : 'run'} isolated and ${needing.length === 1 ? 'needs' : 'need'} the Worker Loader binding. Add "worker_loaders": [{ "binding": "${PLUGIN_LOADER_BINDING}" }] to the Wrangler configuration (Dynamic Workers need the Workers Paid plan), or add the plugin with --in-app.` });
          }
          if (this.environment?.mode !== 'dev') for (const line of isolationReport(entries)) this.environment?.logger?.info(line);
          return pluginRegistryModule(projectRoot, plugins, true, entries);
        }, (error: unknown) => {
          if (error instanceof PluginIsolationError) this.error({ code: error.code, message: error.message, id: resolve(projectRoot, error.file) });
          throw error;
        });
      }
      if (id === resolvedRealtimeComponentsModuleId) {
        // Server environments import exactly the realtime components; the
        // browser gets an empty registry (classes carry their own ids).
        return realtimeRegistryModule(scanRealtimeComponents(projectRoot).components, this.environment?.name !== 'client');
      }
      if (id === resolvedVirtualModuleId) {
        // Detect environment via the Vite 6 Environment API
        // SSR/worker environment: eager loading (synchronous access needed for server routes)
        // Client environment: lazy loading (code splitting for performance)
        const isSsrEnvironment = this.environment?.name !== 'client';

        // Explicit imports, one per file the scan found: a mounted package's files are outside
        // the project, where a glob cannot reach, and an overridden file is not imported at all.
        const pageSources = scanPageSources(projectRoot, markdownEnabled);
        const entries = (keys: readonly string[]): MapEntry[] => keys.map(key => ({ key, file: pageSources.origins[key]!.file }));
        // The build manifest is keyed by a module's real path: the keys whose module is elsewhere.
        const elsewhere = Object.fromEntries(Object.entries(pageSources.sources).filter(([key, source]) => key !== source && pageSources.origins[key]));

        // The development server loads a page's module with the first request that names it:
        // importing every page up front costs a module fetch each before the server answers
        // anything (about 25 s for the CMS's pages on Workers). The keys stay complete, so
        // route ids and matching do not change. 404 and error pages and Markdown pages are
        // imported up front: the router reads them outside a route of their own.
        const deferPages = isSsrEnvironment && this.environment?.mode === 'dev' && options.deferPages !== false;
        const upFront = (key: string) => {
          if (/\.mdx?$/.test(key)) return true;
          try { const kind = classifyRoute(filePathToHttpRoute(key)); return kind === '404' || kind === 'error'; }
          catch { return true; }
        };
        const deferredPages = (keys: readonly string[]) => {
          const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          return `
          ${moduleMap('pagesUpFront', projectRoot, entries(sorted.filter(upFront)), { eager: true })}
          ${moduleMap('pageLoaders', projectRoot, entries(sorted.filter(key => !upFront(key))), { eager: false })}
          const pages = {};
          for (const key of ${JSON.stringify(sorted)}) pages[key] = pagesUpFront[key];
          const loading = {};
          const load = keys => Promise.all(keys.map(key => {
            if (typeof key !== 'string' || !Object.hasOwn(pageLoaders, key)) return undefined;
            // The router answers a failed page with a redacted 500, so the reason is printed
            // here, in the developer's terminal. The next request tries the import again.
            return loading[key] ??= pageLoaders[key]().then(module => { pages[key] = module; }, error => {
              delete loading[key];
              console.error('[cossack] ' + key + ' failed to load:', error);
              throw error;
            });
          })).then(() => undefined);
          `;
        };

        // Worker-rendered HTML may bypass transformIndexHtml. The client
        // registry is the shared bootstrap path for generated applications.
        return `
          ${!isSsrEnvironment && traceBridge ? `import ${JSON.stringify(TRACE_BRIDGE_MODULE)};` : ''}
          // Route key -> plugin name, so the router can ask the host whether a plugin's routes answer.
          const owners = ${JSON.stringify(pageSources.plugins)};
          // Route key -> real source path, where it differs from the key. The build manifest is keyed by it.
          const sources = ${isSsrEnvironment ? JSON.stringify(elsewhere) : '{}'};
          ${deferPages ? deferredPages(pageSources.pageKeys) : moduleMap('pages', projectRoot, entries(pageSources.pageKeys), { eager: isSsrEnvironment })}

          // Layouts: eager on SSR (synchronous server rendering), lazy on the
          // client. A layout often pulls in heavy deps (e.g. the dashboard
          // layout imports the whole @cossackframework/ui barrel); eager-loading
          // every layout on the client would force those deps onto routes that
          // don't use them (e.g. the public landing page loading the dashboard
          // sidebar). The client resolves layouts via dynamic import in app.ts.
          ${moduleMap('layouts', projectRoot, entries(pageSources.layoutKeys), { eager: isSsrEnvironment })}

          // Loading states: always eager (small, needed immediately for UX)
          ${moduleMap('loadings', projectRoot, entries(pageSources.loadingKeys), { eager: true })}

          // Components resolve by direct class reference (component(Card, ...)
          // captures the constructor), so no registry glob is needed. Eagerly
          // globbing src/components/ would pull in every re-exported component
          // (e.g. a UI barrel) and defeat tree-shaking.
          const components = {};

          // Functional HTTP handler routes: client navigation loads them as documents, without fetching first.
          const handlers = ${isSsrEnvironment ? '[]' : JSON.stringify(discoverGetHandlers(projectRoot, markdownEnabled))};

          export default { pages, layouts, loadings, components, owners, sources, handlers${deferPages ? ', load' : ''} };
        `;
      }
    },
    transformIndexHtml() {
      if (!traceBridge) return;
      return [{ tag: 'script', attrs: { type: 'module', src: developmentBase + '@id/__x00__' + TRACE_BRIDGE_MODULE }, injectTo: 'body' }];
    },
    closeBundle() { traceBridge?.dispose(); traceBridge = undefined; },
    configureServer: {
      // Native Cloudflare handlers install their request proxy in a returned hook.
      // Install our error boundary after that proxy and before Vite's HTML renderer.
      order: 'post',
      handler(server) {
        const restoreReloadPrivacy = installPublicReloadPrivacy(server);
        server.httpServer?.once('close', restoreReloadPrivacy);
        // A linked package rebuilt while the server runs is bundled again, without deleting node_modules/.vite.
        if (linkedFolders.length && server.httpServer && !server.config.server?.middlewareMode) {
          server.httpServer.once('close', restartOnLinkedRebuilds(server, linkedFolders));
        }
        // Middleware-mode servers (SSG rendering, tests) serve no editing session.
        if (options.templateDiagnostics !== false && server.httpServer && !server.config.server?.middlewareMode) {
          const logger = server.config.logger;
          const checks = startDevelopmentTemplateChecks(projectRoot, (file, diagnostics) => {
            if (!diagnostics.length) logger.info(`[cossack] ${file}: templates are clean.`, { timestamp: true });
            for (const diagnostic of diagnostics) {
              const line = `[cossack] ${formatTemplateDiagnostic(diagnostic)}`;
              if (diagnostic.severity === 'error') logger.error(line, { timestamp: true });
              else logger.warn(line, { timestamp: true });
            }
          }, message => logger.warn(message, { timestamp: true }));
          if (checks) {
            const changed = (file: string) => {
              const path = relative(projectRoot, file);
              if (!path.startsWith('..') && !path.split(/[\\/]/).includes('node_modules') && /\.(?:[cm]?ts|tsx)$/.test(path)) checks.changed([file]);
            };
            server.watcher.on('add', changed).on('unlink', changed).on('change', changed);
            server.httpServer?.once('close', () => {
              server.watcher.off('add', changed).off('unlink', changed).off('change', changed);
              checks.close();
            });
          }
        }
        if (options.developmentTraces) traceBridge = installDevelopmentTraceBridge(server, projectRoot);
        const sourceDirectory = resolve(projectRoot, 'src');
        const updateRealtime = (file: string) => {
          if (!file.endsWith('.ts') || (!isUnder(sourceDirectory, resolve(file)) && !servedFile(projectRoot, resolve(file)))) return;
          for (const environment of Object.values(server.environments ?? {})) {
            const module = environment.moduleGraph.getModuleById(resolvedRealtimeComponentsModuleId);
            if (module) environment.moduleGraph.invalidateModule(module);
          }
          const diagnostics = unreportedRealtime(scanRealtimeComponents(projectRoot).diagnostics);
          if (diagnostics) server.config.logger.warn(diagnostics, { timestamp: true });
        };
        server.watcher.on('add', updateRealtime).on('unlink', updateRealtime).on('change', updateRealtime);
        server.httpServer?.once('close', () => {
          server.watcher.off('add', updateRealtime).off('unlink', updateRealtime).off('change', updateRealtime);
        });
        // The browser's handler list is fixed when virtual:cossack-pages loads, and Vite
        // reloads that module only when page files are added or removed: a page turning
        // into a handler (or back) invalidates it here.
        // The module lists every page file by name, so a file added or removed invalidates it too.
        const registryFacts = () => {
          const scanned = scanPageSources(projectRoot, markdownEnabled);
          return JSON.stringify([discoverGetHandlers(projectRoot, markdownEnabled), scanned.sources, scanned.loadingKeys]);
        };
        let knownHandlers: string | undefined;
        try { knownHandlers = registryFacts(); } catch { /* Reported by the first update. */ }
        // A workspace-linked package changes while the server runs; an installed one does not.
        for (const mounted of mountedPackages(projectRoot)) if (mounted.linked) server.watcher.add(mounted.root);
        const update = (file: string) => {
          if (!/\.(?:ts|mdx?)$/.test(file) || !pageDirectories(projectRoot).some(directory => isUnder(directory, resolve(file)))) return;
          try {
            if (options.capabilities) refreshCapabilityPages();
            const generated = generateRoutes(projectRoot, { includeMarkdown: markdownEnabled });
            const handlers = registryFacts();
            if (knownHandlers !== undefined && handlers !== knownHandlers) {
              for (const environment of Object.values(server.environments ?? {})) {
                const module = environment.moduleGraph.getModuleById(resolvedVirtualModuleId);
                if (module) environment.moduleGraph.invalidateModule(module);
              }
              server.ws.send({ type: 'full-reload' });
            }
            knownHandlers = handlers;
            if (!generated.changed) return;
            const reserved = unreportedReservedPaths(reservedPaths(generated.manifest.routes));
            if (reserved) server.config.logger.warn(reserved, { timestamp: true });
            const module = server.moduleGraph.getModuleById(generated.file);
            if (module) server.moduleGraph.invalidateModule(module);
          } catch (error) { server.config.logger.error(String(error)); }
        };
        server.watcher.on('add', update).on('unlink', update).on('change', update);
        server.httpServer?.once('close', () => {
          server.watcher.off('add', update).off('unlink', update).off('change', update);
        });
        if (options.capabilities?.runtime !== 'cloudflare') return;
        const requestStarts = new WeakMap<IncomingMessage, number>();
        server.middlewares.use((request, _response, next) => {
          requestStarts.set(request, performance.now());
          next();
        });
        return () => {
          // ModuleRunner compiler results use the private hot channel. Only HTTP
          // request exceptions are caught here; retain full compiler diagnostics
          // in the developer's terminal without serializing them into HTML.
          server.middlewares.use((error: unknown, request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
            if (response.headersSent) { next(error); return; }
            const requestId = randomUUID();
            server.config.logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
            logRuntimeFailure({ requestId, runtime: 'cloudflare', startedAt: requestStarts.get(request) }, 'dispatch');
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('X-Cossack-Request-Id', requestId);
            response.end(JSON.stringify({ error: 'Internal Server Error', code: 'COSSACK_RUNTIME_FAILED', requestId }));
          });
        };
      },
    },
    async transform(code, id) {
      // Inject source metadata for DevTools (only in dev mode for client environment)
      const isDev = this.environment?.mode === 'dev';
      const file = id.split('?')[0].replaceAll('\\', '/');
      if (isDev && options.capabilities && capabilityPages.has(file)) {
        // Recheck repaired and edited pages, using original source before
        // another plugin strips decorators or server-only dependencies.
        const result = await pageRequirement(file);
        if (result.diagnostic && !result.parseError) this.error(result.diagnostic);
        if (result.requirement) {
          const first = checkCapabilityRequirements(options.capabilities.runtime,
            [result.requirement], capabilityBindings)[0];
          if (first) this.error({ code: first.code, id: file,
            message: `${file}${first.source.line ? `:${first.source.line}` : ''}: ${first.message}` });
        }
      }
      const applicationSource = file.startsWith(resolve(projectRoot, 'src').replaceAll('\\', '/') + '/') || servedFile(projectRoot, file) !== null;
      if (isDev && id.endsWith('.ts') && applicationSource) {
        // Parse declarations: text inside comments or string literals is not a class.
        const parsed = parseSync(id, code);
        if (!parsed.errors.length) {
          const edits: { offset: number; text: string }[] = [];
          const visit = (node: any) => {
            if (!node || typeof node !== 'object') return;
            if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.superClass
              && !node.body.body.some((member: any) => member.key?.name === '__source')) {
              const classStart = node.start;
              const offset = node.body.start + 1;
              const beforeClass = code.slice(0, classStart);
              const sourceInfo = JSON.stringify({ file: relative(projectRoot, id).replaceAll('\\', '/'),
                line: beforeClass.split('\n').length, column: beforeClass.length - beforeClass.lastIndexOf('\n') });
              edits.push({ offset, text: `\n  static __source = ${sourceInfo};\n` });
            }
            for (const [key, value] of Object.entries(node)) {
              if (key === 'parent') continue;
              if (Array.isArray(value)) value.forEach(visit);
              else if (value && typeof value === 'object') visit(value);
            }
          };
          visit(parsed.program);
          for (const edit of edits.sort((a, b) => b.offset - a.offset)) code = code.slice(0, edit.offset) + edit.text + code.slice(edit.offset);
        }
      }

      if (id.endsWith('.mdx') || id.endsWith('.md')) {
        if (!options.markdownProcessor) {
          warnIfMarkdownIsUnconfigured((message) => this.warn(message));
          return;
        }
        const result = await options.markdownProcessor(code, id);
        const frontmatter = isValidatedMarkdownFrontmatter(result.frontmatter) ? result.frontmatter
          : validateMarkdownFrontmatter(result.frontmatter, { source: code, filename: id, extensions: (options.markdownProcessor as any).frontmatterExtensions });
        const sourceRoute = filePathToRoutePath(routeKeyOf(projectRoot, id.split('?')[0]!));
        if (frontmatter.aliases?.length && /\[|:[A-Za-z_]/.test(sourceRoute)) {
          this.error({ code: 'COSSACK_MARKDOWN_ALIAS_DYNAMIC', id,
            message: 'Markdown output aliases require a static source route.' });
        }
        const htmlContent = result.html;
        const author = typeof frontmatter.author === 'string' ? frontmatter.author : '';
        const date = typeof frontmatter.date === 'string' ? frontmatter.date : '';
        const renderedMarkdown = injectMarkdownByline(htmlContent, author, date);

        return {
          code: `
            import { Cossack } from '@cossackframework/core';
            import { html, unsafeHTML } from '@cossackframework/renderer';

            const markdownContent = ${JSON.stringify(renderedMarkdown)};

            class MdxPage extends Cossack {
              static markdownFrontmatter = Object.freeze(${JSON.stringify(frontmatter)});
              head() {
                return {
                  title: ${JSON.stringify(frontmatter.title || '')},
                  description: ${JSON.stringify(frontmatter.description || '')},
                  image: ${JSON.stringify(frontmatter.image || '')},
                  links: [{ tag: 'link', attributes: { rel: 'canonical', href: new URL(${JSON.stringify(frontmatter.canonical ?? sourceRoute)} , this.isServer ? this.c.req.url : globalThis.location.href).href } }]
                };
              }

              render() {
                return html\`<div class="mdx-content">
                  \${unsafeHTML(markdownContent)}
                </div>\`;
              }
            }

            // Manually define metadata since decorators require extra build steps
            // when generated from a plugin transform hook. .md/.mdx pages are
            // static content (no server logic), so pre-render them by default —
            // they can't opt in via @Page({ ssg: true }) like .ts pages because
            // they aren't TypeScript.
            Reflect.defineMetadata('page:options', { transport: 'http', ssg: ${frontmatter.ssg !== false} }, MdxPage);

            export default MdxPage;
          `,
          map: null,
        };
      }

      // Attach each realtime component's registry id to its class in every
      // environment, from the original source (another pre plugin may have
      // rewritten `code` for the browser).
      if (file.endsWith('.ts') && !file.endsWith('.d.ts') && applicationSource) {
        let original: string | undefined;
        try { original = readFileSync(file, 'utf8'); } catch { original = undefined; }
        if (original?.includes('durable-object')) {
          const { components } = findRealtimeComponents(original, realtimeFileLabel(projectRoot, file) ?? '/' + relative(projectRoot, file).replaceAll('\\', '/'));
          if (components.length) code += realtimeIdAssignments(components);
        }
      }

      return { code, map: null };
    },
    writeBundle() {
      // After the CLIENT environment build, the Vite manifest exists at
      // dist/client/.vite/manifest.json. The Cloudflare plugin's generated
      // `.assetsignore` excludes the `.vite` directory from the ASSETS
      // binding, so copy the manifest to a non-ignored path the SSR runtime
      // can fetch via env.ASSETS.fetch(SSR_MANIFEST_ASSET_PATH).
      //
      // This hook fires once per environment build; only act on the client
      // environment where the manifest has just been emitted.
      if (this.environment?.name !== 'client') return;

      const clientOutDir = resolve(projectRoot, this.environment.config.build.outDir);
      const src = resolve(clientOutDir, '.vite', 'manifest.json');
      if (!existsSync(src)) {
        this.warn('[cossack] No client build manifest at .vite/manifest.json; production pages will not load client scripts. ' +
          'Set build.manifest: true for the client environment.');
        return;
      }

      // Without this copy, production SSR renders pages with no client
      // scripts (no hydration). Fail the build instead of shipping that.
      try {
        const data = readFileSync(src, 'utf-8');
        const uncovered = uncoveredClientOutput(JSON.parse(data));
        if (uncovered.length) this.warn(`[cossack] ${describeUncoveredClientOutput(uncovered)}`);
        const destDir = clientOutDir;
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const dest = resolve(destDir, 'cossack-manifest.json');
        writeFileSync(dest, data);
      } catch (e) {
        this.error(`[cossack] Could not emit cossack-manifest.json: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Emit the routes manifest consumed by the `cossack ssg` CLI. This is the
      // single source of truth for component route IDs (cmp_N) — the SSG build
      // reads it instead of re-scanning `src/pages` and re-deriving IDs, so the
      // IDs can never drift from what the SSR router assigns here. Route
      // conflicts and write failures fail the build.
      try {
        emitRoutesManifest(projectRoot, clientOutDir, markdownEnabled);
      } catch (e) {
        this.error(`[cossack] Could not emit routes manifest: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

function emitRoutesManifest(projectRoot: string, clientOutDir: string, includeMarkdown: boolean) {
  const { manifest } = generateRoutes(projectRoot, { includeMarkdown });
  if (!existsSync(clientOutDir)) mkdirSync(clientOutDir, { recursive: true });
  writeFileSync(resolve(clientOutDir, 'cossack-routes.json'), JSON.stringify(manifest, null, 2));
}

/**
 * Virtual module exposing the user's `src/lang/*.json` catalogs, plugins'
 * namespaced `lang/*.json`, and language packs' `translations/` catalogs.
 *
 * - **Server**: catalogs are `import.meta.glob`-ed eagerly so the locale
 *   middleware can read any locale synchronously during SSR.
 * - **Client**: catalogs are loaded lazily (one chunk per locale) so only the
 *   active + default locales ship in the initial bundle. The framework
 *   hydrates those two via `window.__INITIAL_STATE__`; the rest are fetched
 *   on demand by `setLocale('<code>')`.
 *
 * Emits:
 * ```ts
 * export const defaultLocale: string;          // 'en' (or APP_LOCALE at build time)
 * export const supportedLocales: string[];     // ['en', 'es', ...]
 * export const catalogs: Record<string, () => Promise<{ default: TranslationCatalog }>>;
 * export async function loadCatalog(locale: string): Promise<TranslationCatalog>;
 * ```
 */
export function cossackLang(): Plugin {
  let projectRoot = process.cwd();
  const json = (name: string) => name.endsWith('.json');
  return {
    name: 'cossack-lang',
    enforce: 'pre',
    configResolved(config) { projectRoot = config.root; },
    configureServer(server) {
      reloadOnTreeChange(server, resolvedLangVirtualModuleId, file => file.endsWith('.json') &&
        (isUnder(resolve(projectRoot, 'src/lang'), file) || pluginLocations(projectRoot).some(plugin =>
          isUnder(resolve(plugin.directory, 'lang'), file) || isUnder(resolve(plugin.directory, 'translations'), file))));
    },
    resolveId(id) {
      if (id === langVirtualModuleId) return resolvedLangVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedLangVirtualModuleId) return;
      const isSsrEnvironment = this.environment?.name !== 'client';
      const plugins = pluginLocations(projectRoot);
      // Packs one level down: translations/<locale>/<plugin>.json.
      const nested = plugins.flatMap(plugin => {
        const directory = resolve(plugin.directory, 'translations');
        if (!existsSync(directory)) return [];
        return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
          .flatMap(entry => directoryEntries(resolve(directory, entry.name), `/src/plugins/${plugin.name}/translations/${entry.name}/`, json));
      });
      const eager = isSsrEnvironment;
      return `
        // One entry per src/lang/<locale>.json. Eager on the server, lazy on the
        // client so each locale becomes its own chunk (code splitting).
        ${moduleMap('modules', projectRoot, directoryEntries(resolve(projectRoot, 'src/lang'), '/src/lang/', json), { eager })}
        // Plugin catalogs (src/plugins/<name>/lang/<locale>.json) join the
        // application's locales under '<name>::key'.
        ${moduleMap('pluginModules', projectRoot, pluginEntries(plugins, 'lang/', json), { eager })}
        // Language packs: a plugin's translations/<locale>.json translates the
        // application's own keys, translations/<locale>/<plugin>.json another
        // plugin's. Packs add their locales.
        ${moduleMap('packModules', projectRoot, [...pluginEntries(plugins, 'translations/', json), ...nested], { eager })}
        function messagesOf(mod) { return (mod && mod.default) ? mod.default : (mod || {}); }
        function extractLocale(globKey) {
          const parts = globKey.split('/');
          const file = parts[parts.length - 1];
          return file.replace(/\.json$/, '');
        }

        // Each locale's sources in merge order: plugins' own catalogs, then packs,
        // then the application's, so application keys win and packs override plugins.
        const sources = {};
        const add = (locale, rank, order, prefix, mod) => (sources[locale] ??= []).push({ rank, order, prefix, mod });
        for (const [key, mod] of Object.entries(pluginModules)) add(extractLocale(key), 0, key, key.split('/')[3] + '::', mod);
        for (const [key, mod] of Object.entries(packModules)) {
          const parts = key.split('/');
          if (parts.length === 6) add(extractLocale(key), 1, key, '', mod);
          else add(parts[5], 1, key, extractLocale(key) + '::', mod);
        }
        for (const [key, mod] of Object.entries(modules)) add(extractLocale(key), 2, key, '', mod);
        for (const list of Object.values(sources)) list.sort((a, b) => a.rank - b.rank || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
        function merge(list, loaded) {
          const merged = {};
          list.forEach((source, index) => {
            for (const [name, value] of Object.entries(messagesOf(loaded[index]))) merged[source.prefix + name] = value;
          });
          return merged;
        }

        const defaultLocale = ${JSON.stringify(process.env.APP_LOCALE || 'en')} || 'en';
        // The application's catalogs and packs name the locales; plugins' own catalogs only join them.
        const named = Object.keys(sources).filter(locale => sources[locale].some(source => source.rank > 0));
        // A pack never makes its language the default: the source text is the default's catalog.
        if (named.length && !named.includes(defaultLocale) && Object.keys(packModules).length) { named.push(defaultLocale); sources[defaultLocale] ??= []; }

        const supportedLocales = named
          .sort((a, b) => {
            // Default locale first so wildcard / fallback behavior prefers
            // the configured default (APP_LOCALE) instead of hardcoding 'en'.
            if (a === defaultLocale) return -1;
            if (b === defaultLocale) return 1;
            return a.localeCompare(b);
          });

        // Lazy loaders used by the client. On the server these are pre-resolved
        // (eager), but we keep the same call signature for a unified API.
        const catalogs = {};
        for (const locale of supportedLocales) {
          const list = sources[locale];
          if (${isSsrEnvironment ? 'true' : 'false'}) {
            const messages = merge(list, list.map(source => source.mod));
            catalogs[locale] = () => Promise.resolve({ default: messages });
          } else if (list.length === 1 && !list[0].prefix) {
            catalogs[locale] = list[0].mod;
          } else {
            catalogs[locale] = async () => ({ default: merge(list, await Promise.all(list.map(source => source.mod()))) });
          }
        }

        async function loadCatalog(locale) {
          const loader = catalogs[locale];
          if (!loader) return undefined;
          const loaded = await loader();
          return (loaded && loaded.default) ? loaded.default : loaded;
        }

        export { defaultLocale, supportedLocales, catalogs, loadCatalog };
      `;
    },
  };
}

const middlewaresVirtualModuleId = 'virtual:cossack-middlewares';
const resolvedMiddlewaresVirtualModuleId = '\0' + middlewaresVirtualModuleId;

/**
 * Virtual module exposing the project's global request middleware registry.
 *
 * Loads `src/bootstrap/middlewares.ts` (if present) — an ordered array of Hono
 * `MiddlewareHandler`s (db client, auth session, feature flags, ...). This is
 * the Laravel-style "kernel" list: middleware definitions live in
 * `src/middlewares/*.ts`, and `src/bootstrap/middlewares.ts` only holds the
 * ordered references. `createApp()` imports this module and registers each
 * handler with `app.use('*', ...)` in array order.
 *
 * Absent file → empty array (existing apps without the registry are unaffected).
 * Client environment → empty array (middlewares only run on the server).
 *
 * Emits:
 * ```ts
 * const middlewares: MiddlewareHandler[];
 * export default middlewares;
 * ```
 */
export function cossackMiddlewares(): Plugin {
  let projectRoot = process.cwd();
  return {
    name: 'cossack-middlewares',
    enforce: 'pre',
    configResolved(config) { projectRoot = config.root; },
    configureServer(server) {
      reloadOnTreeChange(server, resolvedMiddlewaresVirtualModuleId, file => file.endsWith('middlewares.ts') &&
        (file === resolve(projectRoot, 'src/bootstrap/middlewares.ts') || pluginLocations(projectRoot).some(plugin => file === resolve(plugin.directory, 'middlewares.ts'))));
    },
    resolveId(id) {
      if (id === middlewaresVirtualModuleId) return resolvedMiddlewaresVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedMiddlewaresVirtualModuleId) return;
      const isSsrEnvironment = this.environment?.name !== 'client';
      if (!isSsrEnvironment) {
        return `const middlewares = [];\nexport default middlewares;\n`;
      }
      const registry = resolve(projectRoot, 'src/bootstrap/middlewares.ts');
      // A mounted package's middleware module, keyed by the package's name.
      const packages = mountedPackages(projectRoot).filter(mounted => mounted.middlewares !== undefined)
        .map(mounted => ({ key: mounted.name, file: resolve(mounted.root, mounted.middlewares!) }));
      return `
        // Loads src/bootstrap/middlewares.ts (if present): an absent file resolves to [].
        ${moduleMap('modules', projectRoot, existsSync(registry) ? [{ key: '/src/bootstrap/middlewares.ts', file: registry }] : [], { eager: true })}
        const mod = modules['/src/bootstrap/middlewares.ts'];
        // Mounted packages' middleware runs after the application's, in package name order.
        ${moduleMap('packageModules', projectRoot, packages, { eager: true })}
        // Plugin middleware (src/plugins/<name>/middlewares.ts) runs last, in plugin name order.
        ${moduleMap('pluginModules', projectRoot, pluginEntries(pluginLocations(projectRoot), 'middlewares.ts'), { eager: true })}
        const middlewares = [...((mod && mod.default) || [])];
        for (const key of Object.keys(packageModules).sort()) {
          const list = packageModules[key].default;
          if (!Array.isArray(list)) throw new Error('[Cossack] COSSACK_PACKAGE_MOUNT_INVALID: the middleware module of ' + key + ' must default-export an array of middleware.');
          middlewares.push(...list);
        }
        for (const key of Object.keys(pluginModules).sort()) {
          const list = pluginModules[key].default;
          if (!Array.isArray(list)) throw new Error('[Cossack] COSSACK_PLUGIN_MIDDLEWARE_INVALID: ' + key.slice(1) + ' must default-export an array of middleware.');
          // Tagged with the plugin's name, so the router runs them only while it is active.
          const plugin = key.split('/')[3];
          middlewares.push(...list.map(middleware => Object.assign((c, next) => middleware(c, next), { cossackPlugin: plugin })));
        }
        export default middlewares;
      `;
    },
  };
}

const configVirtualModuleId = 'virtual:cossack-config';
const resolvedConfigVirtualModuleId = '\0' + configVirtualModuleId;

/**
 * Virtual module exposing the project's config factories from `src/config/*.ts`.
 *
 * Each config file default-exports a factory `({ env }) => ({...})` that is
 * evaluated per request inside the framework's config ALS scope (see `src/config.ts`). 
 * This is Workers-correct: env bindings (`c.env`) are only available inside the request handler, 
 * so config cannot be evaluated once at module load — it must run per request.
 *
 * `createApp()` imports this module, evaluates each factory with the request's
 * env bindings, and stores the resulting tree in the ALS store where
 * `config('app.name')` resolves it.
 *
 * Absent `src/config/` folder → empty object (existing apps are unaffected).
 * Client environment → empty object (config is server-only — it reads env
 * bindings and must never ship to the browser).
 *
 * Emits (SSR):
 * ```ts
 * const configs: Record<string, ConfigFactory>; // keyed by file name (no ext)
 * export default configs;
 * ```
 */
export function cossackConfig(options: { runtime?: ConfigRuntime; environment?: string; configPath?: string } = {}): Plugin {
  let projectRoot = '';
  let selectedEnvironment: string | undefined;
  let isBuild = false;
  const preflight = async () => {
    const result = await checkConfigBuildRequirements(projectRoot, { runtime: options.runtime, environment: selectedEnvironment, configPath: options.configPath });
    if (!result.valid) { const first = result.diagnostics.find(diagnostic => diagnostic.severity === 'error')!; throw Object.assign(new Error(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n')), { code: first.code }); }
  };
  return {
    name: 'cossack-config',
    enforce: 'pre',
    async configResolved(config) {
      projectRoot = config.root;
      isBuild = config.command === 'build';
      selectedEnvironment = options.environment ?? process.env.CLOUDFLARE_ENV;
      if (isBuild) await preflight();
      generateConfigTypes(projectRoot);
    },
    async buildStart() {
      if (!isBuild) return;
      for (const file of ['src/config', 'package.json', '.cossack/scaffold.json', 'wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) this.addWatchFile(resolve(projectRoot, file));
      const selectedConfig = options.configPath ?? process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH;
      if (selectedConfig) this.addWatchFile(resolve(projectRoot, selectedConfig));
      for (const { source } of discoverConfigSources(projectRoot)) this.addWatchFile(resolve(projectRoot, source));
      await preflight();
      generateConfigTypes(projectRoot);
    },
    configureServer(server) {
      const directory = resolve(projectRoot, 'src/config');
      const isConfig = (file: string) => file.endsWith('.ts') && (isUnder(directory, file) ||
        pluginLocations(projectRoot).some(plugin => isUnder(resolve(plugin.directory, 'config'), file)));
      const update = (file: string) => {
        if (isConfig(resolve(file))) {
          try { generateConfigTypes(projectRoot); }
          catch (error) { server.config.logger.error(String(error)); }
        }
      };
      reloadOnTreeChange(server, resolvedConfigVirtualModuleId, isConfig);
      server.watcher.add(directory);
      for (const event of ['add', 'unlink', 'change'] as const) server.watcher.on(event, update);
      server.httpServer?.once('close', () => {
        for (const event of ['add', 'unlink', 'change'] as const) server.watcher.off(event, update);
      });
    },
    resolveId(id) {
      if (id === configVirtualModuleId) return resolvedConfigVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedConfigVirtualModuleId) return;
      const isSsrEnvironment = this.environment?.name !== 'client';
      if (!isSsrEnvironment) {
        // Config reads env bindings — server-only. Never ship to the client.
        return `const configs = {};\nexport const requirements = {};\nexport const environment = null;\nexport default configs;\n`;
      }
      return `
        // Loads src/config/*.ts (if present). Globs the well-known config
        // directory so an absent folder resolves to {} (no-op).
        ${moduleMap('modules', projectRoot, discoverConfigSources(projectRoot).filter(entry => !entry.key.includes('::')).map(entry => ({ key: `/src/config/${entry.key}.ts`, file: entry.file })), { eager: true })}
        // Plugin configuration joins under '<plugin>::<file>'.
        ${moduleMap('pluginModules', projectRoot, discoverConfigSources(projectRoot).filter(entry => entry.key.includes('::')).map(entry => ({ key: `/src/plugins/${entry.key.split('::')[0]}/config/${entry.key.split('::')[1]}.ts`, file: entry.file })), { eager: true })}
        const configs = {};
        const requirements = {};
        for (const [filePath, mod] of [...Object.entries(modules), ...Object.entries(pluginModules)]) {
          const parts = filePath.split('/');
          const file = parts.pop().replace(/\\.ts$/, '');
          const name = parts[2] === 'plugins' ? parts[3] + '::' + file : file;
          configs[name] = mod.default;
          if (mod.requirements !== undefined) requirements[name] = mod.requirements;
        }
        export { requirements };
        export const environment = ${JSON.stringify(selectedEnvironment ?? null)};
        export default configs;
      `;
    },
  };
}
