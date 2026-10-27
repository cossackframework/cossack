# @cossackframework/romedb

RomeDB for Cossack applications on Cloudflare Workers and Node.js: a service-protocol
client on Web APIs, request bindings with exact write recovery, typed values and a
JSON transport codec.

```ts
import { createRomeDB } from '@cossackframework/romedb';
import { FilePendingWriteStore } from '@cossackframework/romedb/node';

const db = createRomeDB({
  url: process.env.ROMEDB_URL!,        // http://127.0.0.1:4321 or a RomeDB Cloud database URL
  token: process.env.ROMEDB_TOKEN!,    // server-only
  pending: new FilePendingWriteStore('.cossack/romedb-pending'),
});

const result = await db.write([{ rql: 'UPDATE posts SET title = $t WHERE id = posts:p1', params: { $t: 'Edited' } }]);
```

| Entry | Use |
| --- | --- |
| `@cossackframework/romedb` | `connect`, `createRomeDB`, typed values, row helpers, `rqlDatabase` (server) |
| `@cossackframework/romedb/values` | `Float64`, `RecordId`, `Vector`, `toTransport`, `fromTransport` (client-safe) |
| `@cossackframework/romedb/node` | `FilePendingWriteStore` |
| `@cossackframework/romedb/cloudflare` | `RomeDBPendingWrites` Durable Object and `DurableObjectPendingWriteStore` |
| `@cossackframework/romedb/testing` | `startRomeDBService` for live tests against `romedb serve` |

Rules:

- The engine must be RomeDB 0.2.9 or later; `preflight()` refuses older or missing releases.
- Every write is saved before dispatch. A lost response leaves an `UncertainWriteError`;
  `recoverPending()` replays the exact request. It never sends a replacement write.
- Reads send explicit `workLimits` and retry 503/429 backpressure a bounded number of times.
- Request paths never warm a Cloud database. Call `warm()` from a schedule.

Live tests run when `COSSACK_TEST_ROMEDB_BIN` points at a `romedb` executable (or
`romedb` is on `PATH`); `COSSACK_TEST_ROMEDB_URL` and `COSSACK_TEST_ROMEDB_TOKEN`
select an existing database instead.
