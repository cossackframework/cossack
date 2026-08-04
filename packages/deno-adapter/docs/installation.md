---
title: Installation
description: Install and configure the Cossack Deno adapter.
---

# Installation

## Requirements

- Deno 2.9 or newer
- A Cossack application using ESM
- Hono 4.12 or newer
- Vite for client and SSR builds

Check the installed runtime before continuing:

```sh
deno --version
```

## Create a web project

Choose the web adapter independently:

```sh
cossack create my-app --adapter deno
cd my-app
pnpm install
```

Create a Cloudflare web app with a Deno Desktop target, for example:

```sh
cossack create my-app --adapter cloudflare --features ui,desktop
```

Node.js and Deno are also valid web adapters. Adding `desktop` always generates
`src/desktop/index.ts` and `deno.json` for the local target without changing the
web adapter's `src/index.ts`.

The non-interactive Deno web database default is Turso. Select another compatible
provider explicitly when needed:

```sh
cossack create my-app --adapter deno --features database --database sqlite
cossack create my-app --adapter deno --features database --database postgres
cossack create my-app --adapter deno --features database --database mysql
```

D1 and Hyperdrive are Cloudflare-only providers.

When the same server method accesses a database in both web and Desktop builds,
choose a provider/configuration supported by both runtimes, such as remote
Turso or PostgreSQL. A D1-backed Cloudflare method cannot run unchanged in the
local Deno target.

## Add the package manually

With pnpm:

```sh
pnpm add @cossackframework/deno-adapter hono
pnpm add -D @types/deno
```

With Deno's package manager:

```sh
deno add npm:@cossackframework/deno-adapter npm:hono
```

When manually managing `deno.json`, map packages that are imported from Deno
configuration or source files:

```json
{
  "nodeModulesDir": "auto",
  "imports": {
    "hono": "npm:hono@^4.12.0",
    "vite": "npm:vite@^8.0.0"
  },
  "tasks": {
    "dev": "pnpm run dev",
    "build": "pnpm run build",
    "start": "deno run --allow-env --allow-net --allow-read dist/server/index.js",
    "deploy": "deno task build && deno deploy"
  }
}
```

Pin versions appropriate for the application rather than copying the example
constraints indefinitely. Commit `deno.lock`; it is part of a reproducible Deno
application build.

## Configure Vite

Use the Cossack plugins and bundle Hono into the SSR output consumed by Deno
Desktop:

```ts
import { defineConfig } from 'vite';
import { cossackPlugin } from '@cossackframework/framework/vite-plugin';
import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';

export default defineConfig({
  plugins: [cossackPlugin(), cossackSecurityPlugin()],
  ssr: {
    noExternal: [
      '@cossackframework/core',
      '@cossackframework/deno-adapter',
      '@cossackframework/framework',
      '@cossackframework/renderer',
      'hono',
    ],
  },
});
```

Keep the project's complete generated Vite configuration when using the
scaffold; the excerpt only highlights the Deno-specific SSR requirement.

## Create a Deno web server entry

```ts
import { createDenoAdapter } from '@cossackframework/deno-adapter';
import { createApp } from '@cossackframework/framework/router';
import { App } from './App.ts';
import { template } from './root.ts';

export const env: Record<string, unknown> = Deno.env.toObject();
export const runtime = createDenoAdapter({ env });
export const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: runtime,
});

export default {
  fetch: (request: Request, requestEnv?: Record<string, unknown>) =>
    runtime.fetch(app, request, requestEnv),
};

if (import.meta.main && typeof (Deno as any).BrowserWindow !== 'function') {
  runtime.serve(app);
}
```

The Desktop guard matters because `deno desktop` automatically serves the
module's default `fetch` export. Calling `runtime.serve()` a second time would
try to bind the reserved Desktop address twice.

## Create the independent Desktop entry

For Node.js and Cloudflare web projects, keep `src/index.ts` unchanged and add
the generated `src/desktop/index.ts`:

```ts
import { createDenoAdapter } from '@cossackframework/deno-adapter';
import { createApp } from '@cossackframework/framework/router';
import { fileURLToPath } from 'node:url';
import { App } from '../App.ts';
import { template } from '../root.ts';

const assetsRoot = fileURLToPath(new URL('../client/', Deno.mainModule));
const runtime = createDenoAdapter({ env: Deno.env.toObject(), assetsRoot });
const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: runtime,
});

export default {
  fetch: (request: Request, env?: Record<string, unknown>) =>
    runtime.fetch(app, request, env),
};
```

Both entries discover the same `src/pages/` modules through the Cossack Vite
plugin.

## Verify the web setup

```sh
deno task build
deno task start
```

Then open the printed local URL. Continue with [Web](./web.md) for runtime
options or [Desktop](./desktop.md) to add a native target.
