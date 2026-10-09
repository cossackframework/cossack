# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-09)

**55 complete / 3 open**, versions 0.8.3. Latest batch completes cross-feature
acceptance scenarios **1, 2 and 3**, following scenario 4 and hosted Workflow
completion. No numbered release task closes. [Evidence](./release-0.9.0-verification-archive.md#codex-cross-feature-scenarios-123-2026-10-09).

Three independently owned fixture/test pairs use retained installed file tarballs
in fresh private apps. Actual workerd/D1/Chromium proves the protected typed
resource/URL filter/validated edit, preserved failed input and anonymous forged
RPC denial without effects. Two native Workers/shared DO prove concurrent
permitted edits, converged subscriptions, explicit TCP cancellation and live
other-scope isolation. Native Queue/D1 proves response-before-consumer ordering,
transient retry, delivery or changed-preference suppression, JSON-only envelopes
and four consumer cleanup receipts. Test identities are synthetic; no real login,
email delivery, hosted execution or cancellation rollback is claimed.

Final combined acceptance: **3 passed / 0 skipped**, 31.29 seconds. Each generated
application's types/build pass; background bindings are generated with Wrangler.
Root `pnpm tsc --noEmit` passes. Coordinator reviews provenance, isolates Vite
caches, corrects truthful teardown receipts and avoids mixed-time D1 observations.
All native owners close; realtime/background private apps are removed and the
protected app's private dependencies are detached. No product APIs changed,
packages repacked, installations performed or cloud resources written.

Open: **REL-03, REL-04, REL-05 (3)**. Next independent work is [scenario 5](./release-0.9.0-scenario-audit.md#5-hosted-staging-ci-explicit-migrations-and-protected-rpc):
actual hosted CI must apply an explicit migration plan to its staging target and
test protected assets plus authorized/unauthorized RPC while preserving production
and cleaning preview-owned resources. Retained CF-09 CI proves preview lifecycle,
cleanup and production isolation; its simple smoke does not prove those additions.

REL-03's strict local Waiting/full CLI gate remains red: current Miniflare lacks
native Waiting. Preserve the user-owned probe; do not patch the simulator or
substitute Running. After the implementation gate, align versions and rerun
affected artifacts before final REL-03/04 completion. REL-05 then audits every
requirement. Scenarios 1–4 retain current-version proof, not final 0.9.0 proof.
Earlier hosted Workflow, CF-09/REL-02, CF-08, SVC-04, Deno, database and other
unchanged acceptance retain their archived scope. Temporary cloud resources from
those batches are confirmed absent; do not rerun their deleted resource options.

Private proof/setup: /tmp/cossack-preview-ci-20261009-agent. The latest repository
and cloud IDs are deleted; do not rerun its options against deleted resources.
Earlier failed attempts and recovered cleanup are retained in private archives.
The cf-created account token remains intentionally available through interactive
zsh (~/.zshrc), restricted to the test account and Worker/D1 writes, expires
2026-10-10T00:52:59Z. Credentials remain outside the repository; never print them.

**Desktop is complete by user decision; remaining platform checks are waived.**
Do not reopen it. Preserve unrelated reports.md, .zcodeignore and both baseline
Workflow probe files; do not stage them. The [checklist](./release-0.9.0.md) owns
status; [plan](./release-0.9.0-plan.md) retains open-task context;
[verification archive](./release-0.9.0-verification-archive.md) retains evidence.

## Active implementation plan — Codex owns remaining work (2026-10-06)

1. Finish cross-feature scenario 5 using a fresh owned hosted CI acceptance app.
   Scenarios 1–4 and expanded hosted Workflow acceptance pass at current versions.
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
