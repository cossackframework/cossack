# @cossackframework/desktop

The Electron main-process runtime for Cossack Desktop applications. It serves
the renderer and local Cossack SSR/RPC over the private `cossack://app` origin,
injecting `ASSETS` and a window-scoped `COSSACK_DESKTOP` shell into request
bindings.

```ts
import { createDesktopApp } from '@cossackframework/desktop';

async function main() {
  await createDesktopApp({
    identifier: 'dev.cossack.my-app',
    productName: 'My App',
    assetsRoot: new URL('../../client/', import.meta.url).pathname,
    fetch: (request, env) => app.fetch(request, env),
  });
}

void main();
```

Do not top-level `await` `createDesktopApp()` in an ESM entry. Electron fires
`ready` after the main module's first event-loop tick completes, while Desktop
creation waits for `ready`; start an async function without awaiting it at the
module's top level as shown above.

`createDesktopApp()` forces context isolation and renderer sandboxing, with Node
integration and preload bridges disabled. Only same-origin navigation is
allowed; valid HTTP(S) popups are opened in the operating-system browser.
Desktop pages currently require `@Page({ transport: 'http' })`.

On Linux, `desktop:dev` checks Electron's local `chrome-sandbox` helper. pnpm's
download is normally user-owned rather than root-owned/setuid, so the runner
prints a warning and applies Electron's testing-only `--no-sandbox` flag to the
development process. Forge packages and installed DEB applications do not use
this fallback; the DEB installs its helper with the required permissions.
For Wayland sessions that expose XWayland, the development runner selects X11
to avoid Chromium's current Wayland/Vulkan incompatibility and hides nonfatal
GPU probe noise. Set `COSSACK_DESKTOP_OZONE_PLATFORM=wayland` to force native
Wayland, or `COSSACK_DESKTOP_DEBUG=1` to retain Chromium diagnostics and print
Desktop lifecycle tracing.

The generated Linux desktop entry also starts the installed DEB through
XWayland so Electron can register its tray with GNOME's StatusNotifier host.
An unpacked Forge executable bypasses that desktop entry; launch it with both
`--no-sandbox` and `--ozone-platform=x11` when testing directly from `out/`.
The sandbox flag is only appropriate for that uninstalled test package.

Use Node 22 or 24 LTS for Forge packaging. The current Forge/Packager ZIP stack
can extract Electron pathologically slowly under Node 26; generated Desktop
projects declare `node: ">=22 <26"` until that upstream combination is fixed.

Use Electron APIs in the bootstrap or through ordinary `@Server()` methods via
`this.env.COSSACK_DESKTOP`. There is deliberately no renderer client or generic
IPC bridge. See Electron's security checklist before adding any renderer-facing
capability: https://www.electronjs.org/docs/latest/tutorial/security

Use `createDesktopTray({ image, menu, toolTip })` when the application needs a
tray. It returns Electron's native `Tray` and, on Linux, performs the separate
StatusNotifier registration needed by Ubuntu's AppIndicator extension. The
compatibility registration uses `dbus-send`, supplied by the standard `dbus`
package on Debian/Ubuntu. Keep the returned tray strongly referenced.

Choose close behavior explicitly with `configureDesktopClose()`:

```ts
const behavior = process.platform === 'linux'
  ? 'confirm-quit'
  : tray
    ? 'hide-to-tray'
    : 'quit';

const close = configureDesktopClose({
  window: desktop.mainWindow,
  behavior,
  tray,
  onQuit: () => desktop.quit(),
});
```

`quit` closes the application, `hide-to-tray` hides only while its tray is
alive and otherwise quits, and `confirm-quit` uses an asynchronous native
dialog. Linux tray activation varies by desktop host, so prefer
`confirm-quit` unless the target distribution has been tested. Use
`close.quit()` from every explicit Quit menu action.
