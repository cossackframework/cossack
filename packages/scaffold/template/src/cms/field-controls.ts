/**
 * Form controls for entry and block fields, shared by the entry editor, Appearance → Widgets
 * and the editor on the public site. Client-safe. Media fields show their files with Choose and
 * Remove buttons; the screen opens its own media chooser.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, Input, NativeSelect, Textarea } from '@cossackframework/ui';
import { mediaKind } from '@cossackframework/cms';
import type { BlockOption, EditorField } from './editor';

/** A file as media controls preview it. */
export interface MediaPreview { id: string; url: string; title: string; alt: string; contentType: string; width: number | null; height: number | null }

/** How a media control shows and changes its files. */
export interface MediaHooks {
    previews: Record<string, MediaPreview>;
    /** Open the screen's media chooser for this field. */
    choose(multiple: boolean): void;
}

/**
 * The control for one field, or null for kinds a screen renders itself (blocks, rich text).
 * `options` lists a reference field's choices.
 */
export function fieldControl(field: EditorField, value: unknown, change: (value: unknown) => void, id: string,
    extra: { media?: MediaHooks; options?: readonly { id: string; title: string }[] } = {}): TemplateResult | null {
    const input = (type: 'text' | 'number' | 'datetime-local') => component(Input, { id, type, '.value': String(value ?? ''), step: field.kind === 'integer' ? 1 : 'any',
        ...(field.kind === 'string' && field.max ? { maxlength: field.max } : {}), '@input': (event: Event) => change((event.target as HTMLInputElement).value) });
    const textarea = (rows: number, className = '') => component(Textarea, { id, rows, ...(className ? { class: className } : {}), '.value': String(value ?? ''),
        '@input': (event: Event) => change((event.target as HTMLTextAreaElement).value) });
    switch (field.kind) {
        case 'boolean': return html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            ${component(Checkbox, { id, checked: value === true, '@change': (event: Event) => change((event.target as HTMLInputElement).checked) })} ${field.label}</label>`;
        case 'enum': return component(NativeSelect, { id, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
            ${field.required ? null : html`<option value="" ?selected=${!value}>—</option>`}
            ${field.choices.map(choice => html`<option value=${choice.value} ?selected=${choice.value === value}>${choice.label}</option>`)}`);
        case 'integer': case 'number': return input('number');
        case 'datetime': return input('datetime-local');
        case 'reference': return component(NativeSelect, { id, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
            <option value="" ?selected=${!value}>—</option>
            ${(extra.options ?? []).map(option => html`<option value=${option.id} ?selected=${option.id === value}>${option.title}</option>`)}`);
        case 'json': return textarea(6, 'font-mono text-xs');
        case 'list': return field.media && extra.media ? mediaControl(value, change, field.label, true, extra.media) : textarea(4);
        case 'text': return textarea(field.format === 'markdown' ? 6 : 4);
        case 'blocks': case 'richtext': case 'vector': case 'bigint': return null;
        default: return field.media && extra.media ? mediaControl(value, change, field.label, false, extra.media) : input('text');
    }
}

/** A media field: its files, with Remove buttons, and a button that opens the chooser. */
export function mediaControl(value: unknown, change: (value: unknown) => void, label: string, multiple: boolean, media: MediaHooks): TemplateResult {
    const ids = Array.isArray(value) ? value as string[] : typeof value === 'string' && value ? [value] : [];
    const remove = (id: string) => change(multiple ? ids.filter(entry => entry !== id) : null);
    return html`<div class="space-y-2">
        ${ids.length ? html`<div class=${multiple ? 'grid grid-cols-3 gap-2' : ''}>${ids.map(id => {
            const file = media.previews[id];
            return html`<figure class="group relative overflow-hidden rounded-md border border-border bg-muted">
                ${file && mediaKind(file.contentType) === 'image'
                    ? html`<img src=${file.url} alt=${file.alt} class="aspect-video w-full object-cover" loading="lazy">`
                    : html`<p class="p-3 text-xs text-muted-foreground">${file?.title ?? id}</p>`}
                <button type="button" class="absolute right-1 top-1 rounded bg-background/90 px-2 py-0.5 text-xs text-destructive border border-border cursor-pointer"
                    @click=${() => remove(id)} aria-label=${`${__('Remove')} ${file?.title ?? ''}`}>${__('Remove')}</button>
            </figure>`;
        })}</div>` : null}
        ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => media.choose(multiple) },
            ids.length && !multiple ? `${__('Replace')} ${label.toLowerCase()}` : `${__('Choose')} ${label.toLowerCase()}`)}
    </div>`;
}

/** A block's fields as a form: one labelled control each. `errors` are keyed by field name. */
export function blockFields(option: BlockOption, values: Record<string, unknown>, change: (name: string, value: unknown) => void, idPrefix: string,
    media: (name: string) => MediaHooks, errors: Record<string, string> = {}): TemplateResult {
    return html`${option.fields.map(entry => {
        const id = `${idPrefix}-${entry.name}`;
        return html`<div class="space-y-1">
            ${entry.kind === 'boolean' ? null : html`<label for=${id} class="block text-sm font-medium text-foreground">${entry.label}${entry.required ? ' *' : ''}</label>`}
            ${fieldControl(entry, values[entry.name], value => change(entry.name, value), id, { media: media(entry.name) })}
            ${entry.description ? html`<p class="text-xs text-muted-foreground">${entry.description}</p>` : null}
            ${errors[entry.name] ? html`<p role="alert" class="text-xs text-destructive">${entry.label} ${errors[entry.name]}</p>` : null}
        </div>`;
    })}`;
}

/** Move one item of a list by `delta` places; the list unchanged when it would leave the ends. */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
    const moved = [...items];
    const [item] = moved.splice(index, 1);
    moved.splice(target, 0, item!);
    return moved;
}
