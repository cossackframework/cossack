import { developmentRpcEvidence, developmentRpcInvoked, developmentRpcReturned, developmentRpcStream } from './transports/development-trace.js';
import { getModuleDefault } from './module-default.js';
import { getForwardedServerMethodClass } from '@cossackframework/core';
// src/router.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Hono, type Context, type Handler } from 'hono';
import { renderRoot, TemplateHelpers } from './root.js';
import { Page, PageOptions, Cossack, User, type CossackRuntimeInfo, type Middleware } from '@cossackframework/core';
import {
  createInstance,
  createLayoutServiceScope,
  createRootServiceScope,
  snapshotRpcValue,
  RpcError,
  getServiceState,
  isOriginAllowed,
  isRpcCallableAction,
  sanitizeClientState,
  sanitizeServiceState,
} from '@cossackframework/core';
import { enforceMethodRateLimit } from '@cossackframework/core';
import { enforceActionInput, enforceActionAuthorization, getAuthorizationFailure, isActionValidationError, isClientVisibleError } from '@cossackframework/core';

/**
 * RPC allowlist that also accepts @Server methods on injected @Service
 * dependencies. Service methods are forwarded onto the component instance at
 * runtime but their cossack:server-methods metadata lives on the service class
 * (verified against the installed forwarding function), so the base
 * isRpcCallableAction (which walks the component's own prototype chain) would
 * reject them.
 */
function isRpcCallableActionOrService(instance: any, action: unknown): boolean {
  if (isRpcCallableAction(instance.constructor, action)) return true;
  const serviceClass = getForwardedServerMethodClass(instance, action);
  return serviceClass !== undefined && isRpcCallableAction(serviceClass, action);
}

/** Change only the action's signal; preserve Hono/native Request receivers. */
function withRpcSignal(c: Context, signal: AbortSignal): Context {
  const raw = new Proxy(c.req.raw, {
    get(target, property) {
      if (property === 'signal') return signal;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const req = new Proxy(c.req, {
    get(target, property) {
      if (property === 'raw') return raw;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(c, {
    set(target, property, value) { return Reflect.set(target, property, value, target); },
    get(target, property) {
      if (property === 'req') return req;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function serializeRpcResult(value: unknown, state: unknown) {
  return { value: snapshotRpcValue(value, 'value'), state: snapshotRpcValue(state, 'state') };
}

/** Preserve action-owned cookies when Hono merges its existing Context response. */
async function rpcRedirectResponse(c: Context, result: unknown): Promise<Response | undefined> {
  const response = result instanceof Response ? result : undefined;
  const existingCookies = new Set(c.res.headers.getSetCookie());
  for (const value of response?.headers.getSetCookie() ?? []) {
    if (!existingCookies.has(value)) {
      c.header('Set-Cookie', value, { append: true });
      existingCookies.add(value);
    }
  }
  const location = response && response.status >= 300 && response.status < 400
    ? response.headers.get('Location') ?? c.res.headers.get('Location')
    : c.res.headers.get('Location');
  if (!location) return undefined;
  // Fetch must receive RPC metadata rather than follow the redirect into HTML.
  await response?.body?.cancel();
  c.header('Location', undefined);
  return c.json({ _cossack_redirect: location });
}
import { createApiHandler, getAuthoredRouteMember } from './api-handler.js';
import registry from 'virtual:cossack-pages';
import configuredMiddlewares from 'virtual:cossack-middlewares';
import configFactories from 'virtual:cossack-config';
import { SSR_MANIFEST_ASSET_PATH } from './runtime-constants.js';
import { computeRouteIds, filePathToRoutePath, filePathToHttpRoute, getModulePreloads, compareHttpRoutes, resolvePageRouteFiles, resolveLayoutPaths, resolveNearestSpecialPage, createNotFoundResolver, classifyRoute, APP_ROUTE_ID, type RouterContext } from './route-ids.js';
import { CossackElement, escapeHtml, html } from '@cossackframework/renderer';
import {
  handleSseEndpoint,
  syncSseState,
  registerSseStoreEntry,
  resolveSseScopeKey,
  getSseScopeStub,
  isCloudflareRuntime,
  sseBindingMissingMessage,
  sseBindingMissingResponse,
  hydrateSseScopeState,
  attachCoordinatorRuntime,
} from './transports/sse.js';
import { handleWebSocketProxy } from './transports/websocket.js';
import { readRpcRequest } from './transports/http.js';
import { protectTransport } from './transports/security.js';
import { createLocaleMiddleware } from './middlewares/locale.js';
import { createFlashMiddleware } from './middlewares/flash.js';
import { createRequestContextMiddleware } from './middlewares/request-context.js';
import { runWithContext } from './request-context-als.js';
import { createCorsMiddleware } from './middlewares/cors.js';
import { getLocale, getLocaleCatalog, getDefaultLocale } from '@cossackframework/core';
import { runWithConfig, buildConfig, type EnvFunction } from './config.js';
import { assertRuntimeTransportSupport, type CossackRuntimeAdapter } from './runtime-adapter.js';
import { decodeRuntimeRouteParams, withRuntimeRouteParams } from './runtime-websocket.js';
import { createAssetsMiddleware } from './assets.js';
import { createRpcStreamResponse, isRpcStream, retainRpcResponseBody } from './transports/rpc-stream.js';
import { retainResponseLifetime } from './response-lifetime.js';

// Side-effect: register the i18n helpers (`__`, `setLocale`, ...) on
// `globalThis` so bare `__('key')` calls in `render()` resolve during SSR.
// This is needed because apps import `createApp` from this `./router`
// subpath, not the framework's main entry (which also imports i18n-globals).
import './i18n-globals.js';
// Side-effect: register the config accessors (`config`, `env`, `binding`) on
// `globalThis` so bare calls in user middleware/auth/pages resolve during SSR.
// Same reason as i18n-globals above: apps import `createApp` from this
// `./router` subpath, not the framework's main entry.
import './config-globals.js';

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
  return resolveLayoutPaths(pagePath, Object.keys(layouts));
}

/**
 * Collect modulepreload hrefs for the current page.
 * Returns an empty array in dev mode (Vite handles module loading natively).
 * In production, collects the page chunk and all its transitive JS imports.
 */
function findNearestSpecialPage(pagePath: string, type: '404' | 'error') {
  const path = resolveNearestSpecialPage(pagePath, Object.keys(pages), type);
  return path ? { path, component: getModuleDefault(pages[path] as object) as new () => Cossack } : null;
}

export interface CreateAppOptions {
  AppComponent?: new (...args: any[]) => any;
  htmlTemplate?: string | ((helpers: TemplateHelpers) => string);
  /**
   * Allowed Origin values for HTTP RPC, uploads, WebSockets and SSE. Defaults to
   * same-origin (the request's own origin). Set this for multi-origin
   * deployments. RPC/uploads/WebSockets require Origin. Same-origin SSE may omit it.
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
  /** Optional process runtime integration (for example the Deno adapter). */
  runtimeAdapter?: CossackRuntimeAdapter;
}

@Page({ transport: 'http' })
class RouterFallbackApp extends Cossack {
  render() {
    return html`${this.children}`;
  }
}

export function createApp(options: CreateAppOptions = {}) {
  // strict:false so trailing slashes match (e.g. /dashboard/ -> /dashboard).
  // Hono's getPathNoStrict strips a single trailing slash before route matching,
  // so users get the same page whether or not they type the slash.
  const app = new Hono<{ Bindings: CloudflareBindings; Variables: { user?: User; db?: any } }>({ strict: false });
  const resolveNotFound = createNotFoundResolver(Object.keys(pages));
  const executedPolicies = Symbol('cossack:executed-route-policies');
  const policy = (source: string, index: number, middleware: Middleware): Middleware => async (c, next) => {
    const context = c as Context & { [executedPolicies]?: Set<string> };
    const executed = context[executedPolicies] ??= new Set();
    const key = JSON.stringify([source, index]);
    if (executed.has(key)) return next();
    executed.add(key);
    return middleware(c, next);
  };
  const getMiddlewares = (componentPath: string): Middleware[] => {
    const paths = new Set([...getLayoutStack(componentPath), componentPath]);
    return [...paths].flatMap(path => {
      const module = pages[path] || layouts[path];
      const component = path === '/src/App' ? options.AppComponent ?? RouterFallbackApp : module && getModuleDefault(module);
      const middlewares: Middleware[] = typeof component === 'function'
        ? (Reflect.getMetadata('page:options', component) as PageOptions | undefined)?.middlewares ?? [] : [];
      return middlewares.map((middleware, index) => policy(path, index, middleware));
    });
  };

  const resolveRuntimeInfo = async (): Promise<CossackRuntimeInfo> => ({
    platform: 'web',
    ...(options.runtimeAdapter ? {
      ...(await options.runtimeAdapter.getClientMetadata?.()),
      adapter: options.runtimeAdapter.name,
    } : {}),
  });

  // Shared context passed to transport handlers
  const routerContext: RouterContext = {
    routeIdMap,
    routePathToIdMap,
    routePathToFilePathMap,
    pages,
    layouts,
    allowedOrigins: options.allowedOrigins,
    runtimeInfo: resolveRuntimeInfo,
    getMiddlewares,
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
    const built = buildConfig(configFactories as Record<string, unknown>, envFn);
    return runWithConfig({ env: envBindings, config: built }, () => next());
  });

  // Built-in API CORS runs inside the request config scope but before project
  // middleware, so valid preflights avoid auth/database work and downstream
  // API responses (including errors) receive CORS headers.
  app.use('*', createCorsMiddleware());

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
  // Worker-first routing keeps global auth/config and page/layout policies in
  // front of static HTML and files. Missing assets continue to SSR/API routes.
  app.use('*', createAssetsMiddleware(routerContext));

  const createSsrHandler = (PageComponent: new () => Cossack, path: string, pageOptions?: PageOptions) => {
    return async (c: Context) => {
      const inlineCss = await getInlineCss(c.env);
      const runtimeInfo = await resolveRuntimeInfo();
      const requestServiceScope = createRootServiceScope();
      const requestComponents: Cossack[] = [];

      try {
        const user = c.get('user');
        requestServiceScope.bindRequest({ context: c, user, env: c.env });
        const appInstance = createInstance(options.AppComponent ?? RouterFallbackApp, { serviceScope: requestServiceScope });
        requestComponents.push(appInstance);
        const layoutInstances: any[] = [];
        const layoutPaths = getLayoutStack(path);

        // Compute scopeKey once — used for SSE store, DO ID, and client initial state.
        const scopeKey = await resolveSseScopeKey(c, pageOptions);

        // For durable-object transport, query the DO for existing state before SSR
        // Only for stateful pages — stateless DOs don't persist state
        let doInitialState: any = undefined;
        let doIdName: string = c.req.url; // Default: per-URL
        if (pageOptions?.transport === 'durable-object' && pageOptions?.scope) {
          doIdName = scopeKey;
        }
        assertRuntimeTransportSupport(options.runtimeAdapter, pageOptions);
        if (!options.runtimeAdapter && pageOptions?.transport === 'durable-object' && pageOptions?.stateful === true) {
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
        await appInstance.bootstrap({ context: c, user, env: c.env, runtime: runtimeInfo, page: c.req.path });

        // Bootstrap Layouts
        const layoutStates: Record<string, any> = {};
        let activeServiceScope = requestServiceScope;
        for (const lPath of layoutPaths) {
          const LComp = getModuleDefault(layouts[lPath] as object) as new () => Cossack;
          const layoutServiceScope = createLayoutServiceScope(activeServiceScope, LComp, {
            ownerRouteId: routePathToIdMap.get(lPath),
            ownerRoutePath: lPath,
            scopeKey,
          });
          layoutServiceScope.bindRequest({ context: c, user, env: c.env });
          const lInst = createInstance(LComp, { serviceScope: layoutServiceScope, ownsServiceScope: true });
          requestComponents.push(lInst);
          await lInst.bootstrap({ context: c, user, env: c.env, runtime: runtimeInfo, page: c.req.path });
          layoutInstances.push(lInst);
          layoutStates[lPath] = lInst.getInitialState();
          activeServiceScope = layoutServiceScope;
        }

        const pageInstance = createInstance(PageComponent, { serviceScope: activeServiceScope });
        requestComponents.push(pageInstance);
        // Check if component has a loading template (method or file convention)
        // If so, skip init() during SSR to show loading UI immediately
        const hasLoadingTemplate = typeof (pageInstance as any).loadingTemplate === 'function';
        const lastSlash = path.lastIndexOf('/');
        const loadingFilePath = `${path.substring(0, lastSlash)}/loading.ts`;
        const hasLoadingFile = loadings[loadingFilePath] !== undefined;
        const shouldSkipInit = hasLoadingTemplate || hasLoadingFile;

        // Bootstrap Page with retrieved DO initial state (if any)
        // Skip init() if component has a loading template to show loading UI immediately
        await pageInstance.bootstrap({
          context: c,
          user,
          env: c.env,
          runtime: runtimeInfo,
          page: c.req.path,
          providerTargets: options.runtimeAdapter && pageOptions?.transport === 'durable-object' ? { page: scopeKey } : undefined,
          initialState: doInitialState,
          skipInit: shouldSkipInit,
        });

        // If we skipped init, set loading state so loadingTemplate() renders during SSR
        // The client will then call init() via RPC to get the actual data
        if (shouldSkipInit) {
          (pageInstance as any).loading.init = 1;
        }

        // For SSE transport, connect the shared scope before rendering so SSR
        // renders the authoritative state. On Cloudflare the coordinator owns
        // the scope: first initialization wins and later requests hydrate the
        // snapshot instead of overwriting it. Node and Deno keep the
        // process-local store entry for the SSE endpoint and /crpc.
        if (pageOptions?.transport === 'sse') {
          const componentRouteId = routePathToIdMap.get(path);
          const sseStub = componentRouteId ? getSseScopeStub(c.env, componentRouteId, scopeKey) : undefined;
          if (sseStub) {
            const initialized = await sseStub.initialize(JSON.stringify(pageInstance.getPublicState()));
            if (!initialized.fresh) {
              try { hydrateSseScopeState(pageInstance, JSON.parse(initialized.state)); }
              catch (error) { throw new Error(`[Cossack SSE] scope state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
            }
          } else if (isCloudflareRuntime()) {
            throw new Error(`${sseBindingMissingMessage()} (page: ${path})`);
          } else {
            registerSseStoreEntry(routerContext, path, scopeKey, pageInstance);
          }
        }

        // Wrap rendering
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
          if (pass === 9) throw new Error('[Cossack server$] SSR resources did not stabilize after 10 render passes.');
          await Promise.all(pending);
        }
        layoutPaths.forEach((layoutPath, index) => {
          layoutStates[layoutPath] = layoutInstances[index].getInitialState();
        });

        // Head Merging (page → layouts → app, inside-out)
        const headTags = Cossack.composeHead(pageInstance, layoutInstances, appInstance);

        const pageInitialState = pageInstance.getInitialState();

        // For durable-object transport, add the DO ID to providerTargets
        // Also add routePath to metadata for client WebSocket connections
        if (pageOptions?.transport === 'durable-object' && options.runtimeAdapter) {
          pageInitialState.providerTargets = {
            ...(pageInitialState.providerTargets || {}),
            page: scopeKey,
          };
          if (pageInitialState.metadata) pageInitialState.metadata.routePath = filePathToRoutePath(path);
        } else if (pageOptions?.transport === 'durable-object') {
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

        const kind = classifyRoute(filePathToHttpRoute(path));
        const boundary = kind === '404' || kind === 'error';
        if (boundary && pageInitialState.metadata) pageInitialState.metadata.routePath = path;
        const finalInitialState = {
          ...pageInitialState,
          routePath: boundary ? path : filePathToRoutePath(path),
          componentPath: path,
          _cossackBoundary: boundary ? { type: kind, source: path } : undefined,
          componentRouteId: routePathToIdMap.get(path),
          appRouteId: 'cossack_app', // Route ID for the App component (root)
          pathname: c.req.path,
          channels: pageOptions?.channels || ['global'],
          transport: pageOptions?.transport || 'http',
          scopeKey,
          _app_state: appInstance.getInitialState(),
          _layout_stack: layoutPaths.map((p) => ({
            path: p,
            state: layoutStates[p],
            componentRouteId: routePathToIdMap.get(p),
          })), // Keep file paths and their RPC target IDs for layouts
          // Localization: hydrate the active locale's catalog (and the default
          // fallback if different) so `__()` works on the client immediately.
          // Other locales are dynamic-imported on demand by `setLocale()`.
          __cossackLang: buildLocaleHydrationData(),
          runtime: runtimeInfo,
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
        const denial = getAuthorizationFailure(err);
        if (denial) {
          const requestId = c.res.headers.get('X-Cossack-Request-Id') ?? crypto.randomUUID();
          c.header('X-Cossack-Request-Id', requestId);
          return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
        }
        console.error('[Cossack SSR Error]:', err);
        const errorPage = findNearestSpecialPage(path, 'error');
        if (errorPage && path !== errorPage.path) {
          c.status(500);
          return renderBoundary(errorPage.component, errorPage.path, c);
        }
        // Escape the error to prevent XSS via user-controlled content in the
        // message/stack, and only expose detailed traces in development. In
        // production, stack traces leak file paths and library versions.
        const detail = err instanceof Error ? err.stack : String(err);
        const body = import.meta.env.DEV
          ? `<h1>Internal Server Error</h1><pre>${escapeHtml(detail)}</pre>`
          : '<h1>Internal Server Error</h1>';
        return c.html(body, 500);
      } finally {
        for (const instance of requestComponents.reverse()) {
          try { await instance.destroyAsync(); }
          catch (error) { console.error('[Cossack SSR] component cleanup failed:', error); }
        }
        try { await requestServiceScope.disposeAsync(); }
        catch (error) { console.error('[Cossack SSR] service cleanup failed:', error); }
      }
    };
  };

  const renderBoundary = async (component: new () => Cossack, path: string, c: Context) => {
    const middlewares = getMiddlewares(path);
    const handler = createSsrHandler(component, path, Reflect.getMetadata('page:options', component));
    // Preserve Hono's original route index and the selected parameter proxy.
    let index = -1;
    const dispatch = async (position: number): Promise<void> => {
      if (position <= index) throw new Error('next() called multiple times');
      index = position;
      const middleware = middlewares[position];
      if (!middleware) { c.res = await handler(c); return; }
      const response = await middleware(c, () => dispatch(position + 1));
      if (response) c.res = response;
    };
    await dispatch(0);
    return c.res;
  };

  // Transport routes
  if (import.meta.env.DEV) {
    app.use('/crpc', developmentRpcEvidence());
    app.use('/upload', developmentRpcEvidence());
  }
  app.use('/crpc', protectTransport(routerContext));
  app.use('/upload', protectTransport(routerContext));
  app.use('/sse/:componentRouteId', protectTransport(routerContext));
  app.use('/ws/:provider/:id', protectTransport(routerContext));
  if (options.runtimeAdapter?.handleWebSocketUpgrade) {
    app.get('/ws/:provider/:id', async (c) => {
      if (!isOriginAllowed(c.req.header('origin'), c.req.url, options.allowedOrigins)) {
        return c.text('Origin not allowed', 403);
      }
      const { provider, id: target } = c.req.param();
      const routePath = c.req.query('routePath') || c.req.query('componentPath');
      if (!routePath) return c.text('routePath or componentPath query parameter is required', 400);
      const componentPath = routePathToFilePathMap.get(routePath) || routePath;
      const componentModule = pages[componentPath] || layouts[componentPath];
      if (!componentModule) return c.text('Component not found', 404);
      const ComponentClass = getModuleDefault(componentModule as object) as new () => Cossack;
      const pageOptions = Reflect.getMetadata('page:options', ComponentClass) as PageOptions | undefined;
      try {
        assertRuntimeTransportSupport(options.runtimeAdapter, pageOptions);
      } catch (error) {
        return c.text(error instanceof Error ? error.message : String(error), 400);
      }
      // Default scopes are recomputed from the authenticated user. Custom
      // scope functions receive the same query values emitted during SSR.
      let routeParams: Record<string, string>;
      try {
        routeParams = decodeRuntimeRouteParams(c.req.query('params'));
      } catch {
        return c.text('Invalid WebSocket route params', 400);
      }
      const componentContext = withRuntimeRouteParams(c, routeParams);
      const expectedTarget = await resolveSseScopeKey(componentContext, pageOptions);
      if (target !== expectedTarget) return c.text('Invalid WebSocket scope', 403);

      const pathname = c.req.query('pathname') || '/';
      const user = c.get('user');
      const runtimeInfo = await resolveRuntimeInfo();
      return options.runtimeAdapter!.handleWebSocketUpgrade!(c, {
        target,
        provider,
        componentId: componentPath,
        pathname,
        user,
        context: componentContext,
        env: c.env as unknown as Record<string, unknown>,
        createComponent: async () => {
          const rootScope = createRootServiceScope();
          rootScope.bindRequest({ context: componentContext, user, env: c.env });
          let instance: Cossack | undefined;
          try {
            let activeScope = rootScope;
            for (const layoutPath of getLayoutStack(componentPath)) {
              const Layout = getModuleDefault(layouts[layoutPath]) as new () => Cossack;
              activeScope = createLayoutServiceScope(activeScope, Layout, {
                ownerRouteId: routePathToIdMap.get(layoutPath), ownerRoutePath: layoutPath, scopeKey: expectedTarget,
              });
              activeScope.bindRequest({ context: componentContext, user, env: c.env });
            }
            instance = createInstance(ComponentClass, { serviceScope: activeScope }) as Cossack;
            instance.__cossack_rpcOwner = componentPath;
            instance._ownServiceScopeLifetime(rootScope);
            await instance.bootstrap({ context: componentContext, user, env: c.env, runtime: runtimeInfo, page: pathname, providerName: provider, providerTargets: { page: expectedTarget, [provider]: expectedTarget } });
            instance._render();
            return instance;
          } catch (error) {
            try { await instance?.destroyAsync(); }
            finally { await rootScope.disposeAsync(); }
            throw error;
          }
        },
      });
    });
  } else {
    app.get('/ws/:provider/:id', handleWebSocketProxy(routerContext));
  }
  app.get('/sse/:componentRouteId', handleSseEndpoint(routerContext));
  // JSON and multipart differ only at decoding. Ownership, validation,
  // streaming, cookies and cleanup use the same action pipeline.
  const handleRpc: Handler = async (c) => {
    const body = await readRpcRequest(c);
    const { componentRouteId, action, state, payload, target, scopeKey: clientScopeKey } = body;
    const requestId = c.res.headers.get('X-Cossack-Request-Id') ?? crypto.randomUUID();
    if (typeof action !== 'string' || !action) return c.json({ error: 'Invalid action', code: 'COSSACK_RPC_REQUEST_INVALID', requestId }, 400);
    // Materialize prepared middleware headers before an action can return an
    // independently constructed stream Response. Hono merges an existing res,
    // but otherwise drops prepared headers when assigning that raw Response.
    c.res.headers.set('X-Cossack-Request-Id', requestId);
    const user = c.get('user');
    const runtimeInfo = await resolveRuntimeInfo();

    // Explicit layout-service RPC. The client addresses the owning layout and
    // stable service slot; no service fields or methods are projected onto a
    // component instance, so component names cannot collide with service names.
    if (body.service) {
      const ownerRouteId = body.service.ownerRouteId;
      const slot = body.service.slot;
      if (typeof ownerRouteId !== 'string' || typeof slot !== 'string') {
        return c.json({ error: 'Invalid service target' }, 400);
      }
      const ownerPath = routeIdMap.get(ownerRouteId);
      if (!ownerPath || !layouts[ownerPath]) return c.json({ error: 'Invalid service owner' }, 400);

      const requestScope = createRootServiceScope();
      requestScope.bindRequest({ context: c, user, env: c.env });
      let responseOwnsCleanup = false;
      try {
        let activeScope = requestScope;
        let ownerScope: ReturnType<typeof createLayoutServiceScope> | undefined;
        for (const layoutPath of getLayoutStack(ownerPath)) {
          const layoutModule = layouts[layoutPath];
          if (!layoutModule) return c.json({ error: 'Service layout not found' }, 404);
          const LayoutComponent = getModuleDefault(layoutModule as object) as new () => Cossack;
          const nextScope = createLayoutServiceScope(activeScope, LayoutComponent, {
            ownerRouteId: routePathToIdMap.get(layoutPath),
            ownerRoutePath: layoutPath,
            scopeKey: clientScopeKey,
          });
          nextScope.bindRequest({ context: c, user, env: c.env });
          activeScope = nextScope;
          if (layoutPath === ownerPath) ownerScope = nextScope;
        }
        if (!ownerScope) return c.json({ error: 'Service owner is not active' }, 400);
        const owned = ownerScope.getOwnedService(slot);
        if (!owned) return c.json({ error: `Unknown service slot '${slot}'` }, 404);

        const safeState = sanitizeServiceState(owned.serviceClass, state);
        ownerScope.hydrateOwnedService(slot, safeState);
        if (!isRpcCallableAction(owned.serviceClass, action)) {
          return c.json({ error: `Action '${String(action)}' is not a callable service method`, code: 'COSSACK_RPC_FORBIDDEN', requestId }, 403);
        }
        const rateLimited = await enforceMethodRateLimit(c, owned.serviceClass, action, `crpc-service:${ownerRouteId}:${slot}`);
        if (rateLimited) return rateLimited;

        let actionResult: unknown;
        try {
          const validatedServicePayload = await enforceActionInput(owned.serviceClass, action, Array.isArray(payload) ? payload : [], { signal: c.req.raw.signal });
          await enforceActionAuthorization(owned.serviceClass, action, validatedServicePayload, c, c.req.raw.signal);
          if (c.req.raw.signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
          if (import.meta.env.DEV) developmentRpcInvoked(c);
          actionResult = await owned.instance[action](...(validatedServicePayload as any[]));
          if (import.meta.env.DEV) developmentRpcReturned(c, actionResult instanceof Response ? 'native' : 'value');
        } catch (e: any) {
          const denial = getAuthorizationFailure(e);
          if (denial) return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
          if (e instanceof RpcError && e.code === 'COSSACK_RPC_CANCELLED') {
            return Response.json({ error: e.message, code: e.code, requestId }, { status: 499 });
          }
          if (isActionValidationError(e)) {
            return c.json({ error: e.message, code: 'COSSACK_VALIDATION_FAILED',
              fieldErrors: e.fieldErrors, requestId }, 400);
          }
          if (isClientVisibleError(e)) {
            return c.json({ error: e.message, code: 'COSSACK_RPC_CLIENT_ERROR', requestId }, 400);
          }
          console.error('[/crpc service] internal error:', { requestId, error: e });
          return c.json({ error: 'Internal Server Error', code: 'COSSACK_RPC_INTERNAL_ERROR', requestId }, 500);
        }
        // Generator results stream through the same response-local protocol as
        // component calls; the stream owns request-scope cleanup until it ends.
        if (isRpcStream(actionResult)) {
          if (import.meta.env.DEV) developmentRpcStream(c);
          const finishResponseLifetime = retainResponseLifetime(c);
          const response = createRpcStreamResponse({
            result: actionResult, requestId, signal: c.req.raw.signal,
            getState: () => getServiceState(owned.instance),
            cleanup: async () => {
              try { await requestScope.disposeAsync(); }
              finally { await finishResponseLifetime?.(); }
            },
          });
          responseOwnsCleanup = true;
          return response;
        }

        const redirectResponse = await rpcRedirectResponse(c, actionResult);
        if (redirectResponse) return redirectResponse;
        if (actionResult instanceof Response) {
          const finishResponseLifetime = retainResponseLifetime(c);
          responseOwnsCleanup = true;
          return await retainRpcResponseBody(actionResult, c.req.raw.signal, async () => {
            try { await requestScope.disposeAsync(); }
            finally { await finishResponseLifetime?.(); }
          });
        }
        const serviceState = getServiceState(owned.instance);
        const serialized = serializeRpcResult(actionResult, serviceState);
        return c.json({
          _cossack_service_state: serialized.state,
          ...(serialized.value !== undefined ? { _cossack_return: serialized.value } : {}),
        });
      } catch (error) {
        console.error('[/crpc service] request failed:', { requestId, error });
        const denial = getAuthorizationFailure(error);
        if (denial) return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
        return c.json({ error: error instanceof RpcError ? error.message : 'Internal Server Error',
          code: error instanceof RpcError ? error.code : 'COSSACK_RPC_INTERNAL_ERROR', requestId }, 500);
      } finally {
        // Match component RPC: await scoped-service cleanup so onDispose
        // hooks finish before the response completes.
        if (!responseOwnsCleanup) await requestScope.disposeAsync();
      }
    }

    const componentPath = routeIdMap.get(componentRouteId);
    if (!componentPath) return c.json({ error: 'Invalid component ID' }, 400);

    let ComponentClass: new (...args: any[]) => Cossack;
    if (componentPath === '/src/App') {
      ComponentClass = options.AppComponent ?? RouterFallbackApp;
    } else {
      const module = pages[componentPath] || layouts[componentPath];
      if (!module) return c.json({ error: 'Component not found' }, 404);
      ComponentClass = getModuleDefault(module as object) as new (...args: any[]) => Cossack;
      if (typeof ComponentClass !== 'function') return c.json({ error: 'Invalid component' }, 500);
    }
    // Resolve and authorize scope before constructors, rendering, or user actions.
    const targetPageOptions = Reflect.getMetadata('page:options', ComponentClass) as PageOptions | undefined;
    let effectiveScopeKey = await resolveSseScopeKey(c, undefined);
    let componentContext: Context = c;
    if (targetPageOptions?.transport === 'sse') {
      let params: Record<string, string>;
      try {
        params = decodeRuntimeRouteParams(body.pageParams === undefined ? undefined : JSON.stringify(body.pageParams));
      } catch {
        return c.json({ error: 'Invalid route params' }, 400);
      }
      componentContext = withRuntimeRouteParams(c, params);
      effectiveScopeKey = await resolveSseScopeKey(componentContext, targetPageOptions);
      if (clientScopeKey !== effectiveScopeKey) return c.json({ error: 'Invalid SSE scope' }, 403);
    }

    // Cloudflare's distributed backend serializes scope actions inside the
    // coordinator Durable Object and hydrates them from the authoritative
    // snapshot instead of the browser's state. Node and Deno keep executing
    // against the process-local store.
    const sseStub = targetPageOptions?.transport === 'sse'
      ? getSseScopeStub(c.env, componentRouteId, effectiveScopeKey) : undefined;
    if (targetPageOptions?.transport === 'sse' && !sseStub && isCloudflareRuntime()) {
      return sseBindingMissingResponse();
    }

    const actionCancellation = sseStub ? new AbortController() : undefined;
    if (actionCancellation) componentContext = withRpcSignal(componentContext, actionCancellation.signal);

    const requestScope = createRootServiceScope();
    requestScope.bindRequest({ context: componentContext, user, env: c.env });
    let componentInstance: Cossack | undefined;
    let responseOwnsCleanup = false;
    let finishResponseLifetime: (() => Promise<void>) | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => cleanupPromise ??= (async () => {
      try { await componentInstance?.destroyAsync(); }
      finally {
        try { await requestScope.disposeAsync(); }
        finally { await finishResponseLifetime?.(); }
      }
    })();

    // Apply received state to a component instance. First restrict to the
    // component's own @State keys (sanitizeClientState) to block overwrites of
    // internal/security-sensitive props. Then also apply keys in the instance's
    // actual public state — covers @State from injected @Service dependencies
    // (synced into the container) which must round-trip or per-action service
    // state would reset on every call.
    const applyReceivedState = (instance: any, source: Record<string, unknown> | undefined) => {
      const safeState = sanitizeClientState(instance.constructor, source);
      for (const key in safeState) {
        instance[key] = safeState[key];
      }
      const publicStateKeys = new Set(Object.keys(instance.getPublicState()));
      if (source && typeof source === 'object') {
        for (const key of Object.keys(source)) {
          if (key in safeState) continue;
          if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
          if (publicStateKeys.has(key)) instance[key] = (source as Record<string, unknown>)[key];
        }
      }
    };

    const runComponentAction = async (
      authoritativeState: Record<string, unknown> | undefined,
    ): Promise<Response> => {
      try {
        if (componentContext.req.raw.signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
        let activeScope = requestScope;
        for (const layoutPath of getLayoutStack(componentPath)) {
          const LayoutClass = getModuleDefault(layouts[layoutPath] as object) as new () => Cossack;
          activeScope = createLayoutServiceScope(activeScope, LayoutClass, {
            ownerRouteId: routePathToIdMap.get(layoutPath), ownerRoutePath: layoutPath, scopeKey: effectiveScopeKey,
          });
          activeScope.bindRequest({ context: componentContext, user, env: c.env });
        }
        componentInstance = createInstance(ComponentClass, { serviceScope: activeScope });
        componentInstance.__cossack_rpcOwner = componentPath;
        const coordinatorRuntime = sseStub ? attachCoordinatorRuntime(componentInstance, sseStub) : undefined;
        await componentInstance.bootstrap({ context: componentContext, user, env: c.env, runtime: runtimeInfo, skipInit: true });
        if (authoritativeState !== undefined) applyReceivedState(componentInstance, authoritativeState);
        else if (!target || target === componentInstance._id) applyReceivedState(componentInstance, state);
        componentInstance.__renderRpcTarget();
        let targetInstance: any = componentInstance;
        if (target && target !== targetInstance._id) {
          if (targetInstance.activeComponents.has(target)) targetInstance = targetInstance.activeComponents.get(target);
          else return c.json({ error: `Target component '${target}' not found`, code: 'COSSACK_RPC_NOT_FOUND', requestId }, 404);
        }

        // On the coordinator path the authoritative scope snapshot replaces the
        // browser snapshot, so a stale tab cannot overwrite shared state. Child
        // targets still receive the client state because the scope tracks the
        // page's public state, not child-local state. Hydrate the page before
        // rendering so conditional children match the authoritative snapshot.
        if (authoritativeState !== undefined) {
          if (targetInstance !== componentInstance) applyReceivedState(targetInstance, state);
        } else {
          applyReceivedState(targetInstance, state);
        }

        // Authorisation gate: only @Server-registered methods are RPC-callable.
        // Prevents crafted requests from invoking framework-internal methods
        // (bootstrap, getMethod, setProperty, getPublicState, destroy, ...).
        // Includes @Server methods on injected @Service dependencies (forwarded
        // onto the component instance but registered on the service class).
        if (!isRpcCallableActionOrService(targetInstance, action)) {
          return c.json({ error: `Action '${action}' is not a callable server method`, code: 'COSSACK_RPC_FORBIDDEN', requestId }, 403);
        }

        // Rate-limit gate: enforce any @RateLimit declared on the action.
        // If this is a forwarded @Service method, the metadata lives on the service class.
        const rateLimitConstructor = isRpcCallableAction(targetInstance.constructor, action)
          ? targetInstance.constructor
          : getForwardedServerMethodClass(targetInstance, action);

        const rateLimited = await enforceMethodRateLimit(componentContext, rateLimitConstructor, action,
          JSON.stringify(['crpc', componentPath, (rateLimitConstructor as typeof Cossack).name]));
        if (rateLimited) return rateLimited;

        if (typeof targetInstance[action] !== 'function') return c.json({ error: `Action '${action}' not found` }, 404);

        // RT-02: enforce @Server({ input }) before the method runs. Coerced
        // values replace the raw payload; failures return stable field errors.
        let validatedPayload: unknown[] = payload as any[];
        try {
          validatedPayload = await enforceActionInput(
            getForwardedServerMethodClass(targetInstance, action) ?? targetInstance.constructor, action, payload || [],
            { signal: componentContext.req.raw.signal });
          await enforceActionAuthorization(getForwardedServerMethodClass(targetInstance, action) ?? targetInstance.constructor,
            action, validatedPayload, componentContext, componentContext.req.raw.signal);
        } catch (validation) {
          const denial = getAuthorizationFailure(validation);
          if (denial) return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
          if (validation instanceof RpcError && validation.code === 'COSSACK_RPC_CANCELLED') {
            return Response.json({ error: validation.message, code: validation.code, requestId }, { status: 499 });
          }
          if (isActionValidationError(validation)) {
            return c.json({ error: validation.message, code: 'COSSACK_VALIDATION_FAILED',
              fieldErrors: validation.fieldErrors, requestId }, 400);
          }
          throw validation;
        }

        if (componentContext.req.raw.signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');

        // Await promises before inspecting the result. Awaiting an async generator
        // does not pull it; its response owns iteration and request-context lifetime.
        let actionResult: unknown;
        try {
          if (import.meta.env.DEV) developmentRpcInvoked(c);
          actionResult = await targetInstance[action](...(validatedPayload as any[]));
          if (import.meta.env.DEV) developmentRpcReturned(c, actionResult instanceof Response ? 'native' : 'value');
        } catch (e: any) {
          const denial = getAuthorizationFailure(e);
          if (denial) return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
          if (isActionValidationError(e)) {
            return c.json({ error: e.message, code: 'COSSACK_VALIDATION_FAILED',
              fieldErrors: e.fieldErrors, requestId }, 400);
          }
          if (isClientVisibleError(e)) {
            return c.json({ error: e.message, code: 'COSSACK_RPC_CLIENT_ERROR', requestId }, 400);
          }
          console.error('[/crpc] internal error:', { requestId, error: e });
          return c.json({ error: 'Internal Server Error', code: 'COSSACK_RPC_INTERNAL_ERROR', requestId }, 500);
        }
        if (componentContext.req.raw.signal.aborted) {
          if (actionResult instanceof Response) void actionResult.body?.cancel().catch(() => {});
          throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
        }
        if (isRpcStream(actionResult)) {
          if (import.meta.env.DEV) developmentRpcStream(c);
          finishResponseLifetime = retainResponseLifetime(c);
          let localSseCursor: number | undefined;
          const response = createRpcStreamResponse({
            result: actionResult, requestId, signal: componentContext.req.raw.signal,
            getState: () => targetInstance.getPublicState(),
            getScopeState: sseStub && targetInstance !== componentInstance
              ? () => componentInstance!.getPublicState() : undefined,
            getStateCursor: !sseStub && targetPageOptions?.transport === 'sse' && targetInstance === componentInstance
              ? () => localSseCursor : undefined,
            // The coordinator publishes every frame's state itself; only the
            // process-local backend needs the store sync.
            onState: coordinatorRuntime
              ? () => coordinatorRuntime.flush()
              : targetPageOptions?.transport === 'sse'
                ? () => { localSseCursor = syncSseState(`${componentRouteId}:${effectiveScopeKey}`, componentInstance!.getPublicState(), requestId); } : undefined,
            cleanup,
          });
          responseOwnsCleanup = true;
          return response;
        }

        // Ordinary results publish the final scope state once. Through the
        // coordinator this is an explicit publish (the DO passes non-stream
        // responses through without inspecting them); locally it bumps the
        // store's version counter for the polling endpoint.
        const publishScopeState = async () => {
          await coordinatorRuntime?.flush();
          if (sseStub) {
            const snapshot = await sseStub.publish(JSON.stringify(componentInstance!.getPublicState()), requestId);
            if (targetInstance === componentInstance) c.header('X-Cossack-SSE-Cursor', String(snapshot.cursor));
            return;
          }
          if (targetPageOptions?.transport === 'sse') {
            const cursor = syncSseState(`${componentRouteId}:${effectiveScopeKey}`, componentInstance!.getPublicState(), requestId);
            if (targetInstance === componentInstance && cursor !== undefined) c.header('X-Cossack-SSE-Cursor', String(cursor));
          }
          return Promise.resolve();
        };
        const redirectResponse = await rpcRedirectResponse(c, actionResult);
        if (redirectResponse) {
          await publishScopeState();
          return redirectResponse;
        }
        if (actionResult instanceof Response) {
          await publishScopeState();
          finishResponseLifetime = retainResponseLifetime(c);
          responseOwnsCleanup = true;
          return await retainRpcResponseBody(actionResult, componentContext.req.raw.signal, cleanup);
        }

        // Get the state of the component that was actually modified
        const responseData = targetInstance.getPublicState();
        const serialized = serializeRpcResult(actionResult, responseData);
        await publishScopeState();

        // Non-streaming path: regular method return
        if (serialized.value !== undefined) {
          (serialized.state as any)._cossack_return = serialized.value;
        }

        return c.json(serialized.state as Record<string, unknown>);
      } catch (error) {
        // Unexpected framework failures (construction, DI, serialization) still
        // produce one JSON RPC error on both backends.
        console.error('[/crpc] request failed:', { requestId, error });
        const denial = getAuthorizationFailure(error);
        if (denial) return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
        return c.json({ error: error instanceof RpcError ? error.message : 'Internal Server Error',
          code: error instanceof RpcError ? error.code : 'COSSACK_RPC_INTERNAL_ERROR', requestId }, 500);
      } finally {
        if (!responseOwnsCleanup) await cleanup();
      }
    };

    if (sseStub) {
      // A private operation ID is distinct from caller-controlled correlation.
      const operationId = crypto.randomUUID();
      const inRequest = AsyncLocalStorage.snapshot();
      const signal = c.req.raw.signal;
      let cancelSent = false;
      let bodyOwnsCancellation = false;
      let stopBody: (() => void) | undefined;
      const cancel = () => {
        actionCancellation!.abort();
        if (cancelSent) { stopBody?.(); return; }
        cancelSent = true;
        const pending = sseStub.cancel(operationId).catch(error => {
          console.error('[/crpc sse coordinator] cancellation failed:', { requestId, error });
        });
        // Incoming disconnect cleanup must survive the cancelled invocation.
        try { c.executionCtx.waitUntil(pending); } catch { /* process-local test adapter */ }
        void pending;
        stopBody?.();
      };
      try {
        if (signal.aborted) return Response.json({ error: 'RPC call was cancelled.', code: 'COSSACK_RPC_CANCELLED', requestId }, { status: 499 });
        const responsePromise = sseStub.execute(
          snapshot => inRequest(async () => runWithContext(componentContext,
            () => runComponentAction(JSON.parse(snapshot)))),
          operationId, async () => { actionCancellation!.abort(); },
        );
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        const response = await responsePromise;
        if (signal.aborted) {
          cancel();
          void response.body?.cancel().catch(() => {});
          return Response.json({ error: 'RPC call was cancelled.', code: 'COSSACK_RPC_CANCELLED', requestId }, { status: 499 });
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        let closed = false;
        let output!: ReadableStreamDefaultController<Uint8Array>;
        const finishBody = () => {
          if (closed) return;
          closed = true;
          signal.removeEventListener('abort', cancel);
          reader.releaseLock();
        };
        stopBody = () => {
          if (closed) return;
          void reader.cancel().catch(() => {});
          finishBody();
          try { output.close(); } catch { /* consumer already cancelled */ }
        };
        const ownedBody = new ReadableStream<Uint8Array>({
          start: controller => { output = controller; },
          pull: async controller => {
            if (closed) return;
            try {
              const next = await reader.read();
              if (closed) return;
              if (next.done) { finishBody(); controller.close(); }
              else controller.enqueue(next.value);
            } catch (error) {
              if (closed) return;
              finishBody(); controller.error(error);
            }
          },
          cancel,
        }, { highWaterMark: 0 });
        bodyOwnsCancellation = true;
        if (signal.aborted) cancel();
        return new Response(ownedBody, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        await cleanup();
        console.error('[/crpc sse coordinator] action failed:', { requestId, error });
        return c.json({ error: 'Internal Server Error', code: 'COSSACK_RPC_INTERNAL_ERROR', requestId }, 500);
      } finally {
        if (!bodyOwnsCancellation) signal.removeEventListener('abort', cancel);
        if (!responseOwnsCleanup) await cleanup();
      }
    }
    return runComponentAction(undefined);
  };
  app.post('/crpc', handleRpc);
  app.post('/upload', handleRpc);

  // Register all routes.
  //
  // Sort by route specificity (literal > param > catch-all) before registering
  // so that a static sibling like `/dashboard/users/new` is registered before
  // `/dashboard/users/:id`. Hono's RegExpRouter otherwise lets an
  // earlier-registered param route shadow a later static sibling at the same
  // path position — and `import.meta.glob` yields keys in lexicographic order,
  // where `[id]` sorts before `new`, which broke `/dashboard/users/new`
  // (matched `:id = 'new'`). See `compareHttpRoutes` for the comparator.
  const pagePaths = resolvePageRouteFiles(Object.keys(pages)).sort((a, b) =>
    compareHttpRoutes(filePathToHttpRoute(a), filePathToHttpRoute(b)),
  );
  for (const path of pagePaths) {
    let httpRoute = filePathToHttpRoute(path);

    if (httpRoute.endsWith('/404') || httpRoute.endsWith('/error')) continue;

    const module = pages[path] as any;
    const mainExport = getModuleDefault(module);

    // 1. Check if it's a Cossack Component
    if (mainExport && typeof mainExport === 'function' && mainExport.prototype instanceof Cossack) {
      const PageComponent = mainExport as new () => Cossack;
      const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);
      const combinedMiddlewares = getMiddlewares(path);

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
        !getAuthoredRouteMember(PageComponent, 'render');

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
    else if (classifyRoute(httpRoute) === 'api') {
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
    const selected = resolveNotFound(c.req.path);
    if (selected) {
      const component = getModuleDefault(pages[selected.path] as object) as new () => Cossack;
      const context = withRuntimeRouteParams(c, selected.params);
      c.status(404);
      return runWithContext(context, () => renderBoundary(component, selected.path, context));
    }
    return c.text('404 Not Found', 404);
  });

  return app;
}
