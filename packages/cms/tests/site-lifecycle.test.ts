import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeValue, type RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, createCMS, NETWORK_ADMIN, siteExport, systemPrincipal, userPrincipal, type CmsHost, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

describe.skipIf(!live)('adding, archiving and deleting sites', () => {
    const service = romedbService();
    let other: { db: RomeDB; stop(): Promise<void> };
    let network: CmsNetwork;
    let main: CmsHost;
    let admin: Principal;
    let owner: string;
    const created: string[] = [];
    const deleted: string[] = [];
    let failCreate = true;
    let answers: { [host: string]: string } = {};
    let now = Date.now();

    beforeAll(async () => {
        other = await service.fresh();
        const db = service.database();
        network = new CmsNetwork({
            db, open: () => other.db, networkHost: () => 'example.com', now: () => now,
            directory: {
                async create(name) {
                    if (failCreate) { failCreate = false; throw new Error('provider unavailable'); }
                    created.push(name);
                    return `db-${name}`;
                },
                async delete(id) { deleted.push(id); },
            },
            fetch: async input => {
                const host = new URL(String(input)).hostname;
                return answers[host] ? new Response(answers[host]) : new Response('Not found', { status: 404 });
            },
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id }),
        });
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        const account = await main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', networkRole: NETWORK_ADMIN });
        owner = account.id;
        admin = (await main.users.principal(owner))!;
    }, 60_000);

    afterAll(async () => { await other?.stop(); });

    it('adds sites only while the network is on', async () => {
        expect(await network.enabled()).toBe(false);
        await expect(network.createSite({ name: 'Blog', host: 'blog.example.com', admin: owner }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(network.setEnabled(true, { principal: userPrincipal('someone', ['admin'], ['*']) })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await network.setEnabled(true, { principal: admin });
        expect(await network.enabled()).toBe(true);
    });

    it('lets only network admins add sites, at an address under the network', async () => {
        await expect(network.createSite({ name: 'Blog', host: 'blog.example.com', admin: owner }, { principal: userPrincipal('someone', ['admin'], ['*']) })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(network.createSite({ name: 'Blog', host: 'blog.example.org', admin: owner }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(network.createSite({ name: 'Blog', host: 'blog.example.com', admin: 'nobody' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(network.subdomainSuffix).toBe('example.com');
    });

    it('creates the database, schema, roles and first administrator, and resumes after a failure', async () => {
        await expect(network.createSite({ name: 'The Blog', host: 'blog.example.com', admin: owner }, { principal: admin })).rejects.toThrow(/provider unavailable/);
        expect(await network.sites.get('the-blog')).toMatchObject({ status: 'creating', step: null, database: 'pending-the-blog' });
        expect(await network.resolve('blog.example.com')).toEqual({ kind: 'missing' });

        const site = await network.createSite({ name: 'The Blog', host: 'blog.example.com', admin: owner }, { principal: admin });
        expect(site).toMatchObject({ id: 'the-blog', status: 'active', step: null, database: 'db-site-the-blog', domains: [{ host: 'blog.example.com', primary: true }] });
        expect(created).toEqual(['site-the-blog']);
        const resolved = await network.resolve('blog.example.com');
        expect(resolved).toMatchObject({ kind: 'site', site: { id: 'the-blog' } });
        const blog = network.hostOf((resolved as { site: Parameters<CmsNetwork['hostOf']>[0] }).site);
        expect(await blog.installed()).toBe(true);
        expect(await blog.users.get(owner)).toMatchObject({ roles: ['admin'], email: 'owner@example.com' });
        expect((await blog.users.roles()).map(role => role.id)).toEqual(expect.arrayContaining(['admin', 'editor', 'author', 'subscriber']));
        expect(await blog.settings.get('general.siteTitle')).toBe('The Blog');
        await expect(network.createSite({ name: 'The Blog', host: 'other.example.com', admin: owner }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
    });

    it('makes an own domain primary once it answers with the site', async () => {
        await network.addDomain('the-blog', 'www.theblog.test', { principal: admin });
        expect(await network.resolve('www.theblog.test')).toEqual({ kind: 'redirect', host: 'blog.example.com', site: 'the-blog' });
        answers = { 'www.theblog.test': 'another-site' };
        expect(await network.checkDomain('the-blog', 'www.theblog.test', { principal: admin })).toBe(false);
        answers = { 'www.theblog.test': 'the-blog\n' };
        expect(await network.checkDomain('the-blog', 'www.theblog.test', { principal: admin })).toBe(true);
        expect((await network.sites.get('the-blog'))!.domains).toEqual([
            { host: 'www.theblog.test', primary: true, verifiedAt: expect.any(Number) },
            { host: 'blog.example.com', primary: false, verifiedAt: expect.any(Number) },
        ]);
        expect(await network.resolve('blog.example.com')).toEqual({ kind: 'redirect', host: 'www.theblog.test', site: 'the-blog' });
        expect(await network.removeDomain('the-blog', 'www.theblog.test', { principal: admin })).toBe(false);
        expect(await network.removeDomain('the-blog', 'blog.example.com', { principal: admin })).toBe(true);
    });

    it('records memberships, lists accounts and deletes an account from every site', async () => {
        const blog = network.hostOf((await network.resolve('www.theblog.test') as { site: Parameters<CmsNetwork['hostOf']>[0] }).site);
        const writer = await blog.users.create({ email: 'writer@example.com', name: 'Writer', password: 'writes daily', roles: ['author'], network: true });
        expect((await main.accounts.memberships([owner, writer.id])).get(owner)).toEqual(['main', 'the-blog']);
        expect((await main.accounts.memberships([writer.id])).get(writer.id)).toEqual(['the-blog']);
        expect((await main.accounts.memberCounts()).get('the-blog')).toBe(2);
        expect((await network.memberSites(owner)).map(site => site.id)).toEqual(['main', 'the-blog']);
        expect((await main.accounts.list({ search: 'writer' })).items.map(account => account.id)).toEqual([writer.id]);
        expect((await main.accounts.list({ networkAdmins: true })).items.map(account => account.id)).toEqual([owner]);

        await expect(network.deleteAccount(owner, { principal: admin })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await blog.users.get(owner)).not.toBeNull();
        expect(await network.deleteAccount(writer.id, { principal: admin })).toBe(true);
        expect(await blog.users.get(writer.id)).toBeNull();
        expect(await main.accounts.get(writer.id)).toBeNull();
        expect((await main.accounts.memberships([writer.id])).get(writer.id)).toEqual([]);
    });

    it('keeps network settings and lists sites with schema steps to apply', async () => {
        await expect(network.saveSettings({ subdomainSuffix: 'not a domain' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await network.saveSettings({ name: 'Example Network', subdomainSuffix: 'sites.example.com' }, { principal: admin })).toEqual({ name: 'Example Network', subdomainSuffix: 'sites.example.com', defaultTheme: '', defaultPlugins: [], defaultLanguage: '', siteExports: 'request' });
        await expect(network.createSite({ name: 'Shop', host: 'shop.example.com', admin: owner }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await network.saveSettings({ subdomainSuffix: '' }, { principal: admin });
        expect(await network.updates()).toEqual([]);
        expect(await network.upgrade({ principal: admin })).toEqual({ upgraded: [], failed: [] });
        await network.setState('test.value', { n: 1 });
        expect(await network.state('test.value')).toEqual({ n: 1 });
    });

    it('exports a site\'s database without credentials, in pages, with its values intact', async () => {
        const blog = network.hostOf((await network.resolve('www.theblog.test') as { site: Parameters<CmsNetwork['hostOf']>[0] }).site);
        await blog.settings.update('general', { tagline: 'Notes' }, { principal: systemPrincipal('test') });
        let text = '';
        for await (const chunk of siteExport(blog.db, { site: { id: 'the-blog', name: 'The Blog', host: 'www.theblog.test' }, now: () => 0, pageSize: 2 })) text += chunk;
        const exported = JSON.parse(text) as { format: string; version: number; exportedAt: string; site: unknown; skipped: string[]; tables: { name: string; model: string; columns?: string[]; rows: unknown[] }[] };
        expect(exported).toMatchObject({ format: 'cossack-site-export', version: 1, exportedAt: '1970-01-01T00:00:00.000Z', site: { id: 'the-blog', name: 'The Blog', host: 'www.theblog.test' } });
        const names = exported.tables.map(table => table.name);
        expect(names).toEqual(expect.arrayContaining(['cms_settings', 'cms_users', 'cms_roles', 'cms_user_roles']));
        for (const secret of ['cms_auth_sessions', 'cms_user_security', 'cms_passkeys', 'cms_api_tokens', 'cms_accounts', 'cms_network']) expect(names).not.toContain(secret);
        // Rows come in key order across pages of two, as RomeDB's portable values.
        const settings = exported.tables.find(table => table.name === 'cms_settings')!;
        const rows = settings.rows.map(row => (row as unknown[]).map(value => decodeValue(value)));
        expect(rows.length).toBeGreaterThan(2);
        expect(rows.map(row => row[0])).toEqual([...rows.map(row => row[0])].sort());
        expect(rows.find(row => row[0] === 'general.tagline')?.[settings.columns!.indexOf('value')]).toBe('"Notes"');
        expect(typeof rows[0]![settings.columns!.indexOf('updated_at')]).toBe('bigint');
        const roles = exported.tables.find(table => table.name === 'cms_roles')!;
        expect(roles.rows).toHaveLength((await blog.users.roles()).length);
    });

    it('lets a site download its export after a network admin approves its request, or at once when sites export themselves', async () => {
        const siteAdmin = userPrincipal(owner, ['admin'], ['*']);
        expect(await network.exportAccess('main')).toEqual({ allowed: true, request: null });
        expect(await network.exportAccess('the-blog')).toEqual({ allowed: false, request: null });
        const request = await network.requestExport('the-blog', { principal: siteAdmin });
        expect(request).toMatchObject({ site: 'the-blog', requestedBy: owner, requestedAt: now, approvedAt: null, expiresAt: null });
        expect(await network.requestExport('the-blog', { principal: siteAdmin })).toEqual(request);
        await expect(network.requestExport('nowhere', { principal: siteAdmin })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await expect(network.answerExport('the-blog', true, { principal: siteAdmin })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect((await network.exportAccess('the-blog')).allowed).toBe(false);

        now += 1_000;
        expect(await network.answerExport('the-blog', true, { principal: admin })).toMatchObject({ approvedBy: owner, approvedAt: now, expiresAt: now + 7 * 24 * 60 * 60_000 });
        expect((await network.exportAccess('the-blog')).allowed).toBe(true);
        // An approval lasts 7 days.
        now += 7 * 24 * 60 * 60_000;
        expect(await network.exportAccess('the-blog')).toEqual({ allowed: false, request: null });

        await network.requestExport('the-blog', { principal: siteAdmin });
        expect(await network.answerExport('the-blog', false, { principal: admin })).toBeNull();
        expect((await network.exportRequests()).size).toBe(0);
        await network.requestExport('the-blog', { principal: siteAdmin });
        await network.withdrawExport('the-blog', { principal: siteAdmin });
        expect((await network.exportRequests()).size).toBe(0);

        await expect(network.saveSettings({ siteExports: 'everyone' as 'self' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await network.saveSettings({ siteExports: 'self' }, { principal: admin });
        expect(await network.exportAccess('the-blog')).toEqual({ allowed: true, request: null });
        await network.saveSettings({ siteExports: 'request' }, { principal: admin });
    });

    it('archives, deletes and restores a site, and purges it 30 days after deletion', async () => {
        expect(await network.setSiteStatus('the-blog', 'archived', { principal: admin })).toMatchObject({ status: 'archived' });
        expect(await network.resolve('www.theblog.test')).toMatchObject({ kind: 'archived' });
        expect(await network.setSiteStatus('the-blog', 'deleted', { principal: admin })).toMatchObject({ status: 'deleted', deletedAt: now });
        expect(await network.resolve('www.theblog.test')).toEqual({ kind: 'missing' });
        expect(await network.purgeDeleted()).toEqual([]);
        expect(await network.setSiteStatus('the-blog', 'active', { principal: admin })).toMatchObject({ status: 'active', deletedAt: null });
        await network.setSiteStatus('the-blog', 'deleted', { principal: systemPrincipal('test') });
        now += 31 * 24 * 60 * 60_000;
        expect(await network.purgeDeleted()).toEqual(['the-blog']);
        expect(deleted).toEqual(['db-site-the-blog']);
        expect(await network.sites.get('the-blog')).toBeNull();
        expect(await network.sites.siteOf('www.theblog.test')).toBeNull();
        await expect(network.setSiteStatus('the-blog', 'active', { principal: admin })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
    });
});
