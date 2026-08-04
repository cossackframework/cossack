---
title: Deno Desktop
description: Run shared Cossack server methods automatically in a local Deno Desktop target.
---

# Deno Desktop

Deno Desktop packages a local Cossack HTTP server and its client assets with a
native webview. It uses the same `src/pages/` tree as the web application. The
web runtime may be Cloudflare Workers, Node.js, or Deno; the additional Desktop
runtime is always Deno.

## Add the target

```sh
cossack add desktop
pnpm install
```

For a new application:

```sh
cossack create my-app --adapter cloudflare --features ui,desktop
```

Replace `cloudflare` with `node` or `deno` for a different web target. Switching
the web adapter later preserves Desktop.

The generated `deno.json` defaults to the platform WebView. Set
`desktop.backend` to `cef` when the application needs bundled Chromium. Do not
select `raw`; Cossack requires an HTML webview.

## Target layout

```text
src/
├── index.ts                 # Cloudflare, Node.js, or Deno web entry
├── pages/                   # shared pages and methods
│   └── index.ts
└── desktop/
    └── index.ts             # local Deno Desktop entry
```

There is no Desktop-specific router. Both entries load the same pages, layouts,
middleware registry, App component, and root template.

## Colocate native behavior with the component

Methods without a client-safe decorator are already server-only in Cossack.
Their bodies are removed from the client bundle and replaced with automatic
RPC proxies. In a Desktop window the proxy calls the packaged local Deno server,
so no manual `desktop.invoke()` layer is needed:

```ts
import { Cossack, Page, State } from '@cossackframework/core';

const STORAGE_KEY = 'counter';

@Page({ transport: 'http' })
export default class CounterPage extends Cossack {
  @State() count = 0;

  async init() {
    if (!this.isDesktop) return;
    const value = Number.parseInt(
      localStorage.getItem(STORAGE_KEY) ?? '0',
      10,
    );
    this.count = Number.isFinite(value) ? value : 0;
  }

  increment() {
    this.count += 1;
    if (this.isDesktop) {
      localStorage.setItem(STORAGE_KEY, String(this.count));
    }
  }

  decrement() {
    this.count -= 1;
    if (this.isDesktop) {
      localStorage.setItem(STORAGE_KEY, String(this.count));
    }
  }
}
```

Do not add `@Client()` to these methods: that would retain and execute their
bodies inside the webview. Leave them undecorated or add `@Server()` explicitly
when you want to emphasize the boundary.

Calls from event handlers use the normal Cossack method syntax:

```ts
render() {
  return html`
    <output>${this.count}</output>
    <button @click=${this.decrement}>−</button>
    <button @click=${this.increment}>+</button>
  `;
}
```

The client proxy chooses `/crpc` for HTTP/SSE pages or WebSockets for a
WebSocket-backed page. Returned `@State()` is synchronized through the existing
Cossack protocol.

## Detect the target

Components receive framework-owned runtime identity during SSR, hydration, and
every reconstructed RPC instance:

```ts
this.isDesktop;                 // boolean convenience getter
this.runtime.platform;         // 'web' | 'desktop'
this.runtime.adapter;          // 'deno' in the Desktop target
```

Use this only inside server-only methods or for harmless rendering differences.
It is not an authorization check.

## Use native APIs safely

Native code remains in the server-only method body, so it is stripped from the
browser bundle. Prefer feature access through `globalThis` when the same source
must also build for Cloudflare or Node.js:

```ts
async chooseFile() {
  if (!this.isDesktop) throw new Error('Desktop only');
  const deno = (globalThis as any).Deno;
  // Call the required Deno Desktop API here.
}
```

Validate all paths, identifiers, and domain values even though the method is
local. Cossack RPC only exposes registered server methods and sanitizes incoming
state, but the webview is still an input boundary.

## Different web and Desktop runtimes

The scaffold treats Desktop as an independent build target:

| Target | Entry | Runtime |
| --- | --- | --- |
| Web | `src/index.ts` | Selected adapter: Cloudflare, Node.js, or Deno |
| Desktop | `src/desktop/index.ts` | Deno adapter |

Application code must be compatible with every target in which it executes.
For a platform-specific branch, use `this.isDesktop`. For shared database calls,
select a database supported by both runtimes or isolate the provider-specific
operation behind separate server logic. D1 and Hyperdrive remain
Cloudflare-only; Deno Desktop supports SQLite, PostgreSQL, MySQL, and Turso.

Use `@tursodatabase/database` for embedded/Desktop Turso and
`@tursodatabase/serverless` for remote Turso. Do not add the outdated libSQL
client.

## Direct per-window bindings

The `defineDesktopBindings()` and `createDesktopClient()` APIs remain as a
low-level escape hatch for operations that intentionally bypass component RPC,
for example a high-frequency per-window channel or a binding attached to only
one additional window. Ordinary page actions should use colocated server
methods.

Direct bindings remain allowlisted, capability-token protected, typed across
the client boundary, and limited to serialized values. Their handlers still
require domain validation. Attach a registry explicitly to every additional
window with `attachDesktopBindings(window, registry)`.

## Development and packaging

The scaffold provides:

```sh
deno task build:desktop
deno task desktop:dev
deno task desktop:build
```

The build uses the explicit Cossack Desktop entry, preventing Deno from
misidentifying the project as a client-only Vite application:

```sh
vite build
vite build --ssr src/desktop/index.ts \
  --outDir dist/desktop-server \
  --minify false

deno desktop -A \
  --exclude-unused-npm \
  --include dist/client \
  dist/desktop-server/index.js
```

The default output directory lives under ignored `dist/desktop`. Keep
`deno.lock` committed, but do not commit packaged executables, runtime `.so`
files, launcher metadata, `.deno-desktop-app`, or `.downloaded` markers.

Grant narrower permissions than `-A` for production packages once the native
feature set is known.

## Persistence example

[`examples/deno-desktop-counter`](../../../examples/deno-desktop-counter/README.md)
uses the automatic model above. Its browser state remains in memory; the same
`init`, `increment`, and `decrement` methods execute in the local Deno server and
persist through Deno-side `localStorage` when `this.isDesktop` is true.

## Current limits

- Desktop server state and WebSockets remain process-local.
- `stateful: true` is unsupported on the Deno adapter.
- Menus, tray integration, deep links, auto-update, signing/notarization
  automation, and Desktop OAuth flows are outside the v1 adapter surface.
- The raw renderer backend is unsupported.
