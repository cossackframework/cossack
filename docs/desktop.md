---
title: Desktop
description: Package a shared Cossack application with Electron.
---

# Desktop applications

Cossack Desktop is an Electron side target for any Cloudflare, Node, or Deno
web project. Run `cossack add desktop`; the web adapter remains unchanged while
the generated Node-based Electron main process uses the same page tree.

Desktop requests use the private `cossack://app` origin for assets, SSR, and
RPC. `@Page({ transport: 'http' })` is currently required. Native APIs stay in
the main process and are available to server methods through
`this.env.COSSACK_DESKTOP`; no preload or generic renderer IPC API is created.

Use `pnpm desktop:dev`, `pnpm desktop:package`, and `pnpm desktop:make`.
Electron Forge creates the host installer only: DEB on Linux, MSI on Windows,
and DMG on macOS. See the package [guide](../packages/desktop/docs/guide.md)
and [migration guide](./migrations/deno-desktop-to-electron.md).

On GNOME Wayland, generated DEB launchers use XWayland for reliable tray
registration. Unpacked Forge output bypasses the launcher and should be tested
with `--no-sandbox --ozone-platform=x11`; installed DEBs do not need the
testing-only sandbox fallback.

Use `configureDesktopClose()` to choose `quit`, `hide-to-tray`, or
`confirm-quit`. Linux tray activation depends on the desktop host, so
`confirm-quit` is the conservative default; use `hide-to-tray` only after a
tray has been constructed and tested on the target OS.
