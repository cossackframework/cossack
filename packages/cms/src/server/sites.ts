/**
 * A network's sites. Each added site has its own database, named by `database`, and answers
 * on its domains: one primary, the rest aliases that redirect to it. The main site is the
 * network database itself; it has no record, but may own domains. The registry is the
 * application's (`SitesStore`).
 */
import { CmsError } from '../errors';
import { MAIN_SITE } from '../permissions';

/** The main site: the network database, with no registry row. */
export { MAIN_SITE };

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
/** IDs no added site takes: the main site's, and `new`, the dashboard's Add site address. */
export const RESERVED_SITE_IDS: ReadonlySet<string> = new Set([MAIN_SITE, 'new']);
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host as the registry stores it: lowercase, without port or trailing dot. Empty when invalid. */
export function siteHost(host: string): string {
    const name = String(host ?? '').trim().toLowerCase().replace(/^\[[^\]]*\]/, '').replace(/:\d+$/, '').replace(/\.$/, '');
    return HOST.test(name) ? name : '';
}

/**
 * The registry of a network's sites, which the application keeps (the dashboard package's
 * tenants in a CMS project). The main site has no record: it is the network's own database.
 */
export interface SitesStore {
    /** Added sites, deleted ones included: zero while the network is only the main site. */
    count(): Promise<number>;
    get(id: string): Promise<SiteRecord | null>;
    /** The added sites among the IDs; unknown IDs and the main site are left out. */
    getMany(ids: readonly string[]): Promise<SiteRecord[]>;
    /** Newest first. `search` matches the name or a domain. */
    list(options?: { search?: string; status?: SiteStatus; limit?: number; offset?: number }): Promise<{ items: SiteRecord[]; total: number }>;
    /** Active and archived sites in ID order, starting after `after` and wrapping around: scheduled work visits them in turn. */
    inTurn(after: string, limit?: number): Promise<SiteRecord[]>;
    /** The site a host belongs to, `main` for the main site's own domains, or null. */
    siteOf(host: string): Promise<{ site: string; domain: SiteDomain } | null>;
    /** Register a site and its domains. The first domain is primary unless one says otherwise. A domain another site has is a conflict. */
    create(input: { id: string; name: string; database: string; status?: SiteStatus; step?: string | null; domains: readonly { host: string; primary?: boolean; verifiedAt?: number | null }[] }): Promise<SiteRecord>;
    /** Change the name, database, status or creation step. A deleted site records when it was deleted. */
    update(id: string, patch: { name?: string; database?: string; status?: SiteStatus; step?: string | null }): Promise<SiteRecord | null>;
    /** Add a domain that is not checked yet; it answers as an alias until a check makes it primary. */
    addDomain(id: string, host: string): Promise<SiteRecord | null>;
    /** Record that the domain answered its check, and make it the site's primary domain when asked. */
    verifyDomain(id: string, host: string, options?: { primary?: boolean }): Promise<boolean>;
    /** Remove an alias. The primary domain stays until another one is primary. */
    removeDomain(id: string, host: string): Promise<boolean>;
    /** Sites deleted before this time, oldest first: their 30 days to restore are over. */
    deletedBefore(at: number, limit?: number): Promise<SiteRecord[]>;
    /** Forget a site, its domains and its members' memberships, once its database and media are gone. */
    remove(id: string): Promise<void>;
}

/**
 * A registry of sites kept in memory: for tests, and for trying a network without an
 * application around it. It follows the rules an application's registry must follow.
 */
export function memorySites(options: { now?: () => number } = {}): SitesStore {
    const now = options.now ?? Date.now;
    const sites = new Map<string, { id: string; name: string; database: string; status: SiteStatus; step: string | null; createdAt: number; updatedAt: number; deletedAt: number | null }>();
    const domains = new Map<string, { site: string; primary: boolean; verifiedAt: number | null }>();
    const record = (id: string): SiteRecord | null => {
        const site = sites.get(id);
        if (!site) return null;
        const own = [...domains].filter(([, domain]) => domain.site === id).map(([host, domain]): SiteDomain => Object.freeze({ host, primary: domain.primary, verifiedAt: domain.verifiedAt }))
            .sort((a, b) => Number(b.primary) - Number(a.primary) || (a.host < b.host ? -1 : 1));
        return Object.freeze({ ...site, domains: Object.freeze(own) });
    };
    const checkName = (name: string) => {
        if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a site name of at most 120 characters.', { fields: { name: 'is required.' } });
    };
    return {
        async count() { return sites.size; },
        async get(id) { return id === MAIN_SITE ? null : record(id); },
        async getMany(ids) { return [...new Set(ids)].filter(id => id !== MAIN_SITE).map(record).filter((site): site is SiteRecord => site !== null); },
        async list(listOptions = {}) {
            const search = listOptions.search?.trim().toLowerCase();
            const all = [...sites.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)).map(site => record(site.id)!)
                .filter(site => !listOptions.status || site.status === listOptions.status)
                .filter(site => !search || site.name.toLowerCase().includes(search) || site.domains.some(domain => domain.host.includes(search)));
            const offset = Math.max(listOptions.offset ?? 0, 0);
            return { items: all.slice(offset, offset + Math.min(Math.max(listOptions.limit ?? 20, 1), 100)), total: all.length };
        },
        async inTurn(after, limit = 50) {
            const live = [...sites.values()].filter(site => site.status === 'active' || site.status === 'archived').map(site => site.id).sort();
            return [...live.filter(id => id > after), ...live.filter(id => id <= after)].slice(0, Math.min(Math.max(limit, 1), 200)).map(id => record(id)!);
        },
        async siteOf(host) {
            const name = siteHost(host);
            const domain = domains.get(name);
            return domain ? { site: domain.site, domain: Object.freeze({ host: name, primary: domain.primary, verifiedAt: domain.verifiedAt }) } : null;
        },
        async create(input) {
            if (!ID.test(input.id) || RESERVED_SITE_IDS.has(input.id)) throw new CmsError('CMS_VALIDATION', 'Site IDs are lowercase letters, digits and hyphens, other than main and new.', { fields: { id: 'is invalid.' } });
            checkName(input.name);
            const hosts = input.domains.map(domain => siteHost(domain.host));
            if (!hosts.length || hosts.length > 20 || hosts.some(host => !host) || new Set(hosts).size !== hosts.length) throw new CmsError('CMS_VALIDATION', 'Enter each domain once, as a host name such as blog.example.com.', { fields: { domains: 'are invalid.' } });
            if (sites.has(input.id)) throw new CmsError('CMS_CONFLICT', 'A site with this ID exists.', { fields: { id: 'is taken.' } });
            if ([...sites.values()].some(site => site.database === input.database)) throw new CmsError('CMS_CONFLICT', 'Another site uses this database.');
            if (hosts.some(host => domains.has(host))) throw new CmsError('CMS_CONFLICT', 'Another site answers on this domain.', { fields: { host: 'is taken.' } });
            const at = now();
            sites.set(input.id, { id: input.id, name: input.name.trim(), database: input.database, status: input.status ?? 'active', step: input.step ?? null, createdAt: at, updatedAt: at, deletedAt: null });
            const primary = Math.max(input.domains.findIndex(domain => domain.primary), 0);
            input.domains.forEach((domain, index) => domains.set(hosts[index]!, { site: input.id, primary: index === primary, verifiedAt: domain.verifiedAt ?? null }));
            return record(input.id)!;
        },
        async update(id, patch) {
            const site = sites.get(id);
            if (!site) return null;
            if (patch.name !== undefined) checkName(patch.name);
            const status = patch.status ?? site.status;
            sites.set(id, { ...site, name: (patch.name ?? site.name).trim(), database: patch.database ?? site.database, status, step: patch.step === undefined ? site.step : patch.step,
                deletedAt: status === 'deleted' ? site.deletedAt ?? now() : null, updatedAt: now() });
            return record(id);
        },
        async addDomain(id, host) {
            const name = siteHost(host);
            if (!name) throw new CmsError('CMS_VALIDATION', 'Enter a host name, such as blog.example.com.', { fields: { host: 'is invalid.' } });
            if (id !== MAIN_SITE && !sites.has(id)) return null;
            if (domains.has(name)) throw new CmsError('CMS_CONFLICT', 'Another site answers on this domain.', { fields: { host: 'is taken.' } });
            domains.set(name, { site: id, primary: false, verifiedAt: null });
            return id === MAIN_SITE ? null : record(id);
        },
        async verifyDomain(id, host, verifyOptions = {}) {
            const name = siteHost(host);
            const domain = domains.get(name);
            if (!domain || domain.site !== id) return false;
            if (verifyOptions.primary) for (const [other, entry] of domains) if (entry.site === id) domains.set(other, { ...entry, primary: false });
            domains.set(name, { site: id, primary: verifyOptions.primary ? true : domain.primary, verifiedAt: now() });
            return true;
        },
        async removeDomain(id, host) {
            const name = siteHost(host);
            const domain = domains.get(name);
            if (!domain || domain.site !== id || domain.primary) return false;
            return domains.delete(name);
        },
        async deletedBefore(at, limit = 20) {
            return [...sites.values()].filter(site => site.status === 'deleted' && site.deletedAt !== null && site.deletedAt <= at)
                .sort((a, b) => a.deletedAt! - b.deletedAt!).slice(0, limit).map(site => record(site.id)!);
        },
        async remove(id) {
            for (const [host, domain] of domains) if (domain.site === id) domains.delete(host);
            sites.delete(id);
        },
    };
}
