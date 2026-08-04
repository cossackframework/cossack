# `@cossackframework/deno-adapter`

The runtime adapter for running one Cossack application on Deno, Deno Deploy,
and Deno Desktop. It connects Cossack's runtime-neutral router and component
model to `Deno.serve()`, Hono's Deno helpers, process-local WebSockets, built
assets, and a local Desktop server-method target.

## Package information

| | |
| --- | --- |
| Package | `@cossackframework/deno-adapter` |
| Runtime | Deno 2.9 or newer |
| Web targets | Local Deno and Deno Deploy |
| Desktop targets | Deno Desktop with WebView or CEF |
| Module format | ESM |
| License | MIT |

The package exports three entry points:

| Import | Purpose |
| --- | --- |
| `@cossackframework/deno-adapter` | `createDenoAdapter()` and runtime types |
| `@cossackframework/deno-adapter/desktop` | Runtime detection and optional low-level window bindings |
| `@cossackframework/deno-adapter/desktop/client` | Optional browser-safe direct-binding client |

## Installation

The recommended setup is the Cossack scaffold:

```sh
cossack create my-app --adapter deno
cd my-app
pnpm install
```

Add the optional Deno Desktop target to any Cossack web project with:

```sh
cossack add desktop
pnpm install
```

For manual installation:

```sh
pnpm add @cossackframework/deno-adapter hono
pnpm add -D @types/deno
```

Or manage the npm dependencies with Deno:

```sh
deno add npm:@cossackframework/deno-adapter npm:hono
```

## Minimal server

```ts
import { createDenoAdapter } from '@cossackframework/deno-adapter';
import { createApp } from '@cossackframework/framework/router';
import { App } from './App.ts';
import { template } from './root.ts';

const env: Record<string, unknown> = Deno.env.toObject();
const runtime = createDenoAdapter({ env });
const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: runtime,
});

export default {
  fetch: (request: Request, requestEnv?: Record<string, unknown>) =>
    runtime.fetch(app, request, requestEnv),
};

// `deno desktop` serves the default export itself.
if (import.meta.main && typeof (Deno as any).BrowserWindow !== 'function') {
  runtime.serve(app);
}
```

`createDenoAdapter()` injects configured environment values and an
`ASSETS.fetch()`-compatible binding, serves the Vite client output, and handles
Cossack WebSocket upgrades without moving routing, authentication, origin
validation, or scope calculation out of the framework.

## Automatic Desktop methods

Desktop runs a local Deno Cossack server against the same `src/pages/` tree.
Undecorated methods keep their normal server-only behavior: their bodies are
stripped from the browser bundle and calls are automatically sent through
Cossack RPC. No `desktop.invoke()` call is required.

```ts
@State() count = 0;

async init() {
  if (this.isDesktop) {
    this.count = Number.parseInt(localStorage.getItem('count') ?? '0', 10);
  }
}

increment() {
  this.count += 1;
  if (this.isDesktop) localStorage.setItem('count', String(this.count));
}
```

Use `this.isDesktop` or `this.runtime.platform` inside server-only code. The web
target may remain Cloudflare Workers, Node.js, or Deno; only the additional
Desktop target is always Deno.

## Documentation

- [Introduction](./docs/introduction.md)
- [Installation](./docs/installation.md)
- [Deno web and Deno Deploy](./docs/web.md)
- [Deno Desktop](./docs/desktop.md)
- [Desktop counter example](../../examples/deno-desktop-counter/README.md)
- [Deno Desktop documentation](https://docs.deno.com/runtime/desktop/)
- [Hono on Deno](https://hono.dev/docs/getting-started/deno)

## Runtime boundaries

- Deno WebSocket component instances are bounded, idle-evicted, and local to
  one process. They do not synchronize across Deno Deploy instances.
- `stateful: true` is rejected on the Deno adapter. Persist durable application
  data through a database.
- Normal undecorated/`@Server()` methods are the automatic Desktop bridge and
  remain the right place for application logic and machine-local Deno APIs.
- Low-level direct bindings remain available for unusual per-window operations
  that intentionally bypass component RPC, but ordinary page actions do not
  need them.
- The Desktop `raw` backend is unsupported because Cossack requires an HTML
  webview. Use the default WebView backend or CEF.
