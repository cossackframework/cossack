/**
 * Server helpers for editing an entry on the public site. Every call checks again that the
 * signed-in user may update the entry; drafts render like previews and save through the
 * dashboard editor's save, with its revision check.
 */
import { CmsError, hasPermission, participantColor, PERMISSIONS, recordTitle, type Block, type CollectionDefinition, type EntryView, type Principal, type RecordShape } from '@cossackframework/cms';
import type { FormRequest } from './site-forms';
import type { CmsHost } from '@cossackframework/cms/server';
import { editorView, entryInput, entryValues, findMedia, mediaPreviews, saveEntry } from './content';
import { blocksInput, editorBlocks, type BlockOption, type EditorBlock, type EditorValues } from './editor';
import { closedChooser } from './media-chooser';
import { entryViews } from './site';
import type { DraftBlock, SiteDocument, SiteDraft, SiteEditable } from './site-editor';

/** The entry when the principal may update it, read as them; otherwise null. */
export async function editableRecord(cms: CmsHost, collection: string, id: string, principal: Principal): Promise<{ collection: CollectionDefinition; record: RecordShape } | null> {
    if (principal.kind !== 'user') return null;
    try {
        const definition = cms.collection(collection);
        const repository = cms.resource(`cms/${definition.name}`);
        const record = await repository.get(id, { principal });
        return record && repository.canUpdate(record, principal) ? { collection: definition, record } : null;
    } catch (error) {
        if (error instanceof CmsError) return null;
        throw error;
    }
}

/** The bar's links for an entry the principal may edit, or null. */
export async function siteEditable(cms: CmsHost, collection: string, id: string, principal: Principal): Promise<SiteEditable | null> {
    const found = await editableRecord(cms, collection, id, principal);
    return found ? { collection: found.collection.name, id, dashboard: `/dashboard/content/${found.collection.name}/${id}` } : null;
}

/** A draft of the saved entry: its editor view and control values, blocks' data as control values too. */
export async function siteDraft(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, principal: Principal): Promise<SiteDraft> {
    const view = await editorView(cms, collection.name);
    const values = await entryValues(cms, view, record);
    const blocksField = view.fields.find(field => field.kind === 'blocks')?.name ?? null;
    const bodyField = view.fields.find(field => field.name === 'body' && field.kind === 'richtext')?.name ?? view.fields.find(field => field.kind === 'richtext')?.name ?? null;
    if (blocksField) values[blocksField] = editorBlocks((values[blocksField] as DraftBlock[] | undefined) ?? [], view.blocks);
    const references: SiteDraft['references'] = {};
    for (const field of view.fields.filter(entry => entry.kind === 'reference')) {
        const page = await cms.resource(field.target).list({ limit: 100 }, { principal }).catch(() => ({ records: [] as RecordShape[] }));
        const target = cms.resourceById(field.target);
        references[field.name] = page.records.filter(entry => entry.id !== record.id).map(entry => ({ id: entry.id, title: recordTitle(entry, target.titleField) }));
    }
    // The entry's notes, with who wrote them, and who a new note could mention.
    const me = principal.kind === 'user' ? principal.id : '';
    const notes = await cms.notes.forEntry(`cms/${collection.name}`, record.id).catch(() => []);
    const users = await cms.users.getMany([...new Set([me, ...notes.map(note => note.userId)].filter(Boolean))]);
    const mentionable = me ? (await cms.users.list({ limit: 100 }).catch(() => ({ items: [] }))).items.filter(user => user.id !== me).map(user => ({ id: user.id, name: user.name || user.email })) : [];
    return {
        collection: collection.name, id: record.id, rev: record.rev, view, values, previews: await mediaPreviews(cms, values, view), references,
        blocksField, bodyField, documents: await siteDocuments(cms, view.blocks, principal), changed: false, error: '', errors: {}, conflict: false, chooser: closedChooser(),
        notes, people: Object.fromEntries([...users.values()].map(user => [user.id, { user: user.id, name: user.name || user.email, avatar: user.avatar, color: participantColor(user.id) }])),
        me, admin: hasPermission(principal, PERMISSIONS.manageUsers), mentionable,
    };
}

/**
 * The active theme's widget areas as documents the editor edits beside the entry: the saved
 * blocks, or the theme's defaults, as control values. Editable with `cms:appearance`.
 */
export async function siteDocuments(cms: CmsHost, options: readonly BlockOption[], principal: Principal): Promise<SiteDocument[]> {
    const editable = principal.kind === 'user' && hasPermission(principal, PERMISSIONS.manageAppearance);
    const saved = await cms.areas.all().catch(() => new Map<string, { readonly blocks: readonly Block[]; readonly revision: number }>());
    return (await cms.areaLocations()).filter(area => area.active).map(area => {
        const stored = saved.get(area.name);
        return { key: `area:${area.name}`, kind: 'area' as const, name: area.name, label: area.label, revision: stored?.revision ?? 0, blocks: editorBlocks((stored?.blocks ?? area.defaults) as EditorBlock[], options), editable, changed: false, error: '', conflict: false };
    });
}

/** Save the changed documents, each over the revision it started from. A conflict or an error stays on its document; the others still save. */
export async function saveDocuments(cms: CmsHost, documents: readonly SiteDocument[], options: readonly BlockOption[], principal: Principal): Promise<SiteDocument[]> {
    const types = new Map(options.map(option => [option.name, option]));
    const known = (await cms.areaLocations()).map(area => area.name);
    const result: SiteDocument[] = [];
    for (const document of documents) {
        if (!document.changed || !document.editable) { result.push(document); continue; }
        const converted = blocksInput(document.blocks, types);
        if ('error' in converted) { result.push({ ...document, error: converted.error }); continue; }
        try {
            const saved = await cms.areas.save(document.name, converted.value, { principal, expectedRevision: document.revision, known });
            result.push({ ...document, revision: saved.revision, blocks: editorBlocks(saved.blocks as EditorBlock[], options), changed: false, error: '', conflict: false });
        } catch (error) {
            if (!(error instanceof CmsError)) throw error;
            result.push({ ...document, error: error.message, conflict: error.code === 'CMS_CONFLICT' });
        }
    }
    return result;
}

/** The areas' blocks as the layout previews them, converted from the editor's control values; an area whose blocks do not convert keeps its saved ones. */
export function areaDraftBlocks(areas: readonly { name: string; blocks: EditorBlock[] }[], options: readonly BlockOption[]): Map<string, readonly Block[]> {
    const types = new Map(options.map(option => [option.name, option]));
    const drafts = new Map<string, readonly Block[]>();
    for (const area of areas) {
        const converted = blocksInput(area.blocks, types);
        if (!('error' in converted)) drafts.set(area.name, converted.value as unknown as Block[]);
    }
    return drafts;
}

/** The entry as the site shows it with the draft's values, like a preview, with its forms. Invalid values throw. */
export async function draftEntry(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, values: EditorValues, forms?: FormRequest): Promise<EntryView> {
    const input = await entryInput(cms, collection.name, values);
    // Typed tags are names until the save creates their terms; the preview keeps the saved ones.
    for (const name of Object.keys(input)) if (cms.resourceById(`cms/${collection.name}`).fields[name]?.taxonomy) delete input[name];
    return (await entryViews(cms, collection, [{ ...record, ...input }], { full: true, ...(forms ? { forms } : {}) }))[0]!;
}

/** Save the draft over the revision it started from. A newer save makes a CMS_CONFLICT. */
export function saveDraft(cms: CmsHost, draft: Pick<SiteDraft, 'collection' | 'id' | 'rev'>, values: EditorValues, principal: Principal): Promise<RecordShape> {
    return saveEntry(cms, draft.collection, draft.id, values, 'update', draft.rev, principal);
}

/** Files for the media chooser of a signed-in editor. */
export function draftMedia(cms: CmsHost, search: string, principal: Principal, kind = '') {
    return principal.kind === 'user' ? findMedia(cms, search, kind) : Promise.resolve([]);
}
