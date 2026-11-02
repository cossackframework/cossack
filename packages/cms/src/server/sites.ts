/**
 * The site registry on the network database. Each added site has its own database, named by
 * `database`, and answers on its domains: one primary, the rest aliases that redirect to it.
 * The main site is the network database itself; it has no row, but may own domains.
 */
import { ClientError, type RomeDB, type Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { inList } from './users';

/** The main site: the network database, with no registry row. */
export const MAIN_SITE = 'main';

export type SiteStatus = 'creating' | 'active' | 'archived' | 'deleted';

export interface SiteDomain {
    /** A host name without port, lowercase, such as `blog.example.com`. */
    readonly host: string;
    readonly primary: boolean;
    /** When the domain answered its check; null until then. */
    readonly verifiedAt: number | null;
}

export interface SiteRecord {
    readonly id: string;
    readonly name: string;
    /** The site database's ID with its provider (a file name, or a Cloud database ID). */
    readonly database: string;
    readonly status: SiteStatus;
    /** The last finished creation step, while `status` is `creating`. */
    readonly step: string | null;
    readonly domains: readonly SiteDomain[];
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly deletedAt: number | null;
}

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DATABASE = /^[A-Za-z0-9_-]{1,80}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const STATUSES: readonly SiteStatus[] = ['creating', 'active', 'archived', 'deleted'];
const COLUMNS = 'id, name, database, status, step, created_at, updated_at, deleted_at';
const WRITE = { kind: 'cms.sites', retryConflicts: 5 } as const;

/** A host as the registry stores it: lowercase, without port or trailing dot. Empty when invalid. */
export function siteHost(host: string): string {
    const name = String(host ?? '').trim().toLowerCase().replace(/^\[[^\]]*\]/, '').replace(/:\d+$/, '').replace(/\.$/, '');
    return HOST.test(name) ? name : '';
}

export class CmsSites {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** Added sites, deleted ones included: zero while the network is only the main site. */
    async count(): Promise<number> {
        const result = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_sites' }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    async get(id: string): Promise<SiteRecord | null> {
        if (!ID.test(id) || id === MAIN_SITE) return null;
        return (await this.#many([id]))[0] ?? null;
    }

    /** Newest first. `search` matches the name or a domain. */
    async list(options: { search?: string; status?: SiteStatus; limit?: number; offset?: number } = {}): Promise<{ items: SiteRecord[]; total: number }> {
        const conditions: string[] = [];
        const params: { [key: string]: Value } = {};
        if (options.search?.trim()) {
            conditions.push("(lower(name) LIKE $q ESCAPE '\\' OR id IN (SELECT site_id FROM cms_site_domains WHERE host LIKE $q ESCAPE '\\'))");
            params.$q = `%${options.search.trim().toLowerCase().slice(0, 100).replace(/[\\%_]/g, character => `\\${character}`)}%`;
        }
        if (options.status) { conditions.push('status = $status'); params.$status = options.status; }
        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.#db.read([
            { rql: `SELECT id FROM cms_sites${where} ORDER BY created_at DESC, id LIMIT $limit OFFSET $offset`, params: { ...params, $limit: Math.min(Math.max(options.limit ?? 20, 1), 100), $offset: Math.max(options.offset ?? 0, 0) } },
            { rql: `SELECT count(*) FROM cms_sites${where}`, params },
        ]);
        return { items: await this.#many(result.results[0]!.rows.map(row => row[0] as string)), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    /** Active and archived sites in ID order, starting after `after` and wrapping around: scheduled work visits them in turn. */
    async inTurn(after: string, limit = 50): Promise<SiteRecord[]> {
        const result = await this.#db.read([{ rql: "SELECT id FROM cms_sites WHERE status IN ('active', 'archived') ORDER BY id <= $after, id LIMIT $limit",
            params: { $after: after, $limit: Math.min(Math.max(limit, 1), 200) } }]);
        return this.#many(result.results[0]!.rows.map(row => row[0] as string));
    }

    /** The site a host belongs to, `main` for the main site's own domains, or null. */
    async siteOf(host: string): Promise<{ site: string; domain: SiteDomain } | null> {
        const name = siteHost(host);
        if (!name) return null;
        const result = await this.#db.read([{ rql: 'SELECT site_id, host, is_primary, verified_at FROM cms_site_domains WHERE host = $host', params: { $host: name } }]);
        const row = result.results[0]!.rows[0];
        return row ? { site: row[0] as string, domain: domainOf(row.slice(1)) } : null;
    }

    /**
     * Register a site and its domains in one write. The first domain is primary unless one
     * says otherwise. A domain another site has is a conflict.
     */
    async create(input: { id: string; name: string; database: string; status?: SiteStatus; step?: string | null; domains: readonly { host: string; primary?: boolean; verifiedAt?: number | null }[] }): Promise<SiteRecord> {
        if (!ID.test(input.id) || input.id === MAIN_SITE) throw new CmsError('CMS_VALIDATION', 'Site IDs are lowercase letters, digits and hyphens.', { fields: { id: 'is invalid.' } });
        if (!DATABASE.test(input.database)) throw new CmsError('CMS_VALIDATION', 'Invalid database ID.');
        checkName(input.name);
        const status = input.status ?? 'active';
        if (!STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown site status.');
        const domains = checkDomains(input.domains);
        const now = this.#now();
        try {
            await this.#db.write([
                { rql: 'INSERT INTO cms_sites (id, name, database, status, step, created_at, updated_at) VALUES ($id, $name, $database, $status, $step, $now, $now)',
                    params: { $id: input.id, $name: input.name.trim(), $database: input.database, $status: status, $step: input.step ?? null, $now: now } },
                ...domains.map(domain => ({ rql: 'INSERT INTO cms_site_domains (host, site_id, is_primary, verified_at, created_at) VALUES ($host, $site, $primary, $verified, $now)',
                    params: { $host: domain.host, $site: input.id, $primary: domain.primary ? 1 : 0, $verified: domain.verifiedAt, $now: now } })),
            ], WRITE);
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|PRIMARY/i.test(error.message)) {
                throw new CmsError('CMS_CONFLICT', /cms_sites\.database/.test(error.message) ? 'Another site uses this database.' : /cms_sites/.test(error.message) ? 'A site with this ID exists.' : 'Another site answers on this domain.');
            }
            throw error;
        }
        return (await this.get(input.id))!;
    }

    /** Change the name, status or creation step. A deleted site records when it was deleted. */
    async update(id: string, patch: { name?: string; status?: SiteStatus; step?: string | null }): Promise<SiteRecord | null> {
        const current = await this.get(id);
        if (!current) return null;
        if (patch.name !== undefined) checkName(patch.name);
        const status = patch.status ?? current.status;
        if (!STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown site status.');
        const now = this.#now();
        const deletedAt = status === 'deleted' ? current.deletedAt ?? now : null;
        await this.#db.write([{ rql: 'UPDATE cms_sites SET name = $name, status = $status, step = $step, deleted_at = $deleted, updated_at = $now WHERE id = $id',
            params: { $id: id, $name: (patch.name ?? current.name).trim(), $status: status, $step: patch.step === undefined ? current.step : patch.step, $deleted: deletedAt, $now: now } }], WRITE);
        return this.get(id);
    }

    async #many(ids: readonly string[]): Promise<SiteRecord[]> {
        if (!ids.length) return [];
        const list = inList('s', ids);
        const result = await this.#db.read([
            { rql: `SELECT ${COLUMNS} FROM cms_sites WHERE id IN ${list.rql}`, params: list.params },
            { rql: `SELECT site_id, host, is_primary, verified_at FROM cms_site_domains WHERE site_id IN ${list.rql} ORDER BY is_primary DESC, host`, params: list.params },
        ]);
        const domains = new Map<string, SiteDomain[]>();
        for (const row of result.results[1]!.rows) {
            const entry = domains.get(row[0] as string) ?? [];
            entry.push(domainOf(row.slice(1)));
            domains.set(row[0] as string, entry);
        }
        const sites = new Map(result.results[0]!.rows.map(row => [row[0] as string, Object.freeze({
            id: row[0] as string, name: row[1] as string, database: row[2] as string, status: row[3] as SiteStatus, step: row[4] as string | null,
            domains: Object.freeze(domains.get(row[0] as string) ?? []), createdAt: Number(row[5] as bigint), updatedAt: Number(row[6] as bigint),
            deletedAt: row[7] === null ? null : Number(row[7] as bigint),
        })]));
        return ids.map(id => sites.get(id)).filter((site): site is SiteRecord => site !== undefined);
    }
}

function domainOf(row: readonly Value[]): SiteDomain {
    return Object.freeze({ host: row[0] as string, primary: Number(row[1] as bigint) === 1, verifiedAt: row[2] === null ? null : Number(row[2] as bigint) });
}

function checkName(name: string): void {
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a site name of at most 120 characters.', { fields: { name: 'is required.' } });
}

function checkDomains(domains: readonly { host: string; primary?: boolean; verifiedAt?: number | null }[]): { host: string; primary: boolean; verifiedAt: number | null }[] {
    if (!domains.length || domains.length > 20) throw new CmsError('CMS_VALIDATION', 'A site needs 1 to 20 domains.', { fields: { domains: 'are required.' } });
    const hosts = domains.map(domain => siteHost(domain.host));
    if (hosts.some(host => !host) || new Set(hosts).size !== hosts.length) throw new CmsError('CMS_VALIDATION', 'Enter each domain once, as a host name such as blog.example.com.', { fields: { domains: 'are invalid.' } });
    const primary = domains.findIndex(domain => domain.primary);
    if (domains.filter(domain => domain.primary).length > 1) throw new CmsError('CMS_VALIDATION', 'A site has one primary domain.', { fields: { domains: 'have two primaries.' } });
    return domains.map((domain, index) => ({ host: hosts[index]!, primary: index === (primary < 0 ? 0 : primary), verifiedAt: domain.verifiedAt ?? null }));
}
