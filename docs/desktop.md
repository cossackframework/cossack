---
title: Desktop
description: Package a shared Cossack application with Electron.
---

# Desktop applications

Cossack Desktop adds Electron to a Cloudflare or Node.js web project.
Run `cossack add desktop`. Electron runs on Node.js and uses the same page tree
as the web application.

Desktop requests use the private `cossack://app` origin for assets, SSR, and
RPC. `@Page({ transport: 'http' })` is required. Native APIs stay in
the main process and are available to server methods through
`this.env.COSSACK_DESKTOP`. The framework does not create a preload or a generic renderer IPC API.

Use `pnpm desktop:dev`, `pnpm desktop:package`, and `pnpm desktop:make`.
Development runs Vite inside Electron and retains the private origin. Source
edits reload managed windows. Changes to the native bootstrap, the Vite
configuration, or the root `.env*` files restart Electron. The bootstrap exports
`frameworkApp`, `env`, and `startDesktop(factory)`.
Development gives the application only the bindings it declares: the `env`
passed to `createDesktopApp()` and the bootstrap's `env` export. Host process
variables and root `.env*` values are not added automatically. To build
bindings from those variables, export
`createEnv(variables)` from the bootstrap, as the Node entry does. Development
calls it with the `.env*` values for the `desktop` mode and the process
variables, and uses its result in place of the `env` export.
Generated projects export a `createEnv` that passes every variable through,
and build `env` from it only in production. Narrow it to the variables the
application needs.
Enable `developmentTraces: true` in `cossackPages()` for the shared
[inspector and CLI/MCP trace readers](./development-traces.md).
Electron Forge creates the host installer only: DEB on Linux, MSI on Windows,
and DMG on macOS. See the package [guide](../packages/desktop/docs/guide.md).

On GNOME Wayland, generated DEB launchers use XWayland for tray
registration. Unpacked Forge output bypasses the launcher. To test unpacked
output, pass `--no-sandbox --ozone-platform=x11`. Installed DEBs do not need the
testing-only sandbox fallback.

`desktop.mainWindow` always returns the current main window. If the main
window closes while another managed window is open, that window becomes the
main window. If no managed window is open, macOS activation, a second instance,
or `desktop.show()` creates a new main window. `desktop.shell` is one stable
object. Its `window`, `show()`, `hide()`, `focus()` and `setOverlayIcon()`
always target the current main window, so a saved reference keeps working.
Read `desktop.mainWindow` when you need it. Do not store it in a variable for
later use. A close policy from `configureDesktopClose()` applies to one window,
so configure it again for a replacement window.

Use `configureDesktopClose()` to choose `quit`, `hide-to-tray`, or
`confirm-quit`. Generated apps start with `quit`. Linux tray activation depends
on the desktop host, so test `confirm-quit` on the target OS. Use
`hide-to-tray` only after a tray exists and works on the target OS.

Desktop requests use Electron's native request initiator and managed window identity.
Foreign and opaque origins are rejected even when Chromium omits `Origin`.
Only verified local requests receive the internal HTTPS origin used by framework
RPC checks. Query parameters and referrers do not select a native window.
This requires Electron 43.7 or later in the 43.x series, or 44.4 or later.
Older runtimes fail at startup. See Electron's
[WebRequest documentation](https://www.electronjs.org/docs/latest/api/web-request).

Cossack owns the persistent `persist:cossack.<identifier>` Electron session and
its `onBeforeSendHeaders` hook. Do not replace that hook or register the private
protocol yourself. App hooks on the default session remain independent. Managed
windows share the private session. Cookies and browser storage from the old
default session are not migrated. App files under `app.getPath('userData')` keep
their existing paths.

Forge packages include only `package.json`, `dist/client`, `dist/desktop` and
`desktop-assets`. Put required native assets in `desktop-assets`. Project files,
web-server output and local environment files stay outside the package. If you
customize Forge, preserve this boundary.

Run `pnpm test:desktop` from this repository on Linux. The script builds and
installs local package tarballs and launches Electron. It tests RPC, window
ownership and persistence, inspects ASAR contents, runs a relocated package, and
constructs a DEB. It
requires Xvfb, `dpkg-deb` and `fakeroot`. This gate uses an uninstalled test
executable and does not prove installed sandbox permissions, menu/tray behavior,
notifications, Windows/macOS installers or signing. Those remain native-host
release checks.
