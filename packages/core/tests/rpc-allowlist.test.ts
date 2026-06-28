import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Server } from '../src/shared/decorators';
import { isRpcCallableAction } from '../src/shared/method-proxy';

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
