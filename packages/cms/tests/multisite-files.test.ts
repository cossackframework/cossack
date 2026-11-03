import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRomeDB, decodeValue, MemoryPendingWriteStore, RecordId, type RomeDB } from '@cossackframework/romedb';
import { connectNode, fileDatabases } from '@cossackframework/romedb/node';
import { CmsNetwork, contentModule, createCMS, formsModule, DEFAULT_ROLES, NETWORK_ADMIN, siteExport, systemPrincipal, type CmsHost, type NetworkSite } from '../src/server/index';

/** Files open through `@romedb/node`'s native addon; without it, this suite skips. */
const probe = await mkdtemp(path.join(os.tmpdir(), 'cossack-probe-'));
const native = await connectNode({ url: path.join(probe, 'probe.romedb') }).then(client => client.close().then(() => true), () => false);
await rm(probe, { recursive: true, force: true });

/** A network on files, as the CMS app runs on Node: app.romedb, and a file per added site beside it. */
function fileNetwork(directory: string) {
    const files = fileDatabases(directory);
    const open = (url: string): RomeDB => createRomeDB({ url, connect: () => connectNode({ url }), pending: new MemoryPendingWriteStore() });
    const network: CmsNetwork = new CmsNetwork({
        db: open(path.join(directory, 'app.romedb')), networkHost: () => 'example.com', directory: files,
        open: site => open(files.url(site.database)),
        host: (site, db) => createCMS({ db, network: network.db, site: site.id, modules: [contentModule, formsModule], sessionsEnded: ended => network.endSessions(ended) }),
    });
    return network;
}

const record = (token: string, userId: string) => ({ id: token.repeat(64).slice(0, 64), userId, kind: 'auth' as const, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });

describe.skipIf(!native)('a network on database files', () => {
    let directory: string;
    let network: CmsNetwork;
    let main: CmsHost;
    let owner: string;

    const siteOf = async (host: string): Promise<CmsHost> => network.hostOf((await network.resolve(host) as { site: NetworkSite }).site);

    beforeAll(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), 'cossack-multisite-'));
        network = fileNetwork(directory);
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await main.users.defineRole({ ...role, permissions: [...role.permissions] });
        owner = (await main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', roles: ['admin'], networkRole: NETWORK_ADMIN })).id;
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
        const writer = await blog.users.create({ email: 'writer@example.com', name: 'Writer', password: 'writes daily', roles: ['author'], network: true });
        expect(await shop.users.get(writer.id)).toBeNull();
        expect(await main.users.get(writer.id)).toBeNull();
        expect((await main.accounts.verifier.verify('writer@example.com', 'writes daily'))?.id).toBe(writer.id);
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

    it('hands a network session to a site and ends it there when it ends', async () => {
        const blog = await siteOf('blog.example.com');
        const writer = (await main.accounts.findByEmail('writer@example.com'))!;
        await main.authSessions.create(record('n', writer.id));
        const reference = (await main.authSessions.publicReference(record('n', writer.id).id))!;
        const handoff = (await network.handoffs.consume(await network.handoffs.issue({ session: reference, user: writer.id, site: 'blog' }), 'blog'))!;
        await blog.authSessions.createChild(record('c', writer.id), { parentId: handoff.session, networkRole: handoff.networkRole, expiresAt: handoff.expiresAt });
        expect((await blog.users.resolve(writer.id, { networkRole: handoff.networkRole }))!.principal).toMatchObject({ roles: ['author'] });
        await main.authSessions.revoke(record('n', writer.id).id);
        expect(await blog.authSessions.read(record('c', writer.id).id)).toBeNull();
    });

    it('opens every file again after a restart', async () => {
        await network.release((await network.sites.get('blog'))!.database);
        await network.release((await network.sites.get('shop'))!.database);
        await network.db.close();
        network = fileNetwork(directory);
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

    it('runs a site\'s database as its own install: members get accounts, its administrator a new password', async () => {
        const blog = await siteOf('blog.example.com');
        const writer = (await main.accounts.findByEmail('writer@example.com'))!;
        // The blog's database alone, as another install's main database.
        const standalone = createCMS({ db: blog.db, modules: [contentModule, formsModule] });
        expect(await standalone.accounts.count()).toBe(0);
        await expect(standalone.accounts.adoptMembers('main', '01a19fc6-0000-7000-8000-000000000000', 'a new password')).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await standalone.accounts.count()).toBe(0);
        expect(await standalone.accounts.adoptMembers('main', owner, 'a new password')).toBe(2);
        expect((await standalone.accounts.verifier.verify('owner@example.com', 'a new password'))?.id).toBe(owner);
        expect(await standalone.accounts.get(owner)).toMatchObject({ networkRole: NETWORK_ADMIN, status: 'active' });
        // Passwords stay in the network: other members set one with a reset.
        expect(await standalone.accounts.verifier.verify('writer@example.com', 'writes daily')).toBeNull();
        expect(await standalone.accounts.get(writer.id)).toMatchObject({ email: 'writer@example.com', networkRole: null });
        expect((await standalone.accounts.memberships([owner, writer.id])).get(writer.id)).toEqual(['main']);
        expect(await standalone.users.principal(owner)).toMatchObject({ roles: expect.arrayContaining(['admin']) });
        // Taking over again changes nothing but the password.
        expect(await standalone.accounts.adoptMembers('main', owner, 'another password')).toBe(0);
    }, 60_000);
});
