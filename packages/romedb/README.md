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
| `@cossackframework/romedb/orm` | `romedb(db)`, the adapter that runs the Cossack ORM (`@cossackframework/database`) on a RomeDB instance, with relational and document entities, and `romedbClient()`, the instance behind an ORM (see the database package's `docs/romedb.md`) |
| `@cossackframework/romedb/dev` | `romedbDev()` Vite plugin: starts `romedb serve` for a loopback `ROMEDB_URL` and passes its token, and, unless `ROMEDB_SITES_URL` is set, `romedb serve --directory storage/romedb/sites` on the next port for a CMS network's added sites (`ROMEDB_SITES_URL`, `ROMEDB_SITES_TOKEN`); `romedbDevVars` hands them to the Cloudflare plugin |
| `@cossackframework/romedb/testing` | `startRomeDBService` and `startRomeDBDirectory` for live tests against `romedb serve` |

Rules:

- Statements are `{ rql, params }`. The binding hands them to RomeDB's client, which calls the
  text `sql`; values, results and `ClientError` are RomeDB's own. `RecordId` is RomeDB's
  `Record`, renamed so it does not hide TypeScript's `Record` type. Print one as
  `` `${id.table}:${id.key}` ``.
- `maxRequestBytes()` and `maxResultBytes()` are the database's own limits, as it reports
  them: 8 MiB of each on a local RomeDB 0.2.23 or later, 1 MiB requests on Cloud, and 64 KiB
  requests with 256 KiB of results from an engine that reports none. Cut batches by them.
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
- The client allows 32 calls in flight. A call it refuses for lack of places (`RDB_LIMIT`,
  outcome `not-sent`, `limit` `client-requests` or `client-bytes`) waits and tries again like
  a 503, so a burst of requests queues instead of failing. `isClientFull(error)` tells such a
  refusal from one about the call's size.
- Request paths never warm a Cloud database. Call `warm()` from a schedule.

## Requests that end early

One binding serves every request of an isolate, and a call gives its place back when it
settles. On Workers a call whose request ends first never settles: the visitor left, or the
request failed while other calls of the same `Promise.all` were in flight, and the runtime
cancelled their I/O with the request. Two things keep a binding serving:

- `requestSignal`: a function that gives the signal of the current request. A call that passes
  no `signal` of its own takes it, so its calls end, and give their places back, when it aborts.
  The CMS passes one that aborts when the visitor leaves or the request fails. In your own
  application, abort a controller from your first middleware the same way:

  ```ts
  import { getRequestContext } from '@cossackframework/core';

  const db = createRomeDB({ url, token, pending, requestSignal: () => getRequestContext()?.get('requestCalls')?.signal });
  ```

  Work that runs after the answer under `waitUntil` should not take a signal that the end of the
  answer aborts.
- The client gives back the place of a call past its deadline (`timeoutMs`, 20 seconds by
  default) when it is full, since `@romedb/client` 0.2.26. A call that never settles holds its
  place until then; `requestSignal` gives it back at once.

Live tests run when `COSSACK_TEST_ROMEDB_BIN` points at a `romedb` executable (or
`romedb` is on `PATH`); `COSSACK_TEST_ROMEDB_URL` and `COSSACK_TEST_ROMEDB_TOKEN`
select an existing database instead.
