import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    ClientError, connect, createRomeDB, Float64, MemoryPendingWriteStore, objects, one, RecordId, UncertainWriteError, Vector,
    type RomeDB, type Value,
} from '../src/index';
import { liveRomeDBTests, startRomeDBService, type RomeDBTestService } from '../src/testing';

/**
 * Live contract against a real RomeDB service. Uses COSSACK_TEST_ROMEDB_URL/TOKEN when set
 * (for example a Cloud database), otherwise starts `romedb serve` from COSSACK_TEST_ROMEDB_BIN or PATH.
 */
const external = process.env.COSSACK_TEST_ROMEDB_URL && process.env.COSSACK_TEST_ROMEDB_TOKEN;
const live = external || liveRomeDBTests() ? describe : describe.skip;

live('RomeDB service contract', () => {
    let service: RomeDBTestService | undefined;
    let url: string;
    let token: string;
    let db: RomeDB;
    const suffix = Math.random().toString(36).slice(2, 8);
    const docs = `fdb_docs_${suffix}`;
    const ledger = `fdb_ledger_${suffix}`;

    beforeAll(async () => {
        if (external) {
            url = process.env.COSSACK_TEST_ROMEDB_URL!;
            token = process.env.COSSACK_TEST_ROMEDB_TOKEN!;
        } else {
            service = await startRomeDBService();
            ({ url, token } = service);
        }
        db = createRomeDB({ url, token, pending: new MemoryPendingWriteStore() });
        await db.preflight();
        await db.write([
            { rql: `CREATE TABLE ${docs}` },
            { rql: `DEFINE FIELD title ON ${docs} TYPE string REQUIRED` },
            { rql: `DEFINE FIELD rev ON ${docs} TYPE integer REQUIRED DEFAULT 1` },
            { rql: `CREATE UNIQUE INDEX ${docs}_title ON ${docs} (title)` },
            { rql: `CREATE TABLE ${ledger} (id TEXT PRIMARY KEY, n INTEGER NOT NULL)` },
        ]);
    }, 30_000);

    afterAll(async () => {
        await db?.close();
        await service?.stop();
    });

    it('reports the engine release at preflight', async () => {
        const info = await db.preflight();
        expect(info.engineVersion).toMatch(/^0\.(?:[2-9]|\d{2,})\./);
    });

    it('round-trips typed values through the engine', async () => {
        const values: { [key: string]: Value } = {
            max: 9223372036854775807n,
            min: -9223372036854775808n,
            float: new Float64(1),
            negativeZero: -0,
            text: 'snowman ☃',
            textKey: new RecordId(docs, '1'),
            intKey: new RecordId(docs, 1n),
            bytes: new Uint8Array([0, 255, 7]),
            nested: { list: [1n, 'two', null, { deep: true }] },
        };
        const names = Object.keys(values);
        const select = names.map(name => `$${name} AS ${name}`).join(', ');
        const result = await db.read([{ rql: `SELECT ${select}`, params: Object.fromEntries(names.map(name => [`$${name}`, values[name]!])) }]);
        const row = one(result.results[0]!);
        expect(row.max).toBe(9223372036854775807n);
        expect(row.min).toBe(-9223372036854775808n);
        expect(row.float).toEqual(new Float64(1));
        expect(Object.is((row.negativeZero as Float64).value, -0)).toBe(true);
        expect(row.text).toBe('snowman ☃');
        expect((row.textKey as RecordId).key).toBe('1');
        expect((row.intKey as RecordId).key).toBe(1n);
        expect(row.bytes).toEqual(new Uint8Array([0, 255, 7]));
        expect(row.nested).toEqual({ list: [1n, 'two', null, { deep: true }] });
    });

    it('stores vectors and documents with typed IDs', async () => {
        const id = new RecordId(docs, 'typed');
        await db.write([{ rql: `INSERT INTO ${docs} DOCUMENT $doc`, params: { $doc: { id, title: 'typed', rev: 1n } } }]);
        const result = await db.read([{ rql: `SELECT id, title, rev FROM ${docs} WHERE id = $id`, params: { $id: id } }]);
        expect(objects(result.results[0]!)).toEqual([{ id, title: 'typed', rev: 1n }]);
        const vector = await db.read([{ rql: 'SELECT $v AS v', params: { $v: Vector.float32([1, 2]) } }]);
        expect((vector.results[0]!.rows[0]![0] as Vector).bytes).toEqual(Vector.float32([1, 2]).bytes);
    });

    it('reads its own writes through afterSequence', async () => {
        const write = await db.write([{ rql: `INSERT INTO ${ledger} (id, n) VALUES ($id, 1)`, params: { $id: 'raw' } }]);
        const other = await connect({ url, token });
        const read = await other.read([{ rql: `SELECT n FROM ${ledger} WHERE id = 'raw'` }], { afterSequence: write.sequence });
        expect(read.sequence).toBeGreaterThanOrEqual(write.sequence);
        expect(read.results[0]!.rows).toEqual([[1n]]);
        await other.close();
    });

    it('rolls back every statement of a failed batch', async () => {
        const before = await db.sequence();
        const error = await db.write([
            { rql: `INSERT INTO ${ledger} (id, n) VALUES ('rollback', 1)` },
            { rql: `INSERT INTO ${docs} {title: 'typed'}` },
        ]).catch(e => e) as ClientError;
        expect(error).toBeInstanceOf(ClientError);
        expect(error.outcome).toBe('rolled-back');
        expect(error.sequence).toBeGreaterThan(before);
        const read = await db.read([{ rql: `SELECT COUNT(*) AS c FROM ${ledger} WHERE id = 'rollback'` }]);
        expect(read.results[0]!.rows[0]![0]).toBe(0n);
        expect(await db.pending.list()).toHaveLength(0);
    });

    it('checks an optimistic edit by affected count', async () => {
        await db.write([{ rql: `INSERT INTO ${docs} {id: type::record('${docs}', 'edit'), title: 'draft'}` }]);
        const edit = (rev: number) => db.write([{ rql: `UPDATE ${docs} SET title = $t, rev = rev + 1 WHERE id = type::record('${docs}', 'edit') AND rev = $rev`, params: { $t: `v${rev}`, $rev: rev } }]);
        expect((await edit(1)).results[0]!.affected).toBe(1n);
        expect((await edit(1)).results[0]!.affected).toBe(0n);
    });

    it('rejects a stale ifSequence without changing data', async () => {
        const sequence = await db.sequence();
        await db.write([{ rql: `INSERT INTO ${ledger} (id, n) VALUES ('bump', 1)` }]);
        const error = await db.write([{ rql: `INSERT INTO ${ledger} (id, n) VALUES ('stale', 1)` }], { afterSequence: sequence, ifSequence: sequence }).catch(e => e) as ClientError;
        expect(error.outcome).toBe('rolled-back');
        const read = await db.read([{ rql: `SELECT COUNT(*) FROM ${ledger} WHERE id = 'stale'` }]);
        expect(read.results[0]!.rows[0]![0]).toBe(0n);
    });

    it('recovers a lost response by exact body without applying it twice', async () => {
        let drop = true;
        const lossy = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const response = await fetch(input, init);
            if (drop && String(input).endsWith('/query')) {
                await response.body?.cancel();
                throw new TypeError('response lost');
            }
            return response;
        }) as typeof globalThis.fetch;
        const pending = new MemoryPendingWriteStore();
        const flaky = createRomeDB({ url, token, pending, fetch: lossy, retry: { attempts: 1 } });
        const error = await flaky.write([{ rql: `UPDATE ${ledger} SET n = n + 1 WHERE id = 'raw'` }], { requestId: `recover-${suffix}` }).catch(e => e);
        expect(error).toBeInstanceOf(UncertainWriteError);
        expect(await pending.get(`recover-${suffix}`)).toBeDefined();
        drop = false;
        expect(await flaky.recover(`recover-${suffix}`)).toBe('confirmed');
        expect(await flaky.recover(`recover-${suffix}`)).toBe('missing');
        // A fresh client replays the saved request: the receipt answers and nothing runs twice.
        const replay = await connect({ url, token });
        const again = await replay.recover(error.request);
        expect(again.requestId).toBe(`recover-${suffix}`);
        const read = await db.read([{ rql: `SELECT n FROM ${ledger} WHERE id = 'raw'` }]);
        expect(read.results[0]!.rows[0]![0]).toBe(2n);
        await flaky.close();
        await replay.close();
    });

    it('cancels a read in flight', async () => {
        const controller = new AbortController();
        const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).endsWith('/read')) controller.abort();
            return fetch(input, init);
        }) as typeof globalThis.fetch;
        const client = await connect({ url, token, fetch: slow });
        const error = await client.read([{ rql: 'SELECT 1' }], { signal: controller.signal }).catch(e => e) as ClientError;
        expect(error).toMatchObject({ code: 'FDB_CANCELLED', outcome: 'read-failed' });
        await client.close();
    });
});
