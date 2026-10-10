import type { StorageRequirements } from './storage-capabilities';
import { RpcError } from './rpc-stream';

/** Counter replies are tiny records, not arbitrary application payloads. */
export const RATE_LIMIT_RESPONSE_MAX_BYTES = 8192;

export interface RateLimitHitOptions {
    /** Requested provider guarantees, checked before any built-in hit. */
    requires?: StorageRequirements;
    /** Cancel this decision. A counter already incremented is not rolled back. */
    signal?: AbortSignal;
    /** Backend deadline in milliseconds, including response EOF. Default 5000. */
    timeoutMs?: number;
}

function cancelled(): RpcError {
    return new RpcError('COSSACK_RPC_CANCELLED', 'Rate-limit decision was cancelled.');
}

export function assertRateLimitNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw cancelled();
}

/** Race even providers that ignore AbortSignal; observe their late rejection. */
export function rateLimitTimeout(options: RateLimitHitOptions): number {
    const timeoutMs = options.timeoutMs === undefined ? 5000 : options.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
        throw new Error('[Cossack] Rate-limit backend timeout must be integer milliseconds from 1 to 2147483647.');
    }
    return timeoutMs;
}

export async function runRateLimitOperation<T>(options: RateLimitHitOptions,
    work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeoutMs = rateLimitTimeout(options);
    assertRateLimitNotAborted(options.signal);
    const controller = new AbortController();
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = (reason: RpcError) => { controller.abort(reason); rejectAbort(reason); };
    const onAbort = () => abort(cancelled());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => abort(new RpcError('COSSACK_RPC_TIMEOUT',
        'Rate-limit backend deadline exceeded. The counter may already have been charged.')), timeoutMs);
    try {
        const pending = Promise.resolve().then(() => {
            assertRateLimitNotAborted(controller.signal);
            return work(controller.signal);
        });
        const result = await Promise.race([pending, aborted]);
        assertRateLimitNotAborted(controller.signal);
        return result;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
    }
}

/** Cleanup must not wait for a faulty producer's never-settling cancel hook. */
export function discardRateLimitResponse(response: Response): void {
    void response.body?.cancel().catch(() => {});
}

export async function readRateLimitResponse(response: Response, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted || !response.ok) {
        discardRateLimitResponse(response);
        assertRateLimitNotAborted(signal);
        throw new Error(`[Cossack] Rate-limit backend returned HTTP ${response.status}.`);
    }
    if (!response.body) throw new Error('[Cossack] Rate-limit backend returned no body.');
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const bytes = new Uint8Array(RATE_LIMIT_RESPONSE_MAX_BYTES);
    let size = 0;
    let complete = false;
    try {
        while (true) {
            assertRateLimitNotAborted(signal);
            const chunk = await reader.read();
            assertRateLimitNotAborted(signal);
            if (chunk.done) { complete = true; break; }
            // Response implementations may create bytes in another JS realm.
            if (!ArrayBuffer.isView(chunk.value) || Object.prototype.toString.call(chunk.value) !== '[object Uint8Array]' ||
                chunk.value.byteLength > bytes.length - size) {
                throw new Error('[Cossack] Rate-limit backend response exceeds 8192 bytes or is not byte data.');
            }
            bytes.set(new Uint8Array(chunk.value.buffer, chunk.value.byteOffset, chunk.value.byteLength), size);
            size += chunk.value.byteLength;
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    } finally {
        signal.removeEventListener('abort', cancel);
        if (!complete) cancel();
        reader.releaseLock();
    }
}
