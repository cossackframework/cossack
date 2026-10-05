# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-06)

Latest verified Codex batch: **preview creation proof and non-Desktop release build**
([evidence](./release-0.9.0-verification-archive.md#codex-preview-creation-release-build-2026-10-06)). **51 complete / 7 open**, versions 0.8.3; no numbered
row closes. No-tag cleanup now requires saved creation ID/name/time plus matching
independent identity and absent latest deployment. Creation identity is saved
before native upload; foreign/latest deployment changes and lost creation responses
remain unproven ownership. Native default-bypass flags are negotiated from actual
help; Wrangler 4.147 uses --ignore-base-config. Parent Worker must already exist.

`pnpm build:release` runs serial non-Desktop native builds including Studio and
test-utils; Framework retains root build's library declaration stage. Native build,
bundle audit, root/all ten non-Desktop types pass. Source combined **108 / 4**,
native source **1 / 1**, installed combined **38 / 3** pass, including actual
Wrangler upload failure, real staging metadata, cleanup failure/retry/idempotency
and preview-only mutation paths. CLI packed once; unchanged tarballs reused in
`/tmp/cossack-preview-empty-release-installed`. This is loopback evidence, not
hosted CI. Prior compiler/aggregate acceptance remains in the archive. Broad CLI
still has its historical 1,112 passed / 2 failed / 9 skipped terminal result,
subsequent targeted scroller/omission fixes and unresolved native Waiting.

**Hosted readiness:** cached Wrangler OAuth is authenticated with one account;
API-token/account environment and CI credentials remain unconfigured. The private
fixture `/tmp/cossack-hosted-release-ready-final` passes generated workflow types,
build, native upload dry-run, authentication guards, retry/event/failure and client
secret scans. `review.md` describes fresh Worker/Workflow/D1/SSE resources and
ownership-verified cleanup; `plan.json`, secrets and native logs remain private.
No remote mutations occurred. Approval for hosted verification is pending; do not
infer it from elapsed time. Preparation scripts contain no deployment-write command.

Open: **SVC-04, CF-08, CF-09, REL-02, REL-03, REL-04, REL-05 (7)**. Missing:
actual Workflow Waiting; CF-08 wider module graphs and provider Logs/maps/startup; CF-09 hosted CI lifecycle/isolation/retry/unchanged
production; lost creation identity still requires manual recovery; Deno Deploy and final versioned artifact/runtime
matrix, then versioning and final audit. Preserve reports.md/.zcodeignore and the
two earlier strict uncommitted Workflow probes. Desktop remains waived.

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
2. Revisit SVC-04 only with real native Waiting proof; event/failure and paused
   process-restart criteria are now verified. Preserve the strict older probes.
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
- Initial CLI run: 1,007 passed / 19 failed / 6 skipped, with later targeted fixes. Latest terminal run: 1,112 passed / 2 failed / 9 skipped; MessageScroller is subsequently fixed, Waiting remains unproven and three non-Desktop omissions pass separately. Six Desktop cases are waived. Neither composite proves a green full CLI gate.
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
  Deno Deploy and the required non-Desktop release matrix remain acceptance gaps.
  Generated Node and Deno standalone draining are verified.
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
