/**
 * The cache headers of the site's anonymous responses: how long the caches in front of the site
 * may hold them (Settings → Cache → Hold pages, a day once a purger is configured) and the tags
 * a change purges (`Cache-Tag`). A response that said `private, no-store` first keeps it; a
 * signed-in user's page is made private by the framework after the page. Server-only.
 */
import type { Context } from 'hono';
import { cacheControl, cacheTagHeader, type RenderedBlock } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

export interface CacheHeaders { 'cache-control': string; 'cache-tag': string }

/** The headers of an anonymous response showing what `tags` name; `max` caps the hold (a not-found page is held a minute). */
export async function cacheHeaders(cms: CmsHost, tags: Iterable<string>, options: { max?: number } = {}): Promise<CacheHeaders> {
    const hold = await cms.settings.get('cache.hold');
    return {
        'cache-control': cacheControl(hold, { purging: cms.purge.configured, ...(options.max !== undefined ? { max: options.max } : {}) }),
        'cache-tag': cacheTagHeader([cms.purge.tag.site(), ...tags]),
    };
}

/** Set the headers on a page's response, unless the page already made it private. */
export async function applyCacheHeaders(c: Context, cms: CmsHost, tags: Iterable<string>, options: { max?: number } = {}): Promise<void> {
    if (c.res.headers.has('cache-control')) return;
    const headers = await cacheHeaders(cms, tags, options);
    c.header('cache-control', headers['cache-control']);
    c.header('cache-tag', headers['cache-tag']);
}

/** Blocks that list a collection's entries, so a page showing one changes when the collection does. */
const LISTING_BLOCKS = new Set(['core/latest-entries']);

/** The collections listed by blocks (Latest entries) anywhere in these trees. */
export function listedCollections(blocks: Iterable<RenderedBlock>): Set<string> {
    const found = new Set<string>();
    const walk = (list: Iterable<RenderedBlock>) => {
        for (const block of list) {
            if (LISTING_BLOCKS.has(block.type) && typeof block.data.collection === 'string' && block.data.collection) found.add(block.data.collection);
            if (block.children) walk(block.children);
        }
    };
    walk(blocks);
    return found;
}
