/**
 * A media chooser for screens that edit blocks outside the entry editor: Appearance → Widgets
 * and the editor on the public site. Client-safe. The screen keeps the state and finds files
 * on the server; uploads go through `uploadFile`.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Modal } from '@cossackframework/ui';
import { mediaKind } from '@cossackframework/cms';
import type { MediaPreview } from './field-controls';
import { CONTROL } from './ui';

export interface MediaChooserState {
    open: boolean;
    /** The field the chosen file goes to. */
    field: string;
    multiple: boolean;
    search: string;
    items: MediaPreview[];
}

export const closedChooser = (): MediaChooserState => ({ open: false, field: '', multiple: false, search: '', items: [] });

export interface MediaChooserHandlers {
    search(text: string): void;
    choose(file: MediaPreview): void;
    /** Upload files from the file input; the chooser lists them afterwards. */
    upload(event: Event): void;
    close(): void;
}

export function mediaChooser(state: MediaChooserState, handlers: MediaChooserHandlers): TemplateResult {
    return component(Modal, { open: state.open, size: 'max-w-3xl', 'aria-label': __('Choose media'), onOpenChange: (open: boolean) => { if (!open) handlers.close(); } }, html`
        <div class="space-y-4">
            <div class="flex items-center justify-between gap-3">
                <h2 class="text-lg font-semibold text-foreground">${__('Choose media')}</h2>
                ${component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => handlers.close() }, state.multiple ? __('Done') : __('Close'))}
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <input type="search" class=${`${CONTROL} max-w-xs`} placeholder=${__('Search media')} aria-label=${__('Search media')} .value=${state.search}
                    @change=${(event: Event) => handlers.search((event.target as HTMLInputElement).value)}>
                <label class="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
                    ${__('Upload files')}<input type="file" multiple class="sr-only" @change=${(event: Event) => handlers.upload(event)}>
                </label>
            </div>
            <ul class="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
                ${state.items.map(file => html`<li>
                    <button type="button" class="w-full overflow-hidden rounded-md border border-border bg-muted p-0 text-left hover:ring-2 hover:ring-ring cursor-pointer" @click=${() => handlers.choose(file)}>
                        ${mediaKind(file.contentType) === 'image' ? html`<img src=${file.url} alt=${file.alt} class="aspect-square w-full object-cover" loading="lazy">`
                            : html`<span class="flex aspect-square items-center justify-center p-2 text-xs text-muted-foreground">${file.title}</span>`}
                        <span class="block truncate bg-card px-2 py-1 text-xs text-foreground">${file.title}</span>
                    </button>
                </li>`)}
            </ul>
            ${state.items.length ? null : html`<p class="text-sm text-muted-foreground">${__('No media found. Upload files to add them.')}</p>`}
        </div>`);
}

/**
 * Upload one file from the browser, of any size: begin the upload, PUT the bytes where the
 * server says (the bucket itself, or this application), then complete it. Throws with a
 * message people can read.
 */
export async function uploadFile(file: File, signal?: AbortSignal): Promise<MediaPreview> {
    const failed = async (response: Response, fallback: string) => {
        const result = await response.json().catch(() => ({})) as { error?: string };
        return new Error(`${file.name}: ${result.error ?? fallback}`);
    };
    const began = await fetch('/api/cms/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, type: file.type, size: file.size }), signal });
    if (!began.ok) throw await failed(began, __('the upload could not start.'));
    const target = await began.json() as { id: string; url: string; method: string; headers: Record<string, string>; direct: boolean };
    const sent = await fetch(target.url, { method: target.method, headers: target.headers, body: file, credentials: target.direct ? 'omit' : 'same-origin', signal });
    if (!sent.ok) throw target.direct ? new Error(`${file.name}: ${__('the storage service refused the upload.')}`) : await failed(sent, __('the upload failed.'));
    const completed = await fetch(`/api/cms/uploads/${target.id}/complete`, { method: 'POST', signal });
    if (!completed.ok) throw await failed(completed, __('the upload failed.'));
    return (await completed.json() as { file: MediaPreview }).file;
}

/** Upload the files of a file input to the library; returns the new files' previews and an error, if any. */
export async function uploadMedia(input: HTMLInputElement): Promise<{ files: MediaPreview[]; error: string }> {
    const files: MediaPreview[] = [];
    let error = '';
    for (const file of [...(input.files ?? [])]) {
        try { files.push(await uploadFile(file)); }
        catch (failure) { error = (failure as Error).message || __('The upload failed.'); }
    }
    input.value = '';
    return { files, error };
}

/** A chosen file added to a media value: replaced for one file, appended once for a list. */
export function withFile(value: unknown, id: string, multiple: boolean): unknown {
    if (!multiple) return id;
    return [...new Set([...(Array.isArray(value) ? value as string[] : []), id])];
}
