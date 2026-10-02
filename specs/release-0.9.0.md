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
- [ ] [CLI-04](./release-0.9.0-plan.md#cli-04) Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons. Codex Group 3 review (2026-10-02): AST inspection handles static options, aliases, quoted keys, exported page selection, and decorated method reasons; dynamic/spread/invalid options report unknown. Codex continuation: own-method facts now come from the shared compiler classifier, including automatic RPC, transitive preservation, retained fields, and stripped methods without RPC. Static route checks now fail for unavailable metadata and invalid transports. Resource macros now expose authored loader locations and matching generated method names. Recorded scaffold recipes and local/relative imported base declarations are integrated. Remaining: module validity, inherited layout options, and service token identity across imports. SSG service ownership/DI and check/explain acceptance now execute against the same source fixture. Declared member precedence, inherited RPC behavior, and a combined static/compiler fixture are verified. Binding-aware transport checks now use the shared runtime model.
- [ ] [CLI-05](./release-0.9.0-plan.md#cli-05) Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.
- [x] [CLI-06](./release-0.9.0-plan.md#cli-06) Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions. Codex completion (2026-10-02): recorded dependency ownership supports additions/removals/section moves while preserving user edits; exact target scaffold releases supply templates and dependencies; plans include file deletions and manifest effects, reject stale/unsafe inputs, and report partial installation failures. Generated-app subprocess fixtures and a real pnpm/local-registry tarball test verify the contract.
- [ ] [CLI-07](./release-0.9.0-plan.md#cli-07) Local MCP tools sharing inspection, documentation, checks, test results, and trace services with the CLI.
- [ ] [CLI-08](./release-0.9.0-plan.md#cli-08) Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples.

## Runtime and application APIs

- [ ] [RT-01](./release-0.9.0-plan.md#rt-01) Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics. GLM implemented correlated calls, deadlines, cancellation, service streams, and raw upload argument validation. Codex Group 3 review fixes nested generic parsing, invalid async/generator modifiers, duplicate RpcCall imports, overlapping field replacements, and validation error propagation. Remaining: actual authored-client/IDE type inference and semantic type tests (a Vite text rewrite alone does not provide these), generator/function-field coverage, and Response cookie/flash coordination with RT-11.
- [ ] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies. Codex Group 3 review: @Server({ input }) validates component/forwarded/explicit service actions; client errors retain fieldErrors across JSON and stream frames; input closures are stripped from client decorators. Remaining: inferred schema types, defined unknown-key/array/file behavior, and resource-policy enforcement with RT-14.
- [ ] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation. Codex Group 3 review: status snapshots and refresh preserve dependencies, retain stale data, discard older results, and share serialization/failure handling. Remaining: compile-time resource names and result types, plus expanded SSR/hydration/unmount acceptance coverage.
- [ ] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics. Codex Group 3 review: development warnings now keep stable object identity and observe deeper nested writes. Remaining: the full state/client-state/store/computed documentation and serialization diagnostic matrix, including cycles and client-only misuse.
- [ ] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work. Codex Group 3 review: AbortSignal cancellation, ordered cleanup across rapid changes, skipped canceled starts, and late cleanup disposal are covered. Cancellation is cooperative: tasks must check the signal before writes. Remaining: typed dependency paths, framework-gated result application, and navigation/service-disposal acceptance tests.
- [ ] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [ ] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection. GLM (2026-10-02): CLI effective route model — runtime-matching IDs, dynamic/catch-all params (also fixed the CLI's catch-all derivation to `:name{.+}`), layout ancestry, nearest 404/error boundaries, source-level @Page options with decorator line numbers, exposed via `cossack routes --json`; remaining: generated typed URL builders/params from the vite-plugin model and API schema declarations.
- [ ] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting, and pagination, with history/defaults.
- [ ] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics. Codex Group 3 review: public this.navigate()/createClientApp().navigate return outcomes; guards, redirects, full destination URLs, missing modules, and overlapping fetch/bootstrap commits have behavioral tests. Remaining: cancellation/bounded completion for stalled work, cache/layout diagnostics, and the browser matrix for history, fragments, retained layouts, and transition fallback.
- [ ] [RT-10](./release-0.9.0-plan.md#rt-10) Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] [RT-11](./release-0.9.0-plan.md#rt-11) Session/flash recipes covering RPC failure, redirects, old input, and rotation.
- [ ] [RT-12](./release-0.9.0-plan.md#rt-12) DI resolution errors and scope/lifetime inspection with clear global/scoped guidance. GLM implemented contextual resolution failures, scoped disposal, and layout declaration inspection. Codex reviews retain this task open: the AST scanner does not prove runtime/compiler ownership for inheritance and dynamic declarations. Finish compiler-backed ownership inspection and browser navigation lifetime verification.
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
- [ ] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop. GLM (2026-10-02): explicit `runtime-capabilities` model (transports, realtime coordination, process-local realtime, scheduled handlers, storage, filesystem) with per-runtime profiles, binding-gated availability (`COSSACK_SSE`), and available/missing-binding/unsupported status distinction; Codex continuation: CLI route inspection/checks now consume the published model and selected-environment binding names. Remaining: scaffold recipe gating and build-time capability enforcement.
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
