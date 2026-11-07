/**
 * What crawlers fetch and what visitors miss: one row per day, crawler and page kind, and one
 * row per path that answered 404. Only known crawlers are counted, so browsers never write;
 * the Health page reads both to show whether engines fetch the site and what to redirect.
 */
import { ClientError, type RomeDB } from '@cossackframework/romedb';
import { crawlerOf } from '../seo';
import { sha256Hex } from './tokens';

export type VisitKind = 'entry' | 'archive' | 'home' | 'term' | 'author' | 'search' | 'markdown' | 'llms' | 'sitemap' | 'robots' | 'feed' | 'not-found' | 'other';

export interface CrawlerVisits {
    readonly agent: string;
    readonly group: string;
    readonly total: number;
    readonly byKind: { readonly [kind: string]: number };
    /** The last day with a visit, as `YYYY-MM-DD`. */
    readonly lastDay: string;
}

/** Page views over a period: by day, the top pages, the referring sites, and the totals. */
export interface ViewsReport {
    readonly days: readonly { readonly day: string; readonly views: number; readonly visitors: number }[];
    readonly pages: readonly { readonly path: string; readonly views: number }[];
    readonly referrers: readonly { readonly host: string; readonly count: number }[];
    readonly views: number;
    readonly visitors: number;
}

export interface NotFoundRow {
    readonly path: string;
    readonly hits: number;
    readonly firstAt: number;
    readonly lastHitAt: number;
    readonly referrer: string;
}

const WRITE = { kind: 'cms.traffic', retryConflicts: 3 } as const;
const PATH = /^\/[^\s]{0,499}$/;
/** Probes for other software, not pages a reader missed. */
const NOISE = /\.(?:php|asp|aspx|env|git|sql|bak|xml|json|js|css|map|ico|png|jpe?g|gif|svg|woff2?|ttf)$|^\/(?:wp-|xmlrpc|\.well-known|cgi-bin|vendor\/|admin\/|phpmyadmin)/i;

export class CmsTraffic {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** The crawler a user agent belongs to, or null for browsers and unknown agents. */
    static crawler(userAgent: string | null | undefined): { agent: string; group: string } | null {
        return crawlerOf(userAgent ?? '');
    }

    /** Count a request by a known crawler; anything else is ignored. Returns whether a row was written. */
    async recordVisit(userAgent: string | null | undefined, kind: VisitKind): Promise<boolean> {
        const crawler = crawlerOf(userAgent ?? '');
        if (!crawler) return false;
        const day = new Date(this.#now()).toISOString().slice(0, 10);
        await this.#db.write([{
            rql: 'INSERT INTO cms_crawler_visits (day, agent, grp, kind, count) VALUES ($day, $agent, $group, $kind, 1) ON CONFLICT (day, agent, kind) DO UPDATE SET count = count + 1',
            params: { $day: day, $agent: crawler.agent, $group: crawler.group, $kind: kind },
        }], WRITE).catch(swallowMissing);
        return true;
    }

    /**
     * Count a page view from the beacon: the path's views for the day, the day's visitor once (the
     * hash of address, browser and day, so no row names a person or lasts past the day), and the
     * referring host when it is another site. Paths that are not pages are ignored.
     */
    async recordView(input: { path: string; referrer: string; visitor: string; origin: string }): Promise<boolean> {
        const path = input.path.replace(/[?#].*$/, '');
        if (!PATH.test(path) || NOISE.test(path) || /^\/(?:dashboard|auth|api)(?:\/|$)/.test(path)) return false;
        const day = new Date(this.#now()).toISOString().slice(0, 10);
        const hash = (await sha256Hex(`${day}|${input.visitor}`)).slice(0, 32);
        let host = '';
        try { const url = new URL(input.referrer); if (url.origin !== input.origin && /^https?:$/.test(url.protocol)) host = url.hostname.replace(/^www\./, '').slice(0, 120); } catch { /* no referrer */ }
        await this.#db.write([
            { rql: 'INSERT INTO cms_views (day, path, views) VALUES ($day, $path, 1) ON CONFLICT (day, path) DO UPDATE SET views = views + 1', params: { $day: day, $path: path } },
            { rql: 'INSERT INTO cms_visitors (day, hash) VALUES ($day, $hash) ON CONFLICT (day, hash) DO NOTHING', params: { $day: day, $hash: hash } },
            ...(host ? [{ rql: 'INSERT INTO cms_referrers (day, host, count) VALUES ($day, $host, 1) ON CONFLICT (day, host) DO UPDATE SET count = count + 1', params: { $day: day, $host: host } }] : []),
        ], WRITE).catch(swallowMissing);
        return true;
    }

    /** Views and visitors by day over the last `days`, the top pages and referrers of that period. */
    async views(days = 30): Promise<ViewsReport> {
        const since = new Date(this.#now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
        const result = await this.#db.read([
            { rql: 'SELECT day, sum(views) FROM cms_views WHERE day >= $since GROUP BY day ORDER BY day LIMIT 400', params: { $since: since } },
            { rql: 'SELECT day, count(*) FROM cms_visitors WHERE day >= $since GROUP BY day ORDER BY day LIMIT 400', params: { $since: since } },
            { rql: 'SELECT path, sum(views) AS total FROM cms_views WHERE day >= $since GROUP BY path ORDER BY total DESC LIMIT 20', params: { $since: since } },
            { rql: 'SELECT host, sum(count) AS total FROM cms_referrers WHERE day >= $since GROUP BY host ORDER BY total DESC LIMIT 20', params: { $since: since } },
        ]).catch(error => { swallowMissing(error); return null; });
        if (!result) return { days: [], pages: [], referrers: [], views: 0, visitors: 0 };
        const visitors = new Map(result.results[1]!.rows.map(row => [row[0] as string, Number(row[1] as bigint)]));
        const byDay = result.results[0]!.rows.map(row => ({ day: row[0] as string, views: Number(row[1] as bigint), visitors: visitors.get(row[0] as string) ?? 0 }));
        return {
            days: byDay,
            pages: result.results[2]!.rows.map(row => ({ path: row[0] as string, views: Number(row[1] as bigint) })),
            referrers: result.results[3]!.rows.map(row => ({ host: row[0] as string, count: Number(row[1] as bigint) })),
            views: byDay.reduce((sum, day) => sum + day.views, 0),
            visitors: [...visitors.values()].reduce((sum, count) => sum + count, 0),
        };
    }

    /** Visits per crawler over the last `days`, most active first. */
    async visits(days = 14): Promise<CrawlerVisits[]> {
        const since = new Date(this.#now() - days * 86_400_000).toISOString().slice(0, 10);
        const result = await this.#db.read([{ rql: 'SELECT agent, grp, kind, sum(count), max(day) FROM cms_crawler_visits WHERE day >= $since GROUP BY agent, grp, kind LIMIT 2000', params: { $since: since } }]).catch(swallowMissing);
        const byAgent = new Map<string, { agent: string; group: string; total: number; byKind: { [kind: string]: number }; lastDay: string }>();
        for (const [agent, group, kind, count, lastDay] of result?.results[0]?.rows ?? []) {
            const entry = byAgent.get(agent as string) ?? { agent: agent as string, group: group as string, total: 0, byKind: {}, lastDay: '' };
            const n = Number(count as bigint);
            entry.total += n;
            entry.byKind[kind as string] = (entry.byKind[kind as string] ?? 0) + n;
            if (String(lastDay) > entry.lastDay) entry.lastDay = String(lastDay);
            byAgent.set(agent as string, entry);
        }
        return [...byAgent.values()].sort((a, b) => b.total - a.total);
    }

    /** Record a page path that answered 404, with the referrer that led there. Probes for other software are skipped. */
    async recordNotFound(path: string, referrer?: string | null): Promise<boolean> {
        const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
        if (!PATH.test(clean) || NOISE.test(clean)) return false;
        const now = this.#now();
        const from = typeof referrer === 'string' && /^https?:\/\//.test(referrer) ? referrer.slice(0, 500) : '';
        await this.#db.write([{
            rql: 'INSERT INTO cms_not_found (path, hits, first_at, last_hit_at, referrer) VALUES ($path, 1, $now, $now, $referrer) ON CONFLICT (path) DO UPDATE SET hits = hits + 1, last_hit_at = excluded.last_hit_at, referrer = CASE WHEN excluded.referrer = \'\' THEN referrer ELSE excluded.referrer END',
            params: { $path: clean, $now: now, $referrer: from },
        }], WRITE).catch(swallowMissing);
        return true;
    }

    /** Missing paths, most hit first. */
    async notFound(options: { limit?: number } = {}): Promise<NotFoundRow[]> {
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
        const result = await this.#db.read([{ rql: 'SELECT path, hits, first_at, last_hit_at, referrer FROM cms_not_found ORDER BY hits DESC, last_hit_at DESC LIMIT $limit', params: { $limit: limit } }]).catch(swallowMissing);
        return (result?.results[0]?.rows ?? []).map(([path, hits, firstAt, lastHitAt, referrer]) => ({ path: path as string, hits: Number(hits as bigint), firstAt: Number(firstAt as bigint), lastHitAt: Number(lastHitAt as bigint), referrer: (referrer as string) ?? '' }));
    }

    /** Forget a missing path, after a redirect was made for it. */
    async forgetNotFound(path: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_not_found WHERE path = $path', params: { $path: path } }], WRITE).catch(swallowMissing);
    }

    /** Drop visit rows older than 90 days and rarely hit missing paths older than 30 days. */
    async prune(): Promise<void> {
        const views = new Date(this.#now() - 365 * 86_400_000).toISOString().slice(0, 10);
        const visitors = new Date(this.#now() - 8 * 86_400_000).toISOString().slice(0, 10);
        await this.#db.write([
            { rql: 'DELETE FROM cms_views WHERE day < $day', params: { $day: views } },
            { rql: 'DELETE FROM cms_referrers WHERE day < $day', params: { $day: views } },
            { rql: 'DELETE FROM cms_visitors WHERE day < $day', params: { $day: visitors } },
        ], WRITE).catch(swallowMissing);
        const now = this.#now();
        const day = new Date(now - 90 * 86_400_000).toISOString().slice(0, 10);
        const old = await this.#db.read([
            { rql: 'SELECT 1 FROM cms_crawler_visits WHERE day < $day LIMIT 1', params: { $day: day } },
            { rql: 'SELECT 1 FROM cms_not_found WHERE last_hit_at < $before AND hits < 3 LIMIT 1', params: { $before: now - 30 * 86_400_000 } },
        ]).catch(swallowMissing);
        if (!old) return;
        if (old.results[0]!.rows.length) await this.#db.write([{ rql: 'DELETE FROM cms_crawler_visits WHERE day < $day', params: { $day: day } }], WRITE);
        if (old.results[1]!.rows.length) await this.#db.write([{ rql: 'DELETE FROM cms_not_found WHERE last_hit_at < $before AND hits < 3', params: { $before: now - 30 * 86_400_000 } }], WRITE);
    }
}

/** Before the tables exist (an upgrade not applied yet), counting is skipped. */
function swallowMissing(error: unknown): undefined {
    if (error instanceof ClientError && /cms_crawler_visits|cms_not_found|no such table|not found/i.test(error.message)) return undefined;
    throw error;
}
