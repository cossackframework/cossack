import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeValue, type RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, createCMS, memorySites, siteExport, systemPrincipal, userPrincipal, type CmsHost, type Principal } from '../src/server/index';
import { networkPeople, romedbService, live } from './helpers';

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
    const people = networkPeople();
    const sites = memorySites({ now: () => now });

    beforeAll(async () => {
        other = await service.fresh();
        const db = service.database();
        network = new CmsNetwork({
            db, open: () => other.db, networkHost: () => 'example.com', now: () => now, sites, memberSites: people.memberSites,
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
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id, people: people.of(site.id) }),
        });
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        owner = await people.admin(main, { email: 'owner@example.com', name: 'Owner' });
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

    it('lists the sites an account is a member of', async () => {
        const blog = network.hostOf((await network.resolve('www.theblog.test') as { site: Parameters<CmsNetwork['hostOf']>[0] }).site);
        const writer = await main.users.create({ email: 'writer@example.com', name: 'Writer' });
        expect(await blog.users.addMember(writer.id, { roles: ['author'] })).toMatchObject({ email: 'writer@example.com', roles: ['author'] });
        expect((await network.memberSites(owner)).map(site => site.id)).toEqual(['main', 'the-blog']);
        expect((await network.memberSites(writer.id)).map(site => site.id)).toEqual(['main', 'the-blog']);
        expect(await blog.users.addMember('nobody')).toBeNull();
    });

    it('keeps network settings and lists sites with schema steps to apply', async () => {
        await expect(network.saveSettings({ subdomainSuffix: 'not a domain' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await network.saveSettings({ name: 'Example Network', subdomainSuffix: 'sites.example.com' }, { principal: admin })).toEqual({ name: 'Example Network', subdomainSuffix: 'sites.example.com', defaultTheme: '', defaultPlugins: [], defaultLanguage: '', siteExports: 'request', siteRegistration: false });
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
        // The application's account tables, as the dashboard package keeps them in a site's database.
        await blog.db.write([
            { rql: 'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT)' },
            { rql: 'CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)' },
            { rql: "INSERT INTO users (id, email, password_hash) VALUES ('u1', 'reader@example.com', 'a hash')" },
            { rql: "INSERT INTO sessions (id, user_id) VALUES ('token', 'u1')" },
        ], { kind: 'test' });
        let text = '';
        for await (const chunk of siteExport(blog.db, { site: { id: 'the-blog', name: 'The Blog', host: 'www.theblog.test' }, now: () => 0, pageSize: 2 })) text += chunk;
        const exported = JSON.parse(text) as { format: string; version: number; exportedAt: string; site: unknown; skipped: string[]; tables: { name: string; model: string; columns?: string[]; rows: unknown[] }[] };
        expect(exported).toMatchObject({ format: 'cossack-site-export', version: 1, exportedAt: '1970-01-01T00:00:00.000Z', site: { id: 'the-blog', name: 'The Blog', host: 'www.theblog.test' } });
        const names = exported.tables.map(table => table.name);
        expect(names).toEqual(expect.arrayContaining(['cms_settings', 'cms_authors', 'users']));
        for (const secret of ['sessions', 'cms_network', 'cms_attempts']) expect(names).not.toContain(secret);
        const users = exported.tables.find(table => table.name === 'users')!;
        expect((users.rows as unknown[][]).map(row => row.map(value => decodeValue(value)))).toEqual([['u1', 'reader@example.com', null]]);
        // Rows come in key order across pages of two, as RomeDB's portable values.
        const settings = exported.tables.find(table => table.name === 'cms_settings')!;
        const rows = settings.rows.map(row => (row as unknown[]).map(value => decodeValue(value)));
        expect(rows.length).toBeGreaterThan(2);
        expect(rows.map(row => row[0])).toEqual([...rows.map(row => row[0])].sort());
        expect(rows.find(row => row[0] === 'general.tagline')?.[settings.columns!.indexOf('value')]).toBe('"Notes"');
        expect(typeof rows[0]![settings.columns!.indexOf('updated_at')]).toBe('bigint');
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

        // Another site's request written between this change's read and its write is kept: the change reads again.
        await network.requestExport('the-blog', { principal: siteAdmin });
        const db = service.database();
        let raced = false;
        const racing = new Proxy(db, {
            get(target, property) {
                if (property === 'read') return async (statements: Parameters<RomeDB['read']>[0], options?: Parameters<RomeDB['read']>[1]) => {
                    const result = await target.read(statements, options);
                    if (!raced && statements[0]?.rql.includes('FROM cms_network') && statements[0].params?.$key === 'exports') {
                        raced = true;
                        const value = JSON.parse(String(result.results[0]!.rows[0]![0])) as Record<string, unknown>;
                        await target.write([{ rql: "UPDATE cms_network SET value = $value WHERE key = 'exports'", params: { $value: JSON.stringify({ ...value, 'other-site': { requestedBy: owner, requestedAt: now } }) } }]);
                    }
                    return result;
                };
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            },
        });
        const second = new CmsNetwork({ db: racing, open: () => other.db, networkHost: () => 'example.com', now: () => now, sites, memberSites: people.memberSites, host: (site, siteDb) => createCMS({ db: siteDb, network: racing, site: site.id, people: people.of(site.id) }) });
        await second.withdrawExport('the-blog', { principal: siteAdmin });
        expect(raced).toBe(true);
        expect([...(await network.exportRequests()).keys()]).toEqual(['other-site']);
        await network.withdrawExport('other-site', { principal: siteAdmin });

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
