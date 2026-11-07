import { StorageError, type StorageAuthorizer, type StorageMetadata, type StorageObject, type StorageOperation, type StoragePresignedUpload, type StorageProvider, type StoragePutOptions, type StorageReadOptions, type StorageProgress } from './contracts';

export function validateStorageKey(key: string): void {
    if (typeof key !== 'string' || !key || key.length > 1024 || /[\\\x00-\x1f\x7f]/.test(key)
        || key.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new StorageError('COSSACK_STORAGE_KEY_INVALID', 'Use a relative object key without empty or traversal segments.');
    }
}
export interface StorageOptions<Context> {
    provider: StorageProvider;
    authorize: StorageAuthorizer<Context>;
    maxBytes?: number;
    contentTypes?: readonly string[];
    /** An application-owned HTTPS endpoint; serve it with handleSignedRequest. */
    signing?: { secret: string; endpoint: string; };
}
export interface StorageTransferOptions extends StorageReadOptions { onProgress?: (progress: StorageProgress) => void; }
export interface StorageUploadOptions extends StoragePutOptions, StorageTransferOptions {}
export interface StorageAccessOptions { expiresIn: number; size?: number; contentType?: string; customMetadata?: Record<string, string>; }
interface AccessTicket { v: 1; key: string; operation: 'get' | 'put'; expires: number; size?: number; contentType?: string; customMetadata?: Record<string, string>; }
const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(value: string): Uint8Array<ArrayBuffer> { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('encoding'); return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new StorageError('COSSACK_STORAGE_ABORTED', 'The storage operation was cancelled.'); }
function metadata(value?: Record<string, string>): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new StorageError('COSSACK_STORAGE_METADATA_INVALID', 'Metadata must contain plain string fields.');
    const descriptors = Object.getOwnPropertyDescriptors(value); const result: Record<string, string> = Object.create(null); let bytes = 0;
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string') || Reflect.ownKeys(descriptors).length > 32) throw new StorageError('COSSACK_STORAGE_METADATA_INVALID', 'Metadata has too many fields.');
    for (const [key, field] of Object.entries(descriptors)) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || !('value' in field) || typeof field.value !== 'string') throw new StorageError('COSSACK_STORAGE_METADATA_INVALID', 'Metadata must contain plain string fields.');
        bytes += encoder.encode(key + field.value).length;
        if (bytes > 8192) throw new StorageError('COSSACK_STORAGE_METADATA_INVALID', 'Metadata exceeds its byte limit.');
        result[key] = field.value;
    }
    return Object.freeze(result);
}
/** Backpressure-preserving byte accounting; never buffers a whole transfer. */
function transfer(body: ReadableStream<Uint8Array>, options: StorageTransferOptions, expected?: number) {
    const reader = body.getReader(); let transferred = 0, ended = false, disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; options.signal?.removeEventListener('abort', abort); };
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => { dispose(); void reader.cancel().catch(() => {}); try { controller.error(new StorageError('COSSACK_STORAGE_ABORTED', 'The storage transfer was cancelled.')); } catch {} };
    const stream = new ReadableStream<Uint8Array>({
        start(owner) { controller = owner; options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort(); },
        async pull(owner) {
            try {
                cancelled(options.signal);
                let item: ReadableStreamReadResult<Uint8Array>;
                try { item = await reader.read(); } catch { throw new StorageError('COSSACK_STORAGE_TRANSFER_FAILED', 'The storage source failed.'); }
                cancelled(options.signal);
                if (item.done) {
                    ended = true; dispose();
                    if (expected !== undefined && transferred !== expected) throw new StorageError('COSSACK_STORAGE_SIZE_MISMATCH', 'The body does not match its declared byte count.');
                    owner.close(); return;
                }
                if (!(item.value instanceof Uint8Array)) throw new StorageError('COSSACK_STORAGE_BODY_INVALID', 'Storage streams must yield byte chunks.');
                transferred += item.value.byteLength;
                if (expected !== undefined && transferred > expected) throw new StorageError('COSSACK_STORAGE_SIZE_MISMATCH', 'The body exceeds its declared byte count.');
                options.onProgress?.({ transferred, total: expected }); owner.enqueue(item.value);
            } catch (error) { dispose(); void reader.cancel().catch(() => {}); owner.error(error instanceof StorageError ? error : new StorageError('COSSACK_STORAGE_TRANSFER_FAILED', 'The storage transfer failed.')); }
        },
        cancel() { dispose(); void reader.cancel().catch(() => {}); },
    });
    return { stream, finish: async () => { dispose(); if (!ended) void reader.cancel().catch(() => {}); } };
}

/** Authorization is checked before every provider operation and signed redemption. */
export class Storage<Context> {
    private readonly maxBytes: number;
    private readonly endpoint?: URL;
    private readonly signingKey?: Promise<CryptoKey>;
    readonly #options: StorageOptions<Context>;
    constructor(options: StorageOptions<Context>) {
        this.#options = options;
        this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
        if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0 || typeof options.authorize !== 'function') throw new StorageError('COSSACK_STORAGE_CONFIG_INVALID', 'Configure an authorizer and a valid byte limit.');
        if (options.signing) {
            try { this.endpoint = new URL(options.signing.endpoint); }
            catch { throw new StorageError('COSSACK_STORAGE_CONFIG_INVALID', 'Configure an absolute secure storage endpoint.'); }
            if (this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash
                || !(this.endpoint.protocol === 'https:' || (this.endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.endpoint.hostname)))
                || typeof options.signing.secret !== 'string' || encoder.encode(options.signing.secret).length < 32) throw new StorageError('COSSACK_STORAGE_CONFIG_INVALID', 'Configure a secure endpoint and a signing secret of at least 32 bytes.');
            this.signingKey = crypto.subtle.importKey('raw', encoder.encode(options.signing.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
        }
    }
    private async allowed(context: Context, operation: StorageOperation, key: string, signal?: AbortSignal) {
        validateStorageKey(key); cancelled(signal);
        let allowed = false; try { allowed = await this.#options.authorize({ context, operation, key }); } catch {}
        if (!allowed) throw new StorageError('COSSACK_STORAGE_FORBIDDEN', 'The object operation is not authorized.');
        cancelled(signal);
    }
    private async operation<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        try { return await run(); }
        catch (error) {
            if (signal?.aborted) throw new StorageError('COSSACK_STORAGE_ABORTED', 'The storage operation was cancelled.');
            const code = error instanceof StorageError && ['COSSACK_STORAGE_ABORTED', 'COSSACK_STORAGE_SIZE_MISMATCH', 'COSSACK_STORAGE_TRANSFER_FAILED', 'COSSACK_STORAGE_BODY_INVALID'].includes(error.code) ? error.code : 'COSSACK_STORAGE_PROVIDER_FAILED';
            throw new StorageError(code, 'The storage operation failed. Check the provider and transfer limits.');
        }
    }
    private upload(options: StoragePutOptions): StoragePutOptions {
        if (!Number.isSafeInteger(options.size) || options.size < 0 || options.size > this.maxBytes) throw new StorageError('COSSACK_STORAGE_SIZE_INVALID', 'The declared size must fit the configured byte limit.');
        if (options.contentType !== undefined && (typeof options.contentType !== 'string' || !options.contentType || options.contentType.length > 128 || /[\r\n\x00]/.test(options.contentType)
            || (this.#options.contentTypes && !this.#options.contentTypes.includes(options.contentType)))) throw new StorageError('COSSACK_STORAGE_TYPE_INVALID', 'The content type is not permitted.');
        if (this.#options.contentTypes && !options.contentType) throw new StorageError('COSSACK_STORAGE_TYPE_INVALID', 'A permitted content type is required.');
        return { size: options.size, contentType: options.contentType, customMetadata: metadata(options.customMetadata), signal: options.signal };
    }
    async put(context: Context, key: string, body: ReadableStream<Uint8Array>, options: StorageUploadOptions): Promise<StorageMetadata> {
        const checked = this.upload(options); await this.allowed(context, 'put', key, options.signal);
        const counted = transfer(body, options, checked.size);
        try { return await this.operation(() => this.#options.provider.put(key, counted.stream, checked), options.signal); }
        finally { await counted.finish(); }
    }
    async get(context: Context, key: string, options: StorageTransferOptions = {}): Promise<StorageObject | null> {
        await this.allowed(context, 'get', key, options.signal); const object = await this.operation(() => this.#options.provider.get(key, options), options.signal);
        if (!object) return null;
        return { ...object, body: transfer(object.body, options, object.size).stream };
    }
    async head(context: Context, key: string, options: StorageReadOptions = {}) { await this.allowed(context, 'head', key, options.signal); return this.operation(() => this.#options.provider.head(key, options), options.signal); }
    async delete(context: Context, key: string, options: StorageReadOptions = {}) { await this.allowed(context, 'delete', key, options.signal); return this.operation(() => this.#options.provider.delete(key, options), options.signal); }
    private signing() { if (!this.signingKey || !this.endpoint) throw new StorageError('COSSACK_STORAGE_SIGNING_UNAVAILABLE', 'Configure a storage endpoint and signing secret.'); return { key: this.signingKey, endpoint: this.endpoint }; }
    async signedUrl(context: Context, key: string, operation: 'get' | 'put', options: StorageAccessOptions): Promise<string> {
        if (!['get', 'put'].includes(operation) || !Number.isInteger(options.expiresIn) || options.expiresIn < 1 || options.expiresIn > 86400) throw new StorageError('COSSACK_STORAGE_ACCESS_INVALID', 'Signed access must expire within one day.');
        const checked = operation === 'put' ? this.upload({ size: options.size!, contentType: options.contentType, customMetadata: options.customMetadata }) : {};
        const signing = this.signing(); await this.allowed(context, operation, key);
        const ticket: AccessTicket = { v: 1, key, operation, expires: Date.now() + options.expiresIn * 1000, ...checked };
        const payload = encode(encoder.encode(JSON.stringify(ticket)));
        if (payload.length > 16384) throw new StorageError('COSSACK_STORAGE_ACCESS_INVALID', 'Signed access metadata is too large.');
        const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', await signing.key, encoder.encode(signing.endpoint.href + '\n' + payload))));
        const url = new URL(signing.endpoint); url.searchParams.set('access', payload + '.' + signature); return url.href;
    }
    /**
     * Where the browser PUTs an upload: the provider's own presigned URL when it can sign
     * (R2 and S3 through their S3 API), otherwise the application endpoint of {@link signedUrl}.
     * One call for every environment: a local directory in development falls back to the endpoint.
     */
    async presignedUpload(context: Context, key: string, options: StorageAccessOptions & { size: number }): Promise<StoragePresignedUpload> {
        const provider = this.#options.provider;
        if (typeof provider.presign === 'function') {
            if (!Number.isInteger(options.expiresIn) || options.expiresIn < 1 || options.expiresIn > 86400) throw new StorageError('COSSACK_STORAGE_ACCESS_INVALID', 'Signed access must expire within one day.');
            const checked = this.upload({ size: options.size, contentType: options.contentType, customMetadata: options.customMetadata });
            await this.allowed(context, 'put', key);
            return this.operation(() => provider.presign!(key, { size: checked.size, contentType: checked.contentType, customMetadata: checked.customMetadata, expiresIn: options.expiresIn }));
        }
        return { url: await this.signedUrl(context, key, 'put', options), method: 'PUT', headers: {} };
    }
    async handleSignedRequest(context: Context, request: Request): Promise<Response> {
        try {
            const signing = this.signing(); const url = new URL(request.url); const access = url.searchParams.get('access');
            if (url.origin + url.pathname !== signing.endpoint.origin + signing.endpoint.pathname || !access || access.length > 16500) throw new StorageError('COSSACK_STORAGE_ACCESS_INVALID', 'The signed access is invalid.');
            const parts = access.split('.'); if (parts.length !== 2) throw new StorageError('COSSACK_STORAGE_ACCESS_INVALID', 'The signed access is invalid.');
            let ticket: AccessTicket;
            try {
                if (!await crypto.subtle.verify('HMAC', await signing.key, decode(parts[1]!), encoder.encode(signing.endpoint.href + '\n' + parts[0]))) throw new Error('signature');
                ticket = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(parts[0]!)));
            } catch { throw new StorageError('COSSACK_STORAGE_ACCESS_INVALID', 'The signed access is invalid.'); }
            if (!ticket || ticket.v !== 1 || !Number.isSafeInteger(ticket.expires) || ticket.expires <= Date.now() || !['get', 'put'].includes(ticket.operation)) throw new StorageError('COSSACK_STORAGE_ACCESS_EXPIRED', 'The signed access is expired or invalid.');
            if (request.method !== (ticket.operation === 'get' ? 'GET' : 'PUT')) return Response.json({ code: 'COSSACK_STORAGE_METHOD_INVALID' }, { status: 405, headers: { Allow: ticket.operation === 'get' ? 'GET' : 'PUT' } });
            if (ticket.operation === 'put') {
                if (!request.body) throw new StorageError('COSSACK_STORAGE_BODY_INVALID', 'A byte body is required.');
                const object = await this.put(context, ticket.key, request.body, { size: ticket.size!, contentType: ticket.contentType, customMetadata: ticket.customMetadata, signal: request.signal });
                return Response.json(object, { status: 201 });
            }
            const object = await this.get(context, ticket.key, { signal: request.signal }); if (!object) return new Response(null, { status: 404 });
            return new Response(object.body, { headers: { 'Content-Type': object.contentType ?? 'application/octet-stream', 'Content-Length': String(object.size), 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff' } });
        } catch (error) {
            const code = error instanceof StorageError ? error.code : 'COSSACK_STORAGE_PROVIDER_FAILED';
            const status = code === 'COSSACK_STORAGE_FORBIDDEN' ? 403 : code === 'COSSACK_STORAGE_ACCESS_EXPIRED' ? 410 : code === 'COSSACK_STORAGE_ABORTED' ? 499 : code === 'COSSACK_STORAGE_PROVIDER_FAILED' ? 502 : 400;
            return Response.json({ code }, { status });
        }
    }
}
