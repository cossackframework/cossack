import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import type { ConfigRequirementCollection } from './config-requirements.js';
import './i18n-globals.js';
import './config-globals.js';
import { getModuleDefault } from './module-default.js';
import * as fs from 'fs';
import * as path from 'path';
import { Cossack, Page, PageOptions, createInstance, createRootServiceScope, createLayoutServiceScope } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import {
    getLocale,
    getLocaleCatalog,
    getSupportedLocales,
    getDefaultLocale,
    DEFAULT_LOCALE,
} from '@cossackframework/core';
import { renderRoot, TemplateHelpers } from './root.js';
import { runWithConfig, prepareConfigStore, type ConfigFactory } from './config.js';
import { ensureLocaleAlsWired, runWithLocale } from './i18n-context.js';
import type { MiddlewareHandler } from 'hono';
import { runPublicSsgRequest } from './ssg-request.js';
import { resolveSseScopeKey } from './transports/sse.js';

/**
 * Locale catalogs and the build-time default, resolved by the caller from the
 * project's `src/lang/*.json` (via the `virtual:cossack-lang` module in the
 * Vite SSG plugin path). Passed into {@link renderSsgPage} so the renderer no
 * longer reads locale files from disk itself.
 */
export interface SsgLocaleInput {
    /** Map of locale code -> message catalog (mirrors `src/lang/*.json`). */
    catalogs: Record<string, Record<string, string>>;
    /** The project's default locale (e.g. from `APP_LOCALE`). */
    defaultLocale?: string;
}

// Re-export the PageOptions and SsgOptions for convenience
export type { PageOptions, SsgOptions } from '@cossackframework/core';

export type HtmlTemplate = string | ((helpers: TemplateHelpers) => string);

interface LayoutModule {
  default: new (...args: any[]) => Cossack;
}

import type { SsgRoute } from './sitemap-generator.js';

/**
 * Server-safe last-resort App for direct renderSsgPage() callers that do not
 * supply their project App. Keep this local: importing the framework demo App
 * eagerly evaluates browser-only decorator metadata such as KeyboardEvent in
 * the Node SSG process.
 */
@Page({ transport: 'http' })
class SsgFallbackApp extends Cossack {
  render() {
    return html`${this.children}`;
  }
}

/**
 * Convert a file path to a simplified route path.
 * Example: /src/pages/hello/[name]/index.ts -> /hello/[name]
 */
// Re-export the canonical route-path helper so callers that historically
// imported it from ssg-renderer keep working, without maintaining a
// divergent copy here.
export { filePathToRoutePath, getModulePreloads } from './route-ids.js';
import { filePathToRoutePath, getModulePreloads, resolvePageRouteFiles, resolveLayoutPaths, resolveStaticRoutePath } from './route-ids.js';

/** Resolve one render's default without changing another request's catalogs. */
function ssgLocaleStore(catalogs: Record<string, Record<string, string>>, requestedDefault?: string) {
    const locales = Object.keys(catalogs);
    const requested = requestedDefault || DEFAULT_LOCALE;
    const locale = locales.includes(requested) ? requested : locales[0] || DEFAULT_LOCALE;
    return { locale, messages: catalogs[locale] ?? {}, defaultLocale: locale, catalogs };
}

/**
 * Collect all pages marked for SSG from the pages registry.
 */
export function collectSsgRoutes(pages: Record<string, unknown>, layouts: Record<string, LayoutModule>): SsgRoute[] {
  const routes: SsgRoute[] = [];

  for (const path of resolvePageRouteFiles(Object.keys(pages))) {
    const module = pages[path] as any;

    // Skip API routes
    if (path.includes('/src/pages/api/')) continue;

    // Skip 404 and error pages
    if (path.endsWith('/404/index.ts') || path.endsWith('/error/index.ts')) continue;

    const mainExport = getModuleDefault(module);

    // Check if it's a Cossack Component
    if (mainExport && typeof mainExport === 'function' && mainExport.prototype instanceof Cossack) {
      const PageComponent = mainExport as new () => Cossack;
      const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);

      // Check if SSG is enabled for this page
      if (pageOptions?.ssg && (typeof pageOptions.ssg !== 'object' || pageOptions.ssg.enabled !== false)) {
        const routePath = filePathToRoutePath(path);
        routes.push({
          routePath,
          filePath: path,
          component: PageComponent,
          pageOptions,
          ...(/\.mdx?$/.test(path) && (PageComponent as any).markdownFrontmatter ? { frontmatter: (PageComponent as any).markdownFrontmatter } : {}),
        });
      }
    }
  }

  return routes;
}

/**
 * Render a single SSG page to HTML.
 *
 * The output is a fully hydration-ready HTML document produced by the same
 * `renderRoot` function used by the SSR runtime, ensuring SSG and SSR output
 * stay structurally identical (client script tag, window.__INITIAL_STATE__,
 * module preloads, CSS, head tags, optional htmlTemplate).
 */
export async function renderSsgPage(
  PageComponent: new (...args: any[]) => Cossack,
  routePath: string,
  staticParams?: Record<string, string>,
  layouts: Record<string, LayoutModule> = {},
  baseUrl: string = 'https://example.com',
  AppComponent?: new (...args: any[]) => any,
  htmlTemplate?: HtmlTemplate,
  pageFilePath?: string,
  componentRouteId?: string,
  configFactories?: Record<string, ConfigFactory>,
  localeInput?: SsgLocaleInput,
  filePathToId: Record<string, string> = {},
  requestMiddlewares: readonly MiddlewareHandler[] = [],
  configRequirements: ConfigRequirementCollection = {},
): Promise<string> {
  // Get page options for transport type
  const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);

  const sourcePath = pageFilePath ?? `/src/pages${routePath}/index.ts`;
  const layoutPaths = resolveLayoutPaths(sourcePath, Object.keys(layouts));
  const routeMiddlewares = [
    ...layoutPaths.flatMap(layoutPath =>
      (Reflect.getMetadata('page:options', layouts[layoutPath].default) as PageOptions | undefined)?.middlewares ?? []),
    ...(pageOptions?.middlewares ?? []),
  ];

  // Build the config store from the provided factories so `config()` / `env()`
  // resolve the same way as in SSR. SSG has no live request bindings, so we
  // inject the resolved `baseUrl` as `APP_URL` (the same binding SSR reads from
  // `c.env`) so `config('app.url')` returns the correct value. Other bindings
  // default to empty — config factories fall back to their defaults.
  const envBindings: Record<string, unknown> = { APP_URL: baseUrl };
  const configStore = prepareConfigStore(configFactories ?? {}, envBindings, { requirements: configRequirements, context: { runtime: 'ssg' } });

  const configLocale = (configStore.config.app as Record<string, unknown> | undefined)?.locale;
  const contentLocale = /\.mdx?$/.test(sourcePath) ? (PageComponent as any).markdownFrontmatter?.locale : undefined;
  const localeStore = ssgLocaleStore(localeInput?.catalogs ?? {},
    typeof configLocale === 'string' ? configLocale : localeInput?.defaultLocale);
  if (contentLocale) {
    const catalogs = localeInput?.catalogs ?? {};
    const active = Object.keys(catalogs).find(locale => locale.toLowerCase() === contentLocale.toLowerCase());
    if (Object.keys(catalogs).length && !active) throw Object.assign(new Error('Markdown locale has no application catalog.'), { code: 'COSSACK_MARKDOWN_LOCALE_UNAVAILABLE' });
    localeStore.locale = active ?? contentLocale;
    localeStore.messages = catalogs[localeStore.locale] ?? {};
  }
  ensureLocaleAlsWired();

  // Wrap the entire render in the config ALS scope so any `config()` / `env()`
  // calls during bootstrap/render resolve correctly (mirrors the SSR middleware).
  return runWithConfig(configStore, () => runWithLocale(localeStore, () => runPublicSsgRequest({
    routePath: resolveStaticRoutePath(routePath, staticParams ?? {}), pageFilePath: sourcePath,
    baseUrl, env: envBindings, middlewares: requestMiddlewares, routeMiddlewares,
  }, async (context) => {
    const render = async () => {
    const requestServiceScope = createRootServiceScope();
    requestServiceScope.bindRequest({ context, env: envBindings });
    const renderInstances: Cossack[] = [];
    let renderFailed = false;
    let renderError: unknown;
    try {
      const scopeKey = await resolveSseScopeKey(context, pageOptions);

      // Bootstrap App
      if (!AppComponent) {
        // No user App was supplied — use a neutral wrapper so direct API calls can
        // still render without evaluating a browser-oriented component in Node.
        // This is almost always a plumbing mistake (the SSG entry should import and
        // pass the project's own `App`), and results in the wrong <title>/head and
        // missing global tags. Warn loudly so it's not silent.
        console.warn(
          '[cossack/ssg] No AppComponent was passed to renderSsgPage(); falling back to a minimal server-safe App. ' +
            'Pass your App (e.g. via `cossack ssg` or renderSsgPage(..., App)) so your head()/title are applied.',
        );
      }
      const appInstance = createInstance(AppComponent ?? SsgFallbackApp, { serviceScope: requestServiceScope }) as Cossack;
      renderInstances.push(appInstance);
      await appInstance.bootstrap({ context, env: envBindings, page: context.req.path });

      // Bootstrap Layouts
      const layoutInstances: Cossack[] = [];
      const layoutStates: Record<string, any> = {};
      let activeServiceScope = requestServiceScope;
      for (const layoutPath of layoutPaths) {
        const LComp = layouts[layoutPath].default;
        const layoutServiceScope = createLayoutServiceScope(activeServiceScope, LComp, {
          ownerRouteId: filePathToId[layoutPath], ownerRoutePath: layoutPath, scopeKey,
        });
        layoutServiceScope.bindRequest({ context, env: envBindings });
        const lInst = createInstance(LComp, { serviceScope: layoutServiceScope, ownsServiceScope: true });
        renderInstances.push(lInst);
        await lInst.bootstrap({ context, env: envBindings, page: context.req.path });
        layoutInstances.push(lInst);
        layoutStates[layoutPath] = lInst.getInitialState();
        activeServiceScope = layoutServiceScope;
      }

      // Bootstrap Page
      const pageInstance = createInstance(PageComponent, { serviceScope: activeServiceScope });
      renderInstances.push(pageInstance);

      // Wrap staticParams in SerializedComponentState format for initializeState
      const initialState =
        staticParams && Object.keys(staticParams).length > 0
          ? { public: staticParams, internal: {}, children: {} }
          : undefined;

      await pageInstance.bootstrap({
        context,
        env: envBindings,
        page: context.req.path,
        initialState,
      });

      let body: any;
      let finalHtml = '';
      const resourceOwners = [pageInstance, ...layoutInstances, appInstance];
      for (let pass = 0; pass < 10; pass++) {
        body = (pageInstance as any)._getWrappedTemplate();
        for (let i = layoutInstances.length - 1; i >= 0; i--) {
          layoutInstances[i].children = body;
          body = layoutInstances[i]._getWrappedTemplate();
        }
        appInstance.children = body;
        finalHtml = appInstance._render();
        const pending = resourceOwners.flatMap((owner) => owner.__serverResourcePending());
        if (!pending.length) break;
        if (pass === 9) throw new Error('[Cossack server$] SSG resources did not stabilize after 10 render passes.');
        await Promise.all(pending);
      }
      layoutPaths.forEach((layoutPath, index) => {
        layoutStates[layoutPath] = layoutInstances[index].getInitialState();
      });

      // Head Merging (page → layouts → app, inside-out)
      let headTags = Cossack.composeHead(pageInstance, layoutInstances, appInstance);
      const contentMetadata = /\.mdx?$/.test(sourcePath) ? (PageComponent as any).markdownFrontmatter : undefined;
      if (contentMetadata) {
        const canonical = new URL(contentMetadata.canonical ?? filePathToRoutePath(sourcePath), baseUrl).href;
        headTags = headTags.filter(tag => !(tag.tag === 'link' && tag.attributes?.rel === 'canonical'));
        headTags.push({ tag: 'link', attributes: { rel: 'canonical', href: canonical } });
      }

      // Build the initial state payload, mirroring the SSR handler in router.ts
      // so the client hydration code receives the same shape it expects.
      // Key: routePath must be the ROUTE PATTERN (e.g. "/ssg-demo/users/[username]"),
      // not the concrete URL — the client uses it to look up the page module loader
      // via routeToFilePath, which maps patterns (with [param] brackets) to files.
      const pageInitialState = pageInstance.getInitialState();

      const finalInitialState = {
        ...pageInitialState,
        routePath: pageFilePath ? filePathToRoutePath(pageFilePath) : routePath,
        componentRouteId: componentRouteId ?? routePath,
        appRouteId: 'cossack_app',
        pathname: context.req.path,
        channels: pageOptions?.channels || ['global'],
        transport: pageOptions?.transport || 'http',
        scopeKey,
        _app_state: appInstance.getInitialState(),
        _layout_stack: layoutPaths.map((layoutPath) => ({
          path: layoutPath,
          state: layoutStates[layoutPath],
          componentRouteId: filePathToId[layoutPath],
        })),
      };

      const manifest = readManifestFile();
      const modulePreloads = getModulePreloads(manifest, pageFilePath ?? '');

      const supported = getSupportedLocales();
      const activeLocale = getLocale();
      const langHydration =
        supported.length > 0
          ? {
              locale: activeLocale,
              messages: getLocaleCatalog(activeLocale) || {},
              ...(getDefaultLocale() !== activeLocale
                ? {
                    defaultLocale: getDefaultLocale(),
                    defaultMessages: getLocaleCatalog(getDefaultLocale()) || {},
                  }
                : {}),
            }
          : undefined;

      const localePreloadEntry = manifest[`src/lang/${activeLocale}.json`];
      const localePreloadHref =
        localePreloadEntry?.file && activeLocale !== getDefaultLocale()
          ? `/${localePreloadEntry.file}`
          : undefined;

      const html = renderRoot({
        body: finalHtml,
        initialState: {
          ...finalInitialState,
          ...(langHydration ? { __cossackLang: langHydration } : {}),
        },
        manifest,
        headTags,
        modulePreloads,
        htmlTemplate,
        lang: activeLocale,
        localePreloadHref,
      });

      return html;
    } catch (error) {
      renderFailed = true;
      renderError = error;
      throw error;
    } finally {
      const errors: unknown[] = [];
      // Pages release first, followed by inner layouts and App. A failed hook
      // must not leave the rest of the request tree alive during the build.
      for (const instance of renderInstances.reverse()) {
        try { await instance.destroyAsync(); } catch (error) { errors.push(error); logRuntimeFailure({ runtime: 'node', component: 'ssg-renderer' }, 'component-cleanup', 'COSSACK_COMPONENT_CLEANUP_FAILED'); }
      }
      try { await requestServiceScope.disposeAsync(); } catch (error) { errors.push(error); logRuntimeFailure({ runtime: 'node', component: 'ssg-renderer' }, 'service-cleanup', 'COSSACK_SERVICE_CLEANUP_FAILED'); }
      if (errors.length) {
        throw new AggregateError(renderFailed ? [renderError, ...errors] : errors,
          `[cossack/ssg] Static rendering failed during ${renderFailed ? 'rendering and cleanup' : 'cleanup'}.`,
          renderFailed ? { cause: renderError } : undefined);
      }
    }
    };
    return contentLocale ? runWithLocale(localeStore, render) : render();
  })));
}

/**
 * Read the Vite manifest to get asset file names.
 * Renamed from getManifest to avoid clashing with router.ts's runtime version.
 */
function readManifestFile(): Record<string, any> {
  try {
    const configuredRoot = import.meta.env.COSSACK_SSG_ROOT;
    const root = typeof configuredRoot === 'string' ? configuredRoot : process.cwd();
    const manifestPath = path.join(root, 'dist/client/.vite/manifest.json');
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(manifestContent);
  } catch (e) {
    // Non-fatal: SSG surfaces a clear error later if the manifest is missing,
    // but warn here so a corrupt read isn't silent.
    logRuntimeFailure({ runtime: 'node', component: 'ssg-manifest' }, 'initialization');
    return {};
  }
}

/**
 * Collect modulepreload hrefs for the current page.
 * Mirrors the implementation in router.ts so SSG output matches SSR output.
 */
/**
 * Get all static params for a dynamic SSG route.
 */
export async function getStaticParams(pageOptions: PageOptions): Promise<Record<string, string>[]> {
  if (typeof pageOptions.ssg === 'object' && pageOptions.ssg.generateStaticParams) {
    return await pageOptions.ssg.generateStaticParams();
  }
  return [{}];
}
