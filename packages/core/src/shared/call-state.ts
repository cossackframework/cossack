import { collectReactiveMetadata } from './reactive-metadata';
import { RpcError } from './rpc-stream';

/**
 * The state a server method call sends and gets back.
 *
 * A field declared `@State({ send: false })` (or `@Store`) stays out of the call: the browser
 * does not send it, the server leaves it at its initial value, and the reply carries it only
 * when the method assigns it.
 */

const recorders = new WeakMap<object, Set<Set<string>>>();
const injectedUnsent = new WeakMap<object, Set<string>>();

/** Note an assignment (or an in-place store change) of `key` on a component or service. */
export function noteStateWrite(target: object, key: string): void {
    const active = recorders.get(target);
    if (active) for (const keys of active) keys.add(key);
}

export interface StateWriteRecord {
    /** The fields assigned since recording began; grows until `stop()`. */
    readonly keys: Set<string>;
    stop(): void;
}

/** Record the fields assigned on `target` until `stop()`. Records may nest. */
export function recordStateWrites(target: object): StateWriteRecord {
    const keys = new Set<string>();
    let active = recorders.get(target);
    if (!active) recorders.set(target, active = new Set());
    active.add(keys);
    return {
        keys,
        stop() {
            const current = recorders.get(target);
            current?.delete(keys);
            if (current?.size === 0) recorders.delete(target);
        },
    };
}

/** @internal A service field declared `send: false` that a component exposes as its own state. */
export function noteInjectedUnsentKey(component: object, key: string): void {
    let keys = injectedUnsent.get(component);
    if (!keys) injectedUnsent.set(component, keys = new Set());
    keys.add(key);
}

/** The public fields of a component or service that calls do not send (`send: false`). */
export function unsentStateKeys(target: object): ReadonlySet<string> {
    const declared = collectReactiveMetadata((target as { constructor?: unknown }).constructor).unsent;
    const injected = injectedUnsent.get(target);
    if (!injected?.size) return declared;
    return new Set([...declared, ...injected]);
}

/** The state a call sends: the public state without the `send: false` fields. */
export function callState(target: object, state: Record<string, unknown>): Record<string, unknown> {
    const unsent = unsentStateKeys(target);
    if (!unsent.size) return state;
    const sent: Record<string, unknown> = {};
    for (const key of Object.keys(state)) if (!unsent.has(key)) sent[key] = state[key];
    return sent;
}

/**
 * The state a reply (or an SSE publication) carries: the public state without the
 * `send: false` fields the method did not assign. The server holds them at their initial
 * values, which must not replace what the browser has.
 */
export function replyState(target: object, state: Record<string, unknown>, written: ReadonlySet<string>): Record<string, unknown> {
    const unsent = unsentStateKeys(target);
    if (!unsent.size) return state;
    const reply: Record<string, unknown> = {};
    for (const key of Object.keys(state)) if (!unsent.has(key) || written.has(key)) reply[key] = state[key];
    return reply;
}

/**
 * The size of the state a component's calls send (its public state without the `send: false`
 * fields), with its largest fields for a message. Undefined when the state has no JSON.
 */
export function measureCallState(target: object, state: Record<string, unknown>): { bytes: number; size: string; largest: string } | undefined {
    const sent = callState(target, state);
    const bytes = jsonBytes(sent);
    if (bytes === undefined) return undefined;
    return {
        bytes,
        get size() { return formatBytes(bytes); },
        get largest() { return describeStateFields(largestStateFields(sent)); },
    };
}

/** The byte size of a value's JSON, or undefined when it has none. */
function jsonBytes(value: unknown): number | undefined {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : new TextEncoder().encode(text).byteLength;
    } catch { return undefined; }
}

/** The largest fields of a state object by JSON size, largest first. */
export function largestStateFields(state: Record<string, unknown>, count = 3): { field: string; bytes: number }[] {
    const sizes: { field: string; bytes: number }[] = [];
    for (const field of Object.keys(state)) {
        const bytes = jsonBytes(state[field]);
        if (bytes !== undefined) sizes.push({ field, bytes });
    }
    return sizes.sort((a, b) => b.bytes - a.bytes).slice(0, count);
}

/** `storm (1.7 MB), rows (12 KB)` */
export function describeStateFields(fields: { field: string; bytes: number }[]): string {
    return fields.map(({ field, bytes }) => `${field} (${formatBytes(bytes)})`).join(', ');
}

/** A byte count for people: `812 B`, `12 KB`, `1.7 MB`. */
export function formatBytes(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Explain a call the server refused as too large (`COSSACK_RPC_REQUEST_TOO_LARGE`): what the
 * browser sent and the state fields that made it large. The server cannot say, because it
 * stops reading at its limit. Other errors pass through.
 */
export function explainRequestTooLarge(
    error: unknown,
    details: { action: string; state: Record<string, unknown>; bytes?: number; upload?: boolean },
): unknown {
    if (!(error instanceof RpcError) || error.code !== 'COSSACK_RPC_REQUEST_TOO_LARGE') return error;
    const fields = largestStateFields(details.state).filter(({ bytes }) => bytes > 0);
    const sent = details.bytes === undefined ? '' : ` sent ${formatBytes(details.bytes)} (${details.bytes} bytes)`;
    const largest = fields.length ? `; its largest state fields are ${describeStateFields(fields)}` : '';
    const option = details.upload ? 'rpc.maxUploadBytes' : 'rpc.maxRequestBytes';
    return new RpcError(error.code, `${error.message} The call to '${details.action}'${sent}. ` +
        `A call sends its arguments and the component's state${largest}. ` +
        `Keep a large field out of calls with @State({ send: false }), or raise ${option}.`,
        { requestId: error.requestId, status: error.status, cause: error });
}
