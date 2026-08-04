# Deno Desktop counter

One Cossack page runs in a browser and in a Deno Desktop window. Its action
methods use normal Cossack RPC in both environments: the web build executes
them on its configured web server, while the Desktop build executes them in
the local Deno server packaged with the app.

The page uses `this.isDesktop` to load and save the Desktop count with
Deno-side `localStorage`. The browser counter remains in memory. No manual
Desktop binding or `invoke()` call is needed.

The Desktop target is also a native-shell showcase:

- a native application menu with About, show/hide, notification, and explicit
  Quit, plus an in-page right-click menu with increment/decrement that works
  around the Linux WebView inspector menu;
- contrasting light/dark transparent tray icons with increment/decrement,
  show/hide/notify/quit actions and safe close-to-tray behavior;
- a Dock/taskbar count badge, menu, and reopen handler;
- a native reset confirmation dialog and explicit notification permission;
- notification click-to-focus; and
- committed macOS PNG sizes, a multi-resolution Windows ICO, a Linux PNG, and
  a shared Cossack SVG in the page.

If the current platform cannot create a tray (`trayId === 0`), closing the
window exits normally instead of hiding an inaccessible application.

Requires Deno 2.9 or newer.

## Run the web app

```sh
pnpm install
deno task dev
```

Build and run the Deno production web server:

```sh
deno task build
deno task start
```

The same web application could instead use the Cossack Cloudflare Workers or
Node.js adapter. Only the Desktop entry at `src/desktop/index.ts` must use the
Deno adapter.

## Run the Desktop app

```sh
deno task desktop:dev
```

This builds the shared client and local Desktop server, then launches Deno
Desktop with HMR. On Linux this development launcher is not registered with the
desktop environment, so GNOME may display a generic taskbar icon. Package a
production app with:

```sh
deno task desktop:build
```

The Linux build is an Ubuntu/Debian package at `dist/cossack-counter.deb`.
Install it, then launch **cossack-counter** from the application grid so GNOME
can match the running window to its registered desktop entry and icon.

```sh
install -m 0644 dist/cossack-counter.deb /tmp/cossack-counter.deb
sudo apt install /tmp/cossack-counter.deb
```

Copying the package to `/tmp` lets apt's unprivileged `_apt` helper read it.
Installing directly from a home directory that `_apt` cannot traverse still
works as root, but apt prints an unsandboxed-download warning.

Linux trays use AppIndicator/KStatusNotifierItem support. Ubuntu Desktop ships
an AppIndicator extension, but it can be absent or disabled in minimal GNOME
sessions. If the app logs that the backend could not create a tray, first
enable Ubuntu AppIndicators or install/enable
`gnome-shell-extension-appindicator`. Deno 2.9.4's published Laufey 0.5.0
WebView and CEF Linux backends are built without AppIndicator and therefore
return `trayId === 0`; installing a shell extension cannot fix that compiled
backend stub. Use a future Deno backend build with AppIndicator support (or a
locally rebuilt Laufey backend) for a Linux tray. The app exits normally on
close whenever `trayId === 0`.

To verify the behavior, increment the count from the page, its right-click
menu, and the native application/tray menus; check the Dock/taskbar badge; use
Reset and Notify; then close and restore the window through the tray or Dock
before choosing explicit Quit.
Relaunch and confirm the previous count is restored. Notification permission is
requested only after Notify is selected; denial is reported in the page.

The default backend is WebView. Change `desktop.backend` in `deno.json` to
`cef` when a bundled Chromium engine is required. The `raw` backend is not
supported because Cossack renders HTML.

Generated Desktop launchers, binaries, `.so` files, `.deno-desktop-app`,
`.downloaded`, and `dist/` are build output and should remain ignored. Keep
`deno.json`, `deno.lock`, and application source under version control.
