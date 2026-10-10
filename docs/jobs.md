# Background jobs

Jobs run independently of component `@Task` lifecycle methods. A job registry
defines validated JSON payloads and handlers. The runtime publishes work through
an adapter and records delivery ownership in an atomic store.

```ts
import { input } from '@cossackframework/core/input';
import {
  createJobRuntime, defineJob, LocalJobAdapter, MemoryJobStore,
} from '@cossackframework/core/jobs';

const adapter = new LocalJobAdapter();
const jobs = createJobRuntime({
  namespace: 'staging', adapter, store: new MemoryJobStore(), now: adapter.now,
  jobs: {
    sendReceipt: defineJob({
      schema: input.object({ orderId: input.string({ required: true }) }),
      maxAttempts: 3, retryDelaySeconds: 10,
      async handle(payload, context) {
        // Resolve credentials and facilities for this job, never from a retained request.
        const client = await openReceiptClient(context.scope.tenantId);
        context.onCleanup(() => client.close());
        await client.send(payload.orderId, { idempotencyKey: context.key });
      },
    }),
  },
});

await jobs.dispatch('sendReceipt', { orderId: 'order-123' }, {
  scope: { tenantId: 'tenant-1', actorId: 'user-1' },
  idempotencyKey: 'receipt:order-123', delaySeconds: 30,
});
adapter.advance(30);
await adapter.drain(jobs);
```

`openReceiptClient` above is an application-owned facility. Actor and tenant IDs
are explicit serialized context. The consumer must independently authorize the
actor and tenant against trusted application data; a serialized ID grants no
permission. Do not expose dispatch directly to untrusted browser payloads.
Do not place credentials in job payloads. Request objects, functions, accessors,
non-finite numbers, and cycles are rejected. Payloads are bounded to 120 KiB and validated at dispatch
and again before handling. Use JSON schemas without coercions that change on
each parse. Unknown names and invalid envelopes are acknowledged as permanent
invalid input and emit a fixed diagnostic; they do not invoke a handler.

Local tests use an explicit clock. `LocalJobAdapter` and `MemoryJobStore` retain
only process state. Their snapshots simulate runtime restarts for deterministic
tests; they provide no persistence after process loss.

## Cloudflare and durable storage

`createCloudflareJobAdapter(env.JOBS)` publishes through a structural Queues
binding. It requires an explicitly configured `JobStore` with
`durability: 'durable'`; the runtime never substitutes an in-memory store.
Expose `queue(batch) { return jobs.queue(batch); }` from the Worker entry and
await it. Bindings and the durable ledger belong to the selected environment.

Queues delivers at least once. A send resolves after Queues persists the message.
The adapter passes `contentType: 'json'` and an explicit dispatch delay between
0 and 86,400 seconds. Retries use a positive delay up to 86,400 seconds.
Per-message settings override queue defaults. Configure provider retry limits
and dead-letter routing to allow the application's attempt limit and lease
contention; Queues may dead-letter a message before the runtime acquires it.
See the [Queues JavaScript API](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
and [retry and delay behavior](https://developers.cloudflare.com/queues/configuration/batching-retries/).

The `JobStore` contract requires these guarantees:

- `claim` atomically creates or reclaims a lease and increments a stored logical
  attempt counter. `options.attempt` is provider delivery metadata; it must not
  reset the persisted counter. Return `acquired` with a fresh opaque token and
  the stored attempt, `busy` with remaining lease delay, or a terminal status.
- `complete` and `fail` update only the matching current token. A stale owner
  cannot complete or release a newer worker's claim. False means ownership was
  lost and delivery must retry. `fail.retryAt` is the earliest permitted next
  execution (equal to `now` for terminal failure). A retrying record remains
  busy until that persisted deadline, including after worker restart; duplicate
  deliveries before it must not acquire a claim or increment attempts.
- Terminal records survive worker restart for the documented retention period.
  Removing a terminal record permits the same key to execute again.
- Inspection returns only the declared bounded metadata. Never store payloads,
  actor/tenant IDs, original idempotency keys, exceptions, tokens, or credentials
  in failure records or diagnostic events.

The logical key is SHA-256 of environment namespace, job name, tenant ID, actor
ID, and the caller's idempotency key. Repeated dispatch with the same tuple
represents the same work; changing its payload does not create another effect.
Use a new key for intentional new work. Without an authored key each dispatch
gets a new identity. `context.id` identifies one dispatch, while `context.key`
identifies logical work across duplicate dispatches and worker restarts.

The default lease is 15 minutes. Set it longer than the handler's maximum
execution time, including cleanup. There is no heartbeat. After lease expiry a
new worker can run the handler while the old handler is still completing an
external call. Token fencing protects the ledger, not that external call.
Persist an effect receipt transactionally with database writes, or pass
`context.key` to a provider that supports idempotent operations. A crash after
an external effect but before `complete` can repeat that effect. A queue ack
does not provide exactly-once external execution.

## Retries and failure inspection

`PermanentJobError` ends retries. `TransientJobError` and other handler errors
retry until the store's logical attempt reaches `maxAttempts` (default 3).
Provider attempt counters cannot reset this limit. Registered cleanup runs in
reverse order and all hooks are awaited even when one throws. A failed handler
retains its own retry classification. Cleanup failure after a successful handler
is terminal `JOB_CLEANUP_FAILED`, preventing an automatic repeat of completed
effects; inspect and resolve it before deliberately dispatching new work.

`await jobs.inspect({ status: 'failed', limit: 100 })` returns job name, hashed
key, state, stored attempt, timestamp, fixed code, and an actionable next step.
The optional logger receives the same redacted shape. Logger failure does not
change delivery outcomes. Store failure retries without acknowledging unrecorded
work. Terminal completion/failure is persisted before acknowledgement.

## Generated Cloudflare applications

Use `cossack add jobs` in a Cloudflare application. The recipe adds the `JOBS`
producer/consumer, a separate `JOB_STATE` D1 ledger, `src/jobs/index.ts` and the
ledger/receipt migration. It does not add the ORM. The factory validates payloads
and passes explicit actor/tenant scope; call it from authorized server code:

```ts
await createJobs(bindings).dispatch('record', { value: 'report-ready' }, {
  scope: { tenantId: authorizedTenantId, actorId: authorizedUserId },
  idempotencyKey: logicalOperationId,
  delaySeconds: 10,
});
```

Import `createJobs` from your application's `src/jobs`. Derive actor/tenant IDs
from server authorization, not submitted user input. The generated example records
one database receipt per `context.key`. This protects that receipt across the
handler/acknowledgement crash window; it does not make an unrelated external API
idempotent. `JOB_NAMESPACE` must identify the environment; use a distinct value
for each environment that shares a ledger. Wrangler named environments must
explicitly declare their Queue/D1 bindings.

Apply `pnpm exec wrangler d1 migrations apply JOB_STATE --local` before consuming
local jobs. This uses the recipe's independent `src/jobs/migrations` directory.
Select/create a Queue and D1 database and set the actual remote `database_id`
before remote deployment; apply its migration with an explicit remote target.
Inspect the resource plan first. Generated local references are not evidence of
remote resource ownership or existence. No framework code auto-creates tables.

`createD1JobStore(binding)` and `jobStateSchema` are available from
`@cossackframework/framework/jobs` for manual composition. Apply schema statements
through migrations or D1 prepared statements; D1's `exec` treats lines as separate
statements and cannot directly consume multiline CREATE TABLE statements.
Completed/failed ledger keys persist until an application-owned retention policy
removes them. Deleting them also removes that deduplication protection. Keep the
ledger's lease longer than the complete handler/cleanup duration. Read-only
inspection never initializes the schema.

The generated jobs recipe requires Cloudflare bindings and rejects Node
composition before writing files. Other runtimes can use explicit durable queue
and store adapters through the portable contracts. `LocalJobAdapter` is for local
tests; it does not provide durable production scheduling or autonomous execution.
