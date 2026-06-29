import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { proxyServerMethods } from '../src/shared/method-proxy';

/**
 * Verifies that object arguments are transported over WebSocket (regression:
 * the WS payload filter previously dropped ALL objects, so
 * this.updateItem({ id: 5 }) sent an empty payload).
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
        component.updateItem({ id: 5, name: 'task' });

        expect(ws.sent.length).toBe(1);
        const msg = JSON.parse(ws.sent[0]);
        expect(msg.type).toBe('action');
        expect(msg.action).toBe('updateItem');
        expect(msg.payload).toEqual([{ id: 5, name: 'task' }]);
    });

    it('keeps arrays and primitives, drops DOM nodes / Events / functions', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };

        proxyServerMethods(component, [{ name: 'mix', channel: 'global', provider: 'page' }]);

        const node = { nodeType: 1 } as any;
        const fn = () => {};
        component.mix('keep', [1, 2, { a: 3 }], 42, node, fn);

        const msg = JSON.parse(ws.sent[0]);
        // DOM node and function dropped; primitive + array kept.
        expect(msg.payload).toEqual(['keep', [1, 2, { a: 3 }], 42]);
    });

    it('does not crash on circular references (logs and skips send)', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        proxyServerMethods(component, [{ name: 'circ', channel: 'global', provider: 'page' }]);

        const circular: any = { a: 1 };
        circular.self = circular;
        component.circ(circular);

        expect(ws.sent.length).toBe(0);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it('invokes the client page-cache invalidation hook on dispatch', () => {
        const component = makeComponent();
        const ws = new MockWS();
        component.websockets.set('page', ws as any);
        (globalThis as any).WebSocket = { OPEN: 1 };

        let invalidated = 0;
        (globalThis as any).__cossack_invalidateCurrentPage = () => { invalidated++; };
        try {
            proxyServerMethods(component, [{ name: 'doThing', channel: 'global', provider: 'page' }]);
            component.doThing();
            expect(invalidated).toBe(1);
        } finally {
            delete (globalThis as any).__cossack_invalidateCurrentPage;
        }
    });
});
