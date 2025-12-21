import { Cossack, enableClientNavigation } from '@cossackframework/core';
// @ts-expect-error - this is a virtual module created by the vite plugin
import pages from 'virtual:cossack-pages';

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

export async function createClientApp({ container }: CreateClientAppOptions) {
  const containerEl =
    typeof container === 'string'
      ? document.querySelector(container)
      : container;

  if (!containerEl) {
    console.error('Could not find root container');
    return;
  }

  let currentComponent: Cossack | null = null;

  const loadComponent = async (initialState: any) => {
    const componentPath = initialState?.componentPath;

    if (!componentPath) {
      console.error('Could not find componentPath in initial state');
      return;
    }

    const module = pages[componentPath] as any;

    if (!module) {
      console.error(`Component module not found for path: ${componentPath}`);
      return;
    }

    const PageComponent = Object.values(module)[0] as new () => Cossack;

    if (PageComponent) {
      if (currentComponent) {
        currentComponent.destroy();
      }
      const componentInstance = new PageComponent();
      currentComponent = componentInstance;
      await componentInstance.bootstrap({ container: containerEl as Element, initialState });
    } else {
      console.error(`Could not extract component from module: ${componentPath}`);
    }
  };

  await loadComponent(window.__INITIAL_STATE__);

  const fetchPage = async (url: string) => {
    if (pageCache.has(url)) return pageCache.get(url)!;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Network response was not ok');
    const html = await response.text();
    const result = parseStateFromHTML(html);
    if (result) {
      const entry = { html, state: result.state, title: result.title };
      pageCache.set(url, entry as any);
      return entry;
    }
    throw new Error('Failed to parse page state');
  };

  enableClientNavigation(
    async (url) => {
      try {
        setProgress(30);
        const { state, title } = await fetchPage(url);
        setProgress(100);

        window.__INITIAL_STATE__ = state;
        await loadComponent(state);
        if (title) document.title = title;
      } catch (error) {
        console.error('Navigation failed:', error);
        window.location.reload();
      }
    },
    async (url) => {
      if (!pageCache.has(url)) {
        console.log(`[Cossack] Pre-fetching: ${url}`);
        fetchPage(url).catch(() => {}); // Silent pre-fetch
      }
    }
  );
}
