import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, createCMS, NETWORK_ADMIN, systemPrincipal, userPrincipal, type CmsHost, type Principal } from '../src/server/index';
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
            host: (_site, siteDb) => createCMS({ db: siteDb, network: db }),
        });
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        const account = await main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', networkRole: NETWORK_ADMIN });
        owner = account.id;
        admin = (await main.users.principal(owner))!;
    }, 60_000);

    afterAll(async () => { await other?.stop(); });

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
