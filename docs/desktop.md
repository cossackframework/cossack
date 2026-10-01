---
title: Desktop
description: Package a shared Cossack application with Electron.
---

# Desktop applications

Cossack Desktop adds Electron to a Cloudflare, Node.js, or Deno web project.
Run `cossack add desktop`. Electron runs on Node.js and uses the same page tree
as the web application.

Desktop requests use the private `cossack://app` origin for assets, SSR, and
RPC. `@Page({ transport: 'http' })` is currently required. Native APIs stay in
the main process and are available to server methods through
`this.env.COSSACK_DESKTOP`. The framework does not create a preload or a generic renderer IPC API.

Use `pnpm desktop:dev`, `pnpm desktop:package`, and `pnpm desktop:make`.
Electron Forge creates the host installer only: DEB on Linux, MSI on Windows,
and DMG on macOS. See the package [guide](../packages/desktop/docs/guide.md)
and [migration guide](./migrations/deno-desktop-to-electron.md).

On GNOME Wayland, generated DEB launchers use XWayland for tray
registration. Unpacked Forge output bypasses the launcher. Test it
with `--no-sandbox --ozone-platform=x11`. Installed DEBs do not need the
testing-only sandbox fallback.

Use `configureDesktopClose()` to choose `quit`, `hide-to-tray`, or
`confirm-quit`. Linux tray activation depends on the desktop host, so
`confirm-quit` is the default. Use `hide-to-tray` only after a
tray exists and works on the target OS.

Desktop requests reject foreign `Origin` headers. The adapter maps the trusted
`cossack://app` origin to its internal HTTPS origin before framework RPC checks.
The generated Desktop recipe now requires Electron 43.5.0 or newer in the 43.x
series for the reviewed security fixes.
