# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
26 of 58 release tasks are complete. 32 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope.

## Completed work — reference only

All **26 completed tasks** are listed in the [completed task index](./release-0.9.0-plan.md#completed-task-index),
with links to their original criteria. Preserve their regressions; do not repeat implementation.
Completed Node development and HTTP/SSE/WebSocket trace acceptance are recorded in the
[verification archive](./release-0.9.0-verification-archive.md#codex-node-websocket-development-2026-10-04).
Partial acceptance does not close RT-28 or REL-03.

## Continue here — Codex, 2026-10-04

1. Finish **[RT-28](./release-0.9.0-plan.md#rt-28)** other runtime development
   acceptance, coordinating Deno development and Desktop verification with REL-03.
   Basic Deno production execution now passes; see the
   [checkpoint](./release-0.9.0.md#codex-deno-production-2026-10-04).
   Deno CLI startup now uses the actual runtime with normal/JSON lifecycle
   supervision; see the [CLI checkpoint](./release-0.9.0.md#codex-deno-cli-start-2026-10-04).
   Native Deno/Vite development, reload and recovery now pass; see the
   [development checkpoint](./release-0.9.0.md#codex-deno-development-2026-10-04).
   Next verify public CLI development trace parity and HTTPS, then Desktop.
   Preserve the public inspector import
   (filesystem imports duplicate capture owners), ordered WebSocket application
   errors, and capture ownership. Keep the Node adapter and core inside the
   development SSR graph so installed socket evidence stays enabled. Headers do not prove body completion; socket
   terminals do not prove later cleanup. Native evidence uses a separate channel
   with a one-second background receipt bound; it does not delay response completion
   or prove client consumption. Stored records are not live state.
2. Finish **[CLI-08](./release-0.9.0-plan.md#cli-08)** authored API/component/recipe
   guidance, executable examples and verified runtime support through the
   [shared documentation services](../docs/local-agent-tools.md).
3. Follow the detailed plan for all 32 open tasks. Close each only against its
   original acceptance criteria; completed portions do not close their parent task.

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
- REL-03 still needs Deno development integration, Electron launch/packaging and the full runtime/release matrix.
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
