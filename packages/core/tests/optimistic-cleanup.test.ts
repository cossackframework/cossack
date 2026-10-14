import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectWebSocket } from '../src/shared/transport-connections';
import { proxyServerMethods } from '../src/shared/method-proxy';
import { ServiceScope } from '../src/shared/service-scope';
import { Server, Service, State } from '../src/shared/decorators';

/**
 * WebSocket transport cleanup: keep-alive teardown and completion broadcasts
 * that must not settle request-scoped calls or explicit service subscribers.
 */

class MockWebSocket {
    static OPEN = 1;
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
        getInitialStateFromWindow: () => ({
            providerTargets: { page: 'do-123' },
            routePath: '/src/pages/test',
        }),
        setProperty: vi.fn(function (this: any, key: string, val: unknown) { (this as any)[key] = val; }),
        requestUpdate: vi.fn(),
        hasMethod: () => false,
        getMethod: () => undefined,
    };
}

describe('WebSocket transport cleanup', () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
        (globalThis as any).window = { location: { host: 'localhost' } };
    });
    afterEach(() => {
        vi.restoreAllMocks();
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

    it('ignores uncorrelated completion broadcasts for a modern request-scoped call', async () => {
        const component = makeComponent() as any;
        component.count = 0;
        component.__cossack_proxies = new Map();
        component.consume = () => undefined;
        component.getPublicState = () => ({ count: component.count });
        component.getMethod = () => () => { component.count++; };
        Reflect.defineMetadata('cossack:state', { count: {} }, component.constructor);
        Reflect.defineMetadata('cossack:optimistic-handlers', { increment: 'preview' }, component.constructor);
        connectWebSocket(component);
        const ws = MockWebSocket.instances[0];
        proxyServerMethods(component, [{ name: 'increment', channel: 'global', provider: 'page' }]);
        const call = component.increment();
        const requestId = JSON.parse(ws.sent[0]).requestId;
        ws.receive({ type: 'state-update', state: { count: 5 } });
        ws.receive({ type: 'action-complete', action: 'increment' });
        expect(component.loading.increment).toBe(1); expect(component.count).toBe(1);
        ws.receive({ v: 1, type: 'done', requestId, value: 'ok', state: { count: 5 } });
        await call;
        expect(component.loading).toEqual({}); expect(component.count).toBe(5);
        ws.close();
    });

    it('does not settle an explicit service subscriber from an unrelated completion broadcast', async () => {
        @Service() class Counter {
            @State() count = 0;
            @Server() edit() { return 'server'; }
        }
        let reply!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { reply = resolve; })));
        const component = makeComponent() as any;
        connectWebSocket(component);
        const ws = MockWebSocket.instances[0];
        const scope = new ServiceScope(undefined, [Counter], { ownerRouteId: 'layout' });
        const off = scope.subscribe(Counter, component);
        const offSecond = scope.subscribe(Counter, component);
        const call = scope.resolve(Counter).edit();
        expect(component.loading.edit).toBe(1);
        ws.receive({ type: 'action-complete', action: 'edit' });
        expect(component.loading.edit).toBe(1);
        off();
        offSecond();
        const renders = component.requestUpdate.mock.calls.length;
        reply(new Response(JSON.stringify({ _cossack_return: 'ok', _cossack_service_state: { count: 2 } }), { headers: { 'Content-Type': 'application/json' } }));
        await call; expect(component.loading).toEqual({});
        expect(component.requestUpdate.mock.calls.length).toBe(renders);
        await scope.disposeAsync(); ws.close(); vi.unstubAllGlobals();
    });
});
