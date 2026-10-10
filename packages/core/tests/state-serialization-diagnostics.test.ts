import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientState, ClientStore, State } from '../src/shared/decorators';
import { describeUnsupportedStateValue, snapshotRpcValue } from '../src/shared/rpc-stream';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('public state diagnostics', () => {
    it.each([
        [() => {}, 'function'], [Symbol('private'), 'symbol'], [1n, 'bigint'],
        [new Map(), 'Map'], [new Set(), 'Set'], [new WeakMap(), 'weak collection'],
        [new Blob(), 'binary value'], [new ArrayBuffer(1), 'binary value'],
        [new Uint8Array(1), 'binary value'], [/private/, 'native object'],
        [new Error('PRIVATE_DIAGNOSTIC_VALUE'), 'native object'], [Promise.resolve(1), 'native object'],
        [new Response(), 'Response'], [new Headers(), 'Headers'],
        [Infinity, 'non-finite number'], [NaN, 'non-finite number'], [new Date('invalid'), 'invalid Date'],
    ])('identifies component, field, nested path and reason for %s', (value, reason) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        class InvalidState extends Cossack { @State() data = { rows: [{ value }] }; }
        const page = new InvalidState();
        page.connectedCallback();
        const snapshot = page.getInitialState();
        page.getPublicState();
        expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(
            `InvalidState field 'data' during initial state: state.data.rows[0].value (${reason})`));
        expect(String(warn.mock.calls)).not.toContain('PRIVATE_DIAGNOSTIC_VALUE');
        expect(snapshot.public.data).toBe((page as any)._stateContainer.getPublic('data'));
    });

    it('reports actual ancestor cycles while accepting repeated acyclic references', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const shared: any = { id: 1 };
        class Graph extends Cossack { @State() data = { left: shared, rows: [shared] }; }
        const page = new Graph();
        page.connectedCallback();
        page.getPublicState();
        expect(warn).not.toHaveBeenCalled();
        shared.self = shared;
        page.getPublicState();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('state.data.left.self (cyclic reference)'));
        delete shared.self;
        page.getPublicState();
        shared.self = shared;
        page.getPublicState();
        expect(warn).toHaveBeenCalledTimes(2); // repaired fields can produce a new diagnostic
    });

    it('does not invoke getters, toJSON or toStringTag during a diagnostic read', () => {
        const getter = vi.fn(() => { throw new Error('PRIVATE_GETTER'); });
        const hook = vi.fn(() => ({ safe: 1 }));
        const hookGetter = vi.fn(() => hook);
        const tag = vi.fn(() => { throw new Error('PRIVATE_TAG'); });
        const data = Object.defineProperty({ safe: 1 }, 'derived', { enumerable: true, get: getter });
        const custom = { toJSON: hook, hidden: new Map() };
        const customGetter = Object.defineProperty({}, 'toJSON', { get: hookGetter });
        const tagged = Object.defineProperty({}, Symbol.toStringTag, { get: tag });
        class Hooks extends Cossack { @State() data = { data, custom, customGetter, tagged }; }
        const page = new Hooks();
        page.connectedCallback();
        page.getInitialState();
        page.getPublicState();
        expect(getter).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled();
        expect(hookGetter).not.toHaveBeenCalled(); expect(tag).not.toHaveBeenCalled();
        expect(snapshotRpcValue(custom)).toEqual({ safe: 1 });
        expect(hook).toHaveBeenCalledOnce();
        expect(() => snapshotRpcValue(data, 'state.data')).toThrow(/state.data.derived \(property access failed\)/);
        expect(getter).toHaveBeenCalledOnce();
    });

    it('keeps valid Dates and model data unchanged, and excludes client-only fields from inspection and snapshots', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        class Model { id = 1; method() {} }
        const when = new Date('2026-10-03');
        class Valid extends Cossack {
            @State() data = { when, model: new Model(), optional: undefined, rows: [undefined, null] };
            @ClientState() callback = () => {};
            @ClientStore() local = { invalid: new Map(), cyclic: undefined as any };
        }
        const page = new Valid();
        page.connectedCallback();
        page.local.cyclic = page.local;
        expect(Object.keys(page.getPublicState())).toEqual(['data']);
        expect(Object.keys(page.getInitialState().public)).toEqual(['data']);
        expect(warn).not.toHaveBeenCalled();
        expect(page.getPublicState().data).toEqual({ when, model: new Model(), optional: undefined, rows: [undefined, null] });
        expect((page.getPublicState().data as any).when).toBe(when);
    });

    it('disables diagnostic inspection in production without changing raw state', () => {
        vi.stubEnv('DEV', false);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        class Production extends Cossack { @State() data = { unsupported: new Map() }; }
        const page = new Production();
        page.connectedCallback();
        const raw = page.getPublicState().data;
        expect(page.data).toBe(raw);
        page.getInitialState();
        page.data.unsupported = new Map();
        expect(warn).not.toHaveBeenCalled();
    });

    it('bounds inspection of deep and wide graphs without allocating a JSON snapshot', () => {
        let nested: unknown = 1;
        for (let index = 0; index < 300; index++) nested = { next: nested };
        expect(describeUnsupportedStateValue(nested, 'state.deep')).toContain('maximum depth exceeded');
        expect(describeUnsupportedStateValue(new Array(2 ** 30), 'state.sparse')).toBeNull();
    });
});
