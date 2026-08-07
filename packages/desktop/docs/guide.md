# Cossack Desktop guide

Add the Electron side target to a Cloudflare, Node, or Deno web application:

```sh
cossack add desktop
pnpm install
pnpm desktop:dev
```

The scaffold creates `src/desktop/index.ts`, `forge.config.ts`, platform icons,
and build/package/make scripts. The Electron process always runs on Node even
when the web adapter is Deno or Cloudflare. Bindings such as D1 do not exist in
Electron unless the application supplies an Electron-compatible equivalent.

`createDesktopApp()` registers and serves `cossack://app`, injects `ASSETS` and
a window-scoped `COSSACK_DESKTOP`, and starts a sandboxed, context-isolated
`BrowserWindow`. Use only HTTP-transport pages. Native work belongs in the
bootstrap or ordinary `@Server()` methods:

Do not top-level `await` `createDesktopApp()` from an ESM entry. Invoke an async
`main()` without awaiting it at module scope so Electron can complete the first
event-loop tick and emit `ready`.

```ts
const shell = this.env.COSSACK_DESKTOP as DesktopShell;
const result = await shell.dialog.showMessageBox(shell.window, options);
```

Electron dialogs are asynchronous. Test `Notification.isSupported()` before
showing a native notification. Treat `app.dock`, Linux badges, Windows overlay
icons, taskbar buttons, menus, and trays as platform-native APIs rather than
cross-platform emulations. Keep a strong `Tray` reference, intercept close
only after tray creation succeeds, and maintain an explicit quitting flag.
Create trays with `createDesktopTray({ image, menu, toolTip })`; it returns the
native Electron object and repairs Ubuntu AppIndicator's StatusNotifier
registration through the standard Linux `dbus-send` utility.

Configure window close handling with `configureDesktopClose()`. Its
`behavior` is one of `quit`, `hide-to-tray`, or `confirm-quit`. The hide policy
requires a live tray and safely quits if that tray is later destroyed; the
confirmation policy uses an asynchronous native message box and ignores
duplicate close attempts while it is open. A conservative OS policy is
`confirm-quit` on Linux and `hide-to-tray` on Windows/macOS only after tray
construction succeeds. Generated projects start with `quit`.

On Linux, the development runner inspects Electron's local SUID sandbox helper.
If the pnpm copy is not root-owned with mode `4755`, it warns and uses
Electron's testing-only `--no-sandbox` flag for `desktop:dev`. Packaged
applications never receive this flag; DEB installation gives the helper its
required permissions.

On a Wayland session with XWayland available, `desktop:dev` selects X11 to
avoid Chromium's Wayland/Vulkan incompatibility and suppresses nonfatal GPU
probe logs. Set `COSSACK_DESKTOP_OZONE_PLATFORM=wayland` to test native Wayland,
or `COSSACK_DESKTOP_DEBUG=1` to retain Chromium diagnostics and enable Desktop
lifecycle tracing.

The generated DEB desktop entry includes `--ozone-platform=x11` for reliable
GNOME StatusNotifier tray integration. A binary launched directly from Forge's
unpacked `out/` directory does not use the desktop entry. Test that artifact as
`./your-app --no-sandbox --ozone-platform=x11`; do not add `--no-sandbox` to an
installed application's launcher.

Forge uses ASAR and the host Electron/Chromium runtime. Run `desktop:package`
for an unpacked app and `desktop:make` for the current host's `.deb`, `.msi`, or
`.dmg`; installers are not cross-built. Signing and notarization are optional
until credentials are supplied.

Node 22 or 24 LTS is recommended for packaging. Node 26 is supported, but
Electron Packager's current ZIP extraction path is extremely slow there;
generated Desktop manifests declare `node: ">=22"`.

References: [security checklist](https://www.electronjs.org/docs/latest/tutorial/security),
[protocol API](https://www.electronjs.org/docs/latest/api/protocol),
[Electron Forge](https://www.electronjs.org/docs/latest/tutorial/forge-overview),
[Menu](https://www.electronjs.org/docs/latest/api/menu),
[Tray](https://www.electronjs.org/docs/latest/api/tray), and
[Notification](https://www.electronjs.org/docs/latest/api/notification).
