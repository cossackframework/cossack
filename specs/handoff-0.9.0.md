# Cossack 0.9.0 continuation notes

Author: Codex. Updated on 2026-10-05. Branch: `fix-084`.
30 of 58 release tasks are complete. 28 remain open.
Versions stay at 0.8.3 until REL-04.
**Codex owns implementation, review, acceptance and status for every remaining
task.** The earlier GLM handoff is superseded; do not delegate this release.
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
REL-03 remains open for the required non-Desktop release matrix.

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
   fresh-tarball docs gate passes sixty-nine standalone
   examples, four auth
   examples, four generated pages, Cloudflare
   HTTP/SSE/WebSocket traces, UI contracts and production stripping. Its
   cold-start Vite cache fix clears optimizer state between
   rewritten graphs and pre-bundles late-discovered API/devtools entries. See
   [the database checkpoint](./release-0.9.0.md#codex-cli08-database-guidance-2026-10-05)
   and [D1 workerd acceptance](./release-0.9.0.md#codex-cli08-d1-workerd-2026-10-05),
   plus the [latest package guide checkpoint](./release-0.9.0.md#codex-cli08-migration-guidance-2026-10-05).
   All 66 published-package guides now include examples, and all seventy-three
   examples run in the installed gate. Framework guidance now covers runtime
   capabilities and cache guarantees; Node and Deno guidance covers adapter
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
   in one isolate. Auth-session rotation has an atomic one-winner test, but a
   copied signed-flash cookie remains replayable until expiry; durable one-use
   semantics and the remaining concurrency contract are still open. The built-in
   database session store now mutates individual JSON keys atomically on
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
   Node/Deno remain stateless until expiry. Preserve that limit and the
   [Cloudflare flash checkpoint](./release-0.9.0.md#codex-rt11-cloudflare-flash-claims-2026-10-05).
   The fresh installed agent-docs gate passes with the clarified core guide.
   The older, unrelated coordinator RPC stream test still reports
   `COSSACK_RPC_STREAM_TRUNCATED` in this checkout; it reproduced against the
   pre-change Durable Object source. Broader in-flight revocation and concurrent
   request semantics remain open.

3. Continue **[RT-01](./release-0.9.0-plan.md#rt-01)** against its remaining native
   disconnect, deadline and concurrency criteria; retain the limits below.
4. Follow the detailed plan for all 28 open tasks. Close each only against its
   original acceptance criteria; completed portions do not close their parent task.

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
- RT-01 needs native pre-header disconnect delivery, arbitrary action deadlines and initialization/restoration concurrency acceptance.
  Explicit coordinator cancellation passes but does not prove incoming TCP abort delivery.
- RT-11 retains session and stream-response cookie requirements. Cloudflare flash is durable one-use through `COSSACK_SSE`; Node/Deno copied tokens remain replayable until signed expiry. Native calls require explicit parsing and authorization.
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
- Continue the remaining tasks directly. Do not delegate, create new chats, send messages, publish, or deploy without new authorization.
- Keep this file focused on current state and next steps. Add new evidence to the release verification log. Archive older checkpoints with links.
