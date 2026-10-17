export { cossackWorkflows } from './vite-workflows.js';
export { cossackSchedules } from './vite-schedules.js';
export { cossackBuildBudgets } from './vite-build-budgets.js';
import { checkConfigBuildRequirements } from './config-preflight.js';
import type { ConfigRuntime } from './config-requirements.js';
import { CONFIG_GLOB, PLUGIN_CONFIG_GLOB, generateConfigTypes, discoverConfigSources } from './config-codegen.js';
import { parseSync, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { installDevelopmentTraceBridge, TRACE_BRIDGE_MODULE } from './vite-development-traces.js';
import { installPublicReloadPrivacy } from './vite-public-diagnostics.js';
import { checkTemplatesForBuild, formatTemplateDiagnostic, startDevelopmentTemplateChecks } from './vite-template-diagnostics.js';
import { clientOptimizedDependencies } from './vite-dependency-optimization.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { generateRoutes, ROUTES_MODULE_ID, ROUTES_SOURCE_PATH, ROUTE_GLOB_EXCLUDES } from './route-codegen.js';
import { PLUGINS_MODULE_ID, pluginPageKey, pluginRegistryModule, readRenderedPlugins, scanPageSources } from './plugin-sources.js';
export { scanPagesDir } from './route-codegen.js';
import { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';
import { checkCapabilityRequirements, type CapabilityUse, type RuntimeName } from './runtime-capabilities.js';
import { extractPageOptionsFromAst, isHttpHandlerModule } from './page-inspection.js';
import { readBuildBindingNames } from './build-bindings.js';
import { classifyRoute, filePathToHttpRoute, filePathToRoutePath } from './route-ids.js';
import { validateMarkdownFrontmatter, isValidatedMarkdownFrontmatter } from './markdown-frontmatter.js';
import { describeUncoveredClientOutput, uncoveredClientOutput, type StaticAssetRouteFact } from './static-asset-routing.js';
import { checkReservedPaths, type ReservedPathDiagnostic } from './reserved-paths.js';
import { findRealtimeComponents, realtimeIdAssignments, realtimeRegistryModule, scanRealtimeComponents,
  REALTIME_COMPONENTS_MODULE_ID, type RealtimeRegistryDiagnostic } from './realtime-registry.js';
export { findRealtimeComponents, scanRealtimeComponents, realtimeRegistryModule, REALTIME_COMPONENTS_MODULE_ID } from './realtime-registry.js';

export { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

const resolvedRealtimeComponentsModuleId = '\0' + REALTIME_COMPONENTS_MODULE_ID;
const resolvedPluginsModuleId = '\0' + PLUGINS_MODULE_ID;

const langVirtualModuleId = 'virtual:cossack-lang';
const resolvedLangVirtualModuleId = '\0' + langVirtualModuleId;

const PAGE_GLOB_EXCLUDES = [
  '!/src/pages/**/layout.ts',
  '!/src/pages/**/loading.ts',
  ...ROUTE_GLOB_EXCLUDES,
];

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
   * Check html and svg templates (`cossack check templates`): builds fail on
   * template errors, and the dev server reports diagnostics as files change.
   * Default true.
   */
  templateDiagnostics?: boolean;
}

let configuredMarkdownProcessor: MarkdownProcessor | undefined;

/** @internal Used by the SSG runner to reproduce the application's page plugin. */
export function getConfiguredMarkdownProcessor(): MarkdownProcessor | undefined {
  return configuredMarkdownProcessor;
}

export function cossackPages(options: CossackPagesOptions = {}): Plugin {
  let projectRoot = process.cwd();
  let templatesChecked = false;
  let publicDirectory: string | false = 'public';
  let developmentBase = '/';
  let traceBridge: ReturnType<typeof installDevelopmentTraceBridge> | undefined;
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
  const refreshCapabilityPages = () => {
    const { pageKeys, sources } = scanPageSources(projectRoot, markdownEnabled);
    capabilityPages = new Set(pageKeys.map(key => resolve(projectRoot, (sources[key] ?? key).slice(1)).replaceAll('\\', '/')));
  };
  const pageRequirement = async (file: string) => {
    const key = pluginPageKey('/' + relative(projectRoot, file).replaceAll('\\', '/'));
    let transport = 'http';
    let stateful = false;
    let line: number | undefined;
    if (file.endsWith('.ts')) {
      const source = readFileSync(file, 'utf8');
      if (classifyRoute(filePathToHttpRoute(key)) === 'api' && await isHttpHandlerModule(source)) return {};
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
    config() {
      return {
        ssr: {
          noExternal: [
            '@cossackframework/framework',
            '@cossackframework/ui',
            '@cossackframework/solar-icons',
          ],
        },
        environments: {
          client: {
            optimizeDeps: {
              // The framework client app stays in Vite's graph for its
              // virtual modules and HMR when linked; see the helper for why
              // an installed framework also lists its devtools entry.
              include: clientOptimizedDependencies(import.meta.url),
            },
          },
          ssr: {
            resolve: {
              noExternal: [
                '@cossackframework/framework',
                '@cossackframework/ui',
                '@cossackframework/solar-icons',
              ],
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
          requirements.push({ feature: 'realtime component', source: { file: resolve(projectRoot, component.file.slice(1)), line: component.line },
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
        return pluginRegistryModule(plugins, this.environment?.name !== 'client');
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

        const pagePatterns = JSON.stringify([
          '/src/pages/**/*.ts',
          ...(markdownEnabled ? ['/src/pages/**/*.mdx', '/src/pages/**/*.md'] : []),
          ...PAGE_GLOB_EXCLUDES,
        ]);
        // Plugin pages overlay the application's tree under the same keys.
        const pluginGlob = (patterns: string[]) => JSON.stringify(patterns.map(pattern =>
          pattern.replace('/src/pages/', '/src/plugins/*/pages/')));
        const globOptions = isSsrEnvironment ? ', { eager: true }' : '';

        // Worker-rendered HTML may bypass transformIndexHtml. The client
        // registry is the shared bootstrap path for generated applications.
        return `
          ${!isSsrEnvironment && traceBridge ? `import ${JSON.stringify(TRACE_BRIDGE_MODULE)};` : ''}
          function overlay(application, plugins) {
            const merged = { ...application };
            for (const [file, module] of Object.entries(plugins)) {
              // '/src/plugins/<name>/pages/<rest>' routes as '/src/pages/<rest>'.
              const key = '/src/pages/' + file.split('/').slice(5).join('/');
              if (Object.hasOwn(merged, key)) {
                throw new Error('[Cossack] COSSACK_PLUGIN_ROUTE_CONFLICT: ' + file.slice(1) + ' and another source both define ' + key.slice('/src/pages'.length) + '.');
              }
              merged[key] = module;
            }
            return merged;
          }
          const pages = overlay(
            import.meta.glob(${pagePatterns}${globOptions}),
            import.meta.glob(${pluginGlob(JSON.parse(pagePatterns))}${globOptions}),
          );

          // Layouts: eager on SSR (synchronous server rendering), lazy on the
          // client. A layout often pulls in heavy deps (e.g. the dashboard
          // layout imports the whole @cossackframework/ui barrel); eager-loading
          // every layout on the client would force those deps onto routes that
          // don't use them (e.g. the public landing page loading the dashboard
          // sidebar). The client resolves layouts via dynamic import in app.ts.
          const layouts = overlay(
            import.meta.glob(${JSON.stringify(['/src/pages/**/layout.ts', ...ROUTE_GLOB_EXCLUDES])}${globOptions}),
            import.meta.glob(${pluginGlob(['/src/pages/**/layout.ts', ...ROUTE_GLOB_EXCLUDES])}${globOptions}),
          );

          // Loading states: always eager (small, needed immediately for UX)
          const loadings = overlay(
            import.meta.glob(${JSON.stringify(['/src/pages/**/loading.ts', ...ROUTE_GLOB_EXCLUDES])}, { eager: true }),
            import.meta.glob(${pluginGlob(['/src/pages/**/loading.ts', ...ROUTE_GLOB_EXCLUDES])}, { eager: true }),
          );

          // Components resolve by direct class reference (component(Card, ...)
          // captures the constructor), so no registry glob is needed. Eagerly
          // globbing src/components/ would pull in every re-exported component
          // (e.g. a UI barrel) and defeat tree-shaking.
          const components = {};

          export default { pages, layouts, loadings, components };
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
          const path = relative(sourceDirectory, file);
          if (path.startsWith('..') || path.startsWith('/') || !path.endsWith('.ts')) return;
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
        const update = (file: string) => {
          const path = relative(projectRoot, file).replaceAll('\\', '/');
          if (!/^src\/(?:pages|plugins\/[^/]+\/pages)\/.+\.(?:ts|mdx?)$/.test(path)) return;
          try {
            if (options.capabilities) refreshCapabilityPages();
            const generated = generateRoutes(projectRoot, { includeMarkdown: markdownEnabled });
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
      if (isDev && id.endsWith('.ts') && file.startsWith(resolve(projectRoot, 'src').replaceAll('\\', '/') + '/')) {
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
        const sourceRoute = filePathToRoutePath(pluginPageKey('/' + relative(projectRoot, id).replaceAll('\\', '/')));
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
      if (file.endsWith('.ts') && !file.endsWith('.d.ts') && file.startsWith(resolve(projectRoot, 'src').replaceAll('\\', '/') + '/')) {
        let original: string | undefined;
        try { original = readFileSync(file, 'utf8'); } catch { original = undefined; }
        if (original?.includes('durable-object')) {
          const { components } = findRealtimeComponents(original, '/' + relative(projectRoot, file).replaceAll('\\', '/'));
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
 * Virtual module exposing the user's `src/lang/*.json` catalogs.
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
  return {
    name: 'cossack-lang',
    enforce: 'pre',
    resolveId(id) {
      if (id === langVirtualModuleId) return resolvedLangVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedLangVirtualModuleId) return;
      const isSsrEnvironment = this.environment?.name !== 'client';
      const globOptions = isSsrEnvironment ? ', { eager: true }' : '';
      return `
        // One entry per src/lang/<locale>.json. Eager on the server, lazy on the
        // client so each locale becomes its own chunk (code splitting).
        const modules = import.meta.glob('/src/lang/*.json'${globOptions});
        // Plugin catalogs (src/plugins/<name>/lang/<locale>.json) join the
        // application's locales under '<name>::key'. Application keys win.
        const pluginModules = import.meta.glob('/src/plugins/*/lang/*.json'${globOptions});
        const pluginCatalogs = {};
        for (const [key, mod] of Object.entries(pluginModules)) {
          const plugin = key.split('/')[3];
          const locale = extractLocale(key);
          (pluginCatalogs[locale] ??= []).push([plugin, mod]);
        }
        for (const list of Object.values(pluginCatalogs)) list.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
        function messagesOf(mod) { return (mod && mod.default) ? mod.default : (mod || {}); }
        function withPlugins(locale, messages, loaded) {
          const merged = {};
          (pluginCatalogs[locale] ?? []).forEach(([plugin], index) => {
            for (const [name, value] of Object.entries(messagesOf(loaded[index]))) merged[plugin + '::' + name] = value;
          });
          return Object.assign(merged, messages);
        }

        function extractLocale(globKey) {
          const parts = globKey.split('/');
          const file = parts[parts.length - 1];
          return file.replace(/\\.json$/, '');
        }

        const defaultLocale = ${JSON.stringify(process.env.APP_LOCALE || 'en')} || 'en';

        const supportedLocales = Object.keys(modules)
          .map(extractLocale)
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
        for (const [key, mod] of Object.entries(modules)) {
          const locale = extractLocale(key);
          const plugins = pluginCatalogs[locale] ?? [];
          if (${isSsrEnvironment ? 'true' : 'false'}) {
            const messages = withPlugins(locale, messagesOf(mod), plugins.map(entry => entry[1]));
            catalogs[locale] = () => Promise.resolve({ default: messages });
          } else if (plugins.length) {
            catalogs[locale] = async () => {
              const [application, ...loaded] = await Promise.all([mod(), ...plugins.map(entry => entry[1]())]);
              return { default: withPlugins(locale, messagesOf(application), loaded) };
            };
          } else {
            catalogs[locale] = mod;
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
  return {
    name: 'cossack-middlewares',
    enforce: 'pre',
    resolveId(id) {
      if (id === middlewaresVirtualModuleId) return resolvedMiddlewaresVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedMiddlewaresVirtualModuleId) return;
      const isSsrEnvironment = this.environment?.name !== 'client';
      if (!isSsrEnvironment) {
        return `const middlewares = [];\nexport default middlewares;\n`;
      }
      return `
        // Loads src/bootstrap/middlewares.ts (if present). Globs a single
        // well-known path so the absence of the file resolves to [].
        const modules = import.meta.glob('/src/bootstrap/middlewares.ts', { eager: true });
        const mod = modules['/src/bootstrap/middlewares.ts'];
        // Plugin middleware (src/plugins/<name>/middlewares.ts) runs after the
        // application's, in plugin name order.
        const pluginModules = import.meta.glob('/src/plugins/*/middlewares.ts', { eager: true });
        const middlewares = [...((mod && mod.default) || [])];
        for (const key of Object.keys(pluginModules).sort()) {
          const list = pluginModules[key].default;
          if (!Array.isArray(list)) throw new Error('[Cossack] COSSACK_PLUGIN_MIDDLEWARE_INVALID: ' + key.slice(1) + ' must default-export an array of middleware.');
          middlewares.push(...list);
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
      const update = (file: string) => {
        const path = relative(projectRoot, resolve(file)).replaceAll('\\', '/');
        if (/^src\/(?:plugins\/[^/]+\/)?config\/[^/]+\.ts$/.test(path)) {
          try { generateConfigTypes(projectRoot); }
          catch (error) { server.config.logger.error(String(error)); }
        }
      };
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
        const modules = import.meta.glob(${JSON.stringify(CONFIG_GLOB)}, { eager: true });
        // Plugin configuration joins under '<plugin>::<file>'.
        const pluginModules = import.meta.glob(${JSON.stringify(PLUGIN_CONFIG_GLOB)}, { eager: true });
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
