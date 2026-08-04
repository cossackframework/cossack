import {
  Cossack,
  createInstance,
  createLayoutServiceScope,
  createRootServiceScope,
  enableClientNavigation,
  LifecyclePhase,
  supportsViewTransitions,
  supportsViewTransitionTypes,
  type NavigateOptions,
} from '@cossackframework/core';
import {
    setSupportedLocales,
    setDefaultLocale,
    setLocaleLoader,
    registerLocale,
    __hydrateLocale,
    getDefaultLocale,
} from '@cossackframework/core';
import { CossackElement } from '@cossackframework/renderer';
import { filePathToRoutePath, resolvePageRouteFiles } from '../route-ids.js';
import registry from 'virtual:cossack-pages';
import { supportedLocales, defaultLocale, loadCatalog } from 'virtual:cossack-lang';
// Side-effect: registers `__`, `setLocale`, `getLocale`, `isLocale` as globals.
import '../i18n-globals.js';
// NOTE: `config`/`env`/`binding` globals are intentionally NOT registered on
// the client. They read the request-scoped AsyncLocalStorage (node:async_hooks),
// which doesn't exist in the browser, and no client code calls them. They are
// installed server-side only (see src/index.ts and src/router.ts).

const { pages, layouts, loadings } = registry;

// Create mapping from route paths to file paths for component loading
const routeToFilePath = new Map<string, string>();
for (const filePath of resolvePageRouteFiles(Object.keys(pages))) {
    const routePath = filePathToRoutePath(filePath);
    routeToFilePath.set(routePath, filePath);
}

// Components resolve by direct class reference (component(Card, ...) captures
// the constructor), so no name-registry population is needed. The `components`
// glob was removed from the vite plugin to allow tree-shaking.

declare global {
  interface Window {
    __INITIAL_STATE__: any;
  }
}

export interface CreateClientAppOptions {
  container: HTMLElement | string;
  AppComponent: new (...args: any[]) => any;
  /**
   * Enable browser View Transitions API for SPA navigations.
   * When true AND the browser supports `document.startViewTransition`,
   * the DOM commit phase of each navigation is wrapped in a view transition.
   * Default: false (zero behavior change for existing apps).
   */
  viewTransitions?: boolean;
  /**
   * Show a top-of-page progress bar during SPA navigations.
   * Default: false.
   */
  progressBar?: boolean;
}

/**
 * In-memory cache of prefetched/visited pages for instant SPA navigation.
 *
 * Bounded (LRU): when the limit is reached the oldest entry is evicted on
 * insert, so a long session traversing many dynamic routes (e.g. /items/[id])
 * cannot grow the cache without bound.
 *
 * Invalidated wholesale after any successful RPC action, so navigating back to
 * a page whose state was mutated server-side never serves stale content.
 */
const PAGE_CACHE_MAX = 20;
type CachedPage = { html: string; state: any };
const pageCache = new Map<string, CachedPage>();
let pageCacheEpoch = 0;

/**
 * Cache route documents by the URL portion that affects the server response.
 * Links can reach us as relative paths, absolute same-origin URLs, or URLs
 * with fragments; treating those as different keys defeats revisit caching.
 */
function pageCacheKey(url: string): string {
  const parsed = new URL(url, window.location.href);
  return parsed.pathname + parsed.search;
}

function invalidatePageCache() {
  pageCache.clear();
  inFlightPages.clear();
  pageCacheEpoch++;
}

// Allow the RPC layer (core method-proxy) to invalidate every cached route
// document after a successful action, without a hard import cycle
// (core → framework).
if (typeof globalThis !== 'undefined') {
  (globalThis as { __cossack_invalidatePageCache?: () => void }).__cossack_invalidatePageCache =
    invalidatePageCache;
}

// Progress bar element. Only created when the `progressBar` option is enabled
// in createClientApp(). setProgress() is a no-op when this is null, so
// navigate() can call it unconditionally.
let progressBar: HTMLDivElement | null = null;

function setProgress(percent: number) {
  const bar = progressBar;
  if (!bar) return;
  bar.style.opacity = percent > 0 && percent < 100 ? '1' : bar.style.opacity;
  bar.style.width = percent + '%';
  if (percent >= 100) {
    setTimeout(() => {
      bar.style.opacity = '0';
      setTimeout(() => { bar.style.width = '0%'; }, 400);
    }, 200);
  }
}

function parseStateFromHTML(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const scripts = doc.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent?.includes('window.__INITIAL_STATE__ =')) {
      const content = script.textContent;
      const jsonStart = content.indexOf('{');
      if (jsonStart > -1) {
        try {
          return {
            state: JSON.parse(content.substring(jsonStart)),
            title: doc.title,
            modulePreloads: Array.from(
              doc.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][href]')
            ).map((link) => link.href),
          };
        } catch (e) {
          console.error('Failed to parse state JSON', e);
        }
      }
    }
  }
  return null;
}

/**
 * A document fetched on hover is inert, so its modulepreload hints would
 * otherwise be ignored. Mirror them into the live document to download and
 * parse the destination's route chunks before the click without evaluating
 * the page module or applying destination styles early.
 */
function preloadPageModules(urls: readonly string[]): void {
  for (const url of urls) {
    const href = new URL(url, window.location.href).href;
    const alreadyPreloaded = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][href]')
    ).some((link) => link.href === href);
    if (alreadyPreloaded) continue;

    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = href;
    link.dataset.cossackPrefetch = '';
    document.head.appendChild(link);
  }
}

/**
 * In-flight fetch deduplication. A hover prefetch and the subsequent click
 * navigation can both call fetchPage(url) before the first resolves, issuing
 * two identical network requests. Track the live promise per URL and reuse it
 * so only one request is in flight at a time.
 */
const inFlightPages = new Map<string, Promise<CachedPage>>();

async function fetchPage(url: string) {
  const key = pageCacheKey(url);
  const cached = pageCache.get(key);
  if (cached) {
    // Refresh insertion order so eviction is genuinely least-recently-used.
    pageCache.delete(key);
    pageCache.set(key, cached);
    return cached;
  }
  const existing = inFlightPages.get(key);
  if (existing) {
    return existing;
  }

  const requestEpoch = pageCacheEpoch;
  const promise = (async () => {
    const response = await fetch(key);
    if (!response.ok) {
      throw new Error(`Failed to load page: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    const parsed = parseStateFromHTML(html);

    if (parsed) {
      const data = { html, state: parsed.state };
      preloadPageModules(parsed.modulePreloads);
      // An RPC may have invalidated the cache while this prefetch was in
      // flight. Return its result to the original caller, but never let that
      // stale document repopulate the post-mutation cache.
      if (requestEpoch !== pageCacheEpoch) return data;
      pageCache.set(key, data);
      // LRU eviction: drop the oldest entry once over capacity. Map iterates in
      // insertion order, so the first key is the least-recently-inserted.
      if (pageCache.size > PAGE_CACHE_MAX) {
        const oldest = pageCache.keys().next().value;
        if (oldest !== undefined) pageCache.delete(oldest);
      }
      return data;
    }

    throw new Error('Failed to load page state');
  })();

  inFlightPages.set(key, promise);
  // Always clear the in-flight entry so a failed fetch can be retried later.
  void promise.then(
    () => {
      if (inFlightPages.get(key) === promise) inFlightPages.delete(key);
    },
    () => {
      if (inFlightPages.get(key) === promise) inFlightPages.delete(key);
    },
  );
  return promise;
}

export async function createClientApp({ container, AppComponent, viewTransitions: viewTransitionsEnabled = false, progressBar: progressBarEnabled = false }: CreateClientAppOptions) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector(container)
      : container;

  if (!containerEl) {
    console.error('Could not find root container');
    return;
  }

  // The SSR route is already available without a fetch. Seed it so navigating
  // away and back honours the documented zero-network revisit behaviour.
  pageCache.set(pageCacheKey(window.location.href), {
    html: document.documentElement.outerHTML,
    state: window.__INITIAL_STATE__,
  });

  // Hydrate localization runtime from the build-time manifest and the
  // server-provided initial state. The active + default catalogs ship inline
  // so `__()` works on first paint; the rest are dynamic-imported on demand
  // by `setLocale()` (one chunk per locale).
  setSupportedLocales(supportedLocales);
  setLocaleLoader(async (locale) => (await loadCatalog(locale)) || {});

  const langState = (window as any).__INITIAL_STATE__?.__cossackLang;
  if (langState && typeof langState === 'object') {
    // Prefer the SSR-provided default (which accounts for runtime resolution
    // like env.APP_LOCALE and supported-locale fallback). Fall back to the
    // first supported locale, then the build-time default.
    const effectiveDefault =
      langState.defaultLocale ||
      supportedLocales[0] ||
      defaultLocale ||
      getDefaultLocale();
    setDefaultLocale(effectiveDefault);
    if (langState.defaultMessages && langState.defaultLocale) {
      registerLocale(langState.defaultLocale, langState.defaultMessages);
    }
    __hydrateLocale(langState.locale, langState.messages);
  } else {
    // No SSR state (e.g. client-only fallback): derive an effective default
    // that is guaranteed to have a catalog, then load it.
    const effectiveDefault =
      supportedLocales.includes(defaultLocale)
        ? defaultLocale
        : supportedLocales[0] || defaultLocale || getDefaultLocale();
    setDefaultLocale(effectiveDefault);
    if (supportedLocales.length > 0) {
      const msgs = await loadCatalog(effectiveDefault);
      if (msgs) __hydrateLocale(effectiveDefault, msgs);
    }
  }

  // Update <html lang> when the locale changes at runtime.
  window.addEventListener('localechange', ((e: CustomEvent) => {
    if (e.detail?.locale) document.documentElement.lang = e.detail.locale;
  }) as EventListener);

  // Create the progress bar once when enabled.
  if (progressBarEnabled && !progressBar) {
    const style = document.createElement('style');
    style.textContent = `
      #cossack-progress {
        position: fixed; top: 0; left: 0; width: 0%; height: 2px;
        background: #3b82f6; z-index: 9999;
        transition: width 0.3s ease, opacity 0.4s ease;
        pointer-events: none; opacity: 0;
      }
    `;
    document.head.appendChild(style);
    progressBar = document.createElement('div');
    progressBar.id = 'cossack-progress';
    document.body.appendChild(progressBar);
  }

  // Inject reduced-motion guard once. When view transitions are enabled,
  // disable all transition animations under prefers-reduced-motion: reduce.
  // Users who want partial motion can override in their own CSS.
  if (viewTransitionsEnabled) {
    const reducedMotionStyle = document.createElement('style');
    reducedMotionStyle.id = 'cossack-view-transitions-reduced-motion';
    if (!document.getElementById(reducedMotionStyle.id)) {
      reducedMotionStyle.textContent = `
        @media (prefers-reduced-motion: reduce) {
          ::view-transition-old(*),
          ::view-transition-new(*),
          ::view-transition-group(*) {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
          }
        }
      `;
      document.head.appendChild(reducedMotionStyle);
    }
  }

  const clientServiceRoot = createRootServiceScope();
  const appInstance = createInstance(AppComponent, { serviceScope: clientServiceRoot });
  
  let currentPage: Cossack | null = null;
  let currentLayoutInstances: Cossack[] = [];
  let isDisplayingLoadingState = false;

  const composeContent = () => {
    if (!currentPage) return null;
    let body = (currentPage as any)._getWrappedTemplate();
    for (let i = currentLayoutInstances.length - 1; i >= 0; i--) {
       const layout = currentLayoutInstances[i];
       layout.children = body;
       body = (layout as any)._getWrappedTemplate();
    }
    return body;
  }

  const triggerAppUpdate = async () => {
      appInstance.children = composeContent();
      // A service/layout update may already be rendering the App when a
      // navigation commits. Joining that in-flight request after replacing
      // `children` is racy: the active render may already have captured the
      // previous tree, yet callers would treat its completion as if the new
      // page had been committed. Wait for it to finish, then always schedule
      // a fresh App pass for the latest composition.
      await appInstance.updateComplete;
      await appInstance.requestUpdate();
      syncHead();
  };

  let _lastHeadTagsJson: string | undefined;

  const syncHead = () => {
    if (!currentPage) return;
    const headTags = Cossack.composeHead(currentPage, currentLayoutInstances, appInstance);

    const serialized = JSON.stringify(headTags);
    if (serialized === _lastHeadTagsJson) return;
    _lastHeadTagsJson = serialized;
    Cossack.applyHeadTags(headTags);
  };

  appInstance.updateHead = syncHead;

  // Initial bootstrap without render logic override
  await appInstance.bootstrap({
    container: containerEl as Element,
    initialState: window.__INITIAL_STATE__._app_state,
    skipInit: true,
    deferMount: true,
  });

  const currentLayoutsMap = new Map<string, Cossack>();

  const notifyNavigationComplete = (pathname: string) => {
    appInstance._frameworkNavigateComplete(pathname);
    for (const layout of currentLayoutInstances) {
      layout._frameworkNavigateComplete(pathname);
    }
    currentPage?._frameworkNavigateComplete(pathname);
  };

  const loadComponent = async (initialState: any) => {
    // Support both routePath (new) and componentPath (legacy) for backward compatibility
    const routePath = initialState?.routePath || initialState?.componentPath;
    const layoutStack = initialState?._layout_stack || [];
    const pathname = initialState?.pathname || window.location.pathname;

    if (!routePath) {
      console.error('Could not find routePath or componentPath in initial state');
      return;
    }

    // Convert route path to file path for module lookup
    const componentPath = routeToFilePath.get(routePath) || routePath;

    appInstance.updatePath(pathname);

    // Build a set of active layout file paths (layoutStack now contains file paths)
    const activeLayoutPaths = new Set<string>();
    for (const l of layoutStack) {
        // Layout paths are already file paths (from server)
        activeLayoutPaths.add(l.path);
    }

    const staleLayoutInstances: Cossack[] = [];
    for (const [path, instance] of currentLayoutsMap.entries()) {
        if (!activeLayoutPaths.has(path)) {
            // Keep the scope alive until the new App render has removed the
            // old page's renderer-created descendants. Those children can
            // have a queued final update and still need their injected service
            // while the DOM reconciliation tears them down.
            staleLayoutInstances.push(instance);
            currentLayoutsMap.delete(path);
        }
    }

    try {
      currentLayoutInstances = [];
      let activeServiceScope = clientServiceRoot;
      for (const { path: layoutFilePath, state, componentRouteId } of layoutStack) {
        // Layout paths are already file paths (from server). Layouts are lazy
        // on the client (code-split per route, like pages), so the registry
        // holds loader functions — await to get the module. This keeps a layout
        // with heavy deps (e.g. dashboard sidebar pulling @cossackframework/ui)
        // off routes that don't use it.
        let instance = currentLayoutsMap.get(layoutFilePath);
        if (!instance) {
          const layoutEntry = layouts[layoutFilePath];
          if (!layoutEntry) {
            console.warn(`[Cossack] Layout module not found for path: ${layoutFilePath}`);
            continue;
          }
          // On the client, layouts are lazy: the registry holds loader functions
          // (see vite-plugin.ts). Await to resolve the module.
          const layoutModule = typeof layoutEntry === 'function'
            ? await (layoutEntry as () => Promise<any>)()
            : layoutEntry;
          const LComp = Object.values(layoutModule)[0] as new () => Cossack;
          const layoutServiceScope = createLayoutServiceScope(activeServiceScope, LComp, {
            ownerRouteId: componentRouteId,
            ownerRoutePath: layoutFilePath,
            initialState: state?.services,
            scopeKey: initialState?.scopeKey,
          });
          instance = createInstance(LComp, { serviceScope: layoutServiceScope, ownsServiceScope: true });
          instance.updateHead = syncHead;

          // Hook reactivity
          const originalRequestUpdate = instance.requestUpdate.bind(instance);
          instance.requestUpdate = async (name?: string, oldValue?: unknown) => {
                const p = originalRequestUpdate(name, oldValue);
                await p;
                await triggerAppUpdate();
                return true;
          };

          await instance.bootstrap({
            initialState: { ...state, componentRouteId },
            skipInit: true,
          });
          currentLayoutsMap.set(layoutFilePath, instance);
        }
        instance.updatePath(pathname);
        currentLayoutInstances.push(instance);
        activeServiceScope = instance._getServiceScope() || activeServiceScope;
      }

      // Dynamic import for page module (code splitting)
      const pageModuleLoader = pages[componentPath];
      if (!pageModuleLoader) {
        console.error(`Component module loader not found for path: ${componentPath}`);
        return;
      }

      // Load the page module asynchronously (cast to function type since import.meta.glob returns a loader for lazy builds)
      const loader = pageModuleLoader as () => Promise<any>;
      const module = await loader();
      if (!module) {
        console.error(`Failed to load module for path: ${componentPath}`);
        return;
      }

      const PageComponent = Object.values(module)[0] as new () => Cossack;

      if (PageComponent) {
        if (currentPage) {
          currentPage.destroy();
        }
        const componentInstance = createInstance(PageComponent, { serviceScope: activeServiceScope });
        currentPage = componentInstance;

        // Register the page with the app instance for child component state restoration
        appInstance.setCurrentPage(componentInstance);

        componentInstance.updateHead = syncHead;

        // Hook reactivity
        const originalRequestUpdate = componentInstance.requestUpdate.bind(componentInstance);
        componentInstance.requestUpdate = async (name?: string, oldValue?: unknown) => {
          const p = originalRequestUpdate(name, oldValue);
          await p;
          await triggerAppUpdate();
          return true;
        };

        await componentInstance.bootstrap({ initialState, skipInit: true });
        componentInstance.updatePath(pathname);

        // Register with DevTools for state inspection (use absolute path from Vite injection)
        const sourceFile = (componentInstance.constructor as any).__source?.file;
        if (import.meta.env.DEV && sourceFile) {
          const { registerDevToolsInstance } = await import('./devtools.js');
          registerDevToolsInstance(sourceFile, componentInstance);
        }

        // Perform initial composition and render
        await triggerAppUpdate();
      }
      isDisplayingLoadingState = false;
    } finally {
      // Scope disposal must happen even when module loading, bootstrap, or the
      // final App reconciliation throws. The scopes stay alive until this
      // point so outgoing renderer children can finish teardown safely.
      for (const staleLayout of staleLayoutInstances) staleLayout.destroy();
    }
  };

  await loadComponent(window.__INITIAL_STATE__);
  // Mount now that the full app tree (header + page + footer) is composed.
  // Hydrate the existing SSR DOM in place instead of wiping it — the server
  // already rendered this exact tree, so we bind to the existing nodes (no
  // flash, no duplicate component initialisation). Subsequent re-renders use
  // the normal reconcile path via the container cache.
  appInstance.mount(containerEl, true);
  appInstance.isMounted = true;
  appInstance._frameworkMount();
  notifyNavigationComplete(window.location.pathname);

  // Mark hydration complete so e2e/tests can wait for client interactivity
  // without racing the bootstrap (SSR elements are present immediately).
  (window as any).__cossackReady = true;
  document.dispatchEvent(new CustomEvent('cossack:ready', {
    bubbles: true,
    detail: { pathname: window.location.pathname, navigationType: 'initial' }
  }));

  const navigate = async (url: string, force = false, options?: NavigateOptions): Promise<boolean> => {
    if (!force && currentPage && !isDisplayingLoadingState) {
        const prevented = await currentPage._checkPreventNavigation();
        if (prevented) {
            currentPage._pendingNavigation = async () => {
                if (await navigate(url, true, options)) {
                    window.history.pushState({}, '', url);
                }
            };
            // Force re-render to show prevention UI if any
            await currentPage.requestUpdate();
            return false;
        }
    }

    try {
      document.dispatchEvent(new CustomEvent('cossack:before-navigate', {
        bubbles: true,
        detail: { fromPathname: window.location.pathname, toPathname: url, types: options?.types }
      }));

      setProgress(30);

      // Check for loading.ts convention
      const urlObj = new URL(url, window.location.href);
      const cleanPath = urlObj.pathname.replace(/\/$/, '') || '/index';
      const potentialLoadingPath = `/src/pages${cleanPath}/loading.ts`;
      const LoadingCompClass = loadings[potentialLoadingPath] ? Object.values(loadings[potentialLoadingPath])[0] as new () => Cossack : null;

      if (LoadingCompClass && !isDisplayingLoadingState) {
          isDisplayingLoadingState = true;
          const loadingScope = currentLayoutInstances.at(-1)?._getServiceScope() || clientServiceRoot;
          const loadingInstance = createInstance(LoadingCompClass, { serviceScope: loadingScope });
          // We swap current page with loading component temporarily
          if (currentPage) currentPage.destroy();
          currentPage = loadingInstance;

          // Hook reactivity for loading component too
          const originalRequestUpdate = loadingInstance.requestUpdate.bind(loadingInstance);
          loadingInstance.requestUpdate = async (name?: string, oldValue?: unknown): Promise<boolean> => {
              // Skip update if component is already destroyed
              if ((loadingInstance as any)._phase === LifecyclePhase.Destroyed) {
                  return false;
              }
              const p = originalRequestUpdate(name, oldValue);
              await p;
              await triggerAppUpdate();
              return true;
          };

          await loadingInstance.bootstrap({ skipInit: true });
          await triggerAppUpdate();
      }

      const { state } = await fetchPage(url);
      setProgress(100);

      // DOM commit: destroy old page, instantiate new page, trigger re-render.
      // When view transitions are enabled and supported, wrap this in
      // document.startViewTransition() so the browser snapshots before/after.
      // The loading.ts swap (if any) happened above, BEFORE fetchPage — its DOM
      // mutation is already committed by the time startViewTransition snapshots,
      // so the transition animates from loading.ts → real content.
      const commit = async () => {
        window.__INITIAL_STATE__ = state;
        await loadComponent(state);
        notifyNavigationComplete(state.pathname);
      };

      if (viewTransitionsEnabled && supportsViewTransitions()) {
        // Only use the object-form ({ update, types }) when the browser
        // supports VT types (Chrome 125+); otherwise fall back to the
        // single-callback form so older browsers don't throw inside the
        // transition (which would surface as a navigation failure).
        const useTypes = !!(options?.types?.length) && supportsViewTransitionTypes();
        const transition = useTypes
          ? (document as any).startViewTransition({ update: commit, types: options.types })
          : (document as any).startViewTransition(commit);
        // `ready` rejects when a newer transition supersedes this one, but the
        // DOM update still runs. Handle that animation-only rejection so it
        // never becomes an unhandled promise rejection. Navigation readiness
        // follows `updateCallbackDone`, which is the standard promise that
        // resolves after the async commit callback has actually completed.
        void transition.ready.catch(() => {});
        void transition.finished.catch(() => {});
        await transition.updateCallbackDone;
      } else {
        await commit();
      }

      (window as any).__cossackReady = true;
      document.dispatchEvent(new CustomEvent('cossack:ready', {
        bubbles: true,
        detail: { pathname: state.pathname, navigationType: 'spa', types: options?.types }
      }));
      return true;
    } catch (error) {
      console.error('Navigation failed:', error);
      // Give the app a chance to handle the failure (show an error UI, retry,
      // or fall back to a cached view) instead of forcing a full reload that
      // discards client state (form input, scroll, theme). If a listener
      // calls preventDefault, the app has handled it and we do not reload.
      const handled = document.dispatchEvent(new CustomEvent('cossack:navigation-error', {
        bubbles: true,
        cancelable: true,
        detail: { url, error, fromPathname: window.location.pathname },
      }));
      if (!handled) {
        return false;
      }
      window.location.reload();
      return false;
    }
  };

  Cossack._onNavigate = async (url, options) => {
      const accepted = await navigate(url, false, options);
      if (accepted) {
          window.history.pushState({}, '', url);
      }
  };

  enableClientNavigation(
    (url, options) => navigate(url, false, options),
    async (url) => {
      if (!pageCache.has(pageCacheKey(url))) {
        fetchPage(url).catch(() => {});
      }
    }
  );
}
