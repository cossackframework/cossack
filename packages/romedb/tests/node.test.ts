import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClientError, createRomeDB, Float64, MemoryPendingWriteStore, objects, one, RecordId, UncertainWriteError, Vector, type Value } from '../src/index';
import { connectNode, isServiceUrl } from '../src/node';
import { servesDirectories, startRomeDBDirectory, type RomeDBTestDirectory } from '../src/testing';

/** `@romedb/node` is linked from a RomeDB checkout until it ships as a package. */
const linked = await import('@romedb/node/embedded-client').then(() => true, () => false);
const files = linked ? describe : describe.skip;

const values: { [key: string]: Value } = {
    max: 9223372036854775807n,
    float: new Float64(1),
    record: new RecordId('notes', 'n1'),
    vector: Vector.float32([1, 0.5]),
    bytes: new Uint8Array([0, 255]),
    nested: { list: [1n, 'two', { deep: new RecordId('notes', 7n) }] },
};

files('Files through @romedb/node', () => {
    let directory: string;

    beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'cossack-romedb-files-')); });
    afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

    it('tells files from service URLs', () => {
        expect(isServiceUrl('storage/romedb/app.romedb')).toBe(false);
        expect(isServiceUrl('/srv/app.romedb')).toBe(false);
        expect(isServiceUrl('http://127.0.0.1:4321')).toBe(true);
        expect(isServiceUrl('https://cloud.romedb.com/v1/organizations/x/databases/y')).toBe(true);
    });

    it('creates a missing file, checks the engine and returns typed values', async () => {
        const file = path.join(directory, 'nested', 'app.romedb');
        const pending = new MemoryPendingWriteStore();
        const db = createRomeDB({ url: file, connect: () => connectNode({ url: file }), pending });
        try {
            await db.write([{ rql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)' }]);
            await db.write([{ rql: 'INSERT INTO notes (id, title) VALUES ($id, $title)', params: { $id: 'n1', $title: 'first' } }]);
            expect(await pending.list()).toEqual([]);
            expect(objects((await db.read([{ rql: 'SELECT id, title FROM notes' }])).results[0]!)).toEqual([{ id: 'n1', title: 'first' }]);
            const doc = one((await db.read([{ rql: 'SELECT $doc AS doc', params: { $doc: values } }])).results[0]!).doc as { [key: string]: Value };
            expect(doc.max).toBe(9223372036854775807n);
            expect(doc.float).toBeInstanceOf(Float64);
            expect(doc.record).toEqual(new RecordId('notes', 'n1'));
            expect(doc.vector).toBeInstanceOf(Vector);
            expect(doc.bytes).toEqual(new Uint8Array([0, 255]));
            expect(((doc.nested as { list: Value[] }).list[2] as { deep: RecordId }).deep.key).toBe(7n);
            expect((await db.preflight()).engineVersion).toMatch(/^\d+\.\d+\.\d+/);
        } finally { await db.close(); }
    });

    it('keeps every file of a new database private', async () => {
        const file = path.join(directory, 'private', 'app.romedb');
        const db = createRomeDB({ url: file, connect: () => connectNode({ url: file }), pending: new MemoryPendingWriteStore() });
        try {
            await db.write([{ rql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }, { rql: "INSERT INTO t (id) VALUES ('a')" }]);
            const names = await readdir(path.dirname(file));
            expect(names.length).toBeGreaterThan(1);
            for (const name of names) expect((await stat(path.join(path.dirname(file), name))).mode & 0o777, name).toBe(0o600);
        } finally { await db.close(); }
    });

    it('raises RomeDB ClientErrors and requires the rql statement shape', async () => {
        const file = path.join(directory, 'errors.romedb');
        const db = createRomeDB({ url: file, connect: () => connectNode({ url: file }), pending: new MemoryPendingWriteStore() });
        try {
            const error = await db.read([{ rql: 'SELEC nonsense' }]).catch(error => error);
            expect(error).toBeInstanceOf(ClientError);
            expect(error.code).toBe('FDB_VALIDATION');
            await expect(db.read([{ sql: 'SELECT 1' } as never])).rejects.toThrow(/rql/);
        } finally { await db.close(); }
    });

    it('reconciles a write saved before the file was reopened', async () => {
        const file = path.join(directory, 'reopen.romedb');
        const pending = new MemoryPendingWriteStore();
        const first = createRomeDB({ url: file, connect: () => connectNode({ url: file }), pending });
        await first.write([{ rql: 'CREATE TABLE ledger (id TEXT PRIMARY KEY, n INTEGER NOT NULL)' }]);
        // Save a write as if its reply was lost, then let it commit through another client.
        const client = await connectNode({ url: file });
        await client.info();
        const request = client.prepareWrite([{ sql: "INSERT INTO ledger (id, n) VALUES ('a', 1)" }]);
        await pending.put(JSON.parse(request.body).requestId, { request, savedAt: Date.now(), kind: 'ledger' });
        await client.submit(request);
        await client.close();
        await first.close();

        const decisions: string[] = [];
        const reopened = createRomeDB({
            url: file, connect: () => connectNode({ url: file }), pending,
            reconcilers: { ledger: async (_write, db) => { decisions.push('asked'); return objects((await db.read([{ rql: "SELECT id FROM ledger WHERE id = 'a'" }])).results[0]!).length ? 'committed' : 'absent'; } },
        });
        try {
            const report = await reopened.recoverPending();
            expect(decisions).toEqual(['asked']);
            expect(report.reconciled).toHaveLength(1);
            expect(await pending.list()).toEqual([]);
        } finally { await reopened.close(); }
    });

    it('leaves a write saved for another database pending', async () => {
        const one = path.join(directory, 'one.romedb');
        const two = path.join(directory, 'two.romedb');
        const pending = new MemoryPendingWriteStore();
        const client = await connectNode({ url: one });
        await client.info();
        const request = client.prepareWrite([{ sql: 'CREATE TABLE never_sent (id TEXT PRIMARY KEY)' }]);
        await client.close();
        await pending.put(JSON.parse(request.body).requestId, { request, savedAt: Date.now() });
        const db = createRomeDB({ url: two, connect: () => connectNode({ url: two }), pending });
        try {
            expect((await db.recoverPending()).pending).toHaveLength(1);
        } finally { await db.close(); }
    });

    it('keeps an uncertain write when the engine does not answer', async () => {
        const file = path.join(directory, 'timeout.romedb');
        const pending = new MemoryPendingWriteStore();
        const db = createRomeDB({ url: file, connect: () => connectNode({ url: file }), pending, retry: { attempts: 1 } });
        try {
            await db.write([{ rql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }]);
            const controller = new AbortController();
            const writing = db.write([{ rql: "INSERT INTO t (id) VALUES ('a')" }], { signal: controller.signal });
            controller.abort();
            const error = await writing.catch(error => error);
            // Aborted before or after dispatch: either nothing was sent, or the write stays saved.
            if (error instanceof UncertainWriteError) expect(await pending.list()).toHaveLength(1);
            else if (error) expect(error).toBeInstanceOf(ClientError);
        } finally { await db.close(); }
    });
});

const serve = linked && servesDirectories() ? describe : describe.skip;

serve('romedb serve --directory through @romedb/node', () => {
    let service: RomeDBTestDirectory;

    beforeAll(async () => { service = await startRomeDBDirectory(); }, 30_000);
    afterAll(async () => { await service?.stop(); });

    it('negotiates a loopback organization URL as a local service', async () => {
        const url = await service.createDatabase('site-a');
        const db = createRomeDB({ url, connect: () => connectNode({ url, token: service.token }), pending: new MemoryPendingWriteStore() });
        try {
            await db.write([{ rql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)' }, { rql: "INSERT INTO notes (id, title) VALUES ('n1', $t)", params: { $t: 'hi' } }]);
            expect(objects((await db.read([{ rql: 'SELECT title FROM notes' }])).results[0]!)).toEqual([{ title: 'hi' }]);
            const info = await db.preflight();
            expect(info.capabilities.provenance).toBe('negotiated');
        } finally { await db.close(); }
    });

    it('connects the binding to the same URL without a connect option', async () => {
        const url = await service.createDatabase('site-b');
        const db = createRomeDB({ url, token: service.token, pending: new MemoryPendingWriteStore() });
        try {
            await db.write([{ rql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }, { rql: "INSERT INTO t (id) VALUES ('a')" }]);
            expect(objects((await db.read([{ rql: 'SELECT id FROM t' }])).results[0]!)).toEqual([{ id: 'a' }]);
        } finally { await db.close(); }
    });
});
