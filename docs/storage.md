---
title: "File Storage & Uploads"
description: "Flexible file upload strategies including direct-to-cloud uploads for R2/S3 and magic RPC uploads for server proxy handling."
---

# File Storage & Uploads

Cossack Framework provides powerful and flexible ways to handle file uploads, catering to both serverless environments (like Cloudflare Workers) and traditional Node.js servers.

We support two primary strategies for uploading files:

1.  **Direct-to-Cloud (Recommended for R2/S3):** The most efficient method for serverless. The client uploads directly to the storage bucket using a presigned URL, bypassing server bandwidth and CPU limits.
2.  **Magic RPC Upload (Server Proxy):** The simplest method for development or processing. You pass a `File` object to a server method, and the framework automatically handles the multipart transfer.

---

## Strategy 1: Direct-to-Cloud (R2 / S3)

This strategy is ideal for Cloudflare Workers and large file uploads. It involves generating a temporary, authorized URL on the server (Presigned URL) that the client uses to upload the file directly.

### Prerequisites

You need to install the AWS SDK (which works with Cloudflare R2):

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Implementation Example

We provide helper functions in `packages/framework/src/storage/s3.ts` to simplify this process.

**`src/pages/upload-demo.ts`**

```typescript
import { Cossack, Page, State, ClientState, Server } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";
import { createR2PresignedUrl, getR2ConfigFromEnv, uploadToPresignedUrl } from "../storage/s3";

@Page({ transport: 'http' })
export class R2UploadPage extends Cossack {
    @ClientState() uploadProgress: number = 0;
    @State() lastUploadUrl: string = '';

    // 1. Server: Generate the Presigned URL
    @Server()
    async getPresignedUrl(key: string, contentType: string) {
        // Automatically reads R2_ACCOUNT_ID, etc. from env
        const config = getR2ConfigFromEnv(this.env);
        // Returns { uploadUrl, publicUrl }
        return await createR2PresignedUrl(config, key, contentType);
    }

    // 2. Client: Perform the Upload
    async upload(file: File) {
        try {
            this.loading['upload'] = 1;
            this._render();

            // A. Get the URL
            const { uploadUrl, publicUrl } = await this.getPresignedUrl(file.name, file.type);

            // B. Upload directly to R2
            await uploadToPresignedUrl(uploadUrl, file, (percent) => {
                this.uploadProgress = percent;
                this._render();
            });

            this.lastUploadUrl = publicUrl;
        } catch (e) {
            console.error(e);
            alert('Upload failed');
        } finally {
            delete this.loading['upload'];
            this._render();
        }
    }

    render() {
        return html`
            <h1>Direct Upload</h1>
            <input type="file" @change="${(e: any) => this.upload(e.target.files[0])}" />
            <progress value="${this.uploadProgress}" max="100"></progress>
            ${this.lastUploadUrl ? html`<img src="${this.lastUploadUrl}" width="200" />` : ''}
        `;
    }
}
```

### Configuration (CORS)

For direct browser uploads to work, you must configure **CORS** on your R2 bucket to allow `PUT` requests from your domain.

```json
[
  {
    "AllowedOrigins": ["https://your-domain.com", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

---

## Strategy 2: Magic RPC Upload (Server Proxy)

This strategy allows you to pass a `File` object directly to a server method. The framework automatically handles the serialization, multipart upload, and reconstruction of the `File` object on the server.

**Best Use Cases:**
-   Node.js environments (saving to disk via `fs`).
-   Small file uploads in Workers (where memory/body limits allow).
-   Processing file content immediately (e.g., parsing a CSV, resizing an image).

### Example

```typescript
import { Cossack, Page, Server } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Page({ transport: 'http' })
export class SimpleUploadPage extends Cossack {
    
    async saveFile(id: string, file: File) {
        console.log(`Receiving file for ID: ${id}`);
        console.log(`File Name: ${file.name}, Size: ${file.size}`);

        // Example: Read content (Buffer/ArrayBuffer)
        const buffer = await file.arrayBuffer();
        
        // Example: Save to disk (Node.js only)
        // import fs from 'node:fs/promises';
        // await fs.writeFile(`./uploads/${file.name}`, Buffer.from(buffer));

        // Example: Process text
        // const text = await file.text();
        
        return { success: true, size: file.size };
    }

    render() {
        return html`
            <input type="file" @change="${(e: any) => {
                const file = e.target.files[0];
                if (file) this.saveFile('user-123', file);
            }}" />
        `;
    }
}
```

### How it Works
1.  The client detects that `saveFile` is being called with a `File` argument.
2.  It intercepts the call and switches from JSON RPC to `multipart/form-data`.
3.  It uploads the file to the framework's internal `/upload` endpoint.
4.  The server reconstructs the arguments and calls your `saveFile` method with the actual `File` object.
5.  **Progress Tracking:** The framework automatically updates a property named `${methodName}Progress` (e.g., `saveFileProgress`) if it exists on your component.

---

## Environment Configuration

Ensure your `wrangler.jsonc` (for Cloudflare) or `.env` (for Node) has the necessary credentials if using R2/S3.

```jsonc
// wrangler.jsonc
{
  "vars": {
    "R2_ACCOUNT_ID": "your_account_id",
    "R2_ACCESS_KEY_ID": "your_access_key",
    "R2_SECRET_ACCESS_KEY": "your_secret_key",
    "R2_BUCKET_NAME": "your_bucket_name",
    "R2_PUBLIC_URL": "https://data.yourdomain.com"
  }
}
```