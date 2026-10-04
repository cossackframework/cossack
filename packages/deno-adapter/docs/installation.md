---
title: Installation
description: Install and configure the Cossack Deno web adapter.
---

# Installation

```sh
cossack create my-app --adapter deno
cd my-app
pnpm install
```

For manual installation:

```sh
pnpm add @cossackframework/deno-adapter hono
pnpm add -D @types/deno
```

Create the adapter with `Deno.env.toObject()`, pass it to `createApp()`, export
a `fetch` handler for Deno Deploy, and call `runtime.serve(app)` when
`import.meta.main` is true. Generated projects provide `deno task build`,
`deno task start`, and `deno task deploy`. Commit `deno.lock` and grant only the
permissions required by the application.

Generated applications use `nodeModulesDir: "manual"`. Run `pnpm install` before
building or starting them; Deno uses that installed dependency tree. Do not switch
to automatic installation in a project whose dependencies are managed by pnpm.
The generated server reads `PORT` (default `8000`) and `HOST` (default `0.0.0.0`)
from the process environment. Set these variables when starting the process;
the production entry does not load `.env` files itself.

## Start through the Cossack CLI

After `pnpm run build`, run `pnpm exec cossack start` or
`pnpm exec cossack start --json`. The CLI selects Deno from the scaffold manifest
or package metadata, finds the project root even when invoked from a subdirectory,
and runs the built server with environment, network and read permissions.
Set `COSSACK_DENO_BINARY` to select an executable; otherwise it uses `deno` from
`PATH`. To customize Deno permissions, edit the generated `deno.json` start task
and use `deno task start`.

Additional CLI arguments follow the server entry as application arguments.
Forwarding preserves each argument, including a literal `--`. JSON mode emits
`started` and `stopped`/`failed` events with `adapter: "deno"` and `tool: "deno"`;
it excludes application output and arguments. `started` confirms process creation,
not HTTP readiness. Both output modes supervise SIGINT/SIGTERM shutdown with a
bounded wait. A forced stop is a failure and does not prove application cleanup.

## Framework runtime acceptance

From the framework repository, run `pnpm test:deno` with Deno 2.9+ on `PATH`, or
set `COSSACK_DENO_BINARY` to its executable. This gate builds and installs local
package tarballs, runs a generated application in Deno with Chromium and checks normal/JSON CLI
startup, runs the
native adapter smoke tests with Deno type checking, and repeats generated
application acceptance against workspace packages. A missing Deno executable
fails the gate. The gate also checks Vite/Deno development, server reload, startup
repair and parent-crash cleanup. Development trace cases drive HTTP, SSE and
WebSocket actions through `cossack dev`, compare browser records with CLI/MCP
reads, and check production exclusion. HTTPS cases use OpenSSL to create a
one-day local test certificate; install OpenSSL before running the gate. Certificate
verification is bypassed only in that test browser context. Deno Deploy and the
full release matrix require separate acceptance.

## Develop with Vite and Deno

Generated Deno projects include `cossackDeno()` from
`@cossackframework/deno-adapter/vite` in their web Vite configuration. Run
`pnpm dev` with Deno on PATH, or set `COSSACK_DENO_BINARY`. Vite runs in Node and
owns the compiler, browser assets and browser HMR connection. Server modules
execute in a separate Deno process through Vite's module runner.

The source entry exports `app.fetch`, `env`, and optionally `runtime.dispose`.
New projects provide these exports. For an older generated entry named
`frameworkApp`, export it as `app` when adding this plugin. Vite loads mode-specific
environment files; process variables take precedence. Server-source edits replace
the Deno process, close its sockets and reset its process-local state. External
side effects are not rolled back.

The plugin forwards HTTP and WebSocket requests through authenticated loopback
connections. It removes its private headers and environment configuration before
calling application code. Application code is trusted local code; this connection
is not a sandbox. Middleware-mode Vite servers are currently rejected explicitly.
Desktop configurations exclude this web plugin.

Configure HTTPS through Vite's `server.https` options. Vite terminates TLS and
forwards the public URL to Deno, including the HTTP/2 authority. Application origin
checks use that URL. Application WebSockets use WSS on the same public listener.

With `cossackPages({ developmentTraces: true })`, Deno reports native-response
cleanup through a separate authenticated runner WebSocket. This shares Vite's
custom-event channel and does not modify response bodies. Server edits still
replace the Deno process; the event connection does not re-evaluate the retiring
application. Trace collection and read commands follow the framework's development
trace guide; recorded evidence does not establish live state.

`cossackDeno({ entry, executable, startupTimeoutMs, shutdownTimeoutMs })` can select
a source entry or executable and adjust the lifecycle deadlines. Defaults are
`/src/index.ts`, `COSSACK_DENO_BINARY` or `deno`, 30 seconds for startup and
3 seconds for shutdown. The child also owns a shutdown timer so loss of the Vite
parent cannot leave it waiting forever on application cleanup. Forced termination
stops local execution; it does not prove that application cleanup completed.
