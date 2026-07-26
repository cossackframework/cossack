import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, join, relative, sep } from 'path';
import { computeRouteIds, buildRoutesManifest } from './route-ids.js';
import { processMarkdown } from './markdown-processor.js';
import { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';

export { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

const langVirtualModuleId = 'virtual:cossack-lang';
const resolvedLangVirtualModuleId = '\0' + langVirtualModuleId;

/**
 * Public path the SSR runtime uses to fetch the Vite manifest via the
 * Cloudflare ASSETS binding. The Cloudflare Vite plugin generates a
 * `.assetsignore` that excludes the `.vite` directory from the ASSETS
 * binding, so the manifest cannot be served from its default location.
 * The `writeBundle` hook below copies it to this non-ignored path after
 * the client build so `env.ASSETS.fetch` can reach it in production.
 */
export function cossackPages(): Plugin {
  return {
    name: 'cossack-pages',
    enforce: 'pre',
    // The framework runtime imports the virtual modules provided by this
    // plugin. If Vite externalizes the package during SSR, Node evaluates the
    // published JS directly and cannot resolve the `virtual:cossack-*` scheme.
    // Keep it in Vite's module graph so both virtual modules and package-local
    // ESM imports are transformed consistently for external applications.
    config() {
      return {
        ssr: {
          noExternal: ['@cossackframework/framework'],
        },
      };
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        // Detect environment via the Vite 6 Environment API
        // SSR/worker environment: eager loading (synchronous access needed for server routes)
        // Client environment: lazy loading (code splitting for performance)
        const isSsrEnvironment = this.environment?.name !== 'client';

        return `
          const pages = import.meta.glob(['/src/pages/**/*.ts', '/src/pages/**/*.mdx', '/src/pages/**/*.md', '!/src/pages/**/layout.ts', '!/src/pages/**/loading.ts']${isSsrEnvironment ? ', { eager: true }' : ''});

          // Layouts: eager on SSR (synchronous server rendering), lazy on the
          // client. A layout often pulls in heavy deps (e.g. the dashboard
          // layout imports the whole @cossackframework/ui barrel); eager-loading
          // every layout on the client would force those deps onto routes that
          // don't use them (e.g. the public landing page loading the dashboard
          // sidebar). The client resolves layouts via dynamic import in app.ts.
          const layouts = import.meta.glob('/src/pages/**/layout.ts'${isSsrEnvironment ? ', { eager: true }' : ''});

          // Loading states: always eager (small, needed immediately for UX)
          const loadings = import.meta.glob('/src/pages/**/loading.ts', { eager: true });

          // Components resolve by direct class reference (component(Card, ...)
          // captures the constructor), so no registry glob is needed. Eagerly
          // globbing src/components/ would pull in every re-exported component
          // (e.g. a UI barrel) and defeat tree-shaking.
          const components = {};

          export default { pages, layouts, loadings, components };
        `;
      }
    },
    async transform(code, id) {
      // Inject source metadata for DevTools (only in dev mode for client environment)
      const isDev = this.environment?.mode === 'dev';
      if (isDev && id.endsWith('.ts') && code.includes('extends Cossack')) {
        const regex = /(export\s+default\s+|export\s+)?class\s+(\w+)\s+extends\s+Cossack\s*(<[^>]+>)?\s*\{/;
        const match = code.match(regex);
        if (match) {
          const insertionIndex = match.index! + match[0].length;
          const sourceInfo = JSON.stringify({ file: id });
          const injection = `\n  static __source = ${sourceInfo};\n`;
          code = code.slice(0, insertionIndex) + injection + code.slice(insertionIndex);
        }
      }

      if (id.endsWith('.mdx') || id.endsWith('.md')) {
        const { html: htmlContent, frontmatter } = await processMarkdown(code);
        const headingEnd = htmlContent.indexOf('</h1>');
        const contentLead = headingEnd >= 0
          ? htmlContent.slice(0, headingEnd + '</h1>'.length)
          : '';
        const contentBody = headingEnd >= 0
          ? htmlContent.slice(headingEnd + '</h1>'.length)
          : htmlContent;
        const author = typeof frontmatter.author === 'string' ? frontmatter.author : '';
        const date = typeof frontmatter.date === 'string' ? frontmatter.date : '';

        return {
          code: `
            import { Cossack } from '@cossackframework/core';
            import { html, unsafeHTML } from '@cossackframework/renderer';

            const markdownLead = ${JSON.stringify(contentLead)};
            const markdownBody = ${JSON.stringify(contentBody)};
            const markdownAuthor = ${JSON.stringify(author)};
            const markdownDate = ${JSON.stringify(date)};

            class MdxPage extends Cossack {
              head() {
                return {
                  title: ${JSON.stringify(frontmatter.title || '')},
                  description: ${JSON.stringify(frontmatter.description || '')},
                  image: ${JSON.stringify(frontmatter.image || '')}
                };
              }

              render() {
                const byline = markdownAuthor || markdownDate
                  ? html\`<p class="mdx-byline mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                      \${markdownAuthor ? html\`<span>By \${markdownAuthor}</span>\` : ''}
                      \${markdownAuthor && markdownDate ? html\`<span aria-hidden="true">·</span>\` : ''}
                      \${markdownDate ? html\`<time datetime=\${markdownDate}>\${markdownDate}</time>\` : ''}
                    </p>\`
                  : '';
                return html\`<div class="mdx-content">
                  \${unsafeHTML(markdownLead)}
                  \${byline}
                  \${unsafeHTML(markdownBody)}
                </div>\`;
              }
            }

            // Manually define metadata since decorators require extra build steps
            // when generated from a plugin transform hook. .md/.mdx pages are
            // static content (no server logic), so pre-render them by default —
            // they can't opt in via @Page({ ssg: true }) like .ts pages because
            // they aren't TypeScript.
            Reflect.defineMetadata('page:options', { transport: 'http', ssg: true }, MdxPage);

            export default MdxPage;
          `,
          map: null,
        };
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

      const clientOutDir = resolve(process.cwd(), 'dist', 'client');
      const src = resolve(clientOutDir, '.vite', 'manifest.json');
      if (!existsSync(src)) return;

      try {
        const data = readFileSync(src, 'utf-8');
        const destDir = clientOutDir;
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const dest = resolve(destDir, 'cossack-manifest.json');
        writeFileSync(dest, data);
      } catch (e) {
        // Non-fatal: SSR will fall back to empty manifest.
        console.warn('[cossack] Could not emit cossack-manifest.json:', e);
      }

      // Emit the routes manifest consumed by the `cossack ssg` CLI. This is the
      // single source of truth for component route IDs (cmp_N) — the SSG build
      // reads it instead of re-scanning `src/pages` and re-deriving IDs, so the
      // IDs can never drift from what the SSR router assigns here.
      try {
        emitRoutesManifest(clientOutDir);
      } catch (e) {
        // Non-fatal: SSG will surface a clear error if the manifest is missing.
        console.warn('[cossack] Could not emit routes manifest:', e);
      }
    },
  };
}

/**
 * Scan `src/pages` reproducing the same key set as the `import.meta.glob`
 * patterns above (pages = `*.ts`/`*.mdx` excluding `layout.ts`/`loading.ts`;
 * layouts = `layout.ts`). Keys use the `/src/pages/<rel>` format with forward
 * slashes, exactly like Vite's glob keys.
 */
function scanPagesDir(pagesDir: string): { pageKeys: string[]; layoutKeys: string[] } {
  const pageKeys: string[] = [];
  const layoutKeys: string[] = [];
  if (!existsSync(pagesDir)) return { pageKeys, layoutKeys };

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = relative(pagesDir, fullPath).split(sep).join('/');
        const key = `/src/pages/${rel}`;
        if (entry.name === 'layout.ts') {
          layoutKeys.push(key);
        } else if (entry.name === 'loading.ts') {
          // Excluded — matches the glob's `!/src/pages/**/loading.ts`.
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
          pageKeys.push(key);
        }
      }
    }
  };

  walk(pagesDir);
  return { pageKeys, layoutKeys };
}

function emitRoutesManifest(clientOutDir: string) {
  const pagesDir = resolve(process.cwd(), 'src', 'pages');
  const { pageKeys, layoutKeys } = scanPagesDir(pagesDir);
  const maps = computeRouteIds(pageKeys, layoutKeys);
  const manifest = buildRoutesManifest(pageKeys, layoutKeys, maps);
  if (!existsSync(clientOutDir)) mkdirSync(clientOutDir, { recursive: true });
  const dest = resolve(clientOutDir, 'cossack-routes.json');
  writeFileSync(dest, JSON.stringify(manifest, null, 2));
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
          if (${isSsrEnvironment ? 'true' : 'false'}) {
            const messages = (mod && mod.default) ? mod.default : (mod || {});
            catalogs[locale] = () => Promise.resolve({ default: messages });
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
        const middlewares = (mod && mod.default) || [];
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
export function cossackConfig(): Plugin {
  return {
    name: 'cossack-config',
    enforce: 'pre',
    resolveId(id) {
      if (id === configVirtualModuleId) return resolvedConfigVirtualModuleId;
    },
    load(id) {
      if (id !== resolvedConfigVirtualModuleId) return;
      const isSsrEnvironment = this.environment?.name !== 'client';
      if (!isSsrEnvironment) {
        // Config reads env bindings — server-only. Never ship to the client.
        return `const configs = {};\nexport default configs;\n`;
      }
      return `
        // Loads src/config/*.ts (if present). Globs the well-known config
        // directory so an absent folder resolves to {} (no-op).
        const modules = import.meta.glob('/src/config/*.ts', { eager: true });
        const configs = {};
        for (const [filePath, mod] of Object.entries(modules)) {
          const name = filePath.split('/').pop().replace(/\\.ts$/, '');
          configs[name] = mod.default;
        }
        export default configs;
      `;
    },
  };
}
