import { Cossack, enableClientNavigation, LifecyclePhase, createInstance, supportsViewTransitions, supportsViewTransitionTypes, type NavigateOptions } from '@cossackframework/core';
import {
    setSupportedLocales,
    setDefaultLocale,
    setLocaleLoader,
    registerLocale,
    __hydrateLocale,
    getDefaultLocale,
} from '@cossackframework/core';
import { App } from '../App';
import { CossackElement } from '@cossackframework/renderer';
import { registerDevToolsInstance } from './devtools';
import { filePathToRoutePath } from '../route-ids';
import registry from 'virtual:cossack-pages';
import { supportedLocales, defaultLocale, loadCatalog } from 'virtual:cossack-lang';
// Side-effect: registers `__`, `setLocale`, `getLocale`, `isLocale` as globals.
import '../i18n-globals';
// Side-effect: registers `config`, `env`, `binding` as globals (no-ops/defaults
// on the client, where there is no request scope).
import '../config-globals';

const { pages, layouts, loadings } = registry;

// Create mapping from route paths to file paths for component loading
const routeToFilePath = new Map<string, string>();
for (const filePath in pages) {
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
  AppComponent?: new (...args: any[]) => any;
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
const pageCache = new Map<string, { html: string; state: any }>();

function invalidatePageCache(url?: string) {
  if (url) pageCache.delete(url);
  else pageCache.clear();
}

// Allow the RPC layer (core method-proxy) to invalidate the current page's
// cache entry after an action mutates server state, without a hard import
// cycle (core → framework). Only the current page is dropped so unrelated
// prefetched pages stay cached.
if (typeof globalThis !== 'undefined') {
  (globalThis as { __cossack_invalidateCurrentPage?: () => void }).__cossack_invalidateCurrentPage = () => {
    try {
      if (typeof location !== 'undefined') pageCache.delete(location.href);
    } catch { /* location unavailable */ }
  };
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
            title: doc.title
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
 * In-flight fetch deduplication. A hover prefetch and the subsequent click
 * navigation can both call fetchPage(url) before the first resolves, issuing
 * two identical network requests. Track the live promise per URL and reuse it
 * so only one request is in flight at a time.
 */
const inFlightPages = new Map<string, Promise<{ html: string; state: any }>>();

async function fetchPage(url: string) {
  if (pageCache.has(url)) {
    return pageCache.get(url)!;
  }
  const existing = inFlightPages.get(url);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const response = await fetch(url);
    const html = await response.text();
    const parsed = parseStateFromHTML(html);

    if (parsed) {
      const data = { html, state: parsed.state };
      pageCache.set(url, data);
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

  inFlightPages.set(url, promise);
  // Always clear the in-flight entry so a failed fetch can be retried later.
  promise.finally(() => inFlightPages.delete(url));
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

  const appInstance = createInstance(AppComponent ?? App);
  
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

    for (const [path, instance] of currentLayoutsMap.entries()) {
        if (!activeLayoutPaths.has(path)) {
            instance.destroy();
            currentLayoutsMap.delete(path);
        }
    }

    currentLayoutInstances = [];
    for (const { path: layoutFilePath, state } of layoutStack) {
        // Layout paths are already file paths (from server)
        let instance = currentLayoutsMap.get(layoutFilePath);
        if (!instance) {
            const layoutModule = layouts[layoutFilePath];
            if (!layoutModule) {
                console.warn(`[Cossack] Layout module not found for path: ${layoutFilePath}`);
                continue;
            }
            const LComp = Object.values(layoutModule)[0] as new () => Cossack;
            instance = createInstance(LComp);
            instance.updateHead = syncHead;

            // Hook reactivity
            const originalRequestUpdate = instance.requestUpdate.bind(instance);
            instance.requestUpdate = async (name?: string, oldValue?: unknown) => {
                const p = originalRequestUpdate(name, oldValue);
                await p;
                await triggerAppUpdate();
                return true;
            };

            await instance.bootstrap({ initialState: state, skipInit: true });
            currentLayoutsMap.set(layoutFilePath, instance);
        }
        instance.updatePath(pathname);
        currentLayoutInstances.push(instance);
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
      const componentInstance = createInstance(PageComponent);
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
      if (sourceFile) {
        registerDevToolsInstance(sourceFile, componentInstance);
      }

      // Perform initial composition and render
      await triggerAppUpdate();
    }
    isDisplayingLoadingState = false;
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
  appInstance._frameworkNavigateComplete(window.location.pathname);

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
          const loadingInstance = createInstance(LoadingCompClass);
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
        appInstance._frameworkNavigateComplete(state.pathname);
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
        // transition.updateReady rejects if the transition is skipped (e.g.
        // user navigates again mid-transition). Swallow that so it doesn't
        // trigger the outer error fallback.
        await transition.updateReady?.catch(() => {});
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
      if (!pageCache.has(url)) {
        fetchPage(url).catch(() => {});
      }
    }
  );
}