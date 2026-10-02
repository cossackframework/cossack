# Cossack 0.9.0 agent handoff

Prepared on 2026-10-02 for GLM to continue implementation and Codex to review later.

> **Latest checkpoint — Codex runtime WebSocket scopes (2026-10-03):** read
> [scope creation and cleanup fixes](./release-0.9.0.md#codex-runtime-websocket-scopes-2026-10-03).
> **Author: Codex.** The guarded runtime WebSocket factory now constructs nested
> layout service scopes and bootstraps with original page parameters, user, and
> bindings. Page destruction disposes the whole tree; failed construction cleans
> up too. **12/58 tasks remain checked; RT-12 and RT-25 remain open.** Core: 673
> tests; framework: 608 tests; root and all package type checks passed.
> Next: route Node upgrades through the guarded framework hook, add adapter
> eviction/shutdown disposal and concurrent creation coverage, then verify real
> generated Node WebSocket connections. The legacy adapter is not wired in.

> **Previous checkpoint — Codex generated runtime builds (2026-10-03):** read
> [real configuration builds and Node startup correction](./release-0.9.0.md#codex-generated-runtime-builds-2026-10-03).
> **Author: Codex.** Generated Node/Deno and Desktop side-target builds now have
> acceptance coverage; Node's built HTTP app is exercised. Fixed imports crashing
> when process.argv[1] is absent. **12/58 tasks remain checked.** RT-25 still needs
> Node realtime wiring/capability parity and selected recipe feature requirements.
> Deno execution and Electron launch/packaging were not verified here.

> **Previous checkpoint — Codex handler/default parity (2026-10-03):** read
> [CLI classification and runtime selection corrections](./release-0.9.0.md#codex-handler-default-parity-2026-10-03).
> **Author: Codex.** CLI/build discovery recognize functional HTTP modules only
> inside the router's API boundary. Runtime component paths select default exports
> instead of whichever helper appears first. Runtime SSR/SSG/guard regressions
> verify the fixes. **CLI-04 complete; 12/58 tasks checked.** Full CLI: 539 passed;
> framework: 605 passed; all package types passed. Continue RT-25 generated-app/
> side-target acceptance and selected feature requirements.

> **Previous checkpoint — Codex recipe capability wiring (2026-10-03):** read
> [generated config and binding discovery](./release-0.9.0.md#codex-recipe-capability-wiring-2026-10-03).
> **Author: Codex.** Recipes now select runtime capability checks, including
> Desktop mode. Cloudflare binding discovery uses the project's Wrangler parser
> and selected environment, returning names only. **CLI-04 reopened; 11/58 checked.**
> Generated-app validation exposed named HTTP route handling and first-export
> versus default-export runtime selection that CLI inspection must reconcile.
> Build discovery now accepts named HTTP handlers. Continue those CLI/runtime
> fixes, then RT-25 complete generated-app acceptance and feature planning.

> **Previous checkpoint — Codex page capability discovery (2026-10-03):** read
> [shared parser and automatic build checks](./release-0.9.0.md#codex-page-capability-discovery-2026-10-03).
> **Author: Codex.** Framework now publishes `page-inspection`; CLI re-exports it.
> Selecting a build runtime automatically checks discovered page transports,
> without importing pages or repeating their requirements in config.
> **12/58 tasks remain checked.** Continue recipe/config integration,
> selected-environment binding discovery, and generated-app acceptance for RT-25.

> **Previous checkpoint — Codex schedule capability audit (2026-10-03):** read
> [adapter-dependent status and verification](./release-0.9.0.md#codex-schedule-capability-2026-10-03).
> **Author: Codex.** Node/Deno no longer advertise scheduled dispatch that their
> built-in adapters do not implement. Shared inspection reports `adapter-required`;
> selected schedule requirements fail builds with a dedicated diagnostic.
> **12/58 tasks remain checked.** Continue RT-25 automatic page requirements,
> recipe configuration, environment binding discovery, and generated-app builds.

> **Previous checkpoint — Codex build capabilities (2026-10-03):** read
> [selected requirement enforcement and next integration](./release-0.9.0.md#codex-capability-build-2026-10-03).
> **Author: Codex.** `cossackPages({ capabilities })` rejects unsupported or
> unconfigured selected features before bundle output, using the shared model
> and source-bearing diagnostics. **12/58 tasks remain checked.** RT-25 still
> needs recipe/generated-config integration, automatic page requirements,
> selected-environment bindings, and adapter capability verification.

> **Previous checkpoint — Codex CLI-04 completion (2026-10-03):** read
> [module validity fixes and requirement audit](./release-0.9.0.md#codex-module-inspection-2026-10-03).
> **Author: Codex.** Missing/unresolved default exports now fail route checks;
> unsupported inherited layout options and dynamic service references stay
> unknown. The compiler and executed SSG acceptance fixtures meet CLI-04's
> contract. **12/58 tasks are checked.** Verification: 534 CLI tests, executed
> service acceptance, and root types passed. Next continue **RT-25 build/recipe
> capability enforcement**; typed routes, config registry, and runtime release
> gates remain separate unfinished tasks.

> **Previous checkpoint — Codex service inspection (2026-10-03):** read
> [executed acceptance, fixes, and remaining audit](./release-0.9.0.md#codex-service-inspection-2026-10-03).
> **Author: Codex.** SSG now verifies inspected layout service ownership,
> shadowing, hydration, and disposal. Route checks reject ignored page service
> declarations. Inspection selects the actual indirect default export instead
> of a decorated helper. **11/58 tasks remain checked.** Next audit missing
> exports, inherited layout options, and imported service token identity.

> **Previous checkpoint — Codex combined inspection (2026-10-03):** read
> [acceptance coverage and remaining work](./release-0.9.0.md#codex-inspection-acceptance-2026-10-03).
> **Author: Codex.** Combined compiler/static inspection acceptance passes.
> Fixed missing layout middleware counts and exposed layout/page execution order;
> unresolved counts remain unknown. **11/58 tasks remain checked.** Next extend
> the fixture with executed service ownership/DI and check/explain diagnostics
> before closing CLI-04. Continue RT-25 build/recipe gating afterward.

> **Previous checkpoint — Codex inherited options (2026-10-03):** read
> [option resolution and real dispatch corrections](./release-0.9.0.md#codex-inherited-options-2026-10-03).
> Core now merges inherited server-method options with nearest declarations
> winning. Generated registration preserves inherited policies. Actual RPC dispatch
> also retains the receiver for inherited prototype actions. **11/58 tasks remain
> checked.** Continue CLI-04's complete grouped-route/layout/service acceptance
> and full lifecycle verification; the release goal remains active.

> **Previous checkpoint — Codex inherited RPC registration (2026-10-03):** read
> [compiled execution findings and next verification](./release-0.9.0.md#codex-inherited-rpc-2026-10-03).
> Fixed pre-super access to `this`, dropped constructor arguments, and missing
> inherited automatic RPC registration. Server/client compiled execution tests
> pass; full framework suite: 581 passed; all package types passed.
> **11/58 tasks remain checked.** Continue inherited option/real bootstrap parity
> and the complete CLI-04 acceptance fixture.

> **Previous checkpoint — Codex runtime inspection (2026-10-03):** read
> [shared capabilities, binding checks, and verification](./release-0.9.0.md#codex-runtime-inspection-2026-10-03).
> Route commands now use selected-environment bindings and the shared transport
> model. Missing bindings/unsupported transports fail checks. Node/Deno transport
> support remains explicitly process-local. **11/58 tasks remain checked.**
> Continue CLI-04's full framework acceptance fixture and inherited RPC behavior;
> RT-25 still needs build-time and recipe capability gating.

> **Previous checkpoint — Codex declaration dispatch (2026-10-03):** read
> [member precedence and verification scope](./release-0.9.0.md#codex-declaration-dispatch-2026-10-03).
> Route inspection resolves declared field/prototype/accessor precedence with
> owners and sources. Unknown precedence makes route checks fail. JavaScript
> fixtures verify the rules; runtime mutations and framework RPC installation
> remain outside this static result. **11/58 tasks remain checked.** Continue
> binding-aware capabilities and complete framework inspection acceptance.

> **Previous checkpoint — Codex member facts (2026-10-02):** read
> [member inventory and dispatch continuation](./release-0.9.0.md#codex-member-facts-2026-10-02).
> Compiler/route metadata now distinguishes fields, methods, accessors, static
> and private members, and unknown computed names, including imported bases.
> Resource fields reflect their generated getter form. **11/58 tasks remain
> checked.** Continue effective dispatch with runtime fixtures, then capabilities
> and full CLI-04 acceptance. The prior full workspace checkpoint remains below.

> **Previous checkpoint — Codex workspace verification (2026-10-02):** read
> [integration fixes and complete verification results](./release-0.9.0.md#codex-inspection-integration-2026-10-02).
> Workspace build, root types, all 11 package type checks, and all 2,492 unit tests
> across 13 packages passed. Fixed strict-null test assertions and an outdated
> route-explanation expectation found only by the broader checks.
> **11/58 tasks remain checked.** CLI-04 and release gates remain open; continue
> inherited dispatch, binding-aware capabilities, and full acceptance verification.

> **Previous checkpoint — Codex imported inheritance (2026-10-02):** read
> [relative source resolution and remaining limits](./release-0.9.0.md#codex-imported-inheritance-2026-10-02).
> Relative TypeScript bases and explicit re-exports now resolve without executing
> modules. Cycles, ambiguous paths, and unsupported imports remain unresolved.
> **11/58 tasks remain checked.** Continue inherited dispatch semantics,
> binding-aware capabilities, and CLI-04's full acceptance fixture.

> **Previous checkpoint — Codex local inheritance (2026-10-02):** read
> [base declarations and remaining resolution work](./release-0.9.0.md#codex-local-inheritance-2026-10-02).
> Local base methods now appear with declaring classes and source locations.
> Imported/dynamic bases produce explicit unresolved diagnostics in route checks.
> Own methods remain separate; effective inherited dispatch is still unverified.
> **11/58 tasks remain checked.** Continue imported-base resolution, dispatch
> semantics, binding-aware capabilities, and the full CLI-04 acceptance fixture.

> **Previous checkpoint — Codex scaffold inspection (2026-10-02):** read
> [shared recipe facts and remaining work](./release-0.9.0.md#codex-scaffold-inspection-2026-10-02).
> Inspection and composition now share manifest recipe reconstruction. Route JSON
> includes recorded features/dependencies; invalid metadata makes checks fail.
> Scaffold suite: 89 passed; CLI suites: 75 passed; final metadata suite: 4 passed.
> **11/58 tasks remain checked.** Continue inheritance, binding-aware capabilities,
> and CLI-04's complete acceptance fixture.

> **Previous checkpoint — Codex resource inspection (2026-10-02):** read
> [resource mapping and continuation requirements](./release-0.9.0.md#codex-resource-inspection-2026-10-02).
> Supported resource macros now expose compiler method identities and authored
> loader locations. Compiler tests: 147 passed; CLI suites: 72 passed; types passed.
> **11/58 tasks remain checked.** Continue CLI-04 inheritance resolution and
> scaffold/capability integration, followed by its full acceptance fixture.

> **Previous checkpoint — Codex parser availability (2026-10-02):** read
> [the removal of heuristic route facts](./release-0.9.0.md#codex-parser-unavailable-2026-10-02).
> Parser-unavailable page/layout options now remain unknown. Route suites:
> 37 passed; TypeScript passed. **11/58 tasks remain checked.** Continue CLI-04's
> unresolved project inheritance, macro mapping, and scaffold/capability work.

> **Previous checkpoint — Codex static options (2026-10-02):** read
> [the option-extraction corrections](./release-0.9.0.md#codex-static-options-2026-10-02).
> Nested SSG spreads/computed keys and invalid scalar options now remain unknown;
> duplicate enabled keys use the last value. Route tests: 36 passed; types passed.
> **11/58 tasks remain checked.** Continue CLI-04's project-level requirements.

> **Previous checkpoint — Codex namespace decorators (2026-10-02):** read
> [the compiler correction and verification](./release-0.9.0.md#codex-namespace-methods-2026-10-02).
> Namespace server methods/function fields now receive the same stripping and RPC
> classification as named imports. Namespace client methods remain in the browser.
> Compiler tests: 145 passed; route tests: 27 passed; type checks passed.
> **11/58 tasks remain checked.** Continue CLI-04's project model and source maps.

> **Previous checkpoint — Codex route checks (2026-10-02):** read
> [static route checks and remaining acceptance](./release-0.9.0.md#codex-route-checks-2026-10-02).
> `check routes` now fails for unknown metadata or invalid transports, with
> source-bearing diagnostics. Inheritance and runtime remain explicitly unchecked.
> **11/58 tasks remain checked; CLI-04 remains open.** Continue the project model,
> macro source mapping, and scaffold/capability integration.

> **Previous checkpoint — Codex compiler facts (2026-10-02):** read
> [the shared classifier and remaining project-model work](./release-0.9.0.md#codex-compiler-facts-2026-10-02).
> Route inspection now uses compiler own-method facts, including automatic RPC,
> retained helpers/fields, and stripped methods without RPC registration.
> **11/58 tasks remain checked; CLI-04 remains open.** Continue inheritance,
> macro source mapping, scaffold/capability metadata, and route checks.

> **Previous checkpoint — Codex compiler review (2026-10-02):** read
> [the preservation fix and CLI-04 continuation steps](./release-0.9.0.md#codex-compiler-preservation-2026-10-02).
> Deep client helper chains now survive compilation; cycles terminate and explicit
> server boundaries remain stripped. Security-plugin tests: 139 passed; root
> TypeScript check passed. **11/58 tasks remain checked; CLI-04 is still open.**
> Continue the shared compiler/scaffold inspection model described in that note.

> **Previous checkpoint — Codex structured upgrades (2026-10-02):** read
> [Codex's CLI-06 completion and continuation instructions](./release-0.9.0.md#codex-cli-upgrades-2026-10-02).
> **CLI-06 is complete; 11/58 tasks are checked.** Upgrade plans use the requested
> scaffold release and recorded dependency ownership. They preserve local edits,
> apply owned additions/removals, track file/manifest effects, and report partial
> failures. Subprocess fixtures and a real pnpm/local-registry tarball test pass.
> Continue CLI-04's compiler-backed inspection, then CLI-05/RT-25 recipes and
> capabilities. All 47 unchecked tasks remain in scope; versions remain 0.8.3.
> This supersedes CLI-06's partial status in the historical checkpoints below.

> **Previous checkpoint — Codex JSON contracts (2026-10-02):** read
> [Codex's CLI-03 completion and GLM instructions](./release-0.9.0.md#codex-cli-json-2026-10-02).
> **CLI-03 is complete; 10/58 tasks are checked.** All JSON commands run behind
> a CLI-owned process boundary. Finite commands emit one result; dev/start/Studio
> expose documented lifecycle events with bounded startup and shutdown. ORM
> errors hide connection values and identify the failing phase. Subprocess tests
> cover real effects, dry runs, project logs, malformed results, and cancellation.
> Continue CLI-06's dependency ownership/target-version templates, then CLI-04's
> compiler classification and CLI-05/RT-25 recipes/capabilities. Versions remain
> 0.8.3. The 48 unchecked tasks and final release gates remain in scope.
> This supersedes CLI-03's partial status in the historical checkpoints below.

> **Previous checkpoint — Codex CLI metadata (2026-10-02):** read
> [Codex's validation completion and GLM instructions](./release-0.9.0.md#codex-cli-metadata-2026-10-02).
> **CLI-02 is complete; 9/58 tasks are checked.** Parser, help, aliases,
> scoped options, arity, repetition, and target conflicts share command metadata.
> Invalid inputs fail before project imports/effects. Continue CLI-03's complete
> command-family machine contract matrix, then CLI-06, CLI-04, and recipe/runtime
> capabilities. Versions remain 0.8.3; the full release goal remains active.
> This supersedes the CLI-02 status in the historical checkpoints below.

> **Previous checkpoint — Codex continuation (2026-10-02):** read the
> [Codex implementation and continuation instructions](./release-0.9.0.md#codex-continuation-2026-10-02)
> before the next phase. The development WebSocket crash is fixed: Upgrade
> requests now bypass the HTTP asset bridge. Adapter, image, upgrade, and
> Studio have machine-output paths; Studio uses isolated lifecycle events.
> Upgrade plans precede effects and report partial failures; build/SSG JSON
> excludes raw project logs. **8/58 tasks are checked** and versions remain
> 0.8.3. CLI-02/03/06 still have acceptance work; the full release goal is active.
> Exact checks and limitations are in that new section. The prior
> [Group 3 review](./release-0.9.0.md#codex-review-group3-2026-10-02)
> records GLM's reviewed commits and earlier corrections. The distributed SSE
> prototype instructions below are historical and superseded by the completed
> GLM implementation and Codex fixes.

> **GLM continuation (2026-10-02):** the "Immediate continuation: distributed
> SSE" work below is finished — CF-05 is checked in
> [release-0.9.0.md](./release-0.9.0.md) and the design/verification record is
> [specs/sse.md](./sse.md). Deviations from the suggested approach: the
> coordinator's `execute()` takes no AbortSignal (AbortSignal-over-RPC needs
> the experimental `abort_signal` flag, unavailable on the pinned wrangler
> 4.114.0 baseline; cancellation uses response-body cancel propagation and the
> router wires `c.req.raw.signal` to `body.cancel()`), non-stream responses
> pass through `execute()` with an explicit `publish()` by the router callback,
> and the scaffold additionally emits a `COSSACK_ENV_BINDING_NOT_INHERITED`
> preflight diagnostic because Wrangler environments do not inherit Durable
> Object bindings. Environment note: the workspace pnpm virtual store was
> found emptied before this session; `pnpm install` was rerun. The rest of
> this handoff is the original checkpoint record.

Read [the detailed implementation plan](./release-0.9.0-plan.md) before continuing.
It explains all 58 checklist tasks, including their purpose, current baseline,
proposed implementation, dependencies, source locations, and acceptance criteria.
It also gives the suggested execution order and cross-feature acceptance scenarios.

## Status and scope

This is a work-in-progress checkpoint, not a release. The full objective is to
implement all agreed framework, developer-experience, agent-tooling, and
Cloudflare improvements for 0.9.0. The authoritative scope and verification
history are in [release-0.9.0.md](./release-0.9.0.md). Unchecked rows remain in
scope even where a partial implementation already exists. All versions remain
0.8.3 until the entire release passes its gates.

The current branch is `fix-084`. This handoff is committed with the implementation
checkpoint. The user will arrange GLM's continuation; no new agent or chat was
started. The original checkpoint paused the release implementation goal; the
user has since resumed the full unfinished release objective. The latest Codex
continuation records current implementation and verification above. No packages were published, no changes
were pushed, and no Cloudflare deployment, provisioning, or credential rotation
was performed.

`reports.md` contains the user's own uncommitted replacement of earlier reports
with CSM-004. It is intentionally excluded from the checkpoint. Preserve it.
Its final blank line is the existing exception to `git diff --check`.

## Working rules

- Read root `AGENTS.md`, `specs/architecture.md`, and applicable specs.
- Use pnpm. Run `pnpm tsc --noEmit` after source changes and meaningful tests for
  features and bug fixes. Alpha-stage API breaks are acceptable.
- Keep reusable libraries independent of the framework/application. Keep
  `cloudflare:workers` imports out of core and the Node/Deno runtime import graph.
- Use the installed Cloudflare skills and current official documentation when
  changing Workers, Durable Objects, or Wrangler behavior.
- The tested dependency baseline resolves Wrangler 4.114.0, Cloudflare Vite
  plugin 1.47.0, and Vite 8.1.4. Native Worker Previews require Wrangler 4.135.0
  or later; that upgrade needs compatibility testing.
- Build dependencies before tests that consume published `dist` exports.
  Do not run type checks alongside builds that delete those directories.
  `pnpm test:unit` also runs package pretest builds, so keep it separate from
  `pnpm typecheck`.
- No subagent work was authorized for this checkpoint. Do not assume permission
  to start chats, delegate, send messages, publish, or deploy.

## Implemented and exercised

The release checklist's verification log describes each completed slice. The
main changes in this checkpoint are:

1. **CLI and deployment:** lifecycle flags/help, read-only creation dry runs,
   versioned JSON for creation/deployment/database tools, local Cloudflare
   inspect/check commands, environment selection before Vite/type generation,
   and deployment of the verified built artifact. A deployment dry run writes
   local build artifacts; it performs no upload. Remote readiness is explicitly
   unverified by local checks.
2. **Database tooling:** explicit local/remote and environment context, SQL
   migration plans, read-only history/schema inspection, shared Studio/CLI D1
   discovery, and isolated child-process JSON output. D1 uses real local
   Wrangler/workerd tests. Hyperdrive resource setup is still incomplete.
3. **SSG and assets:** real anonymous Hono requests, middleware/auth checks,
   public-only generation, full validation before writing static output,
   grouped/dynamic layout ancestry, working catch-all routes, and Worker-first
   protected asset handling. SSG constructs and disposes actual DI scopes.
4. **Lifecycle:** awaitable component/service disposal, descendant cleanup, and
   response-owned middleware cleanup. Streaming ORM factories stay alive through
   completion or cancellation. Cloudflare ORM scaffolding supplies async-local
   scope without adding Node imports to neutral database entry points.
5. **HTTP/SSE component RPC:** one POST per action, shared promise/iterator result,
   incremental bounded NDJSON frames, correlated errors, cancellation, and
   original request/ORM context during generator pulls. Failures now reject
   instead of resolving `undefined`. WebSocket and explicit service RPC parity
   are unfinished; authored generator methods still lack precise client-result
   type inference. Automatic optimistic rollback and stale-task cancellation
   remain unfinished.
6. **Reported regressions:** Tabs uses one sliding underline, UI accepts compatible
   Solar Icons patch releases, and framework library declarations no longer
   compile the demo through generated Worker types.

Generated-app tests in `packages/cossack/tests/deploy-integration.test.js` use
actual published package exports, Vite, Wrangler, and workerd. They cover staging
configuration, D1 queries between stream frames, layout services, cancellation
over native HTTP, public SSG, and protected assets. These are local tests, not
evidence of a live deployment.

## Original checkpoint history: distributed SSE prototype

**Historical baseline at `289d181`, superseded by the later GLM/Codex work.**
At that checkpoint the application still used Worker-local SSE state. The last
implementation step had added a coordinator prototype:

- `packages/framework/src/SseDurableObject.ts`: native Cloudflare Durable Object,
  SQLite snapshot/event history, first-initialization-wins behavior, bounded
  pending actions/history, explicit per-scope action serialization, and callback
  RPC to execute the action in its original Worker request. Each action owns
  its response stream and holds the serialization slot until that stream closes.
- `packages/cossack/tests/sse-coordinator-integration.test.js`: two real Workers
  call the same DO namespace. It checks concurrent increments, callback
  AsyncLocalStorage context, separate scopes, state after harness reload, and
  continued progress after canceling a native HTTP response.

The prototype is **not exported from package.json, not included in the library
declaration build, not called by the router, and not scaffolded**. Its source is
covered by the framework package's normal type check. The integration test
imports the source directly; it does not prove that a generated application
uses the new backend. TypeScript errors from the initial prototype were fixed
before this checkpoint (SQL row type aliases and explicit iterator return values).

Continue with these concrete tasks:

1. Review the coordinator's stream ownership and queue release on callback
   failure, malformed/oversized frames, cancellation before and during execution,
   a disconnected queued caller, and DO restart during an action. Do not claim
   exactly-once external database side effects or automatically replay mutations.
2. Add a Cloudflare-only public entry and generated `COSSACK_SSE` binding with
   `new_sqlite_classes`. Keep native Cloudflare imports outside neutral runtime
   modules. Missing required bindings should produce an actionable diagnostic.
3. Replace Cloudflare's global store in `framework/src/transports/sse.ts` and
   integrate SSR and `/crpc` in `framework/src/router.ts`. Recompute authorized
   scopes before constructors/actions. Use collision-safe tuple keys. Preserve
   request middleware, layout DI, ORM lifetime, rate limits, and action allowlists.
4. Initialize shared state once, hydrate authoritative state before executing a
   mutation, and prevent stale browser snapshots or another SSR request from
   overwriting it. Define child-component/service state ownership explicitly.
5. Support ordinary results, redirects, cookies, custom Responses, and generators
   consistently. The current coordinator only accepts successful NDJSON responses;
   the existing router still returns JSON for ordinary calls.
6. Add subscriptions with bounded buffering, cursor-based reconnect, and snapshot
   resynchronization when history expires. The coordinator's `updates()` is only
   a polling primitive; no browser subscription currently uses it. Add broadcast
   events/client actions; the prototype currently records state updates only.
7. Decide and document the Node/Deno backend contract. Their process-local behavior
   must not accidentally become the Cloudflare fallback.
8. Expand actual generated-app/workerd tests to cover the integrated backend,
   authorization, stale concurrent mutations, reconnect, failure, cleanup, history
   bounds, and restart behavior. Retain the existing D1/context stream tests.

Useful official references:

- [RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
- [RPC supported values and streams](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Durable Object base class](https://developers.cloudflare.com/durable-objects/api/base/)

Do not hold `blockConcurrencyWhile()` across callback RPC or application I/O.
Use it for initialization. The prototype uses an explicit queue for actions.

## Remaining release work and later review

After SSE, follow every unchecked item in the release checklist. Major untouched
areas include compiler-backed inspection/explanation, local MCP, offline agent
guides, upgrades/recipes, validated actions/forms, typed routes/URL state,
transport parity, resource authorization, jobs/Cron/Workflows/notifications,
storage/Turnstile, observability, and isolated preview/CI lifecycles. This list is
orientation only; it does not replace or reduce the checklist.

For Codex's later review, compare GLM's commits against this checkpoint. Verify
the actual runtime behavior, published entry points, and generated applications,
not just new tests or checked boxes. Pay particular attention to request I/O
ownership across RPC, cleanup under cancellation, shared-state concurrency,
authorization before execution, secret redaction, and runtime import boundaries.
Keep release versions and release-complete claims gated on the full audit.

Tracked demo secret values were removed earlier. Any still-active credentials
need external rotation; rotation was not performed. Do not copy old values from
Git history into notes or logs.

## Checkpoint verification

The following commands passed on 2026-10-02 after the prototype type fixes:

- `pnpm build`
- `pnpm tsc --noEmit`
- `pnpm typecheck` — all 11 package checks, including the prototype source.
- `pnpm audit:bundle` — 28 neutral modules and the Workers-safe Cloudflare entry.
- `pnpm test:unit` — 2,125 tests across 12 packages, including both real-workerd
  integration tests. Counts: auth 118, renderer 256, database 84, scaffold 82,
  core 615, node-adapter 10, UI 112, framework 515, CLI 262, desktop 16,
  deno-adapter 3, and Studio 52.
- `git diff --check -- . ':!reports.md'`

No Playwright E2E suite, full published-tarball matrix, or live remote deployment
was run for this checkpoint. Existing local integration coverage does not close
those release gates. No test or build process remains running from this handoff.
