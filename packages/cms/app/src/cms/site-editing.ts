/**
 * Server helpers for editing an entry on the public site. Every call checks again that the
 * signed-in user may update the entry; drafts render like previews and save through the
 * dashboard editor's save, with its revision check.
 */
import { CmsError, recordTitle, type CollectionDefinition, type EntryView, type Principal, type RecordShape } from '@cossackframework/cms';
import type { FormRequest } from './site-forms';
import type { CmsHost } from '@cossackframework/cms/server';
import { editorView, entryInput, entryValues, findMedia, mediaPreviews, saveEntry } from './content';
import { editorBlocks, type EditorValues } from './editor';
import { closedChooser } from './media-chooser';
import { entryViews } from './site';
import type { DraftBlock, SiteDraft, SiteEditable } from './site-editor';

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
    return {
        collection: collection.name, id: record.id, rev: record.rev, view, values, previews: await mediaPreviews(cms, values, view), references,
        blocksField, bodyField, changed: false, error: '', errors: {}, conflict: false, chooser: closedChooser(),
    };
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
export function draftMedia(cms: CmsHost, search: string, principal: Principal) {
    return principal.kind === 'user' ? findMedia(cms, search) : Promise.resolve([]);
}
