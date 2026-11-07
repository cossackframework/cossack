/**
 * Syndication feeds: RSS 2.0, Atom and JSON Feed of a collection's published entries, the whole
 * collection or one term's, sized and filled by Settings → Reading. Audio blocks become
 * enclosures (RSS) and attachments (JSON Feed), so a feed of a podcast collection plays.
 */
import { ANONYMOUS, blocksPlain, entryUrl, isCmsError, recordTitle, richTextExcerpt, richTextHtml, richTextPlain, type Block, type CollectionDefinition, type RichTextDoc } from '@cossackframework/cms';
import { renderMarkdown, excerptOf, type CmsHost, type CmsFile } from '@cossackframework/cms/server';
import { blocksHtml } from './content';
import { cacheHeaders } from './cache';

export type FeedFormat = 'rss' | 'atom' | 'json';

export interface FeedItem {
    readonly id: string;
    readonly title: string;
    readonly link: string;
    readonly publishedAt: number;
    readonly updatedAt: number;
    readonly summary: string;
    readonly html: string;
    readonly authors: readonly string[];
    readonly enclosure: { readonly url: string; readonly type: string; readonly size: number } | null;
}

export interface Feed {
    readonly title: string;
    readonly description: string;
    readonly home: string;
    readonly self: string;
    readonly items: readonly FeedItem[];
}

const escape = (text: string) => text.replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
const cdata = (text: string) => `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

/** Which collection and term a feed path names, or null when the path names nothing: `/feed`, `/feed/atom`, `/feed/<collection>`, `/feed/<collection>/json`. */
export function feedTarget(cms: CmsHost, segments: readonly string[]): { collection: CollectionDefinition; format: FeedFormat } | null {
    const rest = [...segments];
    let format: FeedFormat = 'rss';
    if (rest.length && ['rss', 'atom', 'json'].includes(rest[rest.length - 1]!)) format = rest.pop() as FeedFormat;
    if (rest.length > 1) return null;
    const name = rest[0] ?? 'posts';
    const collection = cms.collections().find(entry => entry.name === name && entry.publishable !== false && !entry.managed && typeof entry.path === 'string');
    return collection ? { collection, format } : null;
}

/** The feed's entries: the newest published of the collection, of one term when `term` names a slug of one of its taxonomies. */
export async function buildFeed(cms: CmsHost, options: { collection: CollectionDefinition; origin: string; self: string; term?: string | null }): Promise<Feed> {
    const { collection, origin } = options;
    const settings = await cms.settings.all();
    const resource = cms.resource(`cms/${collection.name}`);
    const where: { [field: string]: unknown } = { status: 'published' };
    let title = settings['general.siteTitle'];
    let description = settings['general.tagline'];
    if (collection.name !== 'posts') { title = `${title} · ${collection.label}`; description = collection.description || description; }
    if (options.term) {
        let matched = false;
        for (const name of collection.taxonomies ?? []) {
            const term = await cms.taxonomies.bySlug(name, options.term).catch(() => null);
            if (!term) continue;
            where[name] = { containsAny: (await cms.taxonomies.subtree(term.id)).slice(0, 50) };
            title = `${title} · ${term.name}`;
            matched = true;
            break;
        }
        if (!matched) return { title, description, home: `${origin}/`, self: options.self, items: [] };
    }
    const page = await resource.list({ where: where as never, order: { field: 'publishedAt', direction: 'desc' }, limit: settings['reading.feedItems'] }, { principal: ANONYMOUS });
    const blocksOf = (record: Record<string, unknown>) => Array.isArray(record.content) ? record.content as Block[] : [];
    const mediaIds = new Set<string>();
    for (const record of page.records) for (const block of flat(blocksOf(record))) {
        for (const value of Object.values(block.data)) if (typeof value === 'string' && value) mediaIds.add(value);
    }
    const files: Map<string, CmsFile> = cms.files ? await cms.files.getMany([...mediaIds]) : new Map();
    const authors = await cms.users.getMany([...new Set(page.records.flatMap(record => Array.isArray(record.authors) ? record.authors as string[] : []))]);
    const items = page.records.map((record): FeedItem => {
        const blocks = blocksOf(record);
        const doc = !blocks.length && record.body && typeof record.body === 'object' ? record.body as RichTextDoc : null;
        const markdown = typeof record.body === 'string' ? record.body : '';
        const full = blocks.length ? blocksHtml(cms, blocks, files) : doc ? richTextHtml(doc, { block: () => '' }) : renderMarkdown(markdown);
        const summary = String(record.excerpt || record.summary || (blocks.length ? excerptOf(blocksPlain(blocks, cms.blockTypes, entry => richTextPlain(entry), 4000), 55) : doc ? richTextExcerpt(doc) : excerptOf(markdown, 55)));
        const audio = flat(blocks).find(block => block.type === 'core/audio');
        const file = audio && typeof audio.data.audio === 'string' ? files.get(audio.data.audio) : undefined;
        return {
            id: record.id, title: recordTitle(record, 'title'), link: `${origin}${entryUrl(collection.path ?? collection.name, [String(record.slug)])}`,
            publishedAt: Number(record.publishedAt), updatedAt: Number(record.updatedAt ?? record.publishedAt), summary, html: settings['reading.feedContent'] === 'full' ? full : '',
            authors: (Array.isArray(record.authors) ? record.authors as string[] : []).map(id => authors.get(id)?.name ?? '').filter(Boolean),
            enclosure: file ? { url: `${origin}/media/${file.id}/${encodeURIComponent(file.name)}`, type: file.contentType, size: file.size } : null,
        };
    });
    return { title, description, home: `${origin}/`, self: options.self, items };
}

function flat(blocks: readonly Block[]): Block[] {
    return blocks.flatMap(block => [block, ...flat(block.children ?? [])]);
}

/** The feed as text with its content type. */
export function renderFeed(feed: Feed, format: FeedFormat): { body: string; contentType: string } {
    if (format === 'json') {
        return { contentType: 'application/feed+json; charset=utf-8', body: JSON.stringify({
            version: 'https://jsonfeed.org/version/1.1', title: feed.title, description: feed.description, home_page_url: feed.home, feed_url: feed.self,
            items: feed.items.map(item => ({
                id: item.link, url: item.link, title: item.title, date_published: new Date(item.publishedAt).toISOString(), date_modified: new Date(item.updatedAt).toISOString(),
                summary: item.summary, ...(item.html ? { content_html: item.html } : { content_text: item.summary }),
                ...(item.authors.length ? { authors: item.authors.map(name => ({ name })) } : {}),
                ...(item.enclosure ? { attachments: [{ url: item.enclosure.url, mime_type: item.enclosure.type, size_in_bytes: item.enclosure.size }] } : {}),
            })),
        }, null, 1) };
    }
    if (format === 'atom') {
        const updated = feed.items.length ? Math.max(...feed.items.map(item => item.updatedAt)) : Date.now();
        const entries = feed.items.map(item => `<entry><title>${escape(item.title)}</title><link href="${escape(item.link)}"/><id>${escape(item.link)}</id>`
            + `<published>${new Date(item.publishedAt).toISOString()}</published><updated>${new Date(item.updatedAt).toISOString()}</updated>`
            + item.authors.map(name => `<author><name>${escape(name)}</name></author>`).join('')
            + `<summary>${escape(item.summary)}</summary>${item.html ? `<content type="html">${escape(item.html)}</content>` : ''}`
            + (item.enclosure ? `<link rel="enclosure" href="${escape(item.enclosure.url)}" type="${escape(item.enclosure.type)}" length="${item.enclosure.size}"/>` : '') + '</entry>').join('');
        return { contentType: 'application/atom+xml; charset=utf-8', body: `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>${escape(feed.title)}</title><subtitle>${escape(feed.description)}</subtitle>`
            + `<link href="${escape(feed.home)}"/><link rel="self" href="${escape(feed.self)}"/><id>${escape(feed.self)}</id><updated>${new Date(updated).toISOString()}</updated>${entries}</feed>\n` };
    }
    const items = feed.items.map(item => `<item><title>${escape(item.title)}</title><link>${escape(item.link)}</link><guid isPermaLink="true">${escape(item.link)}</guid>`
        + `<pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate><description>${item.html ? cdata(item.html) : escape(item.summary)}</description>`
        + item.authors.map(name => `<dc:creator>${escape(name)}</dc:creator>`).join('')
        + (item.enclosure ? `<enclosure url="${escape(item.enclosure.url)}" type="${escape(item.enclosure.type)}" length="${item.enclosure.size}"/>` : '') + '</item>').join('');
    return { contentType: 'application/rss+xml; charset=utf-8', body: `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${escape(feed.title)}</title><link>${escape(feed.home)}</link>`
        + `<atom:link href="${escape(feed.self)}" rel="self" type="application/rss+xml"/><description>${escape(feed.description)}</description>${items}</channel></rss>\n` };
}

/** Answer a feed request, or 404 for a path that names no collection. */
export async function feedResponse(cms: CmsHost, request: Request, segments: readonly string[]): Promise<Response> {
    const target = feedTarget(cms, segments);
    if (!target) return new Response('Not found', { status: 404 });
    const url = new URL(request.url);
    try {
        const feed = await buildFeed(cms, { collection: target.collection, origin: url.origin, self: url.origin + url.pathname + url.search, term: url.searchParams.get('term') });
        const { body, contentType } = renderFeed(feed, target.format);
        return new Response(body, { headers: { 'content-type': contentType, ...await cacheHeaders(cms, [cms.purge.tag.collection(target.collection.name)]) } });
    } catch (error) {
        if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
        return new Response('Not available yet', { status: 503 });
    }
}
