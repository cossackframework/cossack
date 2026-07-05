// tests/store-reactive-keys.test.ts
/**
 * Regression tests for Copilot finding: optimistic handlers and
 * sanitizeClientState must include @Store keys (and @ClientState/@ClientStore
 * for the optimistic snapshot), not just @State.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { State, ClientState, Store, ClientStore } from '../src/shared/decorators';
import { sanitizeClientState } from '../src/shared/method-proxy';

/**
 * Read all four reactive metadata sources the way method-proxy.ts now does,
 * so the test can verify the merge without importing the (unexported) helper.
 */
function readAllReactiveKeys(constructor: any): Set<string> {
    const keys = new Set<string>();
    for (const k of Object.keys(Reflect.getMetadata('cossack:state', constructor) || {})) keys.add(k);
    for (const k of Object.keys(Reflect.getMetadata('cossack:store', constructor) || {})) keys.add(k);
    for (const k of (Reflect.getMetadata('cossack:client-state', constructor) || [])) keys.add(k);
    for (const k of (Reflect.getMetadata('cossack:client-store', constructor) || [])) keys.add(k);
    return keys;
}

class FullComponent {
    @State() publicState = '';
    @ClientState() clientState = '';
    @Store() publicStore = { x: '' };
    @ClientStore() clientStore = { y: '' };
}

describe('reactive state keys: all four sources merged', () => {
    it('includes @State, @Store, @ClientState, and @ClientStore keys', () => {
        const keys = readAllReactiveKeys(FullComponent);
        expect(keys.has('publicState')).toBe(true);
        expect(keys.has('clientState')).toBe(true);
        expect(keys.has('publicStore')).toBe(true);
        expect(keys.has('clientStore')).toBe(true);
        expect(keys.size).toBe(4);
    });

    it('excludes keys not declared as reactive', () => {
        class Comp {
            @State() a = '';
            // plain field — not reactive
            b = '';
        }
        const keys = readAllReactiveKeys(Comp);
        expect(keys.has('a')).toBe(true);
        expect(keys.has('b')).toBe(false);
    });
});

describe('sanitizeClientState: @Store keys are accepted, @ClientStore rejected', () => {
    /**
     * sanitizeClientState is the security gate on inbound client state. Public
     * state (@State, @Store) must be accepted; client-only (@ClientState,
     * @ClientStore) must be rejected (they are never pushed from the client).
     */
    it('keeps @Store keys and strips @ClientStore/@ClientState keys', () => {
        const inbound = {
            publicState: 'a',
            publicStore: { x: 'b' },
            clientState: 'c',
            clientStore: { y: 'd' },
            // Prototype-pollution attempts must always be stripped.
            prototype: { evil: true },
            constructor: { evil: true },
        };
        const clean = sanitizeClientState(FullComponent, inbound) as Record<string, unknown>;
        expect(clean.publicState).toBe('a');
        expect(clean.publicStore).toEqual({ x: 'b' });
        // Client-only keys must not be accepted from the client.
        expect(clean.clientState).toBeUndefined();
        expect(clean.clientStore).toBeUndefined();
        // Prototype pollution attempts ('prototype'/'constructor' as own keys)
        // are not in the allowed set, so they are stripped — verify via the
        // own-key set rather than property access (every object inherits a
        // `constructor` from Object.prototype).
        const ownKeys = Object.keys(clean);
        expect(ownKeys).not.toContain('prototype');
        expect(ownKeys).not.toContain('constructor');
        expect(ownKeys).toEqual(['publicState', 'publicStore']);
        expect((clean as any).evil).toBeUndefined();
    });

    it('rejects unknown keys even when present in inbound state', () => {
        const inbound = { publicState: 'a', unknownKey: 'x' };
        const clean = sanitizeClientState(FullComponent, inbound) as Record<string, unknown>;
        expect(clean.publicState).toBe('a');
        expect(clean.unknownKey).toBeUndefined();
    });
});
