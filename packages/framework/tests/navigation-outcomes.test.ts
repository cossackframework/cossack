// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigateResult } from '@cossackframework/core';

const fixture = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} },
    guard: async () => false,
    bootstrapGate: undefined as Promise<void> | undefined,
    bootstrapStarted: false,
}));
vi.mock('virtual:cossack-pages', () => ({ default: fixture.registry }));
vi.mock('virtual:cossack-lang', () => ({ supportedLocales: [], defaultLocale: 'en', loadCatalog: async () => ({}) }));
vi.mock('@cossackframework/core', async importOriginal => {
    const actual = await importOriginal<typeof import('@cossackframework/core')>();
    return { ...actual,
        createInstance: (Component: new () => any) => new Component(),
        createRootServiceScope: () => ({}),
        enableClientNavigation: vi.fn(),
        applyNavigationScroll: vi.fn(),
    };
});
const { Cossack } = await import('@cossackframework/core');

// Keep real navigation/fetch/cache/history code, with a small component lifecycle
// fixture so module and bootstrap delays can be controlled deterministically.
class Component {
    children: any;
    path = '';
    updateComplete = Promise.resolve();
    updateHead = () => {};
    updatePath(path: string) { this.path = path; }
    async bootstrap(options: any) {
        if (options.initialState?.pathname === '/slow' && fixture.bootstrapGate) {
            fixture.bootstrapStarted = true;
            await fixture.bootstrapGate;
        }
    }
    async requestUpdate() { return true; }
    destroy() {}
    _getServiceScope() { return {}; }
    _getWrappedTemplate() { return this.path; }
    _frameworkNavigateComplete() {}
    _frameworkMount() {}
    _checkPreventNavigation() { return fixture.guard(); }
}
class App extends Component {
    setCurrentPage() {}
    mount() {}
    override async requestUpdate() {
        document.querySelector('#app')!.textContent = this.children;
        return true;
    }
}
for (const route of ['start', 'slow', 'fast', 'final']) {
    fixture.registry.pages[`/src/pages/${route}/index.ts`] = async () => ({ default: Component });
}
const { createClientApp } = await import('../src/client/app');
let navigate: (url: string) => Promise<NavigateResult>;
const handleError = (event: Event) => event.preventDefault();
function documentResponse(route: string, url?: string) {
    const response = new Response(`<title>${route}</title><script>window.__INITIAL_STATE__ = ${JSON.stringify({
        routePath: `/${route}`, pathname: `/${route}`,
    })}</script>`);
    if (url) Object.defineProperty(response, 'url', { value: url });
    return response;
}
beforeEach(async () => {
    vi.restoreAllMocks();
    fixture.guard = async () => false;
    fixture.bootstrapGate = undefined;
    fixture.bootstrapStarted = false;
    (globalThis as any).__cossack_invalidatePageCache?.();
    window.history.replaceState({}, '', '/start');
    document.body.innerHTML = '<div id="app"></div>';
    window.__INITIAL_STATE__ = { routePath: '/start', pathname: '/start' };
    document.addEventListener('cossack:navigation-error', handleError);
    vi.spyOn(Cossack, 'composeHead').mockReturnValue([]);
    vi.spyOn(Cossack, 'applyHeadTags').mockImplementation(() => {});
    navigate = (await createClientApp({ container: '#app', AppComponent: App }))!.navigate;
});
afterEach(() => {
    document.removeEventListener('cossack:navigation-error', handleError);
    vi.unstubAllGlobals();
    Cossack._onNavigate = undefined;
});

describe('navigation completion behavior', () => {
    it('returns the full URL through the public callback and pushes it to history', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast')));
        expect(await Cossack._onNavigate!('/fast?sort=name#row')).toEqual({ outcome: 'completed', url: '/fast?sort=name#row' });
        expect(window.location.pathname + window.location.search + window.location.hash).toBe('/fast?sort=name#row');
        expect(document.querySelector('#app')!.textContent).toBe('/fast');
    });

    it('uses the actual fetch redirect destination for results and history', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('final', new URL('/final?ok=1', window.location.href).href)));
        expect(await navigate('/slow#row')).toEqual({ outcome: 'redirected', url: '/final?ok=1#row' });
        expect(window.location.pathname + window.location.search + window.location.hash).toBe('/final?ok=1#row');
    });

    it('settles prevented and rejected guards without fetching', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        fixture.guard = async () => true;
        expect(await navigate('/fast')).toMatchObject({ outcome: 'canceled' });
        fixture.guard = async () => { throw new Error('guard failed'); };
        expect(await navigate('/fast')).toMatchObject({ outcome: 'failed', error: expect.any(Error) });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('discards a late response and leaves the newer page and history active', async () => {
        let release!: (response: Response) => void;
        const slow = new Promise<Response>(resolve => { release = resolve; });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/slow' ? slow : documentResponse('fast')));
        const older = navigate('/slow');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(await navigate('/fast')).toMatchObject({ outcome: 'completed' });
        release(documentResponse('slow'));
        expect(await older).toMatchObject({ outcome: 'superseded' });
        expect(document.querySelector('#app')!.textContent).toBe('/fast');
        expect(window.location.pathname).toBe('/fast');
    });

    it('keeps an old asynchronous bootstrap from finishing over a newer commit', async () => {
        let release!: () => void;
        fixture.bootstrapGate = new Promise<void>(resolve => { release = resolve; });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => documentResponse(url.slice(1))));
        const older = navigate('/slow');
        await vi.waitFor(() => expect(fixture.bootstrapStarted).toBe(true));
        const newer = navigate('/fast');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        release();
        expect(await older).toMatchObject({ outcome: 'superseded' });
        expect(await newer).toMatchObject({ outcome: 'completed' });
        expect(document.querySelector('#app')!.textContent).toBe('/fast');
        expect(window.location.pathname).toBe('/fast');
    });

    it('reports missing route modules as failures instead of successful navigations', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('missing')));
        expect(await navigate('/missing')).toMatchObject({ outcome: 'failed' });
        expect(window.location.pathname).toBe('/start');
    });
});
