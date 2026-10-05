---
title: "Local agent tools"
description: "Inspect a Cossack project through a local MCP server."
---

# Local agent tools

The installed `cossack` package includes `cossack-mcp`, a local Model Context
Protocol (MCP) server. It communicates through stdin/stdout and opens no HTTP port.
Start it with one explicit project directory:

```sh
pnpm exec cossack-mcp --project /absolute/path/to/app
```

An MCP host starts this process and owns its input pipe. For hosts with a
`command`/`args` configuration, point Node directly at the installed entrypoint:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/app/node_modules/cossack/bin/cossack-mcp.js",
    "--project",
    "/absolute/path/to/app"
  ]
}
```

The directory must exist and contain a valid `package.json`. Startup resolves its
real path. Tool arguments cannot select another project or request arbitrary files.
Package metadata and imported declarations use the project's dependency resolution.
The project binding is not a filesystem sandbox against a malicious local project.

## Inspection

`inspect_project` accepts the following input:

| Field | Values |
| --- | --- |
| `scope` | Required: `routes`, `cloudflare`, or `providers`. |
| `environment` | Optional environment name. Defaults to `CLOUDFLARE_ENV` when set. |
| `route` | Optional exact public route or source identity from route inspection. Only valid for `scope: "routes"` with `check: false`. |
| `check` | Optional boolean, default `false`. Report validation errors through `ok: false`. |

Example tool input:

```json
{ "scope": "routes", "check": true }
```

Results contain `schemaVersion: 1`, `versions`, `ok`, `data` and `diagnostics`.
`versions.cli` identifies the server package. `versions.framework` identifies the
framework installed for the project, or is `null` when unavailable. The server
does not execute application modules to detect versions.

The tool uses the CLI's static inspection models, route explanations and checks.
Cloudflare inspection reports binding and secret names, not configured secret
values. Source identities and static declarations remain visible. Dynamic runtime
behavior, built artifacts, credentials and remote readiness remain unverified.
All tool annotations declare read-only, non-destructive, idempotent local work.

Each call owns a worker. Cancellation, shutdown or a 30-second deadline terminates
that worker, including synchronous compiler work. At most four calls run at once.
Results larger than 4 MiB fail with `COSSACK_MCP_RESULT_TOO_LARGE`. Dependency logs
are drained inside workers and cannot corrupt protocol output. EOF, SIGINT and
SIGTERM close the server and its active workers.

## Stored test results

`read_test_results` accepts `{}` for the newest started run or `{ "run": "<run-uuid>" }`.
It shares the reader behind `pnpm exec cossack test-results --json`. Configure the
opt-in `cossack/vitest-reporter` in Vitest 4 to produce records first. A successful
read can contain failed or unfinished tests. Inspect the recorded state, selected
scope and freshness before citing it. These reads never execute tests.
See [setup, interpretation and limits](./test-results.md).

## Offline documentation

Use `read_documentation` with an optional `package` name from the Cossack package
allowlist. The same service backs `pnpm exec cossack docs --json`. To inspect one
package through the CLI:

```sh
pnpm exec cossack docs --package @cossackframework/core --json
```

The catalog reads installed manifests on each call. Each package includes its
version, a manifest hash and declared public export targets. Conditions and array
fallback order remain visible. Targets report present, missing, blocked, invalid
or a declared pattern. Concrete wildcard matches appear as additional entries with
a `pattern` source. Exact entries and more-specific patterns take precedence,
including private null exclusions. Array fallbacks are not guesses based on file
presence: a missing first target does not activate a later one. Missing packages
report `installed: false`.

For exported symbols and signatures, select one package and request declaration
indexing. In MCP, set `symbols: true` with `package`. In the CLI:

```sh
pnpm exec cossack docs --package @cossackframework/core --symbols --json
```

The index follows declared `.d.ts`, `.d.mts` and `.d.cts` targets, including legacy
`types` entries. TypeScript also resolves adjacent declarations for `.js`, `.mjs`
and `.cjs` targets and legacy main/default-index paths. `resolutions` records the
candidate import, target, conditions and resolved file. Packages without an
`exports` map report a separate `implicitEntry` for their declared `main` and
`types` targets, or the default `index.js`. Their `exports` array stays empty.
An explicit blocked root never falls back to `main`. This reports file presence,
not full legacy Node resolution or runtime compatibility.
Missing public type
coverage remains in `unresolvedImports` and makes the index partial. It resolves aliases and re-exports and reports generic/overloaded
call signatures, constructors, public instance/static and object/namespace members,
documentation and
package-relative declaration locations. Private/protected members and constructors
are excluded. `name` is the public export name and `declarationName` is the original
name, which can differ for aliases. Abstract classes are marked explicitly.

The CLI pins TypeScript API 6.0.3 for this analysis. It does not replace the project's
compiler. Analysis uses ES2022, ESNext modules, Bundler resolution, strict checking
and no automatic ambient type packages. It does not load project tsconfig plugins.
Missing platform globals, unresolved imports or unsupported syntax produce a partial
index with diagnostic codes and source locations. If no declaration or TypeScript
source resolves, the index is unavailable. Published `.ts`, `.mts` and `.cts` entries are also indexed
statically. Their resolution status and entry `sourceKind` are `typescript-source`.
Declaration entries use `sourceKind: "declaration"`. Symbol coverage is
`installed-declarations-and-typescript-source`.
The declaration hash changes when referenced declarations or TypeScript source change,
even if the package version and manifest do not. Reads do not reuse an old program.

Declaration signatures do not prove runtime exports. For example, a class reached
through `export type *` has a constructor declaration but provides no runtime value.
All runtime availability remains `not-verified`. Discovery considers matching
runtime files and declaration siblings, so type-only installations can expose
signatures while their runtime targets remain missing. It does not execute or infer
types from JavaScript bodies. A resolver-selected JavaScript file without a type
entry is reported as `source-not-indexed`. TypeScript source bodies are analyzed
without execution. Candidate
conditions are preserved; the catalog does not select a runtime environment.
The first 100 compiler diagnostics are included, alongside the total count.

`exportDiscovery` reports completeness. Pattern scans skip nested symlinks and
`node_modules`, stop after 20,000 directory-entry visits, and report partial results
for unreadable directories, unsupported URL-encoded targets or filenames, malformed
pattern keys and patterns mapped to a constant target. Constant mappings can expose
infinitely many subpath names, so the catalog does not invent a finite list.
Repeated target stars use the same capture. The precedence rules follow
[Node's package export resolution](https://nodejs.org/api/esm.html#resolution-algorithm-specification).

Command schemas and the packaged agent guide belong to the reported CLI version,
which can differ from installed library versions. MCP refreshes framework version
metadata for each response too. The catalog does not replace application type checks.

Generated applications receive an AGENTS guide that points to local discovery.
No network request or application-module execution is needed to read the catalog.
Unknown package paths are rejected. Malformed manifest diagnostics omit raw content.

## Current scope

These tools expose static inspection, configuration diagnostics, declaration
signatures and available package-owned usage guides. The catalog and initial
examples have installed-tarball acceptance. Full API/component/recipe coverage
and verified runtime guidance remain CLI-08 work. Stored test results and development
traces use shared readers for CLI and MCP. The server does not build, test, mutate, deploy or
provision an application.

The implementation uses the official SDK's
[stdio server entrypoint](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/serveStdio.html).
Tests cover both legacy initialization and protocol revision `2026-07-28`.

## Test the installed documentation tools

From the framework repository, run `pnpm test:agent-docs:local`. The test builds
and packs the local packages, creates a minimal application, and installs the
tarballs. Dependency installation can use the registry.

The discovery phase runs the installed CLI and MCP server with Node fetch, socket,
HTTP, TLS and outbound DNS calls disabled. It permits only a synthetic DNS answer
for the numeric `127.0.0.1` address used to bind an embedded test server. The guard
records denied calls even when callers catch their errors. This is a regression
check for ordinary Node networking, not an operating-system sandbox for untrusted
code.

The test checks packaged and generated guides, installed versions, command
schemas, renderer declarations, CLI/MCP parity and refreshed exports after a
package change. It also runs inside `pnpm test:scaffold:local`. These checks do
not certify every package's examples, runtime support or component guidance.


## Package-owned usage guides

Each installed package can ship `agent-docs.json` in its published files. The
catalog returns that package's guidance beside its export and declaration facts.
The CLI text output includes the guides and example source. MCP returns the same
data through `read_documentation`.

`guidance` includes the package name, installed version, content hash, guides and
omitted entries. Status is `available`, `partial`, `unavailable` or `invalid`.
Missing files are unavailable. Invalid or oversized files produce a warning with
no raw contents. A guide whose listed imports are absent or blocked is omitted.
A hash changes when guide content changes, even if the package version stays the same.

The format is `schemaVersion: 1` with a `guides` array. Each guide supplies a unique
`id`, `title`, `summary`, `imports`, `markdown` and `examples`. Each example supplies
a unique `id` within its guide, `language: "typescript"` and `source`. Guide IDs use
lowercase letters, digits and hyphens. Imports must belong to the owning package.
The file has a 256 KiB limit and cannot resolve outside its package directory.
The CLI rejects unknown fields and unsupported schema versions.

The core guides explain route URLs, typed query state, input schemas and nested
form parsing. The focused `@cossackframework/core/input` entry exports schemas,
form parsing and validation errors without component or runtime imports.
Renderer guidance covers escaped server HTML. Scaffold guidance covers resource,
mutation, scoped-service and protected-route recipes. The tarball acceptance
compiles and executes ten standalone examples against installed public exports. Input
examples cover normalization, rejected fields, nested errors, inferred types and
cancellation of an asynchronous refinement. Discovery itself reports
`exampleExecution: "not-performed"` and `runtimeSupport: "not-verified"`.
The recipe examples inspect dependencies and capability requirements through the
pure scaffold registry without writing files. The protected-route example also
checks auth/database/UI dependencies, D1 requirements and an unsupported provider.
Auth guidance covers trusted session resolution, role guards and typed record
policies. Two additional examples check middleware ordering, anonymous/forbidden
decisions, immutable presentation permissions and action lookup. Auth currently
publishes TypeScript source. The acceptance harness checks these examples with
Bundler resolution, bundles them with the installed esbuild dependency, then
executes them under the offline guard. This does not prove plain Node imports, real session storage,
login/cookie issuance or framework RPC authorization.
Framework guides now cover runtime-capability planning and cache guarantees,
including Cloudflare binding names, the process locality of memory cache, and KV's
eventual consistency. Node and Deno adapter guides cover upgrade/fetch lifecycles,
binding precedence, cleanup and their separate Vite development plugins. The
internal `test-utils` workspace package is not part of the published tarball set,
so it is deliberately excluded from installed package guidance.
Studio guidance explains local versus live D1 access and how embedded startup
reports readiness without exposing the private launch token. Its installed
lifecycle example uses a fake connection and aborts as soon as the loopback
server is ready; it never opens a real database.
Three more core examples are complete application pages. They cover validated
component actions, read-only server resources and lifecycle tasks. These pages
need the framework Vite plugins, generated entry and a browser. An ordinary
Node import does not execute their application behavior.

The separate acceptance harness writes the exact packaged source into a generated
application. It checks types, browser/server behavior and client production builds.
It drives valid and rejected actions, SSR resource reuse, dependency changes,
failed-load recovery, refresh and task disposal during navigation. A held task
operation proves that a stale result cannot overwrite its replacement. The
harness also makes sure that private server markers stay out of browser JavaScript
and source maps. It enables maps for the production build and requires map files
before scanning them. CLI/MCP discovery never invokes this harness.

Standalone examples prove Node execution. The application checks cover local
Cloudflare and Node development and production client stripping. They do not
prove live deployment or every transport and runtime combination. Other APIs,
components, recipes and runtime targets still need their own coverage.
The latest tarball gate typechecks and executes all 69 standalone examples from
published package exports plus four separately bundled auth examples, for 73
examples across 66 package guides. Database guidance now exercises the installed
Node SQLite migration apply/status/rollback and repeatable seeder lifecycle as
well as bound Node SQLite and Cloudflare D1 queries. Core guidance includes locale
negotiation, `q=0` exclusions and CLDR plural formatting. The Deno fetch example uses a small
Node compatibility shim for Hono's Deno static-file import; this checks the installed
adapter path and binding precedence, not native Deno or Deno Deploy readiness.


## Component prop declarations

With `--symbols` (or MCP `symbols: true`), public members include their declaration
comments, JSDoc tags and optional callback signatures. Index signatures report
key and value types, readonly status and source locations. An index signature
such as `[key: string]: any` remains visible. It permits arbitrary values and does
not establish type-safe HTML attributes or event handlers.

Exported classes with a public `props` member also include `propsContract`.
It contains the instantiated prop type, its source, public members and index
signatures. Inherited generic props resolve through the compiler. Private and
protected props are excluded. This is a structural declaration view, not automatic
classification of a class as a UI component.

A contract is `declared` when an object shape is available, `partial` for a union
and `unknown` for an unstructured type such as `any`. Union members are only the
properties common to all alternatives. `declared` does not mean every field is
strictly typed. Read index signatures and package diagnostics too.

Union component props keep `propsContract.status: "partial"`. Their `variants`
list exposes each branch's required and optional fields, callback signatures,
and index contracts. For example, Pagination requires either `onPageChange`
or `href`; its shared members alone make both appear optional. Inspect the
variants and packaged guide before combining options. Unknown branches remain
explicit, and a declared branch does not prove runtime behavior.

The catalog does not prove native attribute forwarding, keyboard behavior, labels
or focus management. Those require authored guidance and browser acceptance.
The installed UI check verifies reviewed prop contracts and guides, with exact-symbol
SettingsPanel CLI/MCP parity covering controlled/default value branches, readonly sections and native div targets,
plus DashboardStat readonly metrics, explicit trend/tone types and native list targets,
plus AuthForm required callbacks and native targets,
plus Icon artwork, native SVG targets, naming and style ownership,
plus Bubble readonly reactions and time metadata,
plus Message/Marker contracts and Attachment filenames, native targets and status,
plus Carousel slide identity and sizing,
plus Toaster isolated store types and both
Sidebar collapse-mode branches and Resizable
panel/callback contracts and all six table
exports and the named ScrollArea viewport,
plus Typography native prop branches, Avatar span/image targets, Field callbacks,
Spinner SVG and other reviewed contracts. It retains unresolved platform diagnostics.


For one exported contract, use an exact symbol name:

```sh
pnpm exec cossack docs --package @cossackframework/ui --symbols --symbol Textarea --json
```

MCP `read_documentation` accepts `package`, `symbols: true` and `symbol: "Textarea"`.
Filtering occurs before member expansion. The response retains the selected
symbol's complete contract and lists `availableSymbols` in each declaration entry.
`selection.matched` distinguishes a missing name from a contract with no members.
Unknown names produce `COSSACK_DOCS_SYMBOL_NOT_FOUND` with no fabricated contract.
The MCP result limit remains 4 MiB; use this filter when a full catalog exceeds it.
Declaration signatures still do not prove runtime availability.

## Development traces

`cossack traces --json` and MCP `read_development_traces` read the same bounded
project-local browser records. Supply `--session <uuid>` or `{ "session": "<uuid>" }`
for one capture. The Vite bridge and browser recording must be enabled explicitly.
Inspect `freshness.ageMs` and `live: false`; a record is not proof of current state
or server execution by itself. Joined `server-native` events report native-body
outcome and cleanup over the separate development channel; they do not prove
client consumption. See [capture setup and limits](./development-traces.md#read-captures-from-cli-and-mcp).
