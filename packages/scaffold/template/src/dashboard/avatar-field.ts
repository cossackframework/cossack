/**
 * The avatar control of the profile and user screens: a preview with Upload and Remove when
 * the auth store keeps files (the CMS keeps them in its media library), otherwise an image URL
 * with a live preview.
 */
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { Avatar, Button, Field, Input } from '@cossackframework/ui';

/** Still and animated images: animated GIF, APNG, WebP and AVIF play in the preview too. */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

export interface AvatarFieldOptions {
    id: string;
    value: string;
    /** Alternative text: the user's name. */
    name: string;
    uploads: boolean;
    uploading: boolean;
    error?: string;
    onFile(file: File): void;
    onUrl(url: string): void;
    onRemove(): void;
}

export function avatarField(options: AvatarFieldOptions): TemplateResult {
    const preview = component(Avatar, { src: options.value || undefined, alt: options.name, size: 72 });
    if (!options.uploads) {
        return html`<div class="flex items-start gap-4">${preview}<div class="flex-1">
            ${component(Field, { label: __('Avatar URL'), for: options.id, hint: __('A link to a picture.'), ...(options.error ? { error: options.error } : {}),
                control: attributes => component(Input, { ...attributes, type: 'url', placeholder: 'https://...', '.value': options.value,
                    '@input': (event: Event) => options.onUrl((event.target as HTMLInputElement).value) }) })}
        </div></div>`;
    }
    return html`<div class="space-y-2">
        <span class="block text-sm font-medium text-foreground">${__('Avatar')}</span>
        <div class="flex items-center gap-4">
            ${preview}
            <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                    <label class=${`inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring ${options.uploading ? 'pointer-events-none opacity-60' : ''}`}>
                        ${options.uploading ? __('Uploading…') : options.value ? __('Change picture') : __('Upload picture')}
                        <input id=${options.id} type="file" accept=${AVATAR_ACCEPT} class="sr-only" ?disabled=${options.uploading}
                            @change=${(event: Event) => {
                                const input = event.currentTarget as HTMLInputElement;
                                const file = input.files?.[0];
                                input.value = '';
                                if (file) options.onFile(file);
                            }}>
                    </label>
                    ${options.value && !options.uploading ? component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => options.onRemove() }, __('Remove')) : null}
                </div>
                <p class="text-xs text-muted-foreground">${__('PNG, JPEG, GIF, WebP or AVIF, still or animated, up to 5 MB.')}</p>
                ${options.error ? html`<p role="alert" class="text-xs text-destructive">${options.error}</p>` : null}
            </div>
        </div>
    </div>`;
}
