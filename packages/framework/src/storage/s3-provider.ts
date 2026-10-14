import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageError, type StorageMetadata, type StorageProvider } from '@cossackframework/core/storage';
import { storageParts, storageReadBody, checkStorageSignal, storageProviderFailure, storageCleanup, storageSinglePut, storageSingleBody } from './r2.js';

export interface S3StorageProviderOptions { client: S3Client; bucket: string; }
/** Isolated SDK entry. Credentials and endpoint remain in the server-owned client. */
export function createS3StorageProvider({ client, bucket }: S3StorageProviderOptions): StorageProvider {
    const missing = (error: unknown) => typeof error === 'object' && error !== null && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
    return {
        name: 's3',
        async put(key, body, options) {
            let uploadId: string | undefined;
            try {
                checkStorageSignal(options.signal);
                let etag: string | undefined;
                if (storageSinglePut(options.size)) {
                    const value = await storageSingleBody(body, options.size, options.signal);
                    checkStorageSignal(options.signal);
                    const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: value, ContentLength: value.byteLength, ContentType: options.contentType, Metadata: options.customMetadata }), { abortSignal: options.signal }); etag = result.ETag;
                } else {
                    const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: options.contentType, Metadata: options.customMetadata }), { abortSignal: options.signal });
                    uploadId = created.UploadId; if (!uploadId) throw storageProviderFailure();
                    const parts: { PartNumber: number; ETag: string }[] = [];
                    for await (const part of storageParts(body, options.size, options.signal)) {
                        const result = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: parts.length + 1, Body: part, ContentLength: part.byteLength }), { abortSignal: options.signal });
                        if (!result.ETag) throw storageProviderFailure(); parts.push({ PartNumber: parts.length + 1, ETag: result.ETag });
                    }
                    checkStorageSignal(options.signal);
                    const result = await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }), { abortSignal: options.signal }); etag = result.ETag;
                }
                return { key, size: options.size, ...(etag ? { etag } : {}), ...(options.contentType ? { contentType: options.contentType } : {}), ...(options.customMetadata ? { customMetadata: { ...options.customMetadata } } : {}) };
            } catch (error) {
                // Cleanup is deliberately not tied to the cancelled request's signal.
                if (uploadId) await storageCleanup(signal => client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }), { abortSignal: signal }));
                if (error instanceof StorageError && ['COSSACK_STORAGE_ABORTED', 'COSSACK_STORAGE_SIZE_MISMATCH'].includes(error.code)) throw storageProviderFailure(error.code);
                throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined);
            }
        },
        async get(key, options = {}) {
            let body: ReadableStream<Uint8Array> | undefined;
            try {
                checkStorageSignal(options.signal); const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: options.signal });
                if (!result.Body || typeof result.Body.transformToWebStream !== 'function') throw storageProviderFailure();
                body = result.Body.transformToWebStream();
                return { ...s3Metadata(key, result), body: storageReadBody(body, options.signal) };
            } catch (error) { void body?.cancel().catch(() => {}); if (missing(error)) return null; throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined); }
        },
        async head(key, options = {}) { try { checkStorageSignal(options.signal); return s3Metadata(key, await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: options.signal })); } catch (error) { if (missing(error)) return null; throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined); } },
        async delete(key, options = {}) { try { checkStorageSignal(options.signal); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: options.signal }); } catch { throw storageProviderFailure(options.signal?.aborted ? 'COSSACK_STORAGE_ABORTED' : undefined); } },
    };
}
function s3Metadata(key: string, value: { ContentLength?: number; ETag?: string; ContentType?: string; Metadata?: Record<string, string>; LastModified?: Date }): StorageMetadata {
    if (!Number.isSafeInteger(value.ContentLength) || value.ContentLength! < 0) throw storageProviderFailure();
    return { key, size: value.ContentLength!, ...(value.ETag ? { etag: value.ETag } : {}), ...(value.ContentType ? { contentType: value.ContentType } : {}), ...(value.Metadata ? { customMetadata: { ...value.Metadata } } : {}), ...(value.LastModified ? { uploaded: value.LastModified } : {}) };
}
