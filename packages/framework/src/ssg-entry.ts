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
import { resolveStaticRoutePath, type RoutesManifest } from './route-ids.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface RunSsgArgs {
  manifest: RoutesManifest;
  outDir: string;
  baseUrl?: string;
}

export interface SsgResult {
  rendered: string[];
  failed: { routePath: string; error: string }[];
}

// ---------------------------------------------------------------------------
// Eager initialization — runs during the module's initial load (before the
// ephemeral runner environment is closed). Everything the later `runSsg` call
// needs from Vite MUST be resolved here.
// ---------------------------------------------------------------------------

const projectRoot = process.cwd();

// Eagerly resolve every locale catalog so the renderer can seed core's i18n
// runtime once (mirrors the SSR locale middleware).
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
  const baseUrl = args.baseUrl;
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

  for (const route of ssgRoutes) {
    console.log(`[cossack/ssg] Rendering: ${route.routePath}`);
    try {
      const staticParamsList = await getStaticParams(route.pageOptions!);
      for (const staticParams of staticParamsList) {
        const routePath = resolveStaticRoutePath(route.routePath, staticParams);

        const html = await renderSsgPage(
          route.component,
          routePath,
          staticParams,
          layouts,
          baseUrl,
          AppComponent,
          htmlTemplate,
          route.filePath,
          args.manifest.filePathToId[route.filePath],
          configFactories,
          locale,
          args.manifest.filePathToId,
          requestMiddlewares,
          configRequirements,
        );

        rendered.push(routePath);
        // Defer the file *writes* to the plugin (which owns the output dir),
        // so this module only reads fs (App/template existence checks) and
        // never writes. We stash the rendered HTML for the plugin to drain.
        _renderedHtml.push({ routePath, html });
      }
    } catch (error) {
      let publicRouteFailure = false;
      try { publicRouteFailure = error instanceof SsgPublicRouteError; } catch { /* hostile exception prototypes are not diagnostic data */ }
      const message = publicRouteFailure
        ? 'COSSACK_SSG_NOT_PUBLIC: Static HTML requires a public request-independent route.'
        : 'COSSACK_RUNTIME_FAILED: Static HTML rendering failed.';
      logRuntimeFailure({ runtime: 'node', component: 'ssg-entry' }, 'dispatch');
      failed.push({ routePath: route.routePath, error: message });
    }
  }

  return { rendered, failed };
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
