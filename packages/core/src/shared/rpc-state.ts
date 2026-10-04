import { RESERVED_STATE_KEYS } from './component-types';
import { snapshotRpcValue } from './rpc-stream';
import { applyOptimisticState, acceptSettledOptimisticSnapshot, confirmOptimisticFields, type OptimisticCall } from './optimistic-state';
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

/**
 * Apply a server-sent state object to a component instance, respecting the
 * per-call optimistic ownership. Legacy locks retain their buffered fallback;
 * other keys are set directly. Internal
 * reserved keys (_cossack_*, loading, isServer, params) are skipped. Does NOT
 * call requestUpdate — callers schedule a render as appropriate to their
 * transport. When requestState is provided for a direct /crpc response (HTTP
 * or SSE), fields changed locally since that request began are skipped as stale.
 */
export function applyStateToComponent(
    component: any,
    data: Record<string, any>,
    requestState?: Record<string, any>,
    call?: OptimisticCall,
): void {
    const cursor = data._cossack_sse_cursor;
    if (cursor !== undefined) {
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RpcError('COSSACK_RPC_RESPONSE_INVALID',
            'Invalid SSE snapshot cursor.', { requestId: call?.requestId });
        const latest = sseCursors.get(component);
        if (latest !== undefined && cursor <= latest) {
            if (call) confirmOptimisticFields(call, Object.keys(data).filter(key => !key.startsWith('_cossack_')
                && !RESERVED_STATE_KEYS.has(key)));
            return;
        }
        sseCursors.set(component, cursor);
    }
    for (const key in data) {
        if (key.startsWith('_cossack_')) continue;
        if (RESERVED_STATE_KEYS.has(key)) continue;
        if (!call && !requestState && !acceptSettledOptimisticSnapshot(component, key, data[key], cursor !== undefined)) continue;
        const echo = !!call && !call.fields.has(key) && !!requestState
            && Object.hasOwn(requestState, key) && transportValuesEqual(data[key], requestState[key], key);
        if (applyOptimisticState(component, key, data[key], call, echo)) continue;
        // Direct /crpc responses contain the server's complete public state,
        // including fields merely echoed from the request. If the local value
        // no longer matches what this request sent, the client edited it while
        // the call was in flight (or a newer response already won), so this
        // field is stale and must not be applied.
        if (
            requestState &&
            Object.prototype.hasOwnProperty.call(requestState, key) &&
            !transportValuesEqual(component[key], requestState[key], key)
        ) {
            continue;
        }
        if (call || requestState) acceptSettledOptimisticSnapshot(component, key, data[key], true);
        if (component._isOptimisticLocked?.(key)) {
            component._optimisticPendingState[key] = data[key];
        } else {
            if (typeof component.setProperty === 'function') component.setProperty(key, data[key]);
            else component[key] = data[key];
        }
    }
}

/** Clone state exactly as JSON transport will represent it. */
export function snapshotTransportState(state: Record<string, any>): Record<string, any> {
    return snapshotRpcValue(state, 'state') as Record<string, any>;
}

/** Compare a live value with its JSON-transport snapshot. */
function transportValuesEqual(liveValue: unknown, sentValue: unknown, key: string): boolean {
    try {
        return JSON.stringify(snapshotTransportState({ [key]: liveValue })[key]) === JSON.stringify(sentValue);
    } catch {
        // The request snapshot is JSON-safe, but the live field can become
        // cyclic or contain a bigint while the request is in flight.
        return Object.is(liveValue, sentValue);
    }
}

/**
 * Build the response-state applier shared by every transport proxy: apply the
 * server state, skip fields the client edited while the request was in flight,
 * and advance the request snapshot so later frames do not clobber local edits.
 */
export function createStateApplier(component: any, requestState: Record<string, any>, call: OptimisticCall, onReconciled?: () => void) {
    return (state: Record<string, unknown>) => {
        // Advance the snapshot only for fields this response can apply. This
        // lets later stream frames update the same field without clobbering
        // edits made locally while the request was in flight.
        const applicable = Object.keys(state).filter(key => !Object.prototype.hasOwnProperty.call(requestState, key)
            || transportValuesEqual(component[key], requestState[key], key));
        applyStateToComponent(component, state, requestState, call);
        for (const key of applicable) {
            if (!key.startsWith('_cossack_') && !RESERVED_STATE_KEYS.has(key)) {
                requestState[key] = snapshotTransportState({ [key]: component[key] })[key];
            }
        }
        component.requestUpdate?.();
        onReconciled?.();
    };
}
