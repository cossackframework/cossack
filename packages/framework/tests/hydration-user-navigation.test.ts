// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-lang', () => ({ supportedLocales: [], defaultLocale: 'en', loadCatalog: async () => ({}) }));

/** The latest instance of each component class, and the user its render saw. */
const live = new Map<string, Cossack>();
const rendered = new Map<string, unknown>();
function track(name: string, component: Cossack, user: unknown) {
  live.set(name, component);
  rendered.set(name, user);
}
const users = () => Object.fromEntries([...live].map(([name, component]) => [name, (component as any).currentUser]));

@Page({ transport: 'http' })
class App extends Cossack {
  get currentUser() { return this.user; }
  render() { track('app', this, this.user); return html`<div id="shell">${this.children}</div>`; }
}
@Page({ transport: 'http' })
class RootLayout extends Cossack {
  get currentUser() { return this.user; }
  render() { track('root', this, this.user); return html`<div class="root">${this.children}</div>`; }
}
@Page({ transport: 'http' })
class AreaLayout extends Cossack {
  get currentUser() { return this.user; }
  render() { track('area', this, this.user); return html`<div class="area">${this.children}</div>`; }
}
@Page({ transport: 'http' })
class Account extends Cossack {
  get currentUser() { return this.user; }
  render() { track('page', this, this.user); return html`<main>account</main>`; }
}
@Page({ transport: 'http' })
class Settings extends Cossack {
  get currentUser() { return this.user; }
  render() { track('page', this, this.user); return html`<main>settings</main>`; }
}
registry.pages['/src/pages/area/account/index.ts'] = async () => ({ default: Account });
registry.pages['/src/pages/area/settings/index.ts'] = async () => ({ default: Settings });
registry.layouts['/src/pages/layout.ts'] = { default: RootLayout };
registry.layouts['/src/pages/area/layout.ts'] = { default: AreaLayout };

const { computeRouteIds } = await import('../src/route-ids');
const { routePathToIdMap } = computeRouteIds(Object.keys(registry.pages), Object.keys(registry.layouts));
const { createClientApp } = await import('../src/client/app');

/** The SSR payload shape: the user appears once, at the root. */
function payload(route: 'account' | 'settings', user?: Record<string, unknown>) {
  const pathname = `/area/${route}`;
  const metadata = (componentId: string) => ({ componentId, pathname, url: pathname, params: {} });
  return {
    public: {}, metadata: metadata(route), ...(user ? { user } : {}),
    routePath: pathname, componentPath: `/src/pages/area/${route}/index.ts`,
    componentRouteId: routePathToIdMap.get(`/src/pages/area/${route}/index.ts`), appRouteId: 'cossack_app',
    pathname, channels: ['global'], transport: 'http',
    _app_state: { public: {}, metadata: metadata('App') },
    _layout_stack: ['/src/pages/layout.ts', '/src/pages/area/layout.ts'].map(path => ({
      path, state: { public: {}, metadata: metadata(path) }, componentRouteId: routePathToIdMap.get(path),
    })),
    runtime: { platform: 'web' },
  };
}
/** Serve the next document. Like a sign-in RPC, it drops cached route documents. */
function serve(state: ReturnType<typeof payload>) {
  (globalThis as any).__cossack_invalidatePageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    `<title>page</title><script>window.__INITIAL_STATE__ = ${JSON.stringify(state)}</script>`)));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (globalThis as any).__cossack_invalidatePageCache?.();
});

describe('user hydration from the payload root', () => {
  it('gives the page, both layouts and the App the root user on first load and after client navigation', async () => {
    const errors = vi.spyOn(console, 'error');
    window.history.replaceState({}, '', '/area/account');
    document.body.innerHTML = '<div id="app"></div>';
    window.__INITIAL_STATE__ = payload('account', { id: 'u1', name: 'Taras' });
    const app = (await createClientApp({ container: '#app', AppComponent: App }))!;
    const signedIn = { id: 'u1', name: 'Taras' };
    expect(users()).toEqual({ app: signedIn, root: signedIn, area: signedIn, page: signedIn });
    expect(Object.fromEntries(rendered)).toEqual({ app: signedIn, root: signedIn, area: signedIn, page: signedIn });
    expect(document.querySelector('main')?.textContent).toBe('account');
    const [firstApp, firstRoot, firstArea] = ['app', 'root', 'area'].map(name => live.get(name));

    // Same user: layouts and the App are retained and keep the destination user.
    serve(payload('settings', { id: 'u1', name: 'Taras' }));
    expect((await app.navigate('/area/settings')).outcome).toBe('completed');
    expect(document.querySelector('main')?.textContent).toBe('settings');
    expect(live.get('root') === firstRoot, 'root retained').toBe(true);
    expect(live.get('area') === firstArea, 'area retained').toBe(true);
    expect(live.get('app') === firstApp, 'app retained').toBe(true);
    expect(users()).toEqual({ app: signedIn, root: signedIn, area: signedIn, page: signedIn });

    // Another user: the ownership change replaces layouts and the App.
    const other = { id: 'u2', name: 'Lesya' };
    serve(payload('account', other));
    expect((await app.navigate('/area/account')).outcome).toBe('completed');
    expect(live.get('root') === firstRoot, 'root replaced').toBe(false);
    expect(live.get('app') === firstApp, 'app replaced').toBe(false);
    expect(users()).toEqual({ app: other, root: other, area: other, page: other });
    expect(Object.fromEntries(rendered)).toEqual({ app: other, root: other, area: other, page: other });

    // Signed out: no component keeps the previous user.
    serve(payload('settings'));
    expect((await app.navigate('/area/settings')).outcome).toBe('completed');
    expect(users()).toEqual({ app: undefined, root: undefined, area: undefined, page: undefined });
    expect(errors).not.toHaveBeenCalled();
  });
});
