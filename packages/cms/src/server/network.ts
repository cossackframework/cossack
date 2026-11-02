/**
 * A network of sites in one isolate or process: which site a request's host names, and one
 * CMS host per site database, kept for the sites used last. The main site is the network
 * database; while it is the only site, every host serves it.
 */
import type { RomeDB } from '@cossackframework/romedb';
import type { StorageMetadata, StorageProvider } from '@cossackframework/core/storage';
import type { CmsHost } from './host';
import { CmsHandoffs } from './handoffs';
import { CmsSites, MAIN_SITE, siteHost, type SiteRecord, type SiteStatus } from './sites';
import type { EndedSessions } from './stores';

/** The site a CMS host serves. */
export interface NetworkSite {
    /** `main`, or the registry ID. */
    readonly id: string;
    /** The registry name; null for the main site, which its settings name. */
    readonly name: string | null;
    /** The database ID with its provider; `main` for the network database. */
    readonly database: string;
    readonly status: SiteStatus;
    /** The primary domain; null for the main site, which `APP_URL` names. */
    readonly host: string | null;
}

export type SiteResolution =
    | { readonly kind: 'site'; readonly site: NetworkSite }
    /** An alias: answer with a permanent redirect to the same path on this host. */
    | { readonly kind: 'redirect'; readonly host: string }
    /** Visitors get "This site is archived"; members can still read the dashboard. */
    | { readonly kind: 'archived'; readonly site: NetworkSite }
    /** No site at this address. */
    | { readonly kind: 'missing' };

export interface CmsNetworkOptions {
    /** The network database: the main site's, with the accounts and the site registry. */
    readonly db: RomeDB;
    /** Builds the CMS host of a site on its database. */
    readonly host: (site: NetworkSite, db: RomeDB) => CmsHost;
    /** Opens an added site's database. Without it, the network is the main site only. */
    readonly open?: (site: NetworkSite) => RomeDB;
    /** The network's host name (`APP_URL`'s), which always serves the main site. */
    readonly networkHost?: () => string | undefined;
    /** Hosts kept per isolate. Default 32; the one used longest ago is dropped first. */
    readonly maxHosts?: number;
    /** How long a host's lookup is reused. Default 30 seconds. */
    readonly cacheMs?: number;
    readonly now?: () => number;
}

export const MAIN: NetworkSite = Object.freeze({ id: MAIN_SITE, name: null, database: MAIN_SITE, status: 'active', host: null });

export class CmsNetwork {
    readonly db: RomeDB;
    readonly sites: CmsSites;
    /** One-use codes that sign a network session in on a site. */
    readonly handoffs: CmsHandoffs;
    readonly #options: CmsNetworkOptions;
    readonly #now: () => number;
    readonly #hosts = new Map<string, CmsHost>();
    readonly #lookups = new Map<string, { at: number; value: Promise<SiteResolution> }>();
    #count: { at: number; value: Promise<number> } | undefined;

    constructor(options: CmsNetworkOptions) {
        this.db = options.db;
        this.#options = options;
        this.#now = options.now ?? Date.now;
        this.sites = new CmsSites(options.db, { now: this.#now });
        this.handoffs = new CmsHandoffs(options.db, { now: this.#now });
    }

    /**
     * End the child sessions sites made from these network sessions. Pass it to every host as
     * `sessionsEnded`: signing out, a password reset, a suspension or a new network role end
     * the account's sessions on every site it reached.
     */
    async endSessions(ended: EndedSessions): Promise<void> {
        if (!this.multisite) return;
        for (const id of await this.handoffs.reached(ended)) {
            const record = await this.sites.get(id);
            if (record && record.status !== 'creating') await this.hostOf(networkSite(record)).authSessions.revokeChildren(ended);
        }
        await this.handoffs.forget(ended);
    }

    /** Whether added sites can open their databases. */
    get multisite(): boolean {
        return this.#options.open !== undefined;
    }

    /** The main site's host: sign-in, accounts and the network dashboard live there. */
    get main(): CmsHost {
        return this.hostOf(MAIN);
    }

    /** The CMS host of a site, built on first use and kept while it is among the last used. */
    hostOf(site: NetworkSite): CmsHost {
        const kept = this.#hosts.get(site.database);
        if (kept) {
            this.#hosts.delete(site.database);
            this.#hosts.set(site.database, kept);
            return kept;
        }
        if (site.database !== MAIN_SITE && !this.#options.open) throw new Error(`Site ${site.id} needs a site database provider.`);
        const db = site.database === MAIN_SITE ? this.db : this.#options.open!(site);
        const host = this.#options.host(site, db);
        this.#hosts.set(site.database, host);
        const limit = Math.max(this.#options.maxHosts ?? 32, 2);
        for (const [database, dropped] of this.#hosts) {
            if (this.#hosts.size <= limit) break;
            if (database === MAIN_SITE) continue;
            this.#hosts.delete(database);
            // Requests may still hold the host; close its database once they are done.
            const timer = setTimeout(() => { dropped.db.close().catch(() => undefined); }, 60_000) as { unref?: () => void };
            timer.unref?.();
        }
        return host;
    }

    /** The site a request's host names. Lookups are reused for 30 seconds. */
    resolve(host: string): Promise<SiteResolution> {
        const name = siteHost(host);
        const now = this.#now();
        const cached = this.#lookups.get(name);
        if (cached && now - cached.at < (this.#options.cacheMs ?? 30_000)) return cached.value;
        const value = this.#resolve(name);
        if (this.#lookups.size >= 1000) this.#lookups.delete(this.#lookups.keys().next().value!);
        this.#lookups.set(name, { at: now, value });
        value.catch(() => this.#lookups.delete(name));
        return value;
    }

    /** Forget cached lookups, after a registry change made in this isolate. */
    invalidate(): void {
        this.#lookups.clear();
        this.#count = undefined;
    }

    async #resolve(name: string): Promise<SiteResolution> {
        const main: SiteResolution = { kind: 'site', site: MAIN };
        // While the network is the main site, every host serves it, so preview URLs and tunnels keep working.
        if (!this.multisite || (await this.#siteCount()) === 0) return main;
        const network = siteHost(this.#options.networkHost?.() ?? '');
        if (!name) return { kind: 'missing' };
        if (name === network) return main;
        const found = await this.sites.siteOf(name);
        if (!found) return { kind: 'missing' };
        if (found.site === MAIN_SITE) return found.domain.primary || !network ? main : { kind: 'redirect', host: network };
        const record = await this.sites.get(found.site);
        if (!record || record.status === 'creating' || record.status === 'deleted') return { kind: 'missing' };
        const site = networkSite(record);
        if (!found.domain.primary && site.host) return { kind: 'redirect', host: site.host };
        return record.status === 'archived' ? { kind: 'archived', site } : { kind: 'site', site };
    }

    #siteCount(): Promise<number> {
        const now = this.#now();
        if (!this.#count || now - this.#count.at >= (this.#options.cacheMs ?? 30_000)) {
            const value = this.sites.count();
            this.#count = { at: now, value };
            value.catch(() => { this.#count = undefined; });
        }
        return this.#count.value;
    }
}

export function networkSite(record: SiteRecord): NetworkSite {
    return Object.freeze({ id: record.id, name: record.name, database: record.database, status: record.status, host: record.domains.find(domain => domain.primary)?.host ?? null });
}

/** A site's media: the same storage under a key prefix, such as `sites/blog/`. Keys come back without it. */
export function prefixedStorage(storage: StorageProvider, prefix: string): StorageProvider {
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(prefix)) throw new TypeError('A storage prefix is path segments ending in a slash.');
    const strip = <T extends StorageMetadata | null>(metadata: T): T => metadata && metadata.key.startsWith(prefix) ? { ...metadata, key: metadata.key.slice(prefix.length) } : metadata;
    return {
        name: storage.name,
        put: async (key, body, options) => strip(await storage.put(prefix + key, body, options)),
        get: async (key, options) => strip(await storage.get(prefix + key, options)),
        head: async (key, options) => strip(await storage.head(prefix + key, options)),
        delete: (key, options) => storage.delete(prefix + key, options),
        ...(storage.presign ? { presign: (key: string, options: Parameters<NonNullable<StorageProvider['presign']>>[1]) => storage.presign!(prefix + key, options) } : {}),
    };
}
