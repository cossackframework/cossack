import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRomeDB, MemoryPendingWriteStore, type RomeDB } from '@cossackframework/romedb';
import { connectNode } from '@cossackframework/romedb/node';
import { servesDirectories, startRomeDBDirectory, startRomeDBService } from '@cossackframework/romedb/testing';
import { CmsNetwork, contentModule, createCMS, DEFAULT_ROLES, FILE_EXPORT_EMPTIED_TABLES, formsModule, memorySites, seedStarterContent, siteFile, systemPrincipal, type CmsHost, type NetworkSite } from '../src/server/index';
import { networkPeople, romedbService, live } from './helpers';

const modules = [contentModule, formsModule];
const TOKEN = 'f00dcafe'.repeat(8);
const SECRET = 'an old webhook secret that must not leave';
const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

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
    const people = networkPeople();

    beforeAll(async () => {
        site = await service.fresh();
        work = await mkdtemp(path.join(os.tmpdir(), 'cossack-site-file-'));
        const db = service.database();
        network = new CmsNetwork({
            db, open: () => site.db, networkHost: () => 'example.com', sites: memorySites(), memberSites: people.memberSites,
            host: (record, siteDb) => createCMS({ db: siteDb, network: db, site: record.id, modules, people: people.of(record.id) }),
        });
        expect((await network.main.migrate()).failed).toBeUndefined();
        await network.setEnabled(true, { principal: systemPrincipal('tests') });
        for (const role of DEFAULT_ROLES) await network.main.users.defineRole({ ...role, permissions: [...role.permissions] });
        owner = await people.admin(network.main, { email: 'owner@example.com', name: 'Owner', roles: ['admin'] });
        await network.sites.create({ id: 'blog', name: 'Blog', database: 'blog-db', domains: [{ host: 'blog.example.com' }] });
        blog = network.hostOf((await network.resolve('blog.example.com') as { site: NetworkSite }).site);
        expect((await blog.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await blog.users.defineRole({ ...role, permissions: [...role.permissions] });
        await blog.users.addMember(owner, { roles: ['admin'] });
        await seedStarterContent(blog, { principal: (await blog.users.principal(owner))! });
        // The application's sign-in tables, as the dashboard package keeps them in a site's database.
        await blog.db.write([
            { rql: 'CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)' },
            { rql: 'CREATE TABLE user_security (user_id TEXT PRIMARY KEY, totp_secret TEXT)' },
            { rql: 'INSERT INTO sessions (id, user_id) VALUES ($id, $user)', params: { $id: TOKEN, $user: owner } },
            { rql: 'INSERT INTO user_security (user_id, totp_secret) VALUES ($user, $secret)', params: { $user: owner, $secret: TOTP } },
        ], { kind: 'test' });
        await blog.db.write([{ rql: 'INSERT INTO cms_webhooks (id, name, url, events, collections, secret, active, created_at, updated_at) VALUES ($id, $name, $url, $events, $collections, $secret, 1, 1, 1)',
            params: { $id: 'hook', $name: 'Hook', $url: 'https://hooks.example.com', $events: '[]', $collections: '[]', $secret: SECRET } }]);
    }, 120_000);

    afterAll(async () => {
        await site?.stop();
        await rm(work, { recursive: true, force: true });
    });

    it('sends a whole database with no byte of its sign-in state, webhooks or pending work', async () => {
        // A plain copy holds both values as they are, so the scan below can find them.
        const plain = await bytesOf((await blog.db.exportFile()).body);
        expect(plain.includes(TOKEN)).toBe(true);
        expect(plain.includes(SECRET)).toBe(true);
        expect(plain.includes(TOTP)).toBe(true);

        const writes = Promise.all(Array.from({ length: 5 }, (_, index) => blog.settings.update('general', { tagline: `Writing ${index}` }, { principal: systemPrincipal('tests') })));
        const [file] = await Promise.all([siteFile(blog.db), writes]);
        const bytes = await bytesOf(file.body);
        expect(bytes.length).toBe(file.size);
        expect(bytes.includes(TOKEN)).toBe(false);
        expect(bytes.includes(SECRET)).toBe(false);
        // Authenticator secrets are stored as they are: a copy would make valid codes.
        expect(bytes.includes(TOTP)).toBe(false);
        await writeFile(path.join(work, 'blog.romedb'), bytes);
        await writeFile(path.join(work, 'unopened.romedb'), bytes);

        const opened = createRomeDB({ url: path.join(work, 'blog.romedb'), pending: new MemoryPendingWriteStore(), connect: () => connectNode({ url: path.join(work, 'blog.romedb') }) });
        const counts = await opened.read(FILE_EXPORT_EMPTIED_TABLES.map(table => ({ rql: `SELECT count(*) FROM ${table}` })));
        expect(counts.results.map(result => result.rows[0]![0])).toEqual(FILE_EXPORT_EMPTIED_TABLES.map(() => 0n));

        // The application's sign-in tables are there and empty, and the file runs as its own install.
        const signIn = await opened.read([{ rql: 'SELECT count(*) FROM sessions' }, { rql: 'SELECT count(*) FROM user_security' }]);
        expect(signIn.results.map(result => result.rows[0]![0])).toEqual([0n, 0n]);
        const standalone = createCMS({ db: opened, modules });
        await standalone.ready({ force: true });
        expect((await standalone.resource('cms/posts').list({}, { principal: systemPrincipal('tests') })).records.map(record => record.title)).toEqual(['Hello World!']);
        await opened.close();

        // The site itself is unchanged.
        expect((await blog.db.read([{ rql: 'SELECT count(*) FROM sessions' }])).results[0]!.rows[0]![0]).toBe(1n);
        expect((await blog.db.read([{ rql: "SELECT count(*) FROM cms_webhooks WHERE id = 'hook'" }])).results[0]!.rows[0]![0]).toBe(1n);
    }, 60_000);

    it('copies a database file this process has open', async () => {
        const url = path.join(work, 'open.romedb');
        await copyFile(path.join(work, 'blog.romedb'), url);
        const db = createRomeDB({ url, pending: new MemoryPendingWriteStore(), connect: () => connectNode({ url }) });
        try {
            await db.write([{ rql: 'INSERT INTO cms_cache (key, value) VALUES ($key, $value)', params: { $key: 'k', $value: TOKEN } }]);
            const file = await siteFile(db);
            expect((await bytesOf(file.body)).includes(TOKEN)).toBe(false);
        } finally { await db.close(); }
    }, 30_000);

    it('opens in romedb serve', async () => {
        const served = await startRomeDBService({ file: path.join(work, 'blog.romedb') });
        const db = createRomeDB({ url: served.url, token: served.token, pending: new MemoryPendingWriteStore() });
        try { expect((await db.read([{ rql: 'SELECT count(*) FROM sessions' }])).results[0]!.rows[0]![0]).toBe(0n); }
        finally {
            await db.close();
            await served.stop();
        }
    }, 30_000);

    it.runIf(servesDirectories())('is a new database, which romedb serve --directory opens under any name', async () => {
        const name = crypto.randomUUID();
        const folder = path.join(work, 'sites');
        await mkdir(folder);
        await copyFile(path.join(work, 'unopened.romedb'), path.join(folder, `${name}.romedb`));
        const directory = await startRomeDBDirectory({ directory: folder });
        const db = createRomeDB({ url: `${directory.url}/databases/${name}`, token: directory.token, pending: new MemoryPendingWriteStore() });
        try {
            expect((await db.read([{ rql: 'SELECT count(*) FROM sessions' }])).results[0]!.rows[0]![0]).toBe(0n);
            expect((await db.preflight()).id).not.toBe((await blog.db.preflight()).id);
            // The organization route is the one Cloud has.
            await db.write([{ rql: 'INSERT INTO cms_cache (key, value) VALUES ($key, $value)', params: { $key: 'k', $value: TOKEN } }]);
            const copy = await siteFile(db);
            expect((await bytesOf(copy.body)).includes(TOKEN)).toBe(false);
        } finally {
            await db.close();
            await directory.stop();
        }
    }, 30_000);
});
