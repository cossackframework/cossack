import { Cossack } from '@cossackframework/core';
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

  const initialState = window.__INITIAL_STATE__;
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
    const componentInstance = new PageComponent();
    await componentInstance.bootstrap({ container: containerEl, initialState });
  } else {
    console.error(`Could not extract component from module: ${componentPath}`);
  }
}
