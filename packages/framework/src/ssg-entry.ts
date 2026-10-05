// src/ssg-entry.ts
//
// SSG orchestration entry, loaded through Vite's `runnerImport()` by the
// `cossackSsg` Vite plugin (see vite-ssg-plugin.ts). Because it runs inside an
// ephemeral `RunnableDevEnvironment`, it can import the `cossack*` virtual
// modules AND the framework's SSR renderer tree (./ssg-renderer, ./root, ...)
// through Vite's full transform pipeline — including the `.mdx`/`.md` →
// Cossack-class transform.
//
// This file is NOT imported at config-evaluation time (it would pull the
// decorator-heavy SSR runtime into the config bundle and break vitest config
// loading). It is only ever reached via `runnerImport(SSG_ENTRY_ID)` from the
// plugin's `closeBundle` hook.
//
// IMPORTANT: all Vite-runner-resolved imports (virtual modules, the project's
// App, the html template, locale catalogs) MUST be evaluated during the
// module's initial load — i.e. at the top level or inside the top-level await
// below. `runnerImport` closes the ephemeral environment as soon as the
// module's top-level evaluation completes, so any `import()` deferred to the
// later `runSsg()` call would hit a "module runner has been closed" error.
// `runSsg` therefore only consumes values captured here at load time.

import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import { SsgPublicRouteError } from './ssg-request.js';
import registry from 'virtual:cossack-pages';
import configFactories, { requirements as configRequirements } from 'virtual:cossack-config';
import requestMiddlewares from 'virtual:cossack-middlewares';
import { supportedLocales, defaultLocale, loadCatalog } from 'virtual:cossack-lang';
import { collectSsgRoutes, getStaticParams, renderSsgPage, type HtmlTemplate } from './ssg-renderer.js';
import { resolveStaticRoutePath, resolvePageRouteFiles, filePathToRoutePath, type RoutesManifest } from './route-ids.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface RunSsgArgs {
  manifest: RoutesManifest;
  outDir: string;
  baseUrl?: string;
}

export interface SsgRouteOutcome {
  routePath: string;
  sourceFile: string;
  params?: Record<string, string>;
  outputPath?: string;
  durationMs: number;
  status: 'rendered' | 'skipped' | 'failed';
  diagnostic?: { code: string; message: string };
}

export interface SsgResult {
  outcomes: SsgRouteOutcome[];
  rendered: string[];
  failed: { routePath: string; error: string }[];
}

// ---------------------------------------------------------------------------
// Eager initialization — runs during the module's initial load (before the
// ephemeral runner environment is closed). Everything the later `runSsg` call
// needs from Vite MUST be resolved here.
// ---------------------------------------------------------------------------

const configuredRoot = import.meta.env.COSSACK_SSG_ROOT;
const projectRoot = typeof configuredRoot === 'string' && configuredRoot ? configuredRoot : process.cwd();

// Eagerly resolve catalogs for each render's isolated locale scope.
const catalogs: Record<string, Record<string, string>> = {};
await Promise.all(
  supportedLocales.map(async (locale) => {
    const messages = await loadCatalog(locale);
    if (messages) catalogs[locale] = messages as Record<string, string>;
  }),
);
const locale = { catalogs, defaultLocale };

// Load the project's App + html template now (through Vite's runner, while the
// environment is still open). Deferred imports inside `runSsg` would fail with
// "module runner has been closed".
const AppComponent = await loadAppComponent();
const htmlTemplate = await loadHtmlTemplate();

// ---------------------------------------------------------------------------
// Public API (called by the plugin after runnerImport returns)
// ---------------------------------------------------------------------------

/**
 * Run the SSG build. Uses the page/config/locale registries and App/template
 * already resolved at module load time. Renders each route marked
 * `@Page({ ssg: true })` (plus all `.md`/`.mdx` pages, which default to SSG)
 * to static HTML via {@link renderSsgPage}. Returns rendered HTML pairs for
 * the plugin to write to disk.
 */
export async function runSsg(args: RunSsgArgs): Promise<SsgResult> {
  _renderedHtml.length = 0;
  const baseUrl = args.baseUrl ?? 'https://example.com';
  // The registry is imported from the SSR build, where layouts are eagerly
  // loaded (see vite-plugin.ts: `{ eager: true }` for SSR). The union type
  // reflects the client's lazy shape; narrow here since SSG is server-only.
  const { pages, layouts } = registry as {
    pages: Record<string, any>;
    layouts: Record<string, any>;
  };

  const ssgRoutes = collectSsgRoutes(pages, layouts);
  console.log(`[cossack/ssg] Found ${ssgRoutes.length} SSG route(s)`);

  const rendered: string[] = [];
  const failed: { routePath: string; error: string }[] = [];
  const outcomes: SsgRouteOutcome[] = [];
  const selected = new Set(ssgRoutes.map(route => route.filePath));
  for (const file of resolvePageRouteFiles(Object.keys(pages))) {
    if (!selected.has(file)) outcomes.push({ routePath: filePathToRoutePath(file), sourceFile: file,
      durationMs: 0, status: 'skipped', diagnostic: { code: 'COSSACK_SSG_NOT_SELECTED',
        message: 'Source is not selected for static page generation.' } });
  }
  const plans: { route: typeof ssgRoutes[number]; outcome: SsgRouteOutcome }[] = [];
  const outputs = new Map<string, SsgRouteOutcome>();
  const reject = (outcome: SsgRouteOutcome, code: string, message: string) => {
    outcome.status = 'failed';
    outcome.diagnostic = { code, message };
    failed.push({ routePath: outcome.routePath, error: `${code}: ${message}` });
  };
  // Validate every output before invoking application render hooks.
  for (const route of ssgRoutes) {
    const started = performance.now();
    let paramsList: Record<string, string>[];
    try { paramsList = await getStaticParams(route.pageOptions!); }
    catch {
      const outcome: SsgRouteOutcome = { routePath: route.routePath, sourceFile: route.filePath,
        durationMs: performance.now() - started, status: 'failed' };
      outcomes.push(outcome);
      reject(outcome, 'COSSACK_RUNTIME_FAILED', 'Static HTML rendering failed.');
      logRuntimeFailure({ runtime: 'node', component: 'ssg-entry' }, 'dispatch');
      continue;
    }
    if (!Array.isArray(paramsList)) {
      const outcome: SsgRouteOutcome = { routePath: route.routePath, sourceFile: route.filePath,
        durationMs: performance.now() - started, status: 'failed' };
      outcomes.push(outcome);
      reject(outcome, 'COSSACK_SSG_INVALID_PARAMS', 'generateStaticParams must return an array of string parameter records.');
      continue;
    }
    if (paramsList.length === 0) {
      outcomes.push({ routePath: route.routePath, sourceFile: route.filePath,
        durationMs: performance.now() - started, status: 'skipped', diagnostic: {
          code: 'COSSACK_SSG_NO_PARAMS', message: 'generateStaticParams returned no routes.' } });
    }
    for (const params of paramsList) {
      for (const outputRoute of [route.routePath, ...(route.frontmatter?.aliases ?? [])]) {
      const outcome: SsgRouteOutcome = { routePath: route.routePath, sourceFile: route.filePath,
        durationMs: 0, status: 'skipped' };
      outcomes.push(outcome);
      try {
        if (!params || typeof params !== 'object' || Array.isArray(params)
          || Object.values(params).some(value => typeof value !== 'string')) throw new Error();
        outcome.params = { ...params };
        outcome.routePath = resolveStaticRoutePath(outputRoute, params);
        // Backslashes, query/hash syntax and parent segments cannot name static output.
        if (!outcome.routePath.startsWith('/') || /[\\?#\u0000]/.test(outcome.routePath)
          || outcome.routePath.split('/').some(segment => segment === '.' || segment === '..')) throw new Error();
        outcome.outputPath = path.resolve(args.outDir, ...outcome.routePath.split('/').filter(Boolean), 'index.html');
        const outputRoot = path.resolve(args.outDir);
        if (!outcome.outputPath.startsWith(outputRoot + path.sep)) throw new Error();
      } catch {
        reject(outcome, 'COSSACK_SSG_INVALID_PARAMS', 'Static parameters do not resolve to a safe complete output path.');
        continue;
      }
      const previous = outputs.get(outcome.outputPath!);
      if (previous) {
        if (previous.status !== 'failed') reject(previous, 'COSSACK_SSG_DUPLICATE_OUTPUT', 'Multiple static routes resolve to the same output file.');
        reject(outcome, 'COSSACK_SSG_DUPLICATE_OUTPUT', 'Multiple static routes resolve to the same output file.');
      } else outputs.set(outcome.outputPath!, outcome);
      plans.push({ route, outcome });
      }
    }
  }
  if (failed.length) {
    for (const { outcome } of plans) if (outcome.status !== 'failed') outcome.diagnostic = {
      code: 'COSSACK_SSG_VALIDATION_ABORTED', message: 'Static rendering was skipped because output validation failed.' };
    return { rendered, failed, outcomes };
  }
  const sourceHtml = new Map<string, string>();
  for (const { route, outcome } of plans) {
    const started = performance.now();
    try {
      const primaryPath = resolveStaticRoutePath(route.routePath, outcome.params!);
      const sourceKey = JSON.stringify([route.filePath, primaryPath]);
      const html = sourceHtml.get(sourceKey) ?? await renderSsgPage(route.component, primaryPath, outcome.params!, layouts,
        baseUrl, AppComponent, htmlTemplate, route.filePath, args.manifest.filePathToId[route.filePath],
        configFactories, locale, args.manifest.filePathToId, requestMiddlewares, configRequirements);
      sourceHtml.set(sourceKey, html);
      outcome.status = 'rendered';
      rendered.push(outcome.routePath);
      _renderedHtml.push({ routePath: outcome.routePath, html, ...(route.frontmatter ? { canonicalUrl: new URL(route.frontmatter.canonical ?? resolveStaticRoutePath(route.routePath, outcome.params!), baseUrl).href } : {}) });
    } catch (error) {
      let publicRouteFailure = false;
      try { publicRouteFailure = error instanceof SsgPublicRouteError; } catch { /* hostile exceptions stay private */ }
      reject(outcome, publicRouteFailure ? 'COSSACK_SSG_NOT_PUBLIC' : 'COSSACK_RUNTIME_FAILED',
        publicRouteFailure ? 'Static HTML requires a public request-independent route.' : 'Static HTML rendering failed.');
      logRuntimeFailure({ runtime: 'node', component: 'ssg-entry' }, 'dispatch');
    } finally { outcome.durationMs = performance.now() - started; }
  }
  // A failed build never exposes a partial HTML publication batch.
  if (failed.length) _renderedHtml.length = 0;
  return { rendered, failed, outcomes };
}

/**
 * Rendered HTML is stashed here (rather than written to disk from this module)
 * so the entry never writes to the output directory — file writes are owned by
 * the plugin, which resolves the final `outDir` and handles the output
 * listing. The plugin drains this after `runSsg` returns and writes the files.
 */
export interface RenderedPage {
  routePath: string;
  html: string;
  canonicalUrl?: string;
}
const _renderedHtml: RenderedPage[] = [];
export function drainRenderedHtml(): RenderedPage[] {
  const out = [..._renderedHtml];
  _renderedHtml.length = 0;
  return out;
}

// ---------------------------------------------------------------------------
// App + html template loading (runs eagerly at module load — see header)
// ---------------------------------------------------------------------------

async function loadAppComponent(): Promise<{ new (...args: any[]): any } | undefined> {
  const resolved = path.resolve(projectRoot, 'src/App.ts');
  if (!fs.existsSync(resolved)) {
    console.warn('[cossack/ssg] App not found at src/App.ts; using framework default.');
    return undefined;
  }
  try {
    // @vite-ignore: the URL is computed at runtime; Vite can't analyze it.
    const mod: any = await import(/* @vite-ignore */ pathToFileURL(resolved).href);
    return mod.App || mod.default;
  } catch (e) {
    logRuntimeFailure({ runtime: 'node', component: 'ssg-App' }, 'initialization');
    return undefined;
  }
}

async function loadHtmlTemplate(): Promise<HtmlTemplate | undefined> {
  const resolved = path.resolve(projectRoot, 'src/root.ts');
  if (!fs.existsSync(resolved)) return undefined;
  try {
    // @vite-ignore: the URL is computed at runtime; Vite can't analyze it.
    const mod: any = await import(/* @vite-ignore */ pathToFileURL(resolved).href);
    const template = mod.template ?? mod.default;
    if (typeof template === 'string' || typeof template === 'function') {
      return template as HtmlTemplate;
    }
    return undefined;
  } catch (e) {
    logRuntimeFailure({ runtime: 'node', component: 'ssg-template' }, 'initialization');
    return undefined;
  }
}
