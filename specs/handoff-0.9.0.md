# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-06)

Completed **CLI-08 and CF-04**. Release: **50 complete / 8 open**.
[Full criterion mapping, commands and limits](./release-0.9.0-verification-archive.md#codex-cli08-cf04-complete-2026-10-06).
Offline usage inventory covers 109 guides / 116 examples; all 28 new examples
compile and execute from installed tarballs. Non-Desktop skills align with tested
APIs. Resource plans pin explicit account/default-or-named environment; verified
D1/KV/R2/Hyperdrive selection applies locally and converges. Unsupported remote
discovery/creation has precise actions, never automatic provisioning claims.
Codex reviewed all three agents' work and fixed Markdown runtime dependencies,
UI metadata, CLI Vite fixtures, DOM harness and inherited environment redirection.

Final installed CLI account/environment isolation and convergent apply pass.
Relevant integration **197 tests pass**; final account-isolation **18 pass**.
Affected matrix **5 pass** after three initial failures. Root plus seven package typechecks exit 0. Full CLI and
non-Desktop release matrices remain required. Reuse unchanged guide evidence.
Retained gate: `/tmp/cossack-local-pack-gZdSQv/minimal-production`; new payloads:
`/tmp/cossack-cli08-cf04-tarballs`, corrected Framework:
`/tmp/cossack-cli08-cf04-final/cossackframework-framework-0.8.3.tgz`, final CLI:
`/tmp/cossack-cli08-cf04-owned-final/cossack-0.8.3.tgz`.

**SVC-04 stays open.** Native creation/steps/retries work, but pinned Miniflare
never assigns Waiting at the event barrier. Interruption/resume/event completion,
native failure and installed acceptance remain unproven. Preserve its two prior
uncommitted failed fixtures and strict assertion; do not relabel running as waiting.
Its provider limitation blocks that task, not independent release work.

Open: SVC-04, CF-08/09/10, REL-02/03/04/05 (**8 total**). Next choose full CF-10
compatibility/guide acceptance or final independent non-Desktop gates. Do not
polish budgets without a required closure. Versions stay 0.8.3 until REL-04.
Preserve user reports.md/.zcodeignore. Desktop remains complete with remaining
platform checks waived. No live cloud mutation, deployment, publication or push.

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

1. Finish CF-08/09/10 observability, isolated previews and deployment compatibility.
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
