# Cossack 0.9.0 agent handoff

Author: **Codex**. Updated on 2026-10-04. Historical checkpoint narratives remain in the verification log.
Branch: `fix-084`. **24 of 58 release tasks are complete; 34 remain open.**
Versions remain **0.8.3** until REL-04. This is a continuation handoff, not a release.

Read the [release checklist](./release-0.9.0.md) for authoritative task status and
verification evidence. Read the [detailed plan](./release-0.9.0-plan.md) for each
task's purpose, source locations, dependencies, implementation steps and acceptance
criteria. All unchecked tasks remain in scope, including partially implemented ones.

Completed checkpoint narratives and superseded next steps are condensed below.
Their evidence remains in the release verification log. The full earlier handoff
is available with `git show 8f084e0:specs/handoff-0.9.0.md`.

## Completed release tasks

These are the 24 checked tasks. Use the linked plan sections and their verification
links when changing these features; do not repeat completed implementation work.

| Task | Completed work |
| --- | --- |
| [CLI-01](./release-0.9.0-plan.md#cli-01) | Lifecycle flags, command help and read-only creation dry runs. |
| [CLI-02](./release-0.9.0-plan.md#cli-02) | Shared command metadata, strict flags, aliases, arity and capability checks. |
| [CLI-03](./release-0.9.0-plan.md#cli-03) | Versioned JSON, stable diagnostics, exit codes and noninteractive command execution. |
| [CLI-04](./release-0.9.0-plan.md#cli-04) | Compiler-backed inspect/check/explain with source locations and runtime/scaffold facts. |
| [CLI-05](./release-0.9.0-plan.md#cli-05) | Resource, validated mutation, protected-route and scoped-service recipes. |
| [CLI-06](./release-0.9.0-plan.md#cli-06) | Versioned upgrades with dependency/file ownership, conflicts and preserved user edits. |
| [RT-02](./release-0.9.0-plan.md#rt-02) | Typed validated actions, schema migration, field errors and resource policy gates. |
| [RT-03](./release-0.9.0-plan.md#rt-03) | Typed resource pending/error/retry, refresh, invalidation and SSR hydration. |
| [RT-04](./release-0.9.0-plan.md#rt-04) | State/store/computed guidance and development mutation/serialization diagnostics. |
| [RT-05](./release-0.9.0-plan.md#rt-05) | Typed task dependencies, owned commits, cleanup and stale-work cancellation. |
| [RT-06](./release-0.9.0-plan.md#rt-06) | Owned optimistic updates, rollback, concurrency and uncertain-outcome recovery. |
| [RT-07](./release-0.9.0-plan.md#rt-07) | Typed routes/API contracts and effective route/boundary inspection. |
| [RT-08](./release-0.9.0-plan.md#rt-08) | Typed URL state, SSR/hydration, merged query intents, drafts and history. |
| [RT-09](./release-0.9.0-plan.md#rt-09) | Bounded navigation outcomes, stale ownership, cache/layout/scroll/transition diagnostics and browser acceptance. |
| [RT-14](./release-0.9.0-plan.md#rt-14) | Typed resource authorization and boolean client visibility projections. |
| [RT-18](./release-0.9.0-plan.md#rt-18) | Cache/limiter capabilities, millisecond TTL contracts and shared durable budgets. |
| [RT-19](./release-0.9.0-plan.md#rt-19) | Realtime status, reconnect/resync and pending-call errors without mutation replay. |
| [RT-25](./release-0.9.0-plan.md#rt-25) | Shared build/scaffold/inspection capability checks for supported runtimes. |
| [CF-03](./release-0.9.0-plan.md#cf-03) | Secret declarations, placeholder checks, ignore rules and binding types. |
| [CF-05](./release-0.9.0-plan.md#cf-05) | Distributed Cloudflare SSE coordination, subscriptions and bounded reconnect history. |
| [CF-06](./release-0.9.0-plan.md#cf-06) | Built-artifact/workerd acceptance for auth, RPC, assets, SSG, bindings and migrations. |
| [CF-07](./release-0.9.0-plan.md#cf-07) | Public-only SSG and Worker-first protected assets. |
| [CF-11](./release-0.9.0-plan.md#cf-11) | Removed tracked credential values; external rotation remains unperformed. |
| [REL-01](./release-0.9.0-plan.md#rel-01) | Original report fixes and package/SSG regressions. |

## Next work

RT-08 and RT-09 are complete. Their [criterion audits](./release-0.9.0-plan.md#rt-08)
and [acceptance record](./release-0.9.0.md#codex-navigation-acceptance-2026-10-04)
replace the older pending navigation steps. Do not repeat completed ownership work.
The public [URL-state contract](../docs/url-state.md) records draft and service limits.

CLI-07 now has a tested read-only `cossack-mcp --project <directory>` entrypoint.
See [setup](../docs/local-agent-tools.md) and the
[checkpoint](./release-0.9.0.md#codex-local-mcp-2026-10-04). It shares static inspection,
reports installed versions and uses bounded cancellable workers. This task remains open.

CLI-08 now has `cossack docs` and MCP `read_documentation` for fresh installed
export targets, command schemas and packaged/scaffolded agent guidance. See the
[catalog checkpoint](./release-0.9.0.md#codex-installed-catalog-2026-10-04).

Next add named-symbol/signature indexing, authored API/component/recipe guidance,
verified runtime support and executable examples. Prove offline behavior from
installed tarballs. Then continue CLI-07 stored test results and RT-28 snapshots/
traces through shared services. Both CLI tasks remain open. A present export file
does not prove runtime importability. Preserve the original acceptance criteria.

Keep every other unchecked task in scope. Close tasks only against their original
criteria. Versions stay 0.8.3 until REL-04.

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

## Latest verification

The [catalog checkpoint](./release-0.9.0.md#codex-installed-catalog-2026-10-04) records current CLI/scaffold results.
The [navigation acceptance record](./release-0.9.0.md#codex-navigation-acceptance-2026-10-04)
records unchanged runtime/browser evidence. Earlier suites are labeled by checkpoint.

| Check | Result |
| --- | --- |
| Documentation / MCP / CLI regressions | 212 passed; final malformed-manifest follow-up: 18 passed |
| Scaffold tests | 78 passed |
| Full generated-runtime matrix | 31 passed |
| Navigation/guard/transition browser suites | 27 passed |
| Focused core / framework navigation suites | 70 / 50 passed |
| Root `pnpm tsc --noEmit` and `pnpm typecheck` | Passed; all 11 package checks |
| Full core / framework at `bd96db4` | 1,442 / 1,453 passed; not rerun for this audit |
| Core/framework builds including SSG at `bd96db4` | Passed; not rerun for this audit |
| Renderer / full CLI at `8f084e0` | 284 / 610 passed; not rerun for this audit |

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
