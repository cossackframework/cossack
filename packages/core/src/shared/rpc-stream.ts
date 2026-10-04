/** Versioned, response-local RPC stream protocol. Each UTF-8 line is one frame. */
export const RPC_STREAM_CONTENT_TYPE = 'application/x-cossack-rpc+ndjson';
export const RPC_STREAM_MAX_FRAME_BYTES = 1024 * 1024;
/** Identifies an action-owned HTTP response rather than an RPC state envelope. */
export const RPC_NATIVE_RESPONSE_HEADER = 'X-Cossack-Rpc-Response';
export const RPC_NATIVE_RESPONSE_MAX_BYTES = 1024 * 1024;

/** Optional development evidence is ignored by the production protocol consumer. */
export type RpcStreamFrame = { developmentTrace?: unknown } & (
    | { v: 1; type: 'yield' | 'done'; requestId: string; state: Record<string, unknown>; value?: unknown; scopeState?: Record<string, unknown> }
    | { v: 1; type: 'error'; requestId: string; code: string; message: string; fieldErrors?: Record<string, unknown> });

/** Stable transport diagnostics. Application failures reject the RPC call. */
export class RpcError extends Error {
    readonly code: string;
    readonly requestId?: string;
    readonly status?: number;
    readonly fieldErrors?: Record<string, unknown>;

    constructor(code: string, message: string, details: { requestId?: string; status?: number; cause?: unknown; fieldErrors?: Record<string, unknown> } = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = 'RpcError';
        this.code = code;
        this.requestId = details.requestId;
        this.status = details.status;
        this.fieldErrors = details.fieldErrors;
    }
}

/** Failures whose diagnostics cannot establish whether server writes finished. */
export function isUncertainRpcError(error: unknown): error is RpcError {
    if (!(error instanceof RpcError)) return false;
    if (['COSSACK_RPC_NETWORK_FAILED', 'COSSACK_RPC_TRANSPORT_CLOSED', 'COSSACK_RPC_TIMEOUT',
        'COSSACK_RPC_CANCELLED', 'COSSACK_RPC_RESPONSE_INVALID', 'COSSACK_RPC_RESPONSE_TOO_LARGE',
        'COSSACK_RPC_STREAM_INVALID', 'COSSACK_RPC_STREAM_TOO_LARGE', 'COSSACK_RPC_STREAM_TRUNCATED',
        'COSSACK_RPC_BUFFER_EXCEEDED', 'COSSACK_RPC_INTERNAL_ERROR'].includes(error.code)) return true;
    // Pre-dispatch serialization and send errors have no correlated server
    // reply. A server-side serialization failure can follow a committed write.
    if (error.code === 'COSSACK_RPC_SERIALIZATION_FAILED') return error.requestId !== undefined || (error.status ?? 0) >= 500;
    return error.code === 'COSSACK_RPC_FAILED' && (error.status ?? 0) >= 500;
}

function parseFrame(bytes: Uint8Array): RpcStreamFrame {
    let frame: any;
    try {
        frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (cause) {
        throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'Invalid RPC stream frame.', { cause });
    }
    return validateRpcFrame(frame);
}

/** Validate the same correlated protocol on HTTP and WebSocket transports. */
export function validateRpcFrame(frame: any): RpcStreamFrame {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.v !== 1 ||
        typeof frame.requestId !== 'string' || !frame.requestId.trim() ||
        !['yield', 'done', 'error'].includes(frame.type) ||
        (frame.type === 'error'
            ? typeof frame.code !== 'string' || !frame.code.trim() || typeof frame.message !== 'string' ||
                (frame.fieldErrors !== undefined && (!frame.fieldErrors || typeof frame.fieldErrors !== 'object' || Array.isArray(frame.fieldErrors)))
            : !frame.state || typeof frame.state !== 'object' || Array.isArray(frame.state) ||
                (frame.scopeState !== undefined && (!frame.scopeState ||
                    typeof frame.scopeState !== 'object' || Array.isArray(frame.scopeState))))) {
        throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'Unsupported or malformed RPC stream frame.');
    }
    return frame;
}

/** Incremental byte-bounded parsing, independent of network chunk boundaries. */
export async function* readRpcStream(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<RpcStreamFrame> {
    let requestId = response.headers.get('X-Cossack-Request-Id') || undefined;
    if (!response.body) throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'RPC stream has no response body.', { requestId });
    const reader = response.body.getReader();
    let buffer = new Uint8Array(4096);
    let size = 0;
    let terminal = false;
    let completion: RpcStreamFrame | undefined;
    const abortError = () => new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId });
    const cancelReader = () => { void reader.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', cancelReader, { once: true });
    const append = (part: Uint8Array) => {
        if (terminal && part.byteLength) throw new RpcError('COSSACK_RPC_STREAM_INVALID',
            'RPC stream contains data after its result.', { requestId });
        const nextSize = size + part.byteLength;
        if (nextSize > RPC_STREAM_MAX_FRAME_BYTES) {
            throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC stream frame exceeds the byte limit.', { requestId });
        }
        if (nextSize > buffer.length) {
            const grown = new Uint8Array(Math.min(RPC_STREAM_MAX_FRAME_BYTES, Math.max(nextSize, buffer.length * 2)));
            grown.set(buffer.subarray(0, size));
            buffer = grown;
        }
        // A single bounded buffer also bounds overhead for one-byte network chunks.
        buffer.set(part, size);
        size = nextSize;
    };
    const decode = () => {
        if (terminal) throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'RPC stream contains frames after its result.', { requestId });
        const frame = parseFrame(buffer.subarray(0, size));
        size = 0;
        if (terminal || (requestId && frame.requestId !== requestId)) {
            throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'RPC stream contains inconsistent frames.', { requestId });
        }
        requestId = frame.requestId;
        terminal = frame.type !== 'yield';
        return frame;
    };
    try {
        while (true) {
            if (signal?.aborted) throw abortError();
            const { value, done } = await reader.read();
            if (signal?.aborted) throw abortError();
            if (done) break;
            let start = 0;
            for (let i = 0; i < value.length; i++) {
                if (value[i] !== 10) continue;
                append(value.subarray(start, i));
                const frame = decode();
                if (frame.type === 'yield') yield frame;
                else completion = frame;
                start = i + 1;
            }
            append(value.subarray(start));
        }
        if (size) throw new RpcError('COSSACK_RPC_STREAM_TRUNCATED', 'RPC stream ended inside a frame.', { requestId });
        if (!terminal) throw new RpcError('COSSACK_RPC_STREAM_TRUNCATED', 'RPC stream ended without a result.', { requestId });
        // Consumers return on done/error. Withhold that frame until EOF so
        // trailing data or a body failure cannot masquerade as completion.
        yield completion!;
    } catch (cause) {
        if (cause instanceof RpcError) throw new RpcError(cause.code, cause.message,
            { cause, requestId: requestId ?? cause.requestId, status: cause.status, fieldErrors: cause.fieldErrors });
        throw new RpcError('COSSACK_RPC_NETWORK_FAILED',
            'RPC stream failed. The server outcome is unknown and is never retried.', { cause, requestId });
    } finally {
        signal?.removeEventListener('abort', cancelReader);
        // Cancellation hooks may ignore abort or never settle. Do not retain the
        // reader lock and local call lifetime while waiting for producer cleanup.
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/**
 * Finish the native body before completing a call, preserving deadlines and
 * request cleanup even for unobserved calls. The returned local Response has
 * a readable body; it is not the server's Response instance or a live stream.
 */
export async function readRpcNativeResponse(response: Response, signal?: AbortSignal): Promise<Response> {
    const requestId = response.headers.get('X-Cossack-Request-Id') ?? undefined;
    if (signal?.aborted) {
        await response.body?.cancel().catch(() => {});
        throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId });
    }
    if (!response.body) return new Response(null, response);
    const reader = response.body.getReader();
    let buffer = new Uint8Array(4096);
    let size = 0;
    const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            if (signal?.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId });
            const next = await reader.read();
            if (signal?.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId });
            if (next.done) break;
            size += next.value.byteLength;
            if (size > RPC_NATIVE_RESPONSE_MAX_BYTES) throw new RpcError('COSSACK_RPC_RESPONSE_TOO_LARGE',
                'Native RPC response exceeds the byte limit. Use an HTTP endpoint for larger or continuous bodies.', { requestId });
            if (size > buffer.length) {
                const grown = new Uint8Array(Math.min(RPC_NATIVE_RESPONSE_MAX_BYTES, Math.max(size, buffer.length * 2)));
                grown.set(buffer);
                buffer = grown;
            }
            buffer.set(next.value, size - next.value.byteLength);
        }
        return new Response(buffer.slice(0, size), response);
    } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export interface RpcCall<Result = unknown, Yield = unknown> extends PromiseLike<Result>, AsyncIterable<Yield> {
    catch<TResult = never>(onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<Result | TResult>;
    finally(onFinally?: (() => void) | null): Promise<Result>;
    cancel(): Promise<void>;
}

// Successful HTTP control-flow bodies resolve to a local buffered Response;
// redirects resolve to undefined. Native Responses cannot be stream values.
/** The JSON representation of a server value, without native prototypes. */
export type RpcSerialized<T> = 0 extends (1 & T) ? any
    : T extends string | number | boolean | null | undefined | void ? T
    : T extends symbol | bigint ? never
    : T extends (...args: any[]) => unknown ? never
    : T extends Date ? string
    : T extends Response | Request | Headers | Blob | ArrayBuffer | ArrayBufferView |
        Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any> | WeakRef<any> |
        RegExp | Error | PromiseLike<any> | Number | String | Boolean ? never
    : T extends { toJSON(...args: any[]): infer Value } ? Value extends T
        ? T extends readonly unknown[] ? RpcSerializedArray<T> : RpcSerializedFields<T>
        : RpcSerialized<Value>
    : T extends readonly unknown[] ? RpcSerializedArray<T>
    : T extends object ? RpcSerializedOptionalHook<T>
    : T;
type RpcSerializedArray<T extends readonly unknown[]> = { [K in keyof T]: RpcSerialized<Exclude<T[K], undefined>> | (undefined extends T[K] ? null : never) };
type RpcSerializedFields<T> = { [K in keyof T as K extends string | number
        ? Exclude<T[K], undefined> extends (...args: any[]) => unknown ? never : K
        : never]: RpcSerialized<T[K]> };
type RpcSerializedOptionalHook<T> = 'toJSON' extends keyof T
    ? Extract<T['toJSON' & keyof T], (...args: any[]) => unknown> extends infer Hook
        ? [Hook] extends [never] ? RpcSerializedFields<T>
            : Hook extends (...args: any[]) => infer Result ? RpcSerializedFields<T> | RpcSerialized<Result> : RpcSerializedFields<T>
        : RpcSerializedFields<T>
    : RpcSerializedFields<T>;
type RpcClientValue<T> = T extends Response ? Response | undefined : RpcSerialized<T>;
type RpcTerminal<T> = RpcClientValue<Awaited<T>>;

/** Final client result inferred from an authored server method's return type. */
export type RpcResult<T> = T extends RpcCall<infer Result, any> ? RpcTerminal<Result>
    : T extends PromiseLike<infer Value> ? RpcResult<Value>
    : T extends AsyncIterable<unknown> & AsyncIterator<unknown, infer Result, any> ? RpcSerialized<Awaited<Result>>
    : T extends AsyncIterable<unknown> ? unknown
    : T extends Response ? Response | undefined
    : RpcSerialized<T>;

/** Client stream values; ordinary server methods have no yielded values. */
export type RpcYield<T> = T extends RpcCall<any, infer Yield> ? RpcSerialized<Yield>
    : T extends PromiseLike<infer Value> ? RpcYield<Value>
    : T extends AsyncIterable<infer Yield> ? RpcSerialized<Awaited<Yield>>
    : never;

const rpcCalls = new WeakSet<object>();

/**
 * View a browser server-method call with its inferred RPC result/yield types.
 * TypeScript decorators cannot change the authored method signature. This
 * helper exposes the proxy contract to the editor without invoking another
 * operation, wrapping its consumers, or relying on Vite's signature rewrite.
 * Use synchronously around the call in client code, before awaiting/iterating.
 */
export function rpc$<ServerReturn>(call: ServerReturn): RpcCall<RpcResult<ServerReturn>, RpcYield<ServerReturn>> {
    if (!call || typeof call !== 'object' || !rpcCalls.has(call)) {
        throw new RpcError('COSSACK_RPC_CALL_REQUIRED',
            'rpc$ requires a browser server-method proxy call. Use it in @Client code before awaiting or iterating the call.');
    }
    return call as unknown as RpcCall<RpcResult<ServerReturn>, RpcYield<ServerReturn>>;
}

/**
 * Locate the first RPC-unsupported value in a tree and describe it by path:
 * functions, symbols, bigints, cyclic structures, and weak collections cannot
 * cross the RPC boundary. Returns null when the value is transportable.
 * Paths use dot/bracket notation from the root (e.g. `items[2].onChange`).
 */
export function describeUnsupportedValue(
    value: unknown,
    path = '',
    seen = new WeakSet<object>(),
    options: { handled?: (value: object) => boolean } = {},
): string | null {
    try { snapshotValue(value, path, seen, { handled: options.handled }, 0, '', true); return null; }
    catch (error) { if (error instanceof UnsupportedRpcValue) return error.description; throw error; }
}

/** Inspect known data properties without running serialization hooks or getters. */
export function describeUnsupportedStateValue(value: unknown, path = 'state'): string | null {
    try {
        snapshotValue(value, path, new WeakSet(), { inspection: { remaining: 10000 } }, 0, '', true);
        return null;
    } catch (error) {
        return error instanceof UnsupportedRpcValue ? error.description : `${path} (inspection failed)`;
    }
}

class UnsupportedRpcValue extends Error {
    constructor(readonly description: string) { super(description); }
}

type SnapshotOptions = {
    handled?: (value: object) => boolean;
    inspection?: { remaining: number };
};

/** Find a property descriptor without invoking its getter. */
function inheritedDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
    let depth = 0;
    for (let current: object | null = value; current; current = Object.getPrototypeOf(current)) {
        if (++depth > 256) throw new Error('Prototype inspection limit exceeded.');
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor) return descriptor;
    }
    return undefined;
}

/** Snapshot once, then stringify this plain value; never evaluate toJSON twice. */
export function snapshotRpcValue(value: unknown, path = '', options: { handled?: (value: object) => boolean } = {}): unknown {
    try { return snapshotValue(value, path, new WeakSet(), { handled: options.handled }, 0, '', true); }
    catch (cause) {
        if (!(cause instanceof UnsupportedRpcValue)) throw cause;
        throw new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
            `Cannot serialize RPC data: unsupported value at ${cause.description}.`);
    }
}

/** Values use a root JSON key on every transport, independent of its envelope. */
export function snapshotRpcFrame(frame: RpcStreamFrame): unknown {
    if (frame.type === 'error') return snapshotRpcValue(frame);
    const metadata = snapshotRpcValue({ ...frame, value: undefined, state: undefined, scopeState: undefined }) as Record<string, unknown>;
    return { ...metadata, value: snapshotRpcValue(frame.value, 'value'), state: snapshotRpcValue(frame.state, 'state'),
        ...(frame.scopeState ? { scopeState: snapshotRpcValue(frame.scopeState, 'scopeState') } : {}) };
}

function snapshotValue(value: unknown, path: string, seen: WeakSet<object>,
    options: SnapshotOptions, depth: number, key: string, applyToJSON: boolean): unknown {
    const fail = (reason: string): never => { throw new UnsupportedRpcValue(`${path || '(root)'} (${reason})`); };
    if (options.inspection && options.inspection.remaining-- <= 0) return undefined;
    if (depth > 256) return fail('maximum depth exceeded');
    if (value === null || value === undefined) return value;
    const type = typeof value;
    if (type === 'number') return Number.isFinite(value) ? value : fail('non-finite number');
    if (type === 'string' || type === 'boolean') return value;
    if (type !== 'object') return fail(type);
    const object = value as Record<string, unknown>;
    if (options.handled?.(object)) return value;
    if (seen.has(object)) return fail('cyclic reference');
    if (value instanceof Date) {
        if (!Number.isFinite(Date.prototype.getTime.call(value))) return fail('invalid Date');
        return Date.prototype.toISOString.call(value);
    }
    if (value instanceof Response || value instanceof Request || value instanceof Headers)
        return fail(value instanceof Response ? 'Response' : value instanceof Request ? 'Request' : 'Headers');
    if (value instanceof WeakMap || value instanceof WeakSet || (typeof WeakRef !== 'undefined' && value instanceof WeakRef)) return fail('weak collection');
    if (value instanceof Map || value instanceof Set) return fail(value instanceof Map ? 'Map' : 'Set');
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return fail('binary value');
    if (value instanceof RegExp || value instanceof Error || value instanceof Promise ||
        value instanceof Number || value instanceof String || value instanceof Boolean) return fail('native object');
    seen.add(object);
    try {
        let toJSON: unknown;
        if (options.inspection && applyToJSON) {
            const descriptor = inheritedDescriptor(object, 'toJSON');
            // A custom representation or getter is unknown until the real serializer runs.
            if (descriptor && (!('value' in descriptor) || typeof descriptor.value === 'function')) return undefined;
        }
        try { toJSON = applyToJSON && !options.inspection ? object.toJSON : undefined; }
        catch { return fail('toJSON access failed'); }
        if (typeof toJSON === 'function') {
            let representation: unknown;
            try { representation = toJSON.call(value, key); }
            catch { return fail('toJSON failed'); }
            if (representation === value) seen.delete(object);
            // JSON invokes this value's hook once, not a second hook on its
            // returned representation. Nested properties get their own hooks.
            return snapshotValue(representation, path, seen, options, depth + 1, key, false);
        }
        if (Array.isArray(value)) {
            const result: unknown[] = [];
            for (let index = 0; index < value.length; index++) {
                if (options.inspection && options.inspection.remaining <= 0) break;
                let field: unknown;
                if (options.inspection) {
                    const descriptor = inheritedDescriptor(value, String(index));
                    if (descriptor && !('value' in descriptor)) continue;
                    field = descriptor?.value;
                }
                try { if (!options.inspection) field = value[index]; }
                catch { throw new UnsupportedRpcValue(`${path}[${index}] (property access failed)`); }
                const normalized = snapshotValue(field, `${path}[${index}]`, seen, options, depth + 1, String(index), true);
                if (!options.inspection) result.push(normalized ?? null);
            }
            return result;
        }
        let tag: string;
        if (options.inspection) {
            const descriptor = inheritedDescriptor(object, Symbol.toStringTag);
            if (descriptor && !('value' in descriptor)) return undefined;
        }
        try { tag = Object.prototype.toString.call(value); }
        catch { return fail('object tag access failed'); }
        if (tag !== '[object Object]') return fail('native object');
        // Data/model instances cross as own enumerable fields, never methods
        // or prototypes. A null prototype also preserves an own __proto__ key.
        const result = Object.create(null) as Record<string, unknown>;
        let keys: string[];
        try { keys = Object.keys(object); }
        catch { return fail('property enumeration failed'); }
        for (const property of keys) {
            if (options.inspection && options.inspection.remaining <= 0) break;
            const location = path ? `${path}.${property}` : property;
            let field: unknown;
            if (options.inspection) {
                const descriptor = Object.getOwnPropertyDescriptor(object, property);
                if (!descriptor || !('value' in descriptor)) continue;
                field = descriptor.value;
            }
            try { if (!options.inspection) field = object[property]; }
            catch { throw new UnsupportedRpcValue(`${location} (property access failed)`); }
            const normalized = snapshotValue(field, location, seen, options, depth + 1, property, true);
            if (!options.inspection && normalized !== undefined) result[property] = normalized;
        }
        return result;
    } finally { seen.delete(object); }
}

/** Minimal structural socket used by the correlated WebSocket RPC protocol. */
export type RpcSocket = { readyState?: number; send: (data: string) => void };

/** Send one correlated RPC frame over a client socket when it is open. */
export function sendRpcFrame(client: unknown, frame: RpcStreamFrame, development?: (type: RpcStreamFrame['type']) => string | undefined): void {
    const socket = client as RpcSocket | null | undefined;
    if (socket && socket.readyState === 1) {
        let serialized: string;
        try { serialized = JSON.stringify(snapshotRpcFrame(frame)); }
        catch (cause) { throw new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
            cause instanceof RpcError ? cause.message : 'Cannot serialize RPC frame.',
            { requestId: frame.requestId, cause }); }
        if (new TextEncoder().encode(serialized).length > RPC_STREAM_MAX_FRAME_BYTES) {
            throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC frame exceeds the byte limit.', { requestId: frame.requestId });
        }
        // Evidence never changes application serialization or turns an otherwise
        // valid frame into an oversized failure. Snapshot application values once.
        if (import.meta.env?.DEV && development) {
            const evidence = development(frame.type);
            if (evidence) {
                const withEvidence = JSON.stringify({ ...JSON.parse(serialized), developmentTrace: evidence });
                if (new TextEncoder().encode(withEvidence).length <= RPC_STREAM_MAX_FRAME_BYTES) serialized = withEvidence;
            }
        }
        try { socket.send(serialized); } catch { /* the socket died mid-send */ }
    }
}

/** Per-socket cancellation hooks for request-scoped WebSocket calls. */
export function rpcCancellations(client: unknown): Map<string, () => void> {
    const socket = client as { __cossack_rpc_cancellations?: Map<string, () => void> } | null | undefined;
    if (!socket || typeof socket !== 'object') return new Map();
    return socket.__cossack_rpc_cancellations ??= new Map();
}

/**
 * One operation, one response, one iterator. Await drains the stream and returns
 * its final result. Iteration yields values with backpressure. A discarded call
 * drains automatically so event-handler calls still execute and clean up.
 * An optional cancellation signal closes paused consumers with the supplied error.
 */
export function createRpcCall<Result, Yield>(
    operation: AsyncGenerator<Yield, Result>,
    abort: () => void,
    onUnobservedError?: (error: unknown) => void,
    getRequestId?: () => string | undefined,
    cancellation?: { signal: AbortSignal; error: () => RpcError },
): RpcCall<Result, Yield> {
    let resolve!: (value: Result) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
    // Observe internally without swallowing rejections returned to callers.
    void completion.catch(() => {});
    let mode: 'promise' | 'iterator' | undefined;
    let settled = false;
    let observed = false;
    let queue: Promise<unknown> = Promise.resolve();
    let interruption: RpcError | undefined;
    let interruptionDelivered = false;
    let closing: Promise<void> | undefined;
    const detach = () => cancellation?.signal.removeEventListener('abort', onAbort);
    const next = (): Promise<IteratorResult<Yield, Result>> => {
        const pending = queue.then(async () => {
            if (settled) {
                // A paused iterator must observe the deadline instead of silently ending.
                if (interruption && !interruptionDelivered) { interruptionDelivered = true; throw interruption; }
                return { done: true as const, value: undefined as Result };
            }
            try {
                const result = await operation.next();
                if (interruption) throw interruption;
                if (result.done) { settled = true; detach(); resolve(result.value); }
                return result;
            } catch (error) {
                if (interruption) { error = interruption; interruptionDelivered = true; }
                settled = true;
                detach();
                reject(error);
                throw error;
            }
        });
        queue = pending.catch(() => {});
        return pending;
    };
    const drive = () => {
        if (mode) return;
        mode = 'promise';
        void (async () => {
            try { while (!(await next()).done) { /* apply state and drain yields */ } }
            catch (error) { if (!observed) onUnobservedError?.(error); }
        })();
    };
    const cancel = (): Promise<void> => {
        if (closing) return closing;
        if (settled) return Promise.resolve();
        interruption = cancellation?.error() ?? new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId: getRequestId?.() });
        settled = true;
        detach();
        reject(interruption);
        let closed!: () => void, failed!: (error: unknown) => void;
        closing = new Promise<void>((resolve, reject) => { closed = resolve; failed = reject; });
        // Install the latch before abort: transport callbacks can reenter cancel.
        let abortFailure: unknown, abortFailed = false;
        try { abort(); } catch (error) { abortFailed = true; abortFailure = error; }
        // Closing a parked generator runs its finally blocks without another consumer pull.
        void queue.then(() => operation.return(undefined as Result)).then(() => {
            if (abortFailed) failed(abortFailure); else closed();
        }, failed);
        return closing;
    };
    const onAbort = () => { void cancel().catch(error => { if (!observed) onUnobservedError?.(error); }); };
    const call: RpcCall<Result, Yield> = {
        then(onFulfilled, onRejected) {
            observed = true;
            drive();
            return completion.then(onFulfilled, onRejected);
        },
        catch(onRejected) { observed = true; drive(); return completion.catch(onRejected); },
        finally(onFinally) { observed = true; drive(); return completion.finally(onFinally); },
        cancel() { observed = true; return cancel(); },
        [Symbol.asyncIterator]() {
            if (mode) throw new RpcError('COSSACK_RPC_ALREADY_CONSUMED', 'RPC results already have a consumer.');
            mode = 'iterator';
            observed = true;
            return {
                next,
                async return() { await cancel(); return { done: true, value: undefined as Result }; },
            };
        },
    };
    rpcCalls.add(call);
    cancellation?.signal.addEventListener('abort', onAbort, { once: true });
    if (cancellation?.signal.aborted) onAbort();
    queueMicrotask(drive);
    return call;
}
