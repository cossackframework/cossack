# Electron Desktop

Add Desktop beside any Cloudflare, Node, or Deno web adapter with
`cossack add desktop`. Routes remain in `src/pages/`; Electron's Node-based
main entry lives at `src/desktop/index.ts` and packages with Forge.

Desktop pages must use HTTP transport. Ordinary undecorated or `@Server()`
methods run through local Cossack RPC over `cossack://app`. Native code accesses
the window-scoped `this.env.COSSACK_DESKTOP`; there is no renderer Desktop
client, preload bridge, or generic IPC layer.

Keep sandboxing and context isolation enabled, Node integration disabled,
navigation same-origin, and external links restricted to valid HTTP(S) URLs.
Use asynchronous dialogs and `Notification.isSupported()`. Treat Dock, badge,
overlay, menu, tray, and taskbar behavior as platform-specific.

Retain trays strongly. Use `configureDesktopClose()` instead of manual close
listeners: default to `confirm-quit` on unverified Linux hosts, and choose
`hide-to-tray` on Windows/macOS only after successful tray creation. Always
expose explicit Quit through the returned controller. Commit all Forge icon paths: PNG
sizes, ICO, ICNS, Linux/Windows tray sizes, and macOS template images. Encode
tray PNGs as 8-bit RGBA; some Linux StatusNotifier hosts reject 16-bit PNGs
even when Electron reports a non-empty `NativeImage`.

Run `build:desktop`, `desktop:package`, and `desktop:make`. Forge builds DEB,
MSI, or DMG on its native host. Inspect the renderer bundle to confirm that it
contains no Electron or Node implementation code. Web-runtime bindings such as
D1 require a separately supplied Electron-compatible implementation.
