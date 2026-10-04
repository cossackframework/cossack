# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
25 of 58 release tasks are complete. 33 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope.

## Completed work — reference only

All 25 closed tasks are in the [completed task index](./release-0.9.0-plan.md#completed-task-index),
with original criteria and evidence archived. Do not repeat their implementation.

Completed portions of open CLI-07/RT-28: [stored test evidence](../docs/test-results.md),
[RPC/navigation capture, passive browser inspection and shared Vite/CLI/MCP records](../docs/development-traces.md).
Service-call capture is committed as `c6c2e49`; [verification and limits](./release-0.9.0-verification-archive.md#codex-service-traces-2026-10-04)
are archived. These portions do not close their parent tasks.

## Continue here — Codex, 2026-10-04

The paused-iterator deadline fix now passes core, generated Node and workerd
acceptance; see the [checkpoint](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04).
Preserve first failure codes, confirmed state, one cancellation request and cleanup
without another iterator pull. Local cancellation cannot undo server writes.

The [HTTP dispatch checkpoint](./release-0.9.0.md#codex-server-dispatch-evidence-2026-10-04)
records the current server-evidence work and WebSocket yield-order correction.

1. Finish **RT-28 / CLI-07** server stream-terminal/WebSocket correlation and generated browser/CLI/MCP and
   published-package acceptance. Preserve capture ownership, terminal outcomes and
   production exclusion. HTTP/multipart dispatch evidence now joins calls by IDs;
   it does not prove response-body completion. Preserve ordered application error
   delivery after WebSocket yields; only local transport failures discard queued frames.
   Stored browser receipt age does not prove live/server state;
   source markers identify only the latest registered instance per file.
2. Continue **CLI-08** authored API/recipe guidance, executable examples and verified
   runtime support through the [shared documentation services](../docs/local-agent-tools.md).
   Follow all 33 open tasks in the detailed plan and retain completed-task regressions.
   Close each task only against its original acceptance criteria.

## Limits to retain

- RT-01 needs native pre-header disconnect delivery, arbitrary action deadlines and initialization/restoration concurrency acceptance.
  Explicit coordinator cancellation passes but does not prove incoming TCP abort delivery.
- RT-11 retains session and stream-response cookie requirements. Native calls require explicit parsing and authorization.
  UI visibility does not authorize access.
- Cancellation and optimistic rollback do not terminate ignored application I/O, undo external effects or replay uncertain mutations.
- Cloudflare SSE uses the coordinator. Node/Deno retain documented process-local behavior.
  See [architecture](./sse.md) and [usage](../docs/sse.md).
- Upgrades preserve existing Wrangler files. Existing apps must add `enable_request_signal` explicitly where required.
- REL-03 still needs plain Node Vite development routing, Deno execution, Electron launch/packaging and the full runtime/release matrix.
- Local checks do not prove remote readiness. No live deployment, provisioning, publication, push or credential rotation occurred.
  Never copy old credential values from Git history.

## Working rules

- Read `AGENTS.md`, [architecture](./architecture.md) and applicable task specs. Use pnpm. Alpha-stage API breaks are acceptable.
- Keep libraries independent of framework/application. Keep `cloudflare:workers` imports out of core and Node/Deno runtime import graphs.
- Use installed Cloudflare skills and current official documentation for Workers, Durable Objects or Wrangler changes.
  Recorded baseline: Wrangler 4.114.0, Cloudflare Vite plugin 1.47.0, Vite 8.1.4. Verify compatibility before upgrades.
- Build dependencies before consumers. Never overlap builds that replace `dist` with tests or type checks that read it.
  Framework pretest rebuilds declarations. After building, use `pnpm --filter @cossackframework/framework exec vitest run`.
- After source changes, run meaningful regression tests, root `pnpm tsc --noEmit` and package type checks.
  Run heavy CLI/generated suites without competing heavy jobs.
- Preserve the user's `reports.md` and `.zcodeignore`. Do not stage them.
  Use `git diff --check -- . ':!reports.md'` for the known report whitespace exception.
- The user arranges GLM continuation. This handoff does not authorize delegation, new chats, messages, publishing or deployment.
- Keep this file focused on current state and next steps. Add new evidence to the release verification log. Archive older checkpoints with links.
