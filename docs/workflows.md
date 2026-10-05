# Workflows

Use a Workflow for a process that must wait and resume across requests. Cloudflare
owns completed step records, retry scheduling, sleeps and event waits. An RPC
response, a local adapter or a background Promise does not provide this durability.

In a generated app, `src/workflows/approval.ts` owns the definition,
`src/workflows/entry.ts` owns the native class, and `src/workflows/index.ts` owns
the pure server helper. Keep these module graphs separate for Node-based static
builds. The example below adds your application-owned effect receipts and policy.

`src/workflows/approval.ts`:

```ts
import { input } from '@cossackframework/core/input';
import { defineWorkflow, type WorkflowContext } from '@cossackframework/core/workflows';
import { prepareRecord, finishRecord } from './operations';

const events = { approved: input.object({ approved: input.boolean() }) };
export const approvalWorkflow = defineWorkflow({
  name: 'approval', version: 1,
  schema: input.object({ reference: input.string() }), events,
  async run(payload, { identity, env, step }: WorkflowContext<typeof events, Env>) {
    await step.do('prepare', async () => {
      await prepareRecord(env, payload.reference, identity.id);
      return { reference: payload.reference };
    }, { retries: { limit: 3, delay: 1000, backoff: 'exponential' } });
    const decision = await step.waitForEvent('approval', 'approved', { timeout: 86400000 });
    await step.do('finish', async () => {
      await finishRecord(env, payload.reference, decision.approved, identity.id);
      return null;
    });
    return { approved: decision.approved };
  },
});
```

`./operations` is your application module. Commit receipts keyed by workflow
identity and step name in its transactions; it is not a generated framework module.

`src/workflows/entry.ts`, imported only by the Cloudflare Worker export graph:

```ts
import { createCloudflareWorkflow } from '@cossackframework/framework/workflows';
import { approvalWorkflow } from './approval';
export class ApprovalWorkflow extends createCloudflareWorkflow(approvalWorkflow) {}
```

Re-export it from `src/index.ts` with
`export { ApprovalWorkflow } from './workflows/entry';`. Configure a Workflow
binding named `WORKFLOWS` with its actual workflow name and
`class_name: "ApprovalWorkflow"`. `cossack add workflows` generates this wiring.

`src/workflows/index.ts`, safe for server API and Node SSG module loading:

```ts
import { createWorkflowClient } from '@cossackframework/core/workflows';
import { createCloudflareWorkflowProvider } from '@cossackframework/framework/workflows/provider';
import { approvalWorkflow } from './approval';
import { authorizeRecordWorkflow } from '../auth/authorize-workflow';

export function createApproval(env: Env) {
  return createWorkflowClient(approvalWorkflow, createCloudflareWorkflowProvider(env.WORKFLOWS), {
    namespace: 'approval-v1',
    authorize: async (operation, identity) => authorizeRecordWorkflow(operation, identity),
  });
}
```

The policy module is your own server access policy: load trusted ownership by ID,
then compare it with the current authenticated context. The generated helper has
no policy implementation; add the hook above or enforce access before every call.
Use explicit imports such as `../workflows/index`, because `src/workflows.json`
is the static inspection manifest and shares the directory's basename.

Inside an authorized server handler:

```ts
import { createApproval } from '../workflows/index';
const client = createApproval(env);
const identity = await client.invoke({ reference: '123' }, {
  key: 'approval-123', scope: { tenantId: trustedTenantId, actorId: trustedUserId },
});
await client.sendEvent(identity, 'approved', { approved: true });
const status = await client.inspect(identity);
```

Do not import the native entry module in server API helpers. Node and Deno need
an explicitly configured durable provider; the local adapter is not a production
replacement.

The definition's authored `name` and positive `version` are static metadata. Keep
step names and control flow stable for existing instances. A version change creates
new invocation identities; coordinate it with your deployment and retention policy.
Invocation hashes include namespace, definition name/version, tenant, actor and
logical key. Reusing a key does not authorize another caller or promise a different
payload will replace the original run. Duplicate creation is provider-owned and
rejected; inspection does not start or recreate an instance.

All invocation, inspection, events and administrative pause/resume/terminate
operations belong on the server. Derive scope and keys from trusted application
context. A caller-provided identity is an identifier, never proof of ownership.
Use the optional `authorize` hook or enforce access before every client operation;
an unauthenticated public inspection/admin endpoint is not supplied. Inspection
returns only identity, durability, status and a fixed failure code. It never
returns workflow inputs, outputs or provider exception values.

Inputs, event payloads and step results use bounded data-only JSON. Dates should
be ISO strings. Accessors, class instances, sparse/custom arrays, hidden properties,
symbols, cycles and nonfinite numbers are rejected without calling getters or
`toJSON`. Enumerable undefined object properties are omitted. Validate direct
provider events too: the entry validates declared event schemas after each wait.

A completed `step.do` result is persisted by Cloudflare and reused when execution
resumes. A side effect can still succeed before its step result is recorded: retries
must therefore use a receipt transaction or the downstream provider's idempotency
key. This wrapper does not promise exactly-once effects or roll back external work.
Do not place unprotected side effects outside steps. An entry factory delegates to
native `WorkflowStep`; it is not a competing step persistence engine.

`pause`, `resume` and `terminate` delegate to the provider. A pause may wait for the
current step to reach its boundary. Termination does not undo completed external
side effects. Provider statuses are mapped to queued/running/paused/waiting/complete/
failed/terminated/unknown; an unfamiliar provider status remains unknown.

The current local Miniflare provider can report `running` during an external
event wait. The wrapper preserves that provider status; it does not infer a
waiting state from private step outputs. A running status alone does not prove
that an authored callback is executing. Native waiting-status and restart
acceptance remain open in the 0.9.0 checklist.

For unit tests, `createLocalWorkflowProvider(definition, { env, sleep })` uses an
in-memory instance map. It executes callbacks, retries, sleeps and external events
in one process. Inject `sleep(milliseconds, signal)` for deterministic retry/sleep timing and honor its AbortSignal; event timeouts use local
Web Standard timers, as do step deadlines. Constant, linear and exponential retry
backoff are honored. Termination cancels adapter-owned timers and stops later
steps; JavaScript cannot forcibly stop an authored callback already in progress.
Timed-out callbacks may still finish external effects, so use effect receipts even
in local tests. Custom clocks must release their own resources when aborted.
The local timer ceiling is 2,147,483,647 milliseconds; longer delays reject rather
than silently clamp. Only one outstanding local event wait per event type is
supported; concurrent same-type waits reject. It does not persist completed steps, survive a restart, or
replay a process snapshot. A new adapter cannot inspect an old adapter's instances.
Use actual Cloudflare runtime acceptance to establish native durability. Local
native tests do not prove live account deployment, resource access or retention.

References: [Cloudflare Workers API](https://developers.cloudflare.com/workflows/build/workers-api/),
[rules for durable execution](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).
