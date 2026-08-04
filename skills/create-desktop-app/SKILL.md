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

Generated Desktop targets must have a stable `desktop.app.identifier`. The
scaffold derives `dev.cossack.<project-name>` by lowercasing the project
basename, replacing non-alphanumeric runs with hyphens, trimming hyphens, and
falling back to `app`.

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

## 7. Use the native shell façade

Import `createDesktopShell()` from
`@cossackframework/deno-adapter/desktop` in Desktop bootstrap code or inside an
ordinary server method. Do not add another browser bridge.

The shell adopts the startup `BrowserWindow` once and exposes native menus,
context menus, trays and tray panels, Dock/taskbar controls, dialogs, and
notifications. Passing `{ window }` creates a shell scoped to an additional
window.

- Preserve native `Deno.MenuItem` shapes and rebuild menus to change them.
- Pass PNG bytes to trays. Check `tray.trayId !== 0` before implementing
  close-to-tray; otherwise allow close so the app cannot become inaccessible.
- Add an explicit Quit action that bypasses close-to-tray and destroys the tray.
- Treat unsupported Dock operations as platform no-ops.
- Check notification permission and request it only after an explicit user
  action. Handle `denied` and `default`, and use notification click events to
  focus the window.
- Do not implement file/folder pickers until Deno provides a first-class native
  API.

Configure native app icons per platform: a PNG size array for macOS, a
multi-resolution ICO for Windows, a 512px PNG for Linux, and a separate
transparent 22px tray PNG. Keep all configured paths committed and ensure the
packaging command includes runtime-read tray assets.

## 8. Develop and package

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

Resolve the packaged asset directory from the compiled main module, not the
process working directory:

```ts
import { fileURLToPath } from 'node:url';

const assetsRoot = fileURLToPath(new URL('../client/', Deno.mainModule));
const runtime = createDenoAdapter({ env: Deno.env.toObject(), assetsRoot });
```

GNOME, Windows, and macOS launchers may start outside the project directory;
leaving the adapter at `./dist/client` breaks the manifest, styles, images,
hydration, and RPC handlers in an installed package.

## 9. Verify

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
6. Every configured icon exists and has the intended dimensions/ICO frames.
7. The client bundle contains no Deno shell implementation or native imports.

Follow the official Deno Desktop documentation for
[menus](https://docs.deno.com/runtime/desktop/menus/),
[tray and Dock](https://docs.deno.com/runtime/desktop/tray_and_dock/),
[dialogs](https://docs.deno.com/runtime/desktop/dialogs/),
[notifications](https://docs.deno.com/runtime/desktop/notifications/), and
[app icons](https://docs.deno.com/runtime/desktop/configuration/#appicons).

Use the adapter guides at
`packages/deno-adapter/docs/{introduction,installation,web,desktop}.md` when the
monorepo is available. Otherwise consult the published
[`@cossackframework/deno-adapter` documentation](https://github.com/cossackframework/cossack/tree/master/packages/deno-adapter/docs).
