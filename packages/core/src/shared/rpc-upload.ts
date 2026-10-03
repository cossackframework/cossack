import { RPC_NATIVE_RESPONSE_HEADER, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES, RpcError } from './rpc-stream';

/** Keep native upload progress while exposing generator replies before load. */
export function sendRpcUpload(url: string, body: FormData, signal: AbortSignal,
    onProgress: (event: ProgressEvent) => void, clientRequestId?: string): Promise<Response> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
        let closed = false;
        let offset = 0;
        let knownRequestId: string | undefined = clientRequestId;
        const encoder = new TextEncoder();
        const requestId = () => knownRequestId ?? xhr.getResponseHeader?.('X-Cossack-Request-Id') ?? undefined;
        const headers = () => {
            const result = new Headers();
            for (const line of xhr.getAllResponseHeaders?.().split(/[\r\n]+/) ?? []) {
                const separator = line.indexOf(':');
                if (separator > 0) result.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
            }
            for (const key of ['Content-Type', RPC_NATIVE_RESPONSE_HEADER, 'X-Cossack-Request-Id']) {
                const value = xhr.getResponseHeader?.(key);
                if (value && !result.has(key)) result.set(key, value);
            }
            if (!result.has('Content-Type')) result.set('Content-Type', 'application/json');
            return result;
        };
        const detach = () => signal.removeEventListener('abort', abort);
        const fail = (error: RpcError) => {
            if (closed) return;
            closed = true; detach();
            if (stream) stream.error(error);
            else reject(error);
        };
        const abort = () => xhr.abort();
        const emit = (final: boolean) => {
            if (!stream || closed) return;
            try {
                const text = xhr.responseText;
                // Only complete lines are stable during progressive UTF-8
                // decoding. Never re-encode an incomplete character/frame.
                while (true) {
                    const newline = text.indexOf('\n', offset);
                    if (newline < 0) break;
                    const bytes = encoder.encode(text.slice(offset, newline + 1));
                    if (bytes.length - 1 > RPC_STREAM_MAX_FRAME_BYTES) throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC stream frame exceeds the byte limit.', { requestId: requestId() });
                    stream.enqueue(bytes); offset = newline + 1;
                }
                const remaining = text.slice(offset);
                if (encoder.encode(remaining).length > RPC_STREAM_MAX_FRAME_BYTES) throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC stream frame exceeds the byte limit.', { requestId: requestId() });
                if (final) {
                    if (remaining) stream.enqueue(encoder.encode(remaining));
                    closed = true; detach(); stream.close();
                }
            } catch (cause) {
                fail(cause instanceof RpcError ? cause : new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Upload response failed. The server outcome is unknown and is never retried.', { cause, requestId: requestId() }));
                xhr.abort();
            }
        };
        xhr.open('POST', url, true);
        if (clientRequestId) xhr.setRequestHeader('X-Cossack-Request-Id', clientRequestId);
        xhr.responseType = 'arraybuffer';
        xhr.upload.onprogress = onProgress;
        xhr.onreadystatechange = () => {
            // responseType can change at HEADERS_RECEIVED, before LOADING.
            // https://xhr.spec.whatwg.org/#the-responsetype-attribute
            if (xhr.readyState !== 2 || closed || stream) return;
            const responseHeaders = headers();
            knownRequestId = responseHeaders.get('X-Cossack-Request-Id') ?? knownRequestId;
            if (xhr.status < 200 || xhr.status >= 300 || responseHeaders.get(RPC_NATIVE_RESPONSE_HEADER) === 'native' ||
                responseHeaders.get('Content-Type')?.split(';', 1)[0] !== RPC_STREAM_CONTENT_TYPE) return;
            xhr.responseType = 'text';
            xhr.overrideMimeType?.(`${RPC_STREAM_CONTENT_TYPE};charset=utf-8`);
            const responseBody = new ReadableStream<Uint8Array>({
                start(controller) { stream = controller; },
                cancel() { closed = true; detach(); xhr.abort(); },
            });
            resolve(new Response(responseBody, { status: xhr.status, statusText: xhr.statusText, headers: responseHeaders }));
        };
        xhr.onprogress = () => emit(false);
        xhr.onload = () => {
            if (stream) { emit(true); return; }
            if (closed) return;
            try {
                const response = new Response(xhr.status === 204 || xhr.status === 205 || xhr.status === 304 ? null : xhr.response ?? xhr.responseText,
                    { status: xhr.status, statusText: xhr.statusText, headers: headers() });
                closed = true; detach(); resolve(response);
            } catch (cause) { fail(new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Upload failed. The server outcome is unknown and is never retried.', { cause, requestId: requestId() })); }
        };
        xhr.onerror = () => fail(new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Upload failed. The server outcome is unknown and is never retried.', { requestId: requestId() }));
        xhr.onabort = () => fail(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId: requestId() }));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { fail(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.')); return; }
        try { xhr.send(body); }
        catch (cause) { fail(new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Upload failed. The server outcome is unknown and is never retried.', { cause })); }
    });
}
