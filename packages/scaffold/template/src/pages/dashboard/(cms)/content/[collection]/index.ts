import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Avatar, Card, CardBody, Button, Checkbox, HoverCard, Icon, NativeSelect, Input, Pagination, AlertDialog, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { evaluateRule, isCmsError, languageName, mediaUrl, recordTitle, type EntryAction, type EntryColumn, type FieldFilter, type ListFilter, type RecordShape } from '@cossackframework/cms';
import { duplicateEntry, listExtras, routeResource, runEntryCommand, termOptions } from '../../../../../cms/content';
import type { TermOption } from '../../../../../cms/editor';
import { icon } from '../../../../../cms/icons';
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
    /** The entry's featured image, when the collection has one. */
    image: { url: string; alt: string } | null;
    /** Actions plugins add under the row. */
    actions: EntryAction[];
}

type Sort = '' | 'title' | 'date';
/** A bulk action: a built-in status change, or a plugin's. */
type BulkKey = 'trash' | 'restore' | 'delete' | 'publish' | 'draft' | `plugin:${number}`;

/**
 * Entries of one collection or resource, WordPress style: status tabs, a filter row, sortable
 * columns, checkboxes with bulk actions, and quick actions under each title. Plugins add
 * actions, bulk actions and columns through the `cms.dashboard.*` filters.
 */
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
    @State() hasImage = false;
    /** Languages to filter by, on a site with several. */
    @State() languages: { code: string; label: string }[] = [];
    @State() locale = '';
    @State() sort: Sort = '';
    @State() dir: 'asc' | 'desc' = 'desc';
    @State() selected: string[] = [];
    @State() bulk = '';
    @State() pluginBulk: EntryAction[] = [];
    @State() columns: EntryColumn[] = [];
    /** A bulk action waiting for confirmation. */
    @State() pendingBulk: { key: BulkKey; label: string; text: string } | null = null;
    /** A plugin action with a question, waiting for confirmation. */
    @State() pendingAction: { row: Row; action: EntryAction } | null = null;

    head(): HeadValue {
        return { title: this.label || 'Content' };
    }

    async init() {
        this.route = this.c.req.param('collection') ?? '';
        this.status = this.c.req.query('status') ?? 'all';
        this.search = (this.c.req.query('q') ?? '').trim().slice(0, 200);
        this.term = this.c.req.query('term') ?? '';
        this.locale = this.c.req.query('lang') ?? '';
        const sort = this.c.req.query('sort');
        this.sort = sort === 'title' || sort === 'date' ? sort : '';
        this.dir = this.c.req.query('dir') === 'asc' ? 'asc' : 'desc';
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
        // The featured image: the collection's own, or the first single media field.
        const imageField = resource.fields.featuredImage?.media ? 'featuredImage' : Object.entries(resource.fields).find(([, field]) => field.kind === 'string' && field.media)?.[0];
        this.hasImage = Boolean(imageField && cms.files);
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
                // The Date column sorts by the publication time on the Published and Scheduled tabs, by the last change elsewhere.
                const dateField = this.publishable && ['published', 'scheduled'].includes(this.status) ? 'publishedAt' : 'updatedAt';
                const order = this.sort === 'title' ? { field: resource.titleField ?? 'title', direction: this.dir } : { field: this.sort === 'date' ? dateField : 'updatedAt', direction: this.sort ? this.dir : 'desc' as const };
                const [page, total] = await Promise.all([
                    repository.list({ ...filter, limit: PAGE_SIZE, offset: (this.page - 1) * PAGE_SIZE, order }, context),
                    repository.count(filter, context),
                ]);
                records = page.records;
                this.total = total;
            }
            const owners = await cms.users.getMany(records.map(record => record.owner).filter((owner): owner is string => !!owner));
            const termIds = this.taxonomy ? records.flatMap(record => (record[this.taxonomy!.name] as string[] | undefined) ?? []) : [];
            const terms = await cms.taxonomies.getMany(termIds);
            const urls = collection ? await cms.entryUrls(collection, records) : new Map<string, string | null>();
            const images = imageField && cms.files ? await cms.files.getMany(records.map(record => record[imageField]).filter((id): id is string => typeof id === 'string' && !!id)) : new Map();
            const extras = await listExtras(cms, resource.id, records, principal);
            this.columns = extras.columns;
            this.pluginBulk = extras.bulk;
            this.rows = records.map(record => {
                const published = record.status === 'published' && typeof record.publishedAt === 'number';
                const scheduled = record.status === 'scheduled' && typeof record.publishedAt === 'number';
                const owner = record.owner ? owners.get(record.owner) : undefined;
                const image = imageField ? images.get(record[imageField] as string) : undefined;
                return {
                    id: record.id, rev: record.rev, title: recordTitle(record, resource.titleField), slug: typeof record.slug === 'string' ? record.slug : '', status: String(record.status ?? ''),
                    url: (published || !this.publishable) ? urls.get(record.id) ?? null : null,
                    author: owner?.name ?? '—', avatar: owner?.avatar ?? null, locale: typeof record.locale === 'string' ? record.locale : '',
                    terms: this.taxonomy ? ((record[this.taxonomy.name] as string[] | undefined) ?? []).map(id => terms.get(id)?.name).filter((name): name is string => !!name) : [],
                    date: shortDate(published || scheduled ? record.publishedAt : record.updatedAt),
                    dateLabel: published ? __('Published') : scheduled ? __('Scheduled for') : __('Last modified'),
                    image: image ? { url: mediaUrl(image), alt: image.alt } : null,
                    actions: extras.actions[record.id] ?? [],
                };
            });
            this.selected = this.selected.filter(id => this.rows.some(row => row.id === id));
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

    /** A draft copy of the entry, kept in this list with a link to edit it. */
    @Server()
    async duplicate(id: string) {
        this.message = '';
        this.error = '';
        try {
            const copy = await duplicateEntry(this.c.get('cms'), this.route, id, this.c.get('principal'));
            this.message = `${__('Copied as')} “${recordTitle(copy, routeResource(this.c.get('cms'), this.route).resource.titleField)}”.`;
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The entry could not be copied.');
        }
        await this.load();
    }

    /** Run a plugin's action for one entry. */
    @Server()
    async runAction(id: string, index: number) {
        this.message = '';
        this.error = '';
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        try {
            const { resource } = routeResource(cms, this.route);
            const record = await cms.resource(resource.id).get(id, { principal });
            if (!record) throw new Error('missing');
            // The action is read again from the plugins, so the client cannot name a command of its own.
            const action = (await listExtras(cms, resource.id, [record], principal)).actions[id]?.[index];
            if (!action?.command) throw new Error('missing');
            await runEntryCommand(cms, action, { resource: resource.id, id }, principal, this.c.req.raw.signal);
            this.message = `${action.label}: ${__('done.')}`;
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The action could not be run.');
        }
        await this.load();
    }

    /** Apply a bulk action to the selected entries, one by one, and report what went wrong. */
    @Server()
    async applyBulk(entries: { id: string; rev: number }[], key: BulkKey) {
        this.message = '';
        this.error = '';
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const { resource } = routeResource(cms, this.route);
        const repository = cms.resource(resource.id);
        const failures: string[] = [];
        let done = 0;
        if (key.startsWith('plugin:')) {
            const action = (await listExtras(cms, resource.id, [], principal)).bulk[Number(key.slice('plugin:'.length))];
            if (!action?.command) { this.error = __('This action is not available.'); await this.load(); return; }
            try { await runEntryCommand(cms, action, { resource: resource.id, ids: entries.map(entry => entry.id) }, principal, this.c.req.raw.signal); done = entries.length; }
            catch (error) { failures.push(isCmsError(error) ? error.message : __('The action could not be run.')); }
        } else {
            const status = ({ trash: 'trash', restore: 'draft', publish: 'published', draft: 'draft' } as Record<string, string>)[key];
            for (const entry of entries) {
                try {
                    if (key === 'delete') await repository.delete(entry.id, { principal, expectedRevision: entry.rev });
                    else await repository.update(entry.id, { status }, { principal, expectedRevision: entry.rev });
                    done++;
                } catch (error) { failures.push(isCmsError(error) ? error.message : __('An entry could not be changed.')); }
            }
        }
        const labels: Record<string, string> = { trash: __('moved to the trash.'), restore: __('restored as drafts.'), delete: __('deleted permanently.'), publish: __('published.'), draft: __('set back to draft.') };
        if (done) this.message = `${done} ${done === 1 ? this.singular.toLowerCase() : this.label.toLowerCase()} ${labels[key] ?? __('done.')}`;
        if (failures.length) this.error = [...new Set(failures)].slice(0, 3).join(' ');
        this.selected = [];
        this.bulk = '';
        await this.load();
    }

    @Client()
    async confirmDelete() {
        const row = this.pendingDelete;
        this.pendingDelete = null;
        if (row) await this.deleteEntry(row.id, row.rev);
    }

    @Client()
    toggle(id: string, checked: boolean) {
        this.selected = checked ? [...new Set([...this.selected, id])] : this.selected.filter(entry => entry !== id);
    }

    @Client()
    toggleAll(checked: boolean) {
        this.selected = checked ? this.rows.map(row => row.id) : [];
    }

    /** The bulk actions the current tab offers. */
    private bulkChoices(): { key: BulkKey; label: string; confirm?: string }[] {
        const trashed = this.status === 'trash';
        const builtin: { key: BulkKey; label: string; confirm?: string }[] = !this.publishable ? [{ key: 'delete', label: __('Delete'), confirm: __('The selected entries and their revisions will be deleted. This cannot be undone.') }]
            : trashed ? [{ key: 'restore', label: __('Restore') }, { key: 'delete', label: __('Delete permanently'), confirm: __('The selected entries and their revisions will be deleted. This cannot be undone.') }]
            : [{ key: 'publish', label: __('Publish') }, { key: 'draft', label: __('Unpublish') }, { key: 'trash', label: __('Move to trash') }];
        return [...builtin, ...this.pluginBulk.map((action, index) => ({ key: `plugin:${index}` as const, label: action.label, ...(action.confirm ? { confirm: action.confirm } : {}) }))];
    }

    @Client()
    async submitBulk() {
        const choice = this.bulkChoices().find(entry => entry.key === this.bulk);
        if (!choice || !this.selected.length) return;
        if (choice.confirm) { this.pendingBulk = { key: choice.key, label: choice.label, text: choice.confirm }; return; }
        await this.runBulk(choice.key);
    }

    @Client()
    async runBulk(key: BulkKey) {
        this.pendingBulk = null;
        const entries = this.rows.filter(row => this.selected.includes(row.id)).map(row => ({ id: row.id, rev: row.rev }));
        await this.applyBulk(entries, key);
        if (this.error) toast.error(this.error); else if (this.message) toast.success(this.message);
    }

    @Client()
    async pickAction(row: Row, action: EntryAction) {
        if (action.confirm) { this.pendingAction = { row, action }; return; }
        await this.runAction(row.id, row.actions.indexOf(action));
    }

    private href(changes: Record<string, string | number>) {
        const params = new URLSearchParams();
        const next = { status: this.status, q: this.search, term: this.term, lang: this.locale, sort: this.sort, dir: this.dir, page: this.page, ...changes };
        if (next.status && next.status !== 'all') params.set('status', String(next.status));
        if (next.q) params.set('q', String(next.q));
        if (next.term) params.set('term', String(next.term));
        if (next.lang) params.set('lang', String(next.lang));
        if (next.sort) { params.set('sort', String(next.sort)); params.set('dir', String(next.dir)); }
        if (Number(next.page) > 1) params.set('page', String(next.page));
        const query = params.toString();
        return `/dashboard/content/${this.route}${query ? `?${query}` : ''}`;
    }

    /** A column heading that sorts the list: a click sorts ascending, another turns it around. */
    private sortable(label: string, key: Sort): TemplateResult {
        const active = this.sort === key;
        const next = active && this.dir === 'asc' ? 'desc' : 'asc';
        return html`<a href=${this.href({ sort: key, dir: next, page: 1 })} class=${`inline-flex items-center gap-1 no-underline hover:text-foreground ${active ? 'text-foreground' : ''}`}
            aria-label=${`${__('Sort by')} ${label.toLowerCase()}`}>${label}
            <span class="inline-flex [&_svg]:size-3.5" aria-hidden="true">${component(Icon, { entry: icon(active ? (this.dir === 'asc' ? 'alt-arrow-up' : 'alt-arrow-down') : 'sort-vertical'), size: 14 })}</span></a>`;
    }

    /** The featured image as a small thumbnail; hovering or focusing it shows the picture. */
    private thumbnail(row: Row): TemplateResult {
        if (!row.image) return html`<span class="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground [&_svg]:size-4" aria-hidden="true">${component(Icon, { entry: icon('gallery'), size: 16 })}</span>`;
        return component(HoverCard, { id: `thumb-${row.id}`, label: row.title, side: 'right', contentProps: { class: 'w-72 p-1' },
            content: html`<img src=${row.image.url} alt=${row.image.alt} class="max-h-72 w-full rounded-md object-contain" loading="lazy">` },
            html`<a href=${`/dashboard/content/${this.route}/${row.id}`} class="block shrink-0" tabindex="0" aria-label=${`${__('Edit')} ${row.title}`}>
                <img src=${row.image.url} alt="" class="size-10 rounded-md border border-border bg-muted object-cover" loading="lazy"></a>`);
    }

    private quickActions(row: Row, base: string): TemplateResult {
        const action = 'text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer';
        const separator = html`<span aria-hidden="true" class="text-muted-foreground">|</span>`;
        const items: TemplateResult[] = row.status === 'trash' ? [
            html`<button type="button" class=${action} @click=${() => this.moveTo(row.id, row.rev, 'draft')}>${__('Restore')}</button>`,
            html`<button type="button" class=${`${action} text-destructive`} @click=${() => { this.pendingDelete = row; }}>${__('Delete permanently')}</button>`,
        ] : [
            html`<a href=${`${base}/${row.id}`} class="text-primary hover:underline">${__('Edit')}</a>`,
            ...(this.canCreate ? [html`<button type="button" class=${action} @click=${() => this.duplicate(row.id)}>${__('Duplicate')}</button>`] : []),
            this.publishable ? html`<button type="button" class=${`${action} text-destructive`} @click=${() => this.moveTo(row.id, row.rev, 'trash')}>${__('Trash')}</button>`
                : html`<button type="button" class=${`${action} text-destructive`} @click=${() => { this.pendingDelete = row; }}>${__('Delete')}</button>`,
            ...(row.url ? [html`<a href=${row.url} class="text-primary hover:underline">${__('View')}</a>`] : []),
        ];
        for (const entry of row.actions) {
            items.push(entry.href ? html`<a href=${entry.href} class=${`hover:underline ${entry.danger ? 'text-destructive' : 'text-primary'}`}>${entry.label}</a>`
                : html`<button type="button" class=${`${action} ${entry.danger ? 'text-destructive' : ''}`} @click=${() => this.pickAction(row, entry)}>${entry.label}</button>`);
        }
        return html`<div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80 group-hover:opacity-100">${items.flatMap((item, index) => index ? [separator, item] : [item])}</div>`;
    }

    render() {
        if (!this.label) return notice(this.error || __('This content type does not exist.'), 'error');
        const base = `/dashboard/content/${this.route}`;
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        const allSelected = this.rows.length > 0 && this.rows.every(row => this.selected.includes(row.id));
        const choices = this.bulkChoices();
        const th = 'px-4 py-3 font-medium';
        return html`<div class="space-y-6">
            ${pageHeader(this.label, { titleActions: this.canCreate ? linkButton(`${__('Add new')} ${this.singular.toLowerCase()}`, `${base}/new`, 'primary', { size: 'sm' }) : null })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="space-y-3">
                <nav aria-label=${__('Filter by status')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    ${this.counts.map((tab, index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                        <a href=${this.href({ status: tab.key, page: 1 })} class=${tab.key === this.status ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}
                            aria-current=${tab.key === this.status ? 'page' : 'false'}>${tab.label} <span class="text-muted-foreground">(${tab.count})</span></a>`)}
                </nav>
                <form method="get" action=${base} class="flex flex-wrap items-center gap-2" role="search">
                    ${this.status !== 'all' ? html`<input type="hidden" name="status" value=${this.status}>` : null}
                    ${this.sort ? html`<input type="hidden" name="sort" value=${this.sort}><input type="hidden" name="dir" value=${this.dir}>` : null}
                    ${this.languages.length ? html`<div class="w-44">${component(NativeSelect, { name: 'lang', size: 'sm', 'aria-label': __('Filter by language') }, html`
                        <option value="" ?selected=${!this.locale}>${__('All languages')}</option>
                        ${this.languages.map(language => html`<option value=${language.code} ?selected=${language.code === this.locale}>${language.label}</option>`)}`)}</div>` : null}
                    ${this.taxonomy ? html`<div class="w-48">${component(NativeSelect, { name: 'term', size: 'sm', 'aria-label': `${__('Filter by')} ${this.taxonomy.label}` }, html`
                        <option value="" ?selected=${!this.term}>${__('All')} ${this.taxonomy.label.toLowerCase()}</option>
                        ${this.taxonomy.terms.map(term => html`<option value=${term.id} ?selected=${term.id === this.term}>${'— '.repeat(term.depth)}${term.name}</option>`)}`)}</div>` : null}
                    <div class="w-64 max-w-full">${component(Input, { type: 'search', name: 'q', value: this.search, size: 'sm', placeholder: `${__('Search')} ${this.label.toLowerCase()}`, 'aria-label': __('Search') })}</div>
                    ${component(Button, { type: 'submit', size: 'sm', variant: 'outline', class: 'gap-1.5' }, html`${component(Icon, { entry: icon('filter'), size: 16 })}${__('Filter')}`)}
                </form>
                <div class="flex flex-wrap items-center gap-2">
                    <div class="w-44">${component(NativeSelect, { size: 'sm', 'aria-label': __('Bulk actions'), '@change': (event: Event) => { this.bulk = (event.target as HTMLSelectElement).value; } }, html`
                        <option value="" ?selected=${!this.bulk}>${__('Bulk actions')}</option>
                        ${choices.map(choice => html`<option value=${choice.key} ?selected=${this.bulk === choice.key}>${choice.label}</option>`)}`)}</div>
                    ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !this.bulk || !this.selected.length, '@click': () => this.submitBulk() }, __('Apply'))}
                    ${this.selected.length ? html`<span class="text-xs text-muted-foreground">${this.selected.length} ${__('selected')}</span>` : null}
                </div>
            </div>
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th class="w-10 px-4 py-3">${component(Checkbox, { checked: allSelected, indeterminate: !allSelected && this.selected.length > 0, 'aria-label': __('Select all'), '@change': (event: Event) => this.toggleAll((event.target as HTMLInputElement).checked) })}</th>
                            <th class=${th} aria-sort=${this.sort === 'title' ? (this.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>${this.sortable(__('Title'), 'title')}</th>
                            ${this.hasSlug ? html`<th class=${th}>${__('Slug')}</th>` : null}
                            <th class=${th}>${__('Author')}</th>
                            ${this.languages.length ? html`<th class=${th}>${__('Language')}</th>` : null}
                            ${this.taxonomy ? html`<th class=${th}>${this.taxonomy.label}</th>` : null}
                            ${this.columns.map(column => html`<th class=${th}>${column.label}</th>`)}
                            <th class=${th} aria-sort=${this.sort === 'date' ? (this.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>${this.sortable(__('Date'), 'date')}</th>
                        </tr></thead>
                        <tbody>${this.rows.map(row => html`<tr class=${`group border-b border-border last:border-0 align-top ${this.selected.includes(row.id) ? 'bg-primary/5' : ''}`} data-entry=${row.id}>
                            <td class="px-4 py-3">${component(Checkbox, { checked: this.selected.includes(row.id), 'aria-label': `${__('Select')} ${row.title}`, '@change': (event: Event) => this.toggle(row.id, (event.target as HTMLInputElement).checked) })}</td>
                            <td class="px-4 py-3">
                                <div class="flex items-start gap-3">
                                    ${this.hasImage ? this.thumbnail(row) : null}
                                    <div class="min-w-0">
                                        <a href=${`${base}/${row.id}`} class="font-medium text-foreground hover:text-primary no-underline">${row.title}</a>
                                        ${row.status && row.status !== 'published' && ['all', 'mine'].includes(this.status) ? html` <span class="text-muted-foreground">— ${statusBadge(row.status)}</span>` : null}
                                        ${this.quickActions(row, base)}
                                    </div>
                                </div>
                            </td>
                            ${this.hasSlug ? html`<td class="px-4 py-3"><code class="break-all text-xs text-muted-foreground">${row.slug}</code></td>` : null}
                            <td class="px-4 py-3 text-muted-foreground"><span class="flex items-center gap-2">
                                ${row.author !== '—' ? component(Avatar, { src: row.avatar ?? undefined, alt: row.author, size: 24 }) : null}<span>${row.author}</span></span></td>
                            ${this.languages.length ? html`<td class="px-4 py-3 text-muted-foreground"><span title=${languageName(row.locale)}>${row.locale.toUpperCase()}</span></td>` : null}
                            ${this.taxonomy ? html`<td class="px-4 py-3 text-muted-foreground">${row.terms.join(', ') || '—'}</td>` : null}
                            ${this.columns.map(column => html`<td class="px-4 py-3 text-muted-foreground">${column.values[row.id] ?? '—'}</td>`)}
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
            ${component(AlertDialog, {
                id: 'bulk-action-dialog',
                open: this.pendingBulk !== null,
                // Closed dialogs still need their labels.
                title: this.pendingBulk ? `${this.pendingBulk.label} ${this.selected.length} ${this.selected.length === 1 ? this.singular.toLowerCase() : this.label.toLowerCase()}?` : __('Apply'),
                description: this.pendingBulk?.text ?? '',
                cancelLabel: __('Cancel'),
                actionLabel: this.pendingBulk?.label || __('Apply'),
                actionVariant: this.pendingBulk?.key === 'delete' ? 'destructive' : 'primary',
                onAction: () => { if (this.pendingBulk) void this.runBulk(this.pendingBulk.key); },
                onOpenChange: () => { this.pendingBulk = null; },
            })}
            ${component(AlertDialog, {
                id: 'entry-action-dialog',
                open: this.pendingAction !== null,
                title: this.pendingAction ? `${this.pendingAction.action.label} “${this.pendingAction.row.title}”?` : __('Confirm'),
                description: this.pendingAction?.action.confirm ?? '',
                cancelLabel: __('Cancel'),
                actionLabel: this.pendingAction?.action.label || __('Confirm'),
                actionVariant: this.pendingAction?.action.danger ? 'destructive' : 'primary',
                onAction: () => { const pending = this.pendingAction; this.pendingAction = null; if (pending) void this.runAction(pending.row.id, pending.row.actions.indexOf(pending.action)); },
                onOpenChange: () => { this.pendingAction = null; },
            })}
        </div>`;
    }
}
