import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRomeDB, decodeValue, MemoryPendingWriteStore, RecordId, type RomeDB } from '@cossackframework/romedb';
import { connectNode, fileDatabases } from '@cossackframework/romedb/node';
import { CmsNetwork, contentModule, createCMS, formsModule, DEFAULT_ROLES, memorySites, siteExport, systemPrincipal, type CmsHost, type NetworkSite, type SitesStore } from '../src/server/index';
import { networkPeople } from './helpers';

/** Files open through `@romedb/node`'s native addon; without it, this suite skips. */
const probe = await mkdtemp(path.join(os.tmpdir(), 'cossack-probe-'));
const native = await connectNode({ url: path.join(probe, 'probe.romedb') }).then(client => client.close().then(() => true), () => false);
await rm(probe, { recursive: true, force: true });

/** A network on files, as the CMS app runs on Node: app.romedb, and a file per added site beside it. */
function fileNetwork(directory: string, sites: SitesStore, people: ReturnType<typeof networkPeople>) {
    const files = fileDatabases(directory);
    const open = (url: string): RomeDB => createRomeDB({ url, connect: () => connectNode({ url }), pending: new MemoryPendingWriteStore() });
    const network: CmsNetwork = new CmsNetwork({
        db: open(path.join(directory, 'app.romedb')), networkHost: () => 'example.com', directory: files, sites, memberSites: people.memberSites,
        open: site => open(files.url(site.database)),
        host: (site, db) => createCMS({ db, network: network.db, site: site.id, modules: [contentModule, formsModule], people: people.of(site.id) }),
    });
    return network;
}

describe.skipIf(!native)('a network on database files', () => {
    let directory: string;
    let network: CmsNetwork;
    let main: CmsHost;
    let owner: string;
    const sites = memorySites();
    const people = networkPeople();

    const siteOf = async (host: string): Promise<CmsHost> => network.hostOf((await network.resolve(host) as { site: NetworkSite }).site);

    beforeAll(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), 'cossack-multisite-'));
        network = fileNetwork(directory, sites, people);
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await main.users.defineRole({ ...role, permissions: [...role.permissions] });
        owner = await people.admin(main, { email: 'owner@example.com', name: 'Owner', roles: ['admin'] });
        await network.setEnabled(true, { principal: systemPrincipal('tests') });
    }, 60_000);

    afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

    it('gives each added site its own file, schema and members', async () => {
        const principal = (await main.users.principal(owner))!;
        await network.createSite({ name: 'Blog', host: 'blog.example.com', admin: owner }, { principal });
        await network.createSite({ name: 'Shop', host: 'shop.example.com', admin: owner, starter: true }, { principal });
        const files = (await readdir(directory)).filter(name => name.endsWith('.romedb')).sort();
        expect(files).toHaveLength(3);
        expect(files).toContain('app.romedb');

        const blog = await siteOf('blog.example.com');
        const shop = await siteOf('shop.example.com');
        expect(blog.db).not.toBe(shop.db);
        const writer = await main.users.create({ email: 'writer@example.com', name: 'Writer' });
        expect((await blog.users.addMember(writer.id, { roles: ['author'] }))?.roles).toEqual(['author']);
        expect(await shop.users.get(writer.id)).toBeNull();
        expect((await shop.resource('cms/posts').list({ limit: 5 }, { principal: (await shop.users.principal(owner))! })).records.length).toBeGreaterThan(0);
        expect((await blog.resource('cms/posts').list({ limit: 5 }, { principal: (await blog.users.principal(owner))! })).records).toEqual([]);
        // The shop's export holds its starter post whole, with its record ID.
        let text = '';
        for await (const chunk of siteExport(shop.db, { site: { id: 'shop', name: 'Shop', host: 'shop.example.com' } })) text += chunk;
        const posts = (JSON.parse(text) as { tables: { name: string; model: string; rows: unknown[] }[] }).tables.find(table => table.name === 'r__cms__posts')!;
        expect(posts.model).toBe('document');
        const post = decodeValue(posts.rows[0]) as { id: RecordId; title: string };
        expect(post.id).toBeInstanceOf(RecordId);
        expect(post.id.table).toBe('r__cms__posts');
        expect(typeof post.title).toBe('string');
    }, 60_000);

    it('opens every file again after a restart', async () => {
        await network.release((await network.sites.get('blog'))!.database);
        await network.release((await network.sites.get('shop'))!.database);
        await network.db.close();
        network = fileNetwork(directory, sites, people);
        main = network.main;
        await main.ready();
        expect(await main.installed()).toBe(true);
        const blog = await siteOf('blog.example.com');
        expect(await blog.installed()).toBe(true);
        expect((await blog.users.list()).items.map(user => user.email).sort()).toEqual(['owner@example.com', 'writer@example.com']);
        expect((await network.memberSites(owner)).map(site => site.id)).toEqual(['main', 'blog', 'shop']);
    }, 60_000);

    it('deletes a site\'s file 30 days after the site is deleted', async () => {
        const principal = (await main.users.principal(owner))!;
        const shop = (await network.sites.get('shop'))!;
        await network.setSiteStatus('shop', 'deleted', { principal });
        expect(await network.purgeDeleted({ olderThanMs: 0 })).toEqual(['shop']);
        const files = await readdir(directory);
        expect(files.some(name => name.startsWith(shop.database))).toBe(false);
        expect(files.filter(name => name.endsWith('.romedb'))).toHaveLength(2);
        expect(await network.resolve('shop.example.com')).toEqual({ kind: 'missing' });
    }, 60_000);
});
