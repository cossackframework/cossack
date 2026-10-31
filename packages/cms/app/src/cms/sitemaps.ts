/**
 * XML sitemaps of the site: the site's own pages (the routes without parameters, such as `/`),
 * 1,000 entries per file for each collection on the site, with their featured images, and one
 * file of term archives per taxonomy. Server-only.
 */
import { ANONYMOUS, ARTICLE_TYPES, authorUrl } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

const PER_FILE = 1000;

/** Routes the site serves that are not pages for crawlers: the dashboard, the API, feeds and the sitemaps themselves. */
const NOT_PAGES = [/^\/(?:api|auth|dashboard|preview|media|sitemaps|indexnow)(?:\/|$)/, /^\/(?:feed|search|robots\.txt|sitemap\.xml|llms\.txt|manifest\.webmanifest)$/];
/** How long an article counts as news for the news sitemap. */
const NEWS_WINDOW = 48 * 3600 * 1000;

export interface SitemapUrl {
    url: string;
    updatedAt: number | null;
    /** The entry's featured image, for the image sitemap. */
    image?: string;
    /** The page in each language, itself included, plus `x-default`; only on multilingual sites. */
    alternates?: { hreflang: string; href: string }[];
    /** News sitemap: the article's title, language and publication time. */
    news?: { title: string; language: string; publishedAt: number };
}

/**
 * The site's own pages among its page files (the keys of `virtual:cossack-pages`, such as
 * `/src/pages/(site)/index.ts`): those without parameters, the dashboard, the API and the
 * machine-read files left out, as paths.
 */
export function staticPages(files: readonly string[]): string[] {
    const paths = files.filter(file => !file.includes('[')).map(file => {
        const path = file.replace('/src/pages/', '/').replace(/\/index\.(ts|mdx?)$/, '').replace(/\.(ts|mdx?)$/, '').replace(/\/\([^)]+\)/g, '');
        return path === '' || path === '/index' ? '/' : path;
    });
    return [...new Set(paths.filter(path => !NOT_PAGES.some(rule => rule.test(path))))].sort();
}

export function xmlEscape(text: string): string {
    return text.replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
}

/** The sitemap files to list in the index: `site.xml` for the site's own pages, then `posts-1.xml`, `terms-categories.xml` and the like. */
export async function sitemapFiles(cms: CmsHost, options: { readonly pages?: readonly string[] } = {}): Promise<string[]> {
    const files: string[] = [];
    if (options.pages?.length) files.push('site.xml');
    for (const collection of cms.collections()) {
        if (collection.path === null || collection.path === undefined || collection.slug === false || collection.sitemap === false || collection.robots?.noindex || (collection.publishable === false && collection.visibility !== 'public')) continue;
        const count = await cms.resource(`cms/${collection.name}`).count(collection.publishable === false ? {} : { where: { status: 'published' } }, { principal: { kind: 'anonymous' } });
        for (let page = 1; page <= Math.max(1, Math.ceil(count / PER_FILE)); page++) if (count) files.push(`${collection.name}-${page}.xml`);
    }
    for (const taxonomy of cms.taxonomies.declarations) if (taxonomy.path && !taxonomy.noindex) files.push(`terms-${taxonomy.name}.xml`);
    if (await cms.settings.get('seo.authorPages') && (await cms.users.authors({ limit: 1 })).length) files.push('authors.xml');
    if ((await newsUrls(cms)).length) files.push('news.xml');
    return files;
}

/** Google News: articles of `NewsArticle` collections published in the last two days, newest first, at most 1,000. */
async function newsUrls(cms: CmsHost): Promise<SitemapUrl[]> {
    const collections = cms.collections().filter(collection => collection.schema?.type === 'NewsArticle' && typeof collection.path === 'string' && collection.publishable !== false && collection.sitemap !== false && !collection.robots?.noindex);
    if (!collections.length) return [];
    const languages = await cms.languages();
    const since = Date.now() - NEWS_WINDOW;
    const urls: SitemapUrl[] = [];
    for (const collection of collections) {
        const page = await cms.resource(`cms/${collection.name}`).list({ where: { status: 'published', publishedAt: { gte: since } }, order: { field: 'publishedAt', direction: 'desc' }, limit: 100 }, { principal: ANONYMOUS }).catch(() => ({ records: [] }));
        const records = page.records.filter(record => !(record.seo as { noindex?: boolean } | null)?.noindex);
        const found = await cms.entryUrls(collection, records);
        for (const record of records) {
            const url = found.get(record.id);
            if (url) urls.push({ url, updatedAt: record.updatedAt, news: { title: String(record.title ?? ''), language: typeof record.locale === 'string' ? record.locale : languages.default, publishedAt: Number(record.publishedAt) } });
        }
    }
    return urls.sort((a, b) => b.news!.publishedAt - a.news!.publishedAt).slice(0, 1000);
}

/** Language alternates of the entries of one sitemap file, grouped by translation group. */
function withAlternates(urls: readonly { id: string; url: string; locale: string | null; translationGroup: string | null }[], languages: { multilingual: boolean; default: string }): Map<string, { hreflang: string; href: string }[]> {
    const alternates = new Map<string, { hreflang: string; href: string }[]>();
    if (!languages.multilingual) return alternates;
    const groups = new Map<string, { id: string; url: string; locale: string }[]>();
    for (const entry of urls) {
        const key = entry.translationGroup ?? entry.id;
        groups.set(key, [...(groups.get(key) ?? []), { id: entry.id, url: entry.url, locale: entry.locale ?? languages.default }]);
    }
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        const links = members.map(member => ({ hreflang: member.locale, href: member.url }));
        const fallback = members.find(member => member.locale === languages.default) ?? members[0]!;
        for (const member of members) alternates.set(member.id, [...links, { hreflang: 'x-default', href: fallback.url }]);
    }
    return alternates;
}

/** Author pages: active users with a slug who own a published article. */
async function authorUrls(cms: CmsHost): Promise<SitemapUrl[]> {
    const urls: SitemapUrl[] = [];
    const collections = cms.collections().filter(collection => typeof collection.path === 'string' && collection.publishable !== false && ARTICLE_TYPES.has(collection.schema?.type ?? 'WebPage'));
    for (const user of await cms.users.authors({ limit: 1000 })) {
        let count = 0;
        for (const collection of collections) count += await cms.resource(`cms/${collection.name}`).count({ where: { status: 'published' }, owner: user.id }, { principal: ANONYMOUS }).catch(() => 0);
        if (count) urls.push({ url: authorUrl(user.slug)!, updatedAt: null });
    }
    return urls;
}

/** The URLs of one sitemap file, or null when there is no such file. */
export async function sitemapUrls(cms: CmsHost, file: string, options: { readonly pages?: readonly string[] } = {}): Promise<SitemapUrl[] | null> {
    if (file === 'site.xml') return options.pages?.length ? options.pages.map(url => ({ url, updatedAt: null })) : null;
    if (file === 'authors.xml') return await cms.settings.get('seo.authorPages') ? authorUrls(cms) : null;
    if (file === 'news.xml') { const urls = await newsUrls(cms); return urls.length ? urls : null; }
    const terms = /^terms-([a-z][a-zA-Z0-9]{0,40})\.xml$/.exec(file);
    if (terms) {
        const taxonomy = cms.taxonomies.declarations.find(entry => entry.name === terms[1]);
        if (!taxonomy?.path || taxonomy.noindex) return null;
        const { items } = await cms.taxonomies.list(taxonomy.name, { limit: 200 });
        return items.map(term => ({ url: `/${taxonomy.path}/${term.slug}`, updatedAt: term.updatedAt }));
    }
    const entries = /^([a-z][a-z0-9_]{0,40})-(\d{1,4})\.xml$/.exec(file);
    if (!entries) return null;
    const page = Number(entries[2]);
    if (page < 1) return null;
    try { cms.collection(entries[1]!); } catch { return null; }
    const urls = await cms.sitemapEntries(entries[1]!, { offset: (page - 1) * PER_FILE, limit: PER_FILE });
    if (page !== 1 && !urls.length) return null;
    const alternates = withAlternates(urls, await cms.languages());
    return urls.map(entry => ({ url: entry.url, updatedAt: entry.updatedAt, ...(entry.image ? { image: entry.image } : {}), ...(alternates.has(entry.id) ? { alternates: alternates.get(entry.id)! } : {}) }));
}
