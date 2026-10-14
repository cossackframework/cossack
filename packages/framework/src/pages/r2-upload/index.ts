import { Cossack, Page, ClientState, Client, HeadContext, HeadValue, Server } from "@cossackframework/core";
import { Storage, type StorageAuthorization } from "@cossackframework/core/storage";
import { TemplateResult, html, component } from "@cossackframework/renderer";
import { FileUploader } from "../../components/FileUploader";
import { createR2StorageProvider, type R2StorageBucket } from "../../storage/r2";

/** Every demo object lives under this prefix; the authorizer rejects any other key. */
export const R2_UPLOAD_DEMO_PREFIX = 'r2-upload-demo/';
export const R2_UPLOAD_DEMO_MAX_BYTES = 5 * 1024 * 1024;
/** Allowed content types and the extension used for the server-chosen key. */
export const R2_UPLOAD_DEMO_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt',
});
const DEMO_KEY = /^r2-upload-demo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{3,4}$/;

/** Demo policy: uploads of server-generated keys under the demo prefix only. No reads, listing or deletes. */
export function authorizeR2UploadDemo({ operation, key }: StorageAuthorization<unknown>): boolean {
    return operation === 'put' && key.startsWith(R2_UPLOAD_DEMO_PREFIX) && DEMO_KEY.test(key);
}

@Page({
    transport: 'http'
})
export class CloudflareR2UploadDemo extends Cossack {
    @ClientState()
    uploadProgress: number = 0;

    @ClientState()
    lastUpload: { key: string; size: number } | null = null;

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Cloudflare R2 Upload Demo'
        }
    }

    /**
     * Server-only (undecorated): the `Storage` facade over the `FILES` R2 binding.
     * Signed upload URLs point back at this page; `put()` redeems them.
     */
    private demoStorage(): Storage<unknown> {
        // Hybrid HTTP handlers (put) receive only the request context, so read bindings from it.
        const env = (this.c?.env ?? this.env) as { FILES?: R2StorageBucket; APP_SECRET?: string } | undefined;
        const bucket = env?.FILES;
        if (!bucket) throw new Error('Configure an R2 bucket binding named FILES to run this demo.');
        return new Storage<unknown>({
            provider: createR2StorageProvider(bucket),
            authorize: authorizeR2UploadDemo,
            maxBytes: R2_UPLOAD_DEMO_MAX_BYTES,
            contentTypes: Object.keys(R2_UPLOAD_DEMO_CONTENT_TYPES),
            signing: { secret: String(env?.APP_SECRET ?? ''), endpoint: new URL('/r2-upload', this.c.req.url).href },
        });
    }

    /** Issues a short-lived upload ticket for a server-generated key. The client never picks the key. */
    @Server()
    async createUpload(size: number, contentType: string) {
        const extension = Object.hasOwn(R2_UPLOAD_DEMO_CONTENT_TYPES, contentType) ? R2_UPLOAD_DEMO_CONTENT_TYPES[contentType] : undefined;
        if (!extension) throw new Error('This file type is not allowed in the demo.');
        if (!Number.isSafeInteger(size) || size < 0 || size > R2_UPLOAD_DEMO_MAX_BYTES) throw new Error('Files must be 5 MiB or smaller.');
        const storage = this.demoStorage();
        const key = `${R2_UPLOAD_DEMO_PREFIX}${crypto.randomUUID()}.${extension}`;
        return { uploadUrl: await storage.signedUrl(undefined, key, 'put', { expiresIn: 60, size, contentType }) };
    }

    /** Signed upload redemption (PUT /r2-upload?access=...). */
    async put() {
        return this.demoStorage().handleSignedRequest(undefined, this.c.req.raw);
    }

    @Client()
    async upload(file: File) {
        try {
            this.loading['upload'] = (this.loading['upload'] || 0) + 1;
            this._render();

            const { uploadUrl } = await this.createUpload(file.size, file.type);
            this.lastUpload = await new Promise<{ key: string; size: number }>((resolve, reject) => {
                const request = new XMLHttpRequest();
                request.open('PUT', uploadUrl);
                request.setRequestHeader('Content-Type', file.type);
                request.upload.onprogress = event => {
                    if (event.lengthComputable) { this.uploadProgress = Math.round(event.loaded / event.total * 100); this._render(); }
                };
                request.onload = () => request.status === 201 ? resolve(JSON.parse(request.responseText)) : reject(new Error(`Upload failed with status ${request.status}`));
                request.onerror = () => reject(new Error('Network error during upload'));
                request.send(file);
            });
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Upload failed: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            if (this.loading['upload']) {
                this.loading['upload']--;
                if (this.loading['upload'] <= 0) delete this.loading['upload'];
            }
            this._render();
        }
    }

    render(): TemplateResult | null {
        const uploading = !!this.loading['upload'];

        return html`
            <div class="container mx-auto p-10 max-w-lg">
                <h1 class="text-3xl font-bold mb-6 text-gray-800">R2 Upload Demo</h1>
                <p class="mb-4 text-gray-600">
                    The server issues a short-lived <strong>signed URL</strong> through the <code>Storage</code> facade.
                    The browser streams the file to it, and the facade checks the signature, key prefix, size (5 MiB max)
                    and content type before writing to the R2 binding.
                </p>

                ${component(FileUploader, {
                    uploading: uploading,
                    progress: this.uploadProgress,
                    onUpload: (file: File) => {
                        this.uploadProgress = 0;
                        this.upload(file);
                    }
                })}

                ${this.lastUpload ? html`
                    <div class="mt-6 p-4 bg-green-50 border border-green-200 rounded-md text-green-800 flex items-center">
                        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        <div>
                            <p class="font-bold">Upload Complete!</p>
                            <p class="text-sm break-all">Stored as <code>${this.lastUpload.key}</code> (${this.lastUpload.size} bytes)</p>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
}

export default CloudflareR2UploadDemo;
