// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-lang', () => ({ supportedLocales: [], defaultLocale: 'en', loadCatalog: async () => ({}) }));

const renders = { app: 0, layout: 0, page: 0 };
let editor: Editor | undefined;

@Page({ transport: 'http' })
class App extends Cossack {
  render() { renders.app++; return html`<div id="shell">${this.children}</div>`; }
}
@Page({ transport: 'http' })
class RootLayout extends Cossack {
  render() { renders.layout++; return html`<div class="root">${this.children}</div>`; }
}
@Page({ transport: 'http' })
class Editor extends Cossack {
  @State() title = '';
  @State() dirty = false;
  render() { renders.page++; editor = this; return html`<main>${this.title}${this.dirty ? ' (unsaved)' : ''}</main>`; }
}
registry.pages['/src/pages/editor/index.ts'] = async () => ({ default: Editor });
registry.layouts['/src/pages/layout.ts'] = { default: RootLayout };

const { computeRouteIds } = await import('../src/route-ids');
const { routePathToIdMap } = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts));
const { createClientApp } = await import('../src/client/app');

function payload() {
  const pathname = '/editor';
  const metadata = (componentId: string) => ({ componentId, pathname, url: pathname, params: {} });
  return {
    public: {}, metadata: metadata('editor'),
    routePath: pathname, componentPath: '/src/pages/editor/index.ts',
    componentRouteId: routePathToIdMap.get('/src/pages/editor/index.ts'), appRouteId: 'cossack_app',
    pathname, channels: ['global'], transport: 'http',
    _app_state: { public: {}, metadata: metadata('App') },
    _layout_stack: [{ path: '/src/pages/layout.ts', state: { public: {}, metadata: metadata('/src/pages/layout.ts') }, componentRouteId: routePathToIdMap.get('/src/pages/layout.ts') }],
    runtime: { platform: 'web' },
  };
}

/** Let the update and the app's render that follows it finish. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Typing in an editor changes page state on every keystroke: each change is one render of
// the page, composed into its layouts, not a render of its own and another for the app.
describe('a page state change', () => {
  it('renders the page once, and once for a handler that sets several fields', async () => {
    window.history.replaceState({}, '', '/editor');
    document.body.innerHTML = '<div id="app"></div>';
    window.__INITIAL_STATE__ = payload();
    await createClientApp({ container: '#app', AppComponent: App });
    await settle();
    expect(editor).toBeDefined();
    const before = { ...renders };

    editor!.title = 'Hello';
    await settle();
    expect(document.querySelector('main')?.textContent).toBe('Hello');
    expect(renders.page - before.page).toBe(1);
    expect(renders.app - before.app).toBe(1);

    const middle = { ...renders };
    editor!.title = 'Hello world';
    editor!.dirty = true;
    await settle();
    expect(document.querySelector('main')?.textContent).toBe('Hello world (unsaved)');
    expect(renders.page - middle.page).toBe(1);
    expect(renders.layout - middle.layout).toBe(1);
    expect(renders.app - middle.app).toBe(1);
  });
});
