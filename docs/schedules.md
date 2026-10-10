# Schedules and Cron

Schedules dispatch registered background jobs. Both a provider event and local
one-shot execution use the same job payload validation, idempotency ledger,
retry policy, handler, and cleanup. They never call a separate business handler.

```ts
import { createScheduleRuntime } from '@cossackframework/core/schedules';

const schedules = createScheduleRuntime({
  dispatcher: jobs, // Your configured SVC-01 job runtime.
  schedules: [{
    name: 'daily-report', cron: '0 9 * * MON-FRI', job: 'report',
    payload: { title: 'Daily report' }, scope: { tenantId: 'tenant-1' },
  }],
});

console.log(schedules.list());
await schedules.runOnce('daily-report', { scheduledTime: Date.UTC(2026, 9, 5, 9) });
// A local job adapter must then drain its queue to execute the handler.
```

`list()` includes names, cron expressions, job names, and policies. It excludes
payload and actor/tenant values. `validateScheduleDefinitions` is a pure shared
validator for JSON configuration, compiler preflight, and inspection; it rejects
duplicate names, invalid cron, unsafe JSON, and missing explicit scope.
The job schema validates payload contents when dispatched. A valid schedule
definition does not prove that its job exists in a separately supplied registry.
Authored literal definitions preserve static job-name checks. An imported JSON
registry must pass through `validateScheduleDefinitions(json)` before being
supplied to a typed dispatcher; its returned `ValidatedScheduleDefinitions`
marks that explicit configuration boundary. Runtime construction validates it
again, and the jobs dispatcher still rejects unknown jobs before publishing.

## Time and expression syntax

Time is UTC. `scheduledTime` is an explicit nonnegative integer count of
milliseconds since the Unix epoch. The provider's original scheduled timestamp,
rather than current delivery time, identifies an occurrence. A one-shot call
does not evaluate the cron expression: it deliberately runs the named schedule
at the supplied occurrence time.

Cossack supports a conservative five-field Cloudflare-compatible subset:
minute 0–59, hour 0–23, day of month 1–31, month 1–12 or JAN–DEC, weekday 1–7 or
SUN–SAT. Fields accept `*`, comma lists, ascending ranges, and positive steps
(for example `*/15`, `0/15`, or `MON-FRI/2`). Weekday **1 means Sunday** and 7
means Saturday. Names are case insensitive; whitespace and names are normalized.
Ranges cannot wrap across the field boundary. Steps cannot exceed the field's
size. Seconds, macros, `?`, and provider extensions `L`, `W`, and `#` are
explicitly unsupported. Cossack validates syntax, not calendar satisfiability;
for example a February 31 schedule may never receive a provider event.

Cloudflare documents [UTC cron syntax and weekday numbering](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [scheduled event timestamp and cron fields](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).

## Delivery, overlap, and retries

The generated Cloudflare entry should await
`schedules.scheduled({ cron: controller.cron, scheduledTime: controller.scheduledTime })`.
The cron string selects matching authored definitions; Cossack does not evaluate
another clock. Several names may share a cron expression and all are dispatched.
An unknown trigger fails with an actionable configuration error. Configuration
and provider triggers must belong to the same selected environment.

Each occurrence uses `schedule:<name>:<timestamp>` as its job idempotency key.
The jobs runtime also namespaces it by environment, job, tenant, and actor.
Duplicate provider events, duplicate one-shot calls, and a caller/provider retry
after partial dispatch, if one occurs, identify the same logical work. Deduplication lasts
only as long as the configured job ledger retains its terminal keys. Local
memory storage provides only process-local guarantees.

Distinct occurrence timestamps may run concurrently. There is no cross-occurrence
lock or single-flight scheduler. If a job requires that behavior, implement a
durable application-level lock or invariant in its handler. Dispatch failures
reject the scheduled event and report failure. Cossack does not automatically
reschedule failed publication, and a failed Cron event does not promise provider
redelivery. If a caller or provider retries, use the original occurrence timestamp.
After dispatch succeeds, **jobs owns handler retries** and cleanup; schedule
delivery does not add another handler retry loop.

Missed occurrences are not replayed automatically. Cossack does not invent
catch-up runs, promise every tick will execute, or interpret deployment downtime
as a backlog. Deliberately replay a known missed occurrence with `runOnce` and
its original timestamp. Consult provider operational events for delivery evidence.

Node does not receive an autonomous timer from this portable module.
It requires an explicit scheduler adapter or an external scheduler that calls
`runOnce`/`scheduled`. The local one-shot API is for controlled execution, not
durable production scheduling. Never retain an HTTP request or its facilities
in a schedule definition; resolve scoped facilities in the job handler.
