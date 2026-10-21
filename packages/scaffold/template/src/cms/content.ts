/**
 * Server helpers for the dashboard's content screens: which resource a route names, the
 * editor's view of it, and saving entries. Pages call these from their server methods.
 */
import { blockCategory, blockMedia, blockSupports, CmsError, CORE_FIELDS, flattenBlocks, isCmsError, mediaUrl, recordTitle, type Block, type CollectionDefinition, type MediaKind, type Principal, type RecordShape, type Resource } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { activePresets } from './site';
import { controlValue, editorField, editorFields, editorInput, type BlockOption, type EditorBlock, type EditorTaxonomy, type EditorValues, type EditorView, type TermOption } from './editor';

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
    return {
        resource: resource.id, route, label: resource.label ?? resource.id, singular: collection?.singular ?? 'Entry',
        titleField, titleRequired: Boolean(titleField && resource.fields[titleField]?.required),
        slug: Boolean(collection && collection.slug !== false), publishable: Boolean(collection && collection.publishable !== false), hierarchical: Boolean(collection?.hierarchical),
        path: collection?.path ?? null,
        fields: editorFields(resource.fields, special),
        taxonomies, blocks, presets: await activePresets(cms),
    };
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
        children: block.children ? { allowed: [...(block.children.allowed ?? [])], max: block.children.max ?? null } : null, parent: [...(block.parent ?? [])], supports: [...blockSupports(block)] }));
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

/** The CMS error's field messages with labels, for showing next to controls. */
export function fieldErrors(error: unknown): Record<string, string> {
    return isCmsError(error) && error.fields ? { ...error.fields } : {};
}
