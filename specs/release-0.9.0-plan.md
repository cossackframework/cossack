# Cossack 0.9.0 implementation plan

Compacted by Codex on 2026-10-04. The release has 58 tasks: 24 complete and 34 open.
The [release checklist](./release-0.9.0.md) owns completion status and verification evidence.
The [handoff](./handoff-0.9.0.md) records current work and continuation instructions.

Completed tasks below retain a short outcome and a link to their original criteria.
The [plan archive](./release-0.9.0-plan-archive.md) preserves the previous document,
including historical checkpoints. Open task sections retain their full context.
Historical status statements inside task sections do not override the checklist.

Continue RT-23 and CLI-07/CLI-08 as described in the handoff. All unchecked tasks
remain in scope. Versions stay at 0.8.3 until REL-04.

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

Status: Complete. Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.

Original plan, acceptance criteria and review history:
[archived CLI-01](./release-0.9.0-plan-archive.md#cli-01).

<a id="cli-02"></a>
### CLI-02: Consistent command validation

Status: Complete. Validate command-specific flags and reject ambiguous/unknown options consistently.

Original plan, acceptance criteria and review history:
[archived CLI-02](./release-0.9.0-plan-archive.md#cli-02).

<a id="cli-03"></a>
### CLI-03: JSON diagnostics and noninteractive execution

Status: Complete. Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands.

Original plan, acceptance criteria and review history:
[archived CLI-03](./release-0.9.0-plan-archive.md#cli-03).

<a id="cli-04"></a>
### CLI-04: Inspect, check, and explain project behavior

Status: Complete. Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons.

Original plan, acceptance criteria and review history:
[archived CLI-04](./release-0.9.0-plan-archive.md#cli-04).

<a id="cli-05"></a>
### CLI-05: Complete application recipes

Status: Complete. Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.

Original plan, acceptance criteria and review history:
[archived CLI-05](./release-0.9.0-plan-archive.md#cli-05).

<a id="cli-06"></a>
### CLI-06: Structured upgrades

Status: Complete. Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions.

Original plan, acceptance criteria and review history:
[archived CLI-06](./release-0.9.0-plan-archive.md#cli-06).

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

Status: Complete. Validated server actions with input schemas, field errors, and shared resource policies.

Original plan, acceptance criteria and review history:
[archived RT-02](./release-0.9.0-plan-archive.md#rt-02).

<a id="rt-03"></a>
### RT-03: Observable server resources

Status: Complete. Public server resource pending/error/retry state and typed refresh/invalidation.

Original plan, acceptance criteria and review history:
[archived RT-03](./release-0.9.0-plan-archive.md#rt-03).

<a id="rt-04"></a>
### RT-04: State, store, and computed diagnostics

Status: Complete. State/store/computed guidance and serialization/shallow mutation diagnostics.

Original plan, acceptance criteria and review history:
[archived RT-04](./release-0.9.0-plan-archive.md#rt-04).

<a id="rt-05"></a>
### RT-05: Typed tasks and stale-work cancellation

Status: Complete. Typed task dependencies, contextual failures, and cancellation of stale async work.

Original plan, acceptance criteria and review history:
[archived RT-05](./release-0.9.0-plan-archive.md#rt-05).

<a id="rt-06"></a>
### RT-06: Optimistic updates and rollback

Status: Complete. Consistent optimistic updates and rollback under failure, concurrency, and disconnects.

Original plan, acceptance criteria and review history:
[archived RT-06](./release-0.9.0-plan-archive.md#rt-06).

<a id="rt-07"></a>
### RT-07: Typed routes and effective route metadata

Status: Complete. Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection.

Original plan, acceptance criteria and review history:
[archived RT-07](./release-0.9.0-plan-archive.md#rt-07).

<a id="rt-08"></a>
### RT-08: Typed URL state

Status: Complete. Typed URL state for search, filtering, sorting and pagination.

Original plan, acceptance criteria and review history:
[archived RT-08](./release-0.9.0-plan-archive.md#rt-08).

<a id="rt-09"></a>
### RT-09: Navigation completion and diagnostics

Status: Complete. Navigation completion and cache/scroll/transition diagnostics.

Original plan, acceptance criteria and review history:
[archived RT-09](./release-0.9.0-plan-archive.md#rt-09).

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

Status: Complete. Typed resource authorization policies and client visibility helpers.

Original plan, acceptance criteria and review history:
[archived RT-14](./release-0.9.0-plan-archive.md#rt-14).

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

Status: Complete. Cache/rate-limit capability checks, consistent TTL units, and transport coverage.

Original plan, acceptance criteria and review history:
[archived RT-18](./release-0.9.0-plan-archive.md#rt-18).

<a id="rt-19"></a>
### RT-19: Realtime lifecycle and recovery

Status: Complete. Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay.

Original plan, acceptance criteria and review history:
[archived RT-19](./release-0.9.0-plan-archive.md#rt-19).

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

Codex checkpoint (2026-10-04): InputOTP now has one native field with decorative
slots, typed props/events, controlled/default values, completion and native reset
handling. See the [review evidence](./release-0.9.0.md#codex-input-otp-2026-10-04).
Combobox now has stable IDs, typed native input props, controlled/default selection,
accessible popup navigation and native form/reset acceptance. See the
[Combobox review](./release-0.9.0.md#codex-combobox-2026-10-04).
Continue MultiSelect and DatePicker through the UI audit. RT-23 stays open.

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
remaining audit work.
Renderer plain/live select values now commit after dynamic options, with stale queued
writes canceled on replacement or removal. Plain spread select values preserve
manual selection on unrelated renders. Textarea/select SSR now uses escaped text and selected options. Textarea, Select
and NativeSelect have closed native contracts and retained-hydration acceptance.
Plain input/textarea spreads also preserve edits when the bound value is unchanged.
A browser-specific renderer entry removes the SSR parser from normal UI bundles.
Explicit browser serialization uses `/server`. InputGroup and PasswordInput now
have native contracts, composed callbacks, ARIA reference types and retained SSR
hydration. Password reveal respects disabling and pointer/keyboard focus ownership.
Next: MultiSelect and DatePicker. See the
[input-addon checkpoint](./release-0.9.0.md#codex-input-addons-2026-10-04).
See the [SSR control checkpoint](./release-0.9.0.md#codex-form-ssr-2026-10-04).
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

Status: Complete. Build-time capability checks across Cloudflare, Node, Deno, and Desktop.

Original plan, acceptance criteria and review history:
[archived RT-25](./release-0.9.0-plan-archive.md#rt-25).

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

Status: Complete. Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation. Remote secret validation remains Wrangler's deployment responsibility.

Original plan, acceptance criteria and review history:
[archived CF-03](./release-0.9.0-plan-archive.md#cf-03).

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

Status: Complete. Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams.

Original plan, acceptance criteria and review history:
[archived CF-05](./release-0.9.0-plan-archive.md#cf-05).

<a id="cf-06"></a>
### CF-06: Built-artifact runtime tests

Status: Complete. Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime.

Original plan, acceptance criteria and review history:
[archived CF-06](./release-0.9.0-plan-archive.md#cf-06).

<a id="cf-07"></a>
### CF-07: Public-only SSG and protected assets

Status: Complete. Public-only SSG and correct Worker-first routing for protected assets.

Original plan, acceptance criteria and review history:
[archived CF-07](./release-0.9.0-plan-archive.md#cf-07).

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

Status: Complete. Remove tracked credential values; report any required external credential rotation without exposing values.

Original plan, acceptance criteria and review history:
[archived CF-11](./release-0.9.0-plan-archive.md#cf-11).

## Release gates

These tasks establish release readiness after implementation. A passing narrow
test is evidence for its behavior only. It does not close unrelated features
or the final release audit.

<a id="rel-01"></a>
### REL-01: Reported regressions

Status: Complete. Fix reports.md issues and verify package/SSG regressions.

Original plan, acceptance criteria and review history:
[archived REL-01](./release-0.9.0-plan-archive.md#rel-01).

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
