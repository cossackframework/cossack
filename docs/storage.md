---
title: "File Storage & Uploads"
description: "Authorize streamed storage operations with local, R2, or S3 providers."
---

# File Storage & Uploads

`Storage` applies authorization, byte limits, content-type limits, and progress reporting before a provider stores an object.
A provider supplies the storage backend. Keep providers and signing secrets in server-only modules.

## Local storage on Node.js

```typescript
import { Storage } from '@cossackframework/core/storage';
import { LocalStorageProvider } from '@cossackframework/node-adapter/storage';

type UploadContext = { tenantId: string };

const storage = new Storage<UploadContext>({
    provider: new LocalStorageProvider({ root: './private-uploads' }),
    authorize: ({ context, key }) => key.startsWith(`${context.tenantId}/`),
    maxBytes: 10 * 1024 * 1024,
    contentTypes: ['image/png', 'image/jpeg'],
});

export async function upload(context: UploadContext, file: File, signal: AbortSignal) {
    // Derive the tenant from authenticated server context.
    const key = `${context.tenantId}/${crypto.randomUUID()}`;
    return storage.put(context, key, file.stream(), {
        size: file.size,
        contentType: file.type,
        signal,
        onProgress: ({ transferred, total }) => {
            // Report bytes through your application's progress channel.
            reportProgress(transferred, total);
        },
    });
}
```

Replace `reportProgress` with your application callback. Progress reports transferred bytes, not proof of publication.
Pass an `AbortSignal` to cancel an upload or download. The facade reports `COSSACK_STORAGE_ABORTED`. The local provider removes unpublished files after cancellation.

Use `storage.get(context, key, { signal, onProgress })` to read an object as a `ReadableStream<Uint8Array>`.
Consume or cancel its `body` to release the open file. `head` returns metadata without a body. `delete` removes an object.
Each operation applies the authorizer. A missing object returns `null` from `get` and `head`.

Local keys use slash-separated ASCII segments. Each segment starts with a letter or digit and contains letters, digits, dots, underscores, or hyphens.
The provider rejects traversal, empty segments, and symlink paths. It hashes keys into private filenames.
Do not use an uploaded filename as an authorization rule.

The local provider writes an immutable data file and metadata before it atomically publishes the metadata reference.
Readers see a complete generation. Existing readers retain their previous generation during replacement.
Metadata and bytes survive provider recreation. Competing operations share a lock across provider instances in the same Node process.

Give the root exclusively to one Node process. Keep the root and its parent directories under trusted filesystem ownership.
This provider does not supply distributed locking or protection against hostile concurrent directory replacement.
An interrupted process can leave unpublished files. Atomic publication does not guarantee durability after sudden power loss.

## R2 and S3

Use the public provider modules `@cossackframework/framework/storage/r2` and `@cossackframework/framework/storage/s3`.
Wrap either provider in the same `Storage` authorization API. Configure R2 through a Worker bucket binding.
For R2, call `createR2StorageProvider(env.FILES)` from
`@cossackframework/framework/storage/r2`, where `FILES` is your R2 binding.
For S3, call `createS3StorageProvider({ client, bucket })` from
`@cossackframework/framework/storage/s3`, where `client` is your server-owned
AWS SDK v3 `S3Client` and `bucket` is its configured bucket name. Neither factory
authorizes callers. Always use the facade or apply an equivalent server policy.
Configure S3 credentials only on the server. Store secrets through your runtime's secret mechanism.
Never put access keys in browser code or public Worker variables.

Provider configuration and credentials belong to the server adapter. The portable core does not import a cloud SDK.
Provider failures return fixed error codes and messages without provider credentials or object contents.

## Signed application URLs

A signed URL is a temporary permission ticket. Configure `signing` on `Storage` with a server secret and your application endpoint.

```typescript
const storage = new Storage<UploadContext>({
    provider,
    authorize: ({ context, key }) => key.startsWith(`${context.tenantId}/`),
    // Use a server secret of at least 32 bytes.
    signing: { secret: signingSecret, endpoint: 'https://app.example.com/files' },
});
const url = await storage.signedUrl(context, key, 'put', {
    expiresIn: 60,
    size: file.size,
    contentType: file.type,
});
```

Replace `provider`, `signingSecret`, `context`, `key`, and `file` with your server values.
Route the configured endpoint to `storage.handleSignedRequest(context, request)` with the current authenticated context.
The handler makes sure again that the signature, expiry, operation, upload metadata, and authorization are valid.
The URL targets your application endpoint. It does not expose bucket credentials or promise a direct provider upload.
Use `fetch(url, { method: 'PUT', body: file, signal })` in the browser. Cancel the request through its signal.

## RPC uploads

An HTTP server method can receive a `File` through the framework's multipart RPC transport.
Pass `file.stream()` and its declared size to `Storage.put` inside that method.
Derive the object key and authorization context on the server. Avoid buffering the entire file with `arrayBuffer()`.

## Provider transfer limits

R2 and S3 providers choose the upload request from the declared `size`:

- Up to 5 MiB (5,242,880 bytes), including empty objects, the provider reads the
  body into one buffer and sends a single request (R2 `put`, S3 `PutObject`).
  It sends the request only after the body ends with exactly the declared bytes.
- Above 5 MiB, the provider uses a multipart upload with 5 MiB parts and at
  most 10,000 parts (52,428,800,000 bytes, about 48.83 GiB).
- A missing or invalid `size` fails with `COSSACK_STORAGE_SIZE_MISMATCH` before
  the provider sends any request.

Both strategies send the same content type and custom metadata. The S3 SDK adds
its default request checksum to the single request and to each part.

The facade defaults to a lower 64 MiB limit. Set `maxBytes` deliberately for
larger transfers. Provider or service limits can be lower. Uploads and downloads
retain backpressure. A provider buffers at most one 5 MiB part, never the whole
object. Progress counts bytes, not provider acceptance or durable delivery.

Cancellation before publication aborts the pending upload and preserves an older
object. If a single-request upload is cancelled while it reads the body, the
provider receives no request. Cleanup is bounded and best effort when the
provider is unavailable.
Configure provider lifecycle rules for abandoned multipart uploads. A completion
race or lost completion response can leave a fully committed object. Cancellation
never promises rollback, and the framework does not delete a newly committed
object to simulate rollback. Reconcile uncertain completion before retrying.
