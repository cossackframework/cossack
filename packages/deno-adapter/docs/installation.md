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

## Framework runtime acceptance

From the framework repository, run `pnpm test:deno` with Deno 2.9+ on `PATH`, or
set `COSSACK_DENO_BINARY` to its executable. This gate builds and installs local
package tarballs, runs a generated application in Deno with Chromium, runs the
native adapter smoke tests with Deno type checking, and repeats generated
application acceptance against workspace packages. A missing Deno executable
fails the gate. This verifies local production execution; Deno development,
Deno Deploy and the full release matrix require separate acceptance.
