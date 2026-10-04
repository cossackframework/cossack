# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
24 of 58 release tasks are complete. 34 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
The [completed task index](./release-0.9.0-plan.md#completed-task-index) links the
24 finished tasks to archived criteria and reviews. Preserve their regression coverage.
All unchecked tasks remain in scope.

RT-23: **65/65 component-source foundations plus Icon, AuthForm and CommandPalette reviewed**.
Completed [verification records](./release-0.9.0-verification-archive.md) and
[batch plans](./release-0.9.0-plan-archive.md) are archived. DashboardStat,
SettingsPanel and remaining acceptance are open; RT-23 is not complete.

<a id="working-state"></a>
## Working state

Codex, 2026-10-04: Last completed implementation commit is `9485dcf`
(CommandPalette). DashboardStat source, exports, CLI ejection, framework demo and
regression test drafts are uncommitted. The UI build passed after fixing generic
inference; the new tests and full type checks have not run. Do not mark this batch
complete or treat its proposed contract as verified.

Resume with the DashboardStat unit/browser/ejection tests and type checks. Verify
wrapping, keyed updates, native props and the real dashboard demo. Investigate the
suspected renderer handling of `class: ifDefined(...)` before claiming directive
class forwarding. Finish installed guidance, migration notes and acceptance before
recording completion. Preserve all existing source edits during this docs cleanup.

## Continue here — Codex, 2026-10-04

1. Continue **RT-23 with DashboardStat**, then SettingsPanel. The DashboardStat draft addresses
   root props, stray template text, readonly metrics, explicit change meaning,
   native semantics and responsive wrapping; verify these against the plan. SettingsPanel still needs typed row/value ownership,
   connected labels and safe native action/reset behavior. The
   [RT-23 plan](./release-0.9.0-plan.md#rt-23) retains source findings and acceptance.
   Preserve compiled/ejected consumers and installed guidance; component milestones
   do not close the broader release criteria.
2. Continue **CLI-07/CLI-08**: authored API/component/recipe guidance, executable
   examples and verified runtime support. Use the shared services described in
   [tool usage](../docs/local-agent-tools.md) and extend
   [installed-tarball acceptance](./release-0.9.0.md#codex-installed-docs-acceptance-2026-10-04).
   Discovery reads examples without executing them; runtime availability remains unverified.
3. Add **CLI-07 stored test results and RT-28 snapshots/traces** through shared
   services. Then follow every remaining checklist item and its detailed plan.
   Close tasks only against their original acceptance criteria.

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
