/**
 * A media chooser for screens that edit blocks outside the entry editor: Appearance → Widgets
 * and the editor on the public site. Client-safe. The screen keeps the state and finds files
 * on the server; uploads go to `/api/cms/media`.
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

/** Upload the files of a file input to the media library; returns the new files' previews and an error, if any. */
export async function uploadMedia(input: HTMLInputElement): Promise<{ files: MediaPreview[]; error: string }> {
    const files: MediaPreview[] = [];
    let error = '';
    for (const file of [...(input.files ?? [])]) {
        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/api/cms/media', { method: 'POST', body });
        const result = await response.json().catch(() => ({ error: __('The upload failed.') })) as { files?: MediaPreview[]; error?: string };
        if (!response.ok || !result.files?.length) { error = result.error ?? __('The upload failed.'); continue; }
        files.push(result.files[0]!);
    }
    input.value = '';
    return { files, error };
}

/** A chosen file added to a media value: replaced for one file, appended once for a list. */
export function withFile(value: unknown, id: string, multiple: boolean): unknown {
    if (!multiple) return id;
    return [...new Set([...(Array.isArray(value) ? value as string[] : []), id])];
}
