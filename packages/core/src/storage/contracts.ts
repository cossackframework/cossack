/** Provider operations are server-only. Authorization belongs to Storage. */
export interface StorageMetadata {
    key: string;
    size: number;
    etag?: string;
    contentType?: string;
    customMetadata?: Record<string, string>;
    uploaded?: Date;
}
export interface StorageObject extends StorageMetadata { body: ReadableStream<Uint8Array>; }
export interface StorageReadOptions { signal?: AbortSignal; }
export interface StoragePutOptions extends StorageReadOptions {
    /** Declared byte count, enforced by the facade and provider before publication. */
    size: number;
    contentType?: string;
    customMetadata?: Record<string, string>;
}
export interface StoragePresignOptions {
    /** Declared byte count, bound into the signature where the provider supports it. */
    size: number;
    contentType?: string;
    customMetadata?: Record<string, string>;
    /** Seconds the URL stays valid. */
    expiresIn: number;
}
/** A PUT the browser sends straight to the provider: the URL, and the headers the signature requires. */
export interface StoragePresignedUpload {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
}
export interface StorageProvider {
    readonly name: string;
    put(key: string, body: ReadableStream<Uint8Array>, options: StoragePutOptions): Promise<StorageMetadata>;
    get(key: string, options?: StorageReadOptions): Promise<StorageObject | null>;
    head(key: string, options?: StorageReadOptions): Promise<StorageMetadata | null>;
    delete(key: string, options?: StorageReadOptions): Promise<void>;
    /**
     * A URL the browser uploads to directly, bypassing the application. Providers that cannot
     * sign (a local directory, an R2 binding) leave this out, and callers fall back to an
     * application endpoint. The bucket needs CORS for the site's origin.
     */
    presign?(key: string, options: StoragePresignOptions): Promise<StoragePresignedUpload>;
}
export type StorageOperation = 'put' | 'get' | 'head' | 'delete';
export interface StorageAuthorization<Context> { context: Context; operation: StorageOperation; key: string; }
export interface StorageProgress { transferred: number; total?: number; }
export type StorageAuthorizer<Context> = (request: StorageAuthorization<Context>) => boolean | Promise<boolean>;
export class StorageError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'StorageError'; }
}
