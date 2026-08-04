---
name: create-desktop-app
description: Add a Deno Desktop side target to a Cossack Framework application while preserving its Cloudflare Workers, Node.js, or Deno web runtime. Use for shared web/Desktop pages, automatic local server-method RPC, machine-local Deno APIs, WebView or CEF packaging, persistence, and verification.
---

# Create Desktop App

Add Deno Desktop as an independent application target. Preserve the project's
chosen web adapter. Shared pages use normal Cossack server-method RPC: web
requests run on the web adapter and Desktop requests run on the local Deno
server packaged with the app.

## 1. Inspect the project

Read these files before changing anything:

- `.cossack/scaffold.json` for the recorded web adapter and features
- `package.json` and any existing `deno.json` for tasks and dependencies
- `vite.config.ts` for Cossack plugins and SSR bundling
- `src/index.ts`, `src/pages/`, and any existing `src/desktop/`

Require Deno 2.9 or newer for the Desktop target. Do not switch a Cloudflare or
Node.js web application to Deno merely to add Desktop.

## 2. Prefer the scaffold

For a new application, choose the intended web adapter independently:

```sh
cossack create my-app --adapter cloudflare --features ui,desktop
cd my-app
pnpm install
```

For an existing Cloudflare Workers, Node.js, or Deno application:

```sh
cossack add desktop
pnpm install
```

Use `--desktop-backend cef` only when bundled Chromium behavior is required.
Default to WebView. Reject the raw backend because Cossack renders HTML.

Review generated changes instead of recreating `deno.json`, the Desktop server
entry, or packaging tasks by hand. Keep `deno.lock` tracked. Ignore packaged
executables, runtime `.so` files, launcher metadata, `.deno-desktop-app`,
`.downloaded`, `dist/`, and `node_modules/`.

## 3. Preserve the shared application structure

Keep shared UI and routes under `src/pages/`. The web and Desktop targets each
have a server entry, but they import the same application and route tree:

```text
src/
├── index.ts              # selected web adapter
├── pages/                # shared browser and Desktop UI
└── desktop/
    └── index.ts          # local Deno adapter/server entry
```

Reserve other `src/desktop/` modules for native windows, menus, and Deno-only
infrastructure. Do not add a second Desktop route tree.

## 4. Use automatic server-method RPC

Leave actions undecorated, or mark them `@Server()` explicitly. Cossack strips
their implementation from the client and proxies calls automatically. In a
Desktop window the proxy targets the packaged local Deno server, so methods can
use machine-local Deno APIs without a manual `desktop.invoke()` layer.

```ts
import { Cossack, Page, State } from '@cossackframework/core';

const STORAGE_KEY = 'example.counter';

@Page({ transport: 'http' })
export default class CounterPage extends Cossack {
  @State() count = 0;

  async init() {
    if (!this.isDesktop) return;
    this.count = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
  }

  increment() {
    this.count += 1;
    if (this.isDesktop) {
      localStorage.setItem(STORAGE_KEY, String(this.count));
    }
  }
}
```

Use `this.isDesktop` for a behavioral difference and `this.runtime` when the
full `{ platform, adapter }` runtime identity is needed. Keep handlers
responsible for authorization, validation, and safe path handling.

Do not add `@Client()` to a method that must execute in local Deno. It would run
inside the webview instead of crossing Cossack RPC.

## 5. Keep the targets compatible

The same server method can run under the web adapter and the local Deno
adapter. Use Web Standard APIs where possible and branch on `this.isDesktop`
only for genuinely platform-specific behavior.

Database providers must work on the runtime that executes the method. Shared
web/Desktop database methods should use a provider supported by both targets,
such as remote Turso or PostgreSQL. D1 and Hyperdrive are Cloudflare-only; put
their calls in web-only code or choose a cross-runtime provider for shared
methods.

Use `@tursodatabase/database` for current embedded/Desktop Turso storage and
`@tursodatabase/serverless` for remote Turso. Do not install the outdated
libSQL client.

Do not set `stateful: true` on Deno WebSocket pages. Deno instances are bounded,
idle-evicted, process-local, and do not coordinate across Deno Deploy replicas.

## 6. Use direct Desktop bindings only as an escape hatch

The adapter's typed binding API remains useful for calls that must bypass
Cossack routing and address a particular native window. Examples include
window-specific controls or a callback needed entirely inside client code.

When direct bindings are necessary:

- Define an explicit allowlist with `defineDesktopBindings()` in Deno-only code.
- Attach each additional window with `attachDesktopBindings()`.
- Import only the registry type into browser-safe code.
- Guard `createDesktopClient().invoke()` with `available`.
- Validate all domain values in the binding handler.

Do not use direct bindings for ordinary page actions, persistence, business
logic, database access, or remote services. Those belong in Cossack server
methods.

## 7. Develop and package

Use the generated tasks:

```sh
pnpm run dev              # selected web runtime
pnpm run build
pnpm run start
deno task desktop:dev
deno task desktop:build
```

The Desktop tasks build both the shared browser client and the independent
`src/desktop/index.ts` SSR server before invoking `deno desktop`. Package that
explicit entry rather than running bare `deno desktop .`, which can be detected
as a client-only Vite app.

## 8. Verify

Run:

```sh
pnpm tsc --noEmit
pnpm run test:unit
pnpm run build
deno task desktop:build
```

Then launch the app and verify:

1. The shared page works through the selected web adapter.
2. The Desktop page reports `this.isDesktop === true`.
3. Undecorated actions execute locally without manual binding calls.
4. Closing and relaunching restores any promised local persistent value.
5. Generated Desktop artifacts remain ignored by version control.

Use the adapter guides at
`packages/deno-adapter/docs/{introduction,installation,web,desktop}.md` when the
monorepo is available. Otherwise consult the published
[`@cossackframework/deno-adapter` documentation](https://github.com/cossackframework/cossack/tree/master/packages/deno-adapter/docs).
