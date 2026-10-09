# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-09)

**55 complete / 3 open**, versions 0.8.3. All five original cross-feature
acceptance scenarios now pass at current versions. Latest batch finishes
**scenario 5** through actual hosted CI; no numbered release task closes.
[Evidence](./release-0.9.0-verification-archive.md#codex-hosted-staging-scenario-2026-10-09).

GitHub run **37880536071** installs retained tarballs, plans/applies the public
remote migration to the exact staging account/D1 UUID, verifies its persisted
checksum and zero pending migrations, and explicitly builds with staging bindings.
The native preview uses staging overrides. Anonymous protected asset/RPC requests
return 401 with no effects; authorized asset/RPC checks return 200 and create
exactly one D1 row. Identity is a server-owned synthetic cookie, not a real login.
Production Worker settings/active deployments and D1 schema/sentinel stay unchanged;
a separate coordinator read confirms all production fixture rows match bootstrap.

Combined acceptance: **24 passed / 0 skipped**, 154.09 seconds. Installed app
local types/build/native smoke and public local migration plan/up also pass;
root `pnpm tsc --noEmit` passes. Preview, temporary parent Worker/D1 pair,
known DO namespaces and private repository are independently confirmed absent.
An initial missing request-signal setup flag failed the existing deploy guard;
both first-attempt databases were deleted before the corrected fresh setup.
No product APIs, package versions or original workflow template changed; no repacks.

Open: **REL-03, REL-04, REL-05 (3)**. The exact remaining implementation gate
is strict local Workflow Waiting/full CLI: current Miniflare lacks the native
Waiting transition. Preserve the user-owned probe; do not patch the simulator,
substitute Running, weaken assertions or waive this gate. All five compositions
now have current-version proof. After the implementation gate passes, align 0.9.0
versions and rebuild/recheck affected artifacts, then finish the requirement audit.
Earlier unchanged hosted Workflow, CF-09/REL-02, CF-08, Deno and database evidence
retains its archived scope; final-version acceptance remains unproven.

Private latest proof/setup: /tmp/cossack-hosted-staging-20261009. Its cloud IDs
and repository are deleted; do not rerun its options. Earlier preview setup is
/tmp/cossack-preview-ci-20261009-agent, also deleted. Credentials remain outside
the repository. The scoped cf-created Worker/D1 token remains available through
interactive zsh and expires 2026-10-10T00:52:59Z; never print it.

**Desktop is complete by user decision; remaining platform checks are waived.**
Do not reopen it. Preserve unrelated reports.md, .zcodeignore and both baseline
Workflow probe files; do not stage them. The [checklist](./release-0.9.0.md) owns
status; the [plan](./release-0.9.0-plan.md) retains open-task criteria.

## Active implementation plan — Codex owns remaining work (2026-10-06)

1. Retain all five verified cross-feature compositions and hosted Workflow proof.
   These pass at current versions and do not establish final 0.9.0 artifacts.
2. Resolve REL-03 strict local Waiting/full CLI when upstream supports the required
   native status; do not patch the simulator or substitute Running for Waiting.
3. Finish the remaining non-Desktop release verification without weakening tests.
4. Align 0.9.0 versions and verify affected artifacts (REL-04), then audit REL-05.
5. Use at most three implementation agents with exclusive ownership, targeted
   checks, coordinator integration, one verified-batch record and explicit staging.

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
- RT-01 native Node/workerd disconnect and component initialization/restoration acceptance is complete. Cancellation remains cooperative and does not stop ignored application I/O.
- Initial CLI run: 1,007 passed / 19 failed / 6 skipped, with later targeted fixes. Latest terminal run: 1,112 passed / 2 failed / 9 skipped; MessageScroller is subsequently fixed, strict local Waiting remains red and three non-Desktop omissions pass separately. Six Desktop cases are waived. Neither composite proves a green full CLI gate.
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
- Local checks do not prove remote readiness. CF-08 has actual hosted acceptance and verified cleanup; that earlier batch performed no production promotion, publication, push or credential rotation. The latest CF-09 batch pushed only to its authorized temporary private repository, now deleted.
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
