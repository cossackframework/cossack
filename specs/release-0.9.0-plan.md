# Cossack 0.9.0 implementation plan

This document explains all 58 tasks in the release checklist. It gives GLM the
reason for each task, the intended result, a starting implementation approach,
and the evidence needed to finish it. The implementation baseline is commit
`e5dbae4`, dated 2026-10-02. Later commits must update the completion evidence.

Read this document with [the handoff](./handoff-0.9.0.md),
[the release checklist](./release-0.9.0.md), and [the architecture](./architecture.md).
The checklist records scope and completion. This plan explains the work. Bundled
framework and scaffold route trees now have a static default-export contract test;
keep non-route helper modules outside `src/pages`.
The handoff records the exact stopping point and commands that passed.

Latest checkpoint: Codex RT-08 query contracts (2026-10-03).
Read the [evidence](./release-0.9.0.md#codex-url-state-contracts-2026-10-03),
[implementation and remaining work](#rt-08), and [URL-state guide](../docs/url-state.md).
Portable typed codecs, default/invalid-value behavior, source-owned browser
queries and explicit history replacement are implemented. Actual Node/native
workerd browser fixtures pass copied URLs, history and resource hydration parity.
RT-08 remains open for draft preservation, pending patch ownership and the full
resource/rapid-edit matrix. All 58 task IDs remain: 22 checked, 36 unchecked.
Continue that work and every remaining task. No release gate is newly closed.

Previous checkpoint: Codex RT-07 completion (2026-10-03).
Read the [completion evidence](./release-0.9.0.md#codex-route-boundaries-2026-10-03)
and [original criterion audit](#rt-07). Source boundaries now retain distinct IDs,
apply their policies once, preserve parameters and hydrate the correct browser
component. Actual Node/native workerd and browser fixtures pass. The unused
PageOptions.route is removed with migration guidance and negative types.
RT-07 is complete. The ledger records 22/58 checked and 36 unchecked.
Continue [RT-08](#rt-08) and every remaining task. All release gates remain separate.

**Previous checkpoint — Codex RT-07 native API contracts (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-api-contracts-2026-10-03).
Portable declared native schemas, parsed guards, correlated failures and owned
cancellation are implemented. Shared AST inspection recognizes aliases and
strips private factories. Generated API types follow actual exports through
type-only references. Actual Node/native workerd requests and D1 mutation
acceptance pass. **21/58 checked, 37 unchecked. RT-07 remains open.**
Finish grouped/dynamic unknown-URL 404 acceptance and resolve `PageOptions.route`,
then audit all original criteria. Every other task and release gate remains.

**Previous checkpoint — Codex RT-07 route generation (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-typed-routes-2026-10-03).
Vite and the CLI now share route discovery, patterns, source ancestry and IDs.
The virtual route import resolves to a generated TypeScript file. Published
negative types and real production Node/browser handlers prove path construction.
Review also found and fixed custom 404 loss in the generated Node wrapper.
**21/58 checked, 37 unchecked. RT-06 stays complete. RT-07 stays open.**
Continue declared native API schemas, generated API types and the remaining
boundary/runtime acceptance described under RT-07. Keep every other original
task and release gate in scope.

**Previous checkpoint — Codex RT-06 completion (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-optimistic-completion-2026-10-03).
The original RT-06 criteria now pass the explicit audit under that task. Service
cancellation before iteration releases preview/loading; component/service response
waits honor client cancellation/deadlines independently of request producers.
The 32-case controlled stream suite, 25-case production Node/native browser matrix
and executable published example complete the remaining stream/read contracts.
**21/58 checked, 37 unchecked. All original IDs remain. RT-06 is complete.**
Continue RT-07 and every other unchecked task/release gate. Broader RT-01/RT-11,
Node Vite development and native Deno/Electron execution remain separate work.

**Previous checkpoint — Codex optimistic SSE ordering (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-optimistic-sse-ordering-2026-10-03).
Actual SSE publication confirms its own pending preview once. Cursor order prevents
older replies from replacing newer state. Native Worker/D1/browser acceptance proves
expired-history resync after actual response EOF and native EventSource reconnect,
with zero mutation replay. Native component SSE stream failure/cancellation and
production Node/SSE ordering/post-yield failure pass. Node cursors span SSR entry
replacement within one process. Child-local replies keep a separate state domain.
**20/58 checked, 38 unchecked. All original IDs remain and RT-06 stays open.**
Finish remaining HTTP/service optimistic streams, malformed payload/cancellation cases,
the complete published example and original criterion audit. Continue all other gates.

**Previous checkpoint — Codex retained service consumers (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-retained-service-loading-2026-10-03).
Service invocations now attach loading to matching late consumers in the retained
scope. Duplicate subscriptions/rejoin count once. Other declarations and shadowed
scopes remain independent. Production Node/browser and the shared Worker/D1
fixture navigate during pending service replies and actual input rejection.
**20/58 checked, 38 unchecked. All original IDs remain and RT-06 stays open.**
Finish actual SSE resync/different late snapshots and the remaining optimistic
stream matrix across transports/services. Continue every other task and gate.

**Previous checkpoint — Codex native optimistic socket recovery (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-optimistic-socket-2026-10-03).
RT-06 now has actual committed/lost socket replies, reconnect after DO eviction,
queued cancellation and post-yield stream error/cancellation acceptance. The default
DO uses the application's compiler registry. A client API-body leak found by native
asset inspection now has a shared-classifier guard and explicit export-shape tests.
**20/58 checked, 38 unchecked. All original IDs remain and RT-06 stays open.**
Finish SSE resync/different late snapshots, retained consumers and the optimistic
stream matrix across remaining transports/services. Continue every other task.

**Previous checkpoint — Codex authoritative optimistic reads (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-optimistic-reconciliation-2026-10-03).
RT-06 step 2 now uses explicit typed resource reconciliation after known uncertain
RPC failures. Repeated recovery shares one current-dependency read and never
repeats mutations. Node browser and actual Worker/D1 tests lose replies only after
writes commit. Component and service HTTP actions converge on HTTP and genuinely
connected SSE pages. RPC reconstruction no longer starts duplicate resource reads.
**20/58 checked, 38 unchecked. All original IDs remain and RT-06 stays open.**
Finish actual socket loss/reconnect, SSE resync/different late snapshots, retained
consumers and stream/cancellation acceptance. Continue every other task and gate.

**Previous checkpoint — Codex explicit optimistic operations (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-optimistic-operations-2026-10-03).
RT-06 now records explicit finite increments and detached append/remove operations.
A failed older contribution leaves newer pending or committed local operations.
Whole-field assignments remain absolute. Handlers run once; internal replay uses
only declared data operations. Published field/item types and browser/native
HTTP/SSE contribution cases accompany the existing transport/service matrix.
**20/58 checked, 38 unchecked**, all original task IDs retained. No task closes.
Continue RT-06's authoritative read, actual reconnect, late broadcast and stream
failure acceptance below. All other tasks and the Node CLI dev gap remain open.

**Previous checkpoint — Codex optimistic call ownership (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-optimistic-ownership-2026-10-03).
RT-06 now has per-call field layers, rollback, confirmed public request state,
scoped-service parity and flat Node/Deno connection snapshots. The task remains
open for complete uncertain-outcome reads, actual reconnect acceptance and the
contribution-rebasing audit. **20/58 checked, 38 unchecked**, all IDs retained.
Continue the detailed RT-06 plan below; the Node plain Vite dev gap stays open.

**Previous checkpoint — Codex state contracts and diagnostics (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-state-diagnostics-2026-10-03).
RT-04 now meets its original criteria: **20/58 checked, 38 unchecked**. Executable
examples, inherited contracts, client-only sanitization and development-only
diagnostics pass unit, published declaration, development/production browser and
native Worker HTTP/SSE checks. Continue RT-06 and all remaining tasks. Generated
Node plain Vite development routing returns 404; its first-party integration is
an open REL-03 gap, detailed below. All original IDs remain in scope.

**Previous checkpoint — Codex typed task ownership (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-task-ownership-2026-10-03).
RT-05 now meets its original criteria: **19/58 checked, 39 unchecked**. Typed
paths and patch values pass published declaration fixtures. Execution-owned
commits reject obsolete/disposed writes; inherited siblings, contextual failures,
cleanup ordering and production browser navigation/service lifetime pass.
Continue RT-04 and the remaining tasks; all original IDs remain in scope.

**Previous checkpoint — Codex resource lifecycle (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-resource-lifecycle-2026-10-03).
RT-03 now meets its original criteria: **18/58 checked, 40 unchecked**. Typed
named lifecycle calls, inferred nullable/optional values, dependency-aware
hydration, pre-render refresh, stale-result/error disposal and production Node/
native workerd HTTP/SSE acceptance pass. RT-05 remains open; this review fixes
settled task signals losing ownership, but typed paths, gated commits and the
navigation/service disposal matrix still need implementation. Preserve all IDs.

**Previous checkpoint — Codex schema migration (2026-10-03):**
[review and evidence](./release-0.9.0.md#codex-schema-migration-2026-10-03).
RT-02 now passes its original criterion audit below: **17/58 checked, 41
unchecked**; all task IDs remain. Schema-only actions, parsed signatures/public
function fields, private type-only imports and callback exception handling pass
unit, generated Node/browser and native Worker/D1/socket acceptance. Continue
RT-03/RT-05 and all later gates. The historical checkpoints below retain their
earlier counts and follow-ups; this checkpoint supersedes those RT-02 gaps.

The latest [Codex coordinator cancellation checkpoint](./release-0.9.0.md#codex-sse-cancellation-2026-10-03)
adds private operation IDs, removes cancelled queued callbacks, bridges active
counter cancellation across Workers and preserves FIFO order. Generated configs
include incoming request-signal flags; preflight checks selected environments and
built compatibility settings. Wrangler upgrade exclusions are preserved.
Production router tests use explicit middleware request signals. Actual pre-header
TCP disconnect notifications were not observed on the installed workerd, including
a minimal direct-socket probe, and remain a separate acceptance gap. No task closes;
14/58 remain checked. The preceding [Codex rate-store contract checkpoint](./release-0.9.0.md#codex-rate-store-contracts-2026-10-03)
fixes invalid configuration fallback, first-environment ownership and unchecked
runtime options/counter replies. Per-action peer environments select their own
backend. Redis now uses millisecond expiry; KV retains records for at least 60
seconds while preserving their logical millisecond deadline. Native fixtures
verify distinct bindings and sanitized configuration refusal before mutation.
Capabilities/inspection, cache duration conventions and backend I/O ownership
remain open; 14/58 tasks stay checked. The preceding [Codex durable rate-window checkpoint](./release-0.9.0.md#codex-rate-window-persistence-2026-10-03)
fixes the DO store's eviction reset. Transactional counter/deadline records and
expiry alarms preserve spent budgets. Native workerd verifies two-Worker bursts,
actual DO eviction, Worker reload and HTTP/socket denial before mutation.
Configuration failure/ownership, other provider validation, cache capability
inspection and duration conventions remain open; 14/58 tasks stay checked.
The preceding [Codex socket-peer checkpoint](./release-0.9.0.md#codex-socket-peer-context-2026-10-03)
fixes anonymous Cloudflare identity and per-connection request context across
Cloudflare/Node/Deno. A new native two-Worker fixture proves shared configured
DO counters, custom headers/params, reconnect budgets and retained attachments
through forced component reconstruction. Counter persistence/failure/consistency
and session policies remain open; 14/58 tasks stay checked. The preceding
[Codex ordinary-envelope checkpoint](./release-0.9.0.md#codex-rpc-json-envelopes-2026-10-03)
records shared bounded UTF-8 decoding before hydration, required service state,
exclusive redirect metadata and correlated typed HTTP diagnostics. The matrix
now has 294 cases; 14/58 tasks remain checked. RT-01 stays open for actual
Cloudflare socket/peer/header context, configured counter-store guarantees and
the policy/session criteria below. The preceding
[Codex target/limit checkpoint](./release-0.9.0.md#codex-rpc-target-limits-2026-10-03)
records page/child snapshot separation on process-local SSE, correlated target
denials, inherited/forwarded WebSocket limits and shared route budgets across
HTTP/socket dispatch. Real production workerd proves limited D1 writes and
layout-service budget ownership across pages. The matrix has 259 cases; 14/58
tasks remain checked. See RT-01's next audit below before declaring it complete.
The preceding [Codex protocol-boundary checkpoint](./release-0.9.0.md#codex-rpc-protocol-boundaries-2026-10-03)
records known-ID preservation, response-header correlation and EOF validation
before final state hydration, plus a 242-case shared transport matrix. RT-01
remains open for child-target and rate-limit coverage and policy criteria.
The preceding [Codex built Workers checkpoint](./release-0.9.0.md#codex-workers-rpc-acceptance-2026-10-03)
records real production workerd/Chromium acceptance for multipart generators,
native response bodies, auth/D1 request ownership, cookies and one-time flash,
and fixes native NDJSON being parsed as protocol by the coordinator.
The preceding [Codex multipart checkpoint](./release-0.9.0.md#codex-rpc-multipart-2026-10-03)
records a shared JSON/multipart dispatcher, nested file/service arguments,
progressive generator consumption through Fetch and optional XHR, pre-mutation
input validation and shared request/response cleanup. The preceding [Codex native-response checkpoint](./release-0.9.0.md#codex-rpc-native-response-2026-10-03)
records bounded native HTTP body completion through public clients and generated
HTTP/SSE/upload browser acceptance. The preceding [JSON wire checkpoint](./release-0.9.0.md#codex-rpc-json-values-2026-10-03)
records a shared normalizer, JSON result/yield types, custom hook semantics,
ordinary upload diagnostics, and generated HTTP/SSE browser acceptance. RT-01
remains open for systematic protocol diagnostics and remaining transport/policy
boundaries. These runtime fixtures do not close every RT-01 or RT-11 criterion. The preceding
[shared conformance checkpoint](./release-0.9.0.md#codex-rpc-conformance-matrix-2026-10-03)
records one matrix for HTTP/SSE components, WebSocket dispatch, and explicit
service actions, with fixes to private errors, value paths, and known request IDs.
The preceding
[response timing checkpoint](./release-0.9.0.md#codex-rpc-response-timing-2026-10-03)
records native cookies/redirects, streaming header guards, flash preservation,
and network uncertainty. RT-01 and RT-11 remain open. The preceding
[authored RPC checkpoint](./release-0.9.0.md#codex-authored-rpc-types-2026-10-03)
records typed client inference and consistent ordinary completion. The earlier
[recipe/capability checkpoint](./release-0.9.0.md#codex-four-recipe-capabilities-2026-10-03)
records CLI-05 and RT-25 completion: 14/58 tasks are checked. The earlier
[upgrade checkpoint](./release-0.9.0.md#codex-cli-upgrades-2026-10-02)
records CLI-06 completion. The preceding machine
contract checkpoint records CLI-03 completion. The earlier continuation
records the development WebSocket fix and upgrade planning. The Group 3 review records corrections
to GLM's implementations. This plan preserves the original task intent; use
those logs and task checkboxes for current completion status.

This is an expansion of the original review intent preserved in those files.
It is not a verbatim transcript of every earlier discussion. Some API shapes
were not settled. Sections called Approach describe proposed implementation
choices. They do not claim that an unimplemented command or API already exists.
Keep the stated behavior goals when improving those choices.

Full paths in this document are relative to the repository root. When a section
names a package followed by a source path, resolve it under `packages/<name>/src/`.
For example, core `shared/rpc-stream.ts` means
`packages/core/src/shared/rpc-stream.ts`. Proposed modules and APIs are described
as new work rather than listed as existing exports.

## Release intent

Cossack lets application authors write server and browser behavior in one
TypeScript component. The compiler removes server code from the browser bundle.
The framework supplies routing, rendering, remote calls, and request context.
Version 0.9.0 must make these behaviors predictable for humans and coding agents.

An agent must be able to answer these questions from project evidence:

1. Which APIs, routes, services, and runtime capabilities exist in this version?
2. Why does a method execute on the server or browser?
3. Which files and resources will a command change?
4. Which runtime, environment, account, and database will receive those changes?
5. What failed, where did it fail, and which operation can fix it?
6. Which tests prove that the result works through the actual framework?

The target is more than additional decorators. A new feature needs types,
runtime behavior, diagnostics, documentation, scaffold support where applicable,
and tests through its published interface. Existing implementations must be
extended when they already solve part of a task.

## Decisions that apply across tasks

Dependency injection, or DI, supplies services to components. A scope owns those
services and controls their lifetime. A remote procedure call, or RPC, invokes
a server method from a client. Server-sent events, or SSE, carry updates to a
browser. Hydration connects browser behavior to server-rendered HTML. Static
site generation, or SSG, writes public HTML during a build.

- Keep core behavior portable. Put Cloudflare-specific implementations behind
  explicit runtime boundaries. Native `cloudflare:workers` imports cannot enter
  the Node, Deno, or browser runtime graph.
- Keep `auth`, `database`, `core`, and `renderer` independent of the framework.
  Share small structural contracts when middleware must cooperate across packages.
- Reuse compiler metadata for inspection, generated types, catalogs, and tools.
  Do not create separate scanners that disagree with compiled behavior.
- Keep one service for each operation. CLI, Studio, MCP, and developer tools
  must call that service when they expose the same operation.
- Separate planning from mutation. A plan describes intended changes and unknowns.
  It must not create resources, execute seeders, or silently apply migrations.
- Preserve request ownership. An action keeps its auth, locale, DI, ORM, and
  configuration context until its response and cleanup finish.
- Do not replay a mutation after a timeout or disconnect by default. A lost
  response does not prove that the mutation failed before making changes.
- Keep public state, client-only state, secrets, and service ownership distinct.
  Browser hydration and JSON diagnostics must never contain secret values.
- Prefer explicit unsupported-capability errors to silently weaker behavior.
  Process-local state is not durable or distributed state.
- Keep the framework ORM-agnostic. The database package and its recipes are optional.
- Prefer clear API breaks during alpha over several competing APIs for the same job.
  Record every break in the migration guide.

The existing CLI result envelope is
`{ schemaVersion: 1, command, ok, data, diagnostics }`.
Extend its contract deliberately. Preserve one JSON result on stdout and stable
diagnostic codes. Source locations and suggested actions belong in structured
fields, not only in prose that an agent must parse.

## Suggested execution order

These groups describe dependencies. They do not reduce the release scope.
Add focused tests during each group, and run broader gates after integration.

| Group | Main tasks | Result needed before moving on |
| --- | --- | --- |
| 1. Finish current runtime work | CF-05, RT-01, RT-12, RT-19, CF-06 | Distributed SSE works through generated apps and retains request ownership. |
| 2. Establish shared metadata and diagnostics | CLI-02 through CLI-04, RT-07, RT-24, RT-25, RT-29 | Tools and types describe the behavior that the compiler and runtime execute. |
| 3. Complete application state and actions | RT-02 through RT-06, RT-08 through RT-11, RT-14 | Forms, data loading, mutations, cancellation, and authorization compose. |
| 4. Complete data and content features | RT-13, RT-15 through RT-18, RT-20 through RT-23, RT-26, RT-27 | Existing features have clear provider contracts and complete failure behavior. |
| 5. Add background application services | SVC-01 through SVC-05 | Jobs, schedules, notifications, workflows, and Turnstile have tested adapters. |
| 6. Expose the complete agent workflow | CLI-05 through CLI-08, RT-28 | Recipes, upgrades, offline help, and MCP use the shared services. |
| 7. Finish operations | CF-01 through CF-04, CF-08 through CF-10 | Environment targeting, resources, logs, previews, and CI form one tested workflow. |
| 8. Audit and prepare release | REL-01 through REL-05 | Every requirement has evidence and the release artifacts match the source. |

Some work in groups 1 and 7 already passed tests. Preserve that behavior while
closing the missing parts. CF-07 and CF-11 are completed baseline invariants.
Keep their regression coverage throughout the refactor.

## CLI and agent tooling

<a id="cli-01"></a>
### CLI-01: Lifecycle flags, help, and creation dry runs

Purpose: Agents commonly call lifecycle commands with explicit ports, hosts,
environments, or help flags. The CLI must pass those values correctly and must
not create an application when the caller only requests a plan.

Baseline: Completed at the checkpoint. Dispatch and flag tests cover help and
forwarding. `create --dry-run --json` reports the proposed creation without writes.

Approach: Keep lifecycle forwarding in the dispatcher. Keep scaffold planning
separate from file creation. A dry run cannot install packages, prompt, generate
secret files, or check for updates as a side effect. Preserve explicit `false`
values and values that contain spaces.

Start in `packages/cossack/src/dispatch.js`, `flags.js`,
`commands/create.js`, and `packages/scaffold/src/index.js`.

Done when: Existing regression tests remain green after CLI changes. Tests must
inspect the temporary directory before and after a dry run. A successful exit
alone does not prove that the operation was read-only. Related tasks: CLI-02 and CLI-03.

<a id="cli-02"></a>
### CLI-02: Consistent command validation

Status: **Complete (Codex, 2026-10-02).** See the
[metadata acceptance checkpoint](./release-0.9.0.md#codex-cli-metadata-2026-10-02).
The baseline/approach below records the original plan. Extend command contracts
in `packages/cossack/src/command-specs.js` when adding future commands; parser,
help, and preflight validation consume the same definitions. CLI-03 is now complete.

Purpose: A misspelled flag or ambiguous target must fail before a command changes
files or connects to a database. Silent flag acceptance makes agent mistakes
hard to discover.

Baseline: Partial. Boolean parsing and selected deployment/database commands
perform explicit validation. The same rules do not cover every command.

Approach: Define command metadata for accepted flags, value types, positional
arguments, aliases, conflicts, and repeat behavior. Use it for parsing and help.
Treat forwarded Vite flags as an explicit boundary, rather than rejecting all
unknown flags globally. Report the invalid token and supported alternatives.

Start in `packages/cossack/src/flags.js`, `dispatch.js`, and `commands/`.
Use CLI-01 tests to preserve lifecycle forwarding.

Done when: Every command rejects missing values, invalid booleans, incompatible
targets, and unexpected arguments before effects. Tests cover aliases, repeated
values, `--`, explicit false, and a flag value that resembles another flag.
CLI-03 defines the machine-readable failure format.

<a id="cli-03"></a>
### CLI-03: JSON diagnostics and noninteractive execution

Status: **Complete (Codex, 2026-10-02).** See the
[machine-contract acceptance checkpoint](./release-0.9.0.md#codex-cli-json-2026-10-02).
Every built-in command has subprocess coverage for its machine protocol.
Finite commands emit one validated envelope; dev/start/Studio emit documented
lifecycle events. JSON executions isolate project imports and subprocess logs,
bound execution/startup/shutdown, and preserve human diagnostic output.
The broader release platform, tarball, and runtime gates remain open.

Purpose: An agent needs a stable result schema and exit code. It must not guess
success from colored output or wait forever for an interactive prompt.

Original baseline: Partial. Creation, deployment, inspection, and database tools have
structured output. Database tools isolate application logs in a child process.

Approach: Apply the existing versioned envelope to every command. Define stable
codes for usage, configuration, capability, conflict, and execution failures.
Include affected paths, target metadata, and next actions where available.
Under noninteractive execution, require missing choices as arguments or use
documented defaults. Long-running commands need an explicit event-output contract.

Start in `packages/cossack/src/output.js`, `bin/cossack.js`, and `commands/`.
Reuse `packages/database/src/tooling/process-json.ts` where project code can log.

Done when: Subprocess tests parse output without filtering banners or warnings.
Failure paths emit structured diagnostics and nonzero exits. Secret values,
project console logs, and parser excerpts cannot contaminate results. Human help
remains useful. This contract supports CLI-04, CLI-06, and CLI-07.

<a id="cli-04"></a>
### CLI-04: Inspect, check, and explain project behavior

Purpose: An agent needs to understand a project before editing it. File names
alone do not reveal inherited middleware, compiled method classification, or
effective transport behavior.

Baseline: Local `inspect cloudflare` and `check cloudflare` exist. Broader compiler
inspection and an explanation interface remain open.

Approach: Expose one project model from compiler and scaffold metadata. Inspection
returns facts. Checks return diagnostics and fail on errors. Explanation returns
the reason behind a fact, such as a method becoming a server proxy because of
its decorator or default classification. Include source file and position.
Do not execute constructors or server methods merely to inspect a project.

Codex completion (2026-10-03): the shared compiler/scaffold/runtime model now
supports inspection, failing checks, and explanations with authored locations.
`packages/cossack/tests/inspection-acceptance.test.js` covers grouped routes,
nested layouts, declared services, imported inheritance, recipes, resources,
and compiler stripping parity. The framework companion
`inspection-service-acceptance.test.ts` executes inspected sources through SSG,
verifies service ownership/shadowing/hydration/disposal, and runs check/explain.
Module-export checks reject missing or unresolved defaults. Unsupported inherited
layout options and dynamic service expressions stay unknown. Service names are
source declarations, not inferred token identity across modules.

The [requirement audit](./release-0.9.0.md#codex-module-inspection-2026-10-03)
records the completion evidence and limits. Follow-up generated-app acceptance
exposed functional HTTP classification and runtime first-export selection gaps.
Both are now fixed: CLI/build discovery share functional handler classification,
and runtime component paths consistently select default exports. Actual SSR, SSG,
transport guards, and generated Worker integration validate the corrections.
CLI-04 is complete. Browser/production
runtime gates, RT-07 typed URL/API generation, RT-24 config registry work, and
RT-25 build/recipe capability enforcement remain under their own tasks.

Start in `packages/framework/src/vite-plugin.ts`, `vite-security-plugin.ts`,
`route-ids.ts`, `packages/scaffold/src/registry.js`, and CLI inspection commands.

Done when: A fixture with grouped routes, nested layouts, services, and mixed
methods produces results that match its compiled behavior. Unsupported syntax
gets a diagnostic rather than an invented answer. Dependencies: RT-07, RT-24,
and RT-25. CLI-07 reuses this model.

<a id="cli-05"></a>
### CLI-05: Complete application recipes

Purpose: Generated examples must teach the intended framework patterns. Agents
need complete working features instead of disconnected stubs that omit validation,
authorization, loading, or failure behavior.

Baseline: The scaffold engine supports feature composition and several presets.
The four recipes below still need a complete contract and acceptance fixtures.

Approach: Add a read-only server resource, a validated mutation, a protected
route, and a layout-scoped service recipe. Each recipe needs imports, registration,
UI states, failure handling, and tests. Declare feature dependencies and runtime
capabilities. Generate database-specific pieces only when that feature is selected.
Use existing conflict detection when composing into an edited application.

Codex resource checkpoint (2026-10-03): `cossack add resource` generates a read-only
HTTP resource page with explicit dependencies, pending/stale/error/empty states,
and refresh/retry. It declares capabilities, adds no database dependency, and has
composition preservation, generated-app type, SSR, code-stripping, and real RPC
acceptance tests. The following checkpoint adds browser coverage and the mutation
recipe using the same registry/composition path and shared capability model.

Codex mutation/browser checkpoint (2026-10-03): `cossack add mutation` now
generates `/mutation` with typed built-in form rules and an explicit
`@Server({ input })` contract. Client-only form/error/pending state is excluded
from RPC component state. Submission snapshots are revalidated server-side.
The page shows field errors and generic failures, keeps input on failure, and
clears it after a successful acknowledgment. This is a public, database-free
demonstration that explicitly saves/sends nothing; real writes require server
authorization and an application service/database call.

Generated acceptance now runs Chromium against the actual production Node app.
It covers mutation hydration, client validation without a request, real server
validation of malformed/tampered inputs, pending/disabled controls, payload/state
separation, server field errors, failed submission, reset, and retry. Resource
coverage now includes hydration, filtered reads, pending with stale results,
empty results, error rendering, and successful retry. This caught a core bug:
failed loaders updated their status without requesting a render. The fix notifies
the client view while ignoring failures from replaced loads. Vite fixtures now
explicitly set NODE_ENV=production instead of inheriting Vitest's test environment.
CI installs Chromium before CLI tests. RT-03 still needs typed resource targeting and the
broader unmount/SSR lifecycle matrix; this recipe slice does not complete it.

Codex service/protected-route checkpoint (2026-10-03): the four recipes now build
and run through published exports. `scoped-service` declares layout ownership,
injects one browser instance into sibling pages and a nested component, and uses
explicit service RPC for pending/failure/retry. Browser acceptance verifies state
retention within the layout, disposal on exit, and fresh state on return. The
public HTTP counter is client-supplied state, not an authoritative record.

`protected-route` selects auth/database/UI, requires the trusted session in layout
middleware, redirects anonymous pages, and returns coded RPC failures. Acceptance
applies real migrations, registers/signs in, rejects forged identity/state, guards
nested pages, and expires persisted sessions while the page is hydrated. This
exposed an existing auth-only scaffold bug: User referenced an unregistered
UserRole entity. Auth/RBAC files and relations now follow selected model ownership.

All four recipes have repeat-composition and edited-file preservation tests.
Creation/composition reject D1 or Hyperdrive plus Desktop before writes, with the
feature and manifest source. Planning, build, and CLI inspection share the pure
core capability model; framework retains its existing entry as a re-export.
Inspection still describes older unsupported recipes with capability diagnostics.
CLI-05 acceptance is complete. The broader runtime tasks listed below retain
their own open contracts; these examples do not complete those tasks.

Start in `packages/scaffold/src/registry.js`, `index.js`, and
`packages/cossack/src/commands/add.js` and `generate.js`.

Done when: Each recipe builds and runs in a generated app through published
exports. Applying it twice is predictable. Edited files survive composition.
Unsupported runtime combinations fail during planning. Dependencies: RT-02,
RT-03, RT-12, RT-14, RT-25, and RT-29.

<a id="cli-06"></a>
### CLI-06: Structured upgrades

Status: **Complete (Codex, 2026-10-02).** See the
[upgrade acceptance checkpoint](./release-0.9.0.md#codex-cli-upgrades-2026-10-02).
Plans now combine recorded dependency ownership with templates from the resolved
target release. Subprocess tests prove read-only application previews, preservation,
owned updates/removals, repeat behavior, and partial failure. A real pnpm/local
registry test exercises release tarball loading. The broader REL-02 matrix remains open.

Purpose: Upgrades must show dependency changes and template conflicts before
overwriting application work. Agents need to distinguish safe generated updates
from files that require a decision.

Original baseline: `upgrade.js` resolves versions and compares template drift. It still
uses a largely human-oriented sequence of updates, installation, and reporting.

Approach: Build a complete upgrade plan first. Include old/new versions,
dependency additions/removals, generated-file changes, preserved edits, conflicts,
and follow-up commands. Use scaffold ownership hashes and versioned manifests.
Separate applying the reviewed plan from computing it. Report partial failure
explicitly if an external package installation fails.

Start in `packages/cossack/src/commands/upgrade.js` and scaffold planning/apply
functions in `packages/scaffold/src/index.js`.

Done when: A dry run changes no files. An edited authentication module remains
preserved. An unchanged generated file updates. Repeating a successful upgrade
produces no unexpected changes. JSON exposes every conflict without prompt text.
Dependencies: CLI-02, CLI-03, and REL-02 fixture applications.

<a id="cli-07"></a>
### CLI-07: Local MCP tools

Codex implementation checkpoint (2026-10-04): `cossack` now publishes a separate
`cossack-mcp --project <directory>` stdio entrypoint. The official MCP server SDK
stays in the Node-only CLI package. `inspection-service.js` shares route
explanations/checks and the existing static route, deployment and provider models.
The `inspect_project` tool has strict inputs, a versioned output schema, installed
CLI/framework versions and read-only annotations. Unknown routes never become
arbitrary file reads. Default environment selection matches `CLOUDFLARE_ENV`.

Each call owns a worker. Captured dependency output cannot pollute stdout, and
termination cancels synchronous compiler work. Calls have a 30-second deadline,
four-worker concurrency limit and 4 MiB result limit. EOF/signals close the server
and its workers. Tests cover real SDK clients, legacy/current protocol negotiation,
CLI parity, configured-secret redaction, import-only package version resolution,
invalid startup/tool/field/path input, deadlines, cancellation and shutdown.
See the [verification](./release-0.9.0.md#codex-local-mcp-2026-10-04) and
[setup guide](../docs/local-agent-tools.md).

CLI-07 remains open. Continue with the installed-version documentation service
(CLI-08), stored test-result access and development snapshot/trace access (RT-28).
Share those models with the CLI/devtools, define provenance and freshness, and
avoid arbitrary file reads or shell-output parsing. Add native MCP interruption
acceptance while these longer-running tools own resources, and verify packaged
entrypoints/dependencies through the REL-02 tarball fixtures. Audit every original
requirement before closure. Static inspection alone does not complete this task.

Purpose: MCP gives coding agents a structured tool interface. The intended server
lets an agent inspect the installed framework and project without reconstructing
answers from shell output or unrelated online documentation.

Baseline: Open. This is a local development tool, not an MCP endpoint in deployed
applications.

Approach: Expose project inspection, installed-version documentation, diagnostics,
test results, and development traces through the same services as CLI and devtools.
Define typed inputs and versioned output. Bind the server to one project root.
Give each operation accurate read/write annotations and cancellation behavior.
Keep mutation commands separate from inspection. Do not shell out to parse the
human CLI view when a shared function is available.

Start with the service boundaries from CLI-04 and RT-28. Select the package
location after checking CLI dependencies and published entry requirements.

Done when: Tool and CLI answers match for one fixture. Invalid paths and unknown
operations fail predictably. Results redact secrets and identify the installed
version. Startup, shutdown, and interrupted tool calls release resources.

<a id="cli-08"></a>
### CLI-08: Installed-version agent documentation

Codex prop-catalog checkpoint (2026-10-04): declaration catalogs now preserve
member comments, JSDoc tags, optional callback signatures and index signatures.
Exported classes with public props expose an instantiated propsContract, including
inherited generics. Union shapes are partial and unknown shapes remain explicit.
This records declared types, not native attribute forwarding or accessibility.
The actual UI catalog exposes Button descriptions and its permissive string/any
index signature. Platform diagnostics remain partial. See the
[checkpoint](./release-0.9.0.md#codex-prop-catalog-2026-10-04).


Codex recipe-guidance checkpoint (2026-10-04): scaffold now ships guidance for
resource, mutation, scoped-service and protected-route recipes. Each guide explains
what the template provides, its limits, preview/application commands and adaptation
steps. Executable examples inspect resolved dependencies and host requirements
through the public registry. The protected-route example checks auth/database/UI,
D1 requirements and rejection of an unsupported Node/D1 selection.

Authoring the examples exposed an unwanted Node Buffer dependency in the pure
registry declarations. Shared metadata declarations now live in registry.d.ts,
and the root API re-exports them. Separate compiler fixtures prove the registry
works without Node ambient types and the root API retains its Node contracts.
See the [checkpoint](./release-0.9.0.md#codex-recipe-guidance-2026-10-04).
Continue broader API/component coverage and runtime guidance under the original
CLI-08 criteria. Recipe planning does not prove remote deployment readiness.

Codex package-guidance checkpoint (2026-10-04): library-owned `agent-docs.json`
files now supply usage explanations and TypeScript example source through the
shared CLI/MCP catalog. Guidance carries the installed package identity/version
and a content hash. The reader validates bounded JSON, rejects escaping paths,
refreshes content and omits guides whose listed public imports disappear.
Missing guidance is explicit. Discovery never runs examples.

Initial authored guides cover core typed route URLs and renderer server HTML.
The tarball acceptance compiles and executes those examples against installed
exports. This is an initial set, not full API/component/recipe coverage or proof
for all runtimes. Continue that coverage, runtime guidance, RT-23 and REL-02.
See the [checkpoint](./release-0.9.0.md#codex-package-guidance-2026-10-04).

Codex installed-tarball checkpoint (2026-10-04): the catalog foundation now passes
`pnpm test:agent-docs:local` in a generated application with real local tarballs.
The installed CLI and MCP entrypoints agree on versions, command metadata, the
packaged guide and renderer declaration signatures. A running server refreshes
changed versions and removed exports. Discovery runs with Node network calls
blocked and recorded. Installation itself can use the registry.

This acceptance also runs in the existing generated-app CI path. It does not
prove every package's examples, component guidance or runtime support. Those
original requirements, plus RT-23 and REL-02 dependencies, remain open. See the
[acceptance record](./release-0.9.0.md#codex-installed-docs-acceptance-2026-10-04).
Older notes that list all installed-tarball discovery as pending are superseded.

Codex export-discovery checkpoint (2026-10-04): wildcard/implicit declaration
discovery is implemented. Catalogs add concrete wildcard matches while preserving
the source pattern. Exact entries, more-specific patterns and null exclusions take
precedence. Repeated target stars use one capture. Default branches and fallback
arrays do not invent alternate paths when an earlier target merely lacks a file.
A native Node resolution fixture verifies public overrides and private exclusions.

Discovery reports partial status for bounded scans, nested symlinks, unreadable
directories, unsupported URL targets/file names, malformed pattern keys and constant
pattern targets. The latter can expose infinitely many public names. These limits
remain explicit rather than producing a false exhaustive catalog. TypeScript finds
adjacent JS/ESM/CommonJS declarations and legacy main/default-index types. Wildcard
matches can come from type files even when runtime output is absent. Resolution
records and unresolvedImports preserve that distinction.

See the [verification](./release-0.9.0.md#codex-export-discovery-2026-10-04).
Next implement authored API/component/recipe explanations and executable examples,
verified runtime guidance and offline installed-tarball acceptance. These remain
required for CLI-08 closure. Previous notes listing wildcard/implicit discovery as
unimplemented are superseded by this checkpoint and its documented limits.

Codex declaration-index checkpoint (2026-10-04): named exports/signatures are now
available through `cossack docs --package <name> --symbols --json` and MCP
`read_documentation` with `symbols: true`. One package must be selected. The CLI
owns a pinned `typescript-api` alias at TypeScript 6.0.3 because the workspace's
TypeScript 7 entry no longer exposes the classic compiler API. Project compilation
still uses TypeScript 7. The index reports its own compiler version explicitly.

Fresh programs read declared type targets, including legacy `types` entries.
They resolve aliases, star/type-only/namespace re-exports and CommonJS export
assignments. Results include overloads/generics, public constructors and members,
object/namespace/enum helpers, documentation, source locations and a declaration
graph hash. Private/protected members and constructors are omitted. Abstract
classes are marked. Underlying signatures never certify runtime value exports.
Missing targets or compiler diagnostics produce unavailable/partial status, not a
successful compatibility claim. Source diagnostic payloads omit raw compiler text.
See the [verification](./release-0.9.0.md#codex-declaration-index-2026-10-04).

Next finish authored API/component/recipe explanations and executable examples,
verified runtime guidance, wildcard/implicit declaration discovery and offline
installed-tarball acceptance. The initial fixed compiler profile has no automatic
ambient platform packages; actual core inspection reports unresolved platform globals
as partial. It does not invent Cloudflare runtime readiness. Keep CLI-08 open until
all original requirements and dependency gates are proven.

Codex catalog checkpoint (2026-10-04): `cossack docs [--package <name>] --json`
and MCP `read_documentation` now share `documentation-service.js`. It reads fresh
installed manifests through a fixed Cossack package allowlist. Results contain
versions, manifest hashes, declared export targets/conditions, target presence,
command schemas and a packaged CLI-version agent guide. Missing, blocked, invalid
and wildcard targets remain explicit. No module entrypoints execute. MCP's outer
framework version also refreshes per call. Malformed manifest diagnostics omit
raw contents, and removed exports disappear on the next catalog read.

Scaffolded AGENTS guidance now starts with offline CLI discovery instead of
requiring remote skills installation. SDK/CLI parity, manifest changes, package
selection, malformed metadata and generated guide content have tests. See the
[verification](./release-0.9.0.md#codex-installed-catalog-2026-10-04).

This is an initial discovery catalog, not completion of CLI-08. Continue by indexing
named exports and their type/signature information through a compiler-backed
service. Add authored API/component and recipe explanations, explicit runtime
support backed by capability metadata, and examples that compile and execute.
Resolve concrete wildcard exports or retain an explicit unsupported result.
Verify the catalogs and guides from installed tarballs in an offline generated
application. Keep command metadata tied to the CLI version and library guidance
tied to each installed package version. Do not equate file presence with a valid
runtime import. RT-23 component coverage and REL-02 acceptance remain dependencies.

Purpose: An agent must use the APIs installed in the project. A generic guide
can recommend symbols, command flags, or components from a different release.

Baseline: Repository docs and scaffold agent instructions exist. A generated,
versioned offline catalog and executable example coverage remain open.

Approach: Package a concise AGENTS guide, API/component catalog, command schemas,
and recipe examples with the release. Generate discoverable facts from exports
and metadata. Write explanations where metadata cannot explain usage. Link each
entry to its version and runtime support. Compile examples and execute behavior
examples in CI. Make the same content available to CLI-07.

Start in `docs/`, `packages/scaffold/template/AGENTS.md`, public package exports,
and the metadata service from CLI-04. Keep installed guidance separate from
instructions for contributing to the framework repository.

Done when: An offline generated project can discover the correct APIs and usage.
Every documented import resolves from its published package. Removed exports
cannot remain in the catalog. Skill examples and generated templates use the
same APIs as the tested release. Dependencies: REL-02 and RT-23.

## Runtime and application APIs

Runtime tasks continue below. Each status describes the checkpoint only.
Reinspect the source before extending it, because GLM can complete tasks in any
dependency-compatible order.

<a id="rt-01"></a>
### RT-01: One RPC contract across transports

Purpose: The same server method must have predictable completion and failure
behavior over HTTP, SSE, WebSockets, and explicit service calls. Transport choice
must not change an awaited value into an unobservable fire-and-forget action.

Baseline: HTTP/SSE component calls now share a promise/iterator contract and
bounded stream frames. WebSocket and service RPC parity, timeouts, and precise
client typing for generator results remain open.

Approach: Extend the existing call abstraction and error taxonomy. Correlate
requests, yields, terminal values, failures, and cancellation by request ID.
Add configurable deadlines and distinguish remote application errors from
transport failure and uncertain completion. Describe serialization failures by
component, action, and value path. Define supported value types explicitly.
Keep cookies and redirects subject to HTTP header timing.

Codex authored-client checkpoint (2026-10-03): added public
`rpc$(this.method(...))` as the explicit client type view. TypeScript decorators
cannot alter a method's authored signature; Vite's signature rewriting alone
does not supply editor inference. The helper derives `RpcCall<Result, Yield>`
from the invoked native return, including inferred/annotated generators,
inherited/generic methods, function fields, and scoped service methods. It checks
that the value is a framework proxy call and returns it by identity. It does not
wrap or redispatch the operation. Ordinary returns have no yielded values;
broad AsyncIterable completion and native Response completion stay unknown.

An isolated TypeScript fixture compiles against published declarations without
Vite, with positive exact-type assertions and negative argument/result/yield
checks. Production Node browser acceptance executes HTTP and SSE generators,
page function fields, and a scoped service function field from the authored
source. Existing WebSocket/service conformance now consumes calls through the
helper too. Fixed ordinary HTTP/SSE JSON calls yielding their final result once;
they now match WebSocket/service completion and `RpcCall<Result, never>`.
The change is recorded in the [draft migration guide](./migration-0.9.0.md).

Remaining before RT-01 completion: finish multipart and Workers/realtime
acceptance, plus remaining request/response protocol diagnostics. The JSON wire
value/type slice is verified in the checkpoint below. The shared conformance
matrix now exercises HTTP, SSE, WebSocket, and explicit service calls for errors,
deadlines, disconnect, cancellation, duplicate consumers, and cleanup.
Extend native Response/cookie/flash acceptance with RT-11 across the full matrix.
Typed client inference is now verified; do not restore it as an unfinished item.

Codex response timing checkpoint (2026-10-03): native component/service HTTP/SSE
responses retain their cookies alongside helper and flash cookies. Native
redirects become navigation metadata. A real Node production browser follows
both page and service redirects, retains HTTP-only cookies, and reads flash/old
input once. The streaming header phase closes after outgoing middleware finishes;
late cookie/header/flash writes reject explicitly. Early cookies are preserved
when returning a lazy generator: materializing the Context response first prevents
Hono from dropping prepared headers on a raw streaming response. Tests cover
both early and late writes. Session rotation/destruction reject before storage
changes once headers finalize. WebSocket actions reject native HTTP responses;
serialized trees reject nested Response/Request/Headers with precise paths.
HTTP/SSE/service/upload network failures explicitly report uncertain completion
and no automatic retry. The supported-value audit and remaining runtime response
acceptance are still required; this checkpoint does not close RT-01.

Codex shared matrix checkpoint (2026-10-03):
`packages/framework/tests/rpc-conformance-matrix.test.ts` runs 19 shared cases
against four paths (76 tests). HTTP/SSE component and explicit service requests
execute the real Hono router with published core proxies. The WebSocket pair
runs the real in-memory runtime/action dispatcher and correlated frame router.
Controlled disconnects affect transport consumption, not fabricated server
results. Shared fixtures cover ordinary and generator values/state, repeated
completion, unobserved draining, catch/finally, validation before mutation, visible
and private errors, failures after yields, pre-header and mid-stream deadlines,
cancellation and iterator return, duplicate iterators, unsupported arguments/
state/results, uncertain disconnects, loading/pending-map cleanup, and request
versus runtime ownership. Finite application I/O allows teardown to await remote
completion without implying mutation rollback or arbitrary I/O interruption.

Fixed service RPC exposing private exception stacks in development, WebSocket
serialization errors losing `payload`/`state` path roots, and HTTP/SSE/service
errors losing a known response request ID on invalid JSON, stream deadlines,
or disconnect. HTTP IDs can remain unavailable before response headers arrive;
local failures need not have server IDs, and HTTP status does not apply to WS.

Codex JSON wire checkpoint (2026-10-03): core now owns `snapshotRpcValue`
and `snapshotRpcFrame`. Encoders validate and copy the actual JSON representation
once before stringify. Dates become ISO strings; undefined object fields omit,
array holes/undefined become null, and top-level void remains undefined.
Data/model instances transfer own enumerable fields; typed `toJSON()` output
replaces the instance. Hooks run once per value location with a consistent empty
root result key; nested hooks receive their field/index. A hook returning itself
is supported without permitting actual cycles. Shared references copy normally.
Lossy non-finite numbers, invalid Dates, opaque/native/binary values, cycles,
throwing hooks/getters, and nesting beyond 256 levels reject with sanitized paths.
The file extraction walker preserves own `__proto__` keys as data. WebSocket
File/Blob arguments reject before dispatch instead of disappearing.

`RpcSerialized<T>` maps results and yields to their JSON types. Published
semantic fixtures check dates, model fields/method exclusion, custom hooks,
optional hooks, tuples, undefined entries, unknown/any, and generators. Compiler
return rewriting delegates to the same public types as authored `rpc$`. Method
parameters and hydrated property annotations remain authored: use JSON input/state
types, such as ISO strings, rather than assuming native revival. TypeScript cannot
infer which class properties are enumerable; use explicit DTOs or typed hooks.
See [the RPC guide](../docs/rpc.md) and [migration notes](./migration-0.9.0.md).

The existing matrix now has 32 shared cases across four paths (128 tests), plus
six real multipart-router cases (134 total). It verifies dates/model/hook values,
normalization once, root hook keys, own `__proto__`, and invalid inputs/results.
Ordinary multipart replies use the same normalizer, stable code/path/request ID,
and private-error redaction in development. Production generated Node browsers
execute Date/custom-hook/undefined-array generators over HTTP and SSE after
source TypeScript checking.

Codex native-response checkpoint (2026-10-03): ordinary successful native
Response actions now resolve through HTTP/SSE component and explicit service
clients to a local browser Response. The reserved native-response header
separates user JSON/NDJSON from framework state and protocol metadata. Text,
JSON, binary, status/status text, browser-visible headers and bodyless 204 work.
Redirects still navigate and complete with undefined; HTTP error statuses reject
with correlation. `RpcResult<Response>` now means `Response | undefined`;
generator Response values remain unsupported and infer never. WebSocket
rejection cancels the response body before returning its explicit error.

Core drains the body before completion using a growing byte buffer capped at
1 MiB. Unobserved calls drain too. Cancellation, deadlines and response-lifetime
cleanup remain active through body consumption; oversized bodies fail with
`COSSACK_RPC_RESPONSE_TOO_LARGE`. Use HTTP endpoints for larger downloads or
continuous streams. Repeated awaits return the same local one-use body; clone
before multiple reads. Native bodies never hydrate action state and the local
response does not preserve fetch URL/redirect flags. Typed data returns remain
the appropriate state synchronization contract. Upload XHR uses arraybuffer and
copies browser-visible headers; real Chromium verifies bytes/status/headers.

The shared matrix adds 11 cases per transport for five native representations,
unobserved draining, size errors, HTTP status failures, body disconnects,
deadlines and cancellation/body cleanup: 43 shared cases across four paths
(172 tests), plus six ordinary multipart cases (178 total). Core reader tests
cover exact byte limits, fragmented chunks, early and pending cancellation,
network failure and reader release. Existing published type tests check the new
result and unsupported generator terminal types. Generated Node apps compile
before production HTTP/SSE browsers consume native text and service binary
results; a separate real upload round-trip returns binary and native metadata.
This proves Node/browser native body completion, not Workers response acceptance.

Codex multipart checkpoint (2026-10-03): `/upload` now shares `/crpc`'s action
pipeline instead of separately bootstrapping and disposing a component. A cached
request decoder is reused by guards and dispatch. It restores nested file
markers, rejects malformed or duplicate metadata/parts before construction,
keeps own `__proto__` data, and rejects explicit null/non-array payloads.
Component and explicit-service clients preserve scope/owner metadata. FileList
becomes an array of Files; raw Blob is still outside the argument contract.

The shared dispatcher applies action input validation before mutation, restores
layout service ownership, and retains request/config/ORM context, stream lifetime,
awaited cleanup and native/helper/flash cookies/redirects. Fetch streams multipart
responses by default. Numeric `<method>Progress` state selects native XHR upload
progress. XHR forwards complete UTF-8 NDJSON lines before load and bounds frame
bytes; it retains cumulative browser response text and has no network download
backpressure. Do not describe it as a total-memory-bounded stream. Native XHR
responses preserve binary bytes and browser-visible headers. Parked iterator
cancellation retains a known request ID on all four client paths.

Evidence: 44 shared cases x four transports (176), 13 raw multipart cases and
15 multipart client/router cases (204 total); 25 existing router lifetime cases
now run for both JSON and multipart (50). Production Node/Chromium acceptance
checks early Unicode yields, final results and progress for HTTP/SSE components
and explicit services. Cancellation tests retain request correlation and verify
remote closure/disposal. Tests capture counters per fixture because response
cleanup can finish after a cancelled caller settles. Full core 726, framework
858 and CLI 559 tests pass with root and all 11 package type checks.

Codex built Workers checkpoint (2026-10-03): extended the generated staging
artifact fixture with protected HTTP/SSE pages and a nested layout service.
Native Responses using RPC NDJSON lost their bytes because the coordinator
selected protocol parsing by MIME type alone. The reserved native marker now
wins before parsing; opaque native bodies retain their existing cleanup and
serialization-slot lifetime. A separate two-Worker source fixture verifies
bytes/headers, unchanged scope state and subsequent coordinator progress.

The artifact fixture uses `NODE_ENV=production`; inheriting Vitest's test env
had emitted development asset paths and could not prove hydration. Chromium
loads hashed scripts, waits for framework readiness, and invokes public clients.
Component XHR and scoped-service Fetch uploads deliver an early Unicode yield,
then wait on an explicit D1 gate before completion. Direct calls verify auth/input
rejection, early cookies and late-cookie diagnostics, native NDJSON/JSON/binary/
204 bodies and eventual cancellation cleanup. D1 audit records from generator
completion, page cleanup and service disposal retain the original user/path and
ORM context. SSR observes authoritative SSE state after multipart mutation.

Real browsers also consume native bodies and observe native/helper/flash cookies
on redirects from both component and service actions. Old input/messages render
once and disappear on reload. These are published-entry production artifact
checks, not tarball installation or remote deployment. Cancellation tests release
finite application I/O explicitly; they do not claim rollback or cancellation of
queued RPC callbacks on the pinned Wrangler baseline. Full framework 858 and CLI
559 tests pass with root and all 11 package checks; core source is unchanged.

Next finish systematic malformed data/frame, rate-limit and child-target checks
and settle file count/size/type/unknown-key policies with RT-02/RT-14. The shared
dispatcher and new runtime fixtures do not themselves prove every authorization
or protocol boundary. RT-11 still requires secret exclusion, complete session
recipes, rotation and concurrency criteria. Physical upgrades, distributed
coordination, Deno execution, Electron packaging and full release gates retain
separate evidence requirements. RT-01 stays open; no additional checkbox closes.

Codex protocol-boundary checkpoint (2026-10-03): malformed JSON/UTF-8/frame
shapes now retain the header/learned request ID. The first HTTP frame must match
the response header; nonempty IDs/error codes are required. The reader holds
done/error until EOF, rejecting trailing bytes or body failure before clients
hydrate terminal state. Yields remain immediate and already accepted state is
retained. Deadline/cancellation ownership remains active through EOF; there is
no retry or mutation rollback. The four-path matrix now has 52 shared cases
(208), six response-local protocol cases, 13 raw multipart and 15 multipart
client/router cases: 242 total. WebSocket faults only rewrite correlated frames;
initial snapshots/broadcasts remain untouched. Unknown socket IDs are ignored,
malformed known-ID frames reject the pending call, and its terminal frame closes
the call without waiting for the shared socket to end.

Codex target/limit checkpoint (2026-10-03): WebSocket execution now checks
inherited or forwarded `@RateLimit` metadata before validation/mutation, with
authenticated peer identity and the same counter decision as HTTP. The runtime
assigns an internal canonical route owner, so the same action/caller/store budget
survives switching JSON/multipart/socket and reopening connections. Child class
budgets are separate from page class budgets; siblings of one class share a
budget. Explicit service limits belong to their layout/slot and span its pages.
Limit/store failures keep request IDs, release loading/pending state, redact
private errors and never retry mutations. HTTP rate replies add a stable code.

Process-local SSE was publishing child state as page state. Ordinary and stream
actions now publish the root snapshot while their caller receives child state.
New tests deliberately collide page/child state names across JSON and multipart,
verify denied/missing/invalid targets and awaited descendant cleanup, and prove
child/page budget separation. Numeric/empty action targets cannot fall back to
root WebSocket execution. The actual browser socket message handler now routes
known-ID malformed frames before filtering broadcast types, so a missing type
rejects its call without waiting for timeout or poisoning another pending call.

Evidence: 56 shared cases x four paths (224), six response-local cases, 13 raw
multipart, 15 multipart client/router and one cross-HTTP/socket budget case:
259 matrix cases. The child suite has 18 cases; separate real socket tests
exercise trusted caller isolation, forwarded service limits and child dispatch.
Generated production workerd proves JSON acceptance followed by multipart 429,
request IDs/Retry-After and zero denied D1 writes. A layout service retains its
spent budget across HTTP/SSE pages. Full core 744, framework 931 and CLI 559 pass
with root/all 11 package checks. Test-only registry caches and the limiter's
expiry clock are isolated so these checks do not depend on warm caches or sleep.

Codex ordinary-envelope checkpoint (2026-10-03): the real response matrix
reproduced 35 malformed service-state, redirect and diagnostic cases before the
fix. Core now uses one decoder for component/SSE/explicit-service ordinary JSON
and HTTP errors. It rejects invalid UTF-8, non-object roots, foreign service
wrappers, missing/null/array service state, invalid/conflicting redirects, and
untyped code/message/field-error/ID metadata. Redirects are exclusive nonempty
HTTP/HTTPS-or-relative URL envelopes. Error body IDs must match known headers;
a valid body ID supplies correlation when a header is absent. Component state
named `requestId` remains application data. Native failure bodies remain opaque.

The complete ordinary JSON/error body is bounded to 1 MiB, including state,
results and diagnostics; the public constant is `RPC_JSON_RESPONSE_MAX_BYTES`.
Overflow cancels the reader and rejects before hydration. Fatal UTF-8 parsing,
EOF, cancellation, deadline and ownership checks precede completion. This does
not prevent a server mutation or roll it back. Non-JSON middleware failures
retain generic status/known-ID errors; malformed declared JSON failures reject.
Nested field-error values remain JSON, without inventing RT-02 schema semantics.

Evidence: 31 new core cases cover exact byte limits, multibyte/split decoding,
opaque/invalid errors, EOF gating, body read failure and public-proxy parked-body
cancellation/deadlines. The matrix has 294 cases (259 previous plus 35 ordinary
response regressions); full core 775/53 files and framework 966/50 pass with
root/all 11 package checks. See the linked checkpoint for CLI/runtime evidence.
No new checkbox closes. The original task scope and all remaining tasks persist.

Codex socket-peer checkpoint (2026-10-03): Cloudflare formerly assigned every
anonymous socket a synthetic `anonymous` user and rebuilt only page params.
Core now retains the verified peer user and upgrade URL/params/filtered headers
in the native attachment. Anonymous peers have no user and use captured IP
headers. Every action receives a fresh Hono context; custom keys and generator
bodies use that peer instead of shared bootstrap state. HTTP credentials,
handshake noise and internal identity assertions are excluded. Arbitrary
middleware variables/session revalidation are not reconstructed. Oversized
attachments reject upgrades with structured 413, and old sockets without a
snapshot reject before mutation and close 1012 for reconnect. Child targets
receive the same context; unrelated broadcasts do not read attachments.

The shared process runtime now stores each client's context; framework upgrade
metadata includes decoded page params. Node, its legacy adapter, and Deno pass
the connecting context rather than borrowing a shared component's first peer.
Evidence includes real two-Worker/native DO sockets with a configured DO rate
store, IP/user/header-key isolation, cross-Worker/reconnect budgets, interleaved
generators, forged message/identity isolation and HTTP/socket counter sharing.
Forced reconstruction uses native storage and retained attachments; it does not
claim timed platform eviction or a persistent rate-counter window. Real Node
sockets prove shared-component headers/users/custom budgets. Deno event tests
verify adapter wiring; actual Deno execution remains REL-03. See the checkpoint
for full commands and counts. No new checkbox closes.

The subsequent durable rate-window checkpoint with RT-18 closes the DO
counter's eviction-reset defect. Counter/deadline commits are transactional and
expiry alarms cannot erase a newer window. Native workerd proves unique ordered
counts from concurrent requests through two Workers, actual DO eviction, Worker
reload and spent HTTP/socket budgets. DO requests/replies have window/counter
validation; malformed storage and failed counter/alarm writes reject. Fake-clock
cases cover exact expiry and queued transactions. These proofs do not apply to
Redis, KV or memory. The subsequent rate-store contract checkpoint rejects invalid configured
backends, removes first-env global ownership and validates runtime options plus
Redis/KV/custom counters. Peer actions prefer their own context environment.
Redis expiry is now milliseconds; KV logical deadlines respect a minimum
60-second storage TTL. Next finish backend response bounds/abort/cleanup,
provider resource policies and public capability/cache-unit inspection. Do not
infer Redis/KV live or regional guarantees from native DO fixtures.
Audit component initialization/restoration concurrency and all remaining RT-01
criteria. Continue schema/file/unknown-key/resource policies with RT-02/RT-14
and session recipes/secrets/rotation/concurrency with RT-11. Handshake identity
is not per-message session revalidation. All 44 unchecked tasks remain in scope;
14/58 are checked. Keep the separate Deno/Electron/tarball/live release gates.

Start in core `shared/rpc-stream.ts`, `shared/rpc-json.ts`, `method-proxy.ts`, `service-scope.ts`,
`transport-connections.ts`, and framework transport handlers and `router.ts`.

Done when: One conformance suite exercises each transport and service calls.
Cover ordinary results, generators, errors, timeout, disconnect, cancellation,
duplicate consumers, and cleanup. Consuming a call twice never dispatches a
second mutation. Type tests prove yielded and final result inference.

<a id="rt-02"></a>
### RT-02: Validated server actions

Purpose: A server mutation needs a typed input boundary. Form validation in the
browser cannot establish that a direct RPC request contains valid or authorized data.

Baseline: Validation rules, coercion, nested errors, and server methods exist.
A consistent action-level input/result contract remains open.

Approach: Compose existing validation with server-action metadata. Infer input
types from the chosen schema/rule contract. Validate before application mutation,
return stable field paths and form-level errors, and run resource policy checks
on the server. Define how unknown keys, missing values, arrays, and files behave.
Keep expected validation failures distinct from internal exceptions. Decide the
decorator/helper spelling during implementation and document it as one API.

Start in `packages/core/src/shared/validation.ts`, `decorators.ts`,
`packages/framework/src/router.ts`, and `api-handler.ts`.

Codex multipart validation slice (2026-10-03): multipart now runs the existing
`enforceActionInput` gate before component/service mutation through the shared
JSON dispatcher. Real clients and direct forged multipart tests verify field
errors/request IDs, no invalid mutation, and cleanup. This closes the old upload
bypass, but does not establish schema inference or unknown-key, array/file and
resource-policy contracts. Those acceptance criteria remain open.

Codex typed-input phase (2026-10-03), after `fb927cb`: the public core `input`
builders now describe parsed and raw values (`InputOf`/`RawInputOf`), strict
primitive coercion, optional/null fields, exact enum/literal values, canonical
UTC dates, nested objects/arrays and actual File constraints. Typed contracts
accept one argument. Unknown fields reject by default; stripping is explicit
per object. Parsed objects/arrays are copies, with no prototype on object output.
Depth/node/field/item/error bounds and accessor/prototype/cycle rejection are
covered. The old plain-map path remains explicitly transitional; it preserves
unknown fields/extra arguments and has no inferred schema types.

`enforceActionInput` moved from validation to its own core module to avoid a
validation/schema import cycle; its root package export remains. Both component
and explicit-service router gates and socket actions pass their owned request
signal. `.refine(value, {signal})` returning false is an expected field error;
callback exceptions/nonboolean results remain private internal failures.
Cancellation releases pending refinement ownership, skips later callbacks and
mutation, and returns correlated cancellation (HTTP 499 / socket code). It does
not terminate a callback that ignores its signal, roll back its own side effects,
or add an arbitrary action deadline. ClientVisibleError now preserves subclass
prototypes; ActionValidationError passes instanceof as well as its module marker.

The client compiler removes input metadata and module declarations reachable
only through the stripped contract, including private callbacks/constants and
unused imports. Type references do not keep runtime declarations. Local contracts
that remain runtime reachable/exported fail the client build. Private foreign
contract imports cannot share a client-retained module because its initializers
cannot be stripped from the importing file. Shared `storeRules` maps stay usable
by browser forms. The mutation recipe uses a private schema built from its shared
string rules. Generated Node production/browser acceptance checks the private
callback sentinel never enters JS client chunks, plus direct forged requests and
form error/pending/retry behavior.

Codex resource-policy phase (2026-10-03), after `49d3236`: RT-14 now supplies
the typed auth kit and structural `@Server({ authorize })` gate. Parsed schema
input, trusted context and owned signal compose without a core→auth dependency.
Direct and typed-channel decorators retain authorizer input inference. The
456-case transport matrix, forwarded socket case, API/SSR tests and compiler
policy-dependency tests pass. Native D1 page/service actions now reject cross-owner,
cross-tenant, missing/anonymous resources and forged input/state through JSON and
multipart without changing records/audit tables. Native sockets and browser UI
also exercise the policy. Read the RT-14 criterion audit below; do not recreate
that completed implementation or interpret it as RT-02 completion.

Remaining work recorded before the Codex schema migration below (historical):

1. Extend `worker-policy-acceptance.js`/the native RPC fixture with the remaining
   scalar/refinement matrix: strict/coercing boolean/number/date, enum/literal,
   optional/null distinctions, async refinement false/private exceptions and
   cancellation. Use generated published exports and actual request/record/audit
   context, prove no mutation on rejection, and preserve request IDs. Typed File,
   object/array, numeric identifiers and resource guards already have native
   acceptance. Actual native incoming disconnect delivery belongs to RT-01;
   explicit/cooperative cancellation must not be reported as that guarantee.
2. Resolve the transitional plain-map migration and browser raw-input typing.
   Authored native methods retain parsed InputOf parameters. RawInputOf describes
   boundary values, not a new proxy argument signature. Client form code should
   normalize its values before calling the authored method for now. The project
   prefers alpha breaks: choose/document a deliberate 0.9 migration rather than
   silently advertising strict schema guarantees for old maps. Inventory action
   maps, migrate examples/recipes, and verify direct browser/native calls retain
   authored signatures. If raw proxy argument typing is added, isolate the client
   view instead of widening native server parameters. Also audit typed-schema
   function-field decorators: current descriptor inference is verified for
   methods, not property decorator signatures. Add appropriate inference and
   generated/native cases before advertising that authored form as complete.
3. Add the chosen migration to release/user/agent guides, run meaningful affected
   package/generated checks, and audit every original RT-02 criterion before
   checking it. Keep RT-01 deadlines and RT-11 session freshness separate.

Codex schema migration and callback privacy review (2026-10-03), after `cd478f4`:

- The 0.9 action API accepts `input` schemas only. Plain action rule maps reject
  at compile time and stale JavaScript metadata rejects before legacy callbacks
  or mutation. Shared `@Validate`/`storeRules` maps retain their form API. The
  inventory found one transitional core runtime test; generated recipes already
  use schemas. Compiler privacy fixtures now use valid schema examples.
- Native and browser-authored method parameters remain parsed `InputOf` values.
  `RawInputOf` describes incoming values without changing the proxy signature.
  Forms normalize their values before calling; native API entrypoints explicitly
  parse/authorize. JSON date fields require explicit date coercion because Date
  arguments become strings on the wire. Public arrow/function/generator fields
  now receive schema parameter checking through direct and typed-channel Server
  decorators. Native return types remain unchanged; private/protected fields are
  not supported by this inference. Type negatives cover mismatched fields,
  additional required arguments, nonfunctions, channel names and raw calls.
- Native acceptance exposed a compiler false positive for a private module's
  type-only sibling import. Runtime reachability now excludes type-only imports,
  and imports containing only types after stripping become explicit `import type`.
  The regression verifies emitted JavaScript with `verbatimModuleSyntax: true`,
  so an empty runtime import cannot execute private initializers.
- Review reproduced callback exception leakage: eight transport regressions
  received public messages from `ClientVisibleError` thrown inside refinements
  or authorizers. Refinements, core structural authorizers and auth-owned
  lookup/rule operations now wrap unexpected exceptions with an internal Error
  and retain their original `cause` for server diagnostics. Throwing public
  validation/HTTP classes cannot expose their message or fields. Expected schema
  `false` results and kit/structural authorization denials retain their normal
  error paths; intentional public exceptions in action bodies remain supported.
- `worker-schema-acceptance.js` composes with the existing generated staging,
  D1 record and audit fixtures. Page/service function fields use parsed
  number/boolean/date values, strict variants, enum/literal, optional/null,
  nested arrays, File and unknown-key/extra-argument guards through HTTP/SSE,
  JSON/multipart. Async false/private/nonboolean/public-class exceptions write
  neither records nor audit rows. Stream fields retain yielded/final values.
  Browser submissions show nested refinement failure, keep input and recover
  through both component and service actions. Native sockets exercise scalar
  errors, parsed fields, private classes, explicit abort and successor progress.
- Explicit cancellation uses the owned signal; it does not establish incoming
  pre-header disconnect delivery, terminate ignored I/O or roll back writes.
  Native socket cancellation suppresses later result/error frames; the client
  settles its own cancellation. The fixture asserts native callback abort and
  no mutation rather than awaiting a nonexistent server cancellation reply.
  The expanded complete staging matrix required 91 seconds; its overall test
  budget is now 180 seconds, while its cancellation signal remains 500 ms.

**RT-02 completion audit — Author: Codex (2026-10-03).**

1. Invalid input cannot reach an inbound RPC mutation: shared gates cover
   component, forwarded/explicit service, HTTP, SSE, socket and multipart.
   The 472-case matrix plus generated Native D1 cases check record versions and
   audit rows on strict/coercing scalar, enum/literal, optional/null, nested
   array/File, unknown-field, positional-argument and refinement rejection.
   Plain action maps no longer bypass the contract. Unguarded actions remain
   explicit opt-outs; authored native calls are not decorator wrappers.
2. Errors map to nested form fields without parsing strings: object/array paths
   and root/container `_` errors use structured `fieldErrors`, stable validation
   codes and nonempty correlated request IDs. Browser page/service forms show
   the refinement error and recover after correcting input.
3. Coerced input has an inferred server type: strict published-export negatives
   check `InputOf`/`RawInputOf`, authorizers, methods and public function fields.
   Generated authored TypeScript and Node browser cases preserve generator
   yield/result inference. Native actions receive number/boolean/Date values;
   the date remains an actual Date until response serialization.
4. Denied resource access performs no mutation: completed RT-14 supplies typed
   app-owned lookup, trusted actors and policy guards. The same generated/native
   suites repeat owned, cross-owner/tenant, missing/anonymous and forged-state
   checks. Unexpected callbacks throwing public/HTTP exception classes remain
   internal rather than leaking fields, messages, stacks or a response.
5. Direct forged requests and browser submissions: final generated Node cases
   pass; final built Worker checks cover HTTP/SSE page/service JSON/multipart
   actions, D1 versions/audits, client chunk privacy, native sockets and browser
   failure/recovery. Signal abort skips mutation and releases successor work.

Exact commands/counts are in the
[release review](./release-0.9.0.md#codex-schema-migration-2026-10-03).
RT-02 uses the tested RT-01 transport boundary without closing its wider
deadlines/disconnect/init/restoration work. RT-07 owns native API schema
declarations/error response integration; native parsing still owns its error
mapping. RT-11 session freshness and REL-02..05/native Deno/Electron gates remain.
Do not reimplement RT-02/RT-14 or widen native signatures during the next phase.

Done when: Invalid input cannot reach the mutation on any supported transport.
Errors map to nested form fields without string parsing. Valid coerced input has
the inferred server type. Denied resource access performs no mutation. Test
direct forged requests as well as browser submissions. Dependencies: RT-01 and RT-14.

<a id="rt-03"></a>
### RT-03: Observable server resources

Purpose: `server$` already supplies read-only data. Authors also need to show
pending, failed, refreshing, and retry states without recreating a loading system.

Baseline: The macro, hydration, dependency tracking, refresh, and invalidation
exist. A complete public resource-status interface and typed targeting remain open.

Approach: Preserve the useful direct-value rendering model. Add a typed way to
inspect the resource lifecycle and request refresh/retry. Decide whether this
uses a companion handle or component methods before changing generated types.
Define stale-data behavior during refresh. Cancel or discard superseded results.
Use stable compiler resource IDs and keep loaders server-only.

Start in core `shared/server-resource.ts` and resource internals in `cossack.ts`,
plus framework `vite-security-plugin.ts` and `docs/server-functions.md`.

Done when: Initial load, successful refresh, failed refresh, retry, dependency
change, and unmount behave consistently. A slow old response cannot replace a
new result. Resource names and result types reject invalid uses at compile time.
SSR and hydration avoid duplicate initial loads. Dependencies: RT-01 and RT-05.

**Codex criterion audit (2026-10-03), after `cab1560`: complete.**

Chosen API: retain plain server$ field values and declare their public names in
`Cossack<Env, { Resources: 'users' | 'selected' }>`. The name union checks lifecycle
calls against actual public fields; status values infer those fields' types.
No phantom brands or nullable wrappers are needed. Public declaration fixtures
without Vite reject unknown names, ordinary fields outside the declaration,
missing fields, arbitrary strings and incorrect value use. Inherited fields,
arrays, scalars, null-only and optional values retain their types. Untyped/inline
names retain runtime validation and unknown status values.

The compiler emits a reserved per-class field-name registry and retains private
loader extraction/stable IDs. Core binds only registered getters, including
inherited fields. Status can start a named resource before render; refresh binds
current dependencies with loading suppressed, then starts one new invocation.
Unknown targets cannot execute unrelated getters. Invalidation drops the entry;
a new read starts from initial data. Registry collisions fail the compiler.

Hydration now carries `{ argsKey, value }` only for settled resources. It cannot
mark an unresolved initial value as complete or attach old data to whichever
arguments the browser happens to read first. Matching dependencies reuse SSR
without an initial RPC; changed dependencies retain stale data while loading.
Current failures retain the last good value and permit retry. Entry identity and
disposal gate results/errors; obsolete SSR failures no longer fail a live pass,
and destroyed components cannot start another resource read.

Validation runs before custom toJSON, rejects class/Date instances, non-finite
numbers and undefined dependencies, and tracks ancestors instead of treating
repeated acyclic references as cycles. Use ISO dates and null dependencies.
Generated resource methods validate results before RPC serialization as well as
SSR settlement; direct forged refreshes cannot convert an invalid Date or custom
toJSON value into acceptable client JSON. Generator loaders fail with an authored
resource diagnostic; use Server actions for streams.
Dependency identity is public hydration data; use browser-safe inputs. Use
ClientState for browser-owned filters. Native SSE acceptance reproduced a filter
reset with shared State because authoritative snapshots correctly restore server
state. The fixture, generated recipe and bundled example now use ClientState;
loader arguments still reach the server while filter fields stay out of RPC state.
Do not weaken authoritative snapshot handling to preserve local selection.

Exact acceptance: core **1107/64 files** (resource lifecycle **15**, task **9**,
SSR **11**, published resource type fixture **1**); framework **1316/57**; scaffold
**108/4**. Two generated Node production/browser cases pass, 12 others skipped.
Browser evidence covers zero hydration RPC, delayed old response after newer empty
result, failed load/retry, and live client navigation with pending read and one
cleanup. Native workerd staging/socket cases **2/2** pass; staging now includes
HTTP/SSE resource SSR keys, D1/request-user reads, private failures, selected
arguments, recovery and single refresh. Native resource checks run first for
useful failure feedback. Builds, root command and all 11 package typechecks pass.

Criterion mapping: initial/success/failure/retry/dependency/invalidation paths are
covered by controlled unit and browser tests; unmount by units and live navigation;
slow old result by controlled refresh and delayed browser response; names/results
by published declarations; SSR/no duplicate hydration by generated Node and native
Worker cases. RT-01's full boundary/deadline/concurrency gates remain separate.
RT-05 receives only the relevant cancellation fix; it does not close here.

<a id="rt-04"></a>
### RT-04: State, store, and computed diagnostics

Purpose: Authors need to know which mutations trigger rendering and which values
cross the server/browser boundary. Agents often confuse shallow state assignment
with nested store mutation.

Baseline: State containers, recursive store proxies, computed behavior, and
separate client-only fields exist. Guidance and contextual diagnostics need work.

Approach: Document the choice between `@State`, `@Store`, client-only state,
computed values, and `server$`. Add development diagnostics for unsupported
serialization and detectable ineffective nested mutations. Identify the owning
component and field. Preserve the selected semantics instead of silently turning
every object into a deep store. Reuse serialization rules from RT-01.

Start in core `shared/state-container.ts`, `store.ts`, `reactive-store.ts`,
`cossack.ts`, and `docs/states.md` and `docs/reactive-store.md`.

Done when: Examples demonstrate the expected update behavior for each mechanism.
Cycles and unsupported values produce useful paths. Client-only fields stay out
of SSR, RPC, and shared state. Tests cover nested objects, arrays, computed
dependencies, and development diagnostics without changing production semantics.

**RT-04 completion audit — Author: Codex (2026-10-03), after `abd80ad`.**

1. Mechanism guidance: states.md compares State, Store, ClientState, ClientStore,
   Computed, server$ and createStore. Full public-export TypeScript examples are
   compiled directly and inside a generated application. The state page runs
   in both consuming Vite development and production modes. Tests prove a shallow
   nested write changes raw data without rendering, replacement renders, nested
   array/object store writes render, computed totals recalculate on read, client
   drafts survive server actions, and resource dependencies load the next record.
   Computed supplies no cache/dependency graph. createStore uses Object.is and
   replacement notifications; connectStore subscription cleanup is verified.
2. Shallow diagnostics: State and ClientState retain shallow semantics. Stable
   development proxies warn once per field, naming owner, nested path and the
   correct Store/ClientStore replacement. Raw aliases unwrap on assignment;
   successful changed writes warn, while no-ops/missing deletes/failed frozen
   writes stay quiet. Original raw aliases still bypass observation.
3. Serialization diagnostics: a bounded read-only mode of the existing RT-01
   traversal identifies cycles, non-finite numbers, functions/symbols/bigints,
   invalid Dates, collections, binary and opaque native values. It logs paths
   and component/field/snapshot context without values. Repeated acyclic
   references, valid Dates and own-field models retain the canonical contract.
   Getters, custom toJSON and accessor object tags are not executed to diagnose
   unknown representations. Inspection has 10,000 visits and a 256-depth limit;
   silence does not certify validity. Real RPC serialization still owns errors
   and hook invocation. Do not substitute strict server$ JSON rules for state.
4. Inherited field contracts: collect each class's own declarations root-to-child.
   The child replaces the same field's complete public/client and shallow/deep
   kind, while parent siblings remain. Bootstrap, service state, legacy service
   forwarding, optimistic field discovery, channel validation and component/
   service request sanitizers use the same contract. Store channels are validated
   too. A client-only replacement cannot accept its parent's public overlay.
5. Boundary proof: SSR public snapshots exclude client/derived fields. Actual
   flat RPC request.state is checked, rather than a nonexistent state.public.
   Native Worker HTTP/SSE tests forge id/local overlays on a client-only child
   override and retain server initializers. HTTP accepts a public inherited
   overlay; SSE retains coordinator authority. Client Store edits survive native
   resource/action responses. Client-only fields still exist during SSR and can
   appear in rendered HTML or explicit RPC arguments; they are not secrets.
6. Production behavior: diagnostics do not normalize/reject writes or change
   snapshot values. Core's library build preserves the DEV decision for the
   consuming Vite app; optional env access keeps published direct Node imports
   safe. Production browser checks produce no Cossack diagnostic warnings.
   Direct Node imports without Vite disable these diagnostics.

Final checks: core **1147 tests /68 files**, framework **1316 /57**, core/framework
builds, root tsc and all **11** package type configs pass. Selected generated
browser cases are **3 passed /14 skipped of 17** (both state modes and the RT-05
task regression). Rebuilt native staging/socket are **2/2**, about 110 seconds.
No full CLI/monorepo/tarball/native Deno/Electron release gate is claimed.

The development browser fixture owns an explicit Node HTTP SSR test bridge
using Vite's real module graph. Plain generated Node Vite development returned
404 and is still an application/CLI integration gap; see REL-03 below. Production
uses the real generated server. Do not treat the test bridge as a CLI fix.

<a id="rt-05"></a>
### RT-05: Typed tasks and stale-work cancellation

Purpose: A task that loads results for an old search must not overwrite results
for the new search. Task dependencies and failures must also be understandable
without tracing framework internals.

Baseline: Task decorators and cleanup exist. Async cleanup is awaited where
required. Typed dependency contracts and cancellation of stale work remain open.

Approach: Give each task execution an identity and a cancellation signal. Cancel
the previous execution on dependency change or disposal. Gate result application
when external work cannot be canceled. Infer dependency tuple/path types from
the chosen declaration style. Report task name, component, dependency trigger,
and failure stage. Keep synchronous tasks synchronous when no async cleanup exists.

Start in `packages/core/src/shared/cossack.ts`, `decorators.ts`, and `docs/tasks.md`.
Reuse lifecycle cleanup and RT-01 cancellation concepts.

Done when: A controlled slow-first/fast-second test retains the second result.
Cleanup runs once, canceled work cannot update destroyed components, and rejected
cleanup does not skip other cleanup. Type tests reject unknown dependency fields.
Test rapid dependency changes, navigation, and service disposal.

**Codex ownership review (2026-10-03): still open.** Two new regressions first
failed because runTasks deleted the controller in setup's finally block. Both
sync and settled async subscriptions then retained signals that never aborted
on rerun/disposal. Controllers now stay owned until rerun or destroy. Destroy
aborts before application/descendant/service cleanup, and cleanup observes the
aborted signal exactly once. TaskMethod now includes the AbortSignal argument
and promise-returned cleanup. All nine task cancellation tests pass.

The above ownership review is historical. Its remaining work is completed by
this checkpoint; retain the settled execution identity.

**RT-05 completion audit — Author: Codex (2026-10-03), after `95b2dd4`.**

- Chosen declaration: `@Task<Host>({ track: [...] as const })`, also ServerTask/
  ClientTask. TaskDependencyPath checks public or explicitly supplied private
  dependency shapes, nested nullable objects and array indices/length, up to six
  segments. Methods are excluded. Without Host, paths remain untyped. Shape types
  do not prove runtime reactive decorators. Published fixtures reject unknown
  root/nested/array fields, methods and primitive method paths; inherited fields
  and readonly tuples pass without Vite. Final review also corrected null-only/
  undefined-only fields being misclassified as functions; both track and commit
  accept those fields, with published fixture coverage.
- Result gate: the second task argument is `TaskContext<Host>`. Its immutable
  identity/signal/trigger and `commit({ field: value })` allow synchronous whole
  reactive-field replacement only while this execution remains owned. Stale or
  disposed executions return false. Runtime patches reject callbacks/promises,
  classes, getters and nonreactive fields; all keys validate before assignments.
  Published fixtures reject unknown/readonly/method fields and invalid values.
  This is deliberately a patch API, not an arbitrary callback that could escape
  ownership through asynchronous work. No transaction or rollback is promised.
- Controlled slow-first/fast-second test resolves the new result first, then old
  ignored-cancellation I/O. Only the current context commits; disposal refuses
  another write and cannot restart tasks. Existing rapid-change cleanup queues
  still skip canceled starts. Synchronous setup/cleanup stays synchronous when no
  async cleanup exists; settled controllers stay owned.
- Setup/commit/cleanup diagnostics name component, task, dependency/bootstrap/
  render/disposal trigger and stage. Rejected cleanup drains both next setup and
  sibling cleanup. An owned ServiceScope test proves abort/cleanup completion
  before service disposal. Late uncancellable setup still releases its returned
  cleanup once; it cannot rely on an already disposed service.
- Review fixed inherited task loss: collect own metadata root-to-child; the child
  declaration replaces the same method's kind/dependencies before environment
  filtering. Parent siblings still run once. An undeclared override continues to
  inherit its registration.
- A generated Node production/browser app uses typed ClientTask/ServerTask and
  layout service injection. It proves rapid changes, stale refusal, sibling SPA
  navigation with retained service identity, layout exit with signals aborted
  before service disposal, and exactly one cleanup for settled/late setups.
  Generated tsc passes and private ServerTask sentinel is absent from client JS.

Verification: core **1115/65 files**, framework **1316/57**, all 11 package type
configs, root tsc, core/framework builds, generated browser **1 passed /14 skipped
of 15**, native staging/socket **2/2**. Task cancellation file has **16** cases.
Native cases are regressions for existing HTTP/SSE/socket/schema/resource behavior;
this phase does not add a standalone service-task engine or native Deno/Desktop
acceptance. Full release gates remain separate.

**Next for GLM — RT-04:** inspect existing State/ClientState/Store/ClientStore/
Computed behavior and the RT-01 wire normalizer before changing serialization.
Write a choice table and executable examples with whole-field vs nested writes,
arrays and computed invalidation. Build diagnostics that name component/field/
value path for cycles and unsupported values without changing production state
semantics. Verify client-only fields remain absent from SSR/RPC/shared snapshots,
including native SSE authoritative updates. Do not apply the stricter resource
JSON policy to all state as a shortcut. Keep browser filters ClientState and
preserve authoritative server snapshots. Complete the original criterion audit
before checking RT-04. Then proceed RT-06 and all other remaining task IDs.

<a id="rt-06"></a>
### RT-06: Optimistic updates and rollback

Purpose: An optimistic edit shows an expected result before the server replies.
If that edit fails, rollback must not erase newer user edits or another successful action.

Baseline: Optimistic locks and pending server state exist. The new RPC path
preserves some concurrent edits. Consistent rollback across transports remains open.

Approach: Track optimistic changes by action identity and affected fields.
Define how server state, local edits, and overlapping operations combine.
Revert only the failed operation's contribution. Do not restore an entire old
component snapshot. Distinguish confirmed failure from disconnect with uncertain
server completion. Refetch authoritative state when the outcome is unknown.

Start in core `shared/method-proxy.ts`, `transport-connections.ts`,
`cossack.ts`, and `docs/optimistic.md`.

Done when: Tests cover two overlapping edits to one field, edits to independent
fields, out-of-order responses, validation rejection, timeout, and disconnect.
Loading indicators settle once. State converges after reconnect without replaying
the mutation. Dependencies: RT-01, RT-05, and RT-19.

**Next implementation plan — Author: Codex (2026-10-03).**

RT-04 and RT-05 are complete. Start by tracing existing optimistic locks,
pending state and method settlement for component and explicit-service HTTP,
SSE and WebSocket paths. Reuse the shared inherited reactive field contract.
Write failing controlled tests before choosing the merge representation.

Each invocation needs its own identity, original affected values and ownership
of its optimistic contribution. Establish a baseline and ordered pending edits
so removing one failed operation retains later edits and successful operations.
Independent fields must remain independent. Prefer field-scoped records over
restoring an old whole-component snapshot. Document nested Store path behavior;
do not invent deep rollback guarantees without tests.

Test two edits to the same field, independent fields, a user edit after the
request, success/failure replies in both orders, parsed validation denial and
transport failures. Verify client-only fields participate only in local updates
and never enter the public overlay. Loading/error indicators must settle once.
Distinguish confirmed rejection from uncertain server completion on timeout or
disconnect. Reuse RT-19 uncertainty errors, then resync/refetch authoritative
state without replaying the mutation. Preserve native SSE server authority.
Add generated browser and native runtime acceptance before closing RT-06, with
the complete original criterion audit. Broader RT-01 deadlines remain open.

Also fix the Node development integration described under REL-03 before claiming
the final runtime matrix. Preserve all other unchecked IDs and release gates.

**Codex ownership continuation (2026-10-03), after `83ea5e4`: still open.**

Twenty initial controlled cases reproduced **17 failures**: rejected previews
were retained, a late older failure discarded newer confirmed data, same-method
calls shared one lock, nested Store changes were not captured, and optimistic
public values were sent back to HTTP/SSE actions. An increment could therefore
run once in the preview and again on a server that received the previewed value.

Core now holds per-target/per-call field layers. Each handler runs once. Plain
trees are detached before/after capture; success supplies an authoritative base,
failure removes that call's layer, and newer successful replies or later local
edits win on owned fields. Component/store and service setters record local
writes. Incoming uncorrelated completion messages cannot settle correlated calls.
Request state excludes pending previews but includes authored local public edits.
The shared RPC state applier retains canonical snapshot/stale-edit behavior and
supports explicit services without importing Cossack or Node facilities.

The chosen representation is a resulting whole-field value, not a delta/reducer.
Newer previews can include older preview data they read. Later nested local edits
protect the entire field. Native class/collection objects remain scalar references.
Do not claim arbitrary arithmetic/array-contribution rebasing or transaction
rollback from these tests. Async handlers are refused; partial synchronous writes
from errors/promises/over-depth snapshots are restored without preventing the
actual action dispatch. Local values beyond supported snapshot semantics still
need a careful audit before claiming a general guarantee.

Explicit scoped services now use this same handler/call ownership, confirmed
request state, filtered reply merging and loading settlement for every subscriber.
Their prior direct hydration could erase local edits. Handler metadata collects
own registrations root-to-child and retains inherited action siblings.
Subscriber loading now has its own per-call release; ambient completion cannot
settle it, duplicate subscriptions count once, and unsubscribed owners release
without another render. Later client-only values that cannot be detached stay
references with contextual diagnostics; per-field cleanup failures drain the
remaining fields and never block loading settlement. Unrelated full-state echoes
do not confirm or cancel a different field's preview.

Node and Deno previously sent a wrapped hydration state object on connection,
while the client expected a flat public record. Core's process runtime now exposes
getPublicState for adapters; both Node upgrade paths and Deno send that record.
Existing production/dev/HMR and adapter assertions now inspect actual flat state.
Cloudflare already uses flat connection snapshots. Native Deno execution remains
the separate REL-03 gate.

Coverage now includes rejection, overlap in both completion orders, independent
fields, later nested/user edits, local exclusion, timeout/cancel/disconnect, shared
service subscribers, throwing/promise handlers and inheritance. Actual generated
Node and native Worker HTTP/SSE pages hold an older invalid call until a newer
success arrives, retain the successful result after rejection, settle loading,
exclude previews from requests and retain a later public edit. Existing native
resource/Store/D1/schema/policy/stream/socket acceptance stays intact.

**Codex explicit-operation continuation (2026-10-03), after `231bcc1`:**

The contribution audit reproduced two failures: rejecting the older increment
and append retained both results, including when the newer client-only operation
already succeeded. Public `optimistic<Host>(target)` now records explicit
`increment`, `append` and first-structurally-equal `remove` operations during a
synchronous handler. The journal folds surviving entries in invocation order.
Successful local operations stay ordered until pending calls settle; public
confirmed replies replace operations at or below their sequence. A no-op removal
still records intent, so it applies if an earlier removal later fails.

A later local replacement is the base for subsequent relative operations.
A regression first lost that replacement on local success; cleanup now retains it.
Ordinary direct assignments remain absolute whole-field values. Do not infer
arithmetic intent from before/after numbers or replay application handlers.
No arithmetic/array guarantee is claimed for arbitrary direct nested writes.
Use explicit operations for contribution ownership. These are client state
operations, not database transactions or a server rollback protocol.

The helper owns one capture identity and rejects outside it, including during
another call's handler. It checks runtime reactive fields and copies finite plain
data before preview. Operations and direct assignment on one field in the same
handler reject and restore the capture. Assignments on other fields remain valid.
Use a concrete class argument inside methods because TypeScript cannot resolve
mapped field types for polymorphic this. Published declarations check writable
number/array fields, item shapes and negative cases; the guide has a complete
public-export example. Native values and later arbitrary user edits retain the
previous documented limits. This resolves remaining step 1 for the declared
operation contract, while the other original RT-06 criteria remain open.

A full generated browser run reproduced a late equal snapshot overwriting a
later local edit after settlement. The weak history now stores a confirmed value
only for fields with a surviving local edit. Equal ambient echoes are ignored
before ledger merging, including while another call is pending. Changed state
and explicit reads clear the field; socket/EventSource open and SSE resync reset
history while preserving active previews. Controlled and browser regressions
cover this correction. It compares values, not server revisions, so step 3 still
needs different late snapshots and actual native lost-response recovery.

**Codex authoritative-read continuation (2026-10-03), after `7cdb039`:**

Step 2 has a declared resource contract. `reconcile$(failure, ...names)` selects
known uncertain RpcError diagnostics and reads existing resources without retrying
writes. All target names bind before dispatch. Same failure object, target set
and current dependency identities share a promise. Binding is synchronous to
preserve the record selected at invocation. Dependency replacement and destruction
refuse obsolete completion. Read failures have their own error and remain cached.
Explicit refresh$ retries later. Public name/result declarations and the complete
[guide example](../docs/optimistic.md#handle-an-uncertain-result) compile.

Production Node/Chromium and native Worker/D1 acceptance prove both component
and injected-service writes commit before their replies are deliberately lost.
Each case sees one mutation, one read, convergence and loading zero. The same
matrix runs on HTTP and SSE pages after actual EventSource open. Those SSE actions
still use HTTP coordinator RPC. Native socket loss/reconnect is not certified.
RPC reconstruction previously performed an incidental render read plus the
selected action read. Synchronous nested render suppression fixes that duplication.
Native tests also exposed and corrected missing ORM context on the test app's
SSE authentication route. The review records intermediate failures and final proof.

The helper classifies diagnostics, not transaction outcomes. Arbitrary authored
errors after writes need an explicit read. It does not infer persisted records,
add independent deadlines, or stop ignored I/O. Recovered means the read completed
under its current resource ownership. Broader RT-01 gates remain separate.

**Codex native-socket continuation (2026-10-03), after `51bef75`:**

Native Chromium/workerd acceptance writes D1 before signaling a held action.
A test-only server endpoint closes the real socket before reply delivery.
Backend audit, client request IDs and captured terminal frames distinguish a
committed mutation from its lost reply. The same socket has two pending browser
calls in another case. One mutation commits and the queued invocation cancels
before execution. Both loading owners release exactly once. Actual DO eviction
closes any early replacement socket. A new connection restores persisted public
state and retains the client draft without dispatching a mutation again.

Post-yield component socket cases commit, then fail visibly or cancel explicitly.
They preserve persisted count/draft and settle loading. Native actor checks prove
u1 from handshake identity. The disposable app now installs ORM context on /ws/
before session validation. Native acceptance uses the published AppDurableObject
registry after its failing regression exposed package-demo lookup. That registry
now uses the same application page/layout keys as the router and rejects helper/
HTTP module exports. A separate browser asset audit found binding-only API SQL.
Functional handler modules now become export-compatible throwing stubs before
private dependencies enter the client graph. SSR stays original.

[Exact evidence and intermediate corrections](./release-0.9.0.md#codex-optimistic-socket-2026-10-03)
record the final commands. These cases advance step 3 and the native component
part of step 4. They do not close SSE resync/different late snapshots, retained
layout/service consumers or optimistic stream acceptance on remaining transports.
Native cancellation is not server transaction rollback. Preserve this distinction.

**Codex retained-consumer continuation (2026-10-03), after `43c189a`:**

Initial controlled tests failed 6/8. New consumers missed pending loading counts.
Consumers of another declared service inherited unrelated action counts.
Each scope now tracks active invocations by service declaration. Each invocation
records one release per consumer. A late subscription attaches to matching work,
including work that started without subscribers. Duplicate injection and rejoin
retain one count. Shadowed scopes retain independent instances and ownership.
Component and service calls with the same action name keep separate contributions.
Exited consumers release on settlement without another render.

The production Node recipe test holds service actions during sibling navigation.
It covers both success and rejection with retained layout and new nested consumers.
The shared recovery fixture consumes a real committed service response before
holding browser delivery. New consumers subscribe before that reply settles.
A later real input rejection removes only its preview after return navigation.
Backend counts distinguish one committed action from the rejected action.
These explicit service actions use HTTP on HTTP and genuinely connected SSE pages.
They do not establish SSE resync delivery, transaction rollback or layout-exit
cancellation. Preserve those limits when evaluating remaining criteria.
Read the [evidence](./release-0.9.0.md#codex-retained-service-loading-2026-10-03).

**Required next work, before RT-06 can close:**

1. Contribution semantics: implemented for the explicit increment/append/remove
   contract above. Direct assignments remain absolute whole-field values. Preserve
   all original rollback tests and limitations in the final criterion audit.
2. Authoritative uncertain HTTP/service reads: implemented through declared
   resources above. Preserve committed/lost-response acceptance and zero repeated
   mutation dispatches. Recovery reads do not establish transactional rollback.
3. Native component socket loss/reconnect, eviction, queued cancellation and
   multiple pending calls pass. Actual SSE resync now passes after native response
   EOF, EventSource reconnect and expired coordinator history. Different snapshots
   before/after a held committed reply preserve newer authority. Controlled tests
   cover coalesced publications and same-value higher revisions; production Node
   verifies real SSE ordering. Retained layouts and late service consumers retain
   their ownership acceptance. Audit all original combinations before closure.
   Preserve public snapshot authority and ClientState/ClientStore drafts. Pending
   user edits retain ownership; a higher SSE revision after settlement is authority.
   Node process IDs do not prove durability or cross-process generation ordering.
4. Native component socket and SSE post-yield failure/cancellation now pass.
   Production Node SSE post-yield failure passes. Controlled malformed SSE cursor
   replies/frames settle loading once, but do not complete every malformed payload
   case. Finish optimistic malformed replies, post-yield errors and cancellation/
   cleanup across remaining HTTP and explicit-service streams, with indicators
   settling once. Keep RT-01's
   broader boundary and actual incoming disconnect gates separate. Add a published full example
   for the final API, then audit every original RT-06 done criterion.

Read the [latest phase evidence](./release-0.9.0.md#codex-optimistic-sse-ordering-2026-10-03)
and updated [optimistic guide](../docs/optimistic.md). No checkbox closes here.
Continue all other unchecked tasks, including the Node CLI dev gap, afterward.

**Codex completion audit (2026-10-03), after `0272cba`.**

The original RT-06 scope is complete for the documented explicit optimistic
operation/whole-field contract. This audit supersedes the preceding remaining-work
list; historical checkpoints retain the gaps that existed at those commits.
Read the [completion review](./release-0.9.0.md#codex-optimistic-completion-2026-10-03).

| Original requirement | Authoritative evidence | Result |
| --- | --- | --- |
| Two overlapping edits to one field | Core optimistic-concurrency and optimistic-operations tests cover HTTP/SSE/WS completion orders, contribution removal and scoped services. Production Node and native resource acceptance holds older invalid calls while newer success completes. | Complete. Only the failed call's owned contribution is removed. |
| Independent fields | Component transport matrix retains the other pending field. New explicit-service streams confirm count while title remains pending/rejects, including a later local edit. | Complete. Confirmed count and surviving title ownership remain independent. |
| Out-of-order replies | Core transport/service ownership cases retain newer success when older success/rejection arrives last. SSE cursor tests and real Node/native publications prevent delayed older replies from replacing newer state. | Complete. Late calls still return their own results. |
| Validation rejection | Real input-schema rejection in browser/native resource and retained-service acceptance performs no invalid write. Controlled structured errors preserve correlation and rollback. | Complete. A confirmed guard rejection stays distinct from uncertain completion. |
| Timeout | HTTP/SSE/WS optimistic-concurrency tests and new component/service streams cover deadlines before headers and after confirmed yields. Held request producers deliberately ignore abort; late bodies cannot hydrate. | Complete for client deadlines. Arbitrary server execution deadlines remain RT-01. |
| Disconnect and uncertainty | Real committed/lost component/service HTTP replies on HTTP/open SSE pages recover through declared resources. Native socket close after D1 commit, actual DO eviction and queued cancellation retain uncertainty and persisted writes. | Complete. No rollback or mutation retry is inferred. |
| Loading settles once | Existing per-call/loading/navigation tests plus 32 new stream cases cover repeated cancel/result reads, before-iteration cancellation, late consumers and independent calls. Browser/native layout/page/nested indicators settle together. | Complete. Terminal cleanup and explicit cancellation are idempotent. |
| State converges after reconnect without mutation replay | Native socket recovery uses a new connection after actual eviction. Native EventSource reconnect follows real response EOF and 130 coordinator publications exceed history, requiring resync. D1 audit and browser dispatch counts remain exact. | Complete. Client-only drafts survive; public snapshots restore authority. |
| Remaining stream and explicit-service acceptance from the implementation plan | A shared 25-case production Node/native Worker browser matrix covers post-yield error/cancel/malformed JSON/truncation/trailing terminal frames. Component HTTP/SSE and service calls on HTTP/open SSE/open socket pages use actual production dispatch. Core also covers wrong request IDs and deadlines. | Complete. Service proxies use HTTP regardless of page transport. Native component socket streams retain their earlier error/cancellation acceptance. |
| Complete published example | The optimistic-stream page/private-store files compile through published declarations. The shared fixture copies the exact page into generated apps; native D1 uses the exact parameterized SQL helper. Actual controls exercise success, authored post-write failure and cancel/read convergence without retry. | Complete. Node substitutes only the persistence provider; no native Deno/Electron claim. |

The synchronous helper contract supports finite increment and detached plain-data
append/remove operations. Direct assignments remain absolute field values. Arbitrary
nested/native mutations do not gain inferred contribution semantics. Tests and the
guide preserve those deliberate contracts instead of claiming transaction rollback.
RT-05 lifecycle and RT-19 connection state/recovery remain intact. Broader RT-01
initialization/incoming-disconnect/server-execution, RT-11 session and REL-03 runtime
gates remain separate. Node plain Vite development routing still returns 404.

**Next for GLM — RT-07:** start with the compiler's route registration model,
route-ids.ts, vite-plugin.ts and router.ts before extending CLI AST inspection.
Generate URL/parameter types from that model; cover missing/extra/wrong parameters,
route groups, aliases and catch-alls through public declarations and actual handlers.
Then define explicit API input/output schemas and a compiler-backed effective manifest
whose middleware order, layouts and error/404 boundaries match execution. Extend the existing CLI-04 inspection from
the same effective metadata. Do not infer runtime validation from TypeScript alone. Follow
the original RT-07 plan below and continue every other unchecked task/release gate.

<a id="rt-07"></a>
### RT-07: Typed routes and effective route metadata

Codex inheritance regression follow-up (2026-10-03): decorated pages that inherit
render() now use SSR rather than returning API 405. API method lookup searches
authored ancestors, stops before Cossack defaults, honors overrides and does not
invoke accessors. Generated Node/native workerd tests exercise inherited GET/POST
and inherited page/layout navigation. See the
[verification](./release-0.9.0.md#codex-route-inheritance-2026-10-03).


Purpose: Route construction must catch missing parameters before a request.
Inspection must show the layouts, middleware, transport, error boundary, and
SSG settings that actually apply to a route.

Baseline: File routing, source ancestry helpers, and catch-all translation exist.
Generated route/API types and unified effective metadata remain open.

Approach: Build a route manifest from the same compiler model used to register
routes. Generate parameter types and a URL builder from it. Represent route
groups, dynamic segments, catch-alls, methods, and inherited policies explicitly.
For API schemas, use declared input/output contracts. Do not claim runtime
validation merely because TypeScript inferred a type. Keep source locations.

Start in framework `route-ids.ts`, `vite-plugin.ts`, `router.ts`, and
`api-handler.ts`, plus CLI `commands/routes.js`.

Done when: Generated URLs reach the expected handlers. Missing, extra, and
incorrect parameters fail type tests. Manifest middleware order matches actual
execution. Fixtures cover aliases, route groups, catch-alls, API routes, and
nearest error/404 boundaries. CLI-04 consumes this same manifest.


**Codex completion audit (2026-10-03): source boundaries finish RT-07.**
Author: Codex. Continued after `b82ba4b`. Read the
[final evidence](./release-0.9.0.md#codex-route-boundaries-2026-10-03),
[boundary guide](../docs/routing.md#unknown-urls-and-boundary-identity), and
[migration notes](./migration-0.9.0.md#file-routes-and-boundary-identities).
The checkpoints below record earlier partial states. This audit supersedes their
remaining RT-07 steps. All other task IDs and release gates remain in scope.

The new generated Node fixture first reproduced the grouped/dynamic failure.
`/users/%E9%9B%AA%2Fa/missing` selected the root 404 and omitted component middleware.
The router derived a fictitious source path from that public URL. The new pure
resolver compiles effective source prefixes once at application construction.
It selects the longest match, literal/parameter/catch-all specificity, and fewer
groups. Equally ranked disjoint groups use their common source ancestor.
Explicit 404 namespaces can own prefixes without an ordinary page. Matching
parameters reach component middleware and request-local helpers through the
same context. Malformed escapes stay in the owning guarded scope.

Route discovery retains every source-specific 404/error component. They have
unique component IDs and remain excluded from public route maps and builders.
SSR carries the exact source and a reserved boundary marker. Client hydration
and navigation select that component rather than another group's `/404` class.
404/500 navigation documents require matching status, type, ID and known source.
Accepted boundaries retain HTTP status and do not enter the success cache.
Plain, mismatched or unknown-module error documents still fail navigation.

Boundary rendering uses actual PageOptions and layout/page middleware.
Request-owned source/index tokens prevent duplicate execution after normal
routing or asset fallthrough. Separate declarations of the same function remain
separate policies. Short-circuit guards and after-next headers survive. A page's
error boundary adds its own policies while preserving entered page policies.
Global bootstrap middleware remains owned by the original request.

PageOptions.route had no registration implementation or in-repository callers.
Alpha removal is explicit: published types reject it, JavaScript decorators
reject it with a fixed diagnostic, and compiler inspection reports it without executing
its value. File placement defines the URL. This does not remove supported
import aliases or default-export aliases. CLI explanations now accept exact
boundary source files and reject a public boundary alias with candidate sources.

| Original RT-07 criterion | Completion evidence | Result |
| --- | --- | --- |
| Generated URLs reach expected handlers | Prior generated Node/browser fixture executes alias, group, dynamic, catch-all and both API styles. Native declared API acceptance executes actual Node/workerd handlers with D1 mutation checks. | Complete for this task. |
| Missing, extra and incorrect parameters fail type tests | Published core route fixture, generated virtual import negatives and native API contract types. The public route fixture now also rejects two removed PageOptions.route declarations. | Complete. |
| Manifest middleware order matches actual execution | Vite manifest equals CLI. New production Node/workerd boundary states match source IDs, layout/page counts and source stacks. Exact headers prove global/layout/page ownership, error fallback, unsupported methods and guard short-circuiting. | Complete. |
| Aliases, groups, catch-alls, APIs and nearest boundaries | Prior route/API acceptance plus nine unknown URLs per runtime, disjoint groups, direct shadowing, literal precedence, catch-all parameters, private denial, error 500, and real browser hydration/navigation/history. Seventeen resolver cases cover remaining source selection rules. | Complete. |
| Effective transport, error and SSG inspection | Shared compiler facts and existing scan-routes tests report transport/SSG and unresolved expressions. Executed inspection-service SSG acceptance shares source layouts, IDs, service state and disposal with inspection. Both remain in the passing regression suites. | Complete. |
| CLI-04 consumes the same manifest | Shared Node discovery/pure route identities feed generation and inspection. Real application comparison and source-boundary explanations pass. Dynamic executable facts remain unknown. | Complete. |

This audit closes RT-07 only. Incoming native disconnect delivery, arbitrary
RPC deadlines and initialization concurrency remain RT-01. Session guarantees
remain RT-11. Plain Node Vite development and native Deno/Electron acceptance
remain separate runtime/release gates. Versions stay 0.8.3 until REL-04.

Next for GLM: continue RT-08 from its original plan below and the concrete
starting steps beside it. Preserve all 36 other unchecked tasks. RT-09 still
owns bounded navigation completion and diagnostics. Do not label its partial
implementation complete because boundary navigation now works.

**Previous Codex implementation checkpoint (2026-10-03): native API contracts are implemented.**
Author: Codex. Continued after `7f4ce93`. This completes the native contract
portion of the previous seven-step continuation, not the full RT-07 task.
See [the API guide](../docs/api-routes.md#declared-input-and-output) and
[verification](./release-0.9.0.md#codex-api-contracts-2026-10-03).

The portable framework `/api` entry owns `defineApi`, `ApiHandler`, `ApiInput`,
`ApiRawInput`, `ApiOutput` and `ApiMethods`. It reuses core schemas and snapshots.
Input location keys are explicit: params, query, body. Handler and authorizer
receive inferred parsed input, Hono context and an owned signal. JSON handlers
return the output schema's parsed type; wire output uses `RpcSerialized`.
Native mode omits output and requires Response. Class API methods need an
explicit wrapper call with their context; @Server metadata does not guard
ordinary native calls automatically.

Runtime order is parsing, authorizing, running the handler, validating output,
then serializing JSON. Invalid input invokes neither authorizer nor handler.
False authorization and existing auth markers have fixed public denials.
Controlled handler ClientVisibleError/HTTPException retain their public behavior.
Unexpected input callbacks, authorizer errors and output failures remain private
500 errors. Expected schema failures use location-prefixed fieldErrors, stable
codes and a matching request ID header. Output failures never look like input
validation failures. A native Response cannot bypass a JSON schema.

Declared JSON bodies accept JSON/+json media, use fatal UTF-8 and actual stream
byte bounds (1 MiB default, configurable up to 16 MiB). A growable bounded buffer
avoids collecting unbounded chunk metadata. The reader cancels and releases its
lock even when underlying cancellation never completes. Optional absent bodies
parse undefined. Undeclared bodies remain native application input. Query keys
are strings; repeated scalar keys reject. queryArrays lists inferred array keys,
keeps singleton arrays and leaves absent optional arrays absent. Encoded query
text is bounded to 64 KiB and 1,024 pairs.

The default asynchronous deadline is 10 seconds, configurable up to five minutes.
It links request cancellation through schema parsing, auth, handler and output.
Ignored callbacks stop retaining framework waits; eventual rejections are
observed and late response bodies cancelled. This does not interrupt synchronous
code, terminate ignored I/O or reverse committed writes. After native response
headers, the application owns stream lifetime. Use the original request signal
for body cancellation. Core schema limits still bound nodes/depth/items.

The AST classifier recognizes canonical `/api` factory import aliases, namespace
imports, const aliases/TS wrappers and default export aliases. Named handlers
may export helper classes. Compiler facts use native default precedence and
source lines. Dynamic/spread declarations remain unknown. Inspection does not
execute imports, schemas, guards or handlers. The security load hook stubs a
factory default before its private initializer/dependency graph loads.

Generated routes retain the existing discovered structural model. ApiRoutes,
ApiRequest and ApiResponse refer to actual API exports through type-only module
queries. These vanish from runtime output. Named method inference and default
`'*'` precedence follow the router. Plain handlers have unknown contracts;
default classes do not pretend ignored named native handlers execute. These
are declarations, not a generated network client. Keep browser fetch input
construction separate from runtime schema enforcement.

| Previous continuation step | Current evidence | Status |
| --- | --- | --- |
| 1. Explicit native schemas and parsed types | Published `/api` entry, location/type checks, raw/parsed/wire inference. | Implemented. |
| 2. Gates and owned cancellation | 29 controlled cases cover malformed/unknown fields, coercion, media/byte/query bounds, all callback phases, private output errors, native response cookies/redirects/streams and abort/deadlines. Actual Node/workerd requests pass. D1 proves zero invalid/unauthorized mutations. | Implemented for the native contract. Incoming adapter disconnect delivery remains RT-01/CF-10 work. |
| 3. Shared compiler facts and stripping | 16 AST/security cases, CLI facts, actual production assets without private markers or SQL. No user module execution. | Implemented for canonical local declarations; dynamic/transitive facts remain unknown. |
| 4. Generated API and published types | Published negative type fixture and both generated app type checks; actual grouped/dynamic native APIs execute and compare CLI facts. | Implemented. |
| 5. Unknown grouped/dynamic URL boundaries | Previous source-ancestry/root404 proof remains valid. The router still reconstructs source paths from public unknown URLs. | Still open. |
| 6. PageOptions.route | Declaration still unused by registration. Default/decorator export aliases are separately proven. | Still open. |
| 7. Original task/release audit | All 58 IDs and checkbox states preserved. | Still open. |

**Next steps for GLM:**

1. Reproduce unknown URLs beneath `(group)/users/[id]` and a deeper group boundary
   in real generated Node and native Worker requests. Include competing source
   groups, literal/dynamic precedence, the root fallback, expected HTTP status
   and global/component middleware ownership. Fix selection using shared route
   metadata rather than pretending a public URL reconstructs its source file.
   Keep error-page selection and CLI source ancestry aligned. Add browser parity
   where client navigation owns the same decision.
2. Resolve PageOptions.route explicitly. Removal is appropriate in alpha if the
   option has never worked: remove its public declaration, identify all in-repo
   callers, give migration guidance and published negative typing. If aliases
   are retained, implement registration, client matching, RPC identities, SSG
   and generation together, with actual acceptance. Do not check an alias task
   merely because a default export/decorator import alias works.
3. Audit every original RT-07 criterion, update the evidence table and only then
   close that checkbox. Preserve all other unchecked tasks and REL gates. No
   release bump until REL-04. Continue the original framework/agent/Cloudflare
   objective; this checkpoint does not narrow it to API schemas.

**Codex implementation checkpoint (2026-10-03): path generation is implemented.**
This is partial RT-07 completion. No release checkbox changes here. Core owns
`createRouteBuilder`, `RouteParameters`, `routeParameters` and `RouteUrlError`
at its portable `/routes` entry. Framework `route-ids` owns structural descriptors.
Its Node-only `route-codegen` owns discovery and `.cossack/routes.ts` emission.
The Vite plugin and CLI consume that same model. The generated module imports
only public path patterns and the pure helper.

The route identity is the bracket-form public path. Groups do not change it.
Ordinary values are strings. Catch-all values are nonempty segment tuples.
Arguments retain their authored shape before checks, so a union cannot hide
an extra key. Narrow union route names. Author manual registries with literal
patterns. Widened strings and selected pattern unions cannot establish one
parameter contract. Runtime checks reject unsupported patterns, extra/missing
keys, accessors, sparse arrays, dot segments and invalid Unicode.

`virtual:cossack-routes` resolves to a real generated TypeScript file. It needs
no permissive ambient declaration that widens names to strings. New recipes
provide the path mapping, ignore the generated file and generate before type
checking. Existing apps use `cossack routes --generate` plus the mapping in
[routing docs](../docs/routing.md#typed-urls). CLI generation stays local and
does not execute Vite. Custom Markdown processors require explicit CLI selection.
Vite root now controls generation, warnings and emitted manifests. Watchers
refresh file additions/deletions and remove their listeners at shutdown.

The generated Node entry now delegates requests after static assets. Hono's
route mounting copied handlers but discarded the framework's custom not-found
handler. The production fixture failed with plain `404 Not Found` before the
fix and renders the authored boundary afterward. Do not reintroduce mounting
without preserving that behavior and single framework request ownership.
Functional API selection also uses the public route pattern. A source-path
check rejected API files inside route groups. Router registration, capability
checks and CLI inspection now share that classification.

| Original RT-07 criterion | Evidence at this checkpoint | Remaining work |
| --- | --- | --- |
| Generated URLs reach handlers | Production Node/browser navigation executes aliased default/decorator components, grouped/dynamic/catch-all pages and functional/class-init APIs. Unicode, encoded slashes and reserved characters survive. | Add explicit native Worker acceptance for the final API contract. No new native typed-API claim here. |
| Missing, extra and wrong parameters fail types | Published package export and generated virtual import have negative cases. Variable/union extras and empty catch-alls reject. | Keep final API input/output declarations in the same published-type acceptance. |
| Middleware order matches execution | Generated manifest equals CLI manifest. Root/group/page source counts match the browser's executed trace. Functional handlers inspect with no component layouts. | Preserve global middleware, unknown policies and final native API guard order. |
| Aliases, groups, catch-alls, APIs and boundaries | Default/decorator aliases and API styles execute. The nearest grouped error boundary and root 404 render through production Node. Structural nearest source boundaries and group collision selection have controlled cases. | Add unknown-URL 404 acceptance under grouped/dynamic ancestry before closing the full boundary claim. |
| CLI-04 consumes the manifest | CLI discovery/conversion/ancestry duplicates are removed. Generation, inspection and Vite compare equal in the actual app. Read-only/dry-run/flag checks pass. | Extend this model with declared API method/schema facts. Keep uncertain facts explicit. |

**Next implementation steps for GLM:**

1. Declare native API input and output contracts. Decide their request-body,
   path and query locations explicitly. Reuse core schema parsing, depth/size
   bounds and existing public error mapping. TypeScript types alone do not run
   validation. Do not assume `@Server` guards wrap authored native API calls.
2. Run parsing and authorization before handler work. Define malformed input,
   unauthorized requests, callback failures, output validation and cancellation.
   Preserve Hono `Response`, cookies, redirects and middleware ownership.
   Expected input failures must cause zero handler mutations. Unexpected schema
   callbacks and output failures must retain private server diagnostics.
3. Teach the shared compiler classifier and inspection about the chosen API
   declaration. Follow aliases and static declarations without importing user
   modules. Keep private schemas/initializers out of client chunks. A factory
   export must not evade functional-handler stripping because it is a call
   expression instead of a function expression. Report dynamic contracts unknown.
4. Generate API method/input/output declarations from those facts. Keep URL
   names, IDs and source locations in this existing model. Add package-export
   negative type cases and real generated Node/native Worker requests. Prove
   that runtime validators run and compare effective middleware execution.
5. Audit nearest not-found behavior for unknown URLs under route groups and
   dynamic directories. The current router synthesizes a source path from the
   public pathname. That path cannot reconstruct omitted groups or `[id]` names.
   Add actual grouped/dynamic 404 acceptance, then align selection and inspection.
   Structural source ancestry alone does not establish unknown-URL behavior.
6. Resolve `PageOptions.route`. It currently does not register an alias. Either
   remove that unused declaration with migration guidance or implement aliases
   across SSR, client matching, RPC, SSG and generation. The current acceptance
   proves decorator/default-export aliases, not authored alternate URL paths.
7. Re-audit every original criterion before checking RT-07. Continue all other
   unchecked tasks afterward. Keep versions at 0.8.3 until REL-04.


<a id="rt-08"></a>
### RT-08: Typed URL state

Codex criterion audit (2026-10-04): the original URL-state requirements now have
implementation and acceptance evidence. Earlier checkpoint next steps below are
historical. Use this audit and the current handoff for continuation.

| Requirement | Evidence |
| --- | --- |
| Inferred declarations, parsing, serialization, defaults and invalid values | Core `shared/url-state.ts`, `url-state.test.ts` and published-export `url-state-types.test.ts` cover typed patches, immutable values, invalid integers and default omission/inclusion. |
| Empty values, repeated scalars, arrays, Unicode and unrelated keys | Portable codec tests distinguish empty arrays/items, reject repeated scalars and malformed encoding, and preserve unrelated query bytes/fragments. |
| Push/replace and browser back/forward | The production Node/workerd URL fixture checks entry lengths, replacement metadata, restored values/results, guards and failed traversals. The same-URL fixture checks entry identity during interrupted restoration/confirmation. |
| Copied URLs and SSR/hydration parity | A second browser tab reproduces Unicode search, sort, tags and pagination. Invalid page zero uses page one. Page/layout backend counters prove SSR reads and no duplicate hydration reads. |
| Resources and rapid changes | Pending patches merge while committed reads remain stable. Exact backend counts cover coalesced updates, stale responses, cache, rollback and retained layouts. Native ownership fixtures cover changed user, scope, parent, runtime and providers. |

RT-03 and RT-07 are complete. RT-09 is audited separately below. See the
[final navigation verification](./release-0.9.0.md#codex-navigation-acceptance-2026-10-04).

Codex backend-read acceptance (2026-10-03): the production URL-state fixture now
uses an actual counting HTTP backend for page and retained-layout resources.
Node and native workerd each read page/layout once per fresh SSR document.
Matching hydration, cached back/forward, guards, failed network interception,
rollback and late response release add no backend reads. Exact assertions also
cover query replacement, copied URLs, invalid query defaults, coalesced rapid
updates, held SSR, uncached traversal and leaving/returning to the route.

The backend count is independent of browser RPC logs and rendered output. The
held request finishes its backend work before its SSR response is delayed, so
that work is counted even when navigation is superseded. This proves neither
backend cancellation nor database-specific caching. Extend the same counter
assertions to the remaining provider/runtime/transport ownership and same-URL
history interruption cases. See the
[verification](./release-0.9.0.md#codex-url-backend-reads-2026-10-03).


Purpose: Search, sorting, filters, and pagination need shareable URLs. Repeated
ad hoc parsing causes disagreement between SSR, browser navigation, and back/forward.

Baseline: Routing and navigation exist. A typed URL-state abstraction remains open.

Approach: Declare query keys with parsing, serialization, defaults, and invalid-value
behavior. Infer the application type from that declaration. Support explicit push
or replace history behavior. Define empty values, repeated keys, arrays, and
unrelated query preservation. Expose the same parsed state during SSR and hydration.
Integrate dependency changes with server resources without duplicate fetches.

Start in core `client/navigation.ts`, framework `client/app.ts`, and route
metadata from RT-07. Keep this separate from path-parameter generation.

Codex implementation checkpoint (2026-10-03): portable query contracts.
Author: Codex. Continued after `25eab9c`. This is progress on RT-08, not its
completion. Read the [public guide](../docs/url-state.md) and
[verification](./release-0.9.0.md#codex-url-state-contracts-2026-10-03).

Core exports defineUrlState, url codecs, InferUrlState and UrlStateError through
its root and portable `/url-state` entry. Declarations infer readonly records.
Codecs support strings, finite decimals, safe integers, literal enums, booleans,
repeated scalar arrays, optional values and explicit synchronous custom codecs.
Missing or invalid field values use declared defaults. Scalar repeats reject
selection even when equal. One invalid array item resets the field. Malformed
encoding has a separate issue. Read issues contain field/code, not raw values.
Unexpected callbacks throw fixed diagnostics. Unsupported promises remain
observed without becoming asynchronous parsing.

URL construction checks inferred patches, rejects variable/union extras and
snapshots arrays without reading item getters. It normalizes declared keys,
omits defaults by default and preserves unrelated encoded pairs/fragments.
Undefined resets a field. A bare array key represents an empty list, distinct
from one empty string. Parsing never edits the address. Limits bound total
query text/pairs, declaration fields, strings and arrays. Read/write limits
share the exact boundary. Definitions/defaults and parsed records are immutable.
The published custom codec uses NoInfer on serializer parameters so String
cannot erase default/parser constraints to any.

Cossack.urlState reads and caches a declaration against the current context URL.
Use it in getters or after bootstrap. SSR emits the public path/query without
an internal origin. Browser contexts previously read window.location while the
new destination booted before history changed. They now own the resolved URL.
Initial App/page/layout hydration retains the visible fragment. Retained layouts
receive the new destination through updatePath. Existing native req.query reads
use that same destination. NavigateOptions.history supports push/replace through
the existing navigation sequence and preserves unrelated history state.

The new production fixture declares a filtered list with a server$ resource.
Actual Node and native workerd browsers copy Unicode/array URLs into a new tab,
exercise invalid page defaults, back/forward, replace and fragments, and perform
zero extra hydration RPCs for matching SSR dependency arguments. It does not
prove retained-layout resource handoff, draft preservation or stalled/overlapping
query transitions. Those requirements remain below.

| Original RT-08 criterion | Current evidence | Status |
| --- | --- | --- |
| Copied filtered URLs show identical state | Production Node/workerd SSR and two tabs have equal query/resource output. Copied tabs receive no browser draft state. | Implemented for page/layout fixture. |
| Back/forward restores filters and results | Both production browsers restore filters/resources and declared drafts during ordinary and pending back/replace/forward, guarded confirmation and failed traversal. | Extend to staged user bootstrap and interrupted history restoration. |
| Invalid numbers and predictable defaults | Pure read/write cases and real invalid page URLs reset to documented defaults. Explicit empty arrays and canonicalization pass. | Implemented. |
| Browser history, SSR parity and Unicode | Owned destination contexts and push/replace pass unit and production acceptance. | Extend to staged commits and changed ownership. |
| Rapid changes and resource integration | Typed pending patches merge; guards/failures/disposal clear intent; local drafts survive; retained layout SSR entries avoid extra RPCs; delayed old responses/results cannot overwrite newer data. | Incomplete: pending history, nested/changed owners, actual backend read counts and bounded completion remain. |


Codex continuation (2026-10-03): query ownership, drafts and retained resources.
Author: Codex. Continued after `c133495`. See the
[verification checkpoint](./release-0.9.0.md#codex-query-ownership-2026-10-03).
RT-08 remains open. The 58 original task IDs remain unchanged: 22 checked,
36 unchecked. Earlier evidence above describes the previous checkpoint.

The first three implementation steps now have concrete implementations:

1. **Typed updater and pending intent.** `Cossack.updateUrlState` accepts an exact
   inferred patch and existing NavigateOptions, then delegates to the framework
   navigation owner. That owner merges against the latest live pending intent.
   Different declarations preserve unrelated keys; later values replace earlier
   values for the same key. Committed reads/address remain unchanged while fetching.
   Matching cleanup clears only its own intent. Ordinary navigation clears query
   intent. A disposed owner's patch cannot enter a live layout's next update.
   Controlled framework tests cover overlaps, late responses, stale source URLs,
   guards, failures and disposal. Published types reject incorrect values and
   literal/variable/union extras.
2. **Local page drafts.** The page still recreates on navigation. For the same
   file, public pathname, class and service/user/transport/provider ownership,
   the framework captures inherited declared ClientState/ClientStore raw values
   in an opaque single-use local capability. Only the matching class can consume
   it before bootstrap. Remote internal JSON and copied tokens cannot supply
   drafts. Fresh proxies belong to the new page. File identity survives. Public
   fields still hydrate from SSR. Query loading does not destroy the editable
   outgoing page. Unrelated pages and changed ownership receive new drafts.
   DOM file-input values are not restored; applications retain their declared
   File state explicitly.
3. **Retained layout resource handoff.** Each retained App/layout replaces its
   resource entry map with the new SSR data before updating its URL/parameters.
   Matching dependency keys avoid duplicate RPCs. Older pending entries cannot
   publish values or errors into the new map. Browser drafts and layout services
   are preserved. A changed parent scope or serialized user/runtime/layout-transport/
   scope/provider identity recreates the layout and its descendants. A child page
   changing between HTTP and SSE does not change its retained layout's transport
   or cancel that layout's pending service calls. The page
   module resolves before changing these owners. This does not make all module,
   bootstrap or transition failures atomic, and it does not stop application I/O.

Both generated Node and native workerd browsers now verify page, layout and
layout-service drafts, declared File state, copied-tab isolation, unrelated-page
reset, back/forward and replace, rapid patches, prevented navigation and failed
fetches. A controlled actual SSR response stays held while the draft is edited;
newer query data commits first and the old response is discarded. Matching page
and retained-layout resources issue zero extra /crpc requests. Core tests also
settle an obsolete resource successfully and exceptionally after the handoff.

Codex continuation (2026-10-03): pending history and module preflight.
Author: Codex. Continued after `f53961e`. See the
[verification](./release-0.9.0.md#codex-pending-history-2026-10-03).
RT-08 and RT-09 remain open; no checklist state changes.

Framework history entries now carry a private app group and position while
preserving scroll and application state. Guards run after browser back/forward
activates a destination. A blocked traversal moves back to the committed entry
without fetching or repeating the guard. Confirmation resumes the original
entry, bypassing that guard once and creating no new entry. Failed fetches or
module imports restore the entry before reporting the error. Unknown/overwritten
positions are not inferred. A missing restoration event fails after two seconds
with COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED. This bounds only history movement.

All requested page/layout modules resolve before live URL/resource/context
changes or window.__INITIAL_STATE__ publication. Superseded imports fail their
sequence check without creating a stale layout/page. Superseded bootstrap cannot
perform the final framework render. Arbitrary user bootstrap and renderer side
effects are still not atomic, and a stalled bootstrap can hold the commit queue.

Both production Node and native workerd browsers now cover guarded back,
confirmation of the same entry, preserved foreign history data, a failed back
fetch, and back/replace/forward while an old actual SSR response stays held.
Page, File, layout and service drafts survive. Later query patches use the
restored query and exclude the abandoned pending field. Matching resources still
make zero extra hydration RPCs. Controlled cases also delay page/layout imports
and bound a missing history event. The public guard guide records the contract.

Codex staging update (2026-10-03): the
[RT-09 checkpoint](#rt-09) now supplies prepared page/layout ownership and a
30-second navigation wait budget. The newer-navigation-before-old-bootstrap
regression passes. Latest matching drafts transfer at publication, before tasks
and mount hooks. The later render-recovery checkpoint restores framework-owned
state before history commit. Next cover nested state after partial DOM teardown
and interrupted history. The draft isolation checkpoint resolves plain raw-target
sharing with disposed owners; opaque native/class capabilities retain identity.

**Next steps for GLM, in order:**

1. **Pending history and staged commit acceptance (RT-08/RT-09).** The ordinary
   pending back/forward/replace, guarded confirmation, failed back
   fetch and delayed module cases above now pass. Extend them to interrupted
   restoration/confirmation and foreign history entries. Delay bootstrap,
   rendering and view-transition callbacks separately. Check
   address, committed readers, drafts and actual visible tree after every outcome.
   Preparation and wait deadlines now have controlled evidence. They do not prove
   atomic rollback after publication or shared-render recovery. Verify those
   boundaries without replaying mutations.
2. **Ownership changes and nested drafts (RT-08/RT-12).** Exercise user, scopeKey,
   transport/provider and parent-layout changes in real browser applications.
   Verify old service cleanup exactly once and fresh instances under the new owner.
   Audit App/root services and nested component draft/resource ownership, not only
   the declared page and retained layout fields covered here. Capture native values
   only through local capabilities; never hydrate client drafts from SSR JSON.
3. **Count actual backend reads (RT-08/REL-02).** Add an isolated audit fixture
   for actual page/layout resource executions in both production runtimes. Compare
   SSR reads and /crpc counts for initial load, cached history, invalid values,
   overlapping delayed queries and refresh during navigation. Current zero-RPC
   proof does not assert exactly one application backend read or abort ignored I/O.
   Release all controlled gates in cleanup and keep test deadlines finite.
4. **Completion audit.** Compare the original criteria below/above against the
   final evidence. Do not close RT-08 from the new narrow fixtures. Keep RT-09's
   wider cache, scroll, transitions, cancellation and diagnostics matrix open
   until its own checks pass. Continue all other 36 unchecked tasks and release
   gates. Versions remain 0.8.3 until REL-04.

Previous starting context after RT-07 (2026-10-03):
Path parameters and native API query schemas are now separate completed
contracts. Neither provides page URL state. Core's route builder constructs
paths only. Framework navigation caches full destinations, including queries.
SSR hydration already carries public/ClientState separation. Use these existing
contracts when implementing RT-08.

1. Define a portable declaration and inferred state type for page query values.
   Start with strings, finite numbers, booleans, repeated arrays and defaults.
   Decide absent, empty, malformed, repeated scalar and unknown-key behavior.
   Define one deterministic serializer and bounds before adding browser effects.
   Do not reuse API coercion silently when its invalid-input policy differs.
2. Parse the same declaration during SSR and initial browser hydration.
   Put request parsing in the framework integration and portable codecs in core.
   Keep database/framework imports out of core. Serialize only allowed values.
   Define a filtered-list example with search, sort and page number.
3. Add explicit push/replace operations through existing navigation/history
   ownership. Preserve unrelated query keys and fragments under a documented
   policy. Omit defaults consistently. Avoid a second global URL store that can
   disagree with the existing committed destination.
4. Integrate query changes with resource dependencies from RT-03. Preserve
   browser-owned draft state. Ensure one authoritative read for each committed
   dependency change and no extra read after matching SSR hydration.
   Rapid changes must supersede obsolete results without reverting URL state.
5. Run published negative types and actual Node/Worker browser acceptance.
   Copy a Unicode-filtered URL into a new tab. Exercise invalid page numbers,
   arrays, defaults, unrelated keys, back/forward, push/replace and rapid edits.
   Compare SSR and hydration state and count actual resource requests.
6. Audit the original criteria before checking RT-08. Finish dependent RT-09
   cancellation/completion contracts as needed, with independent evidence.
   Keep all remaining CLI, framework, Cloudflare and release tasks in scope.

Done when: A filtered list can be copied into a new tab with identical state.
Back/forward restores filters and results. Invalid page numbers use the documented
policy. Default values serialize predictably. Tests cover browser history,
SSR parity, rapid changes, and Unicode. Dependencies: RT-03, RT-07, and RT-09.

<a id="rt-09"></a>
### RT-09: Navigation completion and diagnostics

Codex criterion audit (2026-10-04): the completion and diagnostic contract now
has evidence for each original criterion. Earlier checkpoint next steps below
are historical, including ownership scenarios that later checkpoints completed.

| Requirement | Evidence |
| --- | --- |
| Completed, superseded, canceled, redirected and failed outcomes | Core result types and framework navigation-outcome tests exercise the public promises, effective redirect URLs, failed modules and guards. Native browser fixtures check failed/canceled results and actual redirect destinations. |
| Defined completion and bounded stalled work | `NavigationOwner` applies a 30-second budget. Owned rendering and commit serialization settle at the documented lifecycle boundary. Controlled tests cover stalled body, bootstrap/render, guards and history restoration. Native apps cover a stuck ordinary App render promise. |
| Stale fetches and disposed owners | Shared request readers release ownership independently and abort unused fetches. Unit/native fixtures release obsolete responses after newer commits. Retired task, SSE and WebSocket callbacks cannot publish into replacement owners. Arbitrary external I/O remains outside cancellation guarantees. |
| Cache, invalidation, layout, scroll and transition decisions | Versioned development events have correlation IDs and frozen fields. Tests check order, privacy, layout counts, cache sharing and production suppression. This completes RT-09 diagnostics, not the separate RT-28 devtools snapshot/timeline UI. |
| Rapid links, back/forward, guards, errors, redirects and reused layouts | Framework browser suites plus production Node/workerd fixtures cover these cases. The rapid-link test holds an actual SSR response until a newer linked page commits. |
| Fragments and unavailable transition APIs | Browser tests navigate to `#item-preview`, verify its viewport position, and verify top fallback for a missing fragment. Removing `startViewTransition` still commits navigation and emits the unsupported/completed diagnostics. |

RT-05 and RT-08 provide the lifecycle and URL-state contracts. RT-28 remains open
for its broader devtools deliverables. See the
[final navigation verification](./release-0.9.0.md#codex-navigation-acceptance-2026-10-04).

Codex WebSocket ownership follow-up (2026-10-04): provider retirement now revokes
socket ownership, clears heartbeat/reconnect timers, sets status closed and
settles pending calls immediately. Late open/error/close/message callbacks cannot
mutate retired or replaced owners. Duplicate close delivery cannot schedule two
reconnects, and destroyed components cannot reconnect. The malformed-known-ID
protocol test now uses a live owner and explicitly retires it afterward.

Production Node/native workerd tests open sockets with real provider targets,
change path-derived scope targets, replace a page at the same target and return
to HTTP. Changed ownership resets drafts and services. Matching target ownership
preserves drafts/services while the old connection closes. The Cloudflare fixture
adds a local AppDurableObject binding/migration; no deployment is performed.
See the [verification](./release-0.9.0.md#codex-websocket-ownership-2026-10-04).

Next audit all original RT-08/RT-09 criteria and run the navigation/guard/transition
browser suites plus full generated-runtime matrix. The planned ownership scenarios
now have native evidence. Do not keep listing these completed scenarios as pending,
and do not close either task solely from focused tests or aggregate suite counts.


Codex runtime ownership follow-up (2026-10-03): an actual SSE page opens its
subscription on Node and native workerd, then returns to HTTP. Root/layout drafts
and service identity remain stable, page drafts reset and the retired subscription
closes. The test found that EventSource.close() left realtime status open. Core
now clears source ownership and sets closed explicitly. Every SSE callback checks
source identity and terminal destruction before applying state or calling methods.
Replacement closes the prior source, and destroyed components cannot reconnect.

A local HTTP proxy also routes one browser between real built Node and workerd
applications without editing SSR metadata. Runtime changes in both directions
reset App/layout/page drafts and services while retaining the same user and scope.
Retired services dispose once. This covers HTTP runtime transitions, not mixed
WebSocket provider targets. Finish that remaining matrix before closure. See the
[verification](./release-0.9.0.md#codex-runtime-ownership-2026-10-03).


Codex same-URL history acceptance (2026-10-03): production Node/native workerd
now exercise two distinct entries with identical URLs. A blocked traversal is
held before its actual forward restoration. A newer intent waits, then commits
after the correct owned entry is restored. A separate confirmed traversal holds
its actual SSR response after backend reads. A newer navigation supersedes that
response without allowing it to restore or overwrite newer history.

Assertions cover group/position identity, application entry markers, history
length, page/service/File drafts, page/layout resource values and exact HTTP
backend read counts. Releasing the held response adds no reads or state changes.
The history.go wrapper delays only the test's restoration call; native browser
traversals still choose the entries. See the
[verification](./release-0.9.0.md#codex-same-url-history-2026-10-03).
This completes those two planned native interruption scenarios. Continue the
provider/runtime/transport ownership matrix and audit all original criteria.


Codex diagnostics continuation (2026-10-03): development navigation emits
`cossack:navigation-diagnostic` with version 1, per-document navigation IDs,
monotonic timestamps and frozen fixed-field records. Phases describe start,
cache hit/miss/shared reads, cache invalidation, attempted layout retention,
actual scroll decisions, transition selection/animation rejection and finish.
No URL, user/draft data, application identifiers, transition names or raw errors
are included. Production emits no diagnostic events. Animation rejection can
arrive after finish and does not change navigation success. Initial hydration
and rejected stale URL-update requests do not create traces.

Controlled navigation tests cover ordering/correlation, retained/created/retired
layouts, shared prefetch, invalidation, guard/failure/supersession, transition
fallbacks and production silence. Core scroll tests verify the actual decision.
Native production tests also assert no emitted diagnostics. See the
[event contract](../docs/prevent-navigation.md#development-diagnostics) and
[verification](./release-0.9.0.md#codex-navigation-diagnostics-2026-10-03).
Continue native ownership and interrupted same-URL history acceptance. Measure
actual backend reads separately from diagnostic cache decisions. RT-09 remains open.


Codex root ownership review (2026-10-03), after `ee5734a`:
the root App previously survived user and scope changes. Its private drafts and
children could cross the ownership boundary even when page/layout owners reset.
The framework now prepares a fresh App and root service scope for changed root
ownership. Publication switches the guarded root listener. Failure restores the
old App before recovery rendering. Successful retirement detaches its listener
and waits for component cleanup before disposing the old scope.
Empty root output now clears the previous DOM. Child transport selection stays
separate from the App's transport, so a child SSE-to-HTTP change retains the root.

The generated Node/native workerd fixture tests user and scope changes, matching
owner retention, failed root rendering, stale callbacks, and asynchronous layout
cleanup with the original request context. It uses declared layout services.
Its query-based user identity is a test fixture, not an authentication recipe.
Legacy global constructor injection is unchanged.

Parent-layout acceptance now passes with decorated inherited routes on Node and
native workerd. Root drafts/services remain stable, replaced layout/page drafts
reset, and retired nested services dispose once. Returning creates fresh nested
services. This test exposed the inherited route lookup bug fixed under RT-07.
Bare default re-exports remain outside this passing evidence.

Next steps for GLM:

1. Finish the native provider/runtime/transport ownership matrix. Preserve the
   existing user/scope and parent-layout cases. Use supported decorated modules
   and preserve compiler fail-closed checks.
2. Interrupt restoration and confirmation between two history entries with the
   same URL. Hold the old lifecycle callback, publish a newer intent, then release
   the callback. Assert history entry identity, DOM, drafts and service context.
3. Count actual backend resource reads before and after retained-layout changes,
   rollback and interruption. Assert both returned values and read counts.
4. Add navigation diagnostics for cache, layout retention, scroll, fragment and
   transition fallback. Verify event fields and ordering without exposing drafts.
5. Audit every RT-08/RT-09 acceptance criterion before closing either task.
   This review completes a tested slice. All 36 unchecked release tasks remain.

See the [verification](./release-0.9.0.md#codex-root-ownership-2026-10-03).


Purpose: Code that awaits navigation needs a defined completion point. Agents
also need to understand why cached data, scroll restoration, or a transition
produced an unexpected page state.

Baseline: Client navigation, scroll storage, layout reuse, and view transitions
exist. Their completion and diagnostic contracts need consolidation.

Approach: Define outcomes for completed, superseded, canceled, redirected, and
failed navigation. Settle completion after the documented render/lifecycle boundary.
Cancel stale fetches and discard late responses. Emit development events for
cache hits, invalidation, retained layouts, scroll choice, and transition fallback.
Treat restored history entries and fragment navigation explicitly.

Start in core `client/navigation.ts`, framework `client/app.ts`, and
`docs/prevent-navigation.md` and `docs/view-transitions.md`.

Codex continuation after `f53961e` (2026-10-03): owned history restoration and
module preflight are implemented. Read the
[RT-08 checkpoint](#rt-08) and
[verification](./release-0.9.0.md#codex-pending-history-2026-10-03).
Actual Node/workerd browsers cover guarded/failed traversal and history while a
query response is pending. Page/layout imports resolve before publishing live
contexts or SSR state; delayed obsolete modules cannot create a stale tree.
A missing history restoration event settles with a typed failure after two
seconds. This is not a general navigation deadline or a fetch cancellation claim.

Codex terminal disposal follow-up (2026-10-03): core lifecycle restoration now
keeps Destroyed terminal. Bootstrap checks disposal after its asynchronous
boundaries and before subsequent activation. Rebootstrap/reconnection cannot
revive the instance. Read the
[verification](./release-0.9.0.md#codex-terminal-disposal-2026-10-03).
This is a prerequisite, not completion of staging. Standard runTasks starts async
Tasks in the background, so a pending Task alone does not stall bootstrap.
Use a controlled bootstrap override for the stalled-owner regression. Keep the
old visible tree active while preparing a new tree. Preserve edits made during
preparation. Do not rebind retained service request contexts until publication.
On cancellation, dispose only newly created page/layout/scope instances. Recheck
ownership after every awaited operation and before publishing into the live tree.
Arbitrary application I/O is not stopped by the lifecycle fix.

Codex fetch ownership follow-up (2026-10-03): SharedPageRequests gives each
navigation/prefetch reader an independent 30-second response/body deadline.
Supersession releases the old navigation reader immediately. The final reader
leaving aborts the network request. Late ignored work cannot refill the cache or
preload modules. Invalidation retains existing reader results while detaching
future readers, and cache epoch checks still apply. Read the
[verification](./release-0.9.0.md#codex-fetch-ownership-2026-10-03).

Codex staged navigation checkpoint (2026-10-03): preparation now runs outside
the commit queue. A new page/layout bootstraps without opening transports,
running tasks, binding retained service requests or mounting. Publication adopts
the latest matching local drafts, then activates the new owners. Canceled
preparation disposes new instances. The committed tree remains active while a
bootstrap override waits. A controlled regression requires the newer navigation
to complete before releasing that old bootstrap. Preparation failure preserves
the old page and global SSR state.

NavigationOwner supplies one 30-second asynchronous completion budget. It races
guards, response loading, module/bootstrap preparation, commit queue and transition
completion. Expiry revokes publication with COSSACK_NAVIGATION_TIMEOUT. Fetch
readers keep their independent cancellation/deadline contract. History recovery
has its existing separate two-second bound. These limits settle framework waits;
they do not cancel arbitrary application I/O or roll back effects that already
ran in mount/render hooks. Read the
[verification](./release-0.9.0.md#codex-staged-navigation-2026-10-03).

The subsequent render-recovery checkpoint below restores framework-owned tree,
context and resource state before history commit. Next validate nested state
after partial DOM teardown, changed/nested owners and interrupted history.
Hold callbacks at each lifecycle boundary and compare visible tree, URL, service
context, cleanup count and drafts. Plain draft target sharing is fixed by the
following checkpoint. Keep the opaque capability boundary explicit. Extend actual
browsers for user/scope/provider/parent ownership changes and backend read counts.
Add cache/scroll/fragment/transition fallback diagnostics and timeline evidence.
Audit every original RT-08/RT-09 criterion before closure. No checkbox closes here.


Codex draft isolation checkpoint (2026-10-03): local capability capture now copies
plain records/arrays into a new graph. A disposed owner's saved proxy or cleanup
hook cannot mutate those copied targets. Both Node and native workerd browsers
force a fresh render after such a late write. Cycles, aliases and File identity
survive. Opaque native/class/function capabilities retain identity, so their
internal mutation is not isolated. Accessors in draft records reject before
publication without running getters. Read the
[verification](./release-0.9.0.md#codex-draft-isolation-2026-10-03).
Continue the remaining shared-render, post-publication recovery and full acceptance
work above. Do not treat these focused draft tests as an RT-08/RT-09 closure.


Codex render-recovery checkpoint (2026-10-03): core now owns a guarded navigation
render pass. It does not join a stuck application update promise. It propagates
render errors and suppresses later lifecycle callbacks once ownership is revoked.
The framework keeps the outgoing page alive until rendering and history commit
succeed. Before commit, failure/cancellation restores the page/layout map, retained
request/user/resource contexts, service request bindings and global SSR state.
Unresolved resource snapshots can reload rather than joining discarded promises.
Snapshot recovery does not revive destroyed nested components or undo application
side effects. Errors after commit keep the destination current. Read the
[verification](./release-0.9.0.md#codex-render-recovery-2026-10-03).

Controlled tests cover error/veto/deadline recovery and newer navigation while an
old render waits. Actual Node/native workerd apps throw from App.render, verify
restored page/layout/service/File state, then navigate while the App owns a promise
that never settles. The prior ordinary history/query matrix stays in that fixture.
Next audit partial DOM teardown with nested drafts and transient scopes. Keep
transient scopes alive until rollback reconciliation removes their descendants,
while immediately revoking their task publication. Do not revive destroyed child
instances; restore captured local drafts only into matching new owners. Then test
interrupted same-URL history entries and lifecycle cleanup failures, and finish
the remaining criteria above.


Codex scope-retirement review (2026-10-03), after `773c9c3`:
renderer-created consumers now hold their service scope and its ancestors through
DOM removal and asynchronous component cleanup. Navigation retirement snapshots
these holds before destruction; component task cancellation and the Destroyed
phase remain immediate. Rollback rejects attachment to retiring scopes. Successful
retirement must also honor a consumer whose DOM has gone but whose cleanup is
still pending. An owner releases its own DOM hold before awaiting scope disposal,
which avoids a self-wait. Ordinary explicit destruction retains its existing
contract. The renderer uses structural internal hooks and adds no core dependency.

The renderer also cleans up partially created sibling parts after connection or
hydration failure and invalidates disposed root caches. A throwing disconnection
hook cannot skip sibling destruction or scope release. Tests must exercise both
failed publication and successful retirement in actual Node/native workerd apps,
with an async child cleanup that reads the service before its disposal.
See the [verification](./release-0.9.0.md#codex-scope-retirement-2026-10-03).

Next implementation steps for GLM:

1. Capture local nested child drafts before any DOM teardown. Record the owning
   class, parent, service scope and rendering identity. Restore only into matching
   replacement owners; never reconnect a Destroyed instance. Test changed owners
   as well as retained owners and keep File/native capability boundaries explicit.
2. Hold navigation at render, cleanup and history boundaries. Supersede it with
   another intent, including two history entries with the same URL. Compare the
   visible tree, history entry, resource context and cleanup counts after release.
3. Measure actual backend resource reads during those cases. Add the planned
   cache, layout, scroll, fragment and transition diagnostics; test their contents.
4. Audit all RT-08 and RT-09 criteria before checking either box. This cleanup fix
   does not close those tasks or reduce the release checklist.

Codex nested-draft checkpoint (2026-10-03), after `3af248d`:
rendered child trees now have separate destination and rollback draft checkpoints.
Renderer part identity, position/repeat keys, class, parent and service scope
select matching replacement instances. For a same-class/same-owner page change,
the framework explicitly maps the old page to the prepared page. Fresh child
owners receive their local core capabilities before initializeState and mount.
Live retained instances keep current values; destroyed instances remain terminal.
Late descendant restoration checks the current publication. Consumed child
initialization maps are released after state setup. No SSR JSON transfer is added.

Actual generated Node/native workerd acceptance covers page and layout children,
grandchildren, a nested File draft, same-path query changes, post-render rollback
and restored values observed from mount. Unit cases cover arrays, keyed reordering,
changed class/parent/scope/key, revoked async restoration, and active cache templates.
A synchronous slotted render from a changed wrapper must not bypass the wrapper
match; an explicit no-recovery boundary now prevents that propagation.
A related regression showed that repeat() lost track of early new siblings when
a later connection threw. Reconciliation now disposes all owned partial parts.
Read the [verification](./release-0.9.0.md#codex-nested-drafts-2026-10-03).

This advances steps 1 and 2 from the scope-retirement checkpoint; it does not
complete them. Continue with:

1. **Inactive cached branches.** Checkpoint hidden cache() stashes as well as the
   active template. Define how unconsumed local capabilities survive another
   navigation before their branch becomes visible. Do not read destroyed owners
   or reuse a one-use capability in both destination and rollback checkpoints.
   A possible design is a core-owned capability fork that snapshots the remaining
   plain draft graph while preserving class binding and opaque File identity.
   Keep that operation local and unforgeable; renderer must not inspect draft
   values. Test two hidden branches, two intervening navigations, later activation,
   changed keys/parents/scopes and writes through saved old proxies. Capture live
   stashes without reviving them, and release abandoned checkpoint references.
2. **Ownership changes in native browsers.** Change parent, user, runtime/provider,
   transport and service scope. Prove private drafts do not cross those boundaries.
   Confirm nested saved-proxy writes cannot mutate restored owners, and test hook
   failure/cancellation after partial keyed reconciliation.
3. **Interrupted history and reads.** Finish same-URL entry identity and lifecycle
   interruption tests, then count actual backend resource reads. RPC absence alone
   does not prove that a server resource was read exactly once.
4. **Diagnostics and closure.** Complete cache/layout/scroll/fragment/transition
   events and audit every original RT-08/RT-09 criterion. Preserve all release IDs
   and other unchecked tasks. Versions stay 0.8.3 until REL-04.

Codex inactive-cache checkpoint (2026-10-03), after `34592fd`:
the inactive-branch work above is implemented. Core forks unconsumed capabilities
without reading a disposed owner. Each fork keeps its original class binding and
snapshots the plain graph independently; File/native values keep opaque identity.
Renderer captures hidden live stashes and pending restored branches. On another
navigation, it forks remaining tokens and rebases parent ownership to the current
replacement, so destination and rollback cannot consume one another's values.

Navigation retires old hidden instances and stores draft checkpoints for later
activation. Ordinary cache toggles retain their existing live-DOM behavior.
Restoration covers both placeholder templates and cache(null). Changed class,
parent, scope or key, explicit discard, cache exit and revoked publication reject
pending restoration. Unit fixtures trap any attempt to recapture a destroyed
owner; two-owner replacements and independent rollback copies pass. Actual
Node/native workerd browsers hide two branches, navigate repeatedly and roll back,
write through a saved old proxy, then reveal both drafts and a File value. Leaving
and returning resets unrelated cached drafts. See the
[verification](./release-0.9.0.md#codex-inactive-cache-2026-10-03).

Next actions remain implementation work, not optional release polish:

1. Finish the actual browser ownership matrix (user/scopeKey, runtime/provider,
   transport and parent layouts), including service disposal and nested resource
   context. Unit rejection by identity is not the whole native-runtime proof.
2. Exercise interruption while restoring/confirming same-URL history entries and
   during nested/keyed render or cleanup failures. Preserve entry metadata and
   distinguish committed, superseded and failed outcomes without replaying actions.
3. Count actual backend resource reads and finish cache/layout/scroll/fragment/
   transition diagnostics. Zero extra /crpc requests alone is insufficient.
4. Audit all original RT-08/RT-09 criteria and every remaining release gate before
   closure. All 58 IDs remain in order, with 22 checked and 36 unchecked. Keep
   versions at 0.8.3 until REL-04.

Done when: Browser tests cover rapid links, back/forward, navigation guards,
errors, redirects, reused layouts, fragments, and unavailable transition APIs.
Promises always settle and disposed pages do not receive late updates.
Dependencies: RT-05, RT-08, and RT-28.

<a id="rt-10"></a>
### RT-10: Typed form controller

Purpose: Forms need values, errors, touched fields, submission state, and reset
behavior. Authors currently assemble these from stores and validation helpers.

Baseline: Bracket-based FormData parsing and nested validation exist. Reuse them.
A complete typed controller remains open.

Approach: Add a controller that owns initial/current values, dirty/touched state,
field errors, and submission lifecycle. Infer valid field paths. Connect server
validation errors from RT-02 without manual translation. Define file fields,
array entries, checkbox coercion, double-submit behavior, and reset semantics.
Expose accessible field bindings without requiring UI-package components.

Start in core `shared/forms.ts`, `validation.ts`, `store.ts`, and
`docs/forms.md` and `docs/forms-advanced.md`.

Done when: A nested form can submit, display field/form errors, edit, resubmit,
and reset. File values survive the intended transport. A stale validation result
cannot overwrite a later edit. Type tests reject invalid field names. Browser
tests cover keyboard submission, labels, error associations, and focus recovery.
Dependencies: RT-02 and RT-05.

<a id="rt-11"></a>
### RT-11: Session and flash recipes

Purpose: Login, redirects, old form input, and one-time messages must work through
the framework's actual request lifecycle. A recipe that works only during a
plain page request is incomplete.

Baseline: Session and flash helpers exist. Integrated recipes and failure coverage
remain open.

Approach: Document and generate flows for failed validation, successful mutation
with redirect, authentication change, logout, and session rotation. Specify which
values persist, which are consumed once, and which must never enter old input.
Preserve cookie headers when RPC returns a redirect/result. Reject late cookie
changes after streaming headers are committed with a useful diagnostic.

Codex checkpoint (2026-10-03): verified native cookies/redirects, old-input and
message consumption, and late session/header writes as described under RT-01.
Middleware acceptance covers `/crpc`, `/upload`, `/sse`, and `/ws/`: valid incoming
flash survives background requests, HTTP failures do not replace it with partial
outgoing writes, and invalid tokens clear. A later stream failure cannot undo
already-sent headers. These are response lifecycle fixes, not completion of all
recipes. Next finish password/token exclusion from old input, generated failure/
login/logout/rotation flows, and documented concurrent request semantics. Verify
Workers/realtime integration for this behavior before claiming runtime parity.

Codex Workers acceptance (2026-10-03): production workerd/Chromium now verifies
native/helper/flash redirect cookies and one-time old-input/message consumption
for component and service actions from HTTP/SSE pages. Multipart early cookies
and late-cookie diagnostics work through the real artifact. Continue sensitive
old-input filtering, complete failure/login/logout/rotation recipes and documented
concurrent request behavior; this runtime slice does not close RT-11.

Start in framework `session.ts`, `flash-context.ts`, middleware, core
`shared/flash.ts`, and `packages/auth/src/session.ts`.

Done when: Native HTTP tests observe cookie changes and flash consumption across
requests. RPC failures do not consume or lose unrelated state. Passwords and
tokens never enter serialized old input. Concurrent requests and rotation have
documented behavior. Dependencies: RT-01, RT-02, and RT-13.

<a id="rt-12"></a>
### RT-12: DI errors, ownership, and cleanup

Purpose: Agents must know where a service is declared, which scope owns it, and
when it is destroyed. Missing injections and accidental global request state
must produce useful explanations.

Baseline: Explicit layout scopes, stable service slots, hydration, and awaitable
cleanup exist. SSG and component RPC use that cleanup. SSR, navigation, and
explicit service RPC still have different completion behavior.

Approach: Add resolution paths to errors and inspection. Show the requested
service, requesting component, active layout ancestry, and available declarations.
Document global singleton versus layout/request scope. Finish cleanup ordering
where the owning operation needs to await it. Preserve nested shadowing and
separate service state from component state.

Start in core `shared/container.ts`, `service-scope.ts`, `service-bootstrap.ts`,
`cossack.ts`, framework `router.ts`, and `specs/service.md`.

Done when: Concurrent users cannot share request facilities. Missing declarations
show an actionable owner location. Leaving a layout cleans its services once.
Failures in one hook do not skip others. Inspection matches actual ownership.
Dependencies: RT-01, RT-09, and CLI-04.

<a id="rt-13"></a>
### RT-13: Authentication primitives and OAuth diagnostics

Purpose: Application authors need reusable authentication behavior and clear
provider failures. Agents must not copy large authentication implementations from
templates and then maintain divergent versions.

Baseline: The auth library contains sessions, OAuth flow helpers/providers, and
authorization middleware. Scaffolding supplies application-specific credential flows.

Approach: Identify reusable credential/session operations in generated code and
move those operations behind typed library contracts. Keep application user models,
database selection, and presentation in the application. Classify expected OAuth
failures such as missing configuration, state mismatch, denied consent, and
provider exchange failure. Redact codes, tokens, passwords, and provider secrets.

Start in `packages/auth/src/session.ts`, `oauth/`, `index.ts`, and auth recipe
generation in `packages/scaffold/src/index.js`.

Done when: Generated auth apps consume the shared primitives. Tests cover expiry,
rotation, callback replay, failed provider exchange, and account-mapping errors.
Error messages identify the failing stage without leaking sensitive values.
The auth library remains independent of framework and database. Related task: RT-11.

<a id="rt-14"></a>
### RT-14: Resource authorization policies

Purpose: A route-level role check cannot decide whether a user can edit one
particular record. The server and UI need one typed policy model with different
responsibilities: enforcement and presentation.

Baseline: `createAuthorizer()` supports existing authorization patterns. Resource
policies and reusable client visibility helpers need a complete interface.

Approach: Define actions against resource types with request/user context. Run
the policy in every server path that exposes the resource or mutation. Derive
only necessary permission booleans for the browser. Hidden buttons are convenience,
not enforcement. Keep ownership lookup and database access supplied by the app.
Compose policies with validated actions and route middleware.

Start in `packages/auth/src/authz/index.ts`, `docs/authorization.md`, framework
RPC/API guards, and RT-02 metadata.

Codex next-phase context (2026-10-03): RT-02 now supplies typed parsed input
before action dispatch and an owned cancellation signal. Use that boundary to
compose resource authorization. Auth's existing `createAuthorizer` remains a
string-permission/role kit; it does not infer a record's action union. Define the
new kit in auth with typed resource/action/context callbacks, application-owned
lookup, boolean presentation helpers and imperative enforcement. Core should
consume a structural policy callback/decision without importing auth or ORM.

Wire enforcement after input parsing and before mutation, in both router gates
and the core socket gate. Look up the resource from validated identifiers and
server context; never accept a payload's owner/user/canEdit as authoritative.
Use the same kit explicitly from API handlers and resource read loaders. Decide
native-call enforcement honestly: metadata currently guards inbound RPC only.
Preserve authored method signatures and require explicit checks for internal
read/write calls rather than silently wrapping sync methods in promises.

Compiler stripping must include policy metadata and its private dependencies,
including exported/shared foreign-module hazards and destructured declarations.
Start tests with typed action-name negatives, an owned-record allow, another
actor/tenant deny, missing user, lookup/policy exceptions, forged permission
state and zero writes on denial. Repeat through HTTP/SSE, uploaded input,
forwarded/explicit services and relevant socket paths, with correlation and
consistent denial codes. RT-11 still owns session freshness/revocation; a stored
connection identity alone does not prove those guarantees. Native workerd
acceptance currently proves typed upload validation, not this new resource policy.
Neither RT-02 nor RT-14 can close from schema tests alone.

**Codex implementation and criterion audit (2026-10-03), after `49d3236`.**
The following supersedes the unfinished RT-14 next-phase instructions above.

- Auth exports `createResourcePolicy<Resource, User>()(rules)`. Named actions
  retain their literal union. `can` and `permissions` produce presentation
  booleans; `authorize` returns the permitted record; `action` adapts an
  application-owned lookup to Server metadata; `middleware` checks an HTTP
  record before its handler. Config callbacks are snapshotted, actions/maps
  frozen, decisions strictly boolean, and absent actors/records denied.
- Core exports the independent structural authorizer/context types and gate.
  HTTP/SSE/upload component/explicit service and socket/forwarded-service gates
  run it after input parsing and before invocation. Upstream request/socket actor
  identity supplies `context.get('user')`; payload/state owner/user/canEdit is
  never authoritative. Direct/typed-channel Server overloads infer parsed input.
- Expected failures use fixed 401/403 codes/messages and request IDs across
  direct API, server reads, middleware and action envelopes. Lookup/policy
  exceptions and invalid/nonboolean metadata remain private. Error redaction
  does not invoke arbitrary exception getters. Abort skips later mutation,
  releases pending ownership and observes late callback errors; it does not
  terminate ignored I/O or roll back callback side effects.
- Review fixed a native Hono context proxy defect: private-field getters/methods
  and response setters need the original receiver, including through nested
  socket proxies. The new real-Hono response read/write test and native socket
  denials verify it. Server context helpers still delegate their own form API.
- Compiler stripping removes policy metadata/private transitive declarations
  and dead dependencies used solely by server reads. Shared client helpers
  survive; exported/client-reachable private metadata and retained foreign
  contract modules fail. Static typed-decorator factory/result/destructured
  aliases receive the same method classification and stripping. Unrecognized
  dynamic factories are not advertised as supported patterns.

Original done criteria:

1. Owned-record allow, another owner/tenant deny: shared transport/API/read
   tests and generated native D1 JSON/multipart page/service fixtures. Denials
   leave both actual record versions and audit rows unchanged. Application
   conditional writes repeat actor/tenant predicates to avoid a lookup/write race.
2. Relevant realtime path: actual Cloudflare socket peer/reconstruction fixture
   and forwarded-service socket tests. Denials preserve state; the current trusted
   socket actor is used instead of a stale context user. Session revocation and
   freshness remain RT-11, not a claim from connection identity alone.
3. Forged permission state: raw direct requests/socket frames supply fake
   owner/user/canEdit/permission state and gain no access. Unknown payload fields
   fail typed input before lookup. UI visibility does not replace server checks.
4. Unknown resource actions/type shapes: standalone auth inference fixture rejects
   unknown action/permission names, incorrect resources and mismatched parsed
   lookup input. Core published-declaration fixtures verify authorizer/channel
   inference and reject mismatched native method/authorizer inputs.
5. UI/direct request consistency: generated workerd browser controls reflect
   server-derived named permission flags, owned HTTP/SSE edits succeed and direct
   unauthorized writes fail. API/SSR reads deny cross-tenant resources using the
   same kit. Client chunks contain neither private policy sentinel nor SQL.

RT-14 can close on this evidence. The exact final test counts and any failed
intermediate runs are recorded in the release checkpoint. Native authored method
calls still require explicit authorization; decorator metadata only guards
inbound RPC. Full release/runtime gates and RT-02 migration remain open.

Done when: A user can act on an owned record and is denied for another tenant's
record through HTTP, RPC, and relevant realtime paths. Forged client permission
state grants nothing. Type tests reject unknown resource actions. Denial behavior
is consistent across UI recipes and direct requests.

<a id="rt-15"></a>
### RT-15: Database DX and provider capabilities

Purpose: The database package must explain entity relationships, query behavior,
and provider limits. Similar TypeScript APIs do not prove that every database
supports identical transactions or schema operations.

Baseline: Active Record entities, relationships, query builders, migrations, and
multiple adapters exist. The task extends those features rather than adding an ORM.

Approach: Expose finalized entity/relationship metadata to inspection. Add query
diagnostics with SQL structure, duration, provider, and redacted parameters. Define
pagination ordering and cursor/offset behavior. Publish a capability matrix for
transactions, nesting, schema changes, and generated values. Reject unsupported
operations before effects. Preserve request-local ORM scope.

Start in database `metadata/`, `query/`, `entity/`, `adapter/types.ts`, runtime
adapters, `orm.ts`, and `docs/relationships.md` within that package.

Done when: Provider-specific tests prove supported operations and expected
rejections. Relationship errors name both entities and fields. Pagination remains
stable under its documented ordering. Transaction tests demonstrate commit and
rollback with actual supported drivers. Related tasks: RT-16, RT-17, and CF-02.

<a id="rt-16"></a>
### RT-16: Migration and seeder plans

Purpose: An agent must see database changes and their target before applying
them. A dry run that executes arbitrary migration or seeder effects is not a plan.

Baseline: Partial implementation includes SQL plans, destructive-operation flags,
checksums, read-only history, environment/target context, and structured output.
Seeder preview returns metadata without running the callback.

Approach: Complete the common plan contract across providers and commands. Include
direction, ordered steps, SQL, affected objects, risk, target identity, and plan
completeness. Mark dynamic data-dependent operations as unknown when they cannot
be safely planned. Do not pretend that omitted SQL means no changes. Recheck
history/checksums before applying a previously computed plan.

Start in database `migration/`, `seeding/`, `tooling/`, and CLI database commands.
Reuse the current adapter factory context and isolated JSON transport.

Done when: Planning leaves application data, migration bookkeeping, and generated
files unchanged. Apply reaches the displayed target. Already-applied and changed
migrations report correctly. Tests cover reversal, squash, callbacks, failure,
and provider-specific limitations. Dependencies: RT-15, CLI-03, and CF-02.

<a id="rt-17"></a>
### RT-17: Shared database inspection for Studio and CLI

Purpose: Studio and CLI must agree about the configured database, environment,
schema, and migration history. Separate parsers and queries create conflicting answers.

Baseline: Shared D1 discovery exists. Broader provider inspection and one common
service/result contract remain incomplete.

Approach: Move reusable discovery and read-only inspection into database tooling.
Expose provider capabilities, resolved target, schema, relationships where known,
and migration status. Let Studio render the result and CLI serialize it.
Keep connection lifecycle and disposal in the shared service. Avoid reading
secret values into response objects.

Start in database `tooling/cloudflare.ts`, `tooling/index.ts`,
`schema/introspection.ts`, and Studio `src/lib/remote-d1.ts` and `src/index.ts`.

Done when: The same fixture produces equivalent Studio and CLI facts. Named
environments never fall back to an unintended top-level binding. Read-only
inspection does not create bookkeeping tables. Both callers close temporary
connections after success or failure. Dependencies: RT-15, RT-16, and CLI-03.

<a id="rt-18"></a>
### RT-18: Cache and rate-limit contracts

Purpose: A cache or limiter must state whether it is local, shared, or atomic.
Agents must not infer distributed guarantees from a common interface.

Baseline: Memory, KV, Durable Object, and other provider implementations exist.
Cache TTL uses seconds while rate-limit windows use milliseconds. Capability
diagnostics and transport coverage need consolidation.

**Latest Codex completion (2026-10-03):** RT-18 is complete. The baseline and
older checkpoints below describe prior states. This task closes only the
cache/limiter contract; it does not close arbitrary action deadlines, resource
authorization, actual incoming disconnect delivery, or full release/runtime gates.

Criterion audit:

| Original requirement | Implementation and acceptance evidence |
| --- | --- |
| One explicit duration convention | Cache `ttlMs` and limiter `window`/`windowMs` use integer milliseconds. Fake-clock cache/counter suites prove exact boundaries; native KV/DO prove short logical expiry independent of retention. The database adapter matches the structural contract without framework imports. |
| Provider expiry/atomicity/locality/consistency | Pure core storage model and frozen builtin declarations. Cache DO get/set is not an atomic increment; KV remains eventual/non-atomic. Database deployment traits and Redis persistence remain unknown. Undeclared custom traits remain unknown. |
| Reject unsupported requested guarantees | `CacheStoreSpec.requires`, `cache.require`, `RateLimitOptions.requires`, and builtin `hit(..., {requires})` check before operations. Immutable snapshots prevent later weakening. Provider/handler spies prove no denied operation; compiled page/service acceptance proves no denied D1 writes. Factory construction remains the factory author's resource responsibility. |
| Backend and units in inspection | Runtime `cache.inspect()`/`inspectRateLimitStore(env)` consume no operation. CLI `inspect/check providers` uses compiler AST and selected Wrangler public settings, never config execution or provider calls. Static scope, dynamic/override uncertainty, operation support and binding status are explicit. Missing selected bindings fail; optional unselected bindings warn. |
| Shared multi-request counter behavior | Two native Workers share transactional DO counters across concurrent hits, actual limiter eviction and Worker reload. Native HTTP/socket guards share spent budgets and require shared/durable/atomic traits. Compiled HTTP/SSE page/service and multipart acceptance proves unsupported traits deny mutation. |
| Actual server limits rather than client debounce | The shared RPC matrix exercises server decisions and mutation counters for HTTP/SSE/socket and scoped service dispatch; API wrapper/decorator tests use actual Hono dispatch. Client debounce is independent. |
| Resource/configuration safety and migration | Saturated memory rejects new keys without forgetting live quotas. Keys/namespaces and final framed keys have UTF-8 bounds. Redis validates HTTPS/token/wire URL limits and rejects redirects. Malformed/null/unknown options fail. Framework scope/caller and KV/Redis namespace/key framing have a documented one-time budget migration. |

Public contracts and ownership context for GLM:

- `StorageRequirements` supports `shared`, `durable`, `strongConsistency`,
  `atomicIncrement`, `millisecondExpiry`, and `operations`. Unknown cannot prove a
  positive requirement. Custom capability metadata is the implementer's assertion,
  not remote attestation. Direct custom limiter calls own their own enforcement.
- Memory limiter `maxEntries` is 1..100,000 (default 10,000). Expired buckets free
  capacity; a live spent quota is never evicted. Capacity/backend failures are not
  429 decisions. Final KV/Redis keys must fit 512 encoded bytes; Redis URL limits
  apply both before and after URL normalization. No plain-HTTP exception/retry.
- `window` keeps its existing name and millisecond meaning. Cache's previous
  seconds-to-milliseconds break is retained. New tuple encoding resets old limiter
  budgets once; coordinate mixed-version rollouts if separate quotas matter.
- Compiler inspection follows bounded static declarations/public env calls only.
  Mutation/helper/spread/getter expressions remain unknown. Registration aliases,
  escaped/dynamic namespaces and manual defaults are conservative candidates, not
  proof that an unused module executes. The CLI does not read credential values.
- Do not claim live regional KV/write throttling, live Redis readiness/persistence,
  actual native pre-header TCP abort delivery, remote producer shutdown, rollback,
  arbitrary action deadlines, or native Deno/Electron execution from these tests.
  Those acceptance boundaries retain their original tasks and release gates.

Verification commands/evidence are recorded in the
[Codex provider review](./release-0.9.0.md#codex-storage-capabilities-2026-10-03).
Dependency RT-25 is already checked. All 58 release task IDs remain in the ledger;
this completion changes only RT-18 from open to checked.

Approach: Choose one explicit public duration convention and normalize at provider
boundaries. Record breaking renames if needed. Declare expiry precision, atomic
increment support, locality, and consistency per provider. Reject a requested
guarantee that the selected provider cannot supply. Apply server rate limits to
component/service RPC and realtime calls as well as API routes.

Start in framework `cache.ts`, core `shared/rate-limit.ts`, framework transport
handlers, and `specs/cache.md`.

Codex checkpoint (2026-10-03, after `97316b6`): DO counters now persist in one
transactional storage record with their fixed deadline. Fresh windows schedule
expiry cleanup; delayed/duplicate alarms cannot clear a newer window. Using the
transactional key-value API keeps SQLite and legacy storage support without
importing a platform-only module into the shared core entry. New namespace
examples use SQLite. The original in-memory windows cannot be recovered on the
first upgrade; subsequent windows survive reconstruction.

Evidence: 23 focused core cases cover reconstructed instances, exact expiry,
queued transaction timing, failed counter/alarm commits, corrupt records,
malformed replies and invalid direct windows. All 17 initial regressions failed
on the old implementation. The published core entry is exercised by real
workerd with two Workers sharing one native DO namespace: concurrent counts
remain unique, actual eviction preserves count/deadline, Worker reload preserves
spent budgets, and blocked handlers do not mutate. The native socket fixture also
evicts the real limiter DO before reconnect/new-component and existing-peer
actions. Component reconstruction in that socket fixture remains forced.

Codex checkpoint (2026-10-03, after `78c208c`): explicit backend modes and
binding/credential shapes now reject invalid configuration before mutation.
There is no fallback on failure and no sticky first-env global selection.
`configureRateLimitFromEnv(env)` returns the environment's store; unchanged
binding/credential descriptors are cached in a WeakMap. Each evaluation captures
that store, while intentional manual overrides and the unconfigured memory
store remain process-wide. A shared component's limiter prefers the current
peer context environment. Configuration repair and binding/mode changes work.

Limiter `window`, `max`, `key` and `message` values have runtime checks before
counter dispatch. All returned counters are validated and snapshotted once.
KV corrupt records are not overwritten; storage TTL respects the 60-second
minimum while logical windows remain millisecond deadlines. Redis uses PEXPIRE
and checked PTTL instead of second rounding/guessed TTL. Explicit Redis env
helpers do not borrow process credentials. Public examples distinguish fixed
process overrides from automatic request selection and use Worker token secrets.

Evidence: the initial 103-case contract suite exposed 91 baseline failures, and
44 new shared-matrix cases exposed 40 baseline failures across HTTP/SSE/socket/
service paths. The final contract suite has 105 cases, including explicit null
configuration and single-observation custom getters; the shared matrix has 342
cases after adding null-mode checks. A separate real core socket-dispatch case
reproduced bootstrap-env reuse and now passes. Native workerd uses two distinct
DO namespace classes to prove binding ownership, inherited budgets across two
Workers, absent/invalid/null configuration and zero denied-handler mutations.
The socket fixture reloads into an invalid backend mode and proves correlated
sanitized failure with state unchanged. These fixtures do not prove live Redis
or KV regional consistency. Real Node sockets and Deno event tests pass; actual
Deno execution remains a separate release gate.

Codex checkpoint (2026-10-03, after `14365b3`): DO/Redis replies now have an
8192-byte bound, strict UTF-8 and required EOF. KV text records are bounded before
parsing. A five-second default counter decision deadline applies to built-ins
and framework enforcement of custom stores. `backendTimeoutMs` configures it;
async direct built-in calls accept `{ signal, timeoutMs }` as a third argument.
Late/error bodies are cancelled and readers released without hanging on faulty
cancel callbacks. HTTP request signals and socket call/close/error signals stop
late action invocation. A cancelled pending KV read cannot dispatch a write;
an in-flight write can still commit. No retry or rollback is promised.

Client HTTP/multipart/service requests now carry UUID v4 correlation IDs before
headers. Only valid UUID v4 input is adopted by the server guard; arbitrary IDs
get replaced and authorization still applies. Six new matrix cases initially
exposed missing IDs before response headers. The matrix now has 354 cases, with
12 additions for limiter deadlines/cancellation and next-action progress before
an ignored provider is released. Core has 43 focused I/O cases and three peer
close/error queue cases. Native workerd reads real DO response streams: oversized,
invalid UTF-8, HTTP error, stalled and aborted replies reject without mutations,
reader locks release, and an exact 8192-byte valid body succeeds. Separate custom
fetch cases inside workerd prove late-body disposal for both clients; these are
not live Redis or native header-abort guarantees. Remote native producer cancel
callbacks were not observed after cancelling the subrequest; do not claim them.

Codex cache checkpoint (2026-10-03, after `e6e5677`): public cache TTLs now
use nonnegative integer milliseconds (`ttlMs`), including the structurally
independent database adapter. Facade `set()` defaults to 3_600_000 ms; omitted
TTL on direct stores or batch entries remains indefinite. Zero expires at once.
Invalid durations/batches reject before writes; `remember()` validates even on
a hit and captures its provider before awaiting its computation.

Store selection no longer reuses the first same-name binding: actual binding
identity/full named declarations own built-in wrappers. A missing/invalid
current binding rejects before memo lookup. Custom factories are request-owned,
reuse unchanged full specs/shallow env values, and remain responsible for their
resources; nested env objects must remain stable. Built-in registration is
independent of a custom memory factory. Named memory stores are separate and
bounded to 256 stable selections. DO stubs are obtained inside operations.

KV uses framed namespace/key tuples and versioned envelopes. Logical expiry is
checked in milliseconds, while retention rounds up to at least 60 seconds.
Expired/corrupt KV reads never delete records because they can be stale compared
to a fresh write. Database cleanup compares the selected value/deadline before
deleting; a real SQLite interleaving test proves fresh replacements survive.
DO private routes use a query key (preserving dot segments) and explicit
found/missing batch records (preserving null). Cache input validation bounds
valid UTF-8 keys to 512 bytes, values to 1 MiB, and write batches to 128 entries/
2 MiB including overhead. Memory uses LRU with count and serialized-byte budgets.
DO I/O has a five-second deadline/current request signal, strict UTF-8/EOF and
2 MiB JSON bounds; cancellation cleanup is detached. Writes already dispatched
may commit, backend failures can leave partial batches, and custom cache/DB
operations do not automatically receive these I/O deadlines.

Migration context for GLM: multiply old TTL arguments by 1,000 and rename batch
`ttlSeconds` to `ttlMs` in custom stores. DB/DO epoch timestamp formats remain
unchanged; new KV framing starts a fresh cache without reading old records.
Indefinite old keys need explicit cleanup. Deploy DO clients and class together.
Guide, agent examples, architecture, runnable demo and generated package
acceptance use the new unit. Provider capability declarations/inspection and
requested-guarantee rejection remain unfinished: do not check RT-18 yet.

Historical next steps before the latest RT-18 completion, with each goal kept separate:

1. Finish actual native disconnect acceptance. Coordinator cancellation now has
   cross-Worker native RPC evidence: 32-entry saturation, duplicate-ID refusal,
   cancelled queued callbacks never starting, capacity reuse, preserved FIFO,
   and active counter cancellation before an ignoring provider replies. Built
   production routes prove explicit request-signal cancellation for HTTP/SSE
   JSON/multipart page and service calls, and a queued SSE call never hitting
   its store. Hono proxy getters and response setters retain their real receivers; a real
   Hono assignment regression and compiled page/service response headers verify it. A cancelled
   pre-header response carries the public correlation ID and cancellation code.
   New Cloudflare recipes enable `enable_request_signal`; named environments
   inherit it unless overridden. Selected-config preflight and artifact date/flag
   comparison reject missing/changed settings. Upgrades explicitly exclude
   Wrangler files, so existing apps must add the flag manually; neither template
   application nor force overwrites that exclusion. The installed workerd did
   **not** emit a pre-header TCP disconnect event in a minimal direct-socket
   Worker, even with the flag and waitUntil. Do not describe explicit signal
   cancellation as proof of that delivery. Arbitrary already-started methods
   and initialization/restoration still need policy/deadline audits. Keep actual
   Deno/Electron release gates separate; native producer shutdown remains unproven.
2. Finish limiter-specific configuration/resource validation. Cache key/namespace,
   batch/value, memory count/byte and duration policies now have regressions.
   Audit Redis URL schemes/redirects, optional limiter namespace values, key UTF-8
   bounds, memory limiter capacity semantics and backend maximum durations. Check namespace encoding/collision
   policy with RT-01/RT-14. Do not reinterpret KV write errors as ordinary caller
   quota denials or approximate consistency as a bounded global counter.
3. Cache public durations now use milliseconds, matching limiter windows; retain
   the breaking migration and provider retention explanations. Verify remaining
   native cache I/O/cancellation cases as needed, without claiming actual TCP
   disconnect delivery, live KV regional consistency or remote producer shutdown.
   Decide whether the limiter option should explicitly be called `windowMs`; its
   existing `window` field is already documented and evaluated in milliseconds.
4. Declare provider locality, persistence, expiry precision, atomicity and
   unsupported operations; expose them through inspection. Reject a requested
   guarantee the selected provider cannot provide. Prove capability rejection
   and inspection units, then audit every RT-18 acceptance criterion and related
   RT-01 transport criteria before checking either task.

Historical implementation notes for GLM (now satisfied by RT-18; retained as context):

- Start limiter regressions in core `shared/rate-limit.ts` and its existing
  provider matrix. A saturated memory limiter must reject a *new* key after
  pruning expired buckets; never evict a live spent bucket to admit it, because
  that restores quota. Existing bucket increments must still work at capacity.
- Validate Redis endpoint scheme/embedded credentials/redirect behavior before
  authenticated fetch. Keep diagnostic text free of tokens/URLs. Prove that
  redirects cannot forward bearer credentials to another origin; choose and
  document any supported local-development exception explicitly.
- Frame namespace/key pairs and bound their final UTF-8 encoding before backend
  I/O. Distinguish logical application keys from provider limits. Audit the
  evaluated scope/caller composite for the same collision risk. Record the
  one-time effect on existing limiter bucket names; do not silently reset them
  during ordinary requests or retries.
- Define a pure provider capability model without library-to-framework imports.
  Separate locality, persistence, consistency, expiry precision, supported
  operations and atomic increment. DO cache get/set does not make an arbitrary
  read-modify-write atomic. Database guarantees depend on provider/read settings;
  custom providers without declarations remain unknown rather than implicitly
  distributed. Expose installed/configured backend facts and millisecond units
  in inspection without executing config modules or revealing credentials.
- A requested guarantee must be checked before the first hit/write. Add denied
  mutation/provider-spy tests, inspection fixtures and the existing multi-request
  transport matrix. Keep actual abort delivery/live providers as separate
  evidence gates. Review every original RT-18 acceptance sentence before marking
  completion; these notes explain the remaining work rather than replacing scope.

Done when: Fake-clock and provider tests prove expiry boundaries and counter
behavior. Multi-request tests prove supported shared limits. KV behavior is not
described as an atomic global counter. Inspection shows backend and units.
Tests distinguish client debounce from actual server enforcement. Dependency: RT-25.

<a id="rt-19"></a>
### RT-19: Realtime lifecycle and recovery

Purpose: Applications need to show connection state and recover after a network
break. A reconnect must restore current state without silently repeating mutations.

Baseline: SSE and WebSocket connections exist. EventSource reconnects at the
browser level, but a full application recovery contract remains open.

Approach: Expose connection status, last failure, reconnect attempt, and resync
completion. Define bounded reconnect backoff for WebSockets. Use cursors or
revisions to detect missed updates. Resync from an authoritative snapshot when
history is unavailable. Resolve pending calls with a known result or an explicit
uncertain-outcome error. Keep action responses separate from broadcast state.

Start in core `shared/transport-connections.ts`, runtime providers, framework
SSE/WebSocket handlers, and the CF-05 coordinator.

Done when: Browser/runtime tests cover disconnect during a mutation, missed
events, expired cursors, reconnect after restart, and component disposal.
Recovered state matches the server. No action runs twice merely because a
socket reconnects. Dependencies: RT-01, RT-06, and CF-05.

<a id="rt-20"></a>
### RT-20: SSR and hydration diagnostics

Purpose: A hydration mismatch needs a component and field explanation. A generic
browser warning makes agents guess whether server data, serialization, or markup
caused the mismatch.

Baseline: SSR and hydration exist, with new DI/SSG lifecycle coverage. Contextual
mismatch diagnostics and reusable test helpers remain open.

Approach: Attach development metadata to render/hydration boundaries. Report
source location, component identity, state path, and mismatch category. Limit
captured values and redact sensitive data. Define the behavior for expected
client-only differences. Preserve production bundle size and avoid embedding
absolute source paths or debugging state in production output.

Start in `packages/renderer/src/`, core `shared/cossack.ts`, framework
`root.ts` and `client/app.ts`, and RT-29 test helpers.

Done when: Tests intentionally create text, structural, and state mismatches and
receive actionable diagnostics. Valid SSR hydrates without duplicate listeners
or duplicate resource loads. Browser tests cover nested components and retained
layout services. Dependencies: RT-04, RT-12, and RT-29.

<a id="rt-21"></a>
### RT-21: SSG diagnostics and compatibility

Purpose: A static build must explain which routes were rendered, skipped, or
rejected. Missing compiler plugins or an incompatible runtime must fail clearly.

Baseline: Public-only SSG, route validation before writes, real middleware,
environment resolution, and scoped service cleanup exist. Full reporting and
compatibility coverage remain open.

Approach: Add structured per-route results with route parameters, output path,
duration, status, and diagnostic cause. Detect missing or misordered required
plugins early. Test the supported Vite/Wrangler/plugin baseline through generated
applications. Retain the rule that validation failure prevents publishing partial
HTML or a misleading sitemap.

Start in framework `ssg-entry.ts`, `ssg-renderer.ts`, `ssg-config.ts`,
`vite-ssg-plugin.ts`, and their existing tests.

Done when: A mixed route fixture reports accurate render/skip/failure results.
Bad static parameters, duplicate outputs, protected output, and missing plugins
fail with source context. Production artifact tests confirm successful public
pages and sitemap URLs. Dependencies: RT-07, RT-12, and CF-01.

<a id="rt-22"></a>
### RT-22: Markdown metadata and localized output

Purpose: Content pages need typed metadata and predictable URLs. Two documents
must not silently write the same page or use the wrong locale during SSG.

Baseline: Markdown processing, frontmatter, and sitemap generation exist.
Shared frontmatter schemas and complete content/locale collision coverage remain open.

Approach: Define the supported frontmatter fields and extension mechanism.
Report wrong types with source locations. Derive route and output paths through
the same route model as TypeScript pages. Detect collisions across content,
parameterized pages, aliases, and locale variants. Render each locale with its
own request/configuration scope and canonical URL rules.

Start in framework `markdown-processor.ts`, `vite-plugin.ts`,
`sitemap-generator.ts`, and SSG modules, plus `docs/markdown.md`.

Done when: Invalid metadata fails before output. Mixed Markdown/TypeScript route
collisions are rejected. Locale pages contain the correct language, metadata,
and links with no cross-render leakage. Type tests cover the author-facing
frontmatter contract. Dependencies: RT-07, RT-21, and RT-27.

<a id="rt-23"></a>
### RT-23: DataTable and UI contracts

Codex DataTable implementation (2026-10-04): the UI root now exports a generic
DataTable and typed row/column/query contracts. Columns select a valid row key or
an accessor. Parents own HTTP queries, stale-response handling and selection.
Filtering, sorting and page-size changes reset page to 1. Stable IDs preserve
selection across pages and filters. Loading, errors, retry and empty states are
explicit. Native table controls expose labels, sort state and mixed selection.
Paging preserves focus through loading/boundaries, and retry returns focus to the
filter. A package-owned guide explains the contract and its accessibility needs.

Public type tests exposed extensionless UI declaration imports. UI builds now
rewrite relative declaration imports for NodeNext/Deno resolution. Consumer tests
reject invalid accessors and competing key/accessor definitions without weakening
DataTableProps with an arbitrary attribute signature.

Unit/SSR and Chromium HTTP-data tests verify the component. Generated Node and
local workerd apps now exercise server resources, URL queries, hydration without
duplicate reads, paging/filtering/sorting, history, selection and refresh retry.
Same-owner query navigation restores identified controls and unchanged text
selection. DataTable's optional unique `id` identifies its query/paging controls.
Next audit native attributes, events, labels, keyboard behavior and focus across
the remaining UI catalog.
Codex native-control audit (2026-10-04): Button, Input, Label, Checkbox, Switch and
Form now use typed native attributes and DOM event targets. Renderer component()
no longer adds an arbitrary prop index signature. Public declarations reject
misspelled props/listeners and invalid values. Chromium verifies native labels,
keyboard toggles, controlled reset, disabled/required behavior and FormData.
Checkbox now consumes its label prop; Switch renders children and updates its
native checked property. Sample and Studio consumers use correct prop/event types.
Themed follow-up verifies disabled styles from actual native state, including
fieldsets, and keyboard focus rings. RadioGroup/Slider now have typed native contracts,
property-based selection, stable radio identities and correct range initialization
and bounds changes. The [component inventory](./ui-contract-audit.md) records all
remaining audit work, starting with text/select wrappers and their SSR values.
The full RT-23 criteria below remain open. See the [checkpoint](./release-0.9.0.md#codex-data-table-2026-10-04).


Purpose: Applications need a typed table for real server data, and agents need
reliable component attributes, events, and accessibility guidance.

Baseline: The UI package has many primitives and templates. The task adds a
complete table contract and audits existing component interfaces.

Approach: Add typed row/column definitions, stable row IDs, sorting, filtering,
selection, and pagination. Support controlled server-driven state so large data
sets do not require loading all rows. Define loading, empty, and error views.
Audit native attribute forwarding, event types, keyboard behavior, labels, and
focus management across the catalog. Keep data access outside the UI package.

Start in `packages/ui/src/components/`, its public exports/tests, and table
recipes that consume RT-03, RT-08, and RT-15.

Done when: A generated app filters and pages server data without losing selection
incorrectly. Type tests reject invalid column accessors. Browser tests cover
keyboard and focus behavior. The generated catalog states attributes, events,
and accessibility requirements. Related tasks: CLI-08 and REL-01.

<a id="rt-24"></a>
### RT-24: Inferred configuration and required bindings

Purpose: Authors must discover missing configuration before a request fails deep
inside a method. Agents need the type and origin of a value without seeing secrets.

Baseline: Configuration factories, typed registry augmentation, and `binding()`
exist. Deployment preflight handles some Cloudflare requirements.

Approach: Improve factory inference and generate registry information from project
configuration. Allow required variables and bindings to declare type/coercion
and runtime requirements. Report missing names and the selected environment.
Track secret classification separately from values. Reuse the same metadata for
build checks, CLI inspection, and runtime errors.

Start in framework `config.ts`, `config-globals.ts`, configuration plugins,
`specs/config.md`, and CLI deployment inspection.

Done when: Misspelled configuration paths and incorrect inferred types fail
type tests. Missing bindings produce a named diagnostic before application use.
Concurrent environments cannot share configuration state. Diagnostics, hydration,
and catalogs never expose secret values. Dependencies: CLI-04, RT-25, and CF-03.

<a id="rt-25"></a>
### RT-25: Runtime capability checks

Purpose: Choosing Cloudflare, Node, Deno, or Desktop changes available transports
and infrastructure. The compiler and scaffold must describe those differences
before generating an application that cannot run.

Baseline: Runtime adapters and transport support checks exist. A shared capability
model across build, recipes, and inspection remains open.

Approach: Represent supported transports, persistent coordination, storage,
scheduled handlers, and other selected features as explicit capabilities.
Combine runtime capabilities with declared bindings. Distinguish unsupported,
missing configuration, and available-with-an-adapter. Do not reject portable code
just because a provider-specific optional module exists elsewhere in the project.

Codex acceptance audit (2026-10-03):

| Written requirement | Current evidence | Status |
| --- | --- | --- |
| Unsupported selections fail with feature/source before deployment | Shared core checker; scaffold and black-box CLI creation/composition reject native database/Desktop before writes; framework build checks still reject manually configured combinations | Verified |
| Supported fixtures build through published exports | Generated Node/Deno and Node/Cloudflare Desktop configurations in `cossack/tests/generated-runtime-build.test.js` | Verified |
| Desktop retains HTTP-only boundary | Desktop SSE rejection and generated mode-specific checks | Verified |
| Workers-only imports stay out of other runtime graphs | Every emitted server/Desktop JavaScript chunk checked in generated build fixtures | Verified |
| CLI-04 and CLI-05 consume the same model | All four recipes declare HTTP and selected database requirements; scaffold planning imports the pure core entry; framework/CLI use its re-export; identity and recorded-metadata tests verify one model | Verified |

The model covers transport-specific bindings, durable state, scheduled integration
requirements, filesystem access, and selected native database bindings. Node
production/dev WebSockets use the guarded router factory and have live tests.
Deno and Electron executable runtime coverage remains a broader release gate;
absence of those executables is not itself a missing build-time RT-25 criterion.
The completed four-recipe integration and repeated criterion audit close RT-25.
This does not claim Deno process execution or Electron packaging was verified;
those remain part of REL-03. Remote resource readiness is also a separate gate.

Start in framework `runtime-adapter.ts`, scaffold `registry.js`, and
`packages/node-adapter/`, `deno-adapter/`, and `desktop/`.

Done when: Unsupported feature/runtime fixtures fail before deployment with the
feature and source location. Supported fixtures build from published packages.
Desktop keeps its HTTP-only native boundary unless explicitly expanded.
Cloudflare-only imports do not enter other runtime graphs. CLI-04 and CLI-05
consume the same capability model.

<a id="rt-26"></a>
### RT-26: Storage providers and image diagnostics

Purpose: Uploads, downloads, and deletion need authorization and one discoverable
storage contract. Copying a demo S3 helper is insufficient for a reusable feature.

Baseline: RPC file uploads, image helpers, and a demo S3/R2 signing implementation
exist. That demo helper is not a published storage API.

Approach: Define provider contracts for local storage, R2, and S3. Include object
metadata, streamed transfer, deletion, signed access, progress, and cancellation.
Keep filesystem access in local adapters and credentials on the server. Apply
authorization before granting upload/download capabilities. Define key validation,
size/type limits, expiration, and incomplete-upload cleanup. Image diagnostics
must explain unsupported transforms or missing provider setup.

Start in framework `storage/s3.ts` as reference, upload transport handlers, core
`shared/image.ts`, and `docs/storage.md` and `docs/images.md`.

Done when: Provider tests exercise authorized CRUD, denied cross-user access,
expired access, cancellation, and metadata. Large transfers stay streamed.
Published imports replace demo-relative documentation imports. Dependencies:
RT-14, RT-24, RT-25, and CF-04.

<a id="rt-27"></a>
### RT-27: Localization tooling

Purpose: Missing keys and mismatched placeholders must fail during development,
not appear as broken text after deployment. Agents need to find untranslated
content and use the installed catalog correctly.

Baseline: Runtime localization, per-request locale scope, pluralization, and
language commands exist. Extraction, cross-catalog checks, and generated key
types need completion.

Approach: Extract statically discoverable translation calls with source locations.
Report dynamic keys as unresolved instead of inventing them. Compare locale
catalogs for missing/unused keys and placeholder differences. Generate key and
parameter types from the selected catalog contract. Preserve intentional string
keys and existing pluralization behavior.

Start in core `shared/i18n.ts`, framework locale/context modules, CLI
`commands/lang.js`, and `docs/localization.md`.

Done when: Fixtures cover missing keys, renamed placeholders, plural forms,
dynamic keys, and fallback locales. Generated types reject an unknown key or
missing parameter. Parallel SSR/SSG renders retain the correct locale.
JSON diagnostics support CLI-03 and CLI-07. Related task: RT-22.

<a id="rt-28"></a>
### RT-28: Devtools snapshots and timelines

Purpose: A developer or agent needs to connect a UI symptom to the navigation,
resource load, RPC, or state update that caused it.

Baseline: Click-to-source and component state inspection exist. A structured
snapshot service and correlated event timeline remain open.

Approach: Define a bounded development event stream with timestamps, request/call
IDs, route/component identities, lifecycle phases, and redacted summaries.
Expose snapshots for state, resources, service scopes, and transport status.
Have browser tools, CLI, and MCP consume the same schema. Keep trace collection
opt-in and avoid retaining complete payloads, files, or credentials.

Start in framework `client/devtools.ts`, existing Vite development integration,
and the runtime boundaries instrumented by RT-01, RT-09, RT-12, and RT-19.

Done when: One UI action can be followed through request, result, and state update.
Disconnects and canceled work have terminal events. Buffers stay bounded.
Production builds exclude development endpoints and source metadata. CLI-07 can
read the same facts without depending on a browser console layout.

<a id="rt-29"></a>
### RT-29: Framework-faithful test utilities

Purpose: Tests must exercise the lifecycle that production uses. Helpers that
construct simplified components can pass while auth, DI, hydration, or RPC is broken.

Baseline: `packages/test-utils/src/index.ts` has basic browser rendering helpers.
The root unit command currently excludes this package. It needs its own meaningful
suite and broader published helpers.

Approach: Build separate browser and server entry points with typed state/props,
request context, auth fixtures, DI scope setup, hydration, and RPC dispatch.
Use framework adapters or injected contracts without making core depend on framework.
Make cleanup awaitable. Add utilities for controlled async results and cancellation.
Test the helpers themselves and include their suite in the root test workflow.

Start in `packages/test-utils/src/index.ts`, its package exports, and the root
test scripts. Use existing framework integration fixtures as behavior references.

Done when: A helper-created app behaves like a generated app for the same fixture.
Tests prove request isolation, real policy enforcement, server-code stripping,
hydration, and cleanup. Published tarball imports work without repository aliases.
Document what browser simulation cannot prove and retain real workerd/browser tests.
Dependencies: RT-01, RT-12, RT-20, and REL-02.

## New application services

These are application features, not replacements for component lifecycle tasks.
Each feature needs a portable contract and explicit provider support. A local
test adapter must not be described as durable production infrastructure.

<a id="svc-01"></a>
### SVC-01: Background jobs

Purpose: Applications need to process work after the HTTP response, survive
transient failure, and inspect failed jobs. Component `@Task` methods do not
provide durable background execution.

Baseline: Open as a shared framework feature.

Approach: Define typed job payloads, handler registration, dispatch, delays,
attempt limits, retry classification, and failure inspection. Add a Cloudflare
Queues adapter and a deterministic local test adapter. Give jobs explicit
tenant/actor context in serializable payloads instead of retaining a request.
Support idempotency keys, which prevent repeated effects for one logical job.
State the storage and provider limits of that guarantee. Do not promise exactly-once
external side effects merely because the queue acknowledges once.

Start with new portable contracts, runtime entry generation in scaffold, and
capability metadata from RT-25. Reuse CLI-03 diagnostics and CF-08 tracing.

Done when: Tests cover duplicate delivery, delay, transient/permanent errors,
exhausted retries, cleanup, and worker restart. A generated Cloudflare app executes
a real queue handler. Failed jobs expose redacted actionable state. Dependencies:
RT-24, RT-25, and CF-04.

<a id="svc-02"></a>
### SVC-02: Schedules and Cron

Purpose: Applications need recurring maintenance and report jobs without a
handwritten Worker entry for every project.

Baseline: Open as framework integration.

Approach: Declare named schedules that invoke shared job handlers. Generate the
Cloudflare scheduled handler and Cron configuration. Specify the schedule's time
basis, overlap behavior, retry ownership, and missed-run behavior according to
the selected provider. Provide local listing and one-shot execution for tests.
Keep scheduling separate from the business logic in SVC-01.

Start in scaffold Worker entry/configuration generation and the job registry.
Retrieve the current provider documentation before defining supported expressions.

Done when: A generated app registers and runs the expected handler. Local
one-shot execution uses the same payload validation and cleanup as provider events.
Duplicate or overlapping triggers follow the documented policy. Invalid schedule
definitions fail during build/inspection. Nodes without a scheduler get an explicit
adapter requirement. Dependencies: SVC-01, RT-25, and CF-01.

<a id="svc-03"></a>
### SVC-03: Notifications

Purpose: Applications need reusable email and in-app notifications with delivery
state and user preferences. Direct calls scattered through page methods cannot
reliably track retries or duplicate sends.

Baseline: Scaffold development tooling already supports SMTP configuration.
Templates, preferences, persistence, and a notification service remain open.

Approach: Define typed notification templates and channels. Separate rendering,
recipient preferences, enqueueing, provider delivery, and delivery-status recording.
Reuse SMTP where applicable and use an explicit Cloudflare email adapter when
selected. Keep database persistence supplied through an optional adapter.
Distinguish queued, sent to provider, failed, and delivered only when the provider
actually supplies delivery evidence. Define in-app read/unread behavior.

Start with `packages/scaffold/template/scripts/dev.js` and existing email recipes
as references, then shared service contracts and SVC-01 jobs.

Done when: Tests cover preference changes, template escaping, retry without an
unwanted duplicate send, provider rejection, and per-user in-app isolation.
Local previews do not send real mail. Dependencies: SVC-01, RT-14, and RT-24.

<a id="svc-04"></a>
### SVC-04: Durable multi-step workflows

Purpose: Some processes must pause, resume, and retry individual steps across
requests or restarts. A long async function inside an RPC response cannot provide
that execution model.

Baseline: Open. This task integrates durable workflow infrastructure.

Approach: Supply typed workflow input, identity, invocation, status, events, and
inspection around Cloudflare Workflows. Keep step persistence, waits, and retries
aligned with the provider's actual execution rules. Generate binding/entry setup
and provide local deterministic tests. Reuse job/notification operations where
appropriate. Make step side-effect and idempotency requirements explicit.

Start with runtime capability contracts and scaffold generation. Keep the native
Cloudflare entry separate from core. Do not build a competing workflow engine
or claim parity for runtimes without a configured durable provider.

Done when: A workflow survives interruption between steps, resumes without
repeating completed work incorrectly, and reports failures and waiting state.
Tests cover an external event and a failed retried step. Dependencies: SVC-01,
RT-24, RT-25, CF-04, and CF-08.

<a id="svc-05"></a>
### SVC-05: Turnstile integration

Purpose: Public forms need an optional bot-protection component and server-side
token verification that fit the existing validation flow.

Baseline: Open as a packaged component and server helper.

Approach: Add a browser component with typed success, expiry, and error events.
Add a server helper that verifies tokens with the configured secret and expected
request context. Keep the secret server-only. Compose verification with RT-02
so that rejection prevents the protected mutation. Provide documented local test
configuration and an injectable verifier for deterministic tests.

Start in the UI component package, auth or another suitable server utility
boundary, configuration metadata, and the validated form recipe.

Done when: Expired, reused, invalid, and missing tokens follow the documented
provider behavior. Server tests prove no mutation after rejection. Browser tests
cover widget reset, script failure, disposal, and form resubmission. A spoofed
client success event grants nothing. Dependencies: RT-02, RT-10, and RT-24.

## Cloudflare development and deployment

The Cloudflare goal is one coherent development-to-deployment path. Environment
selection must remain consistent through types, build, static rendering,
database tooling, and deployment. Local validation must distinguish itself from
checks that require authenticated access to real resources.

<a id="cf-01"></a>
### CF-01: One selected environment throughout the build

Purpose: Building with production variables and deploying with a staging name
can publish incorrect HTML or bind the wrong resources. Environment selection
must happen before any environment-dependent build step.

Baseline: `cossack deploy --env` sets the build environment, generates binding
types, builds with Vite, and compares the resulting artifact with the selected
source configuration. SSG understands named environments and dotenv precedence.

Approach: Finish one resolved target contract shared by dev/build/deploy,
migrations, and scaffold output. Preserve Wrangler's inheritance rules through
its parser. Treat Vite mode and Cloudflare environment as separate choices.
Deploy the exact flattened artifact without selecting the environment again.
Report the selected target in JSON results and fail on stale build metadata.

Start in CLI `deployment.js`, `commands/deploy.js`, framework `ssg-config.ts`,
and database tooling context.

Done when: Generated default/staging fixtures use the expected values, bindings,
types, database target, and static URLs. Missing named bindings never inherit
accidentally. Tests include custom D1 migration paths rewritten by Vite.
Dependencies: CLI-03, RT-16, and RT-24.

<a id="cf-02"></a>
### CF-02: Explicit database targets

Purpose: A migration command must make it clear whether it affects local state
or a remote database. An environment name alone must not silently imply remote mutation.

Baseline: Tooling context and D1 local/remote selection exist. Real local D1 tests
cover schema and migration behavior. Live remote verification remains unperformed.

Approach: Complete target semantics for each provider. Require an explicit remote
choice for operations that otherwise use local development storage. Show account,
environment, binding/resource identity, and operation mode without credentials.
Reject conflicting flags before adapter construction. Keep migrations in the
existing database migration system instead of adding a second Wrangler SQL history.

Start in database `tooling/cloudflare.ts`, `config.ts`, runtime adapters,
and CLI `commands/db-run.js` and database command wrappers.

Done when: Tests prove the selected adapter receives the intended target and
read-only intent. Local commands share the app's local D1 state. Remote selection
cannot fall back to local or another environment after failure. Add documented
opt-in remote smoke coverage and label unrun remote checks accurately.
Dependencies: RT-15, RT-16, and CF-01.

<a id="cf-03"></a>
### CF-03: Secrets, placeholders, and binding types

Purpose: Generated applications need usable local secrets and explicit production
requirements. Placeholder resource IDs and stale binding types must fail early.

Baseline: Completed for the checklist scope. Scaffolds declare required secret
names, generate local APP_SECRET, preserve it during composition, ignore local
environment files, and generate deployment types. Preflight rejects secret-like
vars and placeholder resource IDs.

Approach: Preserve these guarantees as new services add bindings and secrets.
Generate types from the selected environment. Keep diagnostics name-only.
Required secret declarations do not prove that remote secrets exist. Wrangler
validates remote requirements during deployment. A future authenticated diagnostic
can inspect secret names without reading values.

Start in scaffold environment/configuration generation, CLI `deployment.js`, and
framework library type-generation configuration.

Done when: Regression fixtures cover new required names, environment ignore rules,
preserved local values, redaction, and matching generated types. A local check
reports remote status as unverified. No credential literals enter generated
tracked files. Related tasks: RT-24, CF-04, and CF-11.

<a id="cf-04"></a>
### CF-04: Resource selection and setup

Purpose: A generated binding must point to a real resource or use supported
provisioning. A fake Hyperdrive ID postpones an inevitable failure until deployment.

Baseline: D1 scaffolds use supported automatic provisioning. Hyperdrive still
uses a rejected placeholder. Full resource selection/setup flows remain open.

Approach: Add a resource plan that distinguishes existing, create, provider-managed,
and unresolved resources. Support D1, R2, KV, Hyperdrive, and bindings needed by
selected Durable Object, Queue, and Workflow features. Record account/environment
ownership and whether the command can create that resource. Accept explicit IDs
in noninteractive mode. Never label every absent ID as automatically provisioned.
Use current project Wrangler capabilities rather than guessed REST operations.

Start in scaffold `index.js` and `registry.js`, CLI `deployment.js`, and shared
Cloudflare inspection services. Extend diagnostics with optional authenticated
resource existence/access checks while retaining a read-only local mode.

Done when: A generated app contains valid bindings or a precise unresolved action.
Plan-only runs create nothing. Tests cover wrong accounts, unavailable resources,
unsupported provisioning, and repeated application of the plan. Dependencies:
CLI-03, RT-24, RT-25, and CF-01.

<a id="cf-05"></a>
### CF-05: Distributed SSE coordination

Purpose: Worker-local Maps cannot coordinate clients whose requests reach
different Worker instances. Shared page state must survive instance changes and
concurrent mutations. A generator's output must still belong to its own caller.

Baseline: The application still uses the Map in framework `transports/sse.ts`.
`SseDurableObject.ts` is a source-only prototype. Its integration test proves a
callback/stream mechanism across two workerd Workers, but no application route
uses it. It is not a package export or scaffold feature.

Approach: Use one SQLite-backed DO for each authorized page/scope tuple. Let it
serialize actions and persist authoritative public state and bounded event history.
Execute user code through a callback into its original Worker request. This keeps
auth, Hono context, DI, ORM, locale, and middleware ownership in the request.
Do not place generators, stream writers, or request objects in a global Worker store.

Implement the integration in this order:

1. Review prototype failure and cancellation behavior before exposing its API.
   Add callback failure, queue saturation, malformed-frame, and cancellation tests.
2. Add the Cloudflare-only package entry, generated binding, and SQLite migration.
   Keep Node/Deno imports free of the native Cloudflare base class.
3. Make SSR initialize a scope once and read its authoritative snapshot.
   A later render must not reset another tab's state.
4. Authenticate and recompute scope before constructing components or invoking actions.
   Use an encoded tuple key, not ambiguous colon concatenation.
5. Hydrate authoritative state inside the serialized action. Specify how page,
   child-component, and service state differ. Ignore stale browser shared-state
   snapshots without losing legitimate explicit action inputs.
6. Handle ordinary JSON values, custom Responses, redirects, and generators.
   The prototype currently accepts successful NDJSON only. Preserve middleware
   headers and the existing response-lifetime cleanup contract.
7. Add subscriptions that read persisted updates in their own request context.
   Respect backpressure, remove timers/listeners on closure, and bound buffering.
8. Add event cursors and snapshot resync after expired history. Support broadcast
   events and client actions as well as state updates.
9. Define restart behavior for in-flight callbacks. Persist operation identity
   where needed. A lease or state revision alone cannot prevent repeated external
   side effects. Report uncertain outcomes and never blindly replay a mutation.

Start in `packages/framework/src/SseDurableObject.ts`, `transports/sse.ts`,
`transports/rpc-stream.ts`, `router.ts`, and core `transport-connections.ts`.
Follow the additional source map in the handoff.

Done when: A generated app using published exports passes a real multi-Worker
test for concurrent mutations, cross-instance subscriptions, scope isolation,
reconnect, state persistence, and original request/ORM context. Tests prove
that cancellation releases owned resources and that wrong scopes are denied
before constructors. Node/Deno behavior is explicit. Dependencies: RT-01, RT-12,
RT-19, RT-25, CF-04, and CF-06.

<a id="cf-06"></a>
### CF-06: Built-artifact runtime tests

Purpose: Source-unit tests cannot prove that security stripping, package exports,
Vite configuration, and Cloudflare bindings work together in the deployed artifact.

Baseline: The generated staging-app test covers real Vite/Wrangler build,
deployment dry run, workerd, D1 stream queries, request context, SSG, and protected
assets. A second test covers the SSE prototype directly from source.

Approach: Expand a small generated-app matrix through published packages.
Exercise authentication, component/service RPC, streaming, assets, migrations,
bindings, and integrated realtime behavior. Keep local cloud emulation distinct
from authenticated remote smoke tests. Use native HTTP cancellation where an
in-memory request helper cannot reproduce disconnect behavior.

Codex extension (2026-10-03): the generated staging test now uses production
build flags and real Chromium hydration through hashed client assets. The fixture
helper `packages/cossack/tests/fixtures/worker-rpc-acceptance.js` writes protected
HTTP/SSE pages, a nested service and test-only D1 gate/audit endpoints. It observes
nested multipart yields/final results, auth/input rejection, D1 ownership through
pulls/disposal, native body representations, cookies, redirects and one-time flash.
Keep those audit/control endpoints confined to temporary test apps. The separate
two-Worker test covers the native-marker/MIME regression, unchanged state and
coordinator progress. CF-06 remains checked; broader tarball/runtime release gates
remain open and this evidence does not establish a live deployment.

Start in `packages/cossack/tests/deploy-integration.test.js`,
`sse-coordinator-integration.test.js`, scaffold tests, and production-bundle scripts.

Done when: The generated artifact uses the selected environment and actual
provider handlers. No secret/server-only implementation reaches browser bundles.
Tests observe behavior rather than only configuration text. Teardown closes
servers and temporary resources. The prototype test alone cannot close CF-05.
Dependencies: CF-01, CF-02, CF-05, and REL-02.

<a id="cf-07"></a>
### CF-07: Public-only SSG and protected assets

Purpose: Static output must not bypass authentication or publish user-specific
content. Asset routing must enforce the same relevant policies as live page requests.

Baseline: Completed for this checklist item. SSG runs a real anonymous request
through middleware. Worker-first asset serving enforces global and owning route
policies. Output is rejected for authentication, redirects, cookies, and private
or credential-dependent responses.

Approach: Preserve these invariants while adding locale output, new middleware,
and previews. Resolve owning layouts from source ancestry. Keep static aliases,
files under protected routes, missing files, and 404 fallback in the test matrix.
Do not optimize public asset routing by bypassing unknown application middleware.

Start in framework `assets.ts`, `ssg-request.ts`, `ssg-renderer.ts`,
`vite-ssg-plugin.ts`, and existing asset/public-SSG tests.

Done when: Existing denial and successful-public-build tests continue to pass.
Protected files remain denied through aliases and direct file requests. Failed
generation publishes no partial route outputs. Authorized responses retain
middleware headers. Related tasks: RT-21, RT-22, and CF-06.

<a id="cf-08"></a>
### CF-08: Production logs and build budgets

Purpose: An operator needs to connect a production error to a route and action.
Builds also need to reveal oversized bundles or startup regressions before upload.

Baseline: RPC request IDs and some error logging exist. A complete production
logging, source-map, and budget workflow remains open.

Approach: Add structured logs with request/action IDs, route identity, duration,
runtime, and redacted failure codes. Generate observability configuration with
explicit sampling defaults. Preserve source maps for server diagnosis through
the supported deployment path. Measure bundle and startup costs from actual
artifacts. Define project-configurable warning/error budgets using current
provider limits rather than hardcoded assumptions from old documentation.

Start in framework logging/request middleware and RPC handlers, scaffold Worker
configuration, CLI build/deploy orchestration, and RT-28 event contracts.

Done when: A failed action can be located from its returned request ID. Logs
exclude credentials and full sensitive payloads. A deliberate budget regression
fails with the measured value and limit. Source maps resolve a production fixture
stack to authored code. Dependencies: RT-01, RT-24, and CF-06.

<a id="cf-09"></a>
### CF-09: Preview and CI resource lifecycle

Purpose: Branch tests need production-like behavior without modifying production
data. A preview URL identifies code but does not establish resource isolation.

Baseline: Deployment docs explain separate resources and rollback limits.
Automated preview creation, smoke checks, cleanup, and promotion remain open.

Approach: Plan code and bound resources together. Identify which D1, KV, R2,
Durable Object, Queue, Workflow, and service bindings are isolated or shared.
Use native Worker Previews only after upgrading and testing the pinned tooling.
The checkpoint resolves Wrangler 4.114.0. The documented native preview minimum
is 4.135.0. Retrieve current limitations before implementation.
Track resource ownership so cleanup deletes only preview-owned resources.
Define an explicit production build/promotion process and migration order.

Start in CLI deployment services, scaffold CI templates, and CF-04 resource plans.
Use [Cloudflare preview documentation](https://developers.cloudflare.com/workers/previews/)
and [rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

Done when: CI creates a preview, runs smoke tests, and cleans its owned resources
without changing production. Failures leave inspectable state and cleanup can
be retried. Code rollback does not claim to restore database or object data.
Dependencies: CF-01, CF-02, CF-04, CF-06, and CF-10.

<a id="cf-10"></a>
### CF-10: Deployment documentation and compatibility baseline

Purpose: A correct framework still fails users if its deployment guide names
the wrong entry file, bypasses its build, or assumes incompatible tooling.

Baseline: Deployment documentation now covers custom domains, environment
selection, dry-run effects, Node entry paths, and code/state rollback differences.
The tested matrix and complete executable guide coverage remain open.

Approach: Maintain a tested combination of framework, Vite, Cloudflare Vite plugin,
Wrangler, runtime flags, and compatibility date. Explain custom domains versus
routes and build output versus source configuration. Make CI execute guide
commands in disposable generated projects. Detect unavailable Wrangler parser
APIs with an actionable diagnostic because the current CLI uses version-sensitive APIs.

Start in `docs/deployment.md`, `docs/installation.md`, scaffold package scripts,
CLI `deployment.js`, and published/generated-app fixtures.

Done when: A new user can follow the guide without importing repository internals
or manually patching generated configuration. Supported combinations pass build
and dry-run tests. Unsupported combinations fail clearly. Dependencies: CF-01,
CF-06, CF-09, and REL-02.

Codex RT-04 acceptance (2026-10-03) also found generated Node plain Vite dev
returns 404. Development guide claims must be tested with the actual CLI and
generated configuration; an acceptance fixture's private SSR bridge does not
establish supported Node dev behavior. Track the implementation under REL-03.

<a id="cf-11"></a>
### CF-11: Tracked credential removal

Purpose: Demo and template configuration must not contain reusable credential
values. Removing current values and rotating a previously exposed credential
are different operations.

Baseline: Tracked demo APP_SECRET and R2 credential values were removed.
The related checklist item is complete for repository changes. External rotation
was reported as required for any still-active credentials and was not performed.

Approach: Preserve name-only declarations, local ignored values, and generated
type redaction. Review added configuration and documentation for accidental
credential copies. Do not reproduce removed values from Git history in plans,
logs, screenshots, or test fixtures. Record external rotation evidence separately
if an authorized operator later performs it.

Start in framework/scaffold Wrangler configuration and environment generation.
Use CF-03 checks when adding new provider credentials.

Done when: The current source and generated tracked files remain free of real
credential values. Release notes accurately distinguish repository cleanup from
external rotation. This task does not authorize history rewriting or account changes.

## Release gates

These tasks establish release readiness after implementation. A passing narrow
test is evidence for its behavior only. It does not close unrelated features
or the final release audit.

<a id="rel-01"></a>
### REL-01: Reported regressions

Purpose: The original request started with downstream reports. The broader
refactor must retain those fixes and prove that the reported user behavior improves.

Baseline: The checkpoint marks report fixes complete. The current user-edited
`reports.md` describes CSM-004, the duplicate Tabs underline. It remains outside
the implementation commit. Earlier verified work also covers package and SSG regressions.

Approach: Preserve report IDs and reproduction evidence. Keep the single animated
Tabs underline and its position updates. Keep compatible Solar Icons peer ranges
and framework declaration boundaries. When the user adds a new report, record
it separately instead of treating the existing completion flag as proof.

Start in UI Tabs/tests, framework package-contract tests, and the release
verification log. Read `reports.md` without overwriting the user's edits.

Done when: Report-specific regressions remain covered through the refactor.
Rendered behavior, package installation, and SSG execution match the requested
outcomes. Visual fixes retain keyboard/focus behavior. Related tasks: RT-23 and REL-03.

<a id="rel-02"></a>
### REL-02: Executable docs and published packages

Purpose: Repository aliases and workspace links can hide missing exports,
undeclared dependencies, and broken examples. A user installs package artifacts,
not the repository source tree.

Baseline: Several package-contract and generated-app tests exist. The full
tarball/runtime/recipe matrix and executable documentation coverage remain open.

Approach: Pack packages into a temporary local artifact set. Install them into
fresh generated applications without workspace path aliases. Compile documented
imports and examples. Build relevant presets for Cloudflare, Node, Deno, and
Desktop. Exercise optional feature combinations and server-code stripping.
Keep the matrix representative and document why each fixture exists.

Start in `scripts/test-local-scaffold.mjs`, package exports/files declarations,
scaffold tests, and examples from CLI-05 and CLI-08.

Done when: Runtime imports and declaration imports resolve from tarballs alone.
No demo-only module or missing dependency is required accidentally. Published
test helpers and new provider entries work. Documentation examples use only
the final public APIs. Dependencies: all API-changing tasks and RT-29.

<a id="rel-03"></a>
### REL-03: Complete verification run

Purpose: Integration changes need a reproducible release gate. A historical
green run cannot prove that later API or configuration changes are correct.

Baseline: At `e5dbae4`, build, root TypeScript, all 11 package type checks,
database bundle audit, and 2,125 tests passed. Playwright and the complete
published-tarball matrix were not run for that checkpoint.

Approach: Build dependencies first. Run `pnpm tsc --noEmit`, `pnpm typecheck`,
`pnpm audit:bundle`, `pnpm test:unit`, relevant Playwright suites, and generated
artifact tests. Include the test-utils suite after RT-29. Do not run type checks
while another command deletes dependency declarations. Record exact commands,
counts, failures, and unavailable external checks.

Start in root scripts and package test/build scripts. Fix meaningful failures
instead of changing assertions only to preserve a green gate.

Done when: Required suites pass on the final implementation and package versions.
Runtime/browser gates cover the changed features. Missing external evidence
remains explicitly open. A source-only prototype test cannot substitute for a
published application test. Dependencies: REL-02 and completed feature work.

**Open Node development gate — Author: Codex (2026-10-03).** A generated Node
app's plain Vite dev command serves no Cossack page and returns 404. The RT-04
diagnostic fixture supplies a test-only getRequestListener/ssrLoadModule bridge
to exercise consuming-app DEV behavior; production uses the real generated Node
server. This bridge is not present in scaffold/CLI development support.

Implement first-party Node Vite HTTP/SSR integration in Node-specific adapter or
tooling, preserving the rule that core and libraries cannot depend on framework
or import Node request APIs into shared runtime code. Compose generated Vite
configuration, asset handling and framework routing without swallowing Vite's
module/HMR endpoints. Verify initial page rendering, RPC, cookies, source reload,
startup errors and bounded shutdown through the actual generated CLI dev command.
Then remove the fixture's redundant private bridge and use the supported path.
Recheck production and Cloudflare development before completing this gate.

<a id="rel-04"></a>
### REL-04: Versioning and release documents

Purpose: A release must present one consistent version and explain intentional
API changes. Users need a migration path from 0.8.x.

Baseline: All package versions remain 0.8.3. The release is not ready to bump.

Approach: After implementation gates pass, use the repository bump process to
set release packages and internal ranges to 0.9.0. Update the lockfile and
generated template version references. Write a changelog, migration guide, and
release notes around final behavior. Include breaking RPC rejection semantics,
runtime/binding requirements, removed APIs, configuration changes, and replacement
examples. Rebuild and repeat affected package/install gates after the bump.

Start in `scripts/bump.mjs`, package manifests, scaffold generation, and release
documentation conventions already present in the repository.

Done when: All intended release artifacts agree on version and dependencies.
The migration guide compiles and describes real final APIs. Pack/install tests
do not retain stale 0.8.x references. Release preparation remains distinct from
an actual package publication or Cloudflare deployment. Dependencies: REL-02 and REL-03.

<a id="rel-05"></a>
### REL-05: Requirement-by-requirement completion audit

Purpose: A large refactor can appear finished while entire checklist rows remain
partially implemented. Completion needs evidence for each requirement.

Baseline: Open. The 0.9.0 objective remains unfinished.

Approach: For every task ID, record the final public API, implementation files,
tests, documentation, and relevant generated-app/runtime evidence. Compare actual
behavior with the Purpose and Done when sections here. Record unsupported
capabilities and external dependencies honestly. Revisit broader rows whose first
subfeature passed earlier. Do not reduce their scope to that subfeature.

Start with all 58 linked checklist rows and the final diff since `e5dbae4`.
Use the later Codex review to challenge completion claims and inspect important
concurrency, auth, serialization, and runtime-boundary changes.

Done when: Every explicit requirement is implemented and proven at the required
scope. There are no unchecked obligations hidden behind green unit tests or
release notes. If evidence is missing, keep the item open and state the next
test or implementation step. Depends on every other release task.

## Cross-feature acceptance scenarios

These scenarios connect features that can otherwise pass in isolation.
They supplement each task's tests. They do not introduce separate product scope.

1. A protected resource page loads a typed server query, filters through URL
   state, submits a validated edit, and shows a field error without losing input.
   An unauthorized direct RPC request cannot perform the edit.
2. Two users in one permitted realtime scope edit concurrently through different
   Workers. State converges, a disconnected caller gets an explicit outcome,
   and another scope receives no private updates.
3. A server action creates a background job and returns. The job retries after
   a transient failure, records delivery state, and respects notification preferences.
   No original request or database handle stays alive for the background job.
4. An agent inspects an installed app, obtains a recipe/upgrade plan, applies
   it without overwriting edited files, and runs structured checks. CLI and MCP
   report the same metadata and diagnostic codes.
5. CI builds a staging artifact with staging bindings, applies an explicit
   migration plan to the intended test target, tests protected assets and RPC,
   and cleans preview-owned resources. Production resources remain unchanged.

## How GLM records progress

For each implementation slice, record the task IDs and the actual behavior changed.
Record unresolved design choices before publishing an API. Keep the explanation
short enough that the next agent can distinguish a decision from an experiment.

Use this record shape in the verification log or a linked implementation note:

```text
Tasks: RT-01, CF-05
Behavior completed:
Public API and compatibility changes:
Implementation files:
Tests and observed results:
Generated-app or runtime evidence:
Remaining work and known limits:
```

Update completion boxes only when the complete row meets its acceptance criteria.
Keep prototype status visible until the published application path uses the feature.
Preserve unrelated user files, including the uncommitted reports and tool settings.
Use the final review to audit GLM's commits against this plan and the checkpoint.
