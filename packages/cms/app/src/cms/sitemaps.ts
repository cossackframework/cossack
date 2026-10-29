/**
 * XML sitemaps of the site: the site's own pages (the routes without parameters, such as `/`),
 * 1,000 entries per file for each collection on the site, with their featured images, and one
 * file of term archives per taxonomy. Server-only.
 */
import type { CmsHost } from '@cossackframework/cms/server';

const PER_FILE = 1000;

/** Routes the site serves that are not pages for crawlers: the dashboard, the API, feeds and the sitemaps themselves. */
const NOT_PAGES = [/^\/(?:api|auth|dashboard|preview|media|sitemaps)(?:\/|$)/, /^\/(?:feed|search|robots\.txt|sitemap\.xml|manifest\.webmanifest)$/];

export interface SitemapUrl {
    url: string;
    updatedAt: number | null;
    /** The entry's featured image, for the image sitemap. */
    image?: string;
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
        if (collection.path === null || collection.path === undefined || collection.slug === false || collection.sitemap === false || (collection.publishable === false && collection.visibility !== 'public')) continue;
        const count = await cms.resource(`cms/${collection.name}`).count(collection.publishable === false ? {} : { where: { status: 'published' } }, { principal: { kind: 'anonymous' } });
        for (let page = 1; page <= Math.max(1, Math.ceil(count / PER_FILE)); page++) if (count) files.push(`${collection.name}-${page}.xml`);
    }
    for (const taxonomy of cms.taxonomies.declarations) if (taxonomy.path) files.push(`terms-${taxonomy.name}.xml`);
    return files;
}

/** The URLs of one sitemap file, or null when there is no such file. */
export async function sitemapUrls(cms: CmsHost, file: string, options: { readonly pages?: readonly string[] } = {}): Promise<SitemapUrl[] | null> {
    if (file === 'site.xml') return options.pages?.length ? options.pages.map(url => ({ url, updatedAt: null })) : null;
    const terms = /^terms-([a-z][a-zA-Z0-9]{0,40})\.xml$/.exec(file);
    if (terms) {
        const taxonomy = cms.taxonomies.declarations.find(entry => entry.name === terms[1]);
        if (!taxonomy?.path) return null;
        const { items } = await cms.taxonomies.list(taxonomy.name, { limit: 200 });
        return items.map(term => ({ url: `/${taxonomy.path}/${term.slug}`, updatedAt: term.updatedAt }));
    }
    const entries = /^([a-z][a-z0-9_]{0,40})-(\d{1,4})\.xml$/.exec(file);
    if (!entries) return null;
    const page = Number(entries[2]);
    if (page < 1) return null;
    try { cms.collection(entries[1]!); } catch { return null; }
    const urls = await cms.sitemapEntries(entries[1]!, { offset: (page - 1) * PER_FILE, limit: PER_FILE });
    return page === 1 || urls.length ? urls : null;
}
