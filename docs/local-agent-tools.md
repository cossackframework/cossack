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
candidate import, target, conditions and resolved declaration. Missing public type
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
index with diagnostic codes and source locations. A missing type entry produces an
unavailable index. The declaration hash changes when referenced declarations change,
even if the package version and manifest do not. Reads do not reuse an old program.

Declaration signatures do not prove runtime exports. For example, a class reached
through `export type *` has a constructor declaration but provides no runtime value.
All runtime availability remains `not-verified`. Discovery considers matching
runtime files and declaration siblings, so type-only installations can expose
signatures while their runtime targets remain missing. It does not execute or infer
types from JavaScript bodies. A resolver-selected source file is reported as
`source-not-indexed` instead of silently treated as a declaration. Candidate
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

These tools expose static inspection, configuration diagnostics and the initial
offline catalog with declaration signatures. Authored API/component examples,
verified runtime guidance and installed-tarball acceptance remain CLI-08 work. Stored test results and development traces
still need shared services. The server does not build, test, mutate, deploy or
provision an application.

The implementation uses the official SDK's
[stdio server entrypoint](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/serveStdio.html).
Tests cover both legacy initialization and protocol revision `2026-07-28`.
