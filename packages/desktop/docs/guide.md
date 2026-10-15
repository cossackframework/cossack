# Cossack Desktop guide

Add an Electron target to a Cloudflare or Node.js web application:

```sh
cossack add desktop
pnpm install
pnpm desktop:dev
```

The scaffold creates `src/desktop/index.ts`, `forge.config.ts`, platform icons,
and build/package/make scripts. The Electron process always runs on Node even
when the web adapter is Cloudflare. Bindings such as D1 do not exist in
Electron unless the application supplies an Electron-compatible equivalent.

`createDesktopApp()` registers and serves `cossack://app`, injects `ASSETS` and
a window-scoped `COSSACK_DESKTOP`, and starts a sandboxed, context-isolated
`BrowserWindow`. It serves hashed `/assets/*` build output directly. Every
other file, including `public/`, reaches the application, so global and page
policies run first. `desktop:dev` applies those policies to `public/` files too,
while Vite answers its client and modules first. Use only HTTP-transport pages.
Native work belongs in the bootstrap or ordinary `@Server()` methods:

Keep the generated `frameworkApp`, `env` and `startDesktop(factory)` exports.
Use the supplied factory to create the application and return its Desktop result.
Put native menus, tray and close handlers inside that bootstrap. The development
runner calls it once. Only production calls it at module scope, guarded by
`if (!import.meta.env.DEV)`. Do not top-level `await` Desktop creation: Electron
must complete the first event-loop tick before it emits `ready`.

`desktop:dev` runs Vite inside Electron and keeps the renderer on `cossack://app`.
Page edits reload managed windows. Native bootstrap, Vite configuration and root `.env*`
changes restart Electron. Page syntax repair recovers the development window. Reloads
reset in-memory modules, so store durable application data explicitly. The Vite
asset listener never dispatches native application actions over loopback HTTP.
Keep `ssr.noExternal: true` limited to `mode === 'desktop' && command === 'build'`.
See the [bootstrap example](../README.md) when migrating an existing entry.

```ts
const shell = this.env.COSSACK_DESKTOP as DesktopShell;
const result = await shell.dialog.showMessageBox(shell.window, options);
```

Electron dialogs are asynchronous. Test `Notification.isSupported()` before
showing a native notification. Treat `app.dock`, Linux badges, Windows overlay
icons, taskbar buttons, menus, and trays as platform-native APIs rather than
cross-platform emulations. Keep a strong `Tray` reference. Intercept close
only after tray creation succeeds. Maintain an explicit quitting flag.
Create trays with `createDesktopTray({ image, menu, toolTip })`. It returns the
native Electron object and repairs Ubuntu AppIndicator's StatusNotifier
registration through the standard Linux `dbus-send` utility.

Configure window close handling with `configureDesktopClose()`. Its
`behavior` is one of `quit`, `hide-to-tray`, or `confirm-quit`. The hide policy
requires a live tray. It quits safely if that tray is later destroyed. The
confirmation policy uses an asynchronous native message box. It ignores
duplicate close attempts while the message box is open. A safe OS policy is
`confirm-quit` on Linux and `hide-to-tray` on Windows/macOS only after tray
construction succeeds. Generated projects start with `quit`.

On Linux, the development runner inspects Electron's local SUID sandbox helper.
If the pnpm copy is not root-owned with mode `4755`, it warns and uses
Electron's testing-only `--no-sandbox` flag for `desktop:dev`. Packaged
applications never receive this flag. DEB installation gives the helper its
required permissions.

On a Wayland session with XWayland available, `desktop:dev` selects X11.
This avoids Chromium's Wayland/Vulkan incompatibility. The runner suppresses
nonfatal GPU probe logs. Set `COSSACK_DESKTOP_OZONE_PLATFORM=wayland` to test native Wayland,
or `COSSACK_DESKTOP_DEBUG=1` to retain Chromium diagnostics and enable Desktop
lifecycle tracing.

The generated DEB desktop entry includes `--ozone-platform=x11` for
GNOME StatusNotifier tray integration. A binary launched directly from Forge's
unpacked `out/` directory does not use the desktop entry. Test that artifact as
`./your-app --no-sandbox --ozone-platform=x11`. Do not add `--no-sandbox` to an
installed application's launcher.

Forge uses ASAR and the host Electron/Chromium runtime. Run `desktop:package`
for an unpacked app and `desktop:make` for the current host's `.deb`, `.msi`, or
`.dmg`. Installers are not cross-built. Signing and notarization are optional
until credentials are supplied.

Use Node 22 or 24 LTS for packaging. Node 26 is supported, but
Electron Packager's current ZIP extraction path is slow there.
Generated Desktop manifests declare `node: ">=22"`.

References: [security checklist](https://www.electronjs.org/docs/latest/tutorial/security),
[protocol API](https://www.electronjs.org/docs/latest/api/protocol),
[Electron Forge](https://www.electronjs.org/docs/latest/tutorial/forge-overview),
[Menu](https://www.electronjs.org/docs/latest/api/menu),
[Tray](https://www.electronjs.org/docs/latest/api/tray), and
[Notification](https://www.electronjs.org/docs/latest/api/notification).
