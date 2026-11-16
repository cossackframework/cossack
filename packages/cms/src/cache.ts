/**
 * What the site tells the caches in front of it (Cloudflare with a cache-everything rule, a
 * CDN, a reverse proxy): how long a shared cache may hold an anonymous page, and what the page
 * shows, as `Cache-Tag` values a change purges. The CMS keeps no HTML cache of its own; the
 * host's `purge` service (`server/purge.ts`) sends the purges.
 */

/** How long shared caches may hold a page: Settings → Cache → Hold pages. */
export const CACHE_HOLDS = ['auto', 'none', 'minute', 'hour', 'day', 'week'] as const;
export type CacheHold = (typeof CACHE_HOLDS)[number];

const SECONDS = { minute: 60, hour: 3_600, day: 86_400, week: 604_800 } as const;
/** Without a purger, a change shows within five minutes; with one, the purge is what shows it. */
const AUTO_SECONDS = 300;

/** The seconds a shared cache may hold a page; 0 for none. */
export function cacheHoldSeconds(hold: CacheHold, options: { purging?: boolean } = {}): number {
    if (hold === 'none') return 0;
    if (hold === 'auto') return options.purging ? SECONDS.day : AUTO_SECONDS;
    return SECONDS[hold];
}

/**
 * The `Cache-Control` of an anonymous page. `max-age=0` keeps browsers revalidating, so a purge
 * reaches them at once; `s-maxage` is the shared cache's hold, capped by `max` (a not-found page
 * is held a minute); a minute of `stale-while-revalidate` covers the refill.
 */
export function cacheControl(hold: CacheHold, options: { purging?: boolean; max?: number } = {}): string {
    let seconds = cacheHoldSeconds(hold, options);
    if (options.max !== undefined) seconds = Math.min(seconds, options.max);
    if (seconds <= 0) return 'private, no-store';
    return `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${Math.min(seconds, 60)}`;
}

/** A tag part: ASCII without spaces or commas, which `Cache-Tag` headers separate tags with. */
const part = (value: string): string => value.replace(/[^A-Za-z0-9_.:@-]+/g, '-').slice(0, 120) || '-';

/**
 * Tag names. Every page of a site carries the site's tag, so a change to what every page shows
 * (settings, menus, the theme) purges them all; a zone may serve several sites of a network, so
 * the site is in every tag.
 */
export const cacheTags = {
    site: (site: string): string => `cms:${part(site)}`,
    /** An entry's page and every list that shows the collection's entries. */
    collection: (site: string, collection: string): string => `cms:${part(site)}:c:${part(collection)}`,
    entry: (site: string, collection: string, id: string): string => `cms:${part(site)}:e:${part(collection)}:${part(id)}`,
    term: (site: string, taxonomy: string, slug: string): string => `cms:${part(site)}:t:${part(taxonomy)}:${part(slug)}`,
};

/** The `Cache-Tag` header value: distinct tags, comma-separated. */
export function cacheTagHeader(tags: Iterable<string>): string {
    return [...new Set(tags)].join(',');
}
