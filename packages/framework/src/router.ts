// src/router.ts
import 'reflect-metadata';
import { Hono, type Context, type Handler } from 'hono';
import { renderRoot, TemplateHelpers } from './root';
import { PageOptions, Cossack, User, type Middleware } from '@cossackframework/core';
import { createInstance, isRpcCallableAction, sanitizeClientState } from '@cossackframework/core';
import { enforceMethodRateLimit } from '@cossackframework/core';
import { isClientVisibleError } from '@cossackframework/core';

/**
 * RPC allowlist that also accepts @Server methods on injected @Service
 * dependencies. Service methods are forwarded onto the component instance at
 * runtime but their cossack:server-methods metadata lives on the service class
 * (reachable via the component's constructor paramtypes), so the base
 * isRpcCallableAction (which walks the component's own prototype chain) would
 * reject them.
 */
function isRpcCallableActionOrService(constructor: unknown, action: unknown): boolean {
  if (isRpcCallableAction(constructor, action)) return true;
  if (typeof action !== 'string' || typeof constructor !== 'function') return false;
  const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', constructor) || [];
  for (const t of paramTypes) {
    if (t && typeof t === 'function' && Reflect.getMetadata('cossack:service', t)) {
      const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', t) || {};
      if (Object.prototype.hasOwnProperty.call(serverMethods, action)) return true;
    }
  }
  return false;
}
import { App } from './App';
import { createApiHandler } from './api-handler';
import registry from 'virtual:cossack-pages';
import configuredMiddlewares from 'virtual:cossack-middlewares';
import configFactories from 'virtual:cossack-config';
import { SSR_MANIFEST_ASSET_PATH } from './vite-plugin';
import { computeRouteIds, filePathToRoutePath, filePathToHttpRoute, getModulePreloads, APP_ROUTE_ID, type RouterContext } from './route-ids';
import { CossackElement, escapeHtml } from '@cossackframework/renderer';
import {
  handleSseEndpoint,
  handleSseCrpc,
  syncSseState,
  registerSseStoreEntry,
  resolveSseScopeKey,
} from './transports/sse';
import { handleWebSocketProxy } from './transports/websocket';
import { handleUpload } from './transports/http';
import { createLocaleMiddleware } from './middlewares/locale';
import { createFlashMiddleware } from './middlewares/flash';
import { createRequestContextMiddleware } from './middlewares/request-context';
import { getLocale, getLocaleCatalog, getDefaultLocale } from '@cossackframework/core';
import { runWithConfig, type ConfigFactory, type EnvFunction } from './config';

// Side-effect: register the i18n helpers (`__`, `setLocale`, ...) on
// `globalThis` so bare `__('key')` calls in `render()` resolve during SSR.
// This is needed because apps import `createApp` from this `./router`
// subpath, not the framework's main entry (which also imports i18n-globals).
import './i18n-globals';
// Side-effect: register the config accessors (`config`, `env`, `binding`) on
// `globalThis` so bare calls in user middleware/auth/pages resolve during SSR.
// Same reason as i18n-globals above: apps import `createApp` from this
// `./router` subpath, not the framework's main entry.
import './config-globals';

// In production builds, the SSR bundle is emitted BEFORE the client build
// produces dist/client/.vite/manifest.json. We therefore cannot use a static
// or dynamic `import()` for the manifest — the bundler (rolldown) resolves
// the path at build time regardless of where the expression sits, and the
// file does not exist yet. Instead we read it at request time via the same
// runtime mechanism used for CSS: env.ASSETS.fetch on Cloudflare Workers,
// fs.readFileSync on Node.js. In dev mode there is no manifest on disk and
// the try/catch returns an empty object (renderRoot handles this).
let _manifest: Record<string, any> | undefined;
async function getManifest(env?: any): Promise<Record<string, any>> {
  if (_manifest !== undefined) return _manifest;
  // In dev there is no client manifest — Vite serves source on demand, so
  // return empty and let renderRoot emit dev paths. (On Cloudflare the ASSETS
  // fetch 404s and the catch below yields the same empty result, but for the
  // Node adapter the on-disk manifest lookup would otherwise pick up a stale
  // built manifest from the framework package itself.) Short-circuit here so
  // both runtimes behave identically in dev.
  if (import.meta.env?.DEV) {
    _manifest = {};
    return _manifest;
  }
  let resolved: Record<string, any> = {};
  try {
    let text: string;
    if (env?.ASSETS?.fetch) {
      // Cloudflare Workers: fetch from the assets binding. The manifest is
      // copied to SSR_MANIFEST_ASSET_PATH by the cossackPages plugin's
      // writeBundle hook (the default .vite/ location is excluded by the
      // Cloudflare plugin's .assetsignore).
      const res = await env.ASSETS.fetch(new Request(`https://assets.local${SSR_MANIFEST_ASSET_PATH}`));
      if (!res.ok) {
        _manifest = resolved;
        return _manifest;
      }
      text = await res.text();
    } else {
      // Node.js: read from dist/client/.vite/manifest.json. Resolve relative
      // to this module via fileURLToPath (NOT dirname(import.meta.url), which
      // is a file: URL string and yields a bogus "file:/..." path).
      const { readFileSync } = await import('fs');
      const { resolve, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const here = dirname(fileURLToPath(import.meta.url));
      const clientDir = resolve(here, '..', 'client');
      text = readFileSync(resolve(clientDir, '.vite', 'manifest.json'), 'utf-8');
    }
    resolved = JSON.parse(text);
  } catch (e) {
    // Dev mode or manifest not yet generated: renderRoot falls back to
    // un-hashed dev paths. Warn (not error) so a genuinely broken/corrupt
    // manifest isn't completely silent.
    if (!import.meta.env?.DEV) {
      console.warn('[Cossack] Could not load client manifest; falling back to dev paths:', e);
    }
  }
  _manifest = resolved;
  return _manifest;
}

/**
 * Builds the localization payload embedded in `window.__INITIAL_STATE__` so
 * the client can render translated text on first paint without fetching.
 *
 * Ships the active locale's catalog plus the default fallback (when they
 * differ). Other locales are code-split and dynamic-imported by `setLocale`.
 * Returns `undefined` when no catalog is registered (the project has no
 * `src/lang/` folder), so the payload is omitted entirely for apps without
 * localization.
 */
function buildLocaleHydrationData(): { locale: string; messages: Record<string, string>; defaultLocale?: string; defaultMessages?: Record<string, string> } | undefined {
  const locale = getLocale();
  const messages = getLocaleCatalog(locale);
  // No catalog registered → the feature is inactive (no src/lang/ folder).
  // Omit the payload entirely rather than embedding an empty catalog.
  if (!messages) return undefined;
  const def = getDefaultLocale();
  const data: { locale: string; messages: Record<string, string>; defaultLocale?: string; defaultMessages?: Record<string, string> } = { locale, messages };
  if (def && def !== locale) {
    const defMsgs = getLocaleCatalog(def);
    if (defMsgs) {
      data.defaultLocale = def;
      data.defaultMessages = defMsgs;
    }
  }
  return data;
}

/**
 * Resolves a `<link rel="modulepreload">` href for the predicted non-default
 * locale chunk, when one is needed. Returns `undefined` when the active
 * locale is already the default (no preload necessary) or when the manifest
 * can't resolve the chunk (dev mode, missing src/lang file, etc.).
 */
function getLocalePreloadHref(manifest: Record<string, any>): string | undefined {
  const locale = getLocale();
  if (!locale || locale === getDefaultLocale()) return undefined;
  // Vite emits each `src/lang/<locale>.json` as its own chunk; the manifest
  // key is the source path.
  const entry = manifest[`src/lang/${locale}.json`];
  if (!entry?.file) return undefined;
  return `/${entry.file}`;
}

const { pages, layouts, loadings } = registry;

/** Maximum byte size for inlining CSS (20 KiB). */
const CSS_INLINE_THRESHOLD = 25600;

/** Cached CSS content after first read. */
let cachedInlineCss: string | undefined | null = null;

/**
 * Read the entry-client CSS file and return its content if below the inline threshold.
 * Returns `undefined` in dev mode or if the CSS exceeds the threshold.
 * Results are cached after the first successful read.
 */
async function getInlineCss(env: any): Promise<string | undefined> {
  if (cachedInlineCss !== null) return cachedInlineCss || undefined;

  const manifest = await getManifest(env);
  const entry = manifest['src/client/entry-client.ts'];
  if (!entry?.css?.[0]) {
    cachedInlineCss = null;
    return undefined;
  }

  const cssPath = `/${entry.css[0]}`;

  try {
    let cssText: string;

    // Cloudflare Workers: use ASSETS binding
    if (env?.ASSETS?.fetch) {
      const res = await env.ASSETS.fetch(new Request(`https://assets.local${cssPath}`));
      if (!res.ok) {
        cachedInlineCss = null;
        return undefined;
      }
      cssText = await res.text();
    } else {
      // Node.js: read from dist/client. Resolve relative to this module via
      // fileURLToPath — dirname(import.meta.url) is a "file:" URL string, not
      // a filesystem path, and produces a bogus "file:/..." prefix.
      const { readFileSync } = await import('fs');
      const { resolve, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const here = dirname(fileURLToPath(import.meta.url));
      const clientDir = resolve(here, '..', 'client');
      cssText = readFileSync(resolve(clientDir, cssPath.replace(/^\//, '')), 'utf-8');
    }

    if (new TextEncoder().encode(cssText).length <= CSS_INLINE_THRESHOLD) {
      cachedInlineCss = cssText;
      return cssText;
    }

    // CSS too large — don't inline, but cache the decision
    cachedInlineCss = null;
    return undefined;
  } catch (e) {
    // Non-fatal: CSS inlining is an optimisation. Warn so a permissions /
    // read error isn't completely silent.
    console.warn('[Cossack] Could not read client CSS for inlining:', e);
    cachedInlineCss = null;
    return undefined;
  }
}

/**
 * Convert a file path to a simplified route path.
 * Re-exported from ./route-ids for any internal callers; the canonical
 * implementation lives there so the SSR router and the SSG build agree.
 */
export { filePathToRoutePath };

// Components resolve by direct class reference (component(Card, ...) captures
// the constructor), so no name-registry population is needed. The `components`
// glob was removed from the vite plugin to allow tree-shaking — eagerly loading
// src/components/ would pull in every re-exported component (e.g. a UI barrel).

// Generate secure IDs for components (single source of truth: ./route-ids).
// The same computation runs in the SSG build via the Vite-plugin-emitted
// `cossack-routes.json`, so client hydration IDs always match the server's.
const { routeIdMap, routePathToIdMap, routePathToFilePathMap } = computeRouteIds(
  Object.keys(pages),
  Object.keys(layouts),
);
const APP_ID = APP_ROUTE_ID;

export type PageModule = {
  [key: string]: (new () => Cossack) | Handler | Record<string, Handler>;
};

function getLayoutStack(pagePath: string) {
  const stack: string[] = [];
  const relativePath = pagePath.replace('/src/pages/', '');
  const parts = relativePath.split('/');

  let currentPath = '/src/pages';

  if (layouts[`${currentPath}/layout.ts`]) {
    stack.push(`${currentPath}/layout.ts`);
  }

  for (let i = 0; i < parts.length - 1; i++) {
    currentPath += `/${parts[i]}`;
    const layoutPath = `${currentPath}/layout.ts`;
    if (layouts[layoutPath]) {
      stack.push(layoutPath);
    }
  }

  return stack;
}

/**
 * Collect modulepreload hrefs for the current page.
 * Returns an empty array in dev mode (Vite handles module loading natively).
 * In production, collects the page chunk and all its transitive JS imports.
 */
function findNearestSpecialPage(pagePath: string, type: '404' | 'error') {
  const relativePath = pagePath.replace('/src/pages/', '');
  const parts = relativePath.split('/');

  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/');
    const searchPath = dir ? `/src/pages/${dir}/${type}/index.ts` : `/src/pages/${type}/index.ts`;

    if (pages[searchPath]) {
      return { path: searchPath, component: Object.values(pages[searchPath] as object)[0] as new () => Cossack };
    }
  }

  return null;
}

export interface CreateAppOptions {
  AppComponent?: new (...args: any[]) => any;
  htmlTemplate?: string | ((helpers: TemplateHelpers) => string);
  /**
   * Allowed Origin values for WebSocket / SSE upgrade requests. Defaults to
   * same-origin (the request's own origin). Set this for multi-origin
   * deployments. Missing Origin headers are always rejected.
   */
  allowedOrigins?: string[];
  /**
   * Localization options. The locale middleware always runs (it's a no-op
   * when the project has no `src/lang/` folder). Enable `autoDetectBrowser`
   * to honor the `Accept-Language` header for visitors without a locale
   * cookie. Disabled by default because it can affect caching/SEO.
   */
  i18n?: {
    autoDetectBrowser?: boolean;
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<{ Bindings: CloudflareBindings; Variables: { user?: User; db?: any } }>();

  // Shared context passed to transport handlers
  const routerContext: RouterContext = {
    routeIdMap,
    routePathToIdMap,
    routePathToFilePathMap,
    pages,
    layouts,
    allowedOrigins: options.allowedOrigins,
  };

  // Request-context middleware — scopes the Hono `Context` into
  // AsyncLocalStorage FIRST so `cookie()` / `session()` / `getRequestContext()`
  // work from anywhere downstream (including the user middlewares below).
  app.use('*', createRequestContextMiddleware());

  // Config middleware — evaluates each config factory from `src/config/*.ts`
  // with the request's env bindings and wraps the remainder of the request in
  // a per-request AsyncLocalStorage scope so `config()` / `env()` resolve the
  // right values for each visitor. Registered early so every downstream
  // middleware and handler can read config. Absent `src/config/` → no-op
  // (the factories object is empty). Workers-correct: env bindings (`c.env`)
  // are only available inside the request handler, so config is built per
  // request, not once at module load.
  app.use('*', async (c, next) => {
    const envBindings = c.env as unknown as Record<string, unknown>;
    const envFn: EnvFunction = (key, def) => {
      const v = envBindings?.[key];
      return v !== undefined && v !== null ? String(v) : def ?? '';
    };
    const built: Record<string, unknown> = {};
    for (const [name, factory] of Object.entries(configFactories as Record<string, unknown>)) {
      if (typeof factory !== 'function') {
        throw new Error(
          `[Cossack] Config file "src/config/${name}.ts" must default-export a factory function.`,
        );
      }
      built[name] = (factory as ConfigFactory)({ env: envFn });
    }
    return runWithConfig({ env: envBindings, config: built }, () => next());
  });

  // Global request middlewares from `src/bootstrap/middlewares.ts` (db client,
  // auth session, feature flags, ...). Each is registered in array order,
  // before the locale middleware. The registry is the Laravel-style "kernel"
  // list — definitions live in `src/middlewares/*.ts`. Absent file → no-op.
  for (const middleware of configuredMiddlewares) {
    app.use('*', middleware as any);
  }

  // Locale middleware — resolves per-request locale and wraps the remainder
  // of the request in an AsyncLocalStorage scope so `__()` / `getLocale()`
  // resolve the right locale for each visitor. No-op without `src/lang/`.
  app.use('*', createLocaleMiddleware({ autoDetectBrowser: options.i18n?.autoDetectBrowser }));

  // Flash middleware — two-phase signed-cookie lifecycle for flash data
  // (POST writes → GET reads once). No-op (no cookie, no outgoing data) when
  // flash isn't used; throws only if flash is used without an APP_SECRET.
  app.use('*', createFlashMiddleware());

  const createSsrHandler = (PageComponent: new () => Cossack, path: string, pageOptions?: PageOptions) => {
    return async (c: Context) => {
      const inlineCss = await getInlineCss(c.env);

      try {
        const user = c.get('user');
        const appInstance = createInstance(options.AppComponent ?? App);
        const layoutInstances: any[] = [];
        const pageInstance = createInstance(PageComponent);
        const layoutPaths = getLayoutStack(path);

        // Check if component has a loading template (method or file convention)
        // If so, skip init() during SSR to show loading UI immediately
        const hasLoadingTemplate = typeof (pageInstance as any).loadingTemplate === 'function';
        const lastSlash = path.lastIndexOf('/');
        const loadingFilePath = `${path.substring(0, lastSlash)}/loading.ts`;
        const hasLoadingFile = loadings[loadingFilePath] !== undefined;
        const shouldSkipInit = hasLoadingTemplate || hasLoadingFile;

        // Compute scopeKey once — used for SSE store, DO ID, and client initial state.
        const scopeKey = await resolveSseScopeKey(c, pageOptions);

        // For durable-object transport, query the DO for existing state before SSR
        // Only for stateful pages — stateless DOs don't persist state
        let doInitialState: any = undefined;
        let doIdName: string = c.req.url; // Default: per-URL
        if (pageOptions?.transport === 'durable-object' && pageOptions?.scope) {
          doIdName = scopeKey;
        }
        if (pageOptions?.transport === 'durable-object' && pageOptions?.stateful === true) {
          try {
            const doBinding = c.env.COSSACK_OBJECT;
            const id = doBinding.idFromName(doIdName);
            const stub = doBinding.get(id);

            // Build query params for on-demand DO initialization
            // Pass the file path since the DO registry is keyed by file path
            const queryParams = new URLSearchParams({
              componentPath: path,
              url: c.req.url,
              providerName: 'page',
              params: JSON.stringify(c.req.param() || {}),
            });

            // Query the DO for current state via HTTP
            const stateRequest = new Request(`http://dummy.local/state?${queryParams.toString()}`, {
              method: 'GET',
            });
            const stateResponse = await stub.fetch(stateRequest);
            if (stateResponse.ok) {
              const responseData = await stateResponse.json();
              // Extract public state from SerializedComponentState
              if (responseData.public) {
                doInitialState = responseData.public;
              } else if (!responseData.error) {
                // If no public field but no error, use the response directly
                doInitialState = responseData;
              }
            }
          } catch (e) {
            // DO might not exist yet, or other error - proceed with default state
            console.log('[Cossack] Could not query DO state:', e);
          }
        }

        // Bootstrap App
        await appInstance.bootstrap({ context: c, user, env: c.env, page: c.req.path });

        // Bootstrap Layouts
        const layoutStates: Record<string, any> = {};
        for (const lPath of layoutPaths) {
          const LComp = Object.values(layouts[lPath] as object)[0] as new () => Cossack;
          const lInst = createInstance(LComp);
          await lInst.bootstrap({ context: c, user, env: c.env, page: c.req.path });
          layoutInstances.push(lInst);
          layoutStates[lPath] = lInst.getInitialState();
        }

        // Bootstrap Page with retrieved DO initial state (if any)
        // Skip init() if component has a loading template to show loading UI immediately
        await pageInstance.bootstrap({
          context: c,
          user,
          env: c.env,
          page: c.req.path,
          initialState: doInitialState,
          skipInit: shouldSkipInit,
        });

        // If we skipped init, set loading state so loadingTemplate() renders during SSR
        // The client will then call init() via RPC to get the actual data
        if (shouldSkipInit) {
          (pageInstance as any).loading.init = 1;
        }

        // Force render to populate registry
        pageInstance._render();

        // For SSE transport, store the component instance for later use by the SSE endpoint and /crpc.
        if (pageOptions?.transport === 'sse') {
          registerSseStoreEntry(routerContext, path, scopeKey, pageInstance);
        }

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

        const pageInitialState = pageInstance.getInitialState();

        // For durable-object transport, add the DO ID to providerTargets
        // Also add routePath to metadata for client WebSocket connections
        if (pageOptions?.transport === 'durable-object') {
          const doBinding = c.env.COSSACK_OBJECT;
          // Use scoped ID (from scope function) or URL-based ID (default)
          const doId = doBinding.idFromName(doIdName);
          // Convert DurableObjectId to string for client-side use
          pageInitialState.providerTargets = {
            ...(pageInitialState.providerTargets || {}),
            page: doId.toString(),
          };
          // Add routePath to metadata for client WebSocket connections
          if (pageInitialState.metadata) {
            pageInitialState.metadata.routePath = filePathToRoutePath(path);
          }
        }

        const finalInitialState = {
          ...pageInitialState,
          routePath: filePathToRoutePath(path), // Simplified route path (no /src/pages prefix)
          componentRouteId: routePathToIdMap.get(path),
          appRouteId: 'cossack_app', // Route ID for the App component (root)
          pathname: c.req.path,
          channels: pageOptions?.channels || ['global'],
          transport: pageOptions?.transport || 'http',
          scopeKey,
          _app_state: appInstance.getInitialState(),
          _layout_stack: layoutPaths.map((p) => ({ path: p, state: layoutStates[p] })), // Keep file paths for layouts
          // Localization: hydrate the active locale's catalog (and the default
          // fallback if different) so `__()` works on the client immediately.
          // Other locales are dynamic-imported on demand by `setLocale()`.
          __cossackLang: buildLocaleHydrationData(),
        };

        c.header('Content-Type', 'text/html');
        const manifest = await getManifest(c.env);
        const modulePreloads = getModulePreloads(manifest, path);
        return c.body(
          renderRoot({
            body: finalHtml,
            initialState: finalInitialState,
            manifest,
            headTags,
            inlineCss,
            modulePreloads,
            htmlTemplate: options.htmlTemplate,
            lang: getLocale(),
            localePreloadHref: getLocalePreloadHref(manifest),
          }),
        );
      } catch (err) {
        console.error('[Cossack SSR Error]:', err);
        const errorPage = findNearestSpecialPage(path, 'error');
        if (errorPage && path !== errorPage.path) {
          c.status(500);
          const handler = createSsrHandler(errorPage.component, errorPage.path);
          return handler(c);
        }
        // Escape the error to prevent XSS via user-controlled content in the
        // message/stack, and only expose detailed traces in development. In
        // production, stack traces leak file paths and library versions.
        const detail = err instanceof Error ? err.stack : String(err);
        const body = import.meta.env.DEV
          ? `<h1>Internal Server Error</h1><pre>${escapeHtml(detail)}</pre>`
          : '<h1>Internal Server Error</h1>';
        return c.html(body, 500);
      }
    };
  };

  // Transport routes
  app.get('/ws/:provider/:id', handleWebSocketProxy(routerContext));
  app.get('/sse/:componentRouteId', handleSseEndpoint(routerContext));
  app.post('/upload', handleUpload(routerContext));

  app.post('/crpc', async (c) => {
    const body = await c.req.json();
    const { componentRouteId, action, state, payload, target, scopeKey: clientScopeKey } = body;
    const isStreamRequest = !!body._cossack_stream;
    const user = c.get('user');

    const componentPath = routeIdMap.get(componentRouteId);
    if (!componentPath) return c.json({ error: 'Invalid component ID' }, 400);

    // Handle App component (global component) specially
    let componentInstance: any;
    if (componentPath === '/src/App') {
      componentInstance = createInstance(options.AppComponent ?? App);
      await componentInstance.bootstrap({ context: c, user, env: c.env, skipInit: true });
      componentInstance._render();
    } else {
      const module = pages[componentPath] || layouts[componentPath];
      if (!module) return c.json({ error: 'Component not found' }, 404);
      const PageComponent = Object.values(module as object)[0] as new () => Cossack;
      if (!PageComponent || typeof PageComponent !== 'function') return c.json({ error: 'Invalid component' }, 500);
      componentInstance = createInstance(PageComponent) as any;
      await componentInstance.bootstrap({ context: c, user, env: c.env, skipInit: true });

      // Rebuild component tree
      componentInstance._render();
    }

    let targetInstance = componentInstance;
    if (target && target !== targetInstance._id) {
      if (targetInstance.activeComponents.has(target)) {
        targetInstance = targetInstance.activeComponents.get(target);
      } else {
        return c.json({ error: `Target component '${target}' not found` }, 404);
      }
    }

    // Apply the received state to the target component. First restrict to the
    // component's own @State keys (sanitizeClientState) to block overwrites of
    // internal/security-sensitive props. Then also apply keys in the instance's
    // actual public state — covers @State from injected @Service dependencies
    // (synced into the container) which must round-trip or per-action service
    // state would reset on every call.
    const safeState = sanitizeClientState(targetInstance.constructor, state);
    for (const key in safeState) {
      (targetInstance as any)[key] = safeState[key];
    }
    const publicStateKeys = new Set(Object.keys(targetInstance.getPublicState()));
    if (state && typeof state === 'object') {
      for (const key of Object.keys(state)) {
        if (key in safeState) continue;
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
        if (publicStateKeys.has(key)) (targetInstance as any)[key] = (state as Record<string, unknown>)[key];
      }
    }

    // Authorisation gate: only @Server-registered methods are RPC-callable.
    // Prevents crafted requests from invoking framework-internal methods
    // (bootstrap, getMethod, setProperty, getPublicState, destroy, ...).
    // Includes @Server methods on injected @Service dependencies (forwarded
    // onto the component instance but registered on the service class).
    if (!isRpcCallableActionOrService(targetInstance.constructor, action)) {
      return c.json({ error: `Action '${action}' is not a callable server method` }, 403);
    }

    // Rate-limit gate: enforce any @RateLimit declared on the action.
    // If this is a forwarded @Service method, the metadata lives on the service class.
    let rateLimitConstructor: unknown = targetInstance.constructor;
    if (!isRpcCallableAction(rateLimitConstructor, action)) {
      const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', targetInstance.constructor) || [];
      for (const t of paramTypes) {
        if (t && typeof t === 'function' && Reflect.getMetadata('cossack:service', t)) {
          const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', t) || {};
          if (Object.prototype.hasOwnProperty.call(serverMethods, action)) {
            rateLimitConstructor = t;
            break;
          }
        }
      }
    }

    const rateLimited = await enforceMethodRateLimit(c, rateLimitConstructor, action, `crpc:${componentRouteId}`);
    if (rateLimited) return rateLimited;

    if (typeof targetInstance[action] !== 'function') return c.json({ error: `Action '${action}' not found` }, 404);

    // Call the method. For streaming requests, don't await — the result may
    // be an async iterable that the SSE driver will pull values from.
    // Wrap in try/catch so thrown errors surface as a JSON body the client can
    // display instead of a generic HTTP 500. `ClientVisibleError` (the caller's
    // fault, message is user-facing) → 400 with the message; anything else is an
    // internal failure → 500, logged server-side, generic message to the client.
    let actionResult: any;
    try {
      if (isStreamRequest) {
        actionResult = targetInstance[action](...(payload || []));
      } else {
        actionResult = await targetInstance[action](...(payload || []));
      }
    } catch (e: any) {
      if (isClientVisibleError(e)) {
        return c.json({ error: e.message }, 400);
      }
      console.error('[/crpc] internal error:', e);
      const isDev = (import.meta as any).env?.DEV;
      return c.json({ error: isDev ? (e?.stack || String(e)) : 'Internal Server Error' }, 500);
    }

    const location = c.res.headers.get('Location');
    if (location) return c.json({ _cossack_redirect: location });
    if (actionResult instanceof Response) return actionResult;

    // Get the state of the component that was actually modified
    const responseData = targetInstance.getPublicState();

    // Handle SSE streaming detection and state sync.
    // For a CUSTOM scope() (e.g. chat room) the developer's scope function is
    // the authorization model and depends on page-request data not present on
    // this POST — so use the client-supplied scopeKey (echoed from SSR).
    // For the DEFAULT per-user scope, re-derive server-side from the
    // authenticated user so a crafted request can't target another user's entry.
    const targetPageOptions = Reflect.getMetadata('page:options', targetInstance.constructor) as PageOptions | undefined;
    const effectiveScopeKey = typeof targetPageOptions?.scope === 'function'
      ? clientScopeKey
      : await resolveSseScopeKey(c, targetPageOptions);
    const sseResult = handleSseCrpc(componentRouteId, effectiveScopeKey, actionResult, responseData, targetInstance);
    if (sseResult.handled) {
      return c.json(sseResult.response);
    }

    // Non-streaming path: regular method return
    if (actionResult !== undefined) {
      (responseData as any)._cossack_return = actionResult;
    }

    return c.json(responseData);
  });

  // Register all routes
  for (const path in pages) {
    let httpRoute = filePathToHttpRoute(path);

    if (httpRoute.endsWith('/404') || httpRoute.endsWith('/error')) continue;

    const module = pages[path] as any;
    const mainExport = Object.values(module)[0];

    // 1. Check if it's a Cossack Component
    if (mainExport && typeof mainExport === 'function' && mainExport.prototype instanceof Cossack) {
      const PageComponent = mainExport as new () => Cossack;
      const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);
      const layoutPaths = getLayoutStack(path);
      const combinedMiddlewares: Middleware[] = [];
      for (const lPath of layoutPaths) {
        const LComp = Object.values(layouts[lPath] as object)[0] as new () => Cossack;
        const lOpts = Reflect.getMetadata('page:options', LComp);
        if (lOpts?.middlewares) combinedMiddlewares.push(...lOpts.middlewares);
      }
      if (pageOptions?.middlewares) combinedMiddlewares.push(...pageOptions.middlewares);

      if (pageOptions?.transport !== 'http' && pageOptions?.transport !== 'sse') {
        Reflect.defineMetadata('cossack:durable-object-name', 'COSSACK_OBJECT', PageComponent);
      }
      // Register path-scoped middleware once so it runs ahead of every method handler
      // on this route. Hono types route handlers as a fixed-length tuple, so a
      // variable-length middleware spread can't be type-checked — `app.use` avoids that
      // and lets the handlers below be registered as plain single-handler routes.
      for (const middleware of combinedMiddlewares) {
        app.use(httpRoute, middleware);
      }
      // A class that does not override render() is a pure API route: GET must
      // return JSON (via the API handler) rather than render HTML. A class that
      // overrides render() is a page, so GET renders HTML through the SSR
      // handler as usual (it may still expose post/put/etc. as JSON endpoints).
      const isApiRoute =
        pageOptions?.transport === 'http' &&
        !Object.getOwnPropertyDescriptor(PageComponent.prototype, 'render');

      if (isApiRoute) {
        // GET -> JSON. `get()` is the canonical HTTP-GET handler; `init()` is
        // kept as a server-side alias for backward compatibility.
        app.get(httpRoute, createApiHandler(PageComponent, ['get', 'init']));
      } else {
        const ssrHandler = createSsrHandler(PageComponent, path, pageOptions);
        app.get(httpRoute, ssrHandler);
      }

      // Handle class-based HTTP method handlers for hybrid pages
      // This allows pages to both render HTML AND handle API requests (e.g., form POST)
      if (pageOptions?.transport === 'http') {
        const httpMethods = ['post', 'put', 'patch', 'delete'];
        for (const method of httpMethods) {
          if (method in PageComponent.prototype) {
            (app as any)[method](httpRoute, createApiHandler(PageComponent, method));
          }
        }
      }
    }
    // 2. Check if it's a functional API Route
    else if (path.includes('/src/pages/api/')) {
      // Handle default export as a generic handler
      if (typeof module.default === 'function') {
        app.all(httpRoute, module.default);
      }
      // Handle named exports for HTTP methods (Nuxt/Next style)
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      for (const m of methods) {
        if (typeof module[m] === 'function') {
          (app as any)[m.toLowerCase()](httpRoute, module[m]);
        }
      }
    }
  }

  app.notFound(async (c) => {
    const virtualPath = `/src/pages${c.req.path.replace(/\/$/, '')}/index.ts`;
    const notFoundPage = findNearestSpecialPage(virtualPath, '404');
    if (notFoundPage) {
      c.status(404);
      return createSsrHandler(notFoundPage.component, notFoundPage.path)(c);
    }
    return c.text('404 Not Found', 404);
  });

  return app;
}
