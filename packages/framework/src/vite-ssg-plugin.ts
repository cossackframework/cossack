// src/vite-ssg-plugin.ts
//
// Vite plugin that performs Static Site Generation (SSG) inside `vite build`,
// replacing the former standalone `cossack ssg` post-build script.
//
// ## How it works
//
// SSG must render the project's page/layout modules to HTML at build time.
// Vite's module runner is *not* available inside build hooks (this.environment
// is a BuildEnvironment with no `runner`), so the plugin uses Vite's standalone
// `runnerImport()` API to spin up an ephemeral Node `RunnableDevEnvironment`.
//
// Two modules are loaded through the runner:
//   1. The SSG entry (`ssg-entry.ts`, a normal source file) — which imports the
//      `cossack*` virtual modules AND the framework's SSR renderer tree
//      (./ssg-renderer, ./root, @cossackframework/core). Resolving these through
//      Vite is what makes `.mdx`/`.md` pages and i18n catalogs work for SSG
//      without a separate tsx process.
//   2. (The entry itself pulls in `virtual:cossack-pages/-config/-lang`.)
//
// The render runs in Node (build-time only). Output is static HTML files under
// `dist/client/<route>/index.html`, which Workers serves via its ASSETS binding
// — there is no Node runtime requirement at deploy time.
//
// ## Hook timing
//
// Rendering happens in `closeBundle`, gated on `this.environment.name ===
// 'client'`. `closeBundle` fires once per environment, so this runs exactly
// once, after the client build has produced the Vite manifest and the
// `cossack-routes.json` manifest emitted by the `cossackPages` plugin's
// `writeBundle`. This is the same pattern `cossackPages` already uses.
//
// ## Why this file stays lightweight
//
// vitest / `vite` bundle `vite.config.ts` and its dependency tree to load it.
// This plugin is part of that tree, so it must NOT statically import the
// decorator-heavy SSR runtime (./ssg-renderer → ./App → @cossackframework/core)
// or config loading breaks. Only the lightweight `./vite-plugin` /
// `./vite-security-plugin` factories (already config-time deps) are imported
// statically. Everything heavy is reached at runtime through `runnerImport`.

import type { Plugin, InlineConfig } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface CossackSsgOptions {
  /** Set to `false` to skip SSG entirely (e.g. for non-SSG projects). */
  enabled?: boolean;
  /**
   * Base URL for sitemap/canonical URLs. Defaults to {@link getSiteUrl} (which
   * reads `APP_URL` from env/wrangler/.env — the same binding the runtime
   * `config('app.url')` resolves). Resolved at build time inside the entry.
   */
  baseUrl?: string;
  /** Output directory. Defaults to `<root>/dist/client`. */
  outDir?: string;
}

/**
 * Virtual module id for the SSG entry. Resolved through `runnerImport`, this is
 * the real `ssg-entry.ts` source (which imports the `cossack*` virtual modules
 * and the SSR renderer). Using a virtual id lets us remap it to the source file
 * inside the ephemeral environment.
 */
const SSG_ENTRY_ID = 'virtual:cossack-ssg-entry';

/**
 * Vite SSG plugin. Renders pages marked `@Page({ ssg: true })` to static HTML
 * during `vite build` and writes them under the client output directory.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';
 *
 * export default defineConfig({
 *   plugins: [/* ...other cossack plugins *\/, cossackSsg()],
 * });
 * ```
 */
export function cossackSsg(options: CossackSsgOptions = {}): Plugin {
  const enabled = options.enabled !== false;
  // Captured in configResolved so the ephemeral SSG environment inherits the
  // parent build's mode (e.g. `vite build --mode staging`) instead of
  // hardcoding 'production'. Defaults to 'production' for safety.
  let buildMode = 'production';

  return {
    name: 'cossack-ssg',

    configResolved(config) {
      buildMode = config.mode;
    },

    async closeBundle() {
      // Run exactly once, after the client build produced the manifests.
      if (this.environment?.name !== 'client') return;
      if (!enabled) return;
      // Never run SSG during unit tests (vitest builds via the framework config).
      if (process.env.VITEST) return;

      const fs: typeof import('node:fs') = requireRealFs();
      const path = await import('node:path');

      const projectRoot = process.cwd();
      const outDir = path.resolve(projectRoot, options.outDir || 'dist/client');

      console.log('[cossack/ssg] Starting static rendering...');

      // --- Read the routes manifest (single source of truth for cmp_N IDs) ---
      const manifestPath = path.join(outDir, 'cossack-routes.json');
      if (!fs.existsSync(manifestPath)) {
        console.warn(
          `[cossack/ssg] Routes manifest not found at ${manifestPath}. ` +
            'This is expected for projects without SSG pages; skipping SSG.',
        );
        return;
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Resolve the base URL once and reuse it for both rendering and the
      // sitemap (avoids resolving getSiteUrl twice). Resolved here (not in the
      // entry) so the plugin and entry agree on a single value.
      const { getSiteUrl } = await import('./ssg-config.js');
      const baseUrl = options.baseUrl || getSiteUrl({ projectRoot });
      console.log(`[cossack/ssg] Using base URL: ${baseUrl}`);

      // --- Run the orchestrator through Vite (runnerImport loads ssg-entry,
      // which resolves virtual:cossack-* and the SSR renderer via Vite). ---
      const entry = await loadEntry(projectRoot, buildMode);
      const result = await entry.runSsg({ manifest, outDir, baseUrl });

      // --- Drain rendered HTML and write files (the entry defers writes here). ---
      const renderedPages = entry.drainRenderedHtml();
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const renderedRoutes: string[] = [];
      for (const { routePath, html } of renderedPages) {
        const outputFilePath = getOutputFilePath(routePath, outDir, path);
        const outputDir = path.dirname(outputFilePath);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(outputFilePath, html, 'utf-8');
        console.log(`[cossack/ssg] Written: ${outputFilePath}`);
        renderedRoutes.push(routePath);
      }

      // --- Sitemap + routes.json ---
      if (renderedRoutes.length > 0) {
        console.log('\n[cossack/ssg] Generating sitemap...');
        const sitemap = (await import('./sitemap-generator.js')).generateSitemapFromUrls(
          renderedRoutes,
          { baseUrl, lastmod: new Date() },
        );
        fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap, 'utf-8');
        console.log(`[cossack/ssg] Written: ${path.join(outDir, 'sitemap.xml')}`);

        fs.writeFileSync(
          path.join(outDir, 'routes.json'),
          JSON.stringify(renderedRoutes, null, 2) + '\n',
          'utf-8',
        );
      }

      console.log('\n[cossack/ssg] Generated SSG files:');
      listFiles(outDir, '', fs, path);

      if (result.failed.length > 0) {
        // Throwing (rather than process.exitCode) is the correct signal inside
        // `vite build`; Vite surfaces it as a non-zero exit so CI catches it.
        throw new Error(
          `[cossack/ssg] ${result.failed.length} route(s) failed:\n` +
            result.failed.map((r) => `  - ${r.routePath}: ${r.error}`).join('\n'),
        );
      }
      console.log('\n[cossack/ssg] SSG build complete!');
    },
  };
}

export default cossackSsg;

// ---------------------------------------------------------------------------
// Entry loading (via runnerImport)
// ---------------------------------------------------------------------------

interface SsgEntryModule {
  runSsg: (args: {
    manifest: unknown;
    outDir: string;
    baseUrl?: string;
  }) => Promise<{ rendered: string[]; failed: { routePath: string; error: string }[] }>;
  drainRenderedHtml: () => { routePath: string; html: string }[];
}

/**
 * Load the SSG entry through Vite's `runnerImport`. The ephemeral environment
 * has the `cossack*` plugins registered so the virtual modules and the
 * `.mdx`/`.md` transform resolve. `runnerImport` forces `configFile: false`,
 * so the plugins are passed explicitly via `inlineConfig`.
 *
 * `node_modules` deps are externalized to Node (`resolve.external: true` in
 * runnerImport's defaults), so `@cossackframework/core`'s `Cossack` class is
 * the single shared instance — `collectSsgRoutes`'s `instanceof Cossack`
 * checks hold across the boundary.
 *
 * The entry source (`ssg-entry.ts`) is mapped via a tiny virtual plugin that
 * resolves `SSG_ENTRY_ID` to the real file path, so Vite transforms it (TS,
 * `import.meta.glob` in the virtual modules it imports, etc.).
 */
async function loadEntry(projectRoot: string, mode: string): Promise<SsgEntryModule> {
  const { runnerImport } = await import('vite');
  const path = await import('node:path');
  // Resolve the entry source relative to this compiled module so it works in
  // both dev (src/) and the published package (dist/esm/).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entryFilePath = path.resolve(here, 'ssg-entry');

  // Dynamically import the cossack plugin factories so they (and their deps)
  // are not part of the config-bundle dependency graph. These run only during
  // SSG (inside closeBundle), never at config-evaluation time.
  const {
    cossackPages,
    cossackLang,
    cossackMiddlewares,
    cossackConfig,
    getConfiguredMarkdownProcessor,
  } = await import(
    './vite-plugin.js'
  );
  const { cossackSecurityPlugin } = await import('./vite-security-plugin.js');

  const inlineConfig: InlineConfig = {
    root: projectRoot,
    mode,
    // The project's vite.config.ts sets these aliases (`@` → src, `~` →
    // dist/client). `runnerImport` forces `configFile: false`, so re-declare
    // them here or page imports like `@/components/...` won't resolve.
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, 'src'),
        '~': path.resolve(projectRoot, 'dist/client'),
      },
    },
    plugins: [
      // The same cossack plugins the project's vite.config.ts registers, so
      // virtual:cossack-pages/-config/-lang and the .mdx transform resolve.
      cossackPages({ markdownProcessor: getConfiguredMarkdownProcessor() }),
      cossackLang(),
      cossackMiddlewares(),
      cossackConfig(),
      cossackSecurityPlugin(),
      // Map the virtual entry id to the real source file so Vite transforms it.
      {
        name: 'cossack-ssg-entry-resolver',
        resolveId(id) {
          if (id === SSG_ENTRY_ID) return '\0' + SSG_ENTRY_ID;
        },
        load(id) {
          if (id === '\0' + SSG_ENTRY_ID) {
            return `export { runSsg, drainRenderedHtml } from '${entryFilePath}';`;
          }
        },
      },
    ],
  };

  const { module } = await runnerImport<SsgEntryModule>(SSG_ENTRY_ID, inlineConfig);
  return module;
}

// ---------------------------------------------------------------------------
// Output helpers (moved from the deleted ssg-build.ts; used by tests too)
// ---------------------------------------------------------------------------

type PathLike = typeof import('node:path');

/**
 * Resolve a route path to its static HTML output file under `outDir`.
 *
 * SECURITY: refuses any path that resolves outside the output directory — a
 * malicious `generateStaticParams` value (e.g. `'../../../etc/passwd'`) must
 * not write outside `outDir`. The throw is caught by the per-route handler so
 * one bad route skips without aborting the whole build.
 */
export function getOutputFilePath(
  routePath: string,
  outputDir: string,
  path: PathLike = createRequire(import.meta.url)('node:path'),
): string {
  let normalizedPath = routePath;
  if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
  if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1);
  }
  if (normalizedPath === '/' || normalizedPath === '') {
    return path.join(outputDir, 'index.html');
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const candidate = path.join(outputDir, ...segments, 'index.html');
  const resolvedRoot = path.resolve(outputDir);
  const resolvedFile = path.resolve(candidate);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`[cossack/ssg] Refusing to write outside output directory: ${routePath}`);
  }
  return candidate;
}

function listFiles(
  dir: string,
  prefix: string,
  fs: typeof import('node:fs'),
  path: PathLike,
): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      console.log(`${prefix}${entry.name}/`);
      listFiles(entryPath, prefix + '  ', fs, path);
    } else {
      const size = fs.statSync(entryPath).size;
      console.log(`${prefix}${entry.name} (${formatSize(size)})`);
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Real fs accessor
// ---------------------------------------------------------------------------

/**
 * Obtain the real Node.js `fs`. The framework's vitest configuration can
 * inherit the Cloudflare SSR/Workers environment, which replaces `node:fs`
 * with an unenv shim. Going through `createRequire` bypasses Vite's SSR
 * resolver so we always get the real built-in.
 */
let _realFs: typeof import('node:fs') | undefined;
function requireRealFs(): typeof import('node:fs') {
  if (_realFs) return _realFs;
  const require = createRequire(import.meta.url);
  _realFs = require('node:fs') as typeof import('node:fs');
  return _realFs;
}
