import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESERVED_STATE_KEYS } from '../src/shared/component-types';
import { acceptSettledOptimisticSnapshot, applyOptimisticState, confirmOptimisticFields, type OptimisticCall } from '../src/shared/optimistic-state';
import { createStateApplier, snapshotTransportState } from '../src/shared/rpc-state';
import { RpcError } from '../src/shared/rpc-stream';

afterEach(() => vi.restoreAllMocks());

/**
 * The applier before it was merged into one pass: advance published fields,
 * collect applicable fields, apply, then advance the request snapshot. Kept
 * here as the reference the single pass must match.
 */
function referenceApplier(component: any, requestState: Record<string, any>, call: OptimisticCall) {
    const cursors = new WeakMap<object, number>();
    const transportForm = (value: unknown, key: string) => {
        try { return JSON.stringify(snapshotTransportState({ [key]: value })[key]); } catch { return undefined; }
    };
    const equal = (live: unknown, sent: unknown, key: string) => {
        try { return JSON.stringify(snapshotTransportState({ [key]: live })[key]) === JSON.stringify(sent); } catch { return Object.is(live, sent); }
    };
    const applyState = (data: Record<string, any>) => {
        const cursor = data._cossack_sse_cursor;
        if (cursor !== undefined) {
            if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RpcError('COSSACK_RPC_RESPONSE_INVALID',
                'Invalid SSE snapshot cursor.', { requestId: call.requestId });
            const latest = cursors.get(component);
            if (latest !== undefined && cursor <= latest) {
                confirmOptimisticFields(call, Object.keys(data).filter(key => !key.startsWith('_cossack_') && !RESERVED_STATE_KEYS.has(key)));
                return;
            }
            cursors.set(component, cursor);
        }
        for (const key in data) {
            if (key.startsWith('_cossack_') || RESERVED_STATE_KEYS.has(key)) continue;
            const echo = !call.fields.has(key) && Object.hasOwn(requestState, key) && equal(data[key], requestState[key], key);
            if (applyOptimisticState(component, key, data[key], call, echo)) continue;
            if (Object.prototype.hasOwnProperty.call(requestState, key) && !equal(component[key], requestState[key], key)) continue;
            acceptSettledOptimisticSnapshot(component, key, data[key], true);
            if (typeof component.setProperty === 'function') component.setProperty(key, data[key]);
            else component[key] = data[key];
        }
    };
    return (state: Record<string, unknown>) => {
        if (call.published) {
            for (const key of Object.keys(state)) {
                const published = call.published.get(key);
                if (published === undefined || !Object.prototype.hasOwnProperty.call(requestState, key)) continue;
                if (transportForm(component[key], key) === published) requestState[key] = snapshotTransportState({ [key]: component[key] })[key];
            }
        }
        const applicable = Object.keys(state).filter(key => !Object.prototype.hasOwnProperty.call(requestState, key)
            || equal(component[key], requestState[key], key));
        applyState(state);
        for (const key of applicable) {
            if (!key.startsWith('_cossack_') && !RESERVED_STATE_KEYS.has(key)) requestState[key] = snapshotTransportState({ [key]: component[key] })[key];
        }
        component.requestUpdate?.();
    };
}

type Scenario = {
    component: Record<string, unknown>;
    requestState: Record<string, unknown>;
    frames: Record<string, unknown>[];
    published?: Record<string, string>;
    fields?: string[];
    /** Values a setter stores instead of the frame value, by key. */
    stores?: Record<string, () => unknown>;
    /** Keys whose setter throws. */
    throws?: string[];
};

function run(scenario: Scenario, factory: (component: any, requestState: Record<string, any>, call: OptimisticCall) => (state: Record<string, unknown>) => void) {
    const updates = { count: 0 };
    const component: any = {
        ...structuredClone(scenario.component),
        requestUpdate() { updates.count++; },
        setProperty(key: string, value: unknown) {
            if (scenario.throws?.includes(key)) throw new Error(`setter ${key} failed`);
            this[key] = scenario.stores?.[key] ? scenario.stores[key]() : value;
        },
    };
    if ('cyclic' in scenario.component) { component.cyclic = { name: 'loop' }; component.cyclic.self = component.cyclic; }
    const requestState = structuredClone(scenario.requestState);
    const call: OptimisticCall = { owner: component, sequence: 1, name: 'run', fields: new Set(scenario.fields ?? []),
        ...(scenario.published ? { published: new Map(Object.entries(scenario.published)) } : {}) };
    const apply = factory(component, requestState, call);
    const errors: string[] = [];
    for (const frame of scenario.frames) {
        try { apply(structuredClone(frame)); } catch (error) { errors.push(`${(error as any).code ?? ''}:${(error as Error).message}`); }
    }
    const { requestUpdate, setProperty, cyclic, ...fields } = component;
    return { fields, requestState, errors, updates: updates.count, cyclicSelf: cyclic ? cyclic.self === cyclic : undefined };
}

const scenarios: Record<string, Scenario> = {
    'unchanged fields are applied and advanced': {
        component: { count: 1, title: 'a', items: [1, 2] }, requestState: { count: 1, title: 'a', items: [1, 2] },
        frames: [{ count: 2, title: 'b', items: [1, 2, 3] }, { count: 3, items: [4] }],
    },
    'fields edited while in flight are skipped': {
        component: { count: 5, title: 'local' }, requestState: { count: 1, title: 'a' },
        frames: [{ count: 2, title: 'server' }],
    },
    'fields missing from the request snapshot are applied and added': {
        component: { count: 1 }, requestState: {},
        frames: [{ count: 2, extra: { nested: true } }, { extra: { nested: false } }],
    },
    'protocol and reserved keys are ignored': {
        component: { count: 1, loading: { run: 1 } }, requestState: { count: 1 },
        frames: [{ count: 2, loading: { other: 3 }, _cossack_return: 9, _cossack_request_id: 'x', isServer: true }],
    },
    'a field holding the call publication advances before staleness': {
        component: { count: 7 }, requestState: { count: 1 }, published: { count: '7' },
        frames: [{ count: 8 }],
    },
    'a publication that no longer matches stays stale': {
        component: { count: 9 }, requestState: { count: 1 }, published: { count: '7' },
        frames: [{ count: 8 }],
    },
    'dates compare by transport form': {
        component: { when: new Date(0) }, requestState: { when: '1970-01-01T00:00:00.000Z' },
        frames: [{ when: '2000-01-01T00:00:00.000Z' }],
    },
    'unserializable live values fall back to identity': {
        component: { cyclic: null, count: 1 }, requestState: { cyclic: { name: 'loop' }, count: 1 },
        frames: [{ cyclic: { name: 'server' }, count: 2 }],
    },
    'owned call fields skip the echo comparison': {
        component: { count: 1, title: 'a' }, requestState: { count: 1, title: 'a' }, fields: ['count'],
        frames: [{ count: 1, title: 'b' }],
    },
    'an older SSE snapshot applies nothing and confirms the call': {
        component: { count: 1 }, requestState: { count: 1 },
        frames: [{ count: 2, _cossack_sse_cursor: 5 }, { count: 3, extra: 1, _cossack_sse_cursor: 4 }, { count: 4, _cossack_sse_cursor: 6 }],
    },
    'an invalid SSE cursor rejects the frame': {
        component: { count: 1 }, requestState: { count: 1 },
        frames: [{ count: 2, _cossack_sse_cursor: -1 }, { count: 3, _cossack_sse_cursor: 1.5 }],
    },
    'a field that cannot be snapshotted after applying fails the frame after every field applies': {
        component: { count: 1, title: 'a' }, requestState: { title: 'a' }, stores: { count: () => new Map() },
        frames: [{ count: 2, title: 'b' }],
    },
    'a throwing setter stops the frame at that field': {
        component: { a: 1, b: 1, c: 1 }, requestState: { a: 1, b: 1, c: 1 }, throws: ['b'],
        frames: [{ a: 2, b: 2, c: 2 }],
    },
};

describe('createStateApplier single pass', () => {
    it.each(Object.entries(scenarios))('%s: matches the reference applier', (_name, scenario) => {
        expect(run(scenario, createStateApplier)).toEqual(run(scenario, referenceApplier));
    });

    it('computes each field transport form once per frame', () => {
        const keys = Array.from({ length: 10 }, (_, index) => `field${index}`);
        const value = (seed: number) => Object.fromEntries(keys.map(key => [key, { seed, rows: [{ id: 1, tags: ['a'] }] }]));
        const component: any = { ...value(0), requestUpdate() {} };
        const call: OptimisticCall = { owner: component, sequence: 1, name: 'run', fields: new Set() };
        const apply = createStateApplier(component, snapshotTransportState(value(0)), call);
        const stringify = vi.spyOn(JSON, 'stringify');
        apply(value(1));
        // Per field: the live value and the request snapshot, each once. Before
        // the merge each field was stringified six times across three walks.
        expect(stringify).toHaveBeenCalledTimes(2 * keys.length);
        expect(component.field3).toEqual({ seed: 1, rows: [{ id: 1, tags: ['a'] }] });
    });
});
