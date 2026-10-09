# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-09)

**53 complete / 5 open. SVC-04 and CF-08 complete**, versions 0.8.3. [Hosted completion](./release-0.9.0-verification-archive.md#codex-hosted-cf08-complete-2026-10-09).
Real current installed Worker: caller UUID matches native tail and stored Workers
Logs; safe fields/credential redaction, provider-authored source remapping and
10 ms native startup pass all eight evidence criteria. Owned temporary Worker,
Workflow, D1 and DO namespace are confirmed absent after cleanup. No production
promotion, GitHub write or publication. User authorized temporary Cloudflare
and Deno hosted acceptance; earlier hosted-approval blocker is superseded.

New hosted evidence assertions: 23 passed. Root/all ten non-Desktop types pass.
Prior full browser 297 and Framework 2,089 / 120 files remain valid; no repeat
packing or broad browser/unit runs. Full CLI still lacks a green terminal result.
Desktop remains completed by user decision; its remaining checks are waived.

SVC-04 original criteria are complete: retained native interruption/restart,
exact step reuse, retries/events and failure redaction plus new actual hosted
REST/native binding/public inspection Waiting. [Audit and limits](./release-0.9.0-verification-archive.md#codex-svc04-waiting-provider-ci-2026-10-09).
Strict local Waiting still fails; Miniflare's hibernation transition is disabled.
The expanded hosted experiment is also red (pause availability, then inconsistent
routing/404), not a green hosted lifecycle or full CLI result. All three attempts'
Worker/Workflow/D1/owned DO namespaces are confirmed absent. Preserve baseline
probes; do not substitute statuses, waive or claim these release tests passed.

Provider acceptance: 6 tests pass, zero skips, including real PostgreSQL 18.6
and MySQL 8.0.46; four cleanup tests pass.
Use node scripts/test-database-providers.mjs for disposable POSIX native providers.
Final root/all ten non-Desktop package types pass. Existing services were untouched.

Deno Deploy acceptance now passes using both tokens loaded through interactive
zsh from ~/.zshrc. Installed compiled artifacts run on provider Deno 2.9.5:
POST body/two cookies, production assets/hydration and HTTP/SSE/WebSocket
mutations pass. Exact app UUID ownership was checked before DELETE204; GET404
and a separate coordinator lookup confirm cleanup. Both Deno harness files are
verified for this batch. [Evidence](./release-0.9.0-verification-archive.md#codex-deno-deploy-hosted-2026-10-09).
Private evidence: /tmp/cossack-deno-hosted-mFjtUA. This proves uploaded compiled
installed artifacts, not provider source builds or final 0.9.0 packages.

Open: **CF-09, REL-02, REL-03, REL-04, REL-05 (5)**. CF-09 needs actual
hosted CI lifecycle/isolation/retry/unchanged-production evidence and portable CI
credentials; cf/Wrangler login alone is not CI authentication. User authorized
creating/running/deleting a temporary private GitHub acceptance repository and
will add CLOUDFLARE_API_TOKEN to ~/.zshrc; final interactive check still finds it
absent. No GitHub/CI resources created. Portable installed app and reviewed setup/
teardown: /tmp/cossack-preview-ci-20261009-agent (setup.mjs prepare/provision/run/
cleanup). Supply verified accountId from prior plan if env absent, revalidate access
before writes. CI evidence helper has 21 passing regressions; hosted case skipped.
REL-02 remains gated on CF-09, not on a premature 0.9.0 version bump. Current
retained public APIs/guides match source; Studio asset names/CSS and a build cache
differ. REL-03 needs its green full CLI/runtime gate. Then REL-04 bumps versions
and repeats affected artifact/install checks before REL-05 audits the final state.
[Original order and payload audit](./release-0.9.0-verification-archive.md#codex-release-gate-order-audit-2026-10-09).
Unreleased [changelog](../CHANGELOG.md) and [release notes](./release-notes-0.9.0.md)
are now prepared; coordinator reviewed claims and all 97 local links/anchors.
Current-API migration coverage now maps all 58 IDs; missing runtime/CLI/scaffold/
config/DI/DataTable/deployment instructions are filled. All 75 guide links resolve;
nine previously compiled examples are unchanged. [Audit](./release-0.9.0-verification-archive.md#codex-migration-coverage-2026-10-09).
REL-04 still needs version alignment and affected build/install proof after its
dependency gates. No source changes or rerun checks in these documentation batches;
counts remain 53/5.
Preserve reports.md/.zcodeignore and the two baseline Workflow probes.

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

1. Finish CF-09 hosted CI previews; CF-08 and CF-10 acceptance is complete.
   Local static plans do not prove hosted CI isolation or unchanged production.
2. Resolve REL-03 strict local Waiting/full CLI and expanded hosted-test failures;
   SVC-04 original acceptance is complete. Preserve the strict older probes.
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
  Hosted Deno compiled-artifact acceptance passes; the required final non-Desktop
  release matrix remains open.
  Generated Node and Deno standalone draining are verified.
- Local checks do not prove remote readiness. CF-08 now has actual hosted acceptance and verified cleanup; no production promotion, publication, push or credential rotation occurred.
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
