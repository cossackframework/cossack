/**
 * The site as machines read it: `/llms.txt` (the site, its collections and latest entries
 * with summaries) and entries as Markdown for `Accept: text/markdown`. Server-only.
 */
import { ANONYMOUS, ARTICLE_TYPES, blocksMarkdown, entryMarkdown, mediaUrl, recordTitle, richTextMarkdown, type CollectionDefinition, type RecordShape, type RichTextDoc, type Block } from '@cossackframework/cms';
import { excerptOf, type CmsFile, type CmsHost } from '@cossackframework/cms/server';
import { isProtected } from './site';

const PER_COLLECTION = 50;

/** The summary of an entry for lists machines read: its meta description, its summary field, its excerpt, else nothing. */
function summaryOf(record: RecordShape): string {
    const seo = record.seo as { description?: string } | null | undefined;
    const value = seo?.description || (typeof record.summary === 'string' ? record.summary : '') || (typeof record.excerpt === 'string' ? record.excerpt : '');
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Collections `/llms.txt` lists: public, publishable, indexed and in the sitemap, posts first. */
export function machineCollections(cms: CmsHost): CollectionDefinition[] {
    return cms.collections()
        .filter(collection => typeof collection.path === 'string' && collection.slug !== false && collection.sitemap !== false && !collection.robots?.noindex && (collection.publishable !== false || collection.visibility === 'public'))
        .sort((a, b) => (a.name === 'posts' ? -1 : b.name === 'posts' ? 1 : a.label.localeCompare(b.label)));
}

/** The body of `/llms.txt`, per the llmstxt.org shape: a title, a blockquote summary, then sections of links. */
export async function llmsTxt(cms: CmsHost, origin: string): Promise<string> {
    const settings = await cms.settings.all();
    const languages = await cms.languages();
    const lines: string[] = [`# ${settings['general.siteTitle']}`, ''];
    if (settings['general.tagline']) lines.push(`> ${settings['general.tagline']}`, '');
    const publisher = settings['seo.publisherName'] || settings['general.siteTitle'];
    lines.push(`Published by ${publisher}. Pages are also available as Markdown: request any entry URL with \`Accept: text/markdown\` or \`?format=md\`. Changes are listed at ${origin}/sitemap.xml${cms.collections().some(collection => collection.name === 'posts' && typeof collection.path === 'string') ? ` and ${origin}/feed` : ''}.`, '');
    for (const collection of machineCollections(cms)) {
        const repository = cms.resource(`cms/${collection.name}`);
        const where = { ...(collection.publishable === false ? {} : { status: 'published' }), ...(languages.multilingual ? { locale: languages.default } : {}) };
        const order = collection.publishable === false ? { field: 'title', direction: 'asc' as const } : { field: 'publishedAt', direction: 'desc' as const };
        let records: RecordShape[] = [];
        try { records = [...(await repository.list({ where, order, limit: PER_COLLECTION }, { principal: ANONYMOUS })).records].filter(record => !isProtected(record) && !(record.seo as { noindex?: boolean } | null)?.noindex); }
        catch { continue; }
        if (!records.length) continue;
        records.sort((a, b) => Number((b.seo as { cornerstone?: boolean } | null)?.cornerstone === true) - Number((a.seo as { cornerstone?: boolean } | null)?.cornerstone === true));
        const urls = await cms.entryUrls(collection, records);
        const archive = await cms.archiveUrl(collection, languages.default).catch(() => null);
        lines.push(`## ${collection.label}${archive ? ` (${origin}${archive})` : ''}`, '');
        if (collection.description) lines.push(collection.description, '');
        for (const record of records) {
            const url = urls.get(record.id);
            if (!url) continue;
            const summary = summaryOf(record);
            lines.push(`- [${recordTitle(record, 'title').replace(/[\[\]]/g, '')}](${origin}${url})${summary ? `: ${summary}` : ''}`);
        }
        lines.push('');
    }
    const notes = settings['seo.llmsTxtNotes'].trim();
    if (notes) lines.push(notes, '');
    return `${lines.join('\n').trimEnd()}\n`;
}

/** Whether a request asks for Markdown: `?format=md`, or `Accept` preferring text/markdown over HTML. */
export function wantsMarkdown(request: Request): boolean {
    const url = new URL(request.url);
    if (url.searchParams.get('format') === 'md' || url.searchParams.get('format') === 'markdown') return true;
    const accept = request.headers.get('accept') ?? '';
    if (!/text\/markdown/i.test(accept)) return false;
    const weight = (type: string) => {
        const match = new RegExp(`${type.replace('/', '\\/')}(?:;\\s*q=([0-9.]+))?`, 'i').exec(accept);
        return match ? Number(match[1] ?? 1) : 0;
    };
    return weight('text/markdown') > weight('text/html');
}

/** An entry as a Markdown document with front matter: title, URL, author, dates, terms, then its content fields in order. */
export async function entryAsMarkdown(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, url: string, origin: string): Promise<string> {
    const settings = await cms.settings.all();
    const resource = cms.resourceById(`cms/${collection.name}`);
    const fields = Object.entries(resource.fields);
    const ids = new Set<string>();
    const blocksOf = (value: unknown) => Array.isArray(value) ? value as Block[] : [];
    for (const [name, declaration] of fields) {
        if (declaration.kind === 'blocks') for (const block of flatten(blocksOf(record[name]))) for (const value of Object.values(block.data)) if (typeof value === 'string' && value.length <= 80) ids.add(value); else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') ids.add(item);
        if (declaration.media && typeof record[name] === 'string') ids.add(record[name] as string);
    }
    const files = cms.files && ids.size ? await cms.files.getMany([...ids].slice(0, 500)).catch(() => new Map<string, CmsFile>()) : new Map<string, CmsFile>();
    const media = (id: string) => { const file = files.get(id); return file ? `${origin}${mediaUrl(file)}` : null; };
    const mediaAlt = (id: string) => files.get(id)?.alt ?? '';
    const parts: string[] = [];
    for (const [name, declaration] of fields) {
        const value = record[name];
        if (name === 'password' || value === undefined || value === null) continue;
        if (declaration.kind === 'blocks' && !declaration.form) parts.push(blocksMarkdown(blocksOf(value), cms.blockTypes, { media, mediaAlt }));
        else if (declaration.kind === 'richtext' && typeof value === 'object') parts.push(richTextMarkdown(value as RichTextDoc, { media }));
        else if (declaration.kind === 'text' && declaration.format === 'markdown' && typeof value === 'string') parts.push(value);
    }
    const image = resource.fields.featuredImage?.media && typeof record.featuredImage === 'string' ? media(record.featuredImage) : null;
    const owner = record.owner && ARTICLE_TYPES.has(collection.schema?.type ?? 'WebPage') ? (await cms.users.getMany([record.owner])).get(record.owner) : undefined;
    const taxonomyFields = fields.filter(([, declaration]) => declaration.taxonomy);
    const terms = await cms.taxonomies.getMany(taxonomyFields.flatMap(([name]) => Array.isArray(record[name]) ? record[name] as string[] : []));
    const summary = summaryOf(record) || excerptOf(parts.join('\n\n').replace(/[#>*_`]/g, ''), 40);
    return entryMarkdown({
        title: recordTitle(record, 'title'), url: `${origin}${url}`, site: settings['general.siteTitle'], description: summary, author: owner?.name,
        published: typeof record.publishedAt === 'number' ? new Date(record.publishedAt).toISOString() : undefined, updated: new Date(record.updatedAt).toISOString(),
        terms: taxonomyFields.map(([name, declaration]) => ({ label: cms.taxonomies.declaration(declaration.taxonomy!).label, terms: (Array.isArray(record[name]) ? record[name] as string[] : []).map(id => terms.get(id)?.name ?? '').filter(Boolean) })),
        body: [image ? `![${mediaAlt(record.featuredImage as string)}](${image})` : '', ...parts].filter(part => part.trim()).join('\n\n'),
    });
}

function flatten(blocks: readonly Block[]): Block[] {
    return blocks.flatMap(block => [block, ...flatten(block.children ?? [])]);
}
