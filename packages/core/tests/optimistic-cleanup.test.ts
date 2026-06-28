import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectWebSocket } from '../src/shared/transport-connections';

/**
 * Verifies the optimistic-lock cleanup on `action-complete`: the locked-keys
 * set must be captured BEFORE it is deleted, so the corresponding buffered
 * pending-state entries are actually freed. Previously the delete happened
 * first, leaving _optimisticPendingState to grow without bound.
 */

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    readyState = 1; // OPEN
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sent: string[] = [];
    closed = false;
    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }
    send(data: string) { this.sent.push(data); }
    close() {
        this.readyState = 3;
        this.closed = true;
        this.onclose?.();
    }
    // helper to inject a server message
    receive(obj: unknown) {
        this.onmessage?.({ data: JSON.stringify(obj) });
    }
}

function makeComponent() {
    return {
        constructor: class Fake {},
        websockets: new Map(),
        loading: {} as Record<string, number>,
        _optimisticLockedKeys: {} as Record<string, Set<string>>,
        _optimisticPendingState: {} as Record<string, unknown>,
        getInitialStateFromWindow: () => ({
            providerTargets: { page: 'do-123' },
            routePath: '/src/pages/test',
        }),
        _isOptimisticLocked(key: string) {
            for (const action of Object.keys(this._optimisticLockedKeys)) {
                if (this.loading[action] && this._optimisticLockedKeys[action]?.has(key)) return true;
            }
            return false;
        },
        setProperty: vi.fn(function (this: any, key: string, val: unknown) { (this as any)[key] = val; }),
        requestUpdate: vi.fn(),
        hasMethod: () => false,
        getMethod: () => undefined,
    };
}

describe('optimistic-lock cleanup on action-complete (WS)', () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
        (globalThis as any).window = { location: { host: 'localhost' } };
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('frees _optimisticPendingState entries when the action completes', () => {
        const component = makeComponent() as any;
        connectWebSocket(component);
        const ws = MockWebSocket.instances[0];

        // Simulate an optimistic action that locks keys 'count' and 'name'.
        component.loading.increment = 1;
        component._optimisticLockedKeys.increment = new Set(['count', 'name']);
        // A state-update arrives while locked → buffered in pending state.
        ws.receive({ type: 'state-update', state: { count: 42, name: 'buffered', extra: 'applied' } });
        expect(component._optimisticPendingState.count).toBe(42);
        expect(component._optimisticPendingState.name).toBe('buffered');
        // 'extra' was not locked → applied directly via setProperty.
        expect(component.setProperty).toHaveBeenCalledWith('extra', 'applied');

        // Action completes → lock released and buffered pending state discarded.
        ws.receive({ type: 'action-complete', action: 'increment' });

        expect(component._optimisticLockedKeys.increment).toBeUndefined();
        expect(component._optimisticPendingState.count).toBeUndefined();
        expect(component._optimisticPendingState.name).toBeUndefined();
    });

    it('does not clear pending state for a different action still in flight', () => {
        const component = makeComponent() as any;
        connectWebSocket(component);
        const ws = MockWebSocket.instances[0];

        component.loading.inc = 1;
        component.loading.other = 1;
        component._optimisticLockedKeys.inc = new Set(['count']);
        component._optimisticLockedKeys.other = new Set(['name']);
        component._optimisticPendingState.count = 1;
        component._optimisticPendingState.name = 2;

        // Only 'inc' completes.
        ws.receive({ type: 'action-complete', action: 'inc' });

        expect(component._optimisticPendingState.count).toBeUndefined();
        // 'other' is still in flight → its pending state must remain.
        expect(component._optimisticPendingState.name).toBe(2);
    });

    it('clears the keep-alive ping interval when the socket closes', () => {
        const cleared: number[] = [];
        const realSetInterval = globalThis.setInterval;
        const realClearInterval = globalThis.clearInterval;
        let nextId = 100;
        const live = new Set<number>();
        (globalThis as any).setInterval = (fn: () => void, ms: number) => {
            const id = nextId++;
            live.add(id);
            return id;
        };
        (globalThis as any).clearInterval = (id: number) => {
            cleared.push(id);
            live.delete(id);
        };

        try {
            const component = makeComponent() as any;
            connectWebSocket(component);
            const ws = MockWebSocket.instances[0];

            // Simulate destroy() closing the websocket.
            ws.close();
            expect(cleared.length).toBe(1);
        } finally {
            (globalThis as any).setInterval = realSetInterval;
            (globalThis as any).clearInterval = realClearInterval;
        }
    });
});
