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
