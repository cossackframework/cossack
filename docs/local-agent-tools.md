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

## Current scope

The initial tool exposes static inspection and configuration diagnostics. Installed
API documentation, stored test results and development traces still need the CLI-08
and RT-28 shared services. The server does not yet expose those tools. It does not
build, test, mutate, deploy or provision an application.

The implementation uses the official SDK's
[stdio server entrypoint](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/serveStdio.html).
Tests cover both legacy initialization and protocol revision `2026-07-28`.
