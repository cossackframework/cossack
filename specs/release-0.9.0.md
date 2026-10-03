# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

Read [the detailed implementation plan](./release-0.9.0-plan.md) for each task's
purpose, baseline, approach, dependencies, and acceptance criteria. The task IDs
below link directly to those explanations.

## CLI and agent tooling

- [x] [CLI-01](./release-0.9.0-plan.md#cli-01) Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.
- [x] [CLI-02](./release-0.9.0-plan.md#cli-02) Validate command-specific flags and reject ambiguous/unknown options consistently. Codex continuation (2026-10-02): every built-in command uses shared parser/help metadata, canonical aliases, repeat rules, scoped options and arity, and target/provider checks before effects. Vite forwarding retains its explicit boundary. See the metadata checkpoint below.
- [x] [CLI-03](./release-0.9.0-plan.md#cli-03) Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands. Codex completion (2026-10-02): supervised finite results and lifecycle events, isolated imports/tool logs, safe ORM/parser failures, bounded execution and shutdown, and subprocess success/failure/dry-run coverage across command families. See the machine-contract acceptance checkpoint below.
- [x] [CLI-04](./release-0.9.0-plan.md#cli-04) Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons. Codex completion (2026-10-03): shared compiler/scaffold/runtime model, imported declarations, authored resource locations, module validity, middleware order, and source-bearing diagnostics. Combined compiler and executed SSG service acceptance pass; unsupported facts remain explicitly unknown. See the [requirement audit](#codex-module-inspection-2026-10-03). Follow-up acceptance now also covers functional HTTP modules and default-export selection across runtime component paths; see [parity corrections](#codex-handler-default-parity-2026-10-03).
- [x] [CLI-05](./release-0.9.0-plan.md#cli-05) Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks. Codex completion (2026-10-03): all four recipes have repeat/edit-safe composition and generated type/build/RPC/browser acceptance. Scoped service navigation/disposal and real protected-route migrations/sessions/expiry pass. Unsupported native database/Desktop combinations fail during planning before writes. See the [completion checkpoint](#codex-four-recipe-capabilities-2026-10-03).
- [x] [CLI-06](./release-0.9.0-plan.md#cli-06) Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions. Codex completion (2026-10-02): recorded dependency ownership supports additions/removals/section moves while preserving user edits; exact target scaffold releases supply templates and dependencies; plans include file deletions and manifest effects, reject stale/unsafe inputs, and report partial installation failures. Generated-app subprocess fixtures and a real pnpm/local-registry tarball test verify the contract.
- [ ] [CLI-07](./release-0.9.0-plan.md#cli-07) Local MCP tools sharing inspection, documentation, checks, test results, and trace services with the CLI. Codex (2026-10-04): project-bound stdio inspection, versioned schemas, installed versions, redaction and bounded cancellable workers now pass SDK/CLI parity and lifecycle tests. Documentation, stored test results and devtools trace access remain open. See the [checkpoint](#codex-local-mcp-2026-10-04).
- [ ] [CLI-08](./release-0.9.0-plan.md#cli-08) Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples. Codex (2026-10-04): offline installed export-target catalogs, command schemas and packaged/scaffolded guides now share CLI/MCP services. Named-symbol signatures now use a pinned compiler API, with partial results and runtime limits explicit. Wildcard and implicit declaration discovery now preserve exclusions, precedence and partial results. Package-owned route/renderer and four feature-recipe guides compile and execute from installed tarballs. Broader API/component/recipe coverage and runtime guidance remain open. See the [guidance checkpoint](#codex-package-guidance-2026-10-04).

## Runtime and application APIs

- [ ] [RT-01](./release-0.9.0-plan.md#rt-01) Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics. Authored inference, JSON wire types, native body completion, shared multipart ownership and a 421-case matrix are verified. Known IDs survive malformed frames; HTTP completion validates EOF before final state hydration. Ordinary JSON/error replies now have bounded strict UTF-8 decoding, validated service/redirect envelopes and correlated diagnostic fields before hydration. Child state stays separate from SSE page snapshots; limits apply to HTTP/socket actions with canonical ownership and correlated denials. Production workerd verifies limited D1 writes and shared layout-service budgets. Native Cloudflare peer/IP/header/custom-key and cross-Worker counter acceptance now passes; Node/Deno pass per-connection contexts. DO counter persistence now survives actual native eviction and Worker reload; concurrent two-Worker counts and spent HTTP/socket budgets pass. Invalid configured stores, first-env ownership and runtime options/counter replies now reject before mutation; the shared matrix has 421 cases. Backend reply bounds/deadlines and explicit cross-Worker coordinator cancellation now pass; cancelled queued callbacks never start. Remaining: actual native pre-header disconnect delivery, arbitrary action deadlines and initialization/restoration concurrency, plus RT-02/RT-14 resource policies and RT-11 session criteria. RT-18 provider contracts are now complete. See the [latest checkpoint](#codex-sse-cancellation-2026-10-03).
- [x] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies. Codex completion (2026-10-03): schema-only migration, parsed/native/browser signatures, public function-field inference, private compiler imports and callback failures pass the transport matrix and generated Node/native Worker acceptance. Coerced types, nested errors, File/resource guards and explicit cancellation perform no invalid/denied mutation. See the [criterion audit](./release-0.9.0-plan.md#rt-02) and [schema migration review](#codex-schema-migration-2026-10-03). Native calls explicitly parse/authorize; RT-01, RT-07 native API declarations/error mapping and final release/runtime gates remain separate.
- [x] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation. Codex completion (2026-10-03): declared field names and inferred nullable/optional values, current-dependency refresh, dependency-aware SSR hydration, stale result/error disposal, and unit/published-type/production-browser/native Worker HTTP/SSE acceptance pass. See the [criterion audit](./release-0.9.0-plan.md#rt-03) and [review](#codex-resource-lifecycle-2026-10-03). Browser-owned filters use ClientState; broad RT-01/RT-05 and final release gates remain separate.
- [x] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics. Codex completion (2026-10-03): executable mechanism examples, read-only development serialization diagnostics, shallow ClientState diagnostics, inherited public/client contracts and forged-state exclusion pass unit, published declarations, development/production browser and native Worker HTTP/SSE acceptance. See the [criterion audit](./release-0.9.0-plan.md#rt-04) and [review](#codex-state-diagnostics-2026-10-03). Production serialization remains unchanged; plain Node Vite development routing remains an open REL-03 integration gap.
- [x] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work. Codex completion (2026-10-03): published typed paths/patches, execution-owned synchronous commits, inherited task registration, cleanup diagnostics and production browser navigation/scoped-service disposal pass. See the [criterion audit](./release-0.9.0-plan.md#rt-05) and [review](#codex-task-ownership-2026-10-03). Direct writes remain cooperative; commits do not terminate ignored I/O or provide rollback.
- [x] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects. Codex completion (2026-10-03): per-call ownership, explicit increment/append/remove contributions, later local edits, ordered SSE publications, retained service consumers, declared uncertain-outcome reads and native socket/SSE recovery pass. Component/service cancellation before iteration and stalled response waits now release ownership; 32 controlled stream cases, a 25-case production Node/native Worker browser matrix and the executable published example complete the original criteria. See the [criterion audit](./release-0.9.0-plan.md#rt-06) and [completion review](#codex-optimistic-completion-2026-10-03). Services use HTTP on HTTP/SSE/socket pages. No mutation retry, server rollback, ignored-I/O termination or broader RT-01/RT-11/REL-03 completion is claimed.
- [x] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection. Codex completion (2026-10-03): shared discovery/manifest, published URL and API contracts, actual Node/native workerd/D1 handlers, source-specific boundaries and middleware ownership pass. Grouped/dynamic unknown URLs, literal/catch-all selection, ambiguous source groups, guards, status-preserving browser hydration/navigation and read-only source explanations now meet the original criteria. The unused PageOptions.route is removed with type/runtime/compiler diagnostics and migration guidance. See the [criterion audit](./release-0.9.0-plan.md#rt-07) and [completion review](#codex-route-boundaries-2026-10-03). Broader RPC, session and runtime/release gates remain separate.
- [x] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting and pagination. Codex completion (2026-10-04): inferred codecs/defaults, copied Unicode URLs, SSR/hydration, push/replace/history, merged pending patches, draft ownership and exact backend reads pass the criterion audit and production Node/workerd matrix. See the [acceptance record](#codex-navigation-acceptance-2026-10-04).
- [x] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics. Codex completion (2026-10-04): bounded outcomes, stale/disposed ownership, rapid links, guarded/interrupted history, errors/redirects, retained layouts, fragments and unavailable transitions pass the criterion audit. RT-28 devtools UI and full release gates remain separate. See the [acceptance record](#codex-navigation-acceptance-2026-10-04).
- [ ] [RT-10](./release-0.9.0-plan.md#rt-10) Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] [RT-11](./release-0.9.0-plan.md#rt-11) Session/flash recipes covering RPC failure, redirects, old input, and rotation. Codex verifies native redirect cookies and old-input consumption, preserves valid flash during background transports/failures, and rejects late rotation/destruction before storage changes. Remaining: secret exclusion, complete recipes, rotation/concurrency semantics, and Workers/realtime acceptance.
- [ ] [RT-12](./release-0.9.0-plan.md#rt-12) DI resolution errors and scope/lifetime inspection with clear global/scoped guidance. GLM implemented contextual resolution failures, scoped disposal, and layout declaration inspection. Codex reviews retain this task open: the AST scanner does not prove runtime/compiler ownership for inheritance and dynamic declarations. Finish compiler-backed ownership inspection and browser navigation lifetime verification.
- [ ] [RT-13](./release-0.9.0-plan.md#rt-13) Auth/OAuth failure diagnostics and reusable credential/session primitives in the auth library.
- [x] [RT-14](./release-0.9.0-plan.md#rt-14) Typed resource authorization policies and client visibility helpers. Codex completion (2026-10-03): typed named actions, app-owned lookup, server request/socket identity, pre-mutation gates, API/read/middleware enforcement and boolean UI projections pass direct forged-state, native D1 and browser/socket acceptance. See the [criterion audit](./release-0.9.0-plan.md#rt-14) and [review](#codex-resource-policies-2026-10-03). Native calls require explicit authorization; session freshness stays RT-11.
- [ ] [RT-15](./release-0.9.0-plan.md#rt-15) Database metadata, relationships, provider capabilities, query diagnostics, pagination, and transactions.
- [ ] [RT-16](./release-0.9.0-plan.md#rt-16) Structured migration/seeder plans including SQL, destructive operations, environment, and target.
- [ ] [RT-17](./release-0.9.0-plan.md#rt-17) Shared Studio/CLI database inspection service.
- [x] [RT-18](./release-0.9.0-plan.md#rt-18) Cache/rate-limit capability checks, consistent TTL units, and transport coverage. Codex completion (2026-10-03): pure provider traits, millisecond contracts, pre-operation required-guarantee rejection, bounded key/namespace/Redis/memory policies and read-only provider inspection now pass unit/SQLite/compiled/native acceptance. Shared DO budgets survive concurrent Workers, actual eviction and reload. See the [criterion audit](./release-0.9.0-plan.md#rt-18) and [provider review](#codex-storage-capabilities-2026-10-03); actual incoming disconnect delivery and full release gates remain separate.
- [x] [RT-19](./release-0.9.0-plan.md#rt-19) Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay. GLM (2026-10-02): `component.realtime` exposes per-connection state/attempts/lastError/lastEventId/resynced; WebSocket reconnect uses bounded exponential backoff (0.5s→30s, reset on open, none after intentional disposal); SSE resends an authoritative snapshot with a `resync` marker when history expired; pending calls reject with explicit uncertain-outcome errors (`COSSACK_RPC_TRANSPORT_CLOSED`) and never replay. Covered by core recovery/conformance tests plus the workerd coordinator suite.
- [ ] [RT-20](./release-0.9.0-plan.md#rt-20) SSR/hydration diagnostics with component/field/source information and test helpers.
- [ ] [RT-21](./release-0.9.0-plan.md#rt-21) SSG entry/plugin validation, per-route results/timings, and dependency compatibility tests.
- [ ] [RT-22](./release-0.9.0-plan.md#rt-22) Typed markdown frontmatter, route/URL collision checks, and locale static output.
- [ ] [RT-23](./release-0.9.0-plan.md#rt-23) Typed DataTable with server data, filtering, sorting, selection, and pagination; native UI attributes/events and accessibility catalog. Codex (2026-10-04): controlled DataTable, stable selection, public types, SSR, HTTP-backed Chromium keyboard/focus coverage and installed guidance are implemented. Generated Cossack app integration and the broader UI audit remain open. See the [checkpoint](#codex-data-table-2026-10-04).
- [ ] [RT-24](./release-0.9.0-plan.md#rt-24) Inferred configuration factories, required binding validation, and secret redaction. GLM (2026-10-02): `requireBinding`/`requireEnv` fail with `COSSACK_BINDING_MISSING` naming the binding, listing available binding NAMES only (never values, secrets stay redacted), and pointing at per-environment wrangler configuration; remaining: config-path misspelling type tests and registry generation from project configuration.
- [x] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop. Codex completion (2026-10-03): one pure core model serves scaffold planning, framework builds, and CLI inspection; selected recipe requirements, transport bindings, durable-state and adapter requirements have source diagnostics. Published-export Node/Deno/Desktop build fixtures preserve the HTTP-only Desktop boundary and reject Workers imports. The [criterion audit](./release-0.9.0-plan.md#rt-25) is complete; Deno execution and Electron launch/packaging remain REL-03 gates.
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
- [x] [CF-05](./release-0.9.0-plan.md#cf-05) Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams. GLM (2026-10-02): coordinator wired through SSR, `/crpc`, and `/sse`; scaffolded `COSSACK_SSE` binding (`new_sqlite_classes`) and `SseDurableObject` entry; missing-binding and environment-inheritance diagnostics; cursor reconnect with bounded history; broadcasts. Node/Deno keep the documented process-local backend (see [specs/sse.md](./sse.md)). Not claimed: exactly-once external side effects, native pre-header TCP disconnect delivery (explicit coordinator cancellation is now verified), stream-response cookie handling (RT-11).
- [x] [CF-06](./release-0.9.0-plan.md#cf-06) Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime. GLM (2026-10-02): the generated staging app runs under workerd through published packages covering D1-backed credentials auth (login/protected route/authenticated SSE scope isolation), component+service RPC with streams and cancellation, protected assets with policies, public SSG validation, binding/artifact comparison, the SSE coordinator (subscriptions, cursors, reconnect, broadcasts), and the migration system applying real migrations against the bound D1 (recorded bookkeeping, idempotent re-runs) plus schema-serving reads.
- [x] [CF-07](./release-0.9.0-plan.md#cf-07) Public-only SSG and correct Worker-first routing for protected assets.
- [ ] [CF-08](./release-0.9.0-plan.md#cf-08) Production logs, source maps, correlation IDs, and build/startup budgets.
- [ ] [CF-09](./release-0.9.0-plan.md#cf-09) Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance.
- [ ] [CF-10](./release-0.9.0-plan.md#cf-10) Correct custom-domain/build deployment documentation and tested compatibility baseline. Codex continuation (2026-10-02): resolved the development WebSocket crash by keeping Upgrade requests out of the ASSETS bridge; 24 navigation/guard/transition browser tests pass. The installed combination is recorded in deployment docs. Generated guide execution and the complete compatibility acceptance remain open.
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

<a id="codex-websocket-ownership-2026-10-04"></a>
## Codex WebSocket ownership (2026-10-04)

Author: **Codex**. Continued after `3584180`. WebSocket callbacks previously lacked
source ownership checks. A retired socket could publish state or invoke an event,
and an obsolete close could overwrite status or schedule a reconnect. Destruction
also depended on a future close callback to clear heartbeat/pending-call state.

Core now retires provider ownership before closure, sets closed status, clears
heartbeat/reconnect timers and settles pending calls with the uncertain-outcome
error. Callback identity and terminal-phase checks reject stale delivery. Duplicate
close events cannot schedule extra reconnects. Provider replacement closes the old
connections, and destroyed components cannot open new ones.

Three new unit cases cover retired/replaced callbacks, pending-call settlement,
zero remaining timers, duplicate close and pending reconnect cancellation. The
existing malformed-known-ID test used a Destroyed component to avoid reconnects;
it now uses a live owner and explicit cleanup while preserving protocol assertions.

Production Node/native workerd fixtures open real sockets, change path-derived
provider targets, replace a page at the same target and return to HTTP. Changed
ownership resets drafts/services; matching ownership preserves them. Old sockets
close and retired services dispose once. Cloudflare uses a test-only binding and
SQLite migration for the existing AppDurableObject export, following the installed
Wrangler schema and [Cloudflare class-export guidance](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

Verification:

- `pnpm --filter @cossackframework/core exec vitest run tests/realtime-recovery.test.ts`:
  13 passed.
- Core and framework builds passed, including framework SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,442 passed, 85 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,453 passed, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|moves between production Node and workerd|parses and navigates typed URL state'`:
  5 passed, 26 skipped (62 seconds), including the final same-target replacement.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No task closes: 22/58 checked, 36 unchecked.** The planned navigation ownership
scenarios now have native evidence. Next audit the original RT-08/RT-09 requirements
and run relevant browser suites plus the full generated-runtime file before closure.
Versions remain 0.8.3. No deployment, publication or full CLI rerun occurred.

<a id="codex-runtime-ownership-2026-10-03"></a>
## Codex runtime and SSE ownership (2026-10-03)

Author: **Codex**. Continued after `c5e01d2`. Production Node/native workerd
acceptance now opens an SSE child page and returns to HTTP. Shared root/layout
drafts and services remain stable. Page drafts reset and the retired source closes.
This test reproduced realtime.sse.state remaining open after navigation on both
runtimes: EventSource.close() does not send a close event.

Core now clears SSE ownership and sets closed before closing the source. Saved
open/error handlers and named event listeners check source identity and destruction.
Late state, cursor/resync, action completion, event and client-action callbacks
cannot mutate retired owners. Replacement closes the old source. Destruction
prevents reconnection. Two unit cases simulate both destroyed and replaced owners.

A separate local HTTP proxy routes one browser from real built Node to native
workerd and back. It does not rewrite SSR metadata. With the same user, scope and
page path, runtime changes reset root/layout/page drafts and create fresh services.
Old services dispose exactly once. This is HTTP runtime acceptance, not a claim
about cross-runtime WebSocket provider targets or production load balancing.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run tests/realtime-recovery.test.ts`:
  10 passed, including both late-callback regressions.
- Core and framework package builds passed, including framework SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,439 passed, 85 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,453 passed, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|moves between production Node and workerd|parses and navigates typed URL state'`:
  5 passed, 26 skipped (66 seconds), including the existing read-count and same-URL cases.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No task closes: 22/58 checked, 36 unchecked.** Finish provider-target/WebSocket
ownership acceptance and audit every RT-08/RT-09 criterion before closure.
Versions remain 0.8.3. No live deployment, publication or full CLI rerun occurred.

<a id="codex-same-url-history-2026-10-03"></a>
## Codex same-URL history (2026-10-03)

Author: **Codex**. Continued after `2f9b7c3`. The generated production fixture now
uses separate history entries with identical URLs to test two interruption cases
on Node and native workerd:

- Delay the forward restoration after a guarded native back traversal. A new
  intent remains pending until restoration reaches the second entry, then pushes
  from that entry. Restoration performs no resource reads.
- Confirm the original back traversal and hold its actual SSR response after
  backend reads complete. A new navigation supersedes it and commits from the
  first entry. Releasing the old response changes neither history nor live state.

Assertions compare history group/position, application entry markers, history
length, page/service/File drafts, page/layout resource values and exact backend
reads. The two identical URLs are distinguished by entry identity throughout.
The test temporarily wraps history.go to delay restoration, then invokes the
real method. Confirmation uses an actual intercepted production SSR response.
Cleanup restores history methods, releases held responses and closes each page.

Verification:

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state|isolates navigation ownership'`:
  4 passed, 26 skipped (49 seconds). Both interruption cases ran on each runtime.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

No runtime fix was required. These are test/documentation changes, so library
builds and full unit/CLI suites retain their prior evidence.
**No task closes: 22/58 checked, 36 unchecked.** Continue native provider/runtime/
transport ownership acceptance and the full RT-08/RT-09 criteria audit. The tested
same-URL scenarios are complete and removed from the active handoff's pending list.
Versions remain 0.8.3. No live deployment or publication occurred.

<a id="codex-url-backend-reads-2026-10-03"></a>
## Codex URL-state backend reads (2026-10-03)

Author: **Codex**. Continued after `4f6d633`. The generated URL-state fixture now
runs a real HTTP backend with independent request records. Page and layout
server resources fetch their values from that backend. The test server starts
before building and closes after browser/runtime cleanup, including failure paths.

Both production Node and native workerd pass exact read assertions:

- Initial SSR and each fresh query document read page/layout once each. Browser
  hydration and retained-layout dependency hydration add no reads or RPCs.
- Cached back/forward, guarded navigation and confirmation use existing data.
- Failed root rendering counts the destination's SSR reads. Rollback adds none.
  Post-render layout teardown/recovery also adds no backend reads.
- Replacement, copied URLs, invalid defaults and coalesced rapid updates return
  expected values with one read per resource for each fresh document.
- A held SSR response has already made its two reads. Superseding it through
  back/replace/forward and a newer query has exact per-destination read counts.
  Releasing the obsolete response adds no reads and cannot overwrite live data.
- Leaving and returning creates a fresh document. Subsequent scope cleanup adds
  no backend reads.

Verification:

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state|isolates navigation ownership'`:
  4 passed, 26 skipped (42 seconds), including both production runtimes.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

These are test-only changes. No library rebuild or full unit/CLI rerun is claimed.
The backend is HTTP, not a database adapter. Delaying an already-produced SSR
response does not prove cancellation of backend work.

**No task closes: 22/58 checked, 36 unchecked.** Keep native provider/runtime/
transport ownership, interrupted same-URL history and full acceptance audits open.
Extend these read assertions with those scenarios. Versions remain 0.8.3.

<a id="codex-navigation-diagnostics-2026-10-03"></a>
## Codex navigation diagnostics (2026-10-03)

Author: **Codex**. Continued after `75609d2`. Development now emits versioned,
frozen navigation diagnostic records with per-document IDs and monotonic timestamps.
Phases report cache hit/miss/shared reads, invalidation count, attempted layout
retention/replacement, actual scroll decisions, transition fallback and final
outcome/commit status. Prefetch and invalidation use a null navigation ID.

Core scroll application returns its actual decision, including a missing fragment
that falls back to the top. Framework does not duplicate that selection logic.
Transition animation rejection is reported separately and can arrive after finish.
Records omit URLs, state, application identifiers, transition names and raw errors.
Production builds emit no diagnostic events. See the
[event contract](../docs/prevent-navigation.md#development-diagnostics).

Verification:

- `pnpm --filter @cossackframework/core build`: passed.
- `pnpm --filter @cossackframework/framework build`: passed, including SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,437 passed, 85 files.
  Scroll assertions cover top, preserve, saved history, found/missing fragments
  and the absence of a browser.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,453 passed, 68 files.
  The 47-case navigation file includes ordered/frozen records, correlation,
  cache reuse/invalidation, layout counts, shared prefetch, cancellation,
  supersession, failure, transition fallbacks and production suppression.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|parses and navigates typed URL state'`:
  4 passed, 26 skipped. Production Node/native workerd ownership scenarios also
  assert that no diagnostic event is emitted.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No task closes: 22/58 checked, 36 unchecked.** Extend diagnostic acceptance with
remaining native provider/runtime/transport and interrupted same-URL history
scenarios. Actual backend read counts still require independent assertions.
Controlled diagnostic tests do not close those requirements or the release gates.
Versions remain 0.8.3. No full CLI rerun or live deployment is claimed here.

<a id="codex-route-inheritance-2026-10-03"></a>
## Codex route inheritance (2026-10-03)

Author: **Codex**. Continued after `8f084e0` and handoff compaction `d53eab4`.
The parent-layout fixture reproduced 405 responses on both Node and native workerd.
Router classification considered only an own render() declaration. API dispatch
also ignored authored inherited handlers. A decorated subclass therefore built
successfully but could not render or invoke its inherited API methods.

A shared descriptor lookup now searches authored ancestors and stops before the
Cossack prototype. Inherited render() selects SSR. API lookup honors get()/init()
precedence and derived overrides without invoking accessors or falling through a
shadowing declaration. The framework's default methods remain excluded.

The production fixture uses decorated inherited pages/layouts and the same child
classes under changed parents. Root drafts/services survive navigation away and
back. Replaced nested drafts reset, nested services are fresh, and retired services
dispose exactly once. Inherited GET/POST handlers return their expected JSON on
both runtimes. Bare default re-export transport discovery is not claimed.

Verification:

- `pnpm --filter @cossackframework/framework exec vitest run tests/api-routes-class.test.ts`:
  14 passed, including 5 new inheritance/override/accessor cases.
- `pnpm --filter @cossackframework/framework build`: passed, including SSG.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,444 passed, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|parses and navigates typed URL state'`:
  4 passed, 26 skipped, covering production Node and native workerd.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  all 30 generated-runtime cases passed (216 seconds).
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 packages passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No new task closes: 22/58 checked, 36 unchecked.** Parent-layout acceptance is
now verified. Native provider/runtime/transport ownership, interrupted same-URL
history, actual backend read counts and navigation diagnostics remain open.
Versions remain 0.8.3. The compact handoff retains current next steps.

<a id="codex-root-ownership-2026-10-03"></a>
## Codex root ownership (2026-10-03)

Author: **Codex**. Reviewed after `ee5734a`. Generated production Node and native
workerd tests reproduced private root App drafts surviving a changed user or
navigation scope. Page/layout replacement alone did not reset the root tree.

The framework now prepares and publishes a fresh App with a fresh root service
scope when root ownership changes. Root listeners check the active App identity.
Rollback restores the prior App, contexts and drafts. Successful retirement
removes its listener and waits for component cleanup before root scope disposal.
The renderer clears old DOM when the current root renders null. The App's own
transport remains independent of its child page's transport.

The new fixture covers retained drafts and service identity for matching owners,
user/scope changes, failed replacement, stale failed-root updates and empty output.
A held asynchronous layout cleanup reads its original user, URL and live service.
Retired declared services dispose exactly once. Legacy global injection is unchanged.
The fixture uses a query-based identity only for testing, not as authentication.

Verification on the final source:

- `pnpm --filter @cossackframework/renderer exec vitest run`: 284 tests, 22 files.
- `pnpm --filter @cossackframework/renderer build`: passed.
- `pnpm --filter @cossackframework/framework build`: passed, including SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,434 tests, 85 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,439 tests, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|parses and navigates typed URL state'`:
  4 passed, 26 skipped. Both fixtures ran in production Node and native workerd.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: 610 tests, 44 files,
  328 seconds. Ran without competing heavy test jobs.
- `git diff --check -- . ':!reports.md'`: passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.

The attempted parent-layout fixture used bare default re-exports. Compiler
validation rejected unknown transport metadata before runtime. It was removed
from this fixture and is not passing evidence. Continue that case with supported
route declarations. Native provider/runtime/transport changes, interrupted
same-URL history, backend read counts and diagnostics remain open.

**No task closes: 22/58 checked, 36 unchecked.** Versions remain 0.8.3. This review
does not close RT-08/RT-09 or the final release gates. See their detailed plans.

<a id="codex-inactive-cache-2026-10-03"></a>
## Codex inactive cache (2026-10-03)

Author: **Codex**. Continued after `34592fd`. Inactive cache branches were absent
from rendered-tree checkpoints. A branch hidden across navigation lost its draft;
reusing one pending token for destination and rollback would also consume the
rollback's values.

Core now forks unconsumed local capabilities without reading their former owner.
Forks keep class binding and copy plain draft graphs independently; File/native
values retain identity. Unknown, consumed and wrong-class capabilities reject.
Renderer checkpoints capture hidden stashes and can fork remaining pending trees
on another navigation, rebasing parent identities to the current owners.

Navigation retires hidden instances and keeps their declared draft capabilities
until matching branches become visible. Restoration precedes mount. Ordinary
cache toggles retain live DOM. Both template placeholders and cache(null) work.
Cache exit, changed key/class/parent/scope, explicit discard and publication
revocation reject pending restoration. Destroyed owners stay terminal. The renderer
still imports no core or framework implementation.

Unit tests prove two owner replacements, independent rollback copies, rejection
boundaries, class-bound one-use tokens, saved-proxy isolation and File identity.
The renderer fixture throws if a disposed owner is read. Generated production
Node/native workerd browsers hide two page branches, navigate repeatedly and roll
back, write through an old proxy, then reveal both drafts and a cached File.
Leaving and returning resets the cached fields.

Verification on 2026-10-03:

- Final renderer: `pnpm --filter @cossackframework/renderer exec vitest run`:
  **282 / 21 files**, including 21 navigation-draft cases.
- Full core: `pnpm --filter @cossackframework/core exec vitest run`:
  **1,434 / 85 files**. After the constructor comparison was adjusted for
  declaration emission, the final `tests/url-state-navigation.test.ts` run passed
  all **10 tests**, including fork rejection and graph/File behavior.
- Renderer, core and framework builds passed, including framework SSG.
- Framework: `pnpm --filter @cossackframework/framework exec vitest run`:
  **1,439 / 68 files**.
- Generated production Node/native workerd browser matrix:
  `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state'`:
  **2 passed / 26 skipped**. The full CLI run below also includes the final
  additional cached-field reset assertions.
- Final full CLI: `pnpm --filter cossack exec vitest run --maxWorkers=2`:
  **608 / 44 files**, 297 seconds. No concurrent heavy test/build job ran during
  this suite. The creation case that timed out at the previous checkpoint passes.
- Final `pnpm tsc --noEmit` and `pnpm typecheck`: passed, all **11 packages**.
- `git diff --check -- . ':!reports.md'`: passed. All 58 task IDs and checkbox
  states match the previous commit. No owned test/build process remains.

No live deployment, publication, push or external message was performed.

**No release checkbox closes: 22/58 checked, 36 unchecked.** Native ownership
changes, interrupted same-URL history, actual backend resource-read counts and
navigation diagnostics remain open. The
[detailed RT-09 plan](./release-0.9.0-plan.md#rt-09) lists the next actions.
Versions stay 0.8.3 until REL-04.

<a id="codex-nested-drafts-2026-10-03"></a>
## Codex nested drafts (2026-10-03)

Author: **Codex**. Continued after `3af248d`. Page-level draft transfer did not
preserve renderer-created children destroyed during destination rendering or
rollback. The renderer now captures a local part-tree checkpoint. Matching uses
template identity, part position or repeat key, component class, parent and service
scope. The framework maps an old page to its prepared replacement only when its
class and ownership match. Separate checkpoints protect rollback values from
consumption during destination rendering.

Fresh children consume core draft capabilities before state initialization and
mount. Core drops the consumed initialization map afterward. Live retained
components keep their latest state; destroyed instances are not reconnected.
Publication checks reject delayed descendant restoration after supersession.
No renderer-to-core dependency or serialized draft payload is added.

Renderer tests cover nested restoration, explicit page-owner replacement, arrays,
keyed reordering, changed class/parent/scope/key, revocation, retained live values,
and the active cache template. A failing repeated item exposed a separate cleanup
leak: earlier new siblings were not yet recorded in the owned part list. The
renderer now records and disposes all partial siblings before propagating failure.
A synchronous render from a mismatched wrapper also exposed fallback propagation
into slotted children. The renderer now passes an explicit no-recovery boundary;
a failing-before/fixed-after regression verifies that no draft crosses it.

Generated production Node/native workerd apps retain page/layout child drafts and
grandchild File values during query replacement and post-render failure recovery.
Replacement mount hooks see restored values. Leaving the page resets unrelated
child drafts. The previous service cleanup and navigation matrix stays enabled.

Verification on 2026-10-03:

- Final renderer: `pnpm --filter @cossackframework/renderer exec vitest run`:
  **273 / 21 files**, including 12 draft/reconciliation cases.
- Full core: **1,432 / 85 files** before the final consumed-map release. After
  that one-line change, `pnpm --filter @cossackframework/core exec vitest run tests/url-state-navigation.test.ts`:
  **9 passed**, including restored values visible during child mount and the
  released initialization map.
- Final renderer, core and framework builds passed, including framework SSG.
- Final framework: `pnpm --filter @cossackframework/framework exec vitest run`:
  **1,439 / 68 files**.
- Final production browser checks:
  `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state'`:
  **2 passed / 26 skipped** (Node and native workerd), after the final rebuild.
- Full CLI `pnpm --filter cossack exec vitest run --maxWorkers=2` completed in
  356 seconds: **607 passed / 1 failed**, 43 green files and one failed file.
  The existing creation/JSON matrix case hit Vitest's five-second timeout.
  `pnpm --filter cossack exec vitest run tests/cli-json-matrix.test.js -t 'create plans without writes'`
  then passed (**1 passed / 42 skipped**, test body 1.9 seconds). No timeout or
  assertion was weakened. The broad run preceded the final synchronous-wrapper
  guard and core map-release refinement; it is not claimed as a clean final run.
- Final `pnpm tsc --noEmit` and `pnpm typecheck`: passed, all **11 packages**.
- `git diff --check -- . ':!reports.md'`: passed. All 58 task IDs/check states
  match the previous commit. No owned test/build process remains.

No live deployment, publication, push or external message was performed.

**No checkbox closes: 22/58 checked, 36 unchecked.** Inactive cache() stashes,
broader native ownership changes, interrupted same-URL history, actual backend
read counts and navigation diagnostics remain open. Read the concrete next steps
in [RT-09](./release-0.9.0-plan.md#rt-09). Versions remain 0.8.3.

<a id="codex-scope-retirement-2026-10-03"></a>
## Codex scope retirement (2026-10-03)

Author: **Codex**. Reviewed and continued after `773c9c3`. Rollback destroyed
transient layout service scopes before renderer-created children finished cleanup.
Successful retirement could also close a service after DOM removal but before
an asynchronous child cleanup finished.

Core now tracks renderer consumer lifetimes for a scope and its ancestors.
Navigation retirement snapshots those consumers before destruction. Components
become Destroyed and cancel tasks immediately; service disposal waits for consumer
removal and async cleanup. New attachments to a retiring scope fail. Owned-scope
holds release before the owner's own disposal completion to prevent a self-wait.
Ordinary explicit destruction keeps its existing contract. A permanently pending
application cleanup can retain its services; this hold does not extend navigation's
completion deadline or forcibly cancel user I/O.

Renderer structural hooks keep the renderer independent of core. Failed connection
or hydration cleans partially created siblings; invalidated root caches cannot
reuse disposed parts. A throwing disconnection hook is logged, and sibling
cleanup and scope release continue. Core tests cover scope ancestry, immediate
task cancellation, self-wait prevention, late attachment rejection, ordinary
destruction and successful retirement during pending child cleanup. Renderer
tests cover attachment/removal, partial render/hydration failure and hook errors.

Generated Node/native workerd apps throw after actual DOM reconciliation, then
check rollback state and an async child's use of its still-open service before
exactly one disposal. Explicit @Client hooks keep browser-only assertions in the
client bundle. Nested child draft restoration remains separate follow-up work.

Verification on 2026-10-03:

- `pnpm --filter @cossackframework/renderer exec vitest run`: **261 / 20 files**.
- Full core: **1,431 / 85 files**. After adding the successful-retirement case,
  `pnpm --filter @cossackframework/core exec vitest run tests/navigation-scope-retirement.test.ts`:
  **5 passed**. Core implementation did not change after the full run.
- Renderer, core and framework builds passed, including framework SSG.
- Full CLI: `pnpm --filter cossack exec vitest run --maxWorkers=2`:
  **608 / 44 files**, 338 seconds. This ran before the final successful-retirement
  framework change and explicit browser cleanup gates.
- After that change, framework was rebuilt. Final full framework:
  `pnpm --filter @cossackframework/framework exec vitest run`: **1,439 / 68 files**.
- Final generated production Node/native workerd browser matrix:
  `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state'`:
  **2 passed / 26 skipped**. Both rollback and successful retirement hold async
  cleanup behind an explicit gate, prove no early disposal, then release it and
  observe cleanup with an open service followed by exactly one disposal.
- Final `pnpm tsc --noEmit` and `pnpm typecheck`: passed, all **11 packages**.
- `git diff --check -- . ':!reports.md'`: passed. No owned test/build process remains.

No live Cloudflare deployment or release publication was performed.

**No release task closes.** All 58 original IDs remain in order, with 22 checked
and 36 unchecked. RT-08 and RT-09 still need their full acceptance audit. Follow
the [detailed next steps](./release-0.9.0-plan.md#rt-09) and
[Codex handoff](./handoff-0.9.0.md). Versions remain 0.8.3.

<a id="codex-render-recovery-2026-10-03"></a>
## Codex render recovery (2026-10-03)

Author: **Codex**. Continued after `457646e`. App rendering could swallow an
exception and report navigation success. Waiting on an unrelated App update
promise also blocked later rendering. The outgoing page was already destroyed,
so failure after publication had no live page owner to restore.

Core now owns a guarded navigation render pass, independent of cached application
update promises. It preserves the render/controller lifecycle, propagates errors,
and checks ownership before template publication and later lifecycle hooks.
A shouldUpdate veto reports COSSACK_NAVIGATION_RENDER_SKIPPED. Ordinary background
updates keep their existing logged-error behavior. Navigation customization uses
render/lifecycle hooks, not requestUpdate/performUpdate synchronization overrides.

The framework keeps the outgoing page alive through rendering. Before history
commit, cancellation or failure restores the prior page/layout map, request URL,
parameters, user, resource entries, service request binding and global SSR state.
Restored unresolved reads can reload rather than join discarded results. An
identity guard prevents late recovery work from overwriting a newer publication.
After rendering and history commit, old owners retire. Cleanup/completion errors
after that boundary leave the committed destination current. Sibling outgoing
owners still receive cleanup when one cleanup throws.

Core tests cover stuck update promises, render errors, revocation during render,
controllers, willUpdate and listeners, plus retained context/resource restoration.
Framework tests cover error/veto/deadline recovery and a newer navigation completing
before an obsolete render is released. Real generated Node/native workerd apps
throw from App.render, verify restored page/layout/service/File state, and then
navigate with an actual App update promise that never settles.

Verification checkpoints: full core **1,427 / 84 files** and full framework
**1,439 / 68 files** pass. Both builds and all type checks pass. Full CLI
**608 / 44 files** passed in 337 seconds before the final callback guard tightening.
After that tightening, both packages were rebuilt. Final full framework
**1,439/68**, both generated production URL browser cases (**2 passed / 26 skipped**),
root TypeScript and all **11** package checks passed again. No owned test/build
process remains. The full CLI suite was not repeated after those final guards.
Initial focused failures came from a renderer mock classifying null as a template;
the tests now return its supported empty template. Type checking caught an omitted
resource loader argument and required serialized-state fields in a new fixture.
Those fixture declarations are corrected. No production type error was suppressed.

Limits: framework context recovery cannot undo arbitrary application effects.
Nested components already removed by DOM teardown are not revived. Next add
partial-DOM recovery acceptance, preserving nested drafts through new owners and
keeping transient layout scopes alive until renderer descendants retire. Then
finish changed/nested ownership, interrupted same-URL history, backend read counts,
scroll/fragment/transition diagnostics and the original acceptance audit.
All **58 original IDs** remain: **22 checked / 36 unchecked**. No checkbox closes.
Versions stay 0.8.3 until REL-04. No live cloud or release-wide gate was run.

<a id="codex-draft-isolation-2026-10-03"></a>
## Codex draft target isolation (2026-10-03)

Author: **Codex**. Continued after `c80fef6`. New page proxies still wrapped
outgoing raw draft targets. A saved proxy or cleanup hook from the disposed page
could mutate the new draft, even though it no longer owned reactive updates.

Local draft capabilities now snapshot plain records, null-prototype records and
arrays as one graph. Cycles and aliases across fields survive. Sparse arrays,
symbol/non-enumerable data properties, descriptors and non-extensibility survive.
Native objects, authored class instances and functions retain identity as opaque
references. Their own mutable contents and external effects are not isolated.
File identity still survives real navigation. No JSON serialization is involved.

Accessors inside draft records fail with COSSACK_NAVIGATION_DRAFT_ACCESSOR before
publication and without executing the getter. The error identifies the field and
suggests moving computed getters onto the component. The existing navigation
failure path preserves the old page, URL and global SSR state in this case.
Public URL-state documentation and migration guidance explain the shape contract.

Four snapshot tests cover graph ownership, data attributes, native identity and
accessor rejection. Component tests cover both transfer paths, old saved proxies,
and cleanup-time mutation. A framework test checks snapshot failure before live
publication. Both actual production browser fixtures now retain an old proxy,
navigate, write through it, force a new-owner render and verify the draft stays
unchanged. This forces rendering so stale DOM cannot hide shared-target corruption.
The existing File, query, resource, draft and history matrix still passes.

Final verification:

- Full core: **1,420 tests / 84 files**. The first focused run exposed the existing
  proxy predicate excluding null-prototype records. Snapshot handling now includes
  those records explicitly; final graph and full-suite tests pass.
- Full framework: **1,435 / 68 files**, including failure-before-publication.
- Generated production Node/native workerd URL tests: **2 passed / 26 skipped**.
  Command: `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js
  -t 'parses and navigates typed URL state'`.
- Core/framework ESM and declaration builds, framework SSG, root `pnpm tsc --noEmit`
  and `pnpm typecheck` for all **11 packages** pass. Consumer checks ran after builds.
- JS syntax, owned whitespace and exact release ID/order/state checks pass.
  Full CLI was not rerun; the previous full CLI result belongs to its checkpoint.

All **58 original IDs** remain: **22 checked / 36 unchecked**. No checkbox closes.
RT-08/RT-09 still require shared-render and post-publication recovery, interrupted
history, changed/nested owners, backend read counts and diagnostics acceptance.
Versions stay 0.8.3 until REL-04. No owned test/build process remains.

<a id="codex-staged-navigation-2026-10-03"></a>
## Codex staged navigation review (2026-10-03)

Author: **Codex**. Continued after `2aa46fb`. Page bootstrap previously ran
inside the serialized commit queue after destroying the old page. A stalled
bootstrap blocked newer navigation, and failure left the live tree partially
replaced before the destination was ready.

Preparation now resolves modules and bootstraps new page/layout instances before
joining the commit queue. Core's internal stageNavigation option defers task
execution, transport connections, shared service request binding and mount hooks.
The committed page/layout map and global SSR state remain active during this
phase. Failed or canceled preparation disposes its new owners. New scopes are
also disposed if component construction fails. Reactive updates from unpublished
components cannot render the active tree.

Publication adopts the latest same-owner ClientState/ClientStore capability,
including edits made while preparation waited, before running tasks and mount
hooks. Preparation does not share the outgoing draft through an early restore.
Declared native File identity stays intact. Retained layouts keep their services
and adopt destination resources at publication. Outgoing layout scopes retire
after DOM reconciliation. Loading content no longer destroys the committed page.

NavigationOwner races asynchronous guards, fetch, module/bootstrap preparation,
commit queue and transition completion against supersession and a 30-second
budget. Timeout reports COSSACK_NAVIGATION_TIMEOUT and revokes publication.
Independent fetch readers retain their separate response deadline and shared
request ownership. History recovery retains its separate two-second limit.
Ignored application promises have rejection handlers even after ownership ends.

New core tests cover delayed activation, abandoned stages, exactly-once activation,
service binding and edits made during preparation. The existing race test now
requires the newer navigation to complete before releasing the old bootstrap.
New navigation tests cover preparation failure, stalled guard/bootstrap/module/
transition deadlines, retry and a late transition callback rejected before
publication. The old response-timeout assertion changed to the earlier navigation
budget's code; its first run was the only focused navigation failure.

Final verification: full core **1,415 tests / 83 files**; final full framework
**1,434 / 68 files**; full CLI **608 / 44 files** (339 seconds, maxWorkers=2).
Total: **3,457 tests**. Core and framework ESM/declaration builds, framework SSG,
root TypeScript and all **11** package checks pass. Consumer checks use completed
builds. The full CLI run includes generated production Node/native workerd query,
history, scoped-service, stream, database and build acceptance. No live cloud
operation or complete 0.9.0 release gate was run. No owned test/build process remains.

Limits: this stages preparation and bounds framework waits. It cannot undo
arbitrary user effects once publication, mount or render has started. Shared App
render state and interrupted publication still need explicit recovery acceptance.
Transferred raw store targets also need a late-write audit for disposed owners.
Changed/nested ownership, interrupted history, actual backend read counts,
scroll/fragment/transition diagnostics and the full criterion audit remain open.
All **58 original IDs** remain in scope: **22 checked / 36 unchecked**. RT-08 and
RT-09 remain open. Versions stay 0.8.3 until REL-04.

<a id="codex-fetch-ownership-2026-10-03"></a>
## Codex navigation fetch ownership (2026-10-03)

Author: **Codex**. Continued after `b0da7d0`. A superseded navigation previously
waited for its old response/body indefinitely. The deduplication map could not
abort one reader without also affecting another reader of the shared request.

SharedPageRequests now tracks independent readers and one network controller.
A newer navigation releases its old reader immediately. The last reader leaving
aborts the fetch/body. Each reader gets a 30-second deadline. The existing error
flow reports COSSACK_NAVIGATION_FETCH_TIMEOUT and permits handled failures to
retry. Cache invalidation detaches old entries without canceling their current
readers. Identity checks keep old completion from removing a replacement entry.
Cache epoch checks remain intact. Aborted work checks ownership after fetch and
body completion, before parsing, module preloading or cache publication.

Six request-owner tests cover shared prefetch survival, ignored abort and late
rejection, independent deadlines, detached invalidation, already aborted callers,
and synchronous failures/retry/timer cleanup. Two real navigation tests cover a
stalled body that settles as superseded before release, rejected stale cache
publication, and body timeout with failure reporting and retry. These are
controlled tests, not evidence that arbitrary application I/O stops on abort.

Final verification:

- Full framework: `pnpm --filter @cossackframework/framework exec vitest run`,
  **1,426 tests / 67 files**, including all eight new tests.
- `pnpm --filter @cossackframework/framework build`: ESM, declarations and SSG pass.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11 packages** pass.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js
  -t 'parses and navigates typed URL state'`: **2 passed / 26 skipped**. Actual
  generated production Node and native workerd browsers retain their query,
  draft, guarded history, failed traversal and held-response behavior.

Consumer tests ran after the build. No full core/CLI suite or release-wide gate
was rerun. Public documentation describes the response deadline and its limits.
All **58 original IDs**, order and states remain unchanged: **22 checked / 36 open**.
RT-08/RT-09 remain open. Next implement a whole-navigation owner and stage new
components before publication. Guards, imports, bootstrap, render and transitions
still lack a shared bound. Versions stay 0.8.3 until REL-04.

<a id="codex-terminal-disposal-2026-10-03"></a>
## Codex terminal disposal review (2026-10-03)

Author: **Codex**. Reviewed the lifecycle prerequisites for navigation staging
from `7b40e71`. Bootstrap could resume after destroy(), open a transport, mount,
and restore a live phase from the lifecycle stack. A later destroy then repeated
cleanup. Server get/init had the same phase restoration problem across awaits.

Phase restoration now preserves terminal disposal and discards saved phases.
Bootstrap and connectedCallback return immediately for destroyed components.
Bootstrap checks disposal after task scheduling, server get/init, DOM mount and
onMount. Its finally block clears the bootstrapping flag on every exit.

Eight new cases cover an already destroyed instance, disposal at the bootstrap
microtask boundary for HTTP/SSE/WebSocket pages, synchronous task disposal,
onMount disposal before clientInit, and disposal while server get/init awaits.
They verify no late activation, no render or rebootstrap after disposal, and
exactly one cleanup. An initial test run had four failures from fixture assumptions: the mock
renderer does not bind inherited task methods, and a socket legitimately starts
before onMount. Direct fixture declarations and boundary-specific assertions
corrected those assumptions. All final checks pass:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,412 tests / 83 files**.
- `pnpm --filter @cossackframework/core build`: ESM and declarations pass.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1,418 / 66 files**.
- `pnpm tsc --noEmit` and `pnpm typecheck`: root and all **11 packages** pass.

Consumer checks ran after the core build. CLI/native browser suites were not
rerun. No release-wide acceptance or navigation deadline claim follows from
these lifecycle tests. Standard async Tasks run in the background already.
Staging tests must explicitly hold a bootstrap override to prove commit queue
independence. Arbitrary application I/O can continue after disposal.

All **58 original IDs** and their order remain unchanged: **22 checked / 36 open**.
RT-08 and RT-09 stay open. Continue the detailed plan for owned cancellation,
staged publication, retained service contexts, draft edits during staging,
interrupted history and the remaining acceptance matrix. Versions stay 0.8.3.

<a id="codex-pending-history-2026-10-03"></a>
### Codex checkpoint: pending history and module preflight (2026-10-03)

Author: Codex. Continued after `f53961e`. No checkbox closes. The original 58 IDs
remain: 22 checked, 36 unchecked. RT-08/RT-09 are still open. Read the
[criterion audit and next steps](./release-0.9.0-plan.md#rt-08),
[navigation completion work](./release-0.9.0-plan.md#rt-09),
[guard contract](../docs/prevent-navigation.md#guards-during-back-and-forward)
and [Codex handoff](./handoff-0.9.0.md).

Fixed canceled browser traversal leaving the address and visible page at different
queries. Framework history entries now carry an app group/position while retaining
scroll and application state. A guard restores the entry it left. The restoration
popstate does not run guards or fetch again. Confirmation resumes the original
entry without pushing history. Failed fetches or module imports restore the prior
owned entry before error reporting. Unknown positions are not invented. A missing
restoration event fails after two seconds with
COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED; this is only a history-movement bound.
Ownership tokens use getRandomValues so ordinary HTTP browser hydration does not
require secure-context-only crypto.randomUUID.

All requested page/layout imports now resolve before live context/resource/tree
changes and window.__INITIAL_STATE__ publication. A superseded module fails a
sequence check before creating a stale owner. Superseded bootstrap skips the
final framework render. This does not make arbitrary bootstrap or rendering
side effects atomic, cancel application I/O or release a stalled commit queue.

Both generated production Node and native workerd browser fixtures now verify
blocked back, restoration and confirmation of the original entry, preserved
application history state, failed back fetch, and back/replace/forward while an
old actual SSR query response remains held. Declared page/File/layout/service
drafts survive; a later query patch uses the restored query and excludes the
abandoned pending field. Matching resources make zero extra hydration RPCs.
Controlled cases delay page/layout imports, check unpublished SSR state, exercise
history restoration/confirmation and bound a missing restoration event.

Final verification:

- Core build and framework declaration/runtime output builds passed before the
  consumer checks. Generated browser cases build actual client/server artifacts.
- `pnpm tsc --noEmit` and `pnpm typecheck` passed; all 11 package checks passed
  again after the final HTTP-compatible history-token change.
- Full core suite: 1,404 tests in 83 files.
- Final full framework suite: 1,418 tests in 66 files. New cases include guarded
  restoration/confirmation, failed traversal, missing-event timeout, delayed
  page/layout imports and hydration without crypto.randomUUID.
- Full CLI suite: 608 tests in 44 files. Command:
  `pnpm --filter cossack exec vitest run --maxWorkers=2`.
  This includes the wider generated Node/native workerd runtime and retained
  service acceptance that failed at the preceding checkpoint before correction.
- After rebuilding the final HTTP-compatible token change, both production URL
  browser cases passed again using `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state' --maxWorkers=1`.
  The three full suites total 3,430 tests; the focused rerun is already included
  in that count, not counted again.
- All four TypeScript examples from the URL-state/navigation guides compiled
  through published exports. Fixture syntax and owned whitespace checks passed.
- All original checklist IDs/order/states remain unchanged: 58 IDs, 22 checked,
  36 unchecked. The seven touched guides/specs have 400 valid local links/anchors.
- No owned build/test process remains. User-owned reports.md/.zcodeignore stay
  excluded from this checkpoint.

Continue RT-08 with changed/nested ownership, actual backend read counts, staged
bootstrap/render/transition acceptance and a criterion audit. RT-09 still needs
owned cancellation/deadlines and a staged tree that lets newer navigation proceed
past a stalled old bootstrap, plus its larger cache/scroll/diagnostic matrix.
Versions remain 0.8.3 until REL-04. No live deployment or publication occurred.

<a id="codex-query-ownership-2026-10-03"></a>
### Codex checkpoint: query ownership review (2026-10-03)

Author: Codex. Continued after `c133495`. No checklist item closes: all 58 IDs
remain, with 22 checked and 36 unchecked. RT-08 is still open. Read the
[updated criterion audit and four next steps](./release-0.9.0-plan.md#rt-08),
[Codex handoff](./handoff-0.9.0.md), [public guide](../docs/url-state.md),
and [migration notes](./migration-0.9.0.md#browser-query-context-and-history).

Fixed the next query integration gaps:

- Typed updateUrlState merges patches against live pending intent in the existing
  navigation owner. Committed readers and address remain unchanged during fetch.
  Guards, failures, disposal and ordinary navigation clear ownership. Later
  patches cannot inherit a disposed owner's abandoned fields.
- Same-page replacement preserves inherited declared ClientState/ClientStore
  values through a local, single-use, class-bound capability. Raw store targets
  receive new owner proxies; File identity survives. SSR internal JSON cannot
  supply drafts. Public state still comes from SSR. Unrelated pages reset drafts.
- Query changes skip the destructive loading component swap. Drafts edited while
  fetching transfer at commit. Browser file-input DOM values do not restore.
- Retained App/layout resources adopt matching SSR entries before query changes.
  Map identity prevents old pending loads from publishing values/errors. Layout
  drafts/services remain. Parent scope, user, runtime, scope/provider and layout
  transport changes invalidate retention. A child page's transport change does
  not invalidate its shared layout's services or pending calls.

Both generated Node and native workerd browsers verify copied query URLs,
Unicode, defaults, ordinary history and replace, native File/page/layout/service
local state, copied-tab isolation and unrelated-page reset. Rapid patches merge.
Guard prevention and a failed fetch leave the committed query intact. A held
actual SSR response lets the user edit a draft while fetching; a newer query
commits first and the late old response cannot overwrite it. Matching page and
retained-layout resources make zero extra hydration /crpc requests. Controlled
core cases also settle old resource values and exceptions after handoff.

The first production URL run used stale framework output and failed before
navigation. Rebuilding the public framework output resolved it. The broader CLI
run then exposed an ownership regression between SSE and HTTP child pages.
The layout identity initially used the page transport. It now uses the layout's
own transport, with a focused regression case and production re-verification.

Final verification:

- Core build and final framework declaration/runtime output build passed before
  the affected production checks. Native cases perform real application builds.
- `pnpm tsc --noEmit` passed. `pnpm typecheck` passed all 11 packages after
  the final ownership fix.
- Full core suite: 1,396 tests in 83 files. The final URL-state hydration and
  published-type fixtures were rerun: six tests passed, including all negative
  updater type cases.
- Final full framework suite: 1,412 tests in 66 files. This includes the new
  layout-transport regression and pending query ownership cases.
- Full CLI suite initially passed 606 of 608 tests in 44 files. Its two failures
  reproduced the same retained-layout service regression in production Node and
  native workerd acceptance. After the fix, both failing cases and both new URL
  production cases passed together: four tests in two files, 25 unrelated tests
  skipped. Command: `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js tests/generated-runtime-build.test.js -t 'builds a generated staging app|reconciles component and service mutations|parses and navigates typed URL state' --maxWorkers=2`.
  The entire CLI suite was not rerun after that focused correction.
- Both TypeScript examples in the revised URL-state guide compile through the
  published package exports. Fixture syntax and owned whitespace checks pass.
- All 58 original checklist IDs/order/states remain intact. The six touched
  guides/specs have 387 valid local documentation links and anchors.
- No owned build/test process remains. User-owned reports.md/.zcodeignore are
  excluded from the commit. No publication or live deployment was performed.

These fixtures do not prove pending back/forward/replace behavior, nested draft
ownership, every scope/transport change, one actual backend read or termination
of application I/O. Arbitrary module/bootstrap/transition failures are not yet
atomic or bounded. Those remain RT-08/RT-09 acceptance work. Continue all other
unchecked tasks and release gates. Versions remain 0.8.3 until REL-04.

<a id="codex-url-state-contracts-2026-10-03"></a>
### Codex checkpoint: typed query contracts and destination contexts (2026-10-03)

Author: Codex. Continued after `25eab9c`. No checkbox closes. The original
58 task IDs remain: 22 checked and 36 unchecked. RT-08 remains open. Read its
[criterion audit and next steps](./release-0.9.0-plan.md#rt-08),
[URL-state guide](../docs/url-state.md),
[migration notes](./migration-0.9.0.md#browser-query-context-and-history), and
[Codex handoff](./handoff-0.9.0.md).

Core now owns defineUrlState, inferred readonly values, UrlStateError and string,
number, integer, boolean, enum, array, optional and synchronous custom codecs.
The portable `/url-state` export has no framework or browser dependency.
Declarations and defaults are snapshots. Parsing uses strict percent/UTF-8
validation, rejects repeated scalars, resets invalid arrays as a whole and reports
field/code issues without query values. Total query bounds throw; field bounds
use declared defaults. Unsupported asynchronous callback results remain observed.
URL patches reject unknown keys, getters, sparse arrays and unsupported values.
Serialization sorts declared keys, omits defaults and retains unrelated encoded
pairs and fragments. Bare array keys distinguish an empty list from one empty
string. Published types reject variable/union extras and invalid custom codecs.

Cossack.urlState caches against the request or browser destination URL. SSR
metadata exposes the public path/query without its internal origin. Browser
bootstrap previously read the old window address before history committed.
Page, App and retained layouts now own the resolved destination. Initial
hydration retains the visible fragment. The production browser fixture first
caught its loss from fragment-free SSR metadata; the fix and both runtimes pass.
Navigation accepts explicit push/replace history. Replacement preserves other
history state, and existing guards and navigation outcomes still apply.

Actual generated Node and native workerd apps execute one shared filtered-page
fixture. Browsers verify copied Unicode/array URLs, invalid page defaults,
back/forward, replacement, preserved fragments and matching query-derived SSR
resources without extra hydration RPCs. Those cases do not prove local draft
preservation, overlapping query patches, retained-layout resource handoff or
stalled query transitions. Normal query navigation still recreates the page.
RT-08 remains open for those original criteria, and RT-09 retains bounded
navigation completion and its larger cache/scroll/transition/diagnostic matrix.

Final verification:

- Core build and framework declaration build passed before consumer checks.
  Generated applications passed actual client and server builds for both runtimes.
- `pnpm tsc --noEmit` passed. `pnpm typecheck` passed all 11 packages.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,391 tests in 82 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,406 tests in 66 files.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: 608 tests in 44 files.
  This includes both new production Node/native workerd browser cases and all
  existing generated runtime acceptance. The three suites total 3,405 tests.
- New core coverage includes 38 codec cases, three real browser-context cases,
  one real request-context case and one package-export fixture with 17 negative
  type cases. Framework adds two destination/history cases.
- Both TypeScript examples in the URL-state guide compiled separately through
  published exports. The portable entry imported and round-tripped Unicode.
- Review resolved the initial incomplete browser mock locations, the custom
  serializer's inference widening, the narrower navigation test type and the
  fixture's required server$ initial value. Final full suites above passed.
- Syntax, owned whitespace, original task ID/state audit and documentation links
  passed. No owned build or test process remains.

Continue the five concrete RT-08 steps in the plan and all other unchecked
CLI/runtime/service/Cloudflare/release tasks. RT-01/RT-11, plain Node Vite dev,
native Deno/Electron and final release gates remain open. Versions stay 0.8.3
until REL-04. User-owned reports.md/.zcodeignore are preserved. No push,
publication, live cloud changes, external messages or new chat occurred.

<a id="codex-route-boundaries-2026-10-03"></a>
### Codex completion: typed routes and source boundaries (2026-10-03)

Author: Codex. Continued after `b82ba4b` against the original RT-07 criteria.
RT-07 is newly checked. The ledger retains all 58 original task IDs:
22 checked and 36 unchecked. Read the
[criterion audit and implementation context](./release-0.9.0-plan.md#rt-07),
[boundary guide](../docs/routing.md#unknown-urls-and-boundary-identity), and
[migration notes](./migration-0.9.0.md#file-routes-and-boundary-identities).

The new real Node fixture first reproduced the defect: a grouped/dynamic
unknown URL selected the root 404 and omitted its source middleware. Selection
now compiles effective source branches once, retains decoded parameters and
falls back to common ancestry for equally ranked disjoint groups. Boundaries
retain distinct source IDs and stay out of public URL maps. SSR and browser
hydration select the same component. Valid 404/500 documents render during
navigation without entering the successful-page cache. Plain or mismatched
error documents still fail navigation.

Boundary rendering now applies actual layout/page policies and PageOptions.
A request-owned source/index token prevents repeated policies during fallthrough
or error rendering. Short-circuit guards and after-next headers remain intact.
Real HTTP traces prove one global scope and exact layout/page order. CLI source
IDs, middleware counts and source stacks match executed boundary state.
Boundary explanations accept exact source files and reject public aliases.

PageOptions.route never registered a URL and had no in-repository callers.
Its removal has two published negative type cases, three decorator runtime cases
and two compiler inspection cases. The getter case proves no value execution.
File placement remains the URL contract. Import/default aliases remain supported.

Final verification:

- Core full build and framework full build, including SSG, passed after the
  runtime changes. Builds finished before consumer test suites started.
- `pnpm tsc --noEmit` passed. `pnpm typecheck` passed all 11 packages.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,348 tests in 78 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,404 tests in 66 files.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: 606 tests in 44 files.
  This includes both new generated Node/native workerd fixtures, the final
  middleware inspection comparisons, API contracts and existing production gates.
- The focused production boundary run passed both runtimes before the final
  inspection assertions. Each runtime covers nine unknown URLs, unsupported
  POST fallthrough, 500 error selection, guard denial/allowance, and real browser
  initial hydration, SPA navigation, history and interactive component identity.
- Seventeen pure resolver cases cover ancestry, ambiguity, namespace ownership,
  encoded parameters, malformed escapes and unique nonaddressable source IDs.
  Six navigation cases cover valid documents, identity mismatches and cache rules.
- One CLI inspection case exceeded its five-second deadline when it ran beside
  both full unit suites. The final complete CLI run above passed it unchanged.
- Syntax, whitespace, original task ID/state audit and local documentation links
  passed. The new boundary inspection command runs in direct CLI tests.

This closes the RT-07 criteria only. It does not certify live deployment,
REL-03, native Deno/Electron, incoming disconnect handling or session guarantees.
Versions remain 0.8.3 until REL-04. User-owned reports.md/.zcodeignore are preserved.
No push, publication, live cloud changes, external messages or new chat occurred.
Continue RT-08 and all other 36 unchecked tasks from the detailed plan.

<a id="codex-api-contracts-2026-10-03"></a>
### Codex checkpoint: native API contracts and generated declarations (2026-10-03)

**Author: Codex.** Continued after `7f4ce93` against RT-07.
**21/58 checked, 37 unchecked. RT-07 remains open. No new checkbox closes.**
The [detailed checkpoint](./release-0.9.0-plan.md#rt-07) gives the implementation,
criterion status and the next steps for GLM.

`defineApi` at framework `/api` adds explicit params/query/body schemas and
inferred parsed authorization/handler inputs. Parsing precedes authorization
and mutation. JSON output validates and serializes to wire types; native mode
requires Response and preserves cookies, redirects, status and streams.
Review reproduced discarded context cookies and duplicate native cookie values.
The wrapper now merges those cookies through Hono's finalization exactly once.
The final review also prevents a single explicit generic from erasing output
types, rejects null contract configuration, reports mutable exports unknown,
and checks elapsed time before accepting a late native body.

JSON input reads actual bounded bytes with fatal UTF-8, independent of a claimed
Content-Length. Readers release on errors and deadlines even when source cancel
never resolves. Query arrays are explicit and repeated scalar keys reject.
Abort/deadline owns every asynchronous pipeline phase until headers. Ignored
callbacks remain observed and late native bodies cancelled. Native stream
lifetime, application I/O termination and rollback remain application concerns.
Unexpected callback/output failures retain private diagnostics. Expected public
failures have stable codes, nested location fields and correlated IDs.

The shared compiler inspects canonical factory imports, namespace/const aliases
and default export aliases. Security stubs private API modules before imports
load. CLI apiContracts facts have effective methods/source lines and explicit
unknown dynamic contracts. Generated ApiRequest/ApiResponse use type-only actual
exports from the shared structural route model; no private modules enter runtime
client output. Native default functions use method '*'. Unvalidated handlers and
class modules do not invent validated input/output guarantees.

New acceptance includes 29 controlled runtime cases, 16 AST/security cases, a
published declaration fixture with 16 negative examples, and actual generated
Node/native workerd apps. Both generated imports type-check with six negative
examples. The shared request matrix covers coercion/Unicode, validation, malformed
JSON, wrong media, authorization, cookies/redirects, output privacy and deadlines.
Actual workerd/D1 proves zero mutations after malformed or unauthorized requests
and exactly one after valid input. Client assets lack private sentinels and SQL.

Final verification:

- Framework full build (including SSG) passed before the final API adjustments;
  the final `build:types` passed afterward. Published entries resolve in both
  real generated production builds.
- `pnpm tsc --noEmit` passed. Final `pnpm typecheck` passed all 11 packages.
- Full framework Vitest: **1,379/64 files**, including all new API suites.
- Focused real Node/workerd API suite: **2/2**, 22 existing cases skipped.
- Full CLI regression: **603/44 files** passed before the final elapsed-time
  and mutable-export checks. After those changes, both actual production API
  cases and all three functional module CLI cases passed again (**5/5**, 39
  unrelated cases skipped). The final declaration default/config-null correction
  has focused published/runtime acceptance below.
- After the final generic-default and null-configuration corrections, all four
  targeted framework suites passed (**52/4 files**) and both real generated
  Node/native Worker API cases passed again (**2/2**, 22 unrelated cases skipped).
  The final root/all-package type checks and declaration build also passed.
- JavaScript syntax, original task ledger, local links and owned whitespace
  checks passed. Both new API guide examples also type-check through published
  exports. There is no live deployment or final REL-03 certification claim.

These are local production/native tests, not a live deployment or full release
certification. No original RT-07 boundary criterion is dropped: grouped/dynamic
unknown-URL 404 selection and PageOptions.route remain open. RT-01/RT-11, plain
Node Vite development, native Deno/Electron and every other REL gate are separate.
Versions remain 0.8.3. User-owned reports.md/.zcodeignore remain untouched.
No push, publication, live cloud changes or external messages.

<a id="codex-typed-routes-2026-10-03"></a>
### Codex checkpoint: generated typed URLs and shared route discovery (2026-10-03)

**Author: Codex.** Continued after `d3b8c5b` against the original RT-07 plan.
**21/58 checked, 37 unchecked. No new checkbox closes. RT-07 stays open.**
The remaining API and boundary work appears in the
[detailed checkpoint](./release-0.9.0-plan.md#rt-07).

Review found duplicated CLI URL conversion and a discovery walk that included
co-located tests/declarations and differed on Markdown. Framework `route-codegen`
now owns that Node-only walk. Vite and CLI use the same structural manifest,
component IDs, source layout ancestry and nearest source boundary helper.
Layout/loading globs use the same exclusions. Vite uses its resolved root for
generation, warnings and output, independent of shell working directory.

Core's `/routes` entry owns portable construction and parameter types. Generated
`.cossack/routes.ts` contains public patterns and the core helper. It imports no
application modules. `virtual:cossack-routes` resolves to that actual TypeScript
file. New recipes provide its path mapping, ignore it and generate before checks.
`cossack routes --generate` supports machine output and read-only dry runs.
Ordinary inspection writes nothing. Authored files at the compiler path reject
replacement. Unchanged contracts keep their modification time. Watcher listeners
update additions/deletions and release at server shutdown.

The 35-case core suite includes actual Hono requests and published package
resolution with **16 negative type cases**. Missing, extra, incorrect and erased
contracts reject. Arguments retain union keys before checks. The runtime rejects
sparse/accessor-backed arrays, getters, invalid Unicode and dot segments. It
encodes Unicode, slashes and reserved characters without replacement expansion.
Six compiler cases cover discovery, ancestry, precedence, conflicts, writes,
resolved root and watcher ownership. CLI cases prove validation and output.

Production Node/browser acceptance compares Vite and CLI manifests, deletes the
generated file, regenerates through the actual CLI and type-checks its virtual
import. Aliased default/decorator components execute grouped dynamic pages and
catch-alls. Root/group/page middleware execution matches the inspected source
order. Functional grouped APIs have no component layout stack. Class APIs invoke
the actual `init` alias. The nearest grouped error and root 404 render, and client
assets contain neither private error text nor the Node generator dependency.

Two concrete routing defects were fixed. Node's outer Hono mounting discarded
custom not-found handling. The generated entry now delegates after static assets.
Functional API registration used raw source directories, so API files inside
route groups were omitted. Registration, capability checks and CLI classification
now use the public pattern. Ordinary `/api-products` stays a page.

Final verification:

- `pnpm --filter @cossackframework/core run build` passed.
- `pnpm --filter @cossackframework/framework run build` passed, including SSG.
- `pnpm tsc --noEmit` and `pnpm typecheck` passed all 11 package checks.
- Core Vitest: **1,345/77 files**. Framework Vitest: **1,333/61 files**.
- Scaffold Vitest: **108/4 files**.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: **599/601 passed**
  before the test-bound fix. All 22 generated production cases and the native
  Worker/peer regressions passed. Two CLI inspection tests exceeded five seconds.
- The unchanged isolated CLI machine matrix passed **43/43** before the bound fix.
- After the fix, `pnpm --filter cossack exec vitest run
  tests/cli-json-matrix.test.js tests/generated-runtime-build.test.js -t
  'cloudflare hides vars|generates typed URLs' --maxWorkers=2` passed **3/3**.
  This reruns both affected inspection cases beside the actual new production app.
- JavaScript syntax, local document links, original task ledger and
  `git diff --check -- . ':!reports.md'` passed.

The initial unrestricted CLI run also passed 598/600 before the final API-prefix
case was added. Reducing workers still left the same two test timeouts. Each
case starts two CLI subprocesses with individual twenty-second deadlines. Their
explicit test bound is now forty-five seconds. Assertions and command deadlines
are unchanged. The focused rerun passed both cases under an actual Vite build.
The entire CLI command was not repeated after this test-only bound change.
No unresolved failure remains from those runs, but this is not a final REL-03 audit.

This checkpoint does not declare native API input/output schemas. The grouped
unknown-URL 404 case and unused `PageOptions.route` declaration still need their
explicit acceptance/decision. Source ancestry alone does not prove unknown-URL
selection. Existing native Worker/D1 suites are regressions, not new native typed
API coverage. Node Vite development, RT-01/RT-11, native Deno/Electron and the
full release gates remain separate. Versions stay 0.8.3. Preserve user-owned
reports.md/.zcodeignore. No push/publication/live-cloud changes or external messages.

<a id="codex-schema-migration-2026-10-03"></a>
### Codex checkpoint: schema-only actions, function fields and private callbacks (2026-10-03)

**Author: Codex.** Continued after `cd478f4` against the original RT-02 criteria.
Only RT-02 newly closes: **17/58 checked, 41 unchecked**. The complete 58-task
plan remains in scope; see its [criterion audit](./release-0.9.0-plan.md#rt-02).

Action input metadata now accepts schemas only. Plain maps reject in public
types and stale JavaScript metadata fails before callbacks or mutation. Form
rule maps retain their existing API. Direct and typed-channel Server decorators
check public function fields, including arrow and generator functions, while
preserving their native return type. Parsed `InputOf` parameters remain the
authored browser/native signature; `RawInputOf` describes boundary values.
Forms normalize values before calls; native APIs explicitly parse/authorize.
JSON date fields need explicit date coercion. The migration and validation
guides now reflect those decisions and the completed resource kit.

Review found two compiler cases: type-only siblings incorrectly kept a private
contract module live, and separate inline type-only imports could preserve an
empty runtime import with verbatim module syntax. Only imports from detached
private modules are normalized; unrelated initializer imports retain their
behavior. Names/aliases come from AST spans, including commented inline types.
Four regressions check actual emitted JS with `verbatimModuleSyntax: true`;
native chunks exclude both private schema/policy sentinels and record SQL.

Review also reproduced exception leakage in **eight failing transport tests**:
a callback's `ClientVisibleError` reached the caller as a public message.
Refinements, structural authorizers and auth-owned lookups/rules now wrap
unexpected exceptions in private errors, retaining `cause` for server logs.
Public validation/HTTP error classes cannot leak their fields, messages, stack
or response through these callbacks. Expected `false` validation/policy decisions
and normalized kit denials retain their error paths. Deliberate public errors
in an action body remain public.

Verified evidence:

- Core: **1,095 tests / 63 files**. Parsed/raw schema and authorizer inference,
  public field negatives, plain-map rejection, cancellation and internal causes.
- Framework: **1,314 tests / 57 files**. Matrix **472**, existing compiler suite
  **167**, plus the policy compiler suite. Method/function-field validation,
  stale metadata refusal and public exception classes are covered across all
  matrix transport/service paths; multipart guards remain covered separately.
- Auth: **145 tests / 8 files**. Policy/lookup exception causes and HTTP middleware
  rejection prevent writes without forwarding a thrown HTTP exception.
- Final generated Node production/browser tests: **2 selected cases pass**, with
  **12 skipped**. Authored/public-export types, HTTP/SSE page/service generator
  fields, multipart schemas and the mutation form's failure/retry flow pass.
- Final native workerd acceptance: **2 tests / 2 files pass** sequentially after
  rebuilding the final compiler exports. Generated staging exercises scalar and
  nested/refinement/enum/literal/optional/null/Date/File guards on HTTP/SSE page
  and service JSON/multipart fields, actual D1 record/audit stability on rejection,
  private public-class exceptions, stream values and browser failure/recovery.
  Native socket cases check parsed fields, nested errors, private exceptions,
  explicit signal abort, no later mutation/terminal reply and successor progress.
  The complete final native run takes about **100 seconds** of test execution.
- Final sequential core/framework builds, root `pnpm tsc --noEmit`, all **11**
  `pnpm typecheck` package configurations and owned-file whitespace checks pass.

Intermediate failures are not final acceptance: the compiler privacy regression
first rejected a type-only sibling module, the initial socket cancellation test
incorrectly awaited a server terminal reply, one fixture cast and a top-level
Oxc option failed TypeScript, and public callback error tests exposed the leak.
The socket fixture now checks native signal abort, suppressed later terminal
frames, unchanged count and successor progress; client cancellation settles
locally. The expanded staging suite reached browser checks but exceeded its old
90-second limit twice, then completed successfully in **91 seconds** with the
larger overall budget. The complete test now permits **180 seconds**, while its
explicit cancellation signal remains **500 ms**. Temporary diagnostic logging
has been removed. This proves explicit cancellation, not native incoming
pre-header disconnect delivery or rollback of ignored application I/O.

Next: finish the remaining RT-03 typed resource/lifecycle criteria with RT-05
task ownership, then continue all unchecked tasks. RT-01's arbitrary action
deadlines/init/restoration/disconnect work, RT-11 session freshness and all final
release gates remain open. RT-07 still owns native API schema declarations and
error response integration; explicit native parsing owns its error mapping.
No full CLI/monorepo/tarball/Deno/Electron release
audit is claimed. Versions remain **0.8.3** until REL-04; no publication or live
deployment occurred.

<a id="codex-resource-policies-2026-10-03"></a>
### Codex checkpoint: typed resource policies and trusted action identity (2026-10-03)

**Author: Codex.** Continued after `49d3236`. Only RT-14 closes on its original
[criterion audit](./release-0.9.0-plan.md#rt-14): **16/58 checked, 42 unchecked**;
all 58 IDs remain. RT-02 migration/native schema work, RT-01 transport deadlines
and disconnect delivery, RT-11 session freshness and later release gates stay open.

Auth now exports `createResourcePolicy<Resource, User>()(rules)` with named action
inference, application-owned record lookup, imperative/API/middleware enforcement
and frozen boolean permissions for UI. Core has an independent structural
`@Server({ authorize })` callback over parsed input, trusted request context and
owned signal. The two router gates and socket dispatch run it before invocation;
forwarded services use their declaring metadata. Direct and typed-channel Server
decorators retain parsed input/authorizer/channel inference. Native internal/API
method calls still require explicit checks; metadata does not wrap them.

Expected denials have fixed 401/403 codes/messages and request IDs. Input owner,
user, tenant and permission state cannot replace lookup or the authenticated
request/socket actor. Nonboolean/malformed metadata and backend exceptions remain
private internal failures. Redaction does not execute arbitrary exception getters.
Cancellation releases stuck lookup/policy ownership, observes late failures and
skips later mutation, without terminating ignored I/O or rolling back callbacks.

Review found Hono private-field getter/method/response-setter calls were using a
proxy receiver. Core's context proxy now preserves the original receiver through
nested socket proxies, verified by real-Hono and native socket tests. Compiler
stripping removes authorization metadata, private transitive callbacks/imports
and dead dependencies used only by server read loaders. Shared client helpers
survive. Static typed-decorator factory, namespace, result and destructured aliases
receive the same classification/stripping. Private contracts retained by exports,
client code or foreign module initializers fail closed.

Verified evidence:

- Core: **1,095 tests / 63 files**. Typed authorizer/channel inference, exact
  service metadata, trusted socket actor over a stale context user, strict
  decision/cancellation/error redaction and native Hono response receivers.
- Framework: **1,294 tests / 57 files**. Matrix **456** covers policy with parsed
  input through HTTP/SSE/component/service/socket/multipart. Separate API/SSR
  tests exercise one kit, request IDs, record reads and permission visibility.
  Policy compiler **11** plus the existing compiler **163** pass.
- Auth: **143 tests / 8 files**, including standalone action/resource/permission
  type negatives, boolean projections, middleware, cancellation and private
  lookup/policy errors. Auth's published main remains its source entry.
- Two affected generated Node production/browser tests pass in separate targeted
  runs: inferred client RPC/upload views and mutation/resource failure recovery.
  Each skipped the other 13 generated cases. No full CLI run is claimed.
- Native workerd staging and socket acceptance: **2 tests / 2 files** pass
  sequentially after final fixture corrections. Published auth/core exports and
  actual D1 records prove owned writes, cross-owner/cross-tenant/anonymous/missing
  denials, forged payload/state rejection and unchanged record versions/audit
  rows on denial through JSON/multipart page/services. Browser HTTP/SSE edits and
  server-derived permission controls pass; API/SSR reads share the kit. Native
  socket peer/reconstruction cases deny forged identity/state without mutation.
  Client chunks contain neither private policy sentinel nor record SQL.
  A second complete staging run passes after the final request/reply body fixes.
- Sequential core/framework declaration builds, root `pnpm tsc --noEmit`, all
  **11** package typecheck configurations and owned-file whitespace checks pass.

Intermediate failures are retained as evidence, not counted as final passes.
The first matrix run failed on a fixture's absent environment and Hono's receiver
defect; both are fixed. Type runs caught factory overload, UUID, fixture dependency,
test environment and optional-param mistakes; final inference/config checks pass.
The first D1 fixture used the wrong write-result member; the correct field is
`result.meta.rowsAffected`. Earlier native runs reached policy checks but had
intermittent lost/empty responses around a test API that ignored its POST body;
merely reading response bodies did not resolve it. The API now owns JSON request
parsing, ignores submitted permission flags, and tests consume/assert every new
reply before audit reads. An empty success request was corrected to `{}`. Final
native verification includes full denial envelopes, not status-only assertions.
This does not claim the broader RT-01 native early-response/disconnect guarantees.

Next: [RT-02 migration/native acceptance](./release-0.9.0-plan.md#rt-02), then the
remaining original plan. Do not reimplement completed RT-14, discard unchecked
tasks or treat these tests as full release acceptance. Versions remain **0.8.3**
until REL-04; no publication, live deployment or cloud resource changes occurred.

<a id="codex-typed-input-2026-10-03"></a>
### Codex checkpoint: typed input and private validator dependencies (2026-10-03)

**Author: Codex.** Continued after `fb927cb` against the original RT-02/RT-14
criteria. **No checkbox closes: 15/58 checked, 43 unchecked; all 58 IDs retained.**
RT-02 now has a concrete typed-input implementation, but shared resource-policy
enforcement remains unfinished. RT-14 stays open.

The prior plain-map contract supplied no schema inference and preserved unknown
keys/extra arguments. New `input` builders infer parsed/raw types, normalize
strict primitive coercions, clone objects/arrays, define optional/null behavior,
and validate nested arrays, enum/literal choices, canonical UTC dates and actual
uploaded Files. Unknown keys reject unless stripping is explicit. Typed contracts
accept one argument. Parsing bounds visits/depth/fields/items/errors and rejects
prototype/accessor/cyclic inputs. Plain maps remain transitional with their old
semantics, explicitly tested and documented; they do not gain these guarantees.

Review found ClientVisibleError rewrote subclasses' prototypes, so validation
errors failed their own instanceof checks. Its constructor now preserves
new.target.prototype. Explicit malformed input metadata previously disappeared
through a truthiness check; it now fails privately before the method runs.

The shared gate passes owned request signals into parsing for component,
forwarded-service, explicit-service and socket actions. Aborted async refinements
release framework ownership before uncooperative callbacks finish, skip later
checks/mutation, and keep late failures observed. Callbacks can use the signal
for cooperative I/O. False creates a field error; exceptions and nonboolean
results stay internal. HTTP cancellation returns 499 with its request ID;
WebSocket calls retain their correlated cancellation protocol. This does not
add arbitrary application deadlines or roll back callback side effects.

Client stripping now follows private module declarations after removing input
metadata, including callback/constants/imports and destructured declarations.
Type-only uses and unrelated local bindings do not retain private code. A
contract exported or still runtime reachable fails the build. Destructured
siblings share removal/liveness. A foreign contract module retained by another
client import also fails, because its initializers cannot be stripped here.
Unsupported private runtime TS enum/namespace/import-equals dependencies fail
rather than emit unstripped initializers. Shared storeRules maps remain suitable
for client forms; the generated mutation recipe uses a separate private schema.

Verified evidence:

- Final core suite: **1,080 tests / 62 files**, including published-declaration
  inference/native-signature negatives, typed parser and forwarded socket guards.
- Final framework suite: **1,243 tests / 55 files**. Shared transport matrix:
  **421** cases; final compiler suite: **163**. Component/explicit-service
  HTTP/SSE/socket and multipart cases cover normalized types, nested errors,
  unknown keys, array/file forgery, excess arguments, internal exceptions,
  cancellation, correlation and no mutation. Router forwarded-service tests use
  typed schemas as well.
- Scaffold: **108 tests / 4 files**, including the updated mutation composition.
- CLI generated/runtime plus deployment acceptance: **15 tests / 2 files**
  (all 14 generated cases and the native workerd staging fixture) after converting
  file actions to schemas. Native HTTP/SSE page/service uploads reject unknown
  fields, forged File metadata and empty arrays with no D1 audit writes. Valid
  Files retain request/ORM context and streaming/disposal behavior.
- After final compiler scope/destructuring hardening and declaration rebuild,
  **2 generated Node production/browser cases** pass again (12 others deliberately
  skipped in that final targeted run). They verify typed RPC/upload UI, private
  validator sentinel absence, direct forged requests, form errors/pending/retry,
  client hydration and real production serving. This is distinguished from the
  earlier complete 15-case run; no full CLI suite is claimed for this phase.
- Sequential core/framework declaration builds, root `pnpm tsc --noEmit`, all
  **11** package typecheck configurations and the owned-file whitespace check pass.

Next: follow the detailed [RT-02](./release-0.9.0-plan.md#rt-02) and
[RT-14](./release-0.9.0-plan.md#rt-14) context. Implement typed resource actions,
app-owned lookup, trusted request identity and consistent pre-mutation enforcement
across API/read/RPC/realtime paths. Add private policy stripping, owned/cross-tenant
and forged-permission acceptance. Decide the plain-map migration and raw proxy
argument typing honestly; native method calls still execute authored code without
metadata validation. Native scalar/refinement/policy acceptance is still open.
RT-01 arbitrary deadlines and RT-11 session revalidation remain separate gates.
Versions stay **0.8.3** until REL-04; no publication or live deployment occurred.

<a id="codex-storage-capabilities-2026-10-03"></a>
### Codex completion: storage guarantees, limiter policies and provider inspection (2026-10-03)

**Author: Codex.** Continued RT-18 after `157573d`. The initial limiter policy
regressions produced **47 failures / 8 passes** in 55 cases. Memory accepted
invalid capacities and grew beyond its cap, concatenated namespace/caller keys
collided, and Redis accepted unsafe URL/token inputs and automatic redirects.
Malformed decorator metadata could also be interpreted as absent limits.

Memory now prunes expiry and rejects new keys at capacity, retaining every live
spent budget and continuing existing increments. Capacities are bounded, keys
and namespaces require bounded valid UTF-8, and KV/Redis validate the final JSON
tuple key before I/O. Evaluated scope/caller keys are framed too. Redis validates
HTTPS, normalized URL size, credentials/query/fragment/control exclusions and
bounded ASCII bearer tokens. Authenticated requests use manual redirects; every
redirect rejects. Null, malformed and unknown/misspelled limiter options reject
before a counter or handler. See the migration guide for the one-time budget
reset and mixed-version rollout implications.

One pure core model declares operation support, millisecond units, locality,
persistence, consistency, logical expiry and atomic increments. Framework
re-exports it; the database adapter declares structural metadata independently.
DO cache get/set never claims atomic increment. KV remains eventual/non-atomic;
database deployment traits and Redis persistence remain unknown. Unknown custom
providers cannot satisfy positive requirements unless their implementer explicitly
declares validated traits. These are declarations, not remote attestation.

Cache configuration/facades and limiter enforcement reject unsupported required
traits before operations, compute callbacks and counter dispatch. Requirements
are snapshotted and cannot be weakened by chained facades or later mutation.
Custom factory construction remains the factory author's resource responsibility.
Runtime inspection consumes no cache operation/quota. The CLI now offers
`inspect providers`/`check providers`, including human and single-envelope JSON
output through the shared command specification. Compiler AST parsing resolves
bounded static cache declarations and public selected Wrangler settings without
executing project code. Dynamic helpers, mutation, escaped/computed registration
namespaces and manual defaults remain conservative unknowns. Credentials and raw
invalid backend values are omitted. Missing selected cache bindings fail checks;
missing optional unselected bindings warn and expose their unavailable status.

Native compiled-library acceptance: two Workers share real KV/DO caches;
inspection units and failed requirements preserve absent values, while supported
DO requirements allow writes visible to the second Worker. Counter/API/socket
fixtures require shared/durable/atomic DO traits and retain spent budgets across
concurrent Workers, actual limiter eviction and reload. The socket eviction names
were migrated to the real framed bucket IDs. Compiled generated HTTP/SSE page and
scoped service calls deny unsupported requirements without D1 writes. The test
counter gate now reads the caller from the tuple instead of matching the obsolete
suffix, preserving actual cancellation/deadline acceptance. Its gated custom
store remains an undeclared test provider, not a distributed/atomic claim.

Final verification:

- Core full suite: **1039** tests / **60** files.
- Framework full suite after the final AST namespace fix: **1187** / **55**;
  RPC matrix **374**, storage AST **13**, cache capability tests **10**.
- CLI full suite: **585** / **43**, including all **14** generated/runtime
  acceptance cases, native storage/counter/socket fixtures and real pnpm release
  installation. After the final conservative namespace/optional-binding/name refinements,
  the affected published-export inspection/command/subprocess suites pass again:
  **85** / **4**, including **18** provider cases, the added optional-store case,
  valid store labels and sanitized invalid literal drivers.
  This split is deliberate; do not merge the added follow-up cases into an
  invented full-suite run.
- Database **87** / **15**, Node adapter **16** / **4**, Deno adapter **16** / **2**,
  scaffold **108** / **4**. Deno tests do not prove execution in a native Deno binary.
- Sequential core/framework/database builds pass. Framework's explicit declaration
  list includes the new storage export; a published-export failure caught that
  omission before it was fixed. Final framework export build, root
  `pnpm tsc --noEmit`, all **11** `pnpm typecheck` configs and owned-file
  `git diff --check` pass. No user-owned report/ignore changes are staged.

Logs: `/tmp/cossack-provider-core-final.log`,
`/tmp/cossack-provider-framework-verified.log`,
`/tmp/cossack-provider-cli-final.log`,
`/tmp/cossack-provider-cli-reviewed.log`,
`/tmp/cossack-provider-{db,node,deno,scaffold}-final.log`,
`/tmp/cossack-provider-{core,framework,database}-build-complete.log`,
`/tmp/cossack-provider-framework-export-final.log`, and
`/tmp/cossack-provider-{root-types,types}-verified.log`.

**RT-18 is complete**, with its original criterion audit in the detailed plan.
The ledger retains every original ID: **15/58 checked, 43 unchecked**. RT-01,
RT-02/RT-14, and REL-02..05 remain open. Actual native incoming pre-header TCP
abort delivery, arbitrary action deadlines/initialization concurrency, live KV
regional/throttling behavior, live Redis readiness/persistence, remote producer
shutdown and native Deno/Electron release gates are not established by this
checkpoint. Package versions remain 0.8.3 until REL-04. No publication/deployment
or push was performed. The next authorization/schema/resource work must retain
these boundaries and the full 58-task scope.

<a id="codex-sse-cancellation-2026-10-03"></a>
### Codex continuation: native coordinator cancellation (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `87495f7`. The coordinator's
promise tail admitted cancelled queued callbacks, retained their queue position,
and had no private cancel protocol for active counter decisions. New Cloudflare
recipes also omitted the incoming request-signal flag.

The coordinator now reserves private operation IDs, rejects duplicates, bounds
all pending entries to 32, and removes cancelled queued entries without invoking
them or releasing another action's slot. FIFO order survives cancellation and
capacity reuse. An RPC abort callback reaches the originating Worker while its
counter guard is pending; an ignoring provider's late reply cannot invoke the
action. Response-body cancellation releases local ownership without awaiting
producer cleanup. Started application methods may finish; no retry or rollback.
`queueStatus()` reports counts and active status without exposing operation IDs.

The router preserves the request/ALS/service context while replacing only the
action signal. Hono proxies now read branded getters on their actual receiver:
the shared matrix exposed three erroneous 500 responses from rate-limit guards.
A real Hono response-assignment regression also reproduced a 500 from the
setter; both context proxies now preserve its receiver. Generated page/service
actions assign a response and verify retained headers. A separate generated-app
test exposed an empty 500 cancellation race. The router
now emits a correlated cancellation response when its signal aborts before the
coordinator response is returned, regardless of which guard/RPC message wins.

Generated Cloudflare configs include `enable_request_signal` alongside their
existing Node compatibility flag. Named environments inherit flags unless they
override them. Preflight rejects a selected coordinator without the flag or with
`disable_request_signal`; artifact checks compare compatibility dates and flags.
Wrangler files remain excluded from template upgrades, including unchanged ones.
Two upgrade regressions prove preservation; existing apps must add the flag
explicitly. Docs explain that migration and the required flag.

Native evidence: two Workers share a real SQLite coordinator. Tests exercise
32-entry saturation, duplicate refusal, removal of 31 queued callers without any
callback invocation, active-counter abort, FIFO progress before provider release,
late replies, and capacity/ID reuse. The compiled generated staging app exercises
explicit middleware request signals through HTTP/SSE JSON/multipart page/service
calls, a cancelled queued SSE caller that never hits its store, and pending
counter deadlines before late success. The no-op cancellation test fake remains
limited to snapshots/publication; these contracts use native workerd fixtures.

**Native disconnect limitation:** actual pre-header TCP disconnect notifications
were not observed on the installed workerd (Miniflare 4.20260722.0), including a
minimal Worker on a direct socket with `enable_request_signal`, with and without
`waitUntil`. Production-router acceptance uses an explicitly aborted request
signal; it does not prove incoming disconnect delivery. Keep that acceptance gap,
remote producer shutdown, arbitrary method deadlines, initialization/restoration,
provider policy/capabilities, and native Deno/Electron gates open. Cloudflare
[documents the required incoming flag](https://developers.cloudflare.com/workers/runtime-apis/request/);
that documentation does not replace this runtime evidence.

Verification after the final response-setter fix:

- `pnpm --filter @cossackframework/framework run build:types` passes before
  dependent consumers run; core exports are unchanged from the prior checkpoint.
- `pnpm --filter @cossackframework/framework exec vitest run` — **1033** tests,
  **50** files; shared matrix **354**. The new real-Hono setter regression failed
  before fixing the proxy receiver.
- `pnpm --filter cossack exec vitest run` — **569** tests, **41** files;
  all **14** generated cases, real-pnpm release fixture, native coordinator/rate
  fixtures and compiled staging JSON/multipart page/service cancellation,
  deadlines, FIFO and response headers pass. Native queue cancellation also
  releases a raw response slot with a never-resolving producer cancel hook;
  remote producer shutdown/first-byte delivery are not claimed for that case.
- `pnpm --filter @cossackframework/scaffold exec vitest run` — **108** tests,
  **4** files, with recipe/provider compatibility-flag assertions.
- `pnpm tsc --noEmit` and `pnpm typecheck` — root and all **11** package configs
  pass. `git diff --check -- docs packages specs` passes; user-owned files are
  excluded. Unchanged core/Node/Deno suites retain their previous checkpoint
  evidence; this slice does not claim a new complete monorepo/release audit.

**Checklist audit:** **14/58 checked; no new checkbox closes.** All 44 unchecked
tasks remain in scope. Next complete provider URL/key/namespace/capacity/duration
policies, cache provider ownership/units, and capability inspection/rejection;
then audit the remaining RT-01/RT-02/RT-11/RT-14 criteria. Versions stay 0.8.3
until REL-04. Preserve user-owned `reports.md` and `.zcodeignore`.

<a id="codex-rate-decision-io-2026-10-03"></a>
### Codex continuation: bounded counter decisions and cancellation (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `14365b3`. Counter clients used
unbounded `res.json()`, did not own a deadline or carry action/request abort,
and could hold the shared component queue while a backend ignored cancellation.
HTTP/service errors before response headers also lost their correlation ID;
six new matrix cases reproduced that gap before the proxy/guard fix.

DO/Redis readers now limit actual bytes to 8192, require strict UTF-8 and EOF,
and reject producer errors after a valid JSON prefix. KV text records have the
same encoded bound before parsing; its structural API still materializes text.
Error and late reply bodies are cancelled, and readers release locks without
waiting indefinitely for a faulty producer's cancel callback. Every framework
counter decision has a five-second default deadline, configurable with
`backendTimeoutMs`; async built-in direct calls support `{ signal, timeoutMs }`
as an optional third `hit` argument. Framework custom stores are raced even if
they ignore the signal. There is no retry or rollback of a charged attempt.

HTTP decisions observe request abort. Correlated socket calls have a dedicated
controller; cancel and peer close/error abort it. Cancelled calls suppress late
frames and release the shared queue. A late KV read cannot dispatch a write;
an already dispatched write can still finish. Router guards recheck request
abort after input validation, before invocation. HTTP/multipart/service proxies
send UUID v4 IDs at dispatch. The server accepts valid UUID v4 IDs and replaces
unsupported input; origin checks and route guards still apply. XHR progress
requests carry the ID too. Server-returned IDs remain authoritative.

Verified:

- Sequential `pnpm --filter @cossackframework/core run build` and framework
  `run build:types` passed. Framework's `pretest` rebuilds declarations; never
  run it while another consumer loads those exports. An accidental parallel
  pretest caused missing-export CLI/type failures; reruns after it finished pass.
- `pnpm --filter @cossackframework/core exec vitest run`: **955** / **58** files.
  **43** new focused I/O cases cover exact/excess bytes, multibyte/invalid UTF-8,
  EOF/errors, headers/body deadlines, early/late abort, uncooperative fetch,
  hanging cancel callbacks, KV read/write ownership and the default deadline.
  Three additional real core dispatch cases cover process close and native
  DO close/error callbacks, queue progress and suppressed late mutation/frames.
- Framework suite: **1032** / **50** files. Shared matrix **354** cases; 12
  additions cover backend and client deadlines/cancellation through HTTP/SSE/
  socket/services, cleanup and following actions before the provider is released.
  Six security cases cover UUID acceptance, replacement and preserved guards.
- CLI suite: **562** / **41** files, including all 14 generated runtime cases,
  native workerd fixtures and the real-pnpm release fixture. A new workerd
  counter-body case consumes real DO streams: oversized, invalid UTF-8, HTTP
  error, stalled and explicitly aborted replies reject with no handler mutation
  and unlocked local bodies. An exact 8192-byte valid reply succeeds. Custom
  fetch cases inside workerd prove late-body disposal for both counter clients.
- Node: **16** / **4** files; Deno: **16** / **2**. Total **2581** across these
  suites. Root `pnpm tsc --noEmit` and all **11** package checks pass. After the
  last type-only test correction, the focused 43-case suite passed again.
- `git diff --check -- . ':!reports.md'` passes. Unrelated `reports.md` and
  `.zcodeignore` remain outside this work.

Limits of evidence: native abort is triggered by an explicit request controller,
not a disconnected external client. Cloudflare incoming disconnect signals need
[`enable_request_signal`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
The shared matrix's SSE path uses the local backend. Native coordinator queued
cancellation remains open. Cancelling a native subrequest did not invoke the
remote DO producer's JS cancel hook in this fixture; the consumer cancels and
releases its local reader, but does not promise remote producer shutdown.
Custom fetch fixtures are not a live Redis service. KV mocks do not prove
regional consistency, and Deno event tests do not prove native Deno execution.

**14/58 checked; no new checkbox closes.** RT-18 still needs native disconnect/
coordinator acceptance, provider URL/key/namespace/capacity/duration policy,
cache unit/ownership contracts and capability inspection/rejection. RT-01 has
additional lifecycle/serialization criteria. All 44 unchecked tasks remain in
scope; versions stay 0.8.3 until REL-04. Continue from the detailed plan and
[Codex handoff](./handoff-0.9.0.md), without treating this checkpoint as release
completion.

<a id="codex-rate-store-contracts-2026-10-03"></a>
### Codex continuation: request-owned rate stores and validated counters (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `78c208c`. Automatic configuration
silently fell back to memory after errors and stuck to the first environment.
Redis missing results defaulted to count zero; KV corruption restored budgets;
invalid options and custom-store replies could allow or misclassify calls.
The initial 103-case contract suite exposed **91** baseline failures. The initial
44 shared-matrix additions exposed **40** failures across HTTP/SSE/socket/service
RPC. A separate shared-component peer-env test also failed before its fix.

Automatic selection now returns the request environment's store and caches
unchanged binding/credential descriptors in a WeakMap. Each evaluation captures
its selection; another environment cannot replace it. Missing/invalid binding
shapes, unknown/blank/non-string modes (including explicit null), and missing
credentials reject instead of falling back. Repair and binding/mode changes
work. Unconfigured requests use the process memory default. Intentional manual
registration remains a process-wide override, documented as fixed-backend setup.
`configureRateLimitFromEnv(env)` returns a store without global mutation;
`getRateLimitStore(env)` inspects that selection. Without env it returns the
manual/default store. Shared component limits prefer the action context's env
instead of charging the first peer's bootstrap binding.

Runtime windows require positive safe-integer milliseconds; maxima require
non-negative safe integers (zero denies all). Key functions return non-empty
strings and messages are strings. Checks run before counter dispatch. Every
returned counter is validated and snapshotted once before the decision, including
custom getter-backed records. Corrupt KV records reject without overwriting;
malformed Redis results and negative/missing TTL reject without guessed expiry.
Redis uses atomic PEXPIRE with millisecond durations. KV retains records at least
60 seconds while the stored logical deadline controls shorter windows. Redis
explicit-env helpers require that env's credentials, without process fallback.

Final focused evidence: **105** contract cases and one real core socket-dispatch
peer-env case; the shared matrix is now **342** cases with null-mode refusal,
configuration repair, invalid options and malformed replies. It proves sanitized
correlated failures, loading/pending-call release and zero rejected mutations.
Native workerd adds two distinct DO namespace classes to prove binding ownership,
spent counters across two Workers, invalid/missing/null/absent modes and unchanged
mutation counts on denial. Socket workerd reloads into an invalid backend and
returns correlated internal failure with state unchanged. These are local native
runtime proofs; they do not establish live Redis or KV regional guarantees.
No local Redis binary was available; Redis coverage checks the REST contract,
script command shape and checked TTL semantics against primary documentation.

Verified after the final changes: core **908**/57 files; framework **1014**/50;
CLI **561**/41 with four native fixtures, all **14** generated runtime cases and
real-pnpm release validation; Node **16**/4 and Deno **16**/2; sequential core build
and framework declarations; root TypeScript and all **11** package checks.
Deno coverage is through adapter events, not native Deno execution. The earlier
full suites were rerun after the final null/getter audit; no assertions or
runtime deadlines were relaxed. Updated rate guide, architecture, migration,
detailed task plan and Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run tests/rate-limit-contract.test.ts tests/rate-limit-peer-store.test.ts tests/rate-limit.test.ts
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
pnpm --filter cossack exec vitest run tests/rate-limit-persistence-integration.test.js tests/websocket-peer-integration.test.js
pnpm tsc --noEmit
pnpm typecheck
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm --filter @cossackframework/node-adapter exec vitest run
pnpm --filter @cossackframework/deno-adapter exec vitest run
```

**14/58 checked; no new checkbox closes. All 44 unchecked tasks remain.**
Next own and bound backend response bodies, propagate abort/deadline ownership
and prove no late mutation. Finish provider resource/key/namespace policies,
cache duration conventions and public capability inspection/rejection with RT-18.
Then audit component initialization/restoration concurrency and all RT-01
criteria; continue RT-02/RT-14 policies and RT-11 secrets/session criteria.
Separate Deno/Electron/tarball/live release gates remain. Versions stay 0.8.3
until REL-04; preserve unrelated `reports.md`/`.zcodeignore`. Keep export
generation sequential and out of running tests or type checks.

<a id="codex-rate-window-persistence-2026-10-03"></a>
### Codex continuation: persistent Durable Object rate windows (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `97316b6`. The recommended
strict rate store kept its counter only in memory, so reconstructing the DO
restored a spent budget. All 17 initial unit regressions failed on the original
implementation. The native fixture also failed after actual object eviction:
count 21 became count 1, with a new deadline.

`RateLimitDurableObject` now commits counter/deadline together using its storage
transaction API. Every hit reads durable state; no separate memory cache can
acknowledge a write that failed. Expiry is evaluated inside the transaction,
after a queued storage read. Changing duration during an active window retains
its deadline. A fresh window schedules an alarm; delayed or duplicate alarms
cannot erase a newer window. Storage/alarm-write errors reject the hit.
Corrupt persisted data rejects instead of restoring a fresh budget.

DO windows require positive safe-integer milliseconds within the platform alarm
timestamp range. Direct DO requests reject invalid values with structured 400;
`DurableObjectRateLimitStore` rejects them before binding dispatch and validates
positive integer counter/deadline replies. Other provider/runtime option policies
remain open. New namespace examples use SQLite; the transactional key-value
API also works with legacy DO storage. The first upgrade cannot recover old
memory-only counters. The migration guide states this limit explicitly.

Evidence: **23** focused core cases cover reconstruction, exact expiry, queued
transaction timing, failed counter/alarm commits, corrupt state, invalid windows
and malformed replies. The storage double is not a platform concurrency model.
The published core entry runs in a native workerd fixture with two Workers and
one SQLite DO namespace. A concurrent 20-hit burst yields unique counts 2–21
and one original deadline. Actual DO eviction preserves count/deadline twice;
a forced configuration reload proves Worker memory reset while the durable
window stays spent. Blocked HTTP handlers do not mutate, including after reload.
The existing native socket fixture evicts limiter DOs before anonymous reconnect
and existing member actions; spent budgets remain denied. Its component reset
still uses the earlier forced reconstruction path, not timed hibernation.

Verified after the changes: core **802**/55 files; framework **966**/50; CLI
**561**/41 with four native workerd fixtures, all **14** generated runtime cases
and the real-pnpm release test; root TypeScript and all **11** package checks.
The fixture uses compatibility date `2026-07-29`, the newest supported by the
installed workerd binary. A startup attempt using today's date was rejected;
no platform behavior assertion or test deadline was relaxed.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run tests/rate-limit-persistence.test.ts tests/rate-limit.test.ts
pnpm --filter cossack exec vitest run tests/rate-limit-persistence-integration.test.js tests/websocket-peer-integration.test.js
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 checked; no new checkbox closes. All 44 unchecked tasks remain.**
Next fix explicit missing/unknown backend configuration, environment/store
ownership and Redis/KV/custom-store response and option validation. Then audit
cache/limiter duration conventions, provider capabilities and inspection; do not
claim those guarantees from the native DO fixture. Audit component initialization
and restoration concurrency with RT-01, and continue RT-02/RT-14 policy and
RT-11 secrets/session criteria. Separate Deno/Electron/tarball/live release gates
remain open. Versions stay 0.8.3 until REL-04. Preserve unrelated `reports.md`
and `.zcodeignore`; keep export generation out of running tests and type checks.

<a id="codex-socket-peer-context-2026-10-03"></a>
### Codex review: WebSocket peer context and native Cloudflare acceptance (2026-10-03)

**Author: Codex.** Continued RT-01 after `44bd46f`. Inspection found that
Cloudflare labeled all anonymous sockets as one user, while rebuilt DO contexts
contained only params. Shared process components also reused their first peer's
headers. Custom rate keys and anonymous identity therefore differed from HTTP.

Cloudflare attachments now retain verified peer identity and a filtered upgrade
request snapshot. Anonymous peers have no user, so the default key uses captured
IP headers. A fresh Hono action context exposes that socket's URL, headers,
query, params, user and DO environment through ordinary/generator completion.
Identity in message payloads is ignored. Old sockets without a snapshot reject
before mutation and close 1012 to reconnect. Cookie/Authorization, common
credential headers, handshake noise and internal auth assertions are excluded;
custom headers/query values remain retained. Arbitrary middleware variables,
HTTP request bodies and session revalidation are outside the snapshot contract.

Native workerd exposed the attachment overflow exception as a plain Error,
rather than RangeError. The upgrade now returns `COSSACK_WS_CONTEXT_TOO_LARGE`
with 413 instead of 500 or discarding header key inputs. Identity assertions
are checked for shape/ID consistency before acceptance (`COSSACK_WS_CONTEXT_INVALID`).
Child dispatch receives the peer context; unrelated frames do not deserialize
attachments. Component base context is restored after each queued action.

The process runtime accepts per-client context, either through
`addClient(client, user, context)` or `getContext`. Framework upgrade metadata
includes original page params. Node, its legacy adapter, and Deno pass the
connecting context through shared-component action execution. Libraries retain
structural runtime contracts and do not import the application package.

The new native two-Worker fixture uses published core entries, the real framework
proxy and CossackDurableObject, native WebSocketPair/attachments/storage and a
configured RateLimitDurableObject binding. It proves user/IP isolation,
forged-identity isolation, custom header/param keys, denied calls without
state mutation, cross-Worker/new-component/reconnect budgets, interleaved
peer-aware generators and HTTP limiter/socket counter sharing. Forced component
reconstruction retains native attachments and reloads durable component state;
it does not claim timed eviction or counter persistence across process restarts.
The test-only Worker supplies auth/IP assertions; this is local workerd acceptance,
not live edge deployment or full auth-provider/session-revocation acceptance.

Real Node sockets sharing one Cossack instance verify user/context/header
isolation and custom budgets. Deno event-level tests verify adapter wiring;
Deno execution remains a separate release gate. Framework scope tests prove the
upgrade's context carries decoded params/user/bindings. Core tests cover filtered
snapshots, variable isolation, child forwarding and old-peer refusal.

Verification: sequential core/framework declarations and Node/Deno builds;
core **779**/54 files, framework **966**/50, Node **16**/4, Deno **16**/2,
CLI **560**/40 including the new native peer fixture, both existing workerd
fixtures and all **14** generated runtime cases; root/all **11** package checks.
The first concurrent CLI run hit an existing 5-second inspect test timeout.
Running the full CLI suite alone passed; no production deadline or assertion
was relaxed. Architecture, RPC/WebSocket/rate documentation, migration, detailed
plan and Codex handoff describe the contract and remaining evidence.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/node-adapter --filter @cossackframework/deno-adapter run build
pnpm --filter cossack exec vitest run tests/websocket-peer-integration.test.js
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter @cossackframework/node-adapter exec vitest run
pnpm --filter @cossackframework/deno-adapter exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 checked; no new task closes. All 44 unchecked tasks remain in scope.**
Next audit RT-18 store configuration fallback, backend response validation,
fixed-window persistence under DO eviction, concurrency and per-environment
ownership. The current DO rate counter remains in memory; shared namespaces
are not persistence. Audit component bootstrap/restoration concurrency and all
RT-01 criteria, then continue RT-02/RT-14 policies and RT-11 sensitive old input,
session recipes, rotation/concurrency and revocation semantics. Preserve separate
Deno/Electron/tarball/live gates, versions 0.8.3 until REL-04 and unrelated
`reports.md`/`.zcodeignore`. No push, deployment or publication occurred.

<a id="codex-rpc-json-envelopes-2026-10-03"></a>
### Codex review: ordinary JSON and HTTP failure envelopes (2026-10-03)

**Author: Codex.** Continued RT-01 after `933f12c`. All **35** new real-handler
matrix regressions failed before the fix: malformed service state and redirects
were accepted, diagnostic codes/field errors were copied without structural
checks, and foreign error body IDs were ignored. The server still executed each
call once; this checkpoint fixes client interpretation, without mutation replay
or rollback.

Core `shared/rpc-json.ts` now supplies one decoder for component, SSE and explicit
service ordinary JSON/error replies. Full bodies have a **1 MiB total byte cap**
(`RPC_JSON_RESPONSE_MAX_BYTES`), strict UTF-8 decoding and object-root validation.
Consumption retains cancellation/deadline ownership until EOF and releases its
reader on completion, failure or overflow. State/result/navigation effects follow
validation. Overflow reports `COSSACK_RPC_RESPONSE_TOO_LARGE`; malformed JSON or
metadata reports `COSSACK_RPC_RESPONSE_INVALID`, retaining a known header ID.

Ordinary service replies require an object `_cossack_service_state`; component
replies reject that service wrapper. Redirects contain only a nonempty
`_cossack_redirect` using HTTP/HTTPS or a relative URL. Error code/ID values must
be nonempty strings, messages strings, and field errors objects. Nested field
errors remain JSON rather than imposing unimplemented RT-02 schema semantics.
The error body ID must agree with a known header, or supplies correlation if no
header exists. Ordinary app state named `requestId` remains application data.

Native failures stay opaque even if their body resembles RPC JSON; middleware
non-JSON/empty failures retain generic status/known-ID diagnostics. A malformed
declared JSON failure rejects as invalid. Network body errors report uncertain
outcome without leaking their producer message or retrying. The byte cap does
not stop a server mutation from having already completed; move large bodies to
an HTTP endpoint. RPC documentation, architecture and the draft migration guide
record these behavior changes.

Verification: sequential core build/framework declarations; **775 core tests**
in 53 files, **966 framework tests** in 50 files, **559 CLI tests** in 39 files,
root TypeScript and all **11** package configs. CLI includes both real-workerd
fixtures, all **14** generated runtime cases and the isolated real-pnpm release
fixture. No live deployment or package publication ran. The matrix now has
**294** cases (259 previous + 35 ordinary response regressions). **31** new core
cases cover split Unicode, invalid UTF-8, exact byte boundaries, overflow
cancellation, typed/opaque errors, EOF gating, body failures and public proxy
parked-body cancellation/deadlines. Older proxy tests now use actual Web Standard
Responses instead of object stubs that bypass response-body ownership.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 tasks checked; no additional task closes. All 44 unchecked tasks remain
in scope.** Continue actual Cloudflare WebSocket/DO peer context, anonymous/header
identity, reconnect and custom rate-key acceptance. Audit configured counter
store failure, ownership, persistence and consistency before making stronger
claims. Then audit all RT-01 criteria and continue RT-02/RT-14 policies and
RT-11 secrets/session recipes/rotation/concurrency. Deno execution, Electron
packaging, full tarball/runtime gates and live deployment keep their separate
evidence requirements. Keep versions 0.8.3 until REL-04 and preserve unrelated
`reports.md`/`.zcodeignore`. The detailed plan and latest Codex handoff identify
this stopping point and retain every task's original intent.

<a id="codex-rpc-target-limits-2026-10-03"></a>
### Codex review: child targets and RPC action limit ownership (2026-10-03)

**Author: Codex.** Continued RT-01 after `5fb8af7`. New rate regressions failed
on all four paths: HTTP/service 429 replies lacked a stable code, and socket
calls executed repeated mutations because they never checked `@RateLimit`.
Child tests exposed process-local SSE publishing child state over same-named
page keys, shared page/child method budgets and missing correlated target errors.

Core now shares the counter decision between HTTP and WebSocket execution.
Socket limits use inherited/forwarded action metadata and trusted peer identity
before validation/mutation. Store failures reject with private details redacted.
Server-assigned canonical route ownership supplies one action/class/caller/store
namespace across JSON, multipart and socket dispatch; changing IDs or opening
another socket does not restore the same budget. Renderer parents need not be
Cossack components: owner lookup traverses wrappers without calling missing
framework methods. Page and child classes have separate budgets, while sibling
instances of one child class share theirs. Explicit layout-service budgets belong
to the layout/slot and span its pages. HTTP 429 adds `COSSACK_RPC_RATE_LIMITED`,
request ID and Retry-After; socket errors retain the ID and clean pending/loading.

HTTP/SSE child actions now publish the page root's state to the process-local
SSE store, matching distributed page/target separation. Caller replies retain
child state. Numeric/blank target metadata rejects before dispatch rather than
falling back to root socket execution. Missing children and denied component/
service actions return `COSSACK_RPC_NOT_FOUND`/`COSSACK_RPC_FORBIDDEN` with IDs.
The browser's actual socket message handler routes known-ID malformed frames
before its broadcast type filter; a missing type rejects only its pending call.

Evidence: **259 matrix cases** (56 shared x four = 224, six response-local,
13 raw multipart, 15 multipart client/router, one cross-HTTP/socket budget);
**18 child cases** cover JSON/multipart ordinary/stream snapshots with colliding
keys, bad targets, action allowlists, descendant cleanup, same-named page/child
limits and shared JSON/multipart limits. Separate real socket/core tests prove
caller isolation across connections, forwarded service limits, valid child
dispatch, invalid targets and route ownership through renderer wrappers.

Generated production workerd now accepts one JSON limited call, rejects a
multipart repeat with 429/ID/Retry-After, and proves via D1 that only permitted
actions mutate. A layout service's spent budget persists across HTTP/SSE pages.
The fixture still runs real auth/ORM, distributed SSE, native bodies, multipart
generators, cancellation and Chromium acceptance through published entries.

Verification: sequential core build/framework declarations; full core **744**
tests/52 files, framework **931**/50, CLI **559**/39 (both workerd fixtures and
all **14** generated runtime cases), root TypeScript/all **11** package checks.
The first CLI run exposed a warm-cache dependency in the existing real-pnpm
registry test: a cached release bypassed its local server. Its metadata/content
caches are now test-local; focused and full runs pass. A short wall-clock DO
expiry test also failed once; it now checks exact expiry with a controlled clock,
preserving production behavior. Updated docs, architecture, migration, plan and
Codex handoff describe the verified contract and remaining audit.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
pnpm --filter cossack exec vitest run tests/upgrade-release.test.js
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
scope.** Continue ordinary/error JSON-envelope validation and actual Cloudflare
socket/DO peer context/reconnect/custom-key acceptance, then audit RT-01 against
all criteria. Anonymous/header identity parity and configured rate-backend
failure/persistence/consistency remain unverified; route namespaces do not make
memory counters distributed. Continue RT-02/RT-14 policies and RT-11 session
criteria. Deno execution, Electron packaging, full tarball/runtime gates and
live deployment retain separate evidence requirements. Versions stay 0.8.3
until REL-04; preserve `reports.md` and `.zcodeignore`.

<a id="codex-rpc-protocol-boundaries-2026-10-03"></a>
### Codex review: RPC correlation and terminal response validation (2026-10-03)

**Author: Codex.** Continued RT-01 after `a7da267`. Ten new regressions failed
before the reader fix. Malformed later JSON/UTF-8/frame shapes lost the already
known ID, first frames could disagree with the HTTP response header, and public
clients returned on done before the reader checked trailing frames. This allowed
false success and terminal state hydration despite a malformed response ending.

`readRpcStream()` now seeds correlation from `X-Cossack-Request-Id`, retains the
header/learned ID on parse and reader failures, and holds done/error until EOF.
Trailing bytes/frames reject with `COSSACK_RPC_STREAM_INVALID`; a body failure
reports sanitized `COSSACK_RPC_NETWORK_FAILED` and the unknown server outcome.
Clients keep earlier accepted progress and withhold terminal state. Yields stay
incremental. Regressions also prove cancellation during the EOF wait and body
failures after both done and error. Frame validation requires an object envelope
and non-whitespace request IDs/error codes.

Expanded the real proxy/router/runtime matrix to **242** cases: **52 shared x
four paths = 208**, six HTTP/SSE/service response-local cases, 13 raw multipart
and 15 multipart client/router cases. Fault injection rewrites only correlated
WebSocket action frames; initialization/broadcasts are untouched. Malformed
known-ID frames reject their pending call and release loading; unknown IDs are
ignored without hydrating foreign state. A valid socket terminal frame closes
its own call without waiting for the multiplexed connection to close. HTTP
faults prove rejection before false state, retained earlier progress, one
dispatch and eventual request cleanup. Cancellation is not mutation rollback.

Verified: sequential core build/framework declarations; full core **739** tests
across **52** files, framework **896**/49, CLI **559**/39 including both workerd
fixtures and all **14** generated runtime cases; root TypeScript and all **11**
package checks. Updated RPC guide, architecture, draft migration, RT-01 plan,
checklist status and latest Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts tests/sse-coordinator-transport.test.ts
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
scope.** GLM should continue RT-01 with child/action target isolation and rate
limits through actual proxy/handler fixtures, then RT-02/RT-14 input/file/resource
policies and RT-11 secret exclusion/session recipes/rotation/concurrency.
Published-entry workspace fixtures are not tarball installation or live
deployment evidence. Deno execution and Electron packaging remain REL-03 gates.
Keep versions 0.8.3 until REL-04; preserve `reports.md`/`.zcodeignore` and build
declarations before dependent checks without simultaneous regeneration.

<a id="codex-workers-rpc-acceptance-2026-10-03"></a>
### Codex review: built Workers multipart and native RPC acceptance (2026-10-03)

**Author: Codex.** Continued RT-01/RT-11 acceptance after `b2b566f`. The real
coordinator regression failed: a native Response with the RPC NDJSON MIME type
lost its body. `SseDurableObject.execute()` now checks the reserved
`X-Cossack-Rpc-Response: native` marker before selecting protocol parsing.
Native bodies retain bytes/headers, request ownership and serialization-slot
lifetime. The two-Worker test verifies the body and unchanged authoritative
state, then runs subsequent coordinated actions. The transport unit fixture
uses the same marker distinction.

The generated staging-app fixture now extends actual Vite/Wrangler output with
protected HTTP/SSE pages, a nested service and test-only D1 gate/audit endpoints.
It explicitly sets `NODE_ENV=production`: inheriting Vitest's test environment
previously emitted development client paths, so successful SSR assertions alone
had not proved production browser hydration. It still runs the selected artifact,
real D1/auth, provider handlers and distributed SSE binding without deployment.

Direct multipart calls verify nested Unicode Files, component/service auth and
input rejection, correlated field errors, early cookies, lazy yields/final
results, late-cookie diagnostics and eventual cancellation cleanup. Native
NDJSON, JSON with reserved-looking data, binary bytes and bodyless 204 preserve
their intended body/status/headers. D1 audit writes during generator completion,
page cleanup and service disposal retain the original request path and user,
proving the ORM context survives response ownership. SSR observes authoritative
SSE state after multipart mutations. Gates release finite fixture I/O explicitly;
this does not establish queued callback abort support or mutation rollback.

Chromium hydrates the production hashed scripts and calls public clients.
Component XHR and explicit-service Fetch uploads display the first Unicode yield
before the D1 gate releases, then report final data and upload progress. Native
body calls retain status/headers/bytes. Component and service redirects from
HTTP/SSE pages preserve all four native/helper/flash cookies, render the old
input/message once and consume them before reload. Header tests use the observed
response and final navigation; they never replay an action to collect diagnostics.
Fixture compiler and browser errors are surfaced on failure.

Verified: framework declarations; focused real-workerd fixtures **2/2**;
framework **858** tests/49 files; CLI **559**/39, including both workerd fixtures
and all **14** generated runtime cases; root TypeScript and all **11** package
checks. Core source remains unchanged from the previous 726-test checkpoint.
Updated SSE guide/spec, detailed RT-01/RT-11/CF-06 plans and Codex handoff.

```sh
pnpm --filter @cossackframework/framework run build:types
pnpm --filter cossack exec vitest run tests/deploy-integration.test.js tests/sse-coordinator-integration.test.js
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks checked; no new task closes. All 44 unchecked items remain in
scope.** These tests exercise published entries from the workspace, not installed
tarballs or a live deployment. Deno execution/Electron packaging remain REL-03.
RT-01 stays open for systematic protocol/malformed-frame, rate-limit and
child-target boundaries; continue file/unknown-key/schema policies with RT-02/
RT-14. RT-11 still needs sensitive old-input exclusion, complete session flows,
rotation and concurrency semantics. Keep versions 0.8.3 until REL-04, rebuild
declarations sequentially before dependent tests and preserve unrelated
`reports.md`/`.zcodeignore` edits.

<a id="codex-rpc-multipart-2026-10-03"></a>
### Codex review: shared multipart RPC ownership and streaming (2026-10-03)

**Author: Codex.** Continued RT-01 after `5029287`. The upload path bootstrapped
and dispatched separately, restored only top-level files, omitted the shared
input-validation gate and full layout service ownership, and did not handle
generator replies or await all request cleanup. Ordinary file/native response
tests had not established those contracts.

`/upload` and `/crpc` now share one dispatcher. Transport guards and dispatch
reuse a cached decoder, so authorization still runs before constructors/actions.
Multipart restores nested markers and preserves own `__proto__` data. Invalid
JSON, null/non-array payloads, missing/invalid file markers, extra marker keys,
duplicate metadata and duplicate referenced file parts fail before construction
with `COSSACK_RPC_REQUEST_INVALID` and correlated IDs. Unreferenced file parts
and broad file/unknown-key policies are not settled by this slice.

Component uploads retain scope and page-parameter metadata. Explicit-service
calls now accept nested File/FileList arguments and preserve owner/slot/state.
FileList becomes a File array; raw Blob still rejects. The shared action path
applies `enforceActionInput` before mutation and keeps layout service injection,
request/config/ORM ownership, awaited disposal, native/helper/flash cookies,
redirects and streaming response lifetime.

Fetch is the default multipart transport. Declaring numeric `<method>Progress`
state selects XHR for upload progress. XHR switches to progressive UTF-8 text
at headers for RPC streams, forwards complete NDJSON lines before load and
preserves native binary bodies/headers. Per-frame byte limits still apply,
but XHR retains cumulative browser text and cannot pause network downloads;
it does not have bounded total response memory or Fetch's network backpressure.
The RPC guide explains that tradeoff. Cancellation while the iterator is parked
at a yield now retains its known request ID across all four client paths.

The matrix has **44 shared cases x four paths = 176**, **13 raw multipart**
cases and **15 multipart client/router** cases: **204** total. It tests nested
files, progress, default Fetch, input failures before mutation, early generator
yields, state/final results, cancellation correlation and eventual remote
cleanup. The existing **25** router lifetime cases now run for JSON and
multipart (**50**), covering forwarded/explicit services, validation, request
and ORM context, cancellation/disposal, cookies, redirects, flash and header
writes. Fixture counters now belong to their original requests so delayed
cancellation cleanup cannot contaminate later tests. An explicit completion
gate proves early yields without depending on a timer.

Generated production Node apps compile and run in Chromium. HTTP/SSE component
and scoped-service calls send nested Unicode Files, display the first yield
before final completion, then verify the final result and upload progress.
Existing native-upload acceptance explicitly selects XHR and verifies binary
bytes/status/headers. This establishes Node/browser evidence, not new Workers,
Deno execution or Electron packaging acceptance.

Verified: core build; framework declarations; focused matrix/router **254**;
full core **726** tests/52 files; framework **858**/49; CLI **559**/39, including
all **14** generated runtime cases; root TypeScript and all **11** package checks.
RPC guide, architecture, migration draft, detailed plan and Codex handoff updated.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run tests/rpc-upload.test.ts
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts tests/router-rpc-stream.test.ts
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
scope. RT-01, RT-02 and RT-11 stay open.** GLM should next extend existing built
Workers fixtures for multipart generators/native body consumption, native/helper/
flash cookies, auth guards, D1/request lifetime and distributed SSE. Then audit
systematic malformed data/frames, rate-limit and child-target boundaries and
finish file count/size/type/unknown-key policies with RT-02/RT-14. RT-02 still
needs inferred schema inputs, arrays/files and resource-policy acceptance;
RT-11 still needs secret exclusion, full recipes, rotation and concurrency.
The full release gates and Deno execution/Electron packaging remain required.
Keep versions 0.8.3 until REL-04; regenerate declarations sequentially before
dependent tests. Preserve unrelated `reports.md` and `.zcodeignore` edits.

<a id="codex-rpc-native-response-2026-10-03"></a>
### Codex review: native HTTP RPC response completion (2026-10-03)

**Author: Codex.** Continued the RT-01 audit after `26ec624`. The router forwarded
native Response bodies correctly, but public clients parsed them as state:
JSON could hydrate unintended fields, while text/binary/bodyless responses
failed JSON decoding. The authored client completion type was unknown.

Successful ordinary native HTTP responses now resolve to a local browser
Response. The reserved `X-Cossack-Rpc-Response: native` header distinguishes user
bodies from state envelopes and generator frames before checking MIME types.
Text, JSON (even objects with reserved metadata-looking keys), binary, raw NDJSON
and bodyless 204 responses work. Status/status text and browser-visible headers
are retained. Redirects keep navigating with undefined completion; HTTP error
statuses still reject with their status and known request ID.

Core drains the native body before call completion using a growing byte buffer
capped at 1 MiB. This keeps deadlines, cancellation and server response-lifetime
cleanup active through consumption; unobserved calls drain too. Oversized bodies
reject with `COSSACK_RPC_RESPONSE_TOO_LARGE` and cancel the producer. Larger or
continuous downloads belong to HTTP endpoints. Repeated awaits share the same
local one-use body; clone before multiple reads. Fetch URL/redirect flags are
not preserved. Native bodies never hydrate action state; typed data returns
remain the state synchronization contract.

`RpcResult<Response>` now resolves to `Response | undefined`; generator Response
terminal values remain invalid and infer never. The existing semantic fixture
checks ordinary, mixed, viewed-again and generator cases. WebSocket rejection
now cancels a native body rather than leaving its producer open. Upload XHR uses
arraybuffer and copies all browser-visible headers instead of decoding every
response as JSON text. Its real Chromium binary round-trip preserves bytes,
status, content type and a custom response header. This fixes the native upload
body boundary, not upload request ownership or generator dispatch.

The existing matrix adds 11 cases per transport: five native representations,
unobserved draining, size errors, HTTP failure status, body disconnect, deadlines
and cancellation/body closure. It now has **43 shared cases x four paths = 172**,
plus six multipart cases: **178 tests**. Core reader tests cover exact byte limits,
fragmented one-byte chunks, pre-abort and pending-read cancellation, network
failure and reader release. Existing native-router tests retain request/ORM
context and disposal evidence. Generated Node sources compile before production
HTTP/SSE browsers consume page text and service binary responses, plus a separate
binary upload page. Existing cookie/redirect browser acceptance still passes.

Verified after the final code change: core build; framework declarations;
focused matrix **178**; full core **718** tests/51 files; framework **807**/49;
CLI **559**/39, including all **14** generated runtime cases; root TypeScript and
all **11** package checks. Own-file whitespace checks passed. Updated RPC guide,
architecture, migration draft, detailed plan and Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts tests/router-rpc-stream.test.ts
pnpm --filter @cossackframework/core exec vitest run tests/rpc-native-response.test.ts tests/rpc-client-types.test.ts tests/method-proxy-route-id.test.ts
pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks checked; no new task closes. RT-01 remains open.** GLM should next
address multipart parity in `packages/framework/src/transports/http.ts`. Source
inspection shows a separate bootstrap/dispatch path with no full layout ownership
chain or awaited component-disposal boundary, top-level-only file reconstruction,
no shared `enforceActionInput` gate, and no generator response handling. Add real
client/router tests that fail on these gaps, then share the existing action
ownership/validation/response machinery with JSON RPC. Do not consume generators
into an ordinary JSON result as a substitute for streamed parity. Preserve upload
progress and decide explicitly how its client consumes generator replies.

Verify nested files, malformed input/markers, forwarded and explicit services,
validation before mutation, cancellation/disconnect, lazy generator completion,
request/config/auth/ORM ownership, cleanup on all exits and native/helper/flash
cookies/redirects. Ordinary multipart/native-body tests do not prove these.
Finish remaining protocol diagnostics and Workers/realtime acceptance with RT-11,
including native body consumption through built Workers artifacts. Its secret
exclusion, recipes, rotation and concurrency criteria remain open. Every other
unchecked release task and Deno/Electron release gate stays in scope. Keep
versions 0.8.3 until REL-04; rebuild declarations sequentially before dependent
tests. Preserve unrelated `reports.md` and `.zcodeignore` edits.

<a id="codex-rpc-json-values-2026-10-03"></a>
### Codex review: JSON RPC values and client types (2026-10-03)

**Author: Codex.** Continued the RT-01 wire/type audit after `6433534`.
The old validation/stringify path inspected native values before their JSON
conversion. Dates and custom objects could change shape, hooks could execute
again during encoding, and client types still promised native methods.

Core now owns `snapshotRpcValue` and `snapshotRpcFrame`. HTTP/SSE, service,
WebSocket and ordinary multipart result encoders consume the validated snapshot.
Valid dates become ISO strings; undefined object fields omit, array entries/holes
become null, and top-level void remains undefined. Data/model instances use own
enumerable fields. Custom hooks run once per value location, with the same empty
root result key across envelopes and the nested property/index key elsewhere.
Self-returning hooks work; actual cycles reject. Shared references copy normally.
Lossy non-finite numbers, invalid Dates, opaque/native/binary objects, throwing
hooks/getters and nesting beyond 256 levels reject with sanitized value paths.

Public `RpcSerialized<T>` applies that contract to `RpcResult`/`RpcYield` and
therefore authored `rpc$` inference. Compiler return rewriting uses those same
public helpers. Published semantic type checks cover models without prototype
methods, nested dates, custom and optional hooks, tuples/undefined/null, unknown,
any, self-returning hooks, and generator yields/completion. TypeScript cannot
infer own enumerability: class contracts need an explicit data object or typed
hook. Parameters and hydrated state properties still need JSON representation
annotations; no native Date/model revival is added.

Also fixed state comparisons passing the wrong JSON hook key, own `__proto__`
payload data being lost during file extraction, and WebSocket File/Blob arguments
silently disappearing before dispatch. Ordinary upload serialization failures
now have stable code/path/request ID. Private upload errors are redacted in
development, with original errors retained in correlated server logs. Upload
XHR clients retain the response request ID.

The existing real-handler matrix now runs 32 shared cases across four paths:
128 tests, plus six multipart-router cases (134 total). Production generated
Node browser acceptance executes Date/custom JSON/undefined-array generators
through HTTP and SSE after checking authored TypeScript. No parallel transport
suite replaces the existing matrix.

Verified after the final code change: core build; framework declarations;
focused matrix **134**; full core **710** tests/50 files; full framework **763**
tests/49 files; full CLI **559** tests/39 files, including all **14** generated
runtime cases; root TypeScript and all **11** package checks. Own-file whitespace
checks passed. Updated architecture, RPC guide, migration draft, detailed plan,
and the Codex handoff. Unrelated user files remain outside this change.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
```

**14/58 tasks checked; no new task is closed. RT-01 stays open.** GLM should
continue with native-response client body consumption and multipart parity.
The router forwarding a native Response does not prove arbitrary bodies work
through a proxy: clients still expect JSON/state and non-JSON bodies can reject
with `COSSACK_RPC_RESPONSE_INVALID`. Decide/document the supported completion
contract and verify it through public clients. Extend multipart coverage to
generators, nested files, scoped ownership/cleanup, cookies/redirects, input
boundaries and errors; the six ordinary-upload cases prove only this slice.
Finish remaining protocol diagnostics and Workers/realtime cookie/header
acceptance with RT-11. RT-11's secret exclusion, recipes, rotation and concurrency
requirements remain open. Continue all other unchecked tasks and REL-02/REL-03
runtime gates; Deno execution and Electron launch/packaging still need evidence.
Versions remain 0.8.3 until REL-04. Rebuild declarations sequentially before
starting dependent tests; do not regenerate them concurrently with those checks.

<a id="codex-rpc-conformance-matrix-2026-10-03"></a>
### Codex continuation: shared RPC conformance matrix (2026-10-03)

**Author: Codex.** Added one conformance suite with 19 identical cases against
HTTP/SSE components, WebSocket dispatch, and explicit scoped services: 76 tests.
Component/service proxies from built core execute the real Hono router; the
loopback WebSocket pair executes the real in-memory runtime/action dispatcher.
Fault injection affects the transport while application methods still run.

Coverage: ordinary results with no yields, yielded/final values and state,
repeated awaits, unobserved draining, catch/finally sharing, validation before
mutation, visible/internal errors, failure after progress, deadlines before and
after headers, cancellation, early iterator return, duplicate consumers, invalid
payload/state/results, uncertain disconnects, loading and pending-call cleanup,
and request versus runtime ownership. Finite delayed application I/O lets
teardown wait for remote cleanup without treating cancellation as rollback.

The common assertions found and fixed service RPC leaking internal stacks in
development and WebSocket serialization errors losing their payload/state path
prefix. Server logs retain the original exception with its request ID; callers
receive the same redacted internal error as component/WebSocket paths. Also fixed
HTTP/SSE/service errors losing the known response ID on invalid JSON, mid-stream
timeout, or disconnect. HTTP IDs can be unknown before headers arrive; local
failures need not have server IDs, and status is HTTP-specific.

Focused matrix: 76 passed. Core build and framework declarations passed. Full
core: 685 tests; framework: 705 tests; CLI: 559 tests across 39 files (all 14
generated runtime cases). Root `pnpm tsc --noEmit` and all 11 package checks
passed. Own-file diff whitespace checks passed; unrelated user files were excluded.
Updated the RPC guide, migration draft, detailed plan, and Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks remain checked. RT-01 stays open.** Its shared matrix acceptance
slice is complete; do not replace it with another parallel suite. Next audit
supported serialization values and corresponding client result/yield types,
including Date/JSON, undefined/void, non-finite and binary values, and custom/model
serialization. Finish protocol diagnostics and Workers/realtime response timing
with RT-11. This suite does not prove physical upgrades or distributed coordination;
production browser, workerd, and release runtime gates remain separate evidence.
Every remaining release task stays in scope; versions remain 0.8.3 until REL-04.

<a id="codex-rpc-response-timing-2026-10-03"></a>
### Codex review: RPC response cookies and header timing (2026-10-03)

**Author: Codex.** Continued the RT-01/RT-11 acceptance audit and fixed these
observable failures:

- Native component/service response cookies were overwritten by Hono's existing
  Context response. Merge their separate `Set-Cookie` values before materialization;
  preserve cookies with `Expires` commas and avoid duplicate identical values.
- Native redirects were followed by Fetch into HTML. Return RPC navigation
  metadata while preserving native, helper, and outgoing flash cookies together.
- Cookies written before returning a lazy generator could also disappear:
  prepared Hono headers were dropped when assigning a raw streaming response.
  Materialize the Context response at RPC entry so the response merge retains them.
- Late cookie/header/flash writes appeared to succeed after headers finalized.
  Core exposes a structural response header state; outer request middleware seals
  it after downstream outgoing middleware finishes and guards `c.header`.
  Cookie/flash helpers reject late writes with `COSSACK_RESPONSE_HEADERS_COMMITTED`.
  Session rotation/destruction check the same guard before storage mutation.
- Background RPC/realtime requests consumed flash meant for a destination page.
  Preserve valid incoming flash for page consumption; clear invalid tokens and
  discard partial outgoing flash on transport HTTP errors (status >= 400).
- WebSocket actions silently serialized native Responses as `{}`. They now fail
  with `COSSACK_RPC_HTTP_RESPONSE_REQUIRED`. Nested Response/Request/Headers
  values produce path-specific serialization errors across the shared walker.
- Component HTTP/SSE, service, and upload network errors now explain that server
  completion is unknown and the framework never retries the operation.

Native router tests cover component/service responses, redirects, multiple
cookies, failed RPC preservation, old input, and early/late streamed writes.
Middleware tests cover all four background endpoints. Session tests verify that
late rotation/destruction leave the original stored row unchanged. Production
Node browser acceptance uses published entries and real generated Vite builds:
both page/service redirects retain HTTP-only cookies, the destination reads
flash/old input once, reload has no flash, early streamed cookies arrive, and late
streamed writes reject. Generated source passes TypeScript checking first.

Verification: core build and framework declaration generation passed. Full core:
685 tests; framework: 629 tests; CLI: 559 tests across 39 files, including all 14
generated runtime cases. Root `pnpm tsc --noEmit` and `pnpm typecheck` passed for
all 11 package configurations. Own-file diff whitespace checks passed; unrelated
user edits were excluded. Documentation covers header timing and adds verified
breaks to the draft migration guide.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks remain checked. RT-01 and RT-11 remain open.** Next consolidate
the complete transport conformance matrix and supported-value audit. Verify
response timing through Workers/realtime paths; the new browser flow proves
Node HTTP/SSE-backed RPC behavior, not complete runtime parity. RT-11 still needs
password/token exclusion from old input, complete generated flows, and documented
rotation/concurrency behavior. Streaming failures cannot retract sent headers;
raw `Response.headers` mutation bypasses the helper guard. Do not prime generators
to permit late headers or claim cancellation rolls back completed mutations.
Continue every remaining release item; package versions stay 0.8.3 until REL-04.

<a id="codex-authored-rpc-types-2026-10-03"></a>
### Codex continuation: authored client RPC types (2026-10-03)

**Author: Codex.** Added `rpc$`, `RpcResult`, and `RpcYield` through core's public
entry. A client handler can use `rpc$(this.generate(...))` to infer generator
yields and final results from authored TypeScript. It also supports native sync
and async signatures, inherited/generic methods, function fields, and scoped
service calls. The helper returns the same framework operation; duplicate awaits,
cancellation, and failures keep their existing behavior. Native return values and
lookalike calls fail with `COSSACK_RPC_CALL_REQUIRED`. Native Response completions
and broad iterable final results are unknown rather than fabricated client types.

The isolated semantic TypeScript test uses the published entry with no Vite
rewrite. Exact types and expected errors cover arguments, yielded fields,
terminal values, inheritance, generics, function fields, scoped services, catch,
finally, and cancellation. The production Node browser fixture executes inferred
HTTP and SSE generators, decorated page/service function fields, ordinary results,
and repeated awaits; all four actions dispatch once per run. Client chunks omit
both server generator marker strings. Existing WebSocket and service conformance
also consume streaming calls through the helper.

Fixed an actual transport mismatch: ordinary HTTP/SSE JSON calls yielded their
final value, unlike WebSocket and explicit service calls. They now return it only
at completion, matching `RpcCall<Result, never>`. Generator yields remain separate.
See [the client guide](../docs/rpc.md) and [draft migration record](./migration-0.9.0.md).

**14/58 tasks remain checked.** RT-01 stays open for the complete conformance
audit/matrix and native Response/cookie/flash behavior coordinated with RT-11.
Every other unchecked task retains its full scope.

Verification: core build passed; full core 682 tests, framework 617, and CLI 558
passed. CLI includes all 13 generated runtime/browser cases. After strengthening
native Response type safety, the 57 focused RPC/semantic checks and root/all 11
package type checks passed again. `git diff --check` passed. No deployment or
package publishing was performed.

<a id="codex-four-recipe-capabilities-2026-10-03"></a>
### Codex completion: four recipes and shared capability planning (2026-10-03)

**Author: Codex.** Completed the remaining CLI-05 recipes through the existing
registry/composition path. The scoped-service layout owns one service; sibling
pages and a nested component inject it. Real RPC and browser acceptance cover
pending/failure/retry, retained sibling state, disposal on exit, and fresh state
on return. HTTP public state is client-supplied; the example is not durable storage.

Protected-route uses existing auth/database/UI recipes and a layout session guard.
Generated acceptance applies actual migrations, registers and signs in through
real sessions, checks anonymous/nested redirects and coded RPC failures, rejects
forged component identity, and expires the persisted session under a hydrated
page. Fixed the auth-only scaffold's dangling UserRole relation: auth and RBAC
model files, registration, and User relations now follow selected features.

Moved the dependency-free capability model to core's published
`runtime-capabilities` entry; framework re-exports it. Scaffold can now use the
same checker without importing framework. Rendering validates all selected
targets before planning writes. D1 and both Hyperdrive providers plus Desktop
fail with feature/source diagnostics during creation and composition. CLI JSON
preserves the diagnostic code. Recorded older unsupported recipes remain
inspectable with target diagnostics rather than losing their recipe facts.
Build checks retain their defense for manually configured combinations.

All four recipes preserve edited files and behave predictably when reapplied.
The expanded generated fixture passed all 12 production build/runtime/browser
cases. Root TypeScript and all 11 package checks passed. Full scaffold: 108 tests;
core: 676; framework: 617. Upgrade acceptance: 10 tests after adding the new core
dependency to isolated release fixtures. The final full CLI suite passed all
557 tests across 39 files, including the generated browser and upgrade fixtures.
`pnpm tsc --noEmit`, `pnpm typecheck`, and the final diff whitespace check passed.
Core build and framework type generation passed before dependent verification.

**14/58 tasks are now checked.** CLI-05 and RT-25 meet their written criteria.
The broader RT-01/02/03/12/14/29 contracts and every other unchecked item remain
in scope. Deno process execution, Electron launch/packaging, and full release
acceptance remain open. Package versions stay 0.8.3 until REL-04 gates pass.

<a id="codex-mutation-browser-recipe-2026-10-03"></a>
### Codex continuation: validated mutation and browser acceptance (2026-10-03)

**Author: Codex.** Added `cossack add mutation` / `--features=mutation` with a
complete public HTTP submission example. It shares typed built-in form rules
with server input validation, sends an explicit argument snapshot, and excludes
client form/error/pending state from synchronized state. It shows field errors,
disables controls while submitting, preserves failed input, resets after success,
and reports safe generic failures. It returns an acknowledgment without saving
or sending data. Application writes belong inside the server method after
authorization. No database/UI dependency is added; the registry declares HTTP
capability, and composition preserves repeated applications and edited files.

Acceptance runs the actual generated app through published package exports,
TypeScript, production client/server builds, stripped server bodies, SSR, and
real RPC input validation (missing/nonobject/invalid/array/oversized input plus
valid normalized output). Chromium covers both mutation and resource hydration,
client validation without RPC, pending/disabled controls, argument/state
separation, server field errors, failure, preserved input, reset, and retry.
Resource checks also cover filtered/empty results and retained stale data.

The browser fixture found two problems absent from server-only checks. Vite
fixtures inherited NODE_ENV=test and emitted development asset paths; builds
now explicitly set NODE_ENV=production and assert hashed module paths. Core
failed resource loaders updated status without requesting a render, leaving
loading UI visible. Failure now requests an update while the existing ownership
guard prevents obsolete/destroyed loads from changing the current view. A core
regression verifies that only the active failure requests a render. CI browser
installation now precedes CLI tests in both E2E and publishing workflows.

Verification: `pnpm --filter @cossackframework/scaffold test` passed 99 tests;
core build and `pnpm --filter @cossackframework/core test --run` passed 676 tests.
The combined generated-app/inspection/command-spec suite passed 37 tests,
including real Chromium interaction. Bundled route contract checks passed 2
tests. Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck`
passed. Full `pnpm --filter cossack test` passed all 553 tests, including the
generated production browser case. Whitespace checks passed for authored files;
the user's unrelated `reports.md` and `.zcodeignore` remain untouched/uncommitted.
**12/58 tasks remain checked:** CLI-05 still needs two recipes, RT-03 still needs
typed targeting and broader lifecycle coverage, and RT-25 remains open for the
remaining recipe integration audit. Continue all unchecked release tasks.

<a id="codex-resource-recipe-2026-10-03"></a>
### Codex continuation: resource recipe and RT-25 audit (2026-10-03)

**Author: Codex.** Audited RT-25 against its written criteria. Build diagnostics,
published-export fixtures, Desktop's transport boundary, and Workers-free output
are verified. The remaining explicit link is integration with all four CLI-05
recipes; Deno/Electron execution belongs to broader runtime release verification.
The detailed plan now records evidence per criterion rather than stale next steps.

Added `cossack add resource` / `--features=resource`. It creates a database-free
public catalog page using `server$`, explicit dependency tracking, lifecycle
status, loading/stale/error/empty output, and refresh/retry. The registry declares
HTTP capability; composition preserves edited pages and repeat application. CLI
add help now derives feature names from the registry. Existing presets do not
silently gain the new recipe.

Generated-app acceptance checks TypeScript, client and server builds, SSR data,
client stripping of loader data, filtered and empty RPC results, safe failures,
and successful reads after failure. Running generated TypeScript found Hono's
server union incompatible with the Node adapter's concrete Server parameter.
`attach()` now accepts the exact event contract it uses, with no generated casts
and no claim of HTTP/2 WebSocket support.

Verification: 98 scaffold tests and the resource generated-app acceptance pass;
Node adapter build and all 15 adapter tests pass. Combined CLI/generated-app
acceptance passed 36 tests. Root `pnpm tsc --noEmit` and all 11 package checks via
`pnpm typecheck` passed. Browser interactions/hydration are not yet covered
by this recipe's fixture. **12/58 tasks remain checked:** CLI-05 and RT-25 stay open
until the remaining recipe acceptance/integration requirements are fulfilled.

<a id="codex-native-database-capabilities-2026-10-03"></a>
### Codex continuation: native database bindings (2026-10-03)

**Author: Codex.** Added `cloudflareBindings` to the shared capability requirement
model. A selected feature supplies native binding names; Cloudflare checks their
presence and other runtimes report unsupported. No values or resource IDs enter
results. Capability summaries distinguish host support from selected named needs.

Selected D1 recipes declare DB, and Hyperdrive PostgreSQL/MySQL declare HYPERDRIVE.
Both web and Desktop configurations receive those requirements because the ORM
factory is shared. Desktop therefore rejects a retained native provider before
compiling application modules instead of generating an app that cannot supply
its database binding. Inactive database defaults add no requirements. Custom
platform emulation is not advertised as native binding support.

Verification: 97 scaffold tests and 30 framework capability/build tests passed.
The generated-app acceptance suite includes a Cloudflare/D1 application's Desktop
build failing with the manifest source and database/d1 feature in its diagnostic.
CLI metadata tests verify missing native bindings and successful name-only checks.
The generated Desktop test also exposed Cloudflare's Vite plugin running in
Desktop mode and rejecting Electron's external module configuration. The template
now omits that plugin in Desktop mode. A portable Cloudflare application's
Desktop build verifies the correction and checks emitted chunks for Workers-only
imports; the D1 Desktop case reaches the intended capability diagnostic.
Final CLI/generated-app acceptance passed (21 tests). Published framework
declaration/ESM generation, root `pnpm tsc --noEmit`, and all 11 package checks via
`pnpm typecheck` passed.

**12/58 tasks remain checked.** Continue the RT-25 audit against its documented
acceptance criteria and the remaining release tasks. These are configuration
checks; remote resources and Deno/Electron runtime execution are not verified here.

<a id="codex-recipe-requirements-2026-10-03"></a>
### Codex continuation: selected recipe requirements (2026-10-03)

**Author: Codex.** Added the pure scaffold API `recipeCapabilityRequirements()`
and its published declarations. Generated Vite configs now include recipe-selected
requirements for their web or Desktop target. SQLite requires filesystem access
only when database support is selected; a default but inactive SQLite choice adds
nothing. Desktop's native filesystem requirement is restricted to its side target,
so selecting Desktop does not make an otherwise portable Cloudflare web app fail.
Requirement sources point to the recorded `.cossack/scaffold.json` selection.

CLI project inspection exposes these requirements, and route checking evaluates
web requirements using the shared framework capability model. Scaffold declares
feature needs without importing framework runtime code or duplicating runtime
profiles. Existing database provider/runtime validation remains in the registry;
page transports and durable-state needs still come from the shared page parser.

Verification: all 94 scaffold tests passed; package checks via `pnpm typecheck`
passed. Generated-app acceptance includes selecting Cloudflare for a SQLite
recipe and verifying a source-bearing filesystem diagnostic before application
module compilation. The fixture supplies an explicit empty binding list because
its original Node recipe has no Wrangler config; the first attempt correctly
failed earlier on missing configuration. The final inspection/metadata and generated
build acceptance run passed all 31 tests (5 files); root `pnpm tsc --noEmit` also
passed.

**12/58 tasks remain checked.** These are the current filesystem declarations,
not a claim that every future service or provider integration is covered. RT-25
still needs remaining capability/provider audits and runtime acceptance. Deno
execution and Electron launch/packaging remain unverified on this host.

<a id="codex-bundled-route-exports-2026-10-03"></a>
### Codex continuation: bundled route export audit (2026-10-03)

**Author: Codex.** Audited the framework and scaffold TypeScript route trees
against the explicit default-export contract. Eighteen framework demo pages had
only named class exports; they now also default-export their component. Existing
named imports remain valid. Moved `pages/cache-regression/store.ts` to
`stores/cache-regression.ts` and updated its two consumers: the old location
incorrectly registered a helper module as a page.

A regression test uses Vite route discovery and the shared AST inspector to check
all TypeScript pages, layouts, and loading modules in both trees. Functional API
handlers retain their separate contract; Markdown retains generated exports.
The check rejects missing or unresolved default classes without executing page
code or accessing external services. It also catches future helpers accidentally
placed in the route tree.

The full framework build and SSG output passed. Targeted contract checks passed
(2 tests), followed by all 614 framework tests. Root `pnpm tsc --noEmit` and all
11 package checks via `pnpm typecheck` passed after the build.
An initial package type-check overlapped declaration regeneration and saw missing
framework modules; the final verification runs after the build to avoid that race.

**12/58 tasks remain checked.** This fixes shipped examples and strengthens route
contract verification; it does not complete RT-25 or prove every demo's external
integration. Continue selected recipe requirements and runtime acceptance.

<a id="codex-durable-state-capability-2026-10-03"></a>
### Codex continuation: durable page capability (2026-10-03)

**Author: Codex.** The capability audit found that Node/Deno WebSocket support
allowed `stateful: true` pages through builds even though the runtime rejects
that option. Added the shared `durableState` capability: available on Cloudflare
with `COSSACK_OBJECT`, unsupported on Node, Deno, and Desktop.

The shared static page parser now reads boolean `stateful` declarations and marks
dynamic values unknown. Build discovery adds the durability requirement for
stateful WebSocket pages. CLI route metadata exposes `stateful`, inspection adds
source-bearing capability diagnostics, and explain distinguishes durable state
from transport availability. Stateless/process-local pages remain valid. These
checks inspect configuration only; they do not prove remote resource readiness.

Targeted validation passed: 28 framework capability/build tests and 65 CLI
metadata/route/inspection tests. Published declaration/ESM generation, root
`pnpm tsc --noEmit`, and all package checks via `pnpm typecheck` passed.
The full framework suite passed (612 tests). The first full CLI run passed 545
of 546 tests; its multi-subprocess add/remove test exceeded the default five-second
limit. It passed alone in 4.92 seconds. That test now has a bounded 30-second
allowance for its real CLI processes and project snapshots; assertions are unchanged.
The full CLI rerun passed all 546 tests (39 files).

**12/58 tasks remain checked.** RT-25 still needs selected recipe feature
requirements and remaining runtime acceptance. No Deno/Electron execution is
claimed. This closes one capability mismatch rather than the entire task.

<a id="codex-node-development-runtime-2026-10-03"></a>
### Codex continuation: Node development runtime (2026-10-03)

**Author: Codex.** The generated Node dev server now requires the entry's exported
`app` and `runtime`, attaches runtime upgrades, and disposes replaced runtimes on
source reload. Reloads share one promise with a queued repeat, invalidate the SSR
module graph, and clear failed loads so later edits can recover. Previous runtime
cleanup errors are reported without preventing the replacement from attaching.

The HTTP server is passed to Vite's HMR configuration. Removed the old catch-all
upgrade listener, which both rejected Cossack upgrades and attempted to dispatch
HMR through a middleware object. Vite and Cossack now own their respective upgrade
paths. SIGINT/SIGTERM stop reloads, drain runtime disposal, close Vite, and close
the HTTP server, collecting cleanup failures. PORT=0 supports ephemeral test ports.

Verification: all four `packages/cossack/tests/generated-runtime-build.test.js`
cases pass. The new case creates a real project, launches its actual dev script,
connects to Vite's authenticated HMR socket and the Cossack page socket, verifies
state, edits the page, observes old socket closure, and receives updated state on
reconnect. Two rapid writes converge to the final value, HMR remains connected,
HTTP still works, and SIGTERM exits normally without the fallback kill. All 92
scaffold tests and root `pnpm tsc --noEmit` pass. No TypeScript runtime source
changed in this checkpoint.

**12/58 tasks remain checked.** RT-25 remains open for selected feature requirements,
remaining capability audits, and runtime acceptance outside Node. Deno execution
and Electron launch/packaging have not been verified. User actions that never
settle can still delay runtime disposal/reload; no forced timeout is claimed.

<a id="codex-node-guarded-runtime-2026-10-03"></a>
### Codex continuation: guarded Node runtime (2026-10-03)

**Author: Codex.** Added `createNodeAdapter()` with a structural router contract
(no framework runtime dependency). `attach(server, fetch)` routes `/ws/` upgrades
through the complete app and only handshakes after its guarded handler succeeds.
Middleware may reject before or after routing. Handshake headers retain cookies.
The adapter shares pending initialization by route/provider/scope, reserves
capacity, evicts idle components with awaited cleanup, and drains initialization,
active actions, sockets, and services during idempotent disposal. Generated Node
production entries pass this adapter to `createApp` and attach it to their server.
The old registry adapter remains exported but is not used by generated entries.

Real generated-app acceptance exposed compiled page providers still attempting
to resolve Cloudflare bindings during snapshot serialization. Bootstrap now
accepts router-resolved `providerTargets`, which take precedence over provider
binding lookup. SSR and runtime factories pass the authorized process-local scope.
Providers without an explicit target retain their normal resolution behavior.

A full framework build exposed two SSG demos that only exported named classes,
contrary to the default-export route contract established earlier. Both now
export their page as default; the expected SSG artifacts are generated again.
Audit remaining bundled examples separately rather than restoring first-export
selection or hiding missing artifacts.

Validation covers 675 core tests, 15 Node adapter tests over actual sockets,
92 scaffold tests, 608 framework tests, and three generated runtime build cases.
The Node generated case executes HTTP SSR and a WebSocket page's SSR, rejects
untrusted origins and another user's target, and receives a real state snapshot
from the built app. Core/Node/framework builds and root/all package types pass.
Commands: package `build` scripts; core/framework `vitest run`; Node adapter
`test`; scaffold `vitest run`; CLI `vitest run tests/generated-runtime-build.test.js`;
`pnpm tsc --noEmit`; `pnpm typecheck`.

**12/58 tasks remain checked.** RT-25 still needs generated development-server
attachment/reload cleanup (the current dev script rejects Cossack upgrades),
remaining selected recipe requirements, and broader runtime capability acceptance.
Node shutdown must be initiated with `runtime.dispose()` before waiting for an
embedded HTTP server to close. Actions must settle; no forced action timeout is
implemented. Request scheme follows the actual socket, not forwarded headers.
Deno live execution and Electron launch/packaging remain unverified here.

<a id="codex-deno-shutdown-2026-10-03"></a>
### Codex continuation: Deno shutdown and action lifetime (2026-10-03)

**Author: Codex.** Added idempotent adapter `dispose()` and native server lifecycle
integration. Disposal blocks new upgrades, drains pending initialization, closes
clients, waits for in-flight actions and already-retiring entries, and destroys
all cached components. One failed component cleanup does not skip the others;
errors are aggregated. Eviction also waits for active actions, so disconnecting
during a mutation does not destroy its service scope underneath it.

The server wrapper preserves native receivers/properties and coordinates native
`shutdown()` with adapter disposal. Its `finished` promise includes cleanup even
when the native server stops independently. Embedded users may call `dispose()`
directly; HTTP fetching remains usable. Cleanup has no forced timeout: an action
that never settles can keep cleanup pending.

Verification: adapter suite passed (15 tests), adapter build passed, root
`pnpm tsc --noEmit` and all 11 package configurations via `pnpm typecheck` passed.
Six added tests cover pending initialization, active actions, repeated disposal,
late events, rejection of new upgrades, cleanup failure isolation, native shutdown,
and independent native completion. The live smoke fixtures now provide component
cleanup methods. **Deno is not installed here; those live tests were not run.**

**12/58 tasks remain checked.** Keep RT-12/RT-25 open until real runtime acceptance
and the remaining Node integration/capability work are complete. Next wire Node
through the framework's guarded upgrade factory and verify generated applications.

<a id="codex-deno-runtime-eviction-2026-10-03"></a>
### Codex continuation: Deno runtime eviction (2026-10-03)

**Author: Codex.** Deno previously created duplicate components for concurrent
connections to one scope and discarded idle runtime entries without destroying
their components. It now caches pending creation by an unambiguous tuple key,
reserves capacity before asynchronous initialization, and releases reservations
after success or failure. Idle/over-capacity eviction awaits component destruction.
Connections closed during initialization cannot register afterward; late open or
message callbacks do not create new instances. Cleanup failures are reported
without rejecting the close event callback.

Verification: `pnpm --filter @cossackframework/deno-adapter test` passed (9 tests),
`pnpm --filter @cossackframework/deno-adapter build` passed, and root/package type
checks passed. Six new tests use the actual in-memory runtime with mocked Hono
socket events. They verify shared initialization, last-client eviction, awaited
replacement disposal, reserved capacity, failed-creation retry, early/late close,
and cleanup failure reporting. They do not execute Deno or a real network socket.

**12/58 tasks remain checked.** RT-12/RT-25 are still open. Continue with explicit
adapter/server shutdown, waiting for in-flight actions before disposal, and live
Deno acceptance. Node generated applications still need guarded WebSocket wiring.
Idle pruning remains activity-triggered, not timer-driven.

<a id="codex-runtime-websocket-scopes-2026-10-03"></a>
### Codex review: runtime WebSocket service scopes (2026-10-03)

**Author: Codex.** Reviewing the prerequisite for Node realtime integration found
that the framework's runtime WebSocket factory constructed a page without its
ancestor layout service scopes. Bootstrap also received the WebSocket URL context
instead of the original page parameters used by scope authorization.

The factory now builds the root and nested layout scopes, binds authenticated
user/context/environment to each, and injects from the innermost scope. The page
owns cleanup of the scope tree separately from service-state ownership, so layout
services are not incorrectly serialized as page-owned state. Constructor,
bootstrap, or render failures dispose the tree; successful pages dispose it when
`destroyAsync()` runs. Repeated destruction is safe.

Verification: `pnpm --filter @cossackframework/core build` passed;
`pnpm --filter @cossackframework/core test` passed (673 tests);
`pnpm --filter @cossackframework/framework exec vitest run` passed (608 tests);
`pnpm tsc --noEmit` and `pnpm typecheck` passed (all 11 package configurations).
The three new factory tests cover nested service shadowing, page parameters,
auth/bindings, serialization ownership, repeated cleanup, and constructor and
bootstrap failure. They use the real router with a test transport adapter.

**Completion audit: 12/58 checked, unchanged.** This is prerequisite work for
RT-12/RT-25, not live Node WebSocket acceptance. Generated Node entries still need
adapter wiring through the framework's guarded upgrade path. Node/Deno runtime
entry eviction and shutdown must invoke component cleanup; concurrent creation
for a shared runtime key also needs coverage. Do not attach the legacy Node
adapter as-is: it independently constructs context/components and bypasses the
shared router middleware and service-scope path. Retain origin/auth/scope checks,
exercise real connections and shutdown, and then reconcile advertised capabilities.

<a id="codex-generated-runtime-builds-2026-10-03"></a>
### Codex continuation: generated Node/Deno/Desktop builds (2026-10-03)

**Author: Codex.** Added generated-project acceptance using actual scaffold output,
Vite configuration, package exports, client assets, and SSR/desktop entries.
Fixtures build minimal Node and Deno applications plus a Node application's
Desktop side target. All emitted JavaScript chunks in their server/desktop output
are checked for accidental `cloudflare:workers` imports. Desktop rebuilds reject
an added SSE page through the generated mode-specific capability configuration.

The built Node app is imported in a fresh Node process and serves a real Hono
request that must return a rendered HTML document. This exposed a template bug:
the direct-entry guard called `pathToFileURL(process.argv[1])` even when Node eval
or embedding supplied no entry filename. The guard now checks for that argument
first, preserving direct startup while allowing programmatic imports.

This proves build compatibility and Node HTTP SSR, not Deno runtime execution,
Electron launch/native packaging, or WebSocket behavior. Source review also found
that generated Node entries do not attach `CossackNodeAdapter`, despite the runtime
profile allowing process-local WebSockets. Reconcile generated runtime wiring and
capability enforcement before closing RT-25; do not attach the legacy adapter
without auditing authentication, middleware, and service-scope behavior.

Verification: all **3 generated runtime integration cases passed**, including
Node HTTP execution, full emitted chunk checks, and Desktop rejection; complete
scaffold suite **92 passed**; `pnpm tsc --noEmit` passed.
**12/58 tasks remain checked; RT-25 stays open.** Next address Node realtime configuration and selected feature
requirements in recipe planning, then audit the complete RT-25 acceptance set.

<a id="codex-handler-default-parity-2026-10-03"></a>
### Codex review: functional handlers and default component selection (2026-10-03)

**Author: Codex.** CLI inspection/checks now recognize functional HTTP modules
under the same `/src/pages/api/` boundary as the router. Named method exports,
default functions, and locally declared default function references are identified
without execution. They expose `routeStyle: http-handlers`, HTTP transport, no
layout scopes, and `not-applicable` component method/dispatch facts. Explanations
do not attribute their transport to a nonexistent decorator. Identical source
outside the functional API boundary does not bypass component checks.

Build discovery uses that same classifier and boundary. The router, SSR layout
selection, RPC transports, SSG discovery, client navigation/loading, and Durable
Object component lookup now use a common default-export selector instead of the
first enumerated module value. A named helper can no longer change the selected
component. Component modules need default exports; named functional API methods
remain supported independently.

Runtime regressions insert a throwing named helper before the real default
page/layout. Actual SSR, SSG discovery, and transport guard paths select the right
component; functional HTTP requests still work. These close the two acceptance
gaps found during generated-app verification. Unsupported/dynamic forms remain
explicitly unknown rather than being executed to obtain metadata.

Verification: complete CLI suite **539 passed across 38 files**, including
generated staging deployment/Worker integration. Complete framework suite
**605 passed across 46 files** after component selection changes; final targeted
module/guard/build suites **26 passed** after functional default-handler support.
Framework declaration build, root TypeScript, and all **11 package type checks
passed**. **CLI-04 is complete again; 12/58 tasks are checked.**
RT-25 still needs full generated application/side-target coverage and feature
planning requirements. Browser and production release gates stay open.

<a id="codex-recipe-capability-wiring-2026-10-03"></a>
### Codex continuation: recipe wiring and environment binding discovery (2026-10-03)

**Author: Codex.** Generated Vite configurations now enable capability checks
for their selected web adapter and switch to Desktop's HTTP-only profile in
desktop mode. Markdown composition preserves the capability option. Bindings are
not baked into templates.

When explicit binding names are absent, Cloudflare builds load the project's
installed Wrangler parser and read its configuration for `capabilities.environment`
or `CLOUDFLARE_ENV`. Unknown environments fail. Wrangler's non-inherited binding
rules remain authoritative; resource values and variables never leave the helper.
Missing configuration/dependencies and parser errors fail without secret-bearing
configuration excerpts. Node/Deno/Desktop do not load Wrangler for these checks.

Published-export Vite builds prove that root SSE bindings work but do not satisfy
an environment that omits them. Additional real-parser tests cover names-only
output and safe parser errors. Recipe tests cover all adapters with and without
Markdown plus feature addition/removal.

Generated-app validation exposed named HTTP handler files in the route set.
Build discovery now recognizes their named method exports and treats them as HTTP
without requiring component decorators. This also revealed two remaining CLI-04
acceptance gaps: CLI checks still apply component metadata requirements to these
modules, and router selection through the first module export can differ from
inspection's default-export choice. **CLI-04 is reopened; 11/58 tasks are checked.**
Fix these discrepancies before claiming full inspection/runtime parity.

Verification: **92 scaffold tests**, **18 binding/build tests**, and the complete
generated staging deployment/Worker integration passed. The broader CLI run
passed 535 tests and exposed the named-handler build failure; that previously
failing integration passed on its own after correction. Framework declaration
build, root TypeScript, and all **11 package type checks passed**.
**RT-25 remains open.** Next verify complete generated applications through their
actual generated configuration, including Desktop side targets, and add selected
feature requirements to recipe planning where needed. A small Vite transport
fixture is not proof of full application or native packaging compatibility.

<a id="codex-page-capability-discovery-2026-10-03"></a>
### Codex continuation: shared source parser and page capability discovery (2026-10-03)

**Author: Codex.** Moved the CLI's AST page inspection implementation into the
published framework `page-inspection` subpath. The CLI retains a thin re-export,
so build and inspection share option selection, aliases, unknown handling,
default-export facts, and compiler-backed method classification. No application
runtime depends on the CLI or scaffold package.

With `capabilities.runtime` configured, `cossackPages` now derives page transport
requirements automatically from the Vite root's route set. Explicit requirements
remain optional additions. Source parsing never instantiates pages. Dynamic or
unresolved options fail with `COSSACK_CAPABILITY_REQUIREMENTS_UNKNOWN`; generated
Markdown uses its fixed HTTP transport. Build errors identify the authored page
and decorator line. Existing route exclusions also apply to discovery.

Real published-export Vite fixtures prove automatically discovered Desktop SSE
rejection, selected Cloudflare binding requirements, aliased decorators, unknown
options, and non-execution of a throwing page constructor. CLI source-inspection
regressions exercise the moved implementation through its public export.

Verification: complete framework suite **597 passed across 44 files**; complete
CLI suite **536 passed across 38 files**; framework declaration build, root
TypeScript, and all **11 package type checks passed**. Published-export build,
capability, and service acceptance focused suites also passed (23 tests).
**12/58 tasks remain checked; RT-25 remains open.** Next wire runtime/binding selection into recipe
output and resolve selected-environment bindings. Full generated application
build and runtime acceptance still remain; these fixtures prove build checks.

<a id="codex-schedule-capability-2026-10-03"></a>
### Codex review: adapter-dependent schedule capability (2026-10-03)

**Author: Codex.** Auditing Node/Deno adapter source found no scheduled-handler
dispatch, although both profiles advertised it as available. The shared model
now reports `adapter-required` for their scheduled handlers. This differs from
Desktop's unsupported capability and Cloudflare's platform support. Selected
schedule requirements produce `COSSACK_CAPABILITY_ADAPTER_REQUIRED` with the
feature and source location; real Vite builds reject them before output.

This does not introduce a scheduler or a flag that pretends an integration is
installed. Future scheduling work must supply and validate that integration
before the capability can become available. Unrelated HTTP routes remain valid;
CLI summaries show the missing schedule integration without failing those routes.

Verification: shared capability and real-build suites **18 passed**; CLI runtime
metadata and inspection suites **17 passed**; framework declaration build, root
TypeScript, and all **11 package type checks passed**. **12/58 tasks remain
checked; RT-25 stays open.** Next integrate automatic page requirements and
recipe-generated configuration with the build checker. Selected-environment
binding resolution and complete generated-app acceptance are still required.

<a id="codex-capability-build-2026-10-03"></a>
### Codex continuation: selected build capability requirements (2026-10-03)

**Author: Codex.** Added `checkCapabilityRequirements` to the shared runtime
model. Selected feature declarations carry requirements and file/line/column
locations. The checker returns all unsupported or missing-binding diagnostics,
with names only; false requirements are omitted. It is reusable by build and
recipe consumers without importing application modules or Cloudflare APIs.

`cossackPages({ capabilities })` checks those declarations in `buildStart` and
fails before bundle output. Documentation shows explicit runtime, binding names,
and selected feature requirements. Real Vite builds exercise Desktop SSE
rejection, missing Cloudflare SSE bindings, supported HTTP builds on all four
runtimes, and a supported Cloudflare SSE configuration. An unused module importing
`cloudflare:workers` does not enter portable fixture bundles.

This is enforcement of supplied requirements, not automatic discovery. RT-25
remains open: connect scaffold registry selection and generated Vite configs to
this API; derive page requirements from shared compiler metadata; resolve bindings
from the selected environment; audit adapter-dependent capabilities; and verify
complete generated application builds. Do not claim these small build fixtures
prove application transport execution or all package graph boundaries.

Verification: framework declaration build passed; capability/model suite
**15 passed**, including real Vite builds through published package exports;
complete framework suite **590 passed across 44 files**. Root TypeScript and
all **11 package type checks passed**.
**12/58 tasks remain checked.** The full release goal remains active.

<a id="codex-module-inspection-2026-10-03"></a>
### Codex review: module validity and CLI-04 acceptance audit (2026-10-03)

**Author: Codex.** Pages and layouts now expose `moduleExport` facts. Checks fail
for missing default exports or exports that do not resolve to a local class.
Direct, identifier, and local export-clause class defaults resolve without
execution. Dynamic/default factory exports and external re-exports remain
unknown. Inspection stays readable for invalid modules. The no-parser fixture
now covers module facts too.

Dynamic service references (computed properties, optional access, or calls)
produce unknown options. Undecorated derived layouts do not borrow metadata from
a decorated base. Service explanations explicitly identify source expressions
and do not claim to resolve runtime token identity across aliases/imports.

CLI-04 requirement audit:

- Shared model: route commands consume `buildEffectiveRouteModel`; compiler facts
  come from the published security-plugin analysis, recipes from the shared
  scaffold registry, and transport capabilities from the runtime model.
- Facts, diagnostics, explanations: inspection/check commands share that model;
  checks fail on missing or unknown facts, invalid declarations, and unsupported
  or missing-binding transports. Explanations carry source locations and reasons.
- No application execution: inspection fixtures contain throwing constructors;
  source import resolution reads files without loading application modules.
- Combined acceptance: `inspection-acceptance.test.js` covers grouped routes,
  nested layouts, declared services, mixed methods, resource expansion, scaffold
  recipes, and actual compiler stripping output. The companion framework
  `inspection-service-acceptance.test.ts` executes the inspected sources through
  SSG and proves service sharing/shadowing, owner IDs, state, disposal, and
  check/explain behavior against the same project.
- Unsupported cases: parser failure, dynamic options, unresolved inheritance,
  ambiguous source resolution, missing/unknown exports, and dynamic service
  references have explicit unknown facts or source-bearing diagnostics.

This completes CLI-04's inspection/check/explain contract, not the broader
RT-07 typed-route/API generation, RT-24 configuration registry, RT-25 build/recipe
gating, or browser/production runtime release gates. Those tasks stay open.

Verification: complete CLI suite **534 passed across 38 files**; the executed
framework service acceptance fixture passed again; `pnpm tsc --noEmit` passed.
The preceding service checkpoint verified all 11 package type checks; this
checkpoint changes JavaScript and documentation only.

**12/58 tasks are now checked. CLI-04 is complete.** Next continue RT-25
build-time and recipe capability enforcement, reusing the existing runtime
capability model. The full release goal stays active.

<a id="codex-service-inspection-2026-10-03"></a>
### Codex review: executed service inspection acceptance (2026-10-03)

**Author: Codex.** Added a framework/CLI integration fixture that writes grouped
route and nested layout sources, emits those same sources with TypeScript legacy
decorators, and renders them through the real SSG renderer. It verifies inner
layout shadowing, page sharing of the inner instance, owner IDs, per-owner
hydration state, and inner-to-outer disposal. Check and explain commands run
against the same source project. This is actual SSG/bootstrap execution, not a
full Vite application build or browser navigation test.

The fixture confirmed that page-level `services` declarations do not create a
scope in either router or SSG bootstrap. Route checks now fail with
`COSSACK_PAGE_SERVICES_UNSUPPORTED` and explain how to move declarations to a
layout; inspection explains that the page does not own them. A throwing service
constructor proves SSG does not instantiate a service merely listed on the page.

Also fixed selection of the inspected class: indirect local default exports now
select their actual class, even when an exported decorated helper comes first.
Undecorated, dynamic, or external default exports no longer borrow that helper's
options or methods. Regression cases cover both default export syntaxes.

Verification: SSG/service acceptance suites **11 passed**; all **11 package type
checks** and `pnpm tsc --noEmit` passed. Full CLI suite: **517 passed across
37 files**. The service integration test also passed again after the default
export selection fix.

**11/58 tasks remain checked; CLI-04 remains open.** Next audit module validity
(missing default exports still allow syntax-only inspection), inherited layout
options, and service token identity across imports before treating inspection as
complete. Keep browser/SSR lifecycle release gates separate from this SSG test.
RT-25 build/recipe capability gating also remains unfinished.

<a id="codex-inspection-acceptance-2026-10-03"></a>
### Codex review: combined inspection fixture and middleware order (2026-10-03)

**Author: Codex.** Added a combined project fixture covering grouped routes,
nested layouts, declared services, recorded scaffold features, imported base
methods, resource expansion, and mixed client/server methods. Inspection reads a
page whose constructor throws without executing it. The fixture compares method
facts with the published compiler transform and checks that private bodies are
removed while reachable client helpers remain.

The fixture exposed missing layout middleware facts. Inspection now reports
layout/page middleware counts in execution order: outer layouts, inner layouts,
then the page. An unresolved layout keeps the total unknown. Explanations
explicitly exclude global bootstrap middleware from this result.

Verification: focused acceptance/inspection/scanner suite **53 passed**;
`pnpm tsc --noEmit` passed; full CLI suite **512 passed across 37 files**.
The full run also exposed a stale contract test that rejected the now-supported
`inspect routes --env=production`; it now checks rejection of a missing environment
value instead.

**11/58 tasks remain checked; CLI-04 remains open.** This fixture validates
compiler output and static declarations, but does not instantiate a complete
application to verify service ownership and DI/bootstrap behavior. GLM should
extend it with real layout/page service resolution, compare the reported owners
with executed behavior, and exercise check/explain diagnostics on the same
project. Keep unsupported project resolution explicit; do not equate declared
member precedence with constructor or decorator side effects. RT-25 still needs
build/recipe capability gating. No release versions changed.

<a id="codex-inherited-options-2026-10-03"></a>
### Codex review: inherited options and action receivers (2026-10-03)

**Author: Codex.** Core timeout lookup, component proxy/bootstrap metadata, and
service bootstrap/disposal previously read only the nearest server-method map.
They now share a hierarchy collector that retains inherited declarations,
preserves their timeout/channel/provider/input options, and lets the nearest
explicit method declaration win without mutating ancestor maps. Compiler-generated
registration also copies inherited options instead of replacing them with default
channel/provider metadata.

A real derived component dispatched through `InMemoryWebSocketRuntime` exposed
another bug: an inherited state-changing action was invoked without its component
receiver because only the nearest prototype had been auto-bound. RPC execution
now applies the action with the component receiver. The regression proves
inherited input validation, ordinary state mutation, and successful results when
the child owns an unrelated server-method map. A separate loopback regression
proves inherited timeout enforcement for a derived client metadata map.

Verification: complete core suite **673 passed**; complete framework suite
**581 passed**; core build, framework declaration generation, root TypeScript,
and all **11 package type checks passed**. The compiler
execution fixtures also verify inherited channel/timeout retention for server and
client output, while unit metadata tests verify nearest-declaration precedence
and ancestor isolation.

**11/58 tasks remain checked.** These fixes improve actual inheritance behavior;
they do not by themselves complete CLI-04's grouped-route/layout/service acceptance,
full DI/bootstrap lifecycle, or remaining runtime/release requirements. Continue
that acceptance fixture using the shared compiler/scaffold/runtime model.

<a id="codex-inherited-rpc-2026-10-03"></a>
### Codex review: inherited compiler RPC registration (2026-10-03)

**Author: Codex.** Executing compiled inheritance fixtures exposed a runtime bug
that text assertions missed: registration inserted before `super()` accessed
`this.constructor`, which throws in derived constructors. Generated constructors
also dropped arguments, and child automatic RPC registration omitted base-class
methods.

Registration now uses `new.target`, which is valid before `super()`, so the full
derived registry is available during base construction. Generated constructors
forward arguments. Static registration chains through the superclass before
adding local methods, preserving child metadata without contaminating the
parent's own registry.

The new tests run both server and client compiler output through Vite's TypeScript
transform, execute explicit and generated derived constructors, verify arguments
and registration during base construction, and call inherited/local server bodies
or client proxies. Parent metadata remains independent. These fixtures prove
compiler registration behavior; they are not a full Cossack bootstrap/DI test.

Verification: focused compiler suite **154 passed**; complete framework suite
**581 passed**; declaration generation, root TypeScript, and all **11 package type
checks passed**.

**11/58 tasks remain checked; CLI-04 remains open.** Next verify inherited
per-method options and actual framework bootstrap/dispatch. In particular,
`serverMethodTimeout` still reads the nearest `Reflect.getMetadata` map; inherited
options must be checked when a derived class owns another metadata map. Then
complete the grouped-route/layout/service acceptance fixture and remaining gates.

<a id="codex-runtime-inspection-2026-10-03"></a>
### Codex continuation: binding-aware transport inspection (2026-10-03)

**Author: Codex.** Published the shared runtime-capability module and included it
in declaration generation. Corrected its transport model: Node/Deno support the
`durable-object` transport through process-local adapters, while durable
cross-instance coordination remains unsupported. Requested transports are now
actually evaluated. Cloudflare SSE and Durable Object transports require
`COSSACK_SSE` and `COSSACK_OBJECT`, respectively; HTTP requires neither.

Route listing, inspection, checks, and explanations consume this model. Runtime
selection reuses scaffold detection. Cloudflare binding names come from the
existing Wrangler-backed deployment inspector. `--env` or `CLOUDFLARE_ENV`
selects the configuration environment. Missing route bindings and unsupported
transports produce failing diagnostics. Unreadable bindings remain unknown;
an undetected runtime is not guessed. Only binding names are passed to capability
evaluation; configuration values and raw parser errors are excluded.

Results explicitly describe configuration presence, not provisioned remote
resources, correct adapter installation, durable Node/Deno state, or successful
runtime execution. General capability summaries do not replace per-route checks.

Verification:

- Runtime capability suite: **7 passed**.
- Six CLI inspection/route/command/subprocess suites: **110 passed**.
- Final metadata/inspection suites: **15 passed**, including a new real Wrangler
  parser fixture proving named-environment non-inheritance and redeclared SSE
  binding availability, plus the route explanation result.
- Framework declaration generation, root TypeScript, and all **11 package type
  checks passed**. The initial CLI run caught the missing declaration-build entry;
  that packaging omission was fixed before the successful runs above.

**11/58 tasks remain checked.** CLI-04 now has shared compiler, scaffold, and
runtime transport facts, but its full grouped-route/layout/service acceptance
and actual inherited framework RPC behavior still need verification. RT-25 remains
open for build-time and recipe gating. Continue those requirements; do not infer
remote deployment readiness from local binding presence.

<a id="codex-declaration-dispatch-2026-10-03"></a>
### Codex continuation: declared member precedence (2026-10-03)

**Author: Codex.** Effective route inspection now includes `declarationDispatch`,
using compiler member facts across local and imported bases. It resolves child
prototype overrides, same-class getter/setter pairs, replacement of inherited
accessor descriptors, and instance fields that shadow prototype members. Derived
fields replace base fields. Static/private members are excluded. Entries identify
the declaring class and source file.

Tests compare these precedence rules with actual JavaScript class instances,
including a base field shadowing a child method and a child setter removing an
inherited getter. A compiler-backed imported-base route fixture verifies model
integration. Erased TypeScript `declare` fields do not participate. Constructor
parameter properties, computed names, missing member facts, and unresolved bases
produce unknown results. `check routes` fails with
`COSSACK_ROUTE_DISPATCH_UNKNOWN` when declaration precedence is unknown.

This is explicitly declaration precedence, not proof of constructor, decorator,
initializer side effects, later property mutation, or framework RPC installation.
Those runtime effects must not be inferred from a resolved static result.

Verification: compiler suite **150 passed**; dispatch/route/inspection suites
**55 passed**; declaration generation, root TypeScript, and all **11 package type
checks passed**. The complete CLI subprocess suite passed **38 tests**, including
failing diagnostics for unknown declared precedence.

**11/58 tasks remain checked; CLI-04 remains open.** Next integrate binding-aware
capabilities and verify the complete grouped-route/layout/service fixture,
including actual framework inherited RPC behavior and explicitly unsupported
runtime mutations. Static declaration precedence now has runtime-language tests;
the larger framework acceptance requirement remains open.

<a id="codex-member-facts-2026-10-02"></a>
### Codex continuation: compiler member facts for dispatch (2026-10-02)

**Author: Codex.** Added compiler member inventory to own and inherited route
metadata. Members distinguish ordinary methods, fields, getters, setters,
static members, private names, and unknown computed names. The inventory uses
expanded compiler classes: a `server$` field becomes a getter rather than being
misrepresented as an instance field. Imported base declarations retain their
member inventory through source resolution.

This is necessary input to effective dispatch resolution. A base instance field
can shadow a child prototype method; choosing the nearest method name alone is
incorrect. No effective runtime dispatch claim is made yet. GLM should use these
facts to resolve field/prototype precedence, getter/setter behavior, overrides,
and unknown computed members, with runtime fixtures verifying the results.
Constructor or runtime mutation effects must remain explicitly outside any
unproven static result.

Verification: compiler suite **149 passed**, route suites **40 passed**,
framework declaration generation, root TypeScript, and all **11 package type
checks passed**. **11/58 tasks remain checked; CLI-04 remains open.** Binding-aware
capabilities and the complete inspection acceptance fixture also remain open.

<a id="codex-inspection-integration-2026-10-02"></a>
### Codex verification: inspection integration checkpoint (2026-10-02)

**Author: Codex.** Ran broader workspace validation after `81ff48a` rather than
relying only on focused compiler/CLI suites. Package type checking caught five
unsafe accesses in the new inheritance test assertions. Optional access now
allows the expected-value assertions to fail normally for a missing class while
satisfying strict TypeScript. The full CLI suite also caught one expectation for
wording from the removed syntax scanner; it now checks the shared compiler's
explicit-server reason while retaining its RPC/local-method assertions.

The root solution-style `pnpm tsc --noEmit` alone does not check package test
files. Keep running `pnpm typecheck` as part of workspace verification.

Final verification:

- `pnpm build`: passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all **11 package configurations passed** after the assertion fix.
- `pnpm run test:unit`: **2,492 tests passed across 13 packages** on the clean rerun, including all **499 CLI tests** and **573 framework tests**.
- Focused route explanation suite: **10 passed** after correcting the old wording expectation.

Logs: `/tmp/cossack-inspection-workspace-build.log`,
`/tmp/cossack-inspection-root-types-final.log`,
`/tmp/cossack-inspection-package-types-final.log`, and
`/tmp/cossack-inspection-workspace-unit-final.log`.
No browser, generated-app tarball matrix, or workerd acceptance suite was rerun
for this checkpoint; those results are not inferred from the unit suite.
**11/58 tasks remain checked.** This checkpoint does not complete CLI-04 or
REL-03: inherited dispatch, binding-aware capabilities, complete inspection
acceptance, generated applications, and relevant browser/runtime release gates
remain open. The CLI-04 checklist row now reflects implemented scaffold recipe
and relative base-declaration inspection rather than its older partial state.

<a id="codex-imported-inheritance-2026-10-02"></a>
### Codex continuation: relative imported base declarations (2026-10-02)

**Author: Codex.** Added source-only resolution for relative TypeScript imports,
named/default exports, import aliases, and explicit re-export chains. Base
methods retain compiler classification, declaring class, resource identity, and
project-relative source locations. The resolver reads source rather than loading
modules; a subprocess fixture deliberately throws at module scope and still
resolves its declarations successfully.

Cycle detection prevents recursive export/base chains from looping. Missing
files, package imports, namespace imports, wildcard exports, path aliases,
dynamic bases, and ambiguous extensionless candidates remain unresolved.
`.js` imports map to `.ts` source and `.mjs` to `.mts`; the resolver does not guess
between competing extensionless candidates. Checks retain explicit diagnostics
for unresolved cases. Known partial declarations may still be inspected.

Verification: route suites **40 passed**; focused base-resolution subprocess
tests and root TypeScript checks passed. This adds declaration resolution, not
an effective inherited runtime dispatch model. **11/58 tasks remain checked.**

GLM continuation: finish override/field/accessor dispatch semantics, extend
resolution only where compiler/project configuration supports it, integrate
binding-aware runtime capabilities, and prove CLI-04's full acceptance fixture.

<a id="codex-local-inheritance-2026-10-02"></a>
### Codex continuation: local inheritance declarations (2026-10-02)

**Author: Codex.** Compiler inspection now reports local base-class chains and
whether the declarations resolve within the source file. Framework root aliases
and namespaces are recognized; cycles, dynamic bases, and imported bases that
need project resolution remain unresolved. CLI route facts include base methods
grouped by declaring class with compiler classification and authored locations.
Own methods remain separate. This deliberately does not claim an effective
runtime dispatch table: instance fields, accessors, and overridden methods still
need explicit resolution semantics and verification.

Route explanations include the base declarations. `check routes` emits
`COSSACK_ROUTE_INHERITANCE_UNKNOWN` for unresolved bases, without loading imports
or executing application code. Local declaration resolution does not change the
readiness statement that inherited runtime behavior remains unchecked.

Verification: compiler suite **148 passed**; route suites **38 passed**;
framework declaration generation and root TypeScript checks passed.
CLI subprocess suite: **36 passed**, including unresolved imported-base checks.

**11/58 tasks remain checked; CLI-04 remains open.** Next resolve imported bases
using source modules and exports, account for overrides/fields/accessors without
inventing dispatch facts, and integrate binding-aware capabilities. Then run the
complete grouped-route/layout/service acceptance fixture from the plan.

<a id="codex-scaffold-inspection-2026-10-02"></a>
### Codex continuation: shared scaffold recipe inspection (2026-10-02)

**Author: Codex.** Exposed `resolveManifestRecipe` from scaffold and reused it in
composition and CLI project inspection. Schema-v3 recorded recipes now resolve
through the actual registry, including transitive feature requirements and
provider/runtime compatibility. Effective route JSON includes these scaffold
facts. Unknown fields, secrets, file contents, and dependency baseline values
are not emitted.

Missing manifests are `unrecorded`; invalid JSON, unsupported schemas, and
invalid recipes are `invalid`. Invalid metadata produces
`COSSACK_SCAFFOLD_METADATA_INVALID` and makes `check routes` fail. Inspection
can still return available route facts. These are recorded recipe facts, not
proof that generated files remain unchanged or that bindings are available.

Verification:

- Complete scaffold suite: **89 passed**, covering composition after extraction.
- CLI metadata/route/subprocess suites: **75 passed**.
- Final metadata suite: **4 passed**, including the added effective-model integration case.
- `pnpm tsc --noEmit`: passed.

**11/58 tasks remain checked; CLI-04 remains open.** GLM should now finish
inheritance resolution, runtime capability evaluation using actual binding
metadata, and the complete grouped-route/layout/service acceptance fixture.
Recipe inspection is integrated; runtime capability gating and recipe completion
under CLI-05/RT-25 still remain separate unfinished requirements.

<a id="codex-resource-inspection-2026-10-02"></a>
### Codex continuation: authored resource inspection (2026-10-02)

**Author: Codex.** `server$` expansion now records generated method names,
resource names, and authored loader offsets. Inspection analyzes the expanded
class with the compiler classifier, then maps both generated resources and
ordinary methods back to authored source. Field resources, inline render
resources, and named import aliases are covered. Comment text containing
`server$` no longer makes inspection unavailable. Unsupported macro declarations
still produce unknown diagnostics without source excerpts or loader bodies.

CLI inspection passes the absolute file ID used for generated resource hashes,
while presenting project-relative source locations. `check routes` accepts valid
resources; a subprocess fixture compares the generated name against compiler
metadata for that exact file and confirms private loader text is absent.

Verification:

- Framework security-plugin suite: **147 passed**.
- CLI route, unavailable-parser, and subprocess suites: **72 passed**.
- Focused generated-resource identity subprocess check: passed after the file-ID correction.
- Framework declaration generation and root TypeScript check: passed.

**11/58 tasks remain checked; CLI-04 remains open.** Resource source mapping is
now implemented for the compiler's supported macro forms. GLM should continue
project inheritance resolution and scaffold/capability integration, then verify
the full grouped-route/layout/service acceptance fixture. Historical notes that
all macros yield unknown metadata are superseded by this checkpoint.

<a id="codex-parser-unavailable-2026-10-02"></a>
### Codex continuation: remove heuristic route facts (2026-10-02)

**Author: Codex.** Effective route inspection no longer falls back to regex
extraction when the TypeScript parser is unavailable. Pages and layouts report
unknown options with a parser-unavailable reason, retaining null/empty values
instead of guessed transport, SSG, and services. The standalone legacy helper
remains available, but the effective project model does not consume it.

Verification: route suites passed **37 tests**, including a mocked unavailable
parser with plausible decorator text in both a page and layout. `pnpm tsc
--noEmit` passed. CLI-04 remains open for project inheritance, macro source
mapping, and scaffold/capability integration. **11/58 tasks remain checked.**

<a id="codex-static-options-2026-10-02"></a>
### Codex review: truthful static option extraction (2026-10-02)

**Author: Codex.** Fixed static inspection reporting `ssg: { ...settings }` as
enabled and coercing invalid scalar SSG values to false. Nested spreads and
computed SSG keys now produce unknown metadata. Boolean SSG values and string
transport values are required for resolved facts. Duplicate static `enabled`
keys use the last value, matching JavaScript. Sparse middleware arrays no longer
produce a misleading known count. These unknown results feed the existing
failing `check routes` diagnostics.

Verification: `pnpm --filter cossack exec vitest run tests/scan-routes.test.js`
passed **36 tests**, including eight unresolved/invalid option cases and duplicate
key behavior. `pnpm tsc --noEmit` passed.

**11/58 tasks remain checked.** CLI-04 still requires project inheritance,
macro source mapping, and scaffold/capability integration; this correction does
not complete it. GLM should continue those requirements from the detailed plan.

<a id="codex-namespace-methods-2026-10-02"></a>
### Codex review: namespace method decorators (2026-10-02)

**Author: Codex.** Found a compiler/inspection mismatch during CLI-04 work:
namespace `@Core.Page` decorators discovered framework classes, but method
classification did not normalize `@Core.Server` or `@Core.Client`. A server
function field could consequently retain its implementation in the browser,
and ordinary server methods lacked explicit RPC classification.

Method collection now resolves named and namespace decorator imports from the
AST before classification. Both compilation and the shared inspection API use
these normalized facts. Tests verify retained client methods, stripped server
methods/function fields/input validators, RPC proxies, rejection of unsupported
server accessors, and route inspection through the published compiler export.
Computed decorator syntax was excluded after the parser rejected the attempted
fixture; this change claims ordinary namespace member decorators only.

Verification:

- Framework security-plugin suite: **145 passed**.
- CLI route-model suite: **27 passed**.
- Framework declaration generation and `pnpm tsc --noEmit`: passed.

**11/58 tasks remain checked; CLI-04 remains open.** GLM should continue inherited
project facts, macro source mapping, and scaffold/capability integration. This
fix is necessary compiler parity, not proof of complete project inspection.

<a id="codex-route-checks-2026-10-02"></a>
### Codex continuation: static route checks (2026-10-02)

**Author: Codex.** Added `check routes` to shared command metadata and dispatch.
The command consumes the same route/compiler model as inspection. Unknown page
or layout options, unavailable method classification, and invalid transports
produce stable source-bearing diagnostics and a failing exit code. All four
core transports are accepted. Inspection remains available for failed inputs.
Neither command executes application constructors or server methods.

The JSON readiness fields state the scope explicitly: static metadata is
validated; inheritance and runtime behavior are not checked. CLI-04 remains
open for the complete project model, inherited declarations, macro source maps,
and scaffold/capability integration. **11/58 tasks remain checked.**

Verification:

- `pnpm --filter cossack exec vitest run tests/cli-subprocess.test.js`: **34 passed**, including successful checks for all transports, non-executed constructors, failing dynamic/layout metadata, unsupported macros, and scoped flag rejection.
- `pnpm --filter cossack exec vitest run tests/command-spec.test.js`: **17 passed**.
- `pnpm tsc --noEmit`: passed.

GLM should continue the unresolved project-model requirements rather than treating
this command as full route correctness validation. The public CLI guide documents
the same limits. Full release gates were not rerun for this CLI-only change.

<a id="codex-compiler-facts-2026-10-02"></a>
### Codex continuation: compiler-backed own-method inspection (2026-10-02)

**Author: Codex.** After `29475c9`, extracted the common class analysis used by
client stripping and server automatic-RPC registration. The public
`inspectCompilerMethods` export uses that analysis and the same built-in policy.
It returns own-method body retention, RPC registration, classification reasons,
and authored body locations without executing application code.

Route inspection now consumes this export instead of independently interpreting
method decorators. `serverMethods` contains RPC methods, `clientMethods` contains
retained implementations, and `strippedMethods` identifies methods that have no
RPC registration. Exported page selection still excludes unrelated classes.
Parser failures, unsupported server declarations, unavailable compiler exports,
and resource macros without source maps produce unknown results. These are
file-level facts: inherited methods are explicitly outside the current result.

**GLM continuation:** finish CLI-04's project-level model. Resolve inheritance,
map macro-generated methods to authored locations, join scaffold recipes and
runtime capabilities, add route checks, and prove the grouped-route/layout/service
fixture in the detailed plan. Do not mark CLI-04 done from own-method parity.
The earlier compiler-preservation note remains relevant, but its first three
implementation steps now have this shared-analysis foundation.

Validation:

- `pnpm --filter @cossackframework/framework exec vitest run tests/vite-security-plugin.test.ts`: **143 passed**, including compiler/transform parity and unknown-input fixtures.
- `pnpm --filter @cossackframework/framework exec tsc -p tsconfig.declarations.json`: passed; generated the published metadata export used by CLI tests.
- `pnpm --filter cossack exec vitest run tests/scan-routes.test.js tests/cli-subprocess.test.js`: **57 passed**, including exported-page selection and actual compiler-backed route classification.
- `pnpm tsc --noEmit`: passed after CLI integration.

**11/58 tasks remain checked; CLI-04 remains open.** No release versions were
changed. Full workspace/runtime release gates were not rerun for this slice.

<a id="codex-compiler-preservation-2026-10-02"></a>
### Codex review: deep client helper preservation (2026-10-02)

**Author: Codex.** Reviewed the compiler classification used as the foundation
for CLI-04 after `cd9f489`. Found that `computePreservedSet` stopped after three
rounds. A client lifecycle method calling a longer helper chain therefore had
reachable helpers replaced by server stubs. The existing test explicitly
accepted the depth limit rather than testing complete reachability.

Replaced the cap with a finite worklist. Each reachable method is visited once;
cycles terminate, and explicit `@Server` methods remain RPC boundaries. Their
bodies and helpers reached only through those bodies remain stripped. The same
function feeds client transforms and automatic server method registration.
The regression fixture covers a five-helper chain, a cycle, and a server-only
branch in one class.

Verification:

- `pnpm --filter @cossackframework/framework exec vitest run tests/vite-security-plugin.test.ts`: **139 passed**.
- `pnpm tsc --noEmit`: passed.

**Status: 11/58 checked; no additional task completed.** CLI-04 remains open.
This focused correction does not establish compiler/inspection parity or replace
release-wide checks. User changes to `reports.md` and `.zcodeignore` are excluded.

**GLM next steps for CLI-04:**

1. Extract a shared per-class analysis from the security compiler. Both transforms
   and inspection must consume it, including preserved methods, explicit and
   automatic RPC registration, stripped methods, and retained function fields.
   Share the built-in method policy; do not create another decorator-only scanner.
2. Export analysis through the existing framework security-plugin subpath. Retain
   source positions and reasons, and account for `server$` transformations without
   presenting generated offsets as authored source locations.
3. Replace `extractMethodClassificationsFromAst` in the CLI with these facts.
   Resolve supported inheritance and report unresolved imported/dynamic cases
   explicitly. Do not execute project classes to infer behavior.
4. Join compiler facts with route/layout ancestry and scaffold recipe/capability
   metadata. Keep unknown options unknown; a regex fallback cannot prove facts.
   Add route checks with failing exit codes alongside inspection/explanation.
5. Prove parity using a grouped-route fixture with nested layouts, services,
   inheritance, function fields, automatic RPC, deep helper chains, and unsupported
   syntax. Only then evaluate CLI-04's complete acceptance criteria in the plan.

<a id="codex-cli-upgrades-2026-10-02"></a>
### Codex continuation: complete release-aligned upgrade plans (2026-10-02)

**Author: Codex.** Continues the unfinished release after `eea3dad`.
**CLI-06 is complete: 11/58 tasks checked.** The other 47 tasks remain in scope;
package versions remain 0.8.3 until the release gates pass.

**Problems fixed and acceptance evidence:**

- Upgrade previously emitted empty dependency addition/removal lists and used
  the installed CLI's templates even when another release was requested.
  `upgrade-scaffold.js` resolves the target scaffold version, reuses the installed
  package only for that same version, or installs the exact foreign version into
  temporary storage with pnpm lifecycle scripts disabled. It validates package
  identity and the ESM import entry, then removes temporary storage on completion
  or load failure. It never falls back to current templates for an unavailable
  release. Application files stay unchanged during planning/dry runs; pnpm can
  populate its cache.
- Scaffold manifests now record `dependencyBaseline` independently of merged
  application package contents. `planDependencyChanges()` compares recorded,
  current, and desired values across dependency sections. It updates/removes
  unchanged owned entries and adds new target entries, including section moves.
  Local pins, intentional deletions/moves, and user-added dependencies remain
  preserved conflicts where applicable. A matching pre-existing dependency does
  not become owned merely by matching a recipe. Adapter force remains explicit.
- Creation, composition, removal, and adapter switching retain this ownership.
  Source-only composition keeps the baseline even when package.json is unchanged.
  Current-version legacy manifests can reconstruct it locally. For a different
  legacy version, composition requires `cossack upgrade` first; upgrade loads the
  recorded exact release to reconstruct ownership and labels its source in JSON.
  Missing/invalid ownership metadata never silently becomes an unmanaged upgrade.
- Plans expose old/new dependency values, additions/removals, preserved edits,
  conflicts, file writes/deletions, manifest effects, build-setting migration,
  installation requirements, and next actions. Follow-up template commands pin
  the resolved version. Human dry runs show dependency decisions as well as files.
  Custom URL/path dependency specifiers are redacted from machine plans.
- Applying templates removes obsolete unchanged owned files. Edited auth modules
  and edited obsolete files remain intact. Package/runtime configuration and local
  secret files cannot be overwritten by `--force-file`. Invalid paths and symbolic
  links in owned paths fail before effects. Owned files and the ownership manifest
  are checked again after package resolution to reject stale plans.
- Installation failure retains the applied dependency/file/manifest changes in
  the result with a retry action. JSON hides package-manager output; human mode
  exposes underlying download/install diagnostics. Successful repeat upgrades
  produce no new filesystem effects or unnecessary installation.

**Acceptance tests:** `upgrade-release.test.js` contains ten subprocess cases,
including dry-run snapshots, requested-version files/dependencies, additions and
removals, edited authentication, obsolete files, repeat snapshots, legacy ownership,
missing releases, stale manifests, unsafe force paths, malformed JSON, symbolic
links, private specifiers, and installation failure. Its local-registry case uses
**real pnpm** to download an ESM-only tarball with integrity metadata; other cases
control package installation to test its failure/results deterministically.
The fixture uses `pnpm_config_registry`, as required by pnpm 11. Seven new scaffold
ownership tests cover merge behavior and composition. Existing upgrade/subprocess
tests continue to exercise explicit file replacement and stale source plans.

**Verification:**

- `pnpm build`, `pnpm tsc --noEmit`, and `pnpm typecheck` pass; package type
  checks cover all 11 configurations.
- `pnpm test:unit`: **2,455 passing tests in 13 packages**, including CLI
  **474 tests in 32 files**, scaffold 86, auth 118, database 84, renderer 256,
  core 669, node-adapter 10, test-utils 8, UI 112, framework 564,
  deno-adapter 3, desktop 16, and Studio 55.
- The final scaffold run passes **89 tests**, including three ownership edge
  cases added after its portion of the root run. The focused CLI matrix passes
  **67 tests in three files**, including the real package-download case and
  human/JSON failure diagnostics. The last stale-plan guard check passes both
  source/manifest regressions; it retains the first package/workspace baselines
  when collecting owned paths. Root `pnpm tsc --noEmit` was repeated afterward
  and passes. Together the final suites cover **2,458 distinct tests**.
- `git diff --check -- docs packages specs`: passes.

Logs use the `/tmp/cossack-upgrade-` prefix: `workspace-build.log`,
`root-types.log`, `package-types.log`, `workspace-unit.log`, `scaffold-final.log`,
`cli-final.log`, `stale-final.log`, and `root-types-final.log`. No browser suite, complete platform
matrix, or full published application tarball matrix was repeated. The local
registry tarball test verifies the upgrade loader, not REL-02's entire matrix.
REL-02/03/05 remain open. No deployment, push, or publication occurred. Preserve
the user's `reports.md` and `.zcodeignore`.

**GLM continuation:** next finish **CLI-04**. Replace the separate syntax-only
inspection decisions with compiler-owned classification and scaffold recipe
metadata. Prove that inspection matches emitted server proxies, transitive client
preservation, inherited declarations, effective layout ownership, and unknown
dynamic declarations. Return source locations and reasons without executing
application constructors. Then complete **CLI-05/RT-25** recipes/capabilities
against generated applications. Keep the existing Group 3 runtime acceptance
gaps and all 47 unchecked tasks in scope; this checkpoint is not the release.

<a id="codex-cli-json-2026-10-02"></a>
### Codex continuation: complete JSON command contracts (2026-10-02)

**Author: Codex.** Continues the review of GLM's implementation and the CLI-02
checkpoint `f30a5a7`. **CLI-03 is complete: 10/58 tasks checked.** The other 48
tasks remain in scope; package versions remain 0.8.3.

**Problems fixed and acceptance evidence:**

- ORM package imports could print before the database tooling's own isolation
  began. Generic scaffold/parser and ORM exception messages could expose project
  values. Every JSON CLI execution now runs in `json-runner.js`, supervised by
  `json-process.js`; raw stdin/stdout/stderr are detached from the protocol.
  Validated framework envelopes cross IPC. Finite results are published only
  after validating both the terminal envelope and process exit.
- Premature exit, missing/duplicate/malformed ORM results, mismatched exit
  codes, and hung project imports now produce one coded failure instead of
  silent success or contaminated output. Canonical command names also cover
  aliases, top-level help/version, and unknown colon-form commands.
- `dev` and `start` now support JSON execution. Their `started` event confirms
  process creation and supplies a PID/tool, without claiming HTTP readiness.
  Clean exits and requested graceful stops emit `stopped`; spawn/runtime/forced
  shutdown errors emit `failed`. Studio retains its ready/stopped/failed contract
  with an explicit tsx loader in its isolated child.
- Finite commands default to a five-minute wall deadline, configurable with
  `COSSACK_COMMAND_TIMEOUT_MS`. Dev/start have a 30-second startup bound; Studio
  retains its configurable readiness timer. Once started/ready, servers run until
  stopped. Signal handling bounds shutdown and reclaims the POSIX process group;
  Windows uses taskkill. Native Windows execution was not tested on this Linux host.
- ORM results retain public target identity and canonical `seeder`/`data.action`.
  Only documented identity fields enter `resolvedTarget`; extra factory fields
  are excluded. Error codes retain known ORM error classes, while messages omit
  application exceptions, connection values, SQL details, and parser excerpts.
  `data.phase` distinguishes configuration, connection, operation, and cleanup;
  human output retains full diagnostic chains.
- Results include affected paths/targets and follow-up actions where available.
  Create/add/remove expose next actions; partial command failures retain recorded
  effects. Noninteractive defaults and explicit choices are documented. Info
  accepts only version-shaped package-manager output.
- The new 43-test subprocess matrix complements existing command-contract,
  subprocess, database integration, and generated-app tests. It checks actual
  filesystem effects and unchanged snapshots for file dry runs, successful and
  failing configuration/ORM paths, top-level import logs, malformed protocols,
  noisy package managers, deadline validation, and servers that ignore termination.
  Lifecycle fixtures prove the server body ran before requesting cancellation.
  The deploy fixture uses actual Wrangler type generation and local deployment
  dry-run with a controlled Vite build fixture; the existing generated-app tests
  exercise real Vite/workerd. The image fixture uses a controlled converter.

**GLM continuation:** next finish **CLI-06**. Track owned dependency additions
and removals in the scaffold manifest; render against the requested target
version rather than the installed CLI's templates. Prove add/remove/preserve
decisions, edited and user-added dependencies, stale plans, and partial install
failure recovery in generated applications. Then finish **CLI-04** from compiler
classification and **CLI-05/RT-25** from shared recipe/capability metadata. Reuse
the JSON process boundary; handlers must return only intentional public metadata.
Do not mark any runtime or release gate complete from this CLI checkpoint.

**Verification:**

- `pnpm build`: passes.
- `pnpm tsc --noEmit`: passes.
- `pnpm typecheck`: passes, all 11 package configurations.
- `pnpm test:unit`: **2,440 passing tests in 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 463, framework 564, deno-adapter 3, desktop 16,
  Studio 55. The CLI result includes the final **43** machine-matrix tests
  and existing local generated-app Vite/workerd integration tests.
- Earlier focused ORM tooling run: **25 passing tests**. The focused native
  local deployment/image run passed before the final matrix additions.
- `git diff --check -- docs packages specs`: passes.

Logs: `/tmp/cossack-cli-json-workspace-build.log`,
`/tmp/cossack-cli-json-root-types.log`, `/tmp/cossack-cli-json-package-types.log`,
and `/tmp/cossack-cli-json-workspace-unit.log`. No browser suite or complete
published-tarball/platform matrix was repeated. REL-02/03/05 remain open for
the full release. The local Wrangler dry-run performed no remote upload or
provisioning. No push or publication occurred. Preserve the user's `reports.md`
and `.zcodeignore`.

<a id="codex-cli-metadata-2026-10-02"></a>
### Codex continuation: complete CLI validation metadata (2026-10-02)

**Author: Codex.** Continues the review and fixes in `3731dbb` and the
implementation checkpoint `01c3c4b`. **CLI-02 is complete: 9/58 tasks checked.**
The other 49 tasks remain in scope; versions remain 0.8.3.

**Problems fixed and acceptance evidence:**

- Create, migration, seeder, schema, and Cloudflare inspection could bypass
  shared option validation. Database wrappers could import project tooling
  before rejecting invalid options. All commands now validate before dispatch
  and direct calls also use shared preflight validation.
- `src/command-specs.js` owns accepted flags, types, aliases, repeats, scoped
  options, positional counts, choices, and constraints. Parser and generated
  help use that metadata. Recipe choices/runtime compatibility come from the
  scaffold's pure `@cossackframework/scaffold/registry` export with declarations.
  Libraries do not import the CLI.
- Boolean repeats using the same spelling explicitly use the last value.
  Contradictory canonical/alias values fail; identical aliases are accepted.
  Scalars reject repeats; supported lists and `--force-file` retain order.
  Short inline boolean values such as `-f=false` work. Separate flag-looking
  values fail; inline values such as `--title=--literal` work. `--` ends parsing.
- Local/remote/target conflicts, explicit runtime/provider incompatibility,
  remote Studio with a non-D1 driver, page-only generation options on other
  types, and options used on the wrong database subcommand fail before effects.
  Language commands reject extra arguments, conflicting locales, and locale
  path traversal. Default-locale errors use the JSON formatter.
- Vite lifecycle forwarding and help remain read-only. Help supports explicit
  booleans, command aliases, and metadata-generated scoped options. JSON
  validation retains all diagnostics and supported alternatives without echoing
  invalid values.
- `command-contracts.test.js` adds **92 tests**, including actual subprocesses
  for invalid booleans across all 23 commands, unknown options across all 19
  non-forwarding commands, command aliases, and incompatible/scoped inputs.
  Those subprocess fixtures contain malformed private project data; results
  must be one JSON envelope, empty stderr, and no files created or changed.
  Three additional fixtures declare real importable ORM modules with filesystem
  and console effects; invalid scoped options must never import those modules.
  Existing actual ORM and deployment integration tests remain part of the CLI
  suite.

**Intentional alpha changes:** unknown/missing/repeated options now receive the
shared `COSSACK_OPTION_*` / `COSSACK_ARGUMENT_*` codes. Removed generate options
`--tag`, `--database`, `--dialect`, and `--yes`, which were accepted but ignored.
Direct command APIs take parsed flags in `ctx.flags`; lang no longer reparses
inline argv. CLI inline flags continue to work through the shared parser.
Studio's remote forwarding fixture now uses D1 instead of an invalid Postgres
combination.

**GLM continuation:** next finish **CLI-03**, using this metadata and the existing
subprocess fixtures. Add success/failure/dry-run coverage for every meaningful
command family. Audit raw project/parser errors, especially project ORM imports;
do not include secrets or project logs in JSON. Long-running commands must have
an explicit structured event or unsupported-mode contract. Keep the full
acceptance criteria in the detailed plan. Then finish CLI-06's dependency
ownership and target-version templates, CLI-04's compiler classification, and
CLI-05/RT-25's recipes/capabilities. Do not re-check these partial tasks merely
because helper APIs or tests exist. The earlier Group 3 review still records
the runtime tasks needing completion.

**Verification:**

- `pnpm build`: passes.
- `pnpm tsc --noEmit`: passes.
- `pnpm typecheck`: passes, all 11 package configurations.
- `pnpm test:unit`: **2,394 passing tests in 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 417, framework 564, deno-adapter 3, desktop 16,
  Studio 55. The final CLI package run also covers the three additional
  project-import regressions added after its portion of the root run.
- `pnpm --filter cossack test`: **420 passing tests in 30 files**, including all
  **92** metadata-contract tests and the final project-import regressions.
- Focused metadata/dispatch/Studio checks before those last regressions:
  **128 passing**. Scaffold package: **82 passing**.
- `git diff --check -- docs packages specs`: passes.

Logs: `/tmp/cossack-cli-metadata-build.log`, `root-tsc.log`,
`package-types.log`, `unit.log`, and `cli-final.log`, each latter filename
with the same `/tmp/cossack-cli-metadata-` prefix. No browser suite or complete
tarball/generated-app matrix was repeated; prior runtime/browser results remain
in the preceding checkpoint. REL-02/03/05 stay open. No deployment, push, or
publication was run. Preserve the user's `reports.md` and `.zcodeignore`.

<a id="codex-continuation-2026-10-02"></a>
### Codex continuation: development upgrades and machine contracts (2026-10-02)

**Author: Codex.** Continued the unfinished release after review checkpoint
`3731dbb`. The full 58-task objective remains active. **8/58 tasks remain
checked**; the changes below complete useful slices, not whole-task acceptance.
Versions remain 0.8.3. Preserve the user's `reports.md` and `.zcodeignore`.

1. **Development WebSockets.** The previous Miniflare assertion was triggered
   by framework asset middleware probing ASSETS with an Upgrade request before
   `/ws` dispatch. The Vite plugin implements this binding as an HTTP Node
   middleware bridge. Upgrade requests now skip asset lookup and retain global
   and transport policies. Regression tests reject any attempted ASSETS probe,
   including mixed-case WebSocket and other upgrade values. The existing 24
   navigation/guard/view-transition tests now pass. A browser regression checks
   actual Durable Object state frames, an action request ID, and its correlated
   `done` frame rather than accepting an optimistic UI change as proof.
2. **Adapter and image JSON.** Adapter suppresses human lines and prompts in
   JSON/non-TTY operation, returns its public plan and follow-up commands, and
   propagates coded failures. Its public recipe removes generated secret values.
   Image validates format/quality, plans without a converter, reports effects
   and counts, rejects traversal and escaping symlinks, and fails for missing
   sources or conversion errors. Converter logs never enter machine output.
3. **Upgrade planning.** File drift, force-file ownership, dependency resolution,
   build-setting migration, installation, and follow-up actions are computed
   before writes. Locally modified files remain preserved unless explicitly
   selected. A file changed during registry resolution rejects the stale plan
   before effects. Installation failure returns a nonzero structured partial
   result with applied changes and a retry command. pnpm build-setting migration
   keeps its merged approvals instead of being overwritten by a template copy.
   Resolution uses bounded `pnpm view`; unresolved versions fail before effects.
   **Still partial:** additions/removals are empty, and templates come from the
   installed CLI, not the dependency version selected at the registry. Finish
   those requirements before checking CLI-06.
4. **Studio lifecycle.** JSON execution imports project code in an isolated
   child process. Ready/stopped/failed events use the versioned envelope, with
   token-free loopback metadata and no browser launch. Startup defaults to a
   30-second deadline; SIGINT/SIGTERM request cleanup. The Studio library has
   `quiet`/`onReady` hooks and finally-based server/database disposal on schema,
   readiness, and shutdown failures. Dry-run does not import project code.
   CLI subprocess tests cover log/token isolation, import failure, and timeout;
   library tests use an actual loopback server and in-memory SQLite connection.
5. **Build/SSG privacy.** Their JSON path previously included raw project and
   parser output in `data.output`. It now discards that output and supplies an
   exit code, coded diagnostic, and a human-mode follow-up command. Legacy SSG
   warnings are structured and include option names only. Captured processes
   have no inherited stdin and resolve on close.

**Verification:**

- `pnpm build`: passes.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass; all 11 package configs.
- `pnpm test:unit`: **2,305 passing tests in 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 328, framework 564, deno-adapter 3, desktop 16,
  Studio 55. The final CLI package run repeats all 328 after tightening the
  image output-symlink guard, including dangling links.
- Focused CLI protocol/dispatch tests: 65 passing; Studio lifecycle: 3;
  asset middleware: 14.
- `pnpm --filter @cossackframework/framework exec playwright test
  e2e/core-features/navigation.spec.ts e2e/pages/prevent-navigation.spec.ts
  e2e/pages/view-transitions.spec.ts --reporter=line --workers=2`:
  **24 passing**.
- `pnpm --filter @cossackframework/framework exec playwright test
  e2e/pages/optimistic-counter.spec.ts --reporter=line --workers=1`:
  **7 passing**, including the actual correlated WebSocket action regression.
- `git diff --check -- docs packages specs`: passes.

Logs for this checkpoint are `/tmp/cossack-continuation-build.log`,
`types-final.log`, `unit.log`, `navigation-e2e.log`, `ws-actions-final.log`, and
`cli-package-final.log`, each latter filename with the same
`/tmp/cossack-continuation-` prefix. No full generated-app/native production
matrix was repeated in this slice; REL-02/03/05 remain open.

**Continue next:** finish CLI-02's metadata-backed parser/help and conflict
handling, then complete CLI-03's full command-family matrix. Finish CLI-06's
dependency ownership/version alignment, compiler-backed CLI-04, and scaffold
capabilities (CLI-05/RT-25). Resume the remaining runtime/service/Cloudflare
tasks in the detailed plan; do not treat this checkpoint as the release.

Do not run builds or framework pretest concurrently with CLI or browser tests:
they recreate dist exports. One exploratory browser attempt overlapped a core
rebuild and failed entry resolution; run the final gates serially. The first
new protocol assertion incorrectly looked for `result`; the defined terminal
frame is `done`, and the corrected assertion remains in the browser suite.


<a id="codex-review-group3-2026-10-02"></a>
### Codex review of GLM command-contract follow-up and Group 3 (2026-10-02)

**Reviewer: Codex.** Reviewed all 13 GLM commits from `11f1499` through
`fac3daf`, after the previous Codex checkpoint `59fa58e`. This section is the
current handoff. Earlier GLM verification logs record what was claimed at those
checkpoints; this acceptance audit supersedes their completion claims.

**Task audit: 8/58 checked.** CLI-02 and CLI-03 are reopened. No new Group 3
task meets all of its detailed acceptance criteria yet. Completed slices are
recorded below, and the task rows name the remaining work. Keep the eight
previously accepted tasks checked: CLI-01, RT-19, CF-03, CF-05, CF-06, CF-07,
CF-11, and REL-01. Versions remain 0.8.3 until REL-04.

#### Findings fixed

1. **Validation errors and ownership.** WebSocket validation previously became
   a generic client error; JSON/stream proxies discarded field errors. Forwarded
   service contracts used the page constructor and could skip their service's
   rules. All now retain the stable validation code and fieldErrors, using the
   declaring service class. WebSocket dispatch accepts only unchanged
   framework-installed forwarders and retains the action allowlist. A canceled
   action stops after asynchronous validation before calling the mutation.
   Non-array payloads and array inputs fail validation.
2. **Client validation-code exposure.** Server input rules remained in client
   decorators, including custom validator closures. The client transform now
   removes input rules before dependency analysis. Static option objects are
   required; spreads and dynamic options fail closed. Timeout/provider metadata
   remains available. This is an alpha API constraint, documented in validation.
3. **Resource refresh races.** Refresh called loaders without their dependency
   arguments and let an older refresh overwrite a newer value. It also skipped
   serialization/disposal checks and mishandled synchronous failures. Initial
   load and refresh now share one loader path and each refresh owns a separate
   entry. Stale results do not publish, dependency arguments are captured, and
   falsey rejection reasons still represent errors.
4. **Task cleanup.** Rapid changes could start a task before its previous async
   cleanup finished; a canceled run could start after waiting for cleanup.
   Cleanup returned by late async setup was dropped. Cleanup barriers now remain
   visible across reruns, canceled starts are skipped, late cleanups run once,
   and thenables are awaited. Arbitrary writes inside task bodies are still
   cooperative; the documentation now requires an AbortSignal check.
5. **Development state identity.** Each read created a different proxy, and
   warning changed later reads back to the raw object. Deeper nested writes
   escaped diagnosis. Proxies are cached per field/object, recursive reads keep
   stable identity, reassignment unwraps diagnostic proxies, and the diagnostic
   runs only when DEV is true.
6. **Compiler projection.** Regex generic parsing mixed yield/return/next types.
   Async/generator modifiers were left on RpcCall signatures, imports could
   collide, and function-field replacements overlapped annotation splices.
   Parsing now uses the TypeScript AST, proxy signatures remove the modifiers,
   existing RpcCall aliases are reused, and field replacements do not overlap.
   Function fields retain their current stub signatures; their complete client
   typing remains open. Rewriting Vite input does not change authored-source
   TypeScript/IDE inference.
7. **Inspection accuracy.** Spreads, dynamic properties, and recovered invalid
   syntax were presented as static facts or silently replaced with regex guesses.
   Methods from helper classes could be attributed to the page. Inspection now
   selects the exported Page class, reports unresolved options as unknown,
   supports quoted keys/SSG objects/service member names, and honors local/shared
   decorator precedence. Method extraction explicitly describes its syntactic
   scope and its missing compiler analysis.
8. **CLI results.** Unknown route inspection emitted two envelopes and accepted
   an extra ignored route argument. Empty results emitted no envelope, while
   numeric failures had no diagnostic. These are fixed. Add/remove keep status
   data and avoid prompts under JSON/non-TTY execution; delete has structured
   planned-delete/deleted effects and a coded missing-file failure. Dry-run
   deletions are labeled as plans.
9. **Navigation.** Guard errors escaped the typed result, public callbacks
   discarded results, URLs lost query/fragment or used the pre-redirect path,
   and a slow bootstrap could finish after a newer commit. Public component
   navigation and the client-app return value now expose outcomes; fetch keeps
   its effective URL; guard failures settle; superseded errors do not reload;
   DOM commits are ordered with sequence checks. Missing modules fail rather
   than report success. Six behavioral tests replace the prior sample-object
   tests. Renamed the demo layout's sidebar handler to avoid overriding the new
   public navigate method.

#### Verification

Focused tests first reproduced seven failures in the new core regressions.
The following checks pass on the reviewed implementation:

- `pnpm build`.
- `pnpm tsc --noEmit` and `pnpm typecheck` (all 11 TypeScript package configs).
- `pnpm test:unit`: **2,288 passing tests across 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 317, framework 561, deno-adapter 3, desktop 16,
  Studio 52. Package tests remain serial because framework pretest recreates
  dist exports used by CLI tests.
- Focused final CLI subprocess/AST/inspection run: 55 passing tests after
  improving child-process tracking and removing the unused AST walker.
- `pnpm audit:bundle`: 28 neutral modules; Cloudflare entry is Workers-safe.
- `git diff --check -- docs packages specs`.

Browser verification is **not green**. The existing navigation, prevention,
and view-transition suites were attempted with Playwright (`--workers=2`):
3/24 passed, then the Vite/Miniflare development server crashed during a
WebSocket upgrade. Miniflare's `#handleLoopback` asserts that its HTTP response
exists for `CUSTOM_NODE_SERVICE`, but `#handleLoopbackUpgrade` calls it without
that response. The remaining 21 tests could not connect to the dead server.
This is a concrete dev/runtime integration failure to resolve under CF-10
and REL-03 before treating browser acceptance as verified. Retrying the same
three files with `--workers=1` reproduces the assertion: 2/24 pass and the
remaining 22 cannot connect. The exact commands use
`pnpm --filter @cossackframework/framework exec playwright test`
with `e2e/core-features/navigation.spec.ts`,
`e2e/pages/prevent-navigation.spec.ts`, and
`e2e/pages/view-transitions.spec.ts`, followed by `--reporter=line` and the
worker option. Do not report these suites as passing or suppress the assertion.
No remote deployment was attempted.

#### GLM continuation — concrete next work

1. **Finish CLI-02/CLI-03 before closing them.** Convert adapter, upgrade, image,
   and Studio to structured results or an explicit unsupported JSON boundary.
   Add subprocess success, failure, dry-run, non-TTY, and prompt-cancellation
   coverage for every family. Include conflicts between aliases and incompatible
   targets; derive parsing/help from command metadata. The original 17 tests
   did not cover every family. Preserve the single-envelope regressions.
2. **Provide actual client type inference (RT-01), then typed targets
   (RT-03/RT-05).** Decide how authored client code sees RpcCall without changing
   the server implementation signature. Generated declarations/client views or
   an editor/compiler integration need semantic type tests, including inferred
   returns, nested generics, aliases, generators, and function fields. A string
   assertion about transformed source is not an inference test.
3. **Finish RT-02 with RT-14.** Infer the server input from rules/schema, settle
   unknown keys and file/array handling, and enforce resource policies before
   mutation. Test forged requests and nested field errors through browser and
   direct transport calls. Keep validation code out of client bundles.
4. **Finish RT-03/RT-04/RT-05 acceptance.** Add typed resource names/results and
   typed task dependencies. Add a result-application mechanism for stale work,
   or make the explicit cooperative contract the reviewed design and revise the
   acceptance criteria deliberately. Test disposal during setup, rejection of
   async cleanup, SSR/hydration deduplication, nested arrays, cycles, computed
   dependencies, and production semantics.
5. **Finish navigation and ownership together (RT-09/RT-12).** Ordered commits
   prevent late overwrites, but a bootstrap that never resolves can still block
   later navigation. First resolve the reproduced Vite/Miniflare WebSocket
   upgrade crash (CF-10/REL-03) and establish a working browser baseline.
   Add cancellation/bounded completion and the Playwright
   matrix for guards, rapid clicks, back/forward, fragments, reused layouts,
   failures, redirects, transition fallback, and service/child disposal. Emit
   the planned cache/layout/scroll diagnostics. Current tests run real
   navigation logic with controlled component lifecycle fixtures in jsdom;
   they do not prove the full renderer/browser matrix.
6. **Unify inspection (CLI-04/RT-07/RT-12).** Expose compiler metadata for
   automatic RPC, transitive client preservation, inheritance, effective
   middleware, and actual service ownership. Keep dynamic facts unknown until
   the shared model can resolve them. Add scaffold-recipe awareness and typed
   routes/API schemas.
7. Resume the remaining groups in the detailed plan after these foundations.
   Update task rows and append a new GLM verification section. Do not place a
   new section between an existing Codex anchor and its heading.

Preserve the user's uncommitted `reports.md` and untracked `.zcodeignore`.
This review does not publish, deploy, push, or start another agent/chat.

### GLM continuation: compiler typing of RPC results (2026-10-02)

Review item 3 (typing): the vite-security-plugin client transform rewrites
stripped `@Server` method signatures to the call contract —
`AsyncGenerator<Y, R>` → `RpcCall<R, Y>`, one-arg generators and
`AsyncIterableIterator<Y>` → `RpcCall<any, Y>`, `Promise<R>` →
`RpcCall<R, never>` — with a type-only RpcCall import injected on first
rewrite. Unrecognized/missing annotations keep declared types. Tests cover
all mappings plus untouched cases; framework 550 and core 647 tests green.

### GLM continuation: Group 3 application-state items (2026-10-02)

Six more checklist items advanced with implementation + tests:

- RT-01 audit (upload boundary): raw arguments are validated BEFORE the
  upload walker transforms them, so Maps/Sets fail with the original path on
  HTTP exactly like WS/service instead of being silently emptied; Dates pass
  through; handled values (File/FileList/DOM) are exempt; rejections never
  throw synchronously. `describeUnsupportedValue` gained a handled-predicate.
- CLI-04: `inspect routes` now lists method classifications — every @Server
  method with the reason it becomes an RPC proxy (source line included) and
  @Client/@Shared methods as transport-free. AST-extracted, no execution.
- RT-05: task executions carry an AbortController identity; dependency
  changes abort the previous execution, stale results are discarded, disposal
  cancels in-flight tasks; failures report task, component, and trigger
  (bootstrap vs dependency change with paths); slow tasks no longer block
  siblings. Acceptance test: slow-first/fast-second retains the second
  result; stale deferreds never apply.
- RT-02: `@Server({ input })` declares action input contracts enforced on
  every transport (HTTP /crpc, WebSocket, service RPC) BEFORE the method
  runs — invalid input can never reach a mutation; failures reject
  client-visibly with `COSSACK_VALIDATION_FAILED` and stable nested field
  errors; declared coercion applies before the payload reaches the method.
  Cross-module detection via a structural validationCode marker.
- RT-03: `resourceStatus$(name)` exposes pending/ready/error, latest value,
  last failure, and staleness (including the refresh window);
  `refresh$` retries the loader directly without a render pass.
- RT-04: development-only shallow-mutation diagnostics — nested mutations on
  plain @State warn once per field with the component name and both fixes;
  @Store stays silent; compiled out of production. docs/states.md gains the
  mechanism selection table (GLM).
- RT-09: `navigate()` settles with a typed `{ outcome, url, error? }` across
  completed/redirected/superseded/canceled/failed; a navigation sequence
  discards late responses when superseded; documented in
  docs/prevent-navigation.md (GLM).
- Gates: core 661, framework 553, CLI 312 tests green after each slice.

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

<a id="codex-review-2026-10-02"></a>
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

<a id="codex-cache-contracts-2026-10-03"></a>
## Codex cache contract review — 2026-10-03

Author: **Codex**. Continued from `e6e5677` while preserving the full 58-task
release scope. This checkpoint advances RT-18 and does not check it off.

Regressions reproduced cache manager cross-request binding reuse, missing-binding
fallback, custom option omission, skipped built-in registration, invalid TTL
writes, namespace collisions, lost nulls and normalized dot-segment keys. The
ownership baseline had 19 failures in 23 new cases; the duration baseline had
31 failures in 36 cases. The fixes select wrappers by actual binding identity/
complete named declarations, keep custom selections request-owned, and obtain
DO I/O stubs per operation. Custom factory disposal remains caller-owned and
nested env object mutations are outside the shallow memoization contract.

All public cache TTLs now use nonnegative integer milliseconds (`ttlMs`), matching
limiter windows. `set()` defaults to one hour; direct stores/batches omit expiry
unless supplied. KV frames namespace/key tuples and stores versioned logical
expiration envelopes, independently of rounded minimum-60-second retention.
Stale expired/corrupt KV reads cannot delete fresh replacements. SQL cleanup
matches its selected value/deadline, proven against a real replacement race.
DO query keys and found/missing batch replies preserve reserved paths and null.

Inputs are validated/snapshotted before writes: valid UTF-8 keys at most 512
bytes, JSON values at most 1 MiB, write batches at most 128 entries/2 MiB including
overhead. Memory evicts LRU entries at count/serialized-byte budgets, and invalid
capacity or oversized overwrite rejects first. These are per-store serialized
limits, not a process heap bound. DO JSON requests/replies are bounded, strict
UTF-8 and EOF checked; the client uses five seconds/current-request signals and
detached cancellation. Started storage writes may commit and later failures may
leave partial batches. Custom/DB I/O does not inherit the DO deadline.

The native fixture imports the compiled public cache/config/core modules in
workerd. Two Workers share native KV/DO bindings, separate alternate namespaces,
survive actual DO eviction and entrypoint reload, and expire short TTLs while KV
still retains the record. It checks missing-binding failure, private invalid
batch non-mutation, namespace collision prevention and null/dot-segment values.
This is native compiled-library acceptance, not proof of every generated cache
configuration, regional KV propagation, production write throttling, actual TCP
abort delivery, or remote producer shutdown.

Breaking migration: multiply old TTL numbers by 1,000, rename batch
`ttlSeconds` to `ttlMs`, update custom providers and deploy DO client/class
together. DB/DO stored epoch timestamps remain valid. New KV keys/envelopes
start a fresh cache; old indefinite records require explicit cleanup. Docs,
architecture, agent examples and runnable/generated acceptance were updated.

Final verification: framework **1144** cases in **53** files (cache contracts
**161**, shared transport matrix **354**); CLI **570** in **42** files including
all **14** generated/runtime cases, native cache storage acceptance and the
real-pnpm release fixture; database **86** in **15** files; scaffold **108** in
**4** files. Total **1908** passing cases across those suites. Final framework
and database builds pass, root `pnpm tsc --noEmit` passes and `pnpm typecheck`
passes all **11** package/test configs. Consumer suites ran after declaration
builds. Core/Node/Deno sources were unchanged in this checkpoint; retain their
prior evidence and separate release gates. Owned-file whitespace checks pass;
the pre-existing `reports.md` EOF warning is preserved with the user's changes.

Requirement audit: **14/58 checked, all 44 unchecked retained.** RT-18 still
requires limiter URL/key/namespace/capacity validation, explicit provider
capabilities/units in inspection and pre-operation rejection of unsupported
requested guarantees. RT-01's actual pre-header disconnect and arbitrary action
deadlines, Deno/Electron/live-provider gates and all other remaining criteria
stay open. Package versions remain 0.8.3 until REL-04. Preserve user-owned
`reports.md` and `.zcodeignore`.


<a id="codex-resource-lifecycle-2026-10-03"></a>
## Codex resource lifecycle review — 2026-10-03

Author: **Codex**. Continued after `cab1560`. Only **RT-03** newly completes:
**18 checked / 40 unchecked**, preserving all 58 original IDs. Read the detailed
[RT-03 audit](./release-0.9.0-plan.md#rt-03),
[RT-05 continuation](./release-0.9.0-plan.md#rt-05) and
[migration](./migration-0.9.0.md#typed-server-resources-and-dependency-aware-hydration).

Resource lifecycle calls now support declared public names with value inference.
The compiler records named fields so status/refresh can bind a getter before
render or after hydration without running arbitrary getters or duplicate loads.
Hydration retains dependencies and only settled values. Superseded/disposed
results and errors cannot replace live data or fail SSR. Refresh failure retains
last data, retry recovers and invalidation restores declared initial behavior.
Validation no longer misidentifies repeated references as cycles or invokes
custom JSON hooks before validating; Dates/class instances/non-finite values and
undefined dependencies fail clearly. Final review caught generated methods
serializing before resource validation. The generated method now validates before
RPC JSON as well as SSR settlement; native forged Date/toJSON calls reject before
conversion. Generator loaders receive an authored diagnostic.

Review also reproduced two settled task signal failures. Keeping controllers
until rerun/disposal and aborting before cleanup fixes subscriptions that lost
cancellation ownership when setup returned. TaskMethod includes signal and async
cleanup. This does not implement RT-05's typed paths or gated writes.

Native fixture review caught a missing ORM route scope, two implicit status
roles, and a browser filter declared as shared State. Resource HTTP passed, but
SSE authoritative state correctly reset that local selection. Fixture/recipe/
bundled example now use ClientState for local filters; requests carry dependency
arguments without publishing those filters as shared state. Private loader
failures stay out of browser output and chunks. Resource checks run early in the
native suite to expose fixture failures before the large policy/schema matrix.
An initial generated test had a quoting typo; a serialization assertion's expected
diagnostic changed while validation order was tightened. These intermediate
failures were fixed, not treated as passing evidence.

Final evidence:

- Core **1107 tests / 64 files**, framework **1316 / 57**, scaffold **108 / 4**.
- Published resource declaration fixture rejects invalid names/value use and
  preserves inherited/null/optional values without Vite.
- Core/framework builds, `pnpm tsc --noEmit` and all **11** package typecheck configs.
- Generated production Node/browser selection: **2 passed, 12 skipped / 14**;
  hydration reuse, stale response, retry and navigation cleanup are observed.
- Native staging/socket: **2/2**, about **109 seconds**; resource HTTP/SSE SSR,
  D1/user context, private failure/recovery and four precise dependency calls.
  Existing schema/policy/stream/counter/socket cases remain passing.
- Owned whitespace and JS syntax checks pass. User-owned reports.md/.zcodeignore
  remain untouched by staging. No full CLI, monorepo release, tarball, native Deno
  or Electron acceptance is claimed. Versions stay 0.8.3 until REL-04.

**Next for GLM:** finish RT-05's typed dependencies, owned commit API, contextual
cleanup failures and navigation/scoped-service disposal matrix. Then follow the
remaining original tasks and release gates. Never count cooperative signals as
proof that arbitrary writes are gated or ignored I/O stops. Do not reintroduce
controller deletion after setup or weaken authoritative realtime snapshots.

<a id="codex-task-ownership-2026-10-03"></a>
## Codex typed task ownership review — 2026-10-03

Author: **Codex**. Continued after `95b2dd4`. Only **RT-05** newly completes:
**19 checked / 39 unchecked**, preserving all 58 original task IDs. Read the
[criterion audit and next plan](./release-0.9.0-plan.md#rt-05),
[task guide](../docs/tasks.md#typed-dependency-paths) and
[migration](./migration-0.9.0.md#typed-task-dependencies-and-owned-commits).

Task decorators accept a host/dependency-shape generic and readonly typed paths.
Methods receive an immutable TaskContext as their second argument. Typed field
patches commit only while the execution remains current; obsolete/disposed
contexts return false, including results of ignored-cancellation I/O. Runtime
patch validation rejects nonreactive fields, promises/callbacks/classes and
getters before changing any fields. Direct writes remain cooperative; this API
cannot stop ignored I/O, undo mutations or transact across reentrant setters.

Review found subclass declarations could hide parent task siblings. Root-to-child
own registration now retains siblings and resolves child kind/track replacement
before server/client filtering. Signals remain owned after setup, abort before
cleanup and cannot revive after destruction. Setup, commit and cleanup failures
name component/task/trigger/stage. Rejected cleanup drains next setup/siblings;
owned scope disposal awaits cleanup. Late uncancellable setup cleans up once,
even after disposal, but cannot depend on an already disposed service.

Final evidence:

- Core **1115 tests /65 files**, including **16** task cancellation/ownership cases
  and a published-export typed dependency/patch fixture; framework **1316 /57**.
- Core/framework builds, root `pnpm tsc --noEmit` and all **11** package typecheck
  configs pass. A generated task app also passes its own TypeScript check.
- Generated Node production/browser **1 passed, 14 skipped /15** proves newer
  result retention, stale/disposed refusal, live sibling navigation and retained
  layout service identity, abort-before-service-disposal and exactly-once cleanup.
  Typed ServerTask private sentinel is absent from client chunks.
- Native staging/socket **2/2** pass with rebuilt packages, preserving existing
  HTTP/SSE/resource/schema/D1/counter/stream/socket behavior. No standalone
  service-task engine or native Deno/Electron acceptance is claimed.
- Initial declaration build caught TypeScript retaining a phase narrowing across
  an asynchronous closure. Ownership checks now read live context state rather
  than assuming the phase remains unchanged. Final type review fixed null-only/
  undefined-only fields being excluded as functions; published fixtures cover
  both tracking and commits. Builds/type tests then passed.
- Owned whitespace and JS syntax checks pass; reports.md has a user-owned trailing
  blank line and remains unstaged, along with .zcodeignore. Versions remain 0.8.3.

**Next for GLM:** RT-04's state/store/computed guidance and contextual serialization
matrix, using the concrete continuation plan above. RT-01 and every other original
unchecked task remain in scope. Full CLI/monorepo, tarball, native Deno/Electron
and release/version/publication gates are still open.

<a id="codex-state-diagnostics-2026-10-03"></a>
## Codex state contracts and diagnostics review — 2026-10-03

Author: **Codex**. Continued after `abd80ad`. Only **RT-04** newly completes:
**20 checked /38 unchecked**, preserving all 58 original IDs. Read the
[original criterion audit](./release-0.9.0-plan.md#rt-04),
[RT-06 continuation](./release-0.9.0-plan.md#rt-06),
[state guide](../docs/states.md) and
[migration](./migration-0.9.0.md#state-contracts-and-development-diagnostics).

The state guide now explains shallow/deep, public/client, computed, resources
and standalone stores with complete compiled public-export examples. Shallow
writes change raw data without rendering; replacement and nested store writes
request renders. Computed calculates on read, without an independent cache.
Standalone createStore compares replacements with Object.is; connectStore owns
a subscription that must disconnect. Documentation no longer recommends cloning
Proxy values directly with structuredClone or calling browser toasts from server
methods. Browser singletons live in client-only modules; server request data needs
request/service ownership.

Development public-state diagnostics use bounded read-only canonical RPC
inspection and report owner/field/boundary/path without values. Known cycles,
unsupported values and invalid Dates warn. Valid Dates/models/repeated acyclic
references retain their canonical behavior. Inspection does not run custom toJSON,
property getters or accessor object tags. Unknown representations are left to
the real serializer; depth/visit limits mean silence is not validity evidence.
Warnings deduplicate per field/issue, with recovery after a valid value. Shallow
diagnostics cover ClientState too, identify nested paths and the correct deep
decorator, keep stable identity, and ignore no-op/missing-delete/failed writes.
Removed old value-bearing change logs. Production writes and serialization remain
unchanged. Core's build preserves consuming Vite DEV selection with optional env
access, so published direct Node imports also remain safe.

Review fixed inherited field loss and inconsistent request sanitization. Gather
own reactive declarations root-to-child and replace the same field's complete
kind/options. Bootstrap, explicit/legacy service state, optimistic field discovery,
channel validation and component/service sanitizers now agree. Parent siblings
remain; public Store channels validate; client-only child replacements reject
forged parent public input. This does not add a new service task engine, a general
transaction, native value revival or a deeper Computed dependency system.

Final evidence and exact scope:

- Core `pnpm --filter @cossackframework/core exec vitest run`: **1147 tests /68
  files**. New state serialization/mechanism/docs fixtures and expanded shallow
  diagnostics cover objects/arrays/computed inputs, cycles/native values,
  inheritance, service forwarding/channel checks, sanitization, no getter/hook
  invocation, diagnostic bounds, published declaration imports and direct Node.
- Framework `pnpm --filter @cossackframework/framework exec vitest run`:
  **1316 /57**. Core/framework package builds pass. Root `pnpm tsc --noEmit`
  and `pnpm typecheck` pass all **11** package configurations. Both full example
  files compile against built declarations; the generated state app passes its
  own TypeScript check against package exports.
- Generated Node/browser command `pnpm --filter cossack exec vitest run
  tests/generated-runtime-build.test.js -t 'state documentation examples|gates
  typed task commits'`: **3 passed /14 skipped of 17**. The exact state example
  runs in development and production, proving shallow/replacement/deep changes,
  computed totals, local draft retention, actual flat RPC overlay exclusion,
  resource dependency arguments, DEV warnings and quiet production. The existing
  typed-task/navigation/scoped-service acceptance also passes.
- Native command `pnpm --filter cossack exec vitest run
  tests/deploy-integration.test.js tests/websocket-peer-integration.test.js
  --maxWorkers=1`: **2/2**, about **110 seconds**. Native HTTP/SSE resource pages
  preserve local Store edits, omit local/computed state from SSR and actual flat
  requests, retain inherited public fields, and reject forged client-only child
  overlays. HTTP accepts allowed public input; SSE keeps authoritative coordinator
  state. Existing actual D1/user/policy/schema/private failure/recovery, streams,
  socket cancellation and limiter cases remain passing. These are local disposable
  Workers; no account resources or live deployment were changed.
- Workers fixture review loaded the Workers skill, current primary best practices
  and latest Workers types; this change adds no platform APIs or Wrangler settings.
  Owned whitespace/JS syntax checks pass. No full CLI/scaffold/monorepo, tarball,
  native Deno or Electron release gate is claimed. Versions remain 0.8.3.

Intermediate failures and corrections:

- Constructor metadata typing needed to tolerate unknown input. Test render spies
  initially returned Promise<void>; they now match the required boolean result.
  Documentation outside package roots initially lacked @core resolution; a strict
  built-declaration fixture supplies paths, and generated app compilation also
  proves real package export resolution.
- Core's original library build erased DEV checks before consuming development
  apps could enable them. A first preserved DEV expression used nonoptional env
  access and failed outside Vite; the final optional expression and direct Node
  subprocess fixture fix and verify both cases.
- Plain generated Node Vite dev returned 404. The development acceptance harness
  now owns an explicit HTTP SSR bridge to the real Vite graph. Initial SIGTERM
  cleanup produced exit 143; owned IPC shutdown now closes the listener/Vite cleanly.
  This bridge does not fix scaffold or CLI Node dev. Its first-party integration
  stays open under [REL-03](./release-0.9.0-plan.md#rel-03) and guide execution CF-10.
- Initial browser assertions expected a nonexistent components wrapper; they now
  inspect the actual page initial.public. RPC fixtures also mistakenly treated
  request.state as state.public, making exclusion checks vacuous. Browser/native
  fixtures now assert actual flat keys. Native HTTP/SSE expectations distinguish
  accepted HTTP overlays from SSE coordinator authority instead of weakening it.
  The initial native fixture failure is superseded by the final rebuilt 2/2 run.

**Next for GLM:** RT-06's action-owned optimistic updates/rollback, using the
detailed plan. Preserve newer local edits, settle loading once, distinguish
rejection from uncertain completion, and resync without replay. Also fix the
first-party Node development gap before the final runtime gate. All other original
unchecked tasks remain; reports.md and .zcodeignore remain user-owned and unstaged.

<a id="codex-optimistic-ownership-2026-10-03"></a>
## Codex optimistic invocation ownership checkpoint — 2026-10-03

Author: **Codex**. Continued after `83ea5e4`. **No checkbox closes: 20 checked /38
unchecked**, all 58 original IDs preserved. RT-06 remains open against its
[original criteria and next plan](./release-0.9.0-plan.md#rt-06). Read the
[optimistic guide](../docs/optimistic.md) and
[migration](./migration-0.9.0.md#optimistic-call-ownership-and-flat-connection-snapshots).

The first 20-case controlled matrix reproduced 17 failures across HTTP, SSE and
socket calls. Previous locks grouped calls by method name, retained failed
previews, dropped a newer success when an older failure settled last, missed
nested Store changes, and sent previewed public values back as server input.

Core now owns each invocation and its resulting field layers separately. Known
plain trees capture before/after values without JSON hooks. Failure removes the
owned preview; newer confirmed data, another pending call, or a later local edit
remains. Component/service setters observe local edits, including Store paths.
Handlers run once and synchronously. Async handlers are refused; synchronous
promise/throw/over-depth failures restore captured changes while the actual action
can still dispatch. Native values remain scalar references. Inherited handler
metadata retains parent action siblings. Uncorrelated completion messages cannot
settle modern request-scoped loading counts.

HTTP/service request state now excludes pending previews, preventing an action
from receiving its own optimistic increment as its starting value. Explicit
services use the same ownership, sanitized state merging and subscriber loading
settlement. Shared rpc-state.ts removes the service's direct-hydration race and
keeps canonical JSON equality for unrelated fields, without a Cossack/Node import.
The current representation is whole-field resulting values. It does not infer
arithmetic/array contribution operations, transact database updates or stop
application I/O. A later nested edit protects the full field and can retain older
preview data it read. These limits are explicit in the remaining RT-06 audit.

Review also found Node/Deno initial WebSocket frames carried wrapped hydration
state, while clients expect a flat public record. The process runtime now exposes
getPublicState, and both Node upgrade paths plus Deno send that record. SSR
hydration remains wrapped. Actual socket/dev/HMR fixtures now inspect flat fields;
this fixes connection-state delivery, not the separate Node plain Vite dev 404 gap.

Final verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1197 tests /69 files**.
  New optimistic matrix has **48** cases; legacy cleanup file now has **5**.
  Coverage includes overlap/success/failure completion order, independent fields,
  nested/local values, later user edits, intervening broadcasts, null request
  values, timeout/cancel/disconnect, inherited/throwing/promise/over-depth handlers,
  actual component setters and explicit service subscribers.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1316 /57**.
  Node adapter suite **16 /4**, Deno adapter suite **16 /2** pass. These Deno
  fixtures run under Vitest; native Deno execution remains REL-03.
- Core/framework/Node/Deno package builds pass. Final root `pnpm tsc --noEmit`
  and `pnpm typecheck` pass all **11** package configurations. Builds complete
  before consumers run; no declaration-deleting build overlaps those checks.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  **18/18**, about **111 seconds**. New generated production HTTP/SSE pages prove
  late older validation rejection after newer success, preview exclusion from
  actual requests, client-only exclusion, nested authoritative state, correct
  loading and later user edits. The app passes its own tsc. Existing state DEV/
  production, task/navigation/scoped service, protected-route, schema/resource,
  portable builds and actual Node production/dev/HMR socket cases also pass.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **121 seconds** while the full generated suite ran separately. Native Worker
  HTTP/SSE pages preserve newer count 20 after a held older invalid call, settle
  loading from 2 to 1 to 0, send confirmed count 0 for both calls, retain local
  Store edits and a later user count 99. Existing native D1/resource/schema/policy/
  limiter/stream/socket acceptance remains passing. All fixtures are disposable
  and local; no remote resource or live deployment changed.
- Owned whitespace and JS syntax checks pass. reports.md/.zcodeignore remain
  user-owned and unstaged. Versions remain 0.8.3. No full CLI/monorepo, tarball,
  native Deno, Electron or release/version/publication gate is claimed.

Intermediate corrections are retained here rather than hidden:

- A first targeted command named a nonexistent service-scope.test.ts; Vitest ran
  the two matching files only (**59** cases). The subsequent explicit commands
  included layout-service-scope and service-rpc-security, and final full core
  verification covers every core file.
- Review separated local user layers from the authoritative base so an intervening
  broadcast cannot erase a later edit while a call is pending. Request extraction
  now preserves an authored null, rather than falling back via nullish coalescing.
  Plain snapshots preserve enumerable symbol properties in local object trees.
- A throwing handler can throw undefined; a dedicated failure flag now restores
  it. Capture failures restore fields instead of escaping before the actual call's
  lifecycle is installed. Promise rejection is consumed without unhandled errors.
- The over-depth preview fixture initially also sent the same invalid deep tree
  as an RPC argument, so canonical validation correctly prevented dispatch. The
  corrected fixture generates the bad preview locally and sends valid arguments;
  it proves preview restoration and one actual call independently of RPC rejection.
- An initial native expanded run passed 2/2; the final rebuilt run after capture
  edge fixes also passed 2/2. Final full generated acceptance replaces earlier
  selected 1/18 optimistic and 2/18 adapter snapshots.
- Late review reproduced explicit service subscriber loading being cleared by an
  unrelated completion broadcast. Per-call subscriber loading now ignores that
  broadcast, counts duplicate subscriptions once, and releases the original owner
  even after unsubscribe without rendering it. The new cleanup regression failed
  before this fix and passed afterward.
- A later client-only tree beyond snapshot depth initially made its ordinary
  setter throw and could mask the RPC error/leak loading. A real Cossack setter
  regression reproduced it. Unsupported local values now retain references with
  owner/field diagnostics; cleanup catches per-field failures, drains siblings and
  settles loading. Public request extraction leaves canonical validation in charge
  instead of throwing an earlier plain-clone error.
- Full-state responses initially treated an unrelated echoed input as a newer
  confirmation, canceling another field's preview. Three transport cases failed
  before the fix. Unrelated echoes now retain that pending ownership; actual
  changes and the owning call's response still supply authority. Final source and
  rebuilt package verification supersede the earlier intermediate green runs.

**Completion audit: RT-06 stays open.** Controlled tests manually applying a
snapshot after uncertainty do not prove an actual lost-response read/reconnect.
Define the authoritative HTTP/service read contract, test an already committed
mutation with a deliberately lost reply and zero replay, finish native socket/SSE
recovery and late broadcast coverage, and audit operation-aware contribution
rebasing plus stream failure/cancellation. Follow the detailed next plan before
checking the task. Preserve all other original unchecked IDs and release gates.

<a id="codex-optimistic-operations-2026-10-03"></a>
## Codex explicit optimistic operation checkpoint — 2026-10-03

Author: **Codex**. Continued after `231bcc1`. **20/58 checked, 38 unchecked**.
No task closes. RT-06's contribution audit now has an explicit supported contract;
uncertain authoritative reads, native reconnect, different late snapshots and
stream/consumer acceptance remain open. Read its
[detailed continuation](./release-0.9.0-plan.md#rt-06),
[operation guide](../docs/optimistic.md#record-relative-operations) and
[migration](./migration-0.9.0.md#explicit-optimistic-operations).

The initial contribution tests failed **2/3**. Whole-field snapshots retained an
older failed increment and append after a newer pending or committed local edit.
Inferring a numeric delta or replaying arbitrary application handlers cannot
safely establish intent. Public `optimistic<Host>(target)` now records explicit
finite increment, detached append and first-structurally-equal remove operations
within the exact synchronous handler capture. Internal replay folds surviving
operations in invocation order. Handler code executes once. A no-op removal
still records intent if an older removal later fails. Array duplicate order stays
stable, and confirmed public replies exclude operations that they confirm.

Successful local operations remain ordered while other calls are pending. A
later local replacement supplies the base for subsequent relative operations.
One new regression initially discarded that replacement at local success; cleanup
now preserves it. Direct assignments keep absolute whole-field semantics. Mixing
assignment and operations on one field in a handler rejects and restores its
capture. Stale helpers reject before writes, including during another handler.
Runtime metadata checks reactive fields; published types check writable numeric/
array names and item shapes. The guide has a complete public-export example.
Types within methods require a concrete Host because polymorphic this leaves
mapped field constraints unresolved. Data operations accept finite acyclic plain
enumerable properties and do not execute serialization hooks. Native object and
arbitrary later nested-write limitations still apply.

A full generated browser run found an additional real regression: a late equal
SSE snapshot replaced count 99 with count 30 after the call settled. A controlled
regression reproduced it before correction. Weak per-target history now retains
the confirmed value only for fields with surviving user edits. Equal ambient
snapshots preserve those edits, including while another increment is pending.
Changed state and explicit RPC reads clear that field's history. Socket/EventSource
open and SSE resync clear history while preserving active preview ownership.
This compares values, not server revisions; it does not prove ordering between
different late snapshots. Actual native lost-response/reconnect tests remain
required before RT-06 closes.

Final verification against the rebuilt core:

- `pnpm --filter @cossackframework/core run build` passes, including declarations
  and rewritten ESM imports. Builds finish before package consumers run.
- `pnpm --filter @cossackframework/core exec vitest run`: **1225 /71**.
  New operation journal file **14** cases, including all six completion orders
  with four success/failure patterns; optimistic concurrency file **58** cases;
  cleanup **5**, published operations types **1**, realtime recovery **8**.
  The explicit final targeted command covers these five files (**86** cases).
  In addition to the prior transport matrix, checks cover stale/mixed/invalid
  helpers, item detachment, removal intent/duplicates, authoritative rebasing,
  retained local replacements, explicit service subscribers, late equal echoes,
  direct reads, and connection-open/resync authority with active previews.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1316 /57**.
  Final root `pnpm tsc --noEmit` and `pnpm typecheck` pass all **11** package
  configurations. No full monorepo/runtime release gate is claimed.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  final **18/18**, about **111 seconds**. Generated apps compile through published
  exports and run actual Node production HTTP/SSE with Chromium. Held negative
  and valid append requests cover older rejection while the newer call remains
  pending and newer success before older rejection. Counts/arrays retain only
  valid contributions; loading releases 2 → 1 → 0; local fields stay absent from
  actual request state. The earlier count-99 late-echo failure is fixed. Existing
  state/task/recipe/schema/resource/native-response/portable-build/Node socket
  production, development and HMR acceptance also passes.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **120 seconds**. Native Worker HTTP/SSE acceptance now holds two append actions,
  rejects the older validated input while the newer action remains pending,
  retains one increment and only the newer array item, and settles loading once.
  Existing D1/resource/schema/policy/cancellation/stream/limiter/socket acceptance
  remains passing. This does not yet test a new optimistic mutation whose response
  is lost after commit and then recovers through a real socket reconnect.
- Owned whitespace, JS syntax and relative documentation file links pass. All
  58 IDs and checked states are preserved. Versions remain 0.8.3. reports.md and
  .zcodeignore remain user-owned and unstaged. No remote/live resource changed.

Intermediate evidence is retained:

- Initial direct-snapshot contribution matrix: **2 failed, 1 passed**. Replacing
  those previews with the explicit operation contract makes all three pass.
- The retained-local-replacement regression failed before cleanup was corrected.
- The first extra transport append cases registered metadata after proxies had
  already captured their reactive keys. The fixture now registers it before proxy
  installation; production components already follow that initialization order.
- Published/service/browser example checks initially failed on mapped polymorphic
  this. Concrete Host arguments now compile, and the guide names that constraint.
  The first selected browser run failed its app tsc before reaching a browser.
- An intermediate full browser suite passed 17/18 and exposed the late equal
  snapshot regression. It is not final acceptance. The new controlled case also
  failed before the history fix. Final rebuilt browser **18/18**, native **2/2**,
  core/framework/types results above supersede those intermediate runs.
- An intermediate native run passed 2/2 before the history fix. The final rebuilt
  native run also passes 2/2. No checks were restarted merely on an observation
  timeout; each restarted run followed an actual fixture/source correction.

**Next:** finish RT-06 steps 2–4. Use an explicit authoritative read/resource
contract for uncertain HTTP/service outcomes. Start with an actual persisted
record and hold/consume the mutation response before deliberately failing its
client delivery. Prove the committed record changes exactly once, the client
reports uncertainty, one read converges, and no mutation replay occurs. Reuse
existing `refresh$`/resource identity and RT-19 recovery instead of inventing a
second state system. Then exercise actual native socket loss/reconnect, SSE
recovery and different late snapshots, retained layouts/service subscribers,
post-yield errors and cancellation, with full original criterion audit. Continue
all other unchecked IDs and the Node plain Vite dev gap afterward.


<a id="codex-optimistic-reconciliation-2026-10-03"></a>
## Codex review: authoritative optimistic reads (2026-10-03)

Author: Codex. Continued after `7cdb039`. **20/58 checked, 38 unchecked.**
All original IDs remain. RT-06 stays open. This phase implements its explicit
read contract and committed/lost-response HTTP/service acceptance.

Core exports `isUncertainRpcError` and ServerResourceReconciliation. Components
call typed `reconcile$(failure, ...names)` for declared resources. Known uncertain
RpcError diagnostics select reads. Standard guard/pre-dispatch/consumer errors
skip reads. Server-correlated serialization failures and generic HTTP 5xx RPC
failures also qualify. Plain application errors and code-shaped objects do not.
This classification does not establish transaction outcomes for authored errors
following writes. Applications explicitly read data for those cases.

All names bind before read dispatch. Each unique target refreshes once. A weak
per-error cache shares the promise for the sorted target set and current dependency
identities. Cached recovery failures require explicit refresh$ for a later retry.
The exact resource entries bind synchronously before dependencies can change.
Results distinguish not-needed/recovered/failed/superseded/disposed. Recovery
errors remain separate from the original mutation failure. Destruction refuses
late state updates and discards the cache. Existing resource/RPC lifecycle owns
these reads. No new deadline or termination of ignored I/O is promised.

RPC target reconstruction previously started an incidental render resource read
before executing the selected generated read action. A failing router regression
observed two reads instead of one. Core's synchronous __renderRpcTarget depth
suppresses loader dispatch across nested reconstruction, with finally cleanup.
Framework uses this render entry point. Deterministic child targets still build.
SSR and ordinary browser resource discovery retain their behavior. The selected
action reads once. Existing child-target and transport guard acceptance passes.

A shared browser fixture runs real Node production HTTP/SSE pages and native
Worker pages backed by D1. Component and layout-owned service actions update a
record. The interception consumes the real response and checks persisted counts
before aborting delivery to the browser. Each case reports NETWORK_FAILED,
restores its preview, performs exactly one resource read, displays the persisted
value, releases loading and never dispatches the mutation again. Backend telemetry
requires mutations +1 and reads +1, not merely a matching final display. Service
requests carry an actual service reference. The SSE page requires its authenticated
EventSource to be open before the cases start. Actions/recovery still use HTTP
through its coordinator. Socket mutation loss/reconnect and SSE resync delivery
are not certified by these cases. Node's fixture uses process-owned records.
Native workerd uses actual D1 and request-user isolation.

Final verification:

- Core/framework builds pass, including published declarations and framework SSG.
  Builds completed before their consumers ran.
- `pnpm --filter @cossackframework/core exec vitest run`: **1255 /72 files**.
  New reconciliation tests: **30**, including dependency races, cached errors,
  code classification, disposal, explicit supersession and immutable snapshots.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1317 /58 files**.
  New reconstruction regression: **1**. Existing child/guard/conformance coverage
  passes. The targeted reconstruction/child/conformance command passes **491 /3**.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  **19/19**, about **116 seconds**. The new case generates, type checks and builds
  an app, then proves four committed/lost-reply cases in production Chromium.
  Existing recipes/state/tasks/resources/schema/HTTP/SSE/Node sockets/dev/HMR pass.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: **2/2**, about **111
  seconds**. Existing native D1/policy/schema/stream/cancellation/limiter/socket
  acceptance remains passing alongside the new persisted-recovery matrix.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations.
  The complete public-export guide example is included in the resource type
  fixture. Its final standalone published-type test passes **1/1** after that
  addition. Negative names and immutable result types are covered too.
- Owned whitespace, fixture JS syntax and relative documentation file links pass.
  All 58 original checkbox IDs/states remain unchanged. Versions stay 0.8.3.
  reports.md/.zcodeignore are user-owned and unstaged. No remote/live resource changes.

Intermediate failures and corrections:

- The first unit cases failed because reconcile$ did not exist. A later dependency
  race sent both reads to the later record. Synchronous entry binding fixes that.
- The router reconstruction regression failed with two reads before suppression.
  An initial test import used a nonexistent router export and was corrected before
  the valid failing baseline. The final test uses the actual createApp factory.
- Generated fixture compilation exposed invalid Layout/Inject declarations and
  an untyped API Context. Correct Page service ownership, explicit Inject type,
  typed Hono context and an inline server$ loader now compile. These were fixture
  defects, not final production acceptance.
- A native run passed the peer test but failed while waiting for actual SSE open.
  Its test app omitted /sse/ from ORM middleware coverage. ORM-backed session
  validation failed outside database context, so the stream could not authenticate.
  The fixture now initializes database context on /sse/ before session validation.
  Earlier SSE-page checks did not wait for actual open. The stronger final check
  does. This changes the disposable test application, not library auth policy.
- The first full framework run passed 1316 cases and failed one partial component
  fixture lacking __renderRpcTarget. The fixture now models the new internal entry
  point. Its original forbidden-method status assertion passes unchanged. The
  final full suite above supersedes that intermediate run.

Next for GLM: finish RT-06 steps 3–4. Prove native socket loss after committed
writes, reconnect without replay, actual SSE resync and different late snapshots,
multiple pending calls, retained layout/service consumers, post-yield stream
errors and cancellation. Make every loading owner settle once. Audit all original
criteria before checking RT-06. Existing value fingerprints do not order different
snapshots by server revision. Keep broader RT-01 incoming disconnect/deadline/init
and RT-11 session gates separate. Continue all remaining IDs and the Node plain
Vite development 404 gap. The [detailed plan](./release-0.9.0-plan.md#rt-06) and
[Codex handoff](./handoff-0.9.0.md) identify the next concrete work.


<a id="codex-optimistic-socket-2026-10-03"></a>
## Codex review: native optimistic socket recovery (2026-10-03)

Author: Codex. Continued after `51bef75`. **20/58 checked, 38 unchecked.**
All original IDs and states remain. RT-06 stays open for the remaining SSE,
late-snapshot, retained-consumer and optimistic stream/service matrix criteria.

Native acceptance now generates a stateful durable-object page, builds through
published framework exports and runs Chromium against actual workerd and D1.
A mutation inserts an operation record, increments the durable count, updates
public state and signals commit while its correlated reply remains held. The
checker audits D1, loading and request IDs before a test-only DO endpoint closes
the real server socket. Held I/O releases after close starts. The browser reports
TRANSPORT_CLOSED, releases loading once and sees no correlated terminal reply.
Backend counts prove one committed write and zero mutation replay.

A second case sends two pending calls on one socket. The server queue starts one
write and holds it. The second invocation remains queued. Closing cancels both
client owners, and the queued method never executes. D1 contains one operation
and one increment for the pair. This preserves the actual socket queue contract,
not a claim that every pending client action already committed.

The harness then actually evicts the DO and closes any early replacement socket.
The checker requires a different open socket after eviction. Its authoritative
public snapshot restores the persisted count. The client-only draft stays local.
The next action uses restored component state and handshake identity. Actor
assertions require the signed-in user u1. The test app installs its ORM context on
/ws/ before ORM-backed session validation, as it already does on /sse/. This
changes disposable app wiring, not production authentication policy.

Two further native cases commit and yield before a client-visible stream error
or explicit client cancellation. Each retains persisted public data and the draft,
releases loading once and sends one action. The final D1 count is four, with four
unique committed operations. The extra queued request has no operation record.
A canceled or failed stream cannot establish rollback of a preceding write.
This matrix is component-owned. Explicit service and HTTP/SSE optimistic stream
acceptance remains separate.

The native fixture initially supplied an explicit registry. Inspection uncovered
a production default-registry bug: AppDurableObject used a package-relative glob
and registered bundled framework demos instead of generated application pages.
A failing unit regression returned those demo keys. The default now uses the
router's virtual application page/layout registry, preserves exact compiler paths
and accepts only default Cossack subclasses. Named helpers, missing defaults and
native HTTP modules are excluded. Final native acceptance subclasses this default
only to add socket-close control. Lookup/restoration use the published production
registry. No fixture-specific page registry remains.

A client asset audit also found socket SQL in an emitted native API chunk. The
route used D1 directly, so the import-based server-only detector did not classify
it. Client catalog imports could therefore expose the handler and its dependency.
The security load hook now uses the shared functional-HTTP source classifier for
route modules. It replaces their default/named export shapes with throwing stubs
before original imports/body evaluation. Explicit aliases and string export names
remain usable module bindings. Ambiguous runtime export stars refuse compilation
with a route-specific diagnostic. SSR returns original modules, and component
classes still follow normal stripping. This does not infer arbitrary non-route
module privacy. The native fixture scans every emitted client JS asset for both
socket SQL table names. Those checks pass after the compiler correction.

Final verification against the rebuilt framework:

- `pnpm --filter @cossackframework/framework run build`: declarations, library ESM
  and executed framework SSG pass. Build completed before runtime consumers ran.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1326 /60 files**.
  Default DO registry regression: **1**. Native HTTP boundary file: **8**, including
  four handler shapes, SSR preservation, component/helper separation, explicit
  aliases/string exports and export-star refusal. Final targeted boundary/security
  command passes **177 /2 files**. Child-target regressions also remain passing.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  final **19/19**, about **114 seconds**. Existing published Node/Deno/Desktop
  builds and production Node/browser HTTP/SSE/resource/state/task/schema/recipe/
  socket/dev/HMR acceptance pass. This is not native Deno or Electron execution.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **120 seconds**. New generated native socket/eviction/stream cases, explicit
  actor identity and client SQL exclusion pass. Existing native D1/schema/policy/
  HTTP/SSE/cancellation/limiter/socket-peer acceptance remains passing.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations
  pass on final source. Core implementation is unchanged from the preceding
  checkpoint's **1255 /72** suite. No new full monorepo release gate is claimed.
- Owned whitespace, fixture JS syntax and relative documentation file links pass.
  All original 58 checkbox IDs/states are preserved. Versions remain 0.8.3.
  reports.md/.zcodeignore remain user-owned and unstaged. No remote/live changes.

Intermediate evidence:

- The first fixture used transport websocket on Cloudflare. Capability validation
  rejected it before build. The fixture now uses durable-object. This was a
  fixture error, not a new production transport capability.
- The first native checker initiated browser close and waited for every pending
  action to commit while holding the first action. Its queue made that impossible,
  and the close handshake could also wait on the held callback. The valid checker
  distinguishes committed from queued work, initiates server close, then releases
  I/O. It never weakens the one-mutation/no-replay invariant.
- An intermediate native run passed after that correction with an explicit
  registry. The default registry regression subsequently failed on demo keys.
  Corrected default-registry/actor/eviction acceptance passed **2/2** before the
  API-body audit. It did not certify client SQL exclusion.
- The API boundary baseline failed **4/6**. Actual client chunk inspection also
  exposed the D1 SQL. Eight final boundary cases pass after the load guard.
  The final rebuilt native run executes both SQL-exclusion assertions and passes.
  Final rebuilt generated **19/19** and framework **1326/60** supersede the earlier
  **19/19** and **1318/59** runs before the compiler guard.
- Processes were observed through their original handles. No live test restarted
  solely because an observation timed out. Each rerun followed a fixture/compiler
  correction or a changed acceptance assertion.

References retrieved for native API/type checks: current
[Cloudflare WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
and the latest Workers type definitions. Installed Wrangler harness declarations
provide the authoritative evictDurableObject signature used by the test.

Next for GLM: finish RT-06 steps 3–4. Prove actual SSE resync and different late
snapshots before/after call cleanup. Test retained layout/service consumers and
late subscribers joining pending service work. Extend optimistic post-yield
failure, malformed reply and cancellation acceptance through HTTP/SSE and explicit
services. Preserve mutation uncertainty, server snapshot authority and local
drafts, then audit every original criterion before checking RT-06. Echo history
is still value-based and does not order different snapshots by server revisions.
Broader RT-01 incoming disconnect/deadline/init and RT-11 session criteria remain
open. Continue every unchecked ID and the Node plain Vite development 404 gap.
Read the [plan](./release-0.9.0-plan.md#rt-06) and [Codex handoff](./handoff-0.9.0.md).

<a id="codex-retained-service-loading-2026-10-03"></a>
### Codex continuation: retained service consumers and loading (2026-10-03)

Author: Codex. Continued after `43c189a`. No checkbox closes: **20/58 checked,
38 unchecked**. All original IDs and states remain. RT-06 stays open for actual
SSE resync/different late snapshots and the remaining optimistic stream matrix.

Six of eight initial controlled regressions failed. A consumer that joined a
retained service during an action received its preview but no loading count.
The scope also attached unrelated action counts to consumers of another service.
ServiceScope now tracks active invocations by declared service class. Each
invocation records one release per consumer. New subscriptions attach to matching
pending work, including work that started without subscribers. Duplicate injection
and unsubscribe/rejoin keep one count. Shadowed scopes remain independent.

The ten final controlled cases cover late consumers, overlapping calls, work
without initial subscribers, duplicates/rejoin, another declaration, equal action
names, independent component loading, shadowing, exited consumers and settled work.
Ambient completion protection uses the same per-consumer RPC ownership guard.
A consumer that exits releases on settlement without another render. A consumer
that now only subscribes to another declaration also avoids an unrelated render.

Production Node/browser acceptance extends the actual scoped-service recipe.
The test adds a declared optimistic increment and observable loading to its
published application. It holds success and rejection replies during sibling
navigation. The retained layout, new sibling page and new nested consumer share
the preview and pending count, then receive confirmed state or rollback. Five
browser action dispatches remain five. Leaving the layout runs its actual disposal
hook once. Returning creates fresh service state.

The shared recovery fixture also runs under production Node and native workerd/D1.
It consumes a real committed service response, then holds delivery to the browser.
Navigation creates new consumers before settlement. Loading and local preview
remain visible in each consumer. Releasing the reply settles every count once.
Backend audit records one additional mutation, with no repeated action dispatch.
A subsequent real input rejection is held during return navigation. It removes
only its preview and performs no additional write. Actual HTTP and authenticated
SSE pages use the same fixture. The SSE connection must open before each relevant
case. Explicit service mutations still use HTTP. These assertions do not prove
SSE resync delivery or an optimistic streamed service action.

This change preserves the existing invocation lifetime. Layout exit does not
cancel that invocation. It does not stop ignored I/O, add a deadline or establish
transaction rollback. RT-01 retains its wider lifecycle/disconnect criteria.
Snapshot fingerprints still do not order different server snapshots.

Final verification:

- `pnpm --filter @cossackframework/core run build`: ESM and declarations pass.
- `pnpm --filter @cossackframework/framework run build`: declarations, library ESM
  and executed framework SSG pass. Runtime consumers ran after builds completed.
- `pnpm --filter @cossackframework/core exec vitest run`: **1265 /73 files**,
  including all **10** new loading regressions and existing optimistic cleanup.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1326 /60 files**.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  final **19/19**, about **113 seconds**. Extended recipe and recovery navigation,
  previous production/browser tests and portable target builds pass. This does
  not establish native Deno or Electron execution.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **125 seconds**. Native retained-consumer/D1 cases and preceding socket,
  eviction, stream, session, policy, migration and asset acceptance pass.
- Final root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package
  configurations pass. Owned whitespace, JS syntax and relative documentation
  file links pass. Versions remain 0.8.3. reports.md/.zcodeignore remain user-owned
  and unstaged. No remote/live changes or complete monorepo release gate claim.

Intermediate results: the original controlled suite failed **6/8** before the
source correction. Initial native acceptance failed **1/2**, and an already
running generated suite failed **1/19**. Both reached the new navigation/rollback
assertions but expected the wrong input-validation code. The established code is
COSSACK_VALIDATION_FAILED. Corrected acceptance preserves that production contract.
The final native **2/2** and generated **19/19** supersede those runs. An early
package typecheck overlapped framework declaration rebuilding and observed its
removed dist entry. Final root/all-package checks ran after rebuilding and pass.
No source change was needed for that build-order error. Tests were observed through
their original handles. Reruns followed source, coverage or fixture corrections.

Next for GLM: finish RT-06 steps 3–4. Prove actual SSE resync and different late
snapshots before/after cleanup. Extend optimistic malformed replies, post-yield
failure and cancellation across HTTP/SSE and explicit services. Preserve retained
consumer ownership, server snapshot authority and client-only drafts. Audit every
original done criterion before checking RT-06. Continue all other unchecked tasks,
including the Node plain Vite development 404 gap and final release gates.
Read the [plan](./release-0.9.0-plan.md#rt-06),
[service lifetime](../docs/services.md#scope-and-lifetime) and
[Codex handoff](./handoff-0.9.0.md).

<a id="codex-optimistic-sse-ordering-2026-10-03"></a>
## Codex optimistic SSE ordering and resync (2026-10-03)

Author: **Codex**. Continued after `4d8fff0`. Ledger remains **20/58 checked,
38 unchecked**. All original IDs and states remain. RT-06 stays open for the
remaining optimistic HTTP/service stream cases, complete example and criterion audit.

The new native browser/workerd/D1 case reproduced a production error: the server
committed one increment, but its ambient SSE publication doubled the pending browser
preview to two before the held HTTP response arrived. Publications now correlate the
originating request to only the target's active optimistic call. Public confirmation
removes that call's contribution without releasing its terminal response/loading
ownership. The authoritative snapshot remains plain public state; request identity
is bounded event metadata. Re-encoded stream frames retain the byte budget.

Event IDs, `X-Cossack-SSE-Cursor` response headers and reserved generator state metadata
order page snapshots. An older reply confirms its own contribution without replacing
a newer base; its return value still belongs to that action. Duplicate cursors cannot
undo a surviving edit. Higher revisions restore public authority after settlement,
even for equal values. Child-local replies never carry their parent page cursor.
ClientState/ClientStore drafts stay local. Sources without cursor metadata retain
value-fingerprint behavior. Reopening resets the client baseline; this is not a
universal epoch protocol across unrelated processes or server generations.

A second review found process-local SSR reset publication IDs under an existing
subscriber. Node/Deno now use process publication IDs across entry replacement and
recreation; active connection counts survive replacement. Scopes can observe gaps.
An actual stream reader regression proves updates before and after replacement.
The store remains process-local with no durable history or distributed guarantees.

Native acceptance uses actual cookie authentication, COSSACK_SSE, D1 and native
Chromium EventSource. A committed HTTP reply is consumed and held while its real
publication arrives. Different snapshots arrive before and after settlement; newer
state survives. A private fixture middleware ends the real subscription response
after a selected event. The client enters reconnecting; offline mode holds retry
while 130 real coordinator publications exceed retained history. Restoring network
allows automatic Last-Event-ID reconnect/resync. The browser converges to persisted
count 777 with its draft intact and no repeated mutation. The native EventSource
class and production subscription handler are unchanged.

Native optimistic streams commit/yield, then fail visibly or are canceled explicitly.
Counts converge to 778/779, loading settles once, drafts persist and each action
dispatches once. The cancellation fixture releases held application I/O explicitly;
it does not prove termination of ignored I/O or rollback. Production Node/browser
uses the actual process-local SSE backend for correlated confirmation, different
late snapshots and post-yield failure. It does not claim native Deno execution.

Thirteen controlled core cases cover own broadcast/reply order, coalesced updates,
other callers, old/duplicate state, pending local edits, equal newer authority,
reopened baseline and malformed header/final-frame cursors with correlated errors.
The Node SSR stream-reader case and router JSON/multipart frame assertions require
strictly increasing safe cursor values. All earlier owned tests remain.

Intermediate evidence: the original native case failed with browser count 2 versus
D1 count 1. Offline mode alone did not terminate an existing subscription, so the
fixture now closes the actual response before holding retry. Existing exact stream
expectations were updated to include cursor metadata and enforce monotonicity. The
Node fixture needed its generated Cossack type without Cloudflare Env. Two early
consumers overlapped dist rebuilding; final consumers run after completed builds.
These fixture/build-order failures are distinct from the reproduced production bug.

Final verification:

- Core ESM/declaration build passes; core **1278 /74 files** passes, including all
  **13** new snapshot ordering cases. Subsequent source changes affected only
  the framework process-local cursor and its tests.
- Framework build passes declarations, library ESM and executed SSG. Consumers
  run after builds complete. Expected local missing-secret warnings do not fail
  the build and provide no live-deployment evidence.
- Final framework suite: **1327 /60 files**, including the new SSR replacement
  stream-reader regression. Targeted scope/router stream checks: **58/58**.
- Final generated runtime suite: **20/20**, about **126 seconds**. Real production
  Node/browser SSE, previous service/navigation/recovery acceptance and portable
  builds pass. No native Deno or Electron execution claim.
- Final native workerd/D1 and socket-peer suite: **2/2**, about **138 seconds**.
  Native SSE confirmation/resync/post-yield failure/cancellation and all preceding
  auth, RPC, socket, migration, policy and client-asset audits pass.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations
  pass after builds. JS syntax, owned whitespace and relative documentation file
  links pass. Ledger comparison against HEAD preserves all **58** original IDs
  and checkbox states. reports.md/.zcodeignore remain user-owned and unstaged.
  This is a targeted checkpoint, not the complete monorepo release gate.

Next for GLM: finish remaining HTTP and explicit-service optimistic malformed
payload, post-yield failure and cancellation cases. Preserve retained service
consumers and per-call ownership. Audit RT-06's original combinations and publish
its full example before checking the task. Keep wider RT-01 deadline/init/incoming
disconnect and RT-11 session gates separate. Continue all other unchecked IDs and
release gates. Node plain Vite development 404 remains CF-10/REL-03 work. Versions
stay 0.8.3. Preserve reports.md/.zcodeignore. No remote/live change was made.
Read the [detailed plan](./release-0.9.0-plan.md#rt-06),
[SSE contract](../docs/sse.md#optimistic-confirmation-and-snapshot-order),
[optimistic guide](../docs/optimistic.md), and [handoff](./handoff-0.9.0.md).

<a id="codex-optimistic-completion-2026-10-03"></a>
## Codex RT-06 completion and stream ownership (2026-10-03)

Author: **Codex**. Continued after `0272cba`. RT-06 now passes its original
criterion audit: **21/58 checked, 37 unchecked**. All original IDs remain.
Only RT-06 changes checkbox state. The complete objective remains all 58 tasks.

The first controlled stream suite found a real service bug: cancellation before
iterator startup never entered the generator's finally block, retaining both the
preview and loading. Explicit service cancellation now invokes idempotent cleanup.
Terminal/finally cleanup cannot release the call twice. Component/service calls also
share an abort-aware response waiter. Cancellation/deadlines stop waiting even when
a request producer ignores abort. The original promise stays observed, and a late
body is released without state hydration. This does not terminate external I/O.

The final **32-case** controlled suite covers component HTTP/SSE and explicit-service
streams: confirmed yields followed by visible errors, malformed JSON, wrong request
IDs, missing completion or trailing terminal data; pending-reader cancellation,
before-iteration cancellation, stalled pre-header cancellation/deadlines and
post-yield deadlines. Repeated cancellation and result reads dispatch once and keep
loading settled. Late consumers inherit loading, then settle together. Two service
cases confirm count while independent title rejects, with/without a later local edit.
Confirmed public state survives. Unconfirmed client-only previews roll back.

A shared **25-case** production Node/browser and native Chromium/workerd/D1 matrix
executes real mutations before failures. Component HTTP/SSE streams and explicit
services on HTTP/open SSE/open socket pages cover post-yield error, cancellation,
malformed JSON, truncation and trailing terminal frames. The test corrupts only
bounded actual response delivery after the backend commits. Each record has one
mutation, each browser action dispatches once, public state remains one, local drafts
persist, and page/layout/nested loading is zero. Services use HTTP regardless of page
transport. Earlier native component socket stream failure/cancellation stays verified.
Cancellation fixtures explicitly release held application I/O; they do not prove
server rollback or termination of ignored work.

The published [page](../docs/examples/optimistic-stream.ts) and
[private store](../docs/examples/optimistic-stream.server.ts) are executable artifacts.
The page uses validated input, explicit previews, rpc$ iteration/cancel, automatic
loading, a ClientState draft and declared persisted reads. The private SQL helper
uses the authenticated request's owner ID and an atomic parameterized increment.
It uses SQLite/D1 syntax and shows demo table creation; real apps use a migration.
Generated fixtures copy the exact page. Native D1 uses the exact helper; Node replaces
only persistence. Actual controls exercise success, authored post-write failure and
cancel/read convergence. Three increments remain three dispatches and persisted
count three; no uncertain mutation is retried. The SQL names stay out of client chunks.

The example chooses refresh explicitly for its deliberately authored post-write
client-visible error; that error is outside transport uncertainty classification.
Network/cancel uncertainty uses reconcile$. A recovered read remains distinct from
the original mutation's outcome. The read can include other callers' changes.

Final verification:

- Core ESM/declaration build passes. Full core suite **1310 /75 files**, including
  all **32** new stream cases and the published-export example declarations.
- Framework build passes declarations, library ESM and executed SSG; full suite
  **1327 /60 files**. Consumer runs use completed dependency builds.
- Generated runtime suite **21/21**, about **139 seconds**, including actual
  production Node/browser stream and example acceptance, all prior navigation,
  service, recovery and portable-build checks. The production test server now
  attaches the real Node WebSocket runtime before announcing its origin.
- Native workerd/D1 and socket-peer suite **2/2**, about **140 seconds**, including
  the 25-case stream matrix, exact example/helper, preceding socket eviction/SSE
  resync, sessions, policies, migrations and client-private-SQL asset audits.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations
  pass. JS syntax, owned whitespace, documentation file links and exact ledger
  ID/state comparison are checked before commit. No complete monorepo release
  gate, native Deno/Electron execution or live deployment claim.

Intermediate results: an import typo stopped the first new suite before collection.
The initial collected **24-case** run had **18 failures**; one reproduced the service
pre-start cancellation bug. The others reflected fixture assumptions about closed
stream cancel callbacks, the existing truncated-stream error code, or canceling a
late already-closed body. Corrected assertions inspect the actual EOF/reader ownership
contract. The extended final 32 cases pass. The first example declaration run lacked
published package paths for files outside packages; explicit declaration paths now
compile the real artifacts. An expanded Node socket-page run timed out because the
production fixture omitted runtime.attach. Correct fixture wiring makes the connection
open, and the final generated 21/21 supersedes that run. Native final 2/2 follows all
fixture/example extensions. Tests were observed through their original live handles.

Read the [original criterion audit](./release-0.9.0-plan.md#rt-06),
[guide](../docs/optimistic.md#cancel-a-stream), and [Codex handoff](./handoff-0.9.0.md).
Next for GLM: RT-07 typed URLs/parameters/API contracts from the compiler route model
and existing inspection metadata, then every other unchecked task and release gate.
Broader RT-01 initialization/incoming disconnect/server-execution deadlines, RT-11
sessions and Node plain Vite development 404 remain open. Versions stay 0.8.3 until
REL-04. reports.md/.zcodeignore remain user-owned and unstaged. No push/publication,
live cloud operation, external message or new chat was performed.

<a id="codex-navigation-acceptance-2026-10-04"></a>
## Codex: RT-08/RT-09 acceptance audit (2026-10-04)

Audited the original Purpose, Approach and Done when requirements against source,
public contracts and behavioral assertions. The criterion tables are in
[RT-08](./release-0.9.0-plan.md#rt-08) and [RT-09](./release-0.9.0-plan.md#rt-09).
Both tasks are complete. The checklist retains all 58 IDs: 24 checked, 34 open.

Added browser regressions for an older linked-page response arriving after a newer
commit, actual fragment scrolling with missing-target fallback, and navigation
without `document.startViewTransition`. The transition example now exposes the
stable `item-preview` target. The rapid-link fixture uses temporary anchors because
collapsed sidebar groups do not render their links. Its initial fixture timeout was
corrected before the final complete browser run.

Verification on the final implementation:

- Full generated-runtime file: **31 passed**, including actual production Node and
  native workerd ownership, backend-read and interrupted same-URL history fixtures.
- Navigation, guard and view-transition browser suites: **27 passed**.
- Focused core URL-state, published type, SSR/hydration and navigation suites:
  **70 passed across 6 files**.
- Framework navigation outcome/owner suites: **50 passed across 2 files**.
- Root `pnpm tsc --noEmit` and all **11** package type checks: passed.
- Whitespace check excluding the user's existing `reports.md`: passed.

Logs: `/tmp/cossack-navigation-matrix-audit.log`,
`/tmp/cossack-navigation-browser-verified.log`,
`/tmp/cossack-navigation-audit-core.log`,
`/tmp/cossack-navigation-audit-framework.log`,
`/tmp/cossack-navigation-audit-root-types-verified.log` and
`/tmp/cossack-navigation-audit-package-types-verified.log`.

The initial Playwright startup probe delayed server launch. A locally started
server supplied the final browser runs. A concurrent automatic startup hit the
occupied devtools port during the first run; the final run reused the single
server and passed. No credentials, remote resources or deployment were required.

RT-28 still needs its broader devtools snapshots/timeline interface. Navigation
events alone do not close it. REL-03 still requires the complete final release
matrix. Versions remain 0.8.3 until REL-04. Arbitrary external side effects, ignored
application I/O and legacy global DI remain outside the documented ownership
contract. No other task status changed.

<a id="codex-local-mcp-2026-10-04"></a>
## Codex: Local MCP inspection foundation (2026-10-04)

Implemented the `cossack-mcp` package binary with the official MCP server SDK
2.3.0 and strict Zod input/output schemas. The SDK client is a development-only
test dependency. pnpm updated the lockfile and added version-specific release-age
exceptions for the new SDK server/core/client packages. Framework versions remain
0.8.3. No application runtime imports the SDK.

The read-only `inspect_project` tool shares static route/deployment/provider models
with CLI inspection. Route explanation/check logic now lives in an output-free
service. The server binds to the real startup project path and reports installed
CLI/framework versions. The import-only framework export exposed a version lookup
bug during testing; manifest lookup now follows package search paths without
executing modules. Missing framework installation reports null.

Workers capture dependency logs and terminate on cancellation, deadline or shutdown.
Concurrency and serialized result sizes are bounded. The public setup guide records
these limits and the remaining tool families. Local project binding does not claim
a sandbox against malicious dependency/source files.

Verification:

- **234 tests across 8 files** passed: MCP, inspect, inspection acceptance, provider
  inspection, CLI subprocess, command contracts, JSON matrix and command specs.
- After aligning default environment selection, **23 tests across 2 files** passed
  again (MCP and inspect). The follow-up covers inherited environment selection.
- Root `pnpm tsc --noEmit` and all **11** package type checks passed after final edits.
- Whitespace check excluding the user's existing `reports.md` passed.
- Actual SDK subprocess tests cover legacy and `2026-07-28` protocol clients,
  installed versions, unknown tools/fields/route paths and configured-secret
  redaction. Raw subprocess tests prove prompt exit on pre/post-initialization EOF
  and SIGTERM. Worker tests prove synchronous cancellation, timeout, shutdown,
  concurrency limits and oversized-result rejection.

Logs: `/tmp/cossack-mcp-regression.log`, `/tmp/cossack-mcp-env-verified.log`,
`/tmp/cossack-mcp-root-types-verified.log` and
`/tmp/cossack-mcp-package-types-verified.log`.

CLI-07 stays unchecked: installed documentation, stored test results, development
traces, further native interruption acceptance and packaged-entry acceptance remain.
The checklist still contains 58 IDs, with 24 complete and 34 open. Nothing was
published, deployed or pushed. User changes in `reports.md` and `.zcodeignore`
remain outside this checkpoint.

<a id="codex-installed-catalog-2026-10-04"></a>
## Codex: Installed-version catalog foundation (2026-10-04)

Added `cossack docs` and MCP `read_documentation` through one offline service.
The catalog follows installed package search paths rather than repository source
paths. It reads versions, manifest hashes and declared export targets with their
conditions and availability. No entrypoint executes. Re-reading after a manifest
change removes stale exports and refreshes versions. Unknown package paths reject
before file access, and malformed manifest errors omit raw contents.

Command schemas come from CLI command metadata. A packaged agent guide identifies
its CLI version and states discovery limits. New scaffolded AGENTS files point to
local discovery commands. MCP keeps its outer framework-version metadata fresh,
including packages installed after the server started. Both tools use strict input
and versioned output schemas and the existing cancellable worker runner.

Verification:

- **212 tests across 6 CLI files** passed: documentation, MCP, command contracts,
  command specs, CLI subprocess and JSON matrix.
- **78 scaffold tests** passed, including generated offline-discovery guidance.
- After allowing startup with malformed framework metadata, **18 MCP/catalog tests**
  passed again. A broken manifest now produces a redacted tool diagnostic instead
  of preventing the agent from inspecting the project.
- Root `pnpm tsc --noEmit` and all **11** package type checks passed.
- Whitespace check excluding the user's existing `reports.md` passed.

Logs: `/tmp/cossack-docs-regression.log`, `/tmp/cossack-docs-scaffold-final.log`,
`/tmp/cossack-docs-malformed-verified.log`,
`/tmp/cossack-docs-root-types-verified.log` and
`/tmp/cossack-docs-package-types-verified.log`.

CLI-07 and CLI-08 remain open. File presence is not evidence of a valid runtime
import. Named API/component symbols, signatures, runtime support, authored and
executable examples, wildcard expansion and offline installed-tarball verification
still need implementation/evidence. Test-result and devtools trace tools remain
CLI-07/RT-28 work. All 58 task IDs remain: 24 complete, 34 open. Versions stay
0.8.3 until REL-04. No remote publication, deployment or push occurred.

<a id="codex-declaration-index-2026-10-04"></a>
## Codex: Compiler-backed declaration catalog (2026-10-04)

Added optional per-package symbol indexing to CLI/MCP documentation. The Node-only
CLI pins TypeScript API 6.0.3 under `typescript-api`; the root TypeScript 7 compiler
is unchanged. Public signatures come from fresh programs over installed type files,
not regex parsing, repository sources or executed entrypoints.

The index includes aliases and re-exports, overloads/generics, public class and
interface members, static members, object/namespace/enum helpers and CommonJS
export assignments. It omits private/protected members and constructors and marks
abstract classes. Declared type-only class/function signatures never imply runtime
value availability. Programs do not load project tsconfig plugins. The documentation
records the fixed ES2022/ESNext/Bundler strict profile with no automatic ambient
packages, partial/unavailable states and the first-100 diagnostic limit.

Tests prove freshness when referenced declarations change without manifest/version
changes. They also cover missing/unresolved type files, non-module declarations,
private constructor exclusion, CLI input validation and actual MCP worker results.
A manual installed-core run indexed 357 root exports and four additional declared
entrypoints. It returned partial with five unresolved platform-type diagnostics,
which remains a reported limit rather than hidden compatibility evidence.

Verification:

- **222 tests across 7 CLI files** passed before the final member-visibility follow-up.
- **30 declaration/documentation/MCP tests across 3 files** passed after the final edits.
- Root `pnpm tsc --noEmit` and all **11** package type checks passed after final code changes.
- Whitespace check excluding the user's existing `reports.md` passed.

Logs: `/tmp/cossack-declaration-regression.log`,
`/tmp/cossack-declaration-verified.log`,
`/tmp/cossack-declaration-root-types-verified.log` and
`/tmp/cossack-declaration-package-types-verified.log`.

CLI-08 stays unchecked. Authored API/component/recipe guidance, executable examples,
verified runtime support, wildcard/implicit type discovery and offline installed
package acceptance remain. CLI-07 still needs test-result and devtools trace tools.
The checklist retains 58 IDs: 24 complete, 34 open. Versions remain 0.8.3 until REL-04.

<a id="codex-export-discovery-2026-10-04"></a>
## Codex: Public export and implicit declaration discovery (2026-10-04)

Implemented concrete wildcard inventory with exact/more-specific precedence and
private null exclusions. Repeated target stars share one named capture, including
numeric trailers. Unreachable default branches are skipped. Array fallbacks follow
resolution rules instead of selecting whichever file exists. Native Node tests
verify exported paths and private denial without executing package entrypoints.

The scanner skips nested symlinks and node_modules, bounds directory-entry visits
at 20,000 and reports incomplete scans. Unsupported URL targets/file names and
constant pattern mappings remain explicit. Targets reject traversal, encoded
separators and forbidden path segments. These are discovery limits, not a claim
that all local projects are sandboxed.

TypeScript extension substitution finds declarations beside JS/MJS/CJS targets
and legacy main/default-index entries. The catalog records each candidate's
conditions, resolved file and status. Missing public type coverage makes the index
partial. Wildcard type files can be indexed while their runtime target remains
missing. Runtime availability remains unverified.

Verification:

- **243 tests across 8 CLI files** passed before the final type-only/numeric-trailer follow-ups.
- **51 focused discovery/declaration/documentation/MCP tests across 4 files passed** after the final follow-ups.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed after the final code changes.
- `git diff --check -- . ':!reports.md'` passed.

Logs: `/tmp/cossack-discovery-regression.log`,
`/tmp/cossack-discovery-final-verified.log`,
`/tmp/cossack-discovery-root-types-verified.log` and
`/tmp/cossack-discovery-package-types-verified.log`.

CLI-08 remains open for authored guidance, executable examples, verified runtime
support and offline tarball acceptance. CLI-07 test-result and devtools trace tools
remain open. The release checklist retains 58 IDs, with 24 complete and 34 open.
Versions remain 0.8.3 until REL-04. No publication, deployment or push occurred.

<a id="codex-installed-docs-acceptance-2026-10-04"></a>
## Codex: Installed documentation acceptance (2026-10-04)

Added `pnpm test:agent-docs:local`, also included in the existing generated-app
CI acceptance path. It builds and packs local packages, generates a minimal
application and installs the tarballs. CLI/MCP entrypoints and inspected packages
must resolve inside that installation, rather than to workspace symlinks.
The test checks installed versions, command metadata, packaged/generated guidance,
renderer signatures, CLI/MCP parity and version/export refresh in a running server.
Manifest replacement uses new files to avoid modifying pnpm store hardlinks.

Node fetch, socket, HTTP and DNS calls are blocked during discovery. The guard
records attempts even if callers catch errors. It is tested before discovery,
and the final assertion proves no attempts occurred. MCP workers inherit the
guard. Dependency installation can use the registry. This is ordinary Node API
coverage, not operating-system isolation against hostile native code.

Verification:

- `pnpm test:agent-docs:local` passed after correcting a test assertion to expect
  the server's explicit `isError: false`. Log: `/tmp/cossack-agent-docs-tarball-final.log`.
- The acceptance builds publishable packages before packing them. The focused
  command skips the unrelated application build/runtime smoke scenarios.
- Script syntax checks, workflow YAML parsing and whitespace checks passed.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-docs-acceptance-root-types-final.log` and
  `/tmp/cossack-docs-acceptance-package-types-final.log`.

CLI-08 remains open for authored API/component/recipe guidance, executable
examples, verified runtime support and acceptance of that remaining content.
The renderer signature check does not establish complete declaration coverage
for every package. CLI-07 stored results and RT-28 trace tools remain open.
Task status remains 24 complete and 34 open. Versions remain 0.8.3.
No publication, deployment, push or external credential rotation occurred.

<a id="codex-package-guidance-2026-10-04"></a>
## Codex: Package-owned guidance and executable examples (2026-10-04)

Library packages can now publish `agent-docs.json` with authored usage explanations
and TypeScript examples. The shared CLI/MCP reader ties each guide to its installed
package version, hashes fresh content and reports unavailable/invalid/partial data.
The bounded reader validates schema and identities, rejects files outside the
package and omits guides whose listed public imports are unavailable. Errors do
not expose raw guide contents. CLI text output includes prose and example source.
Discovery never evaluates the examples or claims runtime compatibility.

Core includes a typed route URL guide and encoded parameter/catch-all example.
Renderer includes a server HTML guide and escaped-text example. Both files ship
in package tarballs. The installed acceptance harness compiles their source with
strict TypeScript and executes emitted JavaScript through public package exports.
The harness selects these repository-owned guides explicitly. It does not offer
execution of arbitrary installed guidance through the CLI or MCP.

The initial example run passed compilation and behavior assertions but detected
a local socket attempt from the tsx loader. The final harness uses TypeScript's
emitted JavaScript directly. The final zero-attempt network assertion passes.
CI now runs generated-app acceptance for core and renderer changes too.

Verification:

- **61 tests across 5 files passed**, covering guidance validation/refresh,
  human CLI output, declaration/export discovery and MCP behavior.
  Log: `/tmp/cossack-package-guidance-tests-final.log`.
- `pnpm test:agent-docs:local` passed: **2 packaged examples compiled and executed**,
  installed CLI/MCP parity, stale export/guide removal and zero Node network attempts.
  Log: `/tmp/cossack-package-guidance-tarball-final.log`.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-package-guidance-types.log` and
  `/tmp/cossack-package-guidance-package-types.log`.
- Script syntax, workflow YAML parsing and whitespace checks passed.

CLI-08 remains open for broader authored API/component/recipe coverage, verified
runtime guidance and the original RT-23/REL-02 dependency gates. These examples
establish Node behavior only. CLI-07 stored results and RT-28 traces remain open.
Task status stays 24 complete and 34 open. Versions remain 0.8.3. No publication,
deployment, push or external credential rotation occurred.

<a id="codex-recipe-guidance-2026-10-04"></a>
## Codex: Recipe guidance and pure registry declarations (2026-10-04)

Scaffold now publishes package-owned guides for resource, mutation, scoped-service
and protected-route recipes. They explain generated behavior, limits, dry-run and
application commands, adaptation steps and the boundary between static capability
checks and remote readiness. Four executable planning examples use the installed
public registry. Protected-route coverage checks auth/database/UI dependencies,
D1 binding requirements and rejection of a Node/D1 selection.

A compiler fixture reproduced TS2591 for Buffer when importing only the pure
registry with no Node ambient types. The registry declarations previously
re-exported the root filesystem declarations. Shared metadata declarations now
live in registry.d.ts, and the root API re-exports them. Dedicated fixtures verify
both the pure registry and the full Node API. Runtime recipe behavior is unchanged.

Verification:

- **109 scaffold tests across 5 files passed** after the declaration fix.
  Log: `/tmp/cossack-recipe-guidance-tests.log`.
- **2 final public declaration checks passed**, covering the registry without Node
  globals and the root API with Node types. The root fixture was corrected to
  pass recipe options rather than the distinct add-feature options type.
  Log: `/tmp/cossack-recipe-guidance-types-tests-final.log`.
- `pnpm test:agent-docs:local` passed with **6 compiled/executed installed examples**,
  CLI/MCP parity, version/export refresh and zero Node network attempts.
  Log: `/tmp/cossack-recipe-guidance-tarball.log`.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-recipe-guidance-types.log` and
  `/tmp/cossack-recipe-guidance-package-types.log`.
- Script syntax and whitespace checks passed.

CLI-08 remains open for broader API/component guidance, verified runtime support
and its original RT-23/REL-02 gates. These examples verify planning behavior in
Node, not application execution on every adapter or remote readiness. Task status
remains 24 complete and 34 open. Versions remain 0.8.3. No publication, deployment,
push or external credential rotation occurred.

<a id="codex-prop-catalog-2026-10-04"></a>
## Codex: Installed component prop contracts (2026-10-04)

Declaration catalogs now retain member comments, JSDoc tags, optional callback
signatures and index signatures. Exported classes with public props expose an
instantiated propsContract, including inherited generic contracts. Private and
protected props stay excluded. Union shapes report partial common-member views,
and unstructured types such as any remain unknown. Declared object shapes do
not imply strict attribute typing, browser behavior or accessibility.

The actual UI catalog exposes Button's declared prop descriptions and unrestricted
string/any index signature. Existing unresolved platform diagnostics stay partial.
The installed tarball acceptance now compares the UI catalog through CLI and MCP.
The first fixture attempt correctly reported UI unavailable because the minimal
app had no direct UI dependency. The acceptance fixture now declares the local UI
tarball as a development dependency without adding UI feature source or imports.
CI includes UI changes in its generated-app acceptance trigger.

Verification:

- **36 tests across 3 CLI files passed**, including inherited generic props,
  private/unknown/union shapes, JSDoc, optional callbacks and index signatures.
  Log: `/tmp/cossack-props-catalog-tests.log`.
- `pnpm test:agent-docs:local` passed with installed UI CLI/MCP parity,
  six compiled/executed examples, fresh manifests/guides and zero Node network attempts.
  Log: `/tmp/cossack-props-catalog-tarball-final.log`.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-props-catalog-types-final.log` and
  `/tmp/cossack-props-catalog-package-types-final.log`.
- JavaScript syntax, workflow YAML parsing and whitespace checks passed.

RT-23 remains open: Table is a styled wrapper, and the inspected UI sources have
no DataTable implementation despite its blocks README mention. Controlled server
data, typed column accessors, selection/pagination, native attribute contracts and
keyboard/focus/accessibility acceptance still require implementation. CLI-08 also
retains broader usage/runtime guidance and its RT-23/REL-02 gates. No checklist
status changed: 24 complete and 34 open. Versions remain 0.8.3. No publication,
deployment, push or credential rotation occurred.

<a id="codex-data-table-2026-10-04"></a>
## Codex: Controlled DataTable foundation (2026-10-04)

Added the generic public DataTable with typed row keys/accessors, column IDs,
controlled page/filter/sort state, explicit totals and stable string row IDs.
Parents own data fetching and stale-response handling. The table renders only
supplied rows. Selection updates copy the controlled set, preserve off-page IDs,
ignore unavailable/unselectable rows and block changes during loading/errors.
Column/row identity and query invariants fail explicitly.

The component provides caption, labeled native controls, sort state, mixed page
selection, status/error/empty views and retry behavior. Chromium exposed focus
loss when paging buttons became disabled during loading. Focusable aria-disabled
controls now guard inactive actions and retain focus through loading/boundaries.
Retry transfers focus to the stable filter before removing its own button.
The package-owned guide documents these contracts and application responsibilities.

Published type acceptance exposed missing .js suffixes in UI declaration imports.
UI builds now use the existing declaration rewrite. DataTableProps is a closed
object type, compatible with renderer composition without an arbitrary attribute
index signature. Consumer tests reject invalid keys, accessors and competing
key/accessor definitions. Table remains available as the simpler native wrapper.

Verification:

- **119 UI tests across 10 files passed**, including controlled state/selection,
  SSR semantics and escaping, invalid inputs and published consumer types.
  Log: `/tmp/cossack-data-table-final-ui.log`.
- **Chromium HTTP-data acceptance passed** using a production bundle of public
  dist exports: server page/filter/sort/size requests, off-page selection, loading,
  empty/error/retry flows, native keyboard activation and retained focus.
  Log: `/tmp/cossack-data-table-final-browser.log`.
- `pnpm test:agent-docs:local` passed: installed DataTable prop and guide discovery,
  UI CLI/MCP parity, six existing executable examples and zero network attempts.
  Log: `/tmp/cossack-data-table-tarball.log`.
- UI build, root `pnpm tsc --noEmit` and all 11 package checks passed.
  Logs: `/tmp/cossack-data-table-final-build.log`,
  `/tmp/cossack-data-table-final-root-types.log` and
  `/tmp/cossack-data-table-final-package-types.log`.
- Whitespace checks passed, excluding the user's existing reports.md changes.

RT-23 remains open. The browser fixture uses a real HTTP endpoint and compiled
public components, but is not a generated Cossack app. Next verify that integration
with server resources/query state, compiler/hydration and runtime ownership, then
audit native attributes/events/accessibility across the remaining UI catalog.
CLI-08/REL-02 retain their broader acceptance gates. Status remains 24 complete
and 34 open. Versions remain 0.8.3. No publication, deployment, push or credential
rotation occurred.

<a id="codex-data-table-integration-2026-10-04"></a>
## Codex: Generated DataTable integration and navigation focus (2026-10-04)

Author: **Codex**. RT-23 remains open for the remaining UI catalog audit.

Generated Node and local workerd apps now compose DataTable with `server$`,
`defineUrlState` and client-only selection. Each fixture type-checks and builds
through public package entries, then runs in Chromium against its production
runtime and a local HTTP data backend. These fixtures use workspace package
links, not an installed-tarball distribution or live Cloudflare deployment.

Acceptance covers copied-page SSR, matching hydration without extra backend
reads/RPC, keyboard selection, paging, browser history, filtering, sorting,
page-size changes, empty results and resource refresh failure/retry. Off-page
selected IDs survive those operations. The test waits for committed URL/results
before refresh so an already-visible row cannot conceal an unfinished navigation.
A failed route transition is distinct from an existing resource refresh failure.

The focus checks exposed lost focus when query navigation replaces the page.
Same-owner publication now restores a unique-ID control with matching tag, type
and name, preserving text selection only for an unchanged value. Retained nodes,
intentional focus moves, duplicate IDs and ownership changes prevent transfer.
Rollback rendering uses the same guarded restoration. DataTable exposes an
optional unique `id` for filter, page-size, sort and paging control IDs.
Generated browser acceptance checks paging/filter/retry focus. Focus regression
tests cover ambiguous IDs, mismatched controls, changed values and retained or
intentionally moved focus. SSR regression assertions also prevent duplicate
`value` and `checked` attributes in DataTable controls.

Verification:

- Generated DataTable and typed URL-state acceptance: 4 cases passed across Node
  and workerd. Log: `/tmp/cossack-generated-data-table.log`.
- Final framework build: generated DataTable and navigation-ownership acceptance
  passed 4 cases across Node/workerd. Log: `/tmp/cossack-table-integration-final.log`.
  Both DataTable cases also passed after adding an explicit client-ready wait
  before hydration read assertions. Log: `/tmp/cossack-table-hydration-final.log`.
- Focus helper and navigation outcome tests: 56 passed across 2 files.
  Log: `/tmp/cossack-navigation-focus.log`.
- UI suite: 119 tests passed across 10 files.
  Log: `/tmp/cossack-table-integration-ui.log`.
- Standalone Chromium HTTP-data acceptance passed after the SSR attribute fix.
  Log: `/tmp/cossack-table-integration-browser.log`.
- UI/framework builds and root/package type checks are recorded in
  `/tmp/cossack-table-integration-build.log`,
  `/tmp/cossack-table-integration-framework-build.log`,
  `/tmp/cossack-table-integration-root-types.log` and
  `/tmp/cossack-table-integration-package-types.log`.

Next audit native attributes, event types, labels, keyboard behavior and focus
across the rest of the UI catalog. Keep CLI-08/REL-02 and the full runtime/release
matrix open. Status remains 24 complete and 34 open. Versions remain 0.8.3.

<a id="codex-native-controls-2026-10-04"></a>
## Codex: Typed native controls and mapped prop discovery (2026-10-04)

Author: **Codex**. RT-23 and CLI-08 remain open. The
[UI inventory](./ui-contract-audit.md) tracks 65 component source files, including
multi-export files, plus a final blocks/icons pass. Seven component foundations
are reviewed, including the earlier DataTable work; this is not full UI acceptance.

Button, Input, Label, Checkbox, Switch and Form now share explicit native attribute
and DOM event contracts. ARIA names come from string-valued DOM reflection fields;
element-reference reflection properties are not advertised as HTML attributes.
Only data-* retains a patterned scalar-value index signature. Checkbox/Switch
exclude text-only input attributes. Bind/live/ifDefined/preventDefault result types
have declaration-only private brands so plain objects cannot impersonate runtime
directives. This changes type checking without adding runtime fields. Event
currentTarget is the actual native control. Renderer component() preserves declared prop types
instead of adding a string index signature that accepted misspelled props.

Checkbox now consumes its label prop, renders a single checked binding and keeps
children as the fallback label. Switch renders its children and updates the native
checked property when parent state changes after user interaction. Chromium
checks native labels, keyboard toggles, controlled reset, disabled state, constraint
validation, event targets and FormData. Public type tests exercise valid renderer
directives and reject misspelled props/listeners, incompatible event types, string
boolean values and competing checked/type overrides.

The stricter types exposed sample/studio issues. Forms now use boolean loading
flags and matching field IDs. Loading button text uses component()'s third argument.
Studio checkbox/switch change handlers use inferred native events and currentTarget.
The new installed native-controls guide explains prop ownership, event syntax,
labeling, property binding, FormData and Form submission/validation behavior.

Installed-tarball verification exposed an agent catalog bug: synthetic remapped
members have no declaration node and were reported as any. The declaration indexer
now supplies the owning declaration when resolving their types, preserving concrete
generic event targets and boolean attributes. Synthetic source locations remain
null instead of attributing them to an invented source property. Regression tests
cover exported mapped aliases and inherited class props.

Verification:

- 121 UI tests across 10 files passed, including public consumer types and SSR
  label/checked ownership. Log: `/tmp/cossack-native-ui-tests.log`.
- 284 renderer tests across 22 files passed. Log: `/tmp/cossack-native-renderer-tests.log`.
- Chromium native-control acceptance passed. Log: `/tmp/cossack-native-browser.log`.
- 17 declaration-index tests passed. Log: `/tmp/cossack-native-catalog-tests.log`.
- Installed tarball CLI/MCP acceptance passed with typed native props, the new guide,
  six existing executable examples, version/export refresh and Node networking
  disabled during discovery. Log: `/tmp/cossack-native-agent-docs.log`.
- Root and all 11 package type checks passed after fixing sample/Studio consumers.
  Logs: `/tmp/cossack-native-root-types.log`, `/tmp/cossack-native-package-types.log`.

Next fix Checkbox/Switch disabled appearance in a themed browser fixture. Current
browser checks verify native semantics without CSS. Then continue with textarea/select
wrappers, RadioGroup, Slider, composite controls and the remaining catalog. Keep runtime/distribution and
release gates open. Status remains 24 complete and 34 open; versions remain 0.8.3.

<a id="codex-choice-controls-2026-10-04"></a>
## Codex: Themed choice controls and range state (2026-10-04)

Author: **Codex**. RT-23 remains open. Nine component foundations now have focused
contract coverage; the [UI inventory](./ui-contract-audit.md) retains the remaining
component, block/icon and full form/runtime work.

The native-control browser fixture now builds Tailwind with the actual UI base
and theme CSS. It reproduced enabled-looking disabled Checkbox labels: their
`:disabled` utility could never match a label. Checkbox/Switch/RadioGroup wrappers
now match their child input's actual disabled state. Slider styles its own native
`:disabled` state. This covers direct disabled flags, Checkbox/Switch presence
bindings, and inherited disabled fieldsets without duplicating browser state.

RadioGroup and Slider now have closed native prop contracts. RadioGroup separates
root div attributes/events from input form flags and the typed onValueChange
callback. It rejects empty names/duplicate values, keys items by value, and updates
native checked properties. Parent resets after user selection, callback targets
and DOM identity across reordered choices are exercised in Chromium.

The browser fixture also reproduced Slider initialization at 1000 when requesting
1500 with bounds 1000–2000. Assigning value before constraints caused premature
browser clamping. Slider now applies bounds first and uses a live value binding.
It recovers a previously clamped requested value when bounds widen. Browser-native
clamping/step rules remain authoritative. Non-finite values, inverted bounds and
nonpositive steps fail explicitly. The label alias no longer duplicates aria-label.

Verification:

- Themed Chromium acceptance passed: light/dark opacity and cursor styles,
  disabled fieldsets, Switch keyboard focus ring, native labels/validation/FormData,
  radio keyboard selection/reset/reordering/callback targets and range keyboard,
  initialization/clamping/bounds updates. Log: `/tmp/cossack-themed-controls.log`.
- 124 UI tests across 10 files passed, including public prop/event types and SSR
  ownership/validation regressions. Log: `/tmp/cossack-themed-ui-tests.log`.
- Root and all 11 package type checks passed. Logs:
  `/tmp/cossack-themed-root-types.log` and `/tmp/cossack-themed-package-types.log`.
- Installed tarball CLI/MCP acceptance passed with RadioGroup/Slider prop contracts,
  the radio-and-range guide, six existing executable examples, catalog refresh and
  Node networking disabled during discovery. Log: `/tmp/cossack-themed-agent-docs.log`.
- UI build and whitespace checks passed. Build log: `/tmp/cossack-themed-ui-build.log`.

Next audit Textarea, Select/NativeSelect, InputGroup and PasswordInput, including
initial values during SSR/hydration. Continue the remaining inventory afterward.
These checks do not close the full UI contrast/layout/cross-browser or release
matrix. Status remains 24 complete and 34 open. Versions remain 0.8.3.

<a id="codex-select-values-2026-10-04"></a>
## Codex: Dynamic select values (2026-10-04)

RT-23 continuation. Plain and live `.value` bindings could run before dynamic
options existed, leaving a select on the wrong option. Replacing option children
could also discard a live selection. Plain spread properties additionally reset
manual selection on unrelated renders. Seven new regression cases failed before
this correction.

Direct and spread select values now retry after child commits. Pending writes
belong to the current binding and are canceled when replaced, cleared or removed.
Repeated synchronous renders retain the latest pending value. Plain bindings
preserve manual selection when the bound value stays unchanged. `live()` reapplies
the controlled value after option changes. Existing `bind()` writeback remains
covered, including transitions to and from plain/live bindings.

Verification:

- Renderer: 299 tests in 22 files passed, including 15 new select cases.
- UI: 124 tests in 10 files passed.
- Production Chromium native-control fixture passed with direct/spread dynamic
  options, manual selection, live resets, reordered options and canceled writes.
- Renderer production build, root `pnpm tsc --noEmit` and all 11 package checks
  through `pnpm typecheck` passed. The final focused select run also passed.
- Logs: `/tmp/cossack-select-{renderer,ui,browser,build,root-types,package-types,final-focused}.log`.

Next: textarea/select SSR value serialization and the Textarea, Select/NativeSelect,
InputGroup and PasswordInput contracts. This checkpoint does not close RT-23,
CLI-08 or the full runtime/release matrix. Status remains 24 complete and 34 open.
The handoff also consolidates completed history into links, as requested by the user.

<a id="codex-form-ssr-2026-10-04"></a>
## Codex: SSR form controls and focused agent contracts (2026-10-04)

RT-23 and CLI-08 continuation. Textarea, Select and NativeSelect now declare native
attributes and exact event targets. Unsupported `value` attributes are rejected;
use `.value` for text or selection. Studio's select handler now uses the native
change event and `currentTarget`. The component audit records twelve reviewed
foundations. InputGroup and PasswordInput remain next.

SSR uses parse5 source locations to convert property values into escaped textarea
text and selected options without reserializing surrounding markup or hydration
markers. It preserves leading newlines, nested options, decoded text values and
first-match selection. Property values override static defaults. Null/undefined
values serialize as empty text. Plain input/textarea spreads now preserve user
edits when the bound value stays unchanged. Minification preserves whitespace-only
textarea values and text resembling attributes.

The renderer's browser entry keeps SSR parsing out of normal UI bundles. Root
`renderToString` in browsers directs callers to the explicit `/server` entry.
Node, Deno, worker and workerd conditions retain the root serializer. The migration
guide records this browser API change. The browser fixture resolves public package
exports and checks the built module graph, not a hard-coded renderer alias.

Expanded UI declarations exceeded MCP's unchanged 4 MiB response limit. CLI
`--symbol <name>` and MCP `symbol` now select one exact public export before member
expansion. Filtered entries list available names and report whether the name matched.
Unknown names return a diagnostic instead of a fabricated contract. CLI/MCP use
the same service. Full package indexing remains available when it fits the bound.

Limits: unmatched single-select values cannot encode `selectedIndex=-1` in static
HTML with options present. Use a matching option for SSR parity. Multiple selections
use selected option children; a scalar `.value` selects one option. Interpolated
textarea child text remains unsupported; use `.value`. Broader UI, agent guidance
and release gates remain open. Status remains 24 complete and 34 open.

Verification for this checkpoint:

- Renderer: 326 tests in 23 files. UI: 124 tests in 10 files, including published
  declaration checks. Core: 1,442 tests in 85 files.
- CLI declaration/documentation/MCP suites: 38 tests. Final command-contract,
  command-spec and Chromium suites: 114 tests in four files.
- Chromium verifies minified SSR values without JavaScript, the same hydrated
  controls/options, labels, native event targets, keyboard selection, required
  validation, disabled FormData exclusion and subsequent updates. Public package
  resolution selects the browser entry; its built graph excludes parse5 and the
  SSR form serializer. Existing themed choice/range acceptance also passes.
- Generated Node and workerd DataTable acceptance: two cases passed. This verifies
  server rendering and browser navigation under the new renderer export conditions.
- Renderer production build, root `pnpm tsc --noEmit`, and all 11 package checks
  through `pnpm typecheck` passed.
- Real installed-tarball acceptance passed: six existing executable guide examples,
  new UI prop contracts, exact-symbol CLI/MCP parity, metadata refresh and discovery
  with Node networking disabled. An initial oversized UI response exposed the need
  for filtering; the 4 MiB limit was preserved.
- Logs: `/tmp/cossack-form-{ssr-renderer,ui-tests,core,docs-tests,final-cli,generated,agent-docs,ssr-build,root-types,package-types}.log`.

These focused results do not close the complete UI catalog, cross-browser/form
recipe acceptance, CLI-07/CLI-08 guidance/runtime requirements or REL-03.

<a id="codex-input-addons-2026-10-04"></a>
## Codex: InputGroup and PasswordInput contracts (2026-10-04)

RT-23 continuation. InputGroup now declares native input props/events and consumes
prefix/suffix content. Its error border and ring follow the input's `aria-invalid`
state. The native input remains the destination for names, labels, descriptions,
values, classes and listeners.

PasswordInput now declares its native attributes and component-owned value/type/
disabled state. It consumes onChange and label settings instead of serializing them.
Autocomplete overrides render once, and empty placeholders remain empty. The
onChange callback and a supplied native @input listener receive the same event in
that order. preventDefault directives retain their validation settings.

Reveal buttons support localized names and reference the input ID. Disabling the
field also disables its button; inherited fieldsets and the native disabled state
block reveal. Pointer reveal restores field focus/selection after the component
update, without stealing deliberate focus changes. Keyboard reveal retains button
focus for repeated activation. Parent value changes do not receive stale selection
restoration.

The audit exposed missing ARIA reference attributes in shared native types. DOM
Element/Elements reflection properties now map to string ID attributes, including
aria-controls, aria-describedby, aria-labelledby and aria-activedescendant.
Reflection property names, element objects and invalid reference values remain
rejected. This also restores the existing Studio InputGroup combobox contract.

The UI inventory now records fourteen reviewed foundations. Next: InputOTP, then
Combobox, MultiSelect and DatePicker. The broader UI, form-recipe, cross-browser and
release acceptance requirements remain open. Release status stays 24 complete and
34 open. Native guidance, migration notes and the compact handoff are updated.

Verification for this checkpoint:

- UI build and all 126 tests in 11 files passed, including public declaration
  assertions, callback-free SSR attributes and native attribute forwarding.
- Both production Chromium fixtures passed. They cover minified SSR without JS,
  retained hydration, reveal after native edits, pointer selection restoration,
  keyboard focus and focus rings, parent reset, callback composition, native
  FormData, direct/fieldset disabling, localized labels and themed error styles.
- Root `pnpm tsc --noEmit` and all 11 package checks through `pnpm typecheck` passed.
- Installed-tarball CLI/MCP acceptance passed for the new native/ARIA contracts,
  filtered PasswordInput declarations, six existing executable guide examples,
  metadata refresh and discovery with Node networking disabled.
- Logs: `/tmp/cossack-addons-{build,ui,browser,root-types,package-types,agent-docs}.log`.

<a id="codex-input-otp-2026-10-04"></a>
## Codex: Native InputOTP contract (2026-10-04)

InputOTP previously ignored native attributes and parent value changes. Its
completion condition could never pass. Separate digit inputs also lost empty
positions and pasted only at the beginning.

The component now uses one native text field and decorative, aria-hidden slots.
Closed props expose labels, ARIA references, native events and form attributes.
The component owns numeric input mode, digit validation and length (1–32).
Controlled values require parent acceptance. Uncontrolled defaults remain stable.
Changed complete codes invoke onComplete after onChange. Initial values and parent
updates do not trigger callbacks. Completion does not prove server verification.

Selection-aware paste preserves leading zeroes, strips separators and respects
application cancellation. Composition text survives rerenders until composition
ends. Native form reset restores the initial uncontrolled code or current
controlled value. Canceled reset preserves the edit. Reset listeners attach with
the input ref and are removed during component cleanup.

Verification: UI build, 134 UI tests across 12 files, root `pnpm tsc --noEmit` and
all 11 package type checks pass. The production Chromium fixture checks no-JS SSR,
retained hydration, one accessible textbox, typing/deletion, paste, completion,
FormData, validation, parent acceptance/rejection, composition, readonly/fieldset
disabling and canceled/native reset. The real Tailwind theme verifies slot size,
focus ring and pointer caret placement. Public types reject competing native value
controls, invalid callbacks and misspelled attributes.

Installed guidance describes attribute ownership and state behavior. The tarball
verifier checks the InputOTP declaration and exact-symbol CLI/MCP parity.
Installed-tarball acceptance passed with Node networking disabled during discovery.
All six existing packaged examples compiled and executed. Logs for this checkpoint
are `/tmp/cossack-otp-{build,ui,browser,root-types,package-types,agent-docs}.log`.

Fifteen UI foundations are reviewed. RT-23 and CLI-07/CLI-08 remain open.
Next: Combobox, MultiSelect and DatePicker. Combobox currently drops native props,
lacks combobox ARIA semantics and can retain a stale selected label after parent
updates. The broader application/accessibility and release runtime matrix remain.
No release checkbox or package version changed.

<a id="codex-combobox-2026-10-04"></a>
## Codex: Combobox selection and form contract (2026-10-04)

Combobox previously discarded native props, used random popup IDs, lacked
combobox/listbox semantics and retained old selected labels after parent updates.
Its text input did not provide a usable form-value contract.

Combobox now requires a stable page-unique id and exposes closed input attributes
and event types. It owns popup relationships and submits the selected option value
through a hidden input. Search text filters choices without committing arbitrary
values. Controlled selections require parent acceptance; uncontrolled selections
start from defaultValue. Current options determine the displayed label. Missing
or disabled options cannot be committed or submitted as valid selections.

Arrow keys skip disabled choices. Enter commits the active option. Escape, Tab,
blur and native popup dismissal discard search and restore the committed label.
The input keeps focus while aria-activedescendant identifies the active option.
Popup placement follows input size, viewport space, scroll and resize. Disabled
fieldsets close an open popup. Required validation checks selection, and form
reset respects controlled values, initial defaults and canceled reset events.
Native event cancellation takes precedence over internal keyboard handling.

The demo now supplies a stable ID and accessible name. Migration notes and
package-owned guidance explain attribute, focus and selection ownership. The
keyboard design follows the [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
Full assistive-technology acceptance remains part of the broader UI audit.

Verification: UI build, 141 UI tests across 13 files, root `pnpm tsc --noEmit`
and all 11 package type checks pass. Production Chromium checks no-JS SSR,
retained hydration, fresh rendering, pointer/keyboard focus, theme sizing/rings,
controlled acceptance/rejection, parent resets, option removal, disabled options,
required validation, FormData, native/canceled reset, fieldsets and event vetoes.
The fresh-render check also verifies fieldset changes after client insertion.

The installed-tarball verifier checks Combobox props and exact-symbol CLI/MCP
parity. Installed acceptance passed with Node networking disabled during discovery.
All six existing packaged examples compiled and executed.
Logs: `/tmp/cossack-combobox-{build,ui,browser,root-types,package-types,agent-docs}.log`.

Sixteen UI foundations are reviewed. Next: MultiSelect, then DatePicker.
RT-23 and CLI-07/CLI-08 remain open. No release checkbox or package version changed.
