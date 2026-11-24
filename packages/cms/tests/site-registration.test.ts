import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, contentModule, createCMS, field, memorySites, formsModule, manifestProblems, NETWORK_ADMIN, networkSite, siteCreated, systemPrincipal, userPrincipal, type CmsHost, type PluginContext, type PluginRegistrationLike, type Principal, type SiteCreatedEvent } from '../src/server/index';
import { networkPeople, romedbService, live } from './helpers';

const networkAdmin: Principal = { kind: 'user', id: 'root', roles: ['admin', NETWORK_ADMIN], permissions: ['*'] };
const system = systemPrincipal('tests');

/** A plugin with two roles, a branch resource, and a handler that prepares each new site. */
const created: SiteCreatedEvent[] = [];
const crewManifest = {
    schemaVersion: 1, name: 'crew', version: '1.0.0',
    resources: [{ name: 'branches', fields: { name: field.string({ required: true }) } }],
    permissions: { define: ['crew:approve'] },
    hooks: [{ point: 'cms.site.created', version: 1 }],
    roles: [
        { id: 'crew-manager', name: 'Manager', permissions: ['cms:dashboard', 'crew:approve', 'crew/*'] },
        { id: 'crew-staff', name: 'Staff', permissions: ['cms:dashboard', 'crew/branches:read'] },
    ],
};
const crew: PluginRegistrationLike = {
    name: 'crew', version: '1.0.0', manifest: crewManifest,
    module: {
        register(context: PluginContext) {
            context.hooks.addAction(siteCreated, async event => {
                created.push(event);
                // Its first branch, made idempotent by the event's ID.
                const branches = context.cms.resource('crew/branches');
                if (!(await branches.get('main', { principal: systemPrincipal('plugin:crew') }))) await branches.create({ name: event.site.name }, { principal: systemPrincipal('plugin:crew'), id: 'main' });
            });
        },
    },
};

describe('plugin roles in the manifest', () => {
    const manifest = (roles: unknown) => ({ ...crewManifest, roles });
    it('takes roles named after the plugin with its own permissions, the dashboard and uploads', () => {
        expect(manifestProblems(crewManifest)).toEqual([]);
        expect(manifestProblems(manifest([{ id: 'manager', name: 'Manager', permissions: [] }]))).toEqual([expect.stringContaining('IDs start with crew-')]);
        expect(manifestProblems(manifest([{ id: 'crew-boss', name: 'Boss', permissions: ['*'] }]))).toEqual([expect.stringContaining('not *')]);
        expect(manifestProblems(manifest([{ id: 'crew-boss', name: 'Boss', permissions: ['cms:users'] }]))).toEqual([expect.stringContaining('not cms:users')]);
        expect(manifestProblems(manifest([{ id: 'crew-boss', name: 'Boss', permissions: ['other:thing'] }]))).toEqual([expect.stringContaining('not other:thing')]);
        expect(manifestProblems(manifest([{ id: 'crew-a', name: 'A', permissions: [] }, { id: 'crew-a', name: 'B', permissions: [] }]))).toEqual([expect.stringContaining('declared twice')]);
        expect(manifestProblems(manifest('crew-a'))).toEqual([expect.stringContaining('roles[0]')]);
    });
});

describe.skipIf(!live)('site registration and new sites', () => {
    const service = romedbService();
    const added = new Map<string, { db: RomeDB; stop(): Promise<void> }>();
    let network: CmsNetwork;
    let ada: string;
    const people = networkPeople();

    beforeAll(async () => {
        const db = service.database();
        network = new CmsNetwork({
            db, open: site => added.get(site.database)!.db, networkHost: () => 'example.com', sites: memorySites(), memberSites: people.memberSites,
            directory: {
                async create(name) {
                    if (!added.has(`db-${name}`)) added.set(`db-${name}`, await service.fresh());
                    return `db-${name}`;
                },
                async delete() {},
            },
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id, modules: [contentModule, formsModule], plugins: [crew], people: people.of(site.id) }),
        });
        expect((await network.main.migrate()).failed).toBeUndefined();
        await network.setEnabled(true, { principal: system });
        await network.setPluginState('crew', 'network', { principal: networkAdmin });
        ada = (await network.main.users.create({ email: 'ada@example.com', name: 'Ada' })).id;
    }, 60_000);

    afterAll(async () => {
        for (const database of added.values()) await database.stop();
    });

    const as = (id: string) => ({ principal: userPrincipal(id, [], []) });

    it('is closed until a network admin opens it', async () => {
        expect((await network.settings()).siteRegistration).toBe(false);
        await expect(network.registerSite({ name: 'Pho', host: 'pho.example.com' }, as(ada))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(network.saveSettings({ siteRegistration: 'yes' as never }, { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await network.saveSettings({ siteRegistration: true }, { principal: networkAdmin });
        expect((await network.settings()).siteRegistration).toBe(true);
    });

    it('checks the name and the address before anything is made', async () => {
        for (const host of ['pho.other.com', 'a.b.example.com', 'main.example.com', 'www.example.com', '-x.example.com', 'example.com']) {
            await expect(network.checkSiteRegistration({ name: 'Pho', host })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { host: expect.any(String) } });
        }
        await expect(network.checkSiteRegistration({ name: ' ', host: 'pho.example.com' })).rejects.toMatchObject({ fields: { name: 'is required.' } });
        expect(await network.checkSiteRegistration({ name: ' Pho ', host: 'Pho.Example.com' })).toEqual({ id: 'pho', name: 'Pho', host: 'pho.example.com' });
    });

    it('needs a signed-in account whose email is confirmed', async () => {
        await expect(network.registerSite({ name: 'Pho', host: 'pho.example.com' }, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        const waiting = (await network.main.users.create({ email: 'new@example.com', name: 'New' })).id;
        people.main.set(waiting, { status: 'disabled' });
        await expect(network.registerSite({ name: 'Pho', host: 'pho.example.com' }, as(waiting))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await network.sites.get('pho')).toBeNull();
    });

    it('makes the site with the person as its administrator, with the plugins\' roles, and tells the plugins', async () => {
        const record = await network.registerSite({ name: 'Pho', host: 'pho.example.com' }, as(ada));
        expect(record).toMatchObject({ id: 'pho', name: 'Pho', status: 'active' });
        const site: CmsHost = network.hostOf(networkSite(record));
        expect((await site.users.get(ada))?.roles).toEqual(['admin']);
        // The roles the network-enabled plugin ships, before its handler ran.
        expect(await site.users.role('crew-manager')).toMatchObject({ name: 'Manager', permissions: ['cms:dashboard', 'crew/*', 'crew:approve'] });
        expect(await site.users.role('crew-staff')).toMatchObject({ name: 'Staff' });
        expect(created).toMatchObject([{ eventId: 'site.created:pho', topic: 'site.created', site: { id: 'pho', name: 'Pho', host: 'pho.example.com' }, admin: { id: ada, email: 'ada@example.com' } }]);
        expect(await site.resource('crew/branches').get('main', { principal: system })).toMatchObject({ name: 'Pho' });
        // Starter content, as a network admin's new site with it.
        expect((await site.resource('cms/posts').list({}, { principal: system })).records.length).toBeGreaterThan(0);
    }, 60_000);

    it('refuses an address in use, and more than three sites a day per account', async () => {
        await expect(network.registerSite({ name: 'Again', host: 'pho.example.com' }, as(ada))).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { host: 'is taken.' } });
        await network.registerSite({ name: 'Two', host: 'two.example.com' }, as(ada));
        await network.registerSite({ name: 'Three', host: 'three.example.com' }, as(ada));
        await expect(network.registerSite({ name: 'Four', host: 'four.example.com' }, as(ada))).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        expect(await network.sites.get('four')).toBeNull();
    }, 120_000);

    it('defines a plugin\'s roles when a site grants it, and leaves a role the site changed alone', async () => {
        await network.setPluginState('crew', 'available', { principal: networkAdmin });
        const site = network.hostOf(networkSite((await network.sites.get('two'))!));
        await site.users.defineRole({ id: 'crew-staff', name: 'Crew', permissions: ['cms:dashboard'] });
        await site.grantPlugin('crew', system);
        expect(await site.users.role('crew-staff')).toMatchObject({ name: 'Crew', permissions: ['cms:dashboard'] });
        expect(await site.users.role('crew-manager')).toMatchObject({ name: 'Manager' });
    }, 60_000);
});
