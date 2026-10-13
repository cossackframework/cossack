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
        // A hostile stream may never finish its cancellation. Observe it without retaining the request.
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** True when a declared Content-Length already exceeds `limit`. */
export function declaredLengthExceeds(headers: Headers, limit: number): boolean {
    const declared = headers.get('Content-Length')?.trim();
    return declared !== undefined && /^\d+$/.test(declared) && Number(declared) > limit;
}
