import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientError, createRomeDB, EngineVersionError, MemoryPendingWriteStore, PendingWriteConflictError, UncertainWriteError, type PendingWriteStore } from '../src/index';
import { FilePendingWriteStore } from '../src/node';
import { DurableObjectPendingWriteStore, RomeDBPendingWrites } from '../src/cloudflare';

const LOCAL = 'http://127.0.0.1:4321/v1/database';
const details = (engineVersion?: string) => ({
    id: 'db-1', sequence: 10, serviceVersion: 1, ...(engineVersion === undefined ? {} : { engineVersion }),
    capabilities: { readVersion: 2, atomicWrites: true, replayWindow: 64, exactSequenceCondition: true }, limits: {},
});
const json = (body: unknown, status = 200, headers: { [key: string]: string } = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function service(options: { engine?: string; onQuery?: (body: { [key: string]: unknown }, attempt: number) => Response | Promise<Response>; onRead?: (attempt: number) => Response } = {}) {
    let queries = 0;
    let reads = 0;
    const bodies: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (url === LOCAL) return json(details(options.engine ?? '0.2.9'));
        const body = JSON.parse(String(init.body));
        if (url.endsWith('/read')) {
            reads++;
            return options.onRead?.(reads) ?? json({ readVersion: 2, requestId: body.requestId, sequence: 10, results: [{ columns: ['n'], rows: [[{ type: 'Integer', value: '1' }]], affected: '0' }] });
        }
        queries++;
        bodies.push(String(init.body));
        return options.onQuery?.(body, queries) ?? json({ requestId: body.requestId, sequence: body.afterSequence + 1, results: [{ columns: [], rows: [], affected: '1' }] });
    }) as typeof globalThis.fetch;
    return { fetch, bodies, get queries() { return queries; }, get reads() { return reads; } };
}

const noSleep = async () => {};

describe('RomeDB binding', () => {
    it('refuses an older or missing engine release', async () => {
        for (const engine of ['0.2.8', undefined]) {
            const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: service({ engine: engine as string }).fetch });
            if (engine === undefined) {
                const fetch = (async (input: RequestInfo | URL) => String(input) === LOCAL ? json(details()) : json({})) as typeof globalThis.fetch;
                const missing = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch });
                await expect(missing.read([{ rql: 'SELECT 1' }])).rejects.toBeInstanceOf(EngineVersionError);
                continue;
            }
            await expect(db.read([{ rql: 'SELECT 1' }])).rejects.toThrow(/0\.2\.8 is older than the required 0\.2\.9/);
        }
        const newer = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: service({ engine: '2.10.1' }).fetch });
        expect((await newer.preflight()).engineVersion).toBe('2.10.1');
    });

    it('sends explicit work limits by default', async () => {
        const bodies: { [key: string]: unknown }[] = [];
        const fake = service({ onQuery: (body) => { bodies.push(body); return json({ requestId: body.requestId, sequence: 11, results: [{ columns: [], rows: [], affected: '1' }] }); } });
        const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: fake.fetch, workLimits: { write: { rowMutations: 10 } } });
        await db.write([{ rql: 'UPDATE x SET y = 1' }]);
        expect(bodies[0]!.workLimits).toEqual({ rowsRead: 50_000, rowMutations: 10, vmSteps: 2_000_000 });
    });

    it('saves the exact request before dispatch and clears it after the receipt', async () => {
        const pending = new MemoryPendingWriteStore();
        const seen: number[] = [];
        const fake = service({ onQuery: async (body) => {
            seen.push((await pending.list()).length);
            return json({ requestId: body.requestId, sequence: (body.afterSequence as number) + 1, results: [{ columns: [], rows: [], affected: '1' }] });
        } });
        const db = createRomeDB({ url: LOCAL, token: 't', pending, fetch: fake.fetch });
        const result = await db.write([{ rql: 'UPDATE x SET y = 1' }], { requestId: 'op-1' });
        expect(result.requestId).toBe('op-1');
        expect(seen).toEqual([1]);
        expect(await pending.list()).toHaveLength(0);
    });

    it('recovers backpressure with the same body and bounded attempts', async () => {
        const fake = service({ onQuery: (body, attempt) => attempt < 3
            ? json({ error: { code: 'FDB_UNAVAILABLE', message: 'busy' } }, 503, { 'retry-after': '1' })
            : json({ requestId: body.requestId, sequence: 11, results: [{ columns: [], rows: [], affected: '1' }] }) });
        const delays: number[] = [];
        const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: fake.fetch, sleep: async ms => { delays.push(ms); }, retry: { attempts: 3, maxDelayMs: 500 } });
        await db.write([{ rql: 'UPDATE x SET y = 1' }], { requestId: 'op-2' });
        expect(fake.queries).toBe(3);
        expect(new Set(fake.bodies).size).toBe(1);
        expect(delays.every(delay => delay >= 500 && delay < 525)).toBe(true);
    });

    it('keeps an unconfirmed write pending and recovers it later by exact body', async () => {
        let up = false;
        const fake = service({ onQuery: (body) => {
            if (!up) throw new TypeError('connection reset');
            return json({ requestId: body.requestId, sequence: 11, results: [{ columns: [], rows: [], affected: '1' }] });
        } });
        const pending = new MemoryPendingWriteStore();
        const db = createRomeDB({ url: LOCAL, token: 't', pending, fetch: fake.fetch, sleep: noSleep, retry: { attempts: 2 } });
        const error = await db.write([{ rql: 'UPDATE x SET y = 1' }], { requestId: 'op-3', kind: 'test' }).catch(e => e);
        expect(error).toBeInstanceOf(UncertainWriteError);
        expect((error as UncertainWriteError).requestId).toBe('op-3');
        expect(await pending.get('op-3')).toMatchObject({ kind: 'test' });
        up = true;
        expect(await db.recoverPending()).toEqual({ confirmed: ['op-3'], rolledBack: [], reconciled: [], pending: [] });
        expect(new Set(fake.bodies).size).toBe(1);
        expect(await pending.list()).toHaveLength(0);
    });

    it('drops the saved request when the database confirms a rollback', async () => {
        const fake = service({ onQuery: (body) => json({ requestId: body.requestId, sequence: 11, error: { code: 'FDB_CONSTRAINT', message: 'unique' } }, 409) });
        const pending = new MemoryPendingWriteStore();
        const db = createRomeDB({ url: LOCAL, token: 't', pending, fetch: fake.fetch, sleep: noSleep });
        await expect(db.write([{ rql: 'INSERT INTO x VALUES (1)' }])).rejects.toMatchObject({ outcome: 'rolled-back', code: 'FDB_CONSTRAINT' });
        expect(fake.queries).toBe(1);
        expect(await pending.list()).toHaveLength(0);
    });

    it('stops retrying when the request is cancelled after dispatch', async () => {
        const controller = new AbortController();
        const fake = service({ onQuery: () => { controller.abort(); throw new DOMException('aborted', 'AbortError'); } });
        const pending = new MemoryPendingWriteStore();
        const db = createRomeDB({ url: LOCAL, token: 't', pending, fetch: fake.fetch, sleep: noSleep });
        await expect(db.write([{ rql: 'UPDATE x SET y = 1' }], { signal: controller.signal })).rejects.toBeInstanceOf(UncertainWriteError);
        expect(fake.queries).toBe(1);
        expect(await pending.list()).toHaveLength(1);
    });

    it('reconciles writes that left the receipt window', async () => {
        let sequence = 10;
        const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
            const url = String(input);
            if (url === LOCAL) return json({ ...details('0.2.9'), sequence });
            const body = JSON.parse(String(init.body));
            if (url.endsWith('/read')) return json({ readVersion: 2, requestId: body.requestId, sequence, results: [{ columns: [], rows: [], affected: '0' }] });
            throw new TypeError('reset');
        }) as typeof globalThis.fetch;
        const pending = new MemoryPendingWriteStore();
        const decisions: string[] = [];
        const db = createRomeDB({ url: LOCAL, token: 't', pending, fetch, sleep: noSleep, retry: { attempts: 1 }, reconcilers: { audit: async write => { decisions.push(write.kind!); return 'committed'; } } });
        await expect(db.write([{ rql: 'UPDATE x SET y = 1' }], { kind: 'audit' })).rejects.toBeInstanceOf(UncertainWriteError);
        expect(await db.recoverPending()).toMatchObject({ pending: [expect.any(String)] });
        sequence = 200;
        await db.read([{ rql: 'SELECT 1' }]);
        expect((await db.recoverPending()).reconciled).toHaveLength(1);
        expect(decisions).toEqual(['audit']);
    });

    it('retries reads under backpressure only', async () => {
        const fake = service({ onRead: attempt => attempt === 1 ? json({ error: 'busy' }, 503) : json({ error: { code: 'FDB_SYNTAX', message: 'bad' } }, 400) });
        const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: fake.fetch, sleep: noSleep });
        const error = await db.read([{ rql: 'SELEC 1' }]).catch(e => e) as ClientError;
        expect(error.code).toBe('FDB_SYNTAX');
        expect(fake.reads).toBe(2);
    });
});

describe('pending write stores', () => {
    const directories: string[] = [];
    afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

    async function contract(store: PendingWriteStore) {
        const db = createRomeDB({ url: LOCAL, token: 't', pending: store, fetch: service().fetch });
        await db.preflight();
        const client = await (db as unknown as { ['sequence'](): Promise<number> }).sequence();
        expect(client).toBe(10);
        const { connect } = await import('../src/index');
        const remote = await connect({ url: LOCAL, token: 't', fetch: service().fetch });
        const a = remote.prepareWrite([{ rql: 'SELECT 1' }], { requestId: 'a' });
        const b = remote.prepareWrite([{ rql: 'SELECT 2' }], { requestId: 'a' });
        await store.put('a', { request: a, savedAt: 2 });
        await store.put('a', { request: a, savedAt: 2 });
        await expect(store.put('a', { request: b, savedAt: 3 })).rejects.toBeInstanceOf(PendingWriteConflictError);
        await store.put('c', { request: remote.prepareWrite([{ rql: 'SELECT 3' }], { requestId: 'c' }), savedAt: 1, kind: 'k' });
        expect((await store.list()).map(write => write.savedAt)).toEqual([1, 2]);
        expect((await store.get('a'))!.request.body).toBe(a.body);
        await store.delete('a');
        expect(await store.get('a')).toBeUndefined();
        await store.delete('a');
        expect(await store.list()).toHaveLength(1);
    }

    it('memory store', async () => { await contract(new MemoryPendingWriteStore()); });

    it('file store writes private files', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'romedb-pending-'));
        directories.push(directory);
        const store = new FilePendingWriteStore(path.join(directory, 'pending'));
        await contract(store);
        const [entry] = (await store.list());
        const id = JSON.parse(entry!.request.body).requestId;
        expect((await stat(path.join(directory, 'pending', `${id}.json`))).mode & 0o777).toBe(0o600);
        await expect(store.get('../x')).rejects.toThrow(/letters/);
    });

    it('Durable Object store', async () => {
        const objects = new Map<string, RomeDBPendingWrites>();
        const namespace = {
            idFromName: (name: string) => name,
            get: (id: never) => {
                const name = id as unknown as string;
                if (!objects.has(name)) {
                    const data = new Map<string, unknown>();
                    const storage = {
                        get: async (key: string) => data.get(key),
                        put: async (key: string, value: unknown) => { data.set(key, value); },
                        delete: async (key: string) => data.delete(key),
                        list: async ({ prefix = '' } = {}) => new Map([...data].filter(([key]) => key.startsWith(prefix))),
                        transaction: async (closure: (txn: unknown) => Promise<unknown>) => closure(storage),
                    };
                    objects.set(name, new RomeDBPendingWrites({ storage } as never));
                }
                const object = objects.get(name)!;
                return { fetch: (input: string | Request, init?: RequestInit) => object.fetch(new Request(input, init)) };
            },
        };
        await contract(new DurableObjectPendingWriteStore(namespace, { shards: 3 }));
    });
});
