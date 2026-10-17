# @cossackframework/fastdb

FastDB for Cossack applications on Cloudflare Workers and Node.js: a service-protocol
client on Web APIs, request bindings with exact write recovery, typed values and a
JSON transport codec.

```ts
import { createFastDB } from '@cossackframework/fastdb';
import { FilePendingWriteStore } from '@cossackframework/fastdb/node';

const db = createFastDB({
  url: process.env.FASTDB_URL!,        // http://127.0.0.1:4321 or a FastDB Cloud database URL
  token: process.env.FASTDB_TOKEN!,    // server-only
  pending: new FilePendingWriteStore('.cossack/fastdb-pending'),
});

const result = await db.write([{ sql: 'UPDATE posts SET title = $t WHERE id = posts:p1', params: { $t: 'Edited' } }]);
```

| Entry | Use |
| --- | --- |
| `@cossackframework/fastdb` | `connect`, `createFastDB`, typed values, row helpers, `sqlDatabase` (server) |
| `@cossackframework/fastdb/values` | `Float64`, `RecordId`, `Vector`, `toTransport`, `fromTransport` (client-safe) |
| `@cossackframework/fastdb/node` | `FilePendingWriteStore` |
| `@cossackframework/fastdb/cloudflare` | `FastDBPendingWrites` Durable Object and `DurableObjectPendingWriteStore` |
| `@cossackframework/fastdb/testing` | `startFastDBService` for live tests against `fastdb serve` |

Rules:

- The engine must be FastDB 2.8.0 or later; `preflight()` refuses older or missing releases.
- Every write is saved before dispatch. A lost response leaves an `UncertainWriteError`;
  `recoverPending()` replays the exact request. It never sends a replacement write.
- Reads send explicit `workLimits` and retry 503/429 backpressure a bounded number of times.
- Request paths never warm a Cloud database. Call `warm()` from a schedule.

Live tests run when `COSSACK_TEST_FASTDB_BIN` points at a `fastdb` executable (or
`fastdb` is on `PATH`); `COSSACK_TEST_FASTDB_URL` and `COSSACK_TEST_FASTDB_TOKEN`
select an existing database instead.
