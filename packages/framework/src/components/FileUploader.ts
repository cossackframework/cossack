import { html } from "@cossackframework/renderer";
import { Cossack, Prop, ClientState } from "@cossackframework/core";

export class FileUploader extends Cossack {
    @Prop()
    uploading: boolean = false;

    @Prop()
    progress: number = 0;

    @Prop()
    onUpload?: (file: File) => void;

    @ClientState()
    selectedFile: File | null = null;

    render() {
        return html`
            <div class="file-uploader p-4 border rounded shadow-sm">
                <div class="mb-4">
                    <label class="block text-gray-700 text-sm font-bold mb-2" for="file-upload">
                        Select File
                    </label>
                    <input 
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        id="file-upload" 
                        type="file" 
                        @change="${(e: Event) => {
                            const input = e.target as HTMLInputElement;
                            if (input.files && input.files.length > 0) {
                                this.selectedFile = input.files[0];
                            }
                        }}"
                        ?disabled="${this.uploading}"
                    />
                </div>

                ${this.uploading ? html`
                    <div class="mb-4">
                        <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                            <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${this.progress}%"></div>
                        </div>
                        <p class="text-sm text-gray-600 mt-1">Uploading... ${this.progress}%</p>
                    </div>
                ` : ''}

                <button 
                    class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline ${this.uploading ? 'opacity-50 cursor-not-allowed' : ''}"
                    type="button"
                    ?disabled="${this.uploading}"
                    @click="${() => {
                        if (this.selectedFile) {
                            if (this.onUpload) this.onUpload(this.selectedFile);
                        } else {
                            alert('Please select a file first');
                        }
                    }}"
                >
                    ${this.uploading ? 'Uploading...' : 'Upload to R2'}
                </button>
            </div>
        `;
    }
}
