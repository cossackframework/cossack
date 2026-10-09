# Cossack 0.9.0 continuation notes

## Current handoff — Codex (2026-10-09)

**58 complete / 0 open. REL-03, REL-04 and REL-05 are complete.** Root and all
13 package manifests are 0.9.0. Twelve non-Desktop public artifacts pass installed
acceptance. This is verified release preparation; packages remain unpublished.
The commit containing this handoff follows `6f9639b1`; use Git history for its ID.

[Final verification](./release-0.9.0-verification-archive.md#codex-final-release-acceptance-2026-10-09), [requirement audit](./release-0.9.0-requirement-audit.md)
and [scenario audit](./release-0.9.0-scenario-audit.md) own the detailed receipts.
Full CLI: 1,267 passed / 0 failed / 18 skipped. Non-CLI package suites: 5,584
passed, with two provider cases separately proven by six native PostgreSQL/MySQL
tests. Root and ten non-Desktop package typechecks, builds and bundle audit pass.
Installed public imports, 116 packaged examples, configuration/browser isolation,
deployment guidance, migrations and affected CLI/runtime scenarios pass.

Database tooling now activates its TypeScript loader only when reading a config;
native guarded imports make zero IPC/network attempts, and TS configs still load.
The [user-approved Workflow split](./release-0.9.0-workflow-acceptance.md) proves
literal Waiting on hosted Cloudflare and the remaining lifecycle locally. The
original strict local probe remains unchanged and excluded from the revised gate.

Earlier 297-case browser and hosted Cloudflare/Deno/CI evidence retains its archived
version/scope through reviewed unchanged runtime payloads. It was not rerun under
new version labels. Changed database tooling has fresh source/native/installed
proof. Primary native Cloudflare acceptance uses Wrangler 4.114.0, plugin 1.47.0
and Vite 8.1.4. Newer 4.148.0 native Workflow acceptance failed and is not claimed;
ordinary generated builds with newer tools have separate passing proof.

**Desktop remains complete by user decision; remaining platform checks are waived.**
Only its version metadata changed. Preserve reports.md, .zcodeignore and both
baseline Workflow probe files; their bytes are unchanged and they are unstaged.

## Latest development follow-up — Codex (2026-10-09)

Linked Core/renderer/UI dependencies share optimized entries with safe rebuild
invalidation; SSR Hono is optimized too. Cold/warm startup measures 9.945/9.940 s
in the final native run, versus 13.767/13.563 s in its prior-config comparison.
Local final samples range 9.9–12.6 s cold and 9.9–11.4 s warm. Browser load/settle
also improves; hydration, HTTP actions and UI blocks pass. SSG is build-only and
DevTools releases its port on close. 223 tests, root/Framework types, declaration
build and rebuilt public SSG import pass. Earlier release/packed/hosted receipts
retain their exact scope; task count remains 58 complete / 0 open, Desktop waived.
[Current receipt](./release-0.9.0-verification-archive.md#codex-cold-warm-startup-2026-10-09) and
[earlier bootstrap follow-up](./release-0.9.0-verification-archive.md#codex-development-startup-2026-10-09).
Remaining startup time still includes eager server route loading; this batch makes
no claim about production cold starts, full CSS performance or other machines.

## Continuation

No numbered release work remains. Publication, tagging, upstream push or production
promotion requires a separate request. Do not reuse deleted hosted resource options
or assume old credentials remain valid. Final private receipts/artifacts are in
`/tmp/cossack-release-090-final`; installed consumers are named in the archive.
Keep current notes compact and preserve failed/historical receipts in that archive.

## Limits to retain

- Native trace evidence uses a separate channel with a one-second background
  receipt bound. It does not delay responses or prove client consumption. Headers
  do not prove body completion; socket terminals do not prove later cleanup.
  Stored records are not live state.
- Preserve the [paused-iterator deadline regressions](./release-0.9.0.md#codex-paused-rpc-deadlines-2026-10-04):
  first failure codes, confirmed state, one cancellation request and cleanup without another iterator pull.
- RT-01 native Node/workerd disconnect and component initialization/restoration acceptance is complete. Cancellation remains cooperative and does not stop ignored application I/O.
- Historical CLI failures remain archived, including 1,259 passed / 2 failed / 24 skipped before this batch’s repairs. The corrected full invocation is green: 1,267 passed / 0 failed / 18 skipped. Six Desktop cases are waived; twelve opt-in cases have separate scoped evidence. The user-approved split does not claim local literal Waiting passed.
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
  Hosted Deno compiled-artifact acceptance retains its scope; the final non-Desktop
  matrix and affected 0.9.0 checks pass.
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
