# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-06)

Completed **RT-01 and RT-11**. Release: **47 complete / 11 open**.
[Criteria, verification and limits](./release-0.9.0-verification-archive.md#codex-rt01-rt11-complete-2026-10-05).
Durable Object components now have one unpublished initialization/restoration
owner, awaited cleanup and reciprocal socket close. Real Node/workerd disconnect,
browser duplicate-consumer, eviction/restoration and final installed Core pass.
Source/installed native SQLite/D1 session races are documented and verified.
Generic anonymous bindUser remains non-atomic; auth rotation has one winner.
No batch blocker. Completed context is compacted into the plan archive.

Next choose **RT-26 and SVC-04** only with bounded full acceptance paths; consider
**CLI-08** alongside them if the coverage inventory can be closed. Keep shared
APIs/integration with Codex, at most three implementation agents with exclusive
files. Finish parent tasks; do not polish Cloudflare budgets unless required.
Run targeted checks, then combined/types once. Repeat only invalidated evidence;
never replace dist while consumers run. Record one verified batch and commit
only owned files. Reuse unchanged tarballs and installed acceptance evidence.

Limits: all Workers/D1/Durable Objects are local. Wrangler's service-entry proxy
suppresses pre-header cancellation; direct workerd application sockets prove it.
No live account/resource mutation, rollback of admitted work, cross-process Node
flash replay guarantee or native Deno interruption claim. REL-03 owns the remaining
non-Desktop runtime matrix. Session acceptance scratch fixtures translate legacy
migration callbacks to declarative SQL; this does not claim generated callback
migration plans are complete. CLI-08, RT-26, SVC-04, CF-04/08/09/10 and
REL-02/03/04/05 remain open (11 total). Versions remain 0.8.3 until REL-04.
Preserve user reports.md and .zcodeignore. Desktop remains complete with remaining
checks waived, not passed.

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
all 47 tasks to archived criteria. Preserve their regressions. Runtime evidence
is in the [verification index](./release-0.9.0.md#archived-checkpoints).
Latest completed checkpoint: [RPC and session acceptance](./release-0.9.0.md#codex-rt01-rt11-complete-2026-10-05).
It closes RT-01 and RT-11. Earlier CF-01/CF-02 acceptance remains archived. No live Cloudflare account or database was contacted.
Previous CLI-08 progress: [installed database transaction guidance](./release-0.9.0.md#codex-cli08-transactions-2026-10-05) adds a Node SQLite example that proves atomic commit and rollback, and explicitly scopes D1's lack of interactive ORM transactions. The fresh offline tarball gate passes all 76 standalone examples and four auth examples (80 total). The SVC-01/SVC-05 and SVC-02/SVC-03 batches each add four independently strict-compiled/executed installed guides (81 guides / 88 examples now). CLI-08 stays open for broader library API, component and recipe coverage.
REL-03 remains open for the required non-Desktop release matrix.
Latest Cloudflare progress: [CF-08 RPC logging](./release-0.9.0.md#codex-cf08-rpc-logging-2026-10-05) adds correlated, redacted structured failure events for component, service, stream and cleanup paths. Its 478-case framework RPC matrix and 24 stream/native-response tests pass with root typechecking. This is local harness evidence only. Worker Logs ingestion, production source maps and startup budgets remain open; primary-Worker build budgets and custom-source selection are verified in the latest checkpoint. The [CF-04 static resource plan](./release-0.9.0.md#codex-cf04-static-resource-plan-2026-10-05) removes misleading `existing`/`automatic` labels and surfaces configured references, unresolved setup actions, and unchecked remote status. D1 without either required `database_name` or `database_id` is now an error for remote deployment, with Wrangler list/create guidance in the scaffold docs. The 30 focused CLI tests, 81 scaffold tests, generated deployment dry-run and root typecheck pass; `git diff --check -- . ':!reports.md'` is clean. The dry-run did not upload or create resources. Account ownership/live existence remain unverified. CF-04 remains open. RT-11 and RT-12 are now complete; preserve their archived acceptance.
Forms are complete; preserve the [RT-10 acceptance](./release-0.9.0.md#codex-rt10-rt15-rt17-complete-2026-10-05).

## Active implementation plan — Codex owns remaining work (2026-10-05)

1. Assess RT-26 published storage/provider acceptance and SVC-04 native Workflow
   interruption/event/retry acceptance. Assign independent implementation only
   after dependency/file ownership checks; coordinator owns shared APIs.
2. Finish CLI-08's remaining authored library/component/recipe coverage inventory.
   Preserve 81 guides / 88 executable examples and prior installed application
   acceptance. Use the active plan and archived checkpoints rather than rerunning
   unchanged catalogs. Generated declarations alone do not prove usage/support.
3. Complete CF-04 real resource selection/provisioning and CF-08/09/10 required
   observability, preview and deployment automation criteria. Local plans/logs do
   not prove remote resources/ingestion. Avoid polishing completed budget behavior.
4. Keep REL-02/03/04/05 open until their full non-Desktop criteria pass. Preserve
   all completed regressions and trace acceptance back to the original criteria.

Earlier detailed continuation notes are [archived](./release-0.9.0-plan-archive.md#codex-handoff-before-rt01-rt11-2026-10-05).

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
- RT-01 native Node/workerd disconnect and component initialization/restoration acceptance is complete. Cancellation remains cooperative and does not stop ignored application I/O.
- The full `cossack` package suite has not passed. Parallel execution exceeded existing subprocess/test timeouts; a serial retry also exceeded a five-second CLI assertion and was stopped. Focused route/inspection checks pass, but REL-03 must rerun the complete suite and resolve any reproducible failures.
- Browser ownership acceptance passes its focused generated Node and Cloudflare
  cases, including SSE and WebSocket ownership. The fixture uses a synthetic
  identity provider only; real authentication has separate RT-13 evidence.
  RT-12's metadata/lifecycle acceptance is complete in the verification archive.
  Incoming TCP abort now has separate Node/direct-workerd acceptance.
- RT-11 session/cookie acceptance is complete. Cloudflare flash is durable one-use through `COSSACK_SSE`; Node/Deno claims are limited to one loaded module instance in its JavaScript process or isolate. They are not distributed or restart durable. Native calls require explicit parsing and authorization.
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
