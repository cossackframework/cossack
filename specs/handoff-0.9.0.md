# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
24 of 58 release tasks are complete. 34 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and verification evidence.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
Completed tasks link to the [original plan archive](./release-0.9.0-plan-archive.md). All unchecked tasks remain in scope.

## Completed work

Completed IDs: CLI-01–06, RT-02–09, RT-14, RT-18, RT-19, RT-25,
CF-03, CF-05–07, CF-11 and REL-01.
See the [verification log](./release-0.9.0.md#verification-log) for implementation and test history.
Earlier handoff details remain available through `git show 8f084e0:specs/handoff-0.9.0.md`.

## Continue here

1. Continue RT-23 using the [UI contract audit](./ui-contract-audit.md).
   Next audit Modal, Sheet, Drawer and Popover.
   The audit records 19 reviewed foundations and their remaining coverage limits.
   Completed control work and tests are in the [verification log](./release-0.9.0.md#verification-log),
   most recently the [date-control checkpoint](./release-0.9.0.md#codex-date-controls-2026-10-04).
   Modal, Sheet and Drawer have uncommitted shared dialog changes in the working tree.
   These changes still need review, regression tests, type checks and migration notes.
   Popover remains pending. The broader component audit and full release matrix remain open.
2. Continue CLI-07/CLI-08 with authored API/component/recipe guidance, executable examples and verified runtime support.
   Existing inspection, documentation and exact-symbol tools are described in [usage](../docs/local-agent-tools.md).
   Extend [installed-tarball acceptance](./release-0.9.0.md#codex-installed-docs-acceptance-2026-10-04),
   which covers CLI/MCP parity and discovery with Node networking disabled.
   Discovery reads examples without executing them. Runtime availability remains unverified.
3. Continue CLI-07 stored test results and RT-28 snapshots/traces through shared services.
   Then follow the remaining checklist and linked plans. Close tasks only against their original acceptance criteria.

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
- Keep this file focused on current state and next steps. Record historical evidence in the release verification log.
