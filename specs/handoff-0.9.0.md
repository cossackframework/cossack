# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-06)

Completed **CF-10**. Release: **51 complete / 7 open**, versions still 0.8.3.
[Verified batch, exact commands and limits](./release-0.9.0-verification-archive.md#codex-cf10-release-batch-2026-10-06). Public installed guide
acceptance passes default/staging builds, SSG, dry runs and local dev with zero
remote attempts. Generated-app CI now runs it; hosted CI was not executed here.

Installed package imports/types and representative generated apps pass their
recorded checks. Fresh native D1 proves all seven authoritative migration plans
and User/Session model requests. Node standalone SIGTERM/SIGINT draining,
deadlines and HTTP/2 are verified. All 19 failures from the initial full CLI run
have passing targeted follow-ups; the three skipped Deno cases also execute and
pass. Three Desktop skips remain waived. Do not describe the initial full run
as green. Final root and all ten non-Desktop package typechecks pass.

Open: **SVC-04, CF-08, CF-09, REL-02, REL-03, REL-04, REL-05 (7)**. SVC-04's
native Waiting/event-resume/failure/installed lifecycle remains unproven; preserve
its two earlier uncommitted failed probes and strict assertion. Continue other
gates independently. CF-08 requires remote logs/source maps and remaining original
acceptance; CF-09 requires actual preview lifecycle/isolation/cleanup. REL-02/03
retain full final non-Desktop matrices, native Workflow, Deno Deploy and generated
Deno shutdown/draining. Do not polish budgets without closing a requirement.

Migration templates now declare authoritative operations. Fresh schemas match
legacy callbacks, but applied callback migration histories reject changed
checksums. Do not rewrite history or claim automatic upgrade reconciliation;
REL-04's migration guide must explain this boundary. Reuse unchanged guide/import
proofs. Latest Framework/Scaffold/Node tarballs: `/tmp/cossack-release-batch-final`; corrected
installed CF gate: `/tmp/cossack-local-pack-Kkq9IK/minimal-production`.

Preserve user reports.md/.zcodeignore and prior Workflow probes. Desktop remains
complete with remaining platform checks waived. No live cloud mutation,
deployment, publication or push. Commit only this batch's owned verified files.

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

1. Finish CF-08/09 observability and isolated previews; reuse completed CF-10 acceptance.
   Local logs/static plans do not prove remote readiness or log ingestion.
2. Revisit SVC-04 only with a real path to waiting/lifecycle proof; preserve its probe.
3. Complete REL-02/03 non-Desktop published/generated/build/unit/runtime gates,
   then versioning and the requirement audit (REL-04/05).
4. Use at most three implementation agents with exclusive ownership, targeted
   checks, coordinator integration, one verified-batch record and explicit staging.

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
- RT-01 native Node/workerd disconnect and component initialization/restoration acceptance is complete. Cancellation remains cooperative and does not stop ignored application I/O.
- Initial serial CLI run completed with 1,007 passed, 19 failed and 6 skipped. Every failure now has targeted passing evidence; three skipped Deno cases executed and three Desktop cases remain waived. Final broad release gates still belong to REL-03; do not claim a second green full CLI run.
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
  Deno Deploy, generated Deno server shutdown/draining and the required non-Desktop
  release matrix remain separate acceptance gaps. Node standalone draining is verified.
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
