# Cossack 0.9.0 agent handoff

Author: **Codex**. Updated on 2026-10-03 after compacting checkpoint `8f084e0`.
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

The following work is already implemented and tested:

- Typed URL codecs, query intents, pending-query merging and matching local drafts.
- Independent request-reader deadlines, stale-result rejection, a 30-second
  navigation budget and bounded history restoration.
- Preparation before publication, terminal destruction, owned rendering and
  precommit recovery of the tree, contexts, resources, drafts and history.
- Nested and inactive-cache draft transfer with class, parent, key and scope
  matching. Plain draft graphs are copied; opaque File/native values retain identity.
- Service lifetime through DOM removal and asynchronous cleanup. Task publication
  is revoked immediately while cleanup retains its request facilities.
- Fresh root App/service scopes for changed user or navigation ownership.
  Same-owner navigation retains drafts. Guarded root listeners reject stale renders,
  failed replacement restores the old App, and null output clears the old DOM.
  A child transport change alone does not replace the App.

Parent-layout acceptance now passes with decorated inherited routes. Root drafts
and services remain live while replaced layout/page drafts reset. Returning to
the old route creates fresh nested services, with exactly-once retired disposal.
This exposed and fixed inherited render/API method lookup returning 405. Authored
ancestors now participate, while framework defaults and accessor handlers do not.
See the [inheritance verification](./release-0.9.0.md#codex-route-inheritance-2026-10-03).

The latest [root ownership verification](./release-0.9.0.md#codex-root-ownership-2026-10-03)
records the implementation in `8f084e0`. Tests use declared layout services.
Legacy undeclared global dependency injection is outside that ownership contract.
The query-based test identity is not an authentication example.

Development navigation diagnostics now emit a versioned, frozen decision stream.
It correlates cache reads, layout commit attempts, actual scroll outcomes,
transition fallbacks and final outcomes without exposing URLs or application data.
See the [event contract](../docs/prevent-navigation.md#development-diagnostics) and
[verification](./release-0.9.0.md#codex-navigation-diagnostics-2026-10-03).

The URL-state fixture now reads from a counting HTTP backend on both production
Node and native workerd. Fresh SSR reads page/layout once each. Hydration, cached
history, guards and rollback add no reads. Pending SSR, rapid changes and stale
response release have exact count assertions. See the
[backend-read verification](./release-0.9.0.md#codex-url-backend-reads-2026-10-03).

Same-URL history acceptance also passes on Node/native workerd. Delayed restoration
queues a newer intent behind the correct entry. A newer navigation supersedes a
held confirmation response. Entry positions, history length, page/service/File
drafts and actual backend counts remain correct after release. See the
[verification](./release-0.9.0.md#codex-same-url-history-2026-10-03).

Continue in this order:

1. Finish the native ownership matrix for provider/runtime/transport. User/scope
   and parent-layout changes already pass. Use decorated route modules; bare
   default re-exports do not establish compiler transport metadata.
2. Extend the existing backend-read and diagnostic assertions to those remaining
   ownership cases. Cache events do not substitute for backend read counts.
3. Audit every original RT-08/RT-09 criterion against the implementation and
   evidence before checking either task. Same-URL restoration/confirmation and
   the existing URL-state read-count matrix are now verified, not pending work.

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

The same-URL checkpoint repeats all 4 production navigation cases and root/all
11 package type checks after test-only changes. The
[diagnostic checkpoint](./release-0.9.0.md#codex-navigation-diagnostics-2026-10-03)
records the latest library builds and unit suites.

| Check | Result |
| --- | --- |
| Core tests | 1,437 passed, 85 files |
| Framework tests | 1,453 passed, 68 files |
| Production Node/native workerd navigation | 4 passed, 26 skipped; production diagnostic silence verified |
| Core/framework builds, including framework SSG | Passed |
| Root `pnpm tsc --noEmit` and `pnpm typecheck` | Passed; all 11 package checks |
| Full generated-runtime file at `75609d2` | 30 passed |
| Renderer / full CLI at `8f084e0` | 284 / 610 passed; not rerun for diagnostics |

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
