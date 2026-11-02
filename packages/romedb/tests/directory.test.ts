import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRomeDB, MemoryPendingWriteStore, objects, organizationDatabases } from '../src/index';
import { connectNode, fileDatabases } from '../src/node';
import { servesDirectories, startRomeDBDirectory, type RomeDBTestDirectory } from '../src/testing';

const ORG = 'http://127.0.0.1:4321/v1/organizations/0b6c1a43-5a2e-4f0e-9b37-2f1e8c0d4a11';

describe('organization databases', () => {
    it('creates by name, deletes by ID and sends the key', async () => {
        const requests: { method: string; url: string; auth: string | null; body: string | null }[] = [];
        const directory = organizationDatabases({
            url: `${ORG}/`, token: 'org-key',
            fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
                requests.push({ method: init.method ?? 'GET', url: String(input), auth: new Headers(init.headers).get('authorization'), body: (init.body as string | undefined) ?? null });
                if (init.method === 'POST') return Response.json({ id: 'db-1', name: 'site-blog', url: `${ORG}/databases/db-1/query` }, { status: 201 });
                return new Response(null, { status: init.method === 'DELETE' && String(input).endsWith('/gone') ? 404 : 204 });
            }) as typeof fetch,
        });
        expect(await directory.create('site-blog')).toBe('db-1');
        await directory.delete('db-1');
        await directory.delete('gone');
        expect(directory.url('db-1')).toBe(`${ORG}/databases/db-1`);
        expect(requests).toEqual([
            { method: 'POST', url: `${ORG}/databases`, auth: 'Bearer org-key', body: '{"name":"site-blog"}' },
            { method: 'DELETE', url: `${ORG}/databases/db-1`, auth: 'Bearer org-key', body: null },
            { method: 'DELETE', url: `${ORG}/databases/gone`, auth: 'Bearer org-key', body: null },
        ]);
        await expect(directory.create('Not A Name')).rejects.toThrow(TypeError);
        expect(() => organizationDatabases({ url: 'http://127.0.0.1:4321/v1/database', token: 't' })).toThrow(/organization URL/);
    });

    it('reports a refused creation', async () => {
        const directory = organizationDatabases({ url: ORG, token: 'k', fetch: (async () => Response.json({ error: 'plan limit reached' }, { status: 402 })) as typeof fetch });
        await expect(directory.create('site-x')).rejects.toThrow(/402: plan limit reached/);
    });
});

const linked = await import('@romedb/node/embedded-client').then(() => true, () => false);

describe.skipIf(!linked)('file databases', () => {
    let directory: string;
    beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-sites-')); });
    afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

    it('names files by UUID, opens them with connectNode and deletes them with their journals', async () => {
        const sites = fileDatabases(path.join(directory, 'sites'));
        const id = await sites.create('site-blog');
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        const url = sites.url(id);
        expect(url).toBe(path.join(directory, 'sites', `${id}.romedb`));
        const db = createRomeDB({ url, connect: () => connectNode({ url }), pending: new MemoryPendingWriteStore() });
        await db.write([{ rql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }, { rql: "INSERT INTO t (id) VALUES ('a')" }]);
        await db.close();
        expect((await readdir(path.join(directory, 'sites'))).length).toBeGreaterThan(0);
        await sites.delete(id);
        expect(await readdir(path.join(directory, 'sites'))).toEqual([]);
        expect(() => sites.url('../escape')).toThrow(TypeError);
    });
});

describe.skipIf(!linked || !servesDirectories())('romedb serve --directory as an organization', () => {
    let service: RomeDBTestDirectory;
    beforeAll(async () => { service = await startRomeDBDirectory(); }, 30_000);
    afterAll(async () => { await service?.stop(); });

    it('creates a database once per name, serves it and deletes it', async () => {
        const directory = organizationDatabases({ url: service.url, token: service.token });
        const id = await directory.create('site-shop');
        expect(await directory.create('site-shop')).toBe(id);
        const url = directory.url(id);
        const db = createRomeDB({ url, connect: () => connectNode({ url, token: service.token }), pending: new MemoryPendingWriteStore() });
        await db.write([{ rql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }, { rql: "INSERT INTO t (id) VALUES ('x')" }]);
        expect(objects((await db.read([{ rql: 'SELECT id FROM t' }])).results[0]!)).toEqual([{ id: 'x' }]);
        await db.close();
        await directory.delete(id);
        expect(await directory.create('site-shop')).not.toBe(id);
    });
});
