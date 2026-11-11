import { Cossack, Page, State, Server, Client, Ref, type RefObject, type HeadValue } from '@cossackframework/core';
import { getCookie } from 'hono/cookie';
import { bulkBar } from '../../../../../dashboard/bulk';
import { listFilters, listFooter, listTable } from '../../../../../dashboard/list-table';
import { Avatar, AvatarGroup, HoverCard, Icon, NativeSelect, AlertDialog, Tooltip, Button, Input } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { ENTRY_ACTION_IDS, entryAuthors, evaluateRule, isCmsError, languageName, mediaUrl, participantColor, recordTitle, translationGroupOf, type BuiltinEntryAction, type EntryAction, type EntryColumn, type FieldFilter, type ListFilter, type RecordShape } from '@cossackframework/cms';
import { duplicateEntry, importEntries, importItems, listExtras, routeResource, runEntryCommand, termOptions, type ImportReport } from '../../../../../cms/content';
import type { TermOption } from '../../../../../cms/editor';
import { avatarStack, type Someone } from '../../../../../cms/collab/presence';
import { icon } from '../../../../../cms/icons';
import { clampPerPage, iconButton, linkButton, notice, pageHeader, saveScreenPreferences, screenCookie, screenHelp, screenOptions, screenPreferences, shortDate, statusBadge } from '../../../../../cms/ui';
import { openMatches } from '../../../../../cms/site';

const PAGE_SIZE = 20;

/** The list's own quick actions for an entry, before plugins change them: links for Edit and View, the rest run by the list. */
function builtinActions(record: RecordShape, options: { base: string; url: string | null; canCreate: boolean; publishable: boolean }): EntryAction[] {
    const action = (id: BuiltinEntryAction, label: string, extra: Partial<EntryAction> = {}): EntryAction => ({ id, label, ...extra });
    if (record.status === 'trash') return [action('restore', __('Restore')), action('delete-permanently', __('Delete permanently'), { danger: true })];
    return [
        action('edit', __('Edit'), { href: `${options.base}/${record.id}` }),
        ...(options.canCreate ? [action('duplicate', __('Duplicate'))] : []),
        options.publishable ? action('trash', __('Trash'), { danger: true }) : action('delete', __('Delete'), { danger: true }),
        ...(options.url ? [action('view', __('View'), { href: options.url })] : []),
    ];
}

interface Row {
    id: string;
    rev: number;
    title: string;
    slug: string;
    status: string;
    url: string | null;
    /** Who wrote the entry, the main author first. */
    authors: { id: string; name: string; avatar: string | null }[];
    /** Who has the entry open in its room right now. */
    editing: Someone[];
    /** Open review notes on the entry. */
    notes: number;
    locale: string;
    /** Every site language: this entry, its translation, or none yet. */
    languages: { code: string; label: string; id: string | null; status: string }[];
    terms: string[];
    date: string;
    dateLabel: string;
    /** The entry's featured image, when the collection has one. */
    image: { url: string; alt: string; caption: string } | null;
    /** The quick actions under the row: the built-in ones as plugins left them, and theirs. */
    actions: EntryAction[];
}

type Sort = '' | 'title' | 'date';
/** A bulk action: a built-in status change, or a plugin's. */
type BulkKey = 'trash' | 'restore' | 'delete' | 'publish' | 'draft' | `plugin:${number}`;

/**
 * Entries of one collection or resource, WordPress style: status tabs, a filter row, sortable
 * columns, checkboxes with bulk actions, and quick actions under each title. Plugins add
 * actions, bulk actions and columns through the `cms.dashboard.*` filters. Screen options,
 * opened from the taskbar, hide columns and set the entries a page lists, kept per collection
 * in the browser's `cs-screen-entries-<collection>` cookie.
 */
@Page({ transport: 'http' })
export default class EntriesPage extends Cossack {
    @Ref() declare importFile: RefObject<HTMLInputElement>;
    @State() route = '';
    @State() label = '';
    @State() singular = '';
    @State() publishable = false;
    @State() canCreate = false;
    /** The last import's outcome, until the next load. */
    @State() imported: ImportReport | null = null;
    @State() importing = false;
    @State() status = 'all';
    @State() search = '';
    @State() term = '';
    @State() taxonomy: { name: string; label: string; terms: TermOption[] } | null = null;
    @State() page = 1;
    /** A search found more entries than this page shows. */
    @State() more = false;
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
    /** The language listed: one at a time on a site with several, the default first; `all` lists every entry. */
    @State() locale = '';
    @State() defaultLocale = '';
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
    /** Screen options: entries a page lists, and the optional columns hidden, by ID. */
    @State() perPage = PAGE_SIZE;
    @State() hidden: string[] = [];

    head(): HeadValue {
        return { title: this.label || 'Content' };
    }

    /** Server methods act on the collection the URL names, never on the client's state. */
    private fromRoute(): void {
        this.route = this.c.req.param('collection') ?? '';
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
        const screen = screenPreferences(getCookie(this.c, screenCookie(`entries-${this.route}`)), { hidden: [], perPage: PAGE_SIZE });
        this.perPage = screen.perPage;
        this.hidden = screen.hidden;
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
        // Screen options arrive with the client's state over RPC: keep them in bounds.
        this.perPage = clampPerPage(this.perPage, PAGE_SIZE);
        this.hidden = Array.isArray(this.hidden) ? this.hidden.filter(id => typeof id === 'string').slice(0, 50) : [];
        const languages = await cms.languages();
        this.languages = collection && languages.multilingual ? languages.all.map(code => ({ code, label: languageName(code) })) : [];
        this.defaultLocale = this.languages.length ? languages.default : '';
        if (!this.languages.length) this.locale = '';
        else if (this.locale !== 'all' && !this.languages.some(language => language.code === this.locale)) this.locale = languages.default;
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
            const language: { [field: string]: FieldFilter } = this.locale && this.locale !== 'all' ? { locale: this.locale } : {};
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
            this.more = false;
            if (this.search && Object.values(resource.fields).some(field => field.search)) {
                // Search knows no total: a page asks for one more entry to tell whether another follows.
                const offset = Math.min((this.page - 1) * this.perPage, 10_000 - this.perPage - 1);
                const found = await repository.search(this.search, { ...filter, limit: this.perPage + 1, offset }, context);
                this.more = found.length > this.perPage;
                records = openMatches(cms, resource.id, found.slice(0, this.perPage), context.principal);
                this.total = offset + records.length;
            } else {
                // The Date column sorts by the publication time on the Published and Scheduled tabs, by the last change elsewhere.
                const dateField = this.publishable && ['published', 'scheduled'].includes(this.status) ? 'publishedAt' : 'updatedAt';
                const order = this.sort === 'title' ? { field: resource.titleField ?? 'title', direction: this.dir } : { field: this.sort === 'date' ? dateField : 'updatedAt', direction: this.sort ? this.dir : 'desc' as const };
                const [page, total] = await Promise.all([
                    repository.list({ ...filter, limit: this.perPage, offset: (this.page - 1) * this.perPage, order }, context),
                    repository.count(filter, context),
                ]);
                records = page.records;
                this.total = total;
            }
            const owners = await cms.users.getMany([...new Set(records.flatMap(record => entryAuthors(record)))]);
            // Who is editing each entry now, from its room's draft row.
            const editing = await cms.drafts.editors(resource.id, records.map(record => record.id)).catch(() => new Map<string, string[]>());
            const editors = await cms.users.getMany([...new Set([...editing.values()].flat())]);
            const noteCounts = await cms.notes.counts(resource.id, records.map(record => record.id)).catch(() => new Map<string, number>());
            const termIds = this.taxonomy ? records.flatMap(record => (record[this.taxonomy!.name] as string[] | undefined) ?? []) : [];
            const terms = await cms.taxonomies.getMany(termIds);
            const urls = collection ? await cms.entryUrls(collection, records) : new Map<string, string | null>();
            const translations = collection && this.languages.length ? await cms.translationsOf(collection, records, context) : new Map<string, Map<string, RecordShape>>();
            const images = imageField && cms.files ? await cms.files.getMany(records.map(record => record[imageField]).filter((id): id is string => typeof id === 'string' && !!id)) : new Map();
            const visible = (record: RecordShape) => (record.status === 'published' && typeof record.publishedAt === 'number') || !this.publishable ? urls.get(record.id) ?? null : null;
            const base = `/dashboard/content/${this.route}`;
            const extras = await listExtras(cms, resource.id, records, principal, record => builtinActions(record, { base, url: visible(record), canCreate: this.canCreate, publishable: this.publishable }));
            this.columns = extras.columns;
            this.pluginBulk = extras.bulk;
            this.rows = records.map(record => {
                const published = record.status === 'published' && typeof record.publishedAt === 'number';
                const scheduled = record.status === 'scheduled' && typeof record.publishedAt === 'number';
                const image = imageField ? images.get(record[imageField] as string) : undefined;
                return {
                    id: record.id, rev: record.rev, title: recordTitle(record, resource.titleField), slug: typeof record.slug === 'string' ? record.slug : '', status: String(record.status ?? ''),
                    url: visible(record),
                    authors: entryAuthors(record).map(id => owners.get(id)).filter(user => user !== undefined).map(user => ({ id: user.id, name: user.name || user.email, avatar: user.avatar })), locale: typeof record.locale === 'string' ? record.locale : '',
                    editing: (editing.get(record.id) ?? []).map(id => editors.get(id)).filter(user => user !== undefined).map(user => ({ user: user.id, name: user.name || user.email, avatar: user.avatar, color: participantColor(user.id) })),
                    notes: noteCounts.get(record.id) ?? 0,
                    languages: this.languages.map(({ code, label }) => {
                        const entry = translations.get(translationGroupOf(record))?.get(code);
                        return { code, label, id: entry?.id ?? null, status: entry ? String(entry.status ?? '') : '' };
                    }),
                    terms: this.taxonomy ? ((record[this.taxonomy.name] as string[] | undefined) ?? []).map(id => terms.get(id)?.name).filter((name): name is string => !!name) : [],
                    date: shortDate(published || scheduled ? record.publishedAt : record.updatedAt),
                    dateLabel: published ? __('Published') : scheduled ? __('Scheduled for') : __('Last modified'),
                    image: image ? { url: mediaUrl(image), alt: image.alt, caption: image.caption } : null,
                    actions: extras.actions[record.id] ?? [],
                };
            });
            this.selected = this.selected.filter(id => this.rows.some(row => row.id === id));
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The entries could not be loaded.');
        }
    }

    /** Import a JSON export or list of entries chosen in the file input. */
    @Client()
    async pickImport(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        this.importing = true;
        try { await this.importJson(await file.text()); }
        finally { this.importing = false; }
        // What the import did; the entries it could not take are listed below the message.
        if (!this.error && this.imported) this.message = `${this.imported.created} ${__('created')}, ${this.imported.updated} ${__('updated')}${this.imported.failed.length ? `, ${this.imported.failed.length} ${__('failed')}` : ''}.`;
    }

    @Server()
    async importJson(text: string) {
        this.fromRoute();
        this.message = '';
        this.error = '';
        this.imported = null;
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { this.error = __('The file is not valid JSON.'); return; }
        const items = importItems(parsed);
        if (typeof items === 'string') { this.error = __(items); return; }
        try {
            this.imported = await importEntries(this.c.get('cms'), this.route, items, this.c.get('principal'));
            this.message = `${__('Imported')}: ${this.imported.created} ${__('created')}, ${this.imported.updated} ${__('updated')}.`;
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The entries could not be imported.'); return; }
        await this.load();
    }

    @Server()
    async moveTo(id: string, rev: number, status: 'trash' | 'draft') {
        this.fromRoute();
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
        this.fromRoute();
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
        this.fromRoute();
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
        this.fromRoute();
        this.message = '';
        this.error = '';
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        try {
            const { resource } = routeResource(cms, this.route);
            const record = await cms.resource(resource.id).get(id, { principal });
            if (!record) throw new Error('missing');
            // The action is read again from the plugins, so the client cannot name a command of its own.
            const action = (await listExtras(cms, resource.id, [record], principal)).actions[id]?.filter(entry => entry.command)[index];
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
        this.fromRoute();
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
    select(ids: string[]) {
        this.selected = ids;
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
    }

    /** Open an entry's translation in a language, starting it as a draft copy. */
    @Server()
    async translate(id: string, locale: string) {
        this.fromRoute();
        this.error = '';
        try {
            const translation = await this.c.get('cms').translateEntry(this.route, id, locale, this.c.get('principal'));
            return this.redirect(`/dashboard/content/${this.route}/${translation.id}`);
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The translation could not be started.'); }
    }

    /** The entry's language and its translations: a link to each, a button to start a missing one. */
    private languagesCell(row: Row): TemplateResult {
        const chip = 'inline-flex h-6 min-w-8 items-center justify-center rounded border px-1.5 text-[11px] font-medium no-underline';
        return html`<div class="flex flex-wrap gap-1" data-translations>${row.languages.map(language => {
            const code = language.code.toUpperCase();
            if (language.id === row.id) return html`<span class=${`${chip} border-primary bg-primary text-primary-foreground`} title=${`${language.label}: ${__('this entry')}`}>${code}</span>`;
            if (language.id) {
                const done = !this.publishable || language.status === 'published';
                return html`<a href=${`/dashboard/content/${this.route}/${language.id}`} data-translation=${language.code} class=${`${chip} ${done ? 'border-border text-foreground' : 'border-dashed border-border text-muted-foreground'} hover:bg-muted`}
                    title=${`${language.label}: ${language.status || __('translated')}`} aria-label=${`${__('Edit translation')}: ${language.label}`}>${code}</a>`;
            }
            return this.canCreate
                ? html`<button type="button" data-translate=${language.code} class=${`${chip} cursor-pointer border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground`}
                    title=${`${__('Translate into')} ${language.label}`} aria-label=${`${__('Translate into')} ${language.label}`} @click=${() => this.translate(row.id, language.code)}>+${code}</button>`
                : html`<span class=${`${chip} border-transparent text-muted-foreground/60`} title=${`${language.label}: ${__('not translated')}`}>${code}</span>`;
        })}</div>`;
    }

    @Client()
    async pickAction(row: Row, action: EntryAction) {
        if (action.confirm) { this.pendingAction = { row, action }; return; }
        await this.runAction(row.id, row.actions.filter(entry => entry.command).indexOf(action));
    }

    private href(changes: Record<string, string | number>) {
        const params = new URLSearchParams();
        const next = { status: this.status, q: this.search, term: this.term, lang: this.locale, sort: this.sort, dir: this.dir, page: this.page, ...changes };
        if (next.status && next.status !== 'all') params.set('status', String(next.status));
        if (next.q) params.set('q', String(next.q));
        if (next.term) params.set('term', String(next.term));
        if (next.lang && next.lang !== this.defaultLocale) params.set('lang', String(next.lang));
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

    /** The featured image as a small thumbnail; hovering or focusing it shows the picture large, with its alt text and caption. */
    private thumbnail(row: Row): TemplateResult {
        if (!row.image) return html`<span class="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground [&_svg]:size-4" aria-hidden="true">${component(Icon, { entry: icon('gallery'), size: 16 })}</span>`;
        const image = row.image;
        return component(HoverCard, { id: `thumb-${row.id}`, label: row.title, side: 'right', contentProps: { class: 'w-[36rem] max-w-[calc(100vw-4rem)] p-2' },
            content: html`<figure class="space-y-2">
                <img src=${image.url} alt=${image.alt} class="max-h-[36rem] w-full rounded-md bg-muted object-contain" loading="lazy">
                ${image.alt || image.caption ? html`<figcaption class="space-y-1 px-1 pb-1 text-xs">
                    ${image.caption ? html`<p class="text-foreground">${image.caption}</p>` : null}
                    ${image.alt ? html`<p class="text-muted-foreground"><span class="font-medium">${__('Alt text')}:</span> ${image.alt}</p>` : null}
                </figcaption>` : null}
            </figure>` },
            html`<a href=${`/dashboard/content/${this.route}/${row.id}`} class="block shrink-0" tabindex="0" aria-label=${`${__('Edit')} ${row.title}`}>
                <img src=${image.url} alt="" class="size-10 rounded-md border border-border bg-muted object-cover" loading="lazy"></a>`);
    }

    /** One author's picture, or the authors' as a group, with their names as the tooltip. */
    private authorCell(row: Row): TemplateResult {
        if (!row.authors.length) return html`<span class="text-muted-foreground">—</span>`;
        const names = row.authors.map(author => author.name).join(', ');
        const tip = `author-${row.id}-tip`;
        const pictures = row.authors.length === 1
            ? component(Avatar, { src: row.authors[0]!.avatar ?? undefined, alt: names, size: 28 })
            : component(AvatarGroup, { label: names, size: 28, max: 3, items: row.authors.map(author => ({ value: author.id, ...(author.avatar ? { src: author.avatar } : {}), alt: author.name })) });
        return component(Tooltip, { id: tip, label: names }, html`<span tabindex="0" aria-describedby=${tip} aria-label=${names} class="inline-flex rounded-full">${pictures}</span>`);
    }

    /** The bulk action select and its Apply button, above and below the table. */
    private bulkBar(position: 'top' | 'bottom'): TemplateResult {
        return bulkBar({ id: `bulk-${position}`, choices: this.bulkChoices(), value: this.bulk, count: this.selected.length, choose: key => { this.bulk = key as BulkKey; }, apply: () => this.submitBulk() });
    }

    /** Runs a built-in quick action; Edit and View are links. */
    @Client()
    runBuiltin(row: Row, id: string) {
        if (id === 'duplicate') void this.duplicate(row.id);
        else if (id === 'trash') void this.moveTo(row.id, row.rev, 'trash');
        else if (id === 'restore') void this.moveTo(row.id, row.rev, 'draft');
        else if (id === 'delete' || id === 'delete-permanently') this.pendingDelete = row;
    }

    /** The row's quick actions as words between bars; plugins change them through `cms.dashboard.entry-actions`. */
    private quickActions(row: Row): TemplateResult {
        const separator = html`<span aria-hidden="true" class="text-muted-foreground">|</span>`;
        const items = row.actions.map(entry => {
            const tone = entry.danger ? 'text-destructive' : 'text-primary';
            if (entry.href) return html`<a href=${entry.href} data-action=${entry.id ?? ''} class=${`${tone} no-underline hover:underline`}>${entry.label}</a>`;
            const builtin = !entry.command && (ENTRY_ACTION_IDS as readonly string[]).includes(entry.id ?? '');
            if (!builtin && !entry.command) return null;
            return html`<button type="button" data-action=${entry.id ?? ''} class=${`${tone} cursor-pointer border-none bg-transparent p-0 text-xs hover:underline`}
                @click=${() => builtin ? this.runBuiltin(row, entry.id!) : this.pickAction(row, entry)}>${entry.label}</button>`;
        }).filter(item => item !== null);
        return html`<div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80 group-hover:opacity-100 focus-within:opacity-100" data-quick-actions>${items.flatMap((item, index) => index ? [separator, item] : [item])}</div>`;
    }

    /** The columns Screen options can hide; the title always shows. */
    private optionalColumns(): { id: string; label: string }[] {
        return [
            ...(this.hasSlug ? [{ id: 'slug', label: __('Slug') }] : []),
            { id: 'authors', label: __('Authors') },
            ...(this.languages.length ? [{ id: 'language', label: __('Languages') }] : []),
            ...(this.taxonomy ? [{ id: 'terms', label: this.taxonomy.label }] : []),
            ...this.columns.map(column => ({ id: `plugin:${column.id}`, label: column.label })),
            { id: 'date', label: __('Date') },
        ];
    }

    /** Screen options: the columns to show and the entries a page lists, applied together. */
    private screenPanel() {
        return screenOptions(html`<form data-screen-options class="space-y-3" @submit=${(event: Event) => this.applyScreen(event)}>
            <fieldset class="space-y-1.5">
                <legend class="mb-1 font-medium text-foreground">${__('Columns')}</legend>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">${this.optionalColumns().map(column => html`<label class="flex items-center gap-2 text-foreground">
                    <input type="checkbox" name="column" value=${column.id} ?checked=${!this.hidden.includes(column.id)} class="size-4 accent-primary">${column.label}</label>`)}</div>
            </fieldset>
            <label class="flex items-center justify-between gap-3 text-foreground">${__('Number of items per page')}
                ${component(Input, { type: 'number', name: 'perPage', min: 1, max: 100, step: 1, value: String(this.perPage), required: true, size: 'sm', class: 'w-20' })}</label>
            <div class="flex justify-end">${component(Button, { type: 'submit', size: 'sm' }, __('Apply'))}</div>
        </form>`);
    }

    /** Keep the chosen Screen options in their cookie; a new page size lists the first page again. */
    @Client()
    async applyScreen(event: Event) {
        event.preventDefault();
        // A submit event's target is the form, wherever the listener sits.
        const form = new FormData(event.target as HTMLFormElement);
        const checked = new Set(form.getAll('column').map(String));
        // Columns this list does not offer now (another language setup, a plugin turned off) keep their choice.
        const offered = this.optionalColumns().map(column => column.id);
        const hidden = [...this.hidden.filter(id => !offered.includes(id)), ...offered.filter(id => !checked.has(id))];
        const perPage = clampPerPage(form.get('perPage'), this.perPage);
        saveScreenPreferences(`entries-${this.route}`, { hidden, perPage });
        document.getElementById('screen-options')?.hidePopover?.();
        this.hidden = hidden;
        if (perPage === this.perPage) return;
        this.perPage = perPage;
        this.page = 1;
        const url = new URL(window.location.href);
        if (url.searchParams.has('page')) { url.searchParams.delete('page'); window.history.replaceState(window.history.state, '', url); }
        await this.load();
    }

    render() {
        if (!this.label) return notice(this.error || __('This content type does not exist.'), 'error');
        const base = `/dashboard/content/${this.route}`;
        const totalPages = this.more ? this.page + 1 : Math.max(1, Math.ceil(this.total / this.perPage));
        const shown = (id: string) => !this.hidden.includes(id);
        const sortState = (key: Sort) => this.sort === key ? (this.dir === 'asc' ? 'ascending' as const : 'descending' as const) : 'none' as const;
        return html`<div class="space-y-6">
            ${screenHelp(html`<p>${__('The tabs above the list filter by status; the search looks through titles and content, and the filters narrow by term and language.')}</p>
                ${this.languages.length ? html`<p>${__('The list shows one language at a time. In the Languages column, the filled code is the entry; the others open its translations, and a plus starts a missing one.')}</p>` : null}
                <p>${__('Hover a row for its quick actions: edit, duplicate, view on the site, trash. Select rows to act on them together with the bulk actions.')}</p>
                <p>${__('Export JSON downloads the entries shown; Import JSON creates or updates entries from such a file.')}</p>
                <p>${__('Screen options, beside Help in the taskbar, choose the columns and how many entries a page lists.')}</p>`)}
            ${this.screenPanel()}
            ${pageHeader(this.label, {
                titleActions: this.canCreate ? linkButton(`${__('New')} ${this.singular.toLowerCase()}`, `${base}/new`, 'primary', { size: 'sm' }) : null,
                actions: html`${component(Tooltip, { id: 'export-json-tip', label: __('Export JSON') }, html`<a href=${`/api/cms/export/${this.route}`} download
                        aria-label=${__('Export JSON')} aria-describedby="export-json-tip"
                        class="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4">
                        ${component(Icon, { entry: icon('download-minimalistic'), size: 16 })}</a>`)}
                    ${this.canCreate ? html`${iconButton('import-json', 'upload-minimalistic', this.importing ? __('Importing…') : __('Import JSON'), () => this.importFile.value?.click(), { size: 'md', disabled: this.importing })}
                        <input ref=${this.importFile} type="file" accept="application/json,.json" hidden ?disabled=${this.importing} @change=${(event: Event) => this.pickImport(event)}>
                        <span class="sr-only" role="status">${this.importing ? __('Importing…') : ''}</span>` : null}`,
            })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.imported?.failed.length ? html`<div role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <p class="font-medium">${this.imported.failed.length} ${this.imported.failed.length === 1 ? __('entry was not imported.') : __('entries were not imported.')}</p>
                <ul class="mt-1 space-y-0.5 text-xs">${this.imported.failed.slice(0, 50).map(row => html`<li>#${row.index + 1}${row.id ? html` <code>${row.id}</code>` : null}: ${row.error}${row.fields ? ` ${Object.entries(row.fields).map(([name, message]) => `${name} ${message}`).join('; ')}` : ''}</li>`)}</ul>
            </div>` : null}
            <div class="space-y-3">
                <nav aria-label=${__('Filter by status')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    ${this.counts.map((tab, index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                        <a href=${this.href({ status: tab.key, page: 1 })} class=${tab.key === this.status ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}
                            aria-current=${tab.key === this.status ? 'page' : 'false'}>${tab.label} <span class="text-muted-foreground">(${tab.count})</span></a>`)}
                </nav>
                ${listFilters({ action: base, hidden: { status: this.status !== 'all' ? this.status : '', sort: this.sort ?? '', dir: this.sort ? this.dir : '' },
                    search: { name: 'q', value: this.search, placeholder: `${__('Search')} ${this.label.toLowerCase()}` },
                    filters: html`${this.languages.length ? html`<div class="w-44">${component(NativeSelect, { name: 'lang', size: 'sm', 'aria-label': __('Filter by language') }, html`
                        <option value="all" ?selected=${this.locale === 'all'}>${__('All languages')}</option>
                        ${this.languages.map(language => html`<option value=${language.code} ?selected=${language.code === this.locale}>${language.label}</option>`)}`)}</div>` : null}
                    ${this.taxonomy ? html`<div class="w-48">${component(NativeSelect, { name: 'term', size: 'sm', 'aria-label': `${__('Filter by')} ${this.taxonomy.label}` }, html`
                        <option value="" ?selected=${!this.term}>${__('All')} ${this.taxonomy.label.toLowerCase()}</option>
                        ${this.taxonomy.terms.map(term => html`<option value=${term.id} ?selected=${term.id === this.term}>${'— '.repeat(term.depth)}${term.name}</option>`)}`)}</div>` : null}` })}
                ${this.bulkBar('top')}
            </div>
            ${listTable<Row>({
                rows: this.rows, key: row => row.id, rowAttribute: 'data-entry',
                selection: { selected: this.selected, label: row => row.title, change: ids => this.select(ids) },
                columns: [
                    { label: this.sortable(__('Title'), 'title'), sort: sortState('title'), cell: row => html`<div class="flex items-start gap-3">
                        ${this.hasImage ? this.thumbnail(row) : null}
                        <div class="min-w-0">
                            <a href=${`${base}/${row.id}`} class="font-medium text-foreground hover:text-primary no-underline">${row.title}</a>
                            ${row.status && row.status !== 'published' && ['all', 'mine'].includes(this.status) ? html` <span class="text-muted-foreground">— ${statusBadge(row.status)}</span>` : null}
                            ${row.editing.length ? html` <span class="ml-1 inline-flex align-middle">${avatarStack(row.editing, { size: 16, max: 3, label: __('Editing now') })}</span>` : null}
                            ${row.notes ? html` <a href=${`${base}/${row.id}?notes=open`} class="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 align-middle text-[10px] font-medium leading-none text-amber-700 no-underline hover:bg-amber-500/20 dark:text-amber-300"
                                data-notes=${row.notes} title=${`${row.notes} ${row.notes === 1 ? __('open note') : __('open notes')}`} aria-label=${`${row.notes} ${row.notes === 1 ? __('open note on') : __('open notes on')} ${row.title}`}>${component(Icon, { entry: icon('notes'), size: 12 })}${row.notes}</a>` : null}
                            ${this.quickActions(row)}
                        </div>
                    </div>` },
                    this.hasSlug && shown('slug') && { label: __('Slug'), cell: row => html`<code class="break-all text-xs text-muted-foreground">${row.slug}</code>` },
                    shown('authors') && { label: __('Authors'), class: 'w-20', cell: row => this.authorCell(row) },
                    this.languages.length > 0 && shown('language') && { label: __('Languages'), cell: row => this.languagesCell(row) },
                    this.taxonomy && shown('terms') && { label: this.taxonomy.label, class: 'text-muted-foreground', cell: row => row.terms.join(', ') || '—' },
                    ...this.columns.filter(column => shown(`plugin:${column.id}`)).map(column => ({ label: column.label, class: 'text-muted-foreground', cell: (row: Row) => column.values[row.id] ?? '—' })),
                    shown('date') && { label: this.sortable(__('Date'), 'date'), sort: sortState('date'), class: 'text-muted-foreground', cell: row => html`<span class="block">${row.dateLabel}</span><span class="block text-xs">${row.date}</span>` },
                ],
            })}
            ${this.rows.length ? this.bulkBar('bottom') : null}
            ${listFooter({ total: this.total, page: this.page, totalPages, more: this.more, href: page => this.href({ page }) })}
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
