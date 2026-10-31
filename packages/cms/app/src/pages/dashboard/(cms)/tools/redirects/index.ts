import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge, Button, Card, CardBody, Field, Input, NativeSelect, Pagination, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS, principalId, REDIRECT_STATUSES, type Redirect, type RedirectStatus } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';

const PAGE_SIZE = 20;
const TYPES: Record<RedirectStatus, string> = { 301: '301 Moved permanently', 302: '302 Found (temporary)', 307: '307 Temporary redirect', 308: '308 Permanent redirect', 410: '410 Gone' };

interface Form { id: string; source: string; target: string; status: RedirectStatus; note: string }
const EMPTY: Form = { id: '', source: '', target: '', status: 301, note: '' };

/**
 * Redirects for addresses without content. The CMS adds 301s itself when a published entry's
 * address changes; add your own for moved or retired pages. A source ending in `/*` matches
 * everything below it, and a target ending in `/*` keeps the rest of the path.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageRedirects)] })
export default class RedirectsPage extends Cossack {
    @State() items: Redirect[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() search = '';
    @State() kind: '' | 'auto' | 'manual' = '';
    @State() form: Form = { ...EMPTY };
    @State() error = '';
    @State() pendingDelete: Redirect | null = null;

    head(): HeadValue {
        return { title: __('Redirects') };
    }

    async init() {
        this.search = (this.c.req.query('q') ?? '').slice(0, 200);
        const kind = this.c.req.query('kind');
        this.kind = kind === 'auto' || kind === 'manual' ? kind : '';
        const page = Number(this.c.req.query('page'));
        this.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
        // Tools → Health links a missing path here to redirect it.
        const source = (this.c.req.query('source') ?? '').slice(0, 500);
        if (source.startsWith('/')) this.form = { ...EMPTY, source };
        await this.load();
    }

    @Server()
    private async load() {
        const { redirects } = this.c.get('cms');
        const result = await redirects.list({ search: this.search, ...(this.kind ? { kind: this.kind } : {}), offset: (this.page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
        this.items = result.items;
        this.total = result.total;
    }

    @Client()
    edit(item: Redirect) {
        this.form = { id: item.id, source: item.source, target: item.target, status: item.status, note: item.note };
        document.getElementById('redirect-source')?.focus();
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        const editing = Boolean(this.form.id);
        await this.save(this.form);
        if (this.error) toast.error(this.error); else toast.success(editing ? __('Redirect updated.') : __('Redirect added.'));
    }

    @Server()
    async save(form: Form) {
        this.error = '';
        try {
            const { redirects } = this.c.get('cms');
            const input = { source: form.source, target: form.target, status: Number(form.status) as RedirectStatus, note: form.note };
            await redirects.save(input, { ...(form.id ? { id: form.id } : {}), by: principalId(this.c.get('principal')) });
            await this.c.get('cms').traffic.forgetNotFound(form.source.trim());
            this.form = { ...EMPTY };
            await this.load();
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The redirect could not be saved.');
        }
    }

    @Server()
    async remove(id: string) {
        await this.c.get('cms').redirects.delete(id);
        if (this.form.id === id) this.form = { ...EMPTY };
        await this.load();
    }

    private href(changes: Record<string, string | number>) {
        const next = { q: this.search, kind: this.kind, page: this.page, ...changes };
        const params = new URLSearchParams(Object.entries(next).filter(([key, value]) => value && !(key === 'page' && Number(value) <= 1)).map(([key, value]) => [key, String(value)]));
        return `/dashboard/tools/redirects${params.size ? `?${params}` : ''}`;
    }

    render() {
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        const gone = Number(this.form.status) === 410;
        return html`<div class="space-y-6">
            ${pageHeader(__('Redirects'), { description: __('Send visitors from addresses without content to new ones. Redirects never hide a live page.') })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="grid gap-4 md:grid-cols-[1fr_1fr_14rem]" @submit=${(event: Event) => this.submit(event)}>
                ${component(Field, { label: __('Source path'), for: 'redirect-source', hint: __('Such as /old-page, or /old/* for everything below it.'),
                    control: attributes => component(Input, { ...attributes, required: true, placeholder: '/old-page', '.value': this.form.source, '@input': (event: Event) => { this.form = { ...this.form, source: (event.target as HTMLInputElement).value }; } }) })}
                ${component(Field, { label: __('Target'), for: 'redirect-target', hint: gone ? __('Gone pages have no target.') : __('A path or a full URL; /new/* keeps the rest of the path.'),
                    control: attributes => component(Input, { ...attributes, disabled: gone, placeholder: '/new-page', '.value': gone ? '' : this.form.target, '@input': (event: Event) => { this.form = { ...this.form, target: (event.target as HTMLInputElement).value }; } }) })}
                ${component(Field, { label: __('Type'), for: 'redirect-status',
                    control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => { this.form = { ...this.form, status: Number((event.target as HTMLSelectElement).value) as RedirectStatus }; } }, html`
                        ${REDIRECT_STATUSES.map(status => html`<option value=${status} ?selected=${Number(this.form.status) === status}>${__(TYPES[status])}</option>`)}`) })}
                <div class="md:col-span-2">${component(Field, { label: __('Note'), for: 'redirect-note',
                    control: attributes => component(Input, { ...attributes, maxlength: 200, '.value': this.form.note, '@input': (event: Event) => { this.form = { ...this.form, note: (event.target as HTMLInputElement).value }; } }) })}</div>
                <div class="flex items-end gap-2">
                    ${component(Button, { type: 'submit' }, this.form.id ? __('Update redirect') : __('Add redirect'))}
                    ${this.form.id ? component(Button, { type: 'button', variant: 'ghost', '@click': () => { this.form = { ...EMPTY }; } }, __('Cancel')) : null}
                </div>
            </form>`))}
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <nav aria-label=${__('Filter by kind')} class="flex gap-3 text-sm">
                    ${([['', __('All')], ['manual', __('Added by people')], ['auto', __('Automatic')]] as const).map(([value, label]) => html`<a href=${this.href({ kind: value, page: 1 })}
                        aria-current=${this.kind === value ? 'page' : 'false'} class=${this.kind === value ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}>${label}</a>`)}
                </nav>
                <form method="get" class="flex gap-2" role="search">
                    ${this.kind ? html`<input type="hidden" name="kind" value=${this.kind}>` : null}
                    ${component(Input, { type: 'search', name: 'q', size: 'sm', value: this.search, placeholder: __('Search redirects'), 'aria-label': __('Search redirects') })}
                    ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Search'))}
                </form>
            </div>
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class="px-3 py-2 font-medium">${__('Source')}</th><th class="px-3 py-2 font-medium">${__('Target')}</th><th class="px-3 py-2 font-medium">${__('Type')}</th>
                    <th class="px-3 py-2 font-medium">${__('Hits')}</th><th class="px-3 py-2 font-medium"><span class="sr-only">${__('Actions')}</span></th>
                </tr></thead>
                <tbody>${this.items.map(item => html`<tr class="border-b border-border last:border-0 align-top" data-redirect=${item.source}>
                    <td class="px-3 py-2"><code class="break-all text-foreground">${item.source}</code>${item.note ? html`<span class="block text-xs text-muted-foreground">${item.note}</span>` : null}</td>
                    <td class="px-3 py-2"><code class="break-all text-muted-foreground">${item.status === 410 ? '—' : item.target}</code></td>
                    <td class="px-3 py-2"><span class="flex flex-wrap gap-1">${component(Badge, { variant: item.status === 410 ? 'destructive' : 'secondary' }, String(item.status))}
                        ${item.kind === 'auto' ? component(Badge, { variant: 'outline' }, __('Automatic')) : null}</span></td>
                    <td class="px-3 py-2 text-muted-foreground">${item.hits}${item.lastHitAt ? html`<span class="block text-xs">${shortDate(item.lastHitAt)}</span>` : null}</td>
                    <td class="px-3 py-2 text-right"><span class="flex justify-end gap-3 text-xs">
                        <button type="button" class="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.edit(item)}>${__('Edit')}</button>
                        <button type="button" class="text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.pendingDelete = item; }}>${__('Delete')}</button>
                    </span></td>
                </tr>`)}</tbody></table>
                ${this.items.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${__('No redirects yet.')}</p>`}</div>`))}
            ${totalPages > 1 ? component(Pagination, { page: this.page, totalPages, label: __('Pagination'), previousLabel: __('Previous page'), nextLabel: __('Next page'),
                pageLabel: (page: number) => `${__('Page')} ${page}`, href: (page: number) => this.href({ page }) }) : null}
            ${component(AlertDialog, {
                id: 'delete-redirect-dialog', open: this.pendingDelete !== null, title: __('Delete this redirect?'),
                description: this.pendingDelete ? `${this.pendingDelete.source} ${__('will answer “Page not found” again.')}` : '',
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { const item = this.pendingDelete; this.pendingDelete = null; if (item) void this.remove(item.id); }, onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
