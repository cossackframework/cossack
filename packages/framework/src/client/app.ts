import { Cossack, enableClientNavigation } from '@cossackframework/core';
import { App } from '../App';
// @ts-expect-error - this is a virtual module created by the vite plugin
import registry from 'virtual:cossack-pages';

const { pages, layouts, loadings } = registry;

declare global {
  interface Window {
    __INITIAL_STATE__: any;
  }
}

export interface CreateClientAppOptions {
  container: HTMLElement | string;
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

export async function createClientApp({ container }: CreateClientAppOptions) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector(container)
      : container;

  if (!containerEl) {
    console.error('Could not find root container');
    return;
  }

  const appInstance = new App();
  
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
    const componentPath = initialState?.componentPath;
    const layoutStack = initialState?._layout_stack || [];
    const pathname = initialState?.pathname || window.location.pathname;

    if (!componentPath) {
      console.error('Could not find componentPath in initial state');
      return;
    }

    appInstance.updatePath(pathname);

    const activeLayoutPaths = new Set(layoutStack.map((l: any) => l.path));
    
    for (const [path, instance] of currentLayoutsMap.entries()) {
        if (!activeLayoutPaths.has(path)) {
            instance.destroy();
            currentLayoutsMap.delete(path);
        }
    }

    currentLayoutInstances = [];
    for (const { path, state } of layoutStack) {
        let instance = currentLayoutsMap.get(path);
        if (!instance) {
            const LComp = Object.values(layouts[path] as object)[0] as new () => Cossack;
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

            await instance.bootstrap({ container: containerEl as Element, initialState: state, skipInit: true });
            currentLayoutsMap.set(path, instance);
        }
        instance.updatePath(pathname);
        currentLayoutInstances.push(instance);
    }

    const module = pages[componentPath] as any;
    if (!module) {
      console.error(`Component module not found for path: ${componentPath}`);
      return;
    }

    const PageComponent = Object.values(module)[0] as new () => Cossack;

    if (PageComponent) {
      if (currentPage) {
        currentPage.destroy();
      }
      const componentInstance = new PageComponent();
      currentPage = componentInstance;
      
      componentInstance.updateHead = syncHead;

      // Hook reactivity
      const originalRequestUpdate = componentInstance.requestUpdate.bind(componentInstance);
      componentInstance.requestUpdate = async (name?: string, oldValue?: unknown) => {
          const p = originalRequestUpdate(name, oldValue);
          await p;
          await triggerAppUpdate();
          return true;
      };

      await componentInstance.bootstrap({ container: containerEl as Element, initialState, skipInit: true });
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
            currentPage._pendingNavigation = () => navigate(url, true);
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
          loadingInstance.requestUpdate = async (name?: string, oldValue?: unknown) => {
              const p = originalRequestUpdate(name, oldValue);
              await p;
              await triggerAppUpdate();
              return true;
          };

          await loadingInstance.bootstrap({ container: containerEl as Element });
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