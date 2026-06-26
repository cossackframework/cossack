import { html } from "@cossackframework/renderer";
import { Cossack, Component, ClientState } from "@cossackframework/core";

interface FileUploaderProps {
    uploading?: boolean;
    progress?: number;
    onUpload?: (file: File) => void;
    // Allow arbitrary HTML attributes to spread onto the root element
    [key: string]: any;
}

@Component()
export class FileUploader extends Cossack {
    // Type-only override: inputs are passed via `this.props` from the parent.
    declare props: FileUploaderProps;

    // Internal UI state (reactive)
    @ClientState()
    selectedFile: File | null = null;

    render() {
        const { uploading = false, progress = 0, onUpload } = this.props;

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
                        ?disabled="${uploading}"
                    />
                </div>

                ${uploading ? html`
                    <div class="mb-4">
                        <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                            <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${progress}%"></div>
                        </div>
                        <p class="text-sm text-gray-600 mt-1">Uploading... ${progress}%</p>
                    </div>
                ` : ''}

                <button
                    class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline ${uploading ? 'opacity-50 cursor-not-allowed' : ''}"
                    type="button"
                    ?disabled="${uploading}"
                    @click="${() => {
                        if (this.selectedFile) {
                            if (onUpload) onUpload(this.selectedFile);
                        } else {
                            alert('Please select a file first');
                        }
                    }}"
                >
                    ${uploading ? 'Uploading...' : 'Upload to R2'}
                </button>
            </div>
        `;
    }
}
