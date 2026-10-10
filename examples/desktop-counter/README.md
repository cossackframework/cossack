# Cossack Desktop counter

One Cossack page runs on the Node adapter for the web target and inside
Electron for Desktop. Both use ordinary Cossack `@Server()` actions. Electron
serves SSR, RPC, and renderer assets over `cossack://app`. No preload script,
renderer IPC bridge, or client-side Electron import is used.

The Desktop count is atomically persisted under Electron's `userData` path.
The example includes native application, renderer context, Dock, tray, and
Windows taskbar menus. It also includes async reset and close confirmation,
supported native notifications, numeric Linux/macOS badges, and a generated
Windows overlay.
Its close policy is intentionally platform-specific: Linux confirms before
quitting and creates no tray, while Windows/macOS hide to a tray only after
tray construction succeeds.

```sh
pnpm dev                 # Node web target
pnpm desktop:dev         # watched renderer + Electron main process
pnpm desktop:package     # unpacked host package
pnpm desktop:make        # .deb, .msi, or .dmg on the native host
```

Use Node 22 or 24 LTS for packaging. The Electron Packager ZIP stack is
slow under Node 26. This example's `engines` field warns about
that unsupported combination.

On Linux, the development runner reports when it uses the testing-only
`--no-sandbox` fallback from Electron. The fallback applies because the
`chrome-sandbox` file from pnpm is
user-owned. This affects `desktop:dev` only. The generated DEB installs the
helper with secure root-owned/setuid permissions.
The runner also selects XWayland when available to avoid Chromium's
Wayland/Vulkan warning. Use `COSSACK_DESKTOP_OZONE_PLATFORM=wayland` to force
native Wayland or `COSSACK_DESKTOP_DEBUG=1` to show Chromium GPU diagnostics.
The installed DEB launcher selects XWayland too. When testing the unpacked
Forge output directly, run:

```sh
./cossack-counter --no-sandbox --ozone-platform=x11
```

The unpacked binary bypasses the generated desktop entry, and its uninstalled
sandbox helper does not yet have the permissions assigned by the DEB.

Electron Forge builds only the installer for the current operating system.
macOS signing/notarization activates when `APPLE_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, and `APPLE_TEAM_ID` are supplied. Linux tray support remains
available through `createDesktopTray()`, but activation differs among desktop
hosts, so this example demonstrates `confirm-quit` instead.

When installing a DEB, `_apt` can emit a harmless unsandboxed warning if the
package is inside a parent directory it cannot traverse. Copy the DEB to
`/tmp` before `apt install` to avoid that warning.
