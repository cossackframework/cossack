// tests/flash.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the environment so we can toggle isServer (mirrors i18n.test.ts).
vi.mock('../src/shared/environment', () => ({
    get isServer() {
        return (globalThis as any).__MOCK_IS_SERVER ?? false;
    },
}));

import {
    flash,
    flashed,
    flashedAll,
    hasFlashed,
    flashInput,
    old,
    setFlashStoreGetter,
    __resetFlashForTests,
    type FlashStore,
} from '../src/shared/flash';

function setEnv(server: boolean) {
    (globalThis as any).__MOCK_IS_SERVER = server;
}

/** Build a fresh per-request store for tests. */
function makeStore(seed: Record<string, unknown> = {}): FlashStore {
    return { outgoing: {}, incoming: { ...seed } };
}

describe('flash — environment gating', () => {
    beforeEach(() => __resetFlashForTests());

    it('writers are no-ops on the client (no store)', () => {
        setEnv(false);
        setFlashStoreGetter(() => makeStore());
        // No throw, just silently ignored.
        flash('x', 'y');
        expect(flash('x', 'y')).toBeUndefined();
    });

    it('readers return undefined without a store', () => {
        setEnv(true);
        // No setter wired → requestStore() returns undefined.
        expect(flashed('x')).toBeUndefined();
        expect(old('x')).toBeUndefined();
        expect(hasFlashed('x')).toBe(false);
        expect(flashedAll()).toEqual({});
    });
});

describe('flash — writers (outgoing)', () => {
    beforeEach(() => {
        setEnv(true);
        setFlashStoreGetter(() => makeStore());
    });
    afterEach(() => __resetFlashForTests());

    it('flash(key, value) writes to the active store', () => {
        const store = makeStore();
        setFlashStoreGetter(() => store);
        flash('success', 'Saved!');
        expect(store.outgoing.success).toBe('Saved!');
        // Writers go to `outgoing`, not `incoming`, so flashed() (a reader)
        // doesn't see it within the same request.
        expect(flashed('success')).toBeUndefined();
    });

    it('flash(object) merges multiple values', () => {
        const store = makeStore();
        setFlashStoreGetter(() => store);
        flash({ a: 1, b: 2 });
        expect(store.outgoing).toEqual({ a: 1, b: 2 });
    });

    it('flash overwrites a previously-set key', () => {
        const store = makeStore();
        setFlashStoreGetter(() => store);
        flash('x', 1);
        flash('x', 2);
        expect(store.outgoing.x).toBe(2);
    });
});

describe('flash — readers (incoming)', () => {
    beforeEach(() => setEnv(true));
    afterEach(() => __resetFlashForTests());

    it('flashed reads from incoming', () => {
        const store = makeStore({ success: 'Saved!' });
        setFlashStoreGetter(() => store);
        expect(flashed('success')).toBe('Saved!');
    });

    it('flashed returns undefined for missing keys', () => {
        setFlashStoreGetter(() => makeStore({ a: 1 }));
        expect(flashed('missing')).toBeUndefined();
    });

    it('flashedAll returns everything except the input namespace', () => {
        setFlashStoreGetter(() => makeStore({ a: 1, b: 2, __input: { x: 1 } }));
        expect(flashedAll()).toEqual({ a: 1, b: 2 });
    });

    it('hasFlashed reports presence', () => {
        setFlashStoreGetter(() => makeStore({ a: 1 }));
        expect(hasFlashed('a')).toBe(true);
        expect(hasFlashed('b')).toBe(false);
    });
});

describe('flash — old input (namespaced)', () => {
    beforeEach(() => setEnv(true));
    afterEach(() => __resetFlashForTests());

    it('flashInput writes under the reserved namespace, not as top-level keys', () => {
        const store = makeStore();
        setFlashStoreGetter(() => store);
        flashInput({ name: 'Alice', email: 'a@x.com' });
        // The whole object is under __input, not spread at the top level.
        expect(store.outgoing).toEqual({ __input: { name: 'Alice', email: 'a@x.com' } });
        expect(store.outgoing.name).toBeUndefined();
    });

    it('old reads from the reserved namespace', () => {
        setFlashStoreGetter(() => makeStore({ __input: { name: 'Alice' } }));
        expect(old('name')).toBe('Alice');
        expect(old<string>('email')).toBeUndefined();
    });

    it('old and flashed do not collide on the same key name', () => {
        // This is the core reason flashInput is namespaced: flashing a message
        // under "name" and stashing submitted input whose field is also "name"
        // must not overwrite each other.
        const store = makeStore();
        setFlashStoreGetter(() => store);
        flash('name', 'This is a message');       // message
        flashInput({ name: 'Alice' });             // submitted input
        expect(store.outgoing.name).toBe('This is a message');
        expect((store.outgoing as any).__input.name).toBe('Alice');
    });

    it('old returns undefined with no input namespace', () => {
        setFlashStoreGetter(() => makeStore({ success: 'x' }));
        expect(old('name')).toBeUndefined();
    });

    it('old resolves dot-paths into nested input data', () => {
        setFlashStoreGetter(() => makeStore({ __input: { address: { street: '123 Main', city: 'Anytown' } } }));
        expect(old('address.street')).toBe('123 Main');
        expect(old('address.city')).toBe('Anytown');
        expect(old('address.missing')).toBeUndefined();
        expect(old('missing.path')).toBeUndefined();
    });

    it('old handles a plain key and a dot key distinctly', () => {
        setFlashStoreGetter(() => makeStore({ __input: { name: 'Alice', 'a.b': 'literal' } }));
        expect(old('name')).toBe('Alice');
        // A literal dot key still works via the dot-path resolver only if there
        // is no nesting; here 'a.b' resolves into { a: { b: 'literal' } } which
        // doesn't exist, so it returns undefined. This is the documented
        // tradeoff: dot-paths are the convention, matching validation rules.
        expect(old('a.b')).toBeUndefined();
    });

    it('flashInput is omitted from flashedAll', () => {
        setFlashStoreGetter(() => makeStore({ success: 'x', __input: { name: 'A' } }));
        expect(flashedAll()).toEqual({ success: 'x' });
    });
});

describe('flash — reset for tests', () => {
    it('__resetFlashForTests clears the getter', () => {
        setEnv(true);
        setFlashStoreGetter(() => makeStore());
        __resetFlashForTests();
        // Now there's no getter → readers no-op.
        expect(flashed('x')).toBeUndefined();
    });
});
