// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server, State, Store } from '../src/shared/decorators';
import { collectReactiveMetadata } from '../src/shared/reactive-metadata';
import { callState, explainRequestTooLarge, recordStateWrites, replyState, unsentStateKeys } from '../src/shared/call-state';
import { bootstrapService, forwardServiceMethods, registerServiceState } from '../src/shared/service-bootstrap';
import { StateContainer } from '../src/shared/state-container';
import { proxyHttpMethods } from '../src/shared/method-proxy';
import { RpcError } from '../src/shared/rpc-stream';

class StormPage {
    @State() note = '';
    @State({ send: false }) storm: unknown = null;
    @Store({ send: false }) layers = { names: [] as string[] };
    @State({ send: true }) rows: string[] = [];
}

class MapService {
    @State({ send: false }) tiles: unknown = null;
    @Store() view = { zoom: 1 };
    @Server() async zoomIn() { this.view.zoom++; }
    @Server() async reset() { this.tiles = null; }
}

describe('send: false metadata', () => {
    it('lists the @State and @Store fields that calls do not send', () => {
        expect([...collectReactiveMetadata(StormPage).unsent].sort()).toEqual(['layers', 'storm']);
        const page = new StormPage();
        expect(callState(page, { note: 'n', storm: { big: true }, layers: {}, rows: [] })).toEqual({ note: 'n', rows: [] });
        // The reply keeps a send: false field only when the method assigned it.
        const state = { note: 'n', storm: null, layers: { names: [] }, rows: [] };
        expect(replyState(page, state, new Set())).toEqual({ note: 'n', rows: [] });
        expect(replyState(page, state, new Set(['storm']))).toEqual({ note: 'n', storm: null, rows: [] });
    });
});

describe('state write records', () => {
    it('record assignments of service fields, equal values and in-place store changes included', () => {
        const service = new MapService();
        bootstrapService(service);
        const outer = recordStateWrites(service);
        const inner = recordStateWrites(service);
        service.tiles = null;
        inner.stop();
        service.view.zoom = 3;
        outer.stop();
        expect([...inner.keys]).toEqual(['tiles']);
        expect([...outer.keys].sort()).toEqual(['tiles', 'view']);
    });

    it('carry an injected service: its send: false fields and its method writes belong to the component', async () => {
        const service = new MapService();
        bootstrapService(service);
        const component: any = { _stateContainer: new StateContainer(), isServer: true, hasMethod: () => false,
            _scheduleStateBroadcast: vi.fn() };
        registerServiceState(component, service);
        forwardServiceMethods(component, service);
        expect([...unsentStateKeys(component)]).toEqual(['tiles']);
        const writes = recordStateWrites(component);
        await component.reset();
        expect([...writes.keys]).toEqual(['tiles']);
    });
});

describe('HTTP calls from the browser', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    function makePage(state: Record<string, unknown>) {
        return {
            constructor: StormPage,
            __cossack_componentRouteId: 'storm-route-id',
            __cossack_proxies: new Map<string, (...args: any[]) => any>(),
            getInitialStateFromWindow: () => ({ componentRouteId: 'storm-route-id' }),
            getPublicState: () => state,
            loading: {} as Record<string, number>,
            requestUpdate: vi.fn(),
            setProperty: vi.fn(),
            hasMethod: () => false,
            _sseConnection: null,
        };
    }

    it('leave send: false fields out of the request', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ note: 'n', _cossack_return: 3 }));
        vi.stubGlobal('fetch', fetchMock);
        const page = makePage({ note: 'n', storm: { features: 'x'.repeat(4096) }, layers: { names: ['hail'] }, rows: ['a'] });
        proxyHttpMethods(page, [{ name: 'impacted' }]);
        await expect(page.__cossack_proxies.get('impacted')!(7, 2)).resolves.toBe(3);
        const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
        expect(body.state).toEqual({ note: 'n', rows: ['a'] });
        expect(body.payload).toEqual([7, 2]);
        expect(page.setProperty).not.toHaveBeenCalledWith('storm', expect.anything());
    });

    it('explain a request the server refused as too large: bytes sent and the largest state fields', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
            error: 'The request is over the 1048576-byte limit of server method calls (rpc.maxRequestBytes).',
            code: 'COSSACK_RPC_REQUEST_TOO_LARGE', requestId: 'r1',
        }, { status: 413 })));
        const page = makePage({ note: 'n', storm: { features: 'x'.repeat(4096) }, rows: ['y'.repeat(2500)] });
        proxyHttpMethods(page, [{ name: 'impacted' }]);
        const error = await page.__cossack_proxies.get('impacted')!(7, 2).catch((cause: unknown) => cause) as RpcError;
        expect(error).toBeInstanceOf(RpcError);
        expect(error.code).toBe('COSSACK_RPC_REQUEST_TOO_LARGE');
        expect(error.status).toBe(413);
        expect(error.requestId).toBe('r1');
        expect(error.message).toMatch(/^The request is over the 1048576-byte limit of server method calls \(rpc\.maxRequestBytes\)\. The call to 'impacted' sent 3 KB \(\d+ bytes\)\./);
        // The send: false field is not among the fields that made the call large.
        expect(error.message).toContain('its largest state fields are rows (3 KB), note (3 B)');
        expect(error.message).not.toContain('storm');
        expect(error.message).toContain('@State({ send: false })');
    });

    it('leave other errors as they are', () => {
        const other = new RpcError('COSSACK_RPC_FAILED', 'nope');
        expect(explainRequestTooLarge(other, { action: 'a', state: {} })).toBe(other);
        const upload = explainRequestTooLarge(new RpcError('COSSACK_RPC_REQUEST_TOO_LARGE', 'Too large.'), { action: 'a', state: {}, upload: true }) as RpcError;
        expect(upload.message).toBe("Too large. The call to 'a'. A call sends its arguments and the component's state. " +
            'Keep a large field out of calls with @State({ send: false }), or raise rpc.maxUploadBytes.');
    });
});
