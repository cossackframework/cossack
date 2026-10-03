# Cossack 0.9.0 agent handoff

Author: **Codex**. Updated on 2026-10-04. Historical checkpoint narratives remain in the verification log.
Branch: `fix-084`. **24 of 58 release tasks are complete; 34 remain open.**
Versions remain **0.8.3** until REL-04. This is a continuation handoff, not a release.

Read the [release checklist](./release-0.9.0.md) for authoritative task status and
verification evidence. Read the [detailed plan](./release-0.9.0-plan.md) for each
task's purpose, source locations, dependencies, implementation steps and acceptance
criteria. All unchecked tasks remain in scope, including partially implemented ones.

## Completed work

The 24 completed tasks are grouped below. Details and acceptance evidence remain
in the [release checklist](./release-0.9.0.md) and linked task plans.

| Completed tasks | Summary |
| --- | --- |
| CLI-01–06 | Command contracts, static inspection, feature recipes and safe upgrades. |
| RT-02–09 | Validated actions, resources, state, tasks, optimistic updates, typed routes, URL state and navigation. |
| RT-14, RT-18, RT-19, RT-25 | Authorization, cache/limiter contracts, realtime recovery and runtime capability checks. |
| CF-03, CF-05–07, CF-11 | Secret declarations, distributed SSE, workerd acceptance, protected assets and credential removal. External rotation remains unperformed. |
| REL-01 | Report fixes and package/SSG regressions. |

RT-08/RT-09 passed their [acceptance audit](./release-0.9.0.md#codex-navigation-acceptance-2026-10-04).
The [URL-state contract](../docs/url-state.md) records draft and service limits.
Earlier handoff details remain available with `git show 8f084e0:specs/handoff-0.9.0.md`.

## Next work

CLI-07 and CLI-08 remain open. Their implemented foundations are:

- `cossack-mcp --project <directory>`: static inspection, installed versions and bounded cancellable workers.
- `cossack docs` and MCP `read_documentation`: installed exports, command schemas and packaged agent guidance.
- `docs --package <name> --symbols --json` or MCP `symbols: true`: signatures, prop contracts, comments and index signatures through a pinned TypeScript 6 API alias.
- Package-owned guides: typed route URLs, server HTML and four feature recipes include TypeScript examples. Discovery reads their source without executing it.
- Wildcard exports and implicit JS/ESM/CommonJS declarations: exclusions and partial results remain explicit. Runtime availability remains unverified.

See [setup and usage](../docs/local-agent-tools.md) and the
[latest catalog checkpoint](./release-0.9.0.md#codex-prop-catalog-2026-10-04).

Next expand authored API/component/recipe guidance and executable examples,
and add verified runtime support. Extend the installed-tarball acceptance to cover that content.
RT-23 still needs a controlled DataTable and native attribute, keyboard/focus and accessibility acceptance.
Then continue CLI-07 stored test results and RT-28 snapshots/traces through shared services.
Close tasks only against their original acceptance criteria. Every unchecked task remains in scope.

## Remaining release scope and known limits

Continue every unchecked row in the release checklist.
Use its linked task plans rather than old checkpoint instructions. Remaining areas
include local MCP/offline agent guides, transport/session parity, application APIs,
background services, deployment environments/resources, observability and release gates.

Carry these unresolved limits into implementation and review:

- RT-01 still needs native pre-header disconnect delivery, arbitrary action
  deadlines and initialization/restoration concurrency acceptance. Explicit
  coordinator cancellation passes; it does not prove incoming TCP abort delivery.
- RT-11 retains session and stream-response cookie requirements. Native calls
  require explicit parsing/authorization. UI visibility is not authorization.
- Task cancellation and optimistic rollback do not terminate ignored application
  I/O, undo external side effects or replay uncertain mutations.
- Cloudflare SSE uses the coordinator. Node/Deno keep documented process-local
  behavior. See [SSE architecture](./sse.md) and [SSE usage](../docs/sse.md).
- Existing Wrangler files are preserved by upgrades. Existing apps must add
  `enable_request_signal` explicitly where required.
- REL-03 still includes plain Node Vite development routing, Deno execution,
  Electron launch/packaging and the full runtime/release acceptance matrix.
  Focused builds and browser tests do not close those gates.
- Local deployment checks do not prove remote readiness. No live deployment,
  provisioning, publication, push or credential rotation was performed.
  Never copy old credential values from Git history.

## Verification references

The [prop-catalog checkpoint](./release-0.9.0.md#codex-prop-catalog-2026-10-04)
records 36 focused tests, installed UI CLI/MCP parity, six executable examples
and root/package type checks. Prior scaffold evidence remains in the release log.

The [installed documentation acceptance](./release-0.9.0.md#codex-installed-docs-acceptance-2026-10-04)
proves CLI/MCP catalog parity, version/export refresh and discovery with Node networking disabled in a generated tarball installation.

Use the [discovery checkpoint](./release-0.9.0.md#codex-export-discovery-2026-10-04)
for current CLI work and its test logs. The
[declaration checkpoint](./release-0.9.0.md#codex-declaration-index-2026-10-04)
records the previous CLI checks. The
[navigation acceptance record](./release-0.9.0.md#codex-navigation-acceptance-2026-10-04)
records runtime and browser checks. Older suite results remain in the release log
under their original checkpoints. They do not prove the current full release matrix.

## Working rules

- Read `AGENTS.md`, [architecture](./architecture.md) and applicable task specs.
  Use pnpm. Alpha-stage API breaks are acceptable.
- Keep libraries independent of framework/application. Keep `cloudflare:workers`
  imports out of core and Node/Deno runtime import graphs.
- Use installed Cloudflare skills and current official documentation when changing
  Workers, Durable Objects or Wrangler behavior.
- The recorded baseline is Wrangler 4.114.0, Cloudflare Vite plugin 1.47.0 and
  Vite 8.1.4. Verify compatibility before upgrades.
- Build dependencies before consumers. Never overlap builds that replace `dist`
  with tests or type checks that read it. Framework pretest rebuilds declarations;
  use `pnpm --filter @cossackframework/framework exec vitest run` after building.
- Run meaningful regression tests, root `pnpm tsc --noEmit` and package type checks
  after source changes. Run heavy CLI/generated suites without competing heavy jobs.
- Preserve the user's uncommitted `reports.md` and `.zcodeignore`. Do not stage them.
  Use `git diff --check -- . ':!reports.md'` for the known report whitespace exception.
- The user arranges GLM continuation. Do not infer permission to delegate, start
  chats, message others, publish or deploy from this handoff.
- Update this handoff with current results and next steps. Put historical evidence
  in the release verification log instead of appending repeated checkpoint narratives.
