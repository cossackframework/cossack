# Deno Desktop

Add Deno Desktop as a side target to a Cossack application. The web target may
continue to use Cloudflare Workers, Node.js, or Deno. Desktop always packages
an independent local Deno server.

## Add the target

```sh
cossack create my-app --adapter cloudflare --features ui,desktop
# or, inside an existing Cloudflare, Node.js, or Deno project:
cossack add desktop
```

Require Deno 2.9 or newer for Desktop. Default to WebView; choose CEF only when
the app needs bundled Chromium behavior. Never select the raw backend because
Cossack requires an HTML webview.

## Keep routes shared

- Keep shared UI and routing in `src/pages/`.
- Keep the selected web adapter in `src/index.ts`.
- Use `src/desktop/index.ts` for the local Deno server entry.
- Resolve `dist/client` from `Deno.mainModule` and pass the absolute path as
  `createDenoAdapter({ assetsRoot })`; packaged launchers have no stable cwd.
- Keep native windows, menus, and other Deno-only infrastructure under
  `src/desktop/`.
- Do not introduce a Desktop-specific route tree.

## Use normal Cossack RPC

Undecorated methods are server methods. Cossack strips them from the client and
automatically proxies calls to the active target: the configured web server in
a browser, or the packaged local Deno server in Desktop.

```ts
import { Cossack, Page, State } from '@cossackframework/core';

const STORAGE_KEY = 'preference.theme';

@Page({ transport: 'http' })
export default class PreferencesPage extends Cossack {
  @State() theme = 'system';

  async init() {
    if (this.isDesktop) {
      this.theme = localStorage.getItem(STORAGE_KEY) ?? 'system';
    }
  }

  saveTheme(theme: string) {
    if (!['light', 'dark', 'system'].includes(theme)) {
      throw new TypeError('invalid theme');
    }
    this.theme = theme;
    if (this.isDesktop) localStorage.setItem(STORAGE_KEY, theme);
  }
}
```

Use `this.isDesktop` for target-specific behavior. Do not decorate methods with
`@Client()` when they need Deno APIs: that makes them execute inside the
webview. Handlers still own authentication, authorization, input validation,
and safe filesystem/path handling.

## Respect runtime compatibility

Prefer Web Standard APIs in shared methods. A database provider must support
every runtime where its method executes. Remote Turso and PostgreSQL can serve
shared targets; D1 and Hyperdrive remain Cloudflare-only.

Use `@tursodatabase/database` for current embedded/Desktop Turso and
`@tursodatabase/serverless` for remote Turso. Do not add the outdated libSQL
client.

Deno WebSocket instances are bounded and process-local. Never request
`stateful: true`; persist important state in a database.

## Direct bindings are an escape hatch

Use `defineDesktopBindings()`, `attachDesktopBindings()`, and
`createDesktopClient()` only when an operation must bypass route RPC and target
a particular native window. Keep an explicit allowlist, import only registry
types into shared code, validate handler inputs, and attach every additional
window explicitly.

Do not manually call `desktop.invoke()` for ordinary page actions, local
persistence, business logic, database access, or remote services.

## Use the native shell without another bridge

Use `createDesktopShell()` in `src/desktop/` bootstrap modules or ordinary
server-only methods. It adopts the startup window once and delegates Deno's
native object shapes for application/context menus, trays and panels, Dock or
taskbar controls, dialogs, and notifications.

```ts
const { createDesktopShell } = await import(
  '@cossackframework/deno-adapter/desktop'
);
const shell = createDesktopShell();
```

- Outside Desktop, check `available`; native calls throw
  `DesktopUnavailableError`.
- A tray with `trayId === 0` is unsupported. Never hide the last window on
  close in that case.
- Add an explicit Quit path when implementing close-to-tray.
- Unsupported Dock operations intentionally remain no-ops.
- Request notification permission only in response to a user action and report
  denial. Notification handles support show, click, close, error, and `close()`.
- Keep file/folder pickers out of the shell until Deno exposes a native picker.

Package a macOS PNG size array, a multi-resolution Windows ICO, a 512px Linux
PNG, and a separate transparent 22px tray PNG. A stable
`desktop.app.identifier` gives packaged notifications a stable OS identity.

Use Deno's official
[menus](https://docs.deno.com/runtime/desktop/menus/),
[tray/Dock](https://docs.deno.com/runtime/desktop/tray_and_dock/),
[dialogs](https://docs.deno.com/runtime/desktop/dialogs/),
[notifications](https://docs.deno.com/runtime/desktop/notifications/), and
[icon configuration](https://docs.deno.com/runtime/desktop/configuration/#appicons)
guides for current platform behavior.

## Build and verification

The generated Desktop tasks first build the shared client and the explicit
`src/desktop/index.ts` server entry, then run `deno desktop`. Avoid bare
`deno desktop .`, which can be detected as a client-only Vite app.

Keep `deno.lock` tracked. Ignore Desktop executables, runtime `.so` files,
launcher metadata, `.deno-desktop-app`, `.downloaded`, `dist/`, and
`node_modules/`.

Verify the chosen web target, automatic local Desktop actions, type checking,
web production build, Desktop production build, and persistence after a full
close/relaunch.
