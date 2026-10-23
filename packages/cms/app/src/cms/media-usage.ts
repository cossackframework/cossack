/**
 * Where a media file is used: entries whose fields, rich text or blocks reference it, and the
 * themes' widget areas. Collections are document tables without an index on file IDs, so the
 * newest entries of each are read and checked here; very large sites see the newest matches.
 */
import { blockMedia, richTextMedia, type Block, type FieldDeclaration, type Principal, type RichTextDoc } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { recordTitle } from '@cossackframework/cms';

export interface MediaUse { title: string; href: string; kind: string; status: string }

/** Entries read per collection. */
const SCAN = 400;

/** Whether a record's fields reference the file. */
function uses(record: { readonly [field: string]: unknown }, fields: { readonly [name: string]: FieldDeclaration }, id: string, types: CmsHost['blockTypes']): boolean {
    for (const [name, declaration] of Object.entries(fields)) {
        const value = record[name];
        if (value === undefined || value === null) continue;
        if (declaration.media && (value === id || (Array.isArray(value) && value.includes(id)))) return true;
        if (declaration.kind === 'richtext' && richTextMedia(value as RichTextDoc).includes(id)) return true;
        if (declaration.kind === 'blocks' && Array.isArray(value) && blocksUse(value as Block[], id, types)) return true;
        if (declaration.kind === 'json' && name === 'seo' && (value as { image?: unknown }).image === id) return true;
    }
    return false;
}

/** Blocks reference the file through their media fields or the rich text inside them. */
function blocksUse(blocks: readonly Block[], id: string, types: CmsHost['blockTypes']): boolean {
    if (blockMedia(blocks, types).includes(id)) return true;
    const visit = (list: readonly Block[]): boolean => list.some(block => Object.entries(types.get(block.type)?.fields ?? {})
        .some(([name, declaration]) => declaration.kind === 'richtext' && richTextMedia(block.data[name] as RichTextDoc).includes(id)) || visit(block.children ?? []));
    return visit(blocks);
}

export async function mediaUsage(cms: CmsHost, id: string, principal: Principal): Promise<MediaUse[]> {
    const found: MediaUse[] = [];
    for (const collection of cms.collections()) {
        const resource = cms.resourceById(`cms/${collection.name}`);
        const page = await cms.resource(resource.id).list({ limit: SCAN, ...(collection.publishable === false ? {} : { where: { status: { ne: 'trash' } } }) }, { principal }).catch(() => ({ records: [] }));
        for (const record of page.records) {
            if (!uses(record, resource.fields, id, cms.blockTypes)) continue;
            found.push({ title: recordTitle(record, resource.titleField), href: `/dashboard/content/${collection.name}/${record.id}`, kind: collection.singular, status: typeof record.status === 'string' ? record.status : '' });
        }
    }
    for (const [name, area] of await cms.areas.all().catch(() => new Map())) {
        if (blocksUse(area.blocks as Block[], id, cms.blockTypes)) found.push({ title: name, href: '/dashboard/appearance/widgets', kind: __('Widget area'), status: '' });
    }
    return found;
}
