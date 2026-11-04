import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRomeDB, MemoryPendingWriteStore, type RomeDB } from '@cossackframework/romedb';
import { cleanedFile, connectNode } from '@cossackframework/romedb/node';
import { startRomeDBService } from '@cossackframework/romedb/testing';
import { cleanSiteFile, CmsNetwork, contentModule, createCMS, DEFAULT_ROLES, FILE_EXPORT_EMPTIED_TABLES, formsModule, NETWORK_ADMIN, seedStarterContent, systemPrincipal, type CmsHost, type NetworkSite } from '../src/server/index';
import { romedbService, live } from './helpers';

const modules = [contentModule, formsModule];
const TOKEN = 'f00dcafe'.repeat(8);
const SECRET = 'an old webhook secret that must not leave';

const bytesOf = async (body: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    const reader = body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
    return Buffer.concat(chunks);
};

describe.skipIf(!live)('a site as a .romedb file', () => {
    const service = romedbService();
    let site: { db: RomeDB; stop(): Promise<void> };
    let network: CmsNetwork;
    let blog: CmsHost;
    let owner: string;
    let work: string;
    let folder: string;

    beforeAll(async () => {
        site = await service.fresh();
        work = await mkdtemp(path.join(os.tmpdir(), 'cossack-site-file-'));
        folder = path.join(work, 'temporary');
        await mkdir(folder);
        const db = service.database();
        network = new CmsNetwork({
            db, open: () => site.db, networkHost: () => 'example.com',
            host: (record, siteDb) => createCMS({ db: siteDb, network: db, site: record.id, modules, sessionsEnded: ended => network.endSessions(ended) }),
        });
        expect((await network.main.migrate()).failed).toBeUndefined();
        await network.setEnabled(true, { principal: systemPrincipal('tests') });
        owner = (await network.main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', roles: ['admin'], networkRole: NETWORK_ADMIN })).id;
        await network.sites.create({ id: 'blog', name: 'Blog', database: 'blog-db', domains: [{ host: 'blog.example.com' }] });
        blog = network.hostOf((await network.resolve('blog.example.com') as { site: NetworkSite }).site);
        expect((await blog.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await blog.users.defineRole({ ...role, permissions: [...role.permissions] });
        await blog.users.addMember(owner, { roles: ['admin'] });
        await seedStarterContent(blog, { principal: (await blog.users.principal(owner))! });
        const reader = await blog.users.create({ email: 'reader@example.com', name: 'Reader', password: 'reads a lot', roles: ['subscriber'] });
        await blog.authSessions.create({ id: TOKEN, userId: reader.id, kind: 'auth', createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
        await blog.db.write([{ rql: 'INSERT INTO cms_webhooks (id, name, url, events, collections, secret, active, created_at, updated_at) VALUES ($id, $name, $url, $events, $collections, $secret, 1, 1, 1)',
            params: { $id: 'hook', $name: 'Hook', $url: 'https://hooks.example.com', $events: '[]', $collections: '[]', $secret: SECRET } }]);
        // More rows than one cleaning write removes.
        for (let batch = 0; batch < 20; batch++) {
            await blog.db.write(Array.from({ length: 32 }, (_, index) => ({ rql: 'INSERT INTO cms_cache (key, value) VALUES ($key, $value)', params: { $key: `k${batch}-${index}`, $value: 'cached' } })));
        }
    }, 120_000);

    afterAll(async () => {
        await site?.stop();
        await rm(work, { recursive: true, force: true });
    });

    it('sends a whole database without its sign-in state, pending work or webhook secrets, in or between its pages', async () => {
        // RomeDB's copy holds the session's token as it is: this is what cleaning takes out.
        expect((await bytesOf((await blog.db.exportFile()).body)).includes(TOKEN)).toBe(true);
        const writes = Promise.all(Array.from({ length: 5 }, (_, index) => blog.settings.update('general', { tagline: `Writing ${index}` }, { principal: systemPrincipal('tests') })));
        const [file] = await Promise.all([cleanedFile(blog.db, cleanSiteFile, { directory: folder }), writes]);
        // Only the cleaned copy is left by the time the file is sent.
        const temporary = await readdir(folder);
        expect(temporary).toHaveLength(1);
        expect(await readdir(path.join(folder, temporary[0]!))).toEqual(['cleaned.romedb']);
        const bytes = await bytesOf(file.body);
        expect(bytes.length).toBe(file.size);
        expect(await readdir(folder)).toEqual([]);
        expect(bytes.includes(TOKEN)).toBe(false);
        expect(bytes.includes(SECRET)).toBe(false);
        await writeFile(path.join(work, 'blog.romedb'), bytes);

        const opened = createRomeDB({ url: path.join(work, 'blog.romedb'), pending: new MemoryPendingWriteStore(), connect: () => connectNode({ url: path.join(work, 'blog.romedb') }) });
        const counts = await opened.read(FILE_EXPORT_EMPTIED_TABLES.map(table => ({ rql: `SELECT count(*) FROM ${table}` })));
        expect(counts.results.map(result => result.rows[0]![0])).toEqual(FILE_EXPORT_EMPTIED_TABLES.map(() => 0n));
        const hook = (await opened.read([{ rql: "SELECT secret, active FROM cms_webhooks WHERE id = 'hook'" }])).results[0]!.rows[0]!;
        expect(hook[0]).toMatch(/^[0-9a-f]{64}$/);
        expect(hook[1]).toBe(0n);

        // It runs as its own install: site accounts keep their passwords, and setup takes it over.
        const standalone = createCMS({ db: opened, modules });
        await standalone.ready({ force: true });
        expect((await standalone.accounts.verifier.verify('reader@example.com', 'reads a lot'))?.email).toBe('reader@example.com');
        expect(await standalone.accounts.hasNetworkAdmin()).toBe(false);
        expect(await standalone.accounts.adoptMembers('main', owner, 'the new owner')).toBe(1);
        const admin = (await standalone.users.principal(owner))!;
        expect((await standalone.resource('cms/posts').list({}, { principal: admin })).records.map(record => record.title)).toEqual(['Hello World!']);
        await opened.close();

        // The site itself is unchanged.
        expect(await blog.authSessions.read(TOKEN)).not.toBeNull();
        expect((await blog.db.read([{ rql: 'SELECT count(*) FROM cms_cache' }])).results[0]!.rows[0]![0]).toBe(640n);
    }, 60_000);

    it('opens in romedb serve', async () => {
        const served = await startRomeDBService({ file: path.join(work, 'blog.romedb') });
        const db = createRomeDB({ url: served.url, token: served.token, pending: new MemoryPendingWriteStore() });
        try { expect((await db.read([{ rql: 'SELECT count(*) FROM cms_auth_sessions' }])).results[0]!.rows[0]![0]).toBe(0n); }
        finally {
            await db.close();
            await served.stop();
        }
    }, 30_000);

    it('removes its copies when the download is cancelled or the cleaning fails', async () => {
        const file = await cleanedFile(blog.db, cleanSiteFile, { directory: folder });
        expect(await readdir(folder)).toHaveLength(1);
        await file.body.cancel();
        expect(await readdir(folder)).toEqual([]);
        await expect(cleanedFile(blog.db, async () => { throw new Error('could not clean'); }, { directory: folder })).rejects.toThrow('could not clean');
        expect(await readdir(folder)).toEqual([]);
    }, 30_000);
});
