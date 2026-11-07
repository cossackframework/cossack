import { createRomeDB, RecordId, Float64, one, UncertainWriteError } from '../../src/index';
import { DurableObjectPendingWriteStore, RomeDBPendingWrites, type DurableObjectNamespaceLike } from '../../src/cloudflare';

export { RomeDBPendingWrites };

interface Env { ROMEDB_URL: string; ROMEDB_TOKEN: string; ROMEDB_PENDING: DurableObjectNamespaceLike }

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const pending = new DurableObjectPendingWriteStore(env.ROMEDB_PENDING, { shards: 2 });
        const suffix = new URL(request.url).searchParams.get('suffix')!;
        const table = `wk_${suffix}`;
        let drop = false;
        const db = createRomeDB({
            url: env.ROMEDB_URL, token: env.ROMEDB_TOKEN, pending, retry: { attempts: 1 },
            fetch: async (input, init) => {
                const response = await fetch(input, init);
                if (drop && String(input).endsWith('/query')) { await response.body?.cancel(); throw new TypeError('lost'); }
                return response;
            },
        });
        const info = await db.preflight();
        await db.write([{ rql: `CREATE TABLE ${table} (id TEXT PRIMARY KEY, n INTEGER NOT NULL)` }, { rql: `INSERT INTO ${table} (id, n) VALUES ('a', 1)` }]);
        const typed = one((await db.read([{ rql: 'SELECT $i AS i, $f AS f, $r AS r', params: { $i: 9223372036854775807n, $f: new Float64(1), $r: new RecordId('posts', 7n) } }])).results[0]!);
        drop = true;
        const lost = await db.write([{ rql: `UPDATE ${table} SET n = n + 1 WHERE id = 'a'` }], { requestId: `wk-${suffix}` }).catch(e => e);
        const pendingBefore = (await pending.list()).length;
        drop = false;
        const report = await db.recoverPending();
        const n = one((await db.read([{ rql: `SELECT n FROM ${table} WHERE id = 'a'` }])).results[0]!).n;
        return Response.json({
            engine: info.engineVersion,
            int: String(typed.i), float: (typed.f as Float64).value, floatTyped: typed.f instanceof Float64,
            recordKey: String((typed.r as RecordId).key), recordKeyType: typeof (typed.r as RecordId).key,
            uncertain: lost instanceof UncertainWriteError, pendingBefore, report, n: String(n),
            pendingAfter: (await pending.list()).length,
        });
    },
};
