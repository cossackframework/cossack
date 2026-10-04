import { AsyncLocalStorage } from 'node:async_hooks';
import { snapshotRpcFrame, RPC_NATIVE_RESPONSE_HEADER, isActionValidationError, isClientVisibleError, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES, RpcError, type RpcStreamFrame } from '@cossackframework/core';

interface RpcStreamOptions {
    result: AsyncIterable<unknown>;
    requestId: string;
    signal: AbortSignal;
    getState: () => Record<string, unknown>;
    getScopeState?: () => Record<string, unknown>;
    getStateCursor?: () => number | undefined;
    onState?: (state: Record<string, unknown>) => void | Promise<void>;
    cleanup: () => Promise<void>;
    developmentTrace?: (outcome: 'succeeded' | 'failed', cleanup: 'completed' | 'failed') => string;
}

export function isRpcStream(result: unknown): result is AsyncIterable<unknown> {
    return result !== null && typeof result === 'object' && Symbol.asyncIterator in result &&
        typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

/** Keep a custom Response's request facilities alive through body consumption. */
export async function retainRpcResponseBody(
    response: Response, signal: AbortSignal, dispose: () => Promise<void>,
): Promise<Response> {
    const inRequest = AsyncLocalStorage.snapshot();
    // Always override application-supplied protocol metadata. Native JSON or
    // NDJSON content types must not be mistaken for framework envelopes.
    const headers = new Headers(response.headers);
    headers.set(RPC_NATIVE_RESPONSE_HEADER, 'native');
    response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    if (!response.body) { await inRequest(dispose); return response; }
    const reader = response.body.getReader();
    let closed = false;
    let cleanupPromise: Promise<void> | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const cleanup = () => cleanupPromise ??= inRequest(async () => {
        signal.removeEventListener('abort', abort);
        try { await reader.cancel(); }
        finally { reader.releaseLock(); await dispose(); }
    });
    const abort = () => {
        if (closed) return;
        closed = true;
        controller.error(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'));
        void cleanup().catch(error => console.error('[Cossack RPC] response cleanup failed:', error));
    };
    const body = new ReadableStream<Uint8Array>({
        start(streamController) {
            controller = streamController;
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        },
        pull(streamController) {
            return inRequest(async () => {
                if (closed) return;
                try {
                    const next = await reader.read();
                    if (closed) return;
                    if (!next.done) { streamController.enqueue(next.value); return; }
                    await cleanup();
                    if (!closed) { closed = true; streamController.close(); }
                } catch (error) {
                    if (closed) return;
                    closed = true;
                    try { await cleanup(); }
                    finally { streamController.error(error); }
                }
            });
        },
        async cancel() { closed = true; await cleanup(); },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** A generator belongs to its action response, never a Worker-global store. */
export function createRpcStreamResponse(options: RpcStreamOptions): Response {
    // Pull/cancel callbacks may run after middleware has returned, or under a
    // different caller's context. Capture all stores, including application ORM stores.
    const inRequest = AsyncLocalStorage.snapshot();
    const iterator = options.result[Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    let closed = false;
    let finished = false;
    let cleanupPromise: Promise<void> | undefined;
    const snapshot = (frame: RpcStreamFrame) => {
        try { return snapshotRpcFrame(frame); }
        catch (cause) {
            if (cause instanceof RpcError) throw cause;
            throw new RpcError('COSSACK_RPC_SERIALIZATION_FAILED', 'Cannot serialize RPC stream value or state.', { cause });
        }
    };
    const encode = (frame: unknown, development?: string) => {
        let bytes: Uint8Array;
        try { bytes = encoder.encode(`${JSON.stringify(frame)}\n`); }
        catch (cause) {
            if (cause instanceof RpcError) throw cause;
            throw new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
                'Cannot serialize RPC stream value or state.', { cause });
        }
        if (bytes.length - 1 > RPC_STREAM_MAX_FRAME_BYTES) {
            throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC stream frame exceeds the byte limit.');
        }
        if (import.meta.env.DEV && development) {
            const candidate = encoder.encode(`${JSON.stringify({ ...(frame as Record<string, unknown>), developmentTrace: development })}\n`);
            // Observability must not turn an otherwise valid frame into a size failure.
            // Leave room for the SSE coordinator to add its numeric state cursor.
            if (candidate.length - 1 + 64 <= RPC_STREAM_MAX_FRAME_BYTES) return candidate;
        }
        return bytes;
    };
    const cleanup = () => cleanupPromise ??= inRequest(async () => {
        options.signal.removeEventListener('abort', onAbort);
        try { if (!finished) await iterator.return?.(); }
        finally { await options.cleanup(); }
    });
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const onAbort = () => {
        if (closed) return;
        closed = true;
        streamController.error(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId: options.requestId }));
        void cleanup().catch(error => console.error('[Cossack RPC] cancellation cleanup failed:', error));
    };
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            streamController = controller;
            options.signal.addEventListener('abort', onAbort, { once: true });
            if (options.signal.aborted) onAbort();
        },
        pull(controller) {
            return inRequest(async () => {
                if (closed) return;
                try {
                    const next = await iterator.next();
                    if (closed) return;
                    finished = next.done === true;
                    const state = options.getState();
                    await options.onState?.(state);
                    const cursor = options.getStateCursor?.();
                    const frame = snapshot({ v: 1, type: finished ? 'done' : 'yield',
                        requestId: options.requestId, value: next.value,
                        state: cursor === undefined ? state : { ...state, _cossack_sse_cursor: cursor },
                        ...(options.getScopeState ? { scopeState: options.getScopeState() } : {}) });
                    let bytes = encode(frame);
                    if (finished) await cleanup();
                    if (closed) return;
                    if (import.meta.env.DEV && finished && options.developmentTrace) {
                        bytes = encode(frame, options.developmentTrace('succeeded', 'completed'));
                    }
                    controller.enqueue(bytes);
                    if (finished) { closed = true; controller.close(); }
                } catch (error) {
                    if (closed) return;
                    console.error('[Cossack RPC] stream failed:', { requestId: options.requestId, error });
                    let cleanupFailed = false;
                    try { await cleanup(); }
                    catch (cleanupError) { cleanupFailed = true; console.error('[Cossack RPC] cleanup failed:', { requestId: options.requestId, error: cleanupError }); }
                    if (closed) return;
                    closed = true;
                    controller.enqueue(encode(snapshot({ v: 1, type: 'error', requestId: options.requestId,
                        code: isActionValidationError(error) ? error.validationCode : isClientVisibleError(error) ? 'COSSACK_RPC_CLIENT_ERROR'
                            : error instanceof RpcError ? error.code : 'COSSACK_RPC_INTERNAL_ERROR',
                        fieldErrors: isActionValidationError(error) || error instanceof RpcError ? error.fieldErrors : undefined,
                        message: isClientVisibleError(error) || error instanceof RpcError
                            ? error.message : 'Internal Server Error' }), import.meta.env.DEV ? options.developmentTrace?.('failed', cleanupFailed ? 'failed' : 'completed') : undefined));
                    controller.close();
                }
            });
        },
        async cancel() { closed = true; await cleanup(); },
    }, { highWaterMark: 0 });
    return new Response(stream, {
        headers: { 'Content-Type': RPC_STREAM_CONTENT_TYPE, 'Cache-Control': 'no-store',
            'X-Cossack-Request-Id': options.requestId },
    });
}
