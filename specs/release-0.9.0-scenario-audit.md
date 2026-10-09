# Cossack 0.9.0 cross-feature evidence audit

Receipt scope: the final package/payload comparisons below record release
preparation at `6764a7a1`. Subsequent demo startup and Core development-logging
changes and build-only SSG hook scoping have [separate targeted/native evidence](./release-0.9.0-verification-archive.md#codex-cold-warm-startup-2026-10-09);
they are not claimed as a repeat of the complete packed/hosted release matrix.


Author: Codex. Source/evidence review and installed scenarios 1–5 acceptance, 2026-10-09.

This indexes the five exact [cross-feature scenarios](./release-0.9.0-plan.md#cross-feature-acceptance-scenarios).
The historical baseline below did not close REL-03 or REL-05. Final reconciliation now closes them. The initial review performed no tests, builds,
packing or provider writes; the follow-ups below execute installed native/browser,
CLI/MCP and hosted CI acceptance. Those original receipts used packages 0.8.3; final packages are 0.9.0. Desktop's remaining
checks are waived by the user and outside this audit.

“Proven” below means the stated assertion has execution evidence at the named
scope. Separate proofs are identified as separate. “Missing combined scope” means
the inspected tests and indexed receipts do not demonstrate that composition;
it is not a claim that the feature is broken or that its completed task must reopen.
Local native workerd/Miniflare is not hosted Cloudflare, a synthetic identity is
not a real login, and installed 0.8.3 acceptance is not final 0.9.0 acceptance.

## 1. Protected resource, URL filters and validated edit

> A protected resource page loads a typed server query, filters through URL
> state, submits a validated edit, and shows a field error without losing input.
> An unauthorized direct RPC request cannot perform the edit.

| Criterion | Evidence and scope | Result |
| --- | --- | --- |
| Typed server query and URL-state filters | [DataTable fixture](../packages/cossack/tests/fixtures/data-table-acceptance.js) uses `server$`, an authored result type and `defineUrlState`; [generated runtime test](../packages/cossack/tests/generated-runtime-build.test.js) runs its Node and Cloudflare cases and checks browser URL changes, filtered results and failure recovery. | Proven for generated apps; the DataTable fixture is not protected. |
| Validated edit with field errors and preserved input | The generated runtime test's mutation/resource browser case checks server validation, argument snapshots, failed input, retry/reset and pending controls. The [form fixture](../packages/cossack/tests/fixtures/auth-forms-acceptance.js) separately checks generated authenticated forms. | Proven separately from the typed URL-filtered resource. |
| Unauthorized direct RPC leaves the edit unapplied | [Policy fixture](../packages/cossack/tests/fixtures/worker-policy-acceptance.js), composed by [RPC fixture](../packages/cossack/tests/fixtures/worker-rpc-acceptance.js), checks HTTP/SSE component/service calls, forged permissions, anonymous/foreign owners and tenants, validation rejection, unchanged database rows and empty mutation audit on denial. | Proven for the native policy fixture, not the same DataTable/mutation page. |
| All features on one protected resource page | [Installed fixture](../packages/cossack/tests/fixtures/protected-resource-scenario.js) and [test](../packages/cossack/tests/protected-resource-scenario.test.js) compose the typed resource, URL filters, validated edit and anonymous replay against the same page/D1 rows. Actual Chromium retains invalid input/field error; the successful edit produces exactly one effect; forged anonymous replay leaves rows/effects unchanged. | Proven together on local workerd/D1/Chromium using current installed tarballs and a server-owned synthetic cookie identity. No real identity-provider claim. |

Recorded execution: [mutation browser recipe](./release-0.9.0-verification-archive.md#codex-mutation-browser-recipe-2026-10-03)
reports the combined generated-app/inspection/command suite at 37 passing cases
and full CLI at 553. [DataTable integration](./release-0.9.0-verification-archive.md#codex-data-table-integration-2026-10-04)
records four generated DataTable/URL-state cases across Node and workerd.
[Forms and public types](./release-0.9.0-verification-archive.md#codex-rt10-rt15-rt17-complete-2026-10-05)
record source and installed browser/type checks; their failed preliminary checks
remain separate from repaired results. [Installed/native release acceptance](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06)
retains actual D1/policy/schema/RPC/asset coverage. These records do not assert
that all scenario-1 clauses executed against one protected page. The subsequent
[combined installed acceptance](./release-0.9.0-verification-archive.md#codex-cross-feature-scenarios-123-2026-10-09) now proves that composition; generated app types/build and native owner cleanup also pass.

## 2. Concurrent permitted users across Workers

> Two users in one permitted realtime scope edit concurrently through different
> Workers. State converges, a disconnected caller gets an explicit outcome,
> and another scope receives no private updates.

| Criterion | Evidence and scope | Result |
| --- | --- | --- |
| Different Workers edit concurrently and state converges | [Native SSE integration](../packages/cossack/tests/sse-coordinator-integration.test.js) creates two actual local Worker instances sharing a SQLite Durable Object; six concurrent calls alternate Workers and yield counts 6–11 with final count 11. It also verifies state after reload. | Proven in local native workerd, including an installed Framework run. Workers use fixture markers, not two authenticated users. |
| Another scope remains isolated | That integration initializes a second scope and observes its independent count. [Coordinator transport](../packages/framework/tests/sse-coordinator-transport.test.ts) rejects cross-user keys and revalidates replay/idle authorization; [SSE scope tests](../packages/framework/tests/sse-scope.test.ts) reject other-user/custom-tenant keys. [Auth SSE fixture](../packages/cossack/tests/fixtures/auth-sse-acceptance.js) also observes denied delivery after logout, expiry, scope or permission changes. | Proven native state isolation plus separate framework/authenticated subscription tests. The native count test alone does not prove another scope receives no private updates. |
| Disconnected caller gets an explicit outcome | Native SSE integration covers queued cancellation and pending guard cancellation. Its legacy unbridged-abort case deliberately allows the queued action to run; it does not promise cancellation undoes effects. [RPC conformance matrix](../packages/framework/tests/rpc-conformance-matrix.test.ts) separately covers transport failure/cancellation outcomes. | Proven within those transport cases, not for two authenticated concurrent editors. |
| Complete permitted-user composition | [Installed fixture](../packages/cossack/tests/fixtures/realtime-release-scenario.js) and [test](../packages/cossack/tests/realtime-release-scenario.test.js) run two real Workers sharing a Durable Object. Permitted Alice/Bob identities concurrently edit through distinct Worker markers, both live subscriptions converge, actual TCP abort produces `COSSACK_RPC_CANCELLED`, and a live other-scope observer receives its own positive control without shared private/forged updates. | Proven together through installed public production SSE/RPC on local workerd, with application-owned synthetic sessions. No real login or rollback claim; no browser UI/hosted execution condition added. |

Recorded execution: [installed/native release acceptance](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06)
records native SSE **3/3** and installed `coordinates native RPC callbacks`
**1/1**, with two unrelated cases filtered. [RPC matrix](./release-0.9.0-verification-archive.md#codex-rpc-conformance-matrix-2026-10-03)
records the corresponding shared transport contract proof; [auth SSE acceptance](./release-0.9.0-verification-archive.md#codex-rt11-sse-auth-2026-10-05)
records separate session revocation/subscription behavior. Their individual scopes
do not establish the combined permitted-user/disconnect/observer assertions. The
[subsequent combined native case](./release-0.9.0-verification-archive.md#codex-cross-feature-scenarios-123-2026-10-09) proves those assertions together and verifies app types/build and harness cleanup.

## 3. Action, background retry and notification preferences

> A server action creates a background job and returns. The job retries after
> a transient failure, records delivery state, and respects notification preferences.
> No original request or database handle stays alive for the background job.

| Criterion | Evidence and scope | Result |
| --- | --- | --- |
| HTTP dispatch returns and generated Queue work completes | [Jobs acceptance](../packages/cossack/tests/jobs-release-acceptance.test.js) dispatches through an authored API endpoint, awaits later D1 completion, exercises deduplication/delay and verifies Worker reload with a new boot marker. | Proven request-side server operation returning before asynchronous delivery. The scenario does not specify a decorator; the API entrypoint is not itself a gap. |
| Transient retry and durable state | [Jobs unit tests](../packages/core/tests/jobs.test.ts) verify retry deadlines, attempts, cleanup and terminal deduplication. [D1 ledger tests](../packages/framework/tests/jobs-d1-store.test.ts) exercise actual SQLite SQL and owner fencing. | Proven separately from the generated notification Queue delivery. |
| Preferences and notification delivery state | [Notifications acceptance](../packages/cossack/tests/notifications-release-acceptance.test.js) observes suppression without opt-in, actual local Queue/in-app delivery, persisted inbox state, user/tenant isolation and reload. [Notification unit tests](../packages/core/tests/notifications.test.ts) test opt-out before enqueue and while queued, retryable pre-accept rejection and truthful provider uncertainty. | Proven local native in-app delivery plus separate retry/preferences units. Provider acceptance is not confirmed email delivery. |
| Original request/database handle not retained | Jobs tests reject request retention and non-JSON scope; the public job boundary carries serialized payload/context, and handler cleanup is awaited. The generated endpoint sends payload and explicit IDs, not its request or a database handle. | Proven serialized-boundary validation and separate cleanup assertions. The combined retry/notification flow still needs to preserve that boundary and consumer-owned facility cleanup; no special object-tracking instrument is required. |
| Complete server-operation-to-notification retry flow | [Installed fixture](../packages/cossack/tests/fixtures/background-release-scenario.js) and [test](../packages/cossack/tests/background-release-scenario.test.js) prove response-before-consumer ordering, native transient Queue retry, persisted job/notification outcomes and preferences changed during the retry window. Four native deliveries carry only JSON IDs/context, four per-attempt cleanup receipts complete, and Request/D1/non-JSON scope input rejects. | Proven together on local native Queue/D1 using installed tarballs. Enabled in-app notification delivers on attempt 2; opting out during retry prevents delivery. D1 bindings have no close API; consumer-owned facades release, and request-owned prepared statements are never queued. |

Recorded execution: [SVC-01 proof](./release-0.9.0-verification-archive.md#codex-svc01-svc05-complete-2026-10-05)
records jobs acceptance **1/1 source and installed**; full Core **1,612/102 files**
and framework jobs/config cases **85/4 files** cover their then-current scope.
[SVC-02/03 proof](./release-0.9.0-verification-archive.md#codex-svc02-svc03-complete-2026-10-05)
records notification Queue/D1 **1/1**, loopback SMTP **1/1**, and corresponding
installed runs; final notification units **19/19**. Cloudflare email responses
were injected and SMTP was loopback. No external email delivery is claimed.
The [new combined native retry/preference case](./release-0.9.0-verification-archive.md#codex-cross-feature-scenarios-123-2026-10-09) executes both delivery/opt-out outcomes and serialized-boundary/cleanup assertions; generated bindings, app types/build and native teardown pass.

## 4. Installed inspection, preserved upgrades and CLI/MCP parity

> An agent inspects an installed app, obtains a recipe/upgrade plan, applies
> it without overwriting edited files, and runs structured checks. CLI and MCP
> report the same metadata and diagnostic codes.

| Criterion | Evidence and scope | Result |
| --- | --- | --- |
| Installed app inspection and structured CLI/MCP parity | [Development trace fixture](../packages/cossack/tests/fixtures/development-trace-acceptance.js) invokes installed CLI/MCP entrypoints against installed app facts/traces. [MCP tests](../packages/cossack/tests/mcp.test.js) compare route/check data and diagnostic codes through real stdio protocol, including invalid inputs and interruption. | Proven installed trace/documentation/report parity plus separate structured route/diagnostic parity. No actual AI model execution is necessary to infer tool correctness. |
| Recipe/upgrade plans and preservation of edited files | [Upgrade release tests](../packages/cossack/tests/upgrade-release.test.js) exercise subprocess plans/application, ownership, edited authentication and obsolete files, stale manifests and missing releases. [Upgrade tests](../packages/cossack/tests/upgrade.test.js) explicitly preserve modified files even under force and only replace selected force-file targets. | Proven CLI/scaffold ownership at the recorded subprocess scopes. Most controlled install cases are not registry deployment acceptance; one case uses a real local registry/pnpm tarball. |
| Same installed app completes the entire sequence | [Installed scenario fixture](../packages/cossack/tests/fixtures/agent-release-scenario.js) and [acceptance test](../packages/cossack/tests/agent-release-scenario.test.js) run seven actual CLI commands and real installed MCP stdio against one fresh app using verified tarball dependencies. Inspection, dry-run recipe planning, application preserving an edited scaffold-owned page and baseline hash, valid checks, matching invalid-route diagnostics and recovery all execute. | Proven at installed 0.8.3 scope. MCP stays read-only; application uses CLI. UI rendering is outside this inspection/composition scenario. |

Recorded execution: [complete upgrades](./release-0.9.0-verification-archive.md#codex-cli-upgrades-2026-10-02)
records ten subprocess cases, seven new scaffold ownership cases and full unit
**2,455**. [CLI-07 installed proof](./release-0.9.0-verification-archive.md#codex-cli07-complete-2026-10-04)
records MCP **18**, Framework trace **18/4 files**, generated browser **1** with
33 unrelated cases filtered, and the successful installed `--agent-docs-only`
gate. These historical counts identify scopes, not the current full release total.
The [new installed sequence](./release-0.9.0-verification-archive.md#codex-workflow-lifecycle-agent-scenario-2026-10-09) closes scenario 4 at current implementation versions; final 0.9.0 artifact checks remain required.

## 5. Hosted staging CI, explicit migrations and protected RPC

> CI builds a staging artifact with staging bindings, applies an explicit
> migration plan to the intended test target, tests protected assets and RPC,
> and cleans preview-owned resources. Production resources remain unchanged.

| Criterion | Evidence and scope | Result |
| --- | --- | --- |
| Actual CI builds staging artifact with staging bindings | [Hosted composition runner](../packages/cossack/tests/fixtures/hosted-staging-scenario-ci.js) verifies the manual workflow with bounded acceptance additions, immutable private repository/run identity and retained tarball blobs/lock. The [app script](../packages/cossack/tests/fixtures/hosted-staging-scenario-app.js) invokes public `deploy --dry-run --env staging` and verifies artifact account, D1 UUID and staging mode. | Proven in actual GitHub run 37880536071. This explicit staging build is separate from the preview CLI's build; native preview overrides independently select the same staging D1. |
| Explicit migration plan applied to intended test target | CI invokes installed public `migration plan/up/status/plan --remote --env staging`. It checks exact account, binding and UUID before apply, then verifies the planned checksum in applied history and no pending migrations. | Proven together in hosted CI against fresh staging D1. |
| Protected assets and authenticated RPC tested in CI | Actual preview HTTP checks reject anonymous asset/RPC with 401, verify protected asset contents with authorized 200, and invoke a decorated RPC using actual Cossack hydration. Forged anonymous state leaves zero effects; authorized RPC creates one row, independently read through D1 API. | Proven together in the same hosted preview. Server-owned synthetic cookie identity; no real login claim. |
| Preview-owned resources cleaned | Deployed/cleaned journals preserve exact immutable preview/deployment/tag ownership and independent GET404. Existing staging D1 is retained by preview cleanup; setup-owner teardown then removes its Worker/D1 pair/known DO namespaces and private repository, with separate coordinator absence reads. | Proven, including independent final cleanup. Earlier CF-09 success/failure/retry matrix remains separate valid evidence. |
| Production remains unchanged | Before/after parent settings, active deployment and full D1 schema/sentinel match; staging visits change 0→1 and effects are exactly 1. A separate coordinator read after CI confirms every production fixture row matches its owned bootstrap. | Proven for the owned acceptance parent/production database; no unrelated production resources were touched. |

Recorded execution: [hosted staging composition](./release-0.9.0-verification-archive.md#codex-hosted-staging-scenario-2026-10-09) records actual
run **37880536071**, combined **24 passed / 0 skipped**, root types and independent
teardown. Private receipts remain under /tmp/cossack-hosted-staging-20261009;
its temporary repository and cloud resources are deleted. Initial setup's missing
request-signal flag failed the existing guard and both created databases were
verified deleted before retrying with fresh resources.
The earlier [CF-09 matrix](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09)
retains its three-run failure/retry coverage; it was not repeated unchanged.

## Integration follow-up

Final reconciliation — Codex (2026-10-09): scenarios 1–4 have fresh 0.9.0
installed native/browser/CLI/MCP acceptance in the 11-test combined gate. Scenario
5 retains its actual hosted 24-test proof at 0.8.3; the Worker/CLI/database runtime
payloads it exercised are unchanged. The later database tooling import repair has
fresh CLI, full package, installed guide and generated native migration evidence.
Hosted lifecycle and cleanup are not relabeled as rerun 0.9.0 checks. The
[final archive](./release-0.9.0-verification-archive.md#codex-final-release-acceptance-2026-10-09) and [58-task audit](./release-0.9.0-requirement-audit.md)
record version alignment, payload classification and all release gate outcomes.
REL-03/04/05 are complete; Desktop remains waived and prior identity/process/provider
limitations remain intact.
