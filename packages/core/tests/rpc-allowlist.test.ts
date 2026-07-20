import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Server, Shared, State } from '../src/shared/decorators';
import { isRpcCallableAction, sanitizeClientState } from '../src/shared/method-proxy';

describe('isRpcCallableAction (RPC allowlist gate)', () => {
    it('allows methods explicitly decorated with @Server', () => {
        class Page {
            @Server()
            doThing() {}
        }
        expect(isRpcCallableAction(Page, 'doThing')).toBe(true);
    });

    it('allows inherited @Server methods from a base class', () => {
        class Base {
            @Server()
            baseMethod() {}
        }
        class Child extends Base {
            @Server()
            childMethod() {}
        }
        expect(isRpcCallableAction(Child, 'baseMethod')).toBe(true);
        expect(isRpcCallableAction(Child, 'childMethod')).toBe(true);
    });

    it('rejects @Shared methods even when stale server metadata exists', () => {
        class Page {
            @Shared()
            format() { return 'local'; }
        }
        Reflect.defineMetadata('cossack:server-methods', {
            format: { channel: 'global', provider: 'page' },
        }, Page);
        expect(isRpcCallableAction(Page, 'format')).toBe(false);
    });

    it('rejects undecorated methods (the core security guarantee)', () => {
        class Page {
            doThing() {}
            // Common framework internals that must NOT be RPC-callable:
            bootstrap() {}
            getMethod() {}
            setProperty() {}
            getPublicState() {}
            destroy() {}
            _render() {}
        }
        for (const name of ['doThing', 'bootstrap', 'getMethod', 'setProperty', 'getPublicState', 'destroy', '_render']) {
            expect(isRpcCallableAction(Page, name)).toBe(false);
        }
    });

    it('rejects framework-internal @Server lifecycle hooks', () => {
        // These are @Server-decorated on the Cossack base class purely for
        // client-side stripping; they are not RPC endpoints.
        class Page {
            @Server()
            initializeProviders() {}
            @Server()
            proxyClientMethods() {}
            @Server()
            validateChannels() {}
        }
        expect(isRpcCallableAction(Page, 'initializeProviders')).toBe(false);
        expect(isRpcCallableAction(Page, 'proxyClientMethods')).toBe(false);
        expect(isRpcCallableAction(Page, 'validateChannels')).toBe(false);
    });

    it('rejects prototype-pollution / builtin names', () => {
        class Page {
            @Server()
            doThing() {}
        }
        // Even if a constructor somehow had these in metadata, they must be refused.
        for (const name of ['__proto__', 'prototype', 'constructor']) {
            expect(isRpcCallableAction(Page, name)).toBe(false);
        }
    });

    it('rejects non-string / empty inputs', () => {
        class Page {
            @Server()
            doThing() {}
        }
        expect(isRpcCallableAction(Page, undefined)).toBe(false);
        expect(isRpcCallableAction(Page, 123)).toBe(false);
        expect(isRpcCallableAction(Page, '')).toBe(false);
        expect(isRpcCallableAction(Page, null)).toBe(false);
    });

    it('rejects when constructor is not a function', () => {
        expect(isRpcCallableAction({}, 'doThing')).toBe(false);
        expect(isRpcCallableAction(undefined, 'doThing')).toBe(false);
        expect(isRpcCallableAction(null, 'doThing')).toBe(false);
    });

    it('rejects methods that exist on the instance but carry no @Server metadata', () => {
        // Simulates an attacker guessing built-in inherited names like
        // toString / hasOwnProperty / valueOf.
        class Page {
            @Server()
            real() {}
        }
        expect(isRpcCallableAction(Page, 'toString')).toBe(false);
        expect(isRpcCallableAction(Page, 'hasOwnProperty')).toBe(false);
    });
});

describe('sanitizeClientState (state-injection guard)', () => {
    it('keeps only keys registered as @State', () => {
        class Page {
            @State()
            count = 0;
            @State()
            name = '';
        }
        const malicious = {
            count: 5,
            name: 'ok',
            user: { id: 'admin', role: 'superuser' }, // not @State
            _runtime: { evil: true },                 // not @State
            loading: { foo: 1 },                       // not @State
        };
        const clean = sanitizeClientState(Page, malicious);
        expect(Object.keys(clean).sort()).toEqual(['count', 'name']);
        expect(clean.count).toBe(5);
        expect(clean.name).toBe('ok');
    });

    it('honours inherited @State properties from base classes', () => {
        class Base {
            @State()
            shared = 0;
        }
        class Child extends Base {
            @State()
            own = 0;
        }
        const clean = sanitizeClientState(Child, { shared: 1, own: 2, extra: 3 });
        expect(Object.keys(clean).sort()).toEqual(['own', 'shared']);
    });

    it('rejects prototype-pollution keys even if present in input', () => {
        class Page {
            @State()
            count = 0;
        }
        // JSON.parse('{"__proto__":...}') produces an own enumerable __proto__ key.
        const crafted = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{}},"prototype":{},"count":7}');
        const clean = sanitizeClientState(Page, crafted);
        expect(Object.keys(clean)).toEqual(['count']);
        expect(({} as any).polluted).toBeUndefined();
    });

    it('returns empty object for non-object input', () => {
        class Page {
            @State()
            count = 0;
        }
        expect(sanitizeClientState(Page, null)).toEqual({});
        expect(sanitizeClientState(Page, undefined)).toEqual({});
        expect(sanitizeClientState(Page, 'string')).toEqual({});
        expect(sanitizeClientState(Page, 123)).toEqual({});
    });

    it('returns empty object when constructor has no @State metadata', () => {
        const clean = sanitizeClientState(function Plain() {}, { a: 1, b: 2 });
        expect(clean).toEqual({});
    });

    it('handles non-function constructor gracefully', () => {
        expect(sanitizeClientState({}, { a: 1 })).toEqual({});
        expect(sanitizeClientState(null, { a: 1 })).toEqual({});
    });
});
