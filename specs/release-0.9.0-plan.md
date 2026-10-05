# Cossack 0.9.0 implementation plan

Compacted by Codex on 2026-10-04. Updated on 2026-10-06. The release has 58 tasks: 51 complete and 7 open.
The [release checklist](./release-0.9.0.md) owns completion status and the evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) retains past test results and review limits.
The [handoff](./handoff-0.9.0.md) records current work and continuation instructions.

The completed task index retains all task anchors and archive links. Outcomes are in the checklist.
The [plan archive](./release-0.9.0-plan-archive.md) preserves the previous document,
including historical checkpoints. Open task sections retain their full context.
Historical status statements inside task sections do not override the checklist.

Continue the open work as described in the handoff. All unchecked tasks
remain in scope. Versions stay at 0.8.3 until REL-04.

**Desktop: completed for 0.9.0 by user decision (2026-10-05).** Remaining
Desktop-only platform acceptance is waived for this release; it is not pending
work or evidence of passing those checks. Preserve the verified implementation
and do not reopen Desktop unless requested. Focus on shared framework behavior,
CLI/agent tooling and Cloudflare.

Read [architecture](./architecture.md) before significant changes. Paths below
are relative to the repository root. A package name followed by a source path
means `packages/<name>/src/<path>`. Approach sections describe proposed work,
not a claim that every listed API exists. Preserve the stated behavior goals.
Keep non-route helper modules outside `src/pages`.

## Release intent

Cossack lets application authors write server and browser behavior in one
TypeScript component. The compiler removes server code from the browser bundle.
The framework supplies routing, rendering, remote calls, and request context.
Version 0.9.0 must make these behaviors predictable for humans and coding agents.

An agent must be able to answer these questions from project evidence:

1. Which APIs, routes, services, and runtime capabilities exist in this version?
2. Why does a method execute on the server or browser?
3. Which files and resources will a command change?
4. Which runtime, environment, account, and database will receive those changes?
5. What failed, where did it fail, and which operation can fix it?
6. Which tests prove that the result works through the actual framework?

The target is more than additional decorators. A new feature needs types,
runtime behavior, diagnostics, documentation, scaffold support where applicable,
and tests through its published interface. Existing implementations must be
extended when they already solve part of a task.

## Decisions that apply across tasks

Dependency injection, or DI, supplies services to components. A scope owns those
services and controls their lifetime. A remote procedure call, or RPC, invokes
a server method from a client. Server-sent events, or SSE, carry updates to a
browser. Hydration connects browser behavior to server-rendered HTML. Static
site generation, or SSG, writes public HTML during a build.

- Keep core behavior portable. Put Cloudflare-specific implementations behind
  explicit runtime boundaries. Native `cloudflare:workers` imports cannot enter
  the Node, Deno, or browser runtime graph.
- Keep `auth`, `database`, `core`, and `renderer` independent of the framework.
  Share small structural contracts when middleware must cooperate across packages.
- Reuse compiler metadata for inspection, generated types, catalogs, and tools.
  Do not create separate scanners that disagree with compiled behavior.
- Keep one service for each operation. CLI, Studio, MCP, and developer tools
  must call that service when they expose the same operation.
- Separate planning from mutation. A plan describes intended changes and unknowns.
  It must not create resources, execute seeders, or silently apply migrations.
- Preserve request ownership. An action keeps its auth, locale, DI, ORM, and
  configuration context until its response and cleanup finish.
- Do not replay a mutation after a timeout or disconnect by default. A lost
  response does not prove that the mutation failed before making changes.
- Keep public state, client-only state, secrets, and service ownership distinct.
  Browser hydration and JSON diagnostics must never contain secret values.
- Prefer explicit unsupported-capability errors to silently weaker behavior.
  Process-local state is not durable or distributed state.
- Keep the framework ORM-agnostic. The database package and its recipes are optional.
- Prefer clear API breaks during alpha over several competing APIs for the same job.
  Record every break in the migration guide.

The existing CLI result envelope is
`{ schemaVersion: 1, command, ok, data, diagnostics }`.
Extend its contract deliberately. Preserve one JSON result on stdout and stable
diagnostic codes. Source locations and suggested actions belong in structured
fields, not only in prose that an agent must parse.

## Suggested execution order

These groups list remaining work in dependency order. Completed prerequisites
and the original sequence remain in the [archive](./release-0.9.0-plan-archive.md#suggested-execution-order).
They do not reduce the release scope.
Add focused tests during each group, and run broader gates after integration.

| Group | Main tasks | Result needed before moving on |
| --- | --- | --- |
| 5. Add background application services | SVC-04 | Jobs, schedules, notifications, workflows, and Turnstile have tested adapters. |
| 7. Finish operations | CF-08 and CF-09 | Complete observability and previews using the verified deployment guide and resource plans. |
| 8. Audit and prepare release | REL-02 through REL-05 | Every requirement has evidence and the release artifacts match the source. |

Preserve regression coverage for completed prerequisites while closing the open criteria.

## Completed task index

Reference only; preserve regression coverage. Full criteria and reviews remain
in the archive. The release checklist retains outcomes and verification evidence.

| Task | Completed work and archived context |
| --- | --- |
| <a id="cf-10"></a>CF-10 | [Full original context](./release-0.9.0-plan-archive.md#codex-cf10-completed-2026-10-06); [installed executable guide, compatibility and limits](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06) |
| <a id="cli-08"></a>CLI-08 | [Full context](./release-0.9.0-plan-archive.md#codex-cli08-completed-2026-10-06); [109 guides / 116 examples, acceptance and limits](./release-0.9.0-verification-archive.md#codex-cli08-cf04-complete-2026-10-06) |
| <a id="cf-04"></a>CF-04 | [Full criteria](./release-0.9.0-plan-archive.md#codex-cf04-completed-2026-10-06); [verified selection and unresolved actions](./release-0.9.0-verification-archive.md#codex-cli08-cf04-complete-2026-10-06) |
| <a id="rt-26"></a>RT-26 | [Full criteria](./release-0.9.0-plan-archive.md#codex-rt-26-completed-2026-10-06); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt26-complete-svc04-open-2026-10-06) |
| <a id="rt-01"></a>RT-01 | [Full criteria](./release-0.9.0-plan-archive.md#codex-rt-01-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt01-rt11-complete-2026-10-05) |
| <a id="rt-11"></a>RT-11 | [Full criteria](./release-0.9.0-plan-archive.md#codex-rt-11-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt01-rt11-complete-2026-10-05) |
| <a id="svc-01"></a>SVC-01 | [Full criteria](./release-0.9.0-plan-archive.md#codex-svc-01-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-svc01-svc05-complete-2026-10-05) |
| <a id="svc-02"></a>SVC-02 | [Full criteria](./release-0.9.0-plan-archive.md#codex-svc-02-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-svc02-svc03-complete-2026-10-05) |
| <a id="svc-03"></a>SVC-03 | [Full criteria](./release-0.9.0-plan-archive.md#codex-svc-03-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-svc02-svc03-complete-2026-10-05) |
| <a id="svc-05"></a>SVC-05 | [Full criteria](./release-0.9.0-plan-archive.md#codex-svc-05-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-svc01-svc05-complete-2026-10-05) |
| <a id="rt-10"></a>RT-10 | [Full criteria](./release-0.9.0-plan-archive.md#codex-rt-10-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt10-rt15-rt17-complete-2026-10-05) |
| <a id="rt-15"></a>RT-15 | [Full criteria](./release-0.9.0-plan-archive.md#codex-rt-15-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt10-rt15-rt17-complete-2026-10-05) |
| <a id="rt-17"></a>RT-17 | [Full criteria](./release-0.9.0-plan-archive.md#codex-rt-17-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt10-rt15-rt17-complete-2026-10-05) |
| <a id="rt-16"></a>RT-16 | [Migration and seeder plans](./release-0.9.0-plan-archive.md#codex-rt-16-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt16-rt22-complete-2026-10-05) |
| <a id="rt-22"></a>RT-22 | [Markdown metadata and localized output](./release-0.9.0-plan-archive.md#codex-rt-22-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt16-rt22-complete-2026-10-05) |
| <a id="rt-24"></a>RT-24 | [Inferred configuration and required bindings](./release-0.9.0-plan-archive.md#codex-rt-24-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt20-rt24-complete-2026-10-05) |
| <a id="rt-20"></a>RT-20 | [SSR and hydration diagnostics](./release-0.9.0-plan-archive.md#codex-rt-20-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt20-rt24-complete-2026-10-05) |
| <a id="cli-01"></a>CLI-01 | [Lifecycle flags, help, and creation dry runs](./release-0.9.0-plan-archive.md#cli-01) |
| <a id="cli-02"></a>CLI-02 | [Consistent command validation](./release-0.9.0-plan-archive.md#cli-02) |
| <a id="cli-03"></a>CLI-03 | [JSON diagnostics and noninteractive execution](./release-0.9.0-plan-archive.md#cli-03) |
| <a id="cli-04"></a>CLI-04 | [Inspect, check, and explain project behavior](./release-0.9.0-plan-archive.md#cli-04) |
| <a id="cli-05"></a>CLI-05 | [Complete application recipes](./release-0.9.0-plan-archive.md#cli-05) |
| <a id="cli-06"></a>CLI-06 | [Structured upgrades](./release-0.9.0-plan-archive.md#cli-06) |
| <a id="cli-07"></a>CLI-07 | [Shared local MCP tools and installed acceptance](./release-0.9.0-plan-archive.md#codex-cli07-final-plan-2026-10-04) |
| <a id="rt-12"></a>RT-12 | [DI errors, ownership, and cleanup](./release-0.9.0-plan-archive.md#codex-rt-12-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt12-rt27-complete-2026-10-05) |
| <a id="rt-27"></a>RT-27 | [Localization tooling](./release-0.9.0-plan-archive.md#codex-rt-27-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt12-rt27-complete-2026-10-05) |
| <a id="rt-21"></a>RT-21 | [SSG diagnostics and compatibility](./release-0.9.0-plan-archive.md#codex-rt-21-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt21-rt29-complete-2026-10-05) |
| <a id="rt-29"></a>RT-29 | [Framework-faithful test utilities](./release-0.9.0-plan-archive.md#codex-rt-29-completed-2026-10-05); [verified acceptance](./release-0.9.0-verification-archive.md#codex-rt21-rt29-complete-2026-10-05) |
| <a id="rt-02"></a>RT-02 | [Validated server actions](./release-0.9.0-plan-archive.md#rt-02) |
| <a id="rt-03"></a>RT-03 | [Observable server resources](./release-0.9.0-plan-archive.md#rt-03) |
| <a id="rt-04"></a>RT-04 | [State, store, and computed diagnostics](./release-0.9.0-plan-archive.md#rt-04) |
| <a id="rt-05"></a>RT-05 | [Typed tasks and stale-work cancellation](./release-0.9.0-plan-archive.md#rt-05) |
| <a id="rt-06"></a>RT-06 | [Optimistic updates and rollback](./release-0.9.0-plan-archive.md#rt-06) |
| <a id="rt-07"></a>RT-07 | [Typed routes and effective route metadata](./release-0.9.0-plan-archive.md#rt-07) |
| <a id="rt-08"></a>RT-08 | [Typed URL state](./release-0.9.0-plan-archive.md#rt-08) |
| <a id="rt-09"></a>RT-09 | [Navigation completion and diagnostics](./release-0.9.0-plan-archive.md#rt-09) |
| <a id="rt-13"></a>RT-13 | [Shared credentials/sessions, safe diagnostics and atomic OAuth state](./release-0.9.0-plan-archive.md#codex-rt13-final-plan-2026-10-05) |
| <a id="rt-14"></a>RT-14 | [Resource authorization policies](./release-0.9.0-plan-archive.md#rt-14) |
| <a id="rt-18"></a>RT-18 | [Cache and rate-limit contracts](./release-0.9.0-plan-archive.md#rt-18) |
| <a id="rt-19"></a>RT-19 | [Realtime lifecycle and recovery](./release-0.9.0-plan-archive.md#rt-19) |
| <a id="rt-23"></a>RT-23 | [DataTable, native UI contracts and installed accessibility guidance](./release-0.9.0-plan-archive.md#codex-rt23-final-plan-2026-10-04) |
| <a id="rt-25"></a>RT-25 | [Runtime capability checks](./release-0.9.0-plan-archive.md#rt-25) |
| <a id="rt-28"></a>RT-28 | [Devtools snapshots, correlated traces and native runtime acceptance](./release-0.9.0-plan-archive.md#codex-rt28-final-plan-2026-10-04) |
| <a id="cf-01"></a>CF-01 | [Full criteria](./release-0.9.0-plan-archive.md#codex-cf-01-compacted-2026-10-05); [verified acceptance](./release-0.9.0.md#codex-cf-targets-complete-2026-10-05) |
| <a id="cf-02"></a>CF-02 | [Full criteria](./release-0.9.0-plan-archive.md#codex-cf-02-compacted-2026-10-05); [verified acceptance](./release-0.9.0.md#codex-cf-targets-complete-2026-10-05) |
| <a id="cf-03"></a>CF-03 | [Secrets, placeholders, and binding types](./release-0.9.0-plan-archive.md#cf-03) |
| <a id="cf-05"></a>CF-05 | [Distributed SSE coordination](./release-0.9.0-plan-archive.md#cf-05) |
| <a id="cf-06"></a>CF-06 | [Built-artifact runtime tests](./release-0.9.0-plan-archive.md#cf-06) |
| <a id="cf-07"></a>CF-07 | [Public-only SSG and protected assets](./release-0.9.0-plan-archive.md#cf-07) |
| <a id="cf-11"></a>CF-11 | [Tracked credential removal](./release-0.9.0-plan-archive.md#cf-11) |
| <a id="rel-01"></a>REL-01 | [Reported regressions](./release-0.9.0-plan-archive.md#rel-01) |

## New application services

These are application features, not replacements for component lifecycle tasks.
Each feature needs a portable contract and explicit provider support. A local
test adapter must not be described as durable production infrastructure.

<a id="svc-04"></a>
### SVC-04: Durable multi-step workflows

Codex status (2026-10-06): partial implementation is source-verified. Native
creation and completed/retried steps work; the strict waiting-status assertion
fails because pinned Miniflare reports running at its event barrier and never
assigns Waiting. Interruption/resume/event completion, native failure and installed
Workflow acceptance remain unproven. Do not replace waiting with running to close
the task. Preserve the two batch-owned uncommitted acceptance fixtures. Continue
independent open tasks until native provider waiting-state support or equivalent
real provider evidence is available. [Evidence](./release-0.9.0-verification-archive.md#codex-rt26-complete-svc04-open-2026-10-06).

Purpose: Some processes must pause, resume, and retry individual steps across
requests or restarts. A long async function inside an RPC response cannot provide
that execution model.

Baseline: Open. This task integrates durable workflow infrastructure.

Approach: Supply typed workflow input, identity, invocation, status, events, and
inspection around Cloudflare Workflows. Keep step persistence, waits, and retries
aligned with the provider's actual execution rules. Generate binding/entry setup
and provide local deterministic tests. Reuse job/notification operations where
appropriate. Make step side-effect and idempotency requirements explicit.

Start with runtime capability contracts and scaffold generation. Keep the native
Cloudflare entry separate from core. Do not build a competing workflow engine
or claim parity for runtimes without a configured durable provider.

Done when: A workflow survives interruption between steps, resumes without
repeating completed work incorrectly, and reports failures and waiting state.
Tests cover an external event and a failed retried step. Dependencies: SVC-01,
RT-24, RT-25, CF-04, and CF-08.

## Cloudflare development and deployment

The Cloudflare goal is one coherent development-to-deployment path. Environment
selection must remain consistent through types, build, static rendering,
database tooling, and deployment. Local validation must distinguish itself from
checks that require authenticated access to real resources.

<a id="cf-08"></a>
### CF-08: Production logs and build budgets

Codex primary receipt identity hardening (2026-10-05): local startup receipts
must identify the external runtime that produced the profile. The private bounded
inventory now resolves Miniflare from Wrangler, workerd from Miniflare, and binds
manifests, loaders, native executable contents and runtime overrides/autogates.
Bare/relative executable overrides and unsupported downloaded fallbacks decline
reuse. Directory membership and redirect reads are bounded. This checkpoint
retains the primary-only receipt contract and fresh-measurement fallback.
See [verification](./release-0.9.0-verification-archive.md#codex-runtime-receipt-identity-2026-10-05).

Deferred CF-08 implementation context (not the next batch): authenticated aggregate receipts. One atomic receipt must
cover the primary Worker and every selected auxiliary policy, with independent
source snapshots, selected environment, complete redirect membership, settings,
tool/runtime identities and ordered artifact inventories. Compute identity before
all measurements and again after all results; never sign a partial prefix.
Initially require auxiliary policies to cover every auxiliary redirect entry;
unselected Workers must decline reuse rather than leave incomplete graph evidence.
Keep the primary artifact bound even when only auxiliary limits are configured.
Store only numeric values and fixed measured/failed outcomes, then reconstruct public
diagnostics from current policies. A successful build may reuse only a complete
matching receipt; missing/unsupported identities require fresh measurement. A
failed build may report budget failures only from a complete authenticated failing
receipt, without running tools again; passing receipts must not disguise unrelated
build failures. Integrate shared APIs, Vite, CLI build/deploy and installed helpers
under coordinator ownership; independent agents can own bounded tests after the
API is fixed. Verify two auxiliary targets, auxiliary-only settings, stale source,
redirect/module/tool/runtime mutations, malformed/partial receipts, private values
and native single-measurement reuse. Auxiliary upload remains a separate task.


Codex direct-Vite dependency audit (2026-10-05), read-only: retain cossackConfig's
preflight order. A separate post plugin must run after Cloudflare's final buildApp
hook, verify built environments and fresh selected-target artifacts, then measure.
Vite build() bypasses buildApp hooks; acceptance must use createBuilder().buildApp()
or the installed CLI. Shared Node-only budget code belongs in framework, consumed
by CLI, never a reverse framework-to-CLI dependency. Reuse strict artifact
verification. Avoid duplicate measurements with a receipt bound to settings,
environment and artifact fingerprint; clear stale receipts before building.
Define primary versus auxiliary Worker scope. Custom builders that leave outputs
unfinished must fail closed. This audit changed no runtime code and ran no tests;
the implementation checkpoints below supersede its audit-only status. CLI receipt
and default scaffold integration are now verified coordinator-owned work.


Codex opt-in direct Vite implementation (2026-10-05): `cossackBuildBudgets()`
now runs after Cloudflare's application build, validates completed Worker
environments and fresh primary-target artifacts, then measures the installed
Wrangler dry-run summary privately. Node-only budget and artifact modules are
shared by framework and CLI; framework never depends on CLI. Real staging builds
exposed and fixed ambient environment selection being applied twice to built
configs. Explicit empty environment now means inspect/measure the already-built
target. Primary Worker scope is documented; auxiliary Workers need separate
future policies. See the [verification checkpoint](./release-0.9.0-verification-archive.md#codex-direct-vite-budgets-2026-10-05).

Codex receipt/default scaffold integration (2026-10-05): implemented a fresh
UUID signing key per CLI build, never persisted. Private atomic receipts contain
only safe metrics and HMAC-bound invocation/settings/environment/fingerprint
metadata. Fingerprints cover all files in supported no-bundle Worker output,
redirect configuration, Wrangler manifest/entry/bin and Node version, with
before/after content and metadata checks. Current manifest limits are rechecked
after building. Unsupported graphs (including auxiliary Workers, symlinks,
external modules, custom builds and rebundling), or bounded inventory overflow,
fall back to a fresh measurement after successful builds. Failed builds are
never freshly measured or excused by passing receipts. Valid failing receipts
preserve structured budget diagnostics and truthful failed build-step status.
New Cloudflare projects include the post plugin; non-Cloudflare recipes strip it.

Acceptance verified: stale invocation/environment/settings, corruption/tampering,
module/config/redirect/tool changes, changes during measurement, unsafe storage,
unsupported graphs, private persistence, unrelated failed builds, fallback and
native build/deploy single-measurement reuse. Framework 1,736 tests, affected CLI 56 tests,
final native integration 3 tests and 91 scaffold cases pass; 9 Desktop cases
were skipped. Root/framework typechecks, declarations and fresh Cloudflare
installed-package gate pass (`/tmp/cossack-local-pack-gZdSQv`). This proves new
published exports, default composition and selected-target signed diagnostics
with Vite 8.3.2 / Wrangler 4.147.0; broader REL-03 acceptance remains. See the
[verification record](./release-0.9.0-verification-archive.md#codex-budget-receipts-2026-10-05).

Codex custom-source/watch integration (2026-10-05): the shared selector now
honors explicit `configPath`, then `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`, then
root defaults, matching Cloudflare's plugin order. Explicit paths are available
on `cossackConfig`, `cossackPages` and `cossackBuildBudgets`; declaration and page
binding checks use the selected file. CLI inspection uses the environment path,
which also reaches Wrangler type generation and Vite. Missing selected files
cannot silently fall back. Native nested-config and explicit plugin composition
acceptance passes after repairing the page binding reader uncovered by the first
run. Framework 1,757 tests, affected CLI 60 tests, root/framework types and
emitted declarations pass. See the [verification record](./release-0.9.0-verification-archive.md#codex-custom-config-watch-2026-10-05).

Installed acceptance exposed another DX gap: direct CLI build depended on vite
being in the caller's PATH. Build now resolves the project-installed Vite for
captured and human paths; both unbudgeted modes have regressions. Final affected
CLI total is 60; native build/deploy receipts remain verified.

SSG review also found its sync URL discovery still selecting root files. It now
shares the source candidate helper; getSiteUrl/cossackSsg support explicit paths.
JSONC/TOML regressions prove selected environment URLs and no root fallback for
missing selected sources. Final full framework total is 1,757.

Final repacked framework/CLI acceptance passes in the retained installed fixture
with Vite 8.3.2 / Wrangler 4.147.0: custom-path CLI receipts, explicit Vite options,
published SSG URL discovery and prompt native watch rejection/privacy. The helper
is included in future Cloudflare tarball gates. This focused final-package update
is not a rerun of the full gate or REL-03 runtime matrix.

Watch policy: configured budgets reject root or environment build.watch before
output/measurement, and recheck custom builder options in buildApp. Installed
Vite returns watchers before output completion and does not rerun buildApp for
each generation. This is explicit unsupported behavior, not successful watch
budget acceptance. Supporting future watch measurement requires synchronized
Worker/client generation completion and fresh receipts per generation. Ordinary
DEV and builds without budgets get no new watch restriction.

Remaining: auxiliary Worker budget policies and wider module graphs. The receipt's
4,096-file/64-MiB inventory cap is a conservative reuse bound, not a provider
limit; failing to fingerprint never weakens budget enforcement.
Local/provider startup costs, native development fault acceptance, remote logs
and deployed source-map resolution retain their full original criteria.

Purpose: An operator needs to connect a production error to a route and action.
Builds also need to reveal oversized bundles or startup regressions before upload.

Baseline: RPC request IDs and some error logging exist. A complete production
logging, source-map, and budget workflow remains open.

Approach: Add structured logs with request/action IDs, route identity, duration,
runtime, and redacted failure codes. Generate observability configuration with
explicit sampling defaults. Preserve source maps for server diagnosis through
the supported deployment path. Measure bundle and startup costs from actual
artifacts. Define project-configurable warning/error budgets using current
provider limits rather than hardcoded assumptions from old documentation.

Start in framework logging/request middleware and RPC handlers, scaffold Worker
configuration, CLI build/deploy orchestration, and RT-28 event contracts.

Done when: A failed action can be located from its returned request ID. Logs
exclude credentials and full sensitive payloads. A deliberate budget regression
fails with the measured value and limit. Source maps resolve a production fixture
stack to authored code. Dependencies: RT-01, RT-24, and CF-06.

Codex checkpoint (2026-10-05): HTTP component and layout-service RPC failures
now emit structured events with request ID, bounded route/action/runtime labels,
elapsed time, stage and a fixed failure code. Stream and cleanup failures use the
same redacted shape. The shared framework matrix checks action and stream events
against caller-visible IDs and confirms that exception text stays out of logs.
The local harness does not prove Cloudflare Workers Logs ingestion. Production
source-map resolution, configurable artifact/startup budgets, full framework log
review and native Worker log acceptance remain open. See the [verification
checkpoint](./release-0.9.0.md#codex-cf08-rpc-logging-2026-10-05).

Codex HTTP/SSR checkpoint (2026-10-05): native/class API, SSR rendering and
router cleanup catches now emit fixed metadata without arbitrary exceptions.
Unhandled configuration/middleware failures use a safe Hono error handler.
Caller-visible UUIDs correlate with logs; authored templates omit concrete paths
and query values, and unknown methods are not retained as labels. The shared
scope helper validates IDs and API failures restore a modified response header.
Global fallback duration covers failure handling only, not the original request.
Source regressions and installed workerd check emission/redaction. Remaining:
core lifecycle/WebSocket and adapter logs, manifest/SSG/access logger review,
development SSR detail policy, whole-request timing, remote Workers Logs
acceptance, source-map resolution and configurable budgets. CF-08 stays open.
See [server logging contract](../docs/server-logging.md).

Codex core/Node checkpoint (2026-10-05): core action/task/cleanup, service
rollback/disposal, Durable Object parse/delivery and Node transport catches now
omit raw exceptions. Shared dispatch omits incoming target/action labels.
Synthetic or hostile request metadata cannot change teardown behavior. This
completes the bounded redaction slice, not CF-08: component update, Deno and
framework loader/SSG/access logs, DEV SSR detail policy, timing, remote ingestion,
source maps and budgets remain. See the [verification checkpoint](./release-0.9.0-verification-archive.md#codex-core-node-redaction-2026-10-05).

Codex framework/Deno checkpoint (2026-10-05): development SSR fallback pages,
access logs, router loaders/state, SSG failures and core update catches now omit
arbitrary exceptions and concrete request URLs. Deno runtime/development catches
emit fixed events. Managed failures measure duration from request-context entry.
Remaining criteria: Deno Vite trusted compiler-channel review, native fault
acceptance, remote ingestion, production source maps and build/startup budgets.
See [verification](./release-0.9.0-verification-archive.md#codex-framework-deno-redaction-2026-10-05).

Codex budget/Deno transport checkpoint (2026-10-05): CLI build/deploy now
share literal project warning/error size budgets measured by local Wrangler
against validated fresh Cloudflare artifacts, with explicit .01 KiB precision
and conservative rounding. Arbitrary tool output is private/bounded. Provider
startup is unavailable locally; configured hard startup budgets fail. Deno Vite
caught errors no longer leak into console or public middleware; private compiler
results are preserved. Remaining criteria: direct Vite budgets, local/provider
startup, native development faults, source-map resolution and remote logs. See
[checkpoint](./release-0.9.0-verification-archive.md#codex-cf08-budgets-deno-transport-2026-10-05)
and [budget contract](../docs/build-budgets.md).

<a id="cf-09"></a>
### CF-09: Preview and CI resource lifecycle

Purpose: Branch tests need production-like behavior without modifying production
data. A preview URL identifies code but does not establish resource isolation.

Baseline: Deployment docs explain separate resources and rollback limits.
Automated preview creation, smoke checks, cleanup, and promotion remain open.

Approach: Plan code and bound resources together. Identify which D1, KV, R2,
Durable Object, Queue, Workflow, and service bindings are isolated or shared.
Use native Worker Previews only after upgrading and testing the pinned tooling.
The checkpoint resolves Wrangler 4.114.0. The documented native preview minimum
is 4.135.0. Retrieve current limitations before implementation.
Track resource ownership so cleanup deletes only preview-owned resources.
Define an explicit production build/promotion process and migration order.

Start in CLI deployment services, scaffold CI templates, and CF-04 resource plans.
Use [Cloudflare preview documentation](https://developers.cloudflare.com/workers/previews/)
and [rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

Done when: CI creates a preview, runs smoke tests, and cleans its owned resources
without changing production. Failures leave inspectable state and cleanup can
be retried. Code rollback does not claim to restore database or object data.
Dependencies: CF-01, CF-02, CF-04, CF-06, and CF-10.

## Release gates

These tasks establish release readiness after implementation. A passing narrow
test is evidence for its behavior only. It does not close unrelated features
or the final release audit.

<a id="rel-02"></a>
### REL-02: Executable docs and published packages

Purpose: Repository aliases and workspace links can hide missing exports,
undeclared dependencies, and broken examples. A user installs package artifacts,
not the repository source tree.

Baseline: Several package-contract and generated-app tests exist. The full
tarball/runtime/recipe matrix and executable documentation coverage remain open.

**Codex verified batch (2026-10-06).** Installed coverage now proves 200 concrete
export targets, 74 Node imports, strict Bundler/NodeNext declaration imports,
representative generated compositions, and fresh native D1 migration/model
acceptance. Templates now declare authoritative operations; existing applied
callback migration histories still reject changed checksums. Native Workflow
lifecycle and the remaining final artifact/runtime matrix keep REL-02 open.
[Evidence and limits](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06).

Approach: Pack packages into a temporary local artifact set. Install them into
fresh generated applications without workspace path aliases. Compile documented
imports and examples. Build relevant presets for Cloudflare, Node, Deno, and
Desktop. Exercise optional feature combinations and server-code stripping.
Keep the matrix representative and document why each fixture exists.

Start in `scripts/test-local-scaffold.mjs`, package exports/files declarations,
scaffold tests, and examples from CLI-05 and CLI-08.

Done when: Runtime imports and declaration imports resolve from tarballs alone.
No demo-only module or missing dependency is required accidentally. Published
test helpers and new provider entries work. Documentation examples use only
the final public APIs. Dependencies: all API-changing tasks and RT-29.

<a id="rel-03"></a>
### REL-03: Complete verification run

Codex type-verification repair (2026-10-05): package checks exposed a real
RawInputOf defect: InputSchema's default raw type was unknown for noncoercing
string, enum and file fields. Raw now defaults to Output; coercing schemas retain
their explicit incoming types. Published declarations reject invalid raw nested
strings, enums, file arrays and optional nulls. Typed config now permits whole
objects and nested subtrees with inferred shapes while rejecting unknown paths.
Locale uses inferred config access; optional CORS reads remain internal without
loosening application config overloads. Test fixture types are repaired without
removing runtime assertions. Acceptance evidence and limits are in the
[verification checkpoint](./release-0.9.0-verification-archive.md#codex-package-type-repair-2026-10-05).
RT-10's completed acceptance is archived; the full REL-03 gate remains open.


Purpose: Integration changes need a reproducible release gate. A historical
green run cannot prove that later API or configuration changes are correct.

Baseline: At `e5dbae4`, build, root TypeScript, all 11 package type checks,
database bundle audit, and 2,125 tests passed. Playwright and the complete
published-tarball matrix were not run for that checkpoint.

Approach: Build dependencies first. Run `pnpm tsc --noEmit`, `pnpm typecheck`,
`pnpm audit:bundle`, `pnpm test:unit`, relevant Playwright suites, and generated
artifact tests. Include the test-utils suite after RT-29. Do not run type checks
while another command deletes dependency declarations. Record exact commands,
counts, failures, and unavailable external checks.

Start in root scripts and package test/build scripts. Fix meaningful failures
instead of changing assertions only to preserve a green gate.

Done when: Required suites pass on the final implementation and package versions.
Runtime/browser gates cover the changed features. Missing external evidence
remains explicitly open. A source-only prototype test cannot substitute for a
published application test. Dependencies: REL-02 and completed feature work.

**Completed runtime checkpoints — Codex (2026-10-04).** Generated and installed
Node development and Deno production/development pass their recorded browser,
CLI lifecycle and trace checks. See the [runtime evidence index](./release-0.9.0-plan-archive.md#codex-handoff-references-2026-10-06)
and [archived implementation context](./release-0.9.0-plan-archive.md#codex-runtime-progress-2026-10-04).
`pnpm test:deno` owns the repeatable native Deno gate.

Remaining: generated Deno server shutdown/draining, Deno Deploy and the required
non-Desktop final release matrix. Node standalone draining is verified in the
[Codex batch](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06). The initial full CLI run failed; all 19 failures
now have passing targeted evidence, and initially skipped Deno cases executed.
This composite evidence is not a second green full-suite run. Desktop development and native Linux checks
pass the [RT-28 audit](./release-0.9.0.md#codex-rt28-complete-2026-10-04).
The user has marked Desktop complete for this release. Remaining installed OS
integration, Windows/macOS and signing acceptance is waived, not claimed as tested.
Retain `pnpm test:desktop` for any future requested Desktop changes; do not reopen
Desktop work or repeat its gate for unrelated work.

<a id="rel-04"></a>
### REL-04: Versioning and release documents

Purpose: A release must present one consistent version and explain intentional
API changes. Users need a migration path from 0.8.x.

Baseline: All package versions remain 0.8.3. The release is not ready to bump.

Approach: After implementation gates pass, use the repository bump process to
set release packages and internal ranges to 0.9.0. Update the lockfile and
generated template version references. Write a changelog, migration guide, and
release notes around final behavior. Include breaking RPC rejection semantics,
runtime/binding requirements, removed APIs, configuration changes, and replacement
examples. Rebuild and repeat affected package/install gates after the bump.

Start in `scripts/bump.mjs`, package manifests, scaffold generation, and release
documentation conventions already present in the repository.

Done when: All intended release artifacts agree on version and dependencies.
The migration guide compiles and describes real final APIs. Pack/install tests
do not retain stale 0.8.x references. Release preparation remains distinct from
an actual package publication or Cloudflare deployment. Dependencies: REL-02 and REL-03.

<a id="rel-05"></a>
### REL-05: Requirement-by-requirement completion audit

Purpose: A large refactor can appear finished while entire checklist rows remain
partially implemented. Completion needs evidence for each requirement.

Baseline: Open. The 0.9.0 objective remains unfinished.

Approach: For every task ID, record the final public API, implementation files,
tests, documentation, and relevant generated-app/runtime evidence. Compare actual
behavior with the Purpose and Done when sections here. Record unsupported
capabilities and external dependencies honestly. Revisit broader rows whose first
subfeature passed earlier. Do not reduce their scope to that subfeature.

Start with all 58 linked checklist rows and the final diff since `e5dbae4`.
Use the later Codex review to challenge completion claims and inspect important
concurrency, auth, serialization, and runtime-boundary changes.

Done when: Every explicit requirement is implemented and proven at the required
scope. There are no unchecked obligations hidden behind green unit tests or
release notes. If evidence is missing, keep the item open and state the next
test or implementation step. Depends on every other release task.

## Cross-feature acceptance scenarios

These scenarios connect features that can otherwise pass in isolation.
They supplement each task's tests. They do not introduce separate product scope.

1. A protected resource page loads a typed server query, filters through URL
   state, submits a validated edit, and shows a field error without losing input.
   An unauthorized direct RPC request cannot perform the edit.
2. Two users in one permitted realtime scope edit concurrently through different
   Workers. State converges, a disconnected caller gets an explicit outcome,
   and another scope receives no private updates.
3. A server action creates a background job and returns. The job retries after
   a transient failure, records delivery state, and respects notification preferences.
   No original request or database handle stays alive for the background job.
4. An agent inspects an installed app, obtains a recipe/upgrade plan, applies
   it without overwriting edited files, and runs structured checks. CLI and MCP
   report the same metadata and diagnostic codes.
5. CI builds a staging artifact with staging bindings, applies an explicit
   migration plan to the intended test target, tests protected assets and RPC,
   and cleans preview-owned resources. Production resources remain unchanged.

## How Codex records progress

For each implementation slice, record the task IDs and the actual behavior changed.
Record unresolved design choices before publishing an API. Keep the explanation
short enough that the next agent can distinguish a decision from an experiment.

Use this record shape in the verification log or a linked implementation note:

```text
Tasks: RT-01, CF-05
Behavior completed:
Public API and compatibility changes:
Implementation files:
Tests and observed results:
Generated-app or runtime evidence:
Remaining work and known limits:
```

Update completion boxes only when the complete row meets its acceptance criteria.
Keep prototype status visible until the published application path uses the feature.
Preserve unrelated user files, including the uncommitted reports and tool settings.
Use the final review to audit implementation commits against this plan and its checkpoints.

<a id="codex-local-startup-plan-2026-10-05"></a>
### Codex: local startup budgets and auxiliary Worker follow-up (2026-10-05)

CF-08 local startup slice: add explicit `localStartupProfileMs` and
`localStartupActiveMs` project thresholds. The first measures the local CPU
profile window; the second sums non-idle samples, including GC. These names must
stay distinct from provider startup. Use the verified fresh primary artifact,
private Wrangler multipart/profile files, bounded subprocesses and fixed errors.
Only numeric results enter JSON and signed invocation receipts. Acceptance covers
native profiling, deliberate threshold failure, receipt reuse, privacy, cleanup,
malformed/oversized files and hung tools. Remote provider evidence stays open.

The independent auxiliary Worker audit found that current deployment selects
and uploads only the primary Worker. Do not claim auxiliary deployment support.
A future bounded phase should define literal per-source policies, independently
inspect each authored source/environment, match exactly one fresh auxiliary
redirect artifact, and validate all selected artifacts before measurement and
again before primary upload. Reject duplicate or ambiguous matches and unsupported
inline overrides. Prerender/dev-only Workers are excluded. Auxiliary-only budgets
must activate validation. Keep receipt reuse disabled for auxiliary redirects
until every target, graph and policy is authenticated. Actual auxiliary upload
orchestration is a separate feature; the existing primary deploy command cannot
prove that those Workers are deployed. No auxiliary API is implemented here.

Counts remain 30 complete / 28 open. CF-08, remote startup/source-map/log
acceptance and REL-03 remain open. Desktop checks remain waived.

Codex acceptance for this slice: full framework 1,808 / 98 files, final combined
affected CLI 63 / 6 files, root/framework types, declarations, native profiling
and repacked installed acceptance pass. Initial framework timeout failures and
unrun platform/remote/full-matrix checks are preserved in the
[verification record](./release-0.9.0-verification-archive.md#codex-local-startup-2026-10-05).

<a id="codex-auxiliary-budget-plan-2026-10-05"></a>
### Codex: auxiliary budget implementation and next phase (2026-10-05)

Goal: budget each explicitly selected auxiliary Worker using its own authored
source/environment, even when the primary Worker has no limits. Read literal
`cossack.auxiliaryBuildBudgets` entries without executing project config; share
metric/limit validation with primary budgets. Give each target an independent
source snapshot before building. After all server environments finish, require
exactly one matching fresh auxiliary redirect artifact for each source. Reject
missing/duplicate/ambiguous entries and primary/prerender reuse. Validate all
selected targets before any tool measurement and recheck sources/policies/configs
after measurement and before primary upload or dry-run success.

Completed implementation: framework owns the Node-only reader/verifier and the
CLI/Vite gate share it. JSON reports per-source safe measurements. Validation is
bounded to 32 policies/redirect entries and 1 MiB regular project configuration
files. Binding/deployment fields are compared using project-installed Wrangler
normalization. D1 migration directories/patterns and empty Cron arrays need
explicit canonicalization because Vite rewrites them. The native multi-Worker
acceptance initially exposed the Cron default mismatch; it was repaired, then
warning/deploy-dry-run and deliberate hard-limit cases passed. Final coordinator
review also added a regression for source mutation during primary measurement.

Limits and next steps: keep signed receipt reuse disabled for auxiliary redirects.
A future authenticated multi-target receipt must bind every policy, source target,
artifact/module inventory, environment and tool identity. Then failed builds can
return precise auxiliary budget diagnostics and successful CLI commands can avoid
repeated plugin measurement. Do not reuse primary-only signed status to classify
an auxiliary failure. Wider graphs and source-entry correspondence need separate
acceptance; configuration comparison does not authenticate all compiled code.
Actual auxiliary upload orchestration is separate work: current deploy uploads
only the primary Worker. Native provider startup, DEV faults, production source
maps and remote logs remain open. No parent task closes; 30 complete / 28 open.
Desktop remains complete and its remaining platform checks remain waived.

Final Codex acceptance for this phase: framework 1,874 / 101 files, affected CLI
65 / 6 files, root/framework types, declarations and repacked auxiliary plus
primary startup/custom-config installed checks pass. Failed Cron attempts and the
final dry-run repair are preserved in the
[verification record](./release-0.9.0-verification-archive.md#codex-auxiliary-budgets-2026-10-05).
The full CLI suite and non-Desktop release matrix remain REL-03 work.

<a id="codex-svc02-svc03-complete-2026-10-05"></a>
## Codex: Schedules and notifications completed (2026-10-05)

SVC-02 and SVC-03 meet their full archived criteria. Generated and installed
Cron/Queue/D1 execution, duplicate identity, cleanup and invalid-definition
rejection pass. Typed escaped notifications compose preferences, durable fenced
state, jobs, Cloudflare email and existing Node SMTP. Tests prove isolation,
preference changes, rejection retry and uncertain-send restart without blind
resending. Four matching installed guides pass strict compilation and execution.
[Commands and limits](./release-0.9.0-verification-archive.md#codex-svc02-svc03-complete-2026-10-05).
Release: **45 complete / 13 open**. SVC-04 and broader runtime, Cloudflare and
release gates remain open; no batch blocker. Desktop remains waived and versions
stay 0.8.3 until REL-04.


<a id="codex-rt01-rt11-complete-2026-10-05"></a>
## Codex: RPC and session acceptance completed (2026-10-05)

RT-01 and RT-11 are complete against their archived full criteria. Native Node
and direct workerd pre-header TCP resets prove component/service abort and cleanup.
Durable Object readiness, failed-owner cleanup, reciprocal close, real eviction
and concurrent restoration pass; final installed Core proves the changed runtime.
Native/installed SQLite and D1 prove documented session write, rotation, flash,
revocation and anonymous-upgrade semantics. Prior transport/type, generated auth,
safe old-input, cookie/failure and realtime evidence remains required and linked
in the [criterion audit](./release-0.9.0-verification-archive.md#codex-rt01-rt11-complete-2026-10-05).
**47 complete / 11 open**. Next assess RT-26 and SVC-04 as independent complete
features; CLI-08 and Cloudflare/release gates remain open. Local runtime proof
is not live deployment or cross-process replay proof. Desktop stays waived;
versions remain 0.8.3. No batch blocker.

<a id="codex-rt26-complete-svc04-open-2026-10-06"></a>
## Codex: Storage completed; Workflow acceptance held open (2026-10-06)

RT-26 meets its full archived criteria through source/native/installed provider
acceptance and image diagnostics. SVC-04 has verified contracts, bridge, recipe
and inspection, but its strict native waiting-status probe fails; no native
restart/resume/event completion or installed Workflow claim is made. Preserve
that requirement and the uncommitted failed fixtures. [Commands and limits](./release-0.9.0-verification-archive.md#codex-rt26-complete-svc04-open-2026-10-06).
**48 complete / 10 open**. Next finish independent CLI-08/Cloudflare acceptance;
avoid additional budget polish. Desktop remains waived; versions stay 0.8.3.

<a id="codex-cli08-cf04-complete-2026-10-06"></a>
## Codex: Agent documentation and resource selection completed (2026-10-06)

**CLI-08 and CF-04 complete; release 50 complete / 8 open.**
The full original contexts moved to the completed index. Versioned family usage,
non-Desktop skills, every new installed example and authenticated resource
selection meet their criteria. Unsupported discovery/creation remains explicit;
no remote readiness or automatic provisioning is inferred.
[Commands, failures, fixes and limits](./release-0.9.0-verification-archive.md#codex-cli08-cf04-complete-2026-10-06).
This historical batch precedes the current CF-10 completion below. Its
remaining-task list is superseded by the current handoff. Reuse unchanged evidence.


### Codex: Current verified release batch (2026-10-06)

**CF-10 complete; 51 complete / 7 open.** REL-02/REL-03 retain their full criteria.
Root and all ten non-Desktop package typechecks pass after the final stream fix.
Node standalone draining, generated native D1 migration plans and the original
CLI failure follow-ups are verified. [Commands, counts and limitations](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06).
Open: SVC-04, CF-08, CF-09, REL-02, REL-03, REL-04, REL-05. Preserve Workflow
waiting probes and checksum rejection; finish independent gates before versioning.
Desktop remains complete by user decision, with platform checks waived.
