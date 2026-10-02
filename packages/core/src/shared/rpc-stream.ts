/** Versioned, response-local RPC stream protocol. Each UTF-8 line is one frame. */
export const RPC_STREAM_CONTENT_TYPE = 'application/x-cossack-rpc+ndjson';
export const RPC_STREAM_MAX_FRAME_BYTES = 1024 * 1024;

export type RpcStreamFrame =
    | { v: 1; type: 'yield' | 'done'; requestId: string; state: Record<string, unknown>; value?: unknown }
    | { v: 1; type: 'error'; requestId: string; code: string; message: string };

/** Stable transport diagnostics. Application failures reject the RPC call. */
export class RpcError extends Error {
    readonly code: string;
    readonly requestId?: string;
    readonly status?: number;

    constructor(code: string, message: string, details: { requestId?: string; status?: number; cause?: unknown } = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = 'RpcError';
        this.code = code;
        this.requestId = details.requestId;
        this.status = details.status;
    }
}

function parseFrame(bytes: Uint8Array): RpcStreamFrame {
    let frame: any;
    try {
        frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (cause) {
        throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'Invalid RPC stream frame.', { cause });
    }
    if (!frame || frame.v !== 1 || typeof frame.requestId !== 'string' || !frame.requestId ||
        !['yield', 'done', 'error'].includes(frame.type) ||
        (frame.type === 'error'
            ? typeof frame.code !== 'string' || typeof frame.message !== 'string'
            : !frame.state || typeof frame.state !== 'object' || Array.isArray(frame.state))) {
        throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'Unsupported or malformed RPC stream frame.');
    }
    return frame;
}

/** Incremental byte-bounded parsing, independent of network chunk boundaries. */
export async function* readRpcStream(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<RpcStreamFrame> {
    if (!response.body) throw new RpcError('COSSACK_RPC_STREAM_INVALID', 'RPC stream has no response body.');
    const reader = response.body.getReader();
    let buffer = new Uint8Array(4096);
    let size = 0;
    let terminal = false;
    let requestId: string | undefined;
    const abortError = () => new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId });
    const cancelReader = () => { void reader.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', cancelReader, { once: true });
    const append = (part: Uint8Array) => {
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
                yield decode();
                start = i + 1;
            }
            append(value.subarray(start));
        }
        if (size) throw new RpcError('COSSACK_RPC_STREAM_TRUNCATED', 'RPC stream ended inside a frame.', { requestId });
        if (!terminal) throw new RpcError('COSSACK_RPC_STREAM_TRUNCATED', 'RPC stream ended without a result.', { requestId });
    } finally {
        signal?.removeEventListener('abort', cancelReader);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export interface RpcCall<Result = unknown, Yield = unknown> extends PromiseLike<Result>, AsyncIterable<Yield> {
    catch<TResult = never>(onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<Result | TResult>;
    finally(onFinally?: (() => void) | null): Promise<Result>;
    cancel(): Promise<void>;
}

/** Minimal structural socket used by the correlated WebSocket RPC protocol. */
export type RpcSocket = { readyState?: number; send: (data: string) => void };

/** Send one correlated RPC frame over a client socket when it is open. */
export function sendRpcFrame(client: unknown, frame: RpcStreamFrame): void {
    const socket = client as RpcSocket | null | undefined;
    if (socket && socket.readyState === 1) {
        try { socket.send(JSON.stringify(frame)); } catch { /* the socket died mid-send */ }
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
 */
export function createRpcCall<Result, Yield>(
    operation: AsyncGenerator<Yield, Result>,
    abort: () => void,
    onUnobservedError?: (error: unknown) => void,
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
    const next = (): Promise<IteratorResult<Yield, Result>> => {
        const pending = queue.then(async () => {
            if (settled) return { done: true as const, value: undefined as Result };
            try {
                const result = await operation.next();
                if (result.done) { settled = true; resolve(result.value); }
                return result;
            } catch (error) {
                settled = true;
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
    const cancel = async () => {
        if (settled) return;
        abort();
        // An abort releases an in-flight reader before closing the generator.
        await queue;
        try { await operation.return(undefined as Result); }
        finally {
            if (!settled) {
                settled = true;
                reject(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'));
            }
        }
    };
    const call: RpcCall<Result, Yield> = {
        then(onFulfilled, onRejected) {
            observed = true;
            drive();
            return completion.then(onFulfilled, onRejected);
        },
        catch(onRejected) { observed = true; drive(); return completion.catch(onRejected); },
        finally(onFinally) { observed = true; drive(); return completion.finally(onFinally); },
        cancel,
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
    queueMicrotask(drive);
    return call;
}
