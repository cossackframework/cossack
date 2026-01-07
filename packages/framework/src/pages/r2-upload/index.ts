import { Cossack, Page, State, ClientState, HeadContext, HeadValue, Server } from "@cossackframework/core";
import { TemplateResult, html } from "@cossackframework/renderer";
import { FileUploader } from "../../components/FileUploader";
import { createR2PresignedUrl, getR2ConfigFromEnv, uploadToPresignedUrl } from "../../storage/s3";

@Page({
    transport: 'http'
})
export class CloudflareR2UploadDemo extends Cossack {
    @ClientState()
    uploadProgress: number = 0;

    @State()
    lastUploadUrl: string = '';

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Cloudflare R2 Upload Demo (S3 API)'
        }
    }

    @Server()
    async getPresignedUrl(key: string, contentType: string) {
        const config = getR2ConfigFromEnv(this.env);
        return await createR2PresignedUrl(config, key, contentType);
    }

    async upload(file: File) {
        try {
            this.loading['upload'] = (this.loading['upload'] || 0) + 1;
            this._render();

            // 1. Get the presigned URL from the server
            const { uploadUrl, publicUrl } = await this.getPresignedUrl(file.name, file.type);
            console.log('Got presigned URL:', uploadUrl);

            // 2. Upload directly to R2
            await uploadToPresignedUrl(uploadUrl, file, (percent) => {
                this.uploadProgress = percent;
                this._render();
            });

            // 3. Update state
            this.lastUploadUrl = publicUrl;
            
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
                    This demo uses the <strong>AWS SDK v3</strong> to generate a <strong>Presigned URL</strong> on the server.
                    The file is then uploaded <strong>directly</strong> from your browser to Cloudflare R2, bypassing the worker's CPU and bandwidth limits.
                </p>
                
                ${FileUploader({
                    uploading: uploading,
                    progress: this.uploadProgress,
                    onUpload: (file) => {
                        this.uploadProgress = 0;
                        this.upload(file);
                    }
                })}

                ${this.lastUploadUrl ? html`
                    <div class="mt-6 p-4 bg-green-50 border border-green-200 rounded-md text-green-800 flex items-center">
                        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        <div>
                            <p class="font-bold">Upload Complete!</p>
                            <p class="text-sm break-all">
                                <a href="${this.lastUploadUrl}" target="_blank" class="text-blue-600 hover:underline">${this.lastUploadUrl}</a>
                            </p>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
