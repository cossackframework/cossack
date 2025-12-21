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

  enableClientNavigation(async (url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Network response was not ok');
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const scripts = doc.querySelectorAll('script');
      let newState = null;

      for (const script of scripts) {
        if (script.textContent?.includes('window.__INITIAL_STATE__ =')) {
          const content = script.textContent;
          const jsonStart = content.indexOf('{');
          if (jsonStart > -1) {
            const json = content.substring(jsonStart);
            try {
              newState = JSON.parse(json);
            } catch (e) {
              console.error('Failed to parse state JSON', e);
            }
          }
          break;
        }
      }

      if (newState) {
        window.__INITIAL_STATE__ = newState;
        await loadComponent(newState);
        if (doc.title) {
          document.title = doc.title;
        }
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Navigation failed:', error);
      window.location.reload();
    }
  });
}
