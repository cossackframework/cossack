import { captureNavigationFocus } from './navigation-focus.js';
import { createNavigationTrace, emitNavigationDiagnostic, type NavigationTrace } from './navigation-diagnostics.js';
import { NavigationOwner } from './navigation-owner.js';
import { SharedPageRequests } from './shared-page-requests.js';
import { getModuleDefault } from '../module-default.js';
import {
  Cossack,
  applyNavigationScroll,
  createNavigationHistoryState,
  createInstance,
  createLayoutServiceScope,
  createRootServiceScope,
  getNavigationHistoryLocation,
  navigationHistoryStateAt,
  enableClientNavigation,
  LifecyclePhase,
  saveCurrentScrollPosition,
  supportsViewTransitions,
  supportsViewTransitionTypes,
  type NavigateOptions,
  type NavigateResult,
  type NavigationScrollBehavior,
  type NavigationHistoryLocation,
} from '@cossackframework/core';
import {
    setSupportedLocales,
    setDefaultLocale,
    setLocaleLoader,
    registerLocale,
    __hydrateLocale,
    getDefaultLocale,
} from '@cossackframework/core';
import { CossackElement, captureRenderDrafts } from '@cossackframework/renderer';
import { classifyRoute, computeRouteIds, filePathToHttpRoute, filePathToRoutePath, resolvePageRouteFiles } from '../route-ids.js';
import registry from 'virtual:cossack-pages';
import { supportedLocales, defaultLocale, loadCatalog } from 'virtual:cossack-lang';
// Side-effect: registers `__`, `setLocale`, `getLocale`, `isLocale` as globals.
import '../i18n-globals.js';
// NOTE: `config`/`env`/`binding` globals are intentionally NOT registered on
// the client. They read the request-scoped AsyncLocalStorage (node:async_hooks),
// which doesn't exist in the browser, and no client code calls them. They are
// installed server-side only (see src/index.ts and src/router.ts).

const { pages, layouts, loadings } = registry;
const { routeIdMap } = computeRouteIds(Object.keys(pages), Object.keys(layouts));

// Create mapping from route paths to file paths for component loading
const routeToFilePath = new Map<string, string>();
for (const filePath of resolvePageRouteFiles(Object.keys(pages))) {
    const kind = classifyRoute(filePathToHttpRoute(filePath));
    if (kind === '404' || kind === 'error') continue;
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
  /** SPA navigation behavior. */
  navigation?: {
    /**
     * Default scroll policy. `auto` scrolls new pages to a fragment or the
     * top and restores saved positions for browser back/forward traversal.
     * Default: auto.
     */
    scroll?: NavigationScrollBehavior;
  };
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
type CachedPage = { html: string; state: any; url: string };
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
  const entries = pageCache.size;
  pageCache.clear();
  inFlightPages.clear();
  pageCacheEpoch++;
  emitNavigationDiagnostic(null, { phase: 'invalidate', entries });
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
const inFlightPages = new SharedPageRequests<CachedPage>();

async function fetchPage(url: string, signal?: AbortSignal, trace: NavigationTrace = event => emitNavigationDiagnostic(null, event)) {
  signal?.throwIfAborted();
  const key = pageCacheKey(url);
  const cached = pageCache.get(key);
  if (cached) {
    trace({ phase: 'cache', decision: 'hit' });
    // Refresh insertion order so eviction is genuinely least-recently-used.
    pageCache.delete(key);
    pageCache.set(key, cached);
    return cached;
  }
  trace({ phase: 'cache', decision: inFlightPages.has(key) ? 'shared' : 'miss' });
  const requestEpoch = pageCacheEpoch;
  return inFlightPages.read(key, async requestSignal => {
    const response = await fetch(key, { signal: requestSignal });
    requestSignal.throwIfAborted();
    if (!response.ok && response.status !== 404 && response.status !== 500) throw new Error(`Failed to load page: ${response.status} ${response.statusText}`);
    const html = await response.text();
    requestSignal.throwIfAborted();
    const parsed = parseStateFromHTML(html);
    const boundary = parsed?.state?._cossackBoundary;
    const source = routeIdMap.get(parsed?.state?.componentRouteId);
    const expectedKind = response.status === 404 ? '404' : 'error';
    const validBoundary = Boolean(boundary && boundary.type === expectedKind && boundary.source === source &&
      source && pages[source] && classifyRoute(filePathToHttpRoute(source)) === expectedKind);
    if (!response.ok && !validBoundary) throw new Error(`Failed to load page: ${response.status} ${response.statusText}`);

    if (parsed) {
      const data = { html, state: parsed.state, url: response.url || new URL(key, window.location.href).href };
      preloadPageModules(parsed.modulePreloads);
      // An RPC may have invalidated the cache while this prefetch was in
      // flight. Return its result to the original caller, but never let that
      // stale document repopulate the post-mutation cache.
      if (!response.ok || requestEpoch !== pageCacheEpoch) return data;
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
  }, signal);
}

export async function createClientApp({
  container,
  AppComponent,
  viewTransitions: viewTransitionsEnabled = false,
  progressBar: progressBarEnabled = false,
  navigation: { scroll: defaultScrollBehavior = 'auto' } = {},
}: CreateClientAppOptions) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector(container)
      : container;

  if (!containerEl) {
    console.error('Could not find root container');
    return;
  }

  // The framework commits same-document navigations asynchronously, so own
  // restoration rather than allowing the browser to restore before the
  // destination DOM exists. Seed the initial entry for a later traversal.
  window.history.scrollRestoration = 'manual';
  let committedHistory: NavigationHistoryLocation = { group: crypto.getRandomValues(new Uint32Array(4)).join('-'), position: 0 };
  window.history.replaceState(navigationHistoryStateAt(window.history.state, committedHistory), '', window.location.href);
  saveCurrentScrollPosition();
  let scrollSaveFrame: number | undefined;
  window.addEventListener('scroll', () => {
    if (scrollSaveFrame !== undefined) return;
    scrollSaveFrame = window.requestAnimationFrame(() => {
      scrollSaveFrame = undefined;
      saveCurrentScrollPosition();
    });
  }, { passive: true });

  // The SSR route is already available without a fetch. Seed it so navigating
  // away and back honours the documented zero-network revisit behaviour.
  if (!window.__INITIAL_STATE__?._cossackBoundary) pageCache.set(pageCacheKey(window.location.href), {
    html: document.documentElement.outerHTML,
    state: window.__INITIAL_STATE__,
    url: new URL(pageCacheKey(window.location.href), window.location.href).href,
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

  let clientServiceRoot = createRootServiceScope();
  let appInstance = createInstance(AppComponent, { serviceScope: clientServiceRoot });
  const rootListeners = new WeakMap<Cossack, () => void>();
  const attachRoot = (instance: Cossack, hydrate = false) => {
    if (instance._frameworkAttachRenderRoot) {
      rootListeners.set(instance, instance._frameworkAttachRenderRoot(containerEl as HTMLElement, () => appInstance === instance, hydrate));
    } else instance.mount(containerEl as HTMLElement, hydrate);
  };
  const releaseRootScope = (scope: ReturnType<typeof createRootServiceScope>, instances: Cossack[]) => {
    // Scope facilities must outlive every component/layout cleanup, including
    // asynchronous hooks. Destruction itself still revokes tasks immediately.
    void Promise.allSettled(instances.map(instance => Promise.resolve().then(() => instance.destroyAsync?.())))
      .then(() => scope.disposeAsync()).catch(error => console.error('Navigation root cleanup failed:', error));
  };
  
  let currentPage: Cossack | null = null;
  let currentLayoutInstances: Cossack[] = [];
  let isDisplayingLoadingState = false;
  let loadingPage: Cossack | undefined;
  let currentPageFile: string | undefined;
  let currentPageUrl: string | undefined;
  let currentPageState: any;
  let committedUrl = window.location.href;
  let publication: object | undefined;
  const ownershipKey = (state: any) => JSON.stringify([
    state?.metadata?.user ?? null, state?.runtime ?? null,
    state?.transport ?? 'http', state?.scopeKey ?? null, state?.providerTargets ?? null,
  ]);
  const layoutOwnership = new WeakMap<Cossack, string>();
  const layoutOwnershipKey = (state: any, pageState: any, Component: Function) => ownershipKey({
    metadata: state?.metadata, runtime: pageState?.runtime, scopeKey: pageState?.scopeKey,
    // The layout owns its transport. Changing a child page from SSE to HTTP
    // does not revoke a retained layout's services or their in-flight calls.
    transport: state?.transport ?? Reflect.getMetadata('page:options', Component)?.transport ?? 'http',
    providerTargets: state?.providerTargets,
  });
  const rootOwnershipKey = (state: any) => layoutOwnershipKey(state?._app_state ?? { metadata: state?.metadata }, state, AppComponent);
  let rootOwnership = rootOwnershipKey(window.__INITIAL_STATE__);

  const composeContent = () => {
    if (!currentPage) return null;
    let body = ((loadingPage ?? currentPage) as any)._getWrappedTemplate();
    for (let i = currentLayoutInstances.length - 1; i >= 0; i--) {
       const layout = currentLayoutInstances[i];
       layout.children = body;
       body = (layout as any)._getWrappedTemplate();
    }
    return body;
  }

  const triggerAppUpdate = async (isCurrent: () => boolean = () => true) => {
      const expectedPublication = publication;
      const allowed = () => publication === expectedPublication && isCurrent();
      if (!allowed()) return false;
      // Core owns this render rather than joining an unrelated, potentially
      // abandoned application update. Small non-core adapters keep the fallback.
      let rendered: boolean;
      if (appInstance._frameworkRenderNavigation) {
        appInstance.children = composeContent();
        rendered = await appInstance._frameworkRenderNavigation(allowed);
      } else {
        await appInstance.updateComplete;
        if (!allowed()) return false;
        appInstance.children = composeContent();
        rendered = await appInstance.requestUpdate();
      }
      if (allowed()) syncHead();
      return rendered;
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
  const initialAppState = window.__INITIAL_STATE__._app_state ?? window.__INITIAL_STATE__;
  await appInstance.bootstrap({
    container: containerEl as Element,
    initialState: { ...initialAppState, metadata: { ...initialAppState?.metadata, url: window.location.href } },
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

  const prepareComponent = async (initialState: any, destination?: string, owner?: NavigationOwner, trace?: NavigationTrace) => {
    const isCurrent = () => !owner?.signal.aborted;
    const assertCurrent = () => owner?.assertCurrent();
    const destinationUrl = destination ?? initialState?.metadata?.url ?? window.location.href;
    initialState = { ...initialState, metadata: { ...initialState?.metadata, url: destinationUrl } };
    const routePath = initialState?.routePath || initialState?.componentPath;
    const layoutStack = initialState?._layout_stack || [];
    const pathname = initialState?.pathname || window.location.pathname;
    if (!routePath) throw new Error('Could not find routePath or componentPath in initial state');

    // Convert route path to file path for module lookup
    const identified = routeIdMap.get(initialState?.componentRouteId);
    const componentPath = identified && pages[identified] ? identified
      : initialState?.componentPath && pages[initialState.componentPath] ? initialState.componentPath
      : routeToFilePath.get(routePath) || routePath;

    // Resolve the page before changing drafts or retained resource ownership.
    const pageModuleLoader = pages[componentPath] as (() => Promise<any>) | undefined;
    if (!pageModuleLoader) throw new Error(`Component module loader not found for path: ${componentPath}`);
    const module = await pageModuleLoader();
    if (!module) throw new Error(`Failed to load module for path: ${componentPath}`);
    const PageComponent = getModuleDefault(module) as new () => Cossack;
    if (!PageComponent) throw new Error(`Failed to load page component for path: ${componentPath}`);
    const layoutComponents = new Map<string, new () => Cossack>();
    await Promise.all(layoutStack.map(async ({ path }: { path: string }) => {
      const entry = layouts[path];
      if (!entry) throw new Error(`Layout module loader not found for path: ${path}`);
      const loaded = typeof entry === 'function' ? await entry() : entry;
      const LayoutComponent = getModuleDefault(loaded) as new () => Cossack;
      if (!LayoutComponent) throw new Error(`Failed to load layout module for path: ${path}`);
      layoutComponents.set(path, LayoutComponent);
    }));
    assertCurrent();
    const staged = new Set<Cossack>();
    let finalized = false;
    let abandoned = false;
    let rollback: (() => void) | undefined;
    let retire: (() => void) | undefined;
    let rollbackDrafts: ReturnType<typeof captureRenderDrafts> | undefined;
    let destinationDrafts: ReturnType<typeof captureRenderDrafts> | undefined;
    let preparedRoot: ReturnType<typeof createRootServiceScope> | undefined;
    const dispose = () => {
      owner?.signal.removeEventListener('abort', dispose);
      if (finalized || abandoned) return;
      abandoned = true;
      destinationDrafts?.discard();
      for (const instance of staged) instance._frameworkRetireNavigationScope?.();
      if (rollback) rollback();
      else rollbackDrafts?.discard();
      for (const instance of [...staged].reverse()) {
        rootListeners.get(instance)?.();
        rootListeners.delete(instance);
        try { instance.destroy(); } catch (error) { console.error('Navigation cleanup failed:', error); }
      }
      if (preparedRoot) releaseRootScope(preparedRoot, [...staged]);
      staged.clear();
    };
    owner?.signal.addEventListener('abort', dispose, { once: true });
    const hookUpdates = (instance: Cossack) => {
      const active = () => currentPage === instance || currentLayoutInstances.includes(instance);
      instance.updateHead = () => { if (active()) syncHead(); };
      const original = instance.requestUpdate.bind(instance);
      instance.requestUpdate = async (name?: string, oldValue?: unknown) => {
        if (!active() || (instance as any)._phase === LifecyclePhase.Destroyed) return false;
        await original(name, oldValue);
        if (!active()) return false;
        await triggerAppUpdate(active);
        return true;
      };
    };
    try {
      const nextRootOwnership = rootOwnershipKey(initialState);
      let nextApp = appInstance;
      if (currentPageState && rootOwnership !== nextRootOwnership) {
        preparedRoot = createRootServiceScope();
        nextApp = createInstance(AppComponent, { serviceScope: preparedRoot });
        trace?.bindComponent?.(nextApp, 'app');
        staged.add(nextApp);
        const root = nextApp;
        root.updateHead = () => { if (appInstance === root) syncHead(); };
        const appState = initialState._app_state ?? initialState;
        await root.bootstrap({ container: containerEl as HTMLElement, initialState: { ...appState,
          metadata: { ...appState?.metadata, url: destinationUrl } }, skipInit: true, stageNavigation: true });
        assertCurrent();
      }
      if (nextApp === appInstance) trace?.bindComponent?.(nextApp, 'app');
      const nextLayouts = new Map<string, Cossack>();
      const nextRoot = preparedRoot ?? clientServiceRoot;
      let activeServiceScope = nextRoot;
      for (const { path, state, componentRouteId } of layoutStack) {
        assertCurrent();
        let instance = currentLayoutsMap.get(path);
        if (instance && (instance._getServiceScope()?.parent !== activeServiceScope ||
          layoutOwnership.get(instance) !== layoutOwnershipKey(state, initialState, instance.constructor))) instance = undefined;
        if (!instance) {
          const Layout = layoutComponents.get(path)!;
          const scope = createLayoutServiceScope(activeServiceScope, Layout, {
            ownerRouteId: componentRouteId, ownerRoutePath: path,
            initialState: state?.services, scopeKey: initialState?.scopeKey,
          });
          try { instance = createInstance(Layout, { serviceScope: scope, ownsServiceScope: true }); }
          catch (error) { await scope.disposeAsync(); throw error; }
          trace?.bindComponent?.(instance, 'layout');
          staged.add(instance);
          hookUpdates(instance);
          await instance.bootstrap({ initialState: { ...state,
            metadata: { ...state?.metadata, url: destinationUrl }, componentRouteId },
            skipInit: true, stageNavigation: true });
          assertCurrent();
          layoutOwnership.set(instance, layoutOwnershipKey(state, initialState, Layout));
        } else trace?.bindComponent?.(instance, 'layout');
        nextLayouts.set(path, instance);
        activeServiceScope = instance._getServiceScope() || activeServiceScope;
      }
      const nextPage = createInstance(PageComponent, { serviceScope: activeServiceScope });
      trace?.bindComponent?.(nextPage, 'page');
      staged.add(nextPage);
      hookUpdates(nextPage);
      await nextPage.bootstrap({ initialState, skipInit: true, stageNavigation: true });
      assertCurrent();
      nextPage.updatePath(pathname, destinationUrl);

      return {
        dispose,
        finish() {
          assertCurrent();
          finalized = true;
          owner?.signal.removeEventListener('abort', dispose);
          rollback = undefined;
          rollbackDrafts?.discard();
          retire?.();
        },
        async commit(onMutation?: (state: any) => void) {
          assertCurrent();
          const samePage = currentPage && currentPageFile === componentPath && currentPageUrl &&
            currentPage.constructor === nextPage.constructor &&
            new URL(currentPageUrl, window.location.href).pathname === new URL(destinationUrl, window.location.href).pathname &&
            currentPage._getServiceScope() === activeServiceScope && ownershipKey(currentPageState) === ownershipKey(initialState);
          const restoreFocus = samePage ? captureNavigationFocus(containerEl) : undefined;
          const draft = samePage ? currentPage?._frameworkCaptureClientDraft?.() : undefined;
          if (draft) nextPage._frameworkAdoptClientDraft(draft);
          const oldPage = currentPage;
          const oldLayouts = currentLayoutInstances;
          const oldMap = new Map(currentLayoutsMap);
          const oldFile = currentPageFile;
          const oldUrl = currentPageUrl;
          const oldState = currentPageState;
          const oldInitial = window.__INITIAL_STATE__;
          const oldPublication = publication;
          const oldApp = appInstance;
          const oldRoot = clientServiceRoot;
          const oldRootOwnership = rootOwnership;
          const token = {};
          rollbackDrafts = captureRenderDrafts(containerEl);
          destinationDrafts = captureRenderDrafts(containerEl);
          const restorers = [appInstance, ...oldLayouts, ...(oldPage ? [oldPage] : [])]
            .map(instance => instance._frameworkCaptureNavigationContext?.());
          const staleLayouts = oldLayouts.filter(layout => ![...nextLayouts.values()].includes(layout));
          trace?.({ phase: 'layouts', retained: [...nextLayouts.values()].filter(layout => oldLayouts.includes(layout)).length,
            created: [...nextLayouts.values()].filter(layout => !oldLayouts.includes(layout)).length, retired: staleLayouts.length, rootReplaced: oldApp !== nextApp });
          retire = () => {
            const errors: unknown[] = [];
            const outgoing = [...(oldPage ? [oldPage] : []), ...staleLayouts, ...(oldApp !== nextApp ? [oldApp] : [])];
            for (const instance of outgoing) instance._frameworkRetireNavigationScope?.();
            for (const instance of outgoing) {
              rootListeners.get(instance)?.();
              rootListeners.delete(instance);
              try { instance.destroy(); } catch (error) { errors.push(error); }
            }
            if (oldApp !== nextApp) releaseRootScope(oldRoot, outgoing);
            if (errors.length) throw new AggregateError(errors, '[Cossack] Outgoing navigation cleanup failed.');
          };
          rollback = () => {
            if (publication !== token) return;
            publication = oldPublication;
            appInstance = oldApp;
            clientServiceRoot = oldRoot;
            rootOwnership = oldRootOwnership;
            currentPage = oldPage;
            currentLayoutInstances = oldLayouts;
            currentLayoutsMap.clear();
            for (const [path, instance] of oldMap) currentLayoutsMap.set(path, instance);
            currentPageFile = oldFile;
            currentPageUrl = oldUrl;
            currentPageState = oldState;
            window.__INITIAL_STATE__ = oldInitial;
            for (const restore of restorers) restore?.();
            appInstance.setCurrentPage(oldPage!);
            loadingPage = undefined;
            isDisplayingLoadingState = false;
            rollbackDrafts?.restore(() => publication === oldPublication);
            void triggerAppUpdate(() => publication === oldPublication)
              .then(rendered => { if (rendered !== false && publication === oldPublication) restoreFocus?.(); })
              .catch(error => console.error('Navigation recovery render failed:', error));
          };
          publication = token;
          appInstance = nextApp;
          clientServiceRoot = nextRoot;
          rootOwnership = nextRootOwnership;
          onMutation?.(initialState);
          appInstance._frameworkHydrateNavigationResources?.(initialState._app_state ?? initialState, pathname, destinationUrl);
          appInstance.updatePath(pathname, destinationUrl);
          assertCurrent();
          for (const { path, state } of layoutStack) {
            const instance = nextLayouts.get(path)!;
            if (!staged.has(instance)) instance._frameworkHydrateNavigationResources?.(state ?? {}, pathname, destinationUrl);
            instance.updatePath(pathname, destinationUrl);
            assertCurrent();
          }
          currentLayoutsMap.clear();
          for (const [path, instance] of nextLayouts) currentLayoutsMap.set(path, instance);
          currentLayoutInstances = [...nextLayouts.values()];
          currentPage = nextPage;
          currentPageFile = componentPath;
          currentPageUrl = destinationUrl;
          currentPageState = initialState;
          appInstance.setCurrentPage(nextPage);
          loadingPage = undefined;
          isDisplayingLoadingState = false;
          assertCurrent();
          for (const instance of staged) {
            assertCurrent();
            await instance._frameworkPublishNavigation?.();
          }
          assertCurrent();
          if (oldApp !== nextApp) attachRoot(nextApp);
          destinationDrafts?.restore(() => publication === token,
            samePage && oldPage ? [[oldPage, nextPage]] : []);
          const rendered = await triggerAppUpdate(isCurrent);
          assertCurrent();
          if (rendered === false) throw Object.assign(new Error('[Cossack] App declined the navigation render.'), {
            code: 'COSSACK_NAVIGATION_RENDER_SKIPPED',
          });
          restoreFocus?.();
          const sourceFile = (nextPage.constructor as any).__source?.file;
          if (import.meta.env.DEV && sourceFile) {
            void import('./devtools.js').then(({ registerDevToolsInstance }) => {
              if (currentPage === nextPage && isCurrent()) registerDevToolsInstance(sourceFile, nextPage);
            }).catch(error => console.error('DevTools registration failed:', error));
          }
        },
      };
    } catch (error) {
      dispose();
      throw error;
    }
  };

  const initial = await prepareComponent(window.__INITIAL_STATE__, window.location.href);
  await initial.commit();
  initial.finish();
  // Mount now that the full app tree (header + page + footer) is composed.
  // Hydrate the existing SSR DOM in place instead of wiping it — the server
  // already rendered this exact tree, so we bind to the existing nodes (no
  // flash, no duplicate component initialisation). Subsequent re-renders use
  // the normal reconcile path via the container cache.
  attachRoot(appInstance, true);
  if (appInstance._frameworkAttachRenderRoot) void appInstance.requestUpdate();
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

  // Navigation sequence: a newer navigation supersedes any in-flight one;
  // its commit is skipped and its result resolves as 'superseded' (RT-09).
  let navigationSequence = 0;
  let activeOwner: NavigationOwner | undefined;
  let commitQueue: Promise<void> = Promise.resolve();
  type QueryIntent = { url: string; isCurrent: () => boolean };
  let pendingQuery: QueryIntent | undefined;
  type HistoryMove = {
    target: NavigationHistoryLocation; url: string; confirm: boolean;
    promise: Promise<NavigateResult>; finish: (result: NavigateResult) => void;
    arrived: () => void;
  };
  let historyMove: HistoryMove | undefined;
  const sameHistory = (left: NavigationHistoryLocation | undefined, right: NavigationHistoryLocation) =>
    left?.group === right.group && left.position === right.position;
  const moveHistory = (target: NavigationHistoryLocation, targetUrl: string, confirm = false): Promise<NavigateResult> => {
    const active = getNavigationHistoryLocation(window.history.state);
    const failed = () => ({ outcome: 'failed' as const, url: targetUrl,
      error: Object.assign(new Error('[Cossack] Could not restore the owned history entry.'), { code: 'COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED' }) });
    if (!active || active.group !== target.group) return Promise.resolve(failed());
    if (sameHistory(active, target) && new URL(targetUrl, window.location.href).href === window.location.href) {
      return confirm ? navigate(targetUrl, true, { navigationType: 'traverse' }) : Promise.resolve({ outcome: 'completed', url: targetUrl });
    }
    historyMove?.finish({ outcome: 'superseded', url: historyMove.url });
    let resolve!: (result: NavigateResult) => void;
    const promise = new Promise<NavigateResult>(done => { resolve = done; });
    const move: HistoryMove = { target, url: new URL(targetUrl, window.location.href).href, confirm, promise,
      arrived: () => clearTimeout(timer),
      finish: result => {
        clearTimeout(timer);
        if (historyMove === move) historyMove = undefined;
        resolve(result);
      } };
    const timer = setTimeout(() => move.finish(failed()), 2000);
    historyMove = move;
    try { window.history.go(target.position - active.position); }
    catch { move.finish(failed()); }
    return promise;
  };
  const navigate = async (url: string, force = false, options?: NavigateOptions, intent?: QueryIntent): Promise<NavigateResult> => {
    if (intent && !intent.isCurrent()) return { outcome: 'canceled', url };
    if (!intent) pendingQuery = undefined;
    const trace = createNavigationTrace();
    let outcome: NavigateResult['outcome'] = 'failed';
    const settle = (result: NavigateResult) => { outcome = result.outcome; return result; };
    const seq = ++navigationSequence;
    activeOwner?.abort();
    const owner = new NavigationOwner();
    activeOwner = owner;
    let prepared: Awaited<ReturnType<typeof prepareComponent>> | undefined;
    let ownLoading: Cossack | undefined;
    const navigationType = options?.navigationType ?? (options?.history === 'replace' ? 'replace' : 'push');
    trace({ phase: 'start', navigationType });
    const requestedHistory = getNavigationHistoryLocation(window.history.state);
    let navigationCommitted = false;
    let restorationAttempted = false;
    if (navigationType === 'traverse' && scrollSaveFrame !== undefined) {
      // popstate has already activated the destination entry. Do not let a
      // queued scroll save from the outgoing page overwrite that entry.
      window.cancelAnimationFrame(scrollSaveFrame);
      scrollSaveFrame = undefined;
    }

    try {
      if (!force && currentPage && !isDisplayingLoadingState) {
          const prevented = await owner.wait(currentPage._checkPreventNavigation());
          if (seq !== navigationSequence) return settle({ outcome: 'superseded', url });
          if (intent && !intent.isCurrent()) return settle({ outcome: 'canceled', url });
          if (prevented) {
              currentPage._pendingNavigation = async () => {
                  if (navigationType === 'traverse' && requestedHistory) await moveHistory(requestedHistory, url, true);
                  else await navigate(url, true, options);
              };
              if (navigationType === 'traverse') {
                restorationAttempted = true;
                const restored = await moveHistory(committedHistory, committedUrl);
                if (seq !== navigationSequence) return settle({ outcome: 'superseded', url });
                if (restored.outcome !== 'completed') throw restored.error;
              }
              // Force re-render to show prevention UI if any
              await owner.wait(currentPage.requestUpdate());
              return settle({ outcome: 'canceled', url });
          }
      }

      if (navigationType !== 'traverse') {
        saveCurrentScrollPosition();
      }

      document.dispatchEvent(new CustomEvent('cossack:before-navigate', {
        bubbles: true,
        detail: {
          fromPathname: window.location.pathname,
          toPathname: url,
          navigationType,
          types: options?.types,
          scroll: options?.scroll ?? defaultScrollBehavior,
        }
      }));

      setProgress(30);

      // Check for loading.ts convention
      const urlObj = new URL(url, window.location.href);
      const cleanPath = urlObj.pathname.replace(/\/$/, '') || '/index';
      const potentialLoadingPath = `/src/pages${cleanPath}/loading.ts`;
      const LoadingCompClass = loadings[potentialLoadingPath] ? getModuleDefault(loadings[potentialLoadingPath]) as new () => Cossack : null;

      const queryTransition = currentPageUrl && new URL(currentPageUrl, window.location.href).pathname === urlObj.pathname;
      if (LoadingCompClass && !isDisplayingLoadingState && !queryTransition) {
          isDisplayingLoadingState = true;
          const loadingScope = currentLayoutInstances.at(-1)?._getServiceScope() || clientServiceRoot;
          const loadingInstance = createInstance(LoadingCompClass, { serviceScope: loadingScope });
          trace.bindComponent?.(loadingInstance, 'loading');
          // Display loading content without destroying the committed page.
          ownLoading = loadingInstance;
          loadingPage = loadingInstance;

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

          await owner.wait(loadingInstance.bootstrap({ skipInit: true }));
          if (seq !== navigationSequence) return settle({ outcome: 'superseded', url });
          await owner.wait(triggerAppUpdate(() => !owner.signal.aborted));
      }

      const { state, url: responseUrl } = await owner.wait(fetchPage(url, owner.signal, trace));
      if (seq !== navigationSequence) {
        // A newer navigation began while this page was loading: discard the
        // late response — it must never commit over the newer navigation.
        return settle({ outcome: 'superseded', url });
      }
      if (intent && !intent.isCurrent()) return settle({ outcome: 'canceled', url });
      setProgress(100);

      // DOM commit: destroy old page, instantiate new page, trigger re-render.
      // When view transitions are enabled and supported, wrap this in
      // document.startViewTransition() so the browser snapshots before/after.
      // The loading.ts swap (if any) happened above, BEFORE fetchPage — its DOM
      // mutation is already committed by the time startViewTransition snapshots,
      // so the transition animates from loading.ts → real content.
      const requestedUrl = new URL(url, window.location.href);
      const destination = new URL(responseUrl, window.location.href);
      if (!destination.hash) destination.hash = requestedUrl.hash;
      const destinationUrl = destination.pathname + destination.search + destination.hash;
      const redirected = destination.pathname !== requestedUrl.pathname || destination.search !== requestedUrl.search;
      prepared = await owner.wait(prepareComponent(state, destinationUrl, owner, trace));
      let ownerDisposed = false;
      const commit = async () => {
        if (seq !== navigationSequence) return;
        if (intent && !intent.isCurrent()) { ownerDisposed = true; return; }
        owner.assertCurrent();
        await prepared!.commit(preparedState => {
          window.__INITIAL_STATE__ = preparedState;
        });
        owner.assertCurrent();
        if (seq !== navigationSequence) return;
        if (navigationType === 'push') {
          const active = getNavigationHistoryLocation(window.history.state);
          const position = active?.group === committedHistory.group ? active.position + 1 : committedHistory.position + 1;
          window.history.pushState(navigationHistoryStateAt(createNavigationHistoryState(), { group: committedHistory.group, position }), '', destinationUrl);
        } else if (navigationType === 'replace') {
          window.history.replaceState(window.history.state, '', destinationUrl);
        } else if (redirected) {
          window.history.replaceState(window.history.state, '', destinationUrl);
        }
        committedUrl = new URL(destinationUrl, window.location.href).href;
        committedHistory = getNavigationHistoryLocation(window.history.state) ?? committedHistory;
        navigationCommitted = true;
        prepared!.finish();
        owner.assertCurrent();
        const scrollDecision = applyNavigationScroll(
          destinationUrl,
          options?.scroll ?? defaultScrollBehavior,
          navigationType,
        );
        trace({ phase: 'scroll', behavior: options?.scroll ?? defaultScrollBehavior, decision: scrollDecision });
        saveCurrentScrollPosition();
        notifyNavigationComplete(state.pathname);
      };

      const performCommit = async () => {
        if (seq !== navigationSequence) return;
        if (viewTransitionsEnabled && supportsViewTransitions()) {
          // Only use the object-form ({ update, types }) when the browser
          // supports VT types (Chrome 125+); otherwise fall back to the
          // single-callback form so older browsers don't throw inside the
          // transition (which would surface as a navigation failure).
          const useTypes = !!(options?.types?.length) && supportsViewTransitionTypes();
          trace({ phase: 'transition', decision: useTypes ? 'typed' : options?.types?.length ? 'types-unsupported' : 'callback' });
          const transition = useTypes
            ? (document as any).startViewTransition({ update: commit, types: options.types })
            : (document as any).startViewTransition(commit);
          // `ready` rejects when a newer transition supersedes this one, but the
          // DOM update still runs. Handle that animation-only rejection so it
          // never becomes an unhandled promise rejection. Navigation readiness
          // follows `updateCallbackDone`, which is the standard promise that
          // resolves after the async commit callback has actually completed.
          void transition.ready.catch(() => trace({ phase: 'transition', decision: 'animation-skipped' }));
          void transition.finished.catch(() => {});
          await transition.updateCallbackDone;
        } else {
          trace({ phase: 'transition', decision: viewTransitionsEnabled ? 'unsupported' : 'disabled' });
          await commit();
        }
      };
      // Bootstrap/render can await user code. Serialize DOM commits so an
      // older navigation cannot finish applying its tree after a newer one.
      const committed = commitQueue.then(() => {
        owner.assertCurrent();
        return owner.wait(performCommit());
      });
      commitQueue = committed.catch(() => {});
      await owner.wait(committed);
      if (seq !== navigationSequence) return settle({ outcome: 'superseded', url });
      if (ownerDisposed) return settle({ outcome: 'canceled', url });

      (window as any).__cossackReady = true;
      document.dispatchEvent(new CustomEvent('cossack:ready', {
        bubbles: true,
        detail: {
          pathname: state.pathname,
          navigationType,
          types: options?.types,
          scroll: options?.scroll ?? defaultScrollBehavior,
        }
      }));
      return settle({ outcome: redirected ? 'redirected' : 'completed', url: destinationUrl });
    } catch (error) {
      prepared?.dispose();
      if (seq !== navigationSequence) return settle({ outcome: 'superseded', url });
      if (navigationType === 'traverse' && !navigationCommitted && !restorationAttempted) {
        await moveHistory(committedHistory, committedUrl);
        if (seq !== navigationSequence) return settle({ outcome: 'superseded', url });
      }
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
        return settle({ outcome: 'failed', url, error });
      }
      window.location.reload();
      return settle({ outcome: 'failed', url, error });
    } finally {
      prepared?.dispose();
      if (ownLoading) {
        if (loadingPage === ownLoading) {
          loadingPage = undefined;
          isDisplayingLoadingState = false;
          void triggerAppUpdate().catch(error => console.error('Loading restoration failed:', error));
        }
        ownLoading.destroy();
      }
      owner.dispose();
      if (activeOwner === owner) activeOwner = undefined;
      trace({ phase: 'finish', outcome, committed: navigationCommitted });
    }
  };

  const dispatchNavigate = async (url: string, options?: NavigateOptions): Promise<NavigateResult> => {
    const move = historyMove;
    if (move && options?.navigationType === 'traverse') {
      if (sameHistory(getNavigationHistoryLocation(window.history.state), move.target) &&
        new URL(url, window.location.href).href === move.url) {
        // Restoration is a browser traversal, but does not reload the retained
        // tree or run its guard. Confirmation resumes the original traversal.
        historyMove = undefined;
        move.arrived();
        const result = move.confirm ? await navigate(url, true, options) : { outcome: 'completed' as const, url };
        move.finish(result);
        return result;
      }
      move.finish({ outcome: 'superseded', url: move.url });
    } else if (move) await move.promise;
    return navigate(url, false, options);
  };
  Cossack._onNavigate = dispatchNavigate;
  Cossack._onUpdateUrlState = async (sourceUrl, build, isCurrent, options) => {
    if (historyMove) await historyMove.promise;
    const source = new URL(sourceUrl, window.location.href);
    const committed = new URL(committedUrl, window.location.href);
    if (!isCurrent() || source.pathname !== committed.pathname || source.search !== committed.search) {
      return { outcome: 'canceled', url: source.pathname + source.search + source.hash };
    }
    let target: string;
    try { target = build(pendingQuery?.isCurrent() ? pendingQuery.url : committedUrl); }
    catch (error) { return { outcome: 'failed', url: committed.pathname + committed.search + committed.hash, error }; }
    const intent: QueryIntent = { url: target, isCurrent };
    pendingQuery = intent;
    try { return await navigate(target, false, options, intent); }
    finally { if (pendingQuery === intent) pendingQuery = undefined; }
  };

  enableClientNavigation(
    dispatchNavigate,
    async (url) => {
      if (!pageCache.has(pageCacheKey(url))) {
        fetchPage(url).catch(() => {});
      }
    }
  );
  return { navigate: dispatchNavigate };
}
