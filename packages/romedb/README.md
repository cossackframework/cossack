# @cossackframework/romedb

RomeDB for Cossack applications on Cloudflare Workers and Node.js: request bindings with
exact write recovery and a JSON transport codec, on RomeDB's own libraries: `@romedb/client`
everywhere, and `@romedb/node` to open database files on Node.
Its client and value types use Web APIs only, so the same client runs on Workers. On Node a
file path opens the file in this process (`openEmbedded`), and a URL reaches `romedb serve`
or RomeDB Cloud.

```ts
import { createRomeDB } from '@cossackframework/romedb';
import { connectNode, FilePendingWriteStore } from '@cossackframework/romedb/node';

const url = process.env.ROMEDB_URL || 'storage/romedb/app.romedb';   // a file, or a service URL
const token = process.env.ROMEDB_TOKEN;                              // server-only; files need none
const db = createRomeDB({
  url,
  connect: () => connectNode({ url, token }),
  pending: new FilePendingWriteStore('.cossack/romedb-pending'),
});

const result = await db.write([{ rql: 'UPDATE posts SET title = $t WHERE id = posts:p1', params: { $t: 'Edited' } }]);
```

On Workers, pass `url` and `token` instead of `connect`.

| Entry | Use |
| --- | --- |
| `@cossackframework/romedb` | `createRomeDB`, RomeDB's `connect` and typed values, row helpers, `rqlDatabase` (server) |
| `@cossackframework/romedb/values` | `Float64`, `RecordId`, `Vector`, `toTransport`, `fromTransport` (client-safe) |
| `@cossackframework/romedb/node` | `connectNode` (files through `@romedb/node`, `romedb serve` and Cloud by URL), `FilePendingWriteStore` |
| `@cossackframework/romedb/cloudflare` | `RomeDBPendingWrites` Durable Object and `DurableObjectPendingWriteStore` |
| `@cossackframework/romedb/dev` | `romedbDev()` Vite plugin: starts `romedb serve` for a loopback `ROMEDB_URL` and passes its token, and, unless `ROMEDB_SITES_URL` is set, `romedb serve --directory storage/romedb/sites` on the next port for a CMS network's added sites (`ROMEDB_SITES_URL`, `ROMEDB_SITES_TOKEN`); `romedbDevVars` hands them to the Cloudflare plugin |
| `@cossackframework/romedb/testing` | `startRomeDBService` and `startRomeDBDirectory` for live tests against `romedb serve` |

Rules:

- Statements are `{ rql, params }`. The binding hands them to RomeDB's client, which calls the
  text `sql`; values, results and `ClientError` are RomeDB's own. `RecordId` is RomeDB's
  `Record`, renamed so it does not hide TypeScript's `Record` type. Print one as
  `` `${id.table}:${id.key}` ``.
- The engine must be RomeDB 0.2.21 or later; `preflight()` refuses older or missing releases,
  and `exportFile()` runs it first, so a copy is never asked of an engine that cannot leave
  tables out.
- One process owns a file. Share a live database between processes (the app and Studio)
  through `romedb serve`. A file gets a new identity each time it opens, so a write saved
  before a restart is settled by its reconciler, not by receipt.
- `@romedb/node` is an optional peer: only Node applications that open files need it, at the
  same version as `@romedb/client`, or a second copy of RomeDB's value classes is installed
  and a client refuses the other's values. It loads its native addon only when a file is
  opened. Mark both external in Vite's SSR config so Node loads them natively.
- Every write is saved before dispatch. A lost response leaves an `UncertainWriteError`;
  `recoverPending()` replays the exact request. It never sends a replacement write.
- Reads send explicit `workLimits` and retry 503/429 backpressure a bounded number of times.
- Request paths never warm a Cloud database. Call `warm()` from a schedule.

Live tests run when `COSSACK_TEST_ROMEDB_BIN` points at a `romedb` executable (or
`romedb` is on `PATH`); `COSSACK_TEST_ROMEDB_URL` and `COSSACK_TEST_ROMEDB_TOKEN`
select an existing database instead.
