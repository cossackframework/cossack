import { html, type TemplateResult } from "@cossackframework/renderer";

type FileUploaderProps = {
    uploading: boolean;
    progress: number;
    onUpload: (file: File) => void;
    [key: string]: any;
};

export const FileUploader = (props: FileUploaderProps) => {
    const { uploading, progress, onUpload, ...rest } = props;

    // We use a simple local variable in the closure scope of the event listener
    // to track the file, since this is a functional component.
    // In a real generic component, we might want to manage this better.
    let selectedFile: File | null = null;

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
                            selectedFile = input.files[0];
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
                    if (selectedFile) {
                        onUpload(selectedFile);
                    } else {
                        alert('Please select a file first');
                    }
                }}"
            >
                ${uploading ? 'Uploading...' : 'Upload to R2'}
            </button>
        </div>
    `;
};
