# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

- [x] **Desktop scope is complete for 0.9.0 by user decision (2026-10-05).**
  Remaining Desktop-only platform checks are waived, not reported as passed.
  Do not reopen Desktop unless requested. Focus on shared framework, CLI/agent
  tooling and Cloudflare. REL-02/REL-03 remain open for their non-Desktop
  acceptance; the numbered release task count is 30 complete / 28 open.

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
- [ ] [CLI-08](./release-0.9.0-plan.md#cli-08) Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples. Codex (2026-10-05): fresh CLI/MCP catalogs include seventy-one standalone examples, four bundled auth examples and four complete action/resource/task/public-form pages. All 67 published-package guides have at least one example; all 75 packaged examples are typechecked and executed by installed acceptance. Core guidance covers locale negotiation, explicit q=0 exclusions and CLDR plural formatting; framework guidance covers runtime capability, cache guarantees and request-scoped typed configuration/raw bindings; Node/Deno guides cover adapter lifecycle, binding precedence and Vite development integrations; Studio guidance covers local/remote data selection and embedded lifecycle. Auth guidance includes typed OAuth failures, shared credential/session contracts, legacy root and static TypeScript source facts. Packaged pages pass types, native Cloudflare/Node browser behavior and client JavaScript/source-map stripping. Database guidance covers bound Node SQLite and Cloudflare D1 queries, typed model filters and projections, plus reversible migration and idempotent seeding lifecycle; the D1 example runs from an installed tarball in workerd with local D1 and proves values stay bound. Broader library/API/component/recipe coverage remains open. See [all package guide acceptance](#codex-cli08-guide-coverage-2026-10-05), [typed database queries](#codex-cli08-database-queries-2026-10-05), [request-scoped configuration](#codex-cli08-request-config-2026-10-05), [migration/seeding guidance](#codex-cli08-migration-guidance-2026-10-05), [D1 runtime acceptance](#codex-cli08-d1-workerd-2026-10-05), [database guidance](#codex-cli08-database-guidance-2026-10-05), [shared primitives](#codex-rt13-primitives-2026-10-05) and [application acceptance](#codex-cli08-application-guidance-2026-10-04).

## Runtime and application APIs

- [ ] [RT-01](./release-0.9.0-plan.md#rt-01) Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics. Authored inference, JSON wire types, native body completion, shared multipart ownership and a 421-case matrix are verified. Known IDs survive malformed frames; HTTP completion validates EOF before final state hydration. Ordinary JSON/error replies now have bounded strict UTF-8 decoding, validated service/redirect envelopes and correlated diagnostic fields before hydration. Child state stays separate from SSE page snapshots; limits apply to HTTP/socket actions with canonical ownership and correlated denials. Production workerd verifies limited D1 writes and shared layout-service budgets. Native Cloudflare peer/IP/header/custom-key and cross-Worker counter acceptance now passes; Node/Deno pass per-connection contexts. DO counter persistence now survives actual native eviction and Worker reload; concurrent two-Worker counts and spent HTTP/socket budgets pass. Invalid configured stores, first-env ownership and runtime options/counter replies now reject before mutation; the shared matrix has 421 cases. Backend reply bounds/deadlines and explicit cross-Worker coordinator cancellation now pass; cancelled queued callbacks never start. Codex bounds `@Server({ timeout })` to integer milliseconds from 1 through 2,147,483,647 and rejects invalid values across component/service proxies; the legacy Node adapter coalesces same-target initialization and accounts for pending instances. Remaining: actual native pre-header disconnect delivery, arbitrary dynamic/per-call action deadlines and broader component initialization/restoration concurrency, plus RT-02/RT-14 resource policies and RT-11 session criteria. RT-18 provider contracts are now complete. See the [latest checkpoint](#codex-sse-cancellation-2026-10-03) and [deadline-boundary review](./release-0.9.0-plan.md#codex-rt01-timeout-bounds-2026-10-05).
- [x] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies.
- [x] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation.
- [x] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics.
- [x] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work.
- [x] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [x] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection.
- [x] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting and pagination.
- [x] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics.
- [ ] [RT-10](./release-0.9.0-plan.md#rt-10) Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] [RT-11](./release-0.9.0-plan.md#rt-11) Session/flash recipes covering RPC failure, redirects, old input, and rotation. Native redirect/flash consumption, background failure preservation and late-write rejection pass. Generated dashboard references, owner/purpose checks, RPC guards and rotation races pass SQLite/D1 acceptance. Explicit public old-input selection now passes decoded-cookie and following-SSR checks on Node/Cloudflare. Actual generated auth forms now keep drafts outside shared state, validate inbound objects and pass login/reset/logout/rotation failures and redirects on Node/Cloudflare. Authenticated SSE and WebSockets revalidate storage, fresh guards and scope before delivery; session rotation closes both transports on subsequent traffic. The built-in database store now applies key-level atomic JSON mutations for SQLite, PostgreSQL and MySQL. Flash payloads enforce a signed server-side expiry; Cloudflare atomically consumes each signed nonce through `COSSACK_SSE`, with real two-Worker coverage. Node/Deno copied cookies remain replayable until signed expiry. Remaining: broader concurrent request semantics and process-runtime replay guarantees. See [SSE acceptance](#codex-rt11-sse-auth-2026-10-05), [WebSocket acceptance](#codex-rt11-websocket-auth-2026-10-05), [database session acceptance](#codex-rt11-session-concurrency-2026-10-05), [flash expiry acceptance](#codex-rt11-flash-expiry-2026-10-05), and [Cloudflare flash claims](#codex-rt11-cloudflare-flash-claims-2026-10-05).
- [ ] [RT-12](./release-0.9.0-plan.md#rt-12) DI resolution errors and scope/lifetime inspection with clear global/scoped guidance. GLM implemented contextual resolution failures and scoped disposal. Codex adds a static TypeScript-source `serviceOwnership` result for imported/re-exported expressions and inherited layout decorators, with explicit unknown status for dynamic expressions; no project module executes. Remaining: verifying actual `@Service`/lifecycle validity and browser navigation lifetime acceptance. See the [ownership-inspection checkpoint](./release-0.9.0-plan.md#rt-12).
- [x] [RT-13](./release-0.9.0-plan.md#rt-13) Shared credentials/sessions and safe OAuth diagnostics with required atomic state consumption. Generated Node SQLite and Cloudflare D1 verify expiry, rotation, concurrent callback replay, failed exchange and mapping. [Original acceptance audit](#codex-rt13-complete-2026-10-05).
- [x] [RT-14](./release-0.9.0-plan.md#rt-14) Typed resource authorization policies and client visibility helpers.
- [ ] [RT-15](./release-0.9.0-plan.md#rt-15) Database metadata, relationships, provider capabilities, query diagnostics, pagination, and transactions.
- [ ] [RT-16](./release-0.9.0-plan.md#rt-16) Structured migration/seeder plans including SQL, destructive operations, environment, and target.
- [ ] [RT-17](./release-0.9.0-plan.md#rt-17) Shared Studio/CLI database inspection service.
- [x] [RT-18](./release-0.9.0-plan.md#rt-18) Cache/rate-limit capability checks, consistent TTL units, and transport coverage.
- [x] [RT-19](./release-0.9.0-plan.md#rt-19) Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay.
- [ ] [RT-20](./release-0.9.0-plan.md#rt-20) SSR/hydration diagnostics with component/field/source information and test helpers.
- [ ] [RT-21](./release-0.9.0-plan.md#rt-21) SSG entry/plugin validation, per-route results/timings, and dependency compatibility tests.
- [ ] [RT-22](./release-0.9.0-plan.md#rt-22) Typed markdown frontmatter, route/URL collision checks, and locale static output.
- [x] [RT-23](./release-0.9.0-plan.md#rt-23) Typed server DataTable, native UI contracts and installed accessibility guidance; [audit](#codex-rt23-complete-2026-10-04).
- [ ] [RT-24](./release-0.9.0-plan.md#rt-24) Inferred configuration factories, required binding validation, and secret redaction. GLM (2026-10-02): `requireBinding`/`requireEnv` fail with `COSSACK_BINDING_MISSING` naming the binding, listing available binding NAMES only (never values, secrets stay redacted), and pointing at per-environment wrangler configuration; remaining: config-path misspelling type tests and registry generation from project configuration.
- [x] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop.
- [ ] [RT-26](./release-0.9.0-plan.md#rt-26) Storage providers for local/R2/S3, uploads/downloads/deletes, signed URLs, progress, metadata, and authorization; image diagnostics.
- [ ] [RT-27](./release-0.9.0-plan.md#rt-27) Localization extraction/checks, placeholder validation, missing/unused keys, and typed translation keys.
- [x] [RT-28](./release-0.9.0-plan.md#rt-28) Bounded devtools snapshots and correlated timelines across supported runtimes, shared CLI/MCP records and production exclusion; [completion audit](#codex-rt28-complete-2026-10-04).
- [ ] [RT-29](./release-0.9.0-plan.md#rt-29) Test utilities using real lifecycle/context/auth/DI/SSR/hydration/RPC behavior, published exports, and their own test suite. GLM (2026-10-02): `@cossackframework/test-utils/server` — `withRequestScope` (production request-context ALS + root service scope, awaited disposal, restoration on failure) and `controlledAsync` (settle-once deferred + shared AbortSignal); own suite now runs in root `pnpm test:unit`; remaining: framework-level RPC dispatch fixtures, auth fixtures, hydration helpers, and tarball-import verification.

## New services

- [ ] [SVC-01](./release-0.9.0-plan.md#svc-01) Background jobs with delays, retries, idempotency, failure inspection, and local test adapters.
- [ ] [SVC-02](./release-0.9.0-plan.md#svc-02) Schedules/Cron integration.
- [ ] [SVC-03](./release-0.9.0-plan.md#svc-03) Email/in-app notification templates, preferences, and delivery status using existing SMTP support where applicable.
- [ ] [SVC-04](./release-0.9.0-plan.md#svc-04) Durable multi-step Workflows integration.
- [ ] [SVC-05](./release-0.9.0-plan.md#svc-05) Turnstile component and server token verification.

## Cloudflare deployment

- [x] [CF-01](./release-0.9.0-plan.md#cf-01) Select environment before Vite build and share it across SSG, bindings, migrations, and deployment; [acceptance](#codex-cf-targets-complete-2026-10-05).
- [x] [CF-02](./release-0.9.0-plan.md#cf-02) Explicit local/remote database targets using the existing migration system; [acceptance](#codex-cf-targets-complete-2026-10-05).
- [x] [CF-03](./release-0.9.0-plan.md#cf-03) Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation.
- [ ] [CF-04](./release-0.9.0-plan.md#cf-04) Real resource selection or Wrangler provisioning in place of fake resource IDs.
- [x] [CF-05](./release-0.9.0-plan.md#cf-05) Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams.
- [x] [CF-06](./release-0.9.0-plan.md#cf-06) Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime.
- [x] [CF-07](./release-0.9.0-plan.md#cf-07) Public-only SSG and correct Worker-first routing for protected assets.
- [ ] [CF-08](./release-0.9.0-plan.md#cf-08) Production logs, source maps, correlation IDs, and build/startup budgets.
- [ ] [CF-09](./release-0.9.0-plan.md#cf-09) Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance.
- [ ] [CF-10](./release-0.9.0-plan.md#cf-10) Correct custom-domain/build deployment documentation and tested compatibility baseline. Codex continuation (2026-10-02): resolved the development WebSocket crash by keeping Upgrade requests out of the ASSETS bridge; 24 navigation/guard/transition browser tests pass. The installed combination is recorded in deployment docs. Generated guide execution and the complete compatibility acceptance remain open.
- [x] [CF-11](./release-0.9.0-plan.md#cf-11) Remove tracked credential values; report any required external credential rotation without exposing values.

## Release gates

- [x] [REL-01](./release-0.9.0-plan.md#rel-01) Fix reports.md issues and verify package/SSG regressions.
- [ ] [REL-02](./release-0.9.0-plan.md#rel-02) Compile documentation examples and validate generated applications and published tarballs.
- [ ] [REL-03](./release-0.9.0-plan.md#rel-03) Run build, root TypeScript command, package type checks, unit tests, and relevant end-to-end/runtime tests.
- [ ] [REL-04](./release-0.9.0-plan.md#rel-04) Update all release versions to 0.9.0, lockfile, changelog, migration guide, and release notes.
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
API and recipe coverage; release status remains **30 complete / 28 open**.

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
remains **30 complete / 28 open**.

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

Release status is **30 complete / 28 open**. Desktop remains complete by user
decision; waived platform checks are not claimed as passed.

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

Barrier tests confirm generic session and flash scopes stay separate across
overlapping requests in one isolate. Auth-managed rotation already has an
atomic single-winner test. Signed flash tokens remain replayable until expiry;
these request-isolation checks do not claim durable one-use semantics.

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
cleared. The 30-second default still allows a copied valid token to be replayed
within its signed window; durable one-winner consumption remains open.

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

### Archived checkpoints

Codex compacted the recorded checkpoints on 2026-10-04. Full evidence and limits
remain in the [verification archive](./release-0.9.0-verification-archive.md). Existing checkpoint
anchors below link to those records. Archiving a checkpoint does not complete its
parent task. Current status is 28 complete and 30 open.

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
