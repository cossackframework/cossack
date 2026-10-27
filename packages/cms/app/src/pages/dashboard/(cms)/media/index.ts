import { Cossack, Page, State, Server, Client, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Icon, Input, NativeSelect, Pagination, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { formatBytes, isSameOriginPost, mediaKind, mediaUrl, PERMISSIONS, type MediaKind } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { icon } from '../../../../cms/icons';
import { formFiles, uploadFiles } from '../../../../cms/uploads';
import { uploadFile } from '../../../../cms/media-chooser';
import { notice, pageHeader, shortDate } from '../../../../cms/ui';

const PAGE_SIZE = 40;

interface MediaRow { id: string; url: string; name: string; title: string; alt: string; kind: MediaKind; size: string; dimensions: string; createdAt: number }

/** The media library: a grid of uploads with type and text filters, and an uploader that takes dropped files. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.upload, PERMISSIONS.manageMedia)] })
export default class MediaLibrary extends Cossack {
    @State() items: MediaRow[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() kind = '';
    @State() search = '';
    @State() uploading = false;
    @State() showUploader = false;
    @State() dragging = false;
    @State() message = '';
    @State() errors: string[] = [];
    @State() configured = true;

    head(): HeadValue {
        return { title: 'Files' };
    }

    async init() {
        this.kind = this.c.req.query('kind') ?? '';
        this.search = (this.c.req.query('q') ?? '').slice(0, 100);
        const page = Number(this.c.req.query('page'));
        this.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
        this.showUploader = this.c.req.query('upload') === '1';
        const flashedErrors = flashed<string[]>('cms.media.errors');
        this.errors = flashedErrors ?? [];
        this.message = flashed<string>('cms.media.message') ?? '';
        await this.load();
    }

    @Server()
    async load() {
        const files = this.c.get('cms').files;
        this.configured = files !== null;
        if (!files) return;
        const result = await files.list({ ...(this.kind ? { kind: this.kind as MediaKind } : {}), search: this.search, limit: PAGE_SIZE, offset: (this.page - 1) * PAGE_SIZE });
        this.total = result.total;
        this.items = result.items.map(file => ({
            id: file.id, url: mediaUrl(file), name: file.name, title: file.title, alt: file.alt, kind: mediaKind(file.contentType), size: formatBytes(file.size),
            dimensions: file.width && file.height ? `${file.width} × ${file.height}` : '', createdAt: file.createdAt,
        }));
    }

    /** Uploads from the plain form, without JavaScript. */
    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const result = await uploadFiles(this.c.get('cms'), formFiles(await this.c.req.formData()), this.c.get('principal'), this.c.req.raw.signal);
        if (result.files.length) flash('cms.media.message', `${__('Uploaded')} ${result.files.length} ${result.files.length === 1 ? __('file') : __('files')}.`);
        if (result.errors.length) flash('cms.media.errors', result.errors);
        return this.redirect('/dashboard/media');
    }

    @Client()
    async sendFiles(files: File[]) {
        if (!files.length) return;
        this.uploading = true;
        this.errors = [];
        let uploaded = 0;
        for (const file of files) {
            try { await uploadFile(file); uploaded++; }
            catch (error) { this.errors = [...this.errors, (error as Error).message || `${file.name}: ${__('the upload failed.')}`]; }
        }
        this.uploading = false;
        if (uploaded) {
            toast.success(`${__('Uploaded')} ${uploaded} ${uploaded === 1 ? __('file') : __('files')}.`);
            this.page = 1;
            await this.load();
        }
    }

    @Client()
    onDrop(event: DragEvent) {
        event.preventDefault();
        this.dragging = false;
        void this.sendFiles([...(event.dataTransfer?.files ?? [])]);
    }

    @Client()
    onPick(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const files = [...(input.files ?? [])];
        input.value = '';
        void this.sendFiles(files);
    }

    private href(page: number) {
        const params = new URLSearchParams();
        if (this.kind) params.set('kind', this.kind);
        if (this.search) params.set('q', this.search);
        if (page > 1) params.set('page', String(page));
        const query = params.toString();
        return `/dashboard/media${query ? `?${query}` : ''}`;
    }

    render() {
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        return html`<div class="space-y-6">
            ${pageHeader(__('Files'), { titleActions: component(Button, { type: 'button', size: 'sm', '@click': () => { this.showUploader = !this.showUploader; } }, __('Add new file')) })}
            ${this.configured ? null : notice(__('File storage is not configured. Bind an R2 bucket as MEDIA, or set S3_BUCKET or MEDIA_DIR.'), 'error')}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.errors.map(error => notice(error, 'error'))}
            ${this.showUploader ? html`<form method="post" enctype="multipart/form-data"
                class=${`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${this.dragging ? 'border-primary bg-primary/5' : 'border-border'}`}
                @dragover=${(event: DragEvent) => { event.preventDefault(); this.dragging = true; }} @dragleave=${() => { this.dragging = false; }} @drop=${(event: DragEvent) => this.onDrop(event)}>
                <p class="text-lg font-medium text-foreground">${this.uploading ? __('Uploading…') : __('Drop files to upload')}</p>
                <p class="text-sm text-muted-foreground">${__('or')}</p>
                <label class="inline-flex cursor-pointer items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                    ${__('Select files')}<input type="file" name="file" multiple class="sr-only" @change=${(event: Event) => this.onPick(event)}>
                </label>
                <noscript><button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">${__('Upload')}</button></noscript>
                <p class="text-xs text-muted-foreground">${__('Any kind of file. The size limit is in Settings → Files.')}</p>
            </form>` : null}
            <form method="get" action="/dashboard/media" class="flex flex-wrap items-center gap-2" role="search">
                <div class="w-44">${component(NativeSelect, { name: 'kind', size: 'sm', 'aria-label': __('File type') }, html`
                    ${[['', __('All files')], ['image', __('Images')], ['video', __('Video')], ['audio', __('Audio')], ['document', __('Documents')], ['archive', __('Archives')]]
                        .map(([value, label]) => html`<option value=${value} ?selected=${this.kind === value}>${label}</option>`)}`)}</div>
                <div class="w-64 max-w-full">${component(Input, { type: 'search', name: 'q', size: 'sm', value: this.search, placeholder: __('Search files'), 'aria-label': __('Search files') })}</div>
                ${component(Button, { type: 'submit', size: 'sm', variant: 'outline', class: 'gap-1.5' }, html`${component(Icon, { entry: icon('filter'), size: 16 })}${__('Filter')}`)}
                <span class="ml-auto text-xs text-muted-foreground">${this.total} ${this.total === 1 ? __('item') : __('items')}</span>
            </form>
            ${this.items.length ? html`<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                ${this.items.map(item => html`<li>
                    <a href=${`/dashboard/media/${item.id}`} class="group block overflow-hidden rounded-lg border border-border bg-card no-underline hover:ring-2 hover:ring-ring">
                        ${item.kind === 'image' ? html`<img src=${item.url} alt=${item.alt} class="aspect-square w-full bg-muted object-cover" loading="lazy">`
                            : html`<span class="flex aspect-square w-full items-center justify-center bg-muted p-3 text-center text-xs font-medium uppercase text-muted-foreground">${item.kind}<br>${item.name}</span>`}
                        <span class="block truncate px-2 py-1.5 text-xs text-foreground">${item.title || item.name}</span>
                        <span class="block truncate px-2 pb-1.5 text-[11px] text-muted-foreground">${item.size}${item.dimensions ? ` · ${item.dimensions}` : ''} · ${shortDate(item.createdAt)}</span>
                    </a>
                </li>`)}
            </ul>` : component(Card, {}, component(CardBody, {}, html`<p class="py-8 text-center text-sm text-muted-foreground">${__('No files found.')}</p>`))}
            ${totalPages > 1 ? component(Pagination, {
                page: this.page, totalPages, label: __('Pagination'), previousLabel: __('Previous page'), nextLabel: __('Next page'),
                pageLabel: (page: number) => `${__('Page')} ${page}`, href: (page: number) => this.href(page),
            }) : null}
        </div>`;
    }
}
