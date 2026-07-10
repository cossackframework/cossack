import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Cossack, PageOptions, User } from '@cossackframework/core';
import {
    setSupportedLocales,
    setDefaultLocale,
    __hydrateLocale,
    registerLocale,
    getLocale,
    getLocaleCatalog,
    getSupportedLocales,
    getDefaultLocale,
    DEFAULT_LOCALE,
} from '@cossackframework/core';
import { App } from './App';
import { renderRoot, TemplateHelpers } from './root';
import { runWithConfig, type ConfigFactory, type ConfigStore, type EnvFunction } from './config';
import type { Context } from 'hono';

// Re-export the PageOptions and SsgOptions for convenience
export type { PageOptions, SsgOptions } from '@cossackframework/core';

export type HtmlTemplate = string | ((helpers: TemplateHelpers) => string);

interface LayoutModule {
  default: new () => Cossack;
}

interface SsgRoute {
  routePath: string;
  filePath: string;
  component: new () => Cossack;
  pageOptions?: PageOptions;
}

interface LayoutStackItem {
  path: string;
  instance: Cossack;
}

/**
 * Convert a file path to a simplified route path.
 * Example: /src/pages/hello/[name]/index.ts -> /hello/[name]
 */
// Re-export the canonical route-path helper so callers that historically
// imported it from ssg-renderer keep working, without maintaining a
// divergent copy here.
export { filePathToRoutePath, getModulePreloads } from './route-ids';
import { filePathToRoutePath, getModulePreloads } from './route-ids';

/**
 * One-time locale setup for the SSG build. SSG runs under tsx (not Vite), so
 * the `virtual:cossack-lang` module isn't available — read `src/lang/*.json`
 * directly from disk and seed the i18n runtime.
 *
 * The rendered locale is `config('app.locale')` (or `'en'`). Per-locale
 * static output is a follow-up; today every page renders once in the default.
 */
let ssgLocaleInitialized = false;
function ensureSsgLocaleInitialized(projectRoot: string, requestedDefault?: string): void {
    if (ssgLocaleInitialized) return;
    ssgLocaleInitialized = true;
    const langDir = path.resolve(projectRoot, 'src', 'lang');
    const locales: string[] = [];
    try {
        if (fs.existsSync(langDir)) {
            for (const file of fs.readdirSync(langDir)) {
                if (file.endsWith('.json')) {
                    locales.push(file.replace(/\.json$/, ''));
                }
            }
        }
    } catch {
        // Non-fatal — fall through with no catalogs.
    }
    setSupportedLocales(locales.length > 0 ? locales : [DEFAULT_LOCALE]);
    // Resolve a default that is guaranteed to have a catalog on disk. Prefer
    // the passed-in locale (from config('app.locale'), which reads APP_LOCALE);
    // otherwise the first discovered locale; only fall back to 'en' when there
    // are no catalogs at all. This ensures the `__()` missing-key fallback
    // chain always targets a real catalog.
    const requested = requestedDefault || DEFAULT_LOCALE;
    const resolvedDefault = locales.includes(requested)
        ? requested
        : locales[0] || DEFAULT_LOCALE;
    setDefaultLocale(resolvedDefault);
    for (const locale of locales) {
        try {
            const text = fs.readFileSync(path.join(langDir, `${locale}.json`), 'utf8');
            registerLocale(locale, JSON.parse(text));
        } catch {
            // Skip unreadable files.
        }
    }
    const initial = locales.length > 0 ? resolvedDefault : DEFAULT_LOCALE;
    __hydrateLocale(initial, getLocaleCatalog(initial));
}

/**
 * Get the layout stack for a given page path.
 */
function getLayoutStack(pagePath: string, layouts: Record<string, LayoutModule>): LayoutStackItem[] {
  const stack: LayoutStackItem[] = [];
  const relativePath = pagePath.replace('/src/pages/', '');
  const parts = relativePath.split('/');

  let currentPath = '/src/pages';

  // Get root layout if it exists
  if (layouts[`${currentPath}/layout.ts`]) {
    const LComp = layouts[`${currentPath}/layout.ts`].default;
    const lInst = new LComp();
    stack.push({ path: `${currentPath}/layout.ts`, instance: lInst });
  }

  for (let i = 0; i < parts.length - 1; i++) {
    currentPath += `/${parts[i]}`;
    const layoutPath = `${currentPath}/layout.ts`;
    if (layouts[layoutPath]) {
      const LComp = layouts[layoutPath].default;
      const lInst = new LComp();
      stack.push({ path: layoutPath, instance: lInst });
    }
  }

  return stack;
}

/**
 * Collect all pages marked for SSG from the pages registry.
 */
export function collectSsgRoutes(pages: Record<string, unknown>, layouts: Record<string, LayoutModule>): SsgRoute[] {
  const routes: SsgRoute[] = [];

  for (const path in pages) {
    const module = pages[path] as any;

    // Skip API routes
    if (path.includes('/src/pages/api/')) continue;

    // Skip 404 and error pages
    if (path.endsWith('/404/index.ts') || path.endsWith('/error/index.ts')) continue;

    const mainExport = Object.values(module)[0];

    // Check if it's a Cossack Component
    if (mainExport && typeof mainExport === 'function' && mainExport.prototype instanceof Cossack) {
      const PageComponent = mainExport as new () => Cossack;
      const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);

      // Check if SSG is enabled for this page
      if (pageOptions?.ssg) {
        const routePath = filePathToRoutePath(path);
        routes.push({
          routePath,
          filePath: path,
          component: PageComponent,
          pageOptions,
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
  PageComponent: new () => Cossack,
  routePath: string,
  staticParams?: Record<string, string>,
  layouts: Record<string, LayoutModule> = {},
  baseUrl: string = 'https://example.com',
  AppComponent?: new (...args: any[]) => any,
  htmlTemplate?: HtmlTemplate,
  pageFilePath?: string,
  componentRouteId?: string,
  configFactories?: Record<string, ConfigFactory>,
): Promise<string> {
  // Create a mock Hono context for SSR
  const mockContext = createMockContext(routePath, staticParams, baseUrl);

  // Get page options for transport type
  const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);

  const user: User = { id: 'ssg-user' };

  // Build the config store from the provided factories so `config()` / `env()`
  // resolve the same way as in SSR. SSG has no live request bindings, so we
  // inject the resolved `baseUrl` as `APP_URL` (the same binding SSR reads from
  // `c.env`) so `config('app.url')` returns the correct value. Other bindings
  // default to empty — config factories fall back to their defaults.
  const envBindings: Record<string, unknown> = { APP_URL: baseUrl };
  const envFn: EnvFunction = (key, def) => {
    const v = envBindings?.[key];
    return v !== undefined && v !== null ? String(v) : def ?? '';
  };
  const builtConfig: Record<string, unknown> = {};
  if (configFactories) {
    for (const [name, factory] of Object.entries(configFactories)) {
      if (typeof factory !== 'function') {
        throw new Error(
          `[Cossack] Config file "src/config/${name}.ts" must default-export a factory function.`,
        );
      }
      builtConfig[name] = (factory as ConfigFactory)({ env: envFn });
    }
  }
  const configStore: ConfigStore = { env: envBindings, config: builtConfig };

  // Seed the i18n runtime from `src/lang/*.json` (one-time) so SSG output
  // renders in the default locale. Done AFTER building the config store so the
  // default locale can be read from `config('app.locale')` (which in turn reads
  // the `APP_LOCALE` env var via `src/config/app.ts`). Reads the project root
  // from cwd. Note: this runs outside `runWithConfig` because it is a one-time
  // init — we pass the resolved locale explicitly.
  const configLocale = (builtConfig.app as Record<string, unknown> | undefined)?.locale;
  ensureSsgLocaleInitialized(process.cwd(), typeof configLocale === 'string' ? configLocale : undefined);

  // Wrap the entire render in the config ALS scope so any `config()` / `env()`
  // calls during bootstrap/render resolve correctly (mirrors the SSR middleware).
  return runWithConfig(configStore, async () => {

  // Bootstrap App
  if (!AppComponent) {
    // No user App was supplied — falling back to the framework's demo App.
    // This is almost always a plumbing mistake (the SSG entry should import and
    // pass the project's own `App`), and results in the wrong <title>/head and
    // missing global tags. Warn loudly so it's not silent.
    console.warn(
      '[cossack/ssg] No AppComponent was passed to renderSsgPage(); falling back to the framework default App. ' +
        'Pass your App (e.g. via `cossack ssg` or renderSsgPage(..., App)) so your head()/title are applied.',
    );
  }
  const appInstance = new (AppComponent ?? App)();
  await appInstance.bootstrap({ context: mockContext, user, env: envBindings, page: routePath });

  // Bootstrap Layouts
  const layoutInstances: Cossack[] = [];
  const layoutStates: Record<string, any> = {};
  const layoutPaths = getLayoutStack(`/src/pages${routePath.replace(/\//g, '/').replace(/^\//, '')}/index.ts`, layouts);

  for (const layoutItem of layoutPaths) {
    const LComp = layouts[layoutItem.path].default;
    const lInst = new LComp();
    await lInst.bootstrap({ context: mockContext, user, env: envBindings, page: routePath });
    layoutInstances.push(lInst);
    layoutStates[layoutItem.path] = lInst.getInitialState();
  }

  // Bootstrap Page
  const pageInstance = new PageComponent();

  // Wrap staticParams in SerializedComponentState format for initializeState
  const initialState =
    staticParams && Object.keys(staticParams).length > 0
      ? { public: staticParams, internal: {}, children: {} }
      : undefined;

  await pageInstance.bootstrap({
    context: mockContext,
    user,
    env: envBindings,
    page: routePath,
    initialState,
  });

  // Force render to populate registry
  pageInstance._render();

  // Wrap rendering
  let body = (pageInstance as any)._getWrappedTemplate();
  for (let i = layoutInstances.length - 1; i >= 0; i--) {
    layoutInstances[i].children = body;
    body = layoutInstances[i]._getWrappedTemplate();
  }
  appInstance.children = body;
  const finalHtml = appInstance._render();

  // Head Merging (page → layouts → app, inside-out)
  const headTags = Cossack.composeHead(pageInstance, layoutInstances, appInstance);

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
    pathname: mockContext.req.path,
    channels: pageOptions?.channels || ['global'],
    transport: pageOptions?.transport || 'http',
    _app_state: appInstance.getInitialState(),
    _layout_stack: layoutPaths.map((item: LayoutStackItem) => ({
      path: item.path,
      state: layoutStates[item.path],
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
  }); // end runWithConfig
}

/**
 * Create a mock Hono context for SSG rendering.
 */
function createMockContext(
  path: string,
  params?: Record<string, string>,
  baseUrl: string = 'https://example.com',
): Context {
  const fullUrl = params ? replaceParams(path, params) : path;

  // Create a minimal Hono context mock
  const mockContext = {
    req: {
      path: path,
      url: `${baseUrl}${fullUrl}`,
      param: (key?: string) => {
        if (key && params) {
          return params[key];
        }
        return params || {};
      },
      query: () => ({}),
    },
    get: () => undefined,
    set: () => {},
    header: () => {},
    status: 200,
    body: (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    html: (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    text: (text: string) => new Response(text, { headers: { 'Content-Type': 'text/plain' } }),
    json: (obj: any) => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }),
    redirect: (url: string, status?: number) =>
      new Response(null, { status: status || 302, headers: { Location: url } }),
  } as unknown as Context;

  return mockContext;
}

/**
 * Replace route params in a path.
 * Example: /hello/:name with { name: 'tan' } -> /hello/tan
 */
function replaceParams(path: string, params: Record<string, string>): string {
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, value);
  }
  return result;
}

/**
 * Read the Vite manifest to get asset file names.
 * Renamed from getManifest to avoid clashing with router.ts's runtime version.
 */
function readManifestFile(): Record<string, any> {
  try {
    const manifestPath = path.join(process.cwd(), 'dist/client/.vite/manifest.json');
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(manifestContent);
  } catch (e) {
    // Non-fatal: SSG surfaces a clear error later if the manifest is missing,
    // but warn here so a corrupt read isn't silent.
    console.warn('[cossack/ssg] Could not load client manifest:', e);
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
