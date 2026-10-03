# Work with the installed Cossack packages

Use pnpm for package commands. Start with `pnpm exec cossack docs --json` to list
installed package versions, public export targets and command schemas. This guide
belongs to the reported CLI version. Package versions can differ from each other.

Inspect the application with `pnpm exec cossack inspect routes --json`. Use
`pnpm exec cossack check routes --json` for static diagnostics. These commands do
not prove runtime correctness. Cloudflare and provider inspection have separate
scopes: `inspect cloudflare` and `inspect providers`.

Use the catalog's exact public import paths. Do not import repository internals.
A present export target only proves that a file exists. It does not prove that a
named symbol exists, that runtime dependencies resolve or that an API works on
all adapters. The catalog reports those limits explicitly. Wildcard entries include
concrete matches and a discovery status. Read partial-discovery reasons before
assuming the list is complete. Blocked exports remain blocked.

For named exports and signatures, select a package:

```sh
pnpm exec cossack docs --package @cossackframework/core --symbols --json
```

Replace the package name when needed. MCP `read_documentation` accepts the same package and `symbols: true`.
Package-owned usage guides appear under each package's `guidance` field. Read
its status, version and omitted entries. Example source is data: discovery does
not execute it. A guide can explain usage without proving all runtime targets.

Read the declaration index status and diagnostics before relying on its types.
Partial results can contain unresolved types. Type-only re-exports do not provide
runtime values, even when their underlying declaration is a class or function.

Keep server logic behind the framework's server boundary. Use declared request
and service scopes for request facilities. Read the installed types before calling
an unfamiliar API. Do not use an online example from another version as proof.

Read command help before a mutation. Prefer inspection and supported dry runs to
learn what an action will change. Never treat a successful local configuration
check as proof that remote credentials, bindings or deployment are ready.

For an MCP host, start `cossack-mcp --project /absolute/path/to/app`. Use
`inspect_project` for static facts and `read_documentation` for this offline
catalog. Neither tool builds, executes tests, deploys or provisions the app.
