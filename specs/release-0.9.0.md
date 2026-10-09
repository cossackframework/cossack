# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

- [x] **Desktop scope is complete for 0.9.0 by user decision (2026-10-05).**
  Remaining Desktop-only platform checks are waived, not reported as passed.
  Do not reopen Desktop unless requested. Focus on shared framework, CLI/agent
  tooling and Cloudflare. REL-03 remains open for its non-Desktop
  acceptance; the numbered release task count is 55 complete / 3 open.

Read [the detailed implementation plan](./release-0.9.0-plan.md) for each task's
purpose, baseline, approach, dependencies, and acceptance criteria. The task IDs
below link directly to those explanations. Completed items retain a short summary.
Their [completion details and limits](./release-0.9.0-plan-archive.md#codex-completed-handoff-2026-10-04)
remain archived, and the verification log below retains test evidence.

## CLI and agent tooling

- [x] [CLI-01](./release-0.9.0-plan.md#cli-01) Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.
- [x] [CLI-02](./release-0.9.0-plan.md#cli-02) Validate command-specific flags and reject ambiguous/unknown options consistently.
- [x] [CLI-03](./release-0.9.0-plan.md#cli-03) Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands.
- [x] [CLI-04](./release-0.9.0-plan.md#cli-04) Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons.
- [x] [CLI-05](./release-0.9.0-plan.md#cli-05) Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.
- [x] [CLI-06](./release-0.9.0-plan.md#cli-06) Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions.
- [x] [CLI-07](./release-0.9.0-plan.md#cli-07) Shared local CLI/MCP tools, installed parity and native interruption acceptance; [audit](#codex-cli07-complete-2026-10-04).
- [x] [CLI-08](./release-0.9.0-plan.md#cli-08) Versioned offline API/usage family inventory, aligned non-Desktop skills, published imports and 109 guides / 116 examples. All 28 new examples pass installed compilation/execution; retained earlier evidence covers unchanged examples. [Verification and limits](#codex-cli08-cf04-complete-2026-10-06).

## Runtime and application APIs

- [x] [RT-01](./release-0.9.0-plan.md#rt-01) Shared transport/type contracts, native Node/workerd pre-header disconnect and one-time cleanup; Durable Object readiness, failed-owner retry, close, eviction and concurrent restoration pass, including final installed Core. [Evidence](#codex-rt01-rt11-complete-2026-10-05).
- [x] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies.
- [x] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation.
- [x] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics.
- [x] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work.
- [x] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [x] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection.
- [x] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting and pagination.
- [x] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics.
- [x] [RT-10](./release-0.9.0-plan.md#rt-10) Typed native/UI form bindings, nested errors and array/file fields, stale/single-flight lifecycle and reset. Node/workerd keyboard/accessibility and multipart RPC pass from source and installed tarballs. [Evidence](#codex-rt10-rt15-rt17-complete-2026-10-05).
- [x] [RT-11](./release-0.9.0-plan.md#rt-11) Native cookies, safe old input, generated auth flows and realtime revalidation; source/installed SQLite and D1 prove documented concurrent writes, rotation, flash replay and revocation limits. [Evidence](#codex-rt01-rt11-complete-2026-10-05).
- [x] [RT-12](./release-0.9.0-plan.md#rt-12) DI ownership, contextual resolution errors and cleanup. Codex verified inherited/nested runtime metadata, concurrent request facilities, static inspection parity, cleanup once and failure continuation in generated Node/Cloudflare browser and SSR/RPC acceptance; [evidence](#codex-rt12-rt27-complete-2026-10-05).
- [x] [RT-13](./release-0.9.0-plan.md#rt-13) Shared credentials/sessions and safe OAuth diagnostics with required atomic state consumption. Generated Node SQLite and Cloudflare D1 verify expiry, rotation, concurrent callback replay, failed exchange and mapping. [Original acceptance audit](#codex-rt13-complete-2026-10-05).
- [x] [RT-14](./release-0.9.0-plan.md#rt-14) Typed resource authorization policies and client visibility helpers.
- [x] [RT-15](./release-0.9.0-plan.md#rt-15) Inspectable finalized metadata, safe query diagnostics, stable pagination and provider capability contracts. Actual SQLite/Turso/PostgreSQL/MySQL generated keys and commit/rollback/savepoints pass; unsupported operations reject before effects. [Evidence](#codex-rt10-rt15-rt17-complete-2026-10-05).
- [x] [RT-16](./release-0.9.0-plan.md#rt-16) Read-only migration/seeder plans, authoritative declarations, target identity, conservative risks, stale-plan rejection and apply/reversal/rollback. SQLite/local D1 and installed public runtime/types pass. [Evidence](#codex-rt16-rt22-complete-2026-10-05).
- [x] [RT-17](./release-0.9.0-plan.md#rt-17) Shared read-only Studio/CLI inspection of schema/models/relationships, capabilities, selected targets and migration history. Parity, unchanged bytes/no bookkeeping, environment rejection and temporary disposal pass. [Evidence](#codex-rt10-rt15-rt17-complete-2026-10-05).
- [x] [RT-18](./release-0.9.0-plan.md#rt-18) Cache/rate-limit capability checks, consistent TTL units, and transport coverage.
- [x] [RT-19](./release-0.9.0-plan.md#rt-19) Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay.
- [x] [RT-20](./release-0.9.0-plan.md#rt-20) Redacted development text/structure/state diagnostics with component, relative source and field paths; valid nested hydration preserves nodes, listeners, resources and layout services. Installed development/production browser acceptance passes. [Evidence](#codex-rt20-rt24-complete-2026-10-05).
- [x] [RT-21](./release-0.9.0-plan.md#rt-21) SSG compiler compatibility, structured per-route outcomes and safe publication; real Vite and installed generated Cloudflare artifacts passed. [Evidence](#codex-rt21-rt29-complete-2026-10-05).
- [x] [RT-22](./release-0.9.0-plan.md#rt-22) Typed/validated Markdown metadata, output collision preflight, isolated locale rendering and canonical aliases/sitemap. Generated and installed Vite/type acceptance passes. [Evidence](#codex-rt16-rt22-complete-2026-10-05).
- [x] [RT-23](./release-0.9.0-plan.md#rt-23) Typed server DataTable, native UI contracts and installed accessibility guidance; [audit](#codex-rt23-complete-2026-10-04).
- [x] [RT-24](./release-0.9.0-plan.md#rt-24) Generated config inference, required variables/bindings, pre-factory named failures and scoped environments. Installed Node/Deno types, tooling policy, SSR/RPC/browser isolation and secret exclusion pass alongside prior Cloudflare acceptance. [Evidence](#codex-rt20-rt24-complete-2026-10-05).
- [x] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop.
- [x] [RT-26](./release-0.9.0-plan.md#rt-26) Published local/R2/S3 providers, authorized streamed CRUD, metadata, progress, cancellation and signed application access; image diagnostics. Source/native/installed acceptance passes. [Evidence](#codex-rt26-complete-svc04-open-2026-10-06).
- [x] [RT-27](./release-0.9.0-plan.md#rt-27) Translation extraction/catalog checks, generated imported/global key and parameter types, CLI/MCP JSON parity and parallel SSR/SSG locale isolation; [evidence](#codex-rt12-rt27-complete-2026-10-05).
- [x] [RT-28](./release-0.9.0-plan.md#rt-28) Bounded devtools snapshots and correlated timelines across supported runtimes, shared CLI/MCP records and production exclusion; [completion audit](#codex-rt28-complete-2026-10-04).
- [x] [RT-29](./release-0.9.0-plan.md#rt-29) Production-fetch/RPC test helpers, credential fixtures, typed browser hydration/DI and awaitable cleanup. Generated Node/Cloudflare policy/isolation/hydration/stripping and published imports pass. [Evidence](#codex-rt21-rt29-complete-2026-10-05).

## New services

- [x] [SVC-01](./release-0.9.0-plan.md#svc-01) Typed jobs, delays/retries, fenced durable D1 ownership, deduplication, redacted inspection and deterministic local adapters. Generated/installed actual Queues and Worker reload pass; [evidence](#codex-svc01-svc05-complete-2026-10-05).
- [x] [SVC-02](./release-0.9.0-plan.md#svc-02) Named UTC schedules share jobs validation, occurrence deduplication, retries and cleanup; generated/installed Cron, local one-shot, build and CLI/MCP inspection pass. [Evidence](#codex-svc02-svc03-complete-2026-10-05).
- [x] [SVC-03](./release-0.9.0-plan.md#svc-03) Typed escaped notifications, scoped preferences/inboxes, durable delivery status and explicit Cloudflare/SMTP providers. Source/installed Queue/D1 and loopback SMTP retry, uncertainty and restart acceptance pass. [Evidence](#codex-svc02-svc03-complete-2026-10-05).
- [x] [SVC-04](./release-0.9.0-plan.md#svc-04) Durable multi-step Workflows integration. Codex: source/installed native interruption, persisted pause/restart/resume, exact step reuse, retry/event and redacted failure acceptance pass; real provider REST, native binding and public inspection now report literal Waiting after an uninterrupted idle interval. Original criteria close through composite evidence. Strict local Waiting remains a failing REL-03 gate, not waived; expanded hosted lifecycle now passes. [Latest proof](./release-0.9.0-verification-archive.md#codex-workflow-lifecycle-agent-scenario-2026-10-09). [Acceptance mapping and limits](./release-0.9.0-verification-archive.md#codex-svc04-waiting-provider-ci-2026-10-09).
- [x] [SVC-05](./release-0.9.0-plan.md#svc-05) Typed accessible Turnstile widget, bounded server verification and validated form recipe. Generated/installed Node and Cloudflare browser mutation/lifecycle and secret stripping pass; [evidence](#codex-svc01-svc05-complete-2026-10-05).

## Cloudflare deployment

- [x] [CF-01](./release-0.9.0-plan.md#cf-01) Select environment before Vite build and share it across SSG, bindings, migrations, and deployment; [acceptance](#codex-cf-targets-complete-2026-10-05).
- [x] [CF-02](./release-0.9.0-plan.md#cf-02) Explicit local/remote database targets using the existing migration system; [acceptance](#codex-cf-targets-complete-2026-10-05).
- [x] [CF-03](./release-0.9.0-plan.md#cf-03) Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation.
- [x] [CF-04](./release-0.9.0-plan.md#cf-04) Explicit account/environment resource plans, authenticated D1/KV/R2/Hyperdrive selection, repeatable local JSONC apply and precise unsupported/provisioning actions. Native Wrangler loopback and installed command acceptance pass; no live cloud mutation. [Verification and limits](#codex-cli08-cf04-complete-2026-10-06).
- [x] [CF-05](./release-0.9.0-plan.md#cf-05) Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams.
- [x] [CF-06](./release-0.9.0-plan.md#cf-06) Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime.
- [x] [CF-07](./release-0.9.0-plan.md#cf-07) Public-only SSG and correct Worker-first routing for protected assets.
- [x] [CF-08](./release-0.9.0-plan.md#cf-08) Structured redacted failures, correlation, server source maps and artifact/startup budgets. Codex (2026-10-09): current installed production Worker proves caller UUID correlation in native tail and stored Workers Logs, redaction, provider-remapped authored source and native provider startup measurement. Prior source/installed compiler, browser and measured budget-regression acceptance retained. Owned Worker/Workflow/D1/DO resources are confirmed removed. [Completion evidence](./release-0.9.0-verification-archive.md#codex-hosted-cf08-complete-2026-10-09).
- [x] [CF-09](./release-0.9.0-plan.md#cf-09) Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance. Codex (2026-10-09): actual hosted installed CLI proves successful creation, intentional smoke failure, saved immutable journals and cleanup retry. Production settings/deployment/D1 remain unchanged; staging D1 receives both smokes. Preview and final test-resource absence are independently verified. Promotion remains a separate reviewed deployment; code rollback does not restore state. [Completion and limits](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09).
- [x] [CF-10](./release-0.9.0-plan.md#cf-10) Executable public installation/deployment guide, custom domains, named environments, SSG and tested compatibility. [Codex installed acceptance and limits](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06); remote preview/resource readiness remains separate.
- [x] [CF-11](./release-0.9.0-plan.md#cf-11) Remove tracked credential values; report any required external credential rotation without exposing values.

## Release gates

- [x] [REL-01](./release-0.9.0-plan.md#rel-01) Fix reports.md issues and verify package/SSG regressions.
- [x] [REL-02](./release-0.9.0-plan.md#rel-02) Compile documentation examples and validate generated applications and published tarballs. Codex (2026-10-09): retained tarball-only imports/declarations/helpers/providers/generated applications and public-API examples, hosted Deno and new changed-CLI hosted acceptance satisfy the original criteria; CF-09 closes its last feature dependency. Final version alignment and affected artifact rechecks remain REL-04. [Completion audit](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09).
- [ ] [REL-03](./release-0.9.0-plan.md#rel-03) Run build, root TypeScript command, package type checks, unit tests, and relevant end-to-end/runtime tests. Codex: standalone Deno draining and hosted Deploy HTTP/SSE/WebSocket acceptance pass; external PostgreSQL/MySQL omissions now pass, while strict local Waiting/full CLI and the final matrix remain. [Hosted evidence](./release-0.9.0-verification-archive.md#codex-deno-deploy-hosted-2026-10-09).
- [ ] [REL-04](./release-0.9.0-plan.md#rel-04) Update all release versions to 0.9.0, lockfile, changelog, migration guide, and release notes. Codex: Unreleased changelog/release notes and current-API migration coverage are reviewed; all 58 IDs map to upgrade guidance, with nine compiled examples unchanged. Versioning and affected artifact checks remain gated. [Migration audit](./release-0.9.0-verification-archive.md#codex-migration-coverage-2026-10-09). [Prose and gate-order review](./release-0.9.0-verification-archive.md#codex-release-gate-order-audit-2026-10-09). [Evidence](./release-0.9.0-verification-archive.md#codex-production-source-maps-release-gates-2026-10-06).
- [ ] [REL-05](./release-0.9.0-plan.md#rel-05) Audit every checklist item against implementation and verification evidence before marking the goal complete.

## Verification log

Record new checkpoints here with exact commands, results and remaining limits.
Focused checks do not replace the final monorepo and runtime release gates.

<a id="codex-cli08-database-queries-2026-10-05"></a>
### Codex: Typed database queries guidance (2026-10-05)

The database package now includes an installed guide for decorated entities,
typed comparison operators, filtered/sorted `find()` calls and query-builder
projections. Its Node SQLite example creates an isolated in-memory table, inserts
representative records, checks operator filtering and verifies that the raw
projection contains only the requested columns. It uses `orm.model()` so the
example makes the explicit-ORM scope behavior clear. Application schema changes
remain the responsibility of migrations; this sample uses static DDL only for
its isolated database.

- `pnpm test:agent-docs:local`: **71 standalone examples, four auth examples
  and four generated application pages** pass against freshly packed/installed
  exports. The gate also passes local D1/workerd, Cloudflare browser traces,
  generated app behavior, CLI/MCP parity, source stripping and UI contracts.
- `pnpm tsc --noEmit`: pass.
- `git diff --check -- . ':!reports.md'` and guide JSON parsing: pass.

There are now 67 published-package guides with 75 packaged examples. This
example proves the Node SQLite API only. CLI-08 remains open for broader library
API and recipe coverage; release status remains **34 complete / 24 open**.

<a id="codex-cli08-request-config-2026-10-05"></a>
### Codex: Request-scoped configuration guidance (2026-10-05)

The framework's installed agent guide now explains typed config registries,
request-time factories, string environment values, raw Worker bindings, and
safe required-binding failures. It distinguishes framework-managed request
scope from `runWithConfig()`/`buildConfig()` integration and test use. The
example compiles and runs from the installed framework tarball; it checks type
inference, request-local values, raw binding identity and value redaction.

- `pnpm test:agent-docs:local`: **70 standalone examples, four auth examples
  and four generated application pages** compile and execute. Local workerd D1
  and generated Cloudflare browser/CLI/MCP/source-stripping checks pass; outbound
  networking remains blocked in the acceptance harness.
- `pnpm tsc --noEmit`: pass.

CLI-08 remains open for broader library API and recipe coverage. Release status
remains **34 complete / 24 open**.

<a id="codex-cf-targets-complete-2026-10-05"></a>
### Codex: Cloudflare environment and database targets (2026-10-05)

`cossack dev`, `build`, and `ssg` now accept `--env` before forwarding Vite
arguments. The selected environment reaches Vite as `CLOUDFLARE_ENV`, while
`--mode` stays independent. JSON lifecycle/build/SSG results identify the
selected environment whether it came from `--env` or the inherited variable.
Generated staging deployment acceptance checks its APP_URL, binding types,
Worker artifact, static HTML and runtime URL behavior. Deployment checks also
cover non-inherited bindings and Vite-rewritten custom D1 migration paths.

Cloudflare D1 tooling remains local by default, including when a named
environment is selected. It uses the `.wrangler/state/v3` path shared by
Wrangler and the Cloudflare Vite plugin. Remote tooling requires explicit
`--target remote`/`--remote`, selects exactly the configured binding, requires
a real database ID, and has no local fallback. Safe JSON identity now includes
account, environment, binding, database name/ID, target, and read-only intent.
The migration guide contains an opt-in remote smoke procedure; no live account
or database was contacted.

- `pnpm --filter cossack exec vitest run tests/dispatch.test.js`: **49 tests pass**.
- `pnpm --filter cossack exec vitest run tests/deploy.test.js tests/deployment.test.js tests/dispatch.test.js`: **72 tests pass**.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js`: **1 generated Worker/workerd integration test passes**.
- `pnpm --filter cossack exec vitest run tests/cli-json-matrix.test.js --testTimeout=30000 -t 'create plans without writes|generate/delete plan and apply affected paths|lang publishes and adds catalogs|top-level help/version'`: **4 previously timed-out cases pass**. The unfiltered default-timeout run had those four unrelated cases exceed five seconds; its other **50 tests passed**.
- `pnpm --filter @cossackframework/database exec vitest run test/tooling.test.ts test/cloudflare-tooling.test.ts`: **32 tests pass**.
- `pnpm tsc --noEmit` and `git diff --check -- . ':!reports.md'`: pass.

Release status is **34 complete / 24 open**. Desktop remains complete by user
decision; waived platform checks are not claimed as passed.

<a id="codex-rt10-form-controller-2026-10-05"></a>
### Codex: Typed headless form controller foundation (2026-10-05)

Core now exports `createFormController()` and `FormController`. The controller
uses an `InputSchema` to type raw and parsed values, narrows dot-path reads and
writes, tracks dirty/touched/error/submission state, supports reset, translates
nested action/RPC validation errors, rejects duplicate submits, and ignores
validation or server errors made stale by a later edit. Plain values are copied;
`File` and `Blob` objects retain identity. It has no DOM or UI dependency. The
forms guide shows the initial client-side API and states the current boundary.
The existing `getFormData()` sample now correctly declares `async post()`.

**Verification:**

- `pnpm --filter @cossackframework/core exec vitest run tests/form-controller.test.ts`: **1 file / 9 tests pass**.
- `pnpm --filter @cossackframework/core exec vitest run`: **95 files / 1,568 tests pass**.
- `pnpm tsc --noEmit`: passes, including negative type assertions for invalid field paths and values.
- `git diff --check -- . ':!reports.md'`: passes.

**Limits:** This is only the shared state/controller foundation. It does not
provide accessible field bindings, browser keyboard/label/error/focus tests,
nested array-item paths, UI reactivity adapters or actual file transport
acceptance. RT-10 remains open and the release count stays **30 complete / 28
open**. No task count changed.

<a id="codex-rt11-sse-auth-2026-10-05"></a>
### Codex: SSE session freshness (2026-10-05)

Authenticated SSE now captures a server-only reference/token fingerprint and
revalidates current storage, user data, inherited guards and scope before every
snapshot, replay frame, event and heartbeat. Each check owns fresh request,
config and ORM scopes. Denial closes EventSource with fixed feedback and stops
retries until reload. Capture configuration and storage failures have distinct codes.
Generated Node SQLite/Cloudflare D1 and Chromium verify revocation, expiry,
rotation across tabs, purpose/scope changes, inherited denial, authorized peers
and idle storage failure. JavaScript and emitted maps exclude private helpers.
See [commands, migration and precise limits](./release-0.9.0-verification-archive.md#codex-rt11-sse-auth-2026-10-05).
**28 complete / 30 open.** RT-11 stays open for broader concurrency. Desktop
stays complete by user decision.

<a id="codex-rt11-websocket-auth-2026-10-05"></a>
### Codex: WebSocket session freshness (2026-10-05)

WebSocket actions and outbound frames now revalidate current identity and scope
inside fresh request, config, locale and middleware scopes. Cloudflare Durable
Object attachments retain a bounded credential-free descriptor so restored
hibernated sockets follow the same checks. Node/Deno delivery queues are
serialized per peer and bounded; denied peers receive a terminal authorization
frame and stop reconnecting. The generated deployment fixture uses a one-way
session fingerprint instead of retaining the bearer session ID. Desktop remains
complete by user decision.

At the time of this WebSocket checkpoint, barrier tests confirmed generic
session and flash scopes stayed separate across overlapping requests in one
isolate, but signed flash tokens still replayed within their expiry. The later
[process-local claim checkpoint](#codex-rt11-process-flash-claims-2026-10-05)
adds one-winner behavior within a module instance; this checkpoint does not
claim cross-process durability.

The focused core/framework/adapter tests, Cloudflare WebSocket peer integration,
generated deployment acceptance, and concurrent session/flash scope tests pass.
Root `pnpm typecheck` and `pnpm tsc --noEmit` pass. See the [full verification
record](./release-0.9.0-verification-archive.md#codex-rt11-websocket-auth-2026-10-05).
**28 complete / 30 open.** RT-11 stays open for broader concurrent request
semantics. A check that passed before revocation can finish in flight; slow
storage and backpressure prevent a strict time-based revocation guarantee.

<a id="codex-rt11-session-concurrency-2026-10-05"></a>
### Codex: Atomic database session key updates (2026-10-05)

The database-backed session store previously loaded the complete JSON bag,
changed one key, then replaced the bag. Concurrent requests updating distinct
keys could therefore silently erase one another's values. The store now uses a
single dialect-specific JSON update for `set()` and `unset()` on SQLite,
PostgreSQL and MySQL, preserving unrelated keys and existing expiry behavior.
Custom session stores are documented to provide the same per-key atomicity.
Same-key writes remain last-writer-wins unless a backend offers a stronger
operation.

The SQLite regression rejects read-before-write behavior and verifies both
values survive concurrent writes; it also checks an unusual JSON key. Before
the fix, a driver barrier reproduced the lost-key interleaving. Dialect SQL
compilation checks confirm SQLite, PostgreSQL and MySQL mutation shapes do not
issue a read-before-write query.

- `pnpm --filter @cossackframework/database exec vitest run test/cossack.test.ts`:
  **11 tests pass**.
- `pnpm --filter @cossackframework/database exec vitest run`: **15 files / 92
  tests pass**.
- `pnpm typecheck` passes all 11 package checks; `pnpm tsc --noEmit` passes.

RT-11 remains open. These writes preserve distinct concurrent session keys but
do not make signed flash cookies durably one-use or resolve in-flight request,
storage-latency and stream-backpressure limits. Desktop remains completed by
user decision; waived platform checks are not claimed as passed. The release
count remains **28 complete / 30 open**.

<a id="codex-rt11-flash-expiry-2026-10-05"></a>
### Codex: Server-enforced flash cookie expiry (2026-10-05)

Flash cookies now sign an envelope containing the data, a format marker and exact
expiry timestamp. The middleware checks that signed expiry after HMAC
verification, so a copied token cannot outlive its configured `maxAge` just by
bypassing the browser's cookie jar. `maxAge` must be a positive whole number of
seconds. Invalid, expired and older raw-data tokens provide no flash and are
cleared. At this expiry-only checkpoint, a copied valid token could still be
replayed within its signed window. The later process-local and Cloudflare claim
checkpoints add one-winner consumption with different durability limits.

- Framework suite: **1,544 tests / 79 files pass**.
- Core flash and crypto suites: **39 tests / 2 files pass**.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass.
- Fresh installed docs acceptance passes twelve standalone examples, four auth
  examples, the four packaged Cloudflare pages, HTTP/SSE/WebSocket traces,
  offline CLI/MCP parity, UI contracts and production stripping. This run uses
  the fresh tarballs from `test:agent-docs:local`, followed by
  `verifyAgentDocumentation(..., { runtime: 'cloudflare' })` against that
  installed fixture.

RT-11 remains open: no durable replay store rejects two uses of the same token
inside its valid window, and already-started application work cannot be rolled
back on session revocation. Desktop remains complete by user decision; waived
platform acceptance is not claimed as passed. Release status stays **28
complete / 30 open**.

<a id="codex-cli08-database-guidance-2026-10-05"></a>
### Codex: Installed database guidance and cold-start acceptance (2026-10-05)

The database package now ships authored agent guidance for parameterized Node
SQLite and Cloudflare D1 usage, runtime-specific imports, safe identifier
quoting, migration practice and the limits of D1 batch versus interactive
transactions. Both examples compile and execute from installed package exports
in the offline docs gate. The D1 example runs against a binding-contract fixture,
not a Miniflare or live D1 database.
Generated Cloudflare trace fixtures now clear stale Vite optimizer artifacts
between rewritten application graphs; the scaffold pre-bundles API and devtools
entries discovered after Vite's initial scan. This keeps HTTP, SSE, WebSocket
trace and packaged-page acceptance stable on cold generated applications.

- `pnpm test:agent-docs:local`: passes fresh packed-package installation,
  twelve standalone examples (including the D1 prepared-binding assertion),
  four auth examples, four generated application pages, offline CLI/MCP parity,
  Cloudflare HTTP/SSE/WebSocket traces, UI contracts and production source-map
  stripping. Desktop is excluded from this focused documentation gate by design.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **13 tests pass**.
- `pnpm tsc --noEmit` and `git diff --check -- . ':!reports.md'`: pass.

CLI-08 remains open for broader library/component/recipe guidance. REL-02 and REL-03 retain their full
criteria. Desktop remains complete by user decision; its waived platform
checks are not claimed as passed. The release count remains **28 complete / 30
open**.

<a id="codex-cli08-ui-example-2026-10-05"></a>
### Codex: Initial installed UI example and SSR acceptance (2026-10-05)

The UI package's `native-controls` guide now includes an executable accessible
profile form using `Button`, `Input` and `Label`. It compiles against the
installed package declarations and verifies server-rendered label/control
relationships, required/email semantics, help text and the submit button. The
acceptance bundles this example before Node execution because the installed UI
barrel exposes Solar icon TypeScript source; this follows the app's Vite
dependency pipeline. No browser interaction or assistive-technology behavior is
claimed by this example.

- `pnpm test:agent-docs:local`: passes fresh packed-package installation,
  **13 standalone examples**, four auth examples, four generated application
  pages, offline CLI/MCP parity, Cloudflare HTTP/SSE/WebSocket traces, UI
  declaration contracts and production source-map stripping. Database tests
  pass **15 files / 92 tests**. Desktop is excluded from this focused docs gate.
- The example typecheck uses the repository's `skipLibCheck` policy because
  imported Cloudflare declarations refer to ambient Worker globals absent from
  the runtime-neutral example harness.

CLI-08 remains open for broader package/component/recipe examples and real
Worker execution of the D1 guidance. REL-02/REL-03 retain their full criteria.
Desktop is complete by user decision; its waived platform checks are not claimed
as passed. Release status remains **28 complete / 30 open**.

<a id="codex-rt11-forms-2026-10-05"></a>
### Codex: Generated auth form privacy and session actions (2026-10-05)

Auth drafts now use ClientStore with client-only validation. Typed server
contracts accept one object and validate native calls too. Fixed failure messages
keep credentials and raw storage errors out of shared state. Generated Node/D1
and Chromium checks cover actual forms, partial registration failure, reset
expiry/replay, login/logout, rotation and cookie/redirect behavior. Rotation
redirects before refreshing the current session. The public-form guide now joins
installed Cloudflare application guidance acceptance. Root/package types and
focused regressions pass.
See [commands, API migration and remaining limits](./release-0.9.0-verification-archive.md#codex-rt11-forms-2026-10-05).
**28 complete / 30 open.** RT-11 and CLI-08 remain open; Desktop stays closed.

<a id="codex-rt11-input-2026-10-05"></a>
### Codex: Explicit public old-input selection (2026-10-05)

Form parsing retains no old input by default. Explicit public paths select
detached scalar leaves; credential paths, whole objects and unsupported values
are omitted. The reserved namespace cannot bypass selection. The new authored
form example passes real Node/Cloudflare POST, RPC failure/redirect, decoded
cookie and following SSR checks. Core/framework regressions, broader native
Workers HTTP/SSE acceptance, guidance discovery and root/package types pass.
See [commands, API migration and limits](./release-0.9.0-verification-archive.md#codex-rt11-input-2026-10-05).
**28 complete / 30 open.** RT-11 and CLI-08 remain open; Desktop stays closed.

<a id="codex-rt11-dashboard-2026-10-05"></a>
### Codex: Safe session dashboard and scoped revocation (2026-10-05)

Generated dashboards expose stable public references instead of auth bearer
tokens. An additive migration and conditional backfill support existing rows.
Authenticated-context helpers scope deletion to owner and auth purpose; current
references remain protected during token rotation. Dashboard layout guards now
cover RPC, and page errors discard storage exceptions. A sessions-only recipe
also uses a seeder without unselected role dependencies.
Auth leaves the separate anonymous session bag opt-in, and standalone SSG now
initializes translation/config helpers without the SSR entry.
Native Node SQLite/Cloudflare D1 checks verify SSR/RPC disclosure rejection,
forged actors and revocations, concurrent backfill/deletion, real database
failures, rotation races, purpose separation and bulk cookie clearing.
The full installed gate also passes adapter switching, migrations/schema,
Studio, public SSG, packaged guidance and production assets.
See [commands, evidence and limits](./release-0.9.0-verification-archive.md#codex-rt11-dashboard-2026-10-05).
**28 complete / 30 open.** RT-11 remains open for its remaining criteria; Desktop stays closed.

<a id="codex-rt13-complete-2026-10-05"></a>
### Codex: Atomic OAuth state and RT-13 completion (2026-10-05)

Cookie flows now require an atomic state store. Generated apps consume a
provider-bound state record before token exchange, with one concurrent winner.
Native SQLite/D1 fixtures verify replay rejection independently of provider code
reuse, failed exchange/mapping, expiry and purpose separation. Cookie clearing
also survives prefixed cookies and raw or immutable custom Responses.
The original RT-13 criteria are all verified. Auth **261/11**, scaffold **116/8**,
native/browser checks, root/package types and the installed guide gate pass.
See [criterion audit, commands and limits](./release-0.9.0-verification-archive.md#codex-rt13-complete-2026-10-05).
**28 complete / 30 open.** CLI-08 and broader release gates stay open; Desktop stays closed.

<a id="codex-rt13-primitives-2026-10-05"></a>
### Codex: Shared credentials and persistent sessions (2026-10-05)

Generated auth now consumes typed password, credential and session operations
from the auth library. Application models and atomic storage remain app-owned.
Node SQLite and Cloudflare D1 verify persistent expiry, one rotation winner,
revocation and reset-token separation. The protected-route browser regression
passes with the new sessions. Auth's fourth guide explains the contracts and
the explicit password-format migration.
See [commands, results and limits](./release-0.9.0-verification-archive.md#codex-rt13-primitives-2026-10-05).
RT-13 remains open for atomic OAuth callback replay acceptance. CLI-08 remains
open for broader coverage. Counts stay **27 complete / 31 open**; Desktop stays closed.

<a id="codex-rt13-diagnostics-2026-10-05"></a>
### Codex: OAuth diagnostics and local D1 JSON tooling (2026-10-05)

Auth exposes fixed codes/stages and safe `OAuthError` callbacks. Session and
generated database warnings omit raw exceptions. Configured callbacks clear
state cookies, including early rejection. The generated Node/Cloudflare apps
pass rejection checks and local migration setup. The latter found and fixed a
Miniflare Worker flag deadlock in isolated JSON database tooling.
Auth's third guide explains the same typed diagnostic contract.
See [commands, results and limits](./release-0.9.0-verification-archive.md#codex-rt13-diagnostics-2026-10-05).
RT-13 and CLI-08 stay open. Desktop stays completed by user decision.

<a id="codex-cli08-auth-guidance-2026-10-04"></a>
### Codex: Auth guidance and published TypeScript discovery (2026-10-04)

Auth ships session/role and record-policy guides with two executable examples.
Legacy manifests expose a separate implicit root entry. Static indexing reads
published TypeScript without executing it and reports its source kind.
The examples use strict Bundler type checking and installed esbuild bundling.
Their Node execution retains the full offline guard.
See [commands, results and limits](./release-0.9.0-verification-archive.md#codex-cli08-auth-guidance-2026-10-04).
CLI-08 stays open. Desktop stays completed by user decision.

<a id="codex-cli08-application-guidance-2026-10-04"></a>
### Codex: Executable application guidance (2026-10-04)

Core now packages complete pages for validated component actions, read-only
server resources and lifecycle tasks. The test harness writes the catalog's
source verbatim into generated applications. It checks types, runs native
server/browser interactions and builds clients with source maps enabled.
Discovery still returns source text without executing it.

Both Cloudflare and Node verify valid and rejected actions, loading settlement,
SSR resource reuse without a duplicate request, dependency changes, retained
values after failure, recovery and refresh. A held legacy operation settles
after its replacement commits, so task ownership is checked without a timing
assumption. Timer cleanup passes on rerun and navigation. Navigation stays in
the same document. Production JavaScript and emitted source maps exclude both
private server markers. Removing the input export also removes its action guide.

- `pnpm test:agent-docs:local`: passes twelve installed tarballs, ten standalone
  examples, three application examples, offline CLI/MCP parity, reporter types,
  Cloudflare HTTP/SSE/WebSocket traces, production exclusion and UI catalogs.
  Log: `/tmp/cossack-cli08-app-guidance-installed.log`.
- `node scripts/test-local-scaffold.mjs --node-dev-only`: passes the same
  installed documentation/application acceptance on Node, plus cold WebSocket
  startup, source reload, HMR and binding parity.
  Log: `/tmp/cossack-cli08-app-guidance-installed-node.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'executes packaged application guidance'`:
  **2 runtime cases pass / 54 unrelated cases skipped**.
  Log: `/tmp/cossack-cli08-app-guidance-workspace.log`.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **11 tests pass**. Log: `/tmp/cossack-cli08-app-guidance-reader.log`.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass for the root and all eleven packages.
  Logs: `/tmp/cossack-cli08-app-guidance-root-types.log` and `/tmp/cossack-cli08-app-guidance-package-types.log`.

These pages prove local HTTP application behavior on Cloudflare and Node, with
production client stripping. They do not prove deployed production behavior,
every transport, Deno application examples or other library/UI guidance.
CLI-08, REL-02 and REL-03 remain open. Catalog runtime support remains explicitly
unverified. Desktop stays closed. Release status remains **27 complete / 31 open**.

<a id="codex-cli08-input-2026-10-04"></a>
### Codex: Portable input guidance and installed examples (2026-10-04)

Core ships guides for typed query state, input schemas and nested forms. The
focused `@cossackframework/core/input` export provides schema types, form parsing
and validation errors without importing component or runtime modules. Root
imports remain available. Guidance explains raw versus parsed types, direct
calls versus inbound contracts, unknown fields and cancellation limits.
Numeric bracket keys create objects; empty brackets create arrays.

The installed harness now compiles and executes ten public usage examples,
including normalized input, rejected fields, nested errors, inferred types,
query round trips and asynchronous validation cancellation. The new declaration
query and guidance match across CLI/MCP. A reader regression removes schema/form
guides when the installed input export disappears. Discovery never runs examples.
The ordinary form guide now awaits request form data. Stale trace and reader
status text is corrected.

- `pnpm test:agent-docs:local`: passes dependency builds, twelve tarballs, ten
  compiled/executed examples, offline CLI/MCP parity, installed reporter types,
  Cloudflare HTTP/SSE/WebSocket traces, production exclusion and UI catalogs.
  Log: `/tmp/cossack-cli08-input-installed.log`.
- `pnpm --filter @cossackframework/core exec vitest run tests/input-schema.test.ts tests/forms.test.ts tests/url-state.test.ts`:
  **105 tests / 3 files pass**. Log: `/tmp/cossack-cli08-input-core.log`.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **11 tests / 1 file pass**. Log: `/tmp/cossack-cli08-input-guidance.log`.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass, including all eleven packages.
  Logs: `/tmp/cossack-cli08-input-root-types.log` and `/tmp/cossack-cli08-input-package-types.log`.

CLI-08 remains open. These helper examples prove Node execution inside an
installed Cloudflare project. They do not prove native helper behavior on every
runtime, component actions, resource/task lifecycles or UI behavior. Continue
authored application examples and the remaining library/component coverage.
REL-02 and REL-03 retain their full acceptance criteria. Desktop remains closed
by user decision. Release status stays **27 complete / 31 open**.

<a id="codex-rt28-complete-2026-10-04"></a>
### Codex: Desktop development and RT-28 completion (2026-10-04)

Desktop now runs Vite inside Electron through a separate development entry. The
public CLI supervises one child; page edits reload windows, while native entry,
Vite config and root environment-file changes restart the child. Private-origin
request ownership remains enforced. The optional asset provider serves Vite
assets without exposing native application handlers on loopback HTTP.

The generated bootstrap exports `frameworkApp`, `env` and `startDesktop(factory)`.
Production starts it through a DEV guard and bundles dependencies; development
uses normal external package resolution. See the [migration](./migration-0.9.0.md#desktop-vite-development).
Page syntax repair preserves the watcher, clears a stale startup overlay and
rechecks capability requirements. Unsupported/dynamic transports still fail.
Document transforms leave opaque HTML RPC bodies unread and unchanged.

Verification (all pass):

- `pnpm test:desktop` (`/tmp/cossack-desktop-dev-gate.log`): dependency builds,
  12 installed tarballs, generated type checking, real Electron production and
  development, ASAR inspection, relocated native execution and Linux DEB. The
  workspace portion passes **3 cases / 51 unrelated skipped**. Development covers
  startup/page syntax recovery, source reload, environment/config/bootstrap
  restarts, normal shutdown and parent-crash cleanup. Five actions cover state,
  streams, binary/HTML native responses and cancellation after server entry;
  repeated cancellation records one terminal. Browser/disk/CLI/MCP records agree.
  Production excludes trace hooks and inspector/source markers even with capture
  enabled in project configuration. Installed Vite 8.3.2 and workspace 8.1.4 pass.
- `pnpm --filter @cossackframework/desktop test`: **33 tests / 7 files**
  (`/tmp/cossack-desktop-dev-unit.log`).
- `pnpm --filter @cossackframework/scaffold test`: **113 tests / 8 files**
  (`/tmp/cossack-desktop-dev-scaffold.log`).
- Core focused tests: `pnpm --filter @cossackframework/core exec vitest run
  tests/development-trace.test.ts tests/service-development-trace.test.ts
  tests/development-inspection.test.ts tests/development-trace-build.test.ts`:
  **35 tests / 4 files** (`/tmp/cossack-desktop-trace-core.log`).
- Framework focused tests: `pnpm --filter @cossackframework/framework exec vitest run
  tests/build-capabilities.test.ts tests/runtime-capabilities.test.ts
  tests/route-codegen.test.ts tests/vite-security-plugin.test.ts tests/devtools.test.ts
  tests/devtools-browser.test.ts tests/development-traces.test.ts
  tests/development-trace-bridge.test.ts tests/native-trace-channel.test.ts
  tests/navigation-trace-build.test.ts`: **245 tests / 10 files**
  (`/tmp/cossack-desktop-framework-regressions.log`).
- Root `pnpm tsc --noEmit`, `pnpm typecheck` (**11 packages**) and
  `pnpm --filter @cossackframework/example-desktop-counter exec tsc --noEmit`
  pass. `pnpm install --lockfile-only --ignore-scripts` reports the lockfile current.

Original RT-28 criteria audit:

| Requirement | Evidence |
| --- | --- |
| Follow an action through request, result and state | Core proxy tests assert ordered correlated phases; native Desktop actions update the UI and join server dispatch/body evidence. Prior [Cloudflare](#codex-cli07-complete-2026-10-04), [Node](#codex-node-websocket-development-2026-10-04) and [Deno](#codex-deno-traces-2026-10-04) installed gates cover their supported transports. |
| Terminal events for disconnect/cancellation | Core tests execute real socket frame routing/disconnect cleanup and repeated HTTP/service cancellation; native Desktop cancellation is recorded once after server entry. |
| Bounded, redacted passive snapshots | Core inspection tests cover state, resources, real service scopes and transport status without invoking getters/loaders. Capture/storage tests cover limits, dropped events, ownership and rejected payloads. |
| Production excludes development code and source metadata | Core/framework production builds and the installed Desktop ASAR checks remove capture, inspector, bridge and source markers. |
| CLI/MCP read the same facts | Installed Desktop readers match the browser/disk snapshot through the existing shared schema; the earlier installed runtime gates cover Cloudflare, Node and Deno. |

**RT-28 is complete: 27 of 58 tasks complete, 31 open.** Versions remain 0.8.3.
The user has closed Desktop for this release and waived remaining OS integration/
sandbox, Windows/macOS packaging and signing acceptance. REL-03 retains the
required non-Desktop release matrix. Cancellation does not undo
external effects; body headers do not prove consumption, and stored records are
not live state. No deployment, publication or push occurred.

<a id="codex-cli08-ui-guides-2026-10-05"></a>
### Codex: Expanded installed UI guide examples (2026-10-05)

Four of the 39 UI guides now include executable examples: `native-controls`,
`server-data-table`, `native-dashboard-stat` and `native-settings-panel`. The
examples demonstrate an accessible native form, a typed server-owned DataTable,
zero-safe localized metric labels and values, and a controlled SettingsPanel
inside an application-owned native form. They check server-rendered markup and
that SSR does not invoke client callbacks. The installed docs verifier selects
all four guides, compiles their source against installed package declarations,
bundles UI output for Node, then executes the resulting examples. This follows
the app's Vite handling of the UI barrel's Solar icon TypeScript dependency.

The example compiler follows the root `skipLibCheck` policy because UI
declarations transitively reference generated Cloudflare Worker globals. The
example source itself uses only renderer and UI APIs. These examples cover SSR;
they do not prove interactive browser behavior or assistive-technology support.
Thirty-five UI guides still lack executable examples, and CLI-08 remains open for
broader authored coverage and runtime guidance. The D1 guide still runs against a
binding-contract fixture rather than Miniflare/workerd or a deployed database.

**Verification:**

- `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local`:
  fresh package builds and install pass; **16 standalone examples**, four auth
  examples, four generated application pages, Cloudflare HTTP/SSE/WebSocket
  browser traces, offline CLI/MCP parity, UI prop/index contracts and
  source-map-enabled production stripping pass. The database package suite passes
  **15 files / 92 tests**.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **1 file / 13 tests pass**.
- `pnpm tsc --noEmit` and `git diff --check -- . ':!reports.md'` pass.

**Release status remains 28 complete / 30 open.** Desktop remains complete by
user decision; its waived platform checks are not claimed as passing. REL-02 and
REL-03 retain their existing acceptance criteria. No deployment or publication
occurred.

<a id="codex-cli08-ui-coverage-2026-10-05"></a>
### Codex: Four more executable UI guides (2026-10-05)

The installed CLI catalog now supplies eight executable SSR UI examples.
Four new guides cover a normalized six-digit OTP that preserves leading zeroes,
named breadcrumb links with current-page semantics, URL-backed pagination with
native links, and a polite Alert beside determinate zero progress. The examples
check rendered form/accessibility markup and verify server rendering does not
call client callbacks. The installed verifier compiles, bundles and executes all
eight selected UI examples.

**Verification:** the fresh-tarball `pnpm test:agent-docs:local` gate passes,
including 20 packaged usage examples, four auth examples, four generated
application pages, installed Cloudflare HTTP/SSE/WebSocket traces, CLI/MCP
offline parity, UI contracts and production source-map stripping. The D1 example
passes its installed binding-contract assertion. `pnpm --filter cossack exec
vitest run tests/package-guidance.test.js` passes 13 tests; `pnpm tsc --noEmit`
and `git diff --check -- . ':!reports.md'` pass.

These examples prove SSR output only; they do not establish browser interaction
or assistive-technology behavior. Thirty-one of 39 UI guides remain without
examples. CLI-08 stays open for broader guidance and real Worker coverage of the
D1 example. Desktop is complete by user decision, with remaining platform checks
waived and not claimed as passed. REL-02/REL-03 remain open for non-Desktop
acceptance; task status remains 28 complete / 30 open. No deployment or
publication occurred.

<a id="codex-cli08-ui-coverage-2-2026-10-05"></a>
### Codex: Four additional executable UI guides (2026-10-05)

The installed UI catalog now has executable SSR examples for twelve of 39
guides. Four new examples cover `Field` passing label, hint, error and required
attributes to a native input alongside an actionable `Empty` state; `Card` slots,
status text and a decorative `Skeleton`; named `ButtonGroup`, static separators
and an image inside `AspectRatio`; and informative/decorative `Avatar` semantics
with a localized `AvatarGroup` overflow count. The examples check public types,
rendered markup and native ownership without invoking browser-only callbacks.

The installed verifier compiles, bundles and executes all twelve selected UI
examples from the fresh CLI catalog. This is server-rendered output coverage;
browser behavior and assistive-technology results remain separate.

**Verification:** the fresh-tarball `pnpm test:agent-docs:local` gate passes,
including 24 packaged usage examples, four auth examples, four generated
application pages, installed Cloudflare HTTP/SSE/WebSocket traces, CLI/MCP
offline parity, UI prop/index contracts and production source-map stripping. The
D1 bound-value fixture passes. `pnpm --filter cossack exec vitest run
tests/package-guidance.test.js` passes 13 tests.

Twenty-seven UI guides remain without examples. CLI-08 stays open for broader
library/component/recipe coverage. The D1 guide now also runs in workerd with
local D1; this does not test deployment to a Cloudflare account.
Desktop remains complete by user decision; waived platform checks are not passed.
REL-02/REL-03 remain open for non-Desktop criteria. Release status remains
**28 complete / 30 open**. No deployment or publication occurred.

<a id="codex-cli08-d1-workerd-2026-10-05"></a>
### Codex: D1 guide execution in workerd (2026-10-05)

The installed docs verifier now executes the packaged D1 example inside a local
Wrangler test Worker with a local D1 database. It creates a temporary `notes`
table, returns a stored value, and confirms SQL-looking input returns no row.
This uses the exact compiled guide example and installed package exports; it
does not contact a Cloudflare account or claim deployed compatibility.

The new Worker test exposed a package boundary defect: the neutral package root
re-exported a URL-selecting SQL client that pulled Node adapter imports into a
D1 Worker bundle, while the Cloudflare entry contained the optional remote Turso
import. The neutral `SQL` constructor now accepts explicit adapters, URL-based
selection is in the Node entry, and remote Workers Turso has its own
`@cossackframework/database/cloudflare-turso` entry. This keeps a fresh D1 app
independent of optional Turso packages.

**Verification:** the database package builds and its bundle audit passes;
**15 files / 93 tests** pass. Root `pnpm tsc --noEmit` passes. A fresh local
tarball install contains no Turso peers; `verifyAgentDocumentation()` passes
24 standalone examples, four auth examples, the real workerd D1 case, installed
CLI/MCP parity, Cloudflare transport traces, application guides, UI contracts,
and source-map-enabled client stripping. The complete direct verifier run passed
from that installed project.

CLI-08 stays open for broader library/component/recipe examples; 27 of 39 UI
guides remain without examples. Desktop remains complete by user decision, with
waived platform checks not claimed as passed. REL-02/REL-03 remain open for
non-Desktop criteria. Release status remains **28 complete / 30 open**. No
deployment or publication occurred.

<a id="codex-cli08-ui-coverage-3-2026-10-05"></a>
### Codex: Five additional executable UI guides (2026-10-05)

The installed UI catalog now has executable SSR examples for seventeen of 39
guides. Five new examples cover native RadioGroup and Slider form controls;
Combobox labels, stable form values and disabled options; MultiSelect repeated
form values and accessible tag actions; semantic Typography, Item, links and
separate buttons; and a named Table wrapper with a keyboard-scrollable
ScrollArea.

The examples compile, bundle and execute from installed package exports. They
check native form markup, selected values, accessible relationships, list and
table structure, wrapper ownership and initial SSR state. They do not establish
browser interaction or assistive-technology acceptance.

**Verification:** Root `pnpm tsc --noEmit`, all 636 UI tests and all 13
package-guidance tests pass. The fresh-tarball `pnpm test:agent-docs:local`
gate compiles and executes thirty-four packaged usage examples, four auth
examples and four generated application pages. It also verifies local workerd
D1 binding, installed Cloudflare HTTP/SSE/WebSocket traces, offline CLI/MCP
parity, UI prop/index contracts and source-map-enabled production stripping.
The D1 fixture does not contact a Cloudflare account.

CLI-08 remains open for broader library, component and recipe coverage.
Twenty-two UI guides still lack executable examples. Desktop remains complete
by user decision, with remaining platform checks waived and not claimed as
passed. REL-02/REL-03 remain open for non-Desktop acceptance. Release status is
**28 complete / 30 open**. No deployment or publication occurred.

<a id="codex-cli08-ui-coverage-4-2026-10-05"></a>
### Codex: Five more executable UI guides (2026-10-05)

The installed UI catalog now has executable SSR examples for twenty-seven of 39
guides. Five new examples cover native Modal, Sheet and Drawer naming and
closed-server behavior; linked Accordion and Collapsible panels; vertical
manually activated tabs; Toggle and ToggleGroup pressed states; and informative
versus decorative SVG icons with an authored trusted artwork fixture.

**Verification:** the installed agent-documentation gate compiles, bundles and
executes all thirty-nine packaged usage examples. It also checks four auth
examples, four generated application pages, workerd D1 binding, Cloudflare
HTTP/SSE/WebSocket traces, offline CLI/MCP parity, UI prop/index contracts and
source-map-enabled production stripping. The new UI examples prove SSR output
and initial accessibility relationships; they do not replace browser or
assistive-technology acceptance.

CLI-08 remains open for broader library, component and recipe coverage.
Twelve UI guides still lack executable examples. Desktop remains complete
by user decision, with waived platform checks not claimed as passed.
REL-02/REL-03 remain open for non-Desktop acceptance; release status remains
**28 complete / 30 open**. No deployment or publication occurred.

<a id="codex-cli08-ui-coverage-5-2026-10-05"></a>
### Codex: Five more native UI guide examples (2026-10-05)

The UI catalog now includes examples for twenty-seven of 39 guides. This batch
covers a natively targeted nonmodal Popover; a named, destructive AlertDialog
whose actions remain application-owned; Tooltip and HoverCard identities;
localized attachment removal with decorative previews; and a semantic chat
transcript built from Message, Bubble and Marker.

**Verification:** the fresh-tarball `pnpm test:agent-docs:local` gate passes
all thirty-nine packaged usage examples, four auth examples and four generated
application pages. It also exercises local workerd D1 binding, installed
Cloudflare browser traces, offline CLI/MCP parity, UI prop/index contracts and
production source stripping. All new UI examples assert server-rendered
structure; this does not establish their browser hover, popover, focus or
assistive-technology behavior.

CLI-08 stays open for the remaining twelve UI guides and broader library and
recipe coverage. Desktop remains complete by user decision; its waived platform
checks are not claimed as passed. REL-02/REL-03 remain open for non-Desktop
acceptance. Release status is **28 complete / 30 open**. No deployment or
publication occurred.

<a id="codex-cli08-ui-coverage-6-2026-10-05"></a>
### Codex: Six additional executable UI guide examples (2026-10-05)

The packaged UI catalog now has executable SSR examples for thirty-three of
its 39 guides. This batch covers Gregorian Calendar/DatePicker form behavior,
DropdownMenu and ContextMenu roles and actions, the base and composed command
search blocks, named Carousel slides, and the Resizable panel/separator
relationship. The catalog now contains forty-five standalone packaged usage
examples; six UI guides remain without examples.

**Verification:** the fresh-tarball `pnpm test:agent-docs:local` gate passes
all forty-five selected examples from installed packages, four auth examples,
four generated application pages, local workerd D1 binding, installed
Cloudflare browser traces, offline CLI/MCP parity, UI prop/index contracts and
production source stripping. The new examples assert SSR structure and callback
ownership; they do not establish UI browser interactions or assistive-technology
behavior.

CLI-08 remains open for the six remaining UI guides and broader library and
recipe coverage. Desktop remains complete by user decision; its waived platform
checks are not claimed as passed. REL-02/REL-03 remain open for non-Desktop
acceptance. Release status is **28 complete / 30 open**. No deployment or
publication occurred.

<a id="codex-cli08-ui-coverage-7-2026-10-05"></a>
### Codex: Final six executable UI guide examples (2026-10-05)

Every UI guide now includes an executable SSR example: 39 of 39 guides and 39
standalone UI examples. This batch covers the application Menubar, native-link
NavigationMenu, Sidebar disclosures, server-safe Toaster output, MessageScroller
viewport structure, and the AuthForm signup form. The packaged catalog contains
fifty-one standalone usage examples in total.

**Verification:** the fresh-tarball `pnpm test:agent-docs:local` gate compiled
and ran all fifty-one selected examples, four auth examples, and generated
Cloudflare application checks, including local workerd D1, browser traces,
source stripping, offline CLI/MCP parity and UI prop/index contracts. These
examples verify SSR structure and server/client
ownership; they do not establish browser interactions or assistive-technology
behavior for these UI components.

CLI-08 remains open for broader library, API, and recipe coverage. Desktop remains
complete by user decision; its waived platform checks are not claimed as passed.
REL-02/REL-03 remain open for non-Desktop acceptance. Release status is
**28 complete / 30 open**. No deployment or publication occurred.

<a id="codex-cli08-guide-coverage-2026-10-05"></a>
### Codex: Execute every published package guide example (2026-10-05)

The offline catalog now contains examples across all 64 published-package guides
and 70 examples in total. This includes runtime-capability and cache guides for
the framework plus lifecycle, fetch-binding and development-plugin guides for
the Node and Deno adapters, plus Studio's local/remote and embedded lifecycle
guidance. The verifier selects all published examples from
Core, renderer, framework, database, Node and Deno adapters, Studio, scaffold and UI; it
separately bundles and executes the four auth examples. It executes Studio's
embedded lifecycle with a fake connection and never opens a real database. Its TypeScript harness
uses the same decorator metadata settings as Core's package config. `test-utils`
is an internal workspace package outside the published tarball set.

**Verification:** the fresh-tarball `pnpm test:agent-docs:local` gate typechecks
and executes all sixty-six standalone usage examples plus four auth examples.
It also passes generated Cloudflare browser traces and source stripping, local
workerd D1, offline CLI/MCP parity, and UI catalog contract checks. The Deno
fetch example runs against the installed adapter with a Node compatibility shim
for Hono's Deno static-file module; it does not prove native Deno or deployed
readiness. The trace example exercises the documented non-Vite fail-closed
branch in the installed Node environment; actual trace transport acceptance
remains under RT-28.

CLI-08 remains open for broader package API and recipe coverage. Desktop remains
complete by user decision; its waived platform checks are not claimed as passed.
REL-02/REL-03 remain open for non-Desktop acceptance. Release status is
**28 complete / 30 open**. No deployment or publication occurred.

<a id="codex-cli08-studio-guidance-2026-10-05"></a>
### Codex: Studio agent guidance and offline import hygiene (2026-10-05)

The published Studio package now documents local versus remote D1 selection,
provider normalization, and embedded startup/shutdown. The lifecycle example
uses a fake connection, confirms loopback readiness, aborts, and verifies that
Studio closes the connection; it does not open a database.

The installed offline gate exposed an eager import of the remote-D1 helper from
Studio's public entry. That helper loads database tooling, which initializes the
`tsx` TypeScript loader and opens local IPC even when an application supplies a
connection. Studio now loads the remote helper only for `remote: true`. The gate
still blocks outbound DNS, fetch, HTTP, TLS and socket connections; it supplies
only a synthetic `127.0.0.1` resolution for loopback listeners and reports stack
traces for denied calls.

**Verification:** `pnpm tsc --noEmit` passes; Studio lifecycle/security tests
pass **7 tests / 2 files**; the fresh-tarball `pnpm test:agent-docs:local` gate
passes all **66 standalone and 4 auth examples** across **64 package guides**.
Generated Cloudflare traces and application pages, local workerd D1, offline
CLI/MCP parity, UI contracts and production stripping pass. Desktop remains
complete by user decision and is excluded from this gate. CLI-08 remains open for
broader package API and recipe coverage; REL-02/REL-03 remain open for the full
non-Desktop release checks. Status remains **28 complete / 30 open**. No
deployment or publication occurred.

<a id="codex-cli08-localization-2026-10-05"></a>
### Codex: Request-scoped localization guidance (2026-10-05)

Core now publishes an agent guide for catalog setup, locale-resolution order,
Cloudflare request isolation, localized response-cache keys and CLDR formatting.
Its installed examples cover supported Accept-Language fallback, explicitly
unacceptable `q=0` ranges and Russian plural selection with placeholder
replacement. The audit found that `detectBrowserLocale()` could select a language
marked `q=0`; it now ignores zero-quality ranges and uses the configured fallback
when no acceptable range remains. The guide states that its pure Core examples
do not prove the framework middleware, catalog loading or cache behavior.

**Verification:** `pnpm tsc --noEmit` passes; the Core i18n suite passes **74
tests**. The fresh-tarball `pnpm test:agent-docs:local` gate typechecks and
executes **68 standalone examples plus 4 auth examples** across **65
published-package guides**. Local workerd D1, installed Cloudflare traces and
application examples, offline CLI/MCP parity, UI contracts and production
stripping pass. Desktop is complete by user decision and is excluded. CLI-08
remains open for broader package API and recipe coverage; REL-02/REL-03 remain
open for the full non-Desktop release checks. Status remains **28 complete / 30
open**. No deployment or publication occurred.

<a id="codex-cli08-migration-guidance-2026-10-05"></a>
### Codex: Installed migration and seeding guidance (2026-10-05)

Database agent guidance now includes an installed Node SQLite lifecycle example.
It applies a named migration, checks its recorded checksum status, runs an
idempotent upsert seeder twice, verifies the stable key is not duplicated, and
rolls the migration back. The guide distinguishes trusted static migration DDL
from bound data values and explains the D1 transaction boundary. It does not
claim that SQLite SQL is portable to D1/PostgreSQL/MySQL or that a deployed
database is ready.

**Verification:** the database package passes **93 tests** and its bundle audit
passes (**28 neutral modules; Cloudflare entry is Workers-safe**). The clean
`COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` run typechecks and executes
**69 standalone examples plus 4 auth examples** from fresh tarballs, and passes
local workerd D1, offline CLI/MCP parity, Cloudflare traces, generated application
behavior, UI contracts and production source-map stripping. Desktop is excluded
because the user closed it for this release; waived platform checks are not
claimed as passed. The latest installed guide count is **66 guides / 73 examples**.
CLI-08 remains open for broader library API and recipe coverage; REL-02/REL-03
remain open for the full non-Desktop release checks. Status remains **28 complete
/ 30 open**. No live database, deployment or publication was used.

<a id="codex-desktop-native-2026-10-04"></a>
### Codex: Completed Desktop checkpoint (2026-10-04)

Committed at `fa434f8`: native request ownership and restricted production
packaging. Installed/workspace Electron acceptance, Linux DEB, 28 Desktop tests,
78 scaffold tests and root/all 11 package type checks passed. Full commands,
versions and limits are in the [verification archive](./release-0.9.0-verification-archive.md#codex-desktop-native-2026-10-04).
These results precede the [development runner and RT-28 audit](#codex-rt28-complete-2026-10-04).
Remaining installed OS integration, other OS packages and signing acceptance
are waived by the user's decision to mark Desktop complete for this release.

<a id="codex-cf04-scaffold-guidance-2026-10-05"></a>
### Codex: Accurate Cloudflare scaffold resource guidance (2026-10-05)

Generated D1 config and README now agree: create a remote D1 database matching
the configured `database_name` before deployment; local development uses the
separate Wrangler database. The README also explains replacing the all-zero
Hyperdrive configuration ID and keeping origin credentials in the Cloudflare
configuration. Scaffold tests check both generated comments and README output.
This is accurate setup guidance, not resource selection, authenticated account
inspection, provisioning or full Cloudflare resource management. CF-04 remains
open.

<a id="codex-cf04-static-resource-plan-2026-10-05"></a>
### Codex: Static Cloudflare resource plan (2026-10-05)

`cossack inspect cloudflare` and `check cloudflare` now describe each binding's
configured name/ID reference, unresolved setup action, and `remote: not-checked`
status. The old `provisioning: existing|automatic` claim is removed. D1
bindings missing either required field are unresolved for remote deployment;
name-only entries are explicitly unresolved because
Cloudflare's [Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
requires `database_name` and `database_id`; the local parser accepting an
incomplete config does not prove it is deployable. Scaffold docs and comments
explain the existing-ID and explicit Wrangler create/update-config paths.
Placeholder Hyperdrive IDs remain errors and now have direct remediation in
inspection output. No account identity is inferred from `--env`; inspection
and check remain local/read-only. A generated staging app also passed a local
`cossack deploy --dry-run` integration without upload or resource creation.

**Verification:** Cossack's focused deployment/inspect tests pass **30/30**; scaffold's `tests/scaffold.test.js` passes **81/81**; the generated staging deploy-dry-run integration passes **1/1**. Root `pnpm tsc --noEmit` and `git diff --check -- . ':!reports.md'` pass.

**Remaining:** This is static configuration planning only. It does not select
resources, verify account ownership/existence/access, provision resources, or
test wrong-account and repeated-application behavior. CF-04 remains open; release
counts remain **34 complete / 24 open**. The dry-run did not upload or create
resources, and remote account/resource readiness remains unverified.

<a id="codex-rt11-process-flash-claims-2026-10-05"></a>
### Codex: Process-local flash replay claims (2026-10-05)

Without the Cloudflare Durable Object coordinator, flash middleware now claims
each signed nonce once in a synchronous, module-local store. A min-heap removes
expired claims, the live-claim capacity is bounded at 10,000, and a full store
fails closed with `COSSACK_FLASH_REPLAY_UNAVAILABLE` (503) without evicting a
live claim. This guarantees one winner only within the current loaded module
instance in its process or isolate; it does not coordinate across processes or
isolates and does not survive restart. Cloudflare continues using the Durable
Object claim path.

**Verification:** `pnpm --filter @cossackframework/framework exec vitest run
tests/flash-middleware.test.ts` passes **1 file / 21 tests**;
`pnpm --filter cossack exec vitest run
tests/sse-coordinator-integration.test.js -t 'atomically consumes signed
flash nonces'` passes **1 test**; root `pnpm tsc --noEmit` passes.

<a id="codex-rt12-navigation-fixture-2026-10-05"></a>
### Codex: Navigation ownership acceptance fixture (2026-10-05)

The synthetic user middleware in the generated navigation ownership fixture now
provides the structural `captureRealtimeIdentity` callback required by
authenticated realtime. The fixture continues to use a query parameter as a
test identity and is not an authentication example. `pnpm --filter cossack
exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation
ownership'` passes **2 runtime cases** (Node and Cloudflare; 62 unrelated tests
skipped). Navigation, cleanup, SSE and WebSocket ownership assertions now pass.
RT-12 remains open for runtime metadata/lifecycle behavior and broader release
gates.

<a id="codex-rt24-typed-paths-2026-10-05"></a>
### Codex: Reject misspelled typed configuration paths (2026-10-05)

The `config()` string fallback previously accepted an unknown path even when an
application had registered `CossackConfigRegistry`, so a typo silently returned
`unknown` and bypassed the typed overload. The fallback now accepts arbitrary
strings only while the registry is empty. A populated registry restricts paths
to its dotted leaves and checks defaults against the registered value type.

**Verification:** root `pnpm tsc --noEmit` passes with compile-time tests for
valid inferred values, a misspelled path and a mismatched default. The installed
request-config example carries the same negative assertions; the fresh
`COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` gate passes all 76 standalone
examples and four auth examples, including the published framework declarations.

RT-24 remains open: the project still has to register its own config shapes
manually. No registry generator was added. Release status remains **30 complete
/ 28 open**.

<a id="codex-rt12-construction-rollback-2026-10-05"></a>
### Codex: Roll back partial service-scope construction (2026-10-05)

If a declared service constructor or hydration step failed after an earlier
service had initialized, `ServiceScope` previously threw without disposing the
partial scope. Construction now starts normal scope disposal before rethrowing
the original failure. Existing services run `onDispose()` once, and the parent
tracks pending async cleanup so its own `disposeAsync()` waits for it. The user
guide now documents this behavior.

**Verification:** `pnpm --filter @cossackframework/core exec vitest run tests/cleanup.test.ts` passes **8 tests**, including a regression where a later constructor throws while an earlier service's async cleanup is held behind a gate. Root `pnpm tsc --noEmit` passes. `git diff --check` passes for the implementation and test files.

RT-12 remains open: this covers failed scope setup only. It does not prove all
runtime metadata/lifecycle combinations or the complete CLI/release gates. Task
status remains **34 complete / 24 open**.

<a id="codex-cf08-rpc-logging-2026-10-05"></a>
### Codex: Correlated RPC failure logs (2026-10-05)

HTTP component and layout-service RPC failures now produce structured events.
Each event includes a validated request ID, bounded route/action/runtime labels,
elapsed time, a failure stage and a fixed failure code. The logger never receives
an exception object or request payload. Stream and cleanup failures use the same
safe event shape.

**Verification:** `pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts` passes **478 tests**. The new action and stream checks find each event by the request ID returned to the caller and confirm that a private error marker is absent. `pnpm --filter @cossackframework/framework exec vitest run tests/rpc-stream.test.ts tests/native-response-evidence.test.ts` passes **24 tests**. Root `pnpm tsc --noEmit` and `git diff --check` for the changed source/test files pass.

CF-08 remains open. These tests run through the local framework harness, not a
deployed Worker Logs account. Source-map stack resolution, configurable bundle
and startup budgets, and a review of non-RPC logs remain unverified. Task status
remains **34 complete / 24 open**.

<a id="codex-rt20-safe-hydration-diagnostics-2026-10-05"></a>
### Codex: Safe hydration mismatch diagnostics (2026-10-05)

Hydration mismatch warnings now use structured fields for the fallback action,
boundary, category, DOM path and expected/actual node shape. Nested component
fallbacks also include the component class name. Text values and comment contents
are not included in these diagnostics.

**Verification:** `pnpm --filter @cossackframework/renderer exec vitest run`
passes **333 tests in 24 files**. New regressions cover a root node-type mismatch
and a nested component tag mismatch. Both confirm the warning identifies the
failure shape and excludes a private rendered-text marker. Root
`pnpm tsc --noEmit` and `git diff --check` for the changed renderer files pass.

RT-20 remains open. This slice does not compare SSR and browser state values or
identify a source file or field. It adds no reusable test helper and does not
verify retained layout services in a browser. Task status remains
**34 complete / 24 open**.

### Archived checkpoints

Codex compacted the recorded checkpoints on 2026-10-04. Full evidence and limits
remain in the [verification archive](./release-0.9.0-verification-archive.md). Existing checkpoint
anchors below link to those records. Archiving a checkpoint does not complete its
parent task. Current status is 30 complete and 28 open.

| Recorded checkpoint and full evidence |
| --- |
| <a id="codex-deno-traces-2026-10-04"></a>[Codex Deno CLI development traces and HTTPS (2026-10-04)](./release-0.9.0-verification-archive.md#codex-deno-traces-2026-10-04) |
| <a id="codex-deno-development-2026-10-04"></a>[Codex native Deno development through Vite (2026-10-04)](./release-0.9.0-verification-archive.md#codex-deno-development-2026-10-04) |
| <a id="codex-deno-cli-start-2026-10-04"></a>[Codex Deno CLI production startup (2026-10-04)](./release-0.9.0-verification-archive.md#codex-deno-cli-start-2026-10-04) |
| <a id="codex-deno-production-2026-10-04"></a>[Codex real Deno production acceptance (2026-10-04)](./release-0.9.0-verification-archive.md#codex-deno-production-2026-10-04) |
| <a id="codex-node-websocket-development-2026-10-04"></a>[Codex unified Node development sockets and bindings (2026-10-04)](./release-0.9.0-verification-archive.md#codex-node-websocket-development-2026-10-04) |
| <a id="codex-node-development-2026-10-04"></a>[Codex Node Vite development HTTP and trace acceptance (2026-10-04)](./release-0.9.0-verification-archive.md#codex-node-development-2026-10-04) |
| <a id="codex-native-trace-evidence-2026-10-04"></a>[Codex native body server trace evidence (2026-10-04)](./release-0.9.0-verification-archive.md#codex-native-trace-evidence-2026-10-04) |
| <a id="codex-native-cancel-settlement-2026-10-04"></a>[Codex native response failure settlement (2026-10-04)](./release-0.9.0-verification-archive.md#codex-native-cancel-settlement-2026-10-04) |
| <a id="codex-socket-trace-evidence-2026-10-04"></a>[Codex WebSocket server trace evidence (2026-10-04)](./release-0.9.0-verification-archive.md#codex-socket-trace-evidence-2026-10-04) |
| <a id="codex-cli07-complete-2026-10-04"></a>[Codex installed trace acceptance and CLI-07 completion (2026-10-04)](./release-0.9.0-verification-archive.md#codex-cli07-complete-2026-10-04) |
| <a id="codex-generated-trace-acceptance-2026-10-04"></a>[Codex generated development-trace acceptance (2026-10-04)](./release-0.9.0-verification-archive.md#codex-generated-trace-acceptance-2026-10-04) |
| <a id="codex-stream-terminal-evidence-2026-10-04"></a>[Codex delivered RPC stream terminal evidence (2026-10-04)](./release-0.9.0-verification-archive.md#codex-stream-terminal-evidence-2026-10-04) |
| <a id="codex-server-dispatch-evidence-2026-10-04"></a>[Codex HTTP server dispatch evidence (2026-10-04)](./release-0.9.0-verification-archive.md#codex-server-dispatch-evidence-2026-10-04) |
| <a id="codex-paused-rpc-deadlines-2026-10-04"></a>[Codex paused RPC deadlines (2026-10-04)](./release-0.9.0-verification-archive.md#codex-paused-rpc-deadlines-2026-10-04) |
| <a id="codex-service-traces-2026-10-04"></a>[Codex explicit service RPC traces (2026-10-04)](./release-0.9.0-verification-archive.md#codex-service-traces-2026-10-04) |
| <a id="codex-trace-bridge-2026-10-04"></a>[Codex project-bound trace bridge (2026-10-04)](./release-0.9.0-verification-archive.md#codex-trace-bridge-2026-10-04) |
| <a id="codex-browser-inspector-2026-10-04"></a>[Codex browser inspector integration (2026-10-04)](./release-0.9.0-verification-archive.md#codex-browser-inspector-2026-10-04) |
| <a id="codex-component-snapshots-2026-10-04"></a>[Codex passive component snapshots (2026-10-04)](./release-0.9.0-verification-archive.md#codex-component-snapshots-2026-10-04) |
| <a id="codex-navigation-trace-2026-10-04"></a>[Codex shared navigation trace capture (2026-10-04)](./release-0.9.0-verification-archive.md#codex-navigation-trace-2026-10-04) |
| <a id="codex-rpc-trace-foundation-2026-10-04"></a>[Codex development RPC trace foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-rpc-trace-foundation-2026-10-04) |
| <a id="codex-test-evidence-2026-10-04"></a>[Codex stored test evidence (2026-10-04)](./release-0.9.0-verification-archive.md#codex-test-evidence-2026-10-04) |
| <a id="codex-rt23-complete-2026-10-04"></a>[Codex RT-23 completion audit (2026-10-04)](./release-0.9.0-verification-archive.md#codex-rt23-complete-2026-10-04) |
| <a id="codex-settings-panel-2026-10-04"></a>[Codex SettingsPanel (2026-10-04)](./release-0.9.0-verification-archive.md#codex-settings-panel-2026-10-04) |
| <a id="codex-dashboard-stat-2026-10-04"></a>[Codex DashboardStat (2026-10-04)](./release-0.9.0-verification-archive.md#codex-dashboard-stat-2026-10-04) |
| <a id="codex-command-palette-2026-10-04"></a>[Codex CommandPalette (2026-10-04)](./release-0.9.0-verification-archive.md#codex-command-palette-2026-10-04) |
| <a id="codex-auth-form-2026-10-04"></a>[Codex AuthForm (2026-10-04)](./release-0.9.0-verification-archive.md#codex-auth-form-2026-10-04) |
| <a id="codex-icon-2026-10-04"></a>[Codex Icon (2026-10-04)](./release-0.9.0-verification-archive.md#codex-icon-2026-10-04) |
| <a id="codex-message-scroller-2026-10-04"></a>[Codex MessageScroller (2026-10-04)](./release-0.9.0-verification-archive.md#codex-message-scroller-2026-10-04) |
| <a id="codex-chat-display-2026-10-04"></a>[Codex Bubble, Marker and Message (2026-10-04)](./release-0.9.0-verification-archive.md#codex-chat-display-2026-10-04) |
| <a id="codex-attachment-2026-10-04"></a>[Codex Attachment (2026-10-04)](./release-0.9.0-verification-archive.md#codex-attachment-2026-10-04) |
| <a id="codex-carousel-2026-10-04"></a>[Codex Carousel (2026-10-04)](./release-0.9.0-verification-archive.md#codex-carousel-2026-10-04) |
| <a id="codex-toast-2026-10-04"></a>[Codex Toast (2026-10-04)](./release-0.9.0-verification-archive.md#codex-toast-2026-10-04) |
| <a id="codex-sidebar-2026-10-04"></a>[Codex Sidebar (2026-10-04)](./release-0.9.0-verification-archive.md#codex-sidebar-2026-10-04) |
| <a id="codex-resizable-2026-10-04"></a>[Codex Resizable (2026-10-04)](./release-0.9.0-verification-archive.md#codex-resizable-2026-10-04) |
| <a id="codex-table-scroll-area-2026-10-04"></a>[Codex Table and ScrollArea (2026-10-04)](./release-0.9.0-verification-archive.md#codex-table-scroll-area-2026-10-04) |
| <a id="codex-typography-item-2026-10-04"></a>[Codex Typography and Item (2026-10-04)](./release-0.9.0-verification-archive.md#codex-typography-item-2026-10-04) |
| <a id="codex-avatar-2026-10-04"></a>[Codex Avatar and AvatarGroup (2026-10-04)](./release-0.9.0-verification-archive.md#codex-avatar-2026-10-04) |
| <a id="codex-field-empty-2026-10-04"></a>[Codex Field and Empty (2026-10-04)](./release-0.9.0-verification-archive.md#codex-field-empty-2026-10-04) |
| <a id="codex-status-controls-2026-10-04"></a>[Codex Alert, Progress and Spinner (2026-10-04)](./release-0.9.0-verification-archive.md#codex-status-controls-2026-10-04) |
| <a id="codex-display-controls-2026-10-04"></a>[Codex Skeleton, Card, Badge and Kbd (2026-10-04)](./release-0.9.0-verification-archive.md#codex-display-controls-2026-10-04) |
| <a id="codex-layout-controls-2026-10-04"></a>[Codex ButtonGroup, Separator and AspectRatio (2026-10-04)](./release-0.9.0-verification-archive.md#codex-layout-controls-2026-10-04) |
| <a id="codex-breadcrumb-2026-10-04"></a>[Codex Breadcrumb (2026-10-04)](./release-0.9.0-verification-archive.md#codex-breadcrumb-2026-10-04) |
| <a id="codex-pagination-2026-10-04"></a>[Codex Pagination and union prop catalogs (2026-10-04)](./release-0.9.0-verification-archive.md#codex-pagination-2026-10-04) |
| <a id="codex-navigation-menu-2026-10-04"></a>[Codex NavigationMenu (2026-10-04)](./release-0.9.0-verification-archive.md#codex-navigation-menu-2026-10-04) |
| <a id="codex-menubar-2026-10-04"></a>[Codex Menubar (2026-10-04)](./release-0.9.0-verification-archive.md#codex-menubar-2026-10-04) |
| <a id="codex-toggles-2026-10-04"></a>[Codex Toggle and ToggleGroup (2026-10-04)](./release-0.9.0-verification-archive.md#codex-toggles-2026-10-04) |
| <a id="codex-tabs-2026-10-04"></a>[Codex Tabs (2026-10-04)](./release-0.9.0-verification-archive.md#codex-tabs-2026-10-04) |
| <a id="codex-disclosures-2026-10-04"></a>[Codex Accordion and Collapsible (2026-10-04)](./release-0.9.0-verification-archive.md#codex-disclosures-2026-10-04) |
| <a id="codex-command-2026-10-04"></a>[Codex Command (2026-10-04)](./release-0.9.0-verification-archive.md#codex-command-2026-10-04) |
| <a id="codex-alert-dialog-2026-10-04"></a>[Codex AlertDialog (2026-10-04)](./release-0.9.0-verification-archive.md#codex-alert-dialog-2026-10-04) |
| <a id="codex-hover-controls-2026-10-04"></a>[Codex hover controls (2026-10-04)](./release-0.9.0-verification-archive.md#codex-hover-controls-2026-10-04) |
| <a id="codex-websocket-ownership-2026-10-04"></a>[Codex WebSocket ownership (2026-10-04)](./release-0.9.0-verification-archive.md#codex-websocket-ownership-2026-10-04) |
| <a id="codex-runtime-ownership-2026-10-03"></a>[Codex runtime and SSE ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-runtime-ownership-2026-10-03) |
| <a id="codex-same-url-history-2026-10-03"></a>[Codex same-URL history (2026-10-03)](./release-0.9.0-verification-archive.md#codex-same-url-history-2026-10-03) |
| <a id="codex-url-backend-reads-2026-10-03"></a>[Codex URL-state backend reads (2026-10-03)](./release-0.9.0-verification-archive.md#codex-url-backend-reads-2026-10-03) |
| <a id="codex-navigation-diagnostics-2026-10-03"></a>[Codex navigation diagnostics (2026-10-03)](./release-0.9.0-verification-archive.md#codex-navigation-diagnostics-2026-10-03) |
| <a id="codex-route-inheritance-2026-10-03"></a>[Codex route inheritance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-route-inheritance-2026-10-03) |
| <a id="codex-root-ownership-2026-10-03"></a>[Codex root ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-root-ownership-2026-10-03) |
| <a id="codex-inactive-cache-2026-10-03"></a>[Codex inactive cache (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inactive-cache-2026-10-03) |
| <a id="codex-nested-drafts-2026-10-03"></a>[Codex nested drafts (2026-10-03)](./release-0.9.0-verification-archive.md#codex-nested-drafts-2026-10-03) |
| <a id="codex-scope-retirement-2026-10-03"></a>[Codex scope retirement (2026-10-03)](./release-0.9.0-verification-archive.md#codex-scope-retirement-2026-10-03) |
| <a id="codex-render-recovery-2026-10-03"></a>[Codex render recovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-render-recovery-2026-10-03) |
| <a id="codex-draft-isolation-2026-10-03"></a>[Codex draft target isolation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-draft-isolation-2026-10-03) |
| <a id="codex-staged-navigation-2026-10-03"></a>[Codex staged navigation review (2026-10-03)](./release-0.9.0-verification-archive.md#codex-staged-navigation-2026-10-03) |
| <a id="codex-fetch-ownership-2026-10-03"></a>[Codex navigation fetch ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-fetch-ownership-2026-10-03) |
| <a id="codex-terminal-disposal-2026-10-03"></a>[Codex terminal disposal review (2026-10-03)](./release-0.9.0-verification-archive.md#codex-terminal-disposal-2026-10-03) |
| <a id="codex-pending-history-2026-10-03"></a>[Codex checkpoint: pending history and module preflight (2026-10-03)](./release-0.9.0-verification-archive.md#codex-pending-history-2026-10-03) |
| <a id="codex-query-ownership-2026-10-03"></a>[Codex checkpoint: query ownership review (2026-10-03)](./release-0.9.0-verification-archive.md#codex-query-ownership-2026-10-03) |
| <a id="codex-url-state-contracts-2026-10-03"></a>[Codex checkpoint: typed query contracts and destination contexts (2026-10-03)](./release-0.9.0-verification-archive.md#codex-url-state-contracts-2026-10-03) |
| <a id="codex-route-boundaries-2026-10-03"></a>[Codex completion: typed routes and source boundaries (2026-10-03)](./release-0.9.0-verification-archive.md#codex-route-boundaries-2026-10-03) |
| <a id="codex-api-contracts-2026-10-03"></a>[Codex checkpoint: native API contracts and generated declarations (2026-10-03)](./release-0.9.0-verification-archive.md#codex-api-contracts-2026-10-03) |
| <a id="codex-typed-routes-2026-10-03"></a>[Codex checkpoint: generated typed URLs and shared route discovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-typed-routes-2026-10-03) |
| <a id="codex-schema-migration-2026-10-03"></a>[Codex checkpoint: schema-only actions, function fields and private callbacks (2026-10-03)](./release-0.9.0-verification-archive.md#codex-schema-migration-2026-10-03) |
| <a id="codex-resource-policies-2026-10-03"></a>[Codex checkpoint: typed resource policies and trusted action identity (2026-10-03)](./release-0.9.0-verification-archive.md#codex-resource-policies-2026-10-03) |
| <a id="codex-typed-input-2026-10-03"></a>[Codex checkpoint: typed input and private validator dependencies (2026-10-03)](./release-0.9.0-verification-archive.md#codex-typed-input-2026-10-03) |
| <a id="codex-storage-capabilities-2026-10-03"></a>[Codex completion: storage guarantees, limiter policies and provider inspection (2026-10-03)](./release-0.9.0-verification-archive.md#codex-storage-capabilities-2026-10-03) |
| <a id="codex-sse-cancellation-2026-10-03"></a>[Codex continuation: native coordinator cancellation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-sse-cancellation-2026-10-03) |
| <a id="codex-rate-decision-io-2026-10-03"></a>[Codex continuation: bounded counter decisions and cancellation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rate-decision-io-2026-10-03) |
| <a id="codex-rate-store-contracts-2026-10-03"></a>[Codex continuation: request-owned rate stores and validated counters (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rate-store-contracts-2026-10-03) |
| <a id="codex-rate-window-persistence-2026-10-03"></a>[Codex continuation: persistent Durable Object rate windows (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rate-window-persistence-2026-10-03) |
| <a id="codex-socket-peer-context-2026-10-03"></a>[Codex review: WebSocket peer context and native Cloudflare acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-socket-peer-context-2026-10-03) |
| <a id="codex-rpc-json-envelopes-2026-10-03"></a>[Codex review: ordinary JSON and HTTP failure envelopes (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-json-envelopes-2026-10-03) |
| <a id="codex-rpc-target-limits-2026-10-03"></a>[Codex review: child targets and RPC action limit ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-target-limits-2026-10-03) |
| <a id="codex-rpc-protocol-boundaries-2026-10-03"></a>[Codex review: RPC correlation and terminal response validation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-protocol-boundaries-2026-10-03) |
| <a id="codex-workers-rpc-acceptance-2026-10-03"></a>[Codex review: built Workers multipart and native RPC acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-workers-rpc-acceptance-2026-10-03) |
| <a id="codex-rpc-multipart-2026-10-03"></a>[Codex review: shared multipart RPC ownership and streaming (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-multipart-2026-10-03) |
| <a id="codex-rpc-native-response-2026-10-03"></a>[Codex review: native HTTP RPC response completion (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-native-response-2026-10-03) |
| <a id="codex-rpc-json-values-2026-10-03"></a>[Codex review: JSON RPC values and client types (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-json-values-2026-10-03) |
| <a id="codex-rpc-conformance-matrix-2026-10-03"></a>[Codex continuation: shared RPC conformance matrix (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-conformance-matrix-2026-10-03) |
| <a id="codex-rpc-response-timing-2026-10-03"></a>[Codex review: RPC response cookies and header timing (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-response-timing-2026-10-03) |
| <a id="codex-authored-rpc-types-2026-10-03"></a>[Codex continuation: authored client RPC types (2026-10-03)](./release-0.9.0-verification-archive.md#codex-authored-rpc-types-2026-10-03) |
| <a id="codex-four-recipe-capabilities-2026-10-03"></a>[Codex completion: four recipes and shared capability planning (2026-10-03)](./release-0.9.0-verification-archive.md#codex-four-recipe-capabilities-2026-10-03) |
| <a id="codex-mutation-browser-recipe-2026-10-03"></a>[Codex continuation: validated mutation and browser acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-mutation-browser-recipe-2026-10-03) |
| <a id="codex-resource-recipe-2026-10-03"></a>[Codex continuation: resource recipe and RT-25 audit (2026-10-03)](./release-0.9.0-verification-archive.md#codex-resource-recipe-2026-10-03) |
| <a id="codex-native-database-capabilities-2026-10-03"></a>[Codex continuation: native database bindings (2026-10-03)](./release-0.9.0-verification-archive.md#codex-native-database-capabilities-2026-10-03) |
| <a id="codex-recipe-requirements-2026-10-03"></a>[Codex continuation: selected recipe requirements (2026-10-03)](./release-0.9.0-verification-archive.md#codex-recipe-requirements-2026-10-03) |
| <a id="codex-bundled-route-exports-2026-10-03"></a>[Codex continuation: bundled route export audit (2026-10-03)](./release-0.9.0-verification-archive.md#codex-bundled-route-exports-2026-10-03) |
| <a id="codex-durable-state-capability-2026-10-03"></a>[Codex continuation: durable page capability (2026-10-03)](./release-0.9.0-verification-archive.md#codex-durable-state-capability-2026-10-03) |
| <a id="codex-node-development-runtime-2026-10-03"></a>[Codex continuation: Node development runtime (2026-10-03)](./release-0.9.0-verification-archive.md#codex-node-development-runtime-2026-10-03) |
| <a id="codex-node-guarded-runtime-2026-10-03"></a>[Codex continuation: guarded Node runtime (2026-10-03)](./release-0.9.0-verification-archive.md#codex-node-guarded-runtime-2026-10-03) |
| <a id="codex-deno-shutdown-2026-10-03"></a>[Codex continuation: Deno shutdown and action lifetime (2026-10-03)](./release-0.9.0-verification-archive.md#codex-deno-shutdown-2026-10-03) |
| <a id="codex-deno-runtime-eviction-2026-10-03"></a>[Codex continuation: Deno runtime eviction (2026-10-03)](./release-0.9.0-verification-archive.md#codex-deno-runtime-eviction-2026-10-03) |
| <a id="codex-runtime-websocket-scopes-2026-10-03"></a>[Codex review: runtime WebSocket service scopes (2026-10-03)](./release-0.9.0-verification-archive.md#codex-runtime-websocket-scopes-2026-10-03) |
| <a id="codex-generated-runtime-builds-2026-10-03"></a>[Codex continuation: generated Node/Deno/Desktop builds (2026-10-03)](./release-0.9.0-verification-archive.md#codex-generated-runtime-builds-2026-10-03) |
| <a id="codex-handler-default-parity-2026-10-03"></a>[Codex review: functional handlers and default component selection (2026-10-03)](./release-0.9.0-verification-archive.md#codex-handler-default-parity-2026-10-03) |
| <a id="codex-recipe-capability-wiring-2026-10-03"></a>[Codex continuation: recipe wiring and environment binding discovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-recipe-capability-wiring-2026-10-03) |
| <a id="codex-page-capability-discovery-2026-10-03"></a>[Codex continuation: shared source parser and page capability discovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-page-capability-discovery-2026-10-03) |
| <a id="codex-schedule-capability-2026-10-03"></a>[Codex review: adapter-dependent schedule capability (2026-10-03)](./release-0.9.0-verification-archive.md#codex-schedule-capability-2026-10-03) |
| <a id="codex-capability-build-2026-10-03"></a>[Codex continuation: selected build capability requirements (2026-10-03)](./release-0.9.0-verification-archive.md#codex-capability-build-2026-10-03) |
| <a id="codex-module-inspection-2026-10-03"></a>[Codex review: module validity and CLI-04 acceptance audit (2026-10-03)](./release-0.9.0-verification-archive.md#codex-module-inspection-2026-10-03) |
| <a id="codex-service-inspection-2026-10-03"></a>[Codex review: executed service inspection acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-service-inspection-2026-10-03) |
| <a id="codex-inspection-acceptance-2026-10-03"></a>[Codex review: combined inspection fixture and middleware order (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inspection-acceptance-2026-10-03) |
| <a id="codex-inherited-options-2026-10-03"></a>[Codex review: inherited options and action receivers (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inherited-options-2026-10-03) |
| <a id="codex-inherited-rpc-2026-10-03"></a>[Codex review: inherited compiler RPC registration (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inherited-rpc-2026-10-03) |
| <a id="codex-runtime-inspection-2026-10-03"></a>[Codex continuation: binding-aware transport inspection (2026-10-03)](./release-0.9.0-verification-archive.md#codex-runtime-inspection-2026-10-03) |
| <a id="codex-declaration-dispatch-2026-10-03"></a>[Codex continuation: declared member precedence (2026-10-03)](./release-0.9.0-verification-archive.md#codex-declaration-dispatch-2026-10-03) |
| <a id="codex-member-facts-2026-10-02"></a>[Codex continuation: compiler member facts for dispatch (2026-10-02)](./release-0.9.0-verification-archive.md#codex-member-facts-2026-10-02) |
| <a id="codex-inspection-integration-2026-10-02"></a>[Codex verification: inspection integration checkpoint (2026-10-02)](./release-0.9.0-verification-archive.md#codex-inspection-integration-2026-10-02) |
| <a id="codex-imported-inheritance-2026-10-02"></a>[Codex continuation: relative imported base declarations (2026-10-02)](./release-0.9.0-verification-archive.md#codex-imported-inheritance-2026-10-02) |
| <a id="codex-local-inheritance-2026-10-02"></a>[Codex continuation: local inheritance declarations (2026-10-02)](./release-0.9.0-verification-archive.md#codex-local-inheritance-2026-10-02) |
| <a id="codex-scaffold-inspection-2026-10-02"></a>[Codex continuation: shared scaffold recipe inspection (2026-10-02)](./release-0.9.0-verification-archive.md#codex-scaffold-inspection-2026-10-02) |
| <a id="codex-resource-inspection-2026-10-02"></a>[Codex continuation: authored resource inspection (2026-10-02)](./release-0.9.0-verification-archive.md#codex-resource-inspection-2026-10-02) |
| <a id="codex-parser-unavailable-2026-10-02"></a>[Codex continuation: remove heuristic route facts (2026-10-02)](./release-0.9.0-verification-archive.md#codex-parser-unavailable-2026-10-02) |
| <a id="codex-static-options-2026-10-02"></a>[Codex review: truthful static option extraction (2026-10-02)](./release-0.9.0-verification-archive.md#codex-static-options-2026-10-02) |
| <a id="codex-namespace-methods-2026-10-02"></a>[Codex review: namespace method decorators (2026-10-02)](./release-0.9.0-verification-archive.md#codex-namespace-methods-2026-10-02) |
| <a id="codex-route-checks-2026-10-02"></a>[Codex continuation: static route checks (2026-10-02)](./release-0.9.0-verification-archive.md#codex-route-checks-2026-10-02) |
| <a id="codex-compiler-facts-2026-10-02"></a>[Codex continuation: compiler-backed own-method inspection (2026-10-02)](./release-0.9.0-verification-archive.md#codex-compiler-facts-2026-10-02) |
| <a id="codex-compiler-preservation-2026-10-02"></a>[Codex review: deep client helper preservation (2026-10-02)](./release-0.9.0-verification-archive.md#codex-compiler-preservation-2026-10-02) |
| <a id="codex-cli-upgrades-2026-10-02"></a>[Codex continuation: complete release-aligned upgrade plans (2026-10-02)](./release-0.9.0-verification-archive.md#codex-cli-upgrades-2026-10-02) |
| <a id="codex-cli-json-2026-10-02"></a>[Codex continuation: complete JSON command contracts (2026-10-02)](./release-0.9.0-verification-archive.md#codex-cli-json-2026-10-02) |
| <a id="codex-cli-metadata-2026-10-02"></a>[Codex continuation: complete CLI validation metadata (2026-10-02)](./release-0.9.0-verification-archive.md#codex-cli-metadata-2026-10-02) |
| <a id="codex-continuation-2026-10-02"></a>[Codex continuation: development upgrades and machine contracts (2026-10-02)](./release-0.9.0-verification-archive.md#codex-continuation-2026-10-02) |
| <a id="codex-review-group3-2026-10-02"></a>[Codex review of GLM command-contract follow-up and Group 3 (2026-10-02)](./release-0.9.0-verification-archive.md#codex-review-group3-2026-10-02) |
| <a id="codex-review-2026-10-02"></a>[Codex review of GLM Groups 1–2 (2026-10-02)](./release-0.9.0-verification-archive.md#codex-review-2026-10-02) |
| <a id="codex-cache-contracts-2026-10-03"></a>[Codex cache contract review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-cache-contracts-2026-10-03) |
| <a id="codex-resource-lifecycle-2026-10-03"></a>[Codex resource lifecycle review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-resource-lifecycle-2026-10-03) |
| <a id="codex-task-ownership-2026-10-03"></a>[Codex typed task ownership review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-task-ownership-2026-10-03) |
| <a id="codex-state-diagnostics-2026-10-03"></a>[Codex state contracts and diagnostics review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-state-diagnostics-2026-10-03) |
| <a id="codex-optimistic-ownership-2026-10-03"></a>[Codex optimistic invocation ownership checkpoint — 2026-10-03](./release-0.9.0-verification-archive.md#codex-optimistic-ownership-2026-10-03) |
| <a id="codex-optimistic-operations-2026-10-03"></a>[Codex explicit optimistic operation checkpoint — 2026-10-03](./release-0.9.0-verification-archive.md#codex-optimistic-operations-2026-10-03) |
| <a id="codex-optimistic-reconciliation-2026-10-03"></a>[Codex review: authoritative optimistic reads (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-reconciliation-2026-10-03) |
| <a id="codex-optimistic-socket-2026-10-03"></a>[Codex review: native optimistic socket recovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-socket-2026-10-03) |
| <a id="codex-retained-service-loading-2026-10-03"></a>[Codex continuation: retained service consumers and loading (2026-10-03)](./release-0.9.0-verification-archive.md#codex-retained-service-loading-2026-10-03) |
| <a id="codex-optimistic-sse-ordering-2026-10-03"></a>[Codex optimistic SSE ordering and resync (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-sse-ordering-2026-10-03) |
| <a id="codex-optimistic-completion-2026-10-03"></a>[Codex RT-06 completion and stream ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-completion-2026-10-03) |
| <a id="codex-navigation-acceptance-2026-10-04"></a>[Codex: RT-08/RT-09 acceptance audit (2026-10-04)](./release-0.9.0-verification-archive.md#codex-navigation-acceptance-2026-10-04) |
| <a id="codex-local-mcp-2026-10-04"></a>[Codex: Local MCP inspection foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-local-mcp-2026-10-04) |
| <a id="codex-installed-catalog-2026-10-04"></a>[Codex: Installed-version catalog foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-installed-catalog-2026-10-04) |
| <a id="codex-declaration-index-2026-10-04"></a>[Codex: Compiler-backed declaration catalog (2026-10-04)](./release-0.9.0-verification-archive.md#codex-declaration-index-2026-10-04) |
| <a id="codex-export-discovery-2026-10-04"></a>[Codex: Public export and implicit declaration discovery (2026-10-04)](./release-0.9.0-verification-archive.md#codex-export-discovery-2026-10-04) |
| <a id="codex-installed-docs-acceptance-2026-10-04"></a>[Codex: Installed documentation acceptance (2026-10-04)](./release-0.9.0-verification-archive.md#codex-installed-docs-acceptance-2026-10-04) |
| <a id="codex-package-guidance-2026-10-04"></a>[Codex: Package-owned guidance and executable examples (2026-10-04)](./release-0.9.0-verification-archive.md#codex-package-guidance-2026-10-04) |
| <a id="codex-recipe-guidance-2026-10-04"></a>[Codex: Recipe guidance and pure registry declarations (2026-10-04)](./release-0.9.0-verification-archive.md#codex-recipe-guidance-2026-10-04) |
| <a id="codex-prop-catalog-2026-10-04"></a>[Codex: Installed component prop contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-prop-catalog-2026-10-04) |
| <a id="codex-data-table-2026-10-04"></a>[Codex: Controlled DataTable foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-data-table-2026-10-04) |
| <a id="codex-data-table-integration-2026-10-04"></a>[Codex: Generated DataTable integration and navigation focus (2026-10-04)](./release-0.9.0-verification-archive.md#codex-data-table-integration-2026-10-04) |
| <a id="codex-native-controls-2026-10-04"></a>[Codex: Typed native controls and mapped prop discovery (2026-10-04)](./release-0.9.0-verification-archive.md#codex-native-controls-2026-10-04) |
| <a id="codex-choice-controls-2026-10-04"></a>[Codex: Themed choice controls and range state (2026-10-04)](./release-0.9.0-verification-archive.md#codex-choice-controls-2026-10-04) |
| <a id="codex-select-values-2026-10-04"></a>[Codex: Dynamic select values (2026-10-04)](./release-0.9.0-verification-archive.md#codex-select-values-2026-10-04) |
| <a id="codex-form-ssr-2026-10-04"></a>[Codex: SSR form controls and focused agent contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-form-ssr-2026-10-04) |
| <a id="codex-input-addons-2026-10-04"></a>[Codex: InputGroup and PasswordInput contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-input-addons-2026-10-04) |
| <a id="codex-input-otp-2026-10-04"></a>[Codex: Native InputOTP contract (2026-10-04)](./release-0.9.0-verification-archive.md#codex-input-otp-2026-10-04) |
| <a id="codex-combobox-2026-10-04"></a>[Codex: Combobox selection and form contract (2026-10-04)](./release-0.9.0-verification-archive.md#codex-combobox-2026-10-04) |
| <a id="codex-multiselect-2026-10-04"></a>[Codex: MultiSelect tags, validation and form values (2026-10-04)](./release-0.9.0-verification-archive.md#codex-multiselect-2026-10-04) |
| <a id="codex-date-controls-2026-10-04"></a>[Codex: Calendar and native DatePicker (2026-10-04)](./release-0.9.0-verification-archive.md#codex-date-controls-2026-10-04) |
| <a id="codex-dialog-controls-2026-10-04"></a>[Codex: native Modal, Sheet and Drawer contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-dialog-controls-2026-10-04) |
| <a id="codex-popover-2026-10-04"></a>[Codex: native Popover contract (2026-10-04)](./release-0.9.0-verification-archive.md#codex-popover-2026-10-04) |
| <a id="codex-action-menus-2026-10-04"></a>[Codex: DropdownMenu and ContextMenu contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-action-menus-2026-10-04) |
| <a id="codex-cli08-database-guidance-2026-10-05"></a>[Codex: Installed database guidance and cold-start acceptance (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cli08-database-guidance-2026-10-05) |
| <a id="codex-cli08-ui-example-2026-10-05"></a>[Codex: Installed UI example and SSR acceptance (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cli08-ui-example-2026-10-05) |
| <a id="codex-cli08-ui-guides-2026-10-05"></a>[Codex: Expanded installed UI guide examples (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cli08-ui-guides-2026-10-05) |
| <a id="codex-rt11-flash-expiry-2026-10-05"></a>[Codex: Server-enforced flash cookie expiry (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt11-flash-expiry-2026-10-05) |
| <a id="codex-rt11-cloudflare-flash-claims-2026-10-05"></a>[Codex: Cloudflare one-use flash claims (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt11-cloudflare-flash-claims-2026-10-05) |
| <a id="codex-rt01-per-call-deadlines-2026-10-05"></a>[Codex: Per-call RPC deadlines and cancellation (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt01-per-call-deadlines-2026-10-05) |
| <a id="codex-cli08-renderer-guides-2026-10-05"></a>[Codex: Installed renderer API guides (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cli08-renderer-guides-2026-10-05) |
| <a id="codex-cli08-transactions-2026-10-05"></a>[Codex: Installed transaction and rollback example (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cli08-transactions-2026-10-05) |
| <a id="codex-cf04-scaffold-guidance-2026-10-05"></a>[Codex: Accurate Cloudflare scaffold resource guidance (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cf04-scaffold-guidance-2026-10-05) |
| <a id="codex-cf04-static-resource-plan-2026-10-05-index"></a>[Codex: Static Cloudflare resource plan (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cf04-static-resource-plan-2026-10-05) |
| <a id="codex-rt11-process-flash-claims-2026-10-05"></a>[Codex: Process-local flash replay claims (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt11-process-flash-claims-2026-10-05) |
| <a id="codex-rt12-navigation-fixture-2026-10-05"></a>[Codex: Navigation ownership browser acceptance (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt12-navigation-fixture-2026-10-05) |
| <a id="codex-rt24-typed-paths-2026-10-05-index"></a>[Codex: Reject misspelled typed configuration paths (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt24-typed-paths-2026-10-05) |
| <a id="codex-rt12-construction-rollback-2026-10-05-index"></a>[Codex: Roll back partial service-scope construction (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt12-service-scope-construction-rollback-2026-10-05) |
| <a id="codex-cf08-rpc-logging-2026-10-05-index"></a>[Codex: Correlated RPC failure logs (2026-10-05)](./release-0.9.0-verification-archive.md#codex-cf08-rpc-logging-2026-10-05) |
| <a id="codex-rt20-safe-hydration-diagnostics-2026-10-05-index"></a>[Codex: Safe hydration mismatch diagnostics (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt20-safe-hydration-diagnostics-2026-10-05) |
| <a id="codex-rt10-form-controller-2026-10-05-index"></a>[Codex: Typed headless form controller foundation (2026-10-05)](./release-0.9.0-verification-archive.md#codex-rt10-typed-headless-form-controller-2026-10-05) |

<a id="codex-rt24-generated-config-2026-10-05"></a>
### Codex: Generate configuration factory types (2026-10-05)

Vite configuration tooling now generates `.cossack/config.d.ts` from flat config
factory filenames and refreshes it on development additions, changes and removals.
Type-only references infer factory return shapes without evaluating modules or
copying values. A separate generated registry preserves explicit authored
registry overrides. Scaffold TypeScript includes the generated declaration and
Git ignores it. The Node-only `framework/config-codegen` export supports explicit
pre-typecheck generation and a no-write preview; authored or symlinked output
files are protected. Server config discovery now excludes declarations/tests/specs.

**Verification:** framework config-codegen/config/route-codegen suites pass
**32/32**, including actual compiler checks with `skipLibCheck: false`, inferred
nested paths, bad defaults/paths and authored override precedence. Scaffold suite
passes **81/81**, including generated include/ignore assertions. Framework
`tsc -p tsconfig.declarations.json`, root `pnpm tsc --noEmit`, emitted tooling
import/no-write preview and task-owned diff checks pass. A read-only subagent
review found interface-return and symlink-discovery issues; Codex fixed both and
reran the combined framework tests.

**Limits:** RT-24 remains open. Standalone CLI generation/inspection, required
variable and binding metadata/coercion, selected-environment preflight, and full
secret-redaction/request-isolation acceptance remain. Tests prove no factory
execution/source-value copying and an empty client virtual module, but a fresh
installed app/browser bundle gate was not run for this checkpoint. Config types
require generation before standalone typechecking; Vite performs it on startup.
Task counts remain **34 complete / 24 open**; Desktop platform checks stay waived.

<a id="codex-rt24-config-cli-2026-10-05"></a>
### Codex: Configuration CLI and installed acceptance (2026-10-05)

`cossack config` catalogs filename-based factory keys and type origins without
reading source or executing modules. JSON explicitly reports evaluation and
validation as not performed. `--generate` emits configuration declarations;
`--generate --dry-run` preserves existing output and creates no missing output.
Read-only discovery remains available when generation would conflict with an
authored file. Shared command validation rejects unknown options before writes.
The generator exports discovery separately; Vite and CLI retain one file scope.
Agent documentation, CLI help/README and config/architecture specs explain the
workflow and its limits. A real client build proves the virtual configuration
module excludes factory code and private-value sentinels.

Codex integrated an exclusive-file CLI implementation subagent and a read-only
requirements/review subagent. Review corrected documentation about factory scope
and clarified that filename discovery does not validate default exports.

**Verification:** combined CLI config/command-spec/documentation suites pass
**34/34**; combined framework codegen/config/routes/publication suites pass
**50/50**; core form-controller tests pass **9/9**. Core build, framework declaration
emission, root `pnpm tsc --noEmit`, and task-owned diff checks pass. Fresh
`COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` passes 76 packaged examples,
four auth examples, offline CLI/MCP checks and installed Cloudflare browser
trace/guidance/source-map stripping checks. The new installed configuration
acceptance helper passes separately against that retained tarball app: packaged
CLI generation, typed paths/default errors, stable regeneration and removal.
The local smoke script now invokes this helper before documentation acceptance.

The first installed gate found a real pre-existing RT-10 declaration error:
`FormController<S>` parsing resolves through its object constraint. The validated
result now retains the correlated `InputOf<S>` type, with typed parsed-value
assertions and successful core declaration emission. RT-10 remains open.

**Limits:** installed configuration checking follows the scaffold's
`skipLibCheck: true` policy; the focused generator compiler test separately uses
`skipLibCheck: false`. Published cache declarations still require Worker ambient
types for strict declaration checking, which this installed fixture does not
supply. The initial strict installed attempt failed for missing
`DurableObjectState`, not generated registry inference. No global compatibility
claim follows from the installed gate.

RT-24 remains open: SSR and SSG build factories before entering the request
config scope, so imported required helpers inside factories cannot read that
pending environment. Required variable/binding metadata, coercion, runtime
applicability, selected-environment preflight and full isolation/hydration
redaction acceptance remain. The virtual-module sentinel test does not prove all
direct-import or hydration secrecy. Counts remain **34 complete / 24 open**;
Desktop-only platform acceptance remains waived. No external deployment or
remote resource provisioning occurred.

<a id="codex-rt24-factory-scope-2026-10-05"></a>
### Codex: Prepare factories in their request binding scope (2026-10-05)

SSR and SSG previously evaluated factories before entering the configuration
scope, so imported required helpers saw no bindings or could inherit an outer
scope. `prepareConfigStore` now evaluates synchronous factories inside a fresh
scope containing the selected bindings and an empty config tree. It publishes
the completed tree only after factories succeed, then SSR/SSG use that store for
downstream work. Nested preparation restores its caller on success and failure.
Missing factory requirements stop subsequent factories, user middleware and
page lifecycle. SSG supplies only APP_URL and fails named required live bindings.
The low-level buildConfig evaluator remains available; it does not create a scope.

Codex integrated the exclusive-file scope-test subagent and reviewed all changes.
Coordinator-owned actual router/SSG tests verify interleaved HTTP requests,
omitted environments, required helper failures and middleware exclusion. The
packaged request-config guide now demonstrates scoped preparation.

**Verification:** eight focused framework suites pass **94 tests** (71 scope,
config/router/SSG/CORS tests plus 23 SSG public/service/global tests). The changed
runtime-preparation suite was rerun **5/5** after adding middleware assertions.
Framework declaration emission, root `pnpm tsc --noEmit` and task-owned diff
checks pass. Fresh `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` passes the
installed config CLI/inference/removal helper, 76 packaged examples, four auth
examples, offline CLI/MCP checks, installed Cloudflare HTTP/SSE/WebSocket and
packaged guidance/source-map stripping acceptance, and UI documentation parity.
Its real workerd fixture now verifies concurrent prepared request values, raw
D1 binding identity, and named missing-binding diagnostics excluding a private
sentinel. Retained evidence: `/tmp/cossack-local-pack-VQ1yPC`.

The Worker acceptance follows current [Cloudflare ALS documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/)
and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/);
Codex retrieved current types and inspected Wrangler's config schema before
extending the local harness. No remote resources were created or deployed.

**Limits:** required helpers still validate when called, rather than reading
independent declarations before the first factory. Variable/binding metadata,
coercion, runtime applicability, selected-environment preflight and full
classification/hydration secrecy remain. Async factories remain unsupported.
Installed config checking retains scaffold skipLibCheck policy; strict cache
ambient-type acceptance remains separate. RT-24 stays open; counts remain
**34 complete / 24 open**. Desktop remains complete by user decision, with its
remaining platform checks waived.


<a id="codex-rt24-declared-requirements-2026-10-05"></a>
### Codex: Declared configuration requirements (2026-10-05)

Author: **Codex**. RT-24 remains open; counts remain **34 complete / 24 open**.
Literal named requirements now declare scalar types/coercion, required names,
secret classification, binding kinds and runtime applicability. The portable
checker validates all active declarations before the first factory. Typed scalar
accessors preserve legacy string env behavior. SSR, SSG and realtime replay use
fresh preparation; snapshots preserve the originating runtime/environment and
replay fails closed before middleware, authorization and operations.

Node-only AST inspection never evaluates application modules. Dynamic, mutated,
unsupported or ambiguous exports remain unknown. CLI config --check, check
cloudflare and deploy use private selected Wrangler declarations and the same
checker. Invalid deployment requirements stop before tool execution or artifact
writes. Catalogs contain metadata/names, not raw or parsed scalar values. Remote
resources and secrets remain explicitly unverified. Binding checks are structural.

See [configuration contract](./config.md#declared-requirements-codex-2026-10-05),
[detailed plan](./release-0.9.0-plan.md#rt-24) and
[verification record](./release-0.9.0-verification-archive.md#codex-declared-configuration-requirements-2026-10-05).

**Verification:** 800 framework tests, 62 CLI/shared-inspection tests and 18
actual stdio MCP tests pass. Framework declaration
emission and root `pnpm tsc --noEmit` pass. Fresh installed tarballs pass config
CLI/inference and failure-before-write checks, 76 packaged examples plus four
auth examples, real D1/workerd requirement validation, Cloudflare HTTP/SSE/
WebSocket browser checks, guidance and production stripping. Retained gate:
`/tmp/cossack-local-pack-5dbkLj`. Exact counts and logs are in the linked archive.
A real Vite SSR build also proves metadata/environment collection without factory
evaluation and validation before factory entry.

**Limits:** Direct Vite preflight, Node/Deno declaration-source support and full
hydration secrecy remain.
Secret classification cannot prevent deliberate application exposure. Async
factories and strict installed cache ambient-type checks remain separate. Desktop
stays complete by user decision; remaining platform checks are waived.

<a id="codex-rt24-direct-vite-preflight-2026-10-05"></a>
### Codex: Direct Vite configuration preflight (2026-10-05)

Author: **Codex**. Direct builds now check Cloudflare requirements through the
same Node-only private Wrangler reader as CLI inspection and deployment, before
type generation and output cleanup. Explicit target options and project metadata
select the runtime; named environments use their own declarations. Build/watch
cycles reread metadata and declarations. Node/Deno builds check metadata and
compatibility while leaving supplied values unverified. Development startup
permits incomplete configuration. Failed build/render hooks suppress SSG
publication, and deployment's secondary parser failure is sanitized.

**Verification:** 1,686 framework tests, 73 combined CLI/deployment/stdio MCP tests,
framework declaration emission and root `pnpm tsc --noEmit` pass. The focused
131-case suite includes 15 direct-build cases. Fresh installed direct Vite
failure-before-write, config inference, 76 usage examples + 4 auth examples,
real D1/prepared-config workerd checks, reporter parity and Cloudflare
HTTP/SSE/WebSocket browser traces, packaged application/source-map stripping,
UI contracts and offline documentation parity pass. Full installed gate exits 0.
Exact evidence and limits:
[verification archive](./release-0.9.0-verification-archive.md#codex-direct-vite-configuration-preflight-2026-10-05).

**Remaining:** RT-24 stays open for Node/Deno declaration-source policy and full
classification/hydration secrecy acceptance. Secret existence and resource
readiness remain unverified. Counts remain **34 complete / 24 open**. Desktop
platform checks remain waived. Versions remain 0.8.3 until REL-04.

<a id="codex-server-failures-hydration-2026-10-05"></a>
### Codex: Safe HTTP/SSR failures and private hydration (2026-10-05)

Author: **Codex**. Unexpected native/class API failures, SSR rendering/router
cleanup and unhandled config/middleware failures now log safe structured events.
Returned UUIDs correlate with fixed stage/code, authored route and runtime.
Exception data, concrete paths and query values stay out of these events.
Internal class API/request failures return generic JSON with code/requestId.

The installed Cloudflare fixture reads a classified secret into a private field,
then verifies SSR/browser hydration, real RPC, CLI catalogs, delivered JavaScript
and production client source maps contain no private value or factory sentinel.
Explicit public state contains only the safe result. Original fixtures/artifacts
are restored. Classification cannot stop intentional application publication.

**Verification:** 1,696 framework tests, root/package types and script syntax
checks pass. Final fresh installed gate passes all 80 usage/auth examples,
workerd API/config/D1, browser traces, application stripping, CLI/MCP parity,
and private hydration/type/client-map acceptance. Retained:
/tmp/cossack-local-pack-mL6TSQ. The archive records the corrected initial fixture
failure and final rerun.

**Status:** CF-08 and RT-24 remain open; **34 complete / 24 open**. Remaining
log paths, development SSR details, whole-request timing, remote log ingestion,
production source-map resolution and budgets still need work. Native Node/Deno
hydration and declaration-source policy remain unverified. Desktop checks stay
waived; versions stay 0.8.3. See the [verification record](./release-0.9.0-verification-archive.md#codex-safe-http-ssr-failures-and-private-hydration-2026-10-05)
and [logging contract](../docs/server-logging.md).

<a id="codex-core-node-redaction-2026-10-05"></a>
### Codex: Core and Node runtime failure redaction (2026-10-05)

Portable core diagnostics replace raw exceptions in component actions, iterator
cleanup, server task setup/cleanup, asynchronous component cleanup and service
rollback/disposal. Metadata is captured before teardown; missing or throwing
request context metadata cannot break cleanup. Durable Object malformed frames
and delivery failures, shared socket missing-target/authentication diagnostics,
and Node authentication/scope/bootstrap/state/upgrade/socket/cleanup paths use
fixed structured events. Incoming socket target/action labels are not logged.
Browser task diagnostics and controlled socket-close behavior are preserved.

CF-08 remains open. Adapter events may have unavailable IDs and unknown authored
labels; Node in-memory callbacks use generic dispatch stages. Task setup duration
starts at failure capture. Component update catches, Deno, development SSR error
pages, manifest/SSG/access logs, whole-request timing, remote Workers Logs,
production source-map resolution and budgets remain open. No live deployment or
fresh installed-tarball gate is claimed for this checkpoint. Release status stays
**34 complete / 24 open**. Desktop remains complete with platform checks waived.

Verification: Node adapter **33/33**, framework RPC/stream/logging **501/501**,
root `pnpm tsc --noEmit`, Node package no-emit check, core build/declaration emit,
Node build/declaration emit and framework `build:types` pass. Full core results
are recorded below after the final serial run. Core package-wide no-emit remains
failing in untouched `form-controller.test.ts` (two diagnostics) and
`rpc-conformance.test.ts` (two missing `loading` members); framework package-wide
no-emit also reports unowned source/test diagnostics. These are not claimed as
passed; its production declaration build succeeds. The introduced fixture Hono
context typing error was corrected.

Earlier full core runs exposed and corrected three partial-context lifecycle
regressions and a socket test fixture missing `readyState`. Another run overlapped
core dist rebuilding and failed seven published-declaration fixtures; the final
run uses completed builds and no concurrent dist writers. Logs:
`/tmp/cossack-runtime-redaction-{core-serial,node-final,framework-final,types-final,core-types-final,node-types,framework-types,build-final,node-build,framework-emit}.log`.

Final serial full core suite: **1580/1580 tests across 97 files pass**. Final owned-file whitespace check passes. No fresh installed tarball or remote Cloudflare check ran.

<a id="codex-framework-deno-redaction-2026-10-05"></a>
### Codex: Framework, SSG and Deno runtime redaction (2026-10-05)

Development SSR fallback HTML now includes only a fixed code, managed UUID and
bounded authored route. Exception stacks/messages/custom values are omitted.
Authored error boundaries and response statuses remain intact. Manifest, CSS,
Durable Object state and SSG loader/render/cleanup catches emit fixed metadata.
SSG failed-page messages retain a fixed public-route code or generic failure;
original cleanup causes remain available for control flow without being logged.
Optional access logging records matched authored templates and allowlisted methods,
not concrete paths or queries. Core server update catches now omit exceptions;
browser diagnostics and explicit propagated navigation errors retain behavior.

Request-context middleware captures monotonic entry time. Managed API/SSR/global
failure durations now include downstream configuration and middleware; standalone
handlers retain a local start fallback. This excludes pre-framework transport,
startup and background work. Deno socket/runtime/development catches use fixed
metadata; shared in-memory callbacks use generic dispatch stages rather than
misclassifying delivery as parsing. Controlled socket closure remains unchanged.

CF-08 and RT-24 remain open; **34 complete / 24 open**. Deno Vite module
transport/load/reload compiler-channel review, native Deno startup/cleanup fault
acceptance, remote Worker log ingestion, production source-map resolution and
artifact/startup budgets remain. Desktop is closed with platform checks waived.
No remote deployment or provisioned resource was used.

Source verification: final full framework suite **1705/1705 across 91 files**
passes with `--testTimeout=30000`; full core **1581/1581 across 97 files** and
configured Deno suite **30/30 across 5 files** pass. Root `pnpm tsc --noEmit`,
core build/declaration emit, Deno build/declaration emit and framework
`build:types` pass. The first framework run had **1697 passes / one five-second
SSG globals timeout**; the full extended-timeout rerun passed, followed by another
full run after final agent additions. No timeout is recorded as a pass or waiver.
Native Deno subprocess fault acceptance did not run (no `deno` executable on
PATH); Node-based tests cover adapter socket/cleanup semantics, not actual
Deno development startup faults. Deno Vite compiler-channel work remains open.
Logs: `/tmp/cossack-redaction-phase2-{core-tests,framework-verified,deno-tests,root-types,core-build,deno-build,framework-types,installed}.log`.

Final installed verification: `COSSACK_KEEP_SMOKE=1 node
scripts/test-local-scaffold.mjs --agent-docs-only` **passes** from freshly built
and packed non-Desktop packages. It verifies generated app types, configuration
preflight, all 80 packaged usage/auth examples, local D1/workerd prepared config,
HTTP/SSE/WebSocket browser traces, CLI/MCP parity, production stripping and private
config SSR/browser/RPC/client-JavaScript/source-map secrecy. Retained fixture:
`/tmp/cossack-local-pack-KrpbyE`. This existing gate proves package integration;
new deliberate SSR/SSG/Deno failure cases are source regression evidence, not
remote logging or native Deno fault acceptance. Final Deno rerun after correcting
the generic dispatch callback: **30/30** (`deno-final.log`). Final root typecheck
and owned-file diff checks pass. Reports and `.zcodeignore` remain untouched and
excluded from the commit.

<a id="codex-cf08-budgets-deno-transport-2026-10-05"></a>
### Codex: Project size budgets and Deno development transport (2026-10-05)

`package.json` literal `cossack.buildBudgets` now configures warning/error limits
for upload/gzip KiB. CLI build and deploy share a local measurement service after
fresh Cloudflare artifact validation. Stale redirects are removed before builds.
A violated error budget stops before upload; warnings allow continuation. Dry-run
deployment reuses the measurement instead of invoking deployment twice. JSON
reports selected metrics/limits and fixed diagnostics; private tool stdout/stderr
is bounded and omitted. Unsupported precision, ambiguous summaries, missing
metrics, malformed settings and tool failures cannot pass a hard budget.
Wrangler reports two decimals; comparisons use its upper rounding interval,
not invented exact bytes. `providerStartupMs` remains unavailable locally and
fails a configured hard gate; build duration is not substituted for startup.

Deno Vite invoke/startup/socket/reload/proxy catches now emit fixed events and
safe HTTP500/502 bodies without forwarding arbitrary exceptions into Vite's
public error renderer. Authenticated compiler results remain unchanged on the
private ModuleRunner channel. Recovery/socket destruction remain covered.
Deno 2.9.6 was obtained with pnpm's temporary tool runner; native smoke includes
real socket action-failure redaction and preserved1013 closure.

CF-08 remains open; **34 complete / 24 open**. Budgets currently require CLI
Cloudflare build/deploy paths, not direct Vite or Node/Deno artifacts. Provider
startup/local profiling, production source-map resolution and remote log
acceptance remain. Native Deno development startup/cleanup fault fixtures remain
open despite passing native socket smoke. Desktop remains closed by user decision.

Verification: final combined budget/deployment suites **44/44 across 5 files**
pass, including a real generated Cloudflare app that generates types, builds,
verifies the artifact and rejects an actual measured size before upload.
Initial fixture runs stopped at existing APP_URL preflight because the generated
URL was localhost; corrected to an HTTPS test URL, then the real budget failure
passed. Reviewer-found summary precision, manifest parse privacy and rejected
tool resolution gaps have regressions and fixed diagnostics.

Full Deno adapter suite **34/34 across 6 files** and native Deno socket smoke
**2/2** pass. Deno build/declaration emission and root `pnpm tsc --noEmit` pass.
CLI JSON matrix initially **54/54** passes in the combined 72-case run; after
final source changes, all **4 selected build/deploy cases** pass with 50 unrelated
cases skipped. Final generated/combined run includes budget-step reporting and
warning-only dry-run reuse. Syntax checks and owned-file diff checks pass.
Logs: `/tmp/cossack-budget-{complete,cli-final,deno-tests,deno-native-final,deno-build,typecheck-verified}.log`.
The earlier precision/input/rejection fixes were reviewed independently.
No fresh full tarball gate ran in this checkpoint; the actual measurement helper
also checked the retained prior installed artifact locally (539.89 KiB upload /
157.41 KiB gzip) and rejected a 0.001 KiB threshold. This is local tool evidence,
not provider startup, deployed source-map resolution or remote logs. Existing
package-wide type failures recorded previously remain outside this checkpoint.
Reports and `.zcodeignore` remain untouched and excluded from staging.

<a id="codex-package-type-repair-2026-10-05"></a>
### Codex package type repair (2026-10-05)

Fixed raw schema typing for noncoercing fields, typed whole-object config access,
locale inference and optional CORS config reads. Added negative published raw-input
type fixtures, compiled config-subtree assertions and runtime config/CORS coverage.
Reviewed and integrated the exclusive framework fixture-repair agent; a second
agent audited direct Vite budgets without edits or tests. See the
[verification record](./release-0.9.0-verification-archive.md#codex-package-type-repair-2026-10-05)
for final commands and results. Core **1,581/97** and framework **1,707/91**
tests/files pass, as do root/core/framework/Node types and declaration builds.
No parent acceptance row closes: RT-10, CF-08 and
REL-03 retain their remaining criteria. Counts stay **34 complete / 24 open**.
Desktop remains complete by user decision; platform checks remain waived.

<a id="codex-direct-vite-budgets-2026-10-05"></a>
### Codex opt-in direct Vite budgets (2026-10-05)

Added the primary-Worker application build gate and shared Node-only budget/artifact
APIs. Real staging builds exposed double environment selection; built reads,
measurement and final CLI deployment now clear ambient selection. Framework
**1,716/94** tests/files and relevant CLI suites pass; root/package types,
declarations and fresh non-Desktop installed acceptance pass. The corrected CLI
was subsequently repacked/reinstalled and its native selected-target dry run
verified. The final CLI JSON matrix passes **54/54** after three multi-process
cases adopt the existing 30-second integration allowance; the initial timeout
failures are recorded. See the [full evidence and limits](./release-0.9.0-verification-archive.md#codex-direct-vite-budgets-2026-10-05).
CLI receipts/default scaffold integration and other CF-08 criteria remain open.
Counts remain **34 complete / 24 open**; Desktop checks remain waived.

<a id="codex-budget-receipts-2026-10-05"></a>
### Codex signed budget receipts and default scaffold (2026-10-05)

CLI build/deploy now reuse the default Cloudflare Vite plugin's measurement when
an invocation-signed receipt matches the settings, environment, complete bounded
artifact inventory, Wrangler identity and Node version. Stale, corrupt, changed
or unsupported receipts cannot skip fresh measurement after a successful build.
A failed build yields structured budget diagnostics only for an authenticated
failing receipt; unrelated build failures remain build failures. New Cloudflare
scaffolds compose the plugin after Cloudflare; Node/Deno recipes strip it.

Verified: framework **1,736/1,736 across 95 files**, affected CLI **56/56 across
6 files**, final native integration **3/3** including successful build/deploy receipt reuse
with zero CLI fallback measurements, scaffold **91 passed / 9 Desktop cases
skipped**, declaration emission and root/framework typechecks. Fresh Cloudflare
installed-package gate passes at `/tmp/cossack-local-pack-gZdSQv`, including
selected-target signed CLI diagnostics, direct limits and privacy. A read-only
subagent found no actionable defects; coordinator owns all implementation.
See [full evidence and limitations](./release-0.9.0-verification-archive.md#codex-budget-receipts-2026-10-05).
No parent task closes: CF-08 remains open. Counts stay **34 complete / 24 open**.
Desktop is complete with remaining platform checks waived. No blocked work.

<a id="codex-custom-config-watch-2026-10-05"></a>
### Codex custom Cloudflare config and watch policy (2026-10-05)

Unified source selection for configuration preflight, page binding checks,
primary-Worker budgets and CLI deployment inspection. Explicit plugin
`configPath` options override `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`; the shared
selector otherwise uses standard root Wrangler files. A missing selected path
fails without fallback. CLI custom paths use the environment variable so type
generation, Vite and artifact validation select the same source.

Budgeted watch builds now reject before building with
`COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED`. Vite application hooks do not validate
every watch generation; no per-rebuild budget support is claimed. Root and
environment options are checked again for mutated custom builders. Unconfigured
budgets and ordinary development receive no added watch restriction.

Verified: full framework **1,757 tests / 96 files**, affected CLI **60 / 6 files**,
root/framework typechecks, declarations and script syntax. Native tests include
nested selected-environment CLI reuse, direct explicit config paths and prompt
watch rejection. Initial explicit-path acceptance exposed the page binding
reader's missing option; it was fixed and combined checks rerun successfully.
See [evidence and limits](./release-0.9.0-verification-archive.md#codex-custom-config-watch-2026-10-05).
CF-08 remains open; **34 complete / 24 open**, no blocked work. Desktop remains
complete with platform checks waived.

Installed acceptance also found and repaired `cossack build` relying on the
parent PATH: JSON/budgeted and human builds now resolve the project's own Vite
through the shared project-tool runner. The final CLI total above includes both
new unbudgeted command regressions and native receipt reuse.

SSG's URL reader now shares source selection and accepts the matching path option
on getSiteUrl/cossackSsg. JSONC/TOML regressions cover selected environments and
missing-source behavior; the final framework total above includes them.

Final focused installed-package acceptance passes with updated framework/CLI
tarballs in `/tmp/cossack-local-pack-gZdSQv/minimal-production` (Vite 8.3.2 /
Wrangler 4.147.0), including published SSG URL discovery. This is a retained
fixture update, not a fresh full release matrix; details are in the archive.

<a id="codex-local-startup-2026-10-05"></a>
### Codex local Worker startup budgets (2026-10-05)

Implemented opt-in `localStartupProfileMs` and `localStartupActiveMs` with
private native Wrangler profiling, numeric-only signed receipt reuse, bounded
subprocess deadlines and failure/cleanup validation. Active samples exclude idle
and include GC. Provider startup remains unavailable locally; these metrics do
not prove production CPU limits. Full framework 1,808 tests / 98 files,
affected CLI 63 tests / 6 files, root/framework types and declarations, native
workspace profiling, deliberate threshold rejection and repacked installed
acceptance pass. See the
[verification record](./release-0.9.0-verification-archive.md#codex-local-startup-2026-10-05)
for CLI results, the initial timeout failures and platform/scope limits.

Independent auxiliary auditing confirms the command currently deploys only the
primary Worker. Its explicit policy/target follow-up is recorded in the
[detailed plan](./release-0.9.0-plan.md#codex-local-startup-plan-2026-10-05).
No parent task closes. CF-08 remains open; counts remain **34 complete / 24 open**.
Desktop remains complete by user decision, with remaining platform checks waived.

<a id="codex-auxiliary-budgets-2026-10-05"></a>
### Codex auxiliary Worker budget policies (2026-10-05)

Implemented literal per-source auxiliary policies, including auxiliary-only
activation, independent environment/source capture, exact fresh artifact matching,
all-target validation before measurement and configuration rechecks before primary
upload/dry-run success. CLI JSON exposes per-Worker safe measurements. Expanded
binding/deployment field comparison also repairs rewritten D1 migration patterns
and empty Cron defaults. All 1,874 framework tests / 101 files and final affected CLI 65 / 6 files
pass; native multi-Worker warning/hard-limit validation passes. Final CLI/package evidence and
initial native failures are recorded in the
[verification archive](./release-0.9.0-verification-archive.md#codex-auxiliary-budgets-2026-10-05).

These policies do not upload auxiliary Workers or add authenticated multi-Worker
receipts. Failed budgeted Vite builds with auxiliary redirects retain generic
build failures; successful builds receive fresh CLI measurements. CF-08 remains
open. Counts stay **34 complete / 24 open**. Desktop is complete by user decision;
remaining Desktop platform checks remain waived.

<a id="codex-runtime-receipt-identity-2026-10-05"></a>
### Codex startup runtime identity and receipt validation (2026-10-05)

Author: **Codex**. Primary startup receipts now bind Wrangler-resolved Miniflare,
workerd manifests/loaders, the actual native executable and runtime override/
autogate settings. Unsupported fallbacks and nonabsolute overrides decline reuse.
Directory traversal, redirect reads and runtime/tool bytes are bounded. Empty
Wrangler temporary directories do not invalidate an otherwise unchanged module
inventory; adding a file does. Malformed fingerprint and partial configured size
evidence cannot authorize reuse or turn an unavailable metric into zero.

Verified: **1,926 framework tests / 102 files**, **65 affected CLI tests / 6 files**, root/framework typechecks, declarations and changed-package installed startup/custom-config acceptance. See [verification and limitations](./release-0.9.0-verification-archive.md#codex-runtime-receipt-identity-2026-10-05).
CF-08 remains open for authenticated aggregate receipts, broader module graphs,
provider startup, production source maps and remote logs. No release task closes;
counts remain **34 complete / 24 open**. Desktop remains complete with its
platform checks waived.

<a id="codex-rt12-rt27-complete-2026-10-05"></a>
### Codex: RT-12 and RT-27 complete (2026-10-05)

Both tasks meet their full criteria. Core: 100 tests/6 files; framework: 87/8;
CLI localization/static ownership: 45/3; MCP: 19/1. Generated production Node
and Cloudflare ownership: both cases passed. Root/core/framework typechecks,
framework declaration build and changed-package installed localization acceptance
passed. [Criteria, results and limits](./release-0.9.0-verification-archive.md#codex-rt12-rt27-complete-2026-10-05).
Release: **34 complete / 24 open**. Desktop remains complete with its checks waived.

<a id="codex-rt21-rt29-complete-2026-10-05"></a>
### Codex: RT-21 and RT-29 complete (2026-10-05)

SSG combined checks: 105 tests/8 files; test-utils: 17/3. Both generated
Node/Cloudflare helper cases pass, as do installed helper runtime/type imports
and installed generated Cloudflare SSG artifacts. Root/framework/test-utils
typechecks and builds pass. [Full criteria and limits](./release-0.9.0-verification-archive.md#codex-rt21-rt29-complete-2026-10-05).
Release: **34 complete / 24 open**; Desktop checks remain waived.

<a id="codex-rt20-rt24-complete-2026-10-05"></a>
### Codex: RT-20 and RT-24 complete (2026-10-05)

Renderer: 343 tests/25 files; Core: 1,587/100; combined framework config/source
metadata: 147/6. Generated Node hydration: 3/3; native Node/Deno configuration:
2/2. Fresh installed Node development/production hydration: 3/3; installed Node
and Deno configuration type/tooling/SSR/RPC/browser/secrecy acceptance passed.
Root and renderer/core/framework typechecks and builds passed.
[Full criteria, commands and limits](./release-0.9.0-verification-archive.md#codex-rt20-rt24-complete-2026-10-05).
Release: **36 complete / 22 open**. Desktop checks remain waived. Node/Deno
value inspection remains explicitly unavailable until hosts supply runtime values;
this is not a claim that secrets or remote resources exist.

<a id="codex-rt16-rt22-complete-2026-10-05"></a>
### Codex: RT-16 and RT-22 complete (2026-10-05)

Database: 104 tests/17 files. Framework metadata/SSG/localization: 108/8 plus
42/3 existing scope regressions. Native Markdown acceptance: 6/6. Installed
Markdown: five behavior/type/rejection cases plus the focused parser retry pass;
installed SQLite plan runtime/types pass. Root/package typechecks, builds,
Workers-safe database bundle audit and owned whitespace checks pass.
[Full criterion audit, commands, retry and limits](./release-0.9.0-verification-archive.md#codex-rt16-rt22-complete-2026-10-05).
Release: **38 complete / 20 open**. No remote provider acceptance is claimed.
Desktop checks remain waived; versions stay 0.8.3 until REL-04.

<a id="codex-rt10-rt15-rt17-complete-2026-10-05"></a>
## Codex: RT-10, RT-15 and RT-17 completed (2026-10-05)

Closed all three parent tasks against their full acceptance criteria. Native and
fresh installed Node/workerd browser forms prove nested errors, keyboard/focus,
file multipart RPC, stale work, single-flight submission and reset. Actual SQLite,
embedded Turso, PostgreSQL 18 and MySQL 8 prove generated keys and transaction
commit/rollback/savepoints. Studio and CLI share read-only database inspection,
selected environments, safe metadata and migration history, with owned disposal.
[Full commands, retries and limits](./release-0.9.0-verification-archive.md#codex-rt10-rt15-rt17-complete-2026-10-05).
Core1595/101, database123/20, Studio69/12, affected focused retries, public types,
builds, bundle audit and required root typecheck pass. Installed browser3/3 and
SQLite/Studio/CLI acceptance pass. Release: **41 complete / 17 open**.
No batch blocker; remote Cloudflare and remote Turso were not verified. Desktop
checks remain waived. Versions remain 0.8.3 until REL-04.

<a id="codex-svc01-svc05-complete-2026-10-05"></a>
## Codex: SVC-01 and SVC-05 complete (2026-10-05)

Closed both full acceptance rows: typed jobs execute through an actual generated
Queue consumer with durable D1 state; Turnstile verification protects mutations
and the widget handles reset, failures, expiry, disposal and resubmission on Node
and Cloudflare. Coordinator integration fixed duplicate retry-delay bypass and
widget document adoption. Source and fresh installed acceptance, public types and
four executable guides pass. [Commands, criterion proof and limitations](./release-0.9.0-verification-archive.md#codex-svc01-svc05-complete-2026-10-05).
Release: **43 complete / 15 open**. CF-04/08 and REL-02/03 remain open; this batch
uses local providers and does not prove account deployment or real Turnstile
challenge service operation. Desktop checks remain waived. Versions stay 0.8.3.

<a id="codex-svc02-svc03-complete-2026-10-05"></a>
## Codex: SVC-02 and SVC-03 complete (2026-10-05)

Both full criteria are closed: named schedules execute shared jobs through actual
generated Cron/Queue/D1; notifications compose typed escaping, scoped preferences,
durable fenced state, read/unread isolation and explicit Cloudflare/SMTP adapters.
Source and fresh installed acceptance prove duplicate suppression, cleanup, safe
rejection retry and uncertain-send persistence without resending. CLI/MCP static
schedule inspection and four new installed strict/executable guides pass.
[Full criteria, commands, fixes and limits](./release-0.9.0-verification-archive.md#codex-svc02-svc03-complete-2026-10-05).
**45 complete / 13 open**. No batch blocker. Remote email/resource deployment is
unverified; no exactly-once external delivery or automatic Cron redelivery claim.
Desktop checks remain waived. Versions stay 0.8.3 until REL-04.

<a id="codex-rt01-rt11-complete-2026-10-05"></a>
### Codex: RPC and session acceptance complete (2026-10-05)

RT-01 and RT-11 close against their original criteria. Final Core suite: **1,674
/ 105 files**; added close regressions: **14 focused tests**. Relevant combined
framework suite: **581 / 7 files**, final affected sockets **6 / 2 files**;
Node adapter **38 / 7 files**. Root and Core/framework/Node typechecks pass.
Native pre-header disconnects pass on Node and direct workerd; native browser
consumption/readiness/eviction/restoration and installed final Core pass.
Session concurrency passes **2 source + 2 installed native cases** (SQLite/D1).
[Criterion mapping, exact commands and limitations](./release-0.9.0-verification-archive.md#codex-rt01-rt11-complete-2026-10-05).
**47 complete / 11 open**; no batch blocker. Desktop checks remain waived.

<a id="codex-rt26-complete-svc04-open-2026-10-06"></a>
### Codex: Storage complete; Workflow native acceptance open (2026-10-06)

**RT-26 is complete.** Portable authorization/signing and streamed local/R2/S3
providers pass CRUD, cross-user denial, expiration, cancellation, metadata and
bounded transfer acceptance. Native R2 transfers 20 MiB. Final installed public
imports/types, S3 SDK protocol tests and local filesystem tests pass. Image
configuration/transform diagnostics and public-import documentation are verified.
Installed checks caught and fixed the S3 SDK's missing runtime dependency.

**SVC-04 remains open.** Contracts, local tests, native bridge, generated bindings
and CLI/MCP inspection are verified. Native invocation and completed/retried steps
work after fixing RPC-safe JSON records and direct RPC method invocation. The
strict native waiting-status assertion still fails: Miniflare reports `running`
after step outputs `[1,2]`, with first effect once and retry effect twice. Its
implementation never assigns Waiting. Restart/resume/event completion and native
failure/installed Workflow acceptance are not proven. The two failed acceptance
fixture files remain batch-owned and uncommitted; the assertion is preserved.

Source verification: Core **1716/107 files**; relevant framework **529/6**, then
final Workflow bridge **3/1**; Node **47/8**; scaffold **164/11**; CLI contracts/MCP
**141/3** plus Workflow inspection **2/1**. Root and affected package typechecks
pass. [Criterion mapping, commands and limits](./release-0.9.0-verification-archive.md#codex-rt26-complete-svc04-open-2026-10-06).
**48 complete / 10 open**. Desktop checks stay waived; versions stay 0.8.3.

<a id="codex-cli08-cf04-complete-2026-10-06"></a>
### Codex: CLI-08 and CF-04 completed (2026-10-06)

**50 complete / 8 open.** Resource/command integration: **197 tests pass**;
final account-isolation checks: **18 pass**.
The earlier combined run had 369 passes / 3 failures; five affected fixture cases
pass after correction. All 28 new guides compile and execute from tarballs;
offline CLI/MCP agrees across 109 guides / 116 catalog examples. Root and seven
affected package typechecks exit 0. Markdown runtime dependency and UI catalog
defects found during installed acceptance are fixed.
[Full criteria, exact commands, failed attempts and limits](./release-0.9.0-verification-archive.md#codex-cli08-cf04-complete-2026-10-06).
Remaining: SVC-04, CF-08/09/10, REL-02/03/04/05. Complete CLI/full release matrices
have not passed this batch. Desktop platform checks remain waived, not passed.

<a id="codex-cf10-release-batch-2026-10-06"></a>
### Codex: CF-10 complete; release acceptance batch (2026-10-06)

**51 complete / 7 open.** [Full criterion mapping, commands and limits](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06).
The installed guide passes default/staging build, SSG, dry runs, local dev and
unsupported-parser diagnostics with zero remote attempts. Generated-app CI
executes the guide; hosted CI was not run here.

Installed imports/types and representative generated apps pass their recorded
checks. Seven generated migrations now have complete read-only plans; actual
native D1 model requests pass. Node shutdown passes real signals and HTTP/2.
Initial full CLI: 1,007 passed / 19 failed / 6 skipped; every failure has passing
targeted evidence, and the three skipped Deno cases subsequently execute and
pass. Three Desktop skips are waived. This is composite evidence, not a rerun
claim. Final root plus ten non-Desktop package typechecks pass.

Open: SVC-04, CF-08, CF-09, REL-02, REL-03, REL-04, REL-05. Native Workflow
lifecycle, remote logs/source maps/previews, Deno Deploy/draining and remaining
final release gates retain their full criteria. Versions remain 0.8.3. Applied
legacy callback migration histories reject changed checksums; no history was
rewritten. No cloud mutation, deployment, publication or push occurred.


### Codex: Production maps and release-gate integration (2026-10-06)

**51 complete / 7 open; no numbered task closes.** [Exact commands, failures,
follow-ups and remaining criteria](./release-0.9.0-verification-archive.md#codex-production-source-maps-release-gates-2026-10-06). Native private stack mapping and real
prepared Wrangler upload parts pass in source/installed minimal and Workflows apps;
published Workflow extension is fixed. Migration-history upgrade guidance passes
two real SQLite tests. Shared Sidebar footer rail state and installed behavior pass.

Non-Desktop builds, Framework production/SSG build and database bundle audit pass.
Package units: 5,525 passed / two external-provider skips, plus eight new config
and two new Sidebar cases. Final root and all ten package typechecks pass.
Full CLI: 1,028 passed / one failed / eight filtered; Studio and accidentally
filtered non-Desktop guidance have passing follow-ups. Full browser: 278 passed /
19 failed; all failed cases pass the final 87-case integrated rerun. SSG: six pass.
These are composite results, not single full green invocations or remote proof.
Desktop remains waived; versions stay 0.8.3. Open: SVC-04, CF-08, CF-09,
REL-02, REL-03, REL-04, REL-05. No cloud mutation/deployment/publication/push.


## Codex: native preview CLI and CI batch — 2026-10-06

**51 complete / 7 open; no numbered task closes.** CF-09 now has connected
native execution, account-scoped inspection, immutable-ID cleanup, explicit
staging resources, saved failure state and a rendered CI template. Local tests
and changed-package installed acceptance pass; hosted isolation/cleanup and
required-secret setup remain open. [Exact checks and missing criteria](./release-0.9.0-verification-archive.md#codex-native-preview-cli-ci-2026-10-06).
Desktop stays completed with platform checks waived; versions remain 0.8.3.


## Codex: preview secrets and receipt recovery — 2026-10-06

**51 complete / 7 open; no numbered task closes.** CF-09 now supports required
staging secrets without changing shared defaults, recovers lost tagged receipts
and checks latest ownership before cleanup. Generated-app source/installed
build and native workerd smoke pass; hosted CI proof is still absent.
[Exact evidence and residual criteria](./release-0.9.0-verification-archive.md#codex-preview-secrets-recovery-2026-10-06).
Desktop remains completed/waived; versions remain 0.8.3.


### Codex — native Workflow lifecycle and executable guide (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Source and installed native
acceptance prove retry, external event completion, redacted terminal failure and
persisted pause/process-kill/restart/resume without repeating completed steps.
All four Workflow guide examples compile unchanged with generated types; public
exports also compile under NodeNext, with negative input/event checks.
[Commands, evidence and limits](./release-0.9.0-verification-archive.md#codex-workflow-native-lifecycle-2026-10-06).

Each source/installed batch: **4 pass / 3 files**. Root/all ten non-Desktop
package type checks pass. Desktop remains waived. SVC-04 stays open for native
Waiting status; no Running-to-Waiting substitution. Hosted execution and final
REL gates remain open. Unchanged tarballs reused; no package repack.


### Codex — executable migration guide and native development faults (2026-10-06)

**51 complete / 7 open; no numbered task closes.** All nine unchanged migration
guide TypeScript examples compile under strict Bundler and NodeNext resolution
against source and installed public packages. Native Cloudflare Vite/workerd API
and SSR failures return fixed diagnostics correlated to their own structured log
events. Private exception/cause/path/request values stay out of public output and
logs; editing the failed page recovers in the same process.
[Evidence and limits](./release-0.9.0-verification-archive.md#codex-migration-native-development-2026-10-06).

Source and installed combined checks each pass **2 tests / 2 files**; root/all
ten non-Desktop package types pass. No repack; Desktop waived. CF-08 remote
logs/maps/provider startup and the wider receipt criteria remain open. REL-04
versioning remains gated; type fixtures do not prove application operations.
The serial non-Desktop CLI gate has started, including the strict older Workflow
probe; its result is pending, not passed.


### Codex — terminal CLI gate, scroller race and hosted preparation (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Broad CLI: **1,112 passed,
2 failed, 9 skipped**. The MessageScroller resize/removal race now has a failing
baseline regression and passing source/installed fix with the original <1px
criterion. Strict native Waiting still fails; three non-Desktop omissions pass
separately, six Desktop cases remain waived. Combined source checks **6 / 4 files**,
UI contracts **12 / 12**, installed browser **1 / 1**, root/all ten non-Desktop
types pass. UI alone repacked once. Cached OAuth works; token/CI configuration
is still absent. Hosted preparation passes types/build/dry-run/local native smoke
and client-secret checks; actual hosted verification awaits approval. No cloud
mutation, deployment, publication or push. [Exact evidence and limits](./release-0.9.0-verification-archive.md#codex-cli-gate-scroller-hosted-preparation-2026-10-06).


### Codex — compiler HTTP boundary and aggregate receipt acceptance (2026-10-06)

**51 complete / 7 open; no numbered task closes.** CF-08's complete signed
receipt criterion now covers primary and two selected auxiliary Workers, including
auxiliary-only policies, startup runtime identity, mutations and malformed/partial
receipts. Actual installed public CLI build/deploy dry-run proves one native
measurement per selected Worker per build, with no repeated CLI measurements.
Native malformed server-only compiler HTTP errors have fixed correlated metadata,
private-source redaction, no-store and same-process repair in source and installed
apps. Framework **157 / 8 files**, CLI units **10 / 1** plus related **33 / 3**,
source two-auxiliary regression **1 / 1** (six filtered cases), installed public CLI
**2 / 1**, compiler source/installed **1 / 1 each**, root/all ten non-Desktop types
pass. [Exact evidence, setup failures and limits](./release-0.9.0-verification-archive.md#codex-compiler-aggregate-acceptance-2026-10-06).

CF-08 wider graphs and hosted Logs/maps/startup remain open; no HMR/overlay or
initial-malformed-startup proof. Hosted approval remains pending. Desktop waived;
versions remain 0.8.3. No broad CLI rerun, cloud write, publication or push.


### Codex — preview creation proof and release build (2026-10-06)

**51 complete / 7 open; no numbered task closes.** CF-09 now persists empty
preview creation identity before upload; matching identity plus provider-confirmed
absent latest deployment authorizes no-tag cleanup. Lost creation responses and
foreign identities/deployments still fail closed. Real installed Wrangler 4.147
exposed and fixed the renamed default-bypass flag. Native source and installed
acceptance prove staging upload metadata, failed-delete retry, idempotent cleanup
and preview-only mutation paths. REL-03's non-Desktop native build and database
bundle audit pass through `pnpm build:release`; Desktop is explicitly waived.
Source combined **108 / 4 files**, native source **1 / 1**, installed combined
**38 / 3**, root/all ten non-Desktop types pass. CLI alone packed once; unchanged
artifacts reused. [Exact evidence and limits](./release-0.9.0-verification-archive.md#codex-preview-creation-release-build-2026-10-06). Hosted approval/CI,
Waiting, wider graphs, Deno Deploy and final versioned gates remain open.


### Codex — module graphs and non-CLI unit gates (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Native source and installed
module-graph acceptance prove upload/gzip warnings and hard limits, authenticated
dynamic reuse, and conservative rebundled/external fallback. All eleven
non-Desktop, non-CLI unit suites pass: **5,575 tests / 380 files**, with two
external Database cases unrun. Root/all ten non-Desktop types pass. Actual
installed native Workflow Waiting still fails; no speculative upgrade or weakened
assertion. Core's optional JSON reporter failed; its full standard run passed.
Desktop remains waived; full CLI/final versioned and hosted gates remain open.
[Exact commands, failures and limits](./release-0.9.0-verification-archive.md#codex-module-graphs-unit-gates-2026-10-06).


### Codex — local observability and full development browser gates (2026-10-06)

**51 complete / 7 open; no numbered task closes.** CF-08's local wider-graph
startup and tested malformed-startup/browser criteria are complete in source and
installed consumers. Fixed the public full-reload absolute path leak; private
compiler diagnostics and reload behavior remain intact. REL-03's current full
development browser invocation passes **297 cases**; the initial SSE failure and
serial omission pass after isolated rooms/real readiness, with assertions retained.
Final full Framework **2,089 / 120 files**, native startup **3 each**, native
compiler-browser **1 each**, root/all ten non-Desktop package types pass. Only
Framework packed once. Hosted criteria, native Waiting, Deno Deploy and final
versioned/CLI gates remain open; Desktop waived. [Commands, failures and limits](./release-0.9.0-verification-archive.md#codex-local-observability-browser-gates-2026-10-06).

### Codex — hosted readiness blockers (2026-10-06)

**51 complete / 7 open; no task closes.** Read-only checks confirm GitHub CLI
authentication, an available recorded Deno 2.9.6 binary, and a token requirement
for official Deno Deploy noninteractive identity. Cloudflare CI credentials and
hosted approval remain pending. No code changed; prior checks retained without
reruns. Desktop waived, versions 0.8.3. [Evidence](./release-0.9.0-verification-archive.md#codex-hosted-readiness-blockers-2026-10-06).

### Codex — CF-08 hosted completion (2026-10-09)

**52 complete / 6 open. CF-08 complete.** Real provider tail/stored Logs match
the returned UUID and safe event; provider source map resolves src/index.ts:25.
Native deployment reports 10 ms startup. All eight hosted evidence criteria pass,
23 assertion regressions pass, root/all ten non-Desktop types pass. Temporary
Worker, Workflow, D1 and owned DO namespace are verified absent after cleanup.
Hosted native Waiting still fails; Deno personal-token REST cleanup is blocked.
No CI/push/publication/version bump; Desktop waived. [Exact evidence](./release-0.9.0-verification-archive.md#codex-hosted-cf08-complete-2026-10-09).

### Codex — Deno Deploy acceptance verified (2026-10-09)

**52 complete / 6 open; no numbered task closes.** REL-02/03 gain real hosted
installed compiled-artifact acceptance: POST body/two cookies, production assets,
hydration and HTTP/SSE/WebSocket mutations. Exact UUID cleanup and independent
GET404 pass. Hosted test: 1 passed; root and all ten non-Desktop package types
pass. Desktop checks remain waived. Final artifact/full CLI gates, native
Waiting and hosted CI remain open. [Evidence](./release-0.9.0-verification-archive.md#codex-deno-deploy-hosted-2026-10-09).

### Codex — SVC-04 complete; provider and CI batch (2026-10-09)

**53 complete / 5 open. SVC-04 complete against its original criteria.** Existing
source/installed native restart/event/retry/failure evidence plus actual hosted
REST/binding/inspection Waiting close the original lifecycle requirements.
The new expanded hosted test is still red; it does not replace the failing
strict local probe or establish a green full CLI gate. All temporary resources
are confirmed absent. Actual PostgreSQL18.6/MySQL8.0.46 acceptance: 6 passed,
zero skips; cleanup regressions4 pass. CI preparation/evidence assertions are
verified locally; hosted CI awaits the promised portable token. Final root/all
ten non-Desktop types pass. Versions0.8.3; Desktop waived.
[Commands, failed attempts and exact remaining gates](./release-0.9.0-verification-archive.md#codex-svc04-waiting-provider-ci-2026-10-09).

### Codex — hosted preview CI and public-artifact gates complete (2026-10-09)

**55 complete / 3 open. CF-09 and REL-02 complete.** Fixed actual native
deployment response parsing and preserved generated pnpm build approvals in the
portable CI fixture. Three real GitHub runs prove successful create, intentional
smoke failure and cleanup retry; immutable journals/provider absence, staging
isolation and unchanged production all pass. Hosted suite: **28 passed**. Combined
local checks: **159 passed / 1 hosted opt-in skipped**; the hosted case subsequently
ran and passed. Root `pnpm tsc --noEmit` passes. Two installed recipe/native-empty
cleanup checks passed at the preceding normalization repair; final changed-CLI
behavior is proven by the hosted run. Only changed CLI artifacts were repacked.
Independent final resource/repository cleanup passes. REL-03 strict local Waiting/
full CLI stays red; REL-04/05 remain gated. Desktop remains waived.
[Commands, failed iterations, retained evidence and limits](./release-0.9.0-verification-archive.md#codex-hosted-ci-complete-2026-10-09).

### Codex — hosted Workflow lifecycle and installed agent scenario (2026-10-09)

**55 complete / 3 open; no numbered task closes.** Expanded hosted Workflow
acceptance passes **5/5**, including pause/resume, both three-channel Waiting
observations, event/retry effects and terminal failure. Owned Worker/Workflow/D1/DO
cleanup is independently verified. Installed scenario 4 now proves the full
inspect/plan/preserve/apply/check/CLI-MCP sequence. Combined local checks:
**5 passed / 1 hosted opt-in skipped**; that hosted case passes separately. Root
`pnpm tsc --noEmit` passes. No packages repacked or user files staged.
Strict local Waiting/full CLI remains blocked by the simulator's missing native
transition; final versions and cross-feature scenarios 1/2/3/5 remain required.
Desktop stays waived. [Commands and exact scope](./release-0.9.0-verification-archive.md#codex-workflow-lifecycle-agent-scenario-2026-10-09).

### Codex — cross-feature scenarios 1, 2 and 3 complete (2026-10-09)

**55 complete / 3 open; no numbered task closes.** Three combined installed
acceptance cases pass: protected typed resource/URL filter/validated edit and
unauthorized effect-free denial; two permitted realtime editors across native
Workers with convergence, explicit TCP cancellation and private-scope observer;
request-return/native Queue retry/preferences/delivery with JSON-only context and
confirmed per-attempt cleanup. Combined: **3 passed / 0 skipped**; generated app
types/build and root `pnpm tsc --noEmit` pass. Native teardown is verified.
No product changes, repacks, installations or cloud writes. Scenarios 1–4 now
pass at current versions; hosted scenario 5, strict local Waiting/full CLI,
final versions/artifacts and requirement audit remain. Desktop stays waived.
[Commands, observations and limits](./release-0.9.0-verification-archive.md#codex-cross-feature-scenarios-123-2026-10-09).

### Codex — hosted staging scenario 5 complete (2026-10-09)

**55 complete / 3 open; no numbered task closes.** All five original cross-feature
compositions now pass at current versions. Actual GitHub CI plans/applies the exact
staging migration, checks persisted checksum/no pending work, builds with staging
bindings, tests anonymous/authorized protected assets and decorated RPC, preserves
production and cleans owned resources. Combined: **24 passed / 0 skipped**; root
`pnpm tsc --noEmit` and installed app local types/build/native smoke pass. Separate
coordinator reads confirm production fixture rows and final cloud/repository absence.
The initial setup guard failure and recovered deletion are retained in the archive.
No original workflow template/product API changes or repacks. Strict local Waiting/
full CLI, final versions/artifacts and final requirement audit remain open; Desktop
stays waived. [Commands, receipts and limits](./release-0.9.0-verification-archive.md#codex-hosted-staging-scenario-2026-10-09).
