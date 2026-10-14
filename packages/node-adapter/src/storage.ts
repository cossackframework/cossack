import { constants } from 'node:fs';
import { mkdir, realpath, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StorageError } from '@cossackframework/core/storage';
import type { StorageProvider, StorageMetadata, StorageObject, StoragePutOptions, StorageReadOptions } from '@cossackframework/core/storage';

export class LocalStorageError extends StorageError {
    constructor() { super('COSSACK_STORAGE_PROVIDER_FAILED', 'Local storage failed. Check the isolated root, object metadata, and filesystem permissions.'); this.name = 'LocalStorageError'; }
}
interface Manifest { key: string; size: number; etag: string; contentType?: string; customMetadata?: Record<string, string>; uploaded: number; file: string; }
const locks = new Map<string, Promise<void>>();
function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Storage operation was cancelled.', 'AbortError'); }
function validKey(key: string): void {
    if (typeof key !== 'string' || key.length > 1024 || !key || key.split('/').some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(part) || part === '.' || part === '..')) throw new LocalStorageError();
}
function metadataOptions(options: StoragePutOptions): Pick<Manifest, 'size' | 'contentType' | 'customMetadata'> {
    if (!Number.isSafeInteger(options.size) || options.size < 0) throw new LocalStorageError();
    if (options.contentType !== undefined && (typeof options.contentType !== 'string' || options.contentType.length > 256 || /[\x00-\x1f\x7f]/.test(options.contentType))) throw new LocalStorageError();
    let customMetadata: Record<string, string> | undefined;
    if (options.customMetadata !== undefined) {
        if (!options.customMetadata || ![Object.prototype, null].includes(Object.getPrototypeOf(options.customMetadata))) throw new LocalStorageError();
        customMetadata = Object.create(null);
        for (const key of Reflect.ownKeys(options.customMetadata)) {
            const descriptor = Object.getOwnPropertyDescriptor(options.customMetadata, key)!;
            if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key) || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.length > 2048) throw new LocalStorageError();
            customMetadata![key] = descriptor.value;
        }
        if (Object.keys(customMetadata!).length > 64 || Buffer.byteLength(JSON.stringify(customMetadata)) > 8192) throw new LocalStorageError();
    }
    return { size: options.size, ...(options.contentType !== undefined ? { contentType: options.contentType } : {}), ...(customMetadata ? { customMetadata } : {}) };
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function publicMetadata(value: Manifest): StorageMetadata { return { key: value.key, size: value.size, etag: value.etag, uploaded: new Date(value.uploaded), ...(value.contentType !== undefined ? { contentType: value.contentType } : {}), ...(value.customMetadata ? { customMetadata: { ...value.customMetadata } } : {}) }; }
async function waitFor(operation: Promise<void>, signal?: AbortSignal): Promise<void> {
    aborted(signal); if (!signal) return operation;
    let interrupt!: () => void;
    const cancellation = new Promise<never>((_resolve, reject) => { interrupt = () => reject(new DOMException('Storage operation was cancelled.', 'AbortError')); signal.addEventListener('abort', interrupt, { once: true }); });
    try { aborted(signal); await Promise.race([operation, cancellation]); }
    finally { signal.removeEventListener('abort', interrupt); }
}
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
    aborted(signal); if (!signal) return reader.read();
    let rejectAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new DOMException('Storage operation was cancelled.', 'AbortError')); signal.addEventListener('abort', rejectAbort, { once: true }); });
    try { aborted(signal); return await Promise.race([reader.read(), interrupted]); }
    finally { signal.removeEventListener('abort', rejectAbort); }
}

/** Persistent filesystem storage for a root exclusively owned by one Node process.
 * Objects use immutable generations; atomic manifest rename publishes complete bytes. */
export class LocalStorageProvider implements StorageProvider {
    readonly name = 'local-filesystem';
    readonly root: string;
    constructor(options: { root: string }) {
        if (!options?.root || typeof options.root !== 'string') throw new LocalStorageError();
        this.root = path.resolve(options.root);
    }
    /** Shared by concurrent callers; cleared on failure and when the root disappears. */
    private initialized: Promise<void> | undefined;
    private ready(): Promise<void> {
        const pending = this.initialized ??= this.initialize().catch(error => {
            if (this.initialized === pending) this.initialized = undefined;
            throw error;
        });
        return pending;
    }
    private async initialize(): Promise<void> {
        // Verify existing ancestors before mkdir, so a symlink ancestor cannot cause writes.
        let ancestor = this.root;
        for (;;) {
            try { if (await realpath(ancestor) !== ancestor) throw new LocalStorageError(); break; }
            catch (error) { if (!missing(error)) throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
        }
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        if (await realpath(this.root) !== this.root) throw new LocalStorageError();
    }
    private prefix(key: string): string { validKey(key); return createHash('sha256').update(key).digest('hex'); }
    private async own<T>(key: string, signal: AbortSignal | undefined, work: (prefix: string) => Promise<T>): Promise<T> {
        const prefix = this.prefix(key); aborted(signal);
        const lockKey = this.root + '/' + prefix;
        const previous = locks.get(lockKey) ?? Promise.resolve(); let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; }); const tail = previous.then(() => held); locks.set(lockKey, tail);
        try {
            await waitFor(previous, signal); aborted(signal);
            const initialized = this.ready(); await initialized;
            try { return await work(prefix); }
            catch (error) {
                if (!missing(error)) throw error;
                // The root (or part of it) vanished after setup: set it up again and retry once.
                // A body that was already read cannot be replayed, so such a put still fails.
                if (this.initialized === initialized) this.initialized = undefined;
                aborted(signal); await this.ready(); return await work(prefix);
            }
        }
        catch (error) { if ((error as Error)?.name === 'AbortError' || error instanceof LocalStorageError) throw error; throw new LocalStorageError(); }
        finally { release(); void tail.then(() => { if (locks.get(lockKey) === tail) locks.delete(lockKey); }); }
    }
    private async safeOpen(filename: string, flags: number, mode?: number): Promise<FileHandle> {
        const full = path.join(this.root, filename); const handle = await open(full, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, mode);
        try { const stat = await handle.stat(); if (await realpath(full) !== full || !stat.isFile() || stat.nlink !== 1) throw new LocalStorageError(); return handle; }
        catch (error) { await handle.close(); throw error; }
    }
    private async manifest(key: string, prefix: string): Promise<Manifest | null> {
        let handle: FileHandle;
        try { handle = await this.safeOpen(prefix + '.json', constants.O_RDONLY); } catch (error) { if (missing(error)) return null; throw error; }
        try {
            if ((await handle.stat()).size > 16384) throw new LocalStorageError();
            const value = JSON.parse(await handle.readFile('utf8')) as Manifest;
            if (value.key !== key || !new RegExp(`^${prefix}\\.[a-f0-9-]{36}\\.blob$`).test(value.file) || !/^"[a-f0-9]{64}"$/.test(value.etag) || !Number.isSafeInteger(value.uploaded) || value.uploaded < 0) throw new LocalStorageError();
            metadataOptions(value); return value;
        } finally { await handle.close(); }
    }
    async put(key: string, body: ReadableStream<Uint8Array>, options: StoragePutOptions): Promise<StorageMetadata> {
        const metadata = metadataOptions(options);
        return this.own(key, options.signal, async prefix => {
            const previous = await this.manifest(key, prefix);
            const id = randomUUID(); const file = `${prefix}.${id}.blob`; const temporary = `${prefix}.${id}.json.tmp`;
            let data: FileHandle | undefined; let info: FileHandle | undefined; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined; let published = false;
            try {
                data = await this.safeOpen(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
                reader = body.getReader(); const hash = createHash('sha256'); let size = 0;
                for (;;) {
                    const chunk = await readChunk(reader, options.signal); if (chunk.done) break;
                    if (!(chunk.value instanceof Uint8Array) || size + chunk.value.byteLength > metadata.size) throw new LocalStorageError();
                    let offset = 0;
                    while (offset < chunk.value.byteLength) { aborted(options.signal); const written = await data.write(chunk.value, offset, chunk.value.byteLength - offset); if (!written.bytesWritten) throw new LocalStorageError(); offset += written.bytesWritten; }
                    hash.update(chunk.value); size += chunk.value.byteLength;
                }
                aborted(options.signal); if (size !== metadata.size) throw new LocalStorageError();
                await data.sync(); await data.close(); data = undefined;
                const value: Manifest = { key, ...metadata, etag: `"${hash.digest('hex')}"`, uploaded: Date.now(), file };
                info = await this.safeOpen(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); await info.writeFile(JSON.stringify(value)); await info.sync(); await info.close(); info = undefined;
                aborted(options.signal); await rename(path.join(this.root, temporary), path.join(this.root, prefix + '.json')); published = true;
                if (previous) await unlink(path.join(this.root, previous.file)).catch(() => {});
                return publicMetadata(value);
            } finally {
                if (reader) { if (!published) void reader.cancel(new DOMException('Storage operation was cancelled.', 'AbortError')).catch(() => {}); reader.releaseLock(); }
                await data?.close(); await info?.close();
                await unlink(path.join(this.root, temporary)).catch(() => {});
                if (!published) await unlink(path.join(this.root, file)).catch(() => {});
            }
        });
    }
    async head(key: string, options: StorageReadOptions = {}): Promise<StorageMetadata | null> {
        return this.own(key, options.signal, async prefix => { const value = await this.manifest(key, prefix); aborted(options.signal); return value ? publicMetadata(value) : null; });
    }
    async get(key: string, options: StorageReadOptions = {}): Promise<StorageObject | null> {
        return this.own(key, options.signal, async prefix => {
            const value = await this.manifest(key, prefix); if (!value) return null;
            const file = await this.safeOpen(value.file, constants.O_RDONLY);
            try { if ((await file.stat()).size !== value.size) throw new LocalStorageError(); } catch (error) { await file.close(); throw error; }
            let closed: Promise<void> | undefined; let interrupted: () => void;
            const close = (): Promise<void> => { options.signal?.removeEventListener('abort', interrupted); return closed ??= file.close(); };
            const body = new ReadableStream<Uint8Array>({
                start(controller) { interrupted = () => { controller.error(new DOMException('Storage operation was cancelled.', 'AbortError')); void close().catch(() => {}); }; options.signal?.addEventListener('abort', interrupted, { once: true }); if (options.signal?.aborted) interrupted(); },
                async pull(controller) { try { aborted(options.signal); const buffer = new Uint8Array(64 * 1024); const { bytesRead } = await file.read(buffer); if (!bytesRead) { await close(); controller.close(); } else controller.enqueue(buffer.subarray(0, bytesRead)); } catch { await close(); controller.error(options.signal?.aborted ? new DOMException('Storage operation was cancelled.', 'AbortError') : new LocalStorageError()); } },
                async cancel() { await close(); },
            }, { highWaterMark: 0 });
            return { ...publicMetadata(value), body };
        });
    }
    async delete(key: string, options: StorageReadOptions = {}): Promise<void> {
        return this.own(key, options.signal, async prefix => { const value = await this.manifest(key, prefix); aborted(options.signal); if (!value) return; await unlink(path.join(this.root, prefix + '.json')); await unlink(path.join(this.root, value.file)).catch(() => {}); });
    }
}
