// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigateResult } from '@cossackframework/core';

const fixture = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
    guard: async () => false,
    bootstrapGate: undefined as Promise<void> | undefined,
    bootstrapStarted: false,
    renderGate: undefined as Promise<void> | undefined,
    renderStarted: false,
    renderError: false,
    renderSkip: false,
    bootstrapUrls: [] as string[],
    page: undefined as any,
}));
vi.mock('virtual:cossack-pages', () => ({ default: fixture.registry }));
vi.mock('virtual:cossack-lang', () => ({ supportedLocales: [], defaultLocale: 'en', loadCatalog: async () => ({}) }));
vi.mock('@cossackframework/core', async importOriginal => {
    const actual = await importOriginal<typeof import('@cossackframework/core')>();
    return { ...actual,
        createInstance: (Component: new () => any, options: any) => Object.assign(new Component(), { scope: options?.serviceScope }),
        createRootServiceScope: () => ({ disposeAsync: async () => {} }),
        createLayoutServiceScope: (parent: any) => ({ parent }),
        enableClientNavigation: vi.fn(),
        applyNavigationScroll: vi.fn(() => 'top'),
    };
});
const { Cossack } = await import('@cossackframework/core');

// Keep real navigation/fetch/cache/history code, with a small component lifecycle
// fixture so module and bootstrap delays can be controlled deterministically.
class Component {
    scope: any;
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
    _getServiceScope() { return this.scope; }
    _getWrappedTemplate() { return this.path; }
    _frameworkNavigateComplete() {}
    _frameworkMount() {}
    _checkPreventNavigation() { return fixture.guard(); }
}
class App extends Component {
    setCurrentPage(page: any) { fixture.page = page; }
    mount() {}
    async _frameworkRenderNavigation(isCurrent: () => boolean) {
        if (this.children === '/slow') {
            fixture.renderStarted = true;
            if (fixture.renderGate) await fixture.renderGate;
            if (fixture.renderError) throw new Error('render failed');
            if (fixture.renderSkip) return false;
        }
        if (!isCurrent()) return false;
        return this.requestUpdate();
    }
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
    fixture.renderGate = undefined;
    fixture.renderStarted = false;
    fixture.renderError = false;
    fixture.renderSkip = false;
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
    vi.useRealTimers();
    document.removeEventListener('cossack:navigation-error', handleError);
    vi.unstubAllGlobals();
    Cossack._onNavigate = undefined;
    Cossack._onUpdateUrlState = undefined;
    for (const key of Object.keys(fixture.registry.layouts)) delete fixture.registry.layouts[key];
});

describe('navigation completion behavior', () => {
    it('settles superseded navigation before an ignored body finishes and rejects its stale cache write', async () => {
        let finishBody!: (html: string) => void;
        let requestSignal!: AbortSignal;
        const body = new Promise<string>(resolve => { finishBody = resolve; });
        let reads = 0;
        const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
            if (url.includes('/slow') && reads++ === 0) {
                requestSignal = options.signal!;
                return { ok: true, status: 200, url: 'http://localhost/slow', text: () => body };
            }
            return documentResponse(url.includes('/slow') ? 'slow' : 'fast');
        });
        vi.stubGlobal('fetch', fetchMock);
        const old = navigate('/slow');
        await vi.waitFor(() => expect(requestSignal).toBeDefined());
        const next = navigate('/fast');
        expect(await old).toMatchObject({ outcome: 'superseded' });
        expect(requestSignal.aborted).toBe(true);
        expect(await next).toMatchObject({ outcome: 'completed' });
        finishBody(await documentResponse('slow').text());
        await Promise.resolve(); await Promise.resolve();
        expect(await navigate('/slow')).toMatchObject({ outcome: 'completed' });
        expect(reads).toBe(2);
    });

    it('reports a bounded failure for a stalled response body and allows retry', async () => {
        vi.useFakeTimers();
        let requestSignal!: AbortSignal;
        vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
            requestSignal = options.signal!;
            return { ok: true, status: 200, text: () => new Promise<string>(() => {}) };
        }));
        const pending = navigate('/slow');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await pending).toMatchObject({ outcome: 'failed', error: { code: 'COSSACK_NAVIGATION_TIMEOUT' } });
        expect(requestSignal.aborted).toBe(true);
        expect(window.location.pathname).toBe('/start');
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('slow')));
        expect(await navigate('/slow')).toMatchObject({ outcome: 'completed' });
    });

    it('seeds navigation ownership on an HTTP browser without crypto.randomUUID', async () => {
        const browserCrypto = globalThis.crypto;
        vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) });
        expect(await createClientApp({ container: '#app', AppComponent: App })).toBeDefined();
        expect(window.history.state.__cossackNavigation.location.group).toMatch(/^\d+-\d+-\d+-\d+$/);
    });
    it('restores a prevented back traversal and confirms the original entry without adding history', async () => {
        const initial = window.history.state;
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast')));
        await navigate('/fast'); const current = window.history.state; const length = window.history.length;
        fixture.guard = vi.fn(async () => true);
        vi.spyOn(window.history, 'go').mockImplementation(delta => {
            queueMicrotask(() => {
                const target = delta === 1 ? '/fast' : '/start';
                window.history.replaceState(delta === 1 ? current : initial, '', target);
                void navigate(target, { navigationType: 'traverse' });
            });
        });
        window.history.replaceState(initial, '', '/start');
        expect(await navigate('/start', { navigationType: 'traverse' })).toMatchObject({ outcome: 'canceled' });
        expect(window.location.pathname).toBe('/fast'); expect(document.querySelector('#app')!.textContent).toBe('/fast');
        expect(window.history.go).toHaveBeenCalledWith(1); expect(fetch).toHaveBeenCalledOnce();
        await fixture.page._pendingNavigation();
        expect(window.location.pathname).toBe('/start'); expect(document.querySelector('#app')!.textContent).toBe('/start');
        expect(window.history.go).toHaveBeenLastCalledWith(-1); expect(window.history.length).toBe(length);
        expect(fixture.guard).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    });

    it('restores a failed traversal before handing its error to the application', async () => {
        const initial = window.history.state;
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast')));
        await navigate('/fast'); const current = window.history.state;
        (globalThis as any).__cossack_invalidatePageCache();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        vi.spyOn(window.history, 'go').mockImplementation(() => {
            queueMicrotask(() => {
                window.history.replaceState(current, '', '/fast');
                void navigate('/fast', { navigationType: 'traverse' });
            });
        });
        window.history.replaceState(initial, '', '/start');
        expect(await navigate('/start', { navigationType: 'traverse' })).toMatchObject({ outcome: 'failed' });
        expect(window.location.pathname).toBe('/fast'); expect(document.querySelector('#app')!.textContent).toBe('/fast');
        expect(window.history.go).toHaveBeenCalledWith(1); expect(fetch).toHaveBeenCalledOnce();
    });

    it('bounds a history restoration that never produces the expected browser event', async () => {
        const initial = window.history.state;
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast'))); await navigate('/fast');
        fixture.guard = async () => true;
        vi.spyOn(window.history, 'go').mockImplementation(() => {});
        window.history.replaceState(initial, '', '/start'); vi.useFakeTimers();
        const result = navigate('/start', { navigationType: 'traverse' });
        await vi.advanceTimersByTimeAsync(2001);
        expect(await result).toMatchObject({ outcome: 'failed', error: { code: 'COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED' } });
    });

    it.each(['page', 'layout'] as const)('does not publish a superseded %s import into live state', async delayed => {
        let release!: (module: any) => void;
        const gate = new Promise<any>(resolve => { release = resolve; });
        const loader = fixture.registry.pages['/src/pages/slow/index.ts'];
        const layoutCreated = vi.fn(); class Layout extends Component { constructor() { super(); layoutCreated(); } }
        if (delayed === 'page') fixture.registry.pages['/src/pages/slow/index.ts'] = () => gate;
        else fixture.registry.layouts['/src/pages/delayed/layout.ts'] = () => gate;
        const fetcher = vi.fn(async (target: string) => delayed === 'layout' && target === '/slow'
            ? new Response(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({ routePath: '/slow', pathname: '/slow',
                _layout_stack: [{ path: '/src/pages/delayed/layout.ts', state: { public: {} } }],
            })}</script>`) : documentResponse(target.slice(1)));
        vi.stubGlobal('fetch', fetcher);
        try {
            const older = navigate('/slow'); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(window.__INITIAL_STATE__.pathname).toBe('/start'); expect(document.querySelector('#app')!.textContent).toBe('/start');
            const newer = navigate('/fast'); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
            release({ default: delayed === 'page' ? Component : Layout });
            expect(await older).toMatchObject({ outcome: 'superseded' }); expect(await newer).toMatchObject({ outcome: 'completed' });
            expect(fixture.bootstrapUrls).not.toContain('/slow'); expect(layoutCreated).not.toHaveBeenCalled();
            expect(window.__INITIAL_STATE__.pathname).toBe('/fast'); expect(document.querySelector('#app')!.textContent).toBe('/fast');
        } finally { release({ default: Component }); fixture.registry.pages['/src/pages/slow/index.ts'] = loader; }
    });
    it('retains a layout when only its child page changes from SSE to HTTP', async () => {
        const created = vi.fn(); const destroyed = vi.fn(); const hydrate = vi.fn();
        class Layout extends Component {
            constructor() { super(); created(); }
            override destroy() { destroyed(); }
            _frameworkHydrateNavigationResources = hydrate;
        }
        fixture.registry.layouts['/src/pages/layout.ts'] = async () => ({ default: Layout });
        vi.stubGlobal('fetch', vi.fn(async (target: string) => new Response(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({
            routePath: target, pathname: target, transport: target === '/slow' ? 'sse' : 'http', scopeKey: 'same-user',
            _layout_stack: [{ path: '/src/pages/layout.ts', state: { public: {}, metadata: { componentId: 'layout' } } }],
        })}</script>`)));
        expect(await navigate('/slow')).toMatchObject({ outcome: 'completed' });
        expect(await navigate('/fast')).toMatchObject({ outcome: 'completed' });
        expect(created).toHaveBeenCalledOnce(); expect(destroyed).not.toHaveBeenCalled(); expect(hydrate).toHaveBeenCalledOnce();
    });
    it('merges rapid query patches and discards late responses without changing the pending address', async () => {
        const { defineUrlState, url } = await import('@cossackframework/core');
        const fields = defineUrlState({ search: url.string(), page: url.integer({ default: 1 }) });
        const source = window.location.href;
        let release!: (response: Response) => void;
        const olderResponse = new Promise<Response>(resolve => { release = resolve; });
        vi.stubGlobal('fetch', vi.fn(async (target: string) => target.includes('page=2') ? olderResponse : documentResponse('start')));
        const older = Cossack._onUpdateUrlState!(source, base => fields.url(base, { page: 2 }), () => true);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(window.location.search).toBe('');
        const newer = Cossack._onUpdateUrlState!(source, base => fields.url(base, { search: 'next', page: 3 }), () => true);
        expect(await newer).toEqual({ outcome: 'completed', url: '/start?page=3&search=next' });
        release(documentResponse('start')); expect(await older).toMatchObject({ outcome: 'superseded' });
        expect(window.location.search).toBe('?page=3&search=next');
        expect(await Cossack._onUpdateUrlState!(source, base => fields.url(base, { page: 4 }), () => true)).toMatchObject({ outcome: 'canceled' });
    });

    it('keeps separate declaration patches while one query request is pending', async () => {
        const { defineUrlState, url } = await import('@cossackframework/core');
        const paging = defineUrlState({ page: url.integer({ default: 1 }) });
        const search = defineUrlState({ search: url.string() });
        const source = window.location.href;
        let release!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(async (target: string) => target === '/start?page=2'
            ? new Promise<Response>(resolve => { release = resolve; }) : documentResponse('start')));
        const older = Cossack._onUpdateUrlState!(source, base => paging.url(base, { page: 2 }), () => true);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(await Cossack._onUpdateUrlState!(source, base => search.url(base, { search: '雪' }), () => true))
            .toEqual({ outcome: 'completed', url: '/start?page=2&search=%E9%9B%AA' });
        release(documentResponse('start')); expect(await older).toMatchObject({ outcome: 'superseded' });
    });

    it('clears canceled and failed query intents before the next patch', async () => {
        const { defineUrlState, url } = await import('@cossackframework/core');
        const fields = defineUrlState({ search: url.string(), page: url.integer({ default: 1 }) });
        const source = window.location.href;
        const update = (patch: { page?: number; search?: string }) => Cossack._onUpdateUrlState!(source, base => fields.url(base, patch), () => true);
        fixture.guard = async () => true;
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        expect(await update({ page: 2 })).toMatchObject({ outcome: 'canceled' }); expect(fetch).not.toHaveBeenCalled();
        fixture.guard = async () => false;
        expect(await update({ page: 3 })).toMatchObject({ outcome: 'failed' });
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('start')));
        expect(await update({ search: 'next' })).toEqual({ outcome: 'completed', url: '/start?search=next' });
    });

    it('does not commit a query response after its source owner is disposed', async () => {
        let active = true; let release!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>(resolve => { release = resolve; })));
        const update = Cossack._onUpdateUrlState!(window.location.href, () => '/start?page=2', () => active);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); active = false;
        release(documentResponse('start'));
        expect(await update).toMatchObject({ outcome: 'canceled' }); expect(window.location.search).toBe('');
    });

    it('does not merge an abandoned patch from a disposed owner into a live layout update', async () => {
        const { defineUrlState, url } = await import('@cossackframework/core');
        const fields = defineUrlState({ search: url.string(), page: url.integer({ default: 1 }) });
        let active = true; let release!: (response: Response) => void;
        const source = window.location.href;
        vi.stubGlobal('fetch', vi.fn(async (target: string) => target.includes('page=2')
            ? new Promise<Response>(resolve => { release = resolve; }) : documentResponse('start')));
        const abandoned = Cossack._onUpdateUrlState!(source, base => fields.url(base, { page: 2 }), () => active);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); active = false;
        expect(await Cossack._onUpdateUrlState!(source, base => fields.url(base, { search: 'live' }), () => true))
            .toEqual({ outcome: 'completed', url: '/start?search=live' });
        release(documentResponse('start')); expect(await abandoned).toMatchObject({ outcome: 'superseded' });
    });
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
        expect(document.querySelector('#app')!.textContent).toBe('/start');
        expect(fixture.page.path).toBe('/start');
        expect(window.__INITIAL_STATE__.pathname).toBe('/start');
        const newer = navigate('/fast');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(await older).toMatchObject({ outcome: 'superseded' });
        expect(await newer).toMatchObject({ outcome: 'completed' });
        release();
        await Promise.resolve(); await Promise.resolve();
        expect(document.querySelector('#app')!.textContent).toBe('/fast');
        expect(window.location.pathname).toBe('/fast');
    });

    it('keeps the committed page alive when preparation fails', async () => {
        let reject!: (error: Error) => void;
        fixture.bootstrapGate = new Promise<void>((_resolve, no) => { reject = no; });
        const previous = fixture.page;
        const destroyed = vi.spyOn(previous, 'destroy');
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('slow')));
        const pending = navigate('/slow');
        await vi.waitFor(() => expect(fixture.bootstrapStarted).toBe(true));
        reject(new Error('preparation failed'));
        expect(await pending).toMatchObject({ outcome: 'failed' });
        expect(fixture.page).toBe(previous);
        expect(destroyed).not.toHaveBeenCalled();
        expect(document.querySelector('#app')!.textContent).toBe('/start');
        expect(window.__INITIAL_STATE__.pathname).toBe('/start');
    });

    it('keeps the committed page when a local draft cannot be snapshotted', async () => {
        const previous = fixture.page;
        const destroyed = vi.spyOn(previous, 'destroy');
        previous._frameworkCaptureClientDraft = () => {
            throw Object.assign(new Error('draft accessor'), { code: 'COSSACK_NAVIGATION_DRAFT_ACCESSOR' });
        };
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('start')));
        expect(await navigate('/start?next=1')).toMatchObject({
            outcome: 'failed', error: { code: 'COSSACK_NAVIGATION_DRAFT_ACCESSOR' },
        });
        expect(fixture.page).toBe(previous);
        expect(destroyed).not.toHaveBeenCalled();
        expect(window.location.search).toBe('');
        expect(window.__INITIAL_STATE__.pathname).toBe('/start');
    });

    it.each(['error', 'veto'])('restores the prior page after render %s without destroying its owner', async failure => {
        const previous = fixture.page;
        const destroyed = vi.spyOn(previous, 'destroy');
        fixture.renderError = failure === 'error';
        fixture.renderSkip = failure === 'veto';
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('slow')));
        const result = await navigate('/slow');
        expect(result).toMatchObject({ outcome: 'failed' });
        if (failure === 'veto') expect(result.error).toMatchObject({ code: 'COSSACK_NAVIGATION_RENDER_SKIPPED' });
        await vi.waitFor(() => expect(document.querySelector('#app')!.textContent).toBe('/start'));
        expect(fixture.page).toBe(previous);
        expect(destroyed).not.toHaveBeenCalled();
        expect(window.__INITIAL_STATE__.pathname).toBe('/start');
        expect(window.location.pathname).toBe('/start');
    });

    it('recovers before a newer navigation while an obsolete render remains pending', async () => {
        let release!: () => void;
        fixture.renderGate = new Promise<void>(resolve => { release = resolve; });
        vi.stubGlobal('fetch', vi.fn(async (url: string) => documentResponse(url.slice(1))));
        const older = navigate('/slow');
        await vi.waitFor(() => expect(fixture.renderStarted).toBe(true));
        expect(await navigate('/fast')).toMatchObject({ outcome: 'completed' });
        expect(await older).toMatchObject({ outcome: 'superseded' });
        release();
        await Promise.resolve(); await Promise.resolve();
        expect(document.querySelector('#app')!.textContent).toBe('/fast');
        expect(window.location.pathname).toBe('/fast');
        expect(window.__INITIAL_STATE__.pathname).toBe('/fast');
    });

    it('restores page ownership after a render deadline and allows a later commit', async () => {
        const previous = fixture.page;
        fixture.renderGate = new Promise<void>(() => {});
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(async (url: string) => documentResponse(url.slice(1))));
        const pending = navigate('/slow');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await pending).toMatchObject({ outcome: 'failed', error: { code: 'COSSACK_NAVIGATION_TIMEOUT' } });
        expect(fixture.page).toBe(previous);
        expect(document.querySelector('#app')!.textContent).toBe('/start');
        expect(await navigate('/fast')).toMatchObject({ outcome: 'completed' });
    });

    it.each(['guard', 'bootstrap'])('bounds an unresponsive %s and permits a later navigation', async boundary => {
        vi.useFakeTimers();
        if (boundary === 'guard') fixture.guard = () => new Promise<boolean>(() => {});
        else fixture.bootstrapGate = new Promise<void>(() => {});
        vi.stubGlobal('fetch', vi.fn(async (url: string) => documentResponse(url.slice(1))));
        const pending = navigate('/slow');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await pending).toMatchObject({ outcome: 'failed', error: { code: 'COSSACK_NAVIGATION_TIMEOUT' } });
        expect(window.location.pathname).toBe('/start');
        expect(fixture.page.path).toBe('/start');
        fixture.guard = async () => false;
        expect(await navigate('/fast')).toMatchObject({ outcome: 'completed' });
    });

    it.each(['module', 'transition'])('revokes publication after a stalled %s reaches its deadline', async boundary => {
        let lateCommit: (() => Promise<void>) | undefined;
        const path = '/src/pages/slow/index.ts';
        const loader = fixture.registry.pages[path];
        if (boundary === 'module') fixture.registry.pages[path] = () => new Promise(() => {});
        else {
            (document as any).startViewTransition = (update: () => Promise<void>) => {
                lateCommit = update;
                return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: new Promise(() => {}) };
            };
            navigate = (await createClientApp({ container: '#app', AppComponent: App, viewTransitions: true }))!.navigate;
        }
        try {
            vi.useFakeTimers();
            vi.stubGlobal('fetch', vi.fn(async () => documentResponse('slow')));
            const previous = fixture.page;
            const pending = navigate('/slow');
            await vi.advanceTimersByTimeAsync(30_000);
            expect(await pending).toMatchObject({ outcome: 'failed', error: { code: 'COSSACK_NAVIGATION_TIMEOUT' } });
            if (boundary === 'transition') {
                expect(lateCommit).toBeDefined();
                await expect(lateCommit!()).rejects.toMatchObject({ code: 'COSSACK_NAVIGATION_TIMEOUT' });
            }
            expect(fixture.page).toBe(previous);
            expect(window.location.pathname).toBe('/start');
            expect(window.__INITIAL_STATE__.pathname).toBe('/start');
        } finally {
            fixture.registry.pages[path] = loader;
            delete (document as any).startViewTransition;
        }
    });

    it('reports missing route modules as failures instead of successful navigations', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('missing')));
        expect(await navigate('/missing')).toMatchObject({ outcome: 'failed' });
        expect(window.location.pathname).toBe('/start');
    });
});


describe('development navigation diagnostics', () => {
    let events: any[];
    const collect = (event: Event) => events.push((event as CustomEvent).detail);
    beforeEach(() => { events = []; document.addEventListener('cossack:navigation-diagnostic', collect); });
    afterEach(() => { document.removeEventListener('cossack:navigation-diagnostic', collect); vi.unstubAllEnvs(); });

    it('correlates ordered decisions, cache reuse and invalidation without URL or state values', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => documentResponse('fast')));
        expect(await navigate('/fast?secret=private#private')).toMatchObject({outcome:'completed'});
        const first = events[0].navigationId;
        expect(events.map(event => event.phase)).toEqual(['start','cache','transition','layouts','scroll','finish']);
        expect(events.find(event => event.phase === 'cache').decision).toBe('miss');
        expect(events.at(-1)).toMatchObject({phase:'finish',outcome:'completed',committed:true});
        expect(events.every(event => event.version===1 && event.navigationId===first && Object.isFrozen(event))).toBe(true);
        expect(events.map(event => event.timestamp)).toEqual([...events.map(event => event.timestamp)].sort((a,b)=>a-b));
        expect(JSON.stringify(events)).not.toMatch(/private|secret|fast/);
        events.length=0;
        await navigate('/fast?secret=private#another');
        expect(events[0].navigationId).not.toBe(first);
        expect(events.find(event => event.phase==='cache').decision).toBe('hit');
        expect(fetch).toHaveBeenCalledOnce();
        (globalThis as any).__cossack_invalidatePageCache();
        expect(events.at(-1)).toMatchObject({phase:'invalidate',navigationId:null,entries:2});
        await navigate('/fast?secret=private');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reports cancellation and failure without a committed destination or raw error', async () => {
        fixture.guard=async()=>true;
        expect(await navigate('/slow')).toMatchObject({outcome:'canceled'});
        expect(events.map(event=>event.phase)).toEqual(['start','finish']);
        expect(events.at(-1)).toMatchObject({outcome:'canceled',committed:false});
        fixture.guard=async()=>false;
        vi.stubGlobal('fetch', vi.fn(async()=>{throw new Error('private failure');}));
        expect(await navigate('/fast')).toMatchObject({outcome:'failed'});
        expect(events.at(-1)).toMatchObject({outcome:'failed',committed:false});
        expect(JSON.stringify(events)).not.toContain('private failure');
    });

    it('distinguishes created, retained and retired layouts', async () => {
        class Layout extends Component {}
        fixture.registry.layouts['/src/pages/layout.ts']=async()=>({default:Layout});
        vi.stubGlobal('fetch', vi.fn(async(target:string)=>new Response(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({
            routePath:target,pathname:target,_layout_stack:target==='/final'?[]:[{path:'/src/pages/layout.ts',state:{public:{}}}],
        })}</script>`)));
        await navigate('/slow'); await navigate('/fast'); await navigate('/final');
        expect(events.filter(event=>event.phase==='layouts').map(({retained,created,retired,rootReplaced})=>({retained,created,retired,rootReplaced}))).toEqual([
            {retained:0,created:1,retired:0,rootReplaced:false},
            {retained:1,created:0,retired:0,rootReplaced:false},
            {retained:0,created:0,retired:1,rootReplaced:false},
        ]);
    });


    it('correlates a shared prefetch and superseded navigation independently', async () => {
        let release!: (response: Response) => void;
        const pending = new Promise<Response>(resolve=>{release=resolve;});
        vi.stubGlobal('fetch', vi.fn(async(target:string)=>target==='/slow'?pending:documentResponse('fast')));
        const core = await import('@cossackframework/core');
        const prefetch = vi.mocked(core.enableClientNavigation).mock.calls.at(-1)![1]!;
        await prefetch('/slow');
        const older = navigate('/slow');
        await vi.waitFor(()=>expect(events.some(event=>event.phase==='cache' && event.decision==='shared')).toBe(true));
        expect(await navigate('/fast')).toMatchObject({outcome:'completed'});
        expect(await older).toMatchObject({outcome:'superseded'});
        const finishes=events.filter(event=>event.phase==='finish');
        expect(finishes).toEqual(expect.arrayContaining([
            expect.objectContaining({outcome:'superseded',committed:false}),
            expect.objectContaining({outcome:'completed',committed:true}),
        ]));
        expect(new Set(finishes.map(event=>event.navigationId)).size).toBe(2);
        release(documentResponse('slow'));
    });

    it.each(['unsupported','callback','typed','types-unsupported'] as const)('reports the %s transition path', async mode => {
        const core = await import('@cossackframework/core');
        vi.spyOn(core,'supportsViewTransitionTypes').mockReturnValue(mode==='typed');
        if(mode!=='unsupported') (document as any).startViewTransition=(argument:any)=>{
            const update=typeof argument==='function'?argument:argument.update;
            return {ready:Promise.reject(new Error('animation only')),finished:Promise.resolve(),updateCallbackDone:Promise.resolve().then(update)};
        };
        try {
            navigate=(await createClientApp({container:'#app',AppComponent:App,viewTransitions:true}))!.navigate;
            vi.stubGlobal('fetch',vi.fn(async()=>documentResponse('fast')));
            await navigate('/fast',{types:mode==='typed'||mode==='types-unsupported'?['private-type']:undefined});
            expect(events.filter(event=>event.phase==='transition').map(event=>event.decision)).toEqual(
                mode==='unsupported'?['unsupported']:[mode,'animation-skipped']);
            expect(JSON.stringify(events)).not.toContain('private-type');
            expect(events.at(-1)).toMatchObject({phase:'finish',outcome:'completed'});
        } finally { delete (document as any).startViewTransition; }
    });

    it('does not emit diagnostics in production', async () => {
        vi.stubEnv('DEV',false);
        vi.stubGlobal('fetch', vi.fn(async()=>documentResponse('fast')));
        await navigate('/fast'); (globalThis as any).__cossack_invalidatePageCache();
        expect(events).toEqual([]);
    });
});
