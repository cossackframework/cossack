// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigateResult } from '@cossackframework/core';

const fixture = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} },
    guard: async () => false,
    bootstrapGate: undefined as Promise<void> | undefined,
    bootstrapStarted: false,
    bootstrapUrls: [] as string[],
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
        if (options.initialState?.metadata?.url) fixture.bootstrapUrls.push(options.initialState.metadata.url);
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
class RootBoundary extends Component { override _getWrappedTemplate() { return 'root-boundary:' + this.path; } }
class GroupBoundary extends Component { override _getWrappedTemplate() { return 'group-boundary:' + this.path; } }
fixture.registry.pages['/src/pages/404/index.ts'] = async () => ({ default: RootBoundary });
fixture.registry.pages['/src/pages/(group)/404/index.ts'] = async () => ({ default: GroupBoundary });
fixture.registry.pages['/src/pages/(group)/error/index.ts'] = async () => ({ default: GroupBoundary });
const { computeRouteIds } = await import('../src/route-ids');
const ids = computeRouteIds(Object.keys(fixture.registry.pages), []);
const { createClientApp } = await import('../src/client/app');
let navigate: (url: string, options?: import('@cossackframework/core').NavigateOptions) => Promise<NavigateResult>;
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
    fixture.bootstrapUrls = [];
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
    it('boots a destination with its full query URL before committing history', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast')));
        expect(await navigate('/fast?search=%E9%9B%AA&page=2')).toMatchObject({ outcome: 'completed' });
        expect(fixture.bootstrapUrls.at(-1)).toBe('/fast?search=%E9%9B%AA&page=2');
    });
    it('replaces history explicitly and preserves unrelated history state', async () => {
        window.history.replaceState({ applicationKey: 'owned' }, '', '/start');
        const length = window.history.length;
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast')));
        expect(await navigate('/fast?sort=name#row', { history: 'replace' })).toEqual({ outcome: 'completed', url: '/fast?sort=name#row' });
        expect(window.history.length).toBe(length);
        expect(window.history.state.applicationKey).toBe('owned');
        expect(window.location.search).toBe('?sort=name'); expect(window.location.hash).toBe('#row');
    });
    const boundaryDocument = (status: number, type: string, source: string, id = ids.routePathToIdMap.get(source)) => new Response(
        `<script>window.__INITIAL_STATE__ = ${JSON.stringify({ routePath: source, componentPath: source,
            componentRouteId: id, pathname: '/missing', _cossackBoundary: { type, source } })}</script>`, { status });

    it.each([[404, '404'], [500, 'error']] as const)('commits a server-selected %s boundary by source identity and never caches its failure', async (status, type) => {
        const source = `/src/pages/(group)/${type}/index.ts`;
        vi.stubGlobal('fetch', vi.fn(async () => boundaryDocument(status, type, source)));
        expect(await navigate('/missing')).toMatchObject({ outcome: 'completed' });
        expect(document.querySelector('#app')!.textContent).toBe('group-boundary:/missing');
        expect(window.location.pathname).toBe('/missing');
        expect(await navigate('/missing')).toMatchObject({ outcome: 'completed' });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        [404, 'error', '/src/pages/(group)/error/index.ts'],
        [404, '404', '/src/pages/start/index.ts'],
        [500, 'error', '/src/pages/(group)/404/index.ts'],
    ])('rejects a failure document with mismatched status/type/module (%#)', async (status, type, source) => {
        vi.stubGlobal('fetch', vi.fn(async () => boundaryDocument(status as number, type as string, source as string)));
        expect(await navigate('/missing')).toMatchObject({ outcome: 'failed' }); expect(window.location.pathname).toBe('/start');
    });

    it('rejects plain failures and a mismatched component ID instead of committing another module', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
        expect(await navigate('/missing')).toMatchObject({ outcome: 'failed' });
        vi.stubGlobal('fetch', vi.fn(async () => boundaryDocument(404, '404', '/src/pages/(group)/404/index.ts', ids.routePathToIdMap.get('/src/pages/404/index.ts'))));
        expect(await navigate('/missing')).toMatchObject({ outcome: 'failed' }); expect(window.location.pathname).toBe('/start');
    });

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
