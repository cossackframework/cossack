import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS, recordTitle, renderSeoTemplate, TITLE_SEPARATORS, type FieldFilter } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

interface SeoRow { id: string; title: string; url: string | null; status: string; seoTitle: string; description: string; summary: string; rev: number; saved: boolean }

const PAGE_SIZE = 25;

/**
 * SEO titles, meta descriptions and summaries of a collection's entries in one table, to fill
 * in or fix many at once. Each row saves on its own, with a revision check so a concurrent
 * edit in the entry editor is not overwritten.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class SeoEditorPage extends Cossack {
    @State() collections: { name: string; label: string; summary: boolean }[] = [];
    @State() collection = '';
    @State() rows: SeoRow[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() filter: 'all' | 'missing' = 'all';
    @State() template = { title: '%title% %sep% %site%', sep: '–', site: '' };
    @State() error = '';

    head(): HeadValue {
        return { title: __('SEO editor') };
    }

    async init() {
        const cms = this.c.get('cms');
        this.collections = cms.collections().filter(collection => typeof collection.path === 'string' && !collection.managed).map(collection => ({ name: collection.name, label: collection.label, summary: Boolean(cms.resourceById(`cms/${collection.name}`).fields.summary) }));
        this.collection = this.collections.find(entry => entry.name === this.c.req.query('collection'))?.name ?? this.collections[0]?.name ?? '';
        this.filter = this.c.req.query('filter') === 'missing' ? 'missing' : 'all';
        const page = Number(this.c.req.query('page'));
        this.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        if (!this.collection) return;
        const collection = cms.collection(this.collection);
        const settings = await cms.settings.all();
        this.template = { title: collection.seoTemplates?.title || settings['seo.entryTitle'], sep: TITLE_SEPARATORS[settings['seo.titleSeparator']] ?? '–', site: settings['general.siteTitle'] };
        const where: { [field: string]: FieldFilter } = collection.publishable === false ? {} : { status: 'published' };
        const repository = cms.resource(`cms/${collection.name}`);
        const principal = this.c.get('principal');
        // The missing filter reads up to 500 entries and keeps those without a description or summary.
        const limit = this.filter === 'missing' ? 100 : PAGE_SIZE;
        const records = [];
        let total = 0;
        if (this.filter === 'missing') {
            for (let offset = 0; offset < 500; offset += 100) {
                const page = await repository.list({ where, limit: 100, offset, order: { field: 'updatedAt', direction: 'desc' } }, { principal });
                records.push(...page.records.filter(record => !(record.seo as { description?: string } | null)?.description || !(typeof record.summary === 'string' && record.summary)));
                if (page.records.length < 100) break;
            }
            total = records.length;
        } else {
            const page = await repository.list({ where, limit, offset: (this.page - 1) * PAGE_SIZE, order: { field: 'updatedAt', direction: 'desc' } }, { principal });
            records.push(...page.records);
            total = await repository.count({ where }, { principal });
        }
        const slice = this.filter === 'missing' ? records.slice((this.page - 1) * PAGE_SIZE, this.page * PAGE_SIZE) : records;
        const urls = await cms.entryUrls(collection, slice);
        this.total = total;
        this.rows = slice.map(record => {
            const seo = (record.seo ?? {}) as { title?: string; description?: string };
            return { id: record.id, title: recordTitle(record, 'title'), url: urls.get(record.id) ?? null, status: String(record.status ?? ''), seoTitle: seo.title ?? '', description: seo.description ?? '', summary: typeof record.summary === 'string' ? record.summary : '', rev: record.rev, saved: false };
        });
    }

    @Client()
    set(id: string, key: 'seoTitle' | 'description' | 'summary', value: string) {
        this.rows = this.rows.map(row => row.id === id ? { ...row, [key]: value, saved: false } : row);
    }

    @Client()
    async save(id: string) {
        const row = this.rows.find(entry => entry.id === id);
        if (!row) return;
        await this.store(row);
        if (this.error) toast.error(this.error); else toast.success(__('Saved.'));
    }

    @Server()
    async store(row: SeoRow) {
        this.error = '';
        const cms = this.c.get('cms');
        try {
            const repository = cms.resource(`cms/${this.collection}`);
            const current = await repository.get(row.id, { principal: this.c.get('principal') });
            if (!current) { this.error = __('The entry no longer exists.'); return; }
            const seo = { ...((current.seo as Record<string, unknown> | null) ?? {}), title: row.seoTitle.trim(), description: row.description.trim() };
            const summary = this.collections.find(entry => entry.name === this.collection)?.summary;
            const saved = await repository.update(row.id, { seo, ...(summary ? { summary: row.summary.trim() } : {}) }, { principal: this.c.get('principal'), expectedRevision: row.rev });
            this.rows = this.rows.map(entry => entry.id === row.id ? { ...entry, rev: saved.rev, saved: true } : entry);
        } catch (error) {
            this.error = isCmsError(error) ? (error.code === 'CMS_CONFLICT' ? __('Someone changed this entry meanwhile; reload the page.') : error.message) : __('The entry could not be saved.');
        }
    }

    render() {
        const pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        const href = (query: { collection?: string; filter?: string; page?: number }) => `/dashboard/tools/seo?collection=${encodeURIComponent(query.collection ?? this.collection)}&filter=${query.filter ?? this.filter}&page=${query.page ?? 1}`;
        const counter = (text: string, ideal: number) => html`<span class=${`text-xs ${[...text].length > ideal ? 'text-amber-600' : 'text-muted-foreground'}`}>${[...text].length}/${ideal}</span>`;
        const summary = this.collections.find(entry => entry.name === this.collection)?.summary ?? false;
        return html`<div class="space-y-6">
            ${pageHeader(__('SEO editor'), { description: __('Titles, descriptions and summaries of many entries at once. Empty titles and descriptions use the templates in Settings → SEO.') })}
            ${this.error ? notice(this.error, 'error') : null}
            <form method="get" action="/dashboard/tools/seo" class="flex flex-wrap items-end gap-3">
                <label class="text-sm text-foreground">${__('Collection')}<br>${component(NativeSelect, { name: 'collection', '@change': (event: Event) => { window.location.href = href({ collection: (event.target as HTMLSelectElement).value }); } }, html`
                    ${this.collections.map(entry => html`<option value=${entry.name} ?selected=${entry.name === this.collection}>${entry.label}</option>`)}`)}</label>
                <nav class="flex gap-3 text-sm">
                    <a href=${href({ filter: 'all' })} class=${this.filter === 'all' ? 'font-semibold text-foreground no-underline' : 'text-primary hover:underline'}>${__('All published')}</a>
                    <a href=${href({ filter: 'missing' })} class=${this.filter === 'missing' ? 'font-semibold text-foreground no-underline' : 'text-primary hover:underline'}>${__('Missing a description or summary')}</a>
                </nav>
            </form>
            ${component(Card, {}, component(CardBody, {}, this.rows.length ? html`<div class="space-y-5">${this.rows.map(row => html`<div class="grid gap-3 border-b border-border pb-5 last:border-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div class="min-w-0 space-y-1">
                    <a href=${`/dashboard/content/${this.collection}/${row.id}`} class="block truncate font-medium text-foreground hover:text-primary" title=${row.title}>${row.title}</a>
                    ${row.url ? html`<p class="truncate text-xs text-muted-foreground">${row.url}</p>` : null}
                    <p class="truncate text-xs text-blue-700 dark:text-blue-400" title=${__('Title in results')}>${renderSeoTemplate(this.template.title, { title: row.seoTitle || row.title, sep: this.template.sep, site: this.template.site })}</p>
                    <div class="flex items-center justify-between"><label for=${`seo-title-${row.id}`} class="text-xs font-medium text-foreground">${__('SEO title')}</label>${counter(row.seoTitle, 60)}</div>
                    ${component(Input, { id: `seo-title-${row.id}`, size: 'sm', placeholder: row.title, '.value': row.seoTitle, '@input': (event: Event) => this.set(row.id, 'seoTitle', (event.target as HTMLInputElement).value) })}
                </div>
                <div class="min-w-0 space-y-1">
                    <div class="flex items-center justify-between"><label for=${`seo-description-${row.id}`} class="text-xs font-medium text-foreground">${__('Meta description')}</label>${counter(row.description, 155)}</div>
                    ${component(Textarea, { id: `seo-description-${row.id}`, rows: 3, '.value': row.description, '@input': (event: Event) => this.set(row.id, 'description', (event.target as HTMLTextAreaElement).value) })}
                </div>
                <div class="min-w-0 space-y-1">
                    ${summary ? html`<div class="flex items-center justify-between"><label for=${`seo-summary-${row.id}`} class="text-xs font-medium text-foreground">${__('Summary')}</label>${counter(row.summary, 300)}</div>
                    ${component(Textarea, { id: `seo-summary-${row.id}`, rows: 3, '.value': row.summary, '@input': (event: Event) => this.set(row.id, 'summary', (event.target as HTMLTextAreaElement).value) })}` : null}
                </div>
                <div class="flex items-end">${component(Button, { type: 'button', size: 'sm', variant: row.saved ? 'outline' : 'default', '@click': () => this.save(row.id) }, row.saved ? __('Saved') : __('Save'))}</div>
            </div>`)}</div>` : html`<p class="text-sm text-muted-foreground">${this.filter === 'missing' ? __('Every entry has a description or a summary.') : __('No published entries.')}</p>`))}
            ${pages > 1 ? html`<nav aria-label=${__('Pages')} class="flex items-center justify-between text-sm">
                ${this.page > 1 ? html`<a href=${href({ page: this.page - 1 })} class="text-primary hover:underline">← ${__('Previous')}</a>` : html`<span></span>`}
                <span class="text-muted-foreground">${__('Page')} ${this.page} ${__('of')} ${pages}</span>
                ${this.page < pages ? html`<a href=${href({ page: this.page + 1 })} class="text-primary hover:underline">${__('Next')} →</a>` : html`<span></span>`}
            </nav>` : null}
        </div>`;
    }
}
