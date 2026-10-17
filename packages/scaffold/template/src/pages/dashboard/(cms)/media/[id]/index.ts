import { Cossack, Page, State, ClientState, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Button, Card, CardBody, Field, Input, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { formatBytes, imageUrl, isCmsError, mediaKind, mediaUrl, PERMISSIONS, transformable, type ImageEdits, type ImageRect, type MediaKind } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';

interface Details { title: string; alt: string; caption: string; description: string }

const ASPECTS: [string, number | null][] = [['Free', null], ['Square', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9]];

/**
 * One media file: preview, its public URL, editable details and deletion. Images can be
 * cropped and given a focal point, which every resized variant keeps in view.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.upload, PERMISSIONS.manageMedia)] })
export default class MediaDetails extends Cossack {
    @State() file: { id: string; url: string; name: string; kind: MediaKind; contentType: string; size: string; dimensions: string; createdAt: number; uploadedBy: string } | null = null;
    @State() details: Details = { title: '', alt: '', caption: '', description: '' };
    @State() error = '';
    @State() confirmDelete = false;
    /** Image editing: available when the host resizes images. */
    @State() editable = false;
    @State() source = { width: 0, height: 0, version: 0 };
    @State() crop: ImageRect | null = null;
    @State() focus: { x: number; y: number } | null = null;
    @ClientState() mode: 'focus' | 'crop' = 'focus';
    @ClientState() aspect = 0;
    @ClientState() editsChanged = false;
    private stage?: HTMLElement;
    private dragging: { id: number; kind: 'move' | 'resize'; x: number; y: number; start: ImageRect } | null = null;

    head(): HeadValue {
        return { title: this.file ? `${__('Edit media')}: ${this.details.title || this.file.name}` : __('Media') };
    }

    async init() {
        const cms = this.c.get('cms');
        const file = await cms.files?.get(this.c.req.param('id') ?? '');
        if (!file) { this.error = __('This file does not exist.'); this.c.status(404); return; }
        const owner = file.owner ? await cms.users.get(file.owner) : null;
        this.file = { id: file.id, url: mediaUrl(file), name: file.name, kind: mediaKind(file.contentType), contentType: file.contentType, size: formatBytes(file.size),
            dimensions: file.width && file.height ? `${file.width} × ${file.height} px` : '', createdAt: file.createdAt, uploadedBy: owner?.name ?? '' };
        this.details = { title: file.title, alt: file.alt, caption: file.caption, description: file.description };
        this.editable = Boolean(cms.files?.resizes && transformable(file.contentType) && file.width && file.height);
        this.source = { width: file.width ?? 0, height: file.height ?? 0, version: file.updatedAt };
        this.crop = file.edits?.crop ?? null;
        this.focus = file.edits?.focus ?? null;
    }

    // --- Crop and focal point ------------------------------------------------------

    @Client()
    stageRef(element: Element | undefined) {
        this.stage = element as HTMLElement | undefined;
    }

    /** Source pixels per displayed pixel. */
    private scale(): number {
        return this.stage && this.stage.clientWidth ? this.source.width / this.stage.clientWidth : 1;
    }

    @Client()
    pickFocus(event: PointerEvent) {
        if (!this.stage) return;
        const box = this.stage.getBoundingClientRect();
        const x = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
        const y = Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1);
        // The focal point is relative to the cropped image, which this view shows.
        this.focus = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
        this.editsChanged = true;
    }

    @Client()
    startCrop(event: PointerEvent, kind: 'move' | 'resize') {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const start = this.crop ?? { x: 0, y: 0, width: this.source.width, height: this.source.height };
        this.dragging = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, start };
    }

    @Client()
    moveCrop(event: PointerEvent) {
        const drag = this.dragging;
        if (!drag || drag.id !== event.pointerId) return;
        const scale = this.scale();
        const dx = Math.round((event.clientX - drag.x) * scale);
        const dy = Math.round((event.clientY - drag.y) * scale);
        const { width: maxWidth, height: maxHeight } = this.source;
        if (drag.kind === 'move') {
            this.crop = { ...drag.start, x: Math.min(Math.max(drag.start.x + dx, 0), maxWidth - drag.start.width), y: Math.min(Math.max(drag.start.y + dy, 0), maxHeight - drag.start.height) };
        } else {
            let width = Math.min(Math.max(drag.start.width + dx, 16), maxWidth - drag.start.x);
            let height = Math.min(Math.max(drag.start.height + dy, 16), maxHeight - drag.start.y);
            if (this.aspect) {
                height = Math.round(width / this.aspect);
                if (drag.start.y + height > maxHeight) { height = maxHeight - drag.start.y; width = Math.round(height * this.aspect); }
            }
            this.crop = { ...drag.start, width, height };
        }
        this.editsChanged = true;
    }

    @Client()
    endCrop() {
        this.dragging = null;
    }

    /** Apply a shape: the largest crop of that shape, centred in the current one. */
    @Client()
    setAspect(value: number) {
        this.aspect = value;
        if (!value) return;
        const base = this.crop ?? { x: 0, y: 0, width: this.source.width, height: this.source.height };
        let width = base.width;
        let height = Math.round(width / value);
        if (height > base.height) { height = base.height; width = Math.round(height * value); }
        this.crop = { x: base.x + Math.round((base.width - width) / 2), y: base.y + Math.round((base.height - height) / 2), width, height };
        this.editsChanged = true;
    }

    @Client()
    setCropValue(key: keyof ImageRect, value: string) {
        const number = Math.round(Number(value));
        if (!Number.isFinite(number)) return;
        this.crop = { ...(this.crop ?? { x: 0, y: 0, width: this.source.width, height: this.source.height }), [key]: number };
        this.editsChanged = true;
    }

    @Client()
    resetEdits() {
        this.crop = null;
        this.focus = null;
        this.aspect = 0;
        this.editsChanged = true;
    }

    @Client()
    async submitEdits() {
        await this.saveEdits({ ...(this.crop ? { crop: this.crop } : {}), ...(this.focus ? { focus: this.focus } : {}) });
        if (this.error) toast.error(this.error);
        else { this.editsChanged = false; toast.success(__('Image edits saved. Pages show the new version.')); }
    }

    @Server()
    async saveEdits(edits: ImageEdits) {
        this.error = '';
        try {
            const updated = await this.c.get('cms').files!.setEdits(this.c.req.param('id') ?? '', edits.crop || edits.focus ? edits : null, { principal: this.c.get('principal') });
            this.crop = updated.edits?.crop ?? null;
            this.focus = updated.edits?.focus ?? null;
            this.source = { ...this.source, version: updated.updatedAt };
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The edits could not be saved.');
        }
    }

    private imageEditor(file: NonNullable<MediaDetails['file']>): TemplateResult {
        const { width, height } = this.source;
        const crop = this.crop ?? { x: 0, y: 0, width, height };
        const percent = (value: number, total: number) => `${(value / total) * 100}%`;
        const cropped = { id: file.id, name: file.name, contentType: file.contentType, width, height, edits: this.crop ? { crop: this.crop } : null, version: this.source.version };
        const tab = (mode: 'focus' | 'crop', label: string) => html`<button type="button" role="tab" aria-selected=${this.mode === mode ? 'true' : 'false'}
            class=${`rounded px-3 py-1 text-xs font-medium border-none cursor-pointer ${this.mode === mode ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
            @click=${() => { this.mode = mode; }}>${label}</button>`;
        return html`<div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" aria-label=${__('Image editing')} class="flex gap-1">${tab('focus', __('Focal point'))}${tab('crop', __('Crop'))}</div>
                <div class="flex gap-2">
                    ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => this.resetEdits() }, __('Reset'))}
                    ${component(Button, { type: 'button', size: 'sm', disabled: !this.editsChanged, '@click': () => this.submitEdits() }, __('Save image edits'))}
                </div>
            </div>
            ${this.mode === 'focus' ? html`<p class="text-xs text-muted-foreground">${__('Click the part that must stay in view when the image is cut to fit a shape, such as a face.')}</p>
                <div class="relative mx-auto w-fit cursor-crosshair" ref=${(element: Element) => this.stageRef(element)} @pointerdown=${(event: PointerEvent) => this.pickFocus(event)} data-focus-stage>
                    <img src=${this.crop && this.editsChanged ? file.url : this.crop ? imageUrl(cropped, { width: Math.min(crop.width, 1280) }) : file.url} alt=${this.details.alt}
                        class=${`block max-h-[60vh] max-w-full select-none ${this.crop && this.editsChanged ? 'opacity-60' : ''}`} draggable="false">
                    ${this.focus ? html`<span aria-hidden="true" class="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/60 shadow ring-2 ring-black/40"
                        style=${`left: ${this.focus.x * 100}%; top: ${this.focus.y * 100}%`}></span>` : null}
                </div>
                <p class="text-xs text-muted-foreground" aria-live="polite">${this.focus ? `${__('Focal point')}: ${Math.round(this.focus.x * 100)}% × ${Math.round(this.focus.y * 100)}%` : __('No focal point: images are cut around their centre.')}
                    ${this.crop && this.editsChanged ? html` ${__('Save the crop to place the point on the cropped image.')}` : null}</p>`
            : html`<div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="text-muted-foreground">${__('Shape')}:</span>
                    ${ASPECTS.map(([label, value]) => html`<button type="button" class=${`rounded border px-2 py-1 cursor-pointer ${(this.aspect || 0) === (value ?? 0) ? 'border-primary text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                        @click=${() => this.setAspect(value ?? 0)}>${__(label)}</button>`)}
                </div>
                <div class="relative mx-auto w-fit touch-none select-none" ref=${(element: Element) => this.stageRef(element)} data-crop-stage>
                    <img src=${file.url} alt=${this.details.alt} class="block max-h-[60vh] max-w-full" draggable="false">
                    <div class="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] cursor-move" data-crop-box
                        style=${`left: ${percent(crop.x, width)}; top: ${percent(crop.y, height)}; width: ${percent(crop.width, width)}; height: ${percent(crop.height, height)}`}
                        @pointerdown=${(event: PointerEvent) => this.startCrop(event, 'move')} @pointermove=${(event: PointerEvent) => this.moveCrop(event)}
                        @pointerup=${() => this.endCrop()} @pointercancel=${() => this.endCrop()}>
                        <span class="absolute -bottom-2 -right-2 size-4 cursor-se-resize rounded-sm border-2 border-white bg-primary" aria-hidden="true"
                            @pointerdown=${(event: PointerEvent) => this.startCrop(event, 'resize')} @pointermove=${(event: PointerEvent) => this.moveCrop(event)}
                            @pointerup=${() => this.endCrop()} @pointercancel=${() => this.endCrop()}></span>
                    </div>
                </div>
                <fieldset class="grid grid-cols-2 gap-2 sm:grid-cols-4"><legend class="sr-only">${__('Crop in pixels')}</legend>
                    ${(['x', 'y', 'width', 'height'] as const).map(key => html`<label class="space-y-1 text-xs"><span class="block text-muted-foreground">${({ x: __('Left'), y: __('Top'), width: __('Width'), height: __('Height') })[key]}</span>
                        <input type="number" min="0" class="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground" .value=${String(crop[key])}
                            @change=${(event: Event) => this.setCropValue(key, (event.target as HTMLInputElement).value)}></label>`)}
                </fieldset>`}
        </div>`;
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.details);
        if (this.error) toast.error(this.error); else toast.success(__('Media details saved.'));
    }

    @Server()
    async save(details: Details) {
        this.error = '';
        try {
            const updated = await this.c.get('cms').files!.update(this.c.req.param('id') ?? '', details, { principal: this.c.get('principal') });
            this.details = { title: updated.title, alt: updated.alt, caption: updated.caption, description: updated.description };
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The details could not be saved.');
        }
    }

    @Server()
    async deleteFile() {
        try {
            await this.c.get('cms').files!.delete(this.c.req.param('id') ?? '', { principal: this.c.get('principal') });
            return this.redirect('/dashboard/media');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The file could not be deleted.');
        }
    }

    @Client()
    async copyUrl() {
        if (!this.file) return;
        try { await navigator.clipboard.writeText(new URL(this.file.url, location.origin).href); toast.success(__('URL copied.')); }
        catch { toast.error(__('Copy the URL from the field instead.')); }
    }

    @Client()
    set(name: keyof Details, value: string) {
        this.details = { ...this.details, [name]: value };
    }

    render() {
        const file = this.file;
        if (!file) return html`<div class="space-y-4">${notice(this.error || __('Loading…'), 'error')}<a href="/dashboard/media" class="text-primary">← ${__('Media library')}</a></div>`;
        return html`<div class="space-y-6">
            ${pageHeader(__('Edit media'), { actions: html`<a href="/dashboard/media" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Media library')}</a>` })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                ${component(Card, {}, component(CardBody, { class: this.editable ? 'bg-muted/40 p-4' : 'flex items-center justify-center bg-muted/40 p-4' },
                    file.kind === 'image' && this.editable ? this.imageEditor(file)
                    : file.kind === 'image' ? html`<img src=${file.url} alt=${this.details.alt} class="max-h-[70vh] max-w-full rounded object-contain">`
                    : file.kind === 'video' ? html`<video src=${file.url} controls class="max-h-[70vh] max-w-full"></video>`
                    : file.kind === 'audio' ? html`<audio src=${file.url} controls class="w-full"></audio>`
                    : html`<a href=${file.url} class="text-primary hover:underline">${__('Open')} ${file.name}</a>`))}
                <div class="space-y-4">
                    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border p-4 text-xs">
                        <dt class="text-muted-foreground">${__('File name')}</dt><dd class="truncate text-foreground">${file.name}</dd>
                        <dt class="text-muted-foreground">${__('Type')}</dt><dd class="text-foreground">${file.contentType}</dd>
                        <dt class="text-muted-foreground">${__('Size')}</dt><dd class="text-foreground">${file.size}</dd>
                        ${file.dimensions ? html`<dt class="text-muted-foreground">${__('Dimensions')}</dt><dd class="text-foreground">${file.dimensions}</dd>` : null}
                        <dt class="text-muted-foreground">${__('Uploaded')}</dt><dd class="text-foreground">${shortDate(file.createdAt)}</dd>
                        ${file.uploadedBy ? html`<dt class="text-muted-foreground">${__('Uploaded by')}</dt><dd class="text-foreground">${file.uploadedBy}</dd>` : null}
                    </dl>
                    <div class="flex gap-2">
                        <input class="w-full rounded-md border border-input bg-muted px-3 py-1.5 font-mono text-xs text-foreground" readonly .value=${file.url} aria-label=${__('File URL')}>
                        ${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.copyUrl() }, __('Copy'))}
                    </div>
                    <form class="space-y-3" @submit=${(event: Event) => this.submit(event)}>
                        ${component(Field, { label: __('Title'), for: 'media-title', control: attributes => component(Input, { ...attributes, '.value': this.details.title, '@input': (event: Event) => this.set('title', (event.target as HTMLInputElement).value) }) })}
                        ${file.kind === 'image' ? component(Field, { label: __('Alternative text'), for: 'media-alt', hint: __('Describe the image for people who cannot see it. Leave empty if it is decorative.'),
                            control: attributes => component(Textarea, { ...attributes, rows: 2, '.value': this.details.alt, '@input': (event: Event) => this.set('alt', (event.target as HTMLTextAreaElement).value) }) }) : null}
                        ${component(Field, { label: __('Caption'), for: 'media-caption', control: attributes => component(Textarea, { ...attributes, rows: 2, '.value': this.details.caption, '@input': (event: Event) => this.set('caption', (event.target as HTMLTextAreaElement).value) }) })}
                        ${component(Field, { label: __('Description'), for: 'media-description', control: attributes => component(Textarea, { ...attributes, rows: 3, '.value': this.details.description, '@input': (event: Event) => this.set('description', (event.target as HTMLTextAreaElement).value) }) })}
                        <div class="flex items-center justify-between">
                            <button type="button" class="text-sm text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.confirmDelete = true; }}>${__('Delete permanently')}</button>
                            ${component(Button, { type: 'submit' }, __('Update'))}
                        </div>
                    </form>
                </div>
            </div>
            ${component(AlertDialog, {
                id: 'delete-media-dialog', open: this.confirmDelete, title: __('Delete this file?'),
                description: __('Entries that use it will show nothing in its place. This cannot be undone.'),
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { this.confirmDelete = false; void this.deleteFile(); }, onOpenChange: () => { this.confirmDelete = false; },
            })}
        </div>`;
    }
}
