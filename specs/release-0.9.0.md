# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

Read [the detailed implementation plan](./release-0.9.0-plan.md) for each task's
purpose, baseline, approach, dependencies, and acceptance criteria. The task IDs
below link directly to those explanations.

## CLI and agent tooling

- [x] [CLI-01](./release-0.9.0-plan.md#cli-01) Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.
- [x] [CLI-02](./release-0.9.0-plan.md#cli-02) Validate command-specific flags and reject ambiguous/unknown options consistently. GLM (2026-10-02): `CommandSpec` validates declared flag types, aliases, repeat rules, positionals, and forwarding boundaries before any effect, with supported alternatives in diagnostics; value flags reject flag-like/missing values instead of silent boolean coercion; coverage includes unit and real-binary subprocess suites (aliases, repeats, `--`, explicit false, flag-like values, conflicts). Codex review fixes (typed validation, repeated single-value options, `f`/`h` aliases) incorporated.
- [x] [CLI-03](./release-0.9.0-plan.md#cli-03) Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands. GLM (2026-10-02): one coherent contract — exactly one envelope on stdout under `--json` with structured effect data (planned paths for dry runs), coded failures (never numeric-only), captured build/ssg output, `COSSACK_JSON_UNSUPPORTED` for long-running `dev`/`start`, documented noninteractive flags and exit codes; 17 real-binary subprocess tests across every command family, including the review acceptance example (`generate component X --dry-run --json` = one envelope, no writes). Codex review fixes (dispatch JSON for lifecycle commands, single envelope) incorporated.
- [ ] [CLI-04](./release-0.9.0-plan.md#cli-04) Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons. GLM (2026-10-02): `cossack inspect routes [route]` explains effective behavior with reasons and source locations using AST-extracted @Page options (nested objects/comments/aliases handled, dynamic options unknown with a reason, regex fallback labeled), single envelope through CommandSpec; remaining: method classification reasons (server/client proxy decisions) from the compiler model and scaffold-recipe awareness.
- [ ] [CLI-05](./release-0.9.0-plan.md#cli-05) Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.
- [ ] [CLI-06](./release-0.9.0-plan.md#cli-06) Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions.
- [ ] [CLI-07](./release-0.9.0-plan.md#cli-07) Local MCP tools sharing inspection, documentation, checks, test results, and trace services with the CLI.
- [ ] [CLI-08](./release-0.9.0-plan.md#cli-08) Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples.

## Runtime and application APIs

- [ ] [RT-01](./release-0.9.0-plan.md#rt-01) Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics. GLM (2026-10-02): WebSocket and explicit service RPC now use the shared request-scoped contract (correlated frames, cancellation, `@Server({ timeout })` deadlines with uncertain-outcome semantics, RpcError taxonomy, generator streaming for service RPC) with a conformance suite; serialization failures now name the offending value path (`describeUnsupportedValue`, pre-dispatch rejection so silently-dropped functions become errors); still open: compiler-level client typing of yielded/final results.
- [ ] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies.
- [ ] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation.
- [ ] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics.
- [ ] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work.
- [ ] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [ ] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection. GLM (2026-10-02): CLI effective route model — runtime-matching IDs, dynamic/catch-all params (also fixed the CLI's catch-all derivation to `:name{.+}`), layout ancestry, nearest 404/error boundaries, source-level @Page options with decorator line numbers, exposed via `cossack routes --json`; remaining: generated typed URL builders/params from the vite-plugin model and API schema declarations.
- [ ] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting, and pagination, with history/defaults.
- [ ] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics.
- [ ] [RT-10](./release-0.9.0-plan.md#rt-10) Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] [RT-11](./release-0.9.0-plan.md#rt-11) Session/flash recipes covering RPC failure, redirects, old input, and rotation.
- [ ] [RT-12](./release-0.9.0-plan.md#rt-12) DI resolution errors and scope/lifetime inspection with clear global/scoped guidance. GLM (2026-10-02): resolution failures name the service, requester, and scope-chain ancestry with per-layout declarations; service ownership visible through `cossack inspect routes` (layouts' declared services and per-page injectable ancestry); service RPC awaits scoped disposal matching component RPC; request-facility isolation, single layout cleanup, and independent hook failures covered by existing core suites. specs/service.md documents global vs layout vs request ownership. Codex review (2026-10-02): reopened. SSR and RPC disposal fixes pass regression tests, but regex inspection does not prove actual service ownership for all valid declarations. Finish compiler-backed ownership inspection and navigation lifetime verification.
- [ ] [RT-13](./release-0.9.0-plan.md#rt-13) Auth/OAuth failure diagnostics and reusable credential/session primitives in the auth library.
- [ ] [RT-14](./release-0.9.0-plan.md#rt-14) Typed resource authorization policies and client visibility helpers.
- [ ] [RT-15](./release-0.9.0-plan.md#rt-15) Database metadata, relationships, provider capabilities, query diagnostics, pagination, and transactions.
- [ ] [RT-16](./release-0.9.0-plan.md#rt-16) Structured migration/seeder plans including SQL, destructive operations, environment, and target.
- [ ] [RT-17](./release-0.9.0-plan.md#rt-17) Shared Studio/CLI database inspection service.
- [ ] [RT-18](./release-0.9.0-plan.md#rt-18) Cache/rate-limit capability checks, consistent TTL units, and transport coverage.
- [x] [RT-19](./release-0.9.0-plan.md#rt-19) Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay. GLM (2026-10-02): `component.realtime` exposes per-connection state/attempts/lastError/lastEventId/resynced; WebSocket reconnect uses bounded exponential backoff (0.5s→30s, reset on open, none after intentional disposal); SSE resends an authoritative snapshot with a `resync` marker when history expired; pending calls reject with explicit uncertain-outcome errors (`COSSACK_RPC_TRANSPORT_CLOSED`) and never replay. Covered by core recovery/conformance tests plus the workerd coordinator suite.
- [ ] [RT-20](./release-0.9.0-plan.md#rt-20) SSR/hydration diagnostics with component/field/source information and test helpers.
- [ ] [RT-21](./release-0.9.0-plan.md#rt-21) SSG entry/plugin validation, per-route results/timings, and dependency compatibility tests.
- [ ] [RT-22](./release-0.9.0-plan.md#rt-22) Typed markdown frontmatter, route/URL collision checks, and locale static output.
- [ ] [RT-23](./release-0.9.0-plan.md#rt-23) Typed DataTable with server data, filtering, sorting, selection, and pagination; native UI attributes/events and accessibility catalog.
- [ ] [RT-24](./release-0.9.0-plan.md#rt-24) Inferred configuration factories, required binding validation, and secret redaction. GLM (2026-10-02): `requireBinding`/`requireEnv` fail with `COSSACK_BINDING_MISSING` naming the binding, listing available binding NAMES only (never values, secrets stay redacted), and pointing at per-environment wrangler configuration; remaining: config-path misspelling type tests and registry generation from project configuration.
- [ ] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop. GLM (2026-10-02): explicit `runtime-capabilities` model (transports, realtime coordination, process-local realtime, scheduled handlers, storage, filesystem) with per-runtime profiles, binding-gated availability (`COSSACK_SSE`), and available/missing-binding/unsupported status distinction; remaining: scaffold recipe gating and CLI inspection must consume the same model.
- [ ] [RT-26](./release-0.9.0-plan.md#rt-26) Storage providers for local/R2/S3, uploads/downloads/deletes, signed URLs, progress, metadata, and authorization; image diagnostics.
- [ ] [RT-27](./release-0.9.0-plan.md#rt-27) Localization extraction/checks, placeholder validation, missing/unused keys, and typed translation keys.
- [ ] [RT-28](./release-0.9.0-plan.md#rt-28) Devtools snapshots and timelines with correlation IDs.
- [ ] [RT-29](./release-0.9.0-plan.md#rt-29) Test utilities using real lifecycle/context/auth/DI/SSR/hydration/RPC behavior, published exports, and their own test suite. GLM (2026-10-02): `@cossackframework/test-utils/server` — `withRequestScope` (production request-context ALS + root service scope, awaited disposal, restoration on failure) and `controlledAsync` (settle-once deferred + shared AbortSignal); own suite now runs in root `pnpm test:unit`; remaining: framework-level RPC dispatch fixtures, auth fixtures, hydration helpers, and tarball-import verification.

## New services

- [ ] [SVC-01](./release-0.9.0-plan.md#svc-01) Background jobs with delays, retries, idempotency, failure inspection, and local test adapters.
- [ ] [SVC-02](./release-0.9.0-plan.md#svc-02) Schedules/Cron integration.
- [ ] [SVC-03](./release-0.9.0-plan.md#svc-03) Email/in-app notification templates, preferences, and delivery status using existing SMTP support where applicable.
- [ ] [SVC-04](./release-0.9.0-plan.md#svc-04) Durable multi-step Workflows integration.
- [ ] [SVC-05](./release-0.9.0-plan.md#svc-05) Turnstile component and server token verification.

## Cloudflare deployment

- [ ] [CF-01](./release-0.9.0-plan.md#cf-01) Select environment before Vite build and share it across SSG, bindings, migrations, and deployment.
- [ ] [CF-02](./release-0.9.0-plan.md#cf-02) Explicit local/remote database targets using the existing migration system.
- [x] [CF-03](./release-0.9.0-plan.md#cf-03) Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation. Remote secret validation remains Wrangler's deployment responsibility.
- [ ] [CF-04](./release-0.9.0-plan.md#cf-04) Real resource selection or Wrangler provisioning in place of fake resource IDs.
- [x] [CF-05](./release-0.9.0-plan.md#cf-05) Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams. GLM (2026-10-02): coordinator wired through SSR, `/crpc`, and `/sse`; scaffolded `COSSACK_SSE` binding (`new_sqlite_classes`) and `SseDurableObject` entry; missing-binding and environment-inheritance diagnostics; cursor reconnect with bounded history; broadcasts. Node/Deno keep the documented process-local backend (see [specs/sse.md](./sse.md)). Not claimed: exactly-once external side effects, queued-caller cancellation on the pinned wrangler baseline, stream-response cookie handling (RT-11).
- [x] [CF-06](./release-0.9.0-plan.md#cf-06) Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime. GLM (2026-10-02): the generated staging app runs under workerd through published packages covering D1-backed credentials auth (login/protected route/authenticated SSE scope isolation), component+service RPC with streams and cancellation, protected assets with policies, public SSG validation, binding/artifact comparison, the SSE coordinator (subscriptions, cursors, reconnect, broadcasts), and the migration system applying real migrations against the bound D1 (recorded bookkeeping, idempotent re-runs) plus schema-serving reads.
- [x] [CF-07](./release-0.9.0-plan.md#cf-07) Public-only SSG and correct Worker-first routing for protected assets.
- [ ] [CF-08](./release-0.9.0-plan.md#cf-08) Production logs, source maps, correlation IDs, and build/startup budgets.
- [ ] [CF-09](./release-0.9.0-plan.md#cf-09) Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance.
- [ ] [CF-10](./release-0.9.0-plan.md#cf-10) Correct custom-domain/build deployment documentation and tested compatibility baseline.
- [x] [CF-11](./release-0.9.0-plan.md#cf-11) Remove tracked credential values; report any required external credential rotation without exposing values.

## Release gates

- [x] [REL-01](./release-0.9.0-plan.md#rel-01) Fix reports.md issues and verify package/SSG regressions.
- [ ] [REL-02](./release-0.9.0-plan.md#rel-02) Compile documentation examples and validate generated applications and published tarballs.
- [ ] [REL-03](./release-0.9.0-plan.md#rel-03) Run build, root TypeScript command, package type checks, unit tests, and relevant end-to-end/runtime tests.
- [ ] [REL-04](./release-0.9.0-plan.md#rel-04) Update all release versions to 0.9.0, lockfile, changelog, migration guide, and release notes.
- [ ] [REL-05](./release-0.9.0-plan.md#rel-05) Audit every checklist item against implementation and verification evidence before marking the goal complete.

## Verification log

Record completed slices and exact verification commands here. Focused checks do
not replace the final monorepo and runtime release gates.


<a id="codex-review-2026-10-02"></a>
### GLM continuation after review: command contract + AST inspection (2026-10-02)

Completed review items 1 and 2:
- CLI-02/CLI-03 closed as one command contract: `createCommandOutput`
  formatter (structured effects; human output suppressed under `--json`);
  add/generate failures carry coded diagnostics (`COSSACK_FEATURE_ADD_FAILED`,
  `COSSACK_FILE_EXISTS` naming the path); `inspect routes` runs through
  CommandSpec and returns single-envelope data; documented exit codes,
  noninteractive flags, and long-running behavior in docs/cossack-cli.md;
  `tests/cli-subprocess.test.js` (17 tests) exercises every command family
  through the real binary, including the review's acceptance example.
- AST extraction (`page-options-ast.js`): vite's oxc `parseSync` (lazy) with
  a labeled regex fallback; aliased Page imports followed; nested objects,
  comments, strings, and trailing commas handled; dynamic options reported as
  unknown with a reason. `buildEffectiveRouteModel` records
  `{ method, reason }` per page and layout.
- `pnpm --filter cossack exec vitest run`: 312 tests green.

### Codex review of GLM Groups 1–2 (2026-10-02)

**Reviewer: Codex.** Reviewed the seven GLM commits from `937843d` through
`e6b7153`, against the detailed plan and checkpoint `289d181`. This review fixes
regressions in those slices; it does not implement or close the remaining release
phases. Versions remain 0.8.3. The checklist now has **8 of 58 tasks checked**:
CLI-02, CLI-03, and RT-12 are reopened because their full acceptance criteria have
not been met. Their implementations remain useful partial progress.

#### Findings fixed in this review

1. **CLI JSON dispatch was unreachable for lifecycle commands.** Dispatch
   forwarded `--json` to Vite and supplied empty framework flags. Build and SSG
   also printed a banner before their result. Dispatch now removes the framework
   JSON option before the forwarding boundary, preserving downstream arguments
   and everything after `--`. Build/SSG emit one envelope. `dev --json` and
   `start --json` fail with `COSSACK_JSON_UNSUPPORTED` before launching a process;
   event output remains unfinished. Route-list JSON also skips its human table.
   Regression tests: `dispatch.test.js` and existing command-spec JSON tests.
2. **CommandSpec ignored its declared value types.** Direct invocation accepted
   boolean values for string flags, empty strings, repeated single-value options,
   and arbitrary `x-*` options. The shared validator now enforces declared types
   and repeat rules, rejects unknown options, and accepts the parser's `f`/`h`
   aliases. Direct JSON help emits an envelope. This strengthens converted
   commands; it does not provide complete command coverage by itself.
3. **Inspection IDs and collision winners differed from the runtime.** The CLI
   assigned page IDs before layouts, while runtime IDs use a combined sorted
   list. Route-group collisions could also display a losing page. Inspection now
   uses the published runtime `computeRouteIds` and `resolvePageRouteFiles`
   functions. Tests compare exact IDs and concrete-vs-grouped route precedence.
   Explanation no longer claims that a different dynamic pattern matches merely
   because its prefix is the same.
4. **Request helpers destroyed the production context getter.** A helper reset
   the getter globally and disposed services after leaving its ALS context.
   Nested or overlapping calls could expose another request or lose the
   framework getter. `setRequestContextGetter` now returns the previous getter;
   test-utils uses one ALS with active-scope accounting, composes the prior
   getter, and awaits disposal inside the helper context. Tests cover nested
   scopes, overlapping completion order, restored production context, and async
   service cleanup. Controlled deferreds clear their timers on settlement.
5. **Explicit service streams lost the ORM before their first pull.** Unlike
   component streams, they did not retain response middleware lifetime. Both now
   release the ORM and DI scope only after completion/cancellation. Tests execute
   SQL between service frames and check that cleanup occurs exactly once.
6. **SSR did not await or fully execute component cleanup.** The router called
   synchronous scope disposal and left rendered component hooks unowned. It now
   records constructed components before bootstrap, destroys them in reverse
   order, and awaits root scope disposal. Independent cleanup failures do not
   skip later owners. Replaced server descendants are retained for final cleanup.
   A gated async service hook proves that SSR waits in its original request
   context before returning.
7. **SSR generated different child IDs from RPC.** A preliminary render followed
   by composition advanced child counters; RPC rendered once and could not find
   the hydrated child's target. Composition resets the render counter and SSR
   removes the redundant preliminary pass. Child RPC tests now exercise actual
   rendered children and their SSR-derived IDs.
8. **Child SSE actions replaced the page's shared snapshot.** Ordinary and
   generator calls published the target child's state into the page DO.
   Ordinary actions now publish the page state. Child stream frames carry
   separate target `state` and page `scopeState`; the coordinator publishes the
   latter. The page is hydrated before rendering conditional children. Tests
   prove that child-local values do not overwrite the page snapshot.
9. **Partial state broadcasts could corrupt the authoritative snapshot.**
   Deferred `broadcastState` messages were treated as complete state replacement,
   potentially after the action slot released. Coordinator state commits now
   come only from full action results/frames. Event and client-action broadcasts
   are tracked and flushed before committing or releasing their action context.
10. **SSE subscriptions ignored backpressure and body cancellation.** Timer
    callbacks accumulated unawaited writer operations and kept polling after
    reader cancellation. The Cloudflare subscription uses a demand-driven
    readable stream, one delivered frame per pull, a bounded persisted-log batch,
    and a cancellable wait timer. Cancellation/abort removes its listener and
    timer. Cold starts construct the actual layout service ancestry before
    rendering, then dispose temporary owners. Tests cover subscription without
    SSR, no polling without reader demand, and cancellation.
11. **Reconnect cursors could acknowledge events before delivering them.**
    Sending the latest snapshot ID before older broadcasts made IDs move
    backwards and allowed a disconnect to skip an unseen broadcast. Replay now
    precedes the latest snapshot, in increasing cursor order. Expired history
    produces resync plus a snapshot. Tests check ordering and a missed broadcast.
12. **WebSocket reconnect backoff did not reset internally.** Status reported
    zero attempts on open, but the retry closure retained its old count. A
    successful open now resets both. The test closes the connection again and
    verifies the first 500 ms retry delay.
13. **RPC serialization silently discarded values or hung callers.** Functions
    could disappear during cloning or JSON encoding; service serialization could
    throw before lifecycle cleanup; WebSocket send failures in encoding were
    swallowed. Validation now precedes state cloning and frame encoding, includes
    ordinary component/service results, and returns coded path diagnostics.
    Shared references are accepted as aliases rather than mistaken for cycles;
    Maps/Sets are rejected at boundaries that inspect them. Generator failures
    close the iterator. Regression tests cover nested function results, aliases,
    unsupported collections, and loading cleanup.
14. **Cancellation and deadline handling left calls waiting.** Local WebSocket
    cancellation now wakes its frame queue immediately; a deadline sends a
    best-effort cancel and clears per-frame timers. Server hooks are registered
    before an action enters its queue, so cancelling a queued mutation skips it.
    Running generator hooks close on cancellation/failure. Arbitrary application
    I/O remains cooperative: cancellation cannot undo an external side effect,
    and uncertain outcomes must never trigger automatic replay.
15. **Realtime frame input and queues were unbounded/unvalidated.** HTTP and
    WebSocket frames now share structural validation, including optional page
    scope state. Socket frames are byte bounded, and pending yields have limits
    of 256 frames / 4 MiB per call. Overflow rejects with
    `COSSACK_RPC_BUFFER_EXCEEDED`, clears loading, and requests cancellation.
    Tests cover malformed frames, slow consumers, and queued cancellation.
16. **Custom Response streams released ownership on return.** A custom body may
    execute SQL or other request I/O when pulled. The router now wraps component
    and explicit-service Responses with captured request context and retained
    middleware/DI cleanup. The DO holds its action slot through all response-body
    completion, failure, or cancellation, including non-NDJSON bodies. Tests
    cover custom body SQL/context, headers, cleanup, and native cross-Worker queue
    ordering/cancellation. Cookie/flash propagation remains RT-11 work.
17. **The root test command raced framework builds with CLI imports.** Sharing
    the authoritative route-ID export exposed the framework/CLI workspace cycle:
    framework pretest deleted `dist/esm` while CLI subprocess tests loaded it.
    Root `test:unit` now uses `--workspace-concurrency=1`. Package suites retain
    their own tests/build hooks; package-level parallel test workers still run.

#### GLM continuation: concrete remaining work

Follow this order before advancing to the next major feature group:

1. **Finish CLI-02/CLI-03 as one coherent command contract.** Inspect/check route
   commands still bypass shared validation; the parser maintains a separate
   hard-coded boolean list; aliases/conflicts and all positional counts need a
   complete audit. Several converted handlers still print human status lines
   under `--json` (for example generate/add/remove/lang), and a handler returning
   nothing emits no envelope. A numeric failure result can lack a diagnostic.
   Convert handlers to return structured data, affected paths, and coded errors,
   with one formatter deciding human/JSON output. Do not capture process-global
   console methods around async work. Add actual CLI subprocess tests for every
   command's success, invalid option, conflict, and failure paths. Specify the
   noninteractive and long-running behavior explicitly. Example acceptance:
   `generate component ReviewProbe --dry-run --json` must produce exactly one
   parseable envelope with planned paths and perform no writes.
2. **Complete CLI-04/RT-07/RT-12 from compiler metadata.** `extractPageOptions`
   remains a regex heuristic. Nested option objects, comments/string text,
   trailing commas, aliased decorators, imported options, and namespaced service
   declarations can be misreported. Declared identifier lists do not prove DI
   ownership or lifetime. Reuse the AST/import-resolution machinery in
   `framework/src/vite-security-plugin.ts`, or extract a shared Node-only
   compiler module. Keep inspection read-only and never execute application
   constructors/configuration to obtain facts. Represent unresolved dynamic
   options as unknown with a reason. Verify inspection against the actual layout
   scope chain, including route groups and navigation cleanup. Add source
   locations and proxy classification reasons as required by the original plan.
3. **Finish RT-01's remaining transport contract.** Compiler/client typing of
   generator yields and final returns is still missing. Audit request upload
   normalization: HTTP's file walker transforms objects before validation, so
   Maps/Sets and other special objects can still lose information there, while
   direct WebSocket/service boundaries reject them. Define supported values and
   paths consistently, including dates, cycles, and DOM/file arguments. Add
   generated-app conformance cases and avoid claiming transport parity from
   source-only tests. Coordinate Response cookies/flash with RT-11.
4. **Finish RT-24/RT-25 using real adapter capabilities.** The new capability
   model is not yet wired into builds, recipes, or inspection. Its profiles need
   correction before they become authoritative: Node/Deno do have process-local
   WebSocket support for the `durable-object` protocol; their framework scheduled
   handlers are not implemented; transport evaluation ignores its requirement;
   storage availability does not verify a concrete bucket binding. Derive facts
   from installed adapters and actual named bindings. Reject unsupported/missing
   capabilities before effects and test the emitted diagnostics. Binding presence
   and platform support must remain separate concepts.
5. **Finish RT-29 without overstating the helper.** `withRequestScope` scopes the
   core request getter and DI, not the framework's config/locale/auth/ORM stores.
   Add fixtures using the actual Hono/router lifecycle, authenticated requests,
   RPC dispatch, SSR/hydration, cancellation, and tarball imports. Keep the
   nested/overlap restoration regression tests. Verify framework middleware
   getter registration alongside helper use, including lazy module loading.
6. **Extend runtime adversarial coverage before release gates.** Preserve the two
   real workerd suites. Add conditional-child scope cases, multi-field state
   broadcasts, dynamic-param subscription cold starts, slow native subscribers,
   response-cookie handling, and restart *during* active callbacks. Harness reload
   proves persisted state across instances; it does not prove atomic external
   side effects or safe replay after an in-flight restart. Node/Deno still use
   the older process-local subscription implementation with timer/writer queues;
   do not imply Cloudflare durability or backpressure guarantees for that path.

After these acceptance gaps, continue the original execution groups in
[release-0.9.0-plan.md](./release-0.9.0-plan.md). No unchecked feature was removed
from scope. Preserve user edits to `reports.md` and the untracked `.zcodeignore`.
The user arranges GLM continuation. This review did not publish, push, deploy,
provision, rotate credentials, or start/message another chat.

#### Verification by Codex

Passed after the fixes:

- `pnpm build`.
- `pnpm tsc --noEmit`.
- `pnpm typecheck` — all 11 package checks.
- `pnpm test:unit` — **2,227 tests across 13 packages**: auth 118, database 84,
  renderer 256, scaffold 82, core 647, node-adapter 10, test-utils 8, UI 112,
  CLI 292, framework 547, deno-adapter 3, desktop 16, Studio 52. This includes
  `deploy-integration.test.js` (generated staging artifact, public exports,
  real workerd/D1/auth/RPC/SSE/SSG/assets/migrations) and
  `sse-coordinator-integration.test.js` (two native Workers sharing a SQLite DO,
  state persistence, cursor history, custom-response ownership, cancellation).
- `pnpm audit:bundle` — 28 neutral modules; the database Cloudflare entry
  remains Workers-safe. Native framework import boundaries are also exercised
  by the generated application build.
- `git diff --check -- . ':!reports.md'`.

The first full run exposed the framework/CLI build race described above; the
final run passed using the corrected root test command. An initial new SSR test
also needed `Promise.resolve(app.request(...))` for Hono's synchronous-or-async
return type; package type checks pass after that test correction. Focused new
regressions passed before the full run. No Playwright suite, complete tarball
matrix, or live Cloudflare deployment was run. Passing this checkpoint does not
close REL-02, REL-03, or REL-05 for the full 0.9.0 release.


### CLI lifecycle and creation

- Dispatcher regression tests exercise all command help handlers, Vite argument
  forwarding, legacy SSG diagnostics, and real temporary-directory creation plans.
- `create --dry-run --json` emits one versioned result without writing files,
  prompting, checking updates, or exposing generated secret values. Creation
  failures have diagnostic codes. Other commands still need JSON conversion.
- Explicit boolean flags accept `true`/`false`, reject other values, and use the
  last repeated value. Canonical `--force=false` takes precedence over `-f`.
- `pnpm --filter cossack exec vitest run`: 222 tests passed.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 81 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed after all code changes in this slice.

### SSG environment resolution

- Named Cloudflare environments resolve APP_URL from JSON, JSONC, and TOML
  without inheriting top-level vars. Explicit environment selection overrides
  CLOUDFLARE_ENV, and explicit shell APP_URL remains highest priority.
- Dotenv files follow environment/local precedence. Tests cover these rules,
  quoted TOML environment names, and the existing build plugin behavior.
- `pnpm --filter @cossackframework/framework exec vitest run tests/ssg-config.test.ts tests/vite-ssg-plugin.test.ts`: 35 tests passed.
- Updated SSG and sitemap documentation to describe the integrated Vite build
  and remove obsolete CLI flag examples. Deployment orchestration, binding
  selection, and remote migrations remain open.

### Cloudflare deployment and scaffold secrets

- Added `cossack deploy --env <name> --dry-run --json`. It uses the project's
  Wrangler parser and executable, selects CLOUDFLARE_ENV before type generation
  and Vite build, verifies target configuration in the artifact, and passes
  the exact built config to Wrangler. Dry runs build and validate locally;
  they do not upload or provision. Remote secret checks are explicitly reported
  as not checked during local validation.
- Preflight rejects unknown environments, secrets in vars, invalid/default
  APP_URL, missing Worker entry points, and placeholder resource IDs. JSON
  results contain names and diagnostics, not raw configuration values.
- Stale deployment metadata is removed before building. A build without the
  Cloudflare plugin cannot deploy metadata left by a previous build.
- New Cloudflare apps generate a local APP_SECRET, preserve it during feature
  composition, declare required secret names, ignore environment-specific local
  files, and use automatic D1 provisioning. Hyperdrive resource selection is
  still open; its placeholder is rejected by deployment preflight.
- Removed R2 credential values and APP_SECRET from the tracked demo Wrangler
  vars and regenerated binding/runtime types. A scan of tracked working-tree
  files found no copies of the removed R2 credentials. Any active credentials
  need external rotation; no rotation or cloud deployment was performed.
- Updated deployment documentation for environment selection, dry-run effects,
  secrets, custom domains, Node entry path, and code/state rollback differences.
- `pnpm --filter cossack exec vitest run`: 235 tests passed before adding the
  integration test; `tests/deploy-integration.test.js` then passed separately.
- The integration test generates a staging app, uses real project Vite and
  Wrangler, generates types, builds, verifies the environment, and completes
  a Wrangler deployment dry run without uploading.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 82 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed with regenerated types.
- Migrations, remote database target selection, broader runtime tests, preview
  automation, and the remaining release checklist are still open.

### Database plans and Cloudflare inspection

- ORM adapter factories receive project root, config path, environment,
  local/remote target, and read-only intent. Commands validate flags by action,
  reject extra arguments and conflicting targets before adapter creation, and
  emit versioned JSON results. CLI forwarding preserves false/repeated values.
- Migration plans include SQL, parameter counts, destructive risk, direction,
  checksum, completeness, and squash consolidation. The disconnected driver
  substitutes the application's ORM scope, including static entity/shared SQL
  calls, and retains its naming strategy. Live query callbacks produce an
  incomplete result. Seeder previews select metadata without executing callbacks.
- History inspection does not initialize bookkeeping and correctly recognizes
  already-applied migrations. Snapshot/generation/squash/schema-pull dry runs
  return proposed changes without writing application files.
- Generated D1 tooling uses project Wrangler, shares local development storage,
  forces local or the selected remote D1 binding, preserves the configured
  account, and disposes proxy resources. Remote binding setup is tested with an
  injected Wrangler; no live Cloudflare database was changed.
- Real local D1 tests cover schema inspection, queued migration plans, applying
  migrations and reading their history, reversal plans, and unique columns.
  D1 inspection avoids a catalog query rejected by workerd and hides Cloudflare
  internal tables. SQLite tests also cover squash consolidation; catalog query
  tests cover PostgreSQL/MySQL history without writes.
- Studio now shares D1 discovery with database tooling instead of maintaining
  separate JSONC/TOML parsers. Tests reject missing environment declarations and
  prevent fallback to top-level bindings, including quoted TOML environment names.
- Added read-only `cossack inspect cloudflare` and `cossack check cloudflare`.
  They share deployment preflight, emit resource/secret names without values,
  report diagnostics, and distinguish local configuration validity from
  unchecked build/remote readiness. Inspection describes invalid configurations;
  checks fail on them. Tests verify no project artifact/config changes.
- Ran the inspection CLI against packages/framework: it returned one JSON
  envelope with the Worker, Durable Object binding, required secret names, valid
  local configuration, and build/remote readiness explicitly not checked.
- The remaining provider target semantics, broader compiler inspection/MCP,
  runtime services, distributed SSE, resource setup, preview automation, and
  release gates remain in scope. These changes do not complete the release.
- Database JSON output is now isolated in a child process. Configuration,
  adapter, migration, disposal, and inherited subprocess logs cannot enter
  stdout/stderr; one validated result returns over IPC. Tests cover console
  output, direct writes, spoofed stdout JSON, parent environment isolation,
  and premature process termination. Live remote D1 verification remains open.
- `pnpm --filter @cossackframework/database build`: passed.
- `pnpm --filter @cossackframework/database exec vitest run`: 81 tests passed.
- `pnpm --filter @cossackframework/database audit:bundle`: passed; neutral
  imports and the Cloudflare runtime retain their runtime boundaries.
- `pnpm --filter cossack exec vitest run`: 245 tests passed. After the final
  help text change, inspection and dispatcher suites passed again (37 tests).
- `pnpm --filter @cossackframework/studio exec vitest run`: 52 tests passed.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 82 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed after the database changes.

### Current reports.md: CSM-004 Tabs underline

- Removed static active/inactive bottom borders from Tabs triggers. The sliding
  indicator remains the single underline; variant props still stay out of the
  DOM attribute spread.
- Server rendering tests verify one indicator and no trigger border classes.
  A browser-method test verifies that selected tab widths/offsets continue to
  position the indicator when the controlled tab changes.
- `pnpm --filter @cossackframework/ui build`: passed.
- `pnpm --filter @cossackframework/ui exec vitest run`: 112 tests passed.
- Root and all package type checks passed after the component change.
- Final `pnpm tsc --noEmit` and UI package TypeScript checks passed after adding
  the browser-method test.
- `pnpm --filter @cossackframework/framework exec vitest run tests/package-contract.test.ts tests/ssg-config.test.ts tests/vite-ssg-plugin.test.ts`:
  51 tests passed, including the package and SSG regressions from earlier reports.
- No edits were made to the user's reports.md contents. Its existing final
  blank line is the only reported issue from `git diff --check`; the remaining
  tracked changes pass the whitespace check.

### Public SSG and Worker-first assets

- SSG now uses a real anonymous Hono request and runs global, layout, and page
  middleware. Synthetic user state and the context mock were removed. Denied
  or redirected requests cannot bootstrap protected pages; authenticated
  identities, cookies, credential-dependent output, and private cache policies
  fail generation. Middleware failures remain build failures.
- SSR and SSG share layout ancestry from source paths, including route groups
  and dynamic layouts. Disabled SSG is honored. Catch-all HTTP routes now use
  a real Hono multi-segment parameter; an actual request test exposed and
  replaced the former nonmatching `:name*` pattern.
- The plugin validates all routes before writing HTML or sitemap files. Failed
  renders, output collisions, and traversal attempts publish no generated
  routes. Static parameter replacement handles catch-alls and rejects missing
  parameters instead of publishing template URLs.
- Generated apps and the demo use Worker-first assets. Framework middleware
  serves matching files within global and page/layout policies, retains
  middleware headers, redirects known HTML aliases to canonical routes, and
  falls through to SSR/API handling for missing assets. Deployment preflight
  requires Worker-first routing and the ASSETS binding and verifies these
  settings in the built artifact.
- A generated staging application's actual Vite artifact ran locally under
  workerd: public SSG and client JavaScript loaded, protected static HTML/files
  were denied, and authorized responses retained policy headers. No upload or
  remote resource mutation was performed. Wider auth/database/realtime runtime
  gates and the remaining release work remain open.

### Static render services and awaitable cleanup

- SSG now creates App, layouts, and pages through core DI. Each render has an
  anonymous request root and explicit nested layout scopes, including grouped
  and dynamic source ancestry. Scoped services bind real request parameters
  and the resolved APP_URL. Layout service slots and scope keys hydrate with
  the same ownership metadata as SSR.
- Added `ServiceScope.disposeAsync()` and `Cossack.destroyAsync()`. They await
  hooks already started by synchronous disposal, release descendants and
  subscriptions even when a hook throws, and report collected failures.
  Completed successful child disposals are removed from long-lived roots.
  Component hooks finish before owned service disposal. Registered async task
  cleanup is awaited without delaying ordinary synchronous task execution.
- SSG awaits all constructed instances and service scopes on success and after
  construction, init, render, or head failures. Cleanup failures fail the render;
  an earlier render failure remains the cause. Constructor DI, lazy injection,
  nested shadowing, concurrent render isolation, public service hydration, and
  renderer-created child cleanup have focused regression coverage.
- The generated staging app integration now hydrates a real layout-owned
  service through published packages and Vite, then runs the artifact under
  workerd. SSG and repeated live SSR requests each get fresh state and the
  staging APP_URL. Protected static files, global/layout/page guards, and the
  failed-public-SSG build gate remain covered. No cloud upload was performed.
- A production framework build generated all six expected static pages and
  the sitemap. Core and framework library builds, root TypeScript, and all
  package type checks passed. Full core tests passed: 40 files, 594 tests.
- `pnpm test:unit` passed: 2,080 tests across all 12 packages that have unit suites,
  including the expanded generated-app/workerd integration. Framework: 495
  tests; CLI: 259 tests. This does not replace the remaining end-to-end and
  final release gates.
- After adding a separate successful-render/failed-cleanup case, the focused
  SSG service suite passed all 10 tests; root and framework TypeScript checks
  passed again. This verifies cleanup failure alone prevents a successful render.
- Library type generation uses a dedicated entry-free Wrangler configuration;
  application-generated declarations no longer import the demo into published
  library output. Package-contract tests check the boundary and generated
  asset/Durable Object binding types.
- Current SSR/RPC completion and browser navigation remain nonblocking.
  Cancellation of in-flight tasks and client compilation of service disposal
  hooks still require work; the broader DI, transport, and release gates remain
  unchecked. This slice does not complete 0.9.0.

### Response-local component RPC streams

- Replaced the separate HTTP/SSE client implementations with one request per
  component action. The call supports iteration, shared promise completion,
  cancellation, and automatic draining for unobserved event-handler calls.
  Iterating SSE actions no longer dispatches a second mutation. Awaiting an
  ordinary async SSE action now waits for its actual result.
- Added a versioned UTF-8 NDJSON frame protocol for yields, final values, state,
  and correlated errors. Both sides enforce a 1 MiB frame limit; the incremental
  parser also bounds buffering overhead for tiny network chunks. Malformed,
  truncated, oversized, and inconsistent frames fail explicitly. HTTP/SSE
  component calls reject failures instead of silently resolving undefined.
- Generator pulls and cleanup use the original action's AsyncLocalStorage
  snapshot. Component RPC reconstructs layout DI scopes and waits for component,
  descendant, and scope cleanup. SSE scopes are checked before constructors.
  SSE's subscription store no longer retains or drives action generators.
- Request-context middleware exposes a structural response-lifetime contract.
  ORM middleware defers factory-owned database closure for retained streams,
  including cancellation, without depending on framework. Ordinary responses
  and caller-owned databases retain their ownership behavior. Generated
  Cloudflare ORM factories now supply async-local scopes for static models and
  global SQL. The database's neutral and Cloudflare entry graphs stay unchanged.
- Real generated staging-app tests build published packages with Vite, validate
  the artifact, and run it under workerd. They verify D1 queries between yields,
  middleware/config/request context, layout-service state, final results,
  client-visible failures, and cancellation through a real HTTP listener. The
  existing public SSG and protected asset checks remain covered.
- These tests exposed Vite's source-relative D1 migration-path rewrite. Artifact
  validation now compares resolved migration directories while still comparing
  every other binding setting. Regression tests reject changed databases, IDs,
  and migration targets, including custom source migration directories.
- `pnpm build`, `pnpm tsc --noEmit`, and `pnpm typecheck` passed. All 11 package
  type checks passed after the dependency build completed. A concurrent earlier
  type check saw temporarily missing core declarations during rebuilding; the
  post-build check passed without a source workaround. Database bundle audit
  passed for the 28 neutral modules and the Workers-safe Cloudflare entry.
- `pnpm test:unit` passed: 2,124 tests across all 12 packages with unit suites.
  Core: 615; framework: 515; database: 84; CLI: 261. The expanded real-worker
  integration is included. No cloud upload or remote provisioning was performed.
- Distributed SSE coordination is still incomplete: its shared state store
  remains Worker-local. WebSocket and explicit service RPC parity, cancellation
  of stale tasks, typed client generator-result inference, preview/release
  tooling, and all other unchecked release requirements remain in scope.
  Versions remain 0.8.3 until the complete 0.9.0 checklist and release gates pass.

### Group 1/2 completion pass (GLM, 2026-10-02)

Closed the remaining acceptance gaps so four rows could be checked honestly:
- RT-12: service ownership in route inspection — layouts' `services: [...]`
  declarations and per-page injectable ancestry appear in `cossack inspect
  routes` output and route explanations, matching what DI resolution finds.
- CLI-02: value flags now require values (`--tag --force` is a parse error,
  not a silent boolean); enumerated acceptance tests cover aliases, repeated
  values, `--` passthrough, explicit false, and flag-like values.
- CLI-03: hard-failure prints in add/generate/remove/delete/lang converted to
  coded throws so `--json` failures are structured diagnostics with nonzero
  exits.
- CF-06: the artifact now applies a real migration through the ORM migration
  system against the bound D1 (creates the table, records `_cossack_migrations`
  bookkeeping, idempotent re-run, schema serves reads through `/api/db`).
- RT-01 (still open, strengthened): `describeUnsupportedValue` walks argument,
  state, and stream-frame trees to name the first unsupported value by path;
  client proxies reject before dispatch instead of letting JSON.stringify
  silently drop functions.
- Gates: core 640, framework 536, CLI 286 tests; `tsc --noEmit` clean.

### Group 2 continued: route metadata, inspection, test utilities (GLM, 2026-10-02)

- RT-07 slice: `buildEffectiveRouteModel` in the CLI — route IDs computed in
  the runtime's index space (`cmp_<base36>`), dynamic and catch-all
  parameters in the framework's `:name{.+}` form (this fixed a real CLI bug:
  `filePathToHttpRoute` derived `:...name` for catch-alls, diverging from the
  router), layout ancestry, nearest 404/error boundaries, and source-level
  @Page options (transport, ssg, middleware count via depth-aware array
  parsing, decorator line numbers). Nothing executes during inspection.
- CLI-04 slice: `cossack inspect routes [route]` — one command lists effective
  facts with source locations and explains a route's behavior with reasons
  (transport origin, ancestry, middleware count, SSG, params, boundaries).
- RT-29 slice: `@cossackframework/test-utils/server` published entry with
  `withRequestScope` and `controlledAsync`; ES-only named-entry lib build;
  the package's own suite (5 tests) joined root `pnpm test:unit` (now 13
  packages, 2,192 tests).
- Gates: `pnpm tsc --noEmit`, `pnpm build`, and `pnpm test:unit` green; CLI
  280 tests, framework 536 tests.

### Group 2 start: CLI spec, required bindings, capability model (GLM, 2026-10-02)

- `command-spec.js` (CLI-02/CLI-03): `CommandSpec` declares flags (type,
  aliases), positionals, and forwarding boundaries; `runWithSpec` validates
  before any effect (unknown options list their `--`-prefixed supported
  alternatives; missing/extra positionals fail with stable codes), keeps the
  `help` flag/positional convention, and emits the versioned JSON envelope —
  data handlers, exit-code results, and `{ exitCode, data }` captured-output
  results. 16 commands converted; database cluster commands already emit
  isolated JSON via their child-process path and move to `runWithSpec` later.
  `build`/`ssg` capture child output under `--json` via `runCaptured` so
  stdout carries exactly one envelope. Existing tests updated to the new
  validation contract; new `command-spec.test.js` (10 tests).
- RT-24: `requireBinding`/`requireEnv` + `ConfigBindingError`
  (`COSSACK_BINDING_MISSING`) name the missing binding, list available binding
  names only — secret values never enter diagnostics — and point at
  per-environment Wrangler configuration. Covered in `config.test.ts`.
- RT-25: `runtime-capabilities.ts` models transports, durable realtime
  coordination (binding-gated on `COSSACK_SSE`), process-local realtime,
  scheduled handlers, serverless storage, and filesystem per runtime
  (cloudflare/node/deno/desktop), distinguishing available, missing-binding,
  and unsupported; `describeRuntimeCapabilities`/`formatCapabilityResult`
  expose it for inspection. Covered in `runtime-capabilities.test.ts` (5
  tests). Scaffold/CLI consumption remains open.
- `pnpm --filter cossack exec vitest run` (273 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (554 tests), and
  both packages' `tsc --noEmit` passed.

### Group 1 runtime work: unified RPC contract and realtime recovery (GLM, 2026-10-02)

- RT-01 slice: WebSocket `@Server` calls are now request-scoped RPCs on the
  shared `createRpcCall` contract — correlated `yield`/`done`/`error` frames
  by request id through `executeAction` and both socket runtimes (in-memory
  and Durable Object), cancellation frames that close the server generator,
  forbidden/not-found error frames, and per-socket cancellation registries.
  Explicit service RPC (`/crpc` service envelope) streams generators through
  the same NDJSON response protocol with service state per frame, awaits
  scoped-service disposal on ordinary results (matching component RPC), and
  its client proxy consumes `createRpcCall` with redirects, stream frames,
  cancellation, and RpcError mapping. `@Server({ timeout })` adds client-side
  deadlines on HTTP/SSE, WebSocket, and service calls; expiry rejects with
  `COSSACK_RPC_TIMEOUT` and an unknown-outcome message, never a retry.
  Transport failures reject: unopened sockets `COSSACK_RPC_TRANSPORT_UNAVAILABLE`,
  send failures `COSSACK_RPC_TRANSPORT_FAILED`, socket loss mid-call
  `COSSACK_RPC_TRANSPORT_CLOSED`.
- RT-19: `component.realtime` (sse + per-provider websockets) exposes
  `state`, `attempts`, `lastEventId`, `lastError`, `resynced`; WebSocket
  reconnect uses bounded exponential backoff and never revives sockets closed
  by component disposal; the SSE subscription endpoint announces snapshot
  resynchronization with a `resync` event carrying the cursor.
- CF-06 slice: the generated staging app now exercises credentials
  authentication through the built artifact — D1-backed sessions via
  `@cossackframework/auth` `createAuth`, a login API route, a protected page,
  and authenticated SSE coordinator scope isolation (`user:u1` state separate
  from the anonymous scope). Artifact-level application of the migration
  system is still open, so CF-06 stays unchecked.
- Tests: core `rpc-conformance.test.ts` (WS loopback through the real runtime:
  ordinary/generator/error/cancel/timeout/disconnect/duplicate-consumer,
  service proxy over mocked fetch, protocol helpers) and
  `realtime-recovery.test.ts` (status transitions, backoff bounds and reset,
  no reconnect after disposal); framework service-stream router tests;
  expanded deploy-integration auth assertions.
- `pnpm --filter @cossackframework/core exec vitest run` (638 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (528 tests),
  `pnpm --filter cossack exec vitest run` (263 tests), and core/framework
  `tsc --noEmit` passed.

### DI resolution diagnostics (GLM, 2026-10-02, RT-12 slice)

- Missing `@Inject` declarations now fail with an actionable error: the
  requested service, the requesting component, the active scope chain
  innermost-first (each layout with the services it declares, ending at the
  request root), the `@Page({ services: [...] })` fix, and the
  global-singleton alternative. `ServiceScope.describeScopeChain()` exposes
  the same ancestry for inspection without failing; `resolveDeclared` accepts
  an optional consumer used only for diagnostics.
- specs/service.md now documents the global-singleton versus layout versus
  request ownership table and when each is request-safe.
- RT-12 remains open: SSR, navigation, and explicit service RPC cleanup
  completion parity and inspection that matches actual ownership (CLI-04
  dependency) are not done.
- `pnpm --filter @cossackframework/core exec vitest run` (616 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (526 tests), and
  `pnpm tsc --noEmit` passed.

### Distributed SSE coordinator integration (GLM, 2026-10-02)

- Finished CF-05 from the agent handoff. `SseDurableObject` now publishes an
  explicit RPC surface (`initialize` with a `fresh` flag via `rowsWritten`,
  `currentState`, `updates`, `publish`, `broadcast`, `execute`) with
  first-initialization-wins snapshots, per-scope action serialization through
  an explicit queue, per-frame state publication for RPC streams, pass-through
  for materialized responses, explicit failure for frames without object
  state, and a bounded (128 events / 1 MiB) SQLite event log.
- The neutral router and SSE transport reach the coordinator only through the
  `COSSACK_SSE` binding (a structural stub contract; no `cloudflare:workers`
  imports outside the Cloudflare-only `@cossackframework/framework/SseDurableObject`
  entry). On Cloudflare without the binding, `/crpc`, `/sse`, and SSR fail
  with `COSSACK_SSE_BINDING_MISSING` instead of falling back to
  process-local state; Node and Deno keep the documented process-local
  backend.
- SSR initializes the scope with the rendered public state and hydrates the
  authoritative snapshot on later renders; it never resets shared state.
  `/crpc` executes SSE actions inside the coordinator's serialization slot
  with the request's AsyncLocalStorage snapshot, hydrating from the
  authoritative state — a stale browser snapshot cannot overwrite shared
  state. Middleware, layout DI, ORM scope, rate limits, and the `@Server`
  allowlist are preserved; component broadcasts fan out through the
  coordinator.
- The `/sse` subscription streams the snapshot plus incremental events with
  SSE `id` cursors, resumes from `Last-Event-ID` without replaying observed
  events, resynchronizes from the snapshot when history expired, and
  reconnects by closing the stream on poll failure. Ordinary results,
  redirects, custom Responses, and generators are supported through the
  coordinator.
- Scaffold/template/demo wiring: generated Cloudflare apps declare the
  `COSSACK_SSE` binding with a `new_sqlite_classes` migration and export
  `SseDurableObject` from the Worker entry; the framework library type
  generation includes the binding. New preflight diagnostic
  `COSSACK_ENV_BINDING_NOT_INHERITED` (Cloudflare environments do not inherit
  bindings — re-declare `durable_objects` per environment).
- Tests: two-Worker coordinator integration under workerd (serialization,
  publish/broadcast, disconnected queued caller, invalid frames, history
  bounds with resync, reload persistence, cancel slot release); framework
  router/endpoint tests against a structural fake coordinator (SSR hydration,
  authoritative stale-state protection, redirects, subscriptions,
  Last-Event-ID resume, missing-binding diagnostics); the generated staging
  app now builds and runs with the coordinator and covers shared-state
  continuation, stale client state, redirects, subscriptions, broadcasts, and
  reconnect under workerd. Existing D1/context stream, SSG, and asset checks
  retained.
- Environment note: the workspace `node_modules` pnpm virtual store was found
  emptied (2026-10-02 05:29, before this session); `pnpm install` was rerun
  after removing the stale state markers. The earlier intermittent deploy-test
  build failures came from this broken install, not from source changes.
- `pnpm build`, `pnpm tsc --noEmit`, `pnpm typecheck` (all packages),
  `pnpm audit:bundle` (28 neutral modules; Cloudflare entry Workers-safe), and
  `git diff --check -- . ':!reports.md'` passed after the final documentation
  edits. `pnpm test:unit` passed with 2,137 tests across 12 packages (auth 118,
  renderer 256, database 84, scaffold 82, core 615, node-adapter 10, UI 112,
  framework 526, CLI 263, desktop 16, deno-adapter 3, Studio 52), including
  both real-workerd integration tests.

### Distributed SSE prototype and agent handoff

- Added a native SQLite-backed `SseDurableObject` prototype with serialized
  actions, bounded snapshots/event history, and callback RPC that runs actions
  in their original Worker request context. Its native integration test uses
  two Workers sharing one namespace and exercises concurrent increments,
  scope isolation, AsyncLocalStorage, persistence after reload, and progress
  after canceling an HTTP response.
- This prototype is not connected to SSR, `/crpc`, or `/sse`, is not scaffolded,
  and is not yet a published package entry. The application still uses the
  Worker-local SSE store. The distributed SSE checklist item remains open.
- The user requested a commit and handoff to GLM. See
  [handoff-0.9.0.md](./handoff-0.9.0.md) for the implementation map, exact remaining
  integration work, verification results, and the later review checklist.
- Fixed the prototype's SQL row generic types and explicit async-iterator
  return arguments. The checkpoint build, root TypeScript check, all 11 package
  type checks, and database bundle audit passed. `pnpm test:unit` passed 2,125
  tests across 12 packages, including the new coordinator test. Exact commands
  and outstanding verification gates are recorded in the handoff note.
