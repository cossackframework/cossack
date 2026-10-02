import { AsyncLocalStorage } from 'node:async_hooks';
import { describeUnsupportedValue, isClientVisibleError, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES, RpcError, type RpcStreamFrame } from '@cossackframework/core';

interface RpcStreamOptions {
    result: AsyncIterable<unknown>;
    requestId: string;
    signal: AbortSignal;
    getState: () => Record<string, unknown>;
    onState?: (state: Record<string, unknown>) => void;
    cleanup: () => Promise<void>;
}

export function isRpcStream(result: unknown): result is AsyncIterable<unknown> {
    return result !== null && typeof result === 'object' && Symbol.asyncIterator in result &&
        typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
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
    const encode = (frame: RpcStreamFrame) => {
        let bytes: Uint8Array;
        try { bytes = encoder.encode(`${JSON.stringify(frame)}\n`); }
        catch (cause) {
            const where = frame.type === 'error'
                ? null
                : describeUnsupportedValue(frame.value) ?? describeUnsupportedValue(frame.state);
            throw new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
                `Cannot serialize RPC stream ${frame.type} value or state${where ? `: unsupported value at ${where}` : ''}.`, { cause });
        }
        if (bytes.length - 1 > RPC_STREAM_MAX_FRAME_BYTES) {
            throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC stream frame exceeds the byte limit.');
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
                    options.onState?.(state);
                    const bytes = encode({ v: 1, type: finished ? 'done' : 'yield',
                        requestId: options.requestId, value: next.value, state });
                    if (finished) await cleanup();
                    if (closed) return;
                    controller.enqueue(bytes);
                    if (finished) { closed = true; controller.close(); }
                } catch (error) {
                    if (closed) return;
                    console.error('[Cossack RPC] stream failed:', { requestId: options.requestId, error });
                    try { await cleanup(); }
                    catch (cleanupError) { console.error('[Cossack RPC] cleanup failed:', { requestId: options.requestId, error: cleanupError }); }
                    if (closed) return;
                    closed = true;
                    controller.enqueue(encode({ v: 1, type: 'error', requestId: options.requestId,
                        code: isClientVisibleError(error) ? 'COSSACK_RPC_CLIENT_ERROR'
                            : error instanceof RpcError ? error.code : 'COSSACK_RPC_INTERNAL_ERROR',
                        message: isClientVisibleError(error) || error instanceof RpcError
                            ? error.message : 'Internal Server Error' }));
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
