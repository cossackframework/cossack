# Cossack 0.9.0 implementation plan

Compacted by Codex on 2026-10-04. Updated on 2026-10-05. The release has 58 tasks: 30 complete and 28 open.
The [release checklist](./release-0.9.0.md) owns completion status and the evidence index.
The [verification archive](./release-0.9.0-verification-archive.md) retains past test results and review limits.
The [handoff](./handoff-0.9.0.md) records current work and continuation instructions.

The completed task index retains all task anchors and archive links. Outcomes are in the checklist.
The [plan archive](./release-0.9.0-plan-archive.md) preserves the previous document,
including historical checkpoints. Open task sections retain their full context.
Historical status statements inside task sections do not override the checklist.

Continue the open work as described in the handoff. All unchecked tasks
remain in scope. Versions stay at 0.8.3 until REL-04.

**Desktop: completed for 0.9.0 by user decision (2026-10-05).** Remaining
Desktop-only platform acceptance is waived for this release; it is not pending
work or evidence of passing those checks. Preserve the verified implementation
and do not reopen Desktop unless requested. Focus on shared framework behavior,
CLI/agent tooling and Cloudflare.

Read [architecture](./architecture.md) before significant changes. Paths below
are relative to the repository root. A package name followed by a source path
means `packages/<name>/src/<path>`. Approach sections describe proposed work,
not a claim that every listed API exists. Preserve the stated behavior goals.
Keep non-route helper modules outside `src/pages`.

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

These groups list remaining work in dependency order. Completed prerequisites
and the original sequence remain in the [archive](./release-0.9.0-plan-archive.md#suggested-execution-order).
They do not reduce the release scope.
Add focused tests during each group, and run broader gates after integration.

| Group | Main tasks | Result needed before moving on |
| --- | --- | --- |
| 1. Finish current runtime work | RT-01, RT-12 | Distributed SSE works through generated apps and retains request ownership. |
| 2. Establish shared metadata and diagnostics | RT-24, RT-29 | Tools and types describe the behavior that the compiler and runtime execute. |
| 3. Complete application state and actions | RT-10, RT-11 | Forms, data loading, mutations, cancellation, and authorization compose. |
| 4. Complete data and content features | RT-15 through RT-17, RT-20 through RT-22, RT-26, RT-27 | Existing features have clear provider contracts and complete failure behavior. |
| 5. Add background application services | SVC-01 through SVC-05 | Jobs, schedules, notifications, workflows, and Turnstile have tested adapters. |
| 6. Expose the complete agent workflow | CLI-08 | Recipes, upgrades, offline help, and MCP use the shared services. |
| 7. Finish operations | CF-01, CF-02, CF-04, CF-08 through CF-10 | Environment targeting, resources, logs, previews, and CI form one tested workflow. |
| 8. Audit and prepare release | REL-02 through REL-05 | Every requirement has evidence and the release artifacts match the source. |

Preserve regression coverage for completed prerequisites while closing the open criteria.

## Completed task index

Reference only; preserve regression coverage. Full criteria and reviews remain
in the archive. The release checklist retains outcomes and verification evidence.

| Task | Completed work and archived context |
| --- | --- |
| <a id="cli-01"></a>CLI-01 | [Lifecycle flags, help, and creation dry runs](./release-0.9.0-plan-archive.md#cli-01) |
| <a id="cli-02"></a>CLI-02 | [Consistent command validation](./release-0.9.0-plan-archive.md#cli-02) |
| <a id="cli-03"></a>CLI-03 | [JSON diagnostics and noninteractive execution](./release-0.9.0-plan-archive.md#cli-03) |
| <a id="cli-04"></a>CLI-04 | [Inspect, check, and explain project behavior](./release-0.9.0-plan-archive.md#cli-04) |
| <a id="cli-05"></a>CLI-05 | [Complete application recipes](./release-0.9.0-plan-archive.md#cli-05) |
| <a id="cli-06"></a>CLI-06 | [Structured upgrades](./release-0.9.0-plan-archive.md#cli-06) |
| <a id="cli-07"></a>CLI-07 | [Shared local MCP tools and installed acceptance](./release-0.9.0-plan-archive.md#codex-cli07-final-plan-2026-10-04) |
| <a id="rt-02"></a>RT-02 | [Validated server actions](./release-0.9.0-plan-archive.md#rt-02) |
| <a id="rt-03"></a>RT-03 | [Observable server resources](./release-0.9.0-plan-archive.md#rt-03) |
| <a id="rt-04"></a>RT-04 | [State, store, and computed diagnostics](./release-0.9.0-plan-archive.md#rt-04) |
| <a id="rt-05"></a>RT-05 | [Typed tasks and stale-work cancellation](./release-0.9.0-plan-archive.md#rt-05) |
| <a id="rt-06"></a>RT-06 | [Optimistic updates and rollback](./release-0.9.0-plan-archive.md#rt-06) |
| <a id="rt-07"></a>RT-07 | [Typed routes and effective route metadata](./release-0.9.0-plan-archive.md#rt-07) |
| <a id="rt-08"></a>RT-08 | [Typed URL state](./release-0.9.0-plan-archive.md#rt-08) |
| <a id="rt-09"></a>RT-09 | [Navigation completion and diagnostics](./release-0.9.0-plan-archive.md#rt-09) |
| <a id="rt-13"></a>RT-13 | [Shared credentials/sessions, safe diagnostics and atomic OAuth state](./release-0.9.0-plan-archive.md#codex-rt13-final-plan-2026-10-05) |
| <a id="rt-14"></a>RT-14 | [Resource authorization policies](./release-0.9.0-plan-archive.md#rt-14) |
| <a id="rt-18"></a>RT-18 | [Cache and rate-limit contracts](./release-0.9.0-plan-archive.md#rt-18) |
| <a id="rt-19"></a>RT-19 | [Realtime lifecycle and recovery](./release-0.9.0-plan-archive.md#rt-19) |
| <a id="rt-23"></a>RT-23 | [DataTable, native UI contracts and installed accessibility guidance](./release-0.9.0-plan-archive.md#codex-rt23-final-plan-2026-10-04) |
| <a id="rt-25"></a>RT-25 | [Runtime capability checks](./release-0.9.0-plan-archive.md#rt-25) |
| <a id="rt-28"></a>RT-28 | [Devtools snapshots, correlated traces and native runtime acceptance](./release-0.9.0-plan-archive.md#codex-rt28-final-plan-2026-10-04) |
| <a id="cf-03"></a>CF-03 | [Secrets, placeholders, and binding types](./release-0.9.0-plan-archive.md#cf-03) |
| <a id="cf-05"></a>CF-05 | [Distributed SSE coordination](./release-0.9.0-plan-archive.md#cf-05) |
| <a id="cf-06"></a>CF-06 | [Built-artifact runtime tests](./release-0.9.0-plan-archive.md#cf-06) |
| <a id="cf-07"></a>CF-07 | [Public-only SSG and protected assets](./release-0.9.0-plan-archive.md#cf-07) |
| <a id="cf-11"></a>CF-11 | [Tracked credential removal](./release-0.9.0-plan-archive.md#cf-11) |
| <a id="rel-01"></a>REL-01 | [Reported regressions](./release-0.9.0-plan-archive.md#rel-01) |

## CLI and agent tooling

<a id="cli-08"></a>
### CLI-08: Installed-version agent documentation

Codex status (2026-10-05): CLI and MCP share fresh installed-package catalogs,
command schemas, declaration signatures, exact-symbol queries and packaged guidance.
Wildcard discovery preserves export precedence and exclusions. Prop catalogs retain
member documentation and explicit partial results. The examples cover route URLs,
query state, schemas, nested forms, renderer output and recipes. The portable
`core/input` entry keeps schema/form helpers independent of component runtimes.
Seventy-six standalone examples compile and execute from installed tarballs,
including thirty-nine UI SSR examples for native controls, one-time codes,
breadcrumbs, URL pagination, status/progress, linked fields/empty states,
display/layout surfaces, avatars, typed tables and dashboard forms, radio/range
controls, searchable choice, repeated tag values, semantic lists/actions and
keyboard-scrollable table regions, native dialogs/disclosures, tabs, toggles and
SVG icons, native popovers, alert confirmation, hover content, attachments,
chat display, date controls, action menus, command search, carousels, resizable
panels, Menubar, native-link navigation, Sidebar, toast rendering, MessageScroller,
AuthForm and the development RPC trace guard. All 39 UI guides now have executable
examples; all 73 published-package guides have at least one example. The installed gate
executes all eighty package examples, including four separately bundled auth
examples. Database guidance exercises typed model filters and query-builder
projections as well as a reversible Node SQLite migration and repeatable seeder
lifecycle. Framework guidance covers runtime capability planning and cache
guarantees; Node and Deno guidance covers adapter lifecycle, binding precedence,
cleanup and the separate Vite development integrations; Studio guidance covers
local/remote data selection and embedded lifecycle; Core guidance covers locale
negotiation, explicit `q=0` exclusions and CLDR plural formatting. Framework
configuration guidance covers typed per-request config, string environment
values, raw Worker bindings and safe required-binding errors. Four packaged
pages exercise component actions, resources and lifecycle tasks in generated
applications. The harness uses the exact
catalog source, owns the browser/server lifecycle and requires emitted client source
maps before checking server stripping. Installed Cloudflare and Node acceptance
passes. Discovery never invokes it. See [application acceptance](./release-0.9.0.md#codex-cli08-application-guidance-2026-10-04),
the [input guidance checkpoint](./release-0.9.0.md#codex-cli08-input-2026-10-04)
and the [latest package guide checkpoint](./release-0.9.0.md#codex-cli08-migration-guidance-2026-10-05).
The RT-23 UI catalog audit is complete.
The latest database guide, `node-sqlite-transaction-rollback`, proves a
two-row transaction commits both writes and rolls back a rejected callback from
the installed Node SQLite adapter. The fresh offline gate compiles and executes
76 standalone examples plus four bundled auth examples. The guide states that
D1 uses sequential `batch()` operations rather than interactive ORM transactions;
it does not claim D1 transaction support. CLI-08 remains open for broader
library, component and recipe guidance.
Auth now contributes session/role, record-policy, OAuth diagnostic and shared
credential/session guides with four executable examples. Discovery exposes legacy root targets separately from an exports map
and statically indexes published TypeScript with explicit source-kind markers.
The auth examples use Bundler type resolution and installed esbuild bundling.
They use local Hono fixtures and memory storage. Separate generated Node SQLite
and Cloudflare D1 tests now verify real credential login, cookie issuance,
persistent expiry, conditional rotation and revocation. The protected-route
browser regression verifies native route/RPC rejection after expiry. These
checks do not establish plain Node imports or production hashing budgets. See the
[RT-13 completion audit](./release-0.9.0.md#codex-rt13-complete-2026-10-05).
See [archived checkpoint history](./release-0.9.0-plan-archive.md#codex-checkpoint-compaction-2026-10-04) and
[installed acceptance](./release-0.9.0.md#codex-installed-docs-acceptance-2026-10-04).

Checkpoint (Codex, 2026-10-05): `@cossackframework/database` now publishes an
authored parameterized Node SQLite guide. Its installed example compiles and
executes in the offline acceptance gate. The guide distinguishes package entry
points by runtime, bound values from quoted identifiers, safe migration practice,
and D1 sequential `batch()` from the interactive transaction API that this ORM
does not expose. The acceptance also uncovered stale Vite SSR optimizer chunks
when generated fixtures rewrite their page/transport graph. Fixture startup now
clears those artifacts, and the template pre-bundles API/devtools entries that
Vite discovers after its initial dependency scan.

The Cloudflare D1 guide now runs from installed package exports inside a local
Wrangler test Worker with local D1 and proves SQL values stay parameterized.
This exercises workerd and the published adapter path, but does not contact a
Cloudflare account or prove a deployed database. The runtime test also exposed
and fixed the D1 import graph: root SQL now requires an explicit adapter, Node
URL selection stays in the Node entry, and remote Workers Turso uses its own
optional `cloudflare-turso` entry. All 39 UI guides have executable SSR examples:
native controls, normalized one-time codes, named breadcrumbs, URL-backed
pagination, polite status and zero-valued progress, linked fields and empty
states, loading/display surfaces, native layout, named avatars, a server-controlled
DataTable, DashboardStat metrics, and a controlled SettingsPanel inside an
application-owned form, plus date controls, action menus, command launchers,
carousels, adjustable split panels, Menubar, native navigation disclosures,
Sidebar, Toaster, MessageScroller and AuthForm. All compile and run against the installed
UI and renderer tarballs. The test bundles selected UI examples for Node, matching Vite's
handling of the UI barrel's Solar icon TypeScript dependency. They verify
server-rendered markup and callback ownership; they do not establish browser
interaction or assistive technology.

Checkpoint (Codex, 2026-10-05): the renderer catalog now has four more
version-owned guides and executable examples for conditional templates and
optional attributes, keyed list output and separators, server-rendered form
values, and safe CSS composition. Their examples import the published root and
`/server` entrypoints. The list guide explicitly limits its evidence to initial
server markup; it does not use SSR to claim browser node reuse. The CSS guide
shows that `css` rejects raw strings and `unsafeCSS` is an explicit trust
boundary. The installed verifier now compiles and executes these guides along
with the existing escaped-HTML guide. The fresh tarball gate passes with 75
non-auth examples and four separately bundled auth examples (79 total),
generated Cloudflare page examples, CLI/MCP parity, UI catalog checks and
production stripping. This adds renderer library guidance but does not close
broader API/component/recipe coverage or CLI-08. See the
[renderer guide acceptance](./release-0.9.0.md#codex-cli08-renderer-guides-2026-10-05).

Checkpoint (Codex, 2026-10-05): the database catalog adds an installed Node
SQLite example for `ORM.transaction()`. It verifies both writes commit together
and that a thrown callback rolls back its partial write. Its guidance states
that D1 does not support interactive ORM transactions and that independent
connections do not form a distributed transaction. The fresh offline gate now
executes 76 non-auth examples plus four separately bundled auth examples (80
total), across 73 published-package guides. This corrects the prior handoff's
one-guide undercount. It proves the Node SQLite path,
not D1 interactive transactions or cross-provider behavior. CLI-08 remains open
for wider API, component and recipe coverage. See the
[transaction example acceptance](./release-0.9.0.md#codex-cli08-transactions-2026-10-05).

Remaining: Complete broader authored API/component/recipe coverage across
the libraries, beyond the now-executable UI guides. Preserve RT-23 regressions
and finish REL-02 acceptance. The full
installed docs gate passes, but CLI-08 and REL-02/REL-03 remain open. The latest
typed-query acceptance is recorded in the [release checklist](./release-0.9.0.md#codex-cli08-database-queries-2026-10-05).
Discovery never executes examples, but the separate installed acceptance runs
every packaged example. Declaration presence does not prove runtime imports or
native attribute behavior. Platform diagnostics and bounded scans can
produce partial catalogs. Installed acceptance blocks outbound Node networking
while allowing a synthetic `127.0.0.1` DNS answer for loopback-only listeners.
Package installation can use the registry. Broader library API and recipe
guidance remains open.
The catalog uses a pinned TypeScript 6.0.3 compiler API independently of the
workspace TypeScript 7 compiler. CLI-08 remains open.

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
Reinspect the source before extending it. Codex now owns the remaining work and
follows task dependencies.

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

Codex status (2026-10-04): Authored RPC inference, JSON serialization, native
response completion and multipart ownership have shared transport coverage.
The 421-case conformance matrix covers correlated results/errors and bounded frames.
Native Workers fixtures cover shared limits, peer context and durable counters.
Backend response bounds/deadlines and explicit cross-Worker coordinator cancellation
also pass. RT-02, RT-14 and RT-18 contracts are now complete.
See [archived checkpoint history](./release-0.9.0-plan-archive.md#codex-checkpoint-compaction-2026-10-04) and the
[cancellation checkpoint](./release-0.9.0.md#codex-sse-cancellation-2026-10-03).

Remaining: Prove native pre-header disconnect delivery and component
initialization/restoration concurrency against the original criteria. The
[per-call deadline checkpoint](#codex-rt01-per-call-deadlines-2026-10-05) closes
the arbitrary per-call action deadline gap.
Retain RT-11 session and stream-response cookie requirements. Handshake identity
does not prove per-message session revalidation. Explicit coordinator cancellation
does not prove incoming TCP abort delivery or terminate ignored application I/O.
Native Durable Object fixtures do not prove live Redis/KV guarantees.
Deno interruption/lifecycle acceptance, actual Electron execution and the full
release matrix remain separate gates. Basic Deno production execution is recorded
in the [runtime checkpoint](./release-0.9.0.md#codex-deno-production-2026-10-04).
RT-01 remains open.

<a id="codex-rt01-timeout-bounds-2026-10-05"></a>
Codex deadline-boundary review (2026-10-05): `@Server({ timeout })` now accepts
only integer milliseconds from 1 through 2,147,483,647. Larger JavaScript timer
delays are clamped by runtimes and could previously become near-immediate
timeouts; fractional, non-finite, negative and nonnumeric values also silently
lost their declared deadline. The decorator rejects invalid options, and the
HTTP/SSE, WebSocket and service proxy paths validate inherited metadata before
creating a timer. The legacy Node WebSocket adapter now coalesces concurrent
same-target bootstrap and reserves its instance limit for pending distinct
targets; failed bootstrap cleans up the component and rejects the socket. Core
deadline/metadata regressions pass (25 tests), the full core suite passes
(1,552 tests), and the core package builds. The Node adapter builds and all 24
of its tests pass, including same-target coalescing and pending-capacity checks;
root `pnpm tsc --noEmit` passes. This does not prove native disconnect delivery,
server-side rollback, or arbitrary dynamic/per-call deadlines. Broader component
initialization/restoration concurrency remains unaudited; RT-01 remains open.

<a id="codex-rt01-per-call-deadlines-2026-10-05"></a>
Codex per-call RPC deadline and cancellation (2026-10-05): `rpc$` now accepts a
factory form, `rpc$(() => this.save(), { timeout, signal })`, while retaining the
existing identity-view form. It validates timeout bounds and AbortSignal shape
before invoking the factory, so invalid options cannot dispatch a mutation. A
per-call timeout overrides the decorated default across component HTTP/SSE and
WebSocket calls and layout-service HTTP calls. An aborted signal settles the
local call and aborts its transport request; server work already in progress may
continue, and the mutation outcome remains uncertain, so calls are never retried.
The installed type fixture checks inference and rejects options on a direct-call
form. Core build, all 1,558 Core tests and root `pnpm tsc --noEmit` pass. This
closes the arbitrary per-call deadline implementation/acceptance gap, but not
native pre-header disconnect delivery, component initialization/restoration
concurrency, session/cookie requirements, or RT-01 itself.

Start in core `shared/rpc-stream.ts`, `shared/rpc-json.ts`, `method-proxy.ts`, `service-scope.ts`,
`transport-connections.ts`, and framework transport handlers and `router.ts`.

Done when: One conformance suite exercises each transport and service calls.
Cover ordinary results, generators, errors, timeout, disconnect, cancellation,
duplicate consumers, and cleanup. Consuming a call twice never dispatches a
second mutation. Type tests prove yielded and final result inference.

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

Codex partial foundation (2026-10-05): Core exports a DOM-free
`createFormController(schema, initialValues)`. It owns cloned raw values and
initial values, typed nested dot-path reads/writes, dirty/touched/error state,
schema validation, reset, single-submit lifecycle, cancellation of stale
validation, and nested `ActionValidationError`/`RpcError` field-error mapping.
`File`/`Blob` identity is preserved locally. The docs distinguish this new
controller from the existing page `@Store()` flow, and correct an async form
example. The Core suite (95 files / 1,568 tests), 9 focused controller tests,
root typecheck, and owned-file whitespace check pass. This is not RT-10
completion: accessible bindings, reactive adapters, keyboard/label/error/focus
browser tests, nested array-item paths and real file transport acceptance remain.

Codex declaration repair (2026-10-05): the fresh installed documentation gate
exposed object-to-InputOf<S> typing in FormController.validate. The parsed result
now retains its concrete schema output type. Core build/declaration emission and
9 form-controller tests pass, and the fresh installed gate passes after repair.
Accessible bindings and RT-10 browser acceptance remain open.

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

Codex session-dashboard checkpoint (2026-10-05): RT-13's shared auth primitives
remain complete. The generated application now exposes independent
`SessionInfo.reference` UUIDs and a whitelist of display fields. An additive
migration and conditional legacy backfill preserve token identities; rotation
preserves the reference. Authenticated-context helpers enforce ownership and
auth purpose. Single and keep-current bulk revocation protect the current
reference during rotation. The dashboard layout also guards RPC requests;
page errors discard raw storage messages. Native Node SQLite/Cloudflare D1
acceptance covers SSR/RPC disclosure, forged actors, foreign/current/reset/state
references, real storage failures, concurrent revocation, rotation races and
bulk cookie clearing. Sessions-only dashboards no longer import absent role
models in their seeder. See the
[checkpoint](./release-0.9.0.md#codex-rt11-dashboard-2026-10-05).
Auth starters now leave the extra anonymous session bag opt-in, preserving public
SSG without visitor cookies; standalone SSG also initializes bare translation/
config helpers. Preserve the session-registration migration and public SSG guards.
Continue sensitive old-input filtering, complete failure/login/logout/rotation
recipes and the remaining concurrent/realtime criteria. This checkpoint does
not close RT-11 or prove connection identity refresh after revocation.

Codex public-input checkpoint (2026-10-05): `getFormData` now defaults to
nonempty validation errors only. Public old input requires `flash.input` paths
or `flashInput(data, { fields })`. Selection copies own finite scalar leaves and
scalar arrays, rebuilds nested containers and leaves server data intact. Whole
objects/files/accessors are omitted. Credential/prototype paths are excluded;
custom secrets must stay outside the application-owned field list. Generic
`flash()` cannot bypass selection through the reserved namespace. No-rules form
options also have the correct parsed-DTO return type. Forms/docs and the new
`safe-old-input` package guide use explicit policies. Its source runs verbatim in
generated Node/Cloudflare production fixtures; decoded cookie bytes, RPC failures
and following SSR state prove selected restoration and credential exclusion.
The broader Workers HTTP/SSE redirect/late-write gate still passes. See the
[evidence and limits](./release-0.9.0.md#codex-rt11-input-2026-10-05).

Codex generated-form checkpoint (2026-10-05): all four auth pages now use
ClientStore drafts and client-only validation. App-owned `auth-input.ts` contracts
accept one explicit object; real RPC gates and repeated native parsing reject
invalid shapes, unknown fields and excess arguments before storage. Passwords
are not normalized and fit the shared UTF-8 size limit. Fixed messages replace
caught storage/transport exceptions. The dashboard layout handles failed logout
without clearing its cookie. Its sessions page rotates and redirects before
refreshing with a new cookie. Generated Node SQLite/Cloudflare D1 and Chromium
acceptance checks actual page SSR/RPC state, browser drafts, reset expiry/replay,
partial registration failure, login/logout/rotation cookies and redirects. Keep
the real-page tests distinct from the helper fixtures. See the
[checkpoint](./release-0.9.0.md#codex-rt11-forms-2026-10-05).

The package public-form example also passes installed Cloudflare application
guidance acceptance for native POST, selected restoration, credential exclusion,
browser clearing and emitted source-map checks.
Codex SSE checkpoint (2026-10-05): authenticated subscriptions use the optional
AuthRealtimeProvider and app-owned storage to capture a bounded, server-only
reference/fingerprint descriptor. Every delivery revalidates the live session
through the shared session manager and resolves current user data. Fresh request,
config and ORM scopes run global/inherited guards and require the original owner
and computed scope. Params/bindings and the subscription locale remain available;
credential headers are removed and late header writes reject. Distinct fixed codes
separate missing/invalid capture configuration from storage capture failures.

Node SQLite/Cloudflare D1 and Chromium verify logout, expiry, rotation across two
tabs, purpose/scope changes, fresh user metadata for inherited guards, authorized
peer delivery and idle storage failure. The browser retires the old EventSource,
ignores late callbacks, stops retries and reconnects on explicit reload with the
new cookie. Preserve replay/heartbeat/backpressure tests and production JS/map
stripping. See the [checkpoint](./release-0.9.0.md#codex-rt11-sse-auth-2026-10-05).

Codex WebSocket checkpoint (2026-10-05): Cloudflare upgrades now capture a
bounded, credential-free identity descriptor and attach it with the request,
route params, locale, user, component owner and computed scope. Each action,
state/event/client-action delivery replays fresh global and inherited middleware
inside a new request/config/locale/ORM scope, then checks the current user and
per-page scope before dispatch or send. Durable Object hibernation restores the
descriptor from the socket attachment; it does not depend on in-memory peer maps.
Invalid identity capture and stale target/scope fail closed. The browser receives
a terminal authorization frame and closes without reconnecting. Node/Deno peers
also recheck each action and outbound delivery and serialize each peer's queue
with a bound of 32 pending frames; overflow closes with 1013.

Generated Cloudflare deployment acceptance exercises authenticated sockets and
the fingerprint provider without putting the bearer session ID in the attachment.
Framework tests cover restored identity, fresh guards and scope changes; core
tests cover action/outbound reauthorization and terminal closure; Node/Deno
adapter and generated peer tests pass. This closes the WebSocket freshness slice,
not RT-11. Broader concurrent request semantics remain. An action or frame that
passed its check before revocation may finish, slow storage and queue backpressure
prevent a wall-clock guarantee, and idle sockets are checked on the next action
or delivery. Barrier tests now prove generic session and signed-flash request
scopes remain separate while handlers overlap in one isolate. Auth-managed
session rotation already uses an atomic store replacement with one winner.
The process-runtime guard now atomically claims each valid signed nonce in a
bounded module-local store. It prevents concurrent and later replay within one
loaded module instance in its JavaScript process or isolate, but does not
coordinate across processes or isolates and does not survive restart. Capacity
fails closed rather than evicting a live claim. Continue verifying broader
concurrent request semantics and documenting these runtime limits before closing
RT-11. See the
[process-local flash checkpoint](./release-0.9.0-verification-archive.md#codex-rt11-process-flash-claims-2026-10-05).

Codex database-session checkpoint (2026-10-05): the built-in database
`SessionStore.set()` and `unset()` now update one JSON key in one SQL statement
for SQLite, PostgreSQL and MySQL. They no longer read and rewrite the whole
session bag, which could erase a different key written concurrently. A SQLite
regression rejects read-before-write behavior and verifies both keys survive;
SQL compilation checks cover all three dialects, and SQLite covers unusual
keys. Custom stores must provide the same key-level atomicity. Same-key writes
remain last-writer-wins, and RT-11 remains open for signed-flash replay,
in-flight work and the rest of its concurrency contract. See the
[database session checkpoint](./release-0.9.0.md#codex-rt11-session-concurrency-2026-10-05).

Already-started HTTP actions can retain resolved identity. A frame checked before
revocation can be in flight. SSE idle checks occur before 15-second heartbeats
with reader demand, so backpressure and slow storage prevent a wall-clock guarantee.
Account writes, reset consumption and response delivery are separate steps;
fixed errors do not establish rollback. Flash now signs and checks its expiry on
the server. Cloudflare consumes each nonce once through a dedicated
`COSSACK_SSE` SQLite Durable Object, with alarm cleanup and atomic two-Worker
coverage. Node/Deno use a bounded module-local claim store when no coordinator
is available. See the [Cloudflare flash checkpoint](./release-0.9.0.md#codex-rt11-cloudflare-flash-claims-2026-10-05)
and [process-local checkpoint](./release-0.9.0-verification-archive.md#codex-rt11-process-flash-claims-2026-10-05).
Audit the remaining concurrency criteria before closing RT-11. CLI-08 retains broader guidance coverage.

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

Codex ownership-inspection checkpoint (2026-10-05): `cossack inspect routes`
now keeps the authored service expressions and adds `serviceOwnership`, resolved
with a static TypeScript source resolver. Static identifiers and property access
follow aliases, re-exports and inherited layout decorators to a class declaration
path and line. The resolver parses but never imports or executes project modules.
Dynamic expressions and unresolved decorators stay explicitly unknown. CLI docs
and route explanations show the resolved class identity or uncertainty reason.
Each token reports whether an imported core `@Service()` decorator is declared,
missing, or unknown; this is static syntax evidence only. All 88 tests across five
focused route/inspection suites pass, as do the two
route-related CLI subprocess tests and root `pnpm tsc --noEmit`. They cover
alias/re-export identity, inherited layout options, dynamic unknown status and a
throwing static initializer that must not run. This does not prove decorator
metadata execution or lifecycle behavior, or verify browser navigation ownership;
RT-12 remains open. The complete CLI package suite has not passed: parallel
execution triggered subprocess/test timeouts, and the serial retry exceeded an
existing five-second CLI assertion before it was stopped. Rerun it during REL-03
and resolve any failures that reproduce without load contention.

Codex navigation-ownership checkpoint (2026-10-05): the first generated browser
run reached authenticated SSE in both Node and Cloudflare but received HTTP 409.
The synthetic-user fixture had not supplied the required
`captureRealtimeIdentity` provider; the transport correctly failed closed. The
fixture now supplies a test-only identity descriptor. The focused generated
acceptance passes both runtime cases, including layout/component state ownership,
cleanup-once behavior, SSE open/closure, WebSocket open/target replacement and
stale socket cleanup. This fixture does not authenticate a real user. Runtime
metadata/lifecycle behavior and the full CLI/release gates remain open, so this
checkpoint does not close RT-12. See the
[browser checkpoint](./release-0.9.0.md#codex-rt12-navigation-fixture-2026-10-05).

Codex construction-lifecycle checkpoint (2026-10-05): if a later service
constructor or hydration step throws while a layout scope is being created,
the partial scope now disposes earlier instances before rethrowing the primary
failure. A parent scope tracks and awaits any asynchronous cleanup that began
during rollback. The service guide describes this behavior. The focused core
cleanup suite passes all 8 tests and root typechecking passes. This does not
close RT-12; runtime metadata/lifecycle combinations and the full CLI/release
gates remain open.

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

Codex checkpoint (2026-10-05): Root and nested component structural fallbacks
now emit structured diagnostics with a mismatch category, DOM path, expected and
actual node shape, and nested component name. Text values and comment contents
stay out of the event. The full renderer suite and root typecheck pass. State
comparison, source/field metadata, retained layout/service browser tests and
reusable test helpers remain open. See the [verification checkpoint](./release-0.9.0.md#codex-rt20-safe-hydration-diagnostics-2026-10-05).

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

Codex checkpoint (2026-10-05): `config()` no longer lets its permissive string
fallback swallow misspelled paths after an app augments
`CossackConfigRegistry`; fallback calls remain available to apps that have not
registered a config tree. Type tests reject a bad dotted path and a default with
the wrong value type. Root typechecking and the installed documentation gate
pass. The registry is still manually declared by each app, so automatic
registry generation and the remaining RT-24 acceptance criteria stay open.

Codex checkpoint (2026-10-05, generated types): Vite now generates and watches
`.cossack/config.d.ts` with type-only factory return references. Authored registry
entries override generated entries. New scaffold TypeScript includes the output;
existing apps must add it. Node-only `framework/config-codegen` supports explicit
generation and write:false. Combined framework suites pass 32/32, scaffold 81/81,
framework declaration emission and root typecheck pass. Continue with standalone
CLI generation/inspection, required binding/variable metadata and coercion,
selected-environment preflight, and full redaction/isolation acceptance. A fresh
installed/browser gate was not run. RT-24 remains open; see the verification archive.

Codex CLI checkpoint (2026-10-05): cossack config catalogs names/type origins;
--generate emits types and --dry-run preserves files. JSON explicitly leaves
factory evaluation/validation unperformed. Combined CLI suites pass 34/34,
framework 50/50, fresh installed documentation/browser gate passes, and installed
config generation/inference/removal helper passes separately. The helper uses the
scaffold's skipLibCheck policy; strict source-generator checks remain separate.
Strict installed cache declarations need Worker ambient types. Required runtime
metadata/validation remains open; counts stay 30 complete / 28 open.

Codex next implementation findings (2026-10-05): router and SSG currently build
factories before entering runWithConfig, so imported required helpers inside
factories cannot see request bindings. Centralize fresh config-store preparation
and validate requirements before any factory/application side effect. Preserve
factory syntax; consider separate literal named requirements exports describing
variable types/coercion, required names, secret classification, binding kinds and
runtime applicability. AST tooling must mark dynamic metadata unknown rather
than execute it. Share pure validation between runtime values and CLI declaration
facts, without claiming remotely deployed secrets exist. Explicitly define SSG
requirements, since its only supplied binding is APP_URL. Acceptance must include
interleaved request isolation and sentinel secrecy in errors, metadata and
hydration, beyond filename catalog/client virtual-module tests.

Codex scoped factory checkpoint (2026-10-05): prepareConfigStore fixes the prior
scope finding above. SSR and SSG use it; required factory accessors see only their
supplied environment, nested callers restore after success/failure, and failure
stops middleware/page lifecycle. Eight focused suites pass 94 tests; framework
emission/root typecheck and fresh installed documentation/browser/workerd gate
pass. The Worker fixture checks concurrent values, raw D1 identity and value-free
errors. Continue with separate requirement declarations/coercion/runtime checks
and selected-environment preflight before any factory side effect. Helpers still
validate at invocation. Async factories and full classification/hydration secrecy
are not covered by this checkpoint. RT-24 stays open; counts stay 30 / 28.


Codex declared-requirement checkpoint (2026-10-05): literal named requirements
exports describe scalar type/coercion, required/secret flags, binding kind and
runtime filters. The pure checker validates before any factory. SSR/SSG use it;
realtime authorization replay now also prepares fresh scopes and preserves the
originating runtime/environment. Typed configVariable/requireConfigVariable
return coerced scalars; legacy env remains string-based. Metadata normalization
rejects accessors/custom iterators without invoking them. Static inspection treats
unsupported exported forms and dynamic/mutated metadata as unknown, and never
evaluates factories. CLI --check, Cloudflare checks and deployment preflight share
private selected Wrangler declaration facts. Failures stop before types/build or
artifact writes. Remote resources and secret values/existence remain unverified.
Node/Deno runtime validation works; their declaration preflight is unavailable.

Continue with direct Vite build preflight, the remaining declaration-source
policy for Node/Deno, and full secret-classification/hydration acceptance. Keep
binding shape checks scoped to structural validation, not remote connectivity.
Document that classification cannot prevent deliberate public exposure. Retain
synchronous factory policy and separate strict installed cache ambient types.
Fresh installed config/workerd/browser/documentation acceptance passes, along
with combined source/CLI/MCP regressions and root/package type checking. A real
Vite SSR build checks named metadata collection and failure before factory entry.
Retained gate: /tmp/cossack-local-pack-5dbkLj.
RT-24 stays open; counts stay 30 complete / 28 open. Final acceptance evidence is
in the [declared requirements record](./release-0.9.0-verification-archive.md#codex-declared-configuration-requirements-2026-10-05).

Codex direct-build checkpoint (2026-10-05): direct `cossackConfig()` builds
now share the Node-only private Wrangler reader and safe inspection facade with
CLI config checks, capability binding discovery and deployment. Explicit target
options take precedence; scaffold/package/adapter metadata resolves the runtime.
Cloudflare checks selected declarations before type generation and build output.
Node/Deno/unknown targets check metadata, conflicts and runtime compatibility;
their supplied values remain unverified. Development startup permits incomplete
configuration. Build/watch cycles reread source and Wrangler facts and watch
factory files and metadata origins. Failed build/render hooks now prevent SSG
publication; a new cycle resets that environment's failure state. A separate
named-environment parser failure is sanitized before deployment diagnostics.
RT-24 remains open for Node/Deno declaration-source policy and full hydration
secrecy acceptance. Counts stay 30 complete / 28 open. See the
[direct-build verification](./release-0.9.0-verification-archive.md#codex-direct-vite-configuration-preflight-2026-10-05).

Codex private-hydration checkpoint (2026-10-05): an installed Cloudflare app
now reads classified configuration into a private field and publishes only a
boolean/count. Actual workerd SSR HTML, parsed hydration, browser/RPC traffic,
delivered scripts, CLI metadata and production client JavaScript/source maps
omit the private value and factory sentinel. Temporary declarations ensure
Wrangler supplies the test secret locally. The helper restores original files,
artifacts and caches. Native Node/Deno hydration and declaration-source policy,
failure diagnostics and broader secret-classification acceptance remain open;
intentional app publication is not automatic redaction. Counts stay 30 / 28.

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

Completion: [Codex CF-01/02 acceptance](./release-0.9.0.md#codex-cf-targets-complete-2026-10-05).

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

Completion: [Codex CF-01/02 acceptance](./release-0.9.0.md#codex-cf-targets-complete-2026-10-05).

<a id="cf-04"></a>
### CF-04: Resource selection and setup

Codex built-target correction (2026-10-05): explicit --config artifact deployment
must clear CLOUDFLARE_ENV after type generation and Vite selection. Wrangler treats
that explicit path as ordinary config and otherwise applies the source environment
again. Source stages retain selection; final artifact stages now disable it. Unit
and published CLI selected-target dry-run evidence are in the
[direct-budget checkpoint](./release-0.9.0-verification-archive.md#codex-direct-vite-budgets-2026-10-05).
This fixes local target selection, not remote account/resource discovery or
provisioning; CF-04 remains open.


Purpose: A generated binding must point to a real resource or use supported
provisioning. A fake Hyperdrive ID postpones an inevitable failure until deployment.

Baseline: D1 scaffolds set `database_name` without a `database_id`. The pinned
Wrangler parser accepts incomplete D1 references for local inspection, but
Cloudflare's [configuration docs](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
require both `database_name` and `database_id` for a remote binding; parser
acceptance is not deployment readiness. Hyperdrive still uses an all-zero
placeholder ID. Full resource selection/setup flows remain open.

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

Codex scaffold-guidance checkpoint (2026-10-05): generated D1 configuration and
README now consistently require the named remote database to exist before
deployment. Hyperdrive guidance calls out the all-zero configuration ID and
keeps database credentials in Cloudflare configuration. The offline scaffold
tests verify generated configuration comments and rendered instructions. No
account discovery, resource selection or provisioning was added, so CF-04
remains open. See the [checkpoint](./release-0.9.0.md#codex-cf04-scaffold-guidance-2026-10-05).

Codex static-plan checkpoint (2026-10-05): local `inspect/check cloudflare`
output now identifies each configured resource reference by name or ID, marks
unresolved placeholders with a next action, and explicitly records remote
existence/access as `not-checked`. It no longer describes configured values as
`existing` or missing values as `automatic`. A Wrangler environment is not an
account identity, so this pass does not guess the target account. Inspection
and check remain local/read-only. D1 bindings missing either `database_name` or
`database_id` are unresolved for remote deployment, even though the local parser
permits incomplete entries. The action guides users to
`wrangler d1 list` or an explicit `wrangler d1 create --update-config` command.
Focused CLI tests (30), scaffold tests (81), a generated deployment dry-run,
and root typechecking pass. The dry-run did not upload or create resources.
This does not add resource selection, authenticated existence/access checks,
provisioning, ownership tracking, or wrong-account/repeated-application tests;
CF-04 remains open. See
the [static-plan checkpoint](./release-0.9.0.md#codex-cf04-static-resource-plan-2026-10-05).

<a id="cf-08"></a>
### CF-08: Production logs and build budgets

Codex direct-Vite dependency audit (2026-10-05), read-only: retain cossackConfig's
preflight order. A separate post plugin must run after Cloudflare's final buildApp
hook, verify built environments and fresh selected-target artifacts, then measure.
Vite build() bypasses buildApp hooks; acceptance must use createBuilder().buildApp()
or the installed CLI. Shared Node-only budget code belongs in framework, consumed
by CLI, never a reverse framework-to-CLI dependency. Reuse strict artifact
verification. Avoid duplicate measurements with a receipt bound to settings,
environment and artifact fingerprint; clear stale receipts before building.
Define primary versus auxiliary Worker scope. Custom builders that leave outputs
unfinished must fail closed. This audit changed no runtime code and ran no tests;
the implementation checkpoints below supersede its audit-only status. CLI receipt
and default scaffold integration are now verified coordinator-owned work.


Codex opt-in direct Vite implementation (2026-10-05): `cossackBuildBudgets()`
now runs after Cloudflare's application build, validates completed Worker
environments and fresh primary-target artifacts, then measures the installed
Wrangler dry-run summary privately. Node-only budget and artifact modules are
shared by framework and CLI; framework never depends on CLI. Real staging builds
exposed and fixed ambient environment selection being applied twice to built
configs. Explicit empty environment now means inspect/measure the already-built
target. Primary Worker scope is documented; auxiliary Workers need separate
future policies. See the [verification checkpoint](./release-0.9.0-verification-archive.md#codex-direct-vite-budgets-2026-10-05).

Codex receipt/default scaffold integration (2026-10-05): implemented a fresh
UUID signing key per CLI build, never persisted. Private atomic receipts contain
only safe metrics and HMAC-bound invocation/settings/environment/fingerprint
metadata. Fingerprints cover all files in supported no-bundle Worker output,
redirect configuration, Wrangler manifest/entry/bin and Node version, with
before/after content and metadata checks. Current manifest limits are rechecked
after building. Unsupported graphs (including auxiliary Workers, symlinks,
external modules, custom builds and rebundling), or bounded inventory overflow,
fall back to a fresh measurement after successful builds. Failed builds are
never freshly measured or excused by passing receipts. Valid failing receipts
preserve structured budget diagnostics and truthful failed build-step status.
New Cloudflare projects include the post plugin; non-Cloudflare recipes strip it.

Acceptance verified: stale invocation/environment/settings, corruption/tampering,
module/config/redirect/tool changes, changes during measurement, unsafe storage,
unsupported graphs, private persistence, unrelated failed builds, fallback and
native build/deploy single-measurement reuse. Framework 1,736 tests, affected CLI 56 tests,
final native integration 3 tests and 91 scaffold cases pass; 9 Desktop cases
were skipped. Root/framework typechecks, declarations and fresh Cloudflare
installed-package gate pass (`/tmp/cossack-local-pack-gZdSQv`). This proves new
published exports, default composition and selected-target signed diagnostics
with Vite 8.3.2 / Wrangler 4.147.0; broader REL-03 acceptance remains. See the
[verification record](./release-0.9.0-verification-archive.md#codex-budget-receipts-2026-10-05).

Codex custom-source/watch integration (2026-10-05): the shared selector now
honors explicit `configPath`, then `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`, then
root defaults, matching Cloudflare's plugin order. Explicit paths are available
on `cossackConfig`, `cossackPages` and `cossackBuildBudgets`; declaration and page
binding checks use the selected file. CLI inspection uses the environment path,
which also reaches Wrangler type generation and Vite. Missing selected files
cannot silently fall back. Native nested-config and explicit plugin composition
acceptance passes after repairing the page binding reader uncovered by the first
run. Framework 1,757 tests, affected CLI 60 tests, root/framework types and
emitted declarations pass. See the [verification record](./release-0.9.0-verification-archive.md#codex-custom-config-watch-2026-10-05).

Installed acceptance exposed another DX gap: direct CLI build depended on vite
being in the caller's PATH. Build now resolves the project-installed Vite for
captured and human paths; both unbudgeted modes have regressions. Final affected
CLI total is 60; native build/deploy receipts remain verified.

SSG review also found its sync URL discovery still selecting root files. It now
shares the source candidate helper; getSiteUrl/cossackSsg support explicit paths.
JSONC/TOML regressions prove selected environment URLs and no root fallback for
missing selected sources. Final full framework total is 1,757.

Final repacked framework/CLI acceptance passes in the retained installed fixture
with Vite 8.3.2 / Wrangler 4.147.0: custom-path CLI receipts, explicit Vite options,
published SSG URL discovery and prompt native watch rejection/privacy. The helper
is included in future Cloudflare tarball gates. This focused final-package update
is not a rerun of the full gate or REL-03 runtime matrix.

Watch policy: configured budgets reject root or environment build.watch before
output/measurement, and recheck custom builder options in buildApp. Installed
Vite returns watchers before output completion and does not rerun buildApp for
each generation. This is explicit unsupported behavior, not successful watch
budget acceptance. Supporting future watch measurement requires synchronized
Worker/client generation completion and fresh receipts per generation. Ordinary
DEV and builds without budgets get no new watch restriction.

Remaining: auxiliary Worker budget policies and wider module graphs. The receipt's
4,096-file/64-MiB inventory cap is a conservative reuse bound, not a provider
limit; failing to fingerprint never weakens budget enforcement.
Local/provider startup costs, native development fault acceptance, remote logs
and deployed source-map resolution retain their full original criteria.

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

Codex checkpoint (2026-10-05): HTTP component and layout-service RPC failures
now emit structured events with request ID, bounded route/action/runtime labels,
elapsed time, stage and a fixed failure code. Stream and cleanup failures use the
same redacted shape. The shared framework matrix checks action and stream events
against caller-visible IDs and confirms that exception text stays out of logs.
The local harness does not prove Cloudflare Workers Logs ingestion. Production
source-map resolution, configurable artifact/startup budgets, full framework log
review and native Worker log acceptance remain open. See the [verification
checkpoint](./release-0.9.0.md#codex-cf08-rpc-logging-2026-10-05).

Codex HTTP/SSR checkpoint (2026-10-05): native/class API, SSR rendering and
router cleanup catches now emit fixed metadata without arbitrary exceptions.
Unhandled configuration/middleware failures use a safe Hono error handler.
Caller-visible UUIDs correlate with logs; authored templates omit concrete paths
and query values, and unknown methods are not retained as labels. The shared
scope helper validates IDs and API failures restore a modified response header.
Global fallback duration covers failure handling only, not the original request.
Source regressions and installed workerd check emission/redaction. Remaining:
core lifecycle/WebSocket and adapter logs, manifest/SSG/access logger review,
development SSR detail policy, whole-request timing, remote Workers Logs
acceptance, source-map resolution and configurable budgets. CF-08 stays open.
See [server logging contract](../docs/server-logging.md).

Codex core/Node checkpoint (2026-10-05): core action/task/cleanup, service
rollback/disposal, Durable Object parse/delivery and Node transport catches now
omit raw exceptions. Shared dispatch omits incoming target/action labels.
Synthetic or hostile request metadata cannot change teardown behavior. This
completes the bounded redaction slice, not CF-08: component update, Deno and
framework loader/SSG/access logs, DEV SSR detail policy, timing, remote ingestion,
source maps and budgets remain. See the [verification checkpoint](./release-0.9.0-verification-archive.md#codex-core-node-redaction-2026-10-05).

Codex framework/Deno checkpoint (2026-10-05): development SSR fallback pages,
access logs, router loaders/state, SSG failures and core update catches now omit
arbitrary exceptions and concrete request URLs. Deno runtime/development catches
emit fixed events. Managed failures measure duration from request-context entry.
Remaining criteria: Deno Vite trusted compiler-channel review, native fault
acceptance, remote ingestion, production source maps and build/startup budgets.
See [verification](./release-0.9.0-verification-archive.md#codex-framework-deno-redaction-2026-10-05).

Codex budget/Deno transport checkpoint (2026-10-05): CLI build/deploy now
share literal project warning/error size budgets measured by local Wrangler
against validated fresh Cloudflare artifacts, with explicit .01 KiB precision
and conservative rounding. Arbitrary tool output is private/bounded. Provider
startup is unavailable locally; configured hard startup budgets fail. Deno Vite
caught errors no longer leak into console or public middleware; private compiler
results are preserved. Remaining criteria: direct Vite budgets, local/provider
startup, native development faults, source-map resolution and remote logs. See
[checkpoint](./release-0.9.0-verification-archive.md#codex-cf08-budgets-deno-transport-2026-10-05)
and [budget contract](../docs/build-budgets.md).

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

Codex RT-04 acceptance (2026-10-03) found a plain Vite Node 404. The Node adapter
plugin now serves this path, and the diagnostic fixture uses the generated
configuration without a private bridge. Remaining development acceptance is
tracked under REL-03.

## Release gates

These tasks establish release readiness after implementation. A passing narrow
test is evidence for its behavior only. It does not close unrelated features
or the final release audit.

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

Codex type-verification repair (2026-10-05): package checks exposed a real
RawInputOf defect: InputSchema's default raw type was unknown for noncoercing
string, enum and file fields. Raw now defaults to Output; coercing schemas retain
their explicit incoming types. Published declarations reject invalid raw nested
strings, enums, file arrays and optional nulls. Typed config now permits whole
objects and nested subtrees with inferred shapes while rejecting unknown paths.
Locale uses inferred config access; optional CORS reads remain internal without
loosening application config overloads. Test fixture types are repaired without
removing runtime assertions. Acceptance evidence and limits are in the
[verification checkpoint](./release-0.9.0-verification-archive.md#codex-package-type-repair-2026-10-05).
RT-10's browser/accessible bindings and the full REL-03 gate remain open.


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

**Completed runtime checkpoints — Codex (2026-10-04).** Generated and installed
Node development and Deno production/development pass their recorded browser,
CLI lifecycle and trace checks. See the [runtime evidence index](./handoff-0.9.0.md#completed-work-reference-only)
and [archived implementation context](./release-0.9.0-plan-archive.md#codex-runtime-progress-2026-10-04).
`pnpm test:deno` owns the repeatable native Deno gate.

Remaining: graceful generated-server draining, Deno Deploy and the required
non-Desktop final release matrix. Desktop development and native Linux checks
pass the [RT-28 audit](./release-0.9.0.md#codex-rt28-complete-2026-10-04).
The user has marked Desktop complete for this release. Remaining installed OS
integration, Windows/macOS and signing acceptance is waived, not claimed as tested.
Retain `pnpm test:desktop` for any future requested Desktop changes; do not reopen
Desktop work or repeat its gate for unrelated work.

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

## How Codex records progress

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
Use the final review to audit implementation commits against this plan and its checkpoints.
