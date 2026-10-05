# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-06)

Completed **RT-26**. Release: **48 complete / 10 open**.
[Criteria, verification and limits](./release-0.9.0-verification-archive.md#codex-rt26-complete-svc04-open-2026-10-06).
Published authorized storage, local/R2/S3 streaming, signed access, cleanup and
image diagnostics pass source/native/installed acceptance. Installed S3 required
moving its SDK to runtime dependencies; the lockfile changes no SDK version.
Completed RT-26 context is archived. Prior RPC/session closures remain intact.

**SVC-04 stays open.** Typed contracts, local tests, native bridge, generated
bindings and CLI/MCP inspection are source-verified. Native creation, completed
steps and retries work, but the strict waiting-status assertion fails: pinned
Miniflare stays running at the event barrier and never assigns Waiting. Native
interruption/resume/event completion and failure plus installed Workflow acceptance
remain unproven. Do not weaken the assertion or relabel running as waiting.
`packages/cossack/tests/workflows-release-acceptance.test.js` and
`packages/cossack/tests/fixtures/workflows-acceptance.js` remain batch-owned,
uncommitted failed acceptance work. Preserve them. The latest native log is
`/tmp/svc04-workflows-native.log` (exit 1); no consumer remains live.

Next choose independent full acceptance paths in **CLI-08** and
**CF-04/08/09/10**. Keep shared APIs/integration with Codex and at most three
implementation agents with exclusive files. Do not polish budgets unless needed
for a missing criterion. Run targeted checks then relevant combined/types once;
repeat only invalidated evidence. Final storage payloads are in
`/tmp/cossack-rt26-svc04-tarballs` (framework-final.tgz); installed gate:
`/tmp/cossack-local-pack-gZdSQv/minimal-production`. Reuse unchanged evidence.

Open: CLI-08, SVC-04, CF-04/08/09/10, REL-02/03/04/05 (**10 total**).
Versions stay 0.8.3 until REL-04. Preserve user reports.md and .zcodeignore.
Desktop remains complete with remaining checks waived, not passed. No live
Cloudflare/AWS account or resource mutation occurred. The Workflow provider
limitation blocks that task's current native acceptance, not independent work.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope, subject to the Desktop closure below.

**Desktop: completed for 0.9.0 by user decision (2026-10-05).** Preserve the
verified implementation. Remaining Desktop-only platform acceptance is waived
for this release, not a pending task or a claim that those checks passed. Do not
reopen Desktop work unless requested. Prioritize shared framework behavior,
CLI/agent tooling and Cloudflare.

Previous completed-task details remain in the [verification archive](./release-0.9.0-verification-archive.md)
and [plan archive](./release-0.9.0-plan-archive.md#codex-handoff-references-2026-10-06).
Retain their acceptance evidence without rerunning unchanged matrices.

## Active implementation plan — Codex owns remaining work (2026-10-06)

1. Finish CLI-08's authored API/component/recipe coverage inventory. Its 81 guides
   and 88 executable examples are unchanged; new storage/Workflow guidance still
   belongs in the inventory. Do not rerun unchanged catalog matrices.
2. Complete CF-04 and CF-08/09/10's resource, observability, preview and deployment
   criteria. Static plans/local logs do not prove remote readiness or ingestion.
3. Revisit SVC-04 only with a path to actual waiting-state and lifecycle proof.
   Preserve its strict uncommitted native probe and original full criteria.
4. Keep REL-02/03/04/05 open until full non-Desktop gates pass.

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
