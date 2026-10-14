import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { proxyServerMethods } from '../src/shared/method-proxy';

/**
 * Verifies that object arguments are transported over WebSocket (regression:
 * the WS payload filter previously dropped ALL objects, so
 * this.updateItem({ id: 5 }) sent an empty payload), and that every call
 * follows the request-scoped realtime RPC contract.
 */

class MockWS {
    readyState = 1; // OPEN
    sent: string[] = [];
    send(data: string) { this.sent.push(data); }
    close() {}
}

function makeComponent() {
    const c: any = {
        constructor: class {},
        websockets: new Map(),
        __cossack_proxies: new Map(),
        loading: {},
        consume: () => undefined,
        hasMethod: () => false,
        getMethod: () => undefined,
        getPublicState: () => ({}),
        setProperty(key: string, val: unknown) { (this as any)[key] = val; },
        requestUpdate() {},
    };
    return c;
}

describe('WS payload keeps serializable objects', () => {
    it('sends plain-object arguments over WebSocket', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };

        proxyServerMethods(component, [{ name: 'updateItem', channel: 'global', provider: 'page' }]);

        // Call the proxied server method with an object argument.
        void component.updateItem({ id: 5, name: 'task' });

        expect(ws.sent.length).toBe(1);
        const msg = JSON.parse(ws.sent[0]);
        expect(msg.type).toBe('action');
        expect(typeof msg.requestId).toBe('string');
        expect(msg.action).toBe('updateItem');
        expect(msg.payload).toEqual([{ id: 5, name: 'task' }]);
    });

    it('keeps arrays and primitives and replaces DOM nodes / Events with null', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };

        proxyServerMethods(component, [{ name: 'mix', channel: 'global', provider: 'page' }]);

        const node = { nodeType: 1 } as any;
        void component.mix('keep', [1, 2, { a: 3 }], 42, node);

        const msg = JSON.parse(ws.sent[0]);
        // DOM node replaced with null (same as HTTP); primitive + array kept.
        expect(msg.payload).toEqual(['keep', [1, 2, { a: 3 }], 42, null]);
    });

    it('keeps positional parameters when an Event precedes other arguments', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };

        proxyServerMethods(component, [{ name: 'save', channel: 'global', provider: 'page' }]);

        void component.save(new Event('click'), 7);

        const msg = JSON.parse(ws.sent[0]);
        expect(msg.payload).toEqual([null, 7]);
    });

    it('rejects instead of crashing on circular references', async () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        proxyServerMethods(component, [{ name: 'circ', channel: 'global', provider: 'page' }]);

        const circular: any = { a: 1 };
        circular.self = circular;
        await expect(Promise.resolve(component.circ(circular)))
            .rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED' });
        expect(ws.sent.length).toBe(0);
        errSpy.mockRestore();
    });

    it('invalidates the client page cache only after a successful send', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };

        let invalidated = 0;
        (globalThis as any).__cossack_invalidatePageCache = () => { invalidated++; };
        try {
            proxyServerMethods(component, [{ name: 'doThing', channel: 'global', provider: 'page' }]);
            void component.doThing();
            expect(invalidated).toBe(1);
        } finally {
            delete (globalThis as any).__cossack_invalidatePageCache;
        }
    });

    it('retains the client page cache when serialization or send fails', async () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const invalidate = vi.fn();
        (globalThis as any).__cossack_invalidatePageCache = invalidate;

        try {
            proxyServerMethods(component, [{ name: 'doThing', channel: 'global', provider: 'page' }]);
            const circular: any = {};
            circular.self = circular;
            await expect(Promise.resolve(component.doThing(circular)))
                .rejects.toMatchObject({ code: 'COSSACK_RPC_SERIALIZATION_FAILED' });
            expect(invalidate).not.toHaveBeenCalled();

            ws.send = () => { throw new Error('send failed'); };
            await expect(Promise.resolve(component.doThing('serializable')))
                .rejects.toMatchObject({ code: 'COSSACK_RPC_TRANSPORT_FAILED' });
            expect(invalidate).not.toHaveBeenCalled();
        } finally {
            delete (globalThis as any).__cossack_invalidatePageCache;
            errSpy.mockRestore();
        }
    });
});
