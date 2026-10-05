# Cossack 0.9.0 continuation notes

Author: Codex. Updated on 2026-10-05. Branch: `fix-084`.
30 of 58 release tasks are complete. 28 remain open.
Versions stay at 0.8.3 until REL-04.
**Codex coordinates implementation, review, acceptance and status for every
remaining task.** The user has resumed the work directly with Codex; GLM is no
longer the continuation owner. Preserve user-owned changes, integrate and
verify all work, and keep task counts consistent.
Keep this file current as work progresses.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope, subject to the Desktop closure below.

**Desktop: completed for 0.9.0 by user decision (2026-10-05).** Preserve the
verified implementation. Remaining Desktop-only platform acceptance is waived
for this release, not a pending task or a claim that those checks passed. Do not
reopen Desktop work unless requested. Prioritize shared framework behavior,
CLI/agent tooling and Cloudflare.

<a id="completed-work-reference-only"></a>
## Completed work — reference only

The [completed task index](./release-0.9.0-plan.md#completed-task-index) links
all 30 tasks to archived criteria. Preserve their regressions. Runtime evidence
is in the [verification index](./release-0.9.0.md#archived-checkpoints).
Latest completed checkpoint: [Cloudflare environment and database targets](./release-0.9.0.md#codex-cf-targets-complete-2026-10-05).
It closes CF-01 and CF-02. No live Cloudflare account or database was contacted.
Latest CLI-08 progress: [installed database transaction guidance](./release-0.9.0.md#codex-cli08-transactions-2026-10-05) adds a Node SQLite example that proves atomic commit and rollback, and explicitly scopes D1's lack of interactive ORM transactions. The fresh offline tarball gate passes all 76 standalone examples and four auth examples (80 total). CLI-08 stays open for broader library API, component and recipe coverage.
REL-03 remains open for the required non-Desktop release matrix.
Latest Cloudflare progress: [CF-08 RPC logging](./release-0.9.0.md#codex-cf08-rpc-logging-2026-10-05) adds correlated, redacted structured failure events for component, service, stream and cleanup paths. Its 478-case framework RPC matrix and 24 stream/native-response tests pass with root typechecking. This is local harness evidence only. Worker Logs ingestion, production source maps and build/startup budgets remain open. The [CF-04 static resource plan](./release-0.9.0.md#codex-cf04-static-resource-plan-2026-10-05) removes misleading `existing`/`automatic` labels and surfaces configured references, unresolved setup actions, and unchecked remote status. D1 without either required `database_name` or `database_id` is now an error for remote deployment, with Wrangler list/create guidance in the scaffold docs. The 30 focused CLI tests, 81 scaffold tests, generated deployment dry-run and root typecheck pass; `git diff --check -- . ':!reports.md'` is clean. The dry-run did not upload or create resources. Account ownership/live existence remain unverified. CF-04 remains open. Latest RT-11 and RT-12 progress is recorded in their linked checkpoints below; neither parent task is complete.
Latest runtime progress: [RT-20 hydration diagnostics](./release-0.9.0.md#codex-rt20-safe-hydration-diagnostics-2026-10-05) now reports typed root and nested component fallback events without logging rendered text. All 333 renderer tests and root typechecking pass. Source/field metadata, state comparison, retained layout/service browser cases and reusable test helpers remain open.

Latest form progress: [RT-10 headless controller](./release-0.9.0.md#codex-rt10-form-controller-2026-10-05) adds a schema-backed Core controller with typed field paths, validation, reset, dirty/touched state, server error mapping, duplicate-module validation-error support and stale-result protection. The 9 focused tests, all 1,568 Core tests and root typecheck pass. This is a partial foundation; accessible bindings, UI adapters, keyboard/label/error/focus browser tests and file transport acceptance remain. The `getFormData()` guide example's missing `async` was also fixed.

## Active implementation plan — Codex owns remaining work (2026-10-05)

1. Finish **[CLI-08](./release-0.9.0-plan.md#cli-08)** authored API/component/recipe
   guidance, executable examples and verified runtime support through the
   [shared documentation services](../docs/local-agent-tools.md). Generated
   declarations alone do not prove usage or runtime compatibility.
   Core guidance now includes typed URL state, standalone schemas and nested forms.
   Preserve the focused `core/input` export and
   [ten installed examples](./release-0.9.0.md#codex-cli08-input-2026-10-04).
   Packaged action/resource/task pages now run verbatim through generated application
   fixtures. Preserve their input rejection, hydrated resource reuse, recovery,
   deterministic stale-task overlap, navigation cleanup and client stripping.
   [Installed Cloudflare and Node acceptance](./release-0.9.0.md#codex-cli08-application-guidance-2026-10-04)
   also requires emitted source maps before scanning for server code.
   Auth now ships session/role, record-policy, OAuth diagnostic and shared
   credential/session guides.
   Preserve the separate legacy `implicitEntry`, static TypeScript source indexing
   and four examples checked with Bundler resolution, bundled from installed
   packages and run offline.
   [Auth acceptance evidence](./release-0.9.0.md#codex-rt13-complete-2026-10-05)
   separates memory examples from real Node SQLite/Cloudflare D1 session checks
   and the protected-route browser regression. OAuth examples now provide typed
   state storage, and native fixtures prove one exchange/account/session despite
   a provider that accepts repeated codes. Bundling does not prove plain
   Node imports or production hashing limits.
   The database package publishes parameterized Node SQLite and Cloudflare D1
   guides. The exact D1 example now runs from a fresh installed tarball inside
   workerd with local D1 and proves SQL-looking values remain bound. It does not
   test a deployed Cloudflare database. The runtime test exposed a packaging
   defect: the root SQL entry pulled in Node adapters, and D1's Cloudflare entry
   pulled in optional Turso. Root `SQL` now takes an explicit adapter; Node
   auto-selection remains under `/node`, and remote Workers Turso has a separate
   `/cloudflare-turso` entry. All thirty-nine UI guides now include executable
   SSR examples. The latest six cover Menubar, NavigationMenu, Sidebar, Toaster,
   MessageScroller and AuthForm; the previous six cover date controls,
   Dropdown/Context menus, both command search guides, Carousel and Resizable.
   Earlier examples cover native dialogs/disclosures, tabs, toggles, icons,
   radio/range controls, searchable choice, repeated tag values, semantic
   lists/actions, named tables/scroll regions and other UI surfaces. The full
   fresh-tarball docs gate now passes seventy-one standalone
   examples, four auth
   examples, four generated pages, Cloudflare
   HTTP/SSE/WebSocket traces, UI contracts and production stripping. Its
   cold-start Vite cache fix clears optimizer state between
   rewritten graphs and pre-bundles late-discovered API/devtools entries. See
   [the database checkpoint](./release-0.9.0.md#codex-cli08-database-guidance-2026-10-05)
   and [D1 workerd acceptance](./release-0.9.0.md#codex-cli08-d1-workerd-2026-10-05),
   plus the [latest package guide checkpoint](./release-0.9.0.md#codex-cli08-migration-guidance-2026-10-05).
   All 73 published-package guides now include examples, and all eighty
   packaged examples run in the installed gate. Database guidance now includes
   typed model filters and query-builder projections; see the [latest query
   acceptance](./release-0.9.0.md#codex-cli08-database-queries-2026-10-05).
   Framework guidance now covers runtime
   capabilities, cache guarantees, typed request-scoped config, environment
   strings and raw binding requirements; Node and Deno guidance covers adapter
   lifecycle, binding precedence and development plugins; Studio guidance covers
   local/remote selection and embedded cleanup; Core guidance covers locale
   negotiation, explicit `q=0` exclusions and CLDR plural formatting. `test-utils` is an
   internal workspace package, outside the published tarball acceptance. Continue
   broader library API and recipe coverage. The UI
   examples
   cover SSR only; they do not close browser or assistive-technology acceptance.
   Pure helpers and recipe plans do not prove RPC, browser or adapter behavior.
   See the [Studio/offline-import checkpoint](./release-0.9.0.md#codex-cli08-studio-guidance-2026-10-05): the public Studio entry now defers the remote-D1 helper, avoiding eager `tsx` IPC when a caller supplies its own connection. The installed gate blocks outbound network APIs and permits only synthetic numeric loopback resolution.
   The [locale guidance checkpoint](./release-0.9.0.md#codex-cli08-localization-2026-10-05) adds installed examples for Accept-Language fallback (including `q=0` exclusions) and CLDR plural formatting. Core now ignores explicitly unacceptable language ranges. The Core i18n suite passes 74 tests and the fresh installed gate passes. These examples cover pure Core helpers; they do not prove framework middleware or response-cache behavior.
   The [migration/seeding checkpoint](./release-0.9.0.md#codex-cli08-migration-guidance-2026-10-05) adds an installed Node SQLite lifecycle example for migration apply/status/rollback and idempotent seeding. It proves the documented Node API against an in-memory SQLite database, not provider portability or deployment readiness.
   The [request-config checkpoint](./release-0.9.0.md#codex-cli08-request-config-2026-10-05) adds an installed framework guide for request-time config factories, typed dotted paths, string environment values and raw bindings. Its example compiles and runs from the framework tarball and verifies safe missing-binding errors. Broader library and recipe coverage remains open.
   The [renderer checkpoint](./release-0.9.0.md#codex-cli08-renderer-guides-2026-10-05) adds four installed examples, raising the package catalog to 72 guides and the acceptance run to 79 examples including auth at that checkpoint. The [latest transaction checkpoint](./release-0.9.0.md#codex-cli08-transactions-2026-10-05) brings the totals to 73 guides and 80 examples. A recount corrected the previous handoff's one-guide undercount. Continue broader library API/component/recipe coverage and preserve the acceptance distinction between SSR output and browser interaction.
   Desktop remains closed by user decision. Do not spend work on its waived platform matrix.
2. Continue **[RT-11](./release-0.9.0-plan.md#rt-11)** application session/flash
   recipes. The [session-dashboard checkpoint](./release-0.9.0.md#codex-rt11-dashboard-2026-10-05)
   verifies independent public references, owner/purpose checks, fixed errors and
   an authenticated dashboard layout guard before RPC. Native SQLite/D1 checks
   cover disclosure, forged actors/references, real storage failures, conditional
   legacy backfill, concurrent revocation and keeping the current session during
   token rotation. Preserve `0008_add_session_public_id`, reference stability,
   reset/OAuth purpose separation and sessions-only recipe composition.
   Auth's separate anonymous session bag is now opt-in; preserve public SSG
   response guards and standalone translation/config initialization.
   The full installed scaffold gate passes the locally packed Node → Cloudflare
   → Node flow, migrations/schema checks, Studio and production assets.
   [Public old-input selection](./release-0.9.0.md#codex-rt11-input-2026-10-05)
   now passes real Node/Cloudflare multipart POST, RPC failure/redirect and
   following SSR checks. Preserve explicit field lists, credential exclusions,
   detached copies, namespace protection and the errors-only form default.
   The packaged `safe-old-input` example runs verbatim in generated production
   fixtures and installed Cloudflare guide acceptance, including decoded-cookie,
   browser clearing and source-map checks.
   [Generated auth pages](./release-0.9.0.md#codex-rt11-forms-2026-10-05) now keep
   drafts in ClientStore, use client-only validation and validate one explicit
   object at RPC and native boundaries. Fixed errors preserve drafts and avoid
   raw storage text. Actual Node/Cloudflare pages and Chromium verify registration,
   login, reset expiry/replay, logout and rotation through cookies/redirects and
   following requests. Preserve the new `auth-input.ts` owned file, object action
   signatures and real-page regressions. Rotation redirects before a fresh list.
   Registration and reset failures can follow partial writes; do not infer rollback.
   [SSE session freshness](./release-0.9.0.md#codex-rt11-sse-auth-2026-10-05)
   now passes generated Node SQLite/Cloudflare D1 and Chromium. Preserve the
   server-only public-reference/token-fingerprint descriptor, strict shared
   session validation, fresh request/config/ORM scopes, inherited guards and
   owner/scope checks before every frame/heartbeat. Credential headers stay out
   of recheck contexts. Missing/invalid provider configuration and capture/storage
   failure have distinct fixed codes. Denial closes EventSource, stops retries
   and requires explicit reload; late old-source callbacks cannot affect a new source.
   Two tabs verify rotation of their shared cookie, old-stream closure and fresh
   reload. Native checks cover purpose/expiry/revocation, fresh user metadata for
   guard/scope changes, authorized peer delivery and an idle storage failure.
   Preserve replay/heartbeat/backpressure tests, private helper/map exclusion,
   actual auth-form regressions and the guide's explicit migration contract.
   The [WebSocket freshness checkpoint](./release-0.9.0.md#codex-rt11-websocket-auth-2026-10-05)
   now rechecks actions and every outbound frame using a credential-free
   attachment after hibernation. Fresh middleware validates user and per-page
   scope; denial sends a terminal frame and closes the stale socket. Node/Deno
   runtime peers use serialized, bounded per-connection delivery queues. Preserve
   the generated Cloudflare, Node/Deno and framework regressions. RT-11 remains
   open for broader concurrent request semantics. A checked in-flight action or
   frame, slow storage and backpressure prevent a strict wall-clock revocation
   guarantee; idle sockets are checked on the next action or delivery. Generic
   session and signed-flash scopes now have barrier tests that overlap requests
   in one isolate. Auth-session rotation has an atomic one-winner test. Node/Deno
   now claim flash nonces once in a bounded module-local store; capacity fails
   closed without evicting live tokens. This does not coordinate across
   processes or isolates and does not survive restart. See the [process-local
   flash checkpoint](./release-0.9.0.md#codex-rt11-process-flash-claims-2026-10-05).
   The built-in database session store now mutates individual JSON keys atomically on
   SQLite/PostgreSQL/MySQL, with a deterministic lost-update regression and
   dialect compilation checks; custom stores must preserve the same key-level
   behavior. Same-key writes remain last-writer-wins. See the
   [database session checkpoint](./release-0.9.0.md#codex-rt11-session-concurrency-2026-10-05).
   Flash cookies now carry a signed server-checked expiry matching `maxAge`;
   copied values are rejected after expiry instead of relying on browser cookie
   clearing. The framework suite, core flash/crypto tests, root/package types and
   fresh installed docs acceptance pass. Cloudflare now consumes flash nonces
   once in `COSSACK_SSE`, preserves background requests and rejects copied-token
   page replays. Native two-Worker tests and middleware tests cover concurrent
   claims, replay, invalid expiry, missing binding and coordinator failure.
   Node/Deno use a bounded module-local claim store. Preserve that limit and the
   [Cloudflare flash checkpoint](./release-0.9.0.md#codex-rt11-cloudflare-flash-claims-2026-10-05).
   The flash middleware and Cloudflare coordinator focused tests and root type
   check pass. RT-11 remains open for broader request concurrency and replay
   guarantees across processes/isolates or restart.
   The fresh installed agent-docs gate passes with the clarified core guide.
   The older, unrelated coordinator RPC stream test still reports
   `COSSACK_RPC_STREAM_TRUNCATED` in this checkout; it reproduced against the
   pre-change Durable Object source. Broader in-flight revocation and concurrent
   request semantics remain open.

3. Continue **[RT-01](./release-0.9.0-plan.md#rt-01)** against native
   pre-header disconnect delivery and component initialization/restoration
   concurrency; retain the limits below. `rpc$(() => action(), opts)` now
   validates per-call options before dispatch and supports
   component HTTP/SSE/WebSocket and layout-service HTTP calls. Core build, all
   1,558 Core tests, authored RPC declaration tests and root TypeScript checking
   pass. Declared `@Server({ timeout })` values remain bounded to integer
   milliseconds from 1 through 2,147,483,647. The legacy Node adapter coalesces
   same-target bootstrap, counts pending instances toward its cap, and closes
   failed upgrades with a fixed error; its 24 tests pass. See the
   [per-call deadline checkpoint](./release-0.9.0-plan.md#codex-rt01-per-call-deadlines-2026-10-05)
   and [earlier timeout-boundary review](./release-0.9.0-plan.md#codex-rt01-timeout-bounds-2026-10-05).
   These changes do not close RT-01.
4. Continue **[RT-12](./release-0.9.0-plan.md#rt-12)**. Route inspection now
   resolves static aliases/re-exports to service class declarations and preserves
   inherited `@Page` options; dynamic expressions and cyclic aliases stay
   unknown. Five focused inspection suites pass (88 tests), plus two route CLI
   subprocess tests and root TypeScript checking. A throwing initializer proves
   service modules are not run. Static `@Service()` identity is classified as
   declared/missing/unknown. Repeat the full CLI suite during REL-03; runtime
   metadata/lifecycle behavior remains open.
   The targeted generated browser acceptance now passes **2 cases** (Node and
   Cloudflare) for navigation and layout/component ownership, cleanup, SSE and
   WebSocket lifetime. The earlier HTTP 409 came from synthetic-user middleware
   missing `captureRealtimeIdentity`; the fixture now supplies a test-only
   descriptor. Runtime metadata/lifecycle behavior remains open, so RT-12 stays
   open. Partial service-scope construction now rolls back earlier services if
   a later constructor or hydration fails; the focused cleanup suite and root
   typecheck pass. See the [construction rollback checkpoint](./release-0.9.0.md#codex-rt12-construction-rollback-2026-10-05).
5. Follow the detailed plan for all 28 open tasks. Close each only against its
   original acceptance criteria; completed portions do not close their parent task.
6. Continue [RT-24](./release-0.9.0-plan.md#rt-24) from the
   [declared requirements checkpoint](./release-0.9.0.md#codex-rt24-declared-requirements-2026-10-05).
   Generated types, scoped factories, typed scalar coercion, independent metadata
   and selected Wrangler declaration checks are implemented. SSR/SSG and realtime
   replay validate before factories; replay preserves runtime/environment and
   fails closed before authorization. AST catalogs never execute application code;
   unsupported/dynamic exports remain unknown. Config --check, check cloudflare
   and deploy use the same portable rules and private declaration facts.
   Continue direct Vite build preflight, Node/Deno declaration-source support,
   and full classification/hydration secrecy. Secret existence and remote resource
   readiness remain unverified. Classification cannot stop deliberate application
   exposure. Async factories remain unsupported; strict installed cache ambient
   types remain separate. Counts remain 30 complete / 28 open. Preserve the final
   results linked from the checkpoint. Fresh installed CLI/workerd/browser/docs
   acceptance and source/CLI/MCP/type checks pass. Retained gate:
   /tmp/cossack-local-pack-5dbkLj. Desktop stays closed with platform checks waived.
7. Continue **[CF-08](./release-0.9.0-plan.md#cf-08)** from the [RPC log
   checkpoint](./release-0.9.0.md#codex-cf08-rpc-logging-2026-10-05). Keep the
   fixed failure-code and payload-redaction tests. Next review the remaining
   server log paths, prove event visibility in a built Worker test, then add
   source-map and measured budget checks. Do not close CF-08 from the local
   framework matrix alone.
8. Continue **[RT-10](./release-0.9.0-plan.md#rt-10)** from the [headless
   controller checkpoint](./release-0.9.0.md#codex-rt10-form-controller-2026-10-05).
   Preserve its 9 Core regression tests and the passing 95-file Core suite.
   Add UI/reactivity integration, accessible field bindings, real keyboard and
   focus/error-association browser coverage, and file transport acceptance
   before closing RT-10. Keep Desktop closed; its remaining platform checks
   are waived.

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
- RT-01 still needs native pre-header disconnect delivery and initialization/restoration concurrency acceptance. Per-call deadlines and cancellation are implemented and covered across component HTTP/SSE/WebSocket and layout-service HTTP calls; this does not prove native disconnect delivery or stop ignored server application I/O.
- The full `cossack` package suite has not passed. Parallel execution exceeded existing subprocess/test timeouts; a serial retry also exceeded a five-second CLI assertion and was stopped. Focused route/inspection checks pass, but REL-03 must rerun the complete suite and resolve any reproducible failures.
- Browser ownership acceptance passes its focused generated Node and Cloudflare
  cases, including SSE and WebSocket ownership. The fixture uses a synthetic
  identity provider only; this does not establish real authentication or close
  RT-12's remaining runtime metadata/lifecycle acceptance.
  Explicit coordinator cancellation passes but does not prove incoming TCP abort delivery.
- RT-11 retains session and stream-response cookie requirements. Cloudflare flash is durable one-use through `COSSACK_SSE`; Node/Deno claims are limited to one loaded module instance in its JavaScript process or isolate. They are not distributed or restart durable. Native calls require explicit parsing and authorization.
  UI visibility does not authorize access.
- Cancellation and optimistic rollback do not terminate ignored application I/O, undo external effects or replay uncertain mutations.
- Cloudflare SSE uses the coordinator. Node/Deno retain documented process-local behavior.
  See [architecture](./sse.md) and [usage](../docs/sse.md).
- Upgrades preserve existing Wrangler files. Existing apps must add `enable_request_signal` explicitly where required.
- Desktop installed OS integration, Windows/macOS packaging and conditional
  signing checks were waived when the user closed Desktop for this release.
  Deno Deploy, graceful generated-server draining and the required non-Desktop
  release matrix remain separate acceptance gaps.
- Local checks do not prove remote readiness. No live deployment, provisioning, publication, push or credential rotation occurred.
  Never copy old credential values from Git history.

## Working rules

- Read `AGENTS.md`, [architecture](./architecture.md) and applicable task specs. Use pnpm. Alpha-stage API breaks are acceptable.
- Keep libraries independent of framework/application. Keep `cloudflare:workers` imports out of core and Node/Deno runtime import graphs.
- Use installed Cloudflare skills and current official documentation for Workers, Durable Objects or Wrangler changes.
  Workspace baseline: Wrangler 4.114.0, Cloudflare Vite plugin 1.47.0, Vite 8.1.4.
  Installed trace acceptance also passes with Wrangler 4.147.0, plugin 1.62.5 and Vite 8.3.2.
  Verify the relevant runtime matrix before upgrades.
- Build dependencies before consumers. Never overlap builds that replace `dist` with tests or type checks that read it.
  Framework pretest rebuilds declarations. After building, use `pnpm --filter @cossackframework/framework exec vitest run`.
- After source changes, run meaningful regression tests, root `pnpm tsc --noEmit` and package type checks.
  Run heavy CLI/generated suites without competing heavy jobs.
- Preserve the user's `reports.md` and `.zcodeignore`. Do not stage them.
  Use `git diff --check -- . ':!reports.md'` for the known report whitespace exception.
- Keep the database JSON bootstrap in default CommonJS eval mode. Miniflare
  Workers inherit eval flags; `--input-type=module` stalls the synchronous bridge.
- For this continuation, use up to three independent, file-scoped subagents when
  useful; do not let agents share implementation files. Keep shared APIs,
  integration and final verification with Codex. Do not create new chats, send
  messages, publish or deploy without authorization.
- Keep this file focused on current state and next steps. Add new evidence to the release verification log. Archive older checkpoints with links.

Codex build repair (2026-10-05): the installed gate exposed RT-10's generic
form-controller declaration error; validated data now retains InputOf<S>. Core
build/declaration emission and 9 focused tests pass. This does not close RT-10's
accessible binding/browser acceptance. Both build and CLI-generation evidence
are recorded in the RT-24 CLI checkpoint above.
