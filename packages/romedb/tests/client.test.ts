import { describe, expect, it } from 'vitest';
import { ClientError, connect, normalizeUrl, RecordId, validatePrepared } from '../src/index';

const LOCAL = 'http://127.0.0.1:4321/v1/database';
const CLOUD = 'https://cloud.romedb.com/v1/organizations/11111111-1111-4111-8111-111111111111/databases/22222222-2222-4222-8222-222222222222';
const DETAILS = {
    id: 'db-1', sequence: 5, serviceVersion: 1, engineVersion: '0.2.9',
    capabilities: { readVersion: 2, atomicWrites: true, replayWindow: 64, exactSequenceCondition: true },
    limits: {},
};

type Call = { url: string; init: RequestInit; body?: { [key: string]: unknown } };

function json(body: unknown, status = 200, headers: { [key: string]: string } = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function server(handler: (call: Call) => Response | Promise<Response>) {
    const calls: Call[] = [];
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const call: Call = { url: String(input), init, ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}) };
        calls.push(call);
        return handler(call);
    };
    return { calls, fetch: fetch as typeof globalThis.fetch };
}

function receipt(call: Call, results: unknown[] = [{ columns: [], rows: [], affected: '1' }]) {
    const body = call.body!;
    return json({ requestId: body.requestId, sequence: (body.afterSequence as number) + 1, results });
}

describe('URL normalization', () => {
    it('accepts local, Cloud and romedb:// URLs', () => {
        expect(normalizeUrl('http://127.0.0.1:4321')).toBe(LOCAL);
        expect(normalizeUrl(`${CLOUD}/query`)).toBe(CLOUD);
        expect(normalizeUrl(CLOUD.replace('https://', 'romedb://'))).toBe(CLOUD);
        expect(() => normalizeUrl('http://example.com/v1/database')).toThrow(/HTTPS/);
        expect(() => normalizeUrl(`${CLOUD}?token=x`)).toThrow();
        expect(() => normalizeUrl('https://cloud.romedb.com/v1/database')).toThrow(/organization-scoped/);
    });
});

describe('protocol client', () => {
    it('sends credentials, database identity and typed parameters', async () => {
        const { calls, fetch } = server(call => call.url === LOCAL ? json(DETAILS) : receipt(call));
        const db = await connect({ url: LOCAL, token: 'secret-token', fetch });
        expect(db.sequence).toBe(5);
        const result = await db.writeAtomic([{ rql: 'UPDATE posts SET author = $a', params: { $a: new RecordId('users', 'tan') } }]);
        expect(result.sequence).toBe(6);
        expect(result.results[0]!.affected).toBe(1n);
        const write = calls[1]!;
        expect(write.url).toBe(`${LOCAL}/query`);
        expect(write.init.redirect).toBe('manual');
        const headers = write.init.headers as { [key: string]: string };
        expect(headers.authorization).toBe('Bearer secret-token');
        expect(headers['x-romedb-database-id']).toBe('db-1');
        expect(headers['x-romedb-query-version']).toBeUndefined();
        expect(write.body).toMatchObject({ afterSequence: 5, statements: [{ params: { $a: { type: 'Record', value: { table: 'users', key: { type: 'String', value: 'tan' } } } } }] });
    });

    it('defers Cloud details, skips warm when asked, and speaks query version 3', async () => {
        const { calls, fetch } = server(call => call.url === CLOUD ? json({ ...DETAILS, id: '22222222-2222-4222-8222-222222222222' }) : call.url.endsWith('/read')
            ? json({ readVersion: 2, requestId: call.body!.requestId, sequence: 0, results: [{ columns: ['b'], rows: [[{ type: 'Binary', value: 'AQI=' }]], affected: '0' }] })
            : receipt(call));
        const db = await connect({ url: CLOUD, token: 't', fetch, warm: false });
        expect(db.deferred).toBe(true);
        expect(calls).toHaveLength(0);
        const read = await db.read([{ rql: 'SELECT $b AS b', params: { $b: new Uint8Array([1, 2]) } }]);
        expect(read.results[0]!.rows[0]![0]).toEqual(new Uint8Array([1, 2]));
        expect((calls[0]!.init.headers as { [key: string]: string })['x-romedb-query-version']).toBe('3');
        expect(calls[0]!.body).toMatchObject({ statements: [{ params: { $b: { type: 'Binary', value: 'AQI=' } } }] });
        expect(() => db.prepareWrite([{ rql: 'SELECT 1' }])).not.toThrow();
    });

    it('requires a known sequence before preparing a deferred write', async () => {
        const { fetch } = server(() => json(DETAILS));
        const db = await connect({ url: CLOUD, token: 't', fetch, warm: false });
        expect(() => db.prepareWrite([{ rql: 'SELECT 1' }])).toThrow(expect.objectContaining({ code: 'FDB_SEQUENCE_UNKNOWN', outcome: 'not-sent' }));
    });

    it('reports rolled-back receipts with their sequence', async () => {
        const { fetch } = server(call => call.url === LOCAL ? json(DETAILS)
            : json({ requestId: call.body!.requestId, sequence: 6, error: { code: 'FDB_CONFLICT', message: 'stale sequence' } }, 409));
        const db = await connect({ url: LOCAL, token: 't', fetch });
        const error = await db.writeAtomic([{ rql: 'SELECT 1' }], { ifSequence: 5 }).catch(e => e) as ClientError;
        expect(error).toBeInstanceOf(ClientError);
        expect(error.outcome).toBe('rolled-back');
        expect(error.code).toBe('FDB_CONFLICT');
        expect(db.sequence).toBe(6);
    });

    it('leaves dispatched writes unknown, keeps the exact request and redacts the token', async () => {
        let mode: 'drop' | 'reject' = 'drop';
        const { calls, fetch } = server(call => {
            if (call.url === LOCAL) return json(DETAILS);
            if (mode === 'drop') throw new TypeError('socket hang up');
            return json({ error: { code: 'FDB_UNAVAILABLE', message: 'busy for token secret-token' } }, 503, { 'retry-after': '2' });
        });
        const db = await connect({ url: LOCAL, token: 'secret-token', fetch });
        const prepared = db.prepareWrite([{ rql: 'SELECT 1' }], { requestId: 'op-1' });
        const dropped = await db.submit(prepared).catch(e => e) as ClientError;
        expect(dropped.outcome).toBe('unknown');
        expect(dropped.request).toBe(prepared);
        mode = 'reject';
        const rejected = await db.recover(prepared).catch(e => e) as ClientError;
        expect(rejected.outcome).toBe('unknown');
        expect(rejected.status).toBe(503);
        expect(rejected.retryAfterMs).toBe(2000);
        expect(rejected.message).not.toContain('secret-token');
        expect(calls[1]!.init.body).toBe(calls[2]!.init.body);
    });

    it('rejects a reply for another request or outside the receipt window', async () => {
        const { fetch } = server(call => call.url === LOCAL ? json(DETAILS) : json({ requestId: call.body!.requestId, sequence: 100, results: [{ columns: [], rows: [], affected: '0' }] }));
        const db = await connect({ url: LOCAL, token: 't', fetch });
        const error = await db.writeAtomic([{ rql: 'SELECT 1' }]).catch(e => e) as ClientError;
        expect(error.code).toBe('FDB_PROTOCOL');
        expect(error.outcome).toBe('unknown');
    });

    it('refuses redirects instead of following them with the credential', async () => {
        const { calls, fetch } = server(call => call.url === LOCAL && calls.length === 1 ? json(DETAILS) : new Response(null, { status: 307, headers: { location: 'https://evil.example/' } }));
        const db = await connect({ url: LOCAL, token: 't', fetch });
        await expect(db.read([{ rql: 'SELECT 1' }])).rejects.toMatchObject({ code: 'FDB_PROTOCOL', status: 307, outcome: 'read-failed' });
        await expect(db.writeAtomic([{ rql: 'SELECT 1' }])).rejects.toMatchObject({ outcome: 'unknown' });
    });

    it('keeps the socket error as the cause of a transport failure', async () => {
        const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4321'), { code: 'ECONNREFUSED' }) });
        const { calls, fetch } = server(() => { if (calls.length === 1) return json(DETAILS); throw refused; });
        const db = await connect({ url: LOCAL, token: 't', fetch });
        const error = await db.read([{ rql: 'SELECT 1' }]).catch((caught: unknown) => caught) as ClientError;
        expect(error).toBeInstanceOf(ClientError);
        expect(error).toMatchObject({ code: 'FDB_TRANSPORT', outcome: 'read-failed' });
        expect(error.status).toBeUndefined();
        expect(error.cause).toBe(refused);
    });

    it('cancels before dispatch without sending', async () => {
        const { calls, fetch } = server(() => json(DETAILS));
        const db = await connect({ url: LOCAL, token: 't', fetch });
        const controller = new AbortController();
        controller.abort();
        const error = await db.read([{ rql: 'SELECT 1' }], { signal: controller.signal }).catch(e => e) as ClientError;
        expect(error).toMatchObject({ code: 'FDB_CANCELLED', outcome: 'not-sent' });
        expect(calls).toHaveLength(1);
    });

    it('validates saved requests before replay', async () => {
        const { fetch } = server(() => json(DETAILS));
        const db = await connect({ url: LOCAL, token: 't', fetch });
        const prepared = db.prepareWrite([{ rql: 'SELECT 1' }], { requestId: 'op-2' });
        expect(validatePrepared(prepared).requestId).toBe('op-2');
        expect(() => validatePrepared({ ...prepared, token: 'x' })).toThrow(/invalid saved request/);
        expect(() => validatePrepared({ ...prepared, body: prepared.body.replace('op-2', 'bad id!') })).toThrow(/identity/);
        await expect(db.submit({ ...prepared, databaseId: 'other' })).rejects.toMatchObject({ code: 'FDB_REQUEST_IDENTITY' });
    });

    it('refuses oversized requests before sending', async () => {
        const { fetch } = server(() => json(DETAILS));
        const db = await connect({ url: LOCAL, token: 't', fetch });
        expect(() => db.prepareWrite([{ rql: 'SELECT $x', params: { $x: 'x'.repeat(70_000) } }])).toThrow(/64 KiB/);
    });
});
