# Migrate Deno Desktop to Electron

This alpha-stage release intentionally removes the Deno Desktop compatibility
layer. Keep `@cossackframework/deno-adapter` only for Deno web or Deno Deploy.

1. Replace `@cossackframework/deno-adapter/desktop` and `/desktop/client` with
   `@cossackframework/desktop` main-process imports. Delete direct binding and
   renderer `invoke()` code.
2. Delete Desktop sections/tasks from `deno.json`, `--desktop-backend`, and
   Desktop-only `@types/deno`. Generate `src/desktop/index.ts`,
   `forge.config.ts`, Electron/Forge dependencies, and the platform assets with
   `cossack add desktop`.
3. Replace the local Deno adapter with `createDesktopApp()`. Pass the shared
   Cossack app's `fetch`, an absolute `dist/client` path, environment values,
   product name, and stable identifier.
4. Move native behavior to the Electron bootstrap or an ordinary `@Server()`
   method using `this.env.COSSACK_DESKTOP`. Keep context isolation and sandbox
   enabled; do not enable Node integration, preload, or broad IPC.
5. Use async Electron dialogs, `Notification.isSupported()`, native menu/tray
   events, macOS Dock APIs, Linux badges, and Windows overlay/taskbar APIs.
   Create trays with `createDesktopTray()`, keep them strongly referenced, and
   let the last window close if tray construction fails. The helper returns a
   native Electron `Tray` and repairs Ubuntu StatusNotifier registration.
   Replace manual close listeners with `configureDesktopClose()`: prefer
   `confirm-quit` on unverified Linux hosts, and select `hide-to-tray` on
   Windows/macOS only after tray creation succeeds.
6. Commit PNG sizes through 512px, multi-frame ICO, ICNS, and OS-specific tray
   images. Encode tray PNGs as 8-bit RGBA for Linux StatusNotifier hosts. Build
   `.deb`, `.msi`, and `.dmg` on their native runners.

Cloudflare-only bindings such as D1 are not automatically available in the
Node-based Electron process; supply a compatible binding or isolate that code
to the web target. Linux tray support requires AppIndicator or
KStatusNotifierItem. Reliable macOS notifications generally require a signed,
packaged application. Installing a DEB from a parent directory unreadable by
`_apt` may print a harmless unsandboxed warning; copy it to `/tmp` first.
Generated Linux desktop entries select XWayland for reliable GNOME tray
registration. When testing Forge's unpacked output directly, pass
`--no-sandbox --ozone-platform=x11`; an installed DEB configures the sandbox
helper and its launcher supplies the display switch.

Review Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security),
[custom protocol API](https://www.electronjs.org/docs/latest/api/protocol), and
[Forge overview](https://www.electronjs.org/docs/latest/tutorial/forge-overview).
