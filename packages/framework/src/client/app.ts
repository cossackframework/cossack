import { Cossack, enableClientNavigation, LifecyclePhase } from '@cossackframework/core';
import { App } from '../App';
import { CossackElement } from '@cossackframework/renderer';
import registry from 'virtual:cossack-pages';

const { pages, layouts, loadings, components } = registry;

/**
 * Convert a file path to a simplified route path.
 * Example: /src/pages/hello/[name]/index.ts -> /hello/[name]
 */
function filePathToRoutePath(filePath: string): string {
    const route = filePath
        .replace('/src/pages/', '/')
        .replace('/index.ts', '')
        .replace('/index.mdx', '')
        .replace(/\.(ts|tsx|mdx)$/, '');

    // Normalize root: /index (from pages/index/index.ts) or empty (from pages/index.ts) -> /
    if (route === '/index' || route === '') {
        return '/';
    }
    return route;
}

// Create mapping from route paths to file paths for component loading
const routeToFilePath = new Map<string, string>();
for (const filePath in pages) {
    const routePath = filePathToRoutePath(filePath);
    routeToFilePath.set(routePath, filePath);
}

// Register Components
for (const path in components) {
    const module = components[path];
    // Find the exported class
    for (const key in module) {
        const exported = (module as any)[key];
        if (typeof exported === 'function' && (exported.prototype instanceof CossackElement || (exported as any)._isCossackElement)) {
            // Register by export name (usually file name matches class name in our convention, e.g. Button.ts -> Button)
            CossackElement.components[key] = exported;
        }
    }
}

declare global {
  interface Window {
    __INITIAL_STATE__: any;
  }
}

export interface CreateClientAppOptions {
  container: HTMLElement | string;
  AppComponent?: new (...args: any[]) => Cossack;
}

const pageCache = new Map<string, { html: string; state: any }>();

// Simple Progress Bar
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
const progressBar = document.createElement('div');
progressBar.id = 'cossack-progress';
document.body.appendChild(progressBar);

function setProgress(percent: number) {
  progressBar.style.opacity = percent > 0 && percent < 100 ? '1' : progressBar.style.opacity;
  progressBar.style.width = percent + '%';
  if (percent >= 100) {
    setTimeout(() => {
      progressBar.style.opacity = '0';
      setTimeout(() => { progressBar.style.width = '0%'; }, 400);
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

async function fetchPage(url: string) {
  if (pageCache.has(url)) {
    return pageCache.get(url)!;
  }

  const response = await fetch(url);
  const html = await response.text();
  const parsed = parseStateFromHTML(html);

  if (parsed) {
    const data = { html, state: parsed.state };
    pageCache.set(url, data);
    return data;
  }

  throw new Error('Failed to load page state');
}

export async function createClientApp({ container, AppComponent }: CreateClientAppOptions) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector(container)
      : container;

  if (!containerEl) {
    console.error('Could not find root container');
    return;
  }

  const appInstance = new (AppComponent ?? App)();
  
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

  const syncHead = () => {
    if (!currentPage) return;
    const emptyCtx = Cossack.buildHeadContext([]);
    const pageHeadValue = currentPage.head(emptyCtx);
    
    let tags = Cossack.mergeHead(emptyCtx, pageHeadValue);
    
    for (let i = currentLayoutInstances.length - 1; i >= 0; i--) {
        const headContext = Cossack.buildHeadContext(tags);
        const headValue = currentLayoutInstances[i].head(headContext);
        tags = Cossack.mergeHead(headContext, headValue);
    }
    
    const finalHeadContext = Cossack.buildHeadContext(tags);
    const appHeadValue = appInstance.head(finalHeadContext);
    const headTags = Cossack.mergeHead(finalHeadContext, appHeadValue);
    
    Cossack.applyHeadTags(headTags);
  };

  appInstance.updateHead = syncHead;

  // Initial bootstrap without render logic override
  await appInstance.bootstrap({ 
    container: containerEl as Element, 
    initialState: window.__INITIAL_STATE__._app_state,
    skipInit: true,
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
            instance = new LComp();
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
      const componentInstance = new PageComponent();
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

      // Perform initial composition and render
      await triggerAppUpdate();
    }
    isDisplayingLoadingState = false;
  };

  await loadComponent(window.__INITIAL_STATE__);

  const navigate = async (url: string, force = false): Promise<boolean> => {
    if (!force && currentPage && !isDisplayingLoadingState) {
        const prevented = await currentPage._checkPreventNavigation();
        if (prevented) {
            currentPage._pendingNavigation = async () => {
                if (await navigate(url, true)) {
                    window.history.pushState({}, '', url);
                }
            };
            // Force re-render to show prevention UI if any
            await currentPage.requestUpdate();
            return false;
        }
    }

    try {
      setProgress(30);

      // Check for loading.ts convention
      const urlObj = new URL(url, window.location.href);
      const cleanPath = urlObj.pathname.replace(/\/$/, '') || '/index';
      const potentialLoadingPath = `/src/pages${cleanPath}/loading.ts`;
      const LoadingCompClass = loadings[potentialLoadingPath] ? Object.values(loadings[potentialLoadingPath])[0] as new () => Cossack : null;

      if (LoadingCompClass && !isDisplayingLoadingState) {
          isDisplayingLoadingState = true;
          const loadingInstance = new LoadingCompClass();
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

      window.__INITIAL_STATE__ = state;
      await loadComponent(state);
      return true;
    } catch (error) {
      console.error('Navigation failed:', error);
      window.location.reload();
      return false;
    }
  };

  Cossack._onNavigate = async (url) => {
      const accepted = await navigate(url);
      if (accepted) {
          window.history.pushState({}, '', url);
      }
  };

  enableClientNavigation(
    navigate,
    async (url) => {
      if (!pageCache.has(url)) {
        fetchPage(url).catch(() => {});
      }
    }
  );
}