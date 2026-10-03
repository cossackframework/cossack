# Cossack 0.9.0 agent handoff

Author: **Codex**. Updated on 2026-10-04. Historical checkpoint narratives remain in the verification log.
Branch: `fix-084`. **22 of 58 release tasks are complete; 36 remain open.**
Versions remain **0.8.3** until REL-04. This is a continuation handoff, not a release.

Read the [release checklist](./release-0.9.0.md) for authoritative task status and
verification evidence. Read the [detailed plan](./release-0.9.0-plan.md) for each
task's purpose, source locations, dependencies, implementation steps and acceptance
criteria. All unchecked tasks remain in scope, including partially implemented ones.

Completed checkpoint narratives and superseded next steps are condensed below.
Their evidence remains in the release verification log. The full earlier handoff
is available with `git show 8f084e0:specs/handoff-0.9.0.md`.

## Completed release tasks

These are the 22 checked tasks. Use the linked plan sections and their verification
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

## Current work: RT-08 and RT-09

Typed URL state and navigation are implemented in part. Both release tasks remain
open. Read [RT-08](./release-0.9.0-plan.md#rt-08),
[RT-09](./release-0.9.0-plan.md#rt-09) and the [URL-state contract](../docs/url-state.md).

Completed implementation within these open tasks is summarized below. Detailed
results remain in the linked verification records. Do not repeat this work unless
the acceptance audit finds a gap.

| Implemented and tested | Evidence / contract |
| --- | --- |
| Typed URL codecs, merged pending queries, matching drafts, bounded requests/history restoration, stale-result rejection and precommit recovery. | [URL-state contract](../docs/url-state.md) and [RT-08 plan](./release-0.9.0-plan.md#rt-08) |
| Nested/cache draft transfer matches class, parent, key and scope. Plain graphs are copied; File/native values retain identity. Services survive asynchronous DOM cleanup while task publication stops immediately. | [RT-09 plan](./release-0.9.0-plan.md#rt-09) |
| Changed user/ownership replaces the root App and services. Failed replacement restores the old App. Stale renders are rejected and null output clears DOM. | [Root ownership](./release-0.9.0.md#codex-root-ownership-2026-10-03) |
| Parent-layout changes preserve root drafts/services, reset replaced descendants and dispose retired services once. Inherited authored render/API handlers work. | [Route inheritance](./release-0.9.0.md#codex-route-inheritance-2026-10-03) |
| Development diagnostics correlate cache, layouts, scroll, transitions and outcomes without application data. | [Event contract](../docs/prevent-navigation.md#development-diagnostics), [verification](./release-0.9.0.md#codex-navigation-diagnostics-2026-10-03) |
| Node/workerd fixtures count actual backend reads across SSR, hydration, cache/history, rapid changes, guards, rollback and late responses. | [Backend reads](./release-0.9.0.md#codex-url-backend-reads-2026-10-03) |
| Same-URL history restores the correct entry and supersedes held confirmations while preserving drafts, entry positions and backend counts. | [Same-URL history](./release-0.9.0.md#codex-same-url-history-2026-10-03) |
| HTTP/SSE child transitions retain root/layout ownership. Node/workerd runtime changes reset the tree. Retired SSE callbacks cannot update state. | [Runtime ownership](./release-0.9.0.md#codex-runtime-ownership-2026-10-03) |
| Actual Node/workerd sockets cover scoped provider targets, same-target replacement and return to HTTP. Retirement closes status, cancels timers, settles calls and rejects late callbacks. | [WebSocket ownership](./release-0.9.0.md#codex-websocket-ownership-2026-10-04) |

Ownership tests use declared layout services. Legacy global dependency injection
remains outside that contract. Query-based test identity is not an authentication
example. A child transport change alone does not replace the root App.

Continue in this order:

1. Audit every original RT-08/RT-09 criterion against current implementation and
   evidence. The planned user/scope, parent-layout, HTTP/SSE/WebSocket/provider-target,
   Node/workerd runtime, same-URL history and backend-read scenarios now have tests.
2. Run the relevant navigation/guard/view-transition browser suites and the full
   generated-runtime matrix on the final implementation. Inspect gaps rather than
   inferring closure from unit counts. Keep final release gates separate.
3. Close RT-08/RT-09 only when that audit proves their written criteria, then
   continue all other unchecked release tasks. Preserve the full 58-task scope.

Start in `packages/core/src/client/navigation.ts`,
`packages/framework/src/client/app.ts` and `packages/renderer/src/cossack-html.ts`.
Generated browser fixtures live in `packages/cossack/tests/fixtures/`:
`url-state-acceptance.js` and `navigation-ownership-acceptance.js`.
Same-URL cases live in `same-url-history-acceptance.js`. Their runner is
`packages/cossack/tests/generated-runtime-build.test.js`.

## Remaining release scope and known limits

After the navigation work, continue every unchecked row in the release checklist.
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

The [WebSocket ownership checkpoint](./release-0.9.0.md#codex-websocket-ownership-2026-10-04)
records the latest runs. Older unaffected-suite evidence remains linked below.

| Check | Result |
| --- | --- |
| Core tests | 1,442 passed, 85 files |
| Framework tests | 1,453 passed, 68 files |
| Production Node/native workerd navigation | 5 passed, 26 skipped, including runtime switch, SSE/WebSocket targets, backend reads and same-URL history |
| Core/framework builds, including framework SSG | Passed |
| Root `pnpm tsc --noEmit` and `pnpm typecheck` | Passed; all 11 package checks |
| Full generated-runtime file at `75609d2` | 30 passed; suite now contains 31 cases |
| Renderer / full CLI at `8f084e0` | 284 / 610 passed; not rerun for this checkpoint |

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
