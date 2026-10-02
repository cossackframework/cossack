# Cossack 0.9.0 implementation plan

This document explains all 58 tasks in the release checklist. It gives GLM the
reason for each task, the intended result, a starting implementation approach,
and the evidence needed to finish it. The implementation baseline is commit
`e5dbae4`, dated 2026-10-02. Later commits must update the completion evidence.

Read this document with [the handoff](./handoff-0.9.0.md),
[the release checklist](./release-0.9.0.md), and [the architecture](./architecture.md).
The checklist records scope and completion. This plan explains the work.
The handoff records the exact stopping point and commands that passed.

The latest [Codex upgrade checkpoint](./release-0.9.0.md#codex-cli-upgrades-2026-10-02)
records CLI-06 completion and remaining acceptance work. The preceding machine
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

Start in core `shared/rpc-stream.ts`, `method-proxy.ts`, `service-scope.ts`,
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

<a id="rt-07"></a>
### RT-07: Typed routes and effective route metadata

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

<a id="rt-08"></a>
### RT-08: Typed URL state

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

Done when: A filtered list can be copied into a new tab with identical state.
Back/forward restores filters and results. Invalid page numbers use the documented
policy. Default values serialize predictably. Tests cover browser history,
SSR parity, rapid changes, and Unicode. Dependencies: RT-03, RT-07, and RT-09.

<a id="rt-09"></a>
### RT-09: Navigation completion and diagnostics

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

Approach: Choose one explicit public duration convention and normalize at provider
boundaries. Record breaking renames if needed. Declare expiry precision, atomic
increment support, locality, and consistency per provider. Reject a requested
guarantee that the selected provider cannot supply. Apply server rate limits to
component/service RPC and realtime calls as well as API routes.

Start in framework `cache.ts`, core `shared/rate-limit.ts`, framework transport
handlers, and `specs/cache.md`.

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

Codex checkpoint (2026-10-03): `checkCapabilityRequirements` now returns
source-bearing diagnostics from the shared model, and `cossackPages` accepts
explicit `capabilities` declarations checked before bundle output. Real Vite
fixtures cover unsupported/missing-binding failure and portable supported builds.
Page transport requirements now derive automatically from the published
`page-inspection` parser shared with the CLI when a build runtime is selected.
Generated recipes now select the web adapter or Desktop mode automatically.
Cloudflare builds resolve binding names through the installed Wrangler parser,
using an explicit environment or CLOUDFLARE_ENV. Next verify actual generated
application configurations and integrate selected feature requirements into
recipe planning where applicable.
The adapter audit found that Node/Deno do not dispatch schedules; their
`scheduledHandlers` capability now reports `adapter-required` and selected
requirements fail builds. Do not mark this capability available until a real
scheduling integration is configured and verified. Generated minimal Node/Deno and Node+Desktop builds now run through actual
recipe configuration. Node HTTP SSR executes from the built app; Desktop rejects
SSE. Deno runtime and Electron launch are not covered by these build tests.
Generated Node entries still lack WebSocket adapter attachment; reconcile that
with the capability profile and security/lifecycle requirements before completion.
The guarded framework WebSocket factory now creates nested layout service scopes,
uses original page params during bootstrap, and assigns scope-tree cleanup to the
page without changing service-state ownership. Next wire Node through this hook,
then make adapter eviction/shutdown await component destruction. Test concurrent
creation for the same runtime key and real authenticated connections from a
generated app. Factory tests alone do not prove transport lifecycle behavior.
Deno now deduplicates pending scope creation, reserves capacity, and awaits idle
entry disposal. Socket-event tests cover early close and retry after failure.
Explicit `dispose()` and server shutdown/completion now drain pending creation,
active actions, and retired entries before destroying components. These paths
have adapter tests; validate with real Deno sockets when Deno is available.
Actions must settle for cleanup to finish. Idle pruning currently occurs on
activity rather than a timer. Continue Node guarded integration in parallel with
this outstanding runtime acceptance.



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
