import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, contentModule, createCMS, field, NETWORK_ADMIN, systemPrincipal, type Block, type CmsHost, type NetworkSite, type PluginRegistrationLike, type Principal } from '../src/server/index';
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
const themes: PluginRegistrationLike[] = [
    { name: 'folio', version: '1.0.0', templates, manifest: { schemaVersion: 1, name: 'folio', version: '1.0.0', theme: { label: 'Folio' } } },
    { name: 'plain', version: '1.0.0', templates, manifest: { schemaVersion: 1, name: 'plain', version: '1.0.0', theme: { label: 'Plain' } } },
];

describe.skipIf(!live)('network plugin and theme states', () => {
    const service = romedbService();
    let other: { db: RomeDB; stop(): Promise<void> };
    let network: CmsNetwork;
    let blog: CmsHost;
    let plugins: PluginRegistrationLike[] = [promo(['api.example.com']), ...themes];

    /** A network whose hosts get today's plugin code, as a deploy would give them. */
    const open = () => {
        const db = service.database();
        const next: CmsNetwork = new CmsNetwork({
            db, open: () => other.db, networkHost: () => 'example.com',
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
        await network.sites.create({ id: 'blog', name: 'Blog', database: 'blog-db', domains: [{ host: 'blog.example.com' }] });
        blog = await siteOf(network);
        expect((await blog.migrate()).failed).toBeUndefined();
        await blog.ready();
    }, 60_000);

    afterAll(async () => { await other?.stop(); });

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
});
