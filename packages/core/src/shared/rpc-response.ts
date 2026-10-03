import { RpcError } from './rpc-stream';

/** Release client response ownership even when a request producer ignores abort. */
export function awaitRpcResponse(
    request: Promise<Response>,
    signal: AbortSignal,
    getRequestId: () => string,
): Promise<Response> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => { settled = true; signal.removeEventListener('abort', abort); };
        const abort = () => {
            if (settled) return;
            finish();
            reject(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { requestId: getRequestId() }));
        };
        // Observe the original request after cancellation too. A late response
        // is never hydrated and its body is released without delaying callers.
        void request.then(response => {
            if (settled) { void response.body?.cancel().catch(() => {}); return; }
            finish(); resolve(response);
        }, error => { if (!settled) { finish(); reject(error); } });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}
