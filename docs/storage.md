---
title: "File Storage & Uploads"
description: "Upload files directly to R2 or S3, or send them to a server method."
---

# File Storage & Uploads

Cossack supports file uploads on Cloudflare Workers and Node.js.

You can upload files in two ways:

1. **Direct-to-Cloud (Recommended for R2/S3):** The client uploads to a storage bucket with a presigned URL. This avoids sending the file through your server.
2. **RPC Upload (Server Proxy):** Pass a `File` object to a server method. The framework sends it as multipart data.

---

## Strategy 1: Direct-to-Cloud (R2 / S3)

Use this method for large files or Cloudflare Workers. The server creates a temporary, authorized URL called a presigned URL. The client uses it to upload the file directly.

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

To allow direct browser uploads, configure **CORS** on your R2 bucket to accept `PUT` requests from your domain.

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

This method lets you pass a `File` object to a server method. The framework sends the file as multipart data and rebuilds the `File` object on the server.

Use this method for:
- Node.js environments (saving to disk via `fs`).
- Small file uploads in Workers (where memory/body limits allow).
- Processing file content immediately (e.g., parsing a CSV, resizing an image).

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
1. The client detects a `File` argument in the call to `saveFile`.
2. It sends the request as `multipart/form-data` instead of JSON RPC.
3. It uploads the file to the framework's internal `/upload` endpoint.
4. The server rebuilds the arguments and calls `saveFile` with the `File` object.
5. The framework updates a `${methodName}Progress` property, such as `saveFileProgress`, if the component defines one.

---

## Environment Configuration

If you use R2 or S3, add the required credentials to `wrangler.jsonc` for Cloudflare or `.env` for Node.js.

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
