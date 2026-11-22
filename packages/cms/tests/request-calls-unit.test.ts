/**
 * A burst of requests to one site on Workers (reports.md, 2026-11-19): a request's database calls
 * end with it, requests that shared a read it started read again for themselves, and a failed
 * read is never kept as an answer (the network off, the main site, an open policy).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Hono, type Context } from 'hono';
import { ClientError, type RomeDB, type Statement } from '@cossackframework/romedb';
import { setRequestContextGetter } from '@cossackframework/core';
import { CmsNetwork, MAIN, memorySites, type CmsHost, type NetworkSite } from '../src/server/index';
import { CmsSettings } from '../src/server/site-settings';
import { readPagedTogether } from '../src/server/budget';
import { answered, requestCallsSignal, withRequestCalls } from '../app/src/cms/request-calls';

type Reply = (statements: Statement[]) => unknown;
const empty = { results: [{ columns: [], rows: [], affected: 0n }], sequence: 1 };
const rows = (...lists: unknown[][][]) => ({ results: lists.map(list => ({ columns: [], rows: list, affected: 0n })), sequence: 1 });

/** A database stand-in that answers each read with `reply`, or throws what it returns when that is an error. */
function fakeDb(reply: Reply): RomeDB & { reads: Statement[][] } {
    const reads: Statement[][] = [];
    return {
        reads,
        async read(statements: Statement[]) {
            reads.push(statements);
            const answer = reply(statements);
            if (answer instanceof Error) throw answer;
            return answer;
        },
        async maxRequestBytes() { return 65_536; },
        async close() {},
    } as unknown as RomeDB & { reads: Statement[][] };
}

const cancelled = () => new ClientError('RDB_CANCELLED', 'Database request failed', 'read-failed');
const full = () => new ClientError('RDB_LIMIT', 'Client request limit reached', 'not-sent', { limit: 'client-requests' });
const missing = (table: string) => new ClientError('RDB_QUERY', `no such table: ${table}`, 'read-failed');
const stubHost = (site: NetworkSite, db: RomeDB) => ({ site: site.id, db }) as unknown as CmsHost;

describe('shared reads under a burst', () => {
    it('reads again when the request that started a shared read ended, once', async () => {
        let attempt = 0;
        const db = fakeDb(() => ++attempt === 1 ? cancelled() : rows([['interface.iconStyle', JSON.stringify('bold')]]));
        const settings = new CmsSettings(db, []);
        await expect(settings.all()).resolves.toBeDefined();
        expect(db.reads).toHaveLength(2);
        // This request's own end is not retried for ever.
        const always = fakeDb(() => cancelled());
        await expect(new CmsSettings(always, []).all()).rejects.toMatchObject({ code: 'RDB_CANCELLED' });
        expect(always.reads).toHaveLength(2);
    });

    it('does not take a refusal for lack of places as a page too large', async () => {
        const db = fakeDb(() => full());
        await expect(new CmsSettings(db, []).all()).rejects.toMatchObject({ code: 'RDB_LIMIT' });
        expect(db.reads).toHaveLength(1);
    });

    it('never keeps a failed read as the network being off', async () => {
        let fail = true;
        const db = fakeDb(statements => {
            if (/cms_network/.test(statements[0]!.rql)) return fail ? full() : rows([[JSON.stringify(true)]]);
            return empty;
        });
        const network = new CmsNetwork({ db, host: stubHost, sites: memorySites() });
        await expect(network.enabled()).rejects.toMatchObject({ code: 'RDB_LIMIT' });
        fail = false;
        await expect(network.enabled()).resolves.toBe(true);
        // Before setup the table does not exist: the network is off.
        const before = new CmsNetwork({ db: fakeDb(() => missing('cms_network')), host: stubHost, sites: memorySites() });
        await expect(before.enabled()).resolves.toBe(false);
    });

    it('answers the main site before setup, and fails rather than serve it when a lookup fails', async () => {
        const open = () => fakeDb(() => empty);
        const before = new CmsNetwork({ db: fakeDb(() => empty), host: stubHost, open, sites: memorySites() });
        await expect(before.resolve('blog.example.com')).resolves.toEqual({ kind: 'site', site: MAIN });
        // The registry is the application's: when it cannot count the sites, the request fails.
        const busy = new CmsNetwork({ db: fakeDb(() => empty), host: stubHost, open, sites: { ...memorySites(), count: async () => { throw full(); } } });
        await expect(busy.resolve('blog.example.com')).rejects.toMatchObject({ code: 'RDB_LIMIT' });
    });

    it('reads several lists in one request, and one after another when the result is too large', async () => {
        const statement = (table: string) => (limit: number, offset: number) => ({ rql: `SELECT name, definition FROM ${table} LIMIT $limit OFFSET $offset`, params: { $limit: limit, $offset: offset } });
        const together = fakeDb(statements => rows(...statements.map((_, index) => [[`list-${index}`, '{}']])));
        expect(await readPagedTogether(together, [statement('a'), statement('b')], 200)).toEqual([[['list-0', '{}']], [['list-1', '{}']]]);
        expect(together.reads).toHaveLength(1);
        const large = fakeDb(statements => statements.length > 1 ? new ClientError('RDB_LIMIT', 'result exceeds the result limit', 'read-failed') : rows([['one', '{}']]));
        expect(await readPagedTogether(large, [statement('a'), statement('b')], 200)).toEqual([[['one', '{}']], [['one', '{}']]]);
        expect(large.reads.map(read => read.length)).toEqual([2, 1, 1]);
    });
});

describe('a request\'s database calls', () => {
    afterEach(() => { setRequestContextGetter(null); });

    /** An app whose route runs `route` inside the CMS's request lifetime, with the context reachable as core's request context. */
    function app(route: (signal: () => AbortSignal | undefined) => Promise<Response>) {
        const hono = new Hono();
        let current: Context | undefined;
        setRequestContextGetter(() => current as never);
        hono.use(async (c, next) => { current = c; await withRequestCalls(c, async () => { await next(); }); });
        hono.get('/', () => route(requestCallsSignal));
        return hono;
    }

    it('end when the request fails, and not when it succeeds', async () => {
        let signal: AbortSignal | undefined;
        await app(async read => { signal = read(); return new Response('ok'); }).request('/');
        expect(signal?.aborted).toBe(false);
        await app(async read => { signal = read(); return new Response('no', { status: 500 }); }).request('/');
        expect(signal?.aborted).toBe(true);
        await app(async read => { signal = read(); throw new Error('boom'); }).request('/');
        expect(signal?.aborted).toBe(true);
    });

    it('end when the visitor leaves', async () => {
        const visitor = new AbortController();
        let signal: AbortSignal | undefined;
        const hono = app(async read => {
            signal = read();
            visitor.abort();
            return new Response('late');
        });
        await hono.request(new Request('http://localhost/', { signal: visitor.signal }));
        expect(signal?.aborted).toBe(true);
    });

    it('take no signal once the answer is made, so work after it is left alone', async () => {
        let after: AbortSignal | undefined = new AbortController().signal;
        const hono = new Hono();
        let current: unknown;
        setRequestContextGetter(() => current as never);
        hono.use(async (c, next) => {
            current = c;
            await withRequestCalls(c, async () => { await next(); answered(c); after = requestCallsSignal(); });
        });
        hono.get('/', () => new Response('ok'));
        await hono.request('/');
        expect(after).toBeUndefined();
    });
});
