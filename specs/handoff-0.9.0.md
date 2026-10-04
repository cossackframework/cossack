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

Current partial work: RT-23 has **59 of 65 UI source rows reviewed**, through
[Toast](./release-0.9.0.md#codex-toast-2026-10-04).
These component checkpoints do not close RT-23 or the release matrix.

## Continue here — Codex, 2026-10-04

1. Continue **RT-23 with Carousel**, then every pending
   [UI audit row](./ui-contract-audit.md). Its root ignores native props, the region
   and viewport lack a naming/keyboard contract, and buttons scroll 0.8 viewport
   instead of targeting slides. Define slide identity/sizing, native targets,
   boundary controls, keyboard/RTL behavior and reduced motion. Cover changing
   content, resizing, focus, SSR, themed browser behavior, source ejection and
   installed CLI/MCP guidance. Toast now has isolated browser stores and verified
   presenter lifecycle/timer/focus contracts. Generated-app and assistive-technology
   acceptance remain separate gates.
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
