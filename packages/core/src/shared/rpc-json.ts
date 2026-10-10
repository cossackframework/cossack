import { RpcError, RPC_NATIVE_RESPONSE_HEADER } from './rpc-stream';

/** Bound the entire ordinary RPC envelope, including state and diagnostics. */
export const RPC_JSON_RESPONSE_MAX_BYTES = 1024 * 1024;
type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid(response: Response, cause?: unknown): RpcError {
    return new RpcError('COSSACK_RPC_RESPONSE_INVALID', 'Invalid RPC response.', {
        requestId: response.headers.get('X-Cossack-Request-Id') || undefined,
        ...(!response.ok ? { status: response.status } : {}), cause,
    });
}

/** Consume before hydration; byte bounds, abort and ownership apply to errors too. */
async function readBody(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
    const requestId = response.headers.get('X-Cossack-Request-Id') || undefined;
    const cancelled = () => new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId });
    if (!response.body) {
        if (signal?.aborted) throw cancelled();
        return new Uint8Array();
    }
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    let buffer = new Uint8Array(4096);
    let size = 0;
    try {
        while (true) {
            if (signal?.aborted) throw cancelled();
            const next = await reader.read();
            if (signal?.aborted) throw cancelled();
            if (next.done) return buffer.subarray(0, size);
            const nextSize = size + next.value.byteLength;
            if (nextSize > RPC_JSON_RESPONSE_MAX_BYTES) throw new RpcError('COSSACK_RPC_RESPONSE_TOO_LARGE',
                'RPC JSON response exceeds the byte limit. Use an HTTP endpoint for larger bodies.', {
                    requestId, ...(!response.ok ? { status: response.status } : {}),
                });
            if (nextSize > buffer.length) {
                const grown = new Uint8Array(Math.min(RPC_JSON_RESPONSE_MAX_BYTES, Math.max(nextSize, buffer.length * 2)));
                grown.set(buffer.subarray(0, size)); buffer = grown;
            }
            buffer.set(next.value, size); size = nextSize;
        }
    } catch (cause) {
        if (signal?.aborted) throw cancelled();
        if (cause instanceof RpcError) throw cause;
        throw new RpcError('COSSACK_RPC_NETWORK_FAILED',
            'RPC response failed. The server outcome is unknown and is never retried.', { cause, requestId });
    } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {}); reader.releaseLock();
    }
}
function parseObject(response: Response, bytes: Uint8Array): JsonObject {
    try {
        const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!isObject(data)) throw new TypeError('Expected an RPC object envelope.');
        return data;
    } catch (cause) { throw invalid(response, cause); }
}

/** @internal Validate before state, result or navigation effects. */
export async function readRpcJsonResponse(
    response: Response, kind: 'component' | 'service', signal?: AbortSignal,
): Promise<JsonObject> {
    const data = parseObject(response, await readBody(response, signal));
    if (Object.hasOwn(data, '_cossack_redirect')) {
        const location = data._cossack_redirect;
        if (typeof location !== 'string' || !location.trim() || Object.keys(data).length !== 1) throw invalid(response);
        try {
            // Resolve only to validate the scheme. Navigation keeps the original
            // relative URL and the browser's actual document base.
            if (!['http:', 'https:'].includes(new URL(location, 'https://cossack.invalid').protocol)) throw invalid(response);
        } catch (cause) { throw invalid(response, cause); }
    } else if (kind === 'service') {
        if (!Object.hasOwn(data, '_cossack_service_state') || !isObject(data._cossack_service_state)) throw invalid(response);
    } else if (Object.hasOwn(data, '_cossack_service_state')) throw invalid(response);
    return data;
}

/** @internal Decode a failure without trusting untyped diagnostic properties. */
export async function readRpcHttpError(response: Response, signal?: AbortSignal): Promise<RpcError> {
    const bytes = await readBody(response, signal);
    let requestId = response.headers.get('X-Cossack-Request-Id') || undefined;
    const fallback = () => new RpcError('COSSACK_RPC_FAILED', `HTTP error! status: ${response.status}`, {
        status: response.status, requestId,
    });
    // Native bodies stay opaque, even if JSON fields resemble RPC metadata.
    if (response.headers.get(RPC_NATIVE_RESPONSE_HEADER) === 'native') return fallback();
    let data: JsonObject;
    try { data = parseObject(response, bytes); }
    catch (cause) {
        const mime = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
        if (mime === 'application/json' || mime?.endsWith('+json')) throw cause;
        return fallback(); // Plain-text/empty middleware and upstream errors.
    }
    if ((Object.hasOwn(data, 'code') && (typeof data.code !== 'string' || !data.code.trim())) ||
        (Object.hasOwn(data, 'error') && typeof data.error !== 'string') ||
        (Object.hasOwn(data, 'fieldErrors') && !isObject(data.fieldErrors)) ||
        (Object.hasOwn(data, 'requestId') && (typeof data.requestId !== 'string' || !data.requestId.trim() ||
            (requestId !== undefined && data.requestId !== requestId)))) throw invalid(response);
    if (typeof data.requestId === 'string') requestId ??= data.requestId;
    return new RpcError(typeof data.code === 'string' ? data.code : 'COSSACK_RPC_FAILED',
        typeof data.error === 'string' ? data.error : `HTTP error! status: ${response.status}`, {
            status: response.status, requestId, fieldErrors: data.fieldErrors as JsonObject | undefined,
        });
}
