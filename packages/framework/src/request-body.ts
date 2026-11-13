/** Bounded request-body reading shared by declared APIs and RPC transports. */

/**
 * Read a body stream into memory, failing as soon as more than `limit` bytes
 * arrive. The stream is always cancelled afterwards so a hostile client cannot
 * keep the request alive. `read` lets callers wrap reads (for example with an
 * abort signal).
 */
export async function readBoundedBody(
    body: ReadableStream<Uint8Array>,
    limit: number,
    tooLarge: () => Error,
    read: (reader: ReadableStreamDefaultReader<Uint8Array>) => Promise<ReadableStreamReadResult<Uint8Array>> = reader => reader.read(),
): Promise<Uint8Array<ArrayBuffer>> {
    const reader = body.getReader();
    let size = 0;
    let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(Math.min(4096, limit));
    try {
        while (true) {
            const next = await read(reader);
            if (next.done) break;
            size += next.value.byteLength;
            if (size > limit) throw tooLarge();
            if (size > bytes.length) {
                const grown = new Uint8Array(Math.min(limit, Math.max(size, bytes.length * 2)));
                grown.set(bytes); bytes = grown;
            }
            bytes.set(next.value, size - next.value.byteLength);
        }
        return bytes.subarray(0, size);
    } finally {
        await settleCancel(reader.cancel());
        reader.releaseLock();
    }
}

/**
 * Wait briefly for a request-body cancellation before the response is sent.
 * On Workers, a cancellation still running after the response tries to read
 * the request stream and raises an uncaught "Can't read from request stream
 * after response has been sent", which can bring down the isolate. A hostile
 * stream may never settle, so the wait is bounded.
 */
export async function settleCancel(cancellation: Promise<unknown>, timeoutMs = 1000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        cancellation.catch(() => {}),
        new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timer);
}

/**
 * Discard an unread request body before rejecting the request. Reading it to
 * the end (within `limit`) lets the upstream connection finish sending, so a
 * keep-alive connection stays usable; cancelling an unread body instead left
 * the sender writing after the response and broke the next request on Workers.
 * Bodies over `limit` are cancelled. A body read partway and released (such as
 * `getFormData` refusing an oversized form) is drained the same way; a body read
 * to its end gives nothing more to read.
 */
export async function discardRequestBody(request: Request, limit: number, timeoutMs = DISCARD_TIMEOUT_MS): Promise<void> {
    if (!request.body || request.body.locked) return;
    const reader = request.body.getReader();
    let size = 0;
    // A client sending a byte now and then would hold the response for as long
    // as it likes: past the deadline the rest of the body is cancelled.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
    try {
        while (true) {
            const next = await Promise.race([reader.read(), deadline]);
            if (next === 'timeout') break;
            if (next.done) return;
            size += next.value.byteLength;
            if (size > limit) break;
        }
    } catch {
        return;
    } finally {
        clearTimeout(timer);
        await settleCancel(reader.cancel());
        reader.releaseLock();
    }
}

/** How long `discardRequestBody` reads before it cancels the rest. */
export const DISCARD_TIMEOUT_MS = 5000;

/** True when a declared Content-Length already exceeds `limit`. */
export function declaredLengthExceeds(headers: Headers, limit: number): boolean {
    const declared = headers.get('Content-Length')?.trim();
    return declared !== undefined && /^\d+$/.test(declared) && Number(declared) > limit;
}
