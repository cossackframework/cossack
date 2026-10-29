/**
 * Server helpers for the dashboard's content screens: which resource a route names, the
 * editor's view of it, and saving entries. Pages call these from their server methods.
 */
import { blockCategory, blockMedia, blockSupports, bulkActions, cloneBlocks, fieldGroupDeclarations, type FieldGroupTarget, CmsError, CORE_FIELDS, entryActions, entryColumns, flattenBlocks, isCmsError, mediaUrl, principalId, recordTitle, richTextHtml, richTextMedia, type Block, type CollectionDefinition, type EntryAction, type EntryColumn, type MediaKind, type Principal, type RecordShape, type Resource, type RichTextDoc, type WriteActor } from '@cossackframework/cms';
import { renderMarkdown, type CmsHost } from '@cossackframework/cms/server';
import { activePresets } from './site';
import { controlValue, editorBlocks, editorField, editorFields, editorInput, type BlockOption, type EditorBlock, type EditorField, type EditorGroup, type EditorTaxonomy, type EditorValues, type EditorView, type TermOption } from './editor';

/** A collection by name (`posts`), or a plugin or application resource as `<owner>.<name>`. */
export function routeResource(cms: CmsHost, route: string): { resource: Resource; collection: CollectionDefinition | null } {
    const [owner, name] = route.includes('.') ? route.split('.', 2) : ['cms', route];
    if (owner === 'cms' && route.includes('.')) throw new CmsError('CMS_NOT_FOUND', 'Unknown content type.');
    const resource = cms.resourceById(`${owner}/${name}`);
    return { resource, collection: owner === 'cms' ? cms.collection(name!) : null };
}

/** Terms of a taxonomy in tree order, for checklists and selects. */
export async function termOptions(cms: CmsHost, taxonomy: string): Promise<TermOption[]> {
    return (await cms.taxonomies.tree(taxonomy)).map(term => ({ id: term.id, name: term.name, depth: term.depth }));
}

export async function editorView(cms: CmsHost, route: string): Promise<EditorView> {
    const { resource, collection } = routeResource(cms, route);
    const taxonomyFields = Object.entries(resource.fields).filter(([, field]) => field.taxonomy).map(([name, field]) => ({ name, taxonomy: field.taxonomy! }));
    const special = collection ? [...CORE_FIELDS, ...taxonomyFields.map(entry => entry.name)] : [resource.titleField ?? '', ...taxonomyFields.map(entry => entry.name)];
    const taxonomies: EditorTaxonomy[] = [];
    for (const { taxonomy } of taxonomyFields) {
        const declaration = cms.taxonomies.declaration(taxonomy);
        taxonomies.push({ name: declaration.name, label: declaration.label, singular: declaration.singular, hierarchical: declaration.hierarchical,
            terms: declaration.hierarchical ? await termOptions(cms, taxonomy) : (await cms.taxonomies.list(taxonomy, { limit: 100 })).items.map(term => ({ id: term.id, name: term.name, depth: 0 })) });
    }
    const blocks = await blockOptions(cms);
    const titleField = collection ? 'title' : resource.titleField ?? '';
    const termChoices: EditorView['termChoices'] = [];
    for (const declaration of cms.taxonomies.declarations) termChoices.push(...(await cms.taxonomies.tree(declaration.name)).slice(0, 200).map(term => ({ id: term.id, name: term.name, taxonomy: declaration.label, depth: term.depth })));
    return {
        resource: resource.id, route, label: resource.label ?? resource.id, singular: collection?.singular ?? 'Entry',
        titleField, titleRequired: Boolean(titleField && resource.fields[titleField]?.required),
        slug: Boolean(collection && collection.slug !== false), publishable: Boolean(collection && collection.publishable !== false), hierarchical: Boolean(collection?.hierarchical),
        path: collection?.path ?? null,
        fields: editorFields(resource.fields, special),
        taxonomies, blocks, presets: await activePresets(cms),
        template: editorBlocks(cloneBlocks(collection?.template ?? []) as EditorBlock[], blocks), ...(collection?.templateLock ? { templateLock: collection.templateLock } : {}),
        collections: cms.collections().filter(entry => entry.publishable !== false && !entry.managed).map(entry => ({ name: entry.name, label: entry.label })),
        termChoices,
        groups: collection ? cms.fieldGroupsFor({ kind: 'collection', name: collection.name }).map(group => ({
            id: group.id, title: group.title, description: group.description ?? '', placement: group.placement ?? 'main', blocks: editorBlocks(cloneBlocks(group.blocks) as EditorBlock[], blocks),
        })) : [],
    };
}

/** What a screen needs to show a target's field groups: the boxes, their fields and the block types. */
export interface GroupsView {
    groups: EditorGroup[];
    fields: EditorField[];
    options: BlockOption[];
}

/** The field groups attached to a target, for the editors of terms, users and menu items. */
export async function groupsView(cms: CmsHost, target: FieldGroupTarget): Promise<GroupsView> {
    const options = await blockOptions(cms);
    const groups = cms.fieldGroupsFor(target);
    const fields = editorFields(fieldGroupDeclarations(groups.flatMap(group => group.blocks), cms.blockTypes), []);
    return {
        groups: groups.map(group => ({ id: group.id, title: group.title, description: group.description ?? '', placement: group.placement ?? 'main', blocks: editorBlocks(cloneBlocks(group.blocks) as EditorBlock[], options) })),
        fields, options,
    };
}

/** A target's meta as control values. */
export function metaValues(fields: readonly EditorField[], meta: { readonly [field: string]: unknown } | undefined): EditorValues {
    return Object.fromEntries(fields.map(field => [field.name, controlValue(field, meta?.[field.name])]));
}

/** Typed meta from control values; invalid text is reported by field. */
export function metaInput(fields: readonly EditorField[], values: EditorValues): { meta: Record<string, unknown>; errors: Record<string, string> } {
    const { input, errors } = editorInput(fields, values);
    return { meta: input, errors };
}

/** The name of the collection's content: the `content` feature, or a plugin resource's first blocks field, which the template and patterns fill. */
export function contentField(view: Pick<EditorView, 'fields'>): string | null {
    return view.fields.find(field => field.kind === 'blocks' && !field.form)?.name ?? null;
}

/** A pattern's blocks, with fresh IDs for the copy. Null when it is gone or private to someone else. */
export async function patternBlocks(cms: CmsHost, id: string, principal: Principal): Promise<Block[] | null> {
    const record = await cms.resource('cms/patterns').get(id, { principal }).catch(() => null);
    return Array.isArray(record?.content) ? cloneBlocks(record.content as Block[]) : null;
}

/**
 * Blocks as plain HTML, for feeds and the content API's `?format=html`: rich text and Markdown
 * rendered, images as tags, the rest as its text. Containers render what they hold.
 */
export function blocksHtml(cms: CmsHost, blocks: readonly Block[], files: ReadonlyMap<string, { id: string; name: string; alt: string }> = new Map()): string {
    const parts: string[] = [];
    for (const block of blocks) {
        const type = cms.blockTypes.get(block.type);
        if (!type || blockCategory(type) === 'data') continue;
        for (const [name, declaration] of Object.entries(type.fields)) {
            const value = block.data[name];
            if (declaration.kind === 'richtext' && value && typeof value === 'object') parts.push(richTextHtml(value as RichTextDoc, { block: () => '' }));
            else if (declaration.kind === 'text' && declaration.format === 'markdown' && typeof value === 'string') parts.push(renderMarkdown(value));
            else if (declaration.media && typeof value === 'string' && files.get(value)) parts.push(`<p><img src="${mediaUrl(files.get(value)!)}" alt="${(files.get(value)!.alt).replace(/"/g, '&quot;')}"></p>`);
            else if (block.type === 'core/heading' && name === 'text' && typeof value === 'string') { const level = typeof block.data.level === 'string' ? block.data.level : 'h2'; parts.push(`<${level}>${escape(value)}</${level}>`); }
            else if (block.type === 'core/list' && name === 'items' && Array.isArray(value)) parts.push(`<${block.data.ordered ? 'ol' : 'ul'}>${value.map(item => `<li>${escape(String(item))}</li>`).join('')}</${block.data.ordered ? 'ol' : 'ul'}>`);
            else if (block.type === 'core/quote' && name === 'text' && typeof value === 'string') parts.push(`<blockquote><p>${escape(value)}</p></blockquote>`);
        }
        if (block.children?.length) parts.push(blocksHtml(cms, block.children, files));
    }
    return parts.join('\n');
}

function escape(text: string): string {
    return text.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!);
}

/** Control values for an entry; tags show as names. */
export async function entryValues(cms: CmsHost, view: EditorView, record: RecordShape | null): Promise<EditorValues> {
    const { resource } = routeResource(cms, view.route);
    const values: EditorValues = {};
    for (const [name, declaration] of Object.entries(resource.fields)) {
        const stored = record ? record[name] : declaration.default ?? null;
        values[name] = controlValue(editorField(name, declaration), stored);
    }
    for (const taxonomy of view.taxonomies) {
        const ids = (record?.[taxonomy.name] as string[] | undefined) ?? [];
        if (taxonomy.hierarchical) { values[taxonomy.name] = ids; continue; }
        const terms = await cms.taxonomies.getMany(ids);
        values[taxonomy.name] = ids.map(id => terms.get(id)?.name).filter(Boolean);
    }
    if (view.publishable) {
        values.status = (record?.status as string | undefined) ?? 'draft';
        values.publishedAt = record?.publishedAt ? new Date(record.publishedAt as number).toISOString().slice(0, 16) : '';
    }
    if (view.hierarchical) {
        values.parent = (record?.parent as string | null | undefined) ?? '';
        values.menuOrder = String(record?.menuOrder ?? 0);
    }
    const languages = await cms.languages();
    values.locale = typeof record?.locale === 'string' ? record.locale : languages.default;
    if (resource.fields.commentsOpen) values.commentsOpen = record ? record.commentsOpen !== false : await cms.settings.get('discussion.defaultOpen');
    return values;
}

export type { MediaPreview } from './field-controls';
import type { MediaPreview } from './field-controls';

/** The block types editors can add: those of modules and active plugins. */
export async function blockOptions(cms: CmsHost): Promise<BlockOption[]> {
    return (await cms.blocks()).map(block => ({ name: block.name, label: block.label, description: block.description ?? '', icon: block.icon ?? '',
        category: blockCategory(block), fields: editorFields(block.fields, []),
        children: block.children ? { allowed: [...(block.children.allowed ?? [])], max: block.children.max ?? null } : null, parent: [...(block.parent ?? [])], supports: [...blockSupports(block)], field: block.field?.kind ?? '', input: Boolean(block.input), keywords: [...(block.keywords ?? [])], common: block.common === true }));
}

/** Previews of files by ID; missing files are left out. */
export async function filePreviews(cms: CmsHost, ids: Iterable<string>): Promise<Record<string, MediaPreview>> {
    const wanted = [...new Set(ids)].filter(Boolean).slice(0, 200);
    if (!cms.files || !wanted.length) return {};
    const files = await cms.files.getMany(wanted);
    return Object.fromEntries([...files.values()].map(file => [file.id, { id: file.id, url: mediaUrl(file), title: file.title, alt: file.alt, contentType: file.contentType, width: file.width, height: file.height }]));
}

/** Previews of the files blocks use. */
export function blockFilePreviews(cms: CmsHost, blocks: readonly Block[]): Promise<Record<string, MediaPreview>> {
    return filePreviews(cms, blockMedia(blocks, cms.blockTypes));
}

/** The media library's newest files matching a search, for a media chooser. */
export async function findMedia(cms: CmsHost, search: string, kind = ''): Promise<MediaPreview[]> {
    if (!cms.files) return [];
    const page = await cms.files.list({ search: search.slice(0, 100), limit: 40, ...(kind ? { kind: kind as MediaKind } : {}) });
    return page.items.map(file => ({ id: file.id, url: mediaUrl(file), title: file.title, alt: file.alt, contentType: file.contentType, width: file.width, height: file.height }));
}

/** Previews of the media an entry's fields and blocks use. */
export async function mediaPreviews(cms: CmsHost, values: EditorValues, view: EditorView): Promise<Record<string, MediaPreview>> {
    const ids = new Set<string>();
    const collect = (fields: EditorView['fields'], source: Record<string, unknown>) => {
        for (const field of fields) {
            const value = source[field.name];
            if (field.media && typeof value === 'string' && value) ids.add(value);
            if (field.media && Array.isArray(value)) for (const id of value) if (typeof id === 'string') ids.add(id);
            if (field.kind === 'richtext' && value && typeof value === 'object') for (const id of richTextMedia(value as RichTextDoc)) ids.add(id);
            if (field.kind === 'blocks' && Array.isArray(value)) {
                for (const block of flattenBlocks(value as EditorBlock[])) collect(view.blocks.find(option => option.name === block.type)?.fields ?? [], block.data ?? {});
            }
        }
    };
    collect(view.fields, values);
    const seo = values.seo as Record<string, unknown> | undefined;
    if (typeof seo?.image === 'string' && seo.image) ids.add(seo.image);
    if (!cms.files || !ids.size) return {};
    const files = await cms.files.getMany([...ids]);
    return Object.fromEntries([...files.values()].map(file => [file.id, { id: file.id, url: mediaUrl(file), title: file.title, alt: file.alt, contentType: file.contentType, width: file.width, height: file.height }]));
}

/** Entries an entry can nest under: everything except itself and its descendants. */
export async function parentOptions(cms: CmsHost, resourceId: string, self: string | null, principal: Principal): Promise<TermOption[]> {
    const page = await cms.resource(resourceId).list({ where: { status: { ne: 'trash' } }, order: { field: 'title', direction: 'asc' }, limit: 100 }, { principal });
    const children = new Map<string | null, RecordShape[]>();
    for (const record of page.records) {
        const parent = (record.parent as string | null) ?? null;
        children.set(parent, [...(children.get(parent) ?? []), record]);
    }
    const known = new Set(page.records.map(record => record.id));
    const options: TermOption[] = [];
    const visit = (parent: string | null, depth: number) => {
        for (const record of children.get(parent) ?? []) {
            if (record.id === self) continue;
            options.push({ id: record.id, name: recordTitle(record, 'title'), depth });
            visit(record.id, depth + 1);
        }
    };
    visit(null, 0);
    // Entries whose parent is outside this page still appear, at the top level.
    for (const record of page.records) {
        const parent = record.parent as string | null;
        if (parent && !known.has(parent) && record.id !== self) options.push({ id: record.id, name: recordTitle(record, 'title'), depth: 0 });
    }
    return options;
}

export type SaveIntent = 'draft' | 'publish' | 'update' | 'trash' | 'restore';

/** Record input from control values, without terms: what saving would write, for previews and saves. */
export async function entryInput(cms: CmsHost, route: string, values: EditorValues): Promise<Record<string, unknown>> {
    const view = await editorView(cms, route);
    const { resource } = routeResource(cms, route);
    const fields = [...view.fields];
    const titleField = view.titleField;
    if (titleField && resource.fields[titleField]) fields.push(editorField(titleField, resource.fields[titleField]!));
    for (const name of ['slug', 'publishedAt', 'parent', 'menuOrder', 'seo', 'locale', 'commentsOpen', 'template']) {
        if (resource.fields[name] && (name !== 'slug' || view.slug) && (name !== 'publishedAt' || view.publishable)) fields.push(editorField(name, resource.fields[name]!));
    }
    const { input, errors } = editorInput(fields, values, view.blocks);
    if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Some fields are invalid.', { fields: errors });
    return input;
}

/**
 * Create or update an entry from control values. Typed tags become term IDs, creating the
 * missing ones. The status is the one chosen, or follows the button pressed. Field errors
 * come back keyed by field.
 */
export async function saveEntry(cms: CmsHost, route: string, id: string | null, values: EditorValues, intent: SaveIntent, revision: number, principal: Principal): Promise<RecordShape> {
    const view = await editorView(cms, route);
    const { resource } = routeResource(cms, route);
    const repository = cms.resource(resource.id);
    // Moving to the trash changes only the status, as in WordPress; edits are not saved.
    if (intent === 'trash' && id && view.publishable) return repository.update(id, { status: 'trash' }, { principal, expectedRevision: revision });
    const input = await entryInput(cms, route, values);
    for (const taxonomy of view.taxonomies) {
        const raw = values[taxonomy.name];
        const list = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
        input[taxonomy.name] = taxonomy.hierarchical ? list : await cms.taxonomies.ensure(taxonomy.name, list, { principal });
    }
    if (view.publishable) {
        const current = typeof values.status === 'string' && ['draft', 'pending', 'scheduled', 'published'].includes(values.status) ? values.status : 'draft';
        input.status = intent === 'publish' ? 'published' : intent === 'draft' ? 'draft' : intent === 'trash' ? 'trash' : intent === 'restore' ? 'draft' : current;
    }
    const record = id ? await repository.update(id, input, { principal, expectedRevision: revision }) : await repository.create(input, { principal });
    // The saved entry replaces the editor's autosave.
    await cms.discardAutosave(resource.id, id ?? 'new', principal).catch(() => undefined);
    return record;
}

/** Fields a copy of an entry does not take: its identity, its slug (derived again), its publication and its translation group. */
const NOT_COPIED = new Set(['slug', 'status', 'publishedAt', 'translationGroup']);

/**
 * A draft copy of an entry, as WordPress's duplicate plugins make one: the same fields with
 * "(Copy)" after the title, a new slug, unpublished, owned by whoever copies it.
 */
export async function duplicateEntry(cms: CmsHost, route: string, id: string, principal: Principal): Promise<RecordShape> {
    const { resource, collection } = routeResource(cms, route);
    const repository = cms.resource(resource.id);
    const source = await repository.get(id, { principal });
    if (!source) throw new CmsError('CMS_NOT_FOUND', 'The entry does not exist.');
    const input: Record<string, unknown> = {};
    for (const name of Object.keys(resource.fields)) {
        if (NOT_COPIED.has(name) || source[name] === undefined) continue;
        input[name] = source[name];
    }
    const titleField = resource.titleField ?? 'title';
    if (typeof source[titleField] === 'string') input[titleField] = `${source[titleField]} (${__('Copy')})`;
    if (collection && collection.publishable !== false) input.status = 'draft';
    return repository.create(input, { principal });
}

function writeActor(principal: Principal): WriteActor {
    return { kind: principal.kind, id: principalId(principal) };
}

/** What plugins add to an entries list: actions under each row, extra columns and bulk actions. */
export async function listExtras(cms: CmsHost, resource: string, records: readonly RecordShape[], principal: Principal): Promise<{ actions: Record<string, EntryAction[]>; columns: EntryColumn[]; bulk: EntryAction[] }> {
    const actor = writeActor(principal);
    const actions: Record<string, EntryAction[]> = {};
    for (const record of records) {
        const added = await cms.hooks.applyFilters(entryActions, [], { resource, record, actor }).catch(() => []);
        if (added.length) actions[record.id] = [...added];
    }
    const columns = await cms.hooks.applyFilters(entryColumns, [], { resource, records, actor }).catch(() => []);
    const bulk = await cms.hooks.applyFilters(bulkActions, [], { resource, actor }).catch(() => []);
    return { actions, columns: [...columns], bulk: [...bulk] };
}

/** Run a plugin command an action names, with the entry or entries as its input. */
export async function runEntryCommand(cms: CmsHost, action: EntryAction, input: { resource: string; id?: string; ids?: readonly string[] }, principal: Principal, signal?: AbortSignal): Promise<void> {
    if (!action.command) return;
    await cms.runCommand(action.command.plugin, action.command.name, { resource: input.resource, ...(input.id ? { id: input.id } : {}), ...(input.ids ? { ids: input.ids.join(',') } : {}) }, { principal, ...(signal ? { signal } : {}) });
}

/** The CMS error's field messages with labels, for showing next to controls. */
export function fieldErrors(error: unknown): Record<string, string> {
    return isCmsError(error) && error.fields ? { ...error.fields } : {};
}

/**
 * The writable part of an entry in the API's shape: its declared fields. The rest (id, rev,
 * owner, the dates, url, anything a plugin adds to the answer) is read-only, so the JSON tab
 * shows it and ignores edits to it.
 */
export function writableEntryFields(fields: { readonly [name: string]: unknown }, declared: { readonly [name: string]: unknown }): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).filter(([name]) => Object.hasOwn(declared, name)));
}

/** An entry as the content API answers it, as indented JSON for the editor's JSON tab. */
export async function entryJson(cms: CmsHost, route: string, record: RecordShape): Promise<string> {
    const { collection } = routeResource(cms, route);
    const url = collection ? (await cms.entryUrls(collection, [record])).get(record.id) ?? null : null;
    return JSON.stringify({ ...record, ...(collection ? { url } : {}) }, null, 2);
}

export interface ImportReport {
    created: number;
    updated: number;
    failed: { index: number; id: string | null; error: string; fields?: Record<string, string> }[];
}

/** The most entries one import takes. */
export const IMPORT_LIMIT = 1000;

/** The entries an export or an upload holds: a list, or an export's `{ items }` document. */
export function importItems(parsed: unknown): Record<string, unknown>[] | string {
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : null;
    if (!list) return 'Send a list of entries, or an export with its items.';
    if (list.length > IMPORT_LIMIT) return `Import at most ${IMPORT_LIMIT} entries at a time.`;
    if (!list.every(item => item && typeof item === 'object' && !Array.isArray(item))) return 'Every entry is a JSON object.';
    return list as Record<string, unknown>[];
}

/**
 * Import entries in the API's shape, as an export wrote them: an entry whose `id` exists is
 * updated, else one with the same slug; the rest are created, keeping their IDs so references
 * between them hold. Each entry is written with the same checks as a save, and a failure
 * leaves the others untouched. Media and terms are referenced by ID and must exist.
 */
export async function importEntries(cms: CmsHost, route: string, items: readonly Record<string, unknown>[], principal: Principal): Promise<ImportReport> {
    const { resource } = routeResource(cms, route);
    const repository = cms.resource(resource.id);
    const report: ImportReport = { created: 0, updated: 0, failed: [] };
    for (const [index, item] of items.entries()) {
        const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item.id) ? item.id : null;
        const fields = writableEntryFields(item, resource.fields);
        try {
            let existing = id ? await repository.get(id, { principal }) : null;
            if (!existing && resource.fields.slug && typeof fields.slug === 'string' && fields.slug) {
                existing = (await repository.list({ where: { slug: fields.slug }, limit: 1 }, { principal })).records[0] ?? null;
            }
            if (existing) {
                await repository.update(existing.id, fields, { principal, expectedRevision: existing.rev });
                report.updated++;
            } else {
                await repository.create(fields, { principal, ...(id ? { id } : {}) });
                report.created++;
            }
        } catch (error) {
            if (!isCmsError(error)) throw error;
            report.failed.push({ index, id, error: error.message, ...(error.fields ? { fields: { ...error.fields } } : {}) });
        }
    }
    return report;
}

/** Every entry the principal may read, in the API's shape, in pages of 100, for an export. */
export async function* exportEntries(cms: CmsHost, route: string, principal: Principal): AsyncGenerator<Record<string, unknown>[]> {
    const { resource, collection } = routeResource(cms, route);
    const repository = cms.resource(resource.id);
    for (let offset = 0; offset <= 10_000; offset += 100) {
        const page = await repository.list({ order: { field: 'createdAt', direction: 'asc' }, limit: 100, offset }, { principal });
        if (!page.records.length) return;
        const urls = collection ? await cms.entryUrls(collection, page.records) : new Map<string, string | null>();
        yield page.records.map(record => ({ ...record, ...(collection ? { url: urls.get(record.id) ?? null } : {}) }));
        if (page.records.length < 100) return;
    }
}

/**
 * Save an entry from the JSON tab: the document is the API's shape, so read-only fields are
 * dropped and the rest is written as a `PATCH /api/cms/content/<collection>/<id>` would be,
 * through the same validation.
 */
export async function applyEntryJson(cms: CmsHost, route: string, id: string, text: string, revision: number, principal: Principal): Promise<RecordShape> {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (error) { throw new CmsError('CMS_VALIDATION', `The JSON is not valid: ${(error as Error).message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CmsError('CMS_VALIDATION', 'The JSON must be an object of the entry\'s fields.');
    const { resource } = routeResource(cms, route);
    const fields = writableEntryFields(parsed as Record<string, unknown>, resource.fields);
    return cms.resource(resource.id).update(id, fields, { principal, expectedRevision: revision });
}
