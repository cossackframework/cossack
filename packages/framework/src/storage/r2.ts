import { StorageError, type StorageMetadata, type StorageObject, type StorageProvider } from '@cossackframework/core/storage';

export interface R2StorageMetadata {
    key: string; size: number; etag: string; uploaded: Date;
    httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>;
}
export interface R2StorageMultipart {
    uploadPart(partNumber: number, value: Uint8Array): Promise<{ partNumber: number; etag: string }>;
    complete(parts: { partNumber: number; etag: string }[]): Promise<R2StorageMetadata>;
    abort(): Promise<void>;
}
/** A narrow structural binding; no Workers global types or Node dependencies. */
export interface R2StorageBucket {
    createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<R2StorageMultipart>;
    put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<R2StorageMetadata | null>;
    get(key: string): Promise<(R2StorageMetadata & { body: ReadableStream<Uint8Array> }) | null>;
    head(key: string): Promise<R2StorageMetadata | null>;
    delete(key: string): Promise<void>;
}
const PART_SIZE = 5 * 1024 * 1024;
/**
 * Bodies up to one part use a single put: they are buffered exactly as one
 * multipart part would be, so peak memory is unchanged and 2 requests are saved.
 */
export const STORAGE_SINGLE_PUT_MAX_BYTES = PART_SIZE;
export function storageProviderFailure(code = 'COSSACK_STORAGE_PROVIDER_FAILED'): StorageError {
    return new StorageError(code, code === 'COSSACK_STORAGE_ABORTED' ? 'Storage operation cancelled.' : 'Storage provider operation failed.');
}
export function checkStorageSignal(signal?: AbortSignal): void { if (signal?.aborted) throw storageProviderFailure('COSSACK_STORAGE_ABORTED'); }

/** Cleanup failures never expose provider errors or indefinitely delay a failed request. */
export async function storageCleanup(operation: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)).catch(() => {}),
            new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, 2000); }),
        ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}
/**
 * Chooses the upload strategy before any provider request. A declared size is
 * required: an invalid or missing size is rejected instead of opening an upload.
 */
export function storageSinglePut(size: number): boolean {
    checkStorageSize(size);
    return size <= STORAGE_SINGLE_PUT_MAX_BYTES;
}
function checkStorageSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > PART_SIZE * 10000) throw storageProviderFailure('COSSACK_STORAGE_SIZE_MISMATCH');
}
/** Reads a single-put body into one exact-length buffer and confirms the source ended. */
export async function storageSingleBody(body: ReadableStream<Uint8Array>, size: number, signal?: AbortSignal): Promise<Uint8Array> {
    let value: Uint8Array = new Uint8Array();
    for await (const part of storageParts(body, size, signal)) value = part;
    return value;
}
/** Bounded buffering, exact byte-count validation, and cancellation of a blocked source. */
export async function* storageParts(body: ReadableStream<Uint8Array>, size: number, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    checkStorageSize(size);
    checkStorageSignal(signal);
    const reader = body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    let total = 0, offset = 0, buffer = new Uint8Array(Math.min(PART_SIZE, size));
    try {
        while (true) {
            checkStorageSignal(signal);
            const { value, done } = await reader.read();
            checkStorageSignal(signal);
            if (done) break;
            if (!(value instanceof Uint8Array) || total + value.byteLength > size) throw storageProviderFailure('COSSACK_STORAGE_SIZE_MISMATCH');
            total += value.byteLength;
            let position = 0;
            while (position < value.byteLength) {
                const length = Math.min(buffer.byteLength - offset, value.byteLength - position);
                buffer.set(value.subarray(position, position + length), offset); position += length; offset += length;
                if (offset === buffer.byteLength) { yield buffer; offset = 0; buffer = new Uint8Array(Math.min(PART_SIZE, size - (total - value.byteLength + position))); }
            }
        }
        if (total !== size) throw storageProviderFailure('COSSACK_STORAGE_SIZE_MISMATCH');
        if (offset > 0) yield buffer.subarray(0, offset);
    } finally {
        signal?.removeEventListener('abort', abort);
        void reader.cancel().catch(() => {}); reader.releaseLock();
    }
}
export function storageReadBody(body: ReadableStream<Uint8Array>, signal?: AbortSignal): ReadableStream<Uint8Array> {
    checkStorageSignal(signal);
    const reader = body.getReader(); let finished = false;
    const cleanup = () => { signal?.removeEventListener('abort', abort); };
    const abort = () => { if (!finished) void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    return new ReadableStream({
        async pull(controller) { try { checkStorageSignal(signal); const result = await reader.read(); checkStorageSignal(signal); if (result.done) { finished = true; cleanup(); reader.releaseLock(); controller.close(); } else controller.enqueue(result.value); } catch { finished = true; cleanup(); void reader.cancel().catch(() => {}); reader.releaseLock(); controller.error(storageProviderFailure(signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined)); } },
        cancel() { finished = true; cleanup(); void reader.cancel().catch(() => {}); reader.releaseLock(); },
    });
}
function metadata(object: R2StorageMetadata): StorageMetadata {
    return { key: object.key, size: object.size, etag: object.etag, uploaded: object.uploaded,
        ...(object.httpMetadata?.contentType ? { contentType: object.httpMetadata.contentType } : {}),
        ...(object.customMetadata ? { customMetadata: { ...object.customMetadata } } : {}) };
}
export function createR2StorageProvider(bucket: R2StorageBucket): StorageProvider {
    return {
        name: 'r2',
        async put(key, body, options) {
            let upload: R2StorageMultipart | undefined;
            const attributes = { httpMetadata: { contentType: options.contentType }, customMetadata: options.customMetadata };
            try {
                checkStorageSignal(options.signal);
                if (storageSinglePut(options.size)) {
                    const value = await storageSingleBody(body, options.size, options.signal);
                    checkStorageSignal(options.signal); const result = await bucket.put(key, value, attributes);
                    if (!result) throw storageProviderFailure(); return metadata(result);
                }
                upload = await bucket.createMultipartUpload(key, attributes);
                const parts: { partNumber: number; etag: string }[] = [];
                for await (const part of storageParts(body, options.size, options.signal)) {
                    checkStorageSignal(options.signal); parts.push(await upload.uploadPart(parts.length + 1, part));
                }
                checkStorageSignal(options.signal);
                return metadata(await upload.complete(parts));
            } catch (error) {
                if (upload) await storageCleanup(() => upload!.abort());
                if (error instanceof StorageError && ['COSSACK_STORAGE_ABORTED', 'COSSACK_STORAGE_SIZE_MISMATCH'].includes(error.code)) throw storageProviderFailure(error.code);
                throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined);
            }
        },
        async get(key, options = {}) {
            try { checkStorageSignal(options.signal); const object = await bucket.get(key); if (options.signal?.aborted) { void object?.body.cancel().catch(() => {}); throw storageProviderFailure('COSSACK_STORAGE_ABORTED'); } return object ? { ...metadata(object), body: storageReadBody(object.body, options.signal) } satisfies StorageObject : null; }
            catch { throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined); }
        },
        async head(key, options = {}) { try { checkStorageSignal(options.signal); const object = await bucket.head(key); checkStorageSignal(options.signal); return object ? metadata(object) : null; } catch { throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined); } },
        async delete(key, options = {}) { try { checkStorageSignal(options.signal); await bucket.delete(key); } catch { throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined); } },
    };
}
