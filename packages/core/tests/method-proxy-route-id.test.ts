import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRpcCallableAction, proxyHttpMethods } from '../src/shared/method-proxy';
import { Cossack } from '../src/shared/cossack';
import type { TemplateResult } from '@cossackframework/renderer';

describe('HTTP component RPC targeting', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses the hydrated component route ID instead of the active page route ID', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
        vi.stubGlobal('fetch', fetchMock);

        const component = {
            constructor: class DashboardLayout {},
            __cossack_componentRouteId: 'layout-route-id',
            __cossack_proxies: new Map<string, (...args: any[]) => any>(),
            getInitialStateFromWindow: () => ({
                componentRouteId: 'leaf-page-route-id',
                transport: 'http',
            }),
            getPublicState: () => ({}),
            loading: {} as Record<string, number>,
            requestUpdate: vi.fn(),
            _optimisticLockedKeys: {} as Record<string, Set<string>>,
            _optimisticPendingState: {} as Record<string, unknown>,
            _isOptimisticLocked: () => false,
            setProperty: vi.fn(),
        };

        proxyHttpMethods(component, [{ name: 'doLogout' }]);
        await component.__cossack_proxies.get('doLogout')?.();

        expect(fetchMock).toHaveBeenCalledOnce();
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toMatchObject({
            componentRouteId: 'layout-route-id',
            action: 'doLogout',
        });
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
