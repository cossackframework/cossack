import { RESERVED_STATE_KEYS } from './component-types';
import { snapshotRpcValue } from './rpc-stream';
import { applyOptimisticState, acceptSettledOptimisticSnapshot, confirmOptimisticFields, ownsOptimisticField, type OptimisticCall } from './optimistic-state';
import { RpcError } from './rpc-stream';

const sseCursors = new WeakMap<object, number>();

/** A newly opened source can belong to a restarted process-local scope. */
export function resetSseSnapshotCursor(target: object): void { sseCursors.delete(target); }

/** Parse protocol metadata before hydration; opaque/native responses bypass it. */
export function rpcSseCursor(response: Response): number | undefined {
    const value = response.headers.get('X-Cossack-SSE-Cursor');
    if (value === null) return undefined;
    const cursor = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RpcError('COSSACK_RPC_RESPONSE_INVALID',
        'Invalid SSE snapshot cursor.', { requestId: response.headers.get('X-Cossack-Request-Id') ?? undefined });
    return cursor;
}

/** Public state keys; protocol (_cossack_*) and reserved keys are never applied. */
function isStateKey(key: string): boolean {
    return !key.startsWith('_cossack_') && !RESERVED_STATE_KEYS.has(key);
}

/**
 * Check a snapshot's SSE cursor. Returns false when it is not newer than one
 * already applied; a valid newer cursor is recorded. Throws on an invalid cursor.
 */
function acceptSseCursor(component: object, data: Record<string, any>, call?: OptimisticCall): boolean {
    const cursor = data._cossack_sse_cursor;
    if (cursor === undefined) return true;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RpcError('COSSACK_RPC_RESPONSE_INVALID',
        'Invalid SSE snapshot cursor.', { requestId: call?.requestId });
    const latest = sseCursors.get(component);
    if (latest !== undefined && cursor <= latest) return false;
    sseCursors.set(component, cursor);
    return true;
}

/**
 * Apply a server-sent (broadcast or correlated SSE) state object to a
 * component instance, respecting the per-call optimistic ownership. Internal
 * reserved keys (_cossack_*, loading, isServer, params) are skipped. Does NOT
 * call requestUpdate — callers schedule a render as appropriate to their
 * transport. Direct /crpc responses go through {@link createStateApplier}.
 */
export function applyStateToComponent(component: any, data: Record<string, any>, call?: OptimisticCall): void {
    if (!acceptSseCursor(component, data, call)) {
        if (call) confirmOptimisticFields(call, Object.keys(data).filter(isStateKey));
        return;
    }
    const snapshot = data._cossack_sse_cursor !== undefined;
    for (const key in data) {
        if (!isStateKey(key)) continue;
        if (!call && !acceptSettledOptimisticSnapshot(component, key, data[key], snapshot)) continue;
        if (applyOptimisticState(component, key, data[key], call)) continue;
        if (call) acceptSettledOptimisticSnapshot(component, key, data[key], true);
        setState(component, key, data[key]);
        // A publication correlated to an in-flight call is server state for that call.
        if (call) recordPublished(call, component, key);
    }
}

function setState(component: any, key: string, value: unknown): void {
    if (typeof component.setProperty === 'function') component.setProperty(key, value);
    else component[key] = value;
}

function transportForm(value: unknown, key: string): string | undefined {
    try { return JSON.stringify(snapshotTransportState({ [key]: value })[key]); } catch { return undefined; }
}

function recordPublished(call: OptimisticCall, component: any, key: string): void {
    const form = transportForm(component[key], key);
    if (form === undefined) return;
    (call.published ??= new Map()).set(key, form);
}

/** Clone state exactly as JSON transport will represent it. */
export function snapshotTransportState(state: Record<string, any>): Record<string, any> {
    return snapshotRpcValue(state, 'state') as Record<string, any>;
}

/** A value's JSON transport text, computed once per comparison side. */
const UNSERIALIZABLE = Symbol('unserializable');
type TransportJson = string | undefined | typeof UNSERIALIZABLE;

/** JSON of a live value as transport snapshots it (the cyclic/bigint case is UNSERIALIZABLE). */
function liveJson(value: unknown, key: string): TransportJson {
    try { return JSON.stringify(snapshotTransportState({ [key]: value })[key]); } catch { return UNSERIALIZABLE; }
}

/** JSON of a value that is already a transport snapshot. */
function sentJson(value: unknown): TransportJson {
    try { return JSON.stringify(value); } catch { return UNSERIALIZABLE; }
}

/**
 * Compare a live value with its JSON-transport snapshot. When either side
 * cannot be serialized (the live field can become cyclic or contain a bigint
 * while the request is in flight) fall back to identity.
 */
function transportJsonEqual(live: unknown, liveForm: TransportJson, sent: unknown, sentForm: TransportJson): boolean {
    return liveForm === UNSERIALIZABLE || sentForm === UNSERIALIZABLE ? Object.is(live, sent) : liveForm === sentForm;
}

/**
 * Build the response-state applier shared by every transport proxy: apply the
 * server state, skip fields the client edited while the request was in flight,
 * and advance the request snapshot so later frames do not clobber local edits.
 *
 * One pass decides and applies each field, computing each value's transport
 * form once. A field is judged against the request snapshot when it is
 * applied, so a setter that changes another field still in the frame affects
 * that later field's decision.
 */
export function createStateApplier(component: any, requestState: Record<string, any>, call: OptimisticCall, onReconciled?: () => void) {
    const sent = (key: string) => Object.prototype.hasOwnProperty.call(requestState, key);
    const advance = (key: string) => { requestState[key] = snapshotTransportState({ [key]: component[key] })[key]; };
    return (state: Record<string, unknown>) => {
        // The call's own publication may reach the component before its reply
        // frames. A field still holding that published value changed on the
        // server for this call, not locally, so advance the request snapshot
        // before the frame is judged stale (otherwise the final frame is skipped
        // as a local edit and its deduplicated publication is lost).
        let liveForms: Map<string, TransportJson> | undefined;
        if (call.published) {
            for (const key of Object.keys(state)) {
                const published = call.published.get(key);
                if (published === undefined || !sent(key)) continue;
                const live = liveJson(component[key], key);
                (liveForms ??= new Map()).set(key, live);
                if (live === published) advance(key);
            }
        }
        const fieldLive = (key: string) => liveForms?.has(key) ? liveForms.get(key) : liveJson(component[key], key);
        // Advance the snapshot only for fields this response can apply, so later
        // stream frames update the same field without clobbering edits made
        // locally while the request was in flight.
        const applicable: string[] = [];
        if (!acceptSseCursor(component, state, call)) {
            // An older snapshot applies nothing; it only confirms the call's fields.
            for (const key of Object.keys(state)) {
                if (isStateKey(key) && (!sent(key) || transportJsonEqual(component[key], fieldLive(key), requestState[key], sentJson(requestState[key])))) applicable.push(key);
            }
            confirmOptimisticFields(call, Object.keys(state).filter(isStateKey));
        } else {
            for (const key in state) {
                if (!isStateKey(key)) continue;
                const wasSent = sent(key);
                const sentForm = wasSent ? sentJson(requestState[key]) : undefined;
                // Direct /crpc responses contain the server's complete public
                // state, including fields merely echoed from the request. A local
                // value that no longer matches what this request sent was edited
                // while the call was in flight (or a newer response already
                // won), so this field is stale and must not be applied.
                const current = !wasSent || transportJsonEqual(component[key], fieldLive(key), requestState[key], sentForm);
                // Only an owned optimistic field reads `echo`; skip comparing the rest.
                const echo = !call.fields.has(key) && wasSent && ownsOptimisticField(component, key, call) &&
                    transportJsonEqual(state[key], liveJson(state[key], key), requestState[key], sentForm);
                if (!applyOptimisticState(component, key, state[key], call, echo) && current) {
                    acceptSettledOptimisticSnapshot(component, key, state[key], true);
                    setState(component, key, state[key]);
                }
                if (current && Object.prototype.hasOwnProperty.call(state, key)) applicable.push(key);
            }
        }
        for (const key of applicable) advance(key);
        component.requestUpdate?.();
        onReconciled?.();
    };
}
