import { describe, expect, it } from 'vitest';
import { ClientError, createRomeDB, MemoryPendingWriteStore, REQUIRED_ENGINE_VERSION } from '../src/index';

// The client allows 32 calls in flight. On Workers a call whose request ends first never
// settles (its I/O is cancelled with the request); the client gives its place back once its
// deadline passes. These tests strand calls with a fetch that ignores its signal and never answers.
const LOCAL = 'http://127.0.0.1:4321/v1/database';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const details = { id: 'db-1', sequence: 10, serviceVersion: 1, engineVersion: REQUIRED_ENGINE_VERSION, capabilities: { readVersion: 2, atomicWrites: true, replayWindow: 64, exactSequenceCondition: true }, limits: {} };
const row = (body: { requestId?: string }) => json({ readVersion: 2, requestId: body.requestId, sequence: 10, results: [{ columns: ['n'], rows: [[{ type: 'Integer', value: '1' }]], affected: '0' }] });

function service(options: { hang?: (sql: string) => boolean; delayMs?: number } = {}) {
    let opened = 0;
    let reads = 0;
    let writes = 0;
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (url === LOCAL) { opened++; return json(details); }
        const body = JSON.parse(String(init.body)) as { requestId?: string; afterSequence?: number; statements: { sql: string }[] };
        // Stranded: the request this call belonged to is gone, and nothing ever answers it.
        if (options.hang?.(body.statements[0]!.sql)) return new Promise<Response>(() => {});
        if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
        if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (url.endsWith('/read')) { reads++; return row(body); }
        writes++;
        return json({ requestId: body.requestId, sequence: (body.afterSequence ?? 10) + 1, results: [{ columns: [], rows: [], affected: '1' }] });
    }) as typeof globalThis.fetch;
    // Each client asks for the database's details twice when it opens: connect, then the engine check.
    return { fetch, get opened() { return opened / 2; }, get reads() { return reads; }, get writes() { return writes; } };
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('RomeDB binding: the client\'s places', () => {
    it('treats a full client as backpressure until the places of calls past their deadline come back', async () => {
        const fake = service({ hang: sql => sql === 'SELECT stranded' });
        const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: fake.fetch, timeoutMs: 50, sleep: async () => {} });
        for (let i = 0; i < 32; i++) void db.read([{ rql: 'SELECT stranded' }]).catch(() => {});
        await pause(10);
        // The client names the limit: its places, not the size of the request.
        await expect(db.read([{ rql: 'SELECT 1' }])).rejects.toMatchObject({ code: 'RDB_LIMIT', outcome: 'not-sent', limit: 'client-requests' });
        await pause(80);
        const result = await db.read([{ rql: 'SELECT 1' }]);
        expect(result.results[0]!.rows).toHaveLength(1);
        // The same client: its places came back.
        await Promise.all(Array.from({ length: 20 }, () => db.read([{ rql: 'SELECT 1' }])));
        expect(fake.opened).toBe(1);
        await db.close();
    });

    it('sends a write refused for lack of places again, with the same request ID', async () => {
        const fake = service({ hang: sql => sql === 'SELECT stranded' });
        const pending = new MemoryPendingWriteStore();
        const db = createRomeDB({ url: LOCAL, token: 't', pending, fetch: fake.fetch, timeoutMs: 50, retry: { attempts: 6 } });
        await db.read([{ rql: 'SELECT 1' }]);
        for (let i = 0; i < 32; i++) void db.read([{ rql: 'SELECT stranded' }]).catch(() => {});
        await pause(10);
        const result = await db.write([{ rql: 'UPDATE x SET y = 1' }], { requestId: 'op-places' });
        expect(result.requestId).toBe('op-places');
        expect(fake.writes).toBe(1);
        expect(await pending.list()).toHaveLength(0);
        await db.close();
    });

    it('waits for places held by live calls instead of failing a burst', async () => {
        const fake = service({ delayMs: 20 });
        const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: fake.fetch, retry: { attempts: 5 } });
        const results = await Promise.allSettled(Array.from({ length: 60 }, () => db.read([{ rql: 'SELECT 1' }])));
        expect(results.filter(result => result.status === 'rejected')).toEqual([]);
        expect(fake.reads).toBe(60);
        expect(fake.opened).toBe(1);
        await db.close();
    });

    it('ends a call with the request it belongs to, which gives its place back', async () => {
        let request = new AbortController();
        const fake = service({ hang: sql => sql === 'SELECT slow' });
        const hangingFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
            // This fetch honours its signal, as a runtime does while the request is alive.
            const answer = fake.fetch(input, init);
            return new Promise<Response>((resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
                answer.then(resolve, reject);
            });
        }) as typeof globalThis.fetch;
        const db = createRomeDB({ url: LOCAL, token: 't', pending: new MemoryPendingWriteStore(), fetch: hangingFetch, sleep: async () => {}, requestSignal: () => request.signal });
        const calls = Array.from({ length: 32 }, () => db.read([{ rql: 'SELECT slow' }]));
        await pause(10);
        // The visitor left, or the request failed: its calls end.
        request.abort();
        const ended = await Promise.allSettled(calls);
        expect(ended.every(result => result.status === 'rejected' && (result.reason as ClientError).code === 'RDB_CANCELLED')).toBe(true);
        request = new AbortController();
        await Promise.all(Array.from({ length: 32 }, () => db.read([{ rql: 'SELECT 1' }])));
        expect(fake.opened).toBe(1);
        // A call's own signal wins over the request's.
        request.abort();
        await expect(db.read([{ rql: 'SELECT 1' }], { signal: new AbortController().signal })).resolves.toBeDefined();
        await expect(db.read([{ rql: 'SELECT 1' }])).rejects.toMatchObject({ code: 'RDB_CANCELLED' });
    });
});
