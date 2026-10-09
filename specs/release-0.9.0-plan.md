# Cossack 0.9.0 implementation plan

Compacted by Codex on 2026-10-04. Updated on 2026-10-09. The release has 58 tasks: 55 complete and 3 open.
The [release checklist](./release-0.9.0.md) owns completion status and the evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) retains past test results and review limits.
The [handoff](./handoff-0.9.0.md) records current work and continuation instructions.

The completed task index retains all task anchors and archive links. Outcomes are in the checklist.
The [plan archive](./release-0.9.0-plan-archive.md) preserves the previous document,
including historical checkpoints. Open task sections retain their full context.
Historical status statements inside task sections do not override the checklist.

Codex hosted batch (2026-10-09): CF-09 and REL-02 now close with actual
installed hosted preview creation, intentional smoke failure, cleanup retry,
unchanged production and verified teardown. Earlier CF-08, SVC-04 and Deno
acceptance remains valid at its documented scope. [Completion audit](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09).

Codex current acceptance (2026-10-09): all five original cross-feature scenarios
now pass at current installed versions. Hosted scenario 5 proves exact staging
migration plan/apply/history, explicit staging build, protected asset/RPC checks,
unchanged production and independent cleanup. Combined: **24 passed / 0 skipped**;
root types pass. Strict local Waiting/full CLI remains blocked by the upstream
simulator; no numbered task closes and final-version artifacts remain required.
[Latest verified batch](./release-0.9.0-verification-archive.md#codex-hosted-staging-scenario-2026-10-09).

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
| 1. Finish verification | REL-03 | Resolve strict local Waiting/full CLI and the remaining release matrix. |
| 2. Prepare versions | REL-04 | Align versions and rebuild/recheck affected release artifacts. |
| 3. Audit release | REL-05 | Verify every requirement against the final release state. |

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
| <a id="svc-04"></a>SVC-04 | [Original context and completed acceptance](./release-0.9.0-plan-archive.md#codex-svc04-complete-2026-10-09) |
| <a id="rel-01"></a>REL-01 | [Reported regressions](./release-0.9.0-plan-archive.md#rel-01) |

## Cloudflare development and deployment

The Cloudflare goal is one coherent development-to-deployment path. Environment
selection must remain consistent through types, build, static rendering,
database tooling, and deployment. Local validation must distinguish itself from
checks that require authenticated access to real resources.

<a id="cf-08"></a>
### CF-08: Production logs and build budgets — complete

Codex (2026-10-09): real current installed production acceptance proves returned
request-ID correlation in tail and stored Workers Logs, safe redacted event
fields, direct provider-remapped authored source and native provider startup.
Retained source/installed tests prove compiler/browser privacy, local startup,
complete authenticated graph receipts and measured warning/hard regressions.
All owned hosted resources are confirmed removed. [Completion evidence](./release-0.9.0-verification-archive.md#codex-hosted-cf08-complete-2026-10-09).
Full implementation context remains in the [plan archive](./release-0.9.0-plan-archive.md#codex-cf08-completed-context-2026-10-09).

<a id="cf-09"></a>
### CF-09: Preview and CI resource lifecycle — complete

Codex (2026-10-09): the exact reviewed manual scaffold workflow runs against
installed tarballs on actual GitHub. Successful create, intentional smoke failure
and restoration of the failure intent for cleanup retry all pass. Saved immutable
preview/deployment/tag identities survive cleanup; provider reads confirm absence.
Production settings/deployment/D1 stay unchanged, while separate staging D1
records both smokes. Final owned Worker/D1/namespaces/repository teardown is
independently verified. Native normalization handles omitted scope fields and
asset progress before JSON without accepting foreign ownership or ambiguous output.
Promotion and code/state rollback limits remain documented; no production
promotion occurred. [Evidence and limitations](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09).
[Original purpose, approach and full criteria](./release-0.9.0-plan-archive.md#cf-09).

## Release gates

These tasks establish release readiness after implementation. A passing narrow
test is evidence for its behavior only. It does not close unrelated features
or the final release audit.

**Gate order — Codex (2026-10-09).** Close REL-02/03 against the completed
implementation at the current package versions. REL-04 then bumps to 0.9.0,
rebuilds and repeats affected package/install checks; REL-05 audits that final
release state. Requiring 0.9.0 artifacts before REL-02/03 would introduce a
circular dependency absent from the original plan. Final 0.9.0 artifact checks
remain required under REL-04. [Original-plan and current-payload audit](./release-0.9.0-verification-archive.md#codex-release-gate-order-audit-2026-10-09).

<a id="rel-02"></a>
### REL-02: Executable docs and published packages — complete

Codex (2026-10-09): current public APIs are proven through retained tarball-only
exports, runtime/declaration imports, published helpers/providers, generated
compositions and executable guides. Hosted Deno compiled artifacts and the new
changed-CLI hosted preview lifecycle complete the remaining runtime/feature
dependencies. No new public declaration or documentation-example API changes
were introduced by the provider repair. Retained unchanged package evidence is
linked in the [completion audit](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09); Studio asset/cache variation remains
explicit. Final 0.9.0 versioning, rebuilt payloads and affected install checks
belong to REL-04; REL-03's full green CLI/runtime gate is still required.
[Original purpose, approach and full criteria](./release-0.9.0-plan-archive.md#rel-02).

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

Codex (2026-10-06): `pnpm build:release` serially runs every non-Desktop native
build stage from the root build and also builds test-utils. Renderer/Core/UI
dependencies precede consumers; Framework retains its library declaration stage,
Studio runs its full Vite build. Auth publishes source and has no build script;
its typecheck is required. Native build, bundle audit and ten package types pass.
This completes the current non-Desktop build criterion, not final versioned or
full unit/browser gates. [Evidence](./release-0.9.0-verification-archive.md#codex-preview-creation-release-build-2026-10-06).

Codex (2026-10-06): all eleven non-Desktop, non-CLI complete unit suites pass
5,575 tests across 380 files, with two external PostgreSQL/MySQL cases skipped
for absent connection URLs. Root/all ten non-Desktop types pass. Full CLI and
final versioned gates remain open. Core's optional JSON reporter failed; the
standard reporter passed its complete suite without repository changes.
[Commands and exact limits](./release-0.9.0-verification-archive.md#codex-module-graphs-unit-gates-2026-10-06).

Codex (2026-10-06): final full development browser gate passes all 297 cases
in one unfiltered invocation after repairing SSE test room isolation/readiness.
Full Framework now passes 2,089 tests / 120 files after the public reload fix;
other unchanged package unit proof is retained. This closes the current local
browser criterion, not the full final-versioned/CLI/hosted runtime gate.
[Final commands and failed iterations](./release-0.9.0-verification-archive.md#codex-local-observability-browser-gates-2026-10-06).

Codex (2026-10-09): previously skipped PostgreSQL/MySQL cases execute against
isolated real native providers: 6 passed, zero skips; owned processes/data removed.
Strict local Waiting/full CLI remains red. The expanded hosted experiment was
red at this checkpoint and subsequently passes in the linked latest continuation.
Hosted Waiting closes SVC-04's original criterion, not those release tests.
[Batch evidence](./release-0.9.0-verification-archive.md#codex-svc04-waiting-provider-ci-2026-10-09).

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

**Deno Deploy criterion verified — Codex (2026-10-09).** Installed compiled
artifacts pass real hosted POST/cookies, production hydration and mutations over
HTTP, SSE and WebSocket; cleanup is independently confirmed by GET404.
[Commands, evidence and limits](./release-0.9.0-verification-archive.md#codex-deno-deploy-hosted-2026-10-09). Provider source builds and final 0.9.0
artifacts are not covered. REL-02/03 remain open.

Remaining before REL-03 closes: the required non-Desktop implementation matrix,
including a green full CLI/runtime gate. REL-04 owns the subsequent version bump
and affected final 0.9.0 artifact rechecks.
Generated Deno standalone shutdown/draining is verified under real signals and
installed tarballs in the [Codex acceptance](./release-0.9.0-verification-archive.md#codex-deno-standalone-draining-2026-10-06). Node standalone draining is verified in the
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

Codex executable migration examples (2026-10-06): all nine unchanged TypeScript
fences compile through public Core/Renderer/UI exports under strict Bundler and
NodeNext in source and installed consumers. Negative cases enforce JSON Date
serialization and native UI prop contracts. Application-owned method/data stubs
provide type context only; obsolete before examples are compiled, not endorsed
at runtime. The subsequent current-API migration coverage audit is complete; versioning and affected artifact checks remain gated.
[Evidence](./release-0.9.0-verification-archive.md#codex-migration-native-development-2026-10-06).

Codex release prose (2026-10-09): [changelog](../CHANGELOG.md) and
[release notes](./release-notes-0.9.0.md) are prepared as Unreleased candidates.
Coordinator reviewed feature coverage, migration claims and all 97 local links/
anchors against the current guides. No new executable examples or source changes.
Full REL-04 remains open: REL-02/03 dependencies, final migration completeness,
version/range/lock/template alignment and affected build/install acceptance.
[Batch evidence](./release-0.9.0-verification-archive.md#codex-release-gate-order-audit-2026-10-09).

Codex migration coverage (2026-10-09): audited all 58 checklist IDs against
existing/new migration sections. Filled CLI/scaffold/generated-contract, runtime/
binding/config, DataTable, DI/test-helper and deployment upgrade omissions. All
75 local links/anchors resolve; all nine previously compiled TypeScript examples
are byte-identical. Current implementation migration prose is prepared; this is
not final versioned artifact or requirement acceptance. No source/tests/types
reruns for prose-only edits. [Coverage and limits](./release-0.9.0-verification-archive.md#codex-migration-coverage-2026-10-09).

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

Codex (2026-10-09): the [criterion-level evidence audit](./release-0.9.0-scenario-audit.md)
records original scopes and all five completed compositions at current 0.8.3
versions. Scenarios 1–4 cover protected resource/edit, two-Worker realtime,
Queue retry/preferences and CLI/MCP composition. Scenario 5 now passes actual
hosted CI migration/build/protected asset/RPC/isolation/cleanup acceptance.
[Latest checks](./release-0.9.0-verification-archive.md#codex-hosted-staging-scenario-2026-10-09). Feature-level evidence remains valid; final versions,
strict local Waiting/full CLI and final audit criteria still govern REL-03/04/05.

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


## Codex verified Deno acceptance — 2026-10-06

Generated standalone Deno draining is complete within REL-03: native signals,
accepted responses, admission shutdown, repeated-signal ownership, forced
10-second deadline and strict installed public types all pass. All 42 adapter
unit tests, two native smoke tests, four Deno preset rendering cases, root and
ten non-Desktop package typechecks pass. [Exact evidence and limits](./release-0.9.0-verification-archive.md#codex-deno-standalone-draining-2026-10-06).
No full numbered task closes: **51 complete / 7 open**. Deno Deploy/final matrix,
native Workflow lifecycle and remote Cloudflare criteria remain. CF-09 needs a
native ownership-verifying resource provider before usable preview execution;
no disconnected prototype is retained. No unchanged installed gate was repacked.


## Codex verified local acceptance batch — 2026-10-06

No numbered task closes: **51 complete / 7 open**. [Full criterion mapping and
reproducible verification](./release-0.9.0-verification-archive.md#codex-production-source-maps-release-gates-2026-10-06). CF-08's local production-map criterion now
resolves an actual workerd fault to exact authored TypeScript; final Wrangler
prepared upload parts contain its matching map/module in source and installed
minimal/Workflows apps. Remote ingestion/remapping and other original criteria
remain open. Workflow public ESM loading is fixed; loading is not lifecycle proof.

REL-04 migration guidance now explains preserved applied callbacks, appended
pending operations and why baseline cannot repair checksums. Two real SQLite
upgrade/rejection cases pass; version/changelog/release-note work remains gated.
REL-02/03 builds, units, bundle audit and all ten non-Desktop package types have
passing final evidence. Full CLI and browser runs had failures; bounded repairs
and the final 87-case browser batch pass. Six SSG cases and changed Sidebar's
installed public native browser acceptance pass. Keep composite/remote limits.

Next finish native Workflow lifecycle and actual preview provider/CI ownership,
then remote operational/runtime acceptance and final versioned artifact gates.
Do not reopen Desktop or expand working budgets to fill these gaps. No cloud
mutation or package publication occurred; preserve the earlier failed probes.


## Codex: native preview batch — 2026-10-06

**No numbered task closes: 51 complete / 7 open.** Native preview CLI/provider,
rendered manual CI, journals, smoke and verified cleanup are connected and pass
source plus installed local checks. [Evidence](./release-0.9.0-verification-archive.md#codex-native-preview-cli-ci-2026-10-06).
To close CF-09, prove hosted creation/smoke/cleanup against an explicit account
without production changes, support required secrets without shared defaults,
and resolve lost-create recovery. Existing D1/KV/R2 staging bindings are retained;
per-branch provisioning is not implemented. Do not treat transport fixtures or
CI shell tests as provider execution. Preserve strict SVC-04 waiting/lifecycle
criteria and earlier failed probes. Other remote/runtime/final release gates
remain unchanged; Desktop is waived and versions stay 0.8.3.


## Codex: preview secret/recovery acceptance — 2026-10-06

**51 complete / 7 open; no numbered task closes.** The required-secret and lost
tagged-receipt gaps from the prior batch are now locally verified: explicit
private staging maps, per-deployment native secret bindings, protected tool logs,
latest-provider ownership recovery and generated-app workerd smoke.
[Checks and limits](./release-0.9.0-verification-archive.md#codex-preview-secrets-recovery-2026-10-06).
Next CF-09 acceptance needs a configured account/token and hosted creation, smoke,
cleanup and retry proof without production effects. A preview created before a
tagged deployment exists still cannot establish independent ownership for
automatic deletion; preserve/manual-recover its state. Existing staging storage
is retained, not provisioned per branch. Do not convert these gaps into waivers.
SVC-04 native Waiting, CF-08 remote and final REL gates remain unchanged.


## Codex — native Workflow lifecycle and guide batch (2026-10-06)

**51 complete / 7 open; no numbered task closes.** SVC-04 now has source and
installed native event/retry/failure and persisted process-restart evidence.
REL-02 gains unchanged Workflow guide compilation through public exports.
Source and installed combined checks each pass four cases; root/all ten
non-Desktop types pass. Unchanged installed artifacts reused. Desktop waived.
[Full evidence](./release-0.9.0-verification-archive.md#codex-workflow-native-lifecycle-2026-10-06).
Native Waiting status, hosted Cloudflare/CI, Deno Deploy and final versioned
artifact gates remain open. Continue independent final acceptance rather than
retesting or relabeling Miniflare Running.


## Codex — migration examples and native DEV acceptance (2026-10-06)

**51 complete / 7 open.** Two exclusive implementation agents added executable
migration-guide and native Cloudflare DEV acceptance; Codex reviewed correlation
and child cleanup, then verified source/installed combined checks (**2 each**)
and root/all ten non-Desktop package types. Unchanged installed artifacts reused.
[Evidence](./release-0.9.0-verification-archive.md#codex-migration-native-development-2026-10-06).
The serial non-Desktop CLI gate is running, including the strict native Waiting
probe. Do not claim it passed or restart on an observation timeout. No numbered
row closes; final hosted/artifact/runtime dependencies remain. Desktop waived.


## Codex — CLI gate and hosted readiness batch (2026-10-06)

**51 complete / 7 open; no numbered task closes.** REL-03's terminal CLI gate
reports **1,112 passed / 2 failed / 9 skipped**. Codex integrated an exclusive
UI agent's deterministic resize/removal regression and geometry-flush fix; source
and a fresh changed-UI tarball consumer pass. Separate checks execute both
non-Desktop name-filter omissions and the installed-only omission; six Desktop
cases remain waived. Root/all ten non-Desktop types pass. This is passing targeted
recovery, not a green rerun of the full CLI suite. Do not repeat unchanged matrices.

SVC-04 still needs actual native Waiting. The private hosted fixture now passes
installed generation, generated Workflow types, build, upload dry-run, guarded
native retry/event/failure smoke and client-secret scans. Function API throws reach
COSSACK_REQUEST_INTERNAL, with a correlated request ID, through the standard
request boundary. The exception API uses no custom catch/log. Cached Wrangler
OAuth is authenticated; absence of token environment variables does not imply
absence of authentication. API-token/CI configuration is still missing. The
reviewable private plan is `/tmp/cossack-hosted-release-ready-final/review.md`;
remote resource creation/checks/ownership-verified cleanup awaits approval and
has not occurred. Neither local fixture success nor the plan proves hosted Waiting,
Logs/maps/startup, CI isolation or unchanged production. CF-08 also retains its
compiler and wider graph/aggregate receipt requirements. Final versioned artifact,
Deno Deploy and release-audit dependencies remain. [Verification](./release-0.9.0-verification-archive.md#codex-cli-gate-scroller-hosted-preparation-2026-10-06).


## Codex — compiler and whole-batch receipt acceptance (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Two independent implementation
agents owned compiler files and aggregate regression tests. Codex owned shared
APIs, Vite/CLI integration, installed public CLI acceptance and final verification.
Framework 157 tests, CLI units 10 + related 33, native two-auxiliary regression,
installed CLI two cases, compiler source/installed and root/all ten non-Desktop
types pass. Framework and CLI changed artifacts packed; unchanged artifacts reused.
[Exact commands, failures and limits](./release-0.9.0-verification-archive.md#codex-compiler-aggregate-acceptance-2026-10-06). Continue with wider graph acceptance
or approved hosted checks; do not repeat unchanged receipt matrices. Native Waiting,
CI credentials/lifecycle, Deno Deploy and final versioned release gates remain.


## Codex — preview creation and release build batch (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Independent agents owned
provider transport/tests and release build orchestration/tests. Coordinator owned
preview lifecycle, real native source/installed integration, package-script wiring
and combined verification. No-tag saved-creation cleanup, compatible actual native
flags and the non-Desktop native build criterion now pass. Lost creation identity
and unknown provider state still refuse cleanup. Parent Worker must already exist;
Cossack does not provision or update it. [Evidence](./release-0.9.0-verification-archive.md#codex-preview-creation-release-build-2026-10-06).
Hosted approval and CI credentials are still pending; source/loopback success does
not prove hosted isolation, production preservation or provider resource cleanup.
Native Waiting, CF-08 wider graphs/remote evidence, Deno Deploy and final versions
still block their full task closures. Continue independent acceptance work.
