import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRpcCallableAction, proxyHttpMethods } from '../src/shared/method-proxy';
import { Cossack } from '../src/shared/cossack';
import type { TemplateResult } from '@cossackframework/renderer';

describe('HTTP component RPC targeting', () => {
    afterEach(() => {
        delete (globalThis as any).__cossack_invalidatePageCache;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function makeComponent(transport: 'http' | 'sse' = 'http') {
        return {
            constructor: class DashboardLayout {},
            __cossack_componentRouteId: 'layout-route-id',
            __cossack_proxies: new Map<string, (...args: any[]) => any>(),
            getInitialStateFromWindow: () => ({
                componentRouteId: 'leaf-page-route-id',
                transport,
            }),
            getPublicState: () => ({}),
            loading: {} as Record<string, number>,
            requestUpdate: vi.fn(),
            _optimisticLockedKeys: {} as Record<string, Set<string>>,
            _optimisticPendingState: {} as Record<string, unknown>,
            _isOptimisticLocked: () => false,
            setProperty: vi.fn(),
            hasMethod: () => false,
            _sseConnection: null,
        };
    }

    it('uses the hydrated component route ID instead of the active page route ID', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
        vi.stubGlobal('fetch', fetchMock);

        const component = makeComponent();

        proxyHttpMethods(component, [{ name: 'doLogout' }]);
        await component.__cossack_proxies.get('doLogout')?.();

        expect(fetchMock).toHaveBeenCalledOnce();
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toMatchObject({
            componentRouteId: 'layout-route-id',
            action: 'doLogout',
        });
    });

    it('invalidates only after a successful HTTP response has been decoded', async () => {
        let resolveFetch!: (value: unknown) => void;
        const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
        vi.stubGlobal('fetch', vi.fn(() => fetchPromise));
        const invalidate = vi.fn();
        (globalThis as any).__cossack_invalidatePageCache = invalidate;
        const component = makeComponent();

        proxyHttpMethods(component, [{ name: 'save' }]);
        const pending = component.__cossack_proxies.get('save')?.();
        expect(invalidate).not.toHaveBeenCalled();

        resolveFetch({
            ok: true,
            json: async () => ({ _cossack_return: 'saved' }),
        });
        await expect(pending).resolves.toBe('saved');
        expect(invalidate).toHaveBeenCalledOnce();
    });

    it('retains the cache for failed HTTP responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'save failed' }),
        }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const invalidate = vi.fn();
        (globalThis as any).__cossack_invalidatePageCache = invalidate;
        const component = makeComponent();

        proxyHttpMethods(component, [{ name: 'save' }]);
        await component.__cossack_proxies.get('save')?.();
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('invalidates a successful SSE RPC before processing its redirect', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ _cossack_redirect: '/fresh-detail' }),
        }));
        const order: string[] = [];
        (globalThis as any).__cossack_invalidatePageCache = () => order.push('invalidate');
        vi.stubGlobal('window', {
            location: {
                set href(_value: string) {
                    order.push('redirect');
                },
            },
        });
        const component = makeComponent('sse');

        proxyHttpMethods(component, [{ name: 'save' }]);
        await component.__cossack_proxies.get('save')?.();
        expect(order).toEqual(['invalidate', 'redirect']);
    });

    it('invalidates successful uploads and retains the cache for failed uploads', async () => {
        class FakeXhr {
            static status = 200;
            upload: { onprogress?: (event: ProgressEvent) => void } = {};
            status = FakeXhr.status;
            responseText = '{}';
            onload?: () => void;
            onerror?: () => void;
            open() {}
            send() {
                this.status = FakeXhr.status;
                this.onload?.();
            }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        const invalidate = vi.fn();
        (globalThis as any).__cossack_invalidatePageCache = invalidate;
        const component = makeComponent();
        proxyHttpMethods(component, [{ name: 'upload' }]);

        await component.__cossack_proxies.get('upload')?.(
            new File(['data'], 'example.txt'),
        );
        expect(invalidate).toHaveBeenCalledOnce();

        FakeXhr.status = 500;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await component.__cossack_proxies.get('upload')?.(
            new File(['data'], 'failed.txt'),
        );
        expect(invalidate).toHaveBeenCalledOnce();
    });

    it('keeps the universal redirect helper local instead of exposing it as RPC', () => {
        class RedirectingComponent extends Cossack {
            render(): TemplateResult {
                return { strings: [], values: [] } as unknown as TemplateResult;
            }
        }

        expect(isRpcCallableAction(RedirectingComponent, 'redirect')).toBe(false);
    });
});
