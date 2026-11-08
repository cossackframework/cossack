import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, contentModule, createCMS, field, NETWORK_ADMIN, networkSite, systemPrincipal, type Block, type CmsHost, type NetworkSite, type PluginRegistrationLike, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

const networkAdmin: Principal = { kind: 'user', id: 'root', roles: ['admin', NETWORK_ADMIN], permissions: ['*'] };
const siteAdmin: Principal = { kind: 'user', id: 'site-admin', roles: ['admin'], permissions: ['*'] };
const noop = () => null as never;
const templates = { layout: { default: noop }, entry: { default: noop }, archive: { default: noop } };
const weight: Block = { _id: 'weight', type: 'field/number', data: { name: 'weight', label: 'Weight', min: 0 } };

/** A plugin with its own collection, a field group for it, and a network host it may fetch. */
const promo = (hosts: string[]): PluginRegistrationLike => ({
    name: 'promo', version: '1.0.0',
    manifest: {
        schemaVersion: 1, name: 'promo', version: '1.0.0', permissions: { network: hosts },
        collections: [{ name: 'promos', label: 'Promos', singular: 'Promo', path: 'promos', icon: 'tag', fields: { code: field.string({ label: 'Code' }) } }],
        fieldGroups: [{ id: 'promo-shipping', title: 'Shipping', targets: [{ kind: 'collection', name: 'promos' }], blocks: [weight] }],
    },
});
/** A plugin asking for everything. */
const vault: PluginRegistrationLike = { name: 'vault', version: '1.0.0', manifest: { schemaVersion: 1, name: 'vault', version: '1.0.0', permissions: { unrestricted: true } } };
const themes: PluginRegistrationLike[] = [
    { name: 'folio', version: '1.0.0', templates, manifest: { schemaVersion: 1, name: 'folio', version: '1.0.0', theme: { label: 'Folio' } } },
    { name: 'plain', version: '1.0.0', templates, manifest: { schemaVersion: 1, name: 'plain', version: '1.0.0', theme: { label: 'Plain' } } },
];

describe.skipIf(!live)('network plugin and theme states', () => {
    const service = romedbService();
    let other: { db: RomeDB; stop(): Promise<void> };
    /** Databases of sites the tests add, by database ID. */
    const added = new Map<string, { db: RomeDB; stop(): Promise<void> }>();
    let network: CmsNetwork;
    let blog: CmsHost;
    let plugins: PluginRegistrationLike[] = [promo(['api.example.com']), ...themes];

    /** A network whose hosts get today's plugin code, as a deploy would give them. */
    const open = () => {
        const db = service.database();
        const next: CmsNetwork = new CmsNetwork({
            db, open: site => added.get(site.database)?.db ?? other.db, networkHost: () => 'example.com',
            directory: {
                async create(name) {
                    if (!added.has(`db-${name}`)) added.set(`db-${name}`, await service.fresh());
                    return `db-${name}`;
                },
                async delete() {},
            },
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id, modules: [contentModule], plugins }),
        });
        return next;
    };
    const siteOf = async (net: CmsNetwork) => net.hostOf((await net.resolve('blog.example.com') as { site: NetworkSite }).site);
    const promoStatus = async (host: CmsHost) => (await host.status()).plugins.find(plugin => plugin.name === 'promo');

    beforeAll(async () => {
        other = await service.fresh();
        network = open();
        expect((await network.main.migrate()).failed).toBeUndefined();
        await network.setEnabled(true, { principal: systemPrincipal('tests') });
        await network.sites.create({ id: 'blog', name: 'Blog', database: 'blog-db', domains: [{ host: 'blog.example.com' }] });
        blog = await siteOf(network);
        expect((await blog.migrate()).failed).toBeUndefined();
        await blog.ready();
    }, 60_000);

    afterAll(async () => {
        await other?.stop();
        for (const database of added.values()) await database.stop();
    });

    it('leaves plugins to each site until the network decides', async () => {
        expect(await promoStatus(blog)).toMatchObject({ network: 'available', active: false, requests: ['plugin:enabled', 'network:api.example.com'] });
        expect(await network.policy()).toMatchObject({ plugins: new Map(), hiddenThemes: new Set() });
        await expect(network.setPluginState('promo', 'network', { principal: siteAdmin })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(network.setPluginState('folio', 'network', { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
    });

    it('activates a plugin on every site, with its field groups, and keeps site admins from turning it off', async () => {
        expect(await network.setPluginState('promo', 'network', { principal: networkAdmin })).toMatchObject({ network: 'network', active: true });
        await blog.ready();
        expect(await promoStatus(blog)).toMatchObject({ network: 'network', active: true, missing: [] });
        expect(blog.collections().map(collection => collection.name)).toContain('promos');
        expect((await blog.fieldGroups.get('promo-shipping'))?.plugin).toBe('promo');
        expect(Object.keys(blog.resourceById('cms/promos').fields)).toContain('weight');
        await expect(blog.revokePlugin('promo', siteAdmin)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(blog.grantPlugin('promo', siteAdmin)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        // The site's own grant table stays empty: the network's approval is what counts.
        expect((await blog.db.read([{ rql: "SELECT 1 FROM cms_grants WHERE subject = 'plugin:promo' LIMIT 1" }])).results[0]!.rows).toEqual([]);
    });

    it('waits for the network admin when an upgrade requests more', async () => {
        plugins = [promo(['api.example.com', 'cdn.example.com']), ...themes];
        const upgraded = open();
        const site = await siteOf(upgraded);
        await site.ready();
        expect(await promoStatus(site)).toMatchObject({ network: 'network', active: false, missing: ['network:cdn.example.com'] });
        expect((await promoStatus(site))!.reason).toMatch(/network's grant/);
        await upgraded.setPluginState('promo', 'network', { principal: networkAdmin });
        expect(await promoStatus(site)).toMatchObject({ network: 'network', active: true });
        network = upgraded;
        blog = site;
    });

    it('hides a plugin from every site, whatever the site granted', async () => {
        await network.setPluginState('promo', 'available', { principal: networkAdmin });
        expect(await promoStatus(blog)).toMatchObject({ network: 'available', active: false });
        await blog.grantPlugin('promo', siteAdmin);
        expect(await blog.pluginActive('promo')).toBe(true);
        await network.setPluginState('promo', 'hidden', { principal: networkAdmin });
        expect(await promoStatus(blog)).toMatchObject({ network: 'hidden', active: false, reason: 'Hidden by the network.' });
        expect(await blog.pluginActive('promo')).toBe(false);
        await expect(blog.grantPlugin('promo', siteAdmin)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        // Available again: the site's own grant applies.
        await network.setPluginState('promo', 'available', { principal: networkAdmin });
        expect(await blog.pluginActive('promo')).toBe(true);
    });

    it('asks a network admin to confirm unrestricted access, and a site admin cannot grant it', async () => {
        plugins = [...plugins, vault];
        const upgraded = open();
        const site = await siteOf(upgraded);
        await site.ready({ force: true });
        // New sites' default plugins grant without confirming, so they cannot enable it either.
        await expect(site.grantPlugin('vault', systemPrincipal('defaults'))).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await expect(site.grantPlugin('vault', siteAdmin, { unrestricted: true })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(upgraded.setPluginState('vault', 'network', { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await upgraded.setPluginState('vault', 'network', { principal: networkAdmin, unrestricted: true })).toMatchObject({ network: 'network', unrestricted: true, active: true });
        expect((await upgraded.main.audit.list({ action: 'grant-unrestricted' })).items).toMatchObject([{ actor: 'root', resource: 'cms/plugins', recordId: 'vault' }]);
        await upgraded.setPluginState('vault', 'available', { principal: networkAdmin });
        plugins = plugins.filter(plugin => plugin !== vault);
    });

    it('hides themes from every site, and a site on a hidden theme falls back', async () => {
        await blog.activateTheme('plain', siteAdmin);
        expect(await blog.activeTheme()).toBe('plain');
        await network.setThemeState('plain', 'hidden', { principal: networkAdmin });
        expect((await blog.availableThemes()).map(theme => theme.name)).toEqual(['folio']);
        expect(await blog.activeTheme()).toBe('folio');
        await expect(blog.activateTheme('plain', siteAdmin)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        expect(blog.themes().map(theme => theme.name)).toContain('plain');
        await expect(network.setThemeState('missing', 'hidden', { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await network.setThemeState('plain', 'available', { principal: networkAdmin });
        expect(await blog.activeTheme()).toBe('plain');
        expect(await network.policy()).toMatchObject({ hiddenThemes: new Set() });
    });

    it('applies to the main site too, which reads the same table', async () => {
        await network.setPluginState('promo', 'network', { principal: networkAdmin });
        await network.main.ready();
        expect(await network.main.pluginActive('promo')).toBe(true);
        await network.setPluginState('promo', 'available', { principal: systemPrincipal('tests') });
        expect(await network.main.pluginActive('promo')).toBe(false);
    });

    it('starts new sites with the network\'s theme, plugins and language', async () => {
        await expect(network.saveSettings({ defaultTheme: 'missing' }, { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(network.saveSettings({ defaultPlugins: ['folio'] }, { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(network.saveSettings({ defaultLanguage: 'French' }, { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await network.saveSettings({ defaultTheme: 'folio', defaultPlugins: ['promo', 'promo'], defaultLanguage: 'fr' }, { principal: networkAdmin });
        expect(await network.settings()).toMatchObject({ defaultTheme: 'folio', defaultPlugins: ['promo'], defaultLanguage: 'fr' });
        const owner = (await network.main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', networkRole: NETWORK_ADMIN })).id;

        const shop = network.hostOf(networkSite(await network.createSite({ name: 'Shop', host: 'shop.example.com', admin: owner }, { principal: networkAdmin })));
        await shop.ready();
        expect(await shop.activeTheme()).toBe('folio');
        expect(await shop.settings.get('appearance.theme')).toBe('folio');
        expect(await shop.pluginActive('promo')).toBe(true);
        expect((await shop.languages()).default).toBe('fr');

        // The form's language wins; a default the network hid since is left out.
        await network.setPluginState('promo', 'hidden', { principal: networkAdmin });
        await network.setThemeState('folio', 'hidden', { principal: networkAdmin });
        const news = network.hostOf(networkSite(await network.createSite({ name: 'News', host: 'news.example.com', admin: owner, language: 'de' }, { principal: networkAdmin })));
        expect((await news.languages()).default).toBe('de');
        expect(await news.settings.get('appearance.theme')).toBe('');
        expect(await news.activeTheme()).toBe('plain');
        await network.setPluginState('promo', 'available', { principal: networkAdmin });
        expect(await news.pluginActive('promo')).toBe(false);
        await expect(network.createSite({ name: 'Bad', host: 'bad.example.com', admin: owner, language: 'Deutsch' }, { principal: networkAdmin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    }, 60_000);
});
