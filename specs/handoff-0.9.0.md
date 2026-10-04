# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
25 of 58 release tasks are complete. 33 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope.

## Completed work — reference only

The [completed task index](./release-0.9.0-plan.md#completed-task-index) covers all
25 closed tasks, including RT-23's 70-row UI audit. Full criteria and evidence
remain in the archives; do not repeat completed implementation work.

Implemented portions of the still-open CLI-07/RT-28 tasks:

- [Stored test evidence](../docs/test-results.md): Vitest 4 reporter and shared CLI/MCP reads.
- [Development capture](../docs/development-traces.md): bounded RPC/navigation events,
  shared component IDs and passive state/resource/service/transport snapshots.
  Values are omitted by default; explicit selections are bounded and redacted.

Browser inspector and the opt-in Vite/CLI/MCP bridge are verified; see the [latest checkpoint](./release-0.9.0.md#codex-trace-bridge-2026-10-04)
for results and limits. These portions do not close CLI-07 or RT-28.

## Continue here — Codex, 2026-10-04

1. Finish **RT-28 / CLI-07**: server correlation, service RPC capture and generated
   application acceptance across browser, CLI and MCP. Preserve capture ownership,
   terminal outcomes, production exclusion and published-package boundaries.
   Vite's opt-in bridge now records default snapshots for the shared CLI/MCP reader.
   Stored receipt age is explicit; records do not prove live or server state.
   Source markers identify only the latest registered instance per file.
2. Continue **CLI-08** authored API/recipe guidance, executable examples and verified
   runtime support. Extend [installed acceptance](./release-0.9.0.md#codex-installed-docs-acceptance-2026-10-04)
   through the [shared documentation services](../docs/local-agent-tools.md).
3. Follow all 33 open tasks in the detailed plan. Close each only against its
   original acceptance criteria. Preserve completed-task regression coverage.

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
