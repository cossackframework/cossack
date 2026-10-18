import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Avatar, Card, CardBody, Button, NativeSelect, Input, Pagination, AlertDialog } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { evaluateRule, isCmsError, languageName, recordTitle, type FieldFilter, type ListFilter, type RecordShape } from '@cossackframework/cms';
import { routeResource, termOptions } from '../../../../../cms/content';
import type { TermOption } from '../../../../../cms/editor';
import { linkButton, notice, pageHeader, shortDate, statusBadge } from '../../../../../cms/ui';

const PAGE_SIZE = 20;

interface Row {
    id: string;
    rev: number;
    title: string;
    slug: string;
    status: string;
    url: string | null;
    author: string;
    avatar: string | null;
    locale: string;
    terms: string[];
    date: string;
    dateLabel: string;
}

/** Entries of one collection or resource, WordPress style: status tabs, search, a term filter and row actions. */
@Page({ transport: 'http' })
export default class EntriesPage extends Cossack {
    @State() route = '';
    @State() label = '';
    @State() singular = '';
    @State() publishable = false;
    @State() canCreate = false;
    @State() status = 'all';
    @State() search = '';
    @State() term = '';
    @State() taxonomy: { name: string; label: string; terms: TermOption[] } | null = null;
    @State() page = 1;
    @State() total = 0;
    @State() counts: { key: string; label: string; count: number }[] = [];
    @State() rows: Row[] = [];
    @State() message = '';
    @State() error = '';
    @State() pendingDelete: Row | null = null;
    @State() hasSlug = false;
    /** Languages to filter by, on a site with several. */
    @State() languages: { code: string; label: string }[] = [];
    @State() locale = '';

    head(): HeadValue {
        return { title: this.label || 'Content' };
    }

    async init() {
        this.route = this.c.req.param('collection') ?? '';
        this.status = this.c.req.query('status') ?? 'all';
        this.search = (this.c.req.query('q') ?? '').trim().slice(0, 200);
        this.term = this.c.req.query('term') ?? '';
        this.locale = this.c.req.query('lang') ?? '';
        const page = Number(this.c.req.query('page'));
        this.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
        await this.load();
    }

    @Server()
    private async load() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        let resource;
        try { ({ resource } = routeResource(cms, this.route)); }
        catch { this.error = __('This content type does not exist.'); this.c.status(404); return; }
        const collection = resource.owner === 'cms' ? cms.collection(resource.name) : null;
        this.label = resource.label ?? resource.id;
        this.singular = collection?.singular ?? __('entry');
        this.publishable = Boolean(collection && collection.publishable !== false);
        this.hasSlug = Boolean(collection && collection.slug !== false);
        const languages = await cms.languages();
        this.languages = collection && languages.multilingual ? languages.all.map(code => ({ code, label: languageName(code) })) : [];
        if (!this.languages.some(language => language.code === this.locale)) this.locale = '';
        this.canCreate = evaluateRule(resource.access.create, principal) !== 'deny';
        const taxonomyName = Object.values(resource.fields).find(field => field.taxonomy && cms.taxonomies.declaration(field.taxonomy).hierarchical)?.taxonomy
            ?? Object.values(resource.fields).find(field => field.taxonomy)?.taxonomy;
        if (taxonomyName) {
            const declaration = cms.taxonomies.declaration(taxonomyName);
            this.taxonomy = { name: taxonomyName, label: declaration.label, terms: await termOptions(cms, taxonomyName) };
        }
        const repository = cms.resource(resource.id);
        const context = { principal };
        const me = principal.kind === 'user' ? principal.id : '';
        const tabs: { key: string; label: string; filter: ListFilter }[] = this.publishable ? [
            { key: 'all', label: __('All'), filter: { where: { status: { ne: 'trash' } } } },
            ...(this.canCreate && me && resource.ownership ? [{ key: 'mine', label: __('Mine'), filter: { where: { status: { ne: 'trash' } }, owner: me } }] : []),
            { key: 'published', label: __('Published'), filter: { where: { status: 'published' } } },
            { key: 'scheduled', label: __('Scheduled'), filter: { where: { status: 'scheduled' } } },
            { key: 'pending', label: __('Pending'), filter: { where: { status: 'pending' } } },
            { key: 'draft', label: __('Drafts'), filter: { where: { status: 'draft' } } },
            { key: 'trash', label: __('Trash'), filter: { where: { status: 'trash' } } },
        ] : [{ key: 'all', label: __('All'), filter: {} }];
        try {
            const language: { [field: string]: FieldFilter } = this.locale ? { locale: this.locale } : {};
            const counts = await repository.countMany(tabs.map(tab => ({ ...tab.filter, where: { ...(tab.filter.where ?? {}), ...language } })), context);
            // Empty tabs other than All and Published stay out of the way, as in WordPress.
            this.counts = tabs.map((tab, index) => ({ key: tab.key, label: tab.label, count: counts[index]! }))
                .filter(tab => tab.count > 0 || ['all', 'published'].includes(tab.key) || tab.key === this.status);
            const tab = tabs.find(entry => entry.key === this.status) ?? tabs[0]!;
            this.status = tab.key;
            const where: { [field: string]: FieldFilter } = { ...(tab.filter.where ?? {}), ...language };
            if (this.term && this.taxonomy) where[this.taxonomy.name] = { containsAny: (await cms.taxonomies.subtree(this.term)).slice(0, 50) };
            const filter: ListFilter = { where, ...(tab.filter.owner ? { owner: tab.filter.owner } : {}) };
            let records: readonly RecordShape[];
            if (this.search && Object.values(resource.fields).some(field => field.search)) {
                records = await repository.search(this.search, { ...filter, limit: 50 }, context);
                this.total = records.length;
            } else {
                const [page, total] = await Promise.all([
                    repository.list({ ...filter, limit: PAGE_SIZE, offset: (this.page - 1) * PAGE_SIZE, order: { field: 'updatedAt', direction: 'desc' } }, context),
                    repository.count(filter, context),
                ]);
                records = page.records;
                this.total = total;
            }
            const owners = await cms.users.getMany(records.map(record => record.owner).filter((owner): owner is string => !!owner));
            const termIds = this.taxonomy ? records.flatMap(record => (record[this.taxonomy!.name] as string[] | undefined) ?? []) : [];
            const terms = await cms.taxonomies.getMany(termIds);
            const urls = collection ? await cms.entryUrls(collection, records) : new Map<string, string | null>();
            this.rows = records.map(record => {
                const published = record.status === 'published' && typeof record.publishedAt === 'number';
                const scheduled = record.status === 'scheduled' && typeof record.publishedAt === 'number';
                const owner = record.owner ? owners.get(record.owner) : undefined;
                return {
                    id: record.id, rev: record.rev, title: recordTitle(record, resource.titleField), slug: typeof record.slug === 'string' ? record.slug : '', status: String(record.status ?? ''),
                    url: (published || !this.publishable) ? urls.get(record.id) ?? null : null,
                    author: owner?.name ?? '—', avatar: owner?.avatar ?? null, locale: typeof record.locale === 'string' ? record.locale : '',
                    terms: this.taxonomy ? ((record[this.taxonomy.name] as string[] | undefined) ?? []).map(id => terms.get(id)?.name).filter((name): name is string => !!name) : [],
                    date: shortDate(published || scheduled ? record.publishedAt : record.updatedAt),
                    dateLabel: published ? __('Published') : scheduled ? __('Scheduled for') : __('Last modified'),
                };
            });
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The entries could not be loaded.');
        }
    }

    @Server()
    async moveTo(id: string, rev: number, status: 'trash' | 'draft') {
        this.message = '';
        this.error = '';
        try {
            const { resource } = routeResource(this.c.get('cms'), this.route);
            await this.c.get('cms').resource(resource.id).update(id, { status }, { principal: this.c.get('principal'), expectedRevision: rev });
            this.message = status === 'trash' ? __('Moved to the trash.') : __('Restored as a draft.');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The entry could not be changed.');
        }
        await this.load();
    }

    @Server()
    async deleteEntry(id: string, rev: number) {
        this.message = '';
        this.error = '';
        try {
            const { resource } = routeResource(this.c.get('cms'), this.route);
            await this.c.get('cms').resource(resource.id).delete(id, { principal: this.c.get('principal'), expectedRevision: rev });
            this.message = __('Deleted permanently.');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The entry could not be deleted.');
        }
        await this.load();
    }

    @Client()
    async confirmDelete() {
        const row = this.pendingDelete;
        this.pendingDelete = null;
        if (row) await this.deleteEntry(row.id, row.rev);
    }

    private href(changes: Record<string, string | number>) {
        const params = new URLSearchParams();
        const next = { status: this.status, q: this.search, term: this.term, lang: this.locale, page: this.page, ...changes };
        if (next.status && next.status !== 'all') params.set('status', String(next.status));
        if (next.q) params.set('q', String(next.q));
        if (next.term) params.set('term', String(next.term));
        if (next.lang) params.set('lang', String(next.lang));
        if (Number(next.page) > 1) params.set('page', String(next.page));
        const query = params.toString();
        return `/dashboard/content/${this.route}${query ? `?${query}` : ''}`;
    }

    render() {
        if (!this.label) return notice(this.error || __('This content type does not exist.'), 'error');
        const base = `/dashboard/content/${this.route}`;
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        const action = 'text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer';
        return html`<div class="space-y-6">
            ${pageHeader(this.label, { actions: this.canCreate ? linkButton(`${__('Add new')} ${this.singular.toLowerCase()}`, `${base}/new`) : null })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <nav aria-label=${__('Filter by status')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    ${this.counts.map((tab, index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                        <a href=${this.href({ status: tab.key, page: 1 })} class=${tab.key === this.status ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}
                            aria-current=${tab.key === this.status ? 'page' : 'false'}>${tab.label} <span class="text-muted-foreground">(${tab.count})</span></a>`)}
                </nav>
                <form method="get" action=${base} class="flex flex-wrap gap-2" role="search">
                    ${this.status !== 'all' ? html`<input type="hidden" name="status" value=${this.status}>` : null}
                    ${this.languages.length ? component(NativeSelect, { name: 'lang', size: 'sm', 'aria-label': __('Filter by language') }, html`
                        <option value="" ?selected=${!this.locale}>${__('All languages')}</option>
                        ${this.languages.map(language => html`<option value=${language.code} ?selected=${language.code === this.locale}>${language.label}</option>`)}`) : null}
                    ${this.taxonomy ? component(NativeSelect, { name: 'term', size: 'sm', 'aria-label': `${__('Filter by')} ${this.taxonomy.label}` }, html`
                        <option value="" ?selected=${!this.term}>${__('All')} ${this.taxonomy.label.toLowerCase()}</option>
                        ${this.taxonomy.terms.map(term => html`<option value=${term.id} ?selected=${term.id === this.term}>${'— '.repeat(term.depth)}${term.name}</option>`)}`) : null}
                    ${component(Input, { type: 'search', name: 'q', value: this.search, size: 'sm', placeholder: `${__('Search')} ${this.label.toLowerCase()}`, 'aria-label': __('Search') })}
                    ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Filter'))}
                </form>
            </div>
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th class="px-4 py-3 font-medium">${__('Title')}</th>
                            ${this.hasSlug ? html`<th class="px-4 py-3 font-medium">${__('Slug')}</th>` : null}
                            <th class="px-4 py-3 font-medium">${__('Author')}</th>
                            ${this.languages.length ? html`<th class="px-4 py-3 font-medium">${__('Language')}</th>` : null}
                            ${this.taxonomy ? html`<th class="px-4 py-3 font-medium">${this.taxonomy.label}</th>` : null}
                            <th class="px-4 py-3 font-medium">${__('Date')}</th>
                        </tr></thead>
                        <tbody>${this.rows.map(row => html`<tr class="group border-b border-border last:border-0 align-top">
                            <td class="px-4 py-3">
                                <a href=${`${base}/${row.id}`} class="font-medium text-foreground hover:text-primary no-underline">${row.title}</a>
                                ${row.status && row.status !== 'published' && ['all', 'mine'].includes(this.status) ? html` <span class="text-muted-foreground">— ${statusBadge(row.status)}</span>` : null}
                                <div class="mt-1 flex flex-wrap gap-2 text-xs opacity-80 group-hover:opacity-100">
                                    ${row.status === 'trash' ? html`
                                        <button type="button" class=${action} @click=${() => this.moveTo(row.id, row.rev, 'draft')}>${__('Restore')}</button>
                                        <span aria-hidden="true" class="text-muted-foreground">|</span>
                                        <button type="button" class=${`${action} text-destructive`} @click=${() => { this.pendingDelete = row; }}>${__('Delete permanently')}</button>` : html`
                                        <a href=${`${base}/${row.id}`} class="text-primary hover:underline">${__('Edit')}</a>
                                        ${this.publishable ? html`<span aria-hidden="true" class="text-muted-foreground">|</span>
                                            <button type="button" class=${`${action} text-destructive`} @click=${() => this.moveTo(row.id, row.rev, 'trash')}>${__('Trash')}</button>`
                                            : html`<span aria-hidden="true" class="text-muted-foreground">|</span>
                                            <button type="button" class=${`${action} text-destructive`} @click=${() => { this.pendingDelete = row; }}>${__('Delete')}</button>`}
                                        ${row.url ? html`<span aria-hidden="true" class="text-muted-foreground">|</span><a href=${row.url} class="text-primary hover:underline">${__('View')}</a>` : null}`}
                                </div>
                            </td>
                            ${this.hasSlug ? html`<td class="px-4 py-3"><code class="break-all text-xs text-muted-foreground">${row.slug}</code></td>` : null}
                            <td class="px-4 py-3 text-muted-foreground"><span class="flex items-center gap-2">
                                ${row.author !== '—' ? component(Avatar, { src: row.avatar ?? undefined, alt: row.author, size: 24 }) : null}<span>${row.author}</span></span></td>
                            ${this.languages.length ? html`<td class="px-4 py-3 text-muted-foreground"><span title=${languageName(row.locale)}>${row.locale.toUpperCase()}</span></td>` : null}
                            ${this.taxonomy ? html`<td class="px-4 py-3 text-muted-foreground">${row.terms.join(', ') || '—'}</td>` : null}
                            <td class="px-4 py-3 text-muted-foreground"><span class="block">${row.dateLabel}</span><span class="block text-xs">${row.date}</span></td>
                        </tr>`)}</tbody>
                    </table>
                    ${this.rows.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${__('Nothing found.')}</p>`}
                </div>`))}
            <div class="flex flex-col items-center justify-between gap-3 sm:flex-row">
                <p class="text-xs text-muted-foreground">${this.total} ${this.total === 1 ? __('item') : __('items')}</p>
                ${totalPages > 1 ? component(Pagination, {
                    page: this.page, totalPages, label: __('Pagination'), previousLabel: __('Previous page'), nextLabel: __('Next page'),
                    pageLabel: (page: number) => `${__('Page')} ${page}`, href: (page: number) => this.href({ page }),
                }) : null}
            </div>
            ${component(AlertDialog, {
                id: 'delete-entry-dialog',
                open: this.pendingDelete !== null,
                title: __('Delete permanently?'),
                description: this.pendingDelete ? `“${this.pendingDelete.title}” ${__('and its revisions will be deleted. This cannot be undone.')}` : '',
                cancelLabel: __('Cancel'),
                actionLabel: __('Delete'),
                actionVariant: 'destructive',
                onAction: () => this.confirmDelete(),
                onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
