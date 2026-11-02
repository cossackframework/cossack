/**
 * A network of sites in one isolate or process: which site a request's host names, and one
 * CMS host per site database, kept for the sites used last. The main site is the network
 * database; while it is the only site, every host serves it.
 */
import type { RomeDB } from '@cossackframework/romedb';
import type { StorageMetadata, StorageProvider } from '@cossackframework/core/storage';
import { CmsError } from '../errors';
import { slugify } from '../fields';
import { DEFAULT_ROLES, isNetworkAdmin, systemPrincipal, type Principal } from '../permissions';
import { PLUGIN_ENABLED, type CmsHost, type PluginStatus } from './host';
import { POLICY_KEYS, readPolicy, type NetworkPluginState, type NetworkPolicy, type NetworkThemeState, type StoredPluginStates, type StoredThemeStates } from './network-policy';
import { CmsHandoffs } from './handoffs';
import { seedStarterContent } from './seed';
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
    | { readonly kind: 'redirect'; readonly host: string; readonly site: string }
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
    /** Creates and deletes site databases (a RomeDB organization, or files). Without it, sites cannot be added. */
    readonly directory?: { create(name: string): Promise<string>; delete(id: string): Promise<void> };
    /** The base URL of a host, for domain checks. Default `https://<host>`. */
    readonly hostUrl?: (host: string) => string;
    /** What new sites' addresses end with, such as `example.com` for `blog.example.com`. Default: the network host without `www.`. */
    readonly subdomainSuffix?: () => string | undefined;
    readonly fetch?: typeof globalThis.fetch;
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
        // Members are recorded under the host's site, so a host made for another site would misfile them.
        if (host.site !== site.id && (host as { site?: string }).site !== undefined) throw new Error(`The host factory must pass site: '${site.id}' to createCMS.`);
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

    /** Whether sites can be added: the network opens and creates site databases. */
    get canAddSites(): boolean {
        return this.multisite && this.#options.directory !== undefined;
    }

    /** What new sites' addresses end with, such as `example.com`. */
    get subdomainSuffix(): string {
        return siteHost(this.#options.subdomainSuffix?.() ?? '') || siteHost(this.#options.networkHost?.() ?? '').replace(/^www\./, '');
    }

    /**
     * Add a site, or finish one an earlier call left half made: create its database, apply the
     * schema, seed the roles and settings, then add its first administrator. Each step is
     * recorded in the registry, so a failure resumes after the last step done.
     */
    async createSite(input: NewSite, context: { principal: Principal }): Promise<SiteRecord> {
        requireNetworkAdmin(context.principal);
        const directory = this.#options.directory;
        if (!directory || !this.#options.open) throw new CmsError('CMS_UNAVAILABLE', 'This network cannot add sites yet: it needs a provider for site databases.');
        const id = input.id ?? (slugify(input.name, 40) || 'site');
        const admin = await this.main.accounts.get(input.admin);
        if (!admin || admin.status !== 'active') throw new CmsError('CMS_VALIDATION', 'Choose an active account as the first administrator.', { fields: { admin: 'is invalid.' } });
        let record = await this.sites.get(id);
        if (record && record.status !== 'creating') throw new CmsError('CMS_CONFLICT', 'A site with this ID exists.', { fields: { id: 'is taken.' } });
        if (!record) {
            record = await this.sites.create({ id, name: input.name, database: `pending-${id}`, status: 'creating', domains: [{ host: await this.#address(input.host), primary: true, verifiedAt: this.#now() }] });
            this.invalidate();
        }
        const done = (step: CreationStep) => record!.step !== null && CREATION_STEPS.indexOf(record!.step as CreationStep) >= CREATION_STEPS.indexOf(step);
        if (!done('database')) record = (await this.sites.update(id, { database: await directory.create(`site-${id}`), step: 'database' }))!;
        const host = this.hostOf(networkSite(record));
        if (!done('schema')) {
            const report = await host.migrate();
            if (report.failed) throw new CmsError('CMS_UNAVAILABLE', `The site's schema could not be applied: ${report.failed.message}`);
            await host.ready({ force: true });
            record = (await this.sites.update(id, { step: 'schema' }))!;
        }
        if (!done('seeded')) {
            for (const role of DEFAULT_ROLES) await host.users.defineRole({ ...role, permissions: [...role.permissions] });
            await host.settings.update('general', { siteTitle: record.name, adminEmail: admin.email }, { principal: systemPrincipal('network') });
            record = (await this.sites.update(id, { step: 'seeded' }))!;
        }
        if (!done('members')) {
            await host.users.addMember(admin.id);
            await host.users.setRoles(admin.id, ['admin']);
            const principal = input.starter ? await host.users.principal(admin.id) : null;
            if (principal) await seedStarterContent(host, { principal }).catch(error => console.warn(`[cms] starter content for site ${id}: ${(error as Error).message}`));
            record = (await this.sites.update(id, { step: 'members' }))!;
        }
        record = (await this.sites.update(id, { status: 'active', step: null }))!;
        this.invalidate();
        return record;
    }

    /** Archive, delete or restore a site. A deleted site can be restored for 30 days. */
    async setSiteStatus(id: string, status: 'active' | 'archived' | 'deleted', context: { principal: Principal }): Promise<SiteRecord> {
        requireNetworkAdmin(context.principal);
        const record = await this.sites.get(id);
        if (!record || record.status === 'creating') throw new CmsError('CMS_NOT_FOUND', 'There is no such site.');
        const updated = (await this.sites.update(id, { status }))!;
        this.invalidate();
        return updated;
    }

    /** Delete for good the sites deleted 30 days ago or more: their media, database and registry row. Run it from the schedule. */
    async purgeDeleted(options: { olderThanMs?: number } = {}): Promise<string[]> {
        const directory = this.#options.directory;
        if (!directory) return [];
        const purged: string[] = [];
        for (const record of await this.sites.deletedBefore(this.#now() - (options.olderThanMs ?? 30 * 24 * 60 * 60_000))) {
            if (!record.database.startsWith('pending-')) {
                await this.hostOf(networkSite(record)).files?.purgeStorage();
                await this.release(record.database);
                await directory.delete(record.database);
            }
            await this.sites.remove(record.id);
            purged.push(record.id);
        }
        if (purged.length) this.invalidate();
        return purged;
    }

    /** Drop a site's host from this isolate and close its database now, before its database is deleted. */
    async release(database: string): Promise<void> {
        const host = this.#hosts.get(database);
        if (!host || database === MAIN_SITE) return;
        this.#hosts.delete(database);
        await host.db.close();
    }

    /** Add a domain to a site. It answers as an alias until `checkDomain` finds the site there. */
    async addDomain(id: string, host: string, context: { principal: Principal }): Promise<SiteRecord | null> {
        requireNetworkAdmin(context.principal);
        const record = await this.sites.addDomain(id, host);
        this.invalidate();
        return record;
    }

    /**
     * Ask a domain which site it serves (`/.well-known/cossack-site`). When it answers with this
     * site's ID, the domain points here: record that, and make it primary unless told otherwise.
     */
    async checkDomain(id: string, host: string, context: { principal: Principal; primary?: boolean }): Promise<boolean> {
        requireNetworkAdmin(context.principal);
        const name = siteHost(host);
        if (!name) return false;
        const base = this.#options.hostUrl?.(name) ?? `https://${name}`;
        const answer = await (this.#options.fetch ?? ((input, init) => globalThis.fetch(input, init)))(`${base}/.well-known/cossack-site`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
            .then(async response => response.ok ? (await response.text()).trim() : '', () => '');
        if (answer !== id) return false;
        const verified = await this.sites.verifyDomain(id, name, { primary: context.primary ?? true });
        this.invalidate();
        return verified;
    }

    async removeDomain(id: string, host: string, context: { principal: Principal }): Promise<boolean> {
        requireNetworkAdmin(context.principal);
        const removed = await this.sites.removeDomain(id, host);
        this.invalidate();
        return removed;
    }

    /** Network settings: its name and what new sites' addresses end with. */
    async settings(): Promise<NetworkSettings> {
        const stored = await this.state<Partial<NetworkSettings>>('settings') ?? {};
        return { name: typeof stored.name === 'string' ? stored.name : '', subdomainSuffix: typeof stored.subdomainSuffix === 'string' ? stored.subdomainSuffix : '' };
    }

    async saveSettings(patch: Partial<NetworkSettings>, context: { principal: Principal }): Promise<NetworkSettings> {
        requireNetworkAdmin(context.principal);
        const next = { ...await this.settings(), ...patch };
        if (typeof next.name !== 'string' || next.name.length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a network name of at most 120 characters.', { fields: { name: 'is too long.' } });
        if (next.subdomainSuffix && !siteHost(next.subdomainSuffix)) throw new CmsError('CMS_VALIDATION', 'Enter a domain, such as example.com.', { fields: { subdomainSuffix: 'is invalid.' } });
        const saved = { name: next.name.trim(), subdomainSuffix: next.subdomainSuffix ? siteHost(next.subdomainSuffix) : '' };
        await this.setState('settings', saved);
        return saved;
    }

    /** The network's plugin and theme states. */
    policy(): Promise<NetworkPolicy> {
        return readPolicy(this.db);
    }

    /**
     * Set a plugin's state on every site. `network` approves everything its manifest requests
     * now, and each site migrates it as it loads; an upgrade that requests more waits until a
     * network admin sets it again. Hosts in other isolates see the change within their activation TTL.
     */
    async setPluginState(name: string, state: NetworkPluginState, context: { principal: Principal }): Promise<PluginStatus> {
        requireNetworkAdmin(context.principal);
        const plugin = (await this.main.status()).plugins.find(entry => entry.name === name && !entry.themeOnly);
        if (!plugin) throw new CmsError('CMS_NOT_FOUND', `Unknown plugin ${name}.`);
        if (state === 'network' && plugin.reason?.startsWith('Invalid manifest')) throw new CmsError('CMS_VALIDATION', `${name} cannot be activated: ${plugin.reason}`);
        const stored: StoredPluginStates = { ...await this.state<StoredPluginStates>(POLICY_KEYS.plugins) };
        if (state === 'available') delete stored[name];
        else stored[name] = state === 'network' ? { state, grants: plugin.requests.filter(grant => grant !== PLUGIN_ENABLED) } : { state };
        await this.setState(POLICY_KEYS.plugins, stored);
        this.#expireHosts();
        await this.main.ready();
        return (await this.main.status()).plugins.find(entry => entry.name === name)!;
    }

    /** Hide a theme from every site, or make it available again. A site whose theme is hidden falls back to another. */
    async setThemeState(name: string, state: NetworkThemeState, context: { principal: Principal }): Promise<void> {
        requireNetworkAdmin(context.principal);
        if (!this.main.themes().some(theme => theme.name === name)) throw new CmsError('CMS_NOT_FOUND', `Unknown theme ${name}.`);
        const stored: StoredThemeStates = { ...await this.state<StoredThemeStates>(POLICY_KEYS.themes) };
        if (state === 'hidden') stored[name] = 'hidden';
        else delete stored[name];
        await this.setState(POLICY_KEYS.themes, stored);
        this.#expireHosts();
    }

    /** Open hosts read the network's states again on their next request. */
    #expireHosts(): void {
        this.main.expire();
        for (const host of this.#hosts.values()) host.expire();
    }

    /** A value the network keeps by key in its database, such as where scheduled work stopped. */
    async state<T>(key: string): Promise<T | undefined> {
        const result = await this.db.read([{ rql: 'SELECT value FROM cms_network WHERE key = $key', params: { $key: key } }]);
        const value = result.results[0]!.rows[0]?.[0];
        return value === undefined ? undefined : JSON.parse(value as string) as T;
    }

    async setState(key: string, value: unknown): Promise<void> {
        await this.db.write([{ rql: 'INSERT INTO cms_network (key, value, updated_at) SELECT $key, $value, $now WHERE 1 = 1 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
            params: { $key: key, $value: JSON.stringify(value), $now: this.#now() } }], { kind: 'cms.network', retryConflicts: 5 });
    }

    /** The sites an account is a member of, the main site first, without opening their databases. */
    async memberSites(accountId: string): Promise<NetworkSite[]> {
        const ids = (await this.main.accounts.memberships([accountId])).get(accountId) ?? [];
        const sites: NetworkSite[] = ids.includes(MAIN_SITE) ? [MAIN] : [];
        for (const id of ids) {
            const record = id === MAIN_SITE ? null : await this.sites.get(id);
            if (record && (record.status === 'active' || record.status === 'archived')) sites.push(networkSite(record));
        }
        return sites;
    }

    /** Delete an account: first its membership of every site, through each site's own user deletion, then the account. */
    async deleteAccount(id: string, context: { principal: Principal }): Promise<boolean> {
        requireNetworkAdmin(context.principal);
        const account = await this.main.accounts.get(id);
        if (!account) return false;
        // Refuse the last network admin before anything changes.
        if (account.networkRole && !(await this.main.accounts.list({ networkAdmins: true, limit: 2 })).items.some(other => other.id !== id && other.status === 'active')) {
            throw new CmsError('CMS_FORBIDDEN', 'The last network admin cannot be deleted.');
        }
        for (const site of (await this.main.accounts.memberships([id])).get(id) ?? []) {
            const record = site === MAIN_SITE ? null : await this.sites.get(site);
            if (site === MAIN_SITE) await this.main.users.delete(id);
            else if (record && record.status !== 'creating') await this.hostOf(networkSite(record)).users.delete(id);
        }
        return this.main.accounts.delete(id);
    }

    /** Sites whose schema has steps to apply after a deploy, with how many; each site applies its own when it next loads. */
    async updates(options: { limit?: number; offset?: number } = {}): Promise<{ site: NetworkSite; name: string; pending: number }[]> {
        const records = (await this.sites.list({ status: 'active', limit: options.limit ?? 50, offset: options.offset ?? 0 })).items;
        const sites: { site: NetworkSite; name: string }[] = [{ site: MAIN, name: (await this.settings()).name || 'Main site' }, ...records.map(record => ({ site: networkSite(record), name: record.name }))];
        const found: { site: NetworkSite; name: string; pending: number }[] = [];
        for (const entry of sites) {
            const plan = await this.hostOf(entry.site).plan().catch(() => null);
            const pending = plan ? plan.steps.filter(step => step.kind === 'host').length : 0;
            if (pending) found.push({ ...entry, pending });
        }
        return found;
    }

    /** Apply pending host steps, up to `limit` sites at a time. Returns the sites upgraded and those that failed. */
    async upgrade(context: { principal: Principal; limit?: number }): Promise<{ upgraded: string[]; failed: { site: string; message: string }[] }> {
        requireNetworkAdmin(context.principal);
        const upgraded: string[] = [];
        const failed: { site: string; message: string }[] = [];
        for (const { site } of (await this.updates()).slice(0, context.limit ?? 10)) {
            const report = await this.hostOf(site).migrate().catch(error => ({ failed: { message: (error as Error).message } }));
            if (report.failed) failed.push({ site: site.id, message: report.failed.message });
            else upgraded.push(site.id);
        }
        return { upgraded, failed };
    }

    /** A new site's address: a host under the network's suffix, or any `.localhost` host in development. */
    async #address(host: string): Promise<string> {
        const name = siteHost(host);
        const suffix = (await this.settings()).subdomainSuffix || this.subdomainSuffix;
        if (!name || (suffix && !name.endsWith(`.${suffix}`) && !name.endsWith('.localhost'))) {
            throw new CmsError('CMS_VALIDATION', suffix ? `New sites start at an address ending in .${suffix}; add their own domains once they exist.` : 'Enter the site\'s address, such as blog.example.com.', { fields: { host: 'is invalid.' } });
        }
        return name;
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
        if (found.site === MAIN_SITE) return found.domain.primary || !network ? main : { kind: 'redirect', host: network, site: MAIN_SITE };
        const record = await this.sites.get(found.site);
        if (!record || record.status === 'creating' || record.status === 'deleted') return { kind: 'missing' };
        const site = networkSite(record);
        if (!found.domain.primary && site.host) return { kind: 'redirect', host: site.host, site: site.id };
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

export interface NetworkSettings {
    /** Shown on the network dashboard and sign-in; empty for the main site's title. */
    readonly name: string;
    /** What new sites' addresses end with; empty for the network host without `www.`. */
    readonly subdomainSuffix: string;
}

/** What adding a site asks for. */
export interface NewSite {
    readonly name: string;
    /** The registry ID; made from the name when left out. */
    readonly id?: string;
    /** The site's address, under the network's subdomain suffix, such as `blog.example.com`. */
    readonly host: string;
    /** The account that becomes the site's first administrator. */
    readonly admin: string;
    /** A first post, a category, a contact form and its page. */
    readonly starter?: boolean;
}

const CREATION_STEPS = ['database', 'schema', 'seeded', 'members'] as const;
type CreationStep = typeof CREATION_STEPS[number];

function requireNetworkAdmin(principal: Principal): void {
    if (principal.kind !== 'system' && !isNetworkAdmin(principal)) throw new CmsError('CMS_FORBIDDEN', 'Only network admins manage sites.');
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
