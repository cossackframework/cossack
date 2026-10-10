/** Per-invocation field ownership. Handlers run once; server mutations are never replayed. */
import './metadata';
import { collectReactiveMetadata } from './reactive-metadata';

export type OptimisticOperation = { kind: 'increment'; amount: number } | { kind: 'append' | 'remove'; value: unknown };
type Change = { sequence: number; value: unknown; operations?: OptimisticOperation[] };
type Field = { base: unknown; sequence: number; changes: Map<object, Change>; displayed: unknown; local?: Change };
export type OptimisticCall = {
    owner: object; sequence: number; name: string; fields: Set<string>; requestId?: string;
    /**
     * Values this call's own correlated publications wrote directly (JSON
     * transport form). A field still holding one is server-owned, not a local
     * edit made while the request was in flight.
     */
    published?: Map<string, string>;
};
type Capture = { call: OptimisticCall; before: Map<string, unknown>; operations: Map<string, OptimisticOperation[]> };
type Ledger = { clock: number; calls: Set<OptimisticCall>; fields: Map<string, Field>; writing: boolean; capturing: boolean; capture?: Capture };
const ledgers = new WeakMap<object, Ledger>();
const pendingLoading = new WeakMap<object, Map<string, number>>();
// Keep only fields whose later user edit survived settlement. A duplicate
// broadcast of that call's confirmed value must not immediately undo the edit.
const settledEdits = new WeakMap<object, Map<string, unknown>>();

/** A reconnect/resync explicitly restores public server authority. */
export function resetOptimisticSnapshotHistory(target: object): void {
    settledEdits.delete(target);
}

/** Match only this component's active call, never another subscriber's ID. */
export function optimisticCallForRequest(target: object, requestId: unknown): OptimisticCall | undefined {
    if (typeof requestId !== 'string') return undefined;
    return [...(ledgers.get(target)?.calls ?? [])].find(call => call.requestId === requestId);
}

/** An older confirmed snapshot removes its contribution without replacing newer state. */
export function confirmOptimisticFields(call: OptimisticCall, keys: string[]): void {
    const ledger = ledgers.get(call.owner);
    if (!ledger?.calls.has(call)) return;
    for (const key of keys) {
        const field = ledger.fields.get(key);
        if (!field || !field.changes.has(call)) continue;
        observeExternal(call.owner, ledger, key, field);
        field.changes.delete(call);
        write(call.owner, ledger, key, field);
    }
}

/** Changed broadcasts and explicit reads retain authority; known echoes do not. */
export function acceptSettledOptimisticSnapshot(target: object, key: string, value: unknown, authoritative: boolean): boolean {
    const fields = settledEdits.get(target);
    if (!fields?.has(key)) return true;
    if (!authoritative && equal(fields.get(key), value)) return false;
    fields.delete(key);
    if (!fields.size) settledEdits.delete(target);
    return true;
}

/** Subscriber loading belongs to the service invocation, not ambient broadcasts. */
export function ownRpcLoading(target: object, name: string): () => void {
    let pending = pendingLoading.get(target);
    if (!pending) pendingLoading.set(target, pending = new Map());
    pending.set(name, (pending.get(name) ?? 0) + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const count = (pending!.get(name) ?? 0) - 1;
        if (count > 0) pending!.set(name, count); else pending!.delete(name);
        if (!pending!.size) pendingLoading.delete(target);
    };
}

export function optimisticKeys(constructor: unknown): string[] {
    const { state, store, clientState, clientStore } = collectReactiveMetadata(constructor);
    return [...new Set([...Object.keys(state), ...Object.keys(store), ...clientState, ...clientStore])];
}

/** Child action handlers replace matching registrations without hiding siblings. */
export function optimisticHandlers(constructor: Function): Record<string, string | symbol> {
    const chain: Function[] = [];
    for (let current = constructor; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) chain.unshift(current);
    const handlers: Record<string, string | symbol> = Object.create(null);
    for (const current of chain) Object.assign(handlers, Reflect.getOwnMetadata('cossack:optimistic-handlers', current) ?? {});
    return handlers;
}

export function optimisticHandler(target: any, key: string | symbol | undefined, args: unknown[]): (() => unknown) | undefined {
    if (key === undefined) return undefined;
    const method = typeof target.getMethod === 'function' ? target.getMethod(key) : target[key];
    if (typeof method !== 'function') return undefined;
    return () => {
        if (Object.prototype.toString.call(method) === '[object AsyncFunction]') throw new Error('Optimistic handlers must be synchronous.');
        const result = method.apply(target, args);
        if (result && typeof result.then === 'function') {
            void Promise.resolve(result).catch(() => {});
            throw new Error('Optimistic handlers must not return promises.');
        }
        return result;
    };
}

/** Detach plain field trees, including nested Store values, without invoking hooks. */
function copy(value: any, seen = new WeakMap<object, unknown>(), depth = 0): any {
    if (value === null || typeof value !== 'object') return value;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
    if (seen.has(value)) return seen.get(value);
    if (depth > 256) throw new Error('Optimistic field snapshot exceeds maximum depth.');
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
    // Accessor representations cannot be copied without executing application code.
    if (Reflect.ownKeys(descriptors).some(key => descriptors[key].enumerable && !('value' in descriptors[key]))) return value;
    const result: any = Array.isArray(value) ? new Array(value.length) : Object.create(prototype);
    seen.set(value, result);
    for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key];
        if (descriptor.enumerable) Object.defineProperty(result, key, { value: copy(descriptor.value, seen, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
}

function equal(a: any, b: any, seen = new WeakMap<object, object>()): boolean {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const prototype = Object.getPrototypeOf(a);
    if (prototype !== Object.getPrototypeOf(b) || (!Array.isArray(a) && prototype !== Object.prototype && prototype !== null)) return false;
    if (seen.has(a)) return seen.get(a) === b;
    seen.set(a, b);
    const left = Object.getOwnPropertyDescriptors(a) as Record<PropertyKey, PropertyDescriptor>;
    const right = Object.getOwnPropertyDescriptors(b) as Record<PropertyKey, PropertyDescriptor>;
    const keys = Reflect.ownKeys(left).filter(key => left[key].enumerable);
    if (keys.length !== Reflect.ownKeys(right).filter(key => right[key].enumerable).length) return false;
    if (Array.isArray(a) && a.length !== b.length) return false;
    return keys.every(key => right[key]?.enumerable && 'value' in left[key] && 'value' in right[key] && equal(left[key].value, right[key].value, seen));
}

export class OptimisticEditError extends Error {
    constructor(detail: string) {
        super(`[Cossack] Invalid optimistic edit: ${detail}`);
        this.name = 'OptimisticEditError';
    }
}

/** Data operations accept plain trees, never application callbacks or hooks. */
function operationValue(value: unknown, ancestors = new Set<object>(), depth = 0): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || depth > 256) throw new OptimisticEditError('operation values must be finite, plain data within the depth limit.');
    const prototype = Object.getPrototypeOf(value);
    if ((!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) || ancestors.has(value)) {
        throw new OptimisticEditError('operation values must be acyclic plain objects or arrays.');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: any = Array.isArray(value) ? new Array(value.length) : Object.create(prototype);
    ancestors.add(value);
    try {
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = (descriptors as Record<PropertyKey, PropertyDescriptor>)[key];
            if (!descriptor.enumerable) continue;
            if (typeof key !== 'string' || !('value' in descriptor)) throw new OptimisticEditError('operation values cannot contain symbols or accessors.');
            Object.defineProperty(result, key, { value: operationValue(descriptor.value, ancestors, depth + 1), enumerable: true, writable: true, configurable: true });
        }
    } finally { ancestors.delete(value); }
    return result;
}

function applyOperations(value: unknown, operations: readonly OptimisticOperation[]): unknown {
    for (const operation of operations) {
        if (operation.kind === 'increment') {
            if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(value + operation.amount)) {
                throw new OptimisticEditError('increment requires a finite number and finite result.');
            }
            value += operation.amount;
        } else {
            if (!Array.isArray(value)) throw new OptimisticEditError(`${operation.kind} requires an array.`);
            if (operation.kind === 'append') value = [...value, copy(operation.value)];
            else {
                const index = value.findIndex(item => equal(item, operation.value));
                value = index < 0 ? value.slice() : [...value.slice(0, index), ...value.slice(index + 1)];
            }
        }
    }
    return value;
}

/** A helper belongs to this exact synchronous handler execution. */
export function optimisticCapture(target: object): OptimisticCall {
    const ledger = ledgers.get(target);
    if (!ledger?.capturing || !ledger.capture) throw new OptimisticEditError('use optimistic() inside a synchronous @Optimistic handler.');
    return ledger.capture.call;
}

export function recordOptimisticOperation(target: any, call: OptimisticCall, key: string, operation: OptimisticOperation): void {
    const ledger = ledgers.get(target), capture = ledger?.capture;
    if (!ledger?.capturing || capture?.call !== call) throw new OptimisticEditError('this handler execution has ended.');
    if (!capture.before.has(key)) throw new OptimisticEditError(`'${key}' is not an initialized reactive field.`);
    const operations = capture.operations.get(key) ?? [];
    if (!equal(target[key], applyOperations(capture.before.get(key), operations))) {
        throw new OptimisticEditError(`do not mix direct assignments and operations on '${key}' in one handler.`);
    }
    const recorded: OptimisticOperation = operation.kind === 'increment'
        ? { kind: 'increment', amount: operation.amount }
        : { kind: operation.kind, value: operationValue(operation.value) };
    if (recorded.kind === 'increment' && !Number.isFinite(recorded.amount)) throw new OptimisticEditError('increment amount must be finite.');
    const next = applyOperations(target[key], [recorded]);
    if (typeof target.setProperty === 'function') target.setProperty(key, next); else target[key] = next;
    operations.push(recorded);
    capture.operations.set(key, operations);
}

/** A snapshot limit must not change ordinary client setters or mask settlement. */
function copyLocal(target: any, key: string, value: unknown): unknown {
    try { return copy(value); }
    catch (error) {
        console.error(`[Cossack] Local optimistic field '${key}' on ${target.constructor.name} could not be detached; retaining its reference:`, error);
        return value;
    }
}

function write(target: any, ledger: Ledger, key: string, field: Field): void {
    let value = field.base;
    const changes = [...field.changes.values()];
    if (field.local) changes.push(field.local);
    for (const change of changes.sort((a, b) => a.sequence - b.sequence)) {
        if (change.sequence <= field.sequence) continue;
        value = change.operations ? applyOperations(value, change.operations) : change.value;
    }
    ledger.writing = true;
    try {
        if (!equal(target[key], value)) {
            const detached = copyLocal(target, key, value);
            if (typeof target.setProperty === 'function') target.setProperty(key, detached);
            else target[key] = detached;
        }
        const current = target[key];
        field.displayed = Object.is(current, value) ? value : copyLocal(target, key, current);
    } finally { ledger.writing = false; }
}

/** Called by component/store setters; local edits supersede older call contributions. */
export function noteOptimisticWrite(target: object, key: string): void {
    const ledger = ledgers.get(target);
    const field = ledger?.fields.get(key);
    if (!ledger || !field || ledger.writing || ledger.capturing) return;
    const value = copyLocal(target, key, (target as any)[key]);
    field.local = { sequence: ++ledger.clock, value };
    field.displayed = value;
}

function observeExternal(target: any, ledger: Ledger, key: string, field: Field): void {
    if (!equal(target[key], field.displayed)) noteOptimisticWrite(target, key);
}

export function beginOptimisticCall(target: any, name: string, handler: (() => unknown) | undefined, keys: string[]): OptimisticCall {
    let ledger = ledgers.get(target);
    if (!ledger) ledgers.set(target, ledger = { clock: 0, calls: new Set(), fields: new Map(), writing: false, capturing: false });
    for (const [key, field] of ledger.fields) observeExternal(target, ledger, key, field);
    const call: OptimisticCall = { owner: target, name, sequence: ++ledger.clock, fields: new Set() };
    ledger.calls.add(call);
    if (!handler) return call;
    let before: Map<string, unknown>;
    try { before = new Map(keys.map(key => [key, copy(target[key])])); }
    catch (failure) { console.error(`Error preparing optimistic handler for '${name}':`, failure); return call; }
    let failure: unknown;
    let failed = false;
    const capture: Capture = { call, before, operations: new Map() };
    ledger.capture = capture;
    ledger.capturing = true;
    try { handler(); } catch (error) { failure = error; failed = true; }
    finally { ledger.capturing = false; ledger.capture = undefined; }
    for (const [key, value] of before) {
        const operations = capture.operations.get(key);
        if (!operations && equal(value, target[key])) continue;
        let field = ledger.fields.get(key);
        if (!field) ledger.fields.set(key, field = { base: value, sequence: 0, changes: new Map(), displayed: value });
        call.fields.add(key);
        try {
            const next = copy(target[key]);
            if (operations && !equal(next, applyOperations(value, operations))) throw new OptimisticEditError(`do not mix direct assignments and operations on '${key}' in one handler.`);
            field.changes.set(call, { sequence: call.sequence, value: next, operations });
            field.displayed = next;
        } catch (error) { failure = error; failed = true; }
    }
    if (failed) {
        for (const key of call.fields) {
            const field = ledger.fields.get(key)!;
            field.changes.delete(call);
            write(target, ledger, key, field);
        }
        call.fields.clear();
        console.error(`Error in optimistic handler for '${name}':`, failure);
    }
    return call;
}

/** Send confirmed/user-authored public state, excluding pending optimistic overlays. */
export function optimisticRequestState(target: any, state: Record<string, unknown>): Record<string, unknown> {
    const ledger = ledgers.get(target);
    if (!ledger) return state;
    const result = { ...state };
    for (const [key, field] of ledger.fields) {
        observeExternal(target, ledger, key, field);
        // The transport snapshots this record immediately. Avoid another plain
        // clone here, so its canonical validator owns unsupported public values.
        if (Object.hasOwn(result, key)) result[key] = field.local ? field.local.value : field.base;
    }
    return result;
}

/** Returns true for an owned field, including responses superseded by newer work. */
export function applyOptimisticState(target: any, key: string, value: unknown, call?: OptimisticCall, echo = false): boolean {
    const ledger = ledgers.get(target);
    if (!ledger || (call && !ledger.calls.has(call))) return false;
    const field = ledger.fields.get(key);
    if (!field) return false;
    observeExternal(target, ledger, key, field);
    // A full response can merely echo another call's confirmed input. That
    // does not confirm or supersede the other call's still-pending preview.
    if (!echo && (!call || call.sequence >= field.sequence)) {
        field.base = copy(value);
        if (call) field.sequence = call.sequence;
        if (call && field.local && call.sequence >= field.local.sequence) field.local = undefined;
    }
    write(target, ledger, key, field);
    return true;
}

export function finishOptimisticCall(call: OptimisticCall, success: boolean): void {
    const target: any = call.owner, ledger = ledgers.get(target);
    if (!ledger?.calls.delete(call)) return;
    for (const key of call.fields) {
        const field = ledger.fields.get(key)!;
        try {
            observeExternal(target, ledger, key, field);
            const change = field.changes.get(call);
            // A successful action with no state frame commits its local contribution.
            // An authoritative response at this sequence has already replaced the base.
            if (success && change && !change.operations && call.sequence > field.sequence) {
                field.base = copy(change.value);
                field.sequence = call.sequence;
            }
            if (success && !change?.operations && field.local && call.sequence >= field.local.sequence) field.local = undefined;
            // Committed local operations remain in order until the last call
            // settles. Older rejection can then remove just its own operation.
            if (!success || !change?.operations) field.changes.delete(call);
            write(target, ledger, key, field);
        } catch (error) {
            console.error(`[Cossack] Optimistic cleanup for '${call.name}' on ${target.constructor.name} field '${key}' failed:`, error);
        } finally {
            if (!success || !field.changes.get(call)?.operations) field.changes.delete(call);
        }
    }
    if (!ledger.calls.size) {
        let settled = settledEdits.get(target);
        for (const [key, field] of ledger.fields) {
            if (field.local && field.local.sequence > field.sequence) {
                if (!settled) settledEdits.set(target, settled = new Map());
                settled.set(key, field.base);
            } else settled?.delete(key);
        }
        if (settled && !settled.size) settledEdits.delete(target);
        ledgers.delete(target);
    }
}

/** Legacy uncorrelated completion messages cannot settle modern request-scoped calls. */
export function hasOptimisticCalls(target: object, name: string): boolean {
    return (pendingLoading.get(target)?.get(name) ?? 0) > 0 || [...(ledgers.get(target)?.calls ?? [])].some(call => call.name === name);
}
