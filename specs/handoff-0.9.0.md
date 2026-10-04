# Cossack 0.9.0 agent handoff

Author: Codex. Compacted on 2026-10-04. Branch: `fix-084`.
27 of 58 release tasks are complete. 31 remain open.
Versions stay at 0.8.3 until REL-04.

The [release checklist](./release-0.9.0.md) owns task status and a compact evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) preserves past results and limits.
The [detailed plan](./release-0.9.0-plan.md) retains full context for open tasks.
All unchecked tasks remain in scope, subject to the Desktop closure below.

**Desktop: completed for 0.9.0 by user decision (2026-10-04).** Preserve the
verified implementation. Remaining Desktop-only platform acceptance is waived
for this release, not a pending task or a claim that those checks passed. Do not
reopen Desktop work unless requested. Prioritize shared framework behavior,
CLI/agent tooling and Cloudflare.

<a id="completed-work-reference-only"></a>
## Completed work — reference only

The [completed task index](./release-0.9.0-plan.md#completed-task-index) links
all 27 tasks to archived criteria. Preserve their regressions. Runtime evidence
is in the [verification index](./release-0.9.0.md#archived-checkpoints).
Latest completed checkpoint: [Desktop development and RT-28 audit](./release-0.9.0.md#codex-rt28-complete-2026-10-04).
The installed native gate, trace parity, production exclusion and relevant
regressions pass. REL-03 remains open for the required non-Desktop release matrix.

## Continue here — Codex, 2026-10-04

1. Finish **[CLI-08](./release-0.9.0-plan.md#cli-08)** authored API/component/recipe
   guidance, executable examples and verified runtime support through the
   [shared documentation services](../docs/local-agent-tools.md). Generated
   declarations alone do not prove usage or runtime compatibility. Desktop's new
   bootstrap is documented in its package guide and migration notes.
   Core guidance now includes typed URL state, standalone schemas and nested forms.
   Preserve the focused `core/input` export and
   [ten installed examples](./release-0.9.0.md#codex-cli08-input-2026-10-04).
   Next add component/action/resource/task usage through executable application
   fixtures, then expand other library and UI guidance. Pure helpers and recipe
   plans do not prove RPC, browser or adapter behavior.
2. Continue **[RT-01](./release-0.9.0-plan.md#rt-01)** against its remaining native
   disconnect, deadline and concurrency criteria; retain the limits below.
3. Follow the detailed plan for all 31 open tasks. Close each only against its
   original acceptance criteria; completed portions do not close their parent task.

Desktop development is verified and ready to preserve. Use the exported
`startDesktop(factory)` bootstrap and restrict full SSR bundling to production
builds. Page repair must recheck capabilities; opaque RPC bodies must bypass HTML
transformation. The main-process supervisor owns restarts and shutdown. Keep the
public inspector import and its single capture owner; do not add renderer IPC.

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
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
- The user arranges GLM continuation. This handoff does not authorize delegation, new chats, messages, publishing or deployment.
- Keep this file focused on current state and next steps. Add new evidence to the release verification log. Archive older checkpoints with links.
