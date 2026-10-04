# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
26 of 58 release tasks are complete. 32 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope.

## Completed work — reference only

All 26 closed tasks are in the [completed task index](./release-0.9.0-plan.md#completed-task-index),
with original criteria and evidence archived. Do not repeat their implementation.

CLI-07 is complete; see the [installed trace and native lifecycle audit](./release-0.9.0.md#codex-cli07-complete-2026-10-04).
RT-28's completed portions remain in its [active plan](./release-0.9.0-plan.md#rt-28)
and [trace contracts](../docs/development-traces.md). Preserve the shared public
inspector import: a filesystem import created a second capture owner in installed apps.

## Continue here — Codex, 2026-10-04

1. Continue **RT-28** native-body terminal evidence and other runtime development
   acceptance. [WebSocket server evidence](./release-0.9.0.md#codex-socket-trace-evidence-2026-10-04)
   now passes generated and installed Cloudflare browser/CLI/MCP parity and
   production exclusion. A socket terminal does not prove post-send iterator cleanup. Preserve ordered
   application errors after WebSocket yields; only local transport failures discard
   queued frames. Header evidence alone does not prove body completion. Stored
   receipt age does not prove live state; source markers identify the latest instance per file.
2. Continue **CLI-08** authored API/recipe guidance, executable examples and verified
   runtime support through the [shared documentation services](../docs/local-agent-tools.md).
   Follow all 32 open tasks in the detailed plan and retain completed-task regressions.
   Close each task only against its original acceptance criteria.

## Limits to retain

- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
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
  Workspace baseline: Wrangler 4.114.0, Cloudflare Vite plugin 1.47.0, Vite 8.1.4.
  Installed trace acceptance also passes with Wrangler 4.147.0, plugin 1.62.5 and Vite 8.3.2.
  Verify the relevant runtime matrix before upgrades.
- Build dependencies before consumers. Never overlap builds that replace `dist` with tests or type checks that read it.
  Framework pretest rebuilds declarations. After building, use `pnpm --filter @cossackframework/framework exec vitest run`.
- After source changes, run meaningful regression tests, root `pnpm tsc --noEmit` and package type checks.
  Run heavy CLI/generated suites without competing heavy jobs.
- Preserve the user's `reports.md` and `.zcodeignore`. Do not stage them.
  Use `git diff --check -- . ':!reports.md'` for the known report whitespace exception.
- The user arranges GLM continuation. This handoff does not authorize delegation, new chats, messages, publishing or deployment.
- Keep this file focused on current state and next steps. Add new evidence to the release verification log. Archive older checkpoints with links.
