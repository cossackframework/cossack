// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyServerMethods } from '../src/shared/method-proxy';
import { connectWebSocket, disconnectWebSocket } from '../src/shared/transport-connections';
import { rpc$ } from '../src/shared/rpc-stream';

/**
 * A call made while the component's socket is connecting or reconnecting
 * waits for it to open and then dispatches, instead of failing with
 * "The realtime connection is not open".
 */

class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) { MockWebSocket.instances.push(this); }
    send(data: string) { this.sent.push(data); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    reply(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

function makeComponent() {
    return {
        constructor: class {},
        _phase: 'Mounted',
        _frameworkBootstrapped: true,
        websocket: undefined,
        __cossack_proxies: new Map(),
        loading: {},
        consume: () => undefined,
        requestUpdate: vi.fn(),
        setProperty(key: string, value: unknown) { (this as any)[key] = value; },
        getInitialStateFromWindow: () => ({
            componentRouteId: 'cmp_ws',
            scopeKey: 'user:anonymous',
            realtimeTarget: 'target-1',
            routePath: '/page',
            metadata: { params: {}, pathname: '/page' },
        }),
        getPublicState: () => ({}),
        hasMethod: () => false,
        getMethod: () => undefined,
    };
}

const done = (ws: MockWebSocket, value: unknown) => {
    const { requestId } = JSON.parse(ws.sent.at(-1)!);
    ws.reply({ v: 1, type: 'done', requestId, value, state: {} });
};

describe('calls while the realtime socket is pending', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('WebSocket', MockWebSocket);
        MockWebSocket.instances.length = 0;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('dispatches a call made before the first open once the socket opens', async () => {
        const component: any = makeComponent();
        connectWebSocket(component);
        proxyServerMethods(component, [{ name: 'increment', channel: 'global' }]);
        const ws = MockWebSocket.instances[0];

        const call = component.increment();
        await vi.advanceTimersByTimeAsync(0);
        expect(ws.sent).toEqual([]);

        ws.open();
        await vi.advanceTimersByTimeAsync(0);
        expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'action', action: 'increment' });
        done(ws, 1);
        await expect(call).resolves.toBe(1);
        disconnectWebSocket(component);
    });

    it('dispatches on the new socket after a reconnect', async () => {
        const component: any = makeComponent();
        connectWebSocket(component);
        proxyServerMethods(component, [{ name: 'increment', channel: 'global' }]);
        MockWebSocket.instances[0].open();
        MockWebSocket.instances[0].readyState = 3;
        MockWebSocket.instances[0].onclose?.();

        const call = component.increment();
        await vi.advanceTimersByTimeAsync(500);
        const next = MockWebSocket.instances[1];
        expect(next).toBeDefined();
        next.open();
        await vi.advanceTimersByTimeAsync(0);
        expect(MockWebSocket.instances[0].sent).toEqual([]);
        done(next, 2);
        await expect(call).resolves.toBe(2);
        disconnectWebSocket(component);
    });

    it('fails undispatched when the socket does not open in time', async () => {
        const component: any = makeComponent();
        connectWebSocket(component);
        proxyServerMethods(component, [{ name: 'increment', channel: 'global' }]);

        const call = component.increment();
        const settled = expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TRANSPORT_UNAVAILABLE' });
        await vi.advanceTimersByTimeAsync(10_000);
        await settled;
        expect(MockWebSocket.instances[0].sent).toEqual([]);
        disconnectWebSocket(component);
    });

    it('applies an rpc$ timeout and cancellation to the wait', async () => {
        const component: any = makeComponent();
        connectWebSocket(component);
        proxyServerMethods(component, [{ name: 'increment', channel: 'global' }]);

        const timed = rpc$(() => component.increment(), { timeout: 100 });
        const timedOut = expect(timed).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(100);
        await timedOut;

        const cancelled = component.increment();
        const settled = expect(cancelled).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await cancelled.cancel();
        await settled;
        MockWebSocket.instances[0].open();
        await vi.advanceTimersByTimeAsync(0);
        expect(MockWebSocket.instances[0].sent).toEqual([]);
        disconnectWebSocket(component);
    });

    it('fails at once when the component has no realtime connection', () => {
        const component: any = makeComponent();
        proxyServerMethods(component, [{ name: 'increment', channel: 'global' }]);
        return expect(component.increment()).rejects.toMatchObject({ code: 'COSSACK_RPC_TRANSPORT_UNAVAILABLE' });
    });
});
