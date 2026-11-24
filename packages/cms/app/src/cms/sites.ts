// The network's registry of sites on the dashboard package's tenants: a site is a tenant
// whose ID and slug are the site's ID, with its domains in `tenant_domains` and its members
// in `tenant_members`. The CMS library's `CmsNetwork` reads and writes sites through this
// (`SitesStore`); the creation step of a site that is still being made is a network setting.
//
// Every call runs against the main database, whichever site the request is for.
import { In } from '@cossackframework/database';
import { CmsError, MAIN_SITE, siteHost, type SiteDomain, type SiteRecord, type SitesStore, type SiteStatus } from '@cossackframework/cms/server';
import { accounts, asMainAccount, forgetTenantHosts } from '#app/tenants';
import { Tenant } from '@/models/Tenant';
import { TenantDomain } from '@/models/TenantDomain';
import { TenantMember } from '@/models/TenantMember';
import { TenantNetwork } from '@/models/TenantNetwork';
import { TenantSession } from '@/models/TenantSession';

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DATABASE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RESERVED = new Set([MAIN_SITE, 'new']);
const STATUSES: readonly SiteStatus[] = ['creating', 'active', 'archived', 'deleted'];
const stepKey = (id: string) => `site.step:${id}`;

const main = <T>(work: () => Promise<T>): Promise<T> => asMainAccount(() => accounts(work));

function checkName(name: string): void {
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a site name of at most 120 characters.', { fields: { name: 'is required.' } });
}

async function records(tenants: readonly Tenant[]): Promise<SiteRecord[]> {
    if (!tenants.length) return [];
    const ids = tenants.map(tenant => tenant.id);
    const [domains, steps] = await Promise.all([
        TenantDomain.find({ where: { tenantId: In(ids) }, take: 5000 }),
        TenantNetwork.find({ where: { key: In(ids.map(stepKey)) }, take: 5000 }),
    ]);
    const step = new Map(steps.map(row => [row.key, row.value]));
    return tenants.map(tenant => Object.freeze({
        id: tenant.id, name: tenant.name, database: tenant.database, status: tenant.status as SiteStatus,
        step: tenant.status === 'creating' ? step.get(stepKey(tenant.id)) ?? null : null,
        domains: Object.freeze(domains.filter(domain => domain.tenantId === tenant.id)
            .map((domain): SiteDomain => Object.freeze({ host: domain.host, primary: domain.isPrimary, verifiedAt: domain.verifiedAt ? domain.verifiedAt.getTime() : null }))
            .sort((a, b) => Number(b.primary) - Number(a.primary) || (a.host < b.host ? -1 : 1))),
        createdAt: tenant.createdAt.getTime(), updatedAt: tenant.createdAt.getTime(),
        deletedAt: tenant.deletedAt ? tenant.deletedAt.getTime() : null,
    }));
}

export const tenantSites: SitesStore = {
    count: () => main(() => Tenant.count()),

    async get(id) {
        if (!ID.test(id) || id === MAIN_SITE) return null;
        return main(async () => (await records(await Tenant.find({ where: { id } })))[0] ?? null);
    },

    async getMany(ids) {
        const wanted = [...new Set(ids.filter(id => ID.test(id) && id !== MAIN_SITE))];
        if (!wanted.length) return [];
        return main(async () => {
            const found = new Map((await records(await Tenant.find({ where: { id: In(wanted) } }))).map(record => [record.id, record]));
            return wanted.map(id => found.get(id)).filter((record): record is SiteRecord => record !== undefined);
        });
    },

    async list(options = {}) {
        return main(async () => {
            const search = options.search?.trim().toLowerCase().slice(0, 100);
            const all = await records(await Tenant.find({ ...(options.status ? { where: { status: options.status } } : {}), order: { createdAt: 'desc' }, take: 2000 }));
            const matching = search ? all.filter(record => record.name.toLowerCase().includes(search) || record.domains.some(domain => domain.host.includes(search))) : all;
            const offset = Math.max(options.offset ?? 0, 0);
            return { items: matching.slice(offset, offset + Math.min(Math.max(options.limit ?? 20, 1), 100)), total: matching.length };
        });
    },

    async inTurn(after, limit = 50) {
        return main(async () => {
            const live = (await Tenant.find({ where: { status: In(['active', 'archived']) }, order: { id: 'asc' }, take: 5000 }));
            const turn = [...live.filter(tenant => tenant.id > after), ...live.filter(tenant => tenant.id <= after)];
            return records(turn.slice(0, Math.min(Math.max(limit, 1), 200)));
        });
    },

    async siteOf(host) {
        const name = siteHost(host);
        if (!name) return null;
        return main(async () => {
            const domain = await TenantDomain.findOne({ where: { host: name } });
            return domain ? { site: domain.tenantId, domain: Object.freeze({ host: domain.host, primary: domain.isPrimary, verifiedAt: domain.verifiedAt ? domain.verifiedAt.getTime() : null }) } : null;
        });
    },

    async create(input) {
        if (!ID.test(input.id) || RESERVED.has(input.id)) throw new CmsError('CMS_VALIDATION', 'Site IDs are lowercase letters, digits and hyphens, other than main and new.', { fields: { id: 'is invalid.' } });
        if (!DATABASE.test(input.database)) throw new CmsError('CMS_VALIDATION', 'Invalid database ID.');
        checkName(input.name);
        const status = input.status ?? 'active';
        if (!STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown site status.');
        const hosts = input.domains.map(domain => siteHost(domain.host));
        if (!hosts.length || hosts.length > 20 || hosts.some(host => !host) || new Set(hosts).size !== hosts.length) throw new CmsError('CMS_VALIDATION', 'Enter each domain once, as a host name such as blog.example.com.', { fields: { domains: 'are invalid.' } });
        const primary = Math.max(input.domains.findIndex(domain => domain.primary), 0);
        return main(async () => {
            if (await Tenant.exists({ id: input.id })) throw new CmsError('CMS_CONFLICT', 'A site with this ID exists.', { fields: { id: 'is taken.' } });
            if (await Tenant.exists({ database: input.database })) throw new CmsError('CMS_CONFLICT', 'Another site uses this database.');
            if (await TenantDomain.exists({ host: In(hosts) })) throw new CmsError('CMS_CONFLICT', 'Another site answers on this domain.', { fields: { host: 'is taken.' } });
            const now = new Date();
            await Tenant.insert({ id: input.id, slug: input.id, name: input.name.trim(), database: input.database, status, deletedAt: null, createdAt: now });
            await TenantDomain.insert(input.domains.map((domain, index) => ({ host: hosts[index]!, tenantId: input.id, isPrimary: index === primary, verifiedAt: domain.verifiedAt ? new Date(domain.verifiedAt) : null, createdAt: now })));
            if (input.step) await TenantNetwork.upsert({ key: stepKey(input.id), value: input.step, updatedAt: now }, ['key']);
            forgetTenantHosts();
            return (await records(await Tenant.find({ where: { id: input.id } })))[0]!;
        });
    },

    async update(id, patch) {
        return main(async () => {
            const current = await Tenant.findOne({ where: { id } });
            if (!current) return null;
            if (patch.name !== undefined) checkName(patch.name);
            if (patch.database !== undefined && !DATABASE.test(patch.database)) throw new CmsError('CMS_VALIDATION', 'Invalid database ID.');
            const status = patch.status ?? (current.status as SiteStatus);
            if (!STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown site status.');
            await Tenant.update({ id }, { name: (patch.name ?? current.name).trim(), database: patch.database ?? current.database, status,
                deletedAt: status === 'deleted' ? current.deletedAt ?? new Date() : null });
            if (patch.step !== undefined) {
                if (patch.step === null) await TenantNetwork.delete({ key: stepKey(id) });
                else await TenantNetwork.upsert({ key: stepKey(id), value: patch.step, updatedAt: new Date() }, ['key']);
            }
            forgetTenantHosts();
            return (await records(await Tenant.find({ where: { id } })))[0] ?? null;
        });
    },

    async addDomain(id, host) {
        const name = siteHost(host);
        if (!name) throw new CmsError('CMS_VALIDATION', 'Enter a host name, such as blog.example.com.', { fields: { host: 'is invalid.' } });
        return main(async () => {
            if (id !== MAIN_SITE && !await Tenant.exists({ id })) return null;
            if (await TenantDomain.exists({ host: name })) throw new CmsError('CMS_CONFLICT', 'Another site answers on this domain.', { fields: { host: 'is taken.' } });
            await TenantDomain.insert({ host: name, tenantId: id, isPrimary: false, verifiedAt: null, createdAt: new Date() });
            forgetTenantHosts();
            return id === MAIN_SITE ? null : (await records(await Tenant.find({ where: { id } })))[0] ?? null;
        });
    },

    async verifyDomain(id, host, options = {}) {
        const name = siteHost(host);
        return main(async () => {
            const result = await TenantDomain.update({ host: name, tenantId: id }, { verifiedAt: new Date() });
            if (result.meta.rowsAffected !== 1) return false;
            if (options.primary) {
                await TenantDomain.update({ tenantId: id }, { isPrimary: false });
                await TenantDomain.update({ host: name, tenantId: id }, { isPrimary: true });
            }
            forgetTenantHosts();
            return true;
        });
    },

    async removeDomain(id, host) {
        return main(async () => {
            const result = await TenantDomain.delete({ host: siteHost(host), tenantId: id, isPrimary: false });
            forgetTenantHosts();
            return result.meta.rowsAffected === 1;
        });
    },

    async deletedBefore(at, limit = 20) {
        return main(async () => records((await Tenant.find({ where: { status: 'deleted' }, take: 2000 }))
            .filter(tenant => tenant.deletedAt && tenant.deletedAt.getTime() < at)
            .sort((a, b) => a.deletedAt!.getTime() - b.deletedAt!.getTime()).slice(0, limit)));
    },

    async remove(id) {
        await main(async () => {
            await TenantDomain.delete({ tenantId: id });
            await TenantMember.delete({ tenantId: id });
            await TenantSession.delete({ tenantId: id });
            await TenantNetwork.delete({ key: stepKey(id) });
            await Tenant.delete({ id });
            forgetTenantHosts();
        });
    },
};
