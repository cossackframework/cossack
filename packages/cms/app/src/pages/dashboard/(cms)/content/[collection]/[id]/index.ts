import { Cossack, Page, State, ClientState, Server, Client, OnWindow, PreventNavigation, type HeadValue } from '@cossackframework/core';
import { Button, Checkbox, Input, Modal, NativeSelect, Textarea, toast, CodeEditor } from '@cossackframework/ui';
import { html, component, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import { blockId, evaluateRule, fieldVisibility, findBlock, flattenBlocks, flattenGroupFields, formatBytes, isCmsError, languageName, mediaKind, recordSchema, recordTitle, richTextBlocks, updateBlock, type Block, type BlockCondition, type EmbeddedBlock, type JsonSchema, type MediaKind, type RecordShape, type RichTextDoc } from '@cossackframework/cms';
import { blockPanel } from '../../../../../../cms/block-panel';
import { describeBlockError } from '../../../../../../cms/block-errors';
import { styleValues, withStyle, type BlockTab, type StyleValues } from '../../../../../../cms/style-controls';
import { renderMarkdown, type CmsHost } from '@cossackframework/cms/server';
import { applyEntryJson, contentField, editorView, entryJson, entryValues, fieldErrors, mediaPreviews, parentOptions, patternBlocks, routeResource, saveEntry, termOptions, type MediaPreview, type SaveIntent } from '../../../../../../cms/content';
import { blockDefaults, controlValue, editorBlocks, editorInput, entryUrl, suggestedSlug, type EditorBlock, type EditorField, type EditorValues, type EditorView, type TermOption } from '../../../../../../cms/editor';
import { RichTextField, richTextEditors } from '../../../../../../cms/rich-text-field';
import { BlockTree } from '../../../../../../cms/block-tree';
import { bindingChoices, choicesControl, fieldControl, groupFields, multipleControl, type BindingChoice } from '../../../../../../cms/field-controls';
import { MEDIA_ACCEPT, uploadFile } from '../../../../../../cms/media-chooser';
import { FieldGroupView, plainBlocks, visibilityTypes, type RowPath } from '../../../../../../cms/field-group-view';
import { box, CONTROL, linkButton, notice, rememberTab, shortDate, STATUS_LABELS, statusBadge, tabFromQuery } from '../../../../../../cms/ui';
import { conditionControl, conditionFields } from '../../../../../../cms/condition-control';
import { notificationRulesControl } from '../../../../../../cms/notification-rules';
import { siteOrigin } from '../../../../../../cms/seo';

type MediaTarget = { field: string; block?: string; key?: string; multiple?: boolean; insert?: boolean; richText?: boolean; dialog?: boolean; group?: boolean; /** The rich text editor to insert into, when it is not the field's own. */ editor?: string;
    /** The rows the value sits in, from the top down: `key` is then a field of the innermost row. */ rows?: RowPath };
/** Field block kinds whose values read as text, as editor field kinds, for the binding picker. */
const BINDABLE_FIELD_BLOCKS: Record<string, EditorField['kind']> = { text: 'string', textarea: 'text', markdown: 'text', number: 'number', integer: 'integer', boolean: 'boolean', choice: 'enum', date: 'datetime' };

/** A block being edited in the side panel: one of a blocks field's tree, or one embedded in a rich text field. */
interface BlockDialog { field: string; id: string; type: string; values: Record<string, unknown>; errors: Record<string, string>; embedded: boolean; tab: BlockTab; style: StyleValues; /** In a form: when the block shows. */ when?: BlockCondition }

/** A translation of the entry, or a language it has none in yet. */
interface TranslationLink { code: string; label: string; id: string | null; title: string; status: string }
/** The editor's views: the fields, a form's settings, or the entry as JSON in the API's shape. */
type EditorTab = 'edit' | 'settings' | 'json';
/** The fields of a form that live on its Settings tab. */
const FORM_SETTINGS_FIELDS = new Set(['settings', 'notifications']);

/**
 * The entry editor for every collection and resource. A new entry is `/new`. The title drives
 * the slug until the slug is edited; the Publish box's status select and button set the status,
 * and a future publication time schedules the entry. Changed values are autosaved every 30
 * seconds through the autosave API, which touches no state here, and offered back when the
 * editor opens. A reload (the browser's, or the dev server's) keeps unsaved values in session
 * storage and puts them back without asking.
 */
@Page({ transport: 'http' })
export default class EntryEditor extends Cossack {
    @State() route = '';
    @State() id = 'new';
    @State() view: EditorView | null = null;
    @State() values: EditorValues = {};
    @State() rev = 0;
    @State() meta = { createdAt: 0, updatedAt: 0, author: '', url: '' as string | null };
    @State() slugTouched = false;
    @State() editingSlug = false;
    @State() errors: Record<string, string> = {};
    @State() message = '';
    @State() error = '';
    @State() saving = false;
    @State() revisions: { revision: number; at: number; actor: string }[] = [];
    @State() parents: TermOption[] = [];
    @State() references: Record<string, { id: string; title: string }[]> = {};
    @State() previews: Record<string, MediaPreview> = {};
    @State() tabs: Record<string, 'write' | 'preview'> = {};
    /** The editor's view: the fields, or the entry as JSON in the API's shape. */
    @State() mode: EditorTab = 'edit';
    @State() json = '';
    /** The entry's JSON Schema, for the JSON tab's completion and linting. */
    @State() schema: JsonSchema | null = null;
    @State() jsonDirty = false;
    @State() rendered: Record<string, string> = {};
    @State() picker: { open: boolean; target: MediaTarget | null; search: string; kind: string; items: (MediaPreview & { size: string; name: string })[] } = { open: false, target: null, search: '', kind: '', items: [] };
    @State() termDrafts: Record<string, { name: string; parent: string }> = {};
    @State() tagDrafts: Record<string, string> = {};
    @State() canManageTerms = false;
    @State() blockDialog: BlockDialog | null = null;
    /** The saved status, which the Publish button's label depends on. */
    @State() savedStatus = '';
    @State() comments = false;
    /** The active theme's templates an editor can choose for this entry, such as `entry-wide`. */
    @State() templates: string[] = [];
    @State() languages: { multilingual: boolean; options: { code: string; label: string }[] } = { multilingual: false, options: [] };
    @State() translations: TranslationLink[] = [];
    @State() seo = { origin: '', siteTitle: '', separator: '–' };
    @State() previewLink = '';
    @State() previewLinks = 0;
    /** A newer autosave than the saved entry, offered for restore. */
    @State() autosaveOffer: { at: number } | null = null;
    @State() autosavedAt = 0;
    @State() patternChoices: { id: string; title: string; synced: boolean }[] = [];
    @State() patternTitles: Record<string, string> = {};
    /** For patterns: the collections whose new entries can start from one. */
    @State() collectionChoices: { name: string; label: string }[] = [];
    @State() patternPicker: { open: boolean; field: string; starter: boolean } = { open: false, field: '', starter: false };
    /** Changes since the last autosave. */
    @ClientState() dirty = false;
    /** Changes since the last save. */
    @ClientState() unsaved = false;
    private autosaveTimer: ReturnType<typeof setInterval> | undefined;
    /** The values as last loaded, saved or autosaved, so an unchanged editor sends nothing. */
    private autosaved = '';
    private autosaving = false;

    head(): HeadValue {
        const title = this.view ? (this.id === 'new' ? `${__('New')} ${this.view.singular.toLowerCase()}` : `${__('Edit')} ${this.view.singular.toLowerCase()}`) : __('Editor');
        return { title };
    }

    async init() {
        this.route = this.c.req.param('collection') ?? '';
        this.id = this.c.req.param('id') ?? 'new';
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        try {
            const view = await editorView(cms, this.route);
            const { resource } = routeResource(cms, this.route);
            const record = this.id === 'new' ? null : await cms.resource(resource.id).get(this.id, { principal });
            if (this.id !== 'new' && !record) { this.error = __('This entry does not exist or you cannot edit it.'); this.c.status(404); return; }
            if (!record && evaluateRule(resource.access.create, principal) === 'deny') { this.error = __('You cannot create entries here.'); this.c.status(403); return; }
            this.view = view;
            this.schema = recordSchema(resource);
            this.values = await entryValues(cms, view, record);
            // A new entry starts from the collection's content template.
            const content = contentField(view);
            if (!record && content && view.template.length && !this.blocks(content).length) this.values = { ...this.values, [content]: view.template };
            if (!record && view.publishable && view.resource === 'cms/posts') {
                this.values = { ...this.values, status: await cms.settings.get('writing.defaultStatus') };
            }
            this.slugTouched = Boolean(record);
            this.canManageTerms = evaluateRule({ permission: 'cms:terms' }, principal) === 'allow';
            this.previews = await mediaPreviews(cms, this.values, view);
            if (view.hierarchical) this.parents = await parentOptions(cms, resource.id, record?.id ?? null, principal);
            for (const field of view.fields.filter(entry => entry.kind === 'reference' && entry.target !== resource.id)) {
                const page = await cms.resource(field.target).list({ limit: 100 }, { principal }).catch(() => ({ records: [] }));
                const target = cms.resourceById(field.target);
                this.references = { ...this.references, [field.name]: page.records.map(entry => ({ id: entry.id, title: recordTitle(entry, target.titleField) })) };
            }
            const collection = resource.owner === 'cms' ? cms.collection(resource.name) : null;
            this.comments = Boolean(collection?.comments);
            if (resource.fields.template) this.templates = await cms.entryTemplates();
            if (record) {
                this.rev = record.rev;
                this.savedStatus = String(record.status ?? '');
                const owner = record.owner ? await cms.users.get(record.owner) : null;
                this.meta = { createdAt: record.createdAt, updatedAt: record.updatedAt, author: owner?.name ?? '', url: collection ? (await cms.entryUrls(collection, [record])).get(record.id) ?? null : null };
                if (this.meta.url && view.publishable && record.status !== 'published') this.meta = { ...this.meta, url: null };
                await this.loadRevisions(record.id);
                if (view.path !== null || view.route === 'forms') this.previewLinks = await cms.previews.count(resource.id, record.id).catch(() => 0);
            }
            const settings = await cms.settings.all();
            this.seo = { origin: siteOrigin(this.c), siteTitle: settings['general.siteTitle'], separator: ({ dash: '–', pipe: '|', hyphen: '-', dot: '·', slash: '/', colon: ':' } as Record<string, string>)[settings['seo.titleSeparator']] ?? '–' };
            const languages = await cms.languages();
            this.languages = { multilingual: languages.multilingual, options: languages.all.map(code => ({ code, label: languageName(code) })) };
            if (collection && languages.multilingual) {
                const locale = this.c.req.query('locale');
                if (!record && locale && languages.all.includes(locale)) this.values = { ...this.values, locale };
                if (record) await this.loadTranslations(collection.name, record.id);
            }
            // Unsaved work from a closed tab or a crash.
            const autosave = await cms.latestAutosave(resource.id, this.id, principal).catch(() => null);
            if (autosave && (!record || autosave.at > record.updatedAt)) this.autosaveOffer = { at: autosave.at };
            if (!record && collection && collection.name !== 'patterns') await this.loadPatterns(collection.name, true);
            if (collection?.name === 'patterns') this.collectionChoices = cms.collections().filter(entry => entry.name !== 'patterns').map(entry => ({ name: entry.name, label: entry.label }));
            await this.loadPatternTitles();
            this.message = this.c.req.query('saved') === '1' ? __('Saved.') : '';
            this.mode = tabFromQuery(this.c.req.query('tab'), this.editorTabs());
            if (this.mode === 'json' && record) this.json = await entryJson(cms, this.route, record);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The editor could not be loaded.');
            if (isCmsError(error, 'CMS_NOT_FOUND')) this.c.status(404);
        }
    }

    private async loadRevisions(id: string) {
        const cms = this.c.get('cms');
        const resource = cms.resourceById(this.resourceId());
        const revisions = resource.revisions ? await cms.resource(resource.id).revisions(id, { principal: this.c.get('principal') }, { limit: 10 }).catch(() => []) : [];
        const actors = await cms.users.getMany(revisions.map(entry => entry.actor ?? '').filter(Boolean));
        this.revisions = revisions.map(entry => ({ revision: entry.revision, at: entry.at, actor: actors.get(entry.actor ?? '')?.name ?? entry.actor ?? '' }));
    }

    private async loadTranslations(collectionName: string, id: string) {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const record = await cms.resource(`cms/${collectionName}`).get(id, { principal });
        if (!record) return;
        const found = await cms.translations(cms.collection(collectionName), record, { principal });
        this.translations = this.languages.options.map(option => {
            const entry = found.get(option.code);
            return { code: option.code, label: option.label, id: entry?.id ?? null, title: entry ? recordTitle(entry, 'title') : '', status: String(entry?.status ?? '') };
        });
    }

    /** Titles of the synced patterns the entry's content and rich text use, for their blocks. */
    private async loadPatternTitles() {
        const ids = Object.values(this.values).flatMap(value => value && typeof value === 'object' && (value as RichTextDoc).type === 'doc'
            ? richTextBlocks(value as RichTextDoc).filter(block => block.type === 'core/pattern').map(block => String(block.data.pattern))
            : Array.isArray(value) && value.every(entry => entry && typeof entry === 'object' && 'type' in entry) ? flattenBlocks(value as Block[]).filter(block => block.type === 'core/pattern').map(block => String(block.data.pattern)) : []);
        if (!ids.length) return;
        const found = await this.c.get('cms').resource('cms/patterns').getMany(ids, { principal: this.c.get('principal') }).catch(() => new Map<string, RecordShape>());
        this.patternTitles = { ...this.patternTitles, ...Object.fromEntries([...found].map(([id, record]) => [id, recordTitle(record, 'title')])) };
    }

    /** Patterns to insert, or with `starter`, those offered as this collection's starting layouts. */
    private async loadPatterns(collectionName: string, starter: boolean) {
        const cms = this.c.get('cms');
        const page = await cms.resource('cms/patterns').list({ order: { field: 'title', direction: 'asc' }, limit: 100 }, { principal: this.c.get('principal') }).catch(() => ({ records: [] }));
        this.patternChoices = page.records.filter(record => !starter || (Array.isArray(record.starter) && record.starter.includes(collectionName)))
            .map(record => ({ id: record.id, title: recordTitle(record, 'title'), synced: record.synced !== false }));
        if (starter && this.patternChoices.length) this.patternPicker = { open: true, field: '', starter: true };
    }

    // --- Editing ---------------------------------------------------------------

    @Client()
    set(name: string, value: unknown) {
        this.values = { ...this.values, [name]: value };
        this.dirty = true;
        this.unsaved = true;
        if (this.errors[name]) this.errors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== name));
    }

    @Client()
    setTitle(value: string) {
        const title = this.view?.titleField || 'title';
        this.values = { ...this.values, [title]: value, ...(this.view?.slug && !this.slugTouched ? { slug: suggestedSlug(value) } : {}) };
        this.dirty = true;
        this.unsaved = true;
        if (this.errors[title]) this.errors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== title));
    }

    /** A field of a group, such as the SEO title. */
    @Client()
    setGroup(name: string, key: string, value: unknown) {
        this.set(name, { ...((this.values[name] as Record<string, unknown> | undefined) ?? {}), [key]: value });
    }

    /** The value of a row's field, through the rows above it. */
    private rowValue(field: string, rows: RowPath, key: string): unknown {
        let current: unknown = this.values[field];
        for (const [index, row] of rows.entries()) {
            const list = Array.isArray(current) ? current as Record<string, unknown>[] : [];
            const found = list.find(entry => entry._id === row.id);
            if (!found) return undefined;
            current = index === rows.length - 1 ? found[key] : found[rows[index + 1]!.field];
        }
        return current;
    }

    /** Set a row's field through the rows above it; the rows are copied on the way down. */
    @Client()
    setRowValue(field: string, rows: RowPath, key: string, value: unknown) {
        const update = (list: unknown, depth: number): unknown => {
            const entries = Array.isArray(list) ? list as Record<string, unknown>[] : [];
            const row = rows[depth]!;
            return entries.map(entry => entry._id !== row.id ? entry : depth === rows.length - 1 ? { ...entry, [key]: value } : { ...entry, [rows[depth + 1]!.field]: update(entry[rows[depth + 1]!.field], depth + 1) });
        };
        this.set(field, update(this.values[field], 0));
    }

    // --- Autosave ----------------------------------------------------------------

    onMount() {
        this.autosaved = this.snapshot();
        this.autosaveTimer = setInterval(() => { void this.autosaveTick(); }, 30_000);
        this.recoverDraft();
    }

    onCleanup() {
        if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    }

    /** Where unsaved values wait out a reload: one key per editor URL. */
    private draftKey(): string {
        return `cms:draft:${window.location.pathname}`;
    }

    /** Before a reload or a close, unsaved values go to session storage; a saved editor leaves nothing. */
    @OnWindow('beforeunload')
    keepDraft() {
        try {
            if (this.unsaved && this.view) window.sessionStorage.setItem(this.draftKey(), JSON.stringify({ at: Date.now(), values: this.values }));
            else window.sessionStorage.removeItem(this.draftKey());
        } catch { /* storage may be unavailable; the autosave still has the draft */ }
    }

    /** After a reload, recent unsaved values come straight back; the autosave stays as the fallback. */
    @Client()
    private recoverDraft() {
        let stored: { at?: number; values?: EditorValues } | null = null;
        try {
            const raw = window.sessionStorage.getItem(this.draftKey());
            window.sessionStorage.removeItem(this.draftKey());
            stored = raw ? JSON.parse(raw) as { at?: number; values?: EditorValues } : null;
        } catch { return; }
        if (!stored?.values || typeof stored.values !== 'object' || typeof stored.at !== 'number' || Date.now() - stored.at > 15 * 60_000) return;
        this.values = { ...this.values, ...stored.values };
        this.unsaved = true;
        this.dirty = true;
        this.autosaveOffer = null;
        this.message = __('Your unsaved changes were kept through the reload. Save to keep them.');
        void this.refreshPreviews(this.values);
    }

    /** Previews of the media the recovered values name. */
    @Server()
    async refreshPreviews(values: EditorValues) {
        const cms = this.c.get('cms');
        this.previews = await mediaPreviews(cms, values, this.view ?? await editorView(cms, this.route));
    }

    /** The values as the autosave stores them; a control that cannot be serialized counts as unchanged. */
    private snapshot(): string {
        try { return JSON.stringify(this.values); } catch { return this.autosaved; }
    }

    /**
     * Store the values when they changed since the last load, save or autosave. A plain request
     * to the autosave API, not a server method: nothing of this page's state comes back, so the
     * editor keeps its focus, selection and any keystrokes in flight.
     */
    @Client()
    async autosaveTick() {
        if (this.saving || this.autosaving || !this.view) return;
        const snapshot = this.snapshot();
        if (snapshot === this.autosaved) { this.dirty = false; return; }
        this.autosaving = true;
        try {
            const response = await fetch(`/api/cms/content/${this.route}/${this.id}/autosave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: snapshot, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`autosave ${response.status}`);
            const { at } = await response.json() as { at: number };
            this.autosaved = snapshot;
            this.dirty = false;
            this.autosavedAt = at;
        } catch (error) {
            console.warn('[cms] the draft could not be autosaved', error);
        } finally { this.autosaving = false; }
    }

    /** The resource this editor's route names, read on the server. */
    private resourceId(): string {
        return routeResource(this.c.get('cms'), this.route).resource.id;
    }

    @Server()
    async storeAutosave(values: EditorValues) {
        this.autosavedAt = await this.c.get('cms').autosave(this.resourceId(), this.id, this.c.get('principal'), values);
    }

    /** Restore the autosave; the restored values are what is stored, so the next tick sends nothing. */
    @Client()
    async restore() {
        await this.restoreAutosave();
        this.autosaved = this.snapshot();
        this.unsaved = true;
    }

    @Server()
    async restoreAutosave() {
        const cms = this.c.get('cms');
        const autosave = await cms.latestAutosave(this.resourceId(), this.id, this.c.get('principal'));
        if (autosave?.data && typeof autosave.data === 'object' && !Array.isArray(autosave.data)) {
            this.values = { ...this.values, ...(autosave.data as EditorValues) };
            this.previews = await mediaPreviews(cms, this.values, await editorView(cms, this.route));
            this.message = __('The autosave is restored. Save to keep it.');
        }
        this.autosaveOffer = null;
    }

    @Server()
    async dismissAutosave() {
        await this.c.get('cms').discardAutosave(this.resourceId(), this.id, this.c.get('principal'));
        this.autosaveOffer = null;
    }

    /** Leaving with unsaved changes asks first; they stay in the autosave either way. */
    @PreventNavigation()
    @Client()
    confirmLeave(): boolean {
        return this.unsaved && !window.confirm(__('Leave the editor? Your latest changes are not saved.'));
    }

    // --- Previews ------------------------------------------------------------------

    /** Open the preview with the current changes: they are autosaved first. */
    @Client()
    async openPreview() {
        if (!this.view || this.id === 'new') return;
        const preview = window.open('about:blank', '_blank');
        try {
            await this.storeAutosave(this.values);
            this.dirty = false;
            this.autosaved = this.snapshot();
            if (preview) preview.location.href = `/preview/${this.view.route}/${this.id}`;
        } catch { preview?.close(); toast.error(__('The preview could not be prepared.')); }
    }

    @Server()
    async createPreviewLink() {
        const cms = this.c.get('cms');
        try {
            const link = await cms.createPreviewLink(this.resourceId(), this.id, this.c.get('principal'));
            this.previewLink = `${siteOrigin(this.c)}/preview/${this.route}/${this.id}?token=${link.token}`;
            this.previewLinks = await cms.previews.count(this.resourceId(), this.id);
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The link could not be created.'); }
    }

    @Server()
    async revokePreviewLinks() {
        const cms = this.c.get('cms');
        await cms.revokePreviewLinks(this.resourceId(), this.id, this.c.get('principal'));
        this.previewLink = '';
        this.previewLinks = 0;
    }

    @Client()
    async copyPreviewLink() {
        try { await navigator.clipboard.writeText(this.previewLink); toast.success(__('Link copied.')); }
        catch { toast.error(__('Copy the link from the box.')); }
    }

    // --- Translations --------------------------------------------------------------

    /** Open the entry's translation in a language, starting it as a draft copy when there is none. */
    @Server()
    async translate(locale: string) {
        const cms = this.c.get('cms');
        try {
            const translation = await cms.translateEntry(this.route, this.id, locale, this.c.get('principal'));
            return this.redirect(`/dashboard/content/${this.route}/${translation.id}`);
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The translation could not be started.'); }
    }

    // --- Patterns ------------------------------------------------------------------

    @Client()
    async openPatterns(field: string) {
        this.patternPicker = { open: true, field, starter: false };
        await this.findPatterns();
    }

    @Server()
    async findPatterns() {
        await this.loadPatterns(this.route, false);
    }

    /** Insert a pattern: synced ones as a reference that follows the pattern, others as a copy. */
    /** Add a pattern to the content: a synced one as a Pattern block, otherwise a copy of its blocks. A starting layout replaces the content. */
    @Client()
    async insertPattern(id: string, copy: boolean) {
        const picker = this.patternPicker;
        this.patternPicker = { open: false, field: '', starter: false };
        const choice = this.patternChoices.find(entry => entry.id === id);
        const view = this.view;
        if (!choice || !view) return;
        const field = picker.starter ? contentField(view) ?? '' : picker.field;
        const content = await this.patternContent(id);
        if (!field || !content) return;
        this.patternTitles = { ...this.patternTitles, [id]: choice.title };
        const added: EditorBlock[] = choice.synced && !copy ? [{ _id: blockId(), type: 'core/pattern', data: { pattern: id } }] : editorBlocks(content as EditorBlock[], view.blocks);
        this.set(field, picker.starter ? added : [...this.blocks(field), ...added]);
    }

    @Server()
    async patternContent(id: string): Promise<Block[] | null> {
        return patternBlocks(this.c.get('cms'), id, this.c.get('principal'));
    }

    @Client()
    setSlug(value: string) {
        this.slugTouched = true;
        this.set('slug', value.toLowerCase().replace(/\s+/g, '-'));
    }

    @Client()
    toggleTerm(taxonomy: string, id: string, checked: boolean) {
        const current = (this.values[taxonomy] as string[] | undefined) ?? [];
        this.set(taxonomy, checked ? [...new Set([...current, id])] : current.filter(entry => entry !== id));
    }

    @Client()
    addTags(taxonomy: string) {
        const names = (this.tagDrafts[taxonomy] ?? '').split(',').map(name => name.trim()).filter(Boolean);
        const current = (this.values[taxonomy] as string[] | undefined) ?? [];
        const known = new Set(current.map(name => name.toLowerCase()));
        this.set(taxonomy, [...current, ...names.filter(name => !known.has(name.toLowerCase()))]);
        this.tagDrafts = { ...this.tagDrafts, [taxonomy]: '' };
    }

    @Client()
    removeTag(taxonomy: string, name: string) {
        this.set(taxonomy, ((this.values[taxonomy] as string[] | undefined) ?? []).filter(entry => entry !== name));
    }

    @Client()
    async showTab(field: string, tab: 'write' | 'preview') {
        this.tabs = { ...this.tabs, [field]: tab };
        if (tab === 'preview') await this.preview(field, String(this.values[field] ?? ''));
    }

    @Server()
    async preview(field: string, text: string) {
        this.rendered = { ...this.rendered, [field]: renderMarkdown(text.slice(0, 200_000)) };
    }

    /** Wrap the selection of a Markdown field in `before` and `after`. */
    @Client()
    format(field: string, before: string, after = '', placeholder = '') {
        const element = document.getElementById(`field-${field}`) as HTMLTextAreaElement | null;
        const text = String(this.values[field] ?? '');
        const start = element?.selectionStart ?? text.length;
        const end = element?.selectionEnd ?? text.length;
        const selected = text.slice(start, end) || placeholder;
        this.set(field, `${text.slice(0, start)}${before}${selected}${after}${text.slice(end)}`);
        requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + before.length, start + before.length + selected.length); });
    }

    // --- Blocks ----------------------------------------------------------------

    private blocks(field: string): EditorBlock[] {
        return (this.values[field] as EditorBlock[] | undefined) ?? [];
    }

    @Client()
    setBlock(field: string, id: string, key: string, value: unknown) {
        this.set(field, updateBlock(this.blocks(field), id, block => ({ ...block, data: { ...block.data, [key]: value } })));
    }

    // --- Media -----------------------------------------------------------------

    @Client()
    async openPicker(target: MediaTarget) {
        this.picker = { ...this.picker, open: true, target, kind: target.insert || target.field ? this.picker.kind : '' };
        await this.findMedia(this.picker.search, this.picker.kind);
    }

    @Client()
    closePicker() {
        this.picker = { ...this.picker, open: false, target: null };
    }

    @Server()
    async findMedia(search: string, kind: string) {
        const files = this.c.get('cms').files;
        if (!files) { this.picker = { ...this.picker, items: [] }; return; }
        const page = await files.list({ search: search.slice(0, 100), limit: 40, ...(kind ? { kind: kind as MediaKind } : {}) });
        this.picker = { ...this.picker, search, kind, items: page.items.map(file => ({ id: file.id, url: `/media/${file.id}/${encodeURIComponent(file.name)}`, title: file.title, alt: file.alt,
            contentType: file.contentType, width: file.width, height: file.height, size: formatBytes(file.size), name: file.name })) };
    }

    @Client()
    choose(file: MediaPreview) {
        const target = this.picker.target;
        if (!target) return;
        this.previews = { ...this.previews, [file.id]: file };
        if (target.richText) {
            const editor = richTextEditors.get(target.editor ?? `field-${target.field}`);
            if (mediaKind(file.contentType) === 'image') editor?.insertImage({ src: file.url, alt: file.alt || file.title, mediaId: file.id });
            else editor?.insertLink(file.title || __('Download'), file.url);
        } else if (target.group && target.key) {
            this.setGroup(target.field, target.key, file.id);
        } else if (target.rows?.length && target.key) {
            const current = this.rowValue(target.field, target.rows, target.key);
            this.setRowValue(target.field, target.rows, target.key, target.multiple ? [...new Set([...(Array.isArray(current) ? current as string[] : []), file.id])] : file.id);
        } else if (target.dialog && target.key && this.blockDialog) {
            const current = this.blockDialog.values[target.key];
            this.setDialogValue(target.key, target.multiple ? [...new Set([...(Array.isArray(current) ? current as string[] : []), file.id])] : file.id);
        } else if (target.insert) {
            const markdown = mediaKind(file.contentType) === 'image' ? `![${file.alt || file.title}](${file.url})` : `[${file.title}](${file.url})`;
            this.format(target.field, `${markdown}\n`);
        } else if (target.block !== undefined && target.key) {
            const current = findBlock(this.blocks(target.field), target.block)?.data[target.key];
            this.setBlock(target.field, target.block, target.key, target.multiple ? [...new Set([...(Array.isArray(current) ? current : []), file.id])] : file.id);
        } else {
            const current = this.values[target.field];
            this.set(target.field, target.multiple ? [...new Set([...(Array.isArray(current) ? current as string[] : []), file.id])] : file.id);
        }
        if (!target.multiple) this.closePicker();
    }

    @Client()
    async uploadInPicker(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const files = [...(input.files ?? [])];
        for (const file of files) {
            try { this.choose(await uploadFile(file)); }
            catch (error) { toast.error((error as Error).message || __('The upload failed.')); }
        }
        input.value = '';
        await this.findMedia('', this.picker.kind);
    }

    // --- Blocks in rich text ---------------------------------------------------

    @Client()
    insertRichBlock(field: string, type: string) {
        const option = this.view?.blocks.find(block => block.name === type);
        const editor = richTextEditors.get(`field-${field}`);
        if (!option || !editor) return;
        const values = blockDefaults(option);
        const block: EmbeddedBlock = { _id: blockId(), type, data: editorInput(option.fields, values).input };
        editor.insertBlock(block);
        if (option.fields.length) this.blockDialog = { field, id: block._id, type, values, errors: {}, embedded: true, tab: 'general', style: styleValues({}) };
    }

    @Client()
    editRichBlock(field: string, block: EmbeddedBlock) {
        const empty = { tab: 'general' as const, style: styleValues({}) };
        if (block.type === 'core/pattern') { this.blockDialog = { field, id: block._id, type: block.type, values: { pattern: block.data.pattern }, errors: {}, embedded: true, ...empty }; return; }
        const option = this.view?.blocks.find(entry => entry.name === block.type);
        if (!option) { toast.error(__('This block type is no longer available.')); return; }
        this.blockDialog = { field, id: block._id, type: block.type, errors: {}, embedded: true, ...empty,
            values: Object.fromEntries(option.fields.map(entry => [entry.name, controlValue(entry, block.data[entry.name] ?? entry.defaultValue)])) };
    }

    /** Open a block of a blocks field in the side panel: its settings on the General tab, its style on the Style tab. */
    @Client()
    editTreeBlock(field: string, id: string) {
        const block = findBlock(this.blocks(field), id);
        const option = this.view?.blocks.find(entry => entry.name === block?.type);
        if (block?.type === 'core/pattern') { this.blockDialog = { field, id, type: block.type, values: { pattern: block.data.pattern }, errors: {}, embedded: false, tab: 'general', style: styleValues({}) }; return; }
        if (!block || !option) return;
        this.blockDialog = { field, id, type: block.type, errors: {}, embedded: false, tab: 'general', style: styleValues(block), ...(block.when ? { when: block.when } : {}),
            values: Object.fromEntries(option.fields.filter(entry => entry.kind !== 'richtext').map(entry => [entry.name, block.data[entry.name] ?? controlValue(entry, entry.defaultValue)])) };
    }

    @Client()
    setDialogValue(name: string, value: unknown) {
        if (!this.blockDialog) return;
        this.applyBlockDialog({ ...this.blockDialog, values: { ...this.blockDialog.values, [name]: value }, errors: { ...this.blockDialog.errors, [name]: '' } });
    }

    @Client()
    setDialogStyle(style: StyleValues) {
        if (this.blockDialog) this.applyBlockDialog({ ...this.blockDialog, style });
    }

    @Client()
    setDialogCondition(when: BlockCondition | null) {
        if (!this.blockDialog) return;
        const { when: _previous, ...rest } = this.blockDialog;
        this.applyBlockDialog(when ? { ...rest, when } : rest);
    }

    @Client()
    showDialogTab(tab: BlockTab) {
        if (this.blockDialog) this.blockDialog = { ...this.blockDialog, tab };
    }

    /**
     * The panel's state goes into its block at once: an embedded block back into its rich text,
     * a tree block into its field with its style and condition. A value its field cannot take
     * stays in the panel with its message; saving checks what is required.
     */
    @Client()
    applyBlockDialog(dialog: BlockDialog) {
        const option = this.view?.blocks.find(block => block.name === dialog.type);
        if (!option) return;
        if (dialog.embedded) {
            const { input, errors } = editorInput(option.fields, dialog.values);
            this.blockDialog = { ...dialog, errors: { ...dialog.errors, ...errors } };
            richTextEditors.get(`field-${dialog.field}`)?.updateBlock(dialog.id, input);
            return;
        }
        const fields = option.fields.filter(entry => entry.kind !== 'richtext');
        const { input, errors } = editorInput(fields, dialog.values);
        this.blockDialog = { ...dialog, errors: { ...dialog.errors, ...errors } };
        // Rich text stays as it is in the tree; the panel's values replace the rest, and the condition follows the panel.
        this.set(dialog.field, updateBlock(this.blocks(dialog.field), dialog.id, block => {
            const { when: _previous, ...rest } = block;
            return withStyle({ ...rest, ...(dialog.when ? { when: dialog.when } : {}), data: { ...Object.fromEntries(Object.entries(block.data).filter(([name]) => option.fields.find(entry => entry.name === name)?.kind === 'richtext')), ...input } }, dialog.style);
        }));
    }

    /** Replace a synced pattern in the content with a copy of its blocks, which no longer follow the pattern. */
    @Client()
    async detachPattern() {
        const dialog = this.blockDialog;
        if (!dialog || dialog.embedded || !this.view) return;
        this.blockDialog = null;
        const content = await this.patternContent(String(dialog.values.pattern ?? ''));
        if (!content) return;
        const copy = editorBlocks(content as EditorBlock[], this.view.blocks);
        const replace = (blocks: EditorBlock[]): EditorBlock[] => blocks.flatMap(block => block._id === dialog.id ? copy : [block.children ? { ...block, children: replace(block.children) } : block]);
        this.set(dialog.field, replace(this.blocks(dialog.field)));
    }

    // --- Terms -----------------------------------------------------------------

    @Server()
    async addTerm(taxonomy: string, name: string, parent: string) {
        const cms = this.c.get('cms');
        try {
            const term = await cms.taxonomies.create(taxonomy, { name, parent: parent || null }, { principal: this.c.get('principal') });
            this.view = this.view ? { ...this.view, taxonomies: await Promise.all(this.view.taxonomies.map(async entry => entry.name === taxonomy ? { ...entry, terms: await termOptions(cms, taxonomy) } : entry)) } : this.view;
            this.values = { ...this.values, [taxonomy]: [...((this.values[taxonomy] as string[] | undefined) ?? []), term.id] };
            this.termDrafts = { ...this.termDrafts, [taxonomy]: { name: '', parent: '' } };
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The term could not be added.');
        }
    }

    // --- Saving ----------------------------------------------------------------

    @Client()
    async submit(intent: SaveIntent) {
        // A blank title is caught here, before the request; the server refuses it too.
        const title = this.view?.titleField ?? '';
        if (this.view?.titleRequired && intent !== 'trash' && !String(this.values[title] ?? '').trim()) {
            this.errors = { ...this.errors, [title]: __('Enter a title.') };
            toast.error(__('Enter a title before saving.'));
            document.getElementById('field-title')?.focus();
            return;
        }
        this.saving = true;
        this.error = '';
        this.message = '';
        try { await this.save(this.values, intent, this.rev); }
        finally { this.saving = false; }
        if (this.error) toast.error(this.error);
        else {
            this.dirty = false;
            this.unsaved = false;
            this.autosaved = this.snapshot();
            this.settleUrl();
            if (this.message) toast.success(this.message);
        }
    }

    /** After the first save, the address becomes the entry's, without a reload: the editor keeps its state. */
    @Client()
    private settleUrl() {
        if (this.id === 'new' || !window.location.pathname.endsWith('/new')) return;
        const url = `/dashboard/content/${this.route}/${this.id}${window.location.search}${window.location.hash}`;
        window.history.replaceState(window.history.state, '', url);
    }

    @Server()
    async save(values: EditorValues, intent: SaveIntent, rev: number) {
        const cms = this.c.get('cms');
        this.errors = {};
        try {
            const record = await saveEntry(cms, this.route, this.id === 'new' ? null : this.id, values, intent, rev, this.c.get('principal'));
            // A new entry becomes this editor's entry: the page stays, and the browser's URL follows.
            if (this.id === 'new') this.id = record.id;
            await this.refreshSaved(cms, record, intent);
        } catch (error) {
            this.errors = fieldErrors(error);
            this.error = isCmsError(error) ? error.message : __('The entry could not be saved.');
        }
    }


    /** What the editor shows after a write: the saved values, the status, the URL and the revisions. */
    private async refreshSaved(cms: CmsHost, record: RecordShape, intent: SaveIntent) {
        this.rev = record.rev;
        const view = this.view ?? await editorView(cms, this.route);
        const before = this.savedStatus;
        this.savedStatus = String(record.status ?? '');
        this.values = await entryValues(cms, view, record);
        this.previews = await mediaPreviews(cms, this.values, view);
        const collection = cms.resourceById(view.resource).owner === 'cms' ? cms.collection(cms.resourceById(view.resource).name) : null;
        const url = collection ? (await cms.entryUrls(collection, [record])).get(record.id) ?? null : null;
        this.meta = { ...this.meta, updatedAt: record.updatedAt, url: view.publishable && record.status !== 'published' ? null : url };
        this.autosaveOffer = null;
        this.message = intent === 'trash' ? __('Moved to the trash.') : intent === 'restore' ? __('Restored as a draft.')
            : record.status === 'scheduled' ? __('Scheduled.') : record.status === 'published' && before !== 'published' ? __('Published.')
            : record.status === 'pending' && before !== 'pending' ? __('Submitted for review.') : __('Saved.');
        await this.loadRevisions(record.id);
        if (this.mode === 'json' || this.json) { this.json = await entryJson(cms, this.route, record); this.jsonDirty = false; }
    }

    @Server()
    async loadJson() {
        const cms = this.c.get('cms');
        try {
            const { resource } = routeResource(cms, this.route);
            const record = await cms.resource(resource.id).get(this.id, { principal: this.c.get('principal') });
            if (!record) { this.error = __('This entry does not exist or you cannot read it.'); return; }
            this.json = await entryJson(cms, this.route, record);
            this.jsonDirty = false;
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The entry could not be loaded.');
        }
    }

    @Server()
    async applyJson(text: string, rev: number) {
        const cms = this.c.get('cms');
        this.errors = {};
        this.error = '';
        try {
            const record = await applyEntryJson(cms, this.route, this.id, text, rev, this.c.get('principal'));
            await this.refreshSaved(cms, record, 'update');
        } catch (error) {
            this.errors = fieldErrors(error);
            this.error = isCmsError(error) ? error.message : __('The entry could not be saved.');
        }
    }

    /** The tabs this entry has: a form adds Settings; JSON needs a saved entry. */
    private editorTabs(): EditorTab[] {
        return ['edit', ...(this.view?.route === 'forms' ? ['settings' as const] : []), ...(this.id !== 'new' ? ['json' as const] : [])];
    }

    @Client()
    async showMode(mode: EditorTab) {
        if (mode === this.mode) return;
        this.mode = mode;
        rememberTab(mode, this.editorTabs());
        if (mode === 'json' && !this.jsonDirty) await this.loadJson();
    }

    @Client()
    async submitJson() {
        this.saving = true;
        try { await this.applyJson(this.json, this.rev); }
        finally { this.saving = false; }
        if (this.error) toast.error(this.error);
        else { this.dirty = false; this.unsaved = false; this.autosaved = this.snapshot(); toast.success(this.message || __('Saved.')); }
    }

    private jsonPanel(): TemplateResult {
        return html`<div class="space-y-3" role="tabpanel" id="entry-json" aria-labelledby="entry-tab-json">
            <p class="text-sm text-muted-foreground">${__('The entry as the content API answers it. Fields such as id, rev and url are read-only; everything else is saved as a PATCH would be, with the same checks.')}</p>
            ${Object.keys(this.errors).length ? html`<ul role="alert" class="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">${Object.entries(this.errors).map(([name, message]) => html`<li><code class="text-xs">${name}</code> ${this.describe(message)}</li>`)}</ul>` : null}
            ${component(CodeEditor, { id: 'field-json', value: this.json, language: 'json', label: __('Entry JSON'), ...(this.schema ? { schema: this.schema } : {}), class: 'min-h-[24rem] rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
                onChange: (value: string) => { this.json = value; this.jsonDirty = true; this.dirty = true; } })}
            <div class="flex items-center gap-2">
                ${component(Button, { type: 'button', size: 'sm', disabled: this.saving || !this.jsonDirty, '@click': () => this.submitJson() }, __('Apply JSON'))}
                ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: this.saving, '@click': () => this.loadJson() }, __('Reload'))}
            </div>
        </div>`;
    }

    // --- Rendering -------------------------------------------------------------

    private errorFor(name: string): TemplateResult | null {
        return this.errors[name] ? html`<p role="alert" class="text-xs text-destructive">${this.describe(this.errors[name]!)}</p>` : null;
    }

    /** A message naming a block by its ID, said with the block's name instead. */
    private describe(message: string): string {
        const view = this.view;
        if (!view) return message;
        return describeBlockError(message, view.fields.filter(field => field.kind === 'blocks').flatMap(field => this.blocks(field.name)), view.blocks);
    }

    private mediaControl(target: MediaTarget, value: unknown, label: string): TemplateResult {
        const ids = Array.isArray(value) ? value as string[] : typeof value === 'string' && value ? [value] : [];
        const remove = (id: string) => target.group && target.key ? this.setGroup(target.field, target.key, null)
            : target.rows?.length && target.key ? this.setRowValue(target.field, target.rows, target.key, target.multiple ? ids.filter(entry => entry !== id) : null)
            : target.dialog && target.key ? this.setDialogValue(target.key, target.multiple ? ids.filter(entry => entry !== id) : null)
            : target.block !== undefined && target.key
            ? this.setBlock(target.field, target.block, target.key, target.multiple ? ids.filter(entry => entry !== id) : null)
            : this.set(target.field, target.multiple ? ids.filter(entry => entry !== id) : null);
        return html`<div class="space-y-2">
            ${ids.length ? html`<div class=${target.multiple ? 'grid grid-cols-3 gap-2' : ''}>${ids.map(id => {
                const file = this.previews[id];
                return html`<figure class="group relative overflow-hidden rounded-md border border-border bg-muted">
                    ${file && mediaKind(file.contentType) === 'image'
                        ? html`<img src=${file.url} alt=${file.alt} class="aspect-video w-full object-cover" loading="lazy">`
                        : file && mediaKind(file.contentType) === 'video' ? html`<video src=${file.url} class="aspect-video w-full bg-black" controls preload="metadata"></video>`
                        : file && mediaKind(file.contentType) === 'audio' ? html`<div class="space-y-1 p-3"><p class="truncate text-xs text-muted-foreground">${file.title || file.alt}</p><audio src=${file.url} class="w-full" controls preload="metadata"></audio></div>`
                        : html`<p class="p-3 text-xs text-muted-foreground">${file?.title ?? id}</p>`}
                    <button type="button" class="absolute right-1 top-1 rounded bg-background/90 px-2 py-0.5 text-xs text-destructive border border-border cursor-pointer"
                        @click=${() => remove(id)} aria-label=${`${__('Remove')} ${file?.title ?? ''}`}>${__('Remove')}</button>
                </figure>`;
            })}</div>` : null}
            ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.openPicker(target) },
                ids.length && !target.multiple ? `${__('Replace')} ${label.toLowerCase()}` : `${__('Choose')} ${label.toLowerCase()}`)}
        </div>`;
    }

    private control(field: EditorField, value: unknown, change: (value: unknown) => void, target: MediaTarget, id: string): TemplateResult {
        // A pattern's starting layouts: the collections, one checkbox each.
        if (this.view?.route === 'patterns' && field.name === 'starter' && target.block === undefined) {
            const chosen = Array.isArray(value) ? value.map(String) : [];
            return html`<div id=${id} class="space-y-1.5">${this.collectionChoices.map(choice => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                ${component(Checkbox, { checked: chosen.includes(choice.name), '@change': (event: Event) => change((event.target as HTMLInputElement).checked
                    ? [...new Set([...chosen, choice.name])] : chosen.filter(name => name !== choice.name)) })} ${choice.label}</label>`)}</div>`;
        }
        // A multiple field: this editor's control for the kind, once per item; a multiple choice is checkboxes and a gallery the media control.
        if (field.multiple && !field.media) {
            if (field.kind === 'enum') return choicesControl(field, value, change, id);
            return multipleControl(field, value, change, id, (item, itemChange, itemId) => this.control({ ...field, multiple: false }, item, itemChange, target, itemId));
        }
        // A group of an entry (a form's settings): its subfields with this editor's controls, media and Markdown included.
        if (field.kind === 'json' && field.fields.length && target.block === undefined && !target.group) {
            return groupFields(field, value, change, id, (sub, subValue, subChange, subId) => this.control(sub, subValue, subChange, { field: target.field, group: true, key: sub.name }, subId));
        }
        // A form's notifications: a list of emails, not JSON.
        if (this.view?.route === 'forms' && field.name === 'notifications' && target.block === undefined) {
            return notificationRulesControl(String(value ?? ''), conditionFields(this.blocks('body'), this.view.blocks), id, change);
        }
        // Blocks that name a collection or a term, such as Latest entries, choose from the site's.
        if (target.block !== undefined && field.name === 'collection' && this.view?.collections.length) {
            return component(NativeSelect, { id, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
                ${this.view.collections.map(entry => html`<option value=${entry.name} ?selected=${entry.name === value}>${entry.label}</option>`)}`);
        }
        if (target.block !== undefined && field.name === 'term' && this.view?.termChoices.length) {
            return component(NativeSelect, { id, '@change': (event: Event) => change((event.target as HTMLSelectElement).value) }, html`
                <option value="" ?selected=${!value}>${__('Every entry')}</option>
                ${this.view.termChoices.map(term => html`<option value=${term.id} ?selected=${term.id === value}>${term.taxonomy}: ${'— '.repeat(term.depth)}${term.name}</option>`)}`);
        }
        switch (field.kind) {
            // Rows outside a layout (a plugin resource's): the group view renders them with this editor's controls.
            case 'rows': return component(FieldGroupView, {
                id, blocks: [{ _id: field.name, type: 'field/repeater', data: { name: field.name, label: field.label } }], options: this.view?.blocks ?? [], fields: [field], values: { [field.name]: value },
                onChange: (_name: string, next: unknown) => change(next), hidden: new Set<string>(), control: (sub: EditorField, subValue: unknown, subChange: (value: unknown) => void, rows: RowPath, subId: string) => this.control(sub, subValue, subChange, { field: target.field, rows, key: sub.name }, subId),
            });
            case 'text': if (field.format === 'markdown' && target.block === undefined) return this.markdownControl(field, value, change, id); break;
            case 'blocks': return this.blocksControl(field);
            // Rich text inside a block, or one item of a multiple field: the word processor alone, with its own editor for the picker.
            case 'richtext': if (target.block !== undefined || id !== field.name) return component(RichTextField, {
                id, label: field.label, value: (value as RichTextDoc | null) ?? null, blocks: [], onChange: (doc: RichTextDoc) => change(doc),
                onMedia: () => this.openPicker({ field: target.field, richText: true, editor: id }), onInsertBlock: () => undefined, onEditBlock: () => undefined,
            });
            return component(RichTextField, {
                id, label: field.label, value: (value as RichTextDoc | null) ?? null,
                blocks: (this.view?.blocks ?? []).filter(block => block.name !== 'core/pattern' && !block.input && block.category !== 'data' && (!field.blocks.length || field.blocks.includes(block.name))),
                onChange: (doc: RichTextDoc) => change(doc),
                onMedia: () => this.openPicker({ field: field.name, richText: true }),
                onInsertBlock: (type: string) => this.insertRichBlock(field.name, type),
                onEditBlock: (block: EmbeddedBlock) => this.editRichBlock(field.name, block),
                patternTitles: this.patternTitles,
            });
            // Media files open this editor's picker, which knows where the chosen file goes.
            default: if (field.media && field.kind === 'string') return this.mediaControl({ ...target, multiple: field.multiple }, value, field.label);
        }
        return fieldControl(field, value, change, id, { options: this.references[field.name] ?? [], ...(target.block !== undefined && !field.media ? { bindings: this.bindings() } : {}),
            ...(target.dialog && this.blockDialog ? { language: String(this.blockDialog.values.language ?? '') } : {}) }) ?? html``;
    }

    /** The entry's fields a block's text may show (`{{ $.price }}`): the collection's and its field groups', apart from blocks and rich text. */
    private bindings(): BindingChoice[] {
        const view = this.view;
        if (!view) return [];
        const grouped = flattenGroupFields(plainBlocks(view.groups.flatMap(group => group.blocks)))
            .flatMap(block => {
                const kind = BINDABLE_FIELD_BLOCKS[block.type.replace(/^field\//, '')];
                const name = String(block.data.name ?? '');
                return kind && name ? [{ name, label: String(block.data.label ?? name), kind, media: false }] : [];
            });
        const own = view.fields.filter(field => !grouped.some(entry => entry.name === field.name));
        return bindingChoices([...own, ...grouped]);
    }

    private markdownControl(field: EditorField, value: unknown, change: (value: unknown) => void, id: string): TemplateResult {
        const tab = this.tabs[field.name] ?? 'write';
        const tool = (label: string, title: string, run: () => void) => html`<button type="button" title=${title} aria-label=${title}
            class="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground border-none bg-transparent cursor-pointer" @click=${run}>${label}</button>`;
        return html`<div class="rounded-lg border border-border bg-card">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1.5">
                <div role="tablist" aria-label=${`${field.label} ${__('editor')}`} class="flex gap-1">
                    ${(['write', 'preview'] as const).map(entry => html`<button type="button" role="tab" aria-selected=${tab === entry ? 'true' : 'false'}
                        class=${`rounded px-3 py-1 text-xs font-medium border-none cursor-pointer ${tab === entry ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                        @click=${() => this.showTab(field.name, entry)}>${entry === 'write' ? __('Write') : __('Preview')}</button>`)}
                </div>
                ${tab === 'write' ? html`<div class="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label=${__('Formatting')}>
                    ${tool('B', __('Bold'), () => this.format(field.name, '**', '**', __('bold text')))}
                    ${tool('I', __('Italic'), () => this.format(field.name, '_', '_', __('italic text')))}
                    ${tool('H2', __('Heading'), () => this.format(field.name, '\n## ', '\n', __('Heading')))}
                    ${tool('“ ”', __('Quote'), () => this.format(field.name, '\n> ', '\n', __('Quote')))}
                    ${tool('• List', __('Bulleted list'), () => this.format(field.name, '\n- ', '\n', __('Item')))}
                    ${tool('</>', __('Code'), () => this.format(field.name, '`', '`', 'code'))}
                    ${tool(__('Link'), __('Link'), () => this.format(field.name, '[', '](https://)', __('link text')))}
                    ${tool(__('Add media'), __('Add media'), () => this.openPicker({ field: field.name, insert: true }))}
                </div>` : null}
            </div>
            ${tab === 'write'
                ? html`<textarea id=${id} class="block min-h-[22rem] w-full resize-y rounded-b-lg border-0 bg-transparent p-4 font-mono text-sm leading-6 text-foreground focus:outline-none"
                    .value=${String(value ?? '')} @input=${(event: Event) => change((event.target as HTMLTextAreaElement).value)}
                    aria-describedby=${`${id}-hint`}></textarea>
                    <p id=${`${id}-hint`} class="border-t border-border px-4 py-2 text-xs text-muted-foreground">${__('Markdown: **bold**, _italic_, ## headings, - lists, [links](https://example.com).')}</p>`
                : html`<div class="cms-prose min-h-[22rem] p-4">${this.rendered[field.name] ? unsafeHTML(this.rendered[field.name]!) : html`<p class="text-muted-foreground">${__('Nothing to preview.')}</p>`}</div>`}
        </div>`;
    }

    private blocksControl(field: EditorField): TemplateResult {
        return html`<div class="space-y-3">
            ${component(BlockTree, {
                // Every block opens in the panel; in a form, with its conditional logic.
                id: `field-${field.name}`, blocks: this.blocks(field.name), options: this.view?.blocks ?? [], allowed: field.blocks, form: field.form, error: this.errors[field.name] ?? '',
                onEdit: (id: string) => this.editTreeBlock(field.name, id), lock: this.view?.templateLock,
                // Patterns go into the content; not into forms, and not into patterns.
                ...(field.form || this.view?.route === 'patterns' ? {} : { onPatterns: () => this.openPatterns(field.name) }),
                onChange: (blocks: EditorBlock[]) => this.set(field.name, blocks),
                control: (entry: EditorField, value: unknown, change: (value: unknown) => void, block: EditorBlock, id: string) => this.control(entry, value, change, { field: field.name, block: block._id, key: entry.name }, id),
            })}
            ${this.errorFor(field.name)}
        </div>`;
    }

    private fieldRow(field: EditorField): TemplateResult {
        const id = `field-${field.name}`;
        const value = this.values[field.name];
        return html`<div class="space-y-1.5">
            ${field.kind === 'boolean' ? null : html`<label for=${id} class="block text-sm font-medium text-foreground">${field.label}${field.required ? html`<span class="text-destructive"> *</span>` : null}</label>`}
            ${this.control(field, value, entry => this.set(field.name, entry), { field: field.name }, id)}
            ${field.description && !(field.kind === 'text' && field.format === 'markdown') ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : null}
            ${field.kind === 'blocks' ? null : this.errorFor(field.name)}
        </div>`;
    }

    private publishBox(view: EditorView): TemplateResult {
        const status = String(this.values.status ?? 'draft');
        const isNew = this.id === 'new';
        const live = this.savedStatus === 'published' || this.savedStatus === 'scheduled';
        const at = typeof this.values.publishedAt === 'string' && this.values.publishedAt ? Date.parse(`${this.values.publishedAt}Z`) : NaN;
        const future = Number.isFinite(at) && at > Date.now();
        const button = (label: string, intent: SaveIntent, variant: 'default' | 'outline' = 'default') =>
            component(Button, { type: 'button', variant, size: 'sm', disabled: this.saving, '@click': () => this.submit(intent) }, label);
        const primary = !view.publishable ? button(isNew ? __('Save') : __('Update'), 'update')
            : status === 'trash' ? button(__('Restore'), 'restore')
            : live && (status === 'published' || status === 'scheduled') ? button(future ? __('Update schedule') : __('Update'), 'update')
            : status === 'published' || status === 'scheduled' ? button(future ? __('Schedule') : __('Publish'), 'update')
            : status === 'pending' ? button(__('Submit for review'), 'update')
            : button(__('Save draft'), 'update');
        const selectable = ['draft', 'pending', 'published'] as const;
        return box(view.publishable ? __('Publish') : __('Save'), html`
            ${view.publishable && status !== 'trash' ? html`<div class="space-y-1">
                <label for="field-status" class="block text-xs font-medium text-foreground">${__('Status')}</label>
                ${component(NativeSelect, { id: 'field-status', size: 'sm', '@change': (event: Event) => this.set('status', (event.target as HTMLSelectElement).value) }, html`
                    ${selectable.map(value => html`<option value=${value} ?selected=${(status === 'scheduled' ? 'published' : status) === value}>${value === 'published' && future ? __('Scheduled') : __(STATUS_LABELS[value])}</option>`)}`)}
            </div>` : view.publishable ? html`<p class="flex items-center gap-2 text-sm text-muted-foreground">${__('Status')}: ${statusBadge(status)}</p>` : null}
            ${view.publishable ? html`<div class="space-y-1">
                <label for="field-publishedAt" class="block text-xs font-medium text-foreground">${live && !future ? __('Published on (UTC)') : __('Publish on (UTC)')}</label>
                ${component(Input, { id: 'field-publishedAt', type: 'datetime-local', size: 'sm', '.value': String(this.values.publishedAt ?? ''), '@input': (event: Event) => this.set('publishedAt', (event.target as HTMLInputElement).value) })}
                <p class="text-xs text-muted-foreground">${future && (status === 'published' || status === 'scheduled') ? __('Goes live at this time.') : __('Leave empty to publish immediately.')}</p>
                ${this.errorFor('publishedAt')}
            </div>` : null}
            ${!isNew && (view.path !== null || view.route === 'forms') ? html`<div class="space-y-2 border-t border-border pt-3">
                <div class="flex flex-wrap items-center gap-2">
                    ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.openPreview() }, __('Preview'))}
                    ${status !== 'published' ? component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => this.createPreviewLink() }, __('Get preview link')) : null}
                </div>
                ${this.previewLink ? html`<div class="flex gap-1"><input readonly aria-label=${__('Preview link')} class=${`${CONTROL} py-1 text-xs`} .value=${this.previewLink}
                    @focus=${(event: Event) => (event.target as HTMLInputElement).select()}>${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.copyPreviewLink() }, __('Copy'))}</div>
                    <p class="text-xs text-muted-foreground">${__('Anyone with the link can see this entry for 7 days.')}</p>` : null}
                ${this.previewLinks ? html`<p class="text-xs text-muted-foreground">${this.previewLinks} ${this.previewLinks === 1 ? __('preview link is active.') : __('preview links are active.')}
                    <button type="button" class="text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.revokePreviewLinks()}>${__('Revoke')}</button></p>` : null}
            </div>` : null}
            ${isNew ? null : html`<dl class="space-y-0.5 text-xs text-muted-foreground">
                ${this.meta.author ? html`<div>${__('Author')}: <span class="text-foreground">${this.meta.author}</span></div>` : null}
                <div>${__('Last modified')}: ${shortDate(this.meta.updatedAt)}</div>
                <div>${__('Revision')} #${this.rev}</div>
            </dl>`}
            ${this.autosavedAt ? html`<p class="text-xs text-muted-foreground" aria-live="polite">${__('Draft autosaved at')} ${shortDate(this.autosavedAt)}</p>` : null}
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                ${view.publishable && !isNew && status !== 'trash'
                    ? html`<button type="button" class="text-sm text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.submit('trash')}>${__('Move to trash')}</button>`
                    : html`<span></span>`}
                <span class="flex flex-wrap gap-2">${primary}</span>
            </div>`, { id: 'publish-box' });
    }

    /** Search title, description and image, with a preview of the search result. */
    private seoBox(): TemplateResult {
        const seo = (this.values.seo as Record<string, unknown> | undefined) ?? {};
        const title = String(seo.title ?? '') || String(this.values.title ?? '');
        const description = String(seo.description ?? '');
        const url = `${this.seo.origin}${this.meta.url ?? (this.view?.path !== null ? entryUrl(this.view?.path, [String(this.values.slug ?? '') || 'slug']) ?? '' : '')}`;
        const counter = (text: string, ideal: number) => html`<span class=${`text-xs ${[...text].length > ideal ? 'text-amber-600' : 'text-muted-foreground'}`}>${[...text].length} / ${ideal}</span>`;
        const text = (key: string, label: string, ideal: number, multiline = false) => html`<div class="space-y-1">
            <div class="flex items-center justify-between"><label for=${`seo-${key}`} class="block text-sm font-medium text-foreground">${label}</label>${counter(String(seo[key] ?? ''), ideal)}</div>
            ${multiline ? component(Textarea, { id: `seo-${key}`, rows: 3, '.value': String(seo[key] ?? ''), '@input': (event: Event) => this.setGroup('seo', key, (event.target as HTMLTextAreaElement).value) })
                : component(Input, { id: `seo-${key}`, '.value': String(seo[key] ?? ''), '@input': (event: Event) => this.setGroup('seo', key, (event.target as HTMLInputElement).value) })}
        </div>`;
        return html`<section aria-labelledby="seo-title-heading" class="space-y-4 rounded-lg border border-border bg-card p-4">
            <h2 id="seo-title-heading" class="text-sm font-semibold text-foreground">${__('Search and sharing')}</h2>
            <div class="rounded-md border border-border bg-background p-3" aria-label=${__('Search result preview')}>
                <p class="truncate text-xs text-emerald-700 dark:text-emerald-400">${url}</p>
                <p class="truncate text-base text-blue-700 dark:text-blue-400">${title || __('Add a title')} ${this.seo.separator} ${this.seo.siteTitle}</p>
                <p class="line-clamp-2 text-sm text-muted-foreground">${description || String(this.values.excerpt ?? '') || __('Search engines show a part of the content when there is no description.')}</p>
            </div>
            ${text('title', __('SEO title'), 60)}
            ${text('description', __('Meta description'), 155, true)}
            <div class="space-y-1"><span class="block text-sm font-medium text-foreground">${__('Social image')}</span>
                ${this.mediaControl({ field: 'seo', key: 'image', group: true }, seo.image ?? null, __('Image'))}
                <p class="text-xs text-muted-foreground">${__('Shown when the entry is shared. Defaults to the featured image.')}</p></div>
            <div class="space-y-1"><label for="seo-canonical" class="block text-sm font-medium text-foreground">${__('Canonical URL')}</label>
                ${component(Input, { id: 'seo-canonical', placeholder: url, '.value': String(seo.canonical ?? ''), '@input': (event: Event) => this.setGroup('seo', 'canonical', (event.target as HTMLInputElement).value) })}
                <p class="text-xs text-muted-foreground">${__('Only when this content first appeared at another address.')}</p></div>
            <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                ${component(Checkbox, { checked: seo.noindex === true, '@change': (event: Event) => this.setGroup('seo', 'noindex', (event.target as HTMLInputElement).checked) })} ${__('Hide from search engines')}</label>
            ${this.errorFor('seo')}
        </section>`;
    }

    /** The entry's language and its translations. */
    private languagesBox(view: EditorView): TemplateResult {
        const current = String(this.values.locale ?? '');
        return box(__('Languages'), html`
            ${this.id === 'new' ? html`<div class="space-y-1">
                <label for="field-locale" class="block text-xs font-medium text-foreground">${__('Language')}</label>
                ${component(NativeSelect, { id: 'field-locale', size: 'sm', '@change': (event: Event) => this.set('locale', (event.target as HTMLSelectElement).value) }, html`
                    ${this.languages.options.map(option => html`<option value=${option.code} ?selected=${option.code === current}>${option.label}</option>`)}`)}
            </div>` : html`<p class="text-sm text-foreground">${__('Language')}: <strong>${this.languages.options.find(option => option.code === current)?.label ?? current}</strong></p>
                <ul class="space-y-1.5 text-sm">${this.translations.filter(entry => entry.code !== current).map(entry => html`<li class="flex items-center justify-between gap-2">
                    <span class="text-muted-foreground">${entry.label}</span>
                    ${entry.id ? html`<a href=${`/dashboard/content/${view.route}/${entry.id}`} class="truncate text-primary hover:underline" title=${entry.title}>${__('Edit')}${entry.status && entry.status !== 'published' ? ` (${__(STATUS_LABELS[entry.status] ?? entry.status)})` : ''}</a>`
                        : html`<button type="button" class="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.translate(entry.code)}>+ ${__('Translate')}</button>`}
                </li>`)}</ul>`}`);
    }

    private taxonomyBox(taxonomy: EditorView['taxonomies'][number]): TemplateResult {
        const selected = (this.values[taxonomy.name] as string[] | undefined) ?? [];
        if (!taxonomy.hierarchical) {
            const suggestions = taxonomy.terms.filter(term => !selected.some(name => name.toLowerCase() === term.name.toLowerCase())).slice(0, 12);
            return box(taxonomy.label, html`
                <div class="flex gap-2">
                    <input id=${`tags-${taxonomy.name}`} class=${CONTROL} list=${`tags-${taxonomy.name}-list`} placeholder=${__('Separate with commas')}
                        .value=${this.tagDrafts[taxonomy.name] ?? ''} aria-label=${`${__('Add')} ${taxonomy.label.toLowerCase()}`}
                        @input=${(event: Event) => { this.tagDrafts = { ...this.tagDrafts, [taxonomy.name]: (event.target as HTMLInputElement).value }; }}
                        @keydown=${(event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); this.addTags(taxonomy.name); } }}>
                    ${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.addTags(taxonomy.name) }, __('Add'))}
                </div>
                <datalist id=${`tags-${taxonomy.name}-list`}>${taxonomy.terms.map(term => html`<option value=${term.name}></option>`)}</datalist>
                ${selected.length ? html`<ul class="flex flex-wrap gap-1.5">${selected.map(name => html`<li class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground">
                    ${name}<button type="button" class="text-muted-foreground hover:text-destructive bg-transparent border-none cursor-pointer" aria-label=${`${__('Remove')} ${name}`} @click=${() => this.removeTag(taxonomy.name, name)}>×</button></li>`)}</ul>` : null}
                ${suggestions.length ? html`<p class="text-xs text-muted-foreground">${__('Choose from')}: ${suggestions.map((term, index) => html`${index ? ', ' : ''}<button type="button" class="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                    @click=${() => this.set(taxonomy.name, [...selected, term.name])}>${term.name}</button>`)}</p>` : null}
                ${this.errorFor(taxonomy.name)}`);
        }
        const draft = this.termDrafts[taxonomy.name] ?? { name: '', parent: '' };
        return box(taxonomy.label, html`
            <div class="max-h-56 space-y-1 overflow-y-auto">
                ${taxonomy.terms.length ? taxonomy.terms.map(term => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer" style=${`padding-left: ${term.depth * 1.25}rem`}>
                    ${component(Checkbox, { checked: selected.includes(term.id), '@change': (event: Event) => this.toggleTerm(taxonomy.name, term.id, (event.target as HTMLInputElement).checked) })} ${term.name}</label>`)
                    : html`<p class="text-xs text-muted-foreground">${__('None yet.')}</p>`}
            </div>
            ${this.canManageTerms ? html`<details class="text-sm">
                <summary class="cursor-pointer text-primary">+ ${__('New')} ${taxonomy.singular.toLowerCase()}</summary>
                <div class="mt-2 space-y-2">
                    <input class=${CONTROL} aria-label=${`${__('New')} ${taxonomy.singular.toLowerCase()}`} .value=${draft.name}
                        @input=${(event: Event) => { this.termDrafts = { ...this.termDrafts, [taxonomy.name]: { ...draft, name: (event.target as HTMLInputElement).value } }; }}>
                    <select class=${CONTROL} aria-label=${__('Parent')} @change=${(event: Event) => { this.termDrafts = { ...this.termDrafts, [taxonomy.name]: { ...draft, parent: (event.target as HTMLSelectElement).value } }; }}>
                        <option value="">— ${__('Parent')} —</option>
                        ${taxonomy.terms.map(term => html`<option value=${term.id} ?selected=${draft.parent === term.id}>${'— '.repeat(term.depth)}${term.name}</option>`)}
                    </select>
                    ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !draft.name.trim(), '@click': () => this.addTerm(taxonomy.name, draft.name, draft.parent) }, `${__('New')} ${taxonomy.singular.toLowerCase()}`)}
                </div>
            </details>` : null}
            ${this.errorFor(taxonomy.name)}`);
    }

    private pickerModal(): TemplateResult {
        const target = this.picker.target;
        return component(Modal, { open: this.picker.open, size: 'max-w-4xl', 'aria-label': __('Media library'), onOpenChange: (open: boolean) => { if (!open) this.closePicker(); } }, html`
            <div class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                    <h2 class="text-lg font-semibold text-foreground">${target?.insert ? __('Add media') : __('Choose media')}</h2>
                    ${component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': () => this.closePicker() }, __('Close'))}
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <input type="search" class=${`${CONTROL} max-w-xs`} placeholder=${__('Search media')} aria-label=${__('Search media')} .value=${this.picker.search}
                        @change=${(event: Event) => this.findMedia((event.target as HTMLInputElement).value, this.picker.kind)}>
                    <select class=${`${CONTROL} max-w-[10rem]`} aria-label=${__('Media type')} @change=${(event: Event) => this.findMedia(this.picker.search, (event.target as HTMLSelectElement).value)}>
                        ${[['', __('All media')], ['image', __('Images')], ['video', __('Video')], ['audio', __('Audio')], ['document', __('Documents')]].map(([value, label]) => html`<option value=${value} ?selected=${this.picker.kind === value}>${label}</option>`)}
                    </select>
                    <label class="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
                        ${__('Upload files')}<input type="file" multiple accept=${this.picker.kind === 'image' ? 'image/*' : MEDIA_ACCEPT} class="sr-only" @change=${(event: Event) => this.uploadInPicker(event)}>
                    </label>
                </div>
                <ul class="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
                    ${this.picker.items.map(file => html`<li>
                        <button type="button" class="w-full overflow-hidden rounded-md border border-border bg-muted text-left hover:ring-2 hover:ring-ring cursor-pointer p-0" @click=${() => this.choose(file)}>
                            ${mediaKind(file.contentType) === 'image' ? html`<img src=${file.url} alt=${file.alt} class="aspect-square w-full object-cover" loading="lazy">`
                                : html`<span class="flex aspect-square items-center justify-center p-2 text-xs text-muted-foreground">${file.name}</span>`}
                            <span class="block truncate bg-card px-2 py-1 text-xs text-foreground">${file.title || file.name} · ${file.size}</span>
                        </button>
                    </li>`)}
                </ul>
                ${this.picker.items.length ? null : html`<p class="text-sm text-muted-foreground">${__('No media found. Upload files to add them.')}</p>`}
            </div>`);
    }

    /** Patterns to insert, or a new entry's starting layouts. */
    private patternModal(): TemplateResult {
        const picker = this.patternPicker;
        const close = () => { this.patternPicker = { open: false, field: '', starter: false }; };
        return component(Modal, { open: picker.open, size: 'max-w-2xl', 'aria-label': __('Patterns'), onOpenChange: (open: boolean) => { if (!open) close(); } }, html`
            <div class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                    <h2 class="text-lg font-semibold text-foreground">${picker.starter ? __('Start from a pattern') : __('Insert a pattern')}</h2>
                    ${component(Button, { type: 'button', variant: 'ghost', size: 'sm', '@click': close }, picker.starter ? __('Start blank') : __('Close'))}
                </div>
                ${this.patternChoices.length ? html`<ul class="divide-y divide-border rounded-md border border-border">${this.patternChoices.map(choice => html`<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span class="min-w-0"><span class="block truncate text-sm font-medium text-foreground">${choice.title}</span>
                        <span class="text-xs text-muted-foreground">${choice.synced ? __('Synced: edits to the pattern show here too') : __('Inserted as a copy')}</span></span>
                    <span class="flex gap-2">
                        ${component(Button, { type: 'button', size: 'sm', '@click': () => this.insertPattern(choice.id, false) }, picker.starter ? __('Use') : __('Insert'))}
                        ${choice.synced ? component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.insertPattern(choice.id, true) }, __('Insert a copy')) : null}
                    </span></li>`)}</ul>`
                    : html`<p class="text-sm text-muted-foreground">${__('No patterns yet.')} <a href="/dashboard/content/patterns/new" class="text-primary hover:underline">${__('Create a pattern')}</a></p>`}
            </div>`);
    }

    private blockDialogModal(): TemplateResult | null {
        const dialog = this.blockDialog;
        if (dialog?.type === 'core/pattern') {
            const id = String(dialog.values.pattern ?? '');
            return component(Modal, { open: true, size: 'max-w-lg', 'aria-label': __('Synced pattern'), onOpenChange: (open: boolean) => { if (!open) this.blockDialog = null; } }, html`
                <div class="space-y-4">
                    <h2 class="text-lg font-semibold text-foreground">${this.patternTitles[id] ?? __('Synced pattern')}</h2>
                    <p class="text-sm text-muted-foreground">${__('This pattern shows its current content wherever it is used. Edit the pattern to change it everywhere, or detach it to change it only here.')}</p>
                    <div class="flex flex-wrap justify-end gap-2">
                        <a href=${`/dashboard/content/patterns/${id}`} target="_blank" rel="noopener" class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm text-foreground no-underline hover:bg-muted">${__('Edit pattern')} ↗</a>
                        ${dialog.embedded ? null : component(Button, { type: 'button', variant: 'outline', '@click': () => this.detachPattern() }, __('Detach'))}
                        ${component(Button, { type: 'button', '@click': () => { this.blockDialog = null; } }, __('Done'))}
                    </div>
                </div>`);
        }
        const option = this.view?.blocks.find(block => block.name === dialog?.type) ?? null;
        const fields = dialog && option ? option.fields.filter(entry => dialog.embedded || entry.kind !== 'richtext') : [];
        return blockPanel({
            id: 'entry-block', open: Boolean(dialog && option), option, tab: dialog?.tab ?? 'general', style: dialog?.style ?? styleValues({}), presets: this.view?.presets ?? { colors: [], fontSizes: [], spacing: [] },
            styleTab: dialog ? !dialog.embedded : false,
            onTab: tab => this.showDialogTab(tab), onStyle: style => this.setDialogStyle(style), onClose: () => { this.blockDialog = null; },
            general: dialog && option ? html`${fields.length ? fields.map(entry => {
                const id = `block-${dialog.id}-${entry.name}`;
                return html`<div class="space-y-1">
                    ${entry.kind === 'boolean' ? null : html`<label for=${id} class="block text-sm font-medium text-foreground">${entry.label}${entry.required ? ' *' : ''}</label>`}
                    ${this.control(entry, dialog.values[entry.name], value => this.setDialogValue(entry.name, value), { field: dialog.field, key: entry.name, dialog: true }, id)}
                    ${entry.description ? html`<p class="text-xs text-muted-foreground">${entry.description}</p>` : null}
                    ${dialog.errors[entry.name] ? html`<p role="alert" class="text-xs text-destructive">${entry.label} ${dialog.errors[entry.name]}</p>` : null}
                </div>`;
            }) : html`<p class="text-sm text-muted-foreground">${__('This block has no settings.')}</p>`}
            ${!dialog.embedded && this.view?.fields.find(entry => entry.name === dialog.field)?.form
                ? conditionControl(dialog.when, conditionFields(this.blocks(dialog.field), this.view.blocks, dialog.id), `block-${dialog.id}`, when => this.setDialogCondition(when ?? null))
                : null}` : html``,
        });
    }

    /** The theme template for this entry, when the active theme offers more than its default. */
    templateBox(): TemplateResult | null {
        const current = String(this.values.template ?? '');
        if (!this.templates.length && !current) return null;
        // A template the active theme no longer has stays listed, so saving keeps it.
        const choices = current && !this.templates.includes(current) ? [...this.templates, current] : this.templates;
        const label = (name: string) => name.slice('entry-'.length).replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
        return box(__('Template'), html`<div class="space-y-1">
            <label for="field-template" class="sr-only">${__('Template')}</label>
            <select id="field-template" class=${CONTROL} @change=${(event: Event) => this.set('template', (event.target as HTMLSelectElement).value)}>
                <option value="" ?selected=${!current}>${__('Default template')}</option>
                ${choices.map(name => html`<option value=${name} ?selected=${name === current}>${label(name)}${this.templates.includes(name) ? '' : ` (${__('not in the active theme')})`}</option>`)}
            </select>
            ${this.errorFor('template')}
        </div>`);
    }

    render() {
        const view = this.view;
        if (!view) return html`<div class="space-y-4">${notice(this.error || __('Loading…'), this.error ? 'error' : 'info')}${linkButton(__('Back'), `/dashboard/content/${this.route}`, 'outline')}</div>`;
        const titleField = view.titleField;
        // Fields the groups place; the rest keep their declared place.
        const groupBlocks = view.groups.flatMap(group => group.blocks);
        const laidOut = new Set(flattenGroupFields(plainBlocks(groupBlocks)).map(block => String(block.data.name ?? '')));
        // A form's settings and notifications have their own tab.
        const onSettingsTab = (field: EditorField) => view.route === 'forms' && FORM_SETTINGS_FIELDS.has(field.name);
        const main = view.fields.filter(field => field.placement === 'main' && !laidOut.has(field.name) && !onSettingsTab(field));
        const sidebar = view.fields.filter(field => field.placement === 'sidebar' && !laidOut.has(field.name));
        const settingsFields = view.fields.filter(onSettingsTab);
        const tabs = this.editorTabs();
        const tabLabels: Record<EditorTab, string> = { edit: view.route === 'forms' ? __('Form') : __('Edit'), settings: __('Settings'), json: 'JSON' };
        const hidden = fieldVisibility(plainBlocks(groupBlocks), visibilityTypes(view.blocks), this.values).hidden;
        const groupView = (id: string, blocks: EditorBlock[]) => component(FieldGroupView, {
            id, blocks, options: view.blocks, fields: view.fields, values: this.values, hidden, errors: this.errors,
            onChange: (name: string, value: unknown) => this.set(name, value),
            control: (field: EditorField, value: unknown, change: (value: unknown) => void, rows: RowPath, controlId: string) =>
                this.control(field, value, change, rows.length ? { field: rows[0]!.field, rows, key: field.name } : { field: field.name }, controlId),
        });
        const groupBox = (group: EditorView['groups'][number]) => box(group.title, html`${group.description ? html`<p class="text-xs text-muted-foreground">${group.description}</p>` : null}${groupView(`group-${group.id}`, group.blocks)}`, { id: `group-${group.id}-title` });
        const base = `/dashboard/content/${view.route}`;
        // Forms have no URL: their slug names them where the Form block places them.
        const form = view.route === 'forms';
        const permalink = view.slug ? form ? String(this.values.slug ?? '') || '…' : entryUrl(view.path, [String(this.values.slug ?? '') || '…']) : null;
        return html`<div class="space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <h1 class="text-2xl font-bold text-foreground">${this.id === 'new' ? `${__('New')} ${view.singular.toLowerCase()}` : `${__('Edit')} ${view.singular.toLowerCase()}`}</h1>
                    ${this.id === 'new' ? null : linkButton(__('New'), `${base}/new`, 'outline')}
                </div>
                <div class="flex items-center gap-3 text-sm">
                    ${this.meta.url ? html`<a href=${this.meta.url} class="text-primary hover:underline" target="_blank" rel="noopener">${__('View')} ${view.singular.toLowerCase()} ↗</a>` : null}
                    ${form && this.id !== 'new' ? html`<a href=${`/dashboard/forms/${this.id}/submissions`} class="text-primary hover:underline">${__('Submissions')}</a>` : null}
                    <a href=${form ? '/dashboard/forms' : base} class="text-muted-foreground hover:text-foreground">← ${__('All')} ${view.label.toLowerCase()}</a>
                </div>
            </div>
            ${tabs.length > 1 ? html`<div role="tablist" aria-label=${__('Editor view')} class="flex gap-1 border-b border-border">
                ${tabs.map(mode => html`<button type="button" role="tab" id=${`entry-tab-${mode}`} aria-selected=${this.mode === mode ? 'true' : 'false'} aria-controls=${mode === 'edit' ? 'entry-fields' : `entry-${mode}`}
                    class=${`-mb-px border-b-2 px-3 py-2 text-sm font-medium bg-transparent cursor-pointer ${this.mode === mode ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    @click=${() => this.showMode(mode)}>${tabLabels[mode]}</button>`)}
            </div>` : null}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.describe(this.error), 'error') : null}
            ${this.autosaveOffer ? html`<div role="status" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
                <span>${this.id === 'new' ? __('You have unsaved work from') : __('There is an autosave of this entry that is newer than the version below, from')} ${shortDate(this.autosaveOffer.at)}.</span>
                <span class="flex gap-2">${component(Button, { type: 'button', size: 'sm', '@click': () => this.restore() }, __('Restore the autosave'))}
                    ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => this.dismissAutosave() }, __('Dismiss'))}</span>
            </div>` : null}
            <div class=${`grid gap-6 ${this.mode === 'json' ? '' : 'lg:grid-cols-[minmax(0,1fr)_20rem]'}`}>
                <div class="min-w-0">
                ${this.mode === 'settings' ? html`<div id="entry-settings" role="tabpanel" aria-labelledby="entry-tab-settings" class="space-y-5">${settingsFields.map(field => this.fieldRow(field))}</div>` : null}
                ${this.mode === 'json' ? this.jsonPanel() : null}
                <div id="entry-fields" role="tabpanel" aria-labelledby="entry-tab-edit" class=${`space-y-5 ${this.mode === 'edit' ? '' : 'hidden'}`}>
                    ${titleField ? html`<div class="space-y-1">
                        <label for="field-title" class="sr-only">${__('Title')}</label>
                        <input id="field-title" class=${`w-full rounded-lg border bg-background px-4 py-3 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${this.errors[titleField] ? 'border-destructive' : 'border-input'}`}
                            placeholder=${__('Add title')} .value=${String(this.values[titleField] ?? '')} @input=${(event: Event) => this.setTitle((event.target as HTMLInputElement).value)}
                            ?required=${view.titleRequired} aria-invalid=${this.errors[titleField] ? 'true' : 'false'} aria-describedby=${this.errors[titleField] ? 'field-title-error' : undefined}>
                        ${this.errors[titleField] ? html`<p id="field-title-error" role="alert" class="text-xs text-destructive">${this.errors[titleField]}</p>` : null}
                    </div>` : null}
                    ${permalink !== null ? html`<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>${form ? __('Slug') : __('Permalink')}:</span>
                        ${this.editingSlug ? html`<input id="field-slug" class=${`${CONTROL} max-w-xs py-1`} aria-label=${__('Slug')} .value=${String(this.values.slug ?? '')}
                                @input=${(event: Event) => this.setSlug((event.target as HTMLInputElement).value)}>
                            ${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => { this.editingSlug = false; } }, __('OK'))}`
                            : html`<code class="rounded bg-muted px-1.5 py-0.5 text-foreground">${permalink}</code>
                            <button type="button" class="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.editingSlug = true; }}>${__('Edit')}</button>`}
                        <span class="sr-only" aria-live="polite">${String(this.values.slug ?? '')}</span>
                        ${form ? html`<span class="basis-full text-xs">${__('Place the form on a page with the Form block and this slug.')}</span>` : null}
                        ${this.errorFor('slug')}
                    </div>` : null}
                    ${main.map(field => this.fieldRow(field))}
                    ${view.groups.filter(group => group.placement === 'main').map(groupBox)}
                    ${view.path !== null && this.values.seo !== undefined ? this.seoBox() : null}
                </div>
                </div>
                <aside class=${`space-y-4 ${this.mode === 'json' ? 'hidden' : ''}`}>
                    ${this.publishBox(view)}
                    ${view.hierarchical ? box(__('Attributes'), html`
                        <div class="space-y-1">
                            <label for="field-parent" class="block text-xs font-medium text-foreground">${__('Parent')}</label>
                            <select id="field-parent" class=${CONTROL} @change=${(event: Event) => this.set('parent', (event.target as HTMLSelectElement).value)}>
                                <option value="" ?selected=${!this.values.parent}>(${__('no parent')})</option>
                                ${this.parents.map(option => html`<option value=${option.id} ?selected=${option.id === this.values.parent}>${'— '.repeat(option.depth)}${option.name}</option>`)}
                            </select>
                            ${this.errorFor('parent')}
                        </div>
                        <div class="space-y-1">
                            <label for="field-menuOrder" class="block text-xs font-medium text-foreground">${__('Order')}</label>
                            ${component(Input, { id: 'field-menuOrder', type: 'number', size: 'sm', '.value': String(this.values.menuOrder ?? '0'), '@input': (event: Event) => this.set('menuOrder', (event.target as HTMLInputElement).value) })}
                        </div>`) : null}
                    ${this.languages.multilingual && this.values.locale !== undefined && view.resource.startsWith('cms/') ? this.languagesBox(view) : null}
                    ${this.templateBox()}
                    ${view.taxonomies.map(taxonomy => this.taxonomyBox(taxonomy))}
                    ${sidebar.length ? box(__('Details'), sidebar.map(field => this.fieldRow(field))) : null}
                    ${view.groups.filter(group => group.placement === 'sidebar').map(groupBox)}
                    ${this.comments ? box(__('Discussion'), html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                        ${component(Checkbox, { id: 'field-commentsOpen', checked: this.values.commentsOpen !== false, '@change': (event: Event) => this.set('commentsOpen', (event.target as HTMLInputElement).checked) })} ${__('Allow comments')}</label>
                        ${this.id === 'new' ? null : html`<a href=${`/dashboard/comments?collection=${view.route}&entry=${this.id}`} class="text-xs text-primary hover:underline">${__('Comments on this entry')}</a>`}`) : null}
                    ${this.revisions.length ? box(__('Revisions'), html`<ol class="space-y-1 text-xs text-muted-foreground">
                        ${this.revisions.map(entry => html`<li>#${entry.revision} · ${shortDate(entry.at)}${entry.actor ? html` · <span class="text-foreground">${entry.actor}</span>` : null}</li>`)}
                    </ol>
                    ${this.revisions.length > 1 ? html`<a href=${`/dashboard/content/${view.route}/${this.id}/revisions`} class="text-sm text-primary hover:underline">${__('Compare and restore')}</a>` : null}`) : null}
                </aside>
            </div>
            ${this.pickerModal()}
            ${this.blockDialogModal()}
            ${this.patternModal()}
        </div>`;
    }
}

