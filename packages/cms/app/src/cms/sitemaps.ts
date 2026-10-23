/**
 * XML sitemaps of the site: 1,000 entries per file for each collection on the site, and one
 * file of term archives per taxonomy. Server-only.
 */
import type { CmsHost } from '@cossackframework/cms/server';

const PER_FILE = 1000;

export function xmlEscape(text: string): string {
    return text.replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
}

/** The sitemap files to list in the index, such as `posts-1.xml` and `terms-categories.xml`. */
export async function sitemapFiles(cms: CmsHost): Promise<string[]> {
    const files: string[] = [];
    for (const collection of cms.collections()) {
        if (collection.path === null || collection.path === undefined || collection.slug === false || (collection.publishable === false && collection.visibility !== 'public')) continue;
        const count = await cms.resource(`cms/${collection.name}`).count(collection.publishable === false ? {} : { where: { status: 'published' } }, { principal: { kind: 'anonymous' } });
        for (let page = 1; page <= Math.max(1, Math.ceil(count / PER_FILE)); page++) if (count) files.push(`${collection.name}-${page}.xml`);
    }
    for (const taxonomy of cms.taxonomies.declarations) if (taxonomy.path) files.push(`terms-${taxonomy.name}.xml`);
    return files;
}

/** The URLs of one sitemap file, or null when there is no such file. */
export async function sitemapUrls(cms: CmsHost, file: string): Promise<{ url: string; updatedAt: number | null }[] | null> {
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
