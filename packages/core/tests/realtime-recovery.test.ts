import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginOptimisticCall, applyOptimisticState, finishOptimisticCall } from '../src/shared/optimistic-state';
import { connectSSE, disconnectSSE, disconnectWebSockets, wsPendingCalls, connectWebSocket, realtimeReconnectDelay, realtimeStatus } from '../src/shared/transport-connections';

/**
 * RT-19: realtime lifecycle and recovery. Connection status, bounded
 * WebSocket reconnect backoff, snapshot resynchronization markers, and
 * no-reconnect after intentional disposal.
 */

class MockEventSource {
    static CONNECTED = 1;
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 2;
    static instances: MockEventSource[] = [];
    readyState = 0;
    listeners = new Map<string, Array<(event: any) => void>>();
    constructor(public url: string) { MockEventSource.instances.push(this); }
    addEventListener(type: string, listener: (event: any) => void) {
        (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)!).push(listener);
    }
    close() { this.readyState = MockEventSource.CLOSED; }
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    emit(type: string, data: string, lastEventId?: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ data, lastEventId: lastEventId ?? '' });
        }
    }
}

class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) { MockWebSocket.instances.push(this); }
    send() {}
    close() { this.readyState = 3; }
}

function makeComponent() {
    return {
        constructor: class {},
        _phase: 'Mounted',
        websockets: new Map(),
        _sseConnection: undefined,
        requestUpdate: vi.fn(),
        setProperty(key: string, value: unknown) { (this as any)[key] = value; },
        _isOptimisticLocked: () => false,
        _optimisticLockedKeys: {},
        _optimisticPendingState: {},
        getInitialStateFromWindow: () => ({
            componentRouteId: 'cmp_sse',
            scopeKey: 'user:anonymous',
            providerTargets: { page: 'target-1' },
            routePath: '/page',
            metadata: { params: {}, pathname: '/page' },
        }),
        getPublicState: () => ({}),
        hasMethod: () => false,
        getMethod: () => undefined,
    };
}

describe('realtime recovery: SSE status', () => {
    beforeEach(() => {
        vi.stubGlobal('EventSource', MockEventSource);
        MockEventSource.instances.length = 0;
    });
    afterEach(() => vi.unstubAllGlobals());

    it('tracks connecting → open, delivery cursors, failures, and resync', () => {
        const component: any = makeComponent();
        connectSSE(component);
        const es = MockEventSource.instances[0];
        expect(realtimeStatus(component).sse.state).toBe('connecting');

        es.readyState = 1;
        es.onopen?.();
        expect(realtimeStatus(component).sse).toMatchObject({ state: 'open', attempts: 0 });

        es.emit('state-update', '{"count":3}', '7');
        expect(realtimeStatus(component).sse.lastEventId).toBe('7');

        es.onerror?.();
        expect(realtimeStatus(component).sse).toMatchObject({ state: 'reconnecting', attempts: 1 });
        expect(realtimeStatus(component).sse.lastError).toContain('reconnecting');

        // Recovery: open clears the error and resets attempts.
        es.onopen?.();
        expect(realtimeStatus(component).sse).toMatchObject({ state: 'open', attempts: 0, lastError: undefined });

        es.emit('resync', '{"cursor":9}', '9');
        expect(realtimeStatus(component).sse).toMatchObject({ resynced: true, lastEventId: 9 });
    });

    it.each(['open', 'resync'])('restores authoritative snapshots after %s without clearing active call ownership', trigger => {
        const component: any = makeComponent(); component.count = 0;
        connectSSE(component); const es = MockEventSource.instances[0]; es.onopen?.();
        const call = beginOptimisticCall(component, 'edit', () => { component.count = 3; }, ['count']);
        component.count = 99;
        applyOptimisticState(component, 'count', 30, call); finishOptimisticCall(call, true);
        es.emit('state-update', '{"count":30}'); expect(component.count).toBe(99);
        if (trigger === 'open') es.onopen?.(); else es.emit('resync', '{"cursor":9}');
        es.emit('state-update', '{"count":30}'); expect(component.count).toBe(30);
        const pending = beginOptimisticCall(component, 'edit', () => { component.count = 4; }, ['count']);
        if (trigger === 'open') es.onopen?.(); else es.emit('resync', '{"cursor":10}');
        es.emit('state-update', '{"count":31}'); expect(component.count).toBe(4);
        finishOptimisticCall(pending, false); expect(component.count).toBe(31);
    });

    it.each(['destroyed','replaced'] as const)('ignores every late SSE callback from a %s owner', reason => {
        const component: any = makeComponent(); component.count=1; component.loading={save:1};
        const action=vi.fn(); component.hasMethod=()=>true; component.getMethod=()=>action;
        Reflect.defineMetadata('cossack:event-handlers',{notice:['handle']},component.constructor);
        Reflect.defineMetadata('cossack:client-methods',{run:true},component.constructor);
        connectSSE(component); const source=MockEventSource.instances[0];
        const open=source.onopen!; const error=source.onerror!; open();
        if(reason==='destroyed') { component._phase='Destroyed'; disconnectSSE(component); }
        else connectSSE(component);
        component.requestUpdate.mockClear();
        open(); error();
        source.emit('resync','{"cursor":9}'); source.emit('state-update','{"count":99}','10');
        source.emit('action-complete','{"action":"save"}');
        source.emit('event','{"eventName":"notice","payload":[]}');
        source.emit('client-action','{"action":"run","payload":[]}');
        expect(source.readyState).toBe(MockEventSource.CLOSED);
        expect(component.count).toBe(1); expect(component.loading.save).toBe(1);
        expect(action).not.toHaveBeenCalled(); expect(component.requestUpdate).not.toHaveBeenCalled();
        expect(realtimeStatus(component).sse.state).toBe(reason==='destroyed'?'closed':'connecting');
        expect(realtimeStatus(component).sse.lastEventId).toBeUndefined();
        expect(realtimeStatus(component).sse.resynced).toBeUndefined();
        if(reason==='destroyed') { connectSSE(component); expect(MockEventSource.instances).toHaveLength(1); }
        else { MockEventSource.instances[1].onopen?.(); expect(realtimeStatus(component).sse.state).toBe('open'); }
    });

    it('stops retries after an authorization change and ignores late frames from that source', () => {
        const component: any = makeComponent(); component.count = 1;
        connectSSE(component); const source = MockEventSource.instances[0]; source.onopen?.();
        source.emit('authorization-error', '{"code":"COSSACK_REALTIME_AUTH_CHANGED","private":"ignored"}');
        expect(source.readyState).toBe(MockEventSource.CLOSED);
        expect(realtimeStatus(component).sse).toMatchObject({ state: 'closed', attempts: 0,
            lastError: 'Realtime authorization changed. Reload the page to reconnect.' });
        source.onerror?.(); source.onopen?.(); source.emit('state-update', '{"count":99}');
        expect(component.count).toBe(1); expect(realtimeStatus(component).sse.state).toBe('closed');
        expect(MockEventSource.instances).toHaveLength(1);
        connectSSE(component); const replacement = MockEventSource.instances[1]; replacement.onopen?.();
        source.emit('authorization-error', '{}');
        expect(replacement.readyState).not.toBe(MockEventSource.CLOSED);
        replacement.emit('state-update', '{"count":2}'); expect(component.count).toBe(2);
        disconnectSSE(component);
    });

    it('marks a permanently closed source as closed', () => {
        const component: any = makeComponent();
        connectSSE(component);
        const es = MockEventSource.instances[0];
        es.readyState = MockEventSource.CLOSED;
        es.onerror?.();
        expect(realtimeStatus(component).sse.state).toBe('closed');
    });
});

describe('realtime recovery: WebSocket reconnect', () => {
    beforeEach(() => {
        vi.stubGlobal('WebSocket', MockWebSocket);
        MockWebSocket.instances.length = 0;
        vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' }, search: '' });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('restores public authority after socket open while preserving a pending preview', () => {
        const component: any = makeComponent(); component.count = 0;
        connectWebSocket(component); const ws = MockWebSocket.instances[0]; ws.onopen?.();
        const call = beginOptimisticCall(component, 'edit', () => { component.count = 3; }, ['count']);
        component.count = 99; applyOptimisticState(component, 'count', 30, call); finishOptimisticCall(call, true);
        ws.onmessage?.({ data: JSON.stringify({ type: 'state-update', state: { count: 30 } }) });
        expect(component.count).toBe(99);
        ws.onopen?.();
        ws.onmessage?.({ data: JSON.stringify({ type: 'state-update', state: { count: 30 } }) });
        expect(component.count).toBe(30);
        const pending = beginOptimisticCall(component, 'edit', () => { component.count = 4; }, ['count']);
        ws.onopen?.();
        ws.onmessage?.({ data: JSON.stringify({ type: 'state-update', state: { count: 31 } }) });
        expect(component.count).toBe(4); finishOptimisticCall(pending, false); expect(component.count).toBe(31);
        component._phase = 'Destroyed'; ws.close(); ws.onclose?.();
    });

    it('reconnects with bounded exponential backoff and resets after open', () => {
        vi.useFakeTimers();
        try {
            const component: any = makeComponent();
            connectWebSocket(component);
            const first = MockWebSocket.instances[0];
            expect(realtimeStatus(component).websockets.page).toMatchObject({ state: 'connecting', attempts: 0 });

            first.onopen?.();
            expect(realtimeStatus(component).websockets.page.state).toBe('open');

            first.readyState = 3;
            first.onclose?.();
            expect(realtimeStatus(component).websockets.page).toMatchObject({ state: 'reconnecting', attempts: 1 });

            vi.advanceTimersByTime(realtimeReconnectDelay(1) - 1);
            expect(MockWebSocket.instances).toHaveLength(1);
            vi.advanceTimersByTime(1);
            expect(MockWebSocket.instances).toHaveLength(2);
            const second = MockWebSocket.instances[1];
            expect(component.websockets.get('page')).toBe(second);

            // The delay doubles per attempt and is bounded.
            expect(realtimeReconnectDelay(1)).toBe(500);
            expect(realtimeReconnectDelay(2)).toBe(1000);
            expect(realtimeReconnectDelay(7)).toBe(30_000);
            expect(realtimeReconnectDelay(50)).toBe(30_000);

            // A successful open resets the attempt counter and clears errors.
            second.onopen?.();
            expect(realtimeStatus(component).websockets.page).toMatchObject({ state: 'open', attempts: 0 });
            second.readyState = 3;
            second.onclose?.();
            expect(realtimeStatus(component).websockets.page.attempts).toBe(1);
            vi.advanceTimersByTime(500);
            expect(MockWebSocket.instances).toHaveLength(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['destroyed','replaced'] as const)('revokes late WebSocket callbacks and timers after %s ownership', reason => {
        vi.useFakeTimers();
        try {
            const component: any=makeComponent(); component.count=1; component.loading={save:1};
            const action=vi.fn(); component.hasMethod=()=>true; component.getMethod=()=>action;
            Reflect.defineMetadata('cossack:event-handlers',{notice:['handle']},component.constructor);
            Reflect.defineMetadata('cossack:client-methods',{run:true},component.constructor);
            connectWebSocket(component); const first=MockWebSocket.instances[0]; first.onopen?.();
            const callbacks={open:first.onopen!,message:first.onmessage!,close:first.onclose!,error:first.onerror!};
            const sink=vi.fn(); wsPendingCalls(first as any).set('pending',sink);
            if(reason==='destroyed') { component._phase='Destroyed'; disconnectWebSockets(component); }
            else connectWebSocket(component);
            expect(sink).toHaveBeenCalledOnce();
            expect(sink.mock.calls[0][0]).toMatchObject({type:'error',code:'COSSACK_RPC_TRANSPORT_CLOSED'});
            expect(wsPendingCalls(first as any).size).toBe(0);
            component.requestUpdate.mockClear();
            callbacks.open(); callbacks.error(); callbacks.close(); callbacks.close();
            for(const frame of [
                {type:'state-update',state:{count:99}}, {type:'action-complete',action:'save'},
                {type:'event',eventName:'notice',payload:[]}, {type:'client-action',action:'run',payload:[]},
            ]) callbacks.message({data:JSON.stringify(frame)});
            expect(component.count).toBe(1); expect(component.loading.save).toBe(1);
            expect(action).not.toHaveBeenCalled(); expect(component.requestUpdate).not.toHaveBeenCalled();
            vi.advanceTimersByTime(60_000);
            expect(MockWebSocket.instances).toHaveLength(reason==='destroyed'?1:2);
            expect(realtimeStatus(component).websockets.page.state).toBe(reason==='destroyed'?'closed':'connecting');
            if(reason==='destroyed') {connectWebSocket(component);expect(MockWebSocket.instances).toHaveLength(1);}
            else {MockWebSocket.instances[1].onopen?.();expect(realtimeStatus(component).websockets.page.state).toBe('open');}
            disconnectWebSockets(component); expect(vi.getTimerCount()).toBe(0);
        } finally {vi.useRealTimers();}
    });

    it('cancels a pending reconnect immediately when its provider is retired', () => {
        vi.useFakeTimers();
        try {
            const component:any=makeComponent(); connectWebSocket(component);
            const socket=MockWebSocket.instances[0]; socket.onclose?.(); socket.onclose?.();
            expect(vi.getTimerCount()).toBe(1);
            disconnectWebSockets(component); expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(60_000); expect(MockWebSocket.instances).toHaveLength(1);
        } finally {vi.useRealTimers();}
    });

    it('does not reconnect after intentional disposal', () => {
        vi.useFakeTimers();
        try {
            const component: any = makeComponent();
            connectWebSocket(component);
            const first = MockWebSocket.instances[0];
            first.onopen?.();
            (first as any).__cossack_intentional_close = true;
            first.readyState = 3;
            first.onclose?.();
            expect(realtimeStatus(component).websockets.page.state).toBe('closed');
            vi.advanceTimersByTime(60_000);
            expect(MockWebSocket.instances).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not reconnect a destroyed component', () => {
        vi.useFakeTimers();
        try {
            const component: any = makeComponent();
            connectWebSocket(component);
            const first = MockWebSocket.instances[0];
            first.readyState = 3;
            first.onclose?.();
            component._phase = 'Destroyed';
            vi.advanceTimersByTime(60_000);
            expect(MockWebSocket.instances).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
