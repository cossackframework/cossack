import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, contentModule, createCMS, DEFAULT_ROLES, formsModule, isNetworkAdmin, NETWORK_ADMIN, seedStarterContent, siteExport, siteImport, systemPrincipal, type CmsHost, type NetworkSite } from '../src/server/index';
import { romedbService, live } from './helpers';

/** The export as text chunks of an awkward size, so values and characters straddle them. */
async function exported(host: CmsHost, site: string): Promise<string[]> {
    let text = '';
    for await (const chunk of siteExport(host.db, { site: { id: site, name: 'Blog', host: 'blog.example.com' } })) text += chunk;
    const chunks: string[] = [];
    for (let at = 0; at < text.length; at += 37) chunks.push(text.slice(at, at + 37));
    return chunks;
}

const bytes = (chunks: readonly string[]) => new ReadableStream<Uint8Array>({
    start(controller) {
        // Bytes cut through multi-byte characters too.
        const all = new TextEncoder().encode(chunks.join(''));
        for (let at = 0; at < all.length; at += 41) controller.enqueue(all.slice(at, at + 41));
        controller.close();
    },
});

const modules = [contentModule, formsModule];

describe.skipIf(!live)('importing a site export into a new site', () => {
    const service = romedbService();
    const databases = new Map<string, { db: RomeDB; stop(): Promise<void> }>();
    let network: CmsNetwork;
    let main: CmsHost;
    let blog: CmsHost;
    let owner: string;
    const hostOf = async (host: string) => network.hostOf((await network.resolve(host) as { site: NetworkSite }).site);

    beforeAll(async () => {
        for (const name of ['blog-db', 'copy-db', 'full-db', 'standalone']) databases.set(name, await service.fresh());
        const db = service.database();
        network = new CmsNetwork({
            db, open: site => databases.get(site.database)!.db, networkHost: () => 'example.com',
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id, modules, sessionsEnded: ended => network.endSessions(ended) }),
        });
        main = network.main;
        expect((await main.migrate()).failed).toBeUndefined();
        await network.setEnabled(true, { principal: systemPrincipal('tests') });
        owner = (await main.users.create({ email: 'owner@example.com', name: 'Owner', password: 'owns the place', roles: ['admin'], networkRole: NETWORK_ADMIN })).id;
        for (const [id, database] of [['blog', 'blog-db'], ['copy', 'copy-db'], ['full', 'full-db']] as const) {
            await network.sites.create({ id, name: id, database, domains: [{ host: `${id}.example.com` }] });
            const host = await hostOf(`${id}.example.com`);
            expect((await host.migrate()).failed).toBeUndefined();
            for (const role of DEFAULT_ROLES) await host.users.defineRole({ ...role, permissions: [...role.permissions] });
            await host.users.addMember(owner, { roles: ['admin'] });
        }
        blog = await hostOf('blog.example.com');
        const admin = (await blog.users.principal(owner))!;
        await seedStarterContent(blog, { principal: admin });
        // A collection that sorts before the CMS's tables, with a record that needs exact values.
        await blog.saveCollection({ name: 'articles', label: 'Articles', singular: 'Article', icon: 'notebook', path: 'articles', fields: {}, features: { content: true } }, admin);
        await blog.resource('cms/articles').create({ title: 'Ünïcödé 🎉 title' }, { principal: admin });
        await blog.settings.update('general', { tagline: 'Notes from far away' }, { principal: admin });
        await blog.db.write([{ rql: "INSERT INTO cms_webhooks (id, name, url, events, collections, secret, active, created_at, updated_at) VALUES ('hook', 'Hook', 'https://hooks.example.com', '[]', '[]', 'old secret', 1, 1, 1)" }]);
        const readerId = (await blog.users.create({ email: 'reader@example.com', name: 'Reader', password: 'reads a lot', roles: ['subscriber'] })).id;
        // What an edited export could carry: a network_admin role for the reader, and an automation that is on.
        await blog.db.write([
            { rql: "INSERT INTO cms_roles (id, name, permissions, created_at) VALUES ('network_admin', 'Network', '[\"*\"]', 1)" },
            { rql: "INSERT INTO cms_user_roles (user_id, role_id) VALUES ($user, 'network_admin')", params: { $user: readerId } },
            { rql: "INSERT INTO cms_automations (id, name, event, conditions, action, active, runs, created_at, updated_at) VALUES ('auto', 'Mail out', 'form.submitted', '[]', '{}', 1, 0, 1, 1)" },
        ], { kind: 'test' });
        // More than one RomeDB request or response holds: 32 statements, 64 KiB, 256 KiB.
        for (let batch = 0; batch < 20; batch++) {
            await blog.db.write(Array.from({ length: 13 }, (_, index) => ({ rql: 'INSERT INTO cms_not_found (path, hits, first_at, last_hit_at, referrer) VALUES ($path, 1, 1, 1, $referrer)', params: { $path: `/${batch}/${index}`, $referrer: 'r'.repeat(2048) } })));
        }
        // The full site has content already.
        await seedStarterContent(await hostOf('full.example.com'), { principal: admin });
    }, 120_000);

    afterAll(async () => { for (const database of databases.values()) await database.stop(); });

    it('lists the CMS tables before the collections in an export', async () => {
        const document = JSON.parse((await exported(blog, 'blog')).join('')) as { tables: { name: string }[] };
        const names = document.tables.map(table => table.name);
        expect(names).toContain('r__cms__articles');
        expect(names.findIndex(name => !/^(cms|cossack)_/.test(name))).toBeGreaterThan(names.findLastIndex(name => /^(cms|cossack)_/.test(name)));
    });

    it('pages each table by its key, so writes during an export neither repeat nor skip rows', async () => {
        const before = (await blog.db.read([{ rql: 'SELECT path FROM cms_not_found ORDER BY path' }])).results[0]!.rows.map(row => row[0] as string);
        let reads = 0;
        // After the first page, a row sorting before it arrives: read by offset, the page's last row would come again.
        const db = new Proxy(blog.db, {
            get(target, property) {
                if (property === 'read') return async (statements: { rql: string }[], options?: unknown) => {
                    const result = await target.read(statements as never, options as never);
                    if (statements[0]!.rql.includes('FROM cms_not_found') && ++reads === 1) {
                        await target.write([{ rql: "INSERT INTO cms_not_found (path, hits, first_at, last_hit_at, referrer) VALUES ('/', 1, 1, 1, '')" }]);
                    }
                    return result;
                };
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            },
        });
        let text = '';
        for await (const chunk of siteExport(db, { site: { id: 'blog', name: 'Blog', host: null }, pageSize: 5 })) text += chunk;
        const table = (JSON.parse(text) as { tables: { name: string; columns: string[]; rows: unknown[][] }[] }).tables.find(entry => entry.name === 'cms_not_found')!;
        const paths = table.rows.map(row => (row[table.columns.indexOf('path')] as { value: string }).value);
        expect(reads).toBeGreaterThan(2);
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths).toEqual(before);
        await blog.db.write([{ rql: "DELETE FROM cms_not_found WHERE path = '/'" }]);
    });

    it('imports into a new added site: settings, collections and entries, members with accounts', async () => {
        const copy = await hostOf('copy.example.com');
        // A plugin's grants come along, but unrestricted access is granted where it runs.
        await blog.db.write([{ rql: "INSERT INTO cms_grants (id, subject, permission, revision, created_at) VALUES ('raw-1', 'plugin:raw', 'plugin:enabled', 1, 1), ('raw-2', 'plugin:raw', 'capability:unrestricted', 1, 1)" }], { kind: 'test' });
        const report = await siteImport(copy, bytes(await exported(blog, 'blog')));
        expect(report).toMatchObject({ site: { id: 'blog', name: 'Blog', host: 'blog.example.com' }, skipped: [] });
        expect(report.rows).toBeGreaterThan(10);
        expect(await copy.settings.get('general.tagline')).toBe('Notes from far away');
        expect((await copy.db.read([{ rql: 'SELECT count(*), sum(length(referrer)) FROM cms_not_found' }])).results[0]!.rows[0]).toEqual([260n, 260n * 2048n]);
        const admin = (await copy.users.principal(owner))!;
        expect(copy.collection('articles').label).toBe('Articles');
        expect((await copy.resource('cms/articles').list({}, { principal: admin })).records.map(record => record.title)).toEqual(['Ünïcödé 🎉 title']);
        const titles = async (host: CmsHost) => (await host.resource('cms/posts').list({}, { principal: admin })).records.map(record => [record.id, record.title]);
        expect(await titles(copy)).toEqual(await titles(blog));
        expect(await titles(copy)).toHaveLength(1);
        // The owner is a network account and stays one; the site account came without its password.
        expect(report.members).toEqual({ network: 1, site: 1, pending: 0 });
        expect((await copy.users.get(owner))?.account).toBe('network');
        expect((await main.accounts.memberships([owner])).get(owner)).toEqual(expect.arrayContaining(['copy']));
        const reader = (await copy.users.findByEmail('reader@example.com'))!;
        expect(reader).toMatchObject({ account: 'site', roles: ['subscriber'] });
        // Network admins are the network's: the export's role and its assignment stay behind, and its automations come in off.
        expect(isNetworkAdmin((await copy.users.principal(reader.id))!)).toBe(false);
        expect((await copy.db.read([{ rql: "SELECT count(*) FROM cms_roles WHERE id = 'network_admin'" }])).results[0]!.rows[0]![0]).toBe(0n);
        expect((await copy.db.read([{ rql: "SELECT active FROM cms_automations WHERE id = 'auto'" }])).results[0]!.rows[0]![0]).toBe(0n);
        expect(await copy.siteAccounts!.verifier.verify('reader@example.com', 'reads a lot')).toBeNull();
        // Webhooks come in turned off, with a new secret; pending work stays behind.
        const hook = (await copy.db.read([{ rql: "SELECT secret, active FROM cms_webhooks WHERE id = 'hook'" }])).results[0]!.rows[0]!;
        expect(hook[0]).toMatch(/^[0-9a-f]{64}$/);
        expect(hook[1]).toBe(0n);
        expect((await copy.db.read([{ rql: "SELECT count(*) FROM cms_outbox WHERE topic != 'search.rebuild'" }])).results[0]!.rows[0]![0]).toBe(0n);
        // The search index is not exported: the import queues its rebuild, which the outbox runs.
        expect((await copy.siteSearch.status()).rebuilding).toBe(true);
        const deadline = Date.now() + 20_000;
        while ((await copy.outbox.dispatch({ limit: 100 })).delivered.length && Date.now() < deadline) { /* next round */ }
        const indexed = await blog.siteSearch.status();
        expect(indexed.entries).toBeGreaterThan(0);
        expect(await copy.siteSearch.status()).toEqual({ entries: indexed.entries, rebuilding: false });
        expect((await copy.db.read([{ rql: "SELECT permission FROM cms_grants WHERE subject = 'plugin:raw'" }])).results[0]!.rows).toEqual([['plugin:enabled']]);
    }, 60_000);

    it('refuses a site with content, a second import, and files that are not exports', async () => {
        await expect(siteImport(await hostOf('full.example.com'), bytes(await exported(blog, 'blog')))).rejects.toThrow(/new site/);
        await expect(siteImport(await hostOf('copy.example.com'), bytes(await exported(blog, 'blog')))).rejects.toThrow(/new site/);
        const empty = createCMS({ db: databases.get('standalone')!.db, modules });
        await expect(siteImport(empty, bytes(['{"format":"something else","version":1,"tables":[]}']))).rejects.toThrow(/not a site export/);
        const settings = '{"format":"cossack-site-export","version":1,"tables":[{"name":"cms_settings","model":"relational","columns":["key"],"rows":[';
        await expect(siteImport(empty, bytes([`${settings}["a"]]}]}`]))).rejects.toThrow(/not a RomeDB value/);
        await expect(siteImport(empty, bytes([`${settings}[{"type":"String","value":"a"}]`]))).rejects.toThrow(/ends early/);
    }, 60_000);

    it('imports into a fresh install, whose members then wait for setup to take the site over', async () => {
        const standalone = createCMS({ db: databases.get('standalone')!.db, modules });
        const report = await siteImport(standalone, bytes(await exported(blog, 'blog')));
        expect(report.members).toEqual({ network: 0, site: 0, pending: 2 });
        expect(await standalone.accounts.hasNetworkAdmin()).toBe(false);
        expect(await standalone.accounts.adoptMembers('main', owner, 'the new owner')).toBe(2);
        expect((await standalone.accounts.verifier.verify('owner@example.com', 'the new owner'))?.id).toBe(owner);
        const admin = (await standalone.users.principal(owner))!;
        expect((await standalone.resource('cms/articles').list({}, { principal: admin })).records).toHaveLength(1);
    }, 60_000);
});
