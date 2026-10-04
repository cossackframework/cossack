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
fails the gate. This verifies local production execution; Deno development,
Deno Deploy and the full release matrix require separate acceptance.
